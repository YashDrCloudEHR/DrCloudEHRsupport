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
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels
from openai import OpenAI
from groq import Groq

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
    conversation_history: Optional[List[ConversationMessage]] = None
    user_id: Optional[str] = None
    site_id: Optional[str] = None
    tags: Optional[List[str]] = None
    filters: Optional[dict] = None
    attachments: Optional[List[str]] = None  # File paths
    ticket_id: Optional[str] = None  # Optional: if provided, use this ID (for file upload coordination)


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

    # Embed question and search
    q_emb = get_embeddings([req.question])[0]
    search_res = client.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=q_emb,
        limit=max(1, min(req.top_k, 20)),
        with_payload=True,
    )

    contexts = []
    sources = []
    for pt in search_res:
        payload = pt.payload or {}
        text = payload.get("text") or ""
        source = payload.get("source") or "unknown"
        if text:
            contexts.append(text)
            sources.append({"source": source, "score": float(pt.score)})

    answer = None
    if req.use_llm:
        if groq_client is None:
            raise HTTPException(status_code=400, detail="GROQ_API_KEY not set; set use_llm=false or configure key.")

        system_prompt = (
            "You are a helpful and conversational assistant for DrCloudEHR Support. "
            "Answer questions using the provided context. Be natural and conversational. "
            "If the answer is not in the context, say you don't know and suggest creating a support ticket."
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
    }


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
    
    # Extract the last assistant answer from conversation history (the answer user was not satisfied with)
    last_answer = None
    if req.conversation_history:
        # Find the last assistant message in conversation history
        for msg in reversed(req.conversation_history):
            if msg.role == "assistant":
                last_answer = msg.content
                break
    
    ticket = {
        "id": ticket_id,
        "type": "ticket",  # Mark as ticket (user-created support ticket)
        "ticket_number": ticket_number,  # Auto-assigned ticket number
        "title": req.title,
        "category": req.category,
        "severity": req.severity or "Medium",
        "description": req.description,
        "question": req.question,
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
