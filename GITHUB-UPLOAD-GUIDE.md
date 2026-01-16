# 🚀 QUICK SETUP - Upload Backend Files to GitHub

Your Railway deployment failed because the backend code files are missing. Here's how to fix it:

---

## 📦 FILES TO UPLOAD (Download these from above):

1. **backend-services-ai-cloudinary.js** ← NEW (with Cloudinary)
2. **backend-routes-video.js** ← NEW
3. **backend-services-creatomate.js** ← NEW
4. **backend-auth-routes.js** ← NEW
5. **package.json** ← UPDATED (with Cloudinary)

---

## 🎯 WHERE TO PUT THEM IN GITHUB:

Go to: https://github.com/Cresent-lab/shortsfusion-backend

### **Structure you need:**

```
shortsfusion-backend/
├── server.js              (you already have this)
├── package.json           ← REPLACE with new one
├── .env.example           (you already have this)
├── db.js                  ← CREATE NEW (see below)
├── routes/
│   ├── auth.js           ← UPLOAD backend-auth-routes.js (rename to auth.js)
│   └── video.js          ← UPLOAD backend-routes-video.js (rename to video.js)
└── services/
    ├── ai.js             ← UPLOAD backend-services-ai-cloudinary.js (rename to ai.js)
    └── creatomate.js     ← UPLOAD backend-services-creatomate.js (rename to creatomate.js)
```

---

## 📝 STEP-BY-STEP:

### **1. Create Missing Folders (if needed):**

Go to your repo → Click "Add file" → "Create new file"

Create these folders by typing:
- `routes/.gitkeep` (then commit)
- `services/.gitkeep` (then commit)

### **2. Upload Files:**

**In `routes/` folder:**
- Upload `backend-auth-routes.js` → Rename to `auth.js`
- Upload `backend-routes-video.js` → Rename to `video.js`

**In `services/` folder:**
- Upload `backend-services-ai-cloudinary.js` → Rename to `ai.js`
- Upload `backend-services-creatomate.js` → Rename to `creatomate.js`

**In root folder:**
- Replace `package.json` with the new one

### **3. Create `db.js` file:**

Create new file in root: `db.js`

```javascript
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = {
  query: (text, params) => pool.query(text, params)
};
```

### **4. Update `server.js`:**

Make sure it has these routes:

```javascript
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const videoRoutes = require('./routes/video');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/video', videoRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
```

---

## ⚡ AFTER UPLOADING:

1. Railway will **automatically redeploy**
2. Watch the deployment logs
3. Should see: ✅ "Deployment successful"
4. Backend will be online!

---

## 🐛 IF IT FAILS AGAIN:

Check Railway logs for:
- Missing dependencies
- Syntax errors
- Database connection issues

---

**Upload these files to GitHub now and Railway will auto-deploy!** 🚀
