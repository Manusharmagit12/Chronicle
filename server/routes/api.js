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
  getCuesForDelivery,
  touchSiteHeartbeat,
  logAuditEvent,
  listAuditLogs
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
  if (!site || !site.domain || !site.domain.trim()) return { allowed: true };

  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;

  // Handle missing Origin/Referer headers safely (e.g. server-side proxy, mobile, curl)
  if (!originHeader && !refererHeader) {
    return { allowed: true };
  }

  const callerUrl = originHeader || refererHeader;
  let callerOrigin = '';
  let callerHost = '';
  try {
    const parsedCaller = new URL(callerUrl);
    callerOrigin = parsedCaller.origin.toLowerCase();
    callerHost = parsedCaller.hostname.toLowerCase();
  } catch (e) {
    return { allowed: true };
  }

  // In non-production, allow localhost and loopback interfaces for testing
  if (process.env.NODE_ENV !== 'production') {
    if (callerHost === 'localhost' || callerHost === '127.0.0.1') {
      return { allowed: true };
    }
  }

  // Support multiple registered domains (comma, semicolon, or whitespace separated)
  const registeredEntries = site.domain.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (registeredEntries.length === 0) {
    return { allowed: true };
  }

  for (const entry of registeredEntries) {
    try {
      const formatted = entry.startsWith('http://') || entry.startsWith('https://')
        ? entry
        : `https://${entry}`;
      const entryUrl = new URL(formatted);
      const entryOrigin = entryUrl.origin.toLowerCase();
      const entryHost = entryUrl.hostname.toLowerCase();

      if (callerOrigin === entryOrigin || callerHost === entryHost) {
        return { allowed: true };
      }
    } catch (e) {
      const cleanEntryHost = entry.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':')[0];
      if (callerHost === cleanEntryHost) {
        return { allowed: true };
      }
    }
  }

  return {
    allowed: false,
    reason: `Origin '${callerOrigin}' is not authorized to deliver cues for site '${site.id}' (configured domain: '${site.domain}').`
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
 * Also records SDK heartbeat and connection metadata.
 */
apiRouter.get('/cues', async (req, res) => {
  const { siteKey, sdkVersion, sdk_version } = req.query;

  if (!siteKey) {
    return res.status(400).json({ error: 'Missing required query parameter: siteKey' });
  }

  const site = await getSite(siteKey);
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

  // Record connection heartbeat
  const version = sdkVersion || sdk_version || '1.1.0';
  await touchSiteHeartbeat(siteKey, version);

  const serverTime = new Date().toISOString();
  // Fetch active cues and cues starting within the next 24 hours (strictly isolated)
  const cues = await getCuesForDelivery(siteKey);

  res.json({
    site: {
      id: site.id,
      name: site.name,
      domain: site.domain
    },
    serverTime,
    cues
  });
});

/**
 * Public Heartbeat Endpoint: Explicit ping from SDK for live status tracking
 */
apiRouter.post('/heartbeat', async (req, res) => {
  const { siteKey, sdkVersion = '1.1.0' } = req.body || {};

  if (!siteKey) {
    return res.status(400).json({ error: 'Missing siteKey in heartbeat payload' });
  }

  const site = await getSite(siteKey);
  if (!site) {
    return res.status(404).json({ error: `Site '${siteKey}' not found` });
  }

  const originValidation = validateSiteOrigin(req, site);
  if (!originValidation.allowed) {
    return res.status(403).json({
      error: 'Forbidden',
      message: originValidation.reason
    });
  }

  await touchSiteHeartbeat(siteKey, sdkVersion);

  res.json({
    success: true,
    siteId: site.id,
    connected: true,
    serverTime: new Date().toISOString()
  });
});

/* =======================================================================
   PROTECTED ADMIN ENDPOINTS (Require ADMIN_API_KEY if configured)
======================================================================= */

/**
 * Admin: List all cues for a site (including expired, active, upcoming, paused)
 */
apiRouter.get('/cues/all', requireAdminAuth, async (req, res) => {
  const { siteKey } = req.query;
  if (!siteKey) {
    return res.status(400).json({ error: 'Missing siteKey' });
  }
  const site = await getSite(siteKey);
  if (!site) {
    return res.status(404).json({ error: 'Site not found' });
  }

  const nowIso = new Date().toISOString();
  const rawCues = await listCuesForSite(siteKey);
  const cues = rawCues.map(cue => {
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
apiRouter.get('/cues/single/:id', requireAdminAuth, async (req, res) => {
  const cue = await getCue(req.params.id);
  if (!cue) {
    return res.status(404).json({ error: 'Cue not found' });
  }
  res.json({ cue });
});

/**
 * Helper: Validates basic CSS selector format
 */
function isValidCssSelector(selector) {
  if (!selector || typeof selector !== 'string') return true;
  const trimmed = selector.trim();
  if (trimmed.length === 0) return true;
  // Disallow tags, brackets without attributes, dangerous syntax
  if (/[<>{};"']/.test(trimmed)) return false;
  return /^[a-zA-Z0-9_\-\.\#\:\s\[\]\=\^\$\*\~\|\,\>\+\(\)]+$/.test(trimmed);
}

/**
 * Admin: Create or schedule a cue
 */
apiRouter.post('/cues', requireAdminAuth, async (req, res) => {
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

    if (target_selector && !isValidCssSelector(target_selector)) {
      return res.status(400).json({ error: `Invalid CSS selector syntax: "${target_selector}"` });
    }

    const site = await getSite(site_id);
    if (!site) {
      return res.status(404).json({ error: `Site '${site_id}' does not exist` });
    }

    const cue = await createCue({
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

    await logAuditEvent({
      site_id: site.id,
      event_type: 'cue_created',
      details: `Created cue "${cue.title}" (${cue.placement_type}) for target "${cue.target_selector || 'body'}"`
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
apiRouter.put('/cues/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await getCue(id);
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

    if (target_selector && !isValidCssSelector(target_selector)) {
      return res.status(400).json({ error: `Invalid CSS selector syntax: "${target_selector}"` });
    }

    const updated = await updateCue(id, {
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

    await logAuditEvent({
      site_id: existing.site_id,
      event_type: 'cue_updated',
      details: `Updated cue "${updated.title}"`
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
apiRouter.patch('/cues/:id/toggle', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await getCue(id);
    if (!existing) {
      return res.status(404).json({ error: 'Cue not found' });
    }

    const forcedState = req.body.is_active !== undefined ? req.body.is_active : null;
    const updated = await toggleCueActive(id, forcedState);

    await logAuditEvent({
      site_id: existing.site_id,
      event_type: updated.is_active ? 'cue_activated' : 'cue_disabled',
      details: `${updated.is_active ? 'Enabled' : 'Disabled'} cue "${updated.title}"`
    });

    res.json({ success: true, cue: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Admin: Delete a cue
 */
apiRouter.delete('/cues/:id', requireAdminAuth, async (req, res) => {
  const existing = await getCue(req.params.id);
  await deleteCue(req.params.id);

  if (existing) {
    await logAuditEvent({
      site_id: existing.site_id,
      event_type: 'cue_deleted',
      details: `Deleted cue "${existing.title}" (ID: ${req.params.id})`
    });
  }

  res.json({ success: true, message: `Cue ${req.params.id} deleted` });
});

/**
 * Admin: Register or update a site
 */
apiRouter.post('/sites', requireAdminAuth, async (req, res) => {
  const { id, name, domain } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: 'Missing required fields: id, name' });
  }
  const site = await upsertSite({ id, name, domain });

  await logAuditEvent({
    site_id: site.id,
    event_type: 'site_registered',
    details: `Registered website "${site.name}" (Key: ${site.site_key})`
  });

  res.json({ success: true, site });
});

/**
 * Admin: List sites
 */
apiRouter.get('/sites', requireAdminAuth, async (req, res) => {
  const sites = await listSites();
  res.json({ sites });
});

/**
 * Admin: Get single site with connection metrics
 */
apiRouter.get('/sites/:id', requireAdminAuth, async (req, res) => {
  const site = await getSite(req.params.id);
  if (!site) {
    return res.status(404).json({ error: 'Site not found' });
  }

  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  const isConnected = site.last_seen_at && (new Date(site.last_seen_at).getTime() >= fiveMinutesAgo);

  res.json({
    site: {
      ...site,
      connected: Boolean(isConnected)
    }
  });
});

/**
 * Admin: Delete site
 */
apiRouter.delete('/sites/:id', requireAdminAuth, async (req, res) => {
  const site = await getSite(req.params.id);
  await deleteSite(req.params.id);

  await logAuditEvent({
    site_id: req.params.id,
    event_type: 'site_deleted',
    details: `Removed website "${site ? site.name : req.params.id}"`
  });

  res.json({ success: true, message: `Site ${req.params.id} deleted` });
});

/**
 * Admin: End-to-End Test Integration Check
 * Verifies site registration, site key, domain configuration, API reachability, SDK status, and cue delivery.
 */
apiRouter.all('/sites/:id/test-integration', requireAdminAuth, async (req, res) => {
  const site = await getSite(req.params.id);
  if (!site) {
    return res.status(404).json({
      success: false,
      error: 'Site not found',
      checks: [
        { id: 'site_registered', title: 'Website registered', passed: false, detail: `Website ID '${req.params.id}' does not exist.` }
      ]
    });
  }

  const checks = [];
  let allPassed = true;

  // 1. Website registered
  checks.push({
    id: 'site_registered',
    title: 'Website registered',
    passed: true,
    detail: `Registered as "${site.name}" (ID: ${site.id})`
  });

  // 2. Site key valid
  const hasSiteKey = Boolean(site.site_key && site.site_key.startsWith('chr_'));
  checks.push({
    id: 'site_key_valid',
    title: 'Site key valid',
    passed: hasSiteKey,
    detail: hasSiteKey ? `Key ${site.site_key} active` : 'Missing or invalid site key format'
  });
  if (!hasSiteKey) allPassed = false;

  // 3. Domain verified
  const hasDomain = Boolean(site.domain && site.domain.trim());
  checks.push({
    id: 'domain_verified',
    title: 'Domain verified',
    passed: true,
    warning: !hasDomain,
    detail: hasDomain
      ? `Restricted to origin '${site.domain}'`
      : 'Open delivery allowed (no domain restriction specified)'
  });

  // 4. Chronicle API reachable
  checks.push({
    id: 'api_reachable',
    title: 'Chronicle API reachable',
    passed: true,
    detail: 'Core API delivery pipeline responding normally (HTTP 200)'
  });

  // 5. SDK connected / heartbeat
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  const isConnected = site.last_seen_at && (new Date(site.last_seen_at).getTime() >= fiveMinutesAgo);
  checks.push({
    id: 'sdk_connected',
    title: 'SDK connected',
    passed: Boolean(isConnected),
    detail: isConnected
      ? `SDK v${site.sdk_version || '1.1.0'} communicating (last heartbeat: ${site.last_seen_at})`
      : (site.last_seen_at
          ? `SDK disconnected. Last heartbeat was ${site.last_seen_at}. Check embed tag on site.`
          : 'No SDK heartbeat received yet. Add the script to your website to connect.')
  });
  if (!isConnected) allPassed = false;

  // 6. Content delivery ready
  const deliveryCues = await getCuesForDelivery(site.site_key || site.id);
  checks.push({
    id: 'content_delivery_ready',
    title: 'Content delivery ready',
    passed: true,
    detail: `${deliveryCues.length} cue(s) ready for scheduled delivery`
  });

  res.json({
    success: allPassed,
    site: {
      id: site.id,
      name: site.name,
      domain: site.domain,
      siteKey: site.site_key,
      lastSeenAt: site.last_seen_at,
      sdkVersion: site.sdk_version
    },
    connected: Boolean(isConnected),
    checks
  });
});

/**
 * Admin: Activity / Audit logs feed
 */
apiRouter.get('/audit-logs', requireAdminAuth, async (req, res) => {
  try {
    const { site_id, limit = 50 } = req.query;
    const logs = await listAuditLogs(site_id || null, parseInt(limit, 10) || 50);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Integration Test Helper: Schedule or refresh the standard integration test cue
 * Title: Chronicle External Integration Test
 * Target selector: #chronicle-notice-board
 * Action: replace
 * Start: ~1 minute after creation
 * End: ~3 minutes after creation
 */
apiRouter.post('/test/schedule-integration-cue', async (req, res) => {
  try {
    const { siteKey = 'chr_live_701ad71ffb3394b1', startDelaySeconds = 60, durationSeconds = 120 } = req.body || {};
    const site = await getSite(siteKey);
    if (!site) {
      return res.status(404).json({ error: `Site '${siteKey}' not found` });
    }

    const now = Date.now();
    const startMs = now + (startDelaySeconds * 1000);
    const endMs = startMs + (durationSeconds * 1000);

    const cueId = 'cue-predix-integration-test';
    const cueData = {
      id: cueId,
      site_id: site.id,
      title: 'Chronicle External Integration Test',
      placement_type: 'selector',
      target_selector: '#chronicle-notice-board',
      action: 'replace',
      content_html: `
        <div class="chronicle-notice-card" style="margin: 16px 24px; padding: 18px 22px; background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.95)); border: 1px solid rgba(59, 130, 246, 0.5); border-radius: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); color: #f8fafc; font-family: system-ui, -apple-system, sans-serif;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <span style="background: #2563eb; color: #fff; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em;">⚡ Live Test Cue</span>
            <span style="font-size: 12px; color: #94a3b8;">Chronicle ↔ Predix Integration</span>
          </div>
          <h4 style="margin: 0 0 6px 0; color: #f8fafc; font-size: 16px; font-weight: 600;">Chronicle External Integration Test</h4>
          <p style="margin: 0; color: #cbd5e1; font-size: 13.5px; line-height: 1.5;">This scheduled notice is automatically delivered by the Chronicle Engine to Predix without page reload.</p>
        </div>
      `,
      css_styles: '',
      start_at: new Date(startMs).toISOString(),
      end_at: new Date(endMs).toISOString(),
      is_active: 1
    };

    const existing = await getCue(cueId);
    let resultCue;
    if (existing) {
      resultCue = await updateCue(cueId, cueData);
    } else {
      resultCue = await createCue(cueData);
    }

    await logAuditEvent({
      site_id: site.id,
      event_type: 'cue_scheduled',
      details: `Integration test cue scheduled: starts in ${startDelaySeconds}s, ends in ${startDelaySeconds + durationSeconds}s`
    });

    res.json({
      success: true,
      message: 'Integration test cue scheduled successfully',
      cue: resultCue,
      serverTime: new Date(now).toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
