// FrameUp autosave: keeps the editor's work in this browser so a refresh,
// a closed tab or a crash never loses it.
//
// What is saved: every design state (5 Social slides, 3 YouTube variations,
// Newsletter with all its assets and infographic edits, Reels) plus the HTML
// widget forms (Desktop News Layout, Trivia, Ticker, List, List V2).
// Photos are saved too, as files in the browser's own database (IndexedDB),
// so large uploads fit. Web photos (ES Image Pool) are kept as links.
//
// Restoring goes through the same steps as Undo (apply the state, then the
// editor's own sync + render), so every template restores the way Undo does.
// If anything goes wrong, the saved copy is dropped and the editor opens
// fresh, exactly like before this feature existed.
//
// Also used by "Recent designs" / Gallery reopen (see frameup-designs.js):
// encodeValue / decodeValue turn a design (with images) into storable data.
(() => {
  'use strict';

  // Generate renders previews in a hidden copy of the editor: never save there.
  if (window.top !== window) return;

  const DB_NAME = 'frameup-editor';
  const DB_VERSION = 1;
  const RECORD_KEY = 'editor';
  const SAVE_DELAY_MS = 900;
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const FORMAT = 1;
  const SKIP_RESTORE_FLAG = 'frameup.autosave.skipRestore';
  // Brief, per-render values that should never be saved or compared.
  const TRANSIENT_KEYS = new Set(['isDraggingText', 'lastTextBounds', 'textHitRects', 'dragOffsetX', 'dragOffsetY']);

  // ─── IndexedDB helpers ────────────────────────────────────────────────────
  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB is not available')); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records');
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the browser database'));
      request.onblocked = () => reject(new Error('The browser database is busy'));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Browser database write failed'));
      tx.onabort = () => reject(tx.error || new Error('Browser database write was cancelled'));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbGet(store, key) {
    const db = await openDb();
    return requestResult(db.transaction(store, 'readonly').objectStore(store).get(key));
  }

  async function dbKeys(store) {
    const db = await openDb();
    return requestResult(db.transaction(store, 'readonly').objectStore(store).getAllKeys());
  }

  async function dbGetAll(store) {
    const db = await openDb();
    const tx = db.transaction(store, 'readonly');
    const [keys, values] = await Promise.all([
      requestResult(tx.objectStore(store).getAllKeys()),
      requestResult(tx.objectStore(store).getAll()),
    ]);
    return keys.map((key, index) => ({ key, value: values[index] }));
  }

  // ─── Image handling ───────────────────────────────────────────────────────
  // Each local image (upload, pasted file) gets an id and is stored once.
  const imageIdByElement = new WeakMap();
  const imageIdBySrc = new Map();
  const storedImageIds = new Set();
  let imageCounter = 0;

  function newImageId() {
    imageCounter += 1;
    return `img-${Date.now().toString(36)}-${imageCounter}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function isWebUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
  }

  function isLocalUrl(value) {
    return /^(blob:|data:image\/)/i.test(String(value || ''));
  }

  function localImageId(src, element) {
    if (element && imageIdByElement.has(element)) return imageIdByElement.get(element);
    let id = imageIdBySrc.get(src);
    if (!id) {
      id = newImageId();
      imageIdBySrc.set(src, id);
    }
    if (element) imageIdByElement.set(element, id);
    return id;
  }

  // Turns a value (state object, design, builder form) into plain data.
  // Images become { __img: ... } and local file links { __file: id }.
  // `needed` collects the local files to store: id -> source url/element.
  function encodeValue(value, needed, options = {}, depth = 0) {
    if (depth > 40) return null;
    if (value == null || typeof value !== 'object') {
      if (typeof value === 'string' && value.startsWith('blob:')) {
        if (options.webOnly) return '';
        const id = localImageId(value, null);
        needed.set(id, { src: value });
        return { __file: id };
      }
      if (typeof value === 'function') return undefined;
      return value;
    }
    if (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) {
      const src = value.currentSrc || value.src || '';
      if (isWebUrl(src)) return { __img: { url: src, cors: value.crossOrigin || null } };
      if (!isLocalUrl(src) || options.webOnly) return null;
      const id = localImageId(src, value);
      needed.set(id, { src });
      return { __img: { id } };
    }
    if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) {
      if (options.webOnly) return null;
      const id = imageIdByElement.get(value) || newImageId();
      imageIdByElement.set(value, id);
      needed.set(id, { canvas: value });
      return { __img: { id } };
    }
    if (Array.isArray(value)) return value.map(item => {
      const encoded = encodeValue(item, needed, options, depth + 1);
      return encoded === undefined ? null : encoded;
    });
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      // Anything else (Map, class instance …) is not part of a design: skip it.
      return null;
    }
    const out = {};
    Object.keys(value).forEach(key => {
      if (TRANSIENT_KEYS.has(key)) return;
      const encoded = encodeValue(value[key], needed, options, depth + 1);
      if (encoded !== undefined) out[key] = encoded;
    });
    return out;
  }

  function sourceToBlob(entry) {
    if (entry.canvas) {
      return new Promise(resolve => {
        try { entry.canvas.toBlob(blob => resolve(blob || null), 'image/png'); } catch (error) { resolve(null); }
      });
    }
    return fetch(entry.src).then(response => (response.ok ? response.blob() : null)).catch(() => null);
  }

  // Loads every image in an encoded value. Returns a lookup used by decodeValue.
  async function loadImagesFor(encoded, getBlob) {
    const refs = [];
    (function collect(value) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(collect); return; }
      if (value.__img) { refs.push(value.__img); return; }
      if (value.__file) { refs.push({ id: value.__file, fileOnly: true }); return; }
      Object.keys(value).forEach(key => collect(value[key]));
    }(encoded));

    const urlsById = new Map();
    const imagesByKey = new Map();
    const loadImage = (src, cors) => new Promise(resolve => {
      const img = new Image();
      if (cors || isWebUrl(src)) img.crossOrigin = cors || 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });

    for (const ref of refs) {
      if (ref.id && !urlsById.has(ref.id)) {
        const blob = await getBlob(ref.id).catch(() => null);
        urlsById.set(ref.id, blob ? URL.createObjectURL(blob) : '');
      }
    }
    await Promise.all(refs.map(async ref => {
      if (ref.fileOnly) return;
      const key = ref.id ? `id:${ref.id}` : `url:${ref.url}`;
      if (imagesByKey.has(key)) return;
      imagesByKey.set(key, null);
      const src = ref.id ? urlsById.get(ref.id) : ref.url;
      if (!src) return;
      const img = await loadImage(src, ref.id ? null : ref.cors);
      imagesByKey.set(key, img);
      if (img && ref.id) {
        imageIdByElement.set(img, ref.id);
        imageIdBySrc.set(src, ref.id);
      }
    }));
    urlsById.forEach((url, id) => { if (url) imageIdBySrc.set(url, id); });
    return { urlsById, imagesByKey };
  }

  function decodeValue(value, lookup) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => decodeValue(item, lookup));
    if (value.__img) {
      const key = value.__img.id ? `id:${value.__img.id}` : `url:${value.__img.url}`;
      return lookup.imagesByKey.get(key) || null;
    }
    if (value.__file) return lookup.urlsById.get(value.__file) || '';
    const out = {};
    Object.keys(value).forEach(key => { out[key] = decodeValue(value[key], lookup); });
    return out;
  }

  // ─── What the editor holds ────────────────────────────────────────────────
  const BUILDERS = [
    ['widget', () => widgetBuilderState],
    ['trivia', () => triviaBuilderState],
    ['ticker', () => tickerBuilderState],
    ['list', () => listBuilderState],
    ['list2', () => list2BuilderState],
  ];

  function collectEditor() {
    return {
      activeInstagramSlide,
      activeYoutubeVariation,
      activeNewsletterAsset,
      activeReelsFormat,
      states: {
        instagram: instagramSlideStates,
        youtube: youtubeVariationStates,
        newsletter: newsletterState,
        reels: reelsState,
      },
      builders: Object.fromEntries(BUILDERS.map(([name, get]) => [name, get()])),
      triviaContentEdited: typeof triviaContentEdited === 'boolean' ? triviaContentEdited : false,
    };
  }

  function signatureOf(encoded) {
    try { return JSON.stringify(encoded); } catch (error) { return String(Math.random()); }
  }

  // Signature of what someone actually made (text, photos, edited fields),
  // ignoring which template / slide / colour happened to be selected. Used
  // to decide whether "Restored your work" is worth saying.
  const NAVIGATION_KEYS = new Set([
    'activeInstagramSlide', 'activeYoutubeVariation', 'activeNewsletterAsset', 'activeReelsFormat',
    'newsletterAsset', 'postType', 'reelsFormat', 'youtubeQuote', 'newsletterBrand', 'sport', 'team',
    'pillPalette', 'pillPaletteIdx', 'randomOffsets', 'randomBottomAnchor', 'textBlockX', 'textBlockY',
    'textBlockUserMoved', 'designByContext', 'protectedPillDesignByContext', 'adjust', 'contentCategory',
  ]);
  const nonEmpty = map => (Object.keys(map).length ? map : undefined);
  function contentSignatureOf(encoded) {
    try {
      return JSON.stringify(encoded, (key, value) => {
        if (NAVIGATION_KEYS.has(key)) return undefined;
        if (key === 'textByContext' && value && typeof value === 'object') {
          return nonEmpty(Object.fromEntries(Object.entries(value).filter(([, lines]) => Array.isArray(lines) && lines.some(line => String(line).trim()))));
        }
        if (key === 'mediaByContext' && value && typeof value === 'object') {
          return nonEmpty(Object.fromEntries(Object.entries(value).filter(([, media]) => media && (media.photo || media.entityPhoto || media.entityPhoto2))));
        }
        if (key === 'infographic' && value && typeof value === 'object') {
          return nonEmpty(Object.fromEntries(Object.entries(value)
            .map(([id, store]) => [id, { values: store?.values || {}, photos: store?.photos || {} }])
            .filter(([, store]) => Object.keys(store.values).length || Object.keys(store.photos).length)));
        }
        return value;
      });
    } catch (error) {
      return String(Math.random());
    }
  }

  // ─── Saving ───────────────────────────────────────────────────────────────
  let enabled = false;
  let saveTimer = null;
  let saving = null;
  let lastSavedSignature = '';
  let defaultSignature = '';
  let lastSaveFailed = false;
  let dirty = false;

  async function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!enabled) return;
    if (saving) { await saving.catch(() => {}); }
    saving = (async () => {
      try { flushPendingTextChange?.(); } catch (error) { /* keep going */ }
      const needed = new Map();
      const payload = encodeValue(collectEditor(), needed);
      const signature = signatureOf(payload);
      if (signature === lastSavedSignature) { dirty = false; return; }
      // Nothing typed yet and nothing saved before: keep the database empty.
      if (signature === defaultSignature && !lastSavedSignature) { dirty = false; return; }
      const blobs = [];
      for (const [id, source] of needed) {
        if (storedImageIds.has(id)) continue;
        const blob = await sourceToBlob(source);
        if (blob) blobs.push([id, blob]);
      }
      const db = await openDb();
      const tx = db.transaction(['records', 'images'], 'readwrite');
      blobs.forEach(([id, blob]) => tx.objectStore('images').put(blob, id));
      tx.objectStore('records').put({ format: FORMAT, savedAt: Date.now(), payload }, RECORD_KEY);
      await txDone(tx);
      blobs.forEach(([id]) => storedImageIds.add(id));
      lastSavedSignature = signature;
      lastSaveFailed = false;
      dirty = false;
      pruneImages().catch(() => {});
    })();
    try {
      await saving;
    } catch (error) {
      lastSaveFailed = true;
      console.warn('[autosave] could not save:', error);
    } finally {
      saving = null;
    }
  }

  function schedule() {
    if (!enabled) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
  }

  // Images no longer used by the editor or by a saved design are removed.
  let pruneRunning = false;
  async function pruneImages() {
    if (pruneRunning) return;
    pruneRunning = true;
    try {
      const records = await dbGetAll('records');
      const used = new Set();
      const walk = value => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(walk); return; }
        if (value.__img?.id) used.add(value.__img.id);
        if (value.__file) used.add(value.__file);
        Object.keys(value).forEach(key => walk(value[key]));
      };
      records.forEach(({ value }) => walk(value?.payload));
      const keys = await dbKeys('images');
      const unused = keys.filter(key => !used.has(key));
      if (!unused.length) return;
      const db = await openDb();
      const tx = db.transaction('images', 'readwrite');
      unused.forEach(key => { tx.objectStore('images').delete(key); storedImageIds.delete(key); });
      await txDone(tx);
    } finally {
      pruneRunning = false;
    }
  }

  // ─── Restoring ────────────────────────────────────────────────────────────
  function assignState(target, saved) {
    if (!target || !saved || typeof saved !== 'object') return;
    Object.assign(target, saved);
    target.isDraggingText = false;
    target.lastTextBounds = null;
    target.textHitRects = [];
  }

  // Builder forms: only keys the form knows about are taken from the save, so
  // a form that gained or lost fields since the save still works.
  function mergeKnown(target, saved) {
    if (!target || !saved || typeof saved !== 'object') return;
    Object.keys(target).forEach(key => {
      if (!(key in saved)) return;
      const current = target[key];
      const next = saved[key];
      if (Array.isArray(current) && Array.isArray(next)) {
        if (current.length && typeof current[0] === 'object' && current[0] !== null) {
          current.forEach((item, index) => mergeKnown(item, next[index]));
        } else if (next.length === current.length) {
          target[key] = next.slice();
        }
      } else if (current && typeof current === 'object' && next && typeof next === 'object') {
        mergeKnown(current, next);
      } else if (typeof next === typeof current || current == null) {
        target[key] = next;
      }
    });
  }

  function syncBuilderForms(savedPickHidden) {
    document.querySelectorAll('[data-widget-field]').forEach(field => { field.value = getWidgetFieldValue(field.dataset.widgetField) ?? ''; });
    document.querySelectorAll('[data-trivia-field]').forEach(field => { field.value = getTriviaFieldValue(field.dataset.triviaField) ?? ''; });
    document.querySelectorAll('[data-ticker-field]').forEach(field => { field.value = tickerBuilderState[field.dataset.tickerField] ?? ''; });
    document.querySelectorAll('[data-list-field]').forEach(field => {
      const [, index, key] = field.dataset.listField.split('.');
      field.value = listBuilderState.items[Number(index)]?.[key] ?? '';
    });
    document.querySelectorAll('[data-list2-field]').forEach(field => {
      const [, index, key] = field.dataset.list2Field.split('.');
      field.value = list2BuilderState.items[Number(index)]?.[key] ?? '';
    });
    // Toggles and choice buttons: use their own click handlers so the UI and
    // the state change together.
    document.querySelectorAll('[data-widget-pick-toggle]').forEach(button => {
      const index = Number(button.dataset.widgetPickToggle);
      const wantHidden = savedPickHidden[index] === true;
      if ((widgetBuilderState.picks[index]?.hidden === true) !== wantHidden) button.click();
    });
    const direction = document.querySelector(`[data-ticker-direction="${tickerBuilderState.direction}"]`);
    if (direction && !direction.classList.contains('is-active')) {
      const wanted = tickerBuilderState.direction;
      direction.click();
      tickerBuilderState.direction = wanted;
    }
    ['main', 'pick0', 'pick1', 'pick2', 'pick3'].forEach(slot => { try { updateWidgetThumb(slot); } catch (error) { /* thumb only */ } });
    try { updateTriviaThumb(); } catch (error) { /* thumb only */ }
    try { updateTickerThumb(); } catch (error) { /* thumb only */ }
  }

  function resetHistory() {
    try {
      [...instagramSlideStates, ...Object.values(youtubeVariationStates), newsletterState, reelsState]
        .forEach(target => designHistory.delete(target));
    } catch (error) { /* history is optional */ }
  }

  // Re-syncs the visible editor after states changed underneath it (same steps
  // as Undo / Redo, plus a workspace re-activation for slide/variation pointers).
  // keepHistory: the change becomes one Undo step (used when opening a design).
  function resyncEditor({ keepHistory = false } = {}) {
    workspaceStates.instagram = instagramSlideStates[activeInstagramSlide];
    workspaceStates.youtube = youtubeVariationStates[activeYoutubeVariation];
    workspaceStates.newsletter = newsletterState;
    workspaceStates.reels = reelsState;
    state = workspaceStates[activeWorkspace];
    if (!keepHistory) isApplyingHistory = true;
    try {
      syncInfographicAfterHistory();
      activateWorkspace(activeWorkspace);
      const textarea = document.getElementById('pill-text');
      if (textarea) textarea.value = (state.lines || []).join('\n');
      updatePillTextHint();
      autoGrowTextarea(textarea);
      updateInstagramSlideNavigation();
      syncWorkspaceControls();
      if (activeWorkspace === 'newsletter') renderWidgetPreview();
      renderRestoredContextNow();
    } finally {
      if (!keepHistory) {
        setTimeout(() => {
          isApplyingHistory = false;
          resetHistory();
          recordDesignHistoryNow();
        }, 500);
      }
    }
  }

  // HTML widget forms (Desktop News Layout, Trivia, Ticker, List, List V2).
  function applyBuilders(builders = {}) {
    const savedPickHidden = builders.widget
      ? (builders.widget.picks || []).map(pick => pick?.hidden === true)
      : (widgetBuilderState?.picks || []).map(pick => pick?.hidden === true);
    const currentPickHidden = (widgetBuilderState?.picks || []).map(pick => pick?.hidden === true);
    BUILDERS.forEach(([name, get]) => { if (builders[name]) mergeKnown(get(), builders[name]); });
    // Pick visibility is set through the toggle buttons in syncBuilderForms.
    (widgetBuilderState?.picks || []).forEach((pick, index) => { pick.hidden = currentPickHidden[index]; });
    syncBuilderForms(savedPickHidden);
  }

  function applyEditor(saved) {
    const states = saved.states || {};
    (states.instagram || []).forEach((slide, index) => assignState(instagramSlideStates[index], slide));
    Object.keys(youtubeVariationStates).forEach(key => assignState(youtubeVariationStates[key], states.youtube?.[key]));
    assignState(newsletterState, states.newsletter);
    assignState(reelsState, states.reels);
    if (Number.isInteger(saved.activeInstagramSlide) && instagramSlideStates[saved.activeInstagramSlide]) activeInstagramSlide = saved.activeInstagramSlide;
    if (youtubeVariationStates[saved.activeYoutubeVariation]) activeYoutubeVariation = saved.activeYoutubeVariation;
    if (NEWSLETTER_ASSET_TYPES[newsletterState.newsletterAsset]) activeNewsletterAsset = newsletterState.newsletterAsset;
    else newsletterState.newsletterAsset = activeNewsletterAsset;
    if (saved.activeReelsFormat) activeReelsFormat = reelsState.reelsFormat || saved.activeReelsFormat;

    if (typeof saved.triviaContentEdited === 'boolean') triviaContentEdited = saved.triviaContentEdited;
    applyBuilders(saved.builders || {});
    resyncEditor();
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return sameDay ? time : `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
  }

  function showRestoredNote(savedAt) {
    let region = document.getElementById('es-toast-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'es-toast-region';
      region.className = 'es-toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    const toast = document.createElement('div');
    toast.className = 'es-toast is-success es-toast--action';
    const text = document.createElement('span');
    text.textContent = `Restored your work from ${formatTime(savedAt)}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'es-toast-action';
    button.textContent = 'Start fresh';
    button.addEventListener('click', () => { toast.remove(); confirmStartFresh(); });
    toast.append(text, button);
    region.appendChild(toast);
    setTimeout(() => toast.classList.add('is-leaving'), 7600);
    setTimeout(() => toast.remove(), 8000);
  }

  function confirmStartFresh() {
    showEsDialog({
      title: 'Start fresh?',
      body: 'This clears the work kept in this browser for Social Media, YouTube, Reels and Newsletter (including HTML widgets) and opens a blank editor. Your exported images are not affected. This can\'t be undone.',
      actions: [
        { label: 'Cancel', variant: 'quiet' },
        { label: 'Clear and start fresh', variant: 'primary', onClick: startFresh },
      ],
    });
  }

  async function startFresh() {
    enabled = false;
    clearTimeout(saveTimer);
    try {
      const db = await openDb();
      const tx = db.transaction('records', 'readwrite');
      tx.objectStore('records').delete(RECORD_KEY);
      await txDone(tx);
      await pruneImages().catch(() => {});
    } catch (error) { /* reload anyway */ }
    try {
      Object.keys(localStorage).filter(key => key.startsWith('frameup.infographic.')).forEach(key => localStorage.removeItem(key));
      localStorage.removeItem('es.canvasNames.v1');
    } catch (error) { /* per-browser extras only */ }
    try { sessionStorage.setItem(SKIP_RESTORE_FLAG, '1'); } catch (error) { /* ignore */ }
    window.removeEventListener('beforeunload', onBeforeUnload);
    location.reload();
  }

  async function restore() {
    let skip = false;
    try { skip = sessionStorage.getItem(SKIP_RESTORE_FLAG) === '1'; sessionStorage.removeItem(SKIP_RESTORE_FLAG); } catch (error) { skip = false; }
    if (skip) return null;
    const record = await dbGet('records', RECORD_KEY).catch(() => null);
    if (!record || record.format !== FORMAT || !record.payload) return null;
    if (Date.now() - Number(record.savedAt || 0) > MAX_AGE_MS) return null;
    // Decode fully before touching the editor, so a bad save changes nothing.
    const lookup = await loadImagesFor(record.payload, id => dbGet('images', id));
    const saved = decodeValue(record.payload, lookup);
    lookup.urlsById.forEach((url, id) => { if (url) storedImageIds.add(id); });
    applyEditor(saved);
    return record;
  }

  function onBeforeUnload(event) {
    if (!enabled) return undefined;
    if (dirty || saveTimer) saveNow();
    if (!lastSaveFailed) return undefined;
    event.preventDefault();
    event.returnValue = '';
    return '';
  }

  function whenEditorReady() {
    return new Promise(resolve => {
      const go = () => {
        const fonts = document.fonts?.ready || Promise.resolve();
        fonts.then(() => setTimeout(resolve, 120));
      };
      if (document.readyState === 'complete') go();
      else window.addEventListener('load', go, { once: true });
    });
  }

  let resolveRestored;
  const restored = new Promise(resolve => { resolveRestored = resolve; });

  async function start() {
    await whenEditorReady();
    let restoredRecord = null;
    try {
      const defaultPayload = encodeValue(collectEditor(), new Map());
      defaultSignature = signatureOf(defaultPayload);
      restoredRecord = await restore();
      if (restoredRecord) {
        lastSavedSignature = signatureOf(restoredRecord.payload);
        if (contentSignatureOf(restoredRecord.payload) !== contentSignatureOf(defaultPayload)) showRestoredNote(restoredRecord.savedAt);
      }
    } catch (error) {
      console.warn('[autosave] saved work could not be restored, starting fresh:', error);
      try {
        const db = await openDb();
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').delete(RECORD_KEY);
        await txDone(tx);
      } catch (cleanupError) { /* nothing more to do */ }
      // The editor may be half-restored: reload once into a clean editor.
      try {
        if (sessionStorage.getItem('frameup.autosave.recovered') !== '1') {
          sessionStorage.setItem('frameup.autosave.recovered', '1');
          sessionStorage.setItem(SKIP_RESTORE_FLAG, '1');
          location.reload();
          return;
        }
      } catch (storageError) { /* fall through */ }
    }
    try { sessionStorage.removeItem('frameup.autosave.recovered'); } catch (error) { /* ignore */ }
    enabled = true;
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && (dirty || saveTimer)) saveNow();
    });
    window.addEventListener('pagehide', () => { if (dirty || saveTimer) saveNow(); });
    resolveRestored(restoredRecord);
  }

  window.FrameUpAutosave = Object.freeze({
    schedule,
    saveNow,
    restored,
    // Shared with Recent designs / Gallery reopen.
    encodeValue,
    decodeValue,
    loadImagesFor,
    sourceToBlob,
    openDb,
    txDone,
    dbGet,
    dbGetAll,
    pruneImages,
    resyncEditor,
    applyBuilders,
    builderState: name => (BUILDERS.find(([key]) => key === name) || [null, () => null])[1](),
    assignState,
    markImagesStored: ids => ids.forEach(id => storedImageIds.add(id)),
    isImageStored: id => storedImageIds.has(id),
  });

  start().catch(error => {
    console.warn('[autosave] not started:', error);
    resolveRestored(null);
  });
})();
