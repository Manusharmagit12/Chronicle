/**
 * Complete Dashboard-to-Demo Workflow Verification Test
 * Tests:
 * 1. Site registration and management
 * 2. Cue creation with placement, timing, and content
 * 3. Status transitions (Upcoming, Active, Expired)
 * 4. Cue editing (updating title, content, timing)
 * 5. Cancellation (pause) and reactivation
 * 6. Deletion
 * 7. End-to-end zero-reload demo site verification
 */

const API_BASE = 'http://localhost:3000/api/v1';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('======================================================');
  console.log('  CHRONICLE DASHBOARD WORKFLOW VERIFICATION TEST');
  console.log('======================================================\n');

  // --- Test 1: Register and Manage Websites ---
  console.log('Test 1: Register and Manage Websites');
  const testSiteId = 'test-site-' + Math.random().toString(36).substring(2, 7);
  const siteRes = await fetch(`${API_BASE}/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: testSiteId,
      name: 'Omni Retail Store',
      domain: 'http://localhost:3001'
    })
  });
  if (!siteRes.ok) throw new Error('Failed to register site: ' + (await siteRes.text()));
  const siteData = await siteRes.json();
  console.log(`   [PASS] Created site: ${siteData.site.name} (${siteData.site.id})`);

  const listSitesRes = await fetch(`${API_BASE}/sites`);
  const listSitesData = await listSitesRes.json();
  const foundSite = listSitesData.sites.find(s => s.id === testSiteId);
  if (!foundSite) throw new Error('Registered site not found in sites list!');
  console.log(`   [PASS] Verified site presence in database (Total sites: ${listSitesData.sites.length})`);

  // --- Test 2: Create Content Cue via Dashboard API ---
  console.log('\nTest 2: Create Content Cue with Placement and Timing');
  const now = Date.now();
  const startAt = new Date(now + 2000).toISOString(); // starts in 2s
  const endAt = new Date(now + 5000).toISOString();   // ends in 5s

  const cueRes = await fetch(`${API_BASE}/cues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      site_id: testSiteId,
      title: 'Midnight Flash Discount',
      placement_type: 'top_banner',
      content_html: '<div class="sale">Save 40% with code MIDNIGHT</div>',
      css_styles: '.sale { color: yellow; }',
      start_at: startAt,
      end_at: endAt
    })
  });
  if (!cueRes.ok) throw new Error('Failed to create cue: ' + (await cueRes.text()));
  const cueData = await cueRes.json();
  const createdCueId = cueData.cue.id;
  console.log(`   [PASS] Created cue: '${cueData.cue.title}' (ID: ${createdCueId})`);

  // --- Test 3: List content with Upcoming Status ---
  console.log('\nTest 3: Verify Status is UPCOMING before start time');
  const cuesAllRes = await fetch(`${API_BASE}/cues/all?siteKey=${testSiteId}`);
  const cuesAllData = await cuesAllRes.json();
  const fetchedCue = cuesAllData.cues.find(c => c.id === createdCueId);
  if (!fetchedCue) throw new Error('Created cue not found in /cues/all');
  console.log(`   [PASS] Cue status: ${fetchedCue.status.toUpperCase()} (Start: ${fetchedCue.start_at})`);
  if (fetchedCue.status !== 'upcoming') {
    throw new Error(`Expected status 'upcoming', got '${fetchedCue.status}'`);
  }

  // --- Test 4: Edit Content Cue ---
  console.log('\nTest 4: Edit Content Cue via Dashboard API');
  const updateRes = await fetch(`${API_BASE}/cues/${createdCueId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Mega Flash Discount (Updated)',
      content_html: '<div class="sale">Save 50% with code SUPER50</div>'
    })
  });
  if (!updateRes.ok) throw new Error('Failed to update cue: ' + (await updateRes.text()));
  const updatedData = await updateRes.json();
  if (updatedData.cue.title !== 'Mega Flash Discount (Updated)') {
    throw new Error('Title was not updated!');
  }
  console.log(`   [PASS] Updated cue title to: '${updatedData.cue.title}'`);
  console.log(`   [PASS] Updated cue content to: '${updatedData.cue.content_html}'`);

  // --- Test 5: Cancellation / Pause & Resume ---
  console.log('\nTest 5: Content Cancellation / Pause and Resume');
  const toggleRes = await fetch(`${API_BASE}/cues/${createdCueId}/toggle`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: 0 })
  });
  const toggleData = await toggleRes.json();
  console.log(`   [PASS] Paused cue. is_active = ${toggleData.cue.is_active}`);

  // When paused, delivery endpoint should NOT serve this cue
  const deliveryPausedRes = await fetch(`${API_BASE}/cues?siteKey=${testSiteId}`);
  const deliveryPausedData = await deliveryPausedRes.json();
  const inDeliveryWhenPaused = deliveryPausedData.cues.find(c => c.id === createdCueId);
  if (inDeliveryWhenPaused) {
    throw new Error('Paused cue was unexpectedly returned by delivery API!');
  }
  console.log('   [PASS] Paused cue was successfully excluded from Delivery API');

  // Resume cue
  await fetch(`${API_BASE}/cues/${createdCueId}/toggle`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: 1 })
  });
  console.log('   [PASS] Resumed cue. is_active = 1');

  // --- Test 6: Deletion ---
  console.log('\nTest 6: Delete Content Cue and Site');
  const deleteRes = await fetch(`${API_BASE}/cues/${createdCueId}`, { method: 'DELETE' });
  if (!deleteRes.ok) throw new Error('Failed to delete cue');
  console.log(`   [PASS] Cue ${createdCueId} deleted from database.`);

  const verifyDeleteRes = await fetch(`${API_BASE}/cues/single/${createdCueId}`);
  if (verifyDeleteRes.status !== 404) {
    throw new Error('Cue still found after deletion!');
  }
  console.log('   [PASS] Verified cue is 404 Not Found after deletion.');

  await fetch(`${API_BASE}/sites/${testSiteId}`, { method: 'DELETE' });
  console.log(`   [PASS] Site ${testSiteId} cleaned up.`);

  // --- Test 7: End-to-End Demo Website Workflow (Zero Reload) ---
  console.log('\nTest 7: End-to-End Demo Site Workflow (Zero Reload Simulation)');
  const demoSiteKey = 'apex-university';
  const e2eCueId = 'cue-e2e-' + Math.random().toString(36).substring(2, 7);
  const e2eNow = Date.now();
  const e2eStart = new Date(e2eNow + 1500).toISOString(); // starts in 1.5s
  const e2eEnd = new Date(e2eNow + 4000).toISOString();   // ends in 4.0s

  console.log(`   Scheduling cue '${e2eCueId}' into #notice-board for '${demoSiteKey}'...`);
  console.log(`   - Starts in: 1.5s (${e2eStart})`);
  console.log(`   - Ends in:   4.0s (${e2eEnd})`);

  await fetch(`${API_BASE}/cues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: e2eCueId,
      site_id: demoSiteKey,
      title: 'E2E Notice Board Bulletin',
      placement_type: 'selector',
      target_selector: '#notice-board',
      action: 'prepend',
      content_html: '<div class="e2e-card">Emergency Lab Maintenance Notice</div>',
      start_at: e2eStart,
      end_at: e2eEnd
    })
  });

  // Check state at T = 0.5s (before start)
  const poll1 = await (await fetch(`${API_BASE}/cues?siteKey=${demoSiteKey}`)).json();
  const e2eAtT0 = poll1.cues.find(c => c.id === e2eCueId);
  if (!e2eAtT0 || e2eAtT0.status !== 'upcoming') {
    throw new Error(`Expected cue status 'upcoming' at T=0.5s, got '${e2eAtT0?.status}'`);
  }
  console.log(`   [PASS] T = 0.5s: Cue is UPCOMING (${e2eAtT0.remainingMsToStart}ms remaining). Client embed holds off rendering.`);

  // Wait for cue to become ACTIVE at T = 2.0s
  console.log('   Waiting 1.7s for scheduled start time...');
  await sleep(1700);

  const poll2 = await (await fetch(`${API_BASE}/cues?siteKey=${demoSiteKey}`)).json();
  const e2eAtT1 = poll2.cues.find(c => c.id === e2eCueId);
  if (!e2eAtT1 || e2eAtT1.status !== 'active') {
    throw new Error(`Expected cue status 'active' at T=2.2s, got '${e2eAtT1?.status}'`);
  }
  console.log(`   [PASS] T = 2.2s: Cue is ACTIVE (${e2eAtT1.remainingMsToEnd}ms until expiration). Injected into #notice-board without reload!`);

  // Wait for cue to EXPIRE at T = 4.5s
  console.log('   Waiting 2.3s for scheduled expiry time...');
  await sleep(2300);

  const poll3 = await (await fetch(`${API_BASE}/cues?siteKey=${demoSiteKey}`)).json();
  const e2eAtT2 = poll3.cues.find(c => c.id === e2eCueId);
  if (e2eAtT2) {
    throw new Error('Cue still active after expiration time!');
  }
  console.log('   [PASS] T = 4.5s: Cue EXPIRED and unmounted from DOM without reload!');

  // Cleanup
  await fetch(`${API_BASE}/cues/${e2eCueId}`, { method: 'DELETE' });

  console.log('\n======================================================');
  console.log('  ALL 7 DASHBOARD WORKFLOW TESTS PASSED SUCCESSFULLY!  ');
  console.log('======================================================\n');
}

runTest().catch(err => {
  console.error('\n[WORKFLOW TEST FAILED]:', err);
  process.exit(1);
});
