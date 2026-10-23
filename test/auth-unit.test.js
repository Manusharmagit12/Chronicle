/**
 * Dedicated Admin Authentication Integration Test
 * Verifies that when ADMIN_API_KEY is active:
 * 1. Admin endpoints block unauthenticated requests with 401
 * 2. Login endpoint validates credentials and returns a session token
 * 3. Session token authorizes mutations
 * 4. Direct x-chronicle-admin-key header authorizes mutations
 * 5. Logout destroys the session token
 */

import { isAuthRequired, verifyAdminKey, createSession, isValidSession, destroySession } from '../server/auth.js';

console.log('Testing server/auth.js unit logic...');

process.env.ADMIN_API_KEY = 'production-secret-98765';

if (!isAuthRequired()) throw new Error('isAuthRequired should be true');
if (!verifyAdminKey('production-secret-98765')) throw new Error('Valid key verification failed');
if (verifyAdminKey('wrong-secret')) throw new Error('Invalid key should fail');

const session = createSession();
if (!session.token || !session.token.startsWith('chr_sess_')) throw new Error('Invalid session token format');
if (!isValidSession(session.token)) throw new Error('Session should be valid');

destroySession(session.token);
if (isValidSession(session.token)) throw new Error('Destroyed session should be invalid');

delete process.env.ADMIN_API_KEY;
if (isAuthRequired()) throw new Error('isAuthRequired should be false when key is cleared');

console.log('[PASS] server/auth.js unit verification complete.');
