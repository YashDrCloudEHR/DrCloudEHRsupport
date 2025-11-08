# DrCloudEHR Support Knowledge Base

A RAG-powered Q&A system for company knowledge bases. Every question and answer is stored as a ticket with user feedback support.

## Features

- **Q&A System**: Ask questions over your company knowledge base
- **Ticket Storage**: All Q&A pairs are stored as tickets in JSON format
- **User Feedback**: Users can provide feedback and ratings (1-5) on answers
- **Ticket History**: View all previous questions and answers
- **Vector Search**: Powered by Qdrant for semantic search
- **LLM Synthesis**: Optional OpenAI integration for answer generation

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

Add your company knowledge base documents as `.txt` files in the `samples/` directory, then run:

```bash
cd backend
source .venv/bin/activate
python seed_kb.py
```

This will read all `.txt` files from `samples/` and index them in Qdrant.

## API Endpoints

- `GET /health` - Health check
- `POST /ask` - Ask a question (creates a ticket)
- `POST /feedback` - Submit feedback on a ticket
- `GET /tickets` - Get ticket history
- `GET /tickets/{ticket_id}` - Get a specific ticket
- `POST /upsert` - Manually add documents to knowledge base

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

### Method 1: Text Files (Recommended)
1. Add `.txt` files to `samples/` directory
2. Run `python backend/seed_kb.py`

### Method 2: API
```bash
curl -X POST http://localhost:8000/upsert \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"text": "Your document content here", "source": "kb/document1.txt"},
      {"text": "More content", "source": "kb/document2.txt"}
    ]
  }'
```

## VS Code Debug

See `.vscode/launch.json` for one-click debug of both backend and frontend.
