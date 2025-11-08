# Quick Reference Card

## 🎫 TICKETS

### Location
```
/Users/yashashwin/Rag/backend/tickets.json
```

### View Tickets
```bash
# In browser UI
http://localhost:5173 → Scroll to "Ticket History" → Click "Show Tickets"

# Via API
curl http://localhost:8000/tickets?limit=20

# Direct file
cat backend/tickets.json | jq
```

### What's Stored
- Question, Answer, Sources, Chunks
- Timestamp, Ticket ID
- User Feedback & Rating (1-5)

---

## 📄 DOCUMENTS

### Easiest Way to Add Documents

**Step 1:** Add `.txt` file to `samples/` directory
```bash
cd /Users/yashashwin/Rag/samples
# Create or copy your .txt file here
```

**Step 2:** Run seeding script
```bash
cd /Users/yashashwin/Rag/backend
source .venv/bin/activate
python seed_kb.py
```

**Done!** Documents are now in Qdrant Cloud and searchable.

### File Structure
```
Rag/
├── samples/              ← ADD YOUR .txt FILES HERE
│   ├── doc1.txt
│   ├── doc2.txt
│   └── ...
├── backend/
│   ├── tickets.json      ← TICKETS STORED HERE
│   └── seed_kb.py        ← RUN THIS TO ADD DOCUMENTS
└── frontend/
```

### Alternative: Add via API
```bash
curl -X POST http://localhost:8000/upsert \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{
      "text": "Your document content",
      "source": "kb/my_doc.txt"
    }]
  }'
```

---

## 🔍 WHERE DATA IS STORED

| Data Type | Storage Location | Access |
|-----------|----------------|--------|
| **Tickets** | `backend/tickets.json` | UI, API, or file |
| **Documents (source)** | `samples/*.txt` | Local files |
| **Documents (vectors)** | Qdrant Cloud | Via API |
| **Embeddings** | Generated on-demand | OpenAI API |

---

## ⚡ Common Tasks

### Add New Document
```bash
# 1. Add file
echo "Your content" > samples/new_doc.txt

# 2. Seed it
cd backend && source .venv/bin/activate && python seed_kb.py
```

### View All Tickets
```bash
# Browser
open http://localhost:8000/tickets?limit=50

# Or file
cat backend/tickets.json | jq '.[] | {id, question, answer, created_at}'
```

### Ask Question (Creates Ticket)
```bash
curl -X POST http://localhost:8000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "Your question", "use_llm": true}'
```

---

## 📍 File Paths

- **Tickets:** `/Users/yashashwin/Rag/backend/tickets.json`
- **Samples:** `/Users/yashashwin/Rag/samples/`
- **Seed Script:** `/Users/yashashwin/Rag/backend/seed_kb.py`

---

For detailed information, see `GUIDE.md`

