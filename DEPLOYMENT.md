# Chronicle — Free Cloud Deployment Guide (Render + Neon PostgreSQL)

This guide walks you through deploying Chronicle **completely free** using:
1. **[Render Free Web Service](https://render.com)** (Node.js hosting)
2. **[Neon Serverless PostgreSQL](https://neon.tech)** (Persistent cloud database with free tier)

---

## Why Render Free + Neon PostgreSQL?

- **Zero Cost**: Both Render and Neon offer generous free tiers.
- **Persistent Data**: Unlike local disks on Render Free (which are wiped on sleep or redeploy), Neon PostgreSQL stores all your sites and cues permanently.
- **Sleep & Wake Resilient**: When Render Free sleeps after 15 minutes of inactivity and wakes upon visitor traffic, Chronicle connects to Neon and evaluates all scheduled boundaries using server-side UTC time. Expired cues are excluded, and active cues are served immediately.
- **Zero Local Setup Needed**: For local development, Chronicle automatically falls back to lightweight native SQLite (`node:sqlite`).

---

## Architecture Overview

```
                      +---------------------------------------+
                      |         Render Web Service            |
                      |            (Free Tier)                |
                      |                                       |
                      |   PORT: 10000 (auto-assigned)         |
                      |   NODE_ENV: production                |
                      |   ADMIN_API_KEY: <secure-secret>      |
                      |   CHRONICLE_PUBLIC_URL: https://...   |
                      +---------------------------------------+
                                  |                 ^
                     Queries via  |                 | Serves Cues
                     DATABASE_URL |                 | (Origin Checked)
                                  v                 |
                    +--------------------+    +-----+-----------------+
                    | Neon PostgreSQL DB |    | External Website      |
                    |   (Serverless)     |    | (Embed: chronicle.js) |
                    |                    |    +-----------------------+
                    |  - sites table     |    | Admin Dashboard       |
                    |  - cues table      |    | (/dashboard)          |
                    +--------------------+    +-----------------------+
```

---

## Step 1: Create a Free Database on Neon

1. Sign up or log in at **[https://neon.tech](https://neon.tech)**.
2. Click **Create Project**:
   - **Name**: `chronicle-db`
   - **Region**: Choose the region closest to your Render service (e.g. `US East (Ohio)` or `US East (N. Virginia)`).
3. Once created, copy the **Connection details** connection string (`Pooled connection` or `Direct connection`):
   ```
   postgresql://user:password@ep-xyz-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

---

## Step 2: Deploy to Render

### Method A: Using Render Blueprint (`render.yaml`) — Recommended
1. Push this repository to **GitHub** or **GitLab**.
2. Go to the [Render Dashboard](https://dashboard.render.com).
3. Click **New +** -> **Blueprint**.
4. Select your Chronicle repository. Render will automatically detect [`render.yaml`](file:///d:/chronicle/render.yaml).
5. When prompted for environment variables:
   - **`DATABASE_URL`**: Paste your Neon connection string from Step 1.
6. Click **Apply**.
7. Once deployed, note your service URL (e.g. `https://chronicle-engine.onrender.com`).
8. Under **Environment**, add or update:
   - **`CHRONICLE_PUBLIC_URL`**: `https://chronicle-engine.onrender.com`

---

### Method B: Manual Setup via Render Dashboard
1. Click **New +** -> **Web Service**.
2. Connect your Git repository.
3. Configure the service:
   - **Name**: `chronicle-engine`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
4. Under **Environment Variables**, add:
   | Key | Value | Notes |
   |---|---|---|
   | `NODE_ENV` | `production` | Enables strict origin validation & security |
   | `DATABASE_URL` | `postgresql://...neon.tech/neondb?sslmode=require` | Your Neon connection string |
   | `ADMIN_API_KEY` | *(Enter a secure secret password)* | Required to log into `/dashboard` |
   | `CHRONICLE_PUBLIC_URL` | `https://<service-name>.onrender.com` | Used for embed script generation |
5. Click **Deploy Web Service**.

---

## Step 3: Verify Deployment

### 1. Check Healthcheck & Active Database Type
Run:
```bash
curl -s https://<your-service>.onrender.com/health
```
Expected response:
```json
{
  "status": "ok",
  "service": "Chronicle Engine",
  "database": {
    "type": "postgres",
    "storageDir": "remote-neon-postgres",
    "dbFile": "postgresql"
  },
  "authConfigured": true,
  "serverTime": "2026-10-23T10:15:00.000Z"
}
```

### 2. Access the Admin Dashboard
Open in your browser:
```
https://<your-service>.onrender.com/dashboard
```
- Click **🔑 Admin Login** in the upper right.
- Enter the `ADMIN_API_KEY` you configured.
- The dashboard validates your key with the server and receives an ephemeral session token stored only in `sessionStorage`.

### 3. Integrating with External Websites
In the dashboard, register your website and copy the generated snippet:
```html
<script 
  src="https://<your-service>.onrender.com/chronicle.js" 
  data-site-key="your-site-key">
</script>
```

---

## Local Development (No Cloud Setup Required)
When developing locally without `DATABASE_URL`, Chronicle automatically uses native local SQLite (`node:sqlite`). Zero PostgreSQL setup or external credentials are required for local work:
```bash
npm start   # Runs locally using SQLite (port 3000)
npm run demo # Runs demo site (port 3001)
npm test    # Runs the full test suite
```
