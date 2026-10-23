import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.DEMO_PORT || 3001;

// Expose dynamic configuration script for the demo client (cloud URL or localhost)
app.get('/config.js', (req, res) => {
  const chronicleUrl = (
    process.env.CHRONICLE_API_URL ||
    process.env.CHRONICLE_PUBLIC_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
  const siteKey = process.env.CHRONICLE_SITE_KEY || 'apex-university';

  res.type('application/javascript').send(`
    window.CHRONICLE_CONFIG = {
      apiUrl: ${JSON.stringify(chronicleUrl)},
      siteKey: ${JSON.stringify(siteKey)}
    };
  `);
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`[Demo Website] Apex Institute of Technology running on http://localhost:${PORT}`);
  console.log(`[Demo Website] Connected to Chronicle Engine via dynamic config.`);
});
