# Multi-Modal RAG Installation Guide

## Quick Installation

### 1. Install Backend Dependencies

```bash
cd backend

# Activate your virtual environment if you have one
source .venv/bin/activate  # or: .venv\Scripts\activate on Windows

# Install all dependencies including new multi-modal packages
pip install -r requirements.txt
```

If you encounter SSL certificate errors, try:
```bash
pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org -r requirements.txt
```

### 2. Verify Installation

Test that the new modules can be imported:

```bash
python -c "from bs4 import BeautifulSoup; from PyPDF2 import PdfReader; from PIL import Image; print('✓ All dependencies installed successfully')"
```

### 3. Test Document Parser

```bash
python -c "from document_parser import parse_document; print('✓ Document parser module loaded successfully')"
```

### 4. Seed Knowledge Base

```bash
python seed_kb.py
```

This will process all `.txt`, `.html`, `.htm`, and `.pdf` files in the `samples/` directory.

### 5. Start Backend

```bash
uvicorn main:app --reload --port 8000
```

### 6. Frontend (No Changes Needed)

The frontend will automatically detect and display media from API responses:

```bash
cd ../frontend
npm run dev
```

## Testing Multi-Modal Features

1. **Add HTML file with video to samples/**:
   - `feature_guide.html` and `quick_start.html` are already included
   - They contain YouTube video embeds

2. **Seed the knowledge base**:
   ```bash
   python backend/seed_kb.py
   ```

3. **Ask questions** like:
   - "How do I use the dashboard?"
   - "Tell me about the scheduling features"
   - "How do I create a patient record?"

4. **View results**: The UI will show related images and videos below the answer

## Troubleshooting

### Import Errors

If you get import errors like `ModuleNotFoundError: No module named 'bs4'`:

```bash
pip install beautifulsoup4 pypdf2 pdf2image pillow requests lxml
```

### PDF Image Extraction (Optional)

For PDF image extraction, you also need `poppler-utils`:

**macOS:**
```bash
brew install poppler
```

**Ubuntu/Debian:**
```bash
sudo apt-get install poppler-utils
```

**Windows:**
Download from: https://github.com/oschwartz10612/poppler-windows/releases

Note: PDF text extraction works without poppler, but image extraction requires it.

### Port Already in Use

If port 8000 is already in use:
```bash
uvicorn main:app --reload --port 8001
```

Then update `frontend/.env` or `frontend/src/App.jsx` to use port 8001.

## Verify Everything is Working

1. Backend running: Visit http://localhost:8000/health - should return `{"ok": true}`
2. Media endpoint: Visit http://localhost:8000/docs - check for `/media/{file_path}` endpoint
3. Frontend: Visit http://localhost:5173 - should load the chat interface
4. Ask a question about features - should see videos/images if available

## Need Help?

- Check `README.md` for rollback instructions
- Check `samples/README_SAMPLES.md` for document format examples
- All original files are backed up with `_backup` suffix


