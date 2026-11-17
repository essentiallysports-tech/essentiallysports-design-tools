// When and where tours open:
//   - Welcome tour once per person (first visit), keyed by a hash of the
//     signed-in email (ESAuth session) or this device when there is none.
//   - "What's new" toast when tours/updates.json has an entry newer than the
//     one this person last saw; "Show me" runs a tour generated from it.
//   - "FrameUp was updated" card when /api/version reports a new deploy that
//     came without a release note.
//   - Entry points: "Take the tour" in the profile menu, the What's new panel
//     and ⌘K search, plus a small "?" on pages with their own tour.
// Needs frameup-tour.js, tours/tours.js and tours/updates.js.
(() => {
  'use strict';

  const Tour = window.FrameUpTour;
  const Updates = window.FrameUpUpdates;
  if (!Tour || !Updates) return;

  const STATE_PREFIX = 'frameup.tours.v1:';
  const VERSION_CHECKED_KEY = 'frameup.tours.versionChecked';
  const scriptSrc = document.currentScript?.src || '';
  const rootUrl = scriptSrc ? new URL('../', scriptSrc).href : new URL('.', window.location.href).href;
  const MANIFEST_URL = new URL('tours/updates.json', rootUrl).href;

  const ICON_HELP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>';
  const ICON_MAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/></svg>';

  // ─── Who is this? (per-person memory without storing the address) ────

  function hash(value) {
    let h = 0x811c9dc5;
    for (const ch of String(value)) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
  }

  let userKeyPromise = null;
  function userKey() {
    if (userKeyPromise) return userKeyPromise;
    userKeyPromise = (async () => {
      let id = '';
      try {
        const session = await withTimeout(window.ESAuth?.getSession?.() || Promise.resolve(null), 2000);
        id = session?.user?.email || '';
      } catch (error) { /* fall through */ }
      if (!id) {
        try { id = JSON.parse(localStorage.getItem('es.ai.profile') || '{}')?.email || ''; } catch (error) { /* ignore */ }
      }
      return id ? `u${hash(String(id).trim().toLowerCase())}` : 'device';
    })();
    return userKeyPromise;
  }

  async function readState() {
    const key = STATE_PREFIX + await userKey();
    try { return { key, data: JSON.parse(localStorage.getItem(key) || '{}') || {} }; } catch (error) { return { key, data: {} }; }
  }

  async function writeState(patch) {
    const { key, data } = await readState();
    const next = { ...data, ...patch };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch (error) { /* private mode: once per session */ }
    return next;
  }

  // ─── Which tour fits this page? ─────────────────────────────────────

  function pageTourId() {
    const page = Tour.pageFile();
    if (page === 'generate.html') {
      const trends = new URLSearchParams(window.location.search).get('view') === 'trends'
        || Boolean(document.querySelector('#ais-view-trends:not([hidden])')?.offsetParent && !document.querySelector('#ais-view-generate')?.offsetParent);
      return trends ? 'trends' : 'generate';
    }
    if (page === 'video-ads.html') return 'video-ads';
    if (page === 'index.html' && ['#instagram', '#youtube', '#newsletter'].includes(window.location.hash)) return 'editor';
    return null;
  }

  function closeOverlays() {
    document.querySelectorAll('dialog[open]').forEach(dialog => { try { dialog.close(); } catch (error) { /* ignore */ } });
    document.querySelectorAll('.fu-tour-toast').forEach(node => node.remove());
    if (document.querySelector('.profile-menu.is-open')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
  }

  function startTour(id) {
    closeOverlays();
    // Let menus finish closing (and hand focus back) before the tour opens.
    setTimeout(() => {
      if (Tour.start(id) && id === 'welcome') writeState({ welcome: new Date().toISOString() });
    }, 60);
  }

  function startWelcome() { startTour('welcome'); }
  function startPageTour() { startTour(pageTourId() || 'welcome'); }

  function startUpdateTour(entry) {
    closeOverlays();
    const tour = Updates.buildUpdateTour(entry, Tour.pageFile());
    setTimeout(() => Tour.start(tour), 60);
  }

  // ─── Entry points ───────────────────────────────────────────────────

  // "Take the tour" in the account menu (built by site-chrome.js).
  function addProfileEntry() {
    document.querySelectorAll('.profile-menu .profile-actions').forEach(actions => {
      if (actions.querySelector('[data-tour-launch]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile-option fu-tour-menu-option';
      button.dataset.tourLaunch = '';
      button.innerHTML = `${ICON_MAP}<span>Take the tour</span>`;
      button.addEventListener('click', event => {
        event.preventDefault();
        startPageTour();
      });
      actions.appendChild(button);
    });
  }

  // A small "?" where each page has room for it.
  const HELP_SLOTS = {
    generate: () => document.querySelector('#gen-form .gen-actions__buttons'),
    trends: () => document.querySelector('#ais-view-trends .td-status')?.parentElement,
    'video-ads': () => document.querySelector('#va-panel .va-pane-nav'),
    editor: () => document.querySelector('.studio-history-group'),
  };

  function addHelpButton() {
    const id = pageTourId();
    document.querySelectorAll('[data-tour-help]').forEach(button => {
      if (button.dataset.tourHelp !== id) button.remove();
    });
    if (!id) return;
    const slot = HELP_SLOTS[id]?.();
    if (!slot || slot.querySelector(`[data-tour-help="${id}"]`)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fu-tour-help';
    button.dataset.tourHelp = id;
    const label = `${Tour.get(id)?.label || 'Page tour'}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = ICON_HELP;
    button.addEventListener('click', () => startTour(id));
    if (id === 'generate' || id === 'video-ads') slot.prepend(button);
    else slot.appendChild(button);
  }

  // "Show me" on release notes that point at something, and the tours.
  function decorateWhatsNew(event) {
    const { dialog, entries } = event.detail || {};
    if (!dialog) return;
    (entries || []).forEach(entry => {
      const section = dialog.querySelector(`.whats-new-entry[data-entry-id="${CSS.escape(entry.id)}"]`);
      const showable = (entry.items || []).some(item => item.target);
      if (!section || !showable) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'es-btn es-btn--sm fu-whats-new-show';
      button.textContent = 'Show me';
      button.addEventListener('click', () => startUpdateTour(entry));
      section.appendChild(button);
    });
    const foot = document.createElement('div');
    foot.className = 'fu-whats-new-foot';
    const pageId = pageTourId();
    foot.innerHTML = `<span>${ICON_MAP}Tours</span>`;
    const tours = [['welcome', 'Welcome to FrameUp']];
    if (pageId) tours.push([pageId, Tour.get(pageId)?.label || 'This page']);
    tours.forEach(([id, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'es-btn es-btn--sm';
      button.textContent = label;
      button.addEventListener('click', () => startTour(id));
      foot.appendChild(button);
    });
    dialog.appendChild(foot);
  }

  function addPaletteEntries() {
    window.FrameUpShell?.addPaletteSource?.(() => {
      const items = [{ label: 'Take the tour', icon: ICON_MAP, keywords: 'tour help guide onboarding welcome', run: startWelcome }];
      const pageId = pageTourId();
      if (pageId) items.push({ label: Tour.get(pageId)?.label || 'Page tour', icon: ICON_MAP, keywords: 'tour help guide', run: () => startTour(pageId) });
      return [{ label: 'Help', items }];
    });
  }

  // ─── Automatic: first visit, release notes, new deploys ─────────────

  function somethingOpen() {
    return Tour.isRunning() || Boolean(document.querySelector('dialog[open], .fu-tour-toast'));
  }

  async function autoStart() {
    const visible = await Tour.whenPageVisible();
    if (!visible) return;
    const [manifest, { data: state }] = await Promise.all([Updates.loadManifest(MANIFEST_URL), readState()]);
    const newestId = Updates.sortEntries(Updates.entriesOf(manifest))[0]?.id || '';
    // A tour resumed from another page, or a dialog the page opened: wait.
    if (somethingOpen()) return;

    if (!state.welcome) {
      // First visit: the Welcome tour, and today's notes count as seen. It is
      // marked as shown when it starts (it may end on another page), so it
      // never comes back on its own; the menu replays it.
      if (Tour.start('welcome')) await writeState({ welcome: new Date().toISOString(), updateSeen: newestId });
      return;
    }

    const entry = Updates.pendingEntry(manifest, state.updateSeen || '');
    if (entry) {
      Updates.showToast({
        kicker: "What's new",
        title: entry.title || 'FrameUp was updated',
        text: (entry.items || []).map(item => item.title).filter(Boolean).slice(0, 3).join(' · '),
        primary: 'Show me',
        secondary: 'Not now',
        onPrimary: () => {
          writeState({ updateSeen: entry.id });
          window.FrameUpWhatsNew?.markSeen?.();
          startUpdateTour(entry);
        },
        onSecondary: () => writeState({ updateSeen: entry.id }),
      });
      return;
    }
    if (!state.updateSeen && newestId) writeState({ updateSeen: newestId });
    checkDeploy(state);
  }

  // A push without a release note still gets a one-line card (once per deploy).
  async function checkDeploy(state) {
    try {
      if (sessionStorage.getItem(VERSION_CHECKED_KEY)) return;
      sessionStorage.setItem(VERSION_CHECKED_KEY, '1');
    } catch (error) { /* check anyway */ }
    const version = await Updates.fetchVersion(new URL('api/version', rootUrl).pathname);
    if (!version) return;
    if (!state.deploySha) {
      writeState({ deploySha: version.sha });
      return;
    }
    if (state.deploySha === version.sha || somethingOpen()) return;
    writeState({ deploySha: version.sha });
    const headline = Updates.commitHeadline(version.message);
    Updates.showToast({
      kicker: 'Update',
      title: 'FrameUp was updated',
      text: headline,
      primary: "What's new",
      secondary: 'Dismiss',
      onPrimary: () => window.FrameUpWhatsNew?.open?.(),
    });
  }

  // ─── Boot ───────────────────────────────────────────────────────────

  function boot() {
    addProfileEntry();
    addHelpButton();
    addPaletteEntries();
    // site-chrome may rebuild the account menu; pages swap views in place.
    setTimeout(addProfileEntry, 600);
    setTimeout(addHelpButton, 900);
    document.addEventListener('click', event => {
      if (event.target.closest?.('.profile-trigger')) addProfileEntry();
    }, true);
    ['hashchange', 'popstate', 'frameup:routechange'].forEach(name => window.addEventListener(name, () => setTimeout(addHelpButton, 50)));
    window.addEventListener('frameup:whatsnew-open', decorateWhatsNew);
    setTimeout(autoStart, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  window.FrameUpTours = Object.freeze({
    startWelcome,
    startPageTour,
    startUpdateTour,
    pageTourId,
    userKey,
    // Forget this person's tour history (handy for testing).
    reset: async () => { try { localStorage.removeItem(STATE_PREFIX + await userKey()); } catch (error) { /* ignore */ } },
  });
})();
