/*
 * FrameUp logo picker: one dialog for every logo slot in the editor.
 *
 *   FrameUpLogoPicker.open({
 *     title: 'Team logo',             // dialog title
 *     current: 'assets/logos/nba/lal.webp', // highlights the current pick
 *     query: 'Lakers',                // optional starting search
 *     league: 'nba',                  // optional starting chip
 *     onPick(choice) {}               // { src, name, id, colors, league, source: 'library'|'custom'|'upload', customId }
 *     onRemove() {}                   // optional: shows "Remove logo"
 *     only: 'custom',                 // optional: just "My logos" + Upload (Custom brand logo)
 *   });
 *
 * Library logos come from logo-library.js (FrameUpLogos). "My logos" is the
 * person's own saved library (frameup-custom-logos.js: Supabase table + private
 * bucket, square crop on upload; this tab only until that migration runs). A
 * custom pick hands back a 1024 px PNG data URL, so it draws and exports like
 * any upload. Older uploads kept in this browser (IndexedDB) still show there,
 * marked "This browser". Recents, favourites and the last source used are per
 * user (localStorage).
 * The pure helpers are exported under FrameUpLogoPicker.helpers for tests.
 * UMD: window.FrameUpLogoPicker in the browser, module.exports under Node.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpLogoPicker = api;
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const MAX_RECENT = 12;
  const MAX_UPLOADS = 60;
  const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
  const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
  const DB_NAME = 'frameup-logos';
  const STORE = 'uploads';

  // ── Pure helpers (tested in scripts/test-logo-library.mjs) ──
  function userKey(email) {
    const value = String(email || '').trim().toLowerCase();
    return value || 'anon';
  }
  function storageKey(kind, email) {
    return 'frameup.logos.' + kind + '.v1.' + userKey(email);
  }
  function pushRecent(list, id, max) {
    const limit = Number.isFinite(max) ? max : MAX_RECENT;
    const next = [String(id)].concat((Array.isArray(list) ? list : []).filter(item => item !== String(id)));
    return next.slice(0, limit);
  }
  function toggleFavorite(list, id) {
    const current = Array.isArray(list) ? list : [];
    return current.includes(id) ? current.filter(item => item !== id) : current.concat(id);
  }
  function validateUpload(file) {
    if (!file) return 'Choose a file.';
    if (!UPLOAD_TYPES.includes(file.type)) return 'Use a PNG, JPEG, WebP or SVG logo.';
    if (file.size > MAX_UPLOAD_BYTES) return 'Logo must be smaller than 4 MB.';
    return '';
  }
  // Chips: All, Recent, Favourites, My uploads, then every league.
  function buildChips(leagues, counts) {
    const c = counts || {};
    const chips = [{ id: 'all', label: 'All' }];
    if (c.recent) chips.push({ id: 'recent', label: 'Recent' });
    if (c.favorites) chips.push({ id: 'favorites', label: 'Favorites' });
    chips.push({ id: 'uploads', label: 'My logos' });
    (leagues || []).forEach(league => chips.push({ id: league.id, label: league.short || league.label, title: league.label }));
    return chips;
  }
  // What the grid shows for a query + chip.
  function filterEntries(library, options) {
    const opts = options || {};
    const chip = opts.chip || 'all';
    const query = String(opts.query || '').trim();
    const byIds = ids => (ids || []).map(id => library.get(id)).filter(Boolean);
    if (chip === 'recent' || chip === 'favorites') {
      const list = byIds(chip === 'recent' ? opts.recents : opts.favorites);
      if (!query) return list;
      const ranked = new Set(library.search(query, { limit: 2000 }).map(entry => entry.id));
      return list.filter(entry => ranked.has(entry.id));
    }
    if (chip === 'uploads') return [];
    const league = chip === 'all' ? '' : chip;
    // No query on "All": favourites first, then the most-used pro leagues.
    if (!query && !league) {
      const fav = byIds(opts.favorites);
      const seen = new Set(fav.map(entry => entry.id));
      return fav.concat(library.search('', { limit: opts.limit || 120 }).filter(entry => !seen.has(entry.id)));
    }
    return library.search(query, { league, limit: opts.limit || 120 });
  }
  function filterUploads(uploads, query) {
    const q = String(query || '').trim().toLowerCase();
    const list = Array.isArray(uploads) ? uploads : [];
    return q ? list.filter(item => String(item.name || '').toLowerCase().includes(q)) : list;
  }
  function choiceFromEntry(entry, library, dark) {
    return {
      source: 'library',
      id: entry.id,
      name: entry.short || entry.name,
      fullName: entry.name,
      league: entry.league,
      colors: entry.colors.slice(),
      src: library.srcFor(entry, { dark }),
    };
  }

  const helpers = Object.freeze({ userKey, storageKey, pushRecent, toggleFavorite, validateUpload, buildChips, filterEntries, filterUploads, choiceFromEntry, MAX_UPLOADS, MAX_UPLOAD_BYTES, UPLOAD_TYPES });

  if (!root || typeof root.document === 'undefined') {
    return Object.freeze({ helpers, open() {}, close() {} });
  }

  // ── Browser-only below ──
  const doc = root.document;
  let currentEmail = '';
  function refreshUser() {
    try {
      const getter = root.ESDashboardData && root.ESDashboardData.getCurrentUser;
      if (typeof getter === 'function') {
        Promise.resolve(getter()).then(user => { currentEmail = (user && user.email) || ''; }).catch(() => {});
      }
    } catch (error) { /* anonymous */ }
  }
  refreshUser();
  root.addEventListener && root.addEventListener('es:auth-ready', refreshUser);

  function readList(kind) {
    try { const value = JSON.parse(root.localStorage.getItem(storageKey(kind, currentEmail)) || '[]'); return Array.isArray(value) ? value : []; }
    catch (error) { return []; }
  }
  function writeList(kind, list) {
    try { root.localStorage.setItem(storageKey(kind, currentEmail), JSON.stringify(list)); } catch (error) { /* per-browser */ }
  }

  // Uploads: IndexedDB records { key: '<user>:<id>', user, id, name, src, addedAt }.
  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('no indexedDB')); return; }
      const request = root.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('user', 'user');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }
  async function listUploads() {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE).objectStore(STORE).index('user').getAll(userKey(currentEmail));
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.addedAt - a.addedAt));
        req.onerror = () => reject(req.error);
      });
    } catch (error) { return []; }
  }
  async function saveUpload(record) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    const list = await listUploads();
    if (list.length > MAX_UPLOADS) await Promise.all(list.slice(MAX_UPLOADS).map(item => deleteUpload(item.key)));
  }
  async function deleteUpload(key) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  const ICON = {
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    upload: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',
    alert: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  let el = null;
  let opts = null;
  let lastFocus = null;
  const view = { query: '', chip: 'all', dark: false, uploads: [], only: '' };
  // "My logos" (frameup-custom-logos.js): status idle | loading | ready | error.
  const mine = { status: 'idle', logos: [], mode: '', note: '', editing: '', confirming: '', busy: '' };
  const customApi = () => root.FrameUpCustomLogos && root.FrameUpCustomLogos.store ? root.FrameUpCustomLogos : null;

  function build() {
    // A modal <dialog> sits in the top layer, above toasts and popovers, and
    // makes the page behind it inert.
    el = doc.createElement('dialog');
    el.className = 'flp';
    el.setAttribute('aria-labelledby', 'flp-title');
    el.innerHTML = `
      <div class="flp__scrim" data-flp-close></div>
      <section class="flp__dialog">
        <header class="flp__head">
          <h2 class="flp__title" id="flp-title">Choose a logo</h2>
          <button type="button" class="es-icon-btn flp__close" data-flp-close aria-label="Close logo library">${ICON.close}</button>
        </header>
        <div class="flp__tools">
          <label class="flp__search">
            <span class="es-sr-only">Search logos</span>
            ${ICON.search}
            <input type="search" class="flp__input" data-flp-search placeholder="Search teams, clubs, leagues: Niners, Bama, LAL" autocomplete="off" spellcheck="false">
          </label>
          <div class="flp__bg es-segmented" role="group" aria-label="Preview background">
            <button type="button" class="es-segmented__item" data-flp-bg="light" aria-pressed="true">Light</button>
            <button type="button" class="es-segmented__item" data-flp-bg="dark" aria-pressed="false">Dark</button>
          </div>
        </div>
        <div class="flp__chips" role="toolbar" aria-label="Filter by league" data-flp-chips></div>
        <p class="flp__status" role="status" aria-live="polite" data-flp-status></p>
        <p class="es-callout flp__session" data-flp-session hidden></p>
        <div class="flp__grid" data-flp-grid></div>
        <footer class="flp__foot">
          <p class="flp__note" data-flp-note>Team logos are for editorial use. Name badges (F1, ATP, WTA) are not official marks: upload the real one if you have it.</p>
          <div class="flp__actions">
            <button type="button" class="es-btn es-btn--sm es-btn--danger" data-flp-remove hidden>Remove logo</button>
            <button type="button" class="es-btn es-btn--sm" data-flp-upload>${ICON.upload}Upload logo</button>
            <input type="file" accept="${UPLOAD_TYPES.join(',')},.svg" hidden data-flp-file>
          </div>
        </footer>
      </section>`;
    doc.body.appendChild(el);

    el.addEventListener('click', onClick);
    el.querySelector('[data-flp-search]').addEventListener('input', event => { view.query = event.target.value; renderGrid(); });
    el.querySelector('[data-flp-file]').addEventListener('change', onFile);
    el.addEventListener('keydown', onKeydown);
    // Leaving the name field saves it (Esc cancels first).
    el.addEventListener('focusout', event => {
      const input = event.target.closest && event.target.closest('[data-flp-rename-input]');
      if (input && mine.editing === input.dataset.flpRenameInput) saveRename(input.dataset.flpRenameInput, input.value);
    });
    el.addEventListener('cancel', event => { event.preventDefault(); if (mine.editing || mine.confirming) return; close(); });
  }

  function setStatus(text) { const node = el.querySelector('[data-flp-status]'); if (node) node.textContent = text || ''; }

  function renderChips() {
    const library = root.FrameUpLogos;
    const chips = buildChips(library ? library.LEAGUES : [], { recent: readList('recent').length, favorites: readList('favorites').length });
    if (!chips.some(chip => chip.id === view.chip)) view.chip = 'all';
    el.querySelector('[data-flp-chips]').hidden = view.only === 'custom';
    el.querySelector('[data-flp-chips]').innerHTML = chips.map(chip =>
      `<button type="button" class="es-chip" data-flp-chip="${esc(chip.id)}" aria-pressed="${chip.id === view.chip}"${chip.title ? ` title="${esc(chip.title)}"` : ''}>${esc(chip.label)}</button>`).join('');
  }

  function tileHtml({ key, src, name, meta, selected, favorite, removable, cors }) {
    return `<div class="flp__tile${selected ? ' is-selected' : ''}">
      <button type="button" class="flp__pick" data-flp-pick="${esc(key)}" aria-label="${esc(name)}${meta ? ', ' + esc(meta) : ''}"${selected ? ' aria-current="true"' : ''}>
        <span class="flp__art"><img src="${esc(src)}" alt="" loading="lazy" decoding="async"${cors ? ' crossorigin="anonymous"' : ''}></span>
        <span class="flp__name">${esc(name)}</span>
        ${meta ? `<span class="flp__meta">${esc(meta)}</span>` : ''}
      </button>
      ${favorite == null ? '' : `<button type="button" class="flp__fav" data-flp-fav="${esc(key)}" aria-pressed="${favorite}" aria-label="${favorite ? 'Remove from' : 'Add to'} favorites: ${esc(name)}">${ICON.star}</button>`}
      ${removable ? `<button type="button" class="flp__fav" data-flp-delete="${esc(key)}" aria-label="Delete upload ${esc(name)}">${ICON.trash}</button>` : ''}
    </div>`;
  }

  function renderGrid() {
    const library = root.FrameUpLogos;
    const grid = el.querySelector('[data-flp-grid]');
    el.classList.toggle('is-dark', view.dark);
    const current = opts && opts.current;
    syncSessionNote();
    if (view.chip === 'uploads') { renderMyLogos(grid); return; }
    if (!library) { grid.innerHTML = '<div class="es-empty flp__empty"><p>The logo library did not load. You can still upload a logo.</p></div>'; return; }
    const favorites = readList('favorites');
    const list = filterEntries(library, { query: view.query, chip: view.chip, recents: readList('recent'), favorites });
    const extraUploads = view.chip === 'all' && view.query ? filterUploads(view.uploads, view.query) : [];
    const extraMine = view.chip === 'all' && view.query && mine.status === 'ready' ? filterMine(view.query) : [];
    const html = extraMine.map(logo => customTileHtml(logo, false)).concat(extraUploads.map(item => tileHtml({ key: 'upload:' + item.key, src: item.src, name: item.name, meta: 'This browser', selected: item.src === current })))
      .concat(list.map(entry => {
        const src = library.srcFor(entry, { dark: view.dark });
        const league = library.leagueOf(entry.league);
        const meta = entry.kind === 'badge' ? 'Name badge' : (league ? (league.short || league.label) : '');
        return tileHtml({ key: entry.id, src, name: entry.short || entry.name, meta, selected: !!current && (current === entry.file || current === entry.darkFile || current === entry.url), favorite: favorites.includes(entry.id), cors: library.needsCors(src) });
      }));
    grid.innerHTML = html.length ? html.join('') : `<div class="es-empty flp__empty"><p>No logo matches “${esc(view.query)}”. Try a nickname or city, or upload the logo.</p></div>`;
    setStatus(html.length ? `${html.length} logo${html.length === 1 ? '' : 's'}` : 'No matches');
    if (extraMine.length) fillThumbs(grid);
  }

  // ── My logos ──
  function filterMine(query) {
    const api = customApi();
    return api ? api.helpers.filterLogos(api.helpers.sortLogos(mine.logos), query) : [];
  }

  function syncSessionNote() {
    const node = el.querySelector('[data-flp-session]');
    const show = view.chip === 'uploads' && mine.status === 'ready' && mine.mode !== 'cloud' && !!mine.note;
    node.hidden = !show;
    node.textContent = show ? mine.note : '';
  }

  function customTileHtml(logo, manage) {
    const key = 'custom:' + logo.id;
    const selected = !!(opts && opts.customId && opts.customId === logo.id);
    if (manage && mine.confirming === logo.id) {
      return `<div class="flp__tile is-confirming" data-flp-tile="${esc(key)}">
        <div class="flp__confirm" role="group" aria-label="Delete ${esc(logo.name)}?">
          <p class="flp__confirm-text">Delete “${esc(logo.name)}”? This can’t be undone.</p>
          <div class="flp__confirm-actions">
            <button type="button" class="es-btn es-btn--sm es-btn--danger" data-flp-confirm-delete="${esc(logo.id)}"${mine.busy === logo.id ? ' disabled aria-busy="true"' : ''}>Delete</button>
            <button type="button" class="es-btn es-btn--sm" data-flp-cancel-delete="${esc(logo.id)}">Keep</button>
          </div>
        </div>
      </div>`;
    }
    const art = `<span class="flp__art"><span class="es-skeleton flp__thumb-wait" aria-hidden="true"></span><img alt="" hidden data-flp-thumb="${esc(logo.id)}"></span>`;
    if (manage && mine.editing === logo.id) {
      return `<div class="flp__tile is-editing" data-flp-tile="${esc(key)}">
        <div class="flp__pick flp__pick--static">${art}
          <label class="es-sr-only" for="flp-rename-${esc(logo.id)}">Logo name</label>
          <input id="flp-rename-${esc(logo.id)}" class="flp__rename" type="text" maxlength="80" value="${esc(logo.name)}" data-flp-rename-input="${esc(logo.id)}" autocomplete="off" spellcheck="false">
          <span class="flp__meta">Enter to save · Esc to cancel</span>
        </div>
      </div>`;
    }
    return `<div class="flp__tile${selected ? ' is-selected' : ''}" data-flp-tile="${esc(key)}">
      <button type="button" class="flp__pick" data-flp-pick="${esc(key)}" aria-label="${esc(logo.name)}, my logo"${selected ? ' aria-current="true"' : ''}>
        ${art}
        <span class="flp__name">${esc(logo.name)}</span>
        <span class="flp__meta">${logo.session ? 'This tab only' : 'My logo'}</span>
      </button>
      ${manage ? `<button type="button" class="flp__fav flp__fav--left flp__tool" data-flp-rename="${esc(logo.id)}" aria-label="Rename ${esc(logo.name)}">${ICON.pencil}</button>
      <button type="button" class="flp__fav flp__tool" data-flp-delete-custom="${esc(logo.id)}" aria-label="Delete ${esc(logo.name)}">${ICON.trash}</button>` : ''}
    </div>`;
  }

  function fillThumbs(grid) {
    const api = customApi();
    if (!api) return;
    grid.querySelectorAll('img[data-flp-thumb]').forEach(img => {
      const logo = mine.logos.find(item => item.id === img.dataset.flpThumb);
      if (!logo) return;
      api.store.thumbUrl(logo).then(url => {
        img.onload = () => { img.hidden = false; img.previousElementSibling?.remove(); };
        img.src = url;
      }).catch(() => {
        const wait = img.previousElementSibling;
        if (wait) { wait.className = 'flp__thumb-missing'; wait.textContent = 'No preview'; }
      });
    });
  }

  function renderMyLogos(grid) {
    const api = customApi();
    const current = opts && opts.current;
    const legacy = filterUploads(view.uploads, view.query);
    const legacyHtml = legacy.map(item => tileHtml({ key: 'upload:' + item.key, src: item.src, name: item.name, meta: 'This browser', selected: item.src === current, removable: true }));
    if (!api) {
      grid.innerHTML = legacyHtml.length ? legacyHtml.join('') : `<div class="es-empty flp__empty"><p>No uploads yet. Use <strong>Upload logo</strong>.</p></div>`;
      setStatus('');
      return;
    }
    if (mine.status === 'loading' || mine.status === 'idle') {
      grid.innerHTML = Array.from({ length: 6 }, () => '<div class="flp__tile flp__tile--wait" aria-hidden="true"><span class="es-skeleton flp__skeleton"></span></div>').join('');
      grid.setAttribute('aria-busy', 'true');
      setStatus('Loading your logos…');
      return;
    }
    grid.removeAttribute('aria-busy');
    if (mine.status === 'error') {
      grid.innerHTML = `<div class="es-error-state flp__empty" role="alert">
        <span class="es-error-state__icon">${ICON.alert}</span>
        <p class="es-error-state__title">Your logos didn’t load</p>
        <p class="es-error-state__copy">Check your connection, then try again. You can still upload a logo.</p>
        <button type="button" class="es-btn es-btn--sm" data-flp-retry>Try again</button>
      </div>`;
      setStatus('');
      return;
    }
    const list = filterMine(view.query);
    const html = list.map(logo => customTileHtml(logo, true)).concat(legacyHtml);
    if (!html.length) {
      grid.innerHTML = view.query
        ? `<div class="es-empty flp__empty"><p>None of your logos is called “${esc(view.query)}”.</p></div>`
        : `<div class="es-empty flp__empty"><p class="es-empty__title">No logos yet</p><p class="es-empty__copy">Upload a PNG, JPG, WebP or SVG (up to 5 MB). You crop it to a square once, and it’s saved here for next time.</p><button type="button" class="es-btn es-btn--sm" data-flp-upload>${ICON.upload}Upload logo</button></div>`;
      setStatus('');
      return;
    }
    grid.innerHTML = html.join('');
    setStatus(`${html.length} logo${html.length === 1 ? '' : 's'}`);
    fillThumbs(grid);
    const editing = mine.editing && grid.querySelector(`[data-flp-rename-input="${CSS.escape(mine.editing)}"]`);
    if (editing) { editing.focus(); editing.select(); }
  }

  function loadMine(force) {
    const api = customApi();
    if (!api) return Promise.resolve();
    if (mine.status === 'loading') return Promise.resolve();
    if (mine.status === 'ready' && !force) return Promise.resolve();
    mine.status = 'loading';
    if (el && el.open) renderGrid();
    return api.store.list({ force }).then(result => {
      mine.logos = result.logos;
      mine.mode = result.mode;
      mine.note = result.note;
      mine.status = 'ready';
    }).catch(() => { mine.status = 'error'; }).then(() => { if (el && el.open) renderGrid(); });
  }

  function refreshMine(focusSelector) {
    const api = customApi();
    if (api) mine.logos = api.helpers.sortLogos(mine.logos);
    const grid = el.querySelector('[data-flp-grid]');
    const scrollTop = grid.scrollTop;
    renderGrid();
    grid.scrollTop = scrollTop;
    if (focusSelector) el.querySelector(focusSelector)?.focus();
  }

  async function pickCustom(id) {
    const api = customApi();
    const logo = mine.logos.find(item => item.id === id);
    if (!api || !logo) return;
    setStatus(`Loading ${logo.name}…`);
    try {
      const src = await api.store.dataUrl(logo);
      api.store.touch(logo.id);
      api.track('custom-logo-use', logo);
      writeLast('custom');
      finish({ source: 'custom', id: '', customId: logo.id, name: logo.name, fullName: logo.name, league: '', colors: [], src });
    } catch (error) {
      setStatus('That logo could not be loaded. Try again.');
    }
  }

  async function saveRename(id, value) {
    const api = customApi();
    if (!api || mine.editing !== id) return;
    mine.editing = '';
    try {
      const logo = await api.store.rename(id, value);
      setStatus(`Renamed to ${logo.name}.`);
    } catch (error) {
      setStatus(error.message || 'The logo could not be renamed.');
    }
    refreshMine(`[data-flp-rename="${CSS.escape(id)}"]`);
  }

  async function confirmDelete(id) {
    const api = customApi();
    const logo = mine.logos.find(item => item.id === id);
    if (!api || !logo) return;
    mine.busy = id;
    refreshMine();
    try {
      await api.store.remove(id);
      mine.logos = mine.logos.filter(item => item.id !== id);
      setStatus(`${logo.name} deleted.`);
    } catch (error) {
      setStatus(error.message || 'The logo could not be deleted.');
    }
    mine.busy = '';
    mine.confirming = '';
    refreshMine();
    el.querySelector('[data-flp-pick], [data-flp-upload]')?.focus();
  }

  function readLast() {
    try { return root.localStorage.getItem(storageKey('lastSource', currentEmail)) || ''; } catch (error) { return ''; }
  }
  function writeLast(value) {
    try { root.localStorage.setItem(storageKey('lastSource', currentEmail), value); } catch (error) { /* per-browser */ }
  }

  function pickUpload(key) {
    const item = view.uploads.find(upload => 'upload:' + upload.key === key);
    if (!item) return;
    finish({ source: 'upload', id: '', name: item.name, fullName: item.name, league: '', colors: [], src: item.src });
  }

  function finish(choice) {
    const handler = opts && opts.onPick;
    close();
    if (typeof handler === 'function') handler(choice);
  }

  function onClick(event) {
    const target = event.target;
    if (target.closest('[data-flp-close]')) { close(); return; }
    if (target.closest('[data-flp-retry]')) { loadMine(true); return; }
    const rename = target.closest('[data-flp-rename]');
    if (rename) { mine.editing = rename.dataset.flpRename; mine.confirming = ''; refreshMine(); return; }
    const delCustom = target.closest('[data-flp-delete-custom]');
    if (delCustom) { mine.confirming = delCustom.dataset.flpDeleteCustom; mine.editing = ''; refreshMine(`[data-flp-cancel-delete="${CSS.escape(mine.confirming)}"]`); return; }
    const yes = target.closest('[data-flp-confirm-delete]');
    if (yes) { confirmDelete(yes.dataset.flpConfirmDelete); return; }
    const no = target.closest('[data-flp-cancel-delete]');
    if (no) { const id = no.dataset.flpCancelDelete; mine.confirming = ''; refreshMine(`[data-flp-delete-custom="${CSS.escape(id)}"]`); return; }
    const chip = target.closest('[data-flp-chip]');
    if (chip) { view.chip = chip.dataset.flpChip; renderChips(); renderGrid(); return; }
    const bg = target.closest('[data-flp-bg]');
    if (bg) {
      view.dark = bg.dataset.flpBg === 'dark';
      el.querySelectorAll('[data-flp-bg]').forEach(button => button.setAttribute('aria-pressed', String(button === bg)));
      renderGrid();
      return;
    }
    const fav = target.closest('[data-flp-fav]');
    if (fav) {
      writeList('favorites', toggleFavorite(readList('favorites'), fav.dataset.flpFav));
      const scrollTop = el.querySelector('[data-flp-grid]').scrollTop;
      renderChips(); renderGrid();
      el.querySelector('[data-flp-grid]').scrollTop = scrollTop;
      el.querySelector(`[data-flp-fav="${CSS.escape(fav.dataset.flpFav)}"]`)?.focus();
      return;
    }
    const del = target.closest('[data-flp-delete]');
    if (del) {
      const key = del.dataset.flpDelete.replace(/^upload:/, '');
      deleteUpload(key).then(listUploads).then(list => { view.uploads = list; renderGrid(); setStatus('Upload deleted from this browser.'); }).catch(() => setStatus('Could not delete that upload.'));
      return;
    }
    const pick = target.closest('[data-flp-pick]');
    if (pick) {
      const key = pick.dataset.flpPick;
      if (key.startsWith('upload:')) { pickUpload(key); return; }
      if (key.startsWith('custom:')) { pickCustom(key.slice(7)); return; }
      const library = root.FrameUpLogos;
      const entry = library && library.get(key);
      if (!entry) return;
      writeList('recent', pushRecent(readList('recent'), entry.id));
      writeLast('library');
      finish(choiceFromEntry(entry, library, view.dark && !!entry.darkFile));
      return;
    }
    if (target.closest('[data-flp-upload]')) { el.querySelector('[data-flp-file]').click(); return; }
    if (target.closest('[data-flp-remove]')) {
      const handler = opts && opts.onRemove;
      close();
      if (typeof handler === 'function') handler();
    }
  }

  function onFile(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = '';
    const api = customApi();
    if (api) { uploadCustom(api, file); return; }
    const problem = validateUpload(file);
    if (problem) { setStatus(problem); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      let src = String(reader.result || '');
      // SVGs become a PNG so every template (and its data checks) can use them.
      if (file.type === 'image/svg+xml') {
        try { src = await rasterize(src); } catch (error) { setStatus('That SVG could not be read. Try a PNG.'); return; }
      }
      const name = file.name.replace(/\.[a-z0-9]+$/i, '') || 'Uploaded logo';
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const record = { key: userKey(currentEmail) + ':' + id, user: userKey(currentEmail), id, name, src, addedAt: Date.now() };
      saveUpload(record).catch(() => { /* still usable in this design */ }).finally(() => {
        finish({ source: 'upload', id: '', name, fullName: name, league: '', colors: [], src });
      });
    };
    reader.onerror = () => setStatus('Could not read that logo.');
    reader.readAsDataURL(file);
  }

  // Upload -> square crop -> saved to My logos -> placed.
  async function uploadCustom(api, file) {
    const problem = api.helpers.validateFile(file);
    if (problem) { setStatus(problem); return; }
    let saved = null;
    try {
      const result = await api.openCrop(file, {
        title: 'Crop your logo',
        onSave: async crop => { saved = await api.store.add(crop); },
      });
      if (!result || !saved) { el.querySelector('[data-flp-upload]')?.focus(); return; }
    } catch (error) {
      setStatus(error.message || 'That logo could not be used.');
      return;
    }
    mine.logos = mine.logos.filter(item => item.id !== saved.id).concat(saved);
    mine.mode = api.store.mode;
    mine.note = api.store.note;
    if (mine.status !== 'ready') mine.status = 'ready';
    view.chip = 'uploads';
    renderChips();
    await pickCustom(saved.id);
  }

  function rasterize(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || 512;
        const h = img.naturalHeight || 512;
        const k = 512 / Math.max(w, h);
        const canvas = doc.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * k));
        canvas.height = Math.max(1, Math.round(h * k));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  function focusables() {
    return Array.from(el.querySelectorAll('button:not([hidden]), input:not([hidden]):not([type="file"])')).filter(node => node.offsetParent !== null);
  }

  function onKeydown(event) {
    const renaming = event.target.closest && event.target.closest('[data-flp-rename-input]');
    if (renaming && (event.key === 'Enter' || event.key === 'Escape')) {
      event.preventDefault();
      event.stopPropagation();
      const id = renaming.dataset.flpRenameInput;
      if (event.key === 'Enter') saveRename(id, renaming.value);
      else { mine.editing = ''; refreshMine(`[data-flp-rename="${CSS.escape(id)}"]`); }
      return;
    }
    if (event.key === 'Escape' && mine.confirming) {
      event.preventDefault();
      event.stopPropagation();
      const id = mine.confirming;
      mine.confirming = '';
      refreshMine(`[data-flp-delete-custom="${CSS.escape(id)}"]`);
      return;
    }
    if (event.key === 'Tab') {
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    // Arrow keys move between tiles.
    const pick = event.target.closest && event.target.closest('[data-flp-pick]');
    if (pick && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      const tiles = Array.from(el.querySelectorAll('[data-flp-pick]'));
      const index = tiles.indexOf(pick);
      const grid = el.querySelector('[data-flp-grid]');
      const columns = Math.max(1, Math.round(grid.clientWidth / (pick.closest('.flp__tile').offsetWidth || 1)));
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
      const next = tiles[Math.max(0, Math.min(tiles.length - 1, index + step))];
      if (next) { event.preventDefault(); next.focus(); }
    }
  }

  function open(options) {
    opts = options || {};
    if (!el) build();
    lastFocus = doc.activeElement;
    view.query = opts.query || '';
    view.only = opts.only === 'custom' ? 'custom' : '';
    const currentIsCustom = /^data:image\//.test(String(opts.current || '')) || !!opts.customId;
    view.chip = view.only ? 'uploads'
      : (opts.league || ((!view.query && (currentIsCustom || (!opts.current && readLast() === 'custom'))) ? 'uploads' : 'all'));
    view.dark = !!opts.dark;
    mine.editing = '';
    mine.confirming = '';
    el.classList.toggle('is-only-custom', !!view.only);
    el.querySelector('[data-flp-search]').placeholder = view.only ? 'Search your logos by name' : 'Search teams, clubs, leagues: Niners, Bama, LAL';
    el.querySelector('[data-flp-note]').textContent = customApi()
      ? (view.only ? 'Square (1:1) logos saved to your FrameUp account. Only you can see them.' : 'Team logos are for editorial use. Uploads are cropped square and saved to My logos (only you see them).')
      : 'Team logos are for editorial use. Name badges (F1, ATP, WTA) are not official marks: upload the real one if you have it.';
    el.querySelector('#flp-title').textContent = opts.title || 'Choose a logo';
    el.querySelector('[data-flp-search]').value = view.query;
    el.querySelector('[data-flp-remove]').hidden = !(typeof opts.onRemove === 'function' && opts.current);
    el.querySelectorAll('[data-flp-bg]').forEach(button => button.setAttribute('aria-pressed', String((button.dataset.flpBg === 'dark') === view.dark)));
    setStatus('');
    renderChips();
    renderGrid();
    if (typeof el.showModal === 'function') { if (!el.open) el.showModal(); } else el.setAttribute('open', '');
    doc.documentElement.classList.add('flp-open');
    root.requestAnimationFrame(() => el.querySelector('[data-flp-search]').focus());
    listUploads().then(list => { view.uploads = list; if (el.open) renderGrid(); });
    loadMine(mine.status === 'error');
  }

  function close() {
    if (!el || !el.open) return;
    if (typeof el.close === 'function') el.close(); else el.removeAttribute('open');
    doc.documentElement.classList.remove('flp-open');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  root.addEventListener && root.addEventListener('es:auth-updated', () => { mine.status = 'idle'; mine.logos = []; });
  return Object.freeze({ helpers, open, close, isOpen: () => !!el && el.open });
}));
