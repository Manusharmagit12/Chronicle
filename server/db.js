import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = process.env.CHRONICLE_DATA_DIR
  ? path.resolve(process.env.CHRONICLE_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(dataDir, 'chronicle.db');

export const db = new DatabaseSync(dbPath);

// Initialize schema
export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cues (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      title TEXT NOT NULL,
      placement_type TEXT NOT NULL, -- 'top_banner', 'selector'
      target_selector TEXT,         -- e.g. '#notice-board', 'header'
      action TEXT DEFAULT 'prepend', -- 'prepend', 'append', 'replace'
      content_html TEXT NOT NULL,
      css_styles TEXT,
      start_at TEXT NOT NULL,       -- ISO8601 UTC
      end_at TEXT NOT NULL,         -- ISO8601 UTC
      is_active INTEGER DEFAULT 1,  -- 1 = enabled, 0 = disabled
      created_at TEXT NOT NULL,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cues_site ON cues(site_id);
    CREATE INDEX IF NOT EXISTS idx_cues_timing ON cues(site_id, is_active, start_at, end_at);
  `);
}

// Site helpers
export function getSite(siteId) {
  const stmt = db.prepare('SELECT * FROM sites WHERE id = ?');
  return stmt.get(siteId);
}

export function upsertSite({ id, name, domain }) {
  const existing = getSite(id);
  const now = new Date().toISOString();
  if (existing) {
    const stmt = db.prepare('UPDATE sites SET name = ?, domain = ? WHERE id = ?');
    stmt.run(name, domain || '', id);
    return getSite(id);
  } else {
    const stmt = db.prepare('INSERT INTO sites (id, name, domain, created_at) VALUES (?, ?, ?, ?)');
    stmt.run(id, name, domain || '', now);
    return getSite(id);
  }
}

export function listSites() {
  const stmt = db.prepare('SELECT * FROM sites ORDER BY created_at DESC');
  return stmt.all();
}

// Cue helpers
export function createCue({
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

export function getCue(id) {
  const stmt = db.prepare('SELECT * FROM cues WHERE id = ?');
  return stmt.get(id);
}

export function deleteCue(id) {
  const stmt = db.prepare('DELETE FROM cues WHERE id = ?');
  return stmt.run(id);
}

export function updateCue(id, updates) {
  const existing = getCue(id);
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

export function toggleCueActive(id, forcedState = null) {
  const existing = getCue(id);
  if (!existing) return null;
  const newState = forcedState !== null ? (forcedState ? 1 : 0) : (existing.is_active ? 0 : 1);
  const stmt = db.prepare('UPDATE cues SET is_active = ? WHERE id = ?');
  stmt.run(newState, id);
  return getCue(id);
}

export function deleteSite(siteId) {
  const stmt = db.prepare('DELETE FROM sites WHERE id = ?');
  return stmt.run(siteId);
}

export function listCuesForSite(siteId) {
  const stmt = db.prepare('SELECT * FROM cues WHERE site_id = ? ORDER BY start_at ASC');
  return stmt.all(siteId);
}

/**
 * Returns currently active cues and upcoming cues (within lookaheadMs)
 * with server-side time validation.
 */
export function getCuesForDelivery(siteId, lookaheadMs = 24 * 60 * 60 * 1000) {
  const now = new Date();
  const nowIso = now.toISOString();
  const lookaheadIso = new Date(now.getTime() + lookaheadMs).toISOString();

  // Active cues (start_at <= now < end_at)
  // Upcoming cues (now < start_at <= lookahead)
  const stmt = db.prepare(`
    SELECT * FROM cues
    WHERE site_id = ?
      AND is_active = 1
      AND end_at > ?
      AND start_at <= ?
    ORDER BY start_at ASC
  `);

  const cues = stmt.all(siteId, nowIso, lookaheadIso);

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
