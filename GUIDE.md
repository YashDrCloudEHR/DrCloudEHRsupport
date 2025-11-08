# Complete Guide: Tickets & Document Management

## 📋 Part 1: Ticket Storage

### Where Tickets Are Stored

**Location:** `backend/tickets.json`

This is a JSON file in your backend directory. Every time a user asks a question, a ticket is automatically created and saved here.

### Ticket Structure

Each ticket contains:
```json
{
  "id": "unique-uuid-here",
  "question": "What is Qdrant?",
  "answer": "Qdrant is a vector database...",
  "chunks": ["retrieved text chunk 1", "retrieved text chunk 2"],
  "sources": [
    {"source": "kb/qdrant.txt", "score": 0.95},
    {"source": "kb/embeddings.txt", "score": 0.87}
  ],
  "use_llm": true,
  "created_at": "2024-11-05T10:30:00.123456",
  "feedback": "Very helpful!",
  "rating": 5,
  "feedback_at": "2024-11-05T10:35:00.123456"
}
```

### How to Access Tickets

#### Method 1: Through the Web UI
1. Open your app at `http://localhost:5173`
2. Scroll down to "Ticket History" section
3. Click "Show Tickets" button
4. View all tickets with questions, answers, and feedback

#### Method 2: Through API
```bash
# Get all tickets (most recent first, limited to 50)
curl http://localhost:8000/tickets?limit=20

# Get a specific ticket by ID
curl http://localhost:8000/tickets/{ticket_id}
```

#### Method 3: Direct File Access
```bash
# View the JSON file directly
cat backend/tickets.json

# Or open in a text editor
code backend/tickets.json  # VS Code
# or
nano backend/tickets.json
```

#### Method 4: Programmatically (Python)
```python
import json
from pathlib import Path

tickets_file = Path("backend/tickets.json")
if tickets_file.exists():
    with open(tickets_file, "r", encoding="utf-8") as f:
        tickets = json.load(f)
    
    # Print all tickets
    for ticket in tickets:
        print(f"ID: {ticket['id']}")
        print(f"Question: {ticket['question']}")
        print(f"Answer: {ticket['answer']}")
        print(f"Created: {ticket['created_at']}")
        if ticket.get('feedback'):
            print(f"Feedback: {ticket['feedback']} (Rating: {ticket.get('rating')}/5)")
        print("-" * 50)
```

### Ticket File Location Details

- **Full Path:** `/Users/yashashwin/Rag/backend/tickets.json`
- **Format:** JSON array of ticket objects
- **Created:** Automatically when first question is asked
- **Updated:** Every time a question is asked or feedback is submitted
- **Backup:** The file is in `.gitignore`, so it won't be committed to git (good for privacy)

---

## 📚 Part 2: Document Storage & Management

### Where Documents Are Stored

Documents are stored in **Qdrant Cloud** (your vector database), NOT in local files. The local `samples/` directory is just for **initial seeding**.

### Document Storage Architecture

```
┌─────────────────┐
│  samples/       │  ← Source files (.txt)
│  ├─ doc1.txt   │
│  ├─ doc2.txt   │
│  └─ doc3.txt   │
└─────────────────┘
         │
         │ (seed_kb.py reads these)
         ▼
┌─────────────────┐
│  FastAPI        │  ← Embeds text chunks
│  /upsert        │
└─────────────────┘
         │
         │ (sends embeddings)
         ▼
┌─────────────────┐
│  Qdrant Cloud   │  ← Final storage (vector DB)
│  Collection:    │
│  kb_documents   │
└─────────────────┘
```

### Easiest Way to Add Documents

#### Method 1: Using the `samples/` Directory (RECOMMENDED)

**Step 1:** Add your document as a `.txt` file
```bash
# Navigate to samples directory
cd /Users/yashashwin/Rag/samples

# Create a new document
cat > company_policies.txt << EOF
Our company policy states that employees must work 40 hours per week.
Remote work is allowed 3 days per week.
Vacation time accrues at 1.5 days per month.
EOF

# Or copy an existing file
cp ~/Documents/employee_handbook.txt samples/
```

**Step 2:** Run the seeding script
```bash
cd /Users/yashashwin/Rag/backend
source .venv/bin/activate
python seed_kb.py
```

**What happens:**
- Script reads all `.txt` files from `samples/` directory
- Each file is chunked into smaller pieces (1000 chars with 200 char overlap)
- Each chunk is embedded using OpenAI
- Chunks are sent to Qdrant Cloud and stored with source tag like `kb/company_policies.txt`

**Output:**
```
Seeding knowledge base from samples/ directory...

✓ Loaded: company_policies.txt
✓ Loaded: qdrant.txt
✓ Loaded: embeddings.txt

✓ Successfully seeded 15 chunks to knowledge base
  Files processed: 3

Done! You can now ask questions in the app.
```

#### Method 2: Using the API Directly

**For single document:**
```bash
curl -X POST http://localhost:8000/upsert \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "text": "Your document content here. Can be multiple paragraphs. The system will automatically chunk it appropriately.",
        "source": "kb/manual_doc.txt"
      }
    ]
  }'
```

**For multiple documents:**
```bash
curl -X POST http://localhost:8000/upsert \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "text": "First document content...",
        "source": "kb/doc1.txt"
      },
      {
        "text": "Second document content...",
        "source": "kb/doc2.txt"
      }
    ]
  }'
```

#### Method 3: Programmatically (Python Script)

Create a script `add_documents.py`:
```python
import json
import requests
from pathlib import Path

API_BASE = "http://localhost:8000"

def add_document(text: str, source: str):
    """Add a document to the knowledge base."""
    response = requests.post(
        f"{API_BASE}/upsert",
        json={
            "items": [{"text": text, "source": source}]
        }
    )
    return response.json()

# Example usage
doc_text = """
Your company knowledge base content here.
This can be multiple paragraphs.
The system will automatically chunk it.
"""

result = add_document(doc_text, "kb/custom_doc.txt")
print(f"Added {result['upserted']} chunks")
```

### Document Organization Best Practices

1. **Use descriptive source names:**
   - ✅ Good: `kb/employee_handbook.txt`, `kb/company_policies.txt`
   - ❌ Bad: `kb/doc1.txt`, `kb/file.txt`

2. **Keep documents focused:**
   - One topic per file when possible
   - Makes it easier to identify sources in answers

3. **File structure example:**
   ```
   samples/
   ├── company_policies.txt
   ├── employee_handbook.txt
   ├── technical_docs/
   │   ├── api_guide.txt
   │   └── deployment.txt
   └── faq.txt
   ```

4. **Source tags will reflect directory structure:**
   - `samples/technical_docs/api_guide.txt` → source: `kb/technical_docs/api_guide.txt`

### How Documents Are Processed

1. **Text Extraction:** Your `.txt` files are read as-is
2. **Chunking:** Large documents are split into chunks:
   - Chunk size: 1000 characters
   - Overlap: 200 characters (for context continuity)
3. **Embedding:** Each chunk is converted to a vector using OpenAI's embedding model
4. **Storage:** Vectors are stored in Qdrant Cloud with:
   - Vector: The embedding (1536 dimensions for `text-embedding-3-small`)
   - Payload: `{"text": "chunk content", "source": "kb/filename.txt"}`

### Viewing Documents in Qdrant Cloud

1. **Via Qdrant Dashboard:**
   - Log into your Qdrant Cloud account
   - Navigate to your cluster
   - View the `kb_documents` collection
   - See all stored points (chunks) with their payloads

2. **Via API:**
   ```bash
   # This would require Qdrant client library
   # See backend/main.py for examples
   ```

### Updating Documents

**To update a document:**
1. Modify the `.txt` file in `samples/`
2. Run `python seed_kb.py` again
3. **Note:** This will ADD new chunks. Old chunks with same source will still exist.
4. **To completely replace:** Delete the collection in Qdrant Cloud dashboard, then re-seed.

**Better approach for updates:**
- Use unique source names for versions: `kb/policies_v2.txt`
- Or manually delete old chunks via Qdrant API before re-seeding

### Document Limits

- **File size:** No hard limit, but very large files (>100KB) may create many chunks
- **Chunk count:** Depends on your Qdrant Cloud plan
- **Embedding cost:** ~$0.02 per 1M tokens (OpenAI pricing)

---

## 🔄 Complete Workflow Example

### Adding a New Company Policy Document

```bash
# 1. Create the document
cd /Users/yashashwin/Rag/samples
cat > remote_work_policy.txt << EOF
Remote Work Policy

Employees may work remotely up to 3 days per week.
Remote work requires manager approval.
All remote workers must have reliable internet.
Core hours are 10 AM - 3 PM EST for team meetings.
EOF

# 2. Seed to Qdrant
cd ../backend
source .venv/bin/activate
python seed_kb.py

# 3. Test it
curl -X POST http://localhost:8000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the remote work policy?", "use_llm": true}'
```

### Viewing All Tickets

```bash
# Get all tickets
curl http://localhost:8000/tickets?limit=50 | jq

# Or view in browser
open http://localhost:8000/tickets?limit=50
```

---

## 📊 Summary

| Item | Location | Access Method |
|------|----------|---------------|
| **Tickets** | `backend/tickets.json` | UI, API, or direct file access |
| **Source Documents** | `samples/*.txt` | Add files here, then run `seed_kb.py` |
| **Vector Storage** | Qdrant Cloud | Via API or Qdrant Dashboard |
| **Embeddings** | Generated on-the-fly | OpenAI API (cached in Qdrant) |

---

## 🚀 Quick Reference Commands

```bash
# Seed documents from samples/
cd backend && source .venv/bin/activate && python seed_kb.py

# View tickets
cat backend/tickets.json | jq

# Add document via API
curl -X POST http://localhost:8000/upsert \
  -H "Content-Type: application/json" \
  -d '{"items": [{"text": "Your content", "source": "kb/my_doc.txt"}]}'

# Get all tickets
curl http://localhost:8000/tickets?limit=20

# Ask a question (creates ticket)
curl -X POST http://localhost:8000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "Your question", "use_llm": true}'
```

