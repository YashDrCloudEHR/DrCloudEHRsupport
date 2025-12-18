# DrCloudEHR Support Knowledge Base

A **Multi-Modal RAG-powered** Q&A system for company knowledge bases. Supports text, images, and videos. Every question and answer is stored as a ticket with user feedback support.

## Features

- **Multi-Modal Content**: Support for text, images, and videos in your knowledge base
- **Q&A System**: Ask questions and get answers with relevant media (images/videos)
- **Document Types**: Process `.txt`, `.html`, `.htm`, and `.pdf` files
- **Ticket Storage**: All Q&A pairs are stored as tickets in JSON format
- **User Feedback**: Users can provide feedback and ratings (1-5) on answers
- **Ticket History**: View all previous questions and answers
- **Vector Search**: Powered by Qdrant for semantic search
- **LLM Synthesis**: Uses Groq for fast answer generation, OpenAI for embeddings
- **Media Display**: Images shown in gallery view with lightbox, videos embedded inline

## Quickstart

### 1) Prerequisites
- Python 3.10+
- Node.js LTS
- Qdrant Cloud account (or self-hosted)
- OpenAI API key (optional, for LLM synthesis)

### 2) Backend Setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Copy env template and edit with your credentials
cp env.sample .env
# Edit .env with your QDRANT_URL, QDRANT_API_KEY, and OPENAI_API_KEY

uvicorn main:app --reload --port 8000
```

### 3) Frontend Setup
```bash
cd ../frontend
npm install
npm run dev
```

Open http://localhost:5173

### 4) Seed Initial Knowledge Base

Add your company knowledge base documents to the `samples/` directory. Supported formats:
- **Text files**: `.txt` (plain text)
- **HTML files**: `.html`, `.htm` (with embedded images and videos)
- **PDF files**: `.pdf` (text and images are extracted automatically)

Then run:

```bash
cd backend
source .venv/bin/activate
python seed_kb.py
```

This will parse all supported files, extract text and media references, and index them in Qdrant.

## API Endpoints

- `GET /health` - Health check
- `POST /ask` - Ask a question (creates a ticket, returns answer with media)
- `POST /feedback` - Submit feedback on a ticket
- `GET /tickets` - Get ticket history
- `GET /tickets/{ticket_id}` - Get a specific ticket
- `POST /upsert` - Manually add documents to knowledge base
- `GET /media/{file_path}` - Serve media files (images, videos)
- `GET /files/{file_path}` - Serve uploaded attachment files

## Ticket Storage

All tickets are stored in `backend/tickets.json` in JSON format. Each ticket contains:
- `id`: Unique ticket ID
- `question`: User's question
- `answer`: Generated answer (if LLM was used)
- `chunks`: Retrieved document chunks
- `sources`: Source documents with similarity scores
- `created_at`: Timestamp
- `feedback`: User feedback (optional)
- `rating`: User rating 1-5 (optional)
- `feedback_at`: Feedback timestamp (optional)

## Adding Documents to Knowledge Base

### Method 1: Document Files (Recommended)

Add documents to the `samples/` directory:

**Text Files (.txt)**
```
samples/
  company_policies.txt
  employee_benefits.txt
```

**HTML Files (.html, .htm)**
```html
<!-- samples/feature_guide.html -->
<article>
  <section>
    <h2>Dashboard Overview</h2>
    <p>The dashboard provides...</p>
    <img src="dashboard.png" alt="Dashboard Screenshot">
    <iframe src="https://www.youtube.com/embed/VIDEO_ID"></iframe>
  </section>
</article>
```

**PDF Files (.pdf)**
- Add any PDF file
- Text and embedded images are automatically extracted
- Extracted images are saved to `backend/extracted_media/`

Then run: `python backend/seed_kb.py`

### Method 2: API
```bash
curl -X POST http://localhost:8000/upsert \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "text": "Your document content here",
        "source": "kb/document1.txt",
        "metadata": {
          "image_urls": ["/media/image1.png"],
          "video_urls": ["https://youtube.com/embed/xyz"],
          "source_doc": "document1.html"
        }
      }
    ]
  }'
```

## Multi-Modal Features

### How It Works

1. **Document Parsing**: HTML and PDF files are parsed to extract text chunks
2. **Media Extraction**: Images and videos found near text are linked to that text
3. **Text Embedding**: Only text is embedded (not images/videos)
4. **Semantic Search**: User questions match relevant text chunks
5. **Media Retrieval**: Associated images/videos are returned with matching text
6. **Frontend Display**: Images shown in gallery, videos embedded inline

### Media Support

**Images**:
- Local files: Place in `samples/` directory, reference as `<img src="image.png">`
- External URLs: Use full URL `<img src="https://example.com/image.jpg">`
- PDF images: Automatically extracted and served

**Videos**:
- YouTube: Use embed URL `https://www.youtube.com/embed/VIDEO_ID`
- Vimeo: Use embed URL `https://player.vimeo.com/video/VIDEO_ID`
- Local videos: Place in `samples/`, reference in HTML5 `<video>` tag

### Payload Structure

Documents are stored in Qdrant with this structure:
```json
{
  "text": "To use the dashboard feature...",
  "source": "kb/feature_guide.html#section-2",
  "image_urls": ["/media/dashboard.png", "https://example.com/img.jpg"],
  "video_urls": ["https://youtube.com/embed/xyz"],
  "source_doc": "feature_guide.html"
}
```

## Rollback to Text-Only Version

If you need to revert to the original text-only version:

```bash
# Restore backend files
cd backend
cp main_backup.py main.py
cp seed_kb_backup.py seed_kb.py

# Restore frontend file
cd ../frontend/src
cp App_backup.jsx App.jsx

# Restore requirements (remove multi-modal dependencies)
cd ../../backend
# Edit requirements.txt to remove:
# beautifulsoup4, pypdf2, pdf2image, pillow, requests, lxml

# Reinstall dependencies
pip install -r requirements.txt

# Restart backend
uvicorn main:app --reload --port 8000
```

The backup files are:
- `backend/main_backup.py` - Original API without multi-modal support
- `backend/seed_kb_backup.py` - Original seeding script (text-only)
- `frontend/src/App_backup.jsx` - Original frontend without media display

## VS Code Debug

See `.vscode/launch.json` for one-click debug of both backend and frontend.
