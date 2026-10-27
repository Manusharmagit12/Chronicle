import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, dbPath, dataDir, getDatabaseType } from './db.js';
import { apiRouter } from './routes/api.js';
import { isAuthRequired } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize database schema asynchronously (supports SQLite & Neon PostgreSQL)
await initDb();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for external client embed scripts on target websites
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. mobile, curl, server-side fetch)
    if (!origin) return callback(null, true);
    // Reflect caller origin so browser cross-origin requests succeed,
    // while route-level validateSiteOrigin strictly enforces registered domain rules
    return callback(null, origin);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Chronicle-Admin-Key', 'X-Chronicle-Admin-Token']
}));
app.use(express.json());

// Serve static assets (the chronicle.js embed library and dashboard)
app.use(express.static(path.resolve(__dirname, '..', 'public')));

// Mount API routes
app.use('/api/v1', apiRouter);

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'public', 'dashboard', 'index.html'));
});

// Dynamic config endpoint for demo site and embed scripts
app.get('/config.js', (req, res) => {
  const chronicleUrl = (
    process.env.CHRONICLE_PUBLIC_URL ||
    process.env.CHRONICLE_API_URL ||
    ''
  ).replace(/\/+$/, '');
  const siteKey = process.env.CHRONICLE_SITE_KEY || 'apex-university';

  res.type('application/javascript').send(`
    window.CHRONICLE_CONFIG = {
      apiUrl: ${JSON.stringify(chronicleUrl)},
      siteKey: ${JSON.stringify(siteKey)}
    };
  `);
});

// Serve live demo website directly on /demo
app.use('/demo', express.static(path.resolve(__dirname, '..', 'demo-site', 'public')));
app.get('/demo', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'demo-site', 'public', 'index.html'));
});

app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// System config endpoint (safe public metadata, zero secrets)
app.get('/api/v1/config', (req, res) => {
  res.json({
    publicUrl: process.env.CHRONICLE_PUBLIC_URL || null,
    databaseType: getDatabaseType(),
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
      type: getDatabaseType(),
      storageDir: getDatabaseType() === 'sqlite' ? dataDir : 'remote-neon-postgres',
      dbFile: getDatabaseType() === 'sqlite' ? path.basename(dbPath) : 'postgresql'
    },
    authConfigured: isAuthRequired(),
    serverTime: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`[Chronicle Engine] Server running on port ${PORT}`);
  console.log(`[Chronicle Engine] Database: ${getDatabaseType().toUpperCase()}`);
  console.log(`[Chronicle Engine] Admin Auth: ${isAuthRequired() ? 'ENABLED (ADMIN_API_KEY set)' : 'OPEN / DEV MODE'}`);
  if (process.env.CHRONICLE_PUBLIC_URL) {
    console.log(`[Chronicle Engine] Public URL configured: ${process.env.CHRONICLE_PUBLIC_URL}`);
  }
});
