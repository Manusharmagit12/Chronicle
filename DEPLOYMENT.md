# Chronicle — Production Cloud Deployment Guide (Render)

This guide walks you through deploying Chronicle to **Render** using a **Persistent Disk** mounted at `/var/data`. This configuration guarantees that your SQLite database survives container restarts, healthcheck failures, sleep cycles, and code redeployments.

---

## Architecture Overview

```
                      +---------------------------------------+
                      |       Render Web Service              |
                      |   (Node.js v24+ Express Engine)       |
                      |                                       |
                      |   PORT: 10000 (auto-assigned)         |
                      |   NODE_ENV: production                |
                      |   ADMIN_API_KEY: <secure-secret>      |
                      |   CHRONICLE_PUBLIC_URL: https://...   |
                      |                                       |
                      |       Mounted Persistent Disk         |
                      |          /var/data                    |
                      |       (chronicle.db)                  |
                      +---------------------------------------+
                                   ^              ^
                                   |              |
                    Cues Delivery  |              | Dashboard Session
                    (Origin Check) |              | (Token-based)
                                   |              |
                      +------------+--+       +---+-------------------+
                      | External Site |       | Management Dashboard  |
                      | (Embed Script)|       | (/dashboard)          |
                      +---------------+       +-----------------------+
```

---

## Method 1: Deploy Using Render Blueprint (`render.yaml`) — Recommended

1. Push this repository to **GitHub** or **GitLab**.
2. Go to the [Render Dashboard](https://dashboard.render.com).
3. Click **New +** and select **Blueprint**.
4. Connect your Chronicle repository. Render will automatically detect [`render.yaml`](file:///d:/chronicle/render.yaml).
5. Render will automatically configure:
   - **Service**: Node Web Service
   - **Persistent Disk**: 1 GB mounted at `/var/data`
   - **Environment Variables**:
     - `NODE_ENV`: `production`
     - `CHRONICLE_DATA_DIR`: `/var/data`
     - `ADMIN_API_KEY`: Auto-generated secure secret
6. Click **Apply**.
7. Once deployed, copy your assigned Render URL (e.g. `https://chronicle-engine.onrender.com`).
8. In the Render Dashboard under **Environment**, set:
   - `CHRONICLE_PUBLIC_URL`: `https://chronicle-engine.onrender.com` (your actual service URL).

---

## Method 2: Manual Setup via Render Dashboard

If you prefer to configure the service manually via the Render UI:

1. Click **New +** -> **Web Service**.
2. Connect your Git repository.
3. Configure the service settings:
   - **Name**: `chronicle-engine`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Starter** ($7/mo) — *Note: Persistent Disks require a Starter plan or above on Render.*
4. Scroll down to **Disks** -> click **Add Disk**:
   - **Name**: `chronicle-data`
   - **Mount Path**: `/var/data`
   - **Size**: `1 GB`
5. Under **Environment Variables**, add:
   | Key | Value | Notes |
   |---|---|---|
   | `NODE_ENV` | `production` | Enables strict origin validation & security |
   | `CHRONICLE_DATA_DIR` | `/var/data` | Directs SQLite to the persistent disk |
   | `ADMIN_API_KEY` | *(Generate a strong 32-char secret)* | Protects admin mutations & dashboard login |
   | `CHRONICLE_PUBLIC_URL` | `https://<your-service>.onrender.com` | Used for embed script generation |
6. Click **Create Web Service**.

---

## Verification After Deployment

### 1. Verify Health & Persistence
Check the healthcheck endpoint:
```bash
curl -s https://<your-service>.onrender.com/health | jq
```
Expected output:
```json
{
  "status": "ok",
  "service": "Chronicle Engine",
  "database": {
    "storageDir": "/var/data",
    "dbFile": "chronicle.db"
  },
  "authConfigured": true
}
```

### 2. Access the Admin Dashboard
Open:
```
https://<your-service>.onrender.com/dashboard
```
- Click **🔑 Admin Login** in the upper right.
- Enter your configured `ADMIN_API_KEY`.
- The dashboard will securely obtain an ephemeral session token stored only in `sessionStorage`. The actual secret is never stored or exposed in client bundles.

### 3. Integrating with External Websites
Copy the embed snippet generated in the dashboard:
```html
<script 
  src="https://<your-service>.onrender.com/chronicle.js" 
  data-site-key="your-site-key">
</script>
```
Ensure your site's domain in Chronicle matches the external website's origin (e.g. `https://mycollege.edu`) to satisfy the production origin check.
