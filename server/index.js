import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, dbPath, dataDir } from './db.js';
import { apiRouter } from './routes/api.js';
import { isAuthRequired } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize database schema
initDb();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all external origins (crucial for client embed scripts on target websites)
app.use(cors());
app.use(express.json());

// Serve static assets (the chronicle.js embed library and dashboard)
app.use(express.static(path.resolve(__dirname, '..', 'public')));

// Mount API routes
app.use('/api/v1', apiRouter);

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'public', 'dashboard', 'index.html'));
});

app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// System config endpoint (safe public metadata, zero secrets)
app.get('/api/v1/config', (req, res) => {
  res.json({
    publicUrl: process.env.CHRONICLE_PUBLIC_URL || null,
    authRequired: isAuthRequired(),
    serverTime: new Date().toISOString()
  });
});

// Healthcheck
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Chronicle Engine',
    database: {
      storageDir: dataDir,
      dbFile: path.basename(dbPath)
    },
    authConfigured: isAuthRequired(),
    serverTime: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`[Chronicle Engine] Server running on port ${PORT}`);
  console.log(`[Chronicle Engine] Database storage: ${dbPath}`);
  console.log(`[Chronicle Engine] Admin Auth: ${isAuthRequired() ? 'ENABLED (ADMIN_API_KEY set)' : 'OPEN / DEV MODE'}`);
  if (process.env.CHRONICLE_PUBLIC_URL) {
    console.log(`[Chronicle Engine] Public URL configured: ${process.env.CHRONICLE_PUBLIC_URL}`);
  }
});
