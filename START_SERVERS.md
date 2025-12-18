# 🚀 Quick Start Guide - Start Your Servers

## ✅ Backend Status: RUNNING

**Backend URL:** http://localhost:8000  
**Health Check:** http://localhost:8000/health  
**API Docs:** http://localhost:8000/docs

---

## 🔄 If Backend Shows "Not Running" Error

### Option 1: Quick Restart (Recommended)

```bash
# Kill any existing backend processes
pkill -f "uvicorn main:app"

# Start backend fresh
cd /Users/yashashwin/Rag/backend
source .venv/bin/activate
nohup python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &

# Wait a moment
sleep 3

# Check it's running
curl http://localhost:8000/health
# Should return: {"ok":true}
```

### Option 2: Manual Start

```bash
cd /Users/yashashwin/Rag/backend
source .venv/bin/activate
python -m uvicorn main:app --reload --port 8000
```

(Keep this terminal window open - press Ctrl+C to stop)

---

## 🎨 Start Frontend

**In a NEW terminal window:**

```bash
cd /Users/yashashwin/Rag/frontend
npm run dev
```

Then open: **http://localhost:5173**

---

## ✅ Verify Everything Works

### Check Backend:
```bash
# Health check
curl http://localhost:8000/health

# Check media endpoint
curl -I http://localhost:8000/media/patient-form.png
```

### Check Frontend:
1. Open http://localhost:5173 in browser
2. Ask: "How do I create a patient record?"
3. Should see:
   - ✅ Text answer
   - ✅ Green "Patient Registration Form" image
   - ✅ No "backend not running" error

---

## 🐛 Common Issues & Fixes

### Issue: "Address already in use"

**Solution:** Kill existing process
```bash
lsof -ti:8000 | xargs kill -9
```

Then start backend again.

### Issue: "command not found: uvicorn"

**Solution:** Activate virtual environment first
```bash
cd /Users/yashashwin/Rag/backend
source .venv/bin/activate
python -m uvicorn main:app --reload --port 8000
```

### Issue: Frontend shows "Backend not running"

**Solutions:**

1. **Check if backend is actually running:**
   ```bash
   curl http://localhost:8000/health
   ```
   
2. **If no response, restart backend:**
   ```bash
   pkill -f uvicorn
   cd /Users/yashashwin/Rag/backend
   source .venv/bin/activate
   python -m uvicorn main:app --reload --port 8000
   ```

3. **Refresh browser:** Press Cmd+R or F5

4. **Check browser console:** 
   - Press F12 → Console tab
   - Look for errors about localhost:8000
   - If you see CORS errors, backend needs restart

### Issue: Images show "Image unavailable"

**Solutions:**

1. **Check if images exist:**
   ```bash
   ls /Users/yashashwin/Rag/samples/*.png
   ```
   Should show: `patient-form.png` and `dashboard-calendar.png`

2. **Check if backend can serve them:**
   ```bash
   curl http://localhost:8000/media/patient-form.png -o /tmp/test.png
   file /tmp/test.png
   ```
   Should say: "PNG image data"

3. **If images don't exist, recreate them:**
   ```bash
   cd /Users/yashashwin/Rag/backend
   source .venv/bin/activate
   cd ../samples
   python << 'EOF'
from PIL import Image, ImageDraw
img = Image.new('RGB', (700, 400), '#28A745')
d = ImageDraw.Draw(img)
d.text((150, 180), "Patient Registration Form", fill='white')
img.save('patient-form.png')
print("Created patient-form.png")
EOF
   ```

4. **Re-seed the knowledge base:**
   ```bash
   cd /Users/yashashwin/Rag/backend
   source .venv/bin/activate
   python reset_collection.py
   python seed_kb.py
   ```

---

## 📊 Current Status Check

Run this to check everything:

```bash
echo "=== Backend Status ==="
curl -s http://localhost:8000/health && echo "✓ Backend running" || echo "✗ Backend not responding"

echo ""
echo "=== Media Serving ==="
curl -s -I http://localhost:8000/media/patient-form.png | head -1

echo ""
echo "=== Images in samples/ ==="
ls -lh /Users/yashashwin/Rag/samples/*.png 2>/dev/null || echo "No PNG files found"

echo ""
echo "=== Backend Process ==="
ps aux | grep uvicorn | grep -v grep || echo "No uvicorn process found"
```

---

## 🎯 Quick Commands

### Start Everything:
```bash
# Backend (in background)
cd /Users/yashashwin/Rag/backend && source .venv/bin/activate && python -m uvicorn main:app --reload --port 8000 &

# Frontend (in new terminal)
cd /Users/yashashwin/Rag/frontend && npm run dev
```

### Stop Everything:
```bash
# Stop backend
pkill -f "uvicorn main:app"

# Stop frontend
# Press Ctrl+C in the terminal where npm run dev is running
```

### Restart Backend:
```bash
pkill -f uvicorn && sleep 1 && cd /Users/yashashwin/Rag/backend && source .venv/bin/activate && python -m uvicorn main:app --reload --port 8000 &
```

---

## 💡 Pro Tips

1. **Keep backend running in background:**
   - Add `&` at end of uvicorn command
   - Output goes to `/tmp/backend.log`
   - Check logs: `tail -f /tmp/backend.log`

2. **Frontend auto-reloads:**
   - Just edit code and save
   - Browser auto-refreshes
   - No restart needed!

3. **Backend auto-reloads:**
   - Edit Python files
   - Uvicorn detects changes
   - Restarts automatically

4. **Check what's using port 8000:**
   ```bash
   lsof -i :8000
   ```

---

## ✅ Recommended Startup Sequence

1. **Open Terminal 1 - Backend:**
   ```bash
   cd /Users/yashashwin/Rag/backend
   source .venv/bin/activate
   python -m uvicorn main:app --reload --port 8000
   ```

2. **Wait for:** "Application startup complete"

3. **Open Terminal 2 - Frontend:**
   ```bash
   cd /Users/yashashwin/Rag/frontend
   npm run dev
   ```

4. **Open Browser:** http://localhost:5173

5. **Test:** Ask "How do I create a patient record?"

---

**That's it! Both servers should now be running! 🎉**


