import { Router } from 'express';
import {
  getSite,
  upsertSite,
  listSites,
  createCue,
  getCue,
  updateCue,
  toggleCueActive,
  deleteCue,
  deleteSite,
  listCuesForSite,
  getCuesForDelivery
} from '../db.js';
import {
  isAuthRequired,
  verifyAdminKey,
  createSession,
  isValidSession,
  destroySession,
  requireAdminAuth
} from '../auth.js';

export const apiRouter = Router();

/**
 * Validates request origin against registered site domain for production delivery
 */
function validateSiteOrigin(req, site) {
  if (!site || !site.domain) return { allowed: true };

  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;

  // Handle missing Origin/Referer headers safely (e.g. server-side proxy, mobile, or curl)
  if (!originHeader && !refererHeader) {
    return { allowed: true };
  }

  const callerUrl = originHeader || refererHeader;
  let callerOrigin = '';
  try {
    callerOrigin = new URL(callerUrl).origin.toLowerCase();
  } catch (e) {
    return { allowed: true };
  }

  // In non-production, allow localhost and loopback interfaces for testing
  if (process.env.NODE_ENV !== 'production') {
    try {
      const host = new URL(callerOrigin).hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        return { allowed: true };
      }
    } catch (e) {}
  }

  // Normalize site domain
  let siteOrigin = '';
  try {
    const formatted = site.domain.startsWith('http://') || site.domain.startsWith('https://')
      ? site.domain
      : `https://${site.domain}`;
    siteOrigin = new URL(formatted).origin.toLowerCase();
  } catch (e) {
    return { allowed: true };
  }

  if (callerOrigin === siteOrigin) {
    return { allowed: true };
  }

  // Also match identical hostnames (e.g. matching port or subdomain)
  try {
    const callerHost = new URL(callerOrigin).hostname;
    const siteHost = new URL(siteOrigin).hostname;
    if (callerHost === siteHost) {
      return { allowed: true };
    }
  } catch (e) {}

  return {
    allowed: false,
    reason: `Origin '${callerOrigin}' is not authorized to deliver cues for site '${site.id}' (configured domain: '${siteOrigin}').`
  };
}

/* =======================================================================
   AUTHENTICATION ENDPOINTS
======================================================================= */

/**
 * Check authentication status and requirement
 */
apiRouter.get('/auth/status', (req, res) => {
  const token =
    req.headers['x-chronicle-admin-token'] ||
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);
  const directKey = req.headers['x-chronicle-admin-key'];

  const authRequired = isAuthRequired();
  let authenticated = !authRequired;

  if (authRequired) {
    authenticated = Boolean(
      (token && isValidSession(token)) || (directKey && verifyAdminKey(directKey))
    );
  }

  res.json({
    authRequired,
    authenticated
  });
});

/**
 * Exchange admin key for a secure session token
 */
apiRouter.post('/auth/login', (req, res) => {
  const { key } = req.body;

  if (!isAuthRequired()) {
    return res.json({
      success: true,
      authRequired: false,
      message: 'Authentication is not configured (open development mode).'
    });
  }

  if (!verifyAdminKey(key)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid admin credentials provided.'
    });
  }

  const session = createSession();
  res.json({
    success: true,
    authRequired: true,
    token: session.token,
    expiresIn: session.expiresIn
  });
});

/**
 * Logout: invalidate the session token
 */
apiRouter.post('/auth/logout', (req, res) => {
  const token =
    req.headers['x-chronicle-admin-token'] ||
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);

  if (token) {
    destroySession(token);
  }

  res.json({ success: true, message: 'Logged out successfully.' });
});

/* =======================================================================
   PUBLIC DELIVERY API
======================================================================= */

/**
 * Public Delivery API: Called by chronicle.js on client websites.
 * Returns time-validated active cues and upcoming cues for the current time.
 */
apiRouter.get('/cues', (req, res) => {
  const { siteKey } = req.query;

  if (!siteKey) {
    return res.status(400).json({ error: 'Missing required query parameter: siteKey' });
  }

  const site = getSite(siteKey);
  if (!site) {
    return res.status(404).json({ error: `Site '${siteKey}' not found` });
  }

  // Origin validation against registered domain
  const originValidation = validateSiteOrigin(req, site);
  if (!originValidation.allowed) {
    return res.status(403).json({
      error: 'Forbidden',
      message: originValidation.reason
    });
  }

  const serverTime = new Date().toISOString();
  // Fetch active cues and cues starting within the next 24 hours
  const cues = getCuesForDelivery(siteKey);

  res.json({
    site: {
      id: site.id,
      name: site.name
    },
    serverTime,
    cues
  });
});

/* =======================================================================
   PROTECTED ADMIN ENDPOINTS (Require ADMIN_API_KEY if configured)
======================================================================= */

/**
 * Admin: List all cues for a site (including expired, active, upcoming, paused)
 */
apiRouter.get('/cues/all', requireAdminAuth, (req, res) => {
  const { siteKey } = req.query;
  if (!siteKey) {
    return res.status(400).json({ error: 'Missing siteKey' });
  }
  const site = getSite(siteKey);
  if (!site) {
    return res.status(404).json({ error: 'Site not found' });
  }

  const nowIso = new Date().toISOString();
  const cues = listCuesForSite(siteKey).map(cue => {
    let status = 'expired';
    if (cue.is_active === 0) {
      status = 'paused';
    } else if (cue.start_at <= nowIso && cue.end_at > nowIso) {
      status = 'active';
    } else if (cue.start_at > nowIso) {
      status = 'upcoming';
    }
    return { ...cue, status };
  });

  res.json({
    site,
    serverTime: nowIso,
    cues
  });
});

/**
 * Admin: Get single cue by ID
 */
apiRouter.get('/cues/single/:id', requireAdminAuth, (req, res) => {
  const cue = getCue(req.params.id);
  if (!cue) {
    return res.status(404).json({ error: 'Cue not found' });
  }
  res.json({ cue });
});

/**
 * Admin: Create or schedule a cue
 */
apiRouter.post('/cues', requireAdminAuth, (req, res) => {
  try {
    const {
      id,
      site_id,
      title,
      placement_type,
      target_selector,
      action = 'prepend',
      content_html,
      css_styles,
      start_at,
      end_at,
      is_active = 1
    } = req.body;

    if (!site_id || !title || !placement_type || !content_html || !start_at || !end_at) {
      return res.status(400).json({
        error: 'Missing required fields: site_id, title, placement_type, content_html, start_at, end_at'
      });
    }

    if (new Date(start_at) >= new Date(end_at)) {
      return res.status(400).json({ error: 'start_at must be before end_at' });
    }

    const site = getSite(site_id);
    if (!site) {
      return res.status(404).json({ error: `Site '${site_id}' does not exist` });
    }

    const cue = createCue({
      id,
      site_id,
      title,
      placement_type,
      target_selector,
      action,
      content_html,
      css_styles,
      start_at,
      end_at,
      is_active
    });

    res.status(201).json({ success: true, cue });
  } catch (err) {
    console.error('Error creating cue:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Admin: Update an existing cue
 */
apiRouter.put('/cues/:id', requireAdminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const existing = getCue(id);
    if (!existing) {
      return res.status(404).json({ error: 'Cue not found' });
    }

    const {
      title,
      placement_type,
      target_selector,
      action,
      content_html,
      css_styles,
      start_at,
      end_at,
      is_active
    } = req.body;

    if (start_at && end_at && new Date(start_at) >= new Date(end_at)) {
      return res.status(400).json({ error: 'start_at must be before end_at' });
    }

    const updated = updateCue(id, {
      title,
      placement_type,
      target_selector,
      action,
      content_html,
      css_styles,
      start_at,
      end_at,
      is_active
    });

    res.json({ success: true, cue: updated });
  } catch (err) {
    console.error('Error updating cue:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Admin: Toggle active state (cancellation/pause/resume)
 */
apiRouter.patch('/cues/:id/toggle', requireAdminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const existing = getCue(id);
    if (!existing) {
      return res.status(404).json({ error: 'Cue not found' });
    }

    const forcedState = req.body.is_active !== undefined ? req.body.is_active : null;
    const updated = toggleCueActive(id, forcedState);
    res.json({ success: true, cue: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Admin: Delete a cue
 */
apiRouter.delete('/cues/:id', requireAdminAuth, (req, res) => {
  deleteCue(req.params.id);
  res.json({ success: true, message: `Cue ${req.params.id} deleted` });
});

/**
 * Admin: Register or update a site
 */
apiRouter.post('/sites', requireAdminAuth, (req, res) => {
  const { id, name, domain } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: 'Missing required fields: id, name' });
  }
  const site = upsertSite({ id, name, domain });
  res.json({ success: true, site });
});

/**
 * Admin: List sites
 */
apiRouter.get('/sites', requireAdminAuth, (req, res) => {
  res.json({ sites: listSites() });
});

/**
 * Admin: Delete site
 */
apiRouter.delete('/sites/:id', requireAdminAuth, (req, res) => {
  deleteSite(req.params.id);
  res.json({ success: true, message: `Site ${req.params.id} deleted` });
});
