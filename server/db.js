import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// SQLite storage configuration (fallback / local development)
export const dataDir = process.env.CHRONICLE_DATA_DIR
  ? path.resolve(process.env.CHRONICLE_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');

export const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(dataDir, 'chronicle.db');

// Database instances
let sqliteInstance = null;
let pgPoolInstance = null;
let DatabaseSyncClass = null;

/**
 * Returns true if the environment is configured to use PostgreSQL (Neon)
 */
export function isPostgresDatabase() {
  const url = process.env.DATABASE_URL;
  return Boolean(
    url &&
    (url.startsWith('postgres://') || url.startsWith('postgresql://'))
  );
}

/**
 * Returns active database type ('postgres' or 'sqlite')
 */
export function getDatabaseType() {
  return isPostgresDatabase() ? 'postgres' : 'sqlite';
}

/**
 * Get or initialize SQLite instance asynchronously (dynamic import protects Node versions on cloud)
 */
async function getSqliteDb() {
  if (!sqliteInstance) {
    if (!DatabaseSyncClass) {
      const sqliteModule = await import('node:sqlite');
      DatabaseSyncClass = sqliteModule.DatabaseSync;
    }
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    sqliteInstance = new DatabaseSyncClass(dbPath);
  }
  return sqliteInstance;
}

/**
 * Get or initialize PostgreSQL pool (supports Neon SSL)
 */
function getPgPool() {
  if (!pgPoolInstance) {
    const connectionString = process.env.DATABASE_URL;
    const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

    pgPoolInstance = new Pool({
      connectionString,
      ssl: isLocalhost ? false : { rejectUnauthorized: false }
    });
  }
  return pgPoolInstance;
}

/**
 * Allow test suites to inject an in-memory PostgreSQL pool (e.g. pg-mem)
 */
export function setTestPgPool(customPool) {
  pgPoolInstance = customPool;
}

/**
 * Close database connections (for test teardowns and process shutdown)
 */
export async function closeDb() {
  if (pgPoolInstance) {
    await pgPoolInstance.end().catch(() => {});
    pgPoolInstance = null;
  }
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
  }
}

/**
 * Reset instances (used by tests switching between adapters)
 */
export function resetDatabaseInstances() {
  sqliteInstance = null;
  pgPoolInstance = null;
}

const COMMON_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cues (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    placement_type TEXT NOT NULL,
    target_selector TEXT,
    action TEXT DEFAULT 'prepend',
    content_html TEXT NOT NULL,
    css_styles TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cues_site ON cues(site_id);
  CREATE INDEX IF NOT EXISTS idx_cues_timing ON cues(site_id, is_active, start_at, end_at);
`;

/**
 * Initialize schema for active database and seed default site if empty
 */
export async function initDb() {
  if (isPostgresDatabase()) {
    const pool = getPgPool();
    await pool.query(COMMON_SCHEMA);
  } else {
    const db = await getSqliteDb();
    db.exec(COMMON_SCHEMA);
  }

  // Ensure default demo site exists if no sites are registered yet
  try {
    const sites = await listSites();
    if (sites.length === 0) {
      const now = Date.now();
      await upsertSite({
        id: 'apex-university',
        name: 'Apex Institute of Technology',
        domain: '' // allows delivery to any origin by default
      });

      await createCue({
        id: 'cue-banner-active',
        site_id: 'apex-university',
        title: 'Fall Semester Admissions Open',
        placement_type: 'top_banner',
        content_html: `
          <div style="display:flex; align-items:center; gap:12px; font-weight:500;">
            <span style="background:rgba(59,130,246,0.25); border:1px solid #3b82f6; color:#93c5fd; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">Live Now</span>
            <span>🎓 <strong>Apex Admissions Open:</strong> Applications for Spring & Fall cohorts are now live. Priority deadline ends in 2 weeks!</span>
            <a href="#admissions" style="color:#60a5fa; text-decoration:underline; font-weight:600; margin-left:8px;">View Programs &rarr;</a>
          </div>
        `,
        css_styles: `
          .chronicle-top-banner {
            background: linear-gradient(90deg, #0f172a 0%, #1e1b4b 100%) !important;
            border-bottom: 1px solid rgba(99, 102, 241, 0.3) !important;
          }
        `,
        start_at: new Date(now - 10 * 60 * 1000).toISOString(),
        end_at: new Date(now + 24 * 60 * 60 * 1000).toISOString()
      });

      await createCue({
        id: 'cue-notice-active',
        site_id: 'apex-university',
        title: 'Campus Career Fair Notice',
        placement_type: 'selector',
        target_selector: '#notice-board',
        action: 'prepend',
        content_html: `
          <div class="notice-card highlight-notice" style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.9)); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 12px; padding: 20px; margin-bottom: 18px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="background:#2563eb; color:#fff; font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px; text-transform:uppercase;">Scheduled Notice</span>
              <span style="font-size:12px; color:#94a3b8;">Active for 24h</span>
            </div>
            <h4 style="margin:0 0 6px 0; color:#f8fafc; font-size:16px;">🚀 Annual Tech Career Fair 2026</h4>
            <p style="margin:0; color:#cbd5e1; font-size:13.5px; line-height:1.5;">Over 45 industry partners will be on campus today in the Main Auditorium. Bring printed resumes and student ID cards.</p>
          </div>
        `,
        start_at: new Date(now - 5 * 60 * 1000).toISOString(),
        end_at: new Date(now + 24 * 60 * 60 * 1000).toISOString()
      });
    }
  } catch (seedErr) {
    console.warn('[Chronicle DB] Notice: Seed check skipped or failed:', seedErr.message);
  }
}

/* =======================================================================
   SITE OPERATIONS
======================================================================= */

export async function getSite(siteId) {
  if (isPostgresDatabase()) {
    const pool = getPgPool();
    const res = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    return res.rows[0] || null;
  } else {
    const db = await getSqliteDb();
    const stmt = db.prepare('SELECT * FROM sites WHERE id = ?');
    return stmt.get(siteId) || null;
  }
}

export async function upsertSite({ id, name, domain }) {
  const now = new Date().toISOString();
  if (isPostgresDatabase()) {
    const pool = getPgPool();
    const res = await pool.query(`
      INSERT INTO sites (id, name, domain, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET name = $2, domain = $3
      RETURNING *
    `, [id, name, domain || '', now]);
    return res.rows[0];
  } else {
    const db = await getSqliteDb();
    const existing = await getSite(id);
    if (existing) {
      const stmt = db.prepare('UPDATE sites SET name = ?, domain = ? WHERE id = ?');
      stmt.run(name, domain || '', id);
    } else {
      const stmt = db.prepare('INSERT INTO sites (id, name, domain, created_at) VALUES (?, ?, ?, ?)');
      stmt.run(id, name, domain || '', now);
    }
    return getSite(id);
  }
}

export async function listSites() {
  if (isPostgresDatabase()) {
    const pool = getPgPool();
    const res = await pool.query('SELECT * FROM sites ORDER BY created_at DESC');
    return res.rows;
  } else {
    const db = await getSqliteDb();
    const stmt = db.prepare('SELECT * FROM sites ORDER BY created_at DESC');
    return stmt.all();
  }
}

export async function deleteSite(siteId) {
  if (isPostgresDatabase()) {
    const pool = getPgPool();
    await pool.query('DELETE FROM sites WHERE id = $1', [siteId]);
    return true;
  } else {
    const db = await getSqliteDb();
    const stmt = db.prepare('DELETE FROM sites WHERE id = ?');
    stmt.run(siteId);
    return true;
  }
}

/* =======================================================================
   CUE OPERATIONS
======================================================================= */

export async function createCue({
  id,
  site_id,
  title,
  placement_type,
  target_selector = '',
  action = 'prepend',
  content_html,
  css_styles = '',
  start_at,
  end_at,
  is_active = 1
}) {
  const cueId = id || 'cue_' + Math.random().toString(36).substring(2, 10);
  const now = new Date().toISOString();

  if (isPostgresDatabase()) {
    const pool = getPgPool();
    const res = await pool.query(`
      INSERT INTO cues (
        id, site_id, title, placement_type, target_selector,
        action, content_html, css_styles, start_at, end_at, is_active, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      cueId,
      site_id,
      title,
      placement_type,
      target_selector,
      action,
      content_html,
      css_styles,
      start_at,
      end_at,
      is_active ? 1 : 0,
      now
    ]);
    return res.rows[0];
  } else {
    const db = await getSqliteDb();
    const stmt = db.prepare(`
      INSERT INTO cues (
        id, site_id, title, placement_type, target_selector,
        action, content_html, css_styles, start_at, end_at, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      cueId,
      site_id,
      title,
      placement_type,
      target_selector,
      action,
      content_html,
      css_styles,
      start_at,
      end_at,
      is_active ? 1 : 0,
      now
    );
    return getCue(cueId);
  }
}

export async function getCue(id) {
  if (isPostgresDatabase()) {
    const pool = getPgPool();
    const res = await pool.query('SELECT * FROM cues WHERE id = $1', [id]);
    return res.rows[0] || null;
  } else {
    const db = await getSqliteDb();
    const stmt = db.prepare('SELECT * FROM cues WHERE id = ?');
    return stmt.get(id) || null;
  }
}

export async function deleteCue(id) {
  if (isPostgresDatabase()) {
    const pool = getPgPool();
    await pool.query('DELETE FROM cues WHERE id = $1', [id]);
    return true;
  } else {
    const db = await getSqliteDb();
    const stmt = db.prepare('DELETE FROM cues WHERE id = ?');
    stmt.run(id);
    return true;
  }
}

export async function updateCue(id, updates) {
  const existing = await getCue(id);
  if (!existing) return null;

  const title = updates.title !== undefined ? updates.title : existing.title;
  const placement_type = updates.placement_type !== undefined ? updates.placement_type : existing.placement_type;
  const target_selector = updates.target_selector !== undefined ? updates.target_selector : existing.target_selector;
  const action = updates.action !== undefined ? updates.action : existing.action;
  const content_html = updates.content_html !== undefined ? updates.content_html : existing.content_html;
  const css_styles = updates.css_styles !== undefined ? updates.css_styles : existing.css_styles;
  const start_at = updates.start_at !== undefined ? updates.start_at : existing.start_at;
  const end_at = updates.end_at !== undefined ? updates.end_at : existing.end_at;
  const is_active = updates.is_active !== undefined ? (updates.is_active ? 1 : 0) : existing.is_active;

  if (isPostgresDatabase()) {
    const pool = getPgPool();
    const res = await pool.query(`
      UPDATE cues SET
        title = $1,
        placement_type = $2,
        target_selector = $3,
        action = $4,
        content_html = $5,
        css_styles = $6,
        start_at = $7,
        end_at = $8,
        is_active = $9
      WHERE id = $10
      RETURNING *
    `, [title, placement_type, target_selector, action, content_html, css_styles, start_at, end_at, is_active, id]);
    return res.rows[0];
  } else {
    const db = await getSqliteDb();
    const stmt = db.prepare(`
      UPDATE cues SET
        title = ?,
        placement_type = ?,
        target_selector = ?,
        action = ?,
        content_html = ?,
        css_styles = ?,
        start_at = ?,
        end_at = ?,
        is_active = ?
      WHERE id = ?
    `);
    stmt.run(title, placement_type, target_selector, action, content_html, css_styles, start_at, end_at, is_active, id);
    return getCue(id);
  }
}

export async function toggleCueActive(id, forcedState = null) {
  const existing = await getCue(id);
  if (!existing) return null;
  const newState = forcedState !== null ? (forcedState ? 1 : 0) : (existing.is_active ? 0 : 1);

  if (isPostgresDatabase()) {
    const pool = getPgPool();
    const res = await pool.query('UPDATE cues SET is_active = $1 WHERE id = $2 RETURNING *', [newState, id]);
    return res.rows[0];
  } else {
    const db = await getSqliteDb();
    const stmt = db.prepare('UPDATE cues SET is_active = ? WHERE id = ?');
    stmt.run(newState, id);
    return getCue(id);
  }
}

export async function listCuesForSite(siteId) {
  if (isPostgresDatabase()) {
    const pool = getPgPool();
    const res = await pool.query('SELECT * FROM cues WHERE site_id = $1 ORDER BY start_at ASC', [siteId]);
    return res.rows;
  } else {
    const db = await getSqliteDb();
    const stmt = db.prepare('SELECT * FROM cues WHERE site_id = ? ORDER BY start_at ASC');
    return stmt.all(siteId);
  }
}

/**
 * Returns currently active cues and upcoming cues (within lookaheadMs)
 * with server-side time validation.
 */
export async function getCuesForDelivery(siteId, lookaheadMs = 24 * 60 * 60 * 1000) {
  const now = new Date();
  const nowIso = now.toISOString();
  const lookaheadIso = new Date(now.getTime() + lookaheadMs).toISOString();

  let cues = [];

  if (isPostgresDatabase()) {
    const pool = getPgPool();
    const res = await pool.query(`
      SELECT * FROM cues
      WHERE site_id = $1
        AND is_active = 1
        AND end_at > $2
        AND start_at <= $3
      ORDER BY start_at ASC
    `, [siteId, nowIso, lookaheadIso]);
    cues = res.rows;
  } else {
    const db = await getSqliteDb();
    const stmt = db.prepare(`
      SELECT * FROM cues
      WHERE site_id = ?
        AND is_active = 1
        AND end_at > ?
        AND start_at <= ?
      ORDER BY start_at ASC
    `);
    cues = stmt.all(siteId, nowIso, lookaheadIso);
  }

  return cues.map(cue => {
    const isCurrentlyActive = cue.start_at <= nowIso && cue.end_at > nowIso;
    const isUpcoming = cue.start_at > nowIso;
    return {
      ...cue,
      status: isCurrentlyActive ? 'active' : isUpcoming ? 'upcoming' : 'expired',
      remainingMsToStart: Math.max(0, new Date(cue.start_at).getTime() - now.getTime()),
      remainingMsToEnd: Math.max(0, new Date(cue.end_at).getTime() - now.getTime())
    };
  });
}
