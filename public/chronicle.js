/**
 * Chronicle Client SDK — Content, On Cue
 * Lightweight embed script to schedule, inject, update, and remove dynamic content
 * at precise times without page reloads.
 */
(function (window, document) {
  'use strict';

  // Prevent multiple initializations
  if (window.__ChronicleInitialized) return;
  window.__ChronicleInitialized = true;

  // Identify the embed script tag and config
  const currentScript =
    document.currentScript ||
    document.querySelector('script[data-site-key]') ||
    document.querySelector('script[src*="chronicle.js"]');

  if (!currentScript) {
    console.warn('[Chronicle] Script element could not be detected.');
    return;
  }

  const siteKey = currentScript.getAttribute('data-site-key');
  let apiUrl = currentScript.getAttribute('data-api-url');

  if (!apiUrl) {
    try {
      const scriptUrl = new URL(currentScript.src, window.location.href);
      apiUrl = scriptUrl.origin;
    } catch (e) {
      apiUrl = 'http://localhost:3000';
    }
  }

  if (!siteKey) {
    console.error('[Chronicle] Missing required data-site-key attribute on script tag.');
    return;
  }

  const pollAttr = currentScript.getAttribute('data-poll-interval');
  const pollIntervalMs = pollAttr ? parseInt(pollAttr, 10) : 4000;

  // Internal state
  const state = {
    siteKey,
    apiUrl: apiUrl.replace(/\/+$/, ''),
    clockDrift: 0, // serverTime - localClientTime
    cues: [],
    renderedCues: new Map(), // cueId -> { element, cue, originalContent }
    scheduledTimers: new Map(), // cueId -> [timerIds...]
    pollTimer: null,
    pollIntervalMs
  };

  /**
   * Calculate adjusted current server timestamp in ms
   */
  function getCurrentServerMs() {
    return Date.now() + state.clockDrift;
  }

  /**
   * Fetch active and upcoming cues from the Delivery API
   */
  async function fetchCues() {
    try {
      const url = `${state.apiUrl}/api/v1/cues?siteKey=${encodeURIComponent(state.siteKey)}&path=${encodeURIComponent(window.location.pathname)}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Synchronize clock drift with server time
      if (data.serverTime) {
        const serverMs = new Date(data.serverTime).getTime();
        state.clockDrift = serverMs - Date.now();
      }

      state.cues = data.cues || [];

      // Process and schedule all cues
      evaluateAndScheduleCues();

      // Dispatch sync event for host page or inspectors
      window.dispatchEvent(
        new CustomEvent('chronicle:synced', {
          detail: {
            serverTime: new Date(getCurrentServerMs()).toISOString(),
            cues: state.cues
          }
        })
      );
    } catch (err) {
      console.warn('[Chronicle] Failed to sync cues:', err.message);
    }
  }

  /**
   * Clear all pending setTimeout timers for a specific cue
   */
  function clearCueTimers(cueId) {
    if (state.scheduledTimers.has(cueId)) {
      const timerList = state.scheduledTimers.get(cueId);
      timerList.forEach(id => clearTimeout(id));
      state.scheduledTimers.delete(cueId);
    }
  }

  function registerCueTimer(cueId, timerId) {
    if (!state.scheduledTimers.has(cueId)) {
      state.scheduledTimers.set(cueId, []);
    }
    state.scheduledTimers.get(cueId).push(timerId);
  }

  /**
   * Evaluates all fetched cues and schedules their appearance/disappearance
   */
  function evaluateAndScheduleCues() {
    const currentMs = getCurrentServerMs();
    const fetchedCueIds = new Set(state.cues.map(c => c.id));

    // 1. Remove any cues that were deleted or disabled on the server
    for (const [renderedId] of state.renderedCues.entries()) {
      if (!fetchedCueIds.has(renderedId)) {
        removeCueFromDOM(renderedId, 'deleted');
        clearCueTimers(renderedId);
      }
    }

    // 2. Evaluate each cue
    state.cues.forEach(cue => {
      const startMs = new Date(cue.start_at).getTime();
      const endMs = new Date(cue.end_at).getTime();

      // Clear any prior pending timers for this cue to avoid duplicates
      clearCueTimers(cue.id);

      if (endMs <= currentMs) {
        // Expired
        if (state.renderedCues.has(cue.id)) {
          removeCueFromDOM(cue.id, 'expired');
        }
      } else if (startMs <= currentMs && endMs > currentMs) {
        // Currently ACTIVE
        if (!state.renderedCues.has(cue.id)) {
          mountCue(cue);
        } else {
          // If content, styling, or title changed during an edit, update in-place smoothly
          const current = state.renderedCues.get(cue.id);
          if (current) {
            current.cue = cue;
            if (cue.placement_type === 'top_banner') {
              const contentEl = current.element.querySelector('.chronicle-banner-content');
              if (contentEl && contentEl.innerHTML !== cue.content_html) {
                contentEl.innerHTML = cue.content_html;
              }
              let styleEl = current.element.querySelector('style');
              if (cue.css_styles) {
                if (!styleEl) {
                  styleEl = document.createElement('style');
                  current.element.appendChild(styleEl);
                }
                styleEl.textContent = cue.css_styles;
              } else if (styleEl) {
                styleEl.remove();
              }
            } else if (cue.placement_type === 'selector') {
              if (current.element.innerHTML !== cue.content_html) {
                current.element.innerHTML = cue.content_html;
              }
            }
          }
        }

        // Schedule disappearance timer
        const msUntilEnd = endMs - currentMs;
        const endTimer = setTimeout(() => {
          removeCueFromDOM(cue.id, 'expired');
        }, msUntilEnd);
        registerCueTimer(cue.id, endTimer);
      } else if (startMs > currentMs) {
        // UPCOMING: Do not show yet. Schedule appearance timer!
        if (state.renderedCues.has(cue.id)) {
          removeCueFromDOM(cue.id, 'reset');
        }

        const msUntilStart = startMs - currentMs;
        const startTimer = setTimeout(() => {
          mountCue(cue);

          // Once mounted, schedule the subsequent disappearance timer
          const remainingDuration = new Date(cue.end_at).getTime() - getCurrentServerMs();
          if (remainingDuration > 0) {
            const endTimer = setTimeout(() => {
              removeCueFromDOM(cue.id, 'expired');
            }, remainingDuration);
            registerCueTimer(cue.id, endTimer);
          }
        }, msUntilStart);

        registerCueTimer(cue.id, startTimer);
      }
    });
  }

  /**
   * Mounts a cue into the target DOM placement
   */
  function mountCue(cue) {
    if (state.renderedCues.has(cue.id)) return;

    // Check DOM readiness
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => mountCue(cue), { once: true });
      return;
    }

    try {
      if (cue.placement_type === 'top_banner') {
        mountTopBanner(cue);
      } else if (cue.placement_type === 'selector') {
        mountInSelector(cue);
      } else {
        console.warn('[Chronicle] Unknown placement type:', cue.placement_type);
      }
    } catch (err) {
      console.error('[Chronicle] Error mounting cue:', cue.id, err);
    }
  }

  /**
   * Top Banner Placement
   */
  function mountTopBanner(cue) {
    // Inject stylesheet once if needed
    injectChronicleStyles();

    const bannerWrapper = document.createElement('div');
    bannerWrapper.id = `chronicle-cue-${cue.id}`;
    bannerWrapper.setAttribute('data-chronicle-cue', cue.id);
    bannerWrapper.className = 'chronicle-top-banner chronicle-enter';

    bannerWrapper.innerHTML = `
      <div class="chronicle-banner-inner">
        <div class="chronicle-banner-content">${cue.content_html}</div>
        <button class="chronicle-banner-close" aria-label="Close" title="Dismiss announcement">&times;</button>
      </div>
    `;

    // Close button dismisses just for the current local session
    const closeBtn = bannerWrapper.querySelector('.chronicle-banner-close');
    closeBtn.addEventListener('click', () => {
      removeCueFromDOM(cue.id, 'dismissed');
    });

    // Custom inline CSS if specified
    if (cue.css_styles) {
      const styleEl = document.createElement('style');
      styleEl.textContent = cue.css_styles;
      bannerWrapper.appendChild(styleEl);
    }

    // Insert at the very top of document.body
    if (document.body.firstChild) {
      document.body.insertBefore(bannerWrapper, document.body.firstChild);
    } else {
      document.body.appendChild(bannerWrapper);
    }

    // Trigger smooth slide down
    requestAnimationFrame(() => {
      bannerWrapper.classList.add('chronicle-visible');
    });

    state.renderedCues.set(cue.id, {
      element: bannerWrapper,
      cue,
      originalContent: null
    });

    // Notify listeners
    window.dispatchEvent(new CustomEvent('chronicle:cue-activated', { detail: cue }));
    console.log(`[Chronicle] Cue '${cue.title}' (${cue.id}) activated and mounted.`);
  }

  /**
   * CSS Selector Placement (prepend, append, replace)
   */
  function mountInSelector(cue) {
    injectChronicleStyles();

    const targetEl = document.querySelector(cue.target_selector);
    if (!targetEl) {
      console.warn(`[Chronicle] Target selector not found: ${cue.target_selector}`);
      // Retry after a short delay in case target renders asynchronously
      setTimeout(() => {
        if (!state.renderedCues.has(cue.id)) {
          const retryEl = document.querySelector(cue.target_selector);
          if (retryEl) mountInSelector(cue);
        }
      }, 1000);
      return;
    }

    const container = document.createElement('div');
    container.id = `chronicle-cue-${cue.id}`;
    container.setAttribute('data-chronicle-cue', cue.id);
    container.className = 'chronicle-selector-cue chronicle-enter';
    container.innerHTML = cue.content_html;

    if (cue.css_styles) {
      const styleEl = document.createElement('style');
      styleEl.textContent = cue.css_styles;
      container.appendChild(styleEl);
    }

    let originalContent = null;
    const action = cue.action || 'prepend';

    if (action === 'replace') {
      originalContent = targetEl.innerHTML;
      targetEl.innerHTML = '';
      targetEl.appendChild(container);
    } else if (action === 'append') {
      targetEl.appendChild(container);
    } else {
      // default: prepend
      if (targetEl.firstChild) {
        targetEl.insertBefore(container, targetEl.firstChild);
      } else {
        targetEl.appendChild(container);
      }
    }

    // Trigger smooth fade in
    requestAnimationFrame(() => {
      container.classList.add('chronicle-visible');
    });

    state.renderedCues.set(cue.id, {
      element: container,
      cue,
      originalContent,
      targetEl
    });

    window.dispatchEvent(new CustomEvent('chronicle:cue-activated', { detail: cue }));
    console.log(`[Chronicle] Cue '${cue.title}' (${cue.id}) mounted inside ${cue.target_selector}`);
  }

  /**
   * Gracefully removes a cue with animation and restores original state if needed
   */
  function removeCueFromDOM(cueId, reason = 'expired') {
    const rendered = state.renderedCues.get(cueId);
    if (!rendered) return;

    const { element, cue, originalContent, targetEl } = rendered;
    state.renderedCues.delete(cueId);

    // Smooth exit animation
    element.classList.remove('chronicle-visible');
    element.classList.add('chronicle-exit');

    setTimeout(() => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }

      // If this was a replace action, restore original content
      if (originalContent !== null && targetEl) {
        targetEl.innerHTML = originalContent;
      }

      window.dispatchEvent(
        new CustomEvent('chronicle:cue-expired', {
          detail: { ...cue, reason }
        })
      );
      console.log(`[Chronicle] Cue '${cue.title}' (${cueId}) removed (${reason}).`);
    }, 400); // 400ms transition time
  }

  /**
   * Inject baseline CSS for Chronicle widgets
   */
  function injectChronicleStyles() {
    if (document.getElementById('chronicle-core-styles')) return;

    const style = document.createElement('style');
    style.id = 'chronicle-core-styles';
    style.textContent = `
      /* Chronicle Core Styles */
      .chronicle-top-banner {
        position: sticky;
        top: 0;
        left: 0;
        width: 100%;
        z-index: 999999;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        color: #f8fafc;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.25);
        transform: translateY(-100%);
        opacity: 0;
        transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease;
        box-sizing: border-box;
      }
      .chronicle-top-banner.chronicle-visible {
        transform: translateY(0);
        opacity: 1;
      }
      .chronicle-top-banner.chronicle-exit {
        transform: translateY(-100%);
        opacity: 0;
      }
      .chronicle-banner-inner {
        max-width: 1200px;
        margin: 0 auto;
        padding: 12px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.5;
      }
      .chronicle-banner-content {
        flex: 1;
      }
      .chronicle-banner-close {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.7);
        font-size: 22px;
        line-height: 1;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        transition: color 0.15s, background-color 0.15s;
      }
      .chronicle-banner-close:hover {
        color: #fff;
        background-color: rgba(255, 255, 255, 0.15);
      }
      .chronicle-selector-cue {
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .chronicle-selector-cue.chronicle-visible {
        opacity: 1;
        transform: translateY(0);
      }
      .chronicle-selector-cue.chronicle-exit {
        opacity: 0;
        transform: translateY(-8px);
      }
    `;
    document.head.appendChild(style);
  }

  // Public runtime API
  window.Chronicle = {
    version: '1.0.0',
    refresh: fetchCues,
    getActiveCues: () => Array.from(state.renderedCues.values()).map(r => r.cue),
    getAllCues: () => [...state.cues],
    getServerTime: () => new Date(getCurrentServerMs()).toISOString()
  };

  // Initial fetch when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchCues);
  } else {
    fetchCues();
  }

  // Periodic polling for newly scheduled cues
  state.pollTimer = setInterval(fetchCues, state.pollIntervalMs);
})(window, document);
