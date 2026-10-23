/**
 * Automated Verification Script for Chronicle Phase 1
 * Simulates the Chronicle client embed script lifecycle:
 * 1. Queries delivery API
 * 2. Schedules a new cue for now + 2 seconds, lasting 4 seconds
 * 3. Verifies cue transitions from UPCOMING -> ACTIVE -> EXPIRED at exact times
 */

const API_BASE = 'http://localhost:3000/api/v1';
const SITE_KEY = 'apex-university';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('--- [Chronicle Verification Test] ---');

  // 1. Check Delivery API
  console.log('1. Checking Delivery API for existing cues...');
  const res1 = await fetch(`${API_BASE}/cues?siteKey=${SITE_KEY}`);
  const data1 = await res1.json();
  console.log(`   Found ${data1.cues.length} existing cues for site: ${data1.site.name}`);
  for (const c of data1.cues) {
    console.log(`   - [${c.status.toUpperCase()}] ${c.title} (${c.placement_type})`);
  }

  // 2. Schedule a short-lived test cue: starts in 2 seconds, ends in 5 seconds
  const now = Date.now();
  const startAt = new Date(now + 2000).toISOString();
  const endAt = new Date(now + 5000).toISOString();
  const testCueId = 'cue-test-' + Math.random().toString(36).substring(2, 7);

  console.log(`\n2. Scheduling test cue '${testCueId}':`);
  console.log(`   Start: ${startAt} (in 2.0s)`);
  console.log(`   End:   ${endAt} (in 5.0s)`);

  const createRes = await fetch(`${API_BASE}/cues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: testCueId,
      site_id: SITE_KEY,
      title: 'Automated Lifecycle Verification Banner',
      placement_type: 'top_banner',
      content_html: '<div>Automated Test Banner</div>',
      start_at: startAt,
      end_at: endAt
    })
  });

  if (!createRes.ok) {
    throw new Error('Failed to create test cue: ' + (await createRes.text()));
  }
  console.log('   Cue registered in SQLite database successfully.');

  // 3. Immediately fetch cues (should be UPCOMING)
  console.log('\n3. Fetching cues immediately (T = 0.5s):');
  const res2 = await fetch(`${API_BASE}/cues?siteKey=${SITE_KEY}`);
  const data2 = await res2.json();
  const testCueT0 = data2.cues.find(c => c.id === testCueId);
  if (!testCueT0) throw new Error('Test cue was not returned in delivery query!');
  console.log(`   Cue Status: ${testCueT0.status} | Remaining to start: ${testCueT0.remainingMsToStart}ms`);
  if (testCueT0.status !== 'upcoming') {
    throw new Error(`Expected status 'upcoming', got '${testCueT0.status}'`);
  }
  console.log('   [PASS] Cue is correctly HIDDEN / UPCOMING before scheduled time.');

  // 4. Wait 2.2 seconds (T = 2.7s): should now be ACTIVE
  console.log('\n4. Waiting 2.2s for cue start time to arrive...');
  await sleep(2200);

  const res3 = await fetch(`${API_BASE}/cues?siteKey=${SITE_KEY}`);
  const data3 = await res3.json();
  const testCueT1 = data3.cues.find(c => c.id === testCueId);
  if (!testCueT1) throw new Error('Test cue vanished prematurely!');
  console.log(`   Cue Status: ${testCueT1.status} | Remaining to end: ${testCueT1.remainingMsToEnd}ms`);
  if (testCueT1.status !== 'active') {
    throw new Error(`Expected status 'active', got '${testCueT1.status}'`);
  }
  console.log('   [PASS] Cue is ACTIVE and displayed at its scheduled start time.');

  // 5. Wait 3.2 seconds (T = 5.9s): should now be EXPIRED / removed
  console.log('\n5. Waiting 3.2s for cue end time to pass...');
  await sleep(3200);

  const res4 = await fetch(`${API_BASE}/cues?siteKey=${SITE_KEY}`);
  const data4 = await res4.json();
  const testCueT2 = data4.cues.find(c => c.id === testCueId);
  if (testCueT2) {
    throw new Error(`Cue should have expired and been excluded from active delivery, but was returned with status '${testCueT2.status}'`);
  }
  console.log('   [PASS] Cue automatically EXPIRED and removed from delivery.');

  // Clean up test cue from DB
  await fetch(`${API_BASE}/cues/${testCueId}`, { method: 'DELETE' });
  console.log('   Test cue cleaned up.');

  console.log('\n=== [ALL VERIFICATION CHECKS PASSED SUCCESSFULLY] ===\n');
}

run().catch(err => {
  console.error('\n[VERIFICATION FAILED]:', err);
  process.exit(1);
});
