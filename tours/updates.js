// "What's new" tours, generated from the release manifest (tours/updates.json)
// with no hand-built steps: each item becomes one step that highlights its
// `target`, or a centred card when there is none (or it can't be found).
// Also: the toast that offers the tour, and the deploy check (/api/version)
// that notices a push even when nobody edited the manifest.
// Orchestration (who sees what, when) is in tours/tour-launcher.js.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpUpdates = api;
})(typeof window !== 'undefined' ? window : globalThis, function (win) {
  'use strict';

  const FRESH_DAYS = 30;
  const PAGE_LABELS = {
    'index.html': 'Home',
    'generate.html': 'Generate',
    'video-ads.html': 'Video Ads',
    'reels.html': 'Reel Captions',
    'gallery.html': 'Gallery',
    'dashboard.html': 'Dashboard',
    'design-request.html': 'Design Request',
    'tool-feedback.html': 'Tool Feedback',
    'how-frameup-works.html': 'How FrameUp works',
    'design-system.html': 'UI Library',
  };

  // ─── Pure helpers (tested in scripts/test-tour.mjs) ──────────────────

  function entriesOf(data) {
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : []);
    return list.filter(entry => entry && entry.id && entry.date);
  }

  /** Newest first, by date then by position in the file. */
  function sortEntries(entries) {
    return entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => (a.entry.date === b.entry.date ? a.index - b.index : (a.entry.date < b.entry.date ? 1 : -1)))
      .map(({ entry }) => entry);
  }

  /**
   * Is `newestId` newer than what the person last saw?
   * - never saw anything (null/''): false (first visit gets the Welcome tour).
   * - same id: false.
   * - seen id still in the manifest: newer when it sits after the newest.
   * - seen id gone (renamed/removed): compare the YYYY-MM-DD prefixes.
   */
  function isNewer(newestId, lastSeenId, entries = []) {
    if (!newestId || !lastSeenId || newestId === lastSeenId) return false;
    const ids = entries.map(entry => entry.id);
    const seenAt = ids.indexOf(lastSeenId);
    const newestAt = ids.indexOf(newestId);
    if (seenAt !== -1 && newestAt !== -1) return newestAt < seenAt;
    return String(newestId).slice(0, 10) >= String(lastSeenId).slice(0, 10);
  }

  /** The entry to announce, or null. `now` is injectable for tests. */
  function pendingEntry(data, lastSeenId, now = Date.now()) {
    const entries = sortEntries(entriesOf(data));
    const newest = entries[0];
    if (!newest || !isNewer(newest.id, lastSeenId, entries)) return null;
    const age = now - new Date(`${newest.date}T12:00:00`).getTime();
    if (age > FRESH_DAYS * 24 * 60 * 60 * 1000) return null;
    return newest;
  }

  function pageLabel(page) {
    const file = String(page || '').split(/[?#]/)[0];
    return PAGE_LABELS[file] || file.replace(/\.html$/, '').replace(/[-_]/g, ' ');
  }

  /**
   * Builds a tour definition from one manifest entry. Items on the current
   * page (or on no page) come first, then other pages grouped, so the tour
   * travels as little as possible. Items without a target never navigate.
   */
  function buildUpdateTour(entry, currentPage = 'index.html') {
    const items = (entry.items || [])
      .map(item => (Array.isArray(item) ? { title: item[0], text: item[1] } : item))
      .filter(item => item && (item.title || item.text));
    const pages = [];
    items.forEach(item => {
      const page = item.target && item.page ? item.page : null;
      if (page && page !== currentPage && !pages.includes(page)) pages.push(page);
    });
    const rank = item => {
      const page = item.target && item.page ? item.page : null;
      return !page || page === currentPage ? -1 : pages.indexOf(page);
    };
    const ordered = items.map((item, index) => ({ item, index }))
      .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
      .map(({ item }) => item);
    const steps = ordered.map(item => {
      const step = { title: item.title || '', text: item.text || '', fallback: 'center' };
      if (item.target) {
        step.target = item.target;
        if (item.page) {
          step.page = item.page;
          step.pageLabel = pageLabel(item.page);
        }
        if (item.route) step.route = item.route;
      }
      return step;
    });
    return { id: `update:${entry.id}`, label: entry.title || "What's new", kicker: "What's new", steps };
  }

  /** First line of a commit message, trimmed for a card. */
  function commitHeadline(message, max = 120) {
    const line = String(message || '').split('\n')[0].trim();
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }

  // ─── Browser parts ───────────────────────────────────────────────────

  const ICON_SPARKLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  /** The manifest, shared with the What's new panel when app-shell loaded it. */
  function loadManifest(url) {
    const shared = win.FrameUpWhatsNew && win.FrameUpWhatsNew.ready;
    if (shared && typeof shared.then === 'function') return shared.then(entries => entries || []);
    return fetch(url, { cache: 'no-cache', headers: { Accept: 'application/json' } })
      .then(response => (response.ok ? response.json() : []))
      .then(entriesOf)
      .catch(() => []);
  }

  /**
   * Small, non-blocking card in the corner. Never steals focus.
   * options: { kicker, title, text, primary, secondary, onPrimary, onSecondary }
   */
  function showToast(options) {
    const doc = win.document;
    doc.querySelectorAll('.fu-tour-toast').forEach(node => node.remove());
    const toast = doc.createElement('section');
    toast.className = 'fu-tour-toast';
    toast.setAttribute('role', 'region');
    toast.setAttribute('aria-label', options.kicker || "What's new");
    toast.innerHTML = `
      <span class="fu-tour-toast__icon">${ICON_SPARKLE}</span>
      <div>
        <p class="fu-tour-toast__kicker"></p>
        <p class="fu-tour-toast__title" aria-live="polite"></p>
        <p class="fu-tour-toast__text"></p>
        <div class="fu-tour-toast__actions">
          <button class="es-btn es-btn--primary es-btn--static es-btn--sm" type="button" data-toast-primary></button>
          <button class="es-btn es-btn--ghost es-btn--sm" type="button" data-toast-secondary></button>
        </div>
      </div>
      <button class="fu-tour__close" type="button" data-toast-close aria-label="Dismiss">${ICON_CLOSE}</button>`;
    toast.querySelector('.fu-tour-toast__kicker').textContent = options.kicker || "What's new";
    toast.querySelector('.fu-tour-toast__title').textContent = options.title || '';
    const text = toast.querySelector('.fu-tour-toast__text');
    text.textContent = options.text || '';
    text.hidden = !options.text;
    const primary = toast.querySelector('[data-toast-primary]');
    const secondary = toast.querySelector('[data-toast-secondary]');
    primary.textContent = options.primary || 'Show me';
    secondary.textContent = options.secondary || 'Not now';
    const close = (callback) => {
      toast.remove();
      if (typeof callback === 'function') callback();
    };
    primary.addEventListener('click', () => close(options.onPrimary));
    secondary.addEventListener('click', () => close(options.onSecondary));
    toast.querySelector('[data-toast-close]').addEventListener('click', () => close(options.onSecondary));
    toast.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(options.onSecondary); }
    });
    doc.body.appendChild(toast);
    return toast;
  }

  /**
   * Latest deploy: { sha, message, deployedAt } from /api/version, or null
   * (local preview, Netlify without the function, signed out, offline).
   */
  async function fetchVersion(url = '/api/version') {
    try {
      const auth = win.ESAuth;
      const request = { headers: { Accept: 'application/json' }, cache: 'no-store' };
      const response = auth && typeof auth.fetchWithAuth === 'function'
        ? await auth.fetchWithAuth(url, request)
        : await fetch(url, request);
      if (!response || !response.ok) return null;
      const data = await response.json();
      return data && data.sha ? data : null;
    } catch (error) {
      return null;
    }
  }

  return {
    FRESH_DAYS,
    entriesOf,
    sortEntries,
    isNewer,
    pendingEntry,
    pageLabel,
    buildUpdateTour,
    commitHeadline,
    loadManifest,
    showToast,
    fetchVersion,
  };
});
