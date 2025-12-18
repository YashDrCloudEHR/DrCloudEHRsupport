import json
import os
import uuid
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from pydantic import BaseModel
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels
from openai import OpenAI
from groq import Groq
from document_parser import DocumentParser, DocumentChunk

load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "kb_documents")

# OpenAI for embeddings (Groq doesn't provide embeddings)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")

# Groq for chat completions
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

# Map known embedding model to vector dimension
EMBED_DIMS = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
}
VECTOR_SIZE = EMBED_DIMS.get(OPENAI_EMBED_MODEL)
if VECTOR_SIZE is None:
    VECTOR_SIZE = 1536

if not QDRANT_URL or not QDRANT_API_KEY:
    raise RuntimeError("QDRANT_URL and QDRANT_API_KEY must be set in environment")

client = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY,
    timeout=60,
)

# Ensure collection exists with cosine distance
def ensure_collection():
    try:
        client.get_collection(QDRANT_COLLECTION)
    except Exception:
        client.recreate_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=qmodels.VectorParams(
                size=VECTOR_SIZE,
                distance=qmodels.Distance.COSINE,
            ),
        )
    
    # Create payload index for text field to enable keyword search
    try:
        client.create_payload_index(
            collection_name=QDRANT_COLLECTION,
            field_name="text",
            field_schema=qmodels.TextIndexParams(
                type="text",
                tokenizer=qmodels.TokenizerType.WORD,
                min_token_len=2,
                max_token_len=20,
                lowercase=True,
            ),
        )
    except Exception:
        pass # Index might already exist

ensure_collection()

# OpenAI client for embeddings
oa = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# Groq client for chat completions
groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

# Ticket storage
TICKETS_FILE = Path(__file__).parent / "tickets.json"

# File upload storage
UPLOADS_DIR = Path(__file__).parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

# Allowed file types and max size
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


def sanitize_filename(filename: str) -> str:
    """Sanitize filename by removing special characters"""
    # Remove path components
    filename = os.path.basename(filename)
    # Replace spaces and special chars with underscores
    filename = re.sub(r'[^\w\-_\.]', '_', filename)
    # Remove multiple underscores
    filename = re.sub(r'_+', '_', filename)
    return filename


def get_upload_path(user_id: str, ticket_id: str) -> Path:
    """Generate upload path: uploads/{date}/{user_id}/{ticket_id}/"""
    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    upload_path = UPLOADS_DIR / date_str / user_id / ticket_id
    upload_path.mkdir(parents=True, exist_ok=True)
    return upload_path

def load_tickets():
    if TICKETS_FILE.exists():
        with open(TICKETS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def get_next_ticket_number():
    """Generate next sequential ticket number (TKT-0001, TKT-0002, etc.)"""
    tickets = load_tickets()
    # Find the highest ticket number
    max_number = 0
    for ticket in tickets:
        ticket_number = ticket.get("ticket_number", "")
        if ticket_number and ticket_number.startswith("TKT-"):
            try:
                num = int(ticket_number.split("-")[1])
                max_number = max(max_number, num)
            except (ValueError, IndexError):
                pass
    # Return next number
    next_number = max_number + 1
    return f"TKT-{next_number:04d}"

def save_ticket(ticket):
    tickets = load_tickets()
    tickets.append(ticket)
    with open(TICKETS_FILE, "w", encoding="utf-8") as f:
        json.dump(tickets, f, indent=2, ensure_ascii=False)
    return ticket

def update_ticket_feedback(ticket_id: str, feedback: str, rating: Optional[int] = None):
    tickets = load_tickets()
    for ticket in tickets:
        if ticket.get("id") == ticket_id:
            ticket["feedback"] = feedback
            if rating is not None:
                ticket["rating"] = rating
            ticket["feedback_at"] = datetime.utcnow().isoformat()
            with open(TICKETS_FILE, "w", encoding="utf-8") as f:
                json.dump(tickets, f, indent=2, ensure_ascii=False)
            return ticket
    raise HTTPException(status_code=404, detail="Ticket not found")


def get_embeddings(texts: List[str]) -> List[List[float]]:
    if oa is None:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY not set; embeddings not available.")
    resp = oa.embeddings.create(model=OPENAI_EMBED_MODEL, input=texts)
    return [d.embedding for d in resp.data]


class UpsertItem(BaseModel):
    text: str
    source: Optional[str] = None
    id: Optional[str] = None
    metadata: Optional[dict] = None  # For multi-modal: image_urls, video_urls, etc.


class UpsertRequest(BaseModel):
    items: List[UpsertItem]


class ConversationMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class AskRequest(BaseModel):
    question: str
    top_k: int = 5
    use_llm: bool = True
    conversation_history: Optional[List[ConversationMessage]] = None
    user_id: Optional[str] = None  # From main website
    site_id: Optional[str] = None  # Site/facility ID
    tags: Optional[List[str]] = None  # Tags for filtering
    filters: Optional[dict] = None  # Additional filters


class FeedbackRequest(BaseModel):
    ticket_id: str
    feedback: str
    rating: Optional[int] = None  # 1-5 scale


class CreateTicketRequest(BaseModel):
    question: str
    title: str
    category: str
    severity: Optional[str] = "Medium"  # Read-only for users, set by company
    description: str
    reason: Optional[str] = None  # Why user is creating ticket
    additional_notes: Optional[str] = None  # Additional notes from user
    conversation_history: Optional[List[ConversationMessage]] = None
    user_id: Optional[str] = None
    site_id: Optional[str] = None
    tags: Optional[List[str]] = None
    filters: Optional[dict] = None
    attachments: Optional[List[str]] = None  # File paths
    ticket_id: Optional[str] = None  # Optional: if provided, use this ID (for file upload coordination)


def search_hybrid(question: str, top_k: int = 5):
    """Hybrid search combining Vector (Semantic) and Keyword (Text Match)"""
    # 1. Vector Search
    q_emb = get_embeddings([question])[0]
    vector_res = client.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=q_emb,
        limit=max(1, min(top_k, 20)),
        with_payload=True,
    )
    
    # 2. Keyword Search (Text Match)
    try:
        keyword_res = client.scroll(
            collection_name=QDRANT_COLLECTION,
            scroll_filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(
                        key="text",
                        match=qmodels.MatchText(text=question)
                    )
                ]
            ),
            limit=max(1, min(top_k, 10)),
            with_payload=True,
        )[0]
    except Exception:
        keyword_res = []

    # 3. Combine
    combined = list(vector_res)
    existing_ids = {pt.id for pt in combined}
    
    for pt in keyword_res:
        if pt.id not in existing_ids:
            # Convert Record to ScoredPoint
            scored_pt = qmodels.ScoredPoint(
                id=pt.id,
                version=pt.version,
                score=0.85, # Boost score for keyword match
                payload=pt.payload,
                vector=None
            )
            combined.append(scored_pt)
            existing_ids.add(pt.id)
            
    return combined


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/upsert")
def upsert(req: UpsertRequest):
    texts = [it.text for it in req.items]
    embeddings = get_embeddings(texts)

    points = []
    for item, vec in zip(req.items, embeddings):
        pid = item.id or str(uuid.uuid4())
        payload = {"text": item.text}
        if item.source:
            payload["source"] = item.source
        
        # Add multi-modal metadata
        if item.metadata:
            payload["image_urls"] = item.metadata.get("image_urls", [])
            payload["video_urls"] = item.metadata.get("video_urls", [])
            payload["source_doc"] = item.metadata.get("source_doc", item.source)
            payload["image_mappings"] = item.metadata.get("image_mappings", [])  # NEW: Images with context
        else:
            payload["image_urls"] = []
            payload["video_urls"] = []
            payload["source_doc"] = item.source
            payload["image_mappings"] = []
        
        points.append(
            qmodels.PointStruct(
                id=pid,
                vector=vec,
                payload=payload,
            )
        )

    client.upsert(
        collection_name=QDRANT_COLLECTION,
        points=points,
        wait=True,
    )
    return {"upserted": len(points)}


@app.post("/ask")
def ask(
    req: AskRequest,
    x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
    x_site_id: Optional[str] = Header(None, alias="X-Site-ID"),
    x_tags: Optional[str] = Header(None, alias="X-Tags"),  # Comma-separated
):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question is empty.")

    # Capture user context from headers or request body (headers take precedence)
    user_id = x_user_id or req.user_id
    site_id = x_site_id or req.site_id
    tags = req.tags or (x_tags.split(",") if x_tags else [])
    tags = [tag.strip() for tag in tags if tag.strip()]  # Clean up tags

    # Hybrid Search
    search_res = search_hybrid(req.question, req.top_k)

    contexts = []
    sources = []
    all_images = []
    all_videos = []
    all_image_mappings = []  # Images with context for smart matching
    
    for pt in search_res:
        payload = pt.payload or {}
        text = payload.get("text") or ""
        source = payload.get("source") or "unknown"
        image_urls = payload.get("image_urls", [])
        video_urls = payload.get("video_urls", [])
        image_mappings = payload.get("image_mappings", [])
        
        if text:
            contexts.append(text)
            sources.append({"source": source, "score": float(pt.score)})
            
            # Collect unique media URLs
            for img_url in image_urls:
                if img_url not in all_images:
                    all_images.append(img_url)
            for vid_url in video_urls:
                if vid_url not in all_videos:
                    all_videos.append(vid_url)
            
            # Collect image mappings (dedupe by URL)
            seen_urls = {m.get("url") for m in all_image_mappings}
            for mapping in image_mappings:
                if mapping.get("url") and mapping["url"] not in seen_urls:
                    all_image_mappings.append(mapping)
                    seen_urls.add(mapping["url"])

    answer = None
    if req.use_llm:
        if groq_client is None:
            raise HTTPException(status_code=400, detail="GROQ_API_KEY not set; set use_llm=false or configure key.")

        system_prompt = (
            "You are a helpful assistant for DrCloudEHR Support. "
            "Answer using the provided context. "
            "\n\nFORMATTING RULES:"
            "\n- For procedures, use NUMBERED STEPS (1. 2. 3.)"
            "\n- Each step on its OWN LINE"
            "\n- For lists, use bullet points (•)"
            "\n- Keep steps clear and concise"
            "\n- Do NOT add any citations or references"
            "\n\nIf not in context, say you don't know."
        )
        context_block = "\n\n".join(f"- {c}" for c in contexts[:10])

        # Build messages with conversation history
        messages = [{"role": "system", "content": system_prompt}]
        
        # Add conversation history if provided
        if req.conversation_history:
            for msg in req.conversation_history:
                if msg.role in ["user", "assistant"]:
                    messages.append({"role": msg.role, "content": msg.content})
        
        # Add current question with context
        current_content = f"Context from knowledge base:\n{context_block}\n\nQuestion: {req.question}"
        messages.append({"role": "user", "content": current_content})

        chat = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            temperature=0.2,
            messages=messages,
        )
        answer = chat.choices[0].message.content.strip() if chat.choices else ""

    # Create and save log entry (Q&A interaction)
    ticket_id = str(uuid.uuid4())
    # Logs don't need ticket numbers, only actual tickets do
    # ticket_number = get_next_ticket_number()  # Removed - logs don't get ticket numbers
    
    log_entry = {
        "id": ticket_id,
        "type": "log",  # Mark as log (Q&A interaction)
        "question": req.question,
        "answer": answer,
        "chunks": contexts,
        "sources": sources,
        "use_llm": req.use_llm,
        "created_at": datetime.utcnow().isoformat(),
        "feedback": None,
        "rating": None,
        "feedback_at": None,
        "user_id": user_id,
        "site_id": site_id,
        "tags": tags,
        "filters": req.filters or {},
    }
    save_ticket(log_entry)

    return {
        "ticket_id": ticket_id,
        "answer": answer,
        "chunks": contexts,
        "sources": sources,
        "media": {
            "images": all_images,
            "videos": all_videos,
            "image_mappings": all_image_mappings,
        }
    }


@app.post("/ask/stream")
async def ask_stream(
    req: AskRequest,
    x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
    x_site_id: Optional[str] = Header(None, alias="X-Site-ID"),
    x_tags: Optional[str] = Header(None, alias="X-Tags"),
):
    """Streaming version of /ask endpoint with SSE support"""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question is empty.")
    
    # Capture user context
    user_id = x_user_id or req.user_id
    site_id = x_site_id or req.site_id
    tags = req.tags or (x_tags.split(",") if x_tags else [])
    tags = [tag.strip() for tag in tags if tag.strip()]
    
    # Hybrid Search
    search_res = search_hybrid(req.question, req.top_k)
    
    contexts = []
    sources = []
    all_images = []
    all_videos = []
    chunk_images = {}  # Map chunk index to its images
    all_image_mappings = []  # NEW: Images with context for smart matching
    
    for idx, pt in enumerate(search_res):
        payload = pt.payload or {}
        text = payload.get("text") or ""
        source = payload.get("source") or "unknown"
        image_urls = payload.get("image_urls", [])
        video_urls = payload.get("video_urls", [])
        image_mappings = payload.get("image_mappings", [])  # NEW
        
        if text:
            contexts.append(text)
            sources.append({"source": source, "score": float(pt.score)})
            
            # Store images associated with this chunk
            if image_urls:
                chunk_images[len(contexts) - 1] = image_urls
            
            for img_url in image_urls:
                if img_url not in all_images:
                    all_images.append(img_url)
            for vid_url in video_urls:
                if vid_url not in all_videos:
                    all_videos.append(vid_url)
            
            # Collect image mappings (dedupe by URL)
            seen_urls = {m.get("url") for m in all_image_mappings}
            for mapping in image_mappings:
                if mapping.get("url") and mapping["url"] not in seen_urls:
                    all_image_mappings.append(mapping)
                    seen_urls.add(mapping["url"])
    
    ticket_id = str(uuid.uuid4())
    
    async def event_generator():
        """Generate SSE events for streaming response"""
        try:
            # Send initial metadata including images per source and image mappings for smart matching
            yield f"data: {json.dumps({'type': 'metadata', 'ticket_id': ticket_id, 'chunks': contexts, 'sources': sources, 'media': {'images': all_images, 'videos': all_videos}, 'source_images': chunk_images, 'image_mappings': all_image_mappings})}\n\n"
            
            if req.use_llm:
                if groq_client is None:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'GROQ_API_KEY not set'})}\n\n"
                    return
                
                system_prompt = (
                    "You are a helpful assistant for DrCloudEHR Support. "
                    "Answer using the provided context. "
                    "\n\nFORMATTING RULES:"
                    "\n- For procedures, use NUMBERED STEPS (1. 2. 3.)"
                    "\n- Each step on its OWN LINE"
                    "\n- For lists, use bullet points (•)"
                    "\n- Keep steps clear and concise"
                    "\n- Do NOT add any citations or references"
                    "\n\nExample:"
                    "\nTo submit DARTS records:"
                    "\n1. Navigate to Patient Summary Chart"
                    "\n2. Click on the DARTS tab"
                    "\n3. Select records to submit"
                    "\n4. Click the Submit button"
                    "\n\nIf not in context, say you don't know."
                )
                
                # Build context - images are handled separately by the frontend
                context_entries = []
                for i, text in enumerate(contexts[:10]):
                    entry = f"[Source {i+1}] {text}"
                    context_entries.append(entry)
                context_block = "\n\n".join(context_entries)
                
                messages = [{"role": "system", "content": system_prompt}]
                
                if req.conversation_history:
                    for msg in req.conversation_history:
                        if msg.role in ["user", "assistant"]:
                            messages.append({"role": msg.role, "content": msg.content})
                
                current_content = f"Context from knowledge base:\n{context_block}\n\nQuestion: {req.question}"
                messages.append({"role": "user", "content": current_content})
                
                # Stream the response
                full_answer = ""
                stream = groq_client.chat.completions.create(
                    model=GROQ_MODEL,
                    temperature=0.2,
                    messages=messages,
                    stream=True,
                )
                
                for chunk in stream:
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        full_answer += content
                        yield f"data: {json.dumps({'type': 'token', 'content': content})}\n\n"
                
                # Generate suggested follow-up questions
                if full_answer:
                    try:
                        follow_up_prompt = f"Based on this question: '{req.question}' and answer: '{full_answer[:500]}...', generate 3 brief follow-up questions a user might ask. Return ONLY a JSON array of strings, nothing else."
                        
                        follow_up_response = groq_client.chat.completions.create(
                            model=GROQ_MODEL,
                            temperature=0.7,
                            messages=[{"role": "user", "content": follow_up_prompt}],
                            max_tokens=200,
                        )
                        
                        suggested_text = follow_up_response.choices[0].message.content.strip()
                        # Try to parse as JSON array
                        try:
                            suggested_questions = json.loads(suggested_text)
                            if isinstance(suggested_questions, list) and len(suggested_questions) > 0:
                                yield f"data: {json.dumps({'type': 'suggestions', 'questions': suggested_questions[:4]})}\n\n"
                        except:
                            # Fallback: split by newlines
                            lines = [l.strip('- ').strip() for l in suggested_text.split('\n') if l.strip()]
                            if lines:
                                yield f"data: {json.dumps({'type': 'suggestions', 'questions': lines[:4]})}\n\n"
                    except Exception as e:
                        print(f"Failed to generate suggestions: {e}")
                
                # Save log entry
                log_entry = {
                    "id": ticket_id,
                    "type": "log",
                    "question": req.question,
                    "answer": full_answer,
                    "chunks": contexts,
                    "sources": sources,
                    "use_llm": req.use_llm,
                    "created_at": datetime.utcnow().isoformat(),
                    "feedback": None,
                    "rating": None,
                    "feedback_at": None,
                    "user_id": user_id,
                    "site_id": site_id,
                    "tags": tags,
                    "filters": req.filters or {},
                }
                save_ticket(log_entry)
            else:
                # Non-LLM mode: just return chunks
                answer = "\n\n".join(contexts[:3]) if contexts else "No relevant information found."
                yield f"data: {json.dumps({'type': 'answer', 'content': answer})}\n\n"
            
            # Send completion event
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


@app.post("/feedback")
def submit_feedback(req: FeedbackRequest):
    if not req.feedback.strip():
        raise HTTPException(status_code=400, detail="Feedback cannot be empty.")
    if req.rating is not None and (req.rating < 1 or req.rating > 5):
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5.")
    return update_ticket_feedback(req.ticket_id, req.feedback, req.rating)


@app.get("/tickets")
def get_tickets(
    user_id: Optional[str] = None,
    site_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    tags: Optional[str] = None,  # Comma-separated
    limit: int = 1000
):
    """Get user-created support tickets only - excludes Q&A logs"""
    tickets = load_tickets()
    # Filter to only tickets (user-created support tickets)
    filtered = [t for t in tickets if t.get("type") == "ticket" or t.get("is_support_ticket", False)]
    
    # Apply filters
    if user_id:
        filtered = [t for t in filtered if t.get("user_id") == user_id]
    
    if site_id:
        filtered = [t for t in filtered if t.get("site_id") == site_id]
    
    if start_date:
        start_date_normalized = start_date.split('T')[0] if 'T' in start_date else start_date
        filtered = [t for t in filtered if t.get("created_at", "").split('T')[0] >= start_date_normalized]
    
    if end_date:
        end_date_normalized = end_date.split('T')[0] if 'T' in end_date else end_date
        filtered = [t for t in filtered if t.get("created_at", "").split('T')[0] <= end_date_normalized]
    
    if tags:
        tag_list = [tag.strip() for tag in tags.split(",")]
        filtered = [t for t in filtered if any(tag in (t.get("tags") or []) for tag in tag_list)]
    
    # Sort by date (newest first) and limit
    filtered.sort(key=lambda x: x.get("created_at", "") or "1970-01-01T00:00:00", reverse=True)
    
    return {
        "tickets": filtered[:limit],
        "total": len(filtered),
        "filters_applied": {
            "user_id": user_id,
            "site_id": site_id,
            "start_date": start_date,
            "end_date": end_date,
            "tags": tags
        }
    }


@app.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str):
    tickets = load_tickets()
    for ticket in tickets:
        if ticket.get("id") == ticket_id:
            return ticket
    raise HTTPException(status_code=404, detail="Ticket not found")


@app.post("/upload-attachment")
async def upload_attachment(
    files: List[UploadFile] = File(...),
    user_id: str = Form(...),
    ticket_id: str = Form(...),
):
    """Upload attachment files for a ticket"""
    if not user_id or not ticket_id:
        raise HTTPException(status_code=400, detail="user_id and ticket_id are required")
    
    uploaded_paths = []
    upload_dir = get_upload_path(user_id, ticket_id)
    
    for index, file in enumerate(files, start=1):
        # Validate file extension
        file_ext = Path(file.filename).suffix.lower()
        if file_ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"File type {file_ext} not allowed. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
            )
        
        # Read file content to check size
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File {file.filename} exceeds maximum size of {MAX_FILE_SIZE / (1024*1024)}MB"
            )
        
        # Sanitize filename and create numbered filename
        sanitized_name = sanitize_filename(file.filename)
        numbered_filename = f"{index}_{sanitized_name}"
        file_path = upload_dir / numbered_filename
        
        # Save file
        with open(file_path, "wb") as f:
            f.write(content)
        
        # Store relative path (from backend directory)
        # Path format: uploads/{date}/{user_id}/{ticket_id}/{index}_{filename}
        relative_path = file_path.relative_to(Path(__file__).parent)
        uploaded_paths.append(str(relative_path).replace('\\', '/'))  # Normalize path separators
    
    return {
        "message": f"Successfully uploaded {len(uploaded_paths)} file(s)",
        "file_paths": uploaded_paths
    }


@app.post("/create-ticket")
def create_ticket(
    req: CreateTicketRequest,
    x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
    x_site_id: Optional[str] = Header(None, alias="X-Site-ID"),
    x_tags: Optional[str] = Header(None, alias="X-Tags"),
):
    """Create a support ticket when user is not satisfied with the answer"""
    # Validate required fields
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    if not req.category.strip():
        raise HTTPException(status_code=400, detail="Category is required")
    if not req.description.strip():
        raise HTTPException(status_code=400, detail="Description is required")
    
    # Validate category
    valid_categories = ["Bug", "Feature Request", "Question", "Incident", "Change Request"]
    if req.category not in valid_categories:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category. Must be one of: {', '.join(valid_categories)}"
        )
    
    # Capture user context from headers or request body
    user_id = x_user_id or req.user_id or "anonymous"
    site_id = x_site_id or req.site_id
    tags = req.tags or (x_tags.split(",") if x_tags else [])
    tags = [tag.strip() for tag in tags if tag.strip()]
    
    # Use provided ticket_id or generate new one
    ticket_id = req.ticket_id or str(uuid.uuid4())
    # Generate ticket number
    ticket_number = get_next_ticket_number()
    
    # Extract the user's original question from conversation history (first user message)
    # This is more reliable than req.question which might contain the LLM answer
    user_question = req.question  # Fallback to req.question
    if req.conversation_history:
        # Find the first user message in conversation history
        for msg in req.conversation_history:
            if msg.role == "user" and msg.content:
                user_question = msg.content
                break
    
    # Extract the last assistant answer from conversation history (the answer user was not satisfied with)
    last_answer = None
    if req.conversation_history:
        # Find the last assistant message in conversation history
        for msg in reversed(req.conversation_history):
            if msg.role == "assistant":
                last_answer = msg.content
                break
    
    # Build comprehensive context for Jira integration
    context = {
        "title": req.title,
        "category": req.category,
        "severity": req.severity or "Medium",
        "description": req.description,
        "additional_notes": req.additional_notes or "",
        "reason_for_ticket": req.reason or "User requested support",
        "original_question": user_question,
        "chatbot_response": last_answer,
        "conversation_summary": f"User asked: {user_question[:200]}..." if user_question and len(user_question) > 200 else user_question,
        "attachment_count": len(req.attachments or []),
        "attachment_paths": req.attachments or [],
        "user_id": user_id,
        "site_id": site_id,
        "tags": tags,
        "created_at": datetime.utcnow().isoformat(),
    }
    
    ticket = {
        "id": ticket_id,
        "type": "ticket",  # Mark as ticket (user-created support ticket)
        "ticket_number": ticket_number,  # Auto-assigned ticket number
        "title": req.title,
        "category": req.category,
        "severity": req.severity or "Medium",
        "description": req.description,
        "additional_notes": req.additional_notes or "",  # NEW: Additional notes field
        "question": user_question,  # Use the user's question from conversation_history, not req.question
        "answer": last_answer,  # Store the chatbot answer that user was not satisfied with
        "chunks": [],
        "sources": [],
        "use_llm": False,
        "created_at": datetime.utcnow().isoformat(),
        "feedback": req.reason or "User requested support ticket - not satisfied with answer",
        "rating": None,
        "feedback_at": datetime.utcnow().isoformat(),
        "is_support_ticket": True,
        "conversation_history": [{"role": m.role, "content": m.content} for m in (req.conversation_history or [])],
        "user_id": user_id,
        "site_id": site_id,
        "tags": tags,
        "filters": req.filters or {},
        "attachments": req.attachments or [],
        "context": context,  # NEW: Full context for dashboard and Jira export
        "jira_status": "not_exported",  # Track Jira export status
    }
    save_ticket(ticket)
    return {"ticket_id": ticket_id, "ticket_number": ticket_number, "message": "Support ticket created successfully"}


@app.get("/files/{file_path:path}")
def get_file(file_path: str):
    """Serve uploaded files"""
    file_full_path = Path(__file__).parent / file_path
    # Security: ensure file is within uploads directory
    uploads_abs = Path(__file__).parent / "uploads"
    try:
        file_full_path.resolve().relative_to(uploads_abs.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not file_full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(file_full_path)


@app.get("/media/{file_path:path}")
def get_media(file_path: str):
    """Serve media files (images, videos) from samples or extracted_media directories"""
    # Try samples directory first
    samples_path = Path(__file__).parent.parent / "samples" / file_path
    if samples_path.exists() and samples_path.is_file():
        return FileResponse(samples_path)
    
    # Try extracted_media directory
    extracted_path = Path(__file__).parent / file_path
    if extracted_path.exists() and extracted_path.is_file():
        return FileResponse(extracted_path)
    
    # Security check: ensure file is within allowed directories
    backend_dir = Path(__file__).parent
    samples_dir = backend_dir.parent / "samples"
    
    try:
        # Check if path is within samples or extracted_media
        if samples_path.exists():
            samples_path.resolve().relative_to(samples_dir.resolve())
        elif extracted_path.exists():
            extracted_path.resolve().relative_to(backend_dir.resolve())
        else:
            raise HTTPException(status_code=404, detail="Media file not found")
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")
    
    return FileResponse(samples_path if samples_path.exists() else extracted_path)


@app.get("/logs")
def get_logs(
    user_id: Optional[str] = None,
    site_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    tags: Optional[str] = None,  # Comma-separated
    limit: int = 1000
):
    """Get logs (Q&A interactions) with filtering options - excludes user-created tickets"""
    tickets = load_tickets()
    
    # Filter to only logs (Q&A interactions), exclude tickets
    filtered = [t for t in tickets if t.get("type") == "log" or (t.get("type") != "ticket" and not t.get("is_support_ticket", False))]
    
    if user_id:
        filtered = [t for t in filtered if t.get("user_id") == user_id]
    
    if site_id:
        filtered = [t for t in filtered if t.get("site_id") == site_id]
    
    if start_date:
        # Handle ISO format dates (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
        start_date_normalized = start_date.split('T')[0] if 'T' in start_date else start_date
        filtered = [t for t in filtered if t.get("created_at", "").split('T')[0] >= start_date_normalized]
    
    if end_date:
        # Handle ISO format dates - add time to include the full day
        end_date_normalized = end_date.split('T')[0] if 'T' in end_date else end_date
        # For end_date, we want to include the entire day, so compare date part only
        filtered = [t for t in filtered if t.get("created_at", "").split('T')[0] <= end_date_normalized]
    
    if tags:
        tag_list = [tag.strip() for tag in tags.split(",")]
        filtered = [t for t in filtered if any(tag in (t.get("tags") or []) for tag in tag_list)]
    
    # Sort by date (newest first) and limit
    # Handle both ISO format and empty dates
    filtered.sort(key=lambda x: x.get("created_at", "") or "1970-01-01T00:00:00", reverse=True)
    
    return {
        "logs": filtered[:limit],
        "total": len(filtered),
        "filters_applied": {
            "user_id": user_id,
            "site_id": site_id,
            "start_date": start_date,
            "end_date": end_date,
            "tags": tags
        }
    }


# Initialize parser
doc_parser = DocumentParser()

@app.post("/admin/upload-doc")
async def admin_upload_doc(file: UploadFile = File(...)):
    """Upload a document to the Knowledge Base (PDF, HTML, TXT)"""
    # Check file type
    ext = Path(file.filename).suffix.lower()
    if ext not in ['.pdf', '.html', '.htm', '.txt']:
        raise HTTPException(status_code=400, detail="Unsupported file type. Use PDF, HTML, or TXT.")
    
    filename = sanitize_filename(file.filename)
    # Save to samples directory so it's persistent and served
    samples_dir = Path(__file__).parent.parent / "samples"
    samples_dir.mkdir(exist_ok=True)
    
    file_path = samples_dir / filename
    
    # Save file
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
        
    try:
        # Parse document
        chunks = doc_parser.parse_document(str(file_path))
        
        if not chunks:
            return {"message": "File uploaded but no text content found", "chunks": 0}
            
        # Convert to UpsertItems
        items = []
        for chunk in chunks:
            chunk_dict = chunk.to_dict()
            items.append(UpsertItem(
                text=chunk_dict["text"],
                source=chunk_dict["source"],
                metadata={
                    "image_urls": chunk_dict["image_urls"],
                    "video_urls": chunk_dict["video_urls"],
                    "source_doc": chunk_dict["source_doc"],
                }
            ))
            
        # Upsert to Qdrant
        # Reuse the upsert endpoint logic
        req = UpsertRequest(items=items)
        result = upsert(req)
        
        return {
            "message": f"Successfully processed {filename}",
            "chunks": len(chunks),
            "upserted": result.get("upserted", 0),
            "file_path": str(file_path.relative_to(Path(__file__).parent.parent))
        }
        
    except Exception as e:
        print(f"Error processing file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")


@app.get("/admin/stats")
def admin_stats():
    """Get knowledge base statistics"""
    try:
        # Get collection info
        info = client.get_collection(QDRANT_COLLECTION)
        vector_count = info.points_count
        
        # Get tickets/logs count
        tickets = load_tickets()
        total_interactions = len(tickets)
        support_tickets = sum(1 for t in tickets if t.get("type") == "ticket" or t.get("is_support_ticket", False))
        feedback_count = sum(1 for t in tickets if t.get("feedback"))
        avg_rating = 0
        rated_tickets = [t for t in tickets if t.get("rating")]
        if rated_tickets:
            avg_rating = sum(t.get("rating") for t in rated_tickets) / len(rated_tickets)
            
        return {
            "documents": {
                "vectors": vector_count,
                "status": str(info.status)
            },
            "interactions": {
                "total": total_interactions,
                "support_tickets": support_tickets,
                "feedback_received": feedback_count,
                "average_rating": round(avg_rating, 2) if avg_rating else None
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch stats: {str(e)}")


# ============================================================
# TICKET CONTEXT & JIRA INTEGRATION ENDPOINTS
# ============================================================

@app.get("/tickets/{ticket_id}/context")
def get_ticket_context(ticket_id: str):
    """Get full context of a ticket for detailed view"""
    tickets = load_tickets()
    for ticket in tickets:
        if ticket.get("id") == ticket_id or ticket.get("ticket_number") == ticket_id:
            # Build comprehensive context if not already stored
            context = ticket.get("context") or {
                "title": ticket.get("title", ""),
                "category": ticket.get("category", ""),
                "severity": ticket.get("severity", "Medium"),
                "description": ticket.get("description", ""),
                "additional_notes": ticket.get("additional_notes", ""),
                "reason_for_ticket": ticket.get("feedback", ""),
                "original_question": ticket.get("question", ""),
                "chatbot_response": ticket.get("answer", ""),
                "attachment_count": len(ticket.get("attachments", [])),
                "attachment_paths": ticket.get("attachments", []),
                "user_id": ticket.get("user_id", ""),
                "site_id": ticket.get("site_id", ""),
                "tags": ticket.get("tags", []),
                "created_at": ticket.get("created_at", ""),
            }
            return {
                "ticket_id": ticket.get("id"),
                "ticket_number": ticket.get("ticket_number"),
                "context": context,
                "conversation_history": ticket.get("conversation_history", []),
                "jira_status": ticket.get("jira_status", "not_exported"),
            }
    raise HTTPException(status_code=404, detail="Ticket not found")


@app.get("/tickets/{ticket_id}/jira-export")
def export_ticket_to_jira_format(ticket_id: str):
    """Export a single ticket in Jira-compatible JSON format"""
    tickets = load_tickets()
    for ticket in tickets:
        if ticket.get("id") == ticket_id or ticket.get("ticket_number") == ticket_id:
            # Map severity to Jira priority
            severity_to_priority = {
                "Low": "Low",
                "Medium": "Medium", 
                "High": "High",
                "Critical": "Highest"
            }
            
            # Map category to Jira issue type
            category_to_type = {
                "Bug": "Bug",
                "Feature Request": "Story",
                "Question": "Task",
                "Incident": "Bug",
                "Change Request": "Story"
            }
            
            # Build Jira-compatible description
            context = ticket.get("context", {})
            description_parts = []
            
            description_parts.append(f"*Description:*\n{ticket.get('description', 'N/A')}\n")
            
            if context.get("additional_notes"):
                description_parts.append(f"*Additional Notes:*\n{context.get('additional_notes')}\n")
            
            description_parts.append(f"*Reason for Ticket:*\n{context.get('reason_for_ticket', ticket.get('feedback', 'N/A'))}\n")
            
            if ticket.get("question"):
                description_parts.append(f"*Original User Question:*\n{ticket.get('question')}\n")
            
            if ticket.get("answer"):
                answer_preview = ticket.get("answer", "")[:500] + "..." if len(ticket.get("answer", "")) > 500 else ticket.get("answer", "")
                description_parts.append(f"*Chatbot Response (User Not Satisfied):*\n{answer_preview}\n")
            
            attachments = ticket.get("attachments", [])
            if attachments:
                description_parts.append(f"*Attachments ({len(attachments)}):*")
                for att in attachments:
                    description_parts.append(f"- {att}")
            
            description_parts.append(f"\n*User ID:* {ticket.get('user_id', 'anonymous')}")
            description_parts.append(f"*Site ID:* {ticket.get('site_id', 'N/A')}")
            description_parts.append(f"*Internal Ticket:* {ticket.get('ticket_number', ticket.get('id'))}")
            
            # Conversation history summary
            conv_history = ticket.get("conversation_history", [])
            if conv_history:
                description_parts.append(f"\n*Conversation History ({len(conv_history)} messages):*")
                for i, msg in enumerate(conv_history[:5]):  # First 5 messages
                    role = msg.get("role", "unknown").capitalize()
                    content = msg.get("content", "")[:200]
                    if len(msg.get("content", "")) > 200:
                        content += "..."
                    description_parts.append(f"{i+1}. [{role}]: {content}")
                if len(conv_history) > 5:
                    description_parts.append(f"   ... and {len(conv_history) - 5} more messages")
            
            jira_format = {
                "fields": {
                    "project": {
                        "key": "DRCLOUD"  # Placeholder - user should configure
                    },
                    "summary": ticket.get("title", f"Support Ticket: {ticket.get('ticket_number', 'Unknown')}"),
                    "description": "\n".join(description_parts),
                    "issuetype": {
                        "name": category_to_type.get(ticket.get("category", "Question"), "Task")
                    },
                    "priority": {
                        "name": severity_to_priority.get(ticket.get("severity", "Medium"), "Medium")
                    },
                    "labels": ticket.get("tags", []) + ["drcloudehr", "support-bot"],
                }
            }
            
            return {
                "ticket_number": ticket.get("ticket_number"),
                "jira_payload": jira_format,
                "raw_context": context,
                "export_timestamp": datetime.utcnow().isoformat(),
            }
    
    raise HTTPException(status_code=404, detail="Ticket not found")


class JiraBulkExportRequest(BaseModel):
    ticket_ids: List[str]
    project_key: Optional[str] = "DRCLOUD"


@app.post("/tickets/jira-export-bulk")
def export_tickets_bulk(req: JiraBulkExportRequest):
    """Export multiple tickets in Jira-compatible format for bulk import"""
    tickets = load_tickets()
    exports = []
    not_found = []
    
    for tid in req.ticket_ids:
        found = False
        for ticket in tickets:
            if ticket.get("id") == tid or ticket.get("ticket_number") == tid:
                found = True
                # Get single export
                try:
                    export = export_ticket_to_jira_format(tid)
                    # Update project key
                    export["jira_payload"]["fields"]["project"]["key"] = req.project_key
                    exports.append(export)
                except:
                    not_found.append(tid)
                break
        if not found:
            not_found.append(tid)
    
    return {
        "exported": len(exports),
        "not_found": not_found,
        "exports": exports,
        "bulk_import_ready": True,
        "instructions": "Use Jira's bulk import API or copy the jira_payload for each ticket to create issues."
    }


@app.post("/tickets/{ticket_id}/mark-exported")
def mark_ticket_exported(ticket_id: str):
    """Mark a ticket as exported to Jira"""
    tickets = load_tickets()
    updated = False
    
    for ticket in tickets:
        if ticket.get("id") == ticket_id or ticket.get("ticket_number") == ticket_id:
            ticket["jira_status"] = "exported"
            ticket["jira_exported_at"] = datetime.utcnow().isoformat()
            updated = True
            break
    
    if updated:
        with open(TICKETS_FILE, "w", encoding="utf-8") as f:
            json.dump(tickets, f, indent=2, ensure_ascii=False)
        return {"message": "Ticket marked as exported", "status": "exported"}
    
    raise HTTPException(status_code=404, detail="Ticket not found")
