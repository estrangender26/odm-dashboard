# ODM Dashboard — Netlify Deployment Guide

## Overview

This is a **fullstack application** with two parts:

| Part | Technology | Where It Runs |
|------|-----------|---------------|
| **Frontend** | React + Tailwind + shadcn/ui | Netlify (static hosting) |
| **Backend** | tRPC + Hono + MySQL | Node.js server (Render/Railway/VPS) |

**Why two parts?** Netlify serves static websites brilliantly, but it cannot run a persistent Node.js API server or host a MySQL database. The backend needs a dedicated server.

---

## Step 1: Deploy the Frontend to Netlify

### Quick Deploy (Drag & Drop)

1. Go to https://app.netlify.com/drop
2. Drag the `dist/public/` folder onto the page
3. Your frontend is live instantly

### Via Git (Recommended for updates)

1. Create a new GitHub repo
2. Upload the contents of `dist/public/`
3. Connect the repo at https://app.netlify.com
4. Build settings:
   - **Build command:** `echo "Built"`
   - **Publish directory:** `/`

---

## Step 2: Set Up the Backend API

The backend needs a Node.js server. **Netlify cannot run this.**

### Recommended: Render.com (Free Tier)

1. Go to https://render.com → Sign up
2. **New Web Service** → Connect your GitHub repo
3. Settings:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Runtime:** Node
4. Add **Environment Variables** (see below)
5. Deploy → You get a URL like `https://your-app.onrender.com`

### Alternative: Railway.app

1. Go to https://railway.app
2. New project → Deploy from GitHub repo
3. Add a MySQL database in Railway dashboard
4. Deploy

---

## Step 3: Connect Frontend ↔ Backend

You **must** tell the Netlify frontend where your backend lives.

### Option A: Netlify Proxy (Easiest)

Edit `netlify.toml` in the `dist/public/` folder:

```toml
[[redirects]]
  from = "/api/*"
  to = "https://your-app.onrender.com/api/:splat"
  status = 200
  force = true

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

Replace `https://your-app.onrender.com` with your actual backend URL.

### Option B: Environment Variable

Set `VITE_API_URL` when building:

```bash
VITE_API_URL=https://your-app.onrender.com/api/trpc npm run build
```

Then deploy the newly built `dist/public/` to Netlify.

---

## Required Environment Variables

Add these to your backend host (Render/Railway):

```
DATABASE_URL=mysql://user:pass@host:port/database
API_SECRET=a-random-secret-key
VITE_APP_ID=your-kimi-app-id
VITE_KIMI_AUTH_URL=https://your-auth-url
VITE_OAUTH_REDIRECT_URI=https://your-backend/api/oauth/callback
```

The `DATABASE_URL` and `API_SECRET` are already set in the `.env` file.

---

## How Multi-User Sync Works

```
User A (browser)
    ↓ clicks Edit, changes dropdown, clicks Save
Netlify frontend
    ↓ POST /api/trpc/tasks.update
Render backend (Node.js)
    ↓ UPDATE tasks SET operations='Operator' WHERE id=...
MySQL Database (shared)
    ✓ Saved

User B (browser)
    ↓ opens dashboard
Netlify frontend
    ↓ GET /api/trpc/tasks.list
Render backend
    ↓ SELECT * FROM tasks...
MySQL Database
    → Returns updated value including User A's change
User B sees "Operator" ✓
```

---

## Data Already in the Database

All 1,377 tasks are pre-loaded:
- **HTT STP:** 976 tasks across 114 equipment groups
- **Aglipay STP:** 401 tasks across 14 equipment groups

No need to upload Excel files — the data is already in MySQL.

---

## Features Available

- ✅ **Edit/Save/Cancel** — writes to shared MySQL database
- ✅ **Export All / Export Selected** — CSV download
- ✅ **Import** — CSV upload to update database in batch
- ✅ **Group by Equipment Type** — collapsible/expandable
- ✅ **Search & Filter** — real-time across all users
- ✅ **OAuth Login** — Kimi authentication
- ✅ **Multi-user sync** — all changes visible to everyone

---

## Troubleshooting

**"API not found" or 404 errors**
→ Your `netlify.toml` proxy URL is wrong. Update it with your actual backend URL.

**"Cannot connect to database"**
→ `DATABASE_URL` is missing or wrong in your backend environment variables.

**Frontend updates but backend doesn't**
→ The backend isn't running. Check Render/Railway logs.

---

## File Structure for Deployment

```
dist/public/          ← Upload this folder to Netlify
├── index.html        ← Entry point
├── assets/           ← JS + CSS bundles
│   ├── index-*.js
│   └── index-*.css
├── _redirects        ← SPA routing rules
└── netlify.toml      ← Proxy config (edit before deploy)

dist/boot.js          ← Backend server (deploy to Render/Railway)
```
