/**
 * Chronicle Management Dashboard Logic
 * Fully integrated with website connection tracking, SDK verification,
 * server-side authentication, origin validation, and persistent storage.
 */
(function () {
  'use strict';

  const API_BASE = '/api/v1';

  // State
  let sites = [];
  let currentSiteId = 'apex-university';
  let allCues = [];
  let currentFilter = 'all';
  let serverTimeDrift = 0; // serverMs - clientMs
  let isEditingCue = false;
  let serverPublicUrl = null;
  let authRequired = false;
  let isAuthenticated = false;

  // DOM Elements - Navigation & Header
  const siteSelect = document.getElementById('site-select');
  const serverClockVal = document.getElementById('server-clock-val');
  const btnAuthAction = document.getElementById('btn-auth-action');
  const authAlertBanner = document.getElementById('auth-alert-banner');
  const btnBannerLogin = document.getElementById('btn-banner-login');
  const linkDemoSite = document.getElementById('link-demo-site');

  // DOM Elements - Summary Metrics
  const metricConnectedSites = document.getElementById('metric-connected-sites');
  const metricTotalSites = document.getElementById('metric-total-sites');
  const metricActiveCues = document.getElementById('metric-active-cues');
  const metricScheduledCues = document.getElementById('metric-scheduled-cues');
  const metricExpiredCues = document.getElementById('metric-expired-cues');

  // DOM Elements - Active Site & Integration Overview
  const currentSiteNameEl = document.getElementById('current-site-name');
  const currentSiteIdBadge = document.getElementById('current-site-id-badge');
  const currentSiteDomainEl = document.getElementById('current-site-domain');
  const siteConnStatusBadge = document.getElementById('site-conn-status-badge');
  const currentSiteKeyDisplay = document.getElementById('current-site-key-display');
  const currentSiteHeartbeat = document.getElementById('current-site-heartbeat');
  const embedCodeText = document.getElementById('embed-code-text');
  const btnCopyEmbed = document.getElementById('btn-copy-embed');
  const btnViewIntegration = document.getElementById('btn-view-integration');
  const btnTestIntegrationQuick = document.getElementById('btn-test-integration-quick');

  // Filter tabs
  const filterTabs = document.querySelectorAll('.filter-tab');
  const countAll = document.getElementById('count-all');
  const countActive = document.getElementById('count-active');
  const countUpcoming = document.getElementById('count-upcoming');
  const countExpired = document.getElementById('count-expired');
  const countPaused = document.getElementById('count-paused');

  // Cues Listing
  const cuesContainer = document.getElementById('cues-container');
  const emptyState = document.getElementById('empty-state');

  // Cue Form & Modal
  const modalCue = document.getElementById('modal-cue');
  const formCue = document.getElementById('form-cue');
  const modalCueTitle = document.getElementById('modal-cue-title');
  const modalTargetSiteName = document.getElementById('modal-target-site-name');
  const modalTargetSiteId = document.getElementById('modal-target-site-id');
  const cueIdInput = document.getElementById('cue-id');
  const cueTitleInput = document.getElementById('cue-input-title');
  const cuePlacementInput = document.getElementById('cue-input-placement');
  const selectorGroup = document.getElementById('selector-group');
  const cueSelectorInput = document.getElementById('cue-input-selector');
  const actionGroup = document.getElementById('action-group');
  const cueActionInput = document.getElementById('cue-input-action');
  const cueHtmlInput = document.getElementById('cue-input-html');
  const cueCssInput = document.getElementById('cue-input-css');
  const cueStartInput = document.getElementById('cue-input-start');
  const cueEndInput = document.getElementById('cue-input-end');
  const modalPreviewBox = document.getElementById('modal-preview-box');

  // Website Integration Modal Elements
  const modalIntegration = document.getElementById('modal-integration');
  const intgSiteName = document.getElementById('intg-site-name');
  const intgSiteDomain = document.getElementById('intg-site-domain');
  const intgStatusBadge = document.getElementById('intg-status-badge');
  const intgSiteId = document.getElementById('intg-site-id');
  const intgSiteKey = document.getElementById('intg-site-key');
  const intgSdkVersion = document.getElementById('intg-sdk-version');
  const intgLastSeen = document.getElementById('intg-last-seen');
  const intgEmbedCode = document.getElementById('intg-embed-code');
  const btnCopyIntgCode = document.getElementById('btn-copy-intg-code');
  const btnTestIntegrationFromModal = document.getElementById('btn-test-integration-from-modal');

  // Test Integration Modal Elements
  const modalTestIntegration = document.getElementById('modal-test-integration');
  const testChecklistContainer = document.getElementById('test-checklist-container');
  const testSummaryMessage = document.getElementById('test-summary-message');
  const btnRetestIntegration = document.getElementById('btn-retest-integration');

  // Audit Feed Elements
  const auditFeedList = document.getElementById('audit-feed-list');
  const btnRefreshAudit = document.getElementById('btn-refresh-audit');

  // Site Modal
  const modalSite = document.getElementById('modal-site');
  const formSite = document.getElementById('form-site');

  // Preview Modal
  const modalPreview = document.getElementById('modal-preview');
  const fullPreviewContainer = document.getElementById('full-preview-container');

  // Auth Modal
  const modalAuth = document.getElementById('modal-auth');
  const formAuth = document.getElementById('form-auth');
  const authInputKey = document.getElementById('auth-input-key');
  const authErrorMsg = document.getElementById('auth-error-msg');

  /**
   * Secure fetch wrapper: automatically passes ephemeral session token from sessionStorage
   */
  async function apiFetch(url, options = {}) {
    const headers = options.headers || {};
    const token = sessionStorage.getItem('chronicle_admin_token');

    if (token) {
      headers['x-chronicle-admin-token'] = token;
    }

    const response = await fetch(url, { ...options, headers });

    // Handle 401 Unauthorized
    if (response.status === 401 && authRequired) {
      sessionStorage.removeItem('chronicle_admin_token');
      isAuthenticated = false;
      updateAuthUI();
      openModal('modal-auth');
    }

    return response;
  }

  /**
   * Initialize Dashboard
   */
  async function init() {
    if (cueStartInput) cueStartInput.setAttribute('step', '1');
    if (cueEndInput) cueEndInput.setAttribute('step', '1');

    setupEventListeners();
    await fetchServerConfig();
    await checkAuthStatus();
    await loadSites();
    await loadAuditLogs();
    startClockSync();

    // Auto-refresh site status & cues every 10 seconds to detect new heartbeats
    setInterval(async () => {
      await refreshCurrentSiteStatus();
    }, 10000);
  }

  /**
   * Fetch server config (public URL & clock sync)
   */
  async function fetchServerConfig() {
    try {
      const res = await fetch('/api/v1/config');
      if (res.ok) {
        const data = await res.json();
        serverPublicUrl = data.publicUrl;
        authRequired = Boolean(data.authRequired);
        if (data.serverTime) {
          const serverMs = new Date(data.serverTime).getTime();
          serverTimeDrift = serverMs - Date.now();
        }
      }
    } catch (e) {
      console.warn('Config fetch error:', e);
    }
  }

  /**
   * Check Auth Status
   */
  async function checkAuthStatus() {
    try {
      const res = await apiFetch(`${API_BASE}/auth/status`);
      if (res.ok) {
        const data = await res.json();
        authRequired = data.authRequired;
        isAuthenticated = data.authenticated;
        updateAuthUI();
      }
    } catch (e) {
      console.warn('Auth status check error:', e);
    }
  }

  function updateAuthUI() {
    if (authAlertBanner) {
      authAlertBanner.style.display = (authRequired && !isAuthenticated) ? 'flex' : 'none';
    }
    if (!btnAuthAction) return;

    if (!authRequired) {
      btnAuthAction.style.display = 'inline-flex';
      btnAuthAction.textContent = '🔓 Open Dev Mode';
      btnAuthAction.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      btnAuthAction.style.color = '#34d399';
      btnAuthAction.title = 'Authentication is not configured on the server. Access is open.';
    } else if (isAuthenticated) {
      btnAuthAction.style.display = 'inline-flex';
      btnAuthAction.textContent = '🔒 Logged In (Logout)';
      btnAuthAction.style.borderColor = 'rgba(59, 130, 246, 0.4)';
      btnAuthAction.style.color = '#93c5fd';
      btnAuthAction.title = 'Click to log out and clear the session token.';
    } else {
      btnAuthAction.style.display = 'inline-flex';
      btnAuthAction.textContent = '🔑 Admin Login';
      btnAuthAction.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      btnAuthAction.style.color = '#fca5a5';
      btnAuthAction.title = 'Admin API Key required. Click to authenticate.';
    }
  }

  function getServerNow() {
    return new Date(Date.now() + serverTimeDrift);
  }

  function startClockSync() {
    setInterval(() => {
      const now = getServerNow();
      serverClockVal.textContent = now.toTimeString().split(' ')[0] + ' UTC';
      updateTimeRemainingCounters();
    }, 1000);
  }

  /**
   * Helper: Relative time formatter ("12s ago", "3m ago", "1h ago")
   */
  function formatRelativeTime(isoString) {
    if (!isoString) return 'Never';
    const pastMs = new Date(isoString).getTime();
    const nowMs = getServerNow().getTime();
    const diffSec = Math.max(0, Math.floor((nowMs - pastMs) / 1000));

    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  /**
   * Helper: Checks if heartbeat timestamp was within the last 5 minutes
   */
  function isSiteConnected(lastSeenAt) {
    if (!lastSeenAt) return false;
    const pastMs = new Date(lastSeenAt).getTime();
    const nowMs = getServerNow().getTime();
    return (nowMs - pastMs) <= (5 * 60 * 1000);
  }

  /**
   * Load Registered Sites
   */
  async function loadSites() {
    try {
      const res = await apiFetch(`${API_BASE}/sites`);
      if (res.status === 401) return;
      const data = await res.json();
      sites = data.sites || [];

      // If no sites exist and in dev mode, register default demo site
      if (sites.length === 0 && !authRequired) {
        const defaultSite = await registerSite({
          id: 'apex-university',
          name: 'Apex Institute of Technology',
          domain: 'http://localhost:3001'
        });
        if (defaultSite) sites = [defaultSite];
      }

      siteSelect.innerHTML = '';
      sites.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        const connDot = isSiteConnected(s.last_seen_at) ? '🟢' : '⚪';
        opt.textContent = `${connDot} ${s.name} (${s.id})`;
        siteSelect.appendChild(opt);
      });

      if (sites.length > 0) {
        if (!sites.some(s => s.id === currentSiteId)) {
          currentSiteId = sites[0].id;
        }
        siteSelect.value = currentSiteId;
        updateSiteDetails();
        await loadCues();
      } else {
        currentSiteNameEl.textContent = 'No Registered Websites';
        currentSiteIdBadge.textContent = 'none';
        currentSiteDomainEl.textContent = 'Register a website to connect Chronicle SDK';
        embedCodeText.textContent = 'Register a website to generate SDK embed code.';
        allCues = [];
        renderCues();
      }

      updateSummaryMetrics();
    } catch (err) {
      console.error('Failed to load sites:', err);
    }
  }

  /**
   * Refresh Current Site Status (Heartbeat & Metadata)
   */
  async function refreshCurrentSiteStatus() {
    try {
      const res = await apiFetch(`${API_BASE}/sites/${currentSiteId}`);
      if (!res.ok) return;
      const data = await res.json();
      const updatedSite = data.site;

      // Update in local cache
      const idx = sites.findIndex(s => s.id === updatedSite.id);
      if (idx !== -1) {
        sites[idx] = updatedSite;
      }

      updateSiteDetails();
      updateSummaryMetrics();
    } catch (e) {
      // quiet fail on polling
    }
  }

  /**
   * Update Site Details in Dashboard View
   */
  function updateSiteDetails() {
    const site = sites.find(s => s.id === currentSiteId);
    if (!site) return;

    currentSiteNameEl.textContent = site.name;
    currentSiteIdBadge.textContent = site.id;
    currentSiteDomainEl.textContent = `Target origin: ${site.domain || 'All origins'}`;

    // Target Website in Cue Modal
    if (modalTargetSiteName) modalTargetSiteName.textContent = site.name;
    if (modalTargetSiteId) modalTargetSiteId.textContent = `(${site.id})`;

    // Connection badge & heartbeat
    const connected = isSiteConnected(site.last_seen_at);
    if (connected) {
      siteConnStatusBadge.className = 'connection-pill status-connected';
      siteConnStatusBadge.innerHTML = '🟢 Connected';
      currentSiteHeartbeat.innerHTML = `SDK v${site.sdk_version || '1.1.0'} active • Heartbeat: ${formatRelativeTime(site.last_seen_at)}`;
      currentSiteHeartbeat.style.color = '#34d399';
    } else {
      siteConnStatusBadge.className = 'connection-pill status-disconnected';
      siteConnStatusBadge.innerHTML = '⚪ Not Connected';
      currentSiteHeartbeat.innerHTML = site.last_seen_at
        ? `Last seen: ${formatRelativeTime(site.last_seen_at)}`
        : 'Last Heartbeat: Never received';
      currentSiteHeartbeat.style.color = '#94a3b8';
    }

    const siteKey = site.site_key || site.id;
    currentSiteKeyDisplay.textContent = `Key: ${siteKey.length > 18 ? siteKey.substring(0, 18) + '...' : siteKey}`;
    currentSiteKeyDisplay.title = siteKey;

    if (linkDemoSite) {
      linkDemoSite.href = '/demo';
    }

    // Embed Snippet with dynamic host URL
    const baseUrl = serverPublicUrl || window.location.origin;
    const snippet = `<script src="${baseUrl}/chronicle.js" data-site-key="${siteKey}"></script>`;
    embedCodeText.textContent = snippet;
  }

  /**
   * Update Summary Metrics Cards (Requirement 11)
   */
  function updateSummaryMetrics() {
    const totalSites = sites.length;
    const connectedCount = sites.filter(s => isSiteConnected(s.last_seen_at)).length;

    if (metricConnectedSites) metricConnectedSites.textContent = connectedCount;
    if (metricTotalSites) metricTotalSites.textContent = `/ ${totalSites} total`;

    const nowIso = getServerNow().toISOString();
    let active = 0, upcoming = 0, expired = 0, paused = 0;

    allCues.forEach(cue => {
      if (cue.is_active === 0) {
        paused++;
      } else if (cue.start_at <= nowIso && cue.end_at > nowIso) {
        active++;
      } else if (cue.start_at > nowIso) {
        upcoming++;
      } else {
        expired++;
      }
    });

    if (metricActiveCues) metricActiveCues.textContent = active;
    if (metricScheduledCues) metricScheduledCues.textContent = upcoming;
    if (metricExpiredCues) metricExpiredCues.textContent = expired;
  }

  /**
   * Load Cues for Current Site
   */
  async function loadCues() {
    try {
      const res = await apiFetch(`${API_BASE}/cues/all?siteKey=${encodeURIComponent(currentSiteId)}`);
      if (res.status === 401) return;
      if (!res.ok) throw new Error('Failed to fetch cues');
      const data = await res.json();
      allCues = data.cues || [];
      updateCounts();
      renderCues();
      updateSummaryMetrics();
    } catch (err) {
      console.error('Failed to load cues:', err);
      allCues = [];
      renderCues();
      updateSummaryMetrics();
    }
  }

  function updateCounts() {
    const nowIso = getServerNow().toISOString();
    let active = 0, upcoming = 0, expired = 0, paused = 0;

    allCues.forEach(cue => {
      if (cue.is_active === 0) {
        paused++;
      } else if (cue.start_at <= nowIso && cue.end_at > nowIso) {
        active++;
      } else if (cue.start_at > nowIso) {
        upcoming++;
      } else {
        expired++;
      }
    });

    countAll.textContent = allCues.length;
    countActive.textContent = active;
    countUpcoming.textContent = upcoming;
    countExpired.textContent = expired;
    countPaused.textContent = paused;
  }

  function renderCues() {
    const nowIso = getServerNow().toISOString();
    const filtered = allCues.filter(cue => {
      let status = 'expired';
      if (cue.is_active === 0) status = 'paused';
      else if (cue.start_at <= nowIso && cue.end_at > nowIso) status = 'active';
      else if (cue.start_at > nowIso) status = 'upcoming';

      if (currentFilter === 'all') return true;
      return status === currentFilter;
    });

    if (filtered.length === 0) {
      cuesContainer.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    cuesContainer.innerHTML = '';

    filtered.forEach(cue => {
      const card = createCueCard(cue, nowIso);
      cuesContainer.appendChild(card);
    });
  }

  /**
   * Create Cue Card with Enhanced Lifecycle Visibility (Requirement 5)
   */
  function createCueCard(cue, nowIso) {
    const card = document.createElement('div');
    card.className = 'cue-card';
    card.id = `card-${cue.id}`;

    let status = 'expired';
    let statusLabel = 'Expired';
    let statusClass = 'status-expired';

    if (cue.is_active === 0) {
      status = 'paused';
      statusLabel = 'Disabled';
      statusClass = 'status-paused';
    } else if (cue.start_at <= nowIso && cue.end_at > nowIso) {
      status = 'active';
      statusLabel = 'Active Now';
      statusClass = 'status-active';
    } else if (cue.start_at > nowIso) {
      status = 'upcoming';
      statusLabel = 'Scheduled';
      statusClass = 'status-upcoming';
    }

    const placementLabel = cue.placement_type === 'top_banner'
      ? 'Top Banner'
      : `Target: ${cue.target_selector || '#notice-board'} (${cue.action || 'append'})`;

    const startLocal = new Date(cue.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + new Date(cue.start_at).toLocaleDateString();
    const endLocal = new Date(cue.end_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + new Date(cue.end_at).toLocaleDateString();

    card.innerHTML = `
      <div class="cue-card-top">
        <div class="cue-title-area">
          <span class="status-pill ${statusClass}">${statusLabel}</span>
          <h3 class="cue-title">${escapeHtml(cue.title)}</h3>
          <span class="placement-tag">${escapeHtml(placementLabel)}</span>
        </div>
        <div class="cue-actions">
          <button class="btn btn-secondary btn-sm btn-preview-cue" data-id="${cue.id}">👁️ Preview</button>
          <button class="btn btn-secondary btn-sm btn-edit-cue" data-id="${cue.id}">✏️ Edit</button>
          <button class="btn btn-secondary btn-sm btn-toggle-cue" data-id="${cue.id}" data-active="${cue.is_active}">
            ${cue.is_active ? '⏸️ Disable' : '▶️ Enable'}
          </button>
          <button class="btn btn-danger btn-sm btn-delete-cue" data-id="${cue.id}">🗑️</button>
        </div>
      </div>

      <div class="cue-body">
        <div class="cue-timing-info">
          <div class="timing-item">
            <span class="timing-label">Start Time</span>
            <span class="timing-val">${startLocal}</span>
          </div>
          <div class="timing-item">
            <span class="timing-label">Expiry Time</span>
            <span class="timing-val">${endLocal}</span>
          </div>
          <div class="timing-item">
            <span class="timing-label">Lifecycle Status</span>
            <span class="timing-val time-countdown" data-start="${cue.start_at}" data-end="${cue.end_at}" data-active="${cue.is_active}">
              Calculating...
            </span>
          </div>
        </div>
      </div>
    `;

    // Attach listeners
    card.querySelector('.btn-preview-cue').addEventListener('click', () => openPreviewModal(cue));
    card.querySelector('.btn-edit-cue').addEventListener('click', () => openEditCueModal(cue));
    card.querySelector('.btn-toggle-cue').addEventListener('click', () => toggleCue(cue.id));
    card.querySelector('.btn-delete-cue').addEventListener('click', () => deleteCue(cue.id));

    return card;
  }

  /**
   * Dynamic Real-Time Countdown & Lifecycle Updates
   */
  function updateTimeRemainingCounters() {
    const nowMs = getServerNow().getTime();
    document.querySelectorAll('.time-countdown').forEach(el => {
      const isActive = el.getAttribute('data-active') === '1';
      if (!isActive) {
        el.textContent = '⏸️ Disabled / Paused';
        el.style.color = '#f59e0b';
        return;
      }

      const startMs = new Date(el.getAttribute('data-start')).getTime();
      const endMs = new Date(el.getAttribute('data-end')).getTime();

      if (endMs <= nowMs) {
        const expiredSecAgo = Math.floor((nowMs - endMs) / 1000);
        el.textContent = `Expired ${formatDuration(expiredSecAgo)} ago`;
        el.style.color = '#94a3b8';
      } else if (startMs <= nowMs && endMs > nowMs) {
        const activeDurationSec = Math.floor((nowMs - startMs) / 1000);
        const remainingSec = Math.floor((endMs - nowMs) / 1000);
        el.textContent = `🟢 Active for ${formatDuration(activeDurationSec)} • Ends in ${formatDuration(remainingSec)}`;
        el.style.color = '#34d399';
      } else {
        const untilStartSec = Math.floor((startMs - nowMs) / 1000);
        el.textContent = `🔵 Starts in ${formatDuration(untilStartSec)}`;
        el.style.color = '#60a5fa';
      }
    });
  }

  function formatDuration(totalSeconds) {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
  }

  /**
   * Modal Handlers: Create / Edit Cue (Requirement 4)
   */
  function openCreateCueModal() {
    if (authRequired && !isAuthenticated) {
      openModal('modal-auth');
      return;
    }
    isEditingCue = false;
    modalCueTitle.textContent = 'Schedule Timed Content';
    cueIdInput.value = '';
    cueTitleInput.value = '';
    cuePlacementInput.value = 'selector';
    selectorGroup.style.display = 'block';
    actionGroup.style.display = 'block';
    cueSelectorInput.value = '#notice-board';
    cueActionInput.value = 'append';
    cueHtmlInput.value = '<div style="background:linear-gradient(135deg, #1e3a8a, #1e1b4b); color:#fff; padding:16px; border-radius:10px; border:1px solid rgba(99,102,241,0.4);"><h3 style="margin-bottom:6px; font-size:1.1rem; color:#93c5fd;">⚡ Flash Announcement</h3><p style="margin:0; font-size:0.9rem;">Limited Time Offer — 30% OFF all certifications this week!</p></div>';
    cueCssInput.value = '';

    // Default: 1-minute quick test demo
    setFormTimingPreset(10, 70);
    updateModalPreview();

    const site = sites.find(s => s.id === currentSiteId);
    if (site) {
      if (modalTargetSiteName) modalTargetSiteName.textContent = site.name;
      if (modalTargetSiteId) modalTargetSiteId.textContent = `(${site.id})`;
    }

    openModal('modal-cue');
  }

  function openEditCueModal(cue) {
    isEditingCue = true;
    modalCueTitle.textContent = 'Edit Content Cue';
    cueIdInput.value = cue.id;
    cueTitleInput.value = cue.title;
    cuePlacementInput.value = cue.placement_type;

    if (cue.placement_type === 'selector') {
      selectorGroup.style.display = 'block';
      actionGroup.style.display = 'block';
      cueSelectorInput.value = cue.target_selector || '#notice-board';
      cueActionInput.value = cue.action || 'append';
    } else {
      selectorGroup.style.display = 'none';
      actionGroup.style.display = 'none';
    }

    cueHtmlInput.value = cue.content_html;
    cueCssInput.value = cue.css_styles || '';

    cueStartInput.value = isoToLocalDatetime(cue.start_at);
    cueEndInput.value = isoToLocalDatetime(cue.end_at);

    updateModalPreview();
    openModal('modal-cue');
  }

  function updateModalPreview() {
    const html = cueHtmlInput.value.trim();
    const css = cueCssInput.value.trim();

    if (!html) {
      modalPreviewBox.innerHTML = '<em style="color:#64748b; font-size:0.85rem;">Type content above to see live preview...</em>';
      return;
    }

    modalPreviewBox.innerHTML = `
      <style>${css}</style>
      <div class="chronicle-preview-render">${html}</div>
    `;
  }

  function setFormTimingPreset(startOffsetSec, durationSec) {
    const now = getServerNow();
    const startMs = now.getTime() + (startOffsetSec * 1000);
    const endMs = startMs + (durationSec * 1000);

    if (cueStartInput) cueStartInput.setAttribute('step', 'any');
    if (cueEndInput) cueEndInput.setAttribute('step', 'any');

    cueStartInput.value = isoToLocalDatetime(new Date(startMs).toISOString());
    cueEndInput.value = isoToLocalDatetime(new Date(endMs).toISOString());
  }

  function isoToLocalDatetime(isoStr) {
    const d = new Date(isoStr);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function localDatetimeToIso(localStr) {
    if (!localStr) return null;
    const d = new Date(localStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  /**
   * Validation Helper: CSS Selector Format
   */
  function isValidCssSelector(selector) {
    if (!selector || typeof selector !== 'string') return true;
    const trimmed = selector.trim();
    if (trimmed.length === 0) return true;
    if (/[<>{};"']/.test(trimmed)) return false;
    return /^[a-zA-Z0-9_\-\.\#\:\s\[\]\=\^\$\*\~\|\,\>\+\(\)]+$/.test(trimmed);
  }

  /**
   * Handle Cue Form Submit with Strict Validation
   */
  async function handleCueSubmit(e) {
    e.preventDefault();

    const btnSaveCue = document.getElementById('btn-save-cue');
    const title = cueTitleInput.value.trim();
    const placementType = cuePlacementInput.value;
    const targetSelector = cueSelectorInput.value.trim();
    const action = cueActionInput.value;
    const contentHtml = cueHtmlInput.value.trim();
    const cssStyles = cueCssInput.value.trim();
    const startAt = localDatetimeToIso(cueStartInput.value);
    const endAt = localDatetimeToIso(cueEndInput.value);

    // Validation 1: Required fields & valid dates
    if (!title || !contentHtml || !startAt || !endAt) {
      alert('Please fill in all required fields (Title, Content, Start Time, Expiry Time).');
      return;
    }

    // Validation 2: Timing
    if (new Date(startAt).getTime() >= new Date(endAt).getTime()) {
      alert('Start time must be strictly before expiry time.');
      return;
    }

    // Validation 3: Target selector
    if (placementType === 'selector') {
      if (!targetSelector) {
        alert('Please specify a target CSS selector (e.g. #notice-board).');
        return;
      }
      if (!isValidCssSelector(targetSelector)) {
        alert('Invalid target CSS selector format. Please use standard selector notation (e.g. #notice-board, .announcement-card).');
        return;
      }
    }

    const payload = {
      site_id: currentSiteId,
      title,
      placement_type: placementType,
      target_selector: placementType === 'selector' ? targetSelector : '',
      action: placementType === 'selector' ? action : 'prepend',
      content_html: contentHtml,
      css_styles: cssStyles,
      start_at: startAt,
      end_at: endAt
    };

    if (btnSaveCue) {
      btnSaveCue.disabled = true;
      btnSaveCue.textContent = 'Saving...';
    }

    try {
      let res;
      if (isEditingCue) {
        const id = cueIdInput.value;
        res = await apiFetch(`${API_BASE}/cues/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await apiFetch(`${API_BASE}/cues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save cue');
      }

      closeModal('modal-cue');
      await loadCues();
      await loadAuditLogs();
    } catch (err) {
      alert(`Error scheduling cue: ${err.message}`);
    } finally {
      if (btnSaveCue) {
        btnSaveCue.disabled = false;
        btnSaveCue.textContent = 'Save & Schedule Cue';
      }
    }
  }

  /**
   * Toggle Cue Active State
   */
  async function toggleCue(id) {
    try {
      const res = await apiFetch(`${API_BASE}/cues/${id}/toggle`, { method: 'PATCH' });
      if (res.ok) {
        await loadCues();
        await loadAuditLogs();
      }
    } catch (e) {
      console.error('Failed to toggle cue:', e);
    }
  }

  /**
   * Delete Cue
   */
  async function deleteCue(id) {
    if (!confirm('Are you sure you want to permanently delete this cue?')) return;
    try {
      const res = await apiFetch(`${API_BASE}/cues/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await loadCues();
        await loadAuditLogs();
      }
    } catch (e) {
      console.error('Failed to delete cue:', e);
    }
  }

  /**
   * Open Dedicated Website Integration Page Modal (Requirements 1 & 2)
   */
  function openWebsiteIntegrationModal() {
    const site = sites.find(s => s.id === currentSiteId);
    if (!site) return;

    intgSiteName.textContent = site.name;
    intgSiteDomain.textContent = site.domain ? `Target origin: ${site.domain}` : 'Target origin: Open to all origins';
    intgSiteId.textContent = site.id;

    const siteKey = site.site_key || site.id;
    intgSiteKey.textContent = siteKey;
    intgSdkVersion.textContent = site.sdk_version ? `v${site.sdk_version}` : 'v1.1.0';

    const connected = isSiteConnected(site.last_seen_at);
    if (connected) {
      intgStatusBadge.className = 'connection-pill status-connected';
      intgStatusBadge.innerHTML = '🟢 Connected';
      intgLastSeen.textContent = `${formatRelativeTime(site.last_seen_at)} (${new Date(site.last_seen_at).toLocaleTimeString()})`;
      intgLastSeen.style.color = '#34d399';
    } else {
      intgStatusBadge.className = 'connection-pill status-disconnected';
      intgStatusBadge.innerHTML = '⚪ Not Connected';
      intgLastSeen.textContent = site.last_seen_at
        ? `${formatRelativeTime(site.last_seen_at)} (${new Date(site.last_seen_at).toLocaleTimeString()})`
        : 'Never contacted';
      intgLastSeen.style.color = '#94a3b8';
    }

    const baseUrl = serverPublicUrl || window.location.origin;
    const snippet = `<script\n  src="${baseUrl}/chronicle.js"\n  data-site-key="${siteKey}">\n</script>`;
    intgEmbedCode.textContent = snippet;

    openModal('modal-integration');
  }

  /**
   * Run End-to-End Test Integration (Requirement 10)
   */
  async function runTestIntegration() {
    openModal('modal-test-integration');
    testSummaryMessage.style.display = 'none';

    testChecklistContainer.innerHTML = `
      <div class="checklist-item">
        <span class="check-icon">⏳</span>
        <div class="check-info">
          <strong>Running verification pipeline...</strong>
          <p>Querying site credentials, domain authorization, SDK heartbeat, and queue status</p>
        </div>
      </div>
    `;

    try {
      const res = await apiFetch(`${API_BASE}/sites/${currentSiteId}/test-integration`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Test integration API call failed');
      }

      const data = await res.json();
      renderTestChecklist(data);

      // Refresh site status in background
      await refreshCurrentSiteStatus();
    } catch (err) {
      testChecklistContainer.innerHTML = `
        <div class="checklist-item fail">
          <span class="check-icon">❌</span>
          <div class="check-info">
            <strong>Verification Request Failed</strong>
            <p>${escapeHtml(err.message)}</p>
          </div>
        </div>
      `;
      testSummaryMessage.className = 'test-summary-box error';
      testSummaryMessage.innerHTML = `<strong>Verification Incomplete:</strong> ${escapeHtml(err.message)}`;
      testSummaryMessage.style.display = 'block';
    }
  }

  function renderTestChecklist(data) {
    testChecklistContainer.innerHTML = '';
    const checks = data.checks || [];

    checks.forEach(check => {
      const item = document.createElement('div');
      let statusClass = check.passed ? 'pass' : (check.warning ? 'warning' : 'fail');
      let icon = check.passed ? '✓' : (check.warning ? '⚠️' : '✗');

      item.className = `checklist-item ${statusClass}`;
      item.innerHTML = `
        <span class="check-icon" style="font-weight:bold; font-size:1.1rem; color:${check.passed ? '#34d399' : (check.warning ? '#f59e0b' : '#ef4444')};">${icon}</span>
        <div class="check-info">
          <strong>${escapeHtml(check.title)}</strong>
          <p>${escapeHtml(check.detail)}</p>
        </div>
      `;
      testChecklistContainer.appendChild(item);
    });

    if (data.success && data.connected) {
      testSummaryMessage.className = 'test-summary-box success';
      testSummaryMessage.innerHTML = '<strong>🎉 Integration Verified:</strong> Chronicle SDK is actively communicating with this website. All scheduled cues will be delivered and removed automatically.';
      testSummaryMessage.style.display = 'block';
    } else {
      testSummaryMessage.className = 'test-summary-box error';
      testSummaryMessage.innerHTML = `
        <strong>⚠️ Action Required:</strong>
        ${!data.connected
          ? 'The Chronicle SDK embed tag has not sent a heartbeat yet. Ensure the script tag is added to your target website, and load or reload the webpage.'
          : 'One or more integration checks require attention before cues can be automatically delivered.'}
      `;
      testSummaryMessage.style.display = 'block';
    }
  }

  /**
   * Load Audit & Activity Logs (Requirement 12)
   */
  async function loadAuditLogs() {
    try {
      const res = await apiFetch(`${API_BASE}/audit-logs?limit=30`);
      if (!res.ok) return;
      const data = await res.json();
      const logs = data.logs || [];

      if (logs.length === 0) {
        auditFeedList.innerHTML = '<div class="audit-empty">No activity recorded yet. Create cues or register websites to populate the audit log.</div>';
        return;
      }

      auditFeedList.innerHTML = '';
      logs.forEach(log => {
        const item = document.createElement('div');
        item.className = 'audit-item';

        const isSiteEvent = log.event_type.startsWith('site');
        const badgeClass = isSiteEvent ? 'site' : 'cue';
        const badgeText = log.event_type.replace('_', ' ');

        item.innerHTML = `
          <div class="audit-item-left">
            <span class="audit-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
            <span class="audit-details">${escapeHtml(log.details)}</span>
          </div>
          <span class="audit-time">${formatRelativeTime(log.created_at)}</span>
        `;
        auditFeedList.appendChild(item);
      });
    } catch (e) {
      console.warn('Failed to load audit logs:', e);
    }
  }

  /**
   * Register Site Handler
   */
  async function handleSiteSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('site-input-name').value.trim();
    const id = document.getElementById('site-input-id').value.trim();
    const domain = document.getElementById('site-input-domain').value.trim();

    if (!name || !id) return;

    try {
      const site = await registerSite({ id, name, domain });
      if (site) {
        closeModal('modal-site');
        document.getElementById('site-input-name').value = '';
        document.getElementById('site-input-id').value = '';
        await loadSites();
        await loadAuditLogs();

        // Automatically open the Integration Page for the new site!
        currentSiteId = site.id;
        siteSelect.value = site.id;
        updateSiteDetails();
        openWebsiteIntegrationModal();
      }
    } catch (err) {
      alert(`Failed to register website: ${err.message}`);
    }
  }

  async function registerSite(payload) {
    const res = await apiFetch(`${API_BASE}/sites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to register site');
    }
    const data = await res.json();
    return data.site;
  }

  /**
   * Handle Admin Login
   */
  async function handleAuthSubmit(e) {
    e.preventDefault();
    authErrorMsg.style.display = 'none';
    const key = authInputKey.value.trim();

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Authentication failed');
      }

      if (data.token) {
        sessionStorage.setItem('chronicle_admin_token', data.token);
      }
      isAuthenticated = true;
      updateAuthUI();
      closeModal('modal-auth');
      authInputKey.value = '';

      await loadSites();
      await loadAuditLogs();
    } catch (err) {
      authErrorMsg.textContent = err.message;
      authErrorMsg.style.display = 'block';
    }
  }

  async function handleLogout() {
    try {
      await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch (e) {}
    sessionStorage.removeItem('chronicle_admin_token');
    isAuthenticated = false;
    updateAuthUI();
    await checkAuthStatus();
    await loadSites();
  }

  /**
   * Full Preview Modal
   */
  function openPreviewModal(cue) {
    document.getElementById('preview-modal-title').textContent = `Preview: ${cue.title}`;
    fullPreviewContainer.innerHTML = `
      <style>${cue.css_styles || ''}</style>
      <div style="padding:10px;">${cue.content_html}</div>
    `;
    openModal('modal-preview');
  }

  /**
   * Modal Utilities
   */
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Event Listeners Setup
   */
  function setupEventListeners() {
    siteSelect.addEventListener('change', async (e) => {
      currentSiteId = e.target.value;
      updateSiteDetails();
      await loadCues();
    });

    btnCopyEmbed.addEventListener('click', () => {
      navigator.clipboard.writeText(embedCodeText.textContent).then(() => {
        const orig = btnCopyEmbed.textContent;
        btnCopyEmbed.textContent = 'Copied!';
        btnCopyEmbed.style.background = '#10b981';
        setTimeout(() => {
          btnCopyEmbed.textContent = orig;
          btnCopyEmbed.style.background = '';
        }, 2000);
      });
    });

    // View Website Integration Modal
    btnViewIntegration.addEventListener('click', openWebsiteIntegrationModal);
    document.getElementById('step-connect').addEventListener('click', openWebsiteIntegrationModal);

    // Quick Test Integration
    btnTestIntegrationQuick.addEventListener('click', runTestIntegration);
    btnTestIntegrationFromModal.addEventListener('click', () => {
      closeModal('modal-integration');
      runTestIntegration();
    });
    btnRetestIntegration.addEventListener('click', runTestIntegration);

    // Copy SDK Code from Integration Modal
    btnCopyIntgCode.addEventListener('click', () => {
      navigator.clipboard.writeText(intgEmbedCode.textContent).then(() => {
        const orig = btnCopyIntgCode.textContent;
        btnCopyIntgCode.textContent = 'Copied Code!';
        btnCopyIntgCode.style.background = '#10b981';
        setTimeout(() => {
          btnCopyIntgCode.textContent = orig;
          btnCopyIntgCode.style.background = '';
        }, 2000);
      });
    });

    filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.getAttribute('data-filter');
        renderCues();
      });
    });

    document.getElementById('btn-create-cue').addEventListener('click', openCreateCueModal);
    document.getElementById('btn-empty-create').addEventListener('click', openCreateCueModal);
    document.getElementById('step-cue').addEventListener('click', openCreateCueModal);

    document.getElementById('btn-add-site').addEventListener('click', () => {
      if (authRequired && !isAuthenticated) {
        openModal('modal-auth');
      } else {
        openModal('modal-site');
      }
    });

    document.getElementById('btn-refresh-cues').addEventListener('click', async () => {
      await refreshCurrentSiteStatus();
      await loadCues();
      await loadAuditLogs();
    });

    btnRefreshAudit.addEventListener('click', loadAuditLogs);

    if (btnBannerLogin) {
      btnBannerLogin.addEventListener('click', () => openModal('modal-auth'));
    }

    if (btnAuthAction) {
      btnAuthAction.addEventListener('click', () => {
        if (isAuthenticated) {
          if (confirm('Do you want to log out of the admin session?')) {
            handleLogout();
          }
        } else {
          openModal('modal-auth');
        }
      });
    }

    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeModal(btn.getAttribute('data-close-modal'));
      });
    });

    cuePlacementInput.addEventListener('change', () => {
      const isSelector = cuePlacementInput.value === 'selector';
      selectorGroup.style.display = isSelector ? 'block' : 'none';
      actionGroup.style.display = isSelector ? 'block' : 'none';
    });

    cueHtmlInput.addEventListener('input', updateModalPreview);
    cueCssInput.addEventListener('input', updateModalPreview);

    // Quick demo presets
    document.getElementById('preset-demo-1m').addEventListener('click', () => {
      setFormTimingPreset(10, 60); // Starts in 10s, ends in 70s
    });
    document.getElementById('preset-demo-3m').addEventListener('click', () => {
      setFormTimingPreset(60, 120); // Starts in 1m, ends in 3m
    });
    document.getElementById('preset-now-1h').addEventListener('click', () => {
      setFormTimingPreset(0, 3600); // Starts now, lasts 1h
    });

    formCue.addEventListener('submit', handleCueSubmit);
    formSite.addEventListener('submit', handleSiteSubmit);
    if (formAuth) {
      formAuth.addEventListener('submit', handleAuthSubmit);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
