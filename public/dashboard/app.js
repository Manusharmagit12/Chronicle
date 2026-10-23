/**
 * Chronicle Management Dashboard Logic
 * Fully integrated with server-side authentication, origin configuration, and persistent storage.
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

  // DOM Elements
  const siteSelect = document.getElementById('site-select');
  const currentSiteNameEl = document.getElementById('current-site-name');
  const currentSiteIdBadge = document.getElementById('current-site-id-badge');
  const currentSiteDomainEl = document.getElementById('current-site-domain');
  const embedCodeText = document.getElementById('embed-code-text');
  const btnCopyEmbed = document.getElementById('btn-copy-embed');
  const serverClockVal = document.getElementById('server-clock-val');
  const cuesContainer = document.getElementById('cues-container');
  const emptyState = document.getElementById('empty-state');
  const btnAuthAction = document.getElementById('btn-auth-action');
  const linkDemoSite = document.getElementById('link-demo-site');

  // Filter tabs
  const filterTabs = document.querySelectorAll('.filter-tab');
  const countAll = document.getElementById('count-all');
  const countActive = document.getElementById('count-active');
  const countUpcoming = document.getElementById('count-upcoming');
  const countExpired = document.getElementById('count-expired');
  const countPaused = document.getElementById('count-paused');

  // Cue Form & Modal
  const modalCue = document.getElementById('modal-cue');
  const formCue = document.getElementById('form-cue');
  const modalCueTitle = document.getElementById('modal-cue-title');
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
    setupEventListeners();
    await fetchServerConfig();
    await checkAuthStatus();
    await loadSites();
    startClockSync();
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
   * Load Registered Sites
   */
  async function loadSites() {
    try {
      const res = await apiFetch(`${API_BASE}/sites`);
      if (res.status === 401) {
        return; // Modal will be triggered by apiFetch
      }
      const data = await res.json();
      sites = data.sites || [];

      // If no sites exist and in dev mode, register default demo site
      if (sites.length === 0 && !authRequired) {
        const defaultSite = await registerSite({
          id: 'apex-university',
          name: 'Apex Institute of Technology',
          domain: 'http://localhost:3001'
        });
        sites = [defaultSite];
      }

      siteSelect.innerHTML = '';
      sites.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} (${s.id})`;
        siteSelect.appendChild(opt);
      });

      if (sites.length > 0) {
        if (!sites.some(s => s.id === currentSiteId)) {
          currentSiteId = sites[0].id;
        }
        siteSelect.value = currentSiteId;
        updateSiteDetails();
        await loadCues();
      }
    } catch (err) {
      console.error('Failed to load sites:', err);
    }
  }

  function updateSiteDetails() {
    const site = sites.find(s => s.id === currentSiteId);
    if (!site) return;

    currentSiteNameEl.textContent = site.name;
    currentSiteIdBadge.textContent = site.id;
    currentSiteDomainEl.textContent = `Target origin: ${site.domain || 'All origins'}`;

    if (linkDemoSite && site.domain && site.domain.startsWith('http')) {
      linkDemoSite.href = site.domain;
    }

    // Use production public URL if configured, otherwise fallback to current origin
    const baseUrl = serverPublicUrl || window.location.origin;
    const snippet = `<script src="${baseUrl}/chronicle.js" data-site-key="${site.id}"></script>`;
    embedCodeText.textContent = snippet;
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
    } catch (err) {
      console.error('Failed to load cues:', err);
      allCues = [];
      renderCues();
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

  function createCueCard(cue, nowIso) {
    const card = document.createElement('div');
    card.className = 'cue-card';
    card.id = `card-${cue.id}`;

    let status = 'expired';
    let statusLabel = 'Expired';
    let statusClass = 'status-expired';

    if (cue.is_active === 0) {
      status = 'paused';
      statusLabel = 'Paused';
      statusClass = 'status-paused';
    } else if (cue.start_at <= nowIso && cue.end_at > nowIso) {
      status = 'active';
      statusLabel = 'Active Now';
      statusClass = 'status-active';
    } else if (cue.start_at > nowIso) {
      status = 'upcoming';
      statusLabel = 'Upcoming';
      statusClass = 'status-upcoming';
    }

    const placementLabel = cue.placement_type === 'top_banner'
      ? 'Top Banner'
      : `Selector: ${cue.target_selector} (${cue.action || 'prepend'})`;

    const startLocal = new Date(cue.start_at).toLocaleString();
    const endLocal = new Date(cue.end_at).toLocaleString();

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
            ${cue.is_active ? '⏸️ Pause' : '▶️ Resume'}
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
            <span class="timing-label">Live Status</span>
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

  function updateTimeRemainingCounters() {
    const nowMs = getServerNow().getTime();
    document.querySelectorAll('.time-countdown').forEach(el => {
      const isActive = el.getAttribute('data-active') === '1';
      if (!isActive) {
        el.textContent = '⏸️ Paused (Canceled)';
        el.style.color = '#f59e0b';
        return;
      }

      const startMs = new Date(el.getAttribute('data-start')).getTime();
      const endMs = new Date(el.getAttribute('data-end')).getTime();

      if (endMs <= nowMs) {
        el.textContent = 'Past expiration';
        el.style.color = '#94a3b8';
      } else if (startMs <= nowMs && endMs > nowMs) {
        const remainingSec = Math.floor((endMs - nowMs) / 1000);
        el.textContent = `🟢 Expires in: ${formatDuration(remainingSec)}`;
        el.style.color = '#34d399';
      } else {
        const untilStartSec = Math.floor((startMs - nowMs) / 1000);
        el.textContent = `🔵 Starts in: ${formatDuration(untilStartSec)}`;
        el.style.color = '#60a5fa';
      }
    });
  }

  function formatDuration(totalSeconds) {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
  }

  /**
   * Modal Handlers: Create / Edit Cue
   */
  function openCreateCueModal() {
    isEditingCue = false;
    modalCueTitle.textContent = 'Schedule Timed Content';
    cueIdInput.value = '';
    cueTitleInput.value = '';
    cuePlacementInput.value = 'top_banner';
    selectorGroup.style.display = 'none';
    actionGroup.style.display = 'none';
    cueSelectorInput.value = '#notice-board';
    cueActionInput.value = 'prepend';
    cueHtmlInput.value = '';
    cueCssInput.value = '';

    setFormTimingPreset(0, 3600);
    updateModalPreview();
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
      cueActionInput.value = cue.action || 'prepend';
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
      <div>${html}</div>
    `;
  }

  function setFormTimingPreset(startOffsetSec, durationSec) {
    const serverNow = getServerNow();
    const startMs = serverNow.getTime() + (startOffsetSec * 1000);
    const endMs = startMs + (durationSec * 1000);

    cueStartInput.value = isoToLocalDatetime(new Date(startMs).toISOString());
    cueEndInput.value = isoToLocalDatetime(new Date(endMs).toISOString());
  }

  function isoToLocalDatetime(isoString) {
    const d = new Date(isoString);
    const offset = d.getTimezoneOffset() * 60000;
    const local = new Date(d.getTime() - offset);
    return local.toISOString().slice(0, 16);
  }

  function localDatetimeToIso(localString) {
    const d = new Date(localString);
    return d.toISOString();
  }

  /**
   * Save Cue (Create or Update)
   */
  async function handleCueSubmit(e) {
    e.preventDefault();

    const title = cueTitleInput.value.trim();
    const placement_type = cuePlacementInput.value;
    const target_selector = placement_type === 'selector' ? cueSelectorInput.value.trim() : '';
    const action = placement_type === 'selector' ? cueActionInput.value : 'prepend';
    const content_html = cueHtmlInput.value.trim();
    const css_styles = cueCssInput.value.trim();
    const start_at = localDatetimeToIso(cueStartInput.value);
    const end_at = localDatetimeToIso(cueEndInput.value);

    if (new Date(start_at) >= new Date(end_at)) {
      alert('Expiry time must be after Start time.');
      return;
    }

    const payload = {
      site_id: currentSiteId,
      title,
      placement_type,
      target_selector,
      action,
      content_html,
      css_styles,
      start_at,
      end_at
    };

    try {
      if (isEditingCue && cueIdInput.value) {
        const res = await apiFetch(`${API_BASE}/cues/${cueIdInput.value}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error((await res.json()).error);
      } else {
        const res = await apiFetch(`${API_BASE}/cues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error((await res.json()).error);
      }

      closeModal('modal-cue');
      await loadCues();
    } catch (err) {
      alert(`Error saving cue: ${err.message}`);
    }
  }

  /**
   * Toggle / Cancel Cue
   */
  async function toggleCue(cueId) {
    try {
      const res = await apiFetch(`${API_BASE}/cues/${cueId}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error('Toggle failed');
      await loadCues();
    } catch (err) {
      alert(`Error toggling cue: ${err.message}`);
    }
  }

  /**
   * Delete Cue
   */
  async function deleteCue(cueId) {
    if (!confirm('Are you sure you want to permanently delete this cue?')) return;
    try {
      const res = await apiFetch(`${API_BASE}/cues/${cueId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      await loadCues();
    } catch (err) {
      alert(`Error deleting cue: ${err.message}`);
    }
  }

  /**
   * Register Site
   */
  async function registerSite(siteData) {
    const res = await apiFetch(`${API_BASE}/sites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(siteData)
    });
    const data = await res.json();
    return data.site;
  }

  async function handleSiteSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('site-input-name').value.trim();
    const id = document.getElementById('site-input-id').value.trim();
    const domain = document.getElementById('site-input-domain').value.trim();

    try {
      await registerSite({ id, name, domain });
      closeModal('modal-site');
      currentSiteId = id;
      await loadSites();
    } catch (err) {
      alert(`Failed to register site: ${err.message}`);
    }
  }

  /**
   * Handle Admin Login
   */
  async function handleAuthSubmit(e) {
    e.preventDefault();
    authErrorMsg.style.display = 'none';

    const key = authInputKey.value;
    if (!key) return;

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        authErrorMsg.textContent = data.message || 'Invalid admin credentials.';
        authErrorMsg.style.display = 'block';
        return;
      }

      if (data.token) {
        sessionStorage.setItem('chronicle_admin_token', data.token);
      }

      authInputKey.value = '';
      isAuthenticated = true;
      updateAuthUI();
      closeModal('modal-auth');

      // Reload dashboard data
      await loadSites();
    } catch (err) {
      authErrorMsg.textContent = 'Authentication request failed: ' + err.message;
      authErrorMsg.style.display = 'block';
    }
  }

  /**
   * Handle Logout
   */
  async function handleLogout() {
    try {
      await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch (e) {}
    sessionStorage.removeItem('chronicle_admin_token');
    isAuthenticated = false;
    updateAuthUI();
    window.location.reload();
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
    document.getElementById('btn-add-site').addEventListener('click', () => openModal('modal-site'));
    document.getElementById('btn-refresh-cues').addEventListener('click', loadCues);

    // Auth action button
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

    document.getElementById('preset-10s').addEventListener('click', () => {
      setFormTimingPreset(10, 30);
    });
    document.getElementById('preset-now-1h').addEventListener('click', () => {
      setFormTimingPreset(0, 3600);
    });
    document.getElementById('preset-tomorrow').addEventListener('click', () => {
      const now = getServerNow();
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
      const startMs = tomorrow.getTime();
      const endMs = startMs + (5 * 24 * 3600 * 1000);
      cueStartInput.value = isoToLocalDatetime(new Date(startMs).toISOString());
      cueEndInput.value = isoToLocalDatetime(new Date(endMs).toISOString());
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
