// When and where tours open. Nothing starts on its own: people are asked.
//   - Welcome offer, once per person (keyed by a hash of the signed-in email
//     from the ESAuth session, or this device when there is none):
//       new to FrameUp  → a small centred choice: "Take the tour" / "Not now"
//                         (Not now asks once more on a later day), plus
//                         "Don't show again".
//       already using it → a dismissible corner card, shown once.
//   - "What's new" toast when tours/updates.json has a note newer than the one
//     this person last saw; "Show me" runs a tour generated from it.
//   - "FrameUp was updated" card when /api/version reports a new deploy that
//     came without a release note.
//   - Replay any tour: "Tours" in the profile menu (a picker), the What's new
//     panel, ⌘K search, and a small "?" on pages with their own tour.
// Needs frameup-tour.js, tours/tours.js and tours/updates.js.
(() => {
  'use strict';

  const Tour = window.FrameUpTour;
  const Updates = window.FrameUpUpdates;
  if (!Tour || !Updates) return;
  // Pages embedded in a frame (Generate renders designs in a hidden editor
  // iframe) never offer, toast or add buttons.
  try { if (window.top !== window) return; } catch (error) { return; }

  const STATE_PREFIX = 'frameup.tours.v1:';
  const VERSION_CHECKED_KEY = 'frameup.tours.versionChecked';
  const OFFER_SESSION_KEY = 'frameup.tours.offered';
  const SNOOZE_MS = 24 * 60 * 60 * 1000;
  const MAX_OFFERS = 2;
  const scriptSrc = document.currentScript?.src || '';
  const rootUrl = scriptSrc ? new URL('../', scriptSrc).href : new URL('.', window.location.href).href;
  const MANIFEST_URL = new URL('tours/updates.json', rootUrl).href;

  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICON_HELP = svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>');
  const ICON_MAP = svg('<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>');
  const ICON_CLOSE = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
  const ICON_WAVE = svg('<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>');

  // Did this browser use FrameUp before tours existed? Read while the page is
  // still parsing, before this visit writes anything. Sign-in, theme and
  // Supabase keys don't count (they appear on any first visit).
  const IGNORE_KEYS = /^(es\.ai\.(profile|settings)|es\.authKnownEmails|es\.designerAuth|frameup\.theme|frameup\.tours?[.:]|sb-|supabase)/;
  const usedBefore = (() => {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i) || '';
        if (/^(frameup|es[.-])/.test(key) && !IGNORE_KEYS.test(key)) return true;
      }
    } catch (error) { /* storage blocked: treat as new */ }
    return false;
  })();

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
      const trendsView = document.querySelector('#ais-view-trends');
      const generateView = document.querySelector('#ais-view-generate');
      const trends = new URLSearchParams(window.location.search).get('view') === 'trends'
        || Boolean(trendsView?.offsetParent && !generateView?.offsetParent);
      return trends ? 'trends' : 'generate';
    }
    if (page === 'video-ads.html') return 'video-ads';
    if (page === 'reel-maker.html') return 'reels-studio';
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

  /** Start a tour by id. From a list (picker), go straight to its page. */
  function startTour(id, options = {}) {
    closeOverlays();
    // Let menus finish closing (and hand focus back) before the tour opens.
    setTimeout(() => {
      if (Tour.start(id, { autoNavigate: Boolean(options.fromList) }) && id === 'welcome') {
        writeState({ welcome: 'taken' });
      }
    }, 60);
  }

  function startWelcome() { startTour('welcome'); }
  function startPageTour() { startTour(pageTourId() || 'welcome'); }

  function startUpdateTour(entry) {
    closeOverlays();
    const tour = Updates.buildUpdateTour(entry, Tour.pageFile());
    setTimeout(() => Tour.start(tour), 60);
  }

  // ─── Welcome offer ──────────────────────────────────────────────────

  // New people: a small centred dialog (native <dialog>: focus stays inside,
  // Esc closes it = "Not now").
  function showOfferDialog({ onTake, onLater, onNever }) {
    document.querySelectorAll('.fu-offer').forEach(node => node.remove());
    const dialog = document.createElement('dialog');
    dialog.className = 'es-dialog fu-offer';
    dialog.setAttribute('aria-labelledby', 'fu-offer-title');
    dialog.setAttribute('aria-describedby', 'fu-offer-text');
    dialog.innerHTML = `
      <span class="fu-offer__art" aria-hidden="true">${ICON_WAVE}</span>
      <h2 class="es-type-card-title" id="fu-offer-title">Welcome to FrameUp</h2>
      <p id="fu-offer-text">On-brand sports designs in minutes. Want a one-minute tour?</p>
      <div class="fu-offer__actions">
        <button class="es-btn es-btn--primary" type="button" data-offer="take">Take the tour</button>
        <button class="es-btn" type="button" data-offer="later">Not now</button>
      </div>
      <button class="es-btn es-btn--tertiary es-btn--sm fu-offer__never" type="button" data-offer="never">Don’t show again</button>`;
    let choice = 'later';
    dialog.querySelectorAll('[data-offer]').forEach(button => button.addEventListener('click', () => {
      choice = button.dataset.offer;
      dialog.close();
    }));
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (choice === 'take') onTake();
      else if (choice === 'never') onNever();
      else onLater();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector('[data-offer="take"]').focus();
  }

  async function offerWelcome(state, newestId) {
    try {
      if (sessionStorage.getItem(OFFER_SESSION_KEY)) return false;
      sessionStorage.setItem(OFFER_SESSION_KEY, '1');
    } catch (error) { /* offer anyway */ }
    const kind = state.kind || (usedBefore ? 'existing' : 'new');
    const offers = Number(state.offers || 0) + 1;
    await writeState({ kind, offers, offeredAt: new Date().toISOString() });
    // A dialog the page opened meanwhile (a Gallery post): never open behind
    // it; offer again on the next page instead (UX audit P2).
    if (somethingOpen()) {
      try { sessionStorage.removeItem(OFFER_SESSION_KEY); } catch (error) { /* ignore */ }
      return true;
    }

    const take = () => { writeState({ welcome: 'taken' }); startTour('welcome'); };
    const never = () => writeState({ welcome: 'never' });

    if (kind === 'new') {
      // Today's notes count as seen; the tour covers them.
      if (newestId) writeState({ updateSeen: newestId });
      showOfferDialog({
        onTake: take,
        onNever: never,
        // "Not now" asks once more on a later day, then stops.
        onLater: () => writeState(offers >= MAX_OFFERS ? { welcome: 'dismissed' } : { snoozeUntil: Date.now() + SNOOZE_MS }),
      });
      return true;
    }
    // People who already use FrameUp: a quiet corner card, once.
    Updates.showToast({
      kicker: 'New: tours',
      icon: ICON_MAP,
      title: 'Take a one-minute tour of FrameUp?',
      text: 'See what’s where, including Video Ads and Ask AI.',
      primary: 'Take the tour',
      secondary: 'Not now',
      tertiary: 'Don’t show again',
      onPrimary: take,
      onSecondary: () => writeState({ welcome: 'dismissed' }),
      onTertiary: never,
    });
    return true;
  }

  // ─── Progress (per person, this browser) ────────────────────────────
  // state.tours = { [id]: { startedAt, doneAt } }. A tour counts as done
  // once it reached its last step; closing it early leaves it "started".

  const PICKER_ORDER = ['welcome', 'generate', 'trends', 'video-ads', 'reels-studio', 'editor'];

  function tourStatus(record) {
    if (record?.doneAt) return 'done';
    if (record?.startedAt) return 'started';
    return 'new';
  }

  async function recordTour(id, patch) {
    if (!id || !Tour.get(id)) return; // generated What's new tours are not tracked
    const { data } = await readState();
    const tours = { ...(data.tours || {}) };
    tours[id] = { ...(tours[id] || {}), ...patch };
    await writeState({ tours });
  }

  window.addEventListener('frameup:tour-start', event => {
    const id = event.detail?.id;
    recordTour(id, { startedAt: new Date().toISOString() });
  });
  window.addEventListener('frameup:tour-end', event => {
    const { id, completed } = event.detail || {};
    if (completed) recordTour(id, { doneAt: new Date().toISOString() });
  });

  async function progressSummary() {
    const { data } = await readState();
    const ids = PICKER_ORDER.filter(id => Tour.get(id));
    const done = ids.filter(id => tourStatus(data.tours?.[id]) === 'done').length;
    return { done, total: ids.length, tours: data.tours || {} };
  }

  // ─── Tours panel (account menu → Tours) ─────────────────────────────

  function pickerItems() {
    const here = pageTourId();
    const tours = PICKER_ORDER.map(id => Tour.get(id)).filter(Boolean);
    if (here) tours.sort((a, b) => (b.id === here) - (a.id === here));
    return { tours, here };
  }

  const ICON_CHECK = svg('<path d="M20 6 9 17l-5-5"/>');
  const ICON_PLAY = svg('<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>');
  const ICON_REPLAY = svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>');

  function shortDate(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  async function openPicker() {
    closeOverlays();
    await new Promise(resolve => setTimeout(resolve, 40));
    document.querySelectorAll('.fu-picker').forEach(node => node.remove());
    const { tours, here } = pickerItems();
    const [entries, summary] = await Promise.all([Updates.loadManifest(MANIFEST_URL), progressSummary()]);
    const latest = Updates.sortEntries(Updates.entriesOf(entries))[0];
    const dialog = document.createElement('dialog');
    dialog.className = 'es-dialog fu-picker';
    dialog.setAttribute('aria-labelledby', 'fu-picker-title');
    dialog.setAttribute('aria-describedby', 'fu-picker-sub');
    const percent = summary.total ? Math.round((summary.done / summary.total) * 100) : 0;
    dialog.innerHTML = `
      <div class="fu-picker__head">
        <div class="fu-picker__heading">
          <h2 class="es-type-card-title" id="fu-picker-title">Tours</h2>
          <p class="fu-picker__sub" id="fu-picker-sub"></p>
        </div>
        <button class="fu-tour__close" type="button" data-picker-close aria-label="Close (Esc)" title="Close (Esc)">${ICON_CLOSE}</button>
      </div>
      <div class="fu-picker__progress" role="progressbar" aria-label="Tours done" aria-valuemin="0" aria-valuemax="${summary.total}" aria-valuenow="${summary.done}" aria-valuetext="${summary.done} of ${summary.total} done"><span style="width:${percent}%"></span></div>
      <ul class="fu-picker__list" aria-label="Tours"></ul>
      <div class="fu-picker__latest" hidden><p class="fu-picker__section">Latest update</p><ul class="fu-picker__list"></ul></div>
      <div class="fu-picker__foot">
        <span>Tours never start on their own. Replay one any time.</span>
        <button class="es-btn es-btn--tertiary es-btn--sm" type="button" data-picker-reset>Reset progress</button>
      </div>`;
    dialog.querySelector('#fu-picker-sub').textContent = summary.done === summary.total && summary.total
      ? `All ${summary.total} done. Nice.`
      : `${summary.done} of ${summary.total} done · about a minute each`;
    const list = dialog.querySelector('.fu-picker__list');
    const add = (target, { icon, name, desc, tag, status, statusText, run }) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fu-picker__item';
      if (status) button.dataset.status = status;
      button.innerHTML = `<span class="fu-tour__icon" aria-hidden="true">${icon || ICON_MAP}</span>
        <span class="fu-picker__copy"><span class="fu-picker__name"></span><span class="fu-picker__desc"></span>${statusText ? '<span class="fu-picker__status"></span>' : ''}</span>
        <span class="fu-picker__end">${tag ? '<span class="fu-picker__tag"></span>' : ''}<span class="fu-picker__go" aria-hidden="true">${status === 'done' ? ICON_REPLAY : ICON_PLAY}</span></span>`;
      button.querySelector('.fu-picker__name').textContent = name;
      button.querySelector('.fu-picker__desc').textContent = desc || '';
      if (statusText) {
        const node = button.querySelector('.fu-picker__status');
        node.innerHTML = status === 'done' ? ICON_CHECK : '';
        node.append(document.createTextNode(statusText));
      }
      if (tag) button.querySelector('.fu-picker__tag').textContent = tag;
      button.setAttribute('aria-label', [name, statusText, tag, desc].filter(Boolean).join('. '));
      button.addEventListener('click', () => { dialog.close(); run(); });
      li.appendChild(button);
      target.appendChild(li);
    };
    tours.forEach(tour => {
      const record = summary.tours?.[tour.id];
      const status = tourStatus(record);
      const steps = Array.isArray(tour.steps) ? tour.steps.length : 0;
      const statusText = status === 'done'
        ? `Done${shortDate(record.doneAt) ? ` ${shortDate(record.doneAt)}` : ''} · Replay`
        : status === 'started' ? 'Started, not finished' : `${steps} ${steps === 1 ? 'step' : 'steps'}`;
      add(list, {
        icon: tour.icon,
        name: tour.label,
        desc: tour.description,
        tag: tour.id === here ? 'This page' : '',
        status,
        statusText,
        run: () => startTour(tour.id, { fromList: true }),
      });
    });
    if (latest) {
      const box = dialog.querySelector('.fu-picker__latest');
      box.hidden = false;
      add(box.querySelector('.fu-picker__list'), {
        icon: ICON_WAVE,
        name: latest.title || 'Latest update',
        desc: new Date(`${latest.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }),
        run: () => startUpdateTour(latest),
      });
    }
    // ↑ / ↓ move between rows (Tab works too).
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const rows = [...dialog.querySelectorAll('.fu-picker__item')];
      const at = rows.indexOf(document.activeElement);
      if (at < 0) return;
      event.preventDefault();
      rows[(at + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();
    });
    dialog.querySelector('[data-picker-reset]').addEventListener('click', async () => {
      await writeState({ tours: {} });
      dialog.close();
      openPicker();
    });
    dialog.querySelector('[data-picker-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();
    list.querySelector('button')?.focus();
  }

  // ─── Entry points ───────────────────────────────────────────────────

  // "Tours" in the account menu (built by site-chrome.js): replay any tour.
  function addProfileEntry() {
    document.querySelectorAll('.profile-menu .profile-actions').forEach(actions => {
      // The account menu (site-chrome.js) has its own Tours item now; this
      // only fills in older menus that don't.
      if (actions.closest('.profile-menu')?.querySelector('[data-tour-launch]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile-option fu-tour-menu-option';
      button.dataset.tourLaunch = '';
      button.innerHTML = `${ICON_MAP}<span>Tours</span>`;
      button.addEventListener('click', event => {
        event.preventDefault();
        openPicker();
      });
      actions.appendChild(button);
    });
  }

  // A small "?" where each page has room for it.
  const HELP_SLOTS = {
    generate: () => document.querySelector('#gen-form .gen-actions__buttons'),
    trends: () => document.querySelector('#ais-view-trends .td-status')?.parentElement,
    'video-ads': () => document.querySelector('#va-panel .va-pane-nav'),
    'reels-studio': () => document.querySelector('.rm-head'),
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
    const label = `${Tour.get(id)?.label || 'Page'} tour`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = ICON_HELP;
    button.addEventListener('click', () => startTour(id));
    if (id === 'generate' || id === 'video-ads') slot.prepend(button);
    else slot.appendChild(button);
  }

  // "Show me" on release notes that point at something, and a tours row.
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
    foot.innerHTML = '<span>New here, or need a refresher?</span>';
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'es-btn es-btn--sm';
    all.innerHTML = `${ICON_MAP}<span>Tours</span>`;
    all.addEventListener('click', openPicker);
    foot.appendChild(all);
    dialog.appendChild(foot);
  }

  function addPaletteEntries() {
    window.FrameUpShell?.addPaletteSource?.(() => {
      const items = [
        { label: 'Tours', icon: ICON_MAP, keywords: 'tour help guide onboarding welcome replay', run: openPicker },
        { label: 'Welcome tour', icon: ICON_MAP, keywords: 'tour help guide onboarding', run: startWelcome },
      ];
      const pageId = pageTourId();
      if (pageId) items.push({ label: `${Tour.get(pageId)?.label || 'Page'} tour`, icon: ICON_MAP, keywords: 'tour help guide', run: () => startTour(pageId) });
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

    const offerDue = !state.welcome && !(state.snoozeUntil > Date.now());
    if (offerDue && await offerWelcome(state, newestId)) return;

    // Before tours, the What's new panel remembered (per browser) the last
    // note opened; people who used it get today's note as a toast too.
    let panelSeen = '';
    try { panelSeen = localStorage.getItem('frameup.whatsNew.seen') || ''; } catch (error) { /* ignore */ }
    const entry = Updates.pendingEntry(manifest, state.updateSeen || panelSeen);
    if (entry && !somethingOpen()) {
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
    Updates.showToast({
      kicker: 'Update',
      title: 'FrameUp was updated',
      text: Updates.commitHeadline(version.message),
      primary: "What's new",
      secondary: 'Dismiss',
      onPrimary: () => window.FrameUpWhatsNew?.open?.(),
    });
  }

  // ─── Boot ───────────────────────────────────────────────────────────

  function boot() {
    // Pages that ask for no tours (the signed-out screen) keep the API only.
    if (document.body?.dataset.tours === 'off') return;
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
    openPicker,
    progressSummary,
    offerWelcome: async () => offerWelcome({ ...(await readState()).data, welcome: undefined }, ''),
    pageTourId,
    userKey,
    usedBefore,
    // Forget this person's tour history (handy for testing).
    reset: async () => {
      try {
        localStorage.removeItem(STATE_PREFIX + await userKey());
        sessionStorage.removeItem(OFFER_SESSION_KEY);
        sessionStorage.removeItem(VERSION_CHECKED_KEY);
      } catch (error) { /* ignore */ }
    },
  });
})();
