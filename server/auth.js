import crypto from 'node:crypto';

// In-memory server-side session store
// Maps secure session tokens to session metadata
const activeSessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Returns true if the server is configured with an ADMIN_API_KEY
 */
export function isAuthRequired() {
  const key = process.env.ADMIN_API_KEY;
  return Boolean(key && key.trim().length > 0);
}

/**
 * Validates whether the supplied password matches the server-side ADMIN_API_KEY
 */
export function verifyAdminKey(key) {
  if (!isAuthRequired()) return true;
  if (!key || typeof key !== 'string') return false;

  const expected = process.env.ADMIN_API_KEY;
  // Constant-time comparison to prevent timing attacks
  const keyBuffer = Buffer.from(key);
  const expectedBuffer = Buffer.from(expected);

  if (keyBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(keyBuffer, expectedBuffer);
}

/**
 * Generates a cryptographically secure session token
 */
export function createSession() {
  const token = 'chr_sess_' + crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  activeSessions.set(token, {
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS
  });
  return {
    token,
    expiresIn: Math.floor(SESSION_TTL_MS / 1000)
  };
}

/**
 * Checks if a session token is valid and not expired
 */
export function isValidSession(token) {
  if (!token) return false;
  const session = activeSessions.get(token);
  if (!session) return false;

  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

/**
 * Invalidate a session token (logout)
 */
export function destroySession(token) {
  if (token) activeSessions.delete(token);
}

/**
 * Middleware: Requires a valid session token OR direct ADMIN_API_KEY header
 */
export function requireAdminAuth(req, res, next) {
  // If no ADMIN_API_KEY is configured on the server, allow open access (development fallback)
  if (!isAuthRequired()) {
    return next();
  }

  // 1. Check session token from header (used by Dashboard after login)
  const sessionToken =
    req.headers['x-chronicle-admin-token'] ||
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);

  if (sessionToken && isValidSession(sessionToken)) {
    return next();
  }

  // 2. Check direct admin API key (for CLI / script / curl integrations)
  const directKey = req.headers['x-chronicle-admin-key'];
  if (directKey && verifyAdminKey(directKey)) {
    return next();
  }

  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Valid admin authentication token or API key required to access this endpoint.'
  });
}
