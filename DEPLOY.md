# ODM Dashboard — Deployment Guide (Render.com)

## Overview

Your ODM Dashboard is a **fullstack application** that can be deployed to a **single** hosting service. The backend server serves both the API and the frontend from the same URL.

| Component | Technology | Deployment |
|-----------|-----------|------------|
| Frontend | React 19 + Tailwind + shadcn/ui | Served by backend |
| Backend API | tRPC + Hono + Node.js | Render.com |
| Database | MySQL (TiDB Serverless) | Already hosted on Aliyun |

The database is already in the cloud and accessible from anywhere. You only need to host the Node.js server.

---

## Option 1: Render.com (Recommended — Free)

### Step 1: Push to GitHub

1. Create a new repository on GitHub
2. Push your project:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/odm-dashboard.git
   git push -u origin main
   ```

### Step 2: Deploy on Render

1. Go to https://render.com and sign up (free)
2. Click **New +** → **Web Service**
3. Connect your GitHub repository
4. Fill in the settings:
   | Setting | Value |
   |---------|-------|
   | Name | `odm-dashboard` |
   | Runtime | Node |
   | Build Command | `npm install && npm run build` |
   | Start Command | `npm start` |
   | Plan | Free |

5. Add **Environment Variables** (copy from your `.env` file):
   - `DATABASE_URL` — your MySQL connection string
   - `APP_ID` — from `.env`
   - `APP_SECRET` — from `.env`
   - `VITE_APP_ID` — same as APP_ID
   - `VITE_KIMI_AUTH_URL` — `https://auth.kimi.com`
   - `KIMI_AUTH_URL` — `https://auth.kimi.com`
   - `KIMI_OPEN_URL` — `https://open.kimi.com`
   - `OWNER_UNION_ID` — from `.env`

6. Click **Deploy Web Service**

Render will build and deploy your app. You'll get a URL like:
```
https://odm-dashboard.onrender.com
```

### Step 3: Update OAuth Callback (One Time)

1. Go to https://open.kimi.com → Your App Settings
2. Add the callback URL:
   ```
   https://odm-dashboard.onrender.com/api/oauth/callback
   ```
3. Save

That's it! Your dashboard is live with both frontend and backend running together.

---

## Option 2: Render Blueprint (Even Easier)

A `render.yaml` file is already included in your project. This automates the setup:

1. Push your code to GitHub (including `render.yaml`)
2. Go to https://render.com/blueprints
3. Click **New Blueprint Instance**
4. Connect your repo
5. Fill in the secret values when prompted (DATABASE_URL, APP_ID, APP_SECRET, etc.)
6. Deploy

---

## How It Works

```
User Browser
    ↓ opens https://your-app.onrender.com
Render Server (Node.js)
    ├── GET / → serves index.html (React app)
    ├── GET /assets/* → serves JS/CSS files
    ├── GET /api/trpc/* → tRPC API endpoints
    └── POST /api/trpc/* → database operations
         ↓
    MySQL Database (Aliyun TiDB)
         ↓
    All users see the same data ✓
```

---

## Data Already in the Database

Your database already contains all the data:
- **1,377 equipment tasks** across HTT STP and Aglipay STP
- **4 governance facilities** with milestones
- No need to upload Excel files or seed data

---

## Features Available After Deploy

| Feature | How It Works |
|---------|-------------|
| Edit/Save/Cancel | Saves to shared MySQL database |
| Multi-user sync | All users see the same live data |
| Export All / Export Selected | CSV download from database |
| Import CSV | Bulk update database from CSV file |
| Group by Equipment Type | Collapsible/expandable groups |
| Search & Filter | Real-time across all users |
| OAuth Login | Kimi authentication |

---

## Troubleshooting

**"Page not loading"**
→ Check Render logs for build errors. Make sure all environment variables are set.

**"Cannot connect to database"**
→ `DATABASE_URL` is wrong or the database is not accessible from Render's IP. Check the connection string in `.env`.

**"API calls failing with 404"**
→ The backend isn't running. Check that `npm start` works in the Render dashboard.

**"OAuth login not working"**
→ The callback URL in Kimi Open platform doesn't match your Render URL. Update it at https://open.kimi.com

---

## Free Tier Limits (Render)

- **Web Service:** Free forever, spins down after 15 min idle (wakes up on next request ~30s)
- **Database:** You're using Aliyun TiDB (already free tier), no additional cost
- **Custom domain:** Supported on free tier

---

## Your Version Snapshot

Your project is also saved as version `19a77d3` in the Kimi portal for rollback if needed.
