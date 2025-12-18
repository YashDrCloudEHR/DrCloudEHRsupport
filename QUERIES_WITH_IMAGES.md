# 🖼️ Queries That Return Images

**Updated:** After parser improvements - Images now appear in 486 chunks (was 194)!

## ✅ What Changed:

1. **More Coverage**: Images are now attached to ALL chunks from a document section (not just the first)
2. **No Tiny Icons**: Bullet points and decorative icons (< 20px) are automatically filtered out
3. **Better Results**: General queries now return images more reliably

---

## 🎯 Guaranteed Queries with Screenshots:

### **Treatment Plans & Settings (4 screenshots)**
```
- "Plan Settings facility form"
- "associate Progress forms"
- "Multidisciplinary Treatment Plan Settings"
- "Basic Plan Settings"
```

### **Lists & Forms (5+ screenshots)**
```
- "how do I use lists"
- "DrCloudEHR Lists"
- "field types"
```

### **Patient Verification (8 screenshots)**
```
- "verify patient benefits"
- "patient eligibility verification"
- "insurance verification process"
```

### **DARTS Illinois (40+ screenshots)**
```
- "DARTS Illinois"
- "DARTS configuration"
```

### **Appointments (6 screenshots)**
```
- "managing appointments"
- "appointment scheduling"
```

### **Fax Center (5 images)**
```
- "fax center"
- "send receive faxes"
```

### **Form Builder (Multiple screenshots)**
```
- "form builder"
- "creating custom forms"
```

### **Reports (Multiple screenshots)**
```
- "creating custom reports"
- "report builder"
```

---

## 🧪 How to Test:

1. **Refresh your frontend** (Cmd+R or F5)
2. **Try any query above**
3. **Look for "Related Media" section** below the answer
4. **Click on image thumbnails** to view full-size (now with better display!)

---

## 💡 Tips:

### Images Will Appear When:
- ✅ Your query matches content from documents with screenshots
- ✅ The matched text is from a section that has images
- ✅ The images are actual screenshots (not tiny decorative icons)

### Images Won't Appear When:
- ❌ Your query matches documents without any images
- ❌ Your query is too generic and matches mostly text-only content
- ❌ The matched section genuinely has no visual content

---

## 📊 Current Coverage:

```
Total Chunks:       3,246
With Images:          486 (15%)
With Videos:            0 (0%)

Image Types:
- Treatment plan screenshots
- Form examples  
- Configuration screens
- Workflow diagrams
- UI components
- Dashboard views
```

---

## 🔍 How to Find More Queries with Images:

### Method 1: Look at Document Names
Check the HTML files in `/samples/` - most have descriptive names:
- `Multidisciplinary-Treatment-Plan-Settings_*.html` → Ask about treatment plans
- `Managing-Appointments_*.html` → Ask about appointments
- `Creating-Custom-Reports_*.html` → Ask about reports

### Method 2: Browse Attachments
Large screenshot files are in:
```
/samples/attachments/50266135/  → Treatment plan screenshots
/samples/attachments/88998253/  → Patient verification screens
/samples/attachments/40337542/  → Lists & field types
/samples/attachments/206930037/ → DARTS Illinois (40+ images!)
/samples/attachments/88998299/  → Visit tools
```

### Method 3: Ask About Features
Most feature-specific queries will return images if screenshots exist:
- "How do I [feature]?"
- "[Feature] configuration"
- "[Feature] settings"
- "Using [feature]"

---

## 🎉 No More Blurry Bullets!

The parser now automatically skips:
- Bullet point icons (8x8 pixels)
- Spacer images
- Decorative icons
- Images smaller than 20x20 pixels

So you only see **real, useful screenshots**! 📸

---

## 🚀 Ready to Test!

**Refresh your browser and try:**

1. `"Plan Settings facility form"`
2. `"how do I use lists"`  
3. `"patient benefits eligibility"`

All should show screenshots (when available for that content)!


