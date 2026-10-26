/**
 * Chronicle Integration Verification & Security Test Suite
 * Validates:
 * 1. Strict Cross-Site Isolation (Site A cannot access Site B content)
 * 2. HTML Injection Sanitization (XSS scripts & dangerous handlers stripped, safe HTML preserved)
 * 3. SDK Connection Heartbeat & Live Tracking
 * 4. End-to-End Test Integration Checklist
 * 5. Audit Logging of System Events
 */

import assert from 'node:assert';
import {
  initDb,
  upsertSite,
  getSite,
  createCue,
  getCuesForDelivery,
  touchSiteHeartbeat,
  logAuditEvent,
  listAuditLogs,
  deleteSite,
  deleteCue
} from '../server/db.js';
import { sanitizeHtml, sanitizeCss } from '../server/sanitizer.js';

console.log('========================================================');
console.log('  CHRONICLE INTEGRATION & SECURITY VERIFICATION SUITE   ');
console.log('========================================================\n');

async function runTests() {
  await initDb();

  /* -----------------------------------------------------------------------
     Test 1: Cross-Site Isolation (Requirement 7)
  ----------------------------------------------------------------------- */
  console.log('Test 1: Strict Cross-Site Isolation by Site ID / Site Key');

  const randSuffix = Math.random().toString(36).substring(2, 7);
  const siteAId = `site-alpha-${randSuffix}`;
  const siteBId = `site-beta-${randSuffix}`;
  const cueAId = `cue-alpha-${randSuffix}`;
  const cueBId = `cue-beta-${randSuffix}`;

  const siteA = await upsertSite({
    id: siteAId,
    name: 'Alpha Corporation',
    domain: 'https://alpha.example.com'
  });

  const siteB = await upsertSite({
    id: siteBId,
    name: 'Beta Retail',
    domain: 'https://beta.example.com'
  });

  assert(siteA.site_key, 'Site A must have a generated site_key');
  assert(siteB.site_key, 'Site B must have a generated site_key');
  assert.notStrictEqual(siteA.site_key, siteB.site_key, 'Site keys must be strictly unique');

  const now = Date.now();
  const startAt = new Date(now - 1000).toISOString();
  const endAt = new Date(now + 3600 * 1000).toISOString();

  // Schedule Cue for Site A
  const cueA = await createCue({
    id: cueAId,
    site_id: siteA.id,
    title: 'Confidential Alpha Internal Notice',
    placement_type: 'top_banner',
    content_html: '<div>Alpha Private Data</div>',
    start_at: startAt,
    end_at: endAt
  });

  // Schedule Cue for Site B
  const cueB = await createCue({
    id: cueBId,
    site_id: siteB.id,
    title: 'Beta 50% Off Flash Promo',
    placement_type: 'selector',
    target_selector: '#notice-board',
    action: 'append',
    content_html: '<div>Beta Public Promo</div>',
    start_at: startAt,
    end_at: endAt
  });

  // Test retrieval using Site A's key / ID
  const deliveryA = await getCuesForDelivery(siteA.site_key);
  const deliveryAById = await getCuesForDelivery(siteA.id);

  assert(deliveryA.some(c => c.id === cueA.id), 'Site A must receive its own cues');
  assert(deliveryAById.some(c => c.id === cueA.id), 'Site A must receive cues when queried by ID');
  assert(!deliveryA.some(c => c.id === cueB.id), 'CRITICAL: Site A delivery MUST NOT contain Site B cues');
  assert(!deliveryAById.some(c => c.id === cueB.id), 'CRITICAL: Site A delivery by ID MUST NOT contain Site B cues');

  // Test retrieval using Site B's key / ID
  const deliveryB = await getCuesForDelivery(siteB.site_key);
  assert(deliveryB.some(c => c.id === cueB.id), 'Site B must receive its own cues');
  assert(!deliveryB.some(c => c.id === cueA.id), 'CRITICAL: Site B delivery MUST NOT contain Site A cues');

  console.log('   [PASS] Verified strict cross-site cue isolation. Zero leakage between sites.\n');

  /* -----------------------------------------------------------------------
     Test 2: HTML Injection Security & XSS Sanitization (Requirement 8)
  ----------------------------------------------------------------------- */
  console.log('Test 2: HTML Sanitization & XSS Defense');

  const maliciousPayloads = [
    '<script>alert("xss")</script><p>Hello World</p>',
    '<img src="invalid.jpg" onerror="alert(document.cookie)"><span>Special Deal</span>',
    '<a href="javascript:alert(1)">Click Here</a>',
    '<iframe src="https://evil.com"></iframe><div>Legitimate Notice</div>',
    '<div onmouseover="evil()" onclick="evil()">Hover or Click me</div>',
    '<style>body { display:none; }</style>Safe style',
    '<object data="exploit.swf"></object>Safe text'
  ];

  maliciousPayloads.forEach((payload, idx) => {
    const sanitized = sanitizeHtml(payload);
    assert(!sanitized.includes('<script'), `Payload ${idx + 1}: <script> was not removed`);
    assert(!sanitized.includes('onerror='), `Payload ${idx + 1}: onerror was not removed`);
    assert(!sanitized.includes('javascript:'), `Payload ${idx + 1}: javascript: url was not removed`);
    assert(!sanitized.includes('<iframe'), `Payload ${idx + 1}: <iframe was not removed`);
    assert(!sanitized.includes('onmouseover='), `Payload ${idx + 1}: onmouseover was not removed`);
    assert(!sanitized.includes('onclick='), `Payload ${idx + 1}: onclick was not removed`);
    assert(!sanitized.includes('<object'), `Payload ${idx + 1}: <object was not removed`);
  });

  // Test that safe formatting is preserved
  const safeContent = `
    <div class="announcement-banner">
      <h3>Limited Time Discount — 30% OFF</h3>
      <p>Use code <strong>SAVE30</strong> at checkout!</p>
      <a href="https://example.com/checkout">Claim Offer &rarr;</a>
    </div>
  `;
  const sanitizedSafe = sanitizeHtml(safeContent);
  assert(sanitizedSafe.includes('<h3>Limited Time Discount — 30% OFF</h3>'), 'Safe headings must be preserved');
  assert(sanitizedSafe.includes('<strong>SAVE30</strong>'), 'Safe formatting tags must be preserved');
  assert(sanitizedSafe.includes('<a href="https://example.com/checkout"'), 'Safe https links must be preserved');

  console.log('   [PASS] Verified comprehensive anti-XSS sanitization while preserving rich formatting.\n');

  /* -----------------------------------------------------------------------
     Test 3: SDK Connection Heartbeat & Live Tracking (Requirement 3)
  ----------------------------------------------------------------------- */
  console.log('Test 3: SDK Connection Heartbeat & Live Status');

  const siteBeforePing = await getSite(siteA.id);
  assert.strictEqual(siteBeforePing.last_seen_at, null, 'Initial heartbeat should be null');

  // Trigger heartbeat ping
  await touchSiteHeartbeat(siteA.site_key, '1.1.0');

  const siteAfterPing = await getSite(siteA.id);
  assert(siteAfterPing.last_seen_at !== null, 'last_seen_at must be populated after heartbeat');
  assert.strictEqual(siteAfterPing.sdk_version, '1.1.0', 'sdk_version must be recorded');

  const pingTime = new Date(siteAfterPing.last_seen_at).getTime();
  const timeDiff = Math.abs(Date.now() - pingTime);
  assert(timeDiff < 5000, 'Heartbeat timestamp must match current server time within 5 seconds');

  console.log('   [PASS] Heartbeat recording and SDK version tracking verified successfully.\n');

  /* -----------------------------------------------------------------------
     Test 4: Activity & Audit Logging (Requirement 12)
  ----------------------------------------------------------------------- */
  console.log('Test 4: System Event Audit Logging');

  await logAuditEvent({
    site_id: siteA.id,
    event_type: 'site_registered',
    details: `Registered test site ${siteA.name}`
  });

  const logs = await listAuditLogs(siteA.id);
  assert(Array.isArray(logs), 'Audit logs must return an array');
  assert(logs.length > 0, 'Site audit log must contain the recorded event');
  assert.strictEqual(logs[0].event_type, 'site_registered');

  const globalLogs = await listAuditLogs(null, 20);
  assert(globalLogs.length > 0, 'Global audit log must contain recorded events');

  console.log(`   [PASS] Audit logs verified (${globalLogs.length} events logged in database).\n`);

  /* -----------------------------------------------------------------------
     Clean Up Test Data
  ----------------------------------------------------------------------- */
  await deleteCue(cueA.id);
  await deleteCue(cueB.id);
  await deleteSite(siteA.id);
  await deleteSite(siteB.id);

  console.log('========================================================');
  console.log('  ALL INTEGRATION & SECURITY CHECKS PASSED (100%)!      ');
  console.log('========================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ INTEGRATION TEST FAILED:', err);
  process.exit(1);
});
