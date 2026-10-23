/**
 * PostgreSQL Persistence, Scheduling, and Operations Test Suite
 * Emulates Neon PostgreSQL using pg-mem to verify:
 * 1. Schema migration on PostgreSQL
 * 2. Site and Cue CRUD operations (create, read, update, pause, resume, delete)
 * 3. Server-side UTC window scheduling and delivery logic
 * 4. Persistence across connection re-initialization (sleep & wake simulation)
 */

import { newDb } from 'pg-mem';
import {
  initDb,
  getSite,
  upsertSite,
  listSites,
  createCue,
  getCue,
  updateCue,
  toggleCueActive,
  deleteCue,
  deleteSite,
  getCuesForDelivery,
  setTestPgPool,
  resetDatabaseInstances,
  closeDb,
  getDatabaseType
} from '../server/db.js';

async function runPostgresTests() {
  console.log('========================================================');
  console.log('  CHRONICLE POSTGRESQL (NEON) VERIFICATION SUITE');
  console.log('========================================================\n');

  // Setup in-memory PostgreSQL instance simulating Neon
  const memDb = newDb();
  // Handle pg-mem AST coverage limit on repeated CREATE TABLE IF NOT EXISTS
  memDb.public.interceptQueries(sql => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS sites')) {
      try {
        memDb.public.getTable('sites');
        return [];
      } catch (e) {}
    }
    return null;
  });

  const pgAdapter = memDb.adapters.createPg();
  const testPool = new pgAdapter.Pool();

  // Configure environment for PostgreSQL mode
  process.env.DATABASE_URL = 'postgresql://user:pass@ep-test-123456.us-east-2.aws.neon.tech/neondb?sslmode=require';
  resetDatabaseInstances();
  setTestPgPool(testPool);

  console.log(`Test 1: PostgreSQL Mode Detection`);
  const dbType = getDatabaseType();
  console.log(`   Database Type: ${dbType}`);
  if (dbType !== 'postgres') {
    throw new Error(`Expected database type 'postgres', got '${dbType}'`);
  }
  console.log('   [PASS] Successfully detected PostgreSQL mode from DATABASE_URL.\n');

  console.log('Test 2: Schema Migration on PostgreSQL');
  await initDb();
  console.log('   [PASS] Schema and indexes created on PostgreSQL successfully.\n');

  console.log('Test 3: Site Management (Upsert, Get, List)');
  const site = await upsertSite({
    id: 'neon-college',
    name: 'Neon Technical College',
    domain: 'https://neoncollege.edu'
  });
  if (!site || site.name !== 'Neon Technical College') {
    throw new Error('Failed to upsert site on PostgreSQL!');
  }
  console.log(`   [PASS] Created site: ${site.name} (${site.id})`);

  const fetchedSite = await getSite('neon-college');
  if (!fetchedSite || fetchedSite.domain !== 'https://neoncollege.edu') {
    throw new Error('Failed to fetch site by ID!');
  }
  console.log(`   [PASS] Verified site retrieval from PostgreSQL.`);

  const allSites = await listSites();
  if (!allSites.some(s => s.id === 'neon-college')) {
    throw new Error('Site not found in listSites()!');
  }
  console.log(`   [PASS] Verified site listing on PostgreSQL.\n`);

  console.log('Test 4: Cue Scheduling & Server-Side UTC Time Evaluation');
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Active cue: started 5 mins ago, ends in 30 mins
  const activeCue = await createCue({
    id: 'cue-pg-active',
    site_id: 'neon-college',
    title: 'Neon Live Announcement',
    placement_type: 'top_banner',
    content_html: '<div>Spring Registration Open</div>',
    start_at: new Date(now - 5 * 60 * 1000).toISOString(),
    end_at: new Date(now + 30 * 60 * 1000).toISOString()
  });
  console.log(`   [PASS] Created Active Cue: ${activeCue.title}`);

  // Upcoming cue: starts in 15 seconds, ends in 60 seconds
  const upcomingCue = await createCue({
    id: 'cue-pg-upcoming',
    site_id: 'neon-college',
    title: 'Upcoming Flash Notice',
    placement_type: 'selector',
    target_selector: '#notice-board',
    action: 'prepend',
    content_html: '<div>Maintenance in 15s</div>',
    start_at: new Date(now + 15 * 1000).toISOString(),
    end_at: new Date(now + 60 * 1000).toISOString()
  });
  console.log(`   [PASS] Created Upcoming Cue: ${upcomingCue.title}`);

  // Expired cue: ended 10 minutes ago
  const expiredCue = await createCue({
    id: 'cue-pg-expired',
    site_id: 'neon-college',
    title: 'Expired Yesterday Promo',
    placement_type: 'top_banner',
    content_html: '<div>Expired Promo</div>',
    start_at: new Date(now - 60 * 60 * 1000).toISOString(),
    end_at: new Date(now - 10 * 60 * 1000).toISOString()
  });
  console.log(`   [PASS] Created Expired Cue: ${expiredCue.title}`);

  // Query delivery endpoint logic
  const deliveryCues = await getCuesForDelivery('neon-college');
  console.log(`   Delivered cues count: ${deliveryCues.length}`);

  const activeFound = deliveryCues.find(c => c.id === 'cue-pg-active');
  const upcomingFound = deliveryCues.find(c => c.id === 'cue-pg-upcoming');
  const expiredFound = deliveryCues.find(c => c.id === 'cue-pg-expired');

  if (!activeFound || activeFound.status !== 'active') {
    throw new Error('Active cue was not returned with status "active" on PostgreSQL!');
  }
  if (!upcomingFound || upcomingFound.status !== 'upcoming') {
    throw new Error('Upcoming cue was not returned with status "upcoming" on PostgreSQL!');
  }
  if (expiredFound) {
    throw new Error('Expired cue was incorrectly included in active delivery on PostgreSQL!');
  }
  console.log('   [PASS] Server-side UTC window query on PostgreSQL correctly filtered Active, Upcoming, and Expired cues.\n');

  console.log('Test 5: Cue Update, Pause (Cancellation), and Reactivation');
  // Update cue content
  const updated = await updateCue('cue-pg-active', {
    title: 'Neon Live Announcement (Updated)',
    content_html: '<div>Updated Registration Details</div>'
  });
  if (updated.title !== 'Neon Live Announcement (Updated)') {
    throw new Error('Cue update failed on PostgreSQL!');
  }
  console.log(`   [PASS] Updated cue content on PostgreSQL.`);

  // Pause cue (cancellation)
  const paused = await toggleCueActive('cue-pg-active', 0);
  if (paused.is_active !== 0) {
    throw new Error('Cue pause failed on PostgreSQL!');
  }
  const deliveryAfterPause = await getCuesForDelivery('neon-college');
  if (deliveryAfterPause.some(c => c.id === 'cue-pg-active')) {
    throw new Error('Paused cue was still returned by delivery query on PostgreSQL!');
  }
  console.log(`   [PASS] Paused cue successfully excluded from delivery on PostgreSQL.`);

  // Reactivate cue
  await toggleCueActive('cue-pg-active', 1);
  const deliveryAfterResume = await getCuesForDelivery('neon-college');
  if (!deliveryAfterResume.some(c => c.id === 'cue-pg-active')) {
    throw new Error('Resumed cue was not restored to delivery on PostgreSQL!');
  }
  console.log(`   [PASS] Reactivated cue successfully restored on PostgreSQL.\n`);

  console.log('Test 6: Simulated Cloud Sleep & Wake Persistence');
  // Simulate the server going to sleep: pool is closed and reconnected to the database
  console.log('   Simulating Render container sleep (connection closing)...');
  resetDatabaseInstances();

  // Container wakes up upon visitor request: re-establishes connection to existing database
  console.log('   Container woke up! Re-connecting to PostgreSQL and re-running initDb()...');
  const wakePool = new pgAdapter.Pool();
  setTestPgPool(wakePool);
  await initDb();

  // Verify all records survived the sleep cycle intact
  const siteAfterWake = await getSite('neon-college');
  const cueAfterWake = await getCue('cue-pg-active');

  if (!siteAfterWake || siteAfterWake.name !== 'Neon Technical College') {
    throw new Error('Site record lost after simulated sleep on PostgreSQL!');
  }
  if (!cueAfterWake || cueAfterWake.title !== 'Neon Live Announcement (Updated)') {
    throw new Error('Cue record lost after simulated sleep on PostgreSQL!');
  }
  console.log('   [PASS] All sites, cues, and updates survived simulated server sleep & wake intact.\n');

  console.log('Test 7: Deletion Operations');
  await deleteCue('cue-pg-active');
  await deleteCue('cue-pg-upcoming');
  await deleteCue('cue-pg-expired');
  const deletedCueCheck = await getCue('cue-pg-active');
  if (deletedCueCheck) throw new Error('Cue was not deleted from PostgreSQL!');
  console.log('   [PASS] Cues deleted successfully.');

  await deleteSite('neon-college');
  const deletedSiteCheck = await getSite('neon-college');
  if (deletedSiteCheck) throw new Error('Site was not deleted from PostgreSQL!');
  console.log('   [PASS] Site deleted successfully.\n');

  // Teardown test environment
  delete process.env.DATABASE_URL;
  resetDatabaseInstances();
  console.log('========================================================');
  console.log('  ALL POSTGRESQL VERIFICATION CHECKS PASSED (100%)!     ');
  console.log('========================================================\n');
}

runPostgresTests().catch(err => {
  console.error('\n[POSTGRESQL TEST FAILED]:', err);
  process.exit(1);
});
