# Multi-Modal RAG - Quick Start Guide

Get your multi-modal RAG system up and running in 5 minutes!

## 🚀 Quick Setup

### 1. Install Dependencies (2 minutes)

```bash
cd backend

# If you have a virtual environment, activate it first
source .venv/bin/activate  # macOS/Linux
# or: .venv\Scripts\activate  # Windows

# Install new packages
pip install beautifulsoup4 pypdf2 pdf2image pillow requests lxml

# Verify installation
python test_parser.py
```

Expected output: `✅ All tests passed!`

### 2. Seed Knowledge Base (1 minute)

```bash
# Still in backend/ directory
python seed_kb.py
```

You should see:
```
============================================================
Multi-Modal Knowledge Base Seeding
============================================================

Found 10 document(s) to process:

✓ Parsed feature_guide.html: 8 chunks
✓ Parsed quick_start.html: 7 chunks
✓ Parsed company_policies.txt: 4 chunks
...

✓ Successfully seeded 45 chunks to knowledge base
```

### 3. Start Backend (10 seconds)

```bash
# Still in backend/ directory
uvicorn main:app --reload --port 8000
```

Wait for: `Application startup complete`

### 4. Start Frontend (30 seconds)

Open a new terminal:

```bash
cd frontend
npm run dev
```

Visit: http://localhost:5173

### 5. Test Multi-Modal Features (1 minute)

**Ask questions like:**

1. **"How do I use the dashboard?"**
   - Should return answer with embedded video tutorial

2. **"Tell me about scheduling appointments"**
   - Should return answer with relevant screenshots

3. **"Show me the patient management features"**
   - Should return answer with images and videos

**What to expect:**
- Text answer from the LLM
- "Related Media" section below with:
  - Image gallery (if images found)
  - Video embeds (if videos found)
- Click images to view full-size

---

## 📁 Example: Adding Your Own Multi-Modal Document

### Create an HTML document:

```html
<!-- samples/my_feature.html -->
<!DOCTYPE html>
<html>
<body>
  <article>
    <section>
      <h2>Using the Dashboard</h2>
      <p>
        The dashboard is your central hub for all activities.
        It displays key metrics and provides quick access to 
        common tasks.
      </p>
      
      <!-- Local image -->
      <img src="dashboard-screenshot.png" alt="Dashboard">
      
      <!-- YouTube video -->
      <iframe src="https://www.youtube.com/embed/YOUR_VIDEO_ID"></iframe>
    </section>
    
    <section>
      <h2>Key Features</h2>
      <p>
        The dashboard includes widgets for patient lists,
        appointments, messages, and alerts. You can customize
        which widgets appear and their arrangement.
      </p>
      
      <!-- External image -->
      <img src="https://example.com/screenshot.jpg">
    </section>
  </article>
</body>
</html>
```

### Add any images:

```bash
# Place images in samples/ directory
cp dashboard-screenshot.png samples/
```

### Re-seed:

```bash
python backend/seed_kb.py
```

Done! Ask questions about your new content.

---

## 🎨 What You'll See

### Before (Text-Only):
```
Q: How do I use the dashboard?
A: The dashboard provides access to key features...

[No images or videos]
```

### After (Multi-Modal):
```
Q: How do I use the dashboard?
A: The dashboard provides access to key features...

Related Media:
[Image Gallery]
  📷 Dashboard Screenshot
  📷 Settings Panel
  📷 User Profile

[Videos]
  🎥 Dashboard Tutorial (5:23)
  🎥 Quick Start Guide (3:15)
```

---

## 🔧 Troubleshooting

### "Module not found" errors?

```bash
pip install beautifulsoup4 pypdf2 pdf2image pillow requests lxml
```

### Backend won't start?

Check if port 8000 is in use:
```bash
lsof -i :8000  # macOS/Linux
# Kill the process or use a different port
uvicorn main:app --reload --port 8001
```

### No images showing?

1. Check browser console for errors
2. Verify images are in `samples/` directory
3. Check `/media/` endpoint: http://localhost:8000/media/your-image.png

### Videos not loading?

1. YouTube videos must use embed format:
   - ✅ `https://www.youtube.com/embed/VIDEO_ID`
   - ❌ `https://www.youtube.com/watch?v=VIDEO_ID`

2. Check iframe `src` attribute in HTML

### Still having issues?

Run the test script:
```bash
python backend/test_parser.py
```

This will diagnose common problems.

---

## 📊 Verify It's Working

### Check Backend:

1. **Health check**: http://localhost:8000/health
   - Should return: `{"ok": true}`

2. **API docs**: http://localhost:8000/docs
   - Look for `/media/{file_path}` endpoint
   - Look for `media` field in `/ask` response

3. **Media endpoint**: http://localhost:8000/media/
   - Try accessing a sample image

### Check Frontend:

1. **Chat loads**: http://localhost:5173
2. **Ask a question** about dashboard/features
3. **Look for**:
   - "Related Media" section
   - Image thumbnails in a grid
   - Video players embedded
   - Click image → lightbox opens

---

## 🎯 What Changed?

**Backend:**
- ✅ New `document_parser.py` module
- ✅ Updated `seed_kb.py` to parse HTML/PDF
- ✅ Updated `main.py` to return media
- ✅ New `/media/` endpoint for serving files

**Frontend:**
- ✅ Updated `App.jsx` to display media
- ✅ Image gallery with lightbox
- ✅ Responsive video embeds

**Backward Compatible:**
- ✅ All .txt files still work
- ✅ Old API responses still work
- ✅ Can rollback anytime (see README.md)

---

## 📚 Next Steps

1. **Add your own documents**:
   - Put HTML/PDF files in `samples/`
   - Run `python seed_kb.py`

2. **Customize the parser**:
   - Edit `document_parser.py`
   - Adjust chunk size, overlap
   - Add support for more video platforms

3. **Improve the UI**:
   - Edit `frontend/src/App.jsx`
   - Customize image gallery layout
   - Add image captions

4. **Add more features**:
   - OCR for images
   - Video transcription
   - Image similarity search

---

## 🆘 Need Help?

- **Installation issues**: See `INSTALLATION.md`
- **Usage guide**: See `README.md`
- **All changes**: See `MULTIMODAL_CHANGES.md`
- **Document formats**: See `samples/README_SAMPLES.md`
- **Rollback**: See "Rollback Instructions" in `README.md`

---

## ✅ Success Checklist

- [ ] Dependencies installed
- [ ] Test script passed
- [ ] Knowledge base seeded
- [ ] Backend running on port 8000
- [ ] Frontend running on port 5173
- [ ] Can ask questions
- [ ] See images in results
- [ ] See videos in results
- [ ] Images open in lightbox
- [ ] Videos play inline

**All checked?** 🎉 You're all set!

---

**Happy Multi-Modal RAG-ing!** 🚀


