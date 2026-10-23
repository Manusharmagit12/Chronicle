import { initDb, upsertSite, createCue, listCuesForSite, deleteCue } from './db.js';

initDb();

console.log('[Seed] Seeding sample sites and cues...');

const siteId = 'apex-university';
upsertSite({
  id: siteId,
  name: 'Apex Institute of Technology',
  domain: 'http://localhost:3001'
});

// Clear previous cues for clean state
const existingCues = listCuesForSite(siteId);
for (const c of existingCues) {
  deleteCue(c.id);
}

const now = Date.now();

// 1. Currently ACTIVE Cue: Top Announcement Banner
createCue({
  id: 'cue-banner-active',
  site_id: siteId,
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
  start_at: new Date(now - 10 * 60 * 1000).toISOString(), // Started 10 mins ago
  end_at: new Date(now + 2 * 60 * 60 * 1000).toISOString() // Ends in 2 hours
});

// 2. Currently ACTIVE Cue: Notice Board highlight
createCue({
  id: 'cue-notice-active',
  site_id: siteId,
  title: 'Campus Career Fair Notice',
  placement_type: 'selector',
  target_selector: '#notice-board',
  action: 'prepend',
  content_html: `
    <div class="notice-card highlight-notice" style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.9)); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 12px; padding: 20px; margin-bottom: 18px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="background:#2563eb; color:#fff; font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px; text-transform:uppercase;">Scheduled Notice</span>
        <span style="font-size:12px; color:#94a3b8;">Active until 5:00 PM</span>
      </div>
      <h4 style="margin:0 0 6px 0; color:#f8fafc; font-size:16px;">🚀 Annual Tech Career Fair 2026</h4>
      <p style="margin:0; color:#cbd5e1; font-size:13.5px; line-height:1.5;">Over 45 industry partners will be on campus today in the Main Auditorium. Bring printed resumes and student ID cards.</p>
    </div>
  `,
  start_at: new Date(now - 5 * 60 * 1000).toISOString(),
  end_at: new Date(now + 60 * 60 * 1000).toISOString()
});

console.log('[Seed] Database seeded with site "apex-university" and 2 active cues.');
