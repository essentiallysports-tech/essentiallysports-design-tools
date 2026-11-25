// Reels Studio 2.0, lane C (inputs): the media tray.
//
// Bring your own photos and clips the easy way: drop them anywhere on the
// page, paste them (or an X post link), or pick several at once. The tray
// puts them on the scenes that take media (videos go to the hook first, file
// names are matched to the scene's words), with Undo. Uploads are kept in this
// browser (IndexedDB) so a reopened reel still has them; when a file is not
// on this device the tray asks for it again.
//
// Pure logic (also loads in Node for tests):
//   LIMITS / validate(file) / skippedMessage(errors)
//   assign(items, beats, opts)        which file goes on which scene
//   xLinkIn(text)                     an X post link in pasted text
//   createStore({ indexedDB })        the 'media' store of 'frameup-reels' v2
//   openDb(indexedDB)                 shared v2 open (vo + media stores)
//   matchMissing(missing, files)      re-added files -> the assets they replace
//
// Browser: ctx.modules.tray = { addFiles(files, { beatId }), open(), mount(el),
//   addLink(url), rehydrate(saved), missing(), items(), store }.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelMediaTray = api;
  if (typeof document !== 'undefined') api.attach();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // The page's own limits (the per-beat upload accepted exactly these).
  const MB = 1024 * 1024;
  const LIMITS = {
    maxBytes: 120 * MB,
    image: ['image/jpeg', 'image/png', 'image/webp'],
    video: ['video/mp4', 'video/quicktime', 'video/webm'],
    ext: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' },
    maxAtOnce: 24,
    storeBytes: 500 * MB,
    storeProjects: 12,
  };
  const ACCEPT = [...LIMITS.image, ...LIMITS.video].join(',');
  const extOf = name => (String(name || '').match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase() || '';
  const sizeText = bytes => (bytes >= MB ? `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const short = (name, max = 32) => { const n = String(name || 'file'); return n.length > max ? `${n.slice(0, max - 9)}…${n.slice(-8)}` : n; };

  // A file the tray can use? -> { ok, kind: 'image' | 'video', type } | { ok: false, error }
  function validate(file) {
    const name = String((file && file.name) || 'This file');
    const type = String((file && file.type) || '').toLowerCase() || LIMITS.ext[extOf(name)] || '';
    const kind = LIMITS.image.includes(type) ? 'image' : (LIMITS.video.includes(type) ? 'video' : '');
    if (!kind) {
      if (/^audio\//.test(type) || ['mp3', 'm4a', 'wav'].includes(extOf(name))) return { ok: false, reason: 'audio', error: `${short(name)} is audio. Add a voiceover under Voice and captions, or music under Music.` };
      if (/^image\//.test(type) || ['heic', 'heif', 'gif', 'avif', 'tif', 'tiff', 'bmp', 'svg'].includes(extOf(name))) return { ok: false, reason: 'type', error: `${short(name)} is a kind of image Reels Studio can't use. Save it as a JPG or PNG.` };
      if (/^video\//.test(type) || ['avi', 'mkv', 'wmv'].includes(extOf(name))) return { ok: false, reason: 'type', error: `${short(name)} is a kind of video Reels Studio can't use. Save it as an MP4.` };
      return { ok: false, reason: 'type', error: `${short(name)} is not a photo or a video.` };
    }
    const size = Number(file.size) || 0;
    if (!size) return { ok: false, reason: 'empty', error: `${short(name)} is empty.` };
    if (size > LIMITS.maxBytes) return { ok: false, reason: 'size', error: `${short(name)} is ${sizeText(size)}. Files can be up to ${sizeText(LIMITS.maxBytes)}.` };
    return { ok: true, kind, type };
  }
  function skippedMessage(errors) {
    if (!errors.length) return '';
    if (errors.length === 1) return errors[0];
    return `${errors.length} files were skipped. ${errors.slice(0, 2).join(' ')}${errors.length > 2 ? ` And ${errors.length - 2} more.` : ''}`;
  }

  // ─── Auto-assign ─────────────────────────────────────────────────────────
  const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'img', 'image', 'photo', 'video', 'clip', 'final', 'copy', 'edit', 'new', 'mov', 'mp4', 'jpg', 'jpeg', 'png', 'webp', 'screenshot', 'screen', 'shot', 'recording', 'untitled', 'export', 'reel', 'reels']);
  const tokens = text => String(text || '').toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '').split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
  // How well a file name fits a scene: shared words (a name, a team, a topic).
  function matchScore(fileName, beat) {
    const want = new Set(tokens([beat.text, beat.name, beat.vo, beat.photo].filter(Boolean).join(' ')));
    return tokens(fileName).reduce((n, t) => n + (want.has(t) ? 1 : 0), 0);
  }
  // items: [{ id, kind: 'image' | 'video', name }] in the order they were added
  // beats: [{ id, media: bool, hook: bool, locked: bool, text, name, vo }] in reel order
  //   media  the scene takes a picture (ES.takesMedia); locked: it already
  //   holds one of the person's own uploads (never replaced automatically).
  // -> { pairs: [{ item, beat, why: 'name' | 'hook' | 'order' }], left: [itemId] }
  function assign(items, beats, { match = true } = {}) {
    const free = beats.filter(b => b.media && !b.locked);
    const open = new Set(free.map(b => b.id));
    const todo = new Set(items.map(i => i.id));
    const pairs = [];
    const take = (item, beat, why) => { pairs.push({ item: item.id, beat: beat.id, why }); open.delete(beat.id); todo.delete(item.id); };
    // 1. File names that match a scene's words (best matches first).
    if (match) {
      const scored = [];
      items.forEach((item, i) => free.forEach((beat, b) => { const score = matchScore(item.name, beat); if (score > 0) scored.push({ item, beat, score, i, b }); }));
      scored.sort((x, y) => y.score - x.score || x.i - y.i || x.b - y.b).forEach(s => { if (todo.has(s.item.id) && open.has(s.beat.id)) take(s.item, s.beat, 'name'); });
    }
    // 2. The first video left goes to the hook (motion opens the reel).
    const hook = free.find(b => b.hook && open.has(b.id));
    const video = items.find(i => i.kind === 'video' && todo.has(i.id));
    if (hook && video) take(video, hook, 'hook');
    // 3. Everything else fills the open scenes in order.
    items.forEach(item => {
      if (!todo.has(item.id)) return;
      const beat = free.find(b => open.has(b.id));
      if (beat) take(item, beat, 'order');
    });
    return { pairs, left: items.filter(i => todo.has(i.id)).map(i => i.id) };
  }

  // An X post link in pasted text -> { url, handle, id } | null
  function xLinkIn(text) {
    const m = String(text || '').trim().match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:[/?#]\S*)?$/i);
    return m ? { url: `https://x.com/${m[1]}/status/${m[2]}`, handle: m[1], id: m[2] } : null;
  }

  // Re-added files -> the missing assets they stand in for (name + size, then name).
  function matchMissing(missing, files) {
    const left = [...missing];
    const pairs = [];
    const rest = [];
    const pull = test => file => { const i = left.findIndex(m => test(m, file)); if (i < 0) return false; pairs.push({ missing: left.splice(i, 1)[0], file }); return true; };
    const exact = pull((m, f) => m.name === f.name && Number(m.size) === Number(f.size));
    const byName = pull((m, f) => m.name === f.name);
    const loose = [];
    Array.from(files).forEach(file => { if (!exact(file)) loose.push(file); });
    loose.forEach(file => { if (!byName(file)) rest.push(file); });
    return { pairs, rest, left };
  }

  // ─── Persistence: IndexedDB 'frameup-reels' v2 ───────────────────────────
  // v1 had one store, 'vo' (the AI voice cache, reel-maker.js). v2 adds
  // 'media': the person's own uploads and voiceover, keyed projectId/assetId.
  const DB_NAME = 'frameup-reels';
  const DB_VERSION = 2;
  const USED = '~used'; // projectId/~used: when the project was last opened (LRU)
  function openDb(idb, { timeoutMs = 4000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!idb) { reject(new Error('no-indexeddb')); return; }
      let done = false;
      const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); fn(value); };
      // Another tab still on v1 can block the upgrade: give up quietly (nothing is lost, uploads just stay in this tab).
      const timer = setTimeout(() => finish(reject, new Error('blocked')), timeoutMs);
      let req;
      try { req = idb.open(DB_NAME, DB_VERSION); } catch (error) { finish(reject, error); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        ['vo', 'media'].forEach(name => { if (!db.objectStoreNames.contains(name)) db.createObjectStore(name); });
      };
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => { try { db.close(); } catch { /* closed */ } }; finish(resolve, db); };
      req.onerror = () => finish(reject, req.error || new Error('open failed'));
    });
  }
  const wait = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const keyOf = (projectId, assetId) => `${projectId}/${assetId}`;
  const splitKey = key => { const s = String(key); const i = s.indexOf('/'); return i < 0 ? ['', s] : [s.slice(0, i), s.slice(i + 1)]; };

  function createStore({ indexedDB: idb, now = () => Date.now(), maxBytes = LIMITS.storeBytes, maxProjects = LIMITS.storeProjects } = {}) {
    let dbp = null;
    const db = () => dbp || (dbp = openDb(idb).catch(error => { dbp = null; throw error; }));
    const run = async (mode, fn) => { const d = await db(); return fn(d.transaction('media', mode).objectStore('media')); };
    const api = {
      available: () => Boolean(idb),
      // -> true when saved. Never throws: an upload that cannot be saved still works in this tab.
      async put(projectId, assetId, blob, meta = {}) {
        if (!projectId || !assetId || !blob) return false;
        try {
          await run('readwrite', store => Promise.all([
            wait(store.put({ blob, name: String(meta.name || ''), type: String(meta.type || blob.type || ''), kind: String(meta.kind || ''), size: Number(meta.size ?? blob.size) || 0, at: now() }, keyOf(projectId, assetId))),
            wait(store.put({ at: now() }, keyOf(projectId, USED))),
          ]));
          return true;
        } catch { return false; }
      },
      async get(projectId, assetId) {
        try { return (await run('readonly', store => wait(store.get(keyOf(projectId, assetId))))) || null; } catch { return null; }
      },
      async remove(projectId, assetId) {
        try { await run('readwrite', store => wait(store.delete(keyOf(projectId, assetId)))); return true; } catch { return false; }
      },
      // The project was opened: it is the most recently used.
      async touch(projectId) {
        try { await run('readwrite', store => wait(store.put({ at: now() }, keyOf(projectId, USED)))); return true; } catch { return false; }
      },
      // -> [{ projectId, bytes, used, keys: [key] }] most recently used first
      async projects() {
        try {
          const [keys, values] = await run('readonly', store => Promise.all([wait(store.getAllKeys()), wait(store.getAll())]));
          const map = new Map();
          keys.forEach((key, i) => {
            const [projectId, assetId] = splitKey(key);
            const value = values[i] || {};
            const p = map.get(projectId) || { projectId, bytes: 0, used: 0, keys: [] };
            p.keys.push(key);
            p.used = Math.max(p.used, Number(value.at) || 0);
            if (assetId !== USED) p.bytes += Number(value.size) || 0;
            map.set(projectId, p);
          });
          return [...map.values()].sort((a, b) => b.used - a.used);
        } catch { return []; }
      },
      // Least recently used projects go first: past maxProjects, or while the
      // store holds more than maxBytes. The open project is never removed.
      async evict(keepProjectId = '') {
        const list = await api.projects();
        const keep = [];
        const drop = [];
        let bytes = 0;
        // The open project first, then by last use.
        [...list.filter(p => p.projectId === keepProjectId), ...list.filter(p => p.projectId !== keepProjectId)].forEach(p => {
          const fits = p.projectId === keepProjectId || (keep.length < maxProjects && bytes + p.bytes <= maxBytes);
          if (fits) { keep.push(p); bytes += p.bytes; } else drop.push(p);
        });
        if (!drop.length) return [];
        try {
          await run('readwrite', store => Promise.all(drop.flatMap(p => p.keys.map(key => wait(store.delete(key))))));
          return drop.map(p => p.projectId);
        } catch { return []; }
      },
    };
    return api;
  }

  // ─── Browser ─────────────────────────────────────────────────────────────
  function attach() {
    const start = ctx => {
      if (!ctx || ctx.modules.tray) return;
      const { state } = ctx;
      const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
      // Lucide icons (ISC licence).
      const ICON = {
        upload: svg('<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'),
        x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
        film: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>'),
        image: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
        warn: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
      };
      const RIGHTS = { source: 'Uploaded by you', licence: 'You confirmed ES may use it', organic: true, paid: true, credit: '' };
      const store = createStore({ indexedDB: window.indexedDB });
      let items = []; // [{ id, kind, name, size, type }] in the order added (the assets live in state.assets)
      let missing = []; // [{ id, kind, name, size, beats: [beatId] }] local files that are not on this device
      let seq = 0;
      let lastPlan = state.plan;
      let host = null;
      let busy = 0;

      const loadImage = src => new Promise(resolve => { const img = new Image(); img.decoding = 'async'; img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });
      const esStyle = () => Boolean(ctx.ES && state.timeline && state.timeline.style === 'es' && !(ctx.F.isDataFormat && ctx.F.isDataFormat(state.plan && state.plan.format)));
      const takes = beat => (esStyle() ? ctx.ES.takesMedia(beat) : beat.kind !== 'cta');
      const beatsNow = () => (state.plan ? state.plan.beats : []);
      const beatNo = id => beatsNow().findIndex(b => b.id === id) + 1;
      const usedOn = id => beatsNow().filter(b => (state.photos[b.id] || []).some(a => a === id || a.startsWith(`${id}@`))).map(b => b.id);
      const isOwn = id => Boolean(state.assets[id] && state.assets[id].local);
      const sceneList = ids => { const n = ids.map(beatNo).filter(Boolean).sort((a, b) => a - b); return n.length === 1 ? `scene ${n[0]}` : `scenes ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`; };
      const refresh = () => { if (state.plan) { ctx.rebuild(); ctx.renderBeats(); } else render(); };

      // One file -> an asset the renderer can draw. -> item | null
      async function makeAsset(file, check, id = '', fileName = '') {
        const assetId = id || `up:${Date.now().toString(36)}${(seq += 1).toString(36)}`;
        const meta = { local: true, name: fileName || file.name || 'file', size: file.size, type: check.type };
        if (check.kind === 'video') {
          if (!await ctx.addClipAsset(assetId, { blob: file, label: `Your clip: ${meta.name.slice(0, 40)}`, rights: { ...RIGHTS } })) return null;
          Object.assign(state.assets[assetId], meta);
        } else {
          const url = URL.createObjectURL(file);
          const img = await loadImage(url);
          if (!img) { URL.revokeObjectURL(url); return null; }
          state.images[assetId] = img;
          state.assets[assetId] = { kind: 'upload', label: `Your image: ${meta.name.slice(0, 40)}`, src: url, rights: { ...RIGHTS }, ...meta };
        }
        // project: the reel it was added to; waiting: added before any reel existed.
        return { id: assetId, kind: check.kind, name: meta.name, size: meta.size, type: meta.type, project: state.projectId, waiting: !state.plan };
      }
      const place = (beatId, item) => ctx.setVisual(beatId, [item.id], item.kind === 'video' ? 'upload-clip' : 'upload');
      const keep = (item, file) => store.put(state.projectId, item.id, file, { name: item.name, type: item.type, kind: item.kind, size: item.size });

      // Puts unused tray items on the scenes that take media. -> pairs
      function autoAssign(list) {
        if (!state.plan || !list.length) return [];
        const beats = beatsNow().map((beat, i) => ({
          id: beat.id, media: takes(beat), hook: i === 0, text: beat.text, name: beat.name, vo: beat.vo, photo: beat.photo,
          locked: (state.photos[beat.id] || []).some(isOwn),
        }));
        const { pairs } = assign(list, beats);
        pairs.forEach(pair => { const item = list.find(i => i.id === pair.item); item.waiting = false; place(pair.beat, item); });
        return pairs;
      }
      function undoable(before, message) {
        ctx.toast(message, { action: { label: 'Undo', run: () => {
          Object.entries(before).forEach(([beatId, was]) => {
            if (was.photos) state.photos[beatId] = was.photos; else delete state.photos[beatId];
            if (was.src) state.visualSrc[beatId] = was.src; else delete state.visualSrc[beatId];
          });
          refresh();
          ctx.toast('Undone. Your files are still in the tray.');
        } } });
      }
      const remember = beatIds => Object.fromEntries(beatIds.map(id => [id, { photos: state.photos[id] ? [...state.photos[id]] : null, src: state.visualSrc[id] || '' }]));

      // The one way files come in: drop, paste, the picker and the per-beat Upload button.
      async function addFiles(fileList, { beatId = '', via = 'picker' } = {}) {
        let files = Array.from(fileList || []).filter(Boolean);
        if (!files.length) return { added: [], skipped: [] };
        const errors = [];
        if (files.length > LIMITS.maxAtOnce) { errors.push(`Only the first ${LIMITS.maxAtOnce} files were added (${files.length} at once is too many).`); files = files.slice(0, LIMITS.maxAtOnce); }
        // Files this reel is waiting for go back where they were.
        let restored = [];
        if (missing.length && !beatId) {
          const m = matchMissing(missing, files);
          restored = m.pairs;
          files = m.rest;
        }
        busy += 1;
        render();
        const added = [];
        const before = remember(beatsNow().map(b => b.id));
        try {
          for (const pair of restored) {
            const check = validate(pair.file);
            const item = check.ok ? await makeAsset(pair.file, check, pair.missing.id) : null;
            if (!item) { errors.push(check.ok ? `${short(pair.file.name)} could not be read.` : check.error); continue; }
            missing = missing.filter(m => m !== pair.missing);
            items = [...items.filter(i => i.id !== item.id), item];
            (pair.missing.beats || []).filter(id => beatsNow().some(b => b.id === id)).forEach(id => place(id, item));
            keep(item, pair.file);
            added.push(item);
          }
          const fresh = [];
          for (const file of files) {
            const check = validate(file);
            if (!check.ok) { errors.push(check.error); continue; }
            const item = await makeAsset(file, check);
            if (!item) { errors.push(check.kind === 'video' ? `${short(file.name)} could not be read. Try an MP4.` : `${short(file.name)} could not be read.`); continue; }
            items.push(item);
            fresh.push(item);
            added.push(item);
            keep(item, file);
          }
          let placedOn = restored.flatMap(p => p.missing.beats || []);
          if (fresh.length && state.plan) {
            const target = beatId && beatsNow().find(b => b.id === beatId);
            if (target) { place(target.id, fresh[0]); placedOn.push(target.id); placedOn.push(...autoAssign(fresh.slice(1)).map(p => p.beat)); } else placedOn.push(...autoAssign(fresh).map(p => p.beat));
          }
          placedOn = [...new Set(placedOn)].filter(id => beatNo(id));
          if (added.length) {
            const n = added.length;
            const what = `${n} file${n === 1 ? '' : 's'}`;
            if (!state.plan) ctx.toast(`${what} ready. ${n === 1 ? 'It goes' : 'They go'} onto your scenes when the reel is made.`);
            else if (!placedOn.length) ctx.toast(`${what} added to the tray. Every scene already has one of your files: pick a scene for ${n === 1 ? 'it' : 'them'} in the tray.`);
            else if (beatId && n === 1) ctx.toast(`Added to scene ${beatNo(beatId)}.`);
            else undoable(before, `Added ${what} to ${sceneList(placedOn)}.${n > placedOn.length ? ` ${n - placedOn.length} left in the tray.` : ''}`);
            store.evict(state.projectId);
            ctx.logEvent('media_add', { count: n, images: added.filter(i => i.kind === 'image').length, videos: added.filter(i => i.kind === 'video').length, via, assigned: placedOn.length, readded: restored.length, skipped: errors.length });
          }
        } finally {
          busy -= 1;
          if (errors.length) ctx.toast(skippedMessage(errors), { tone: 'error' });
          refresh();
          render();
        }
        return { added, skipped: errors };
      }

      // A pasted X post link -> the existing rights-checked clip path (useXClip).
      async function addLink(text, { beatId = '' } = {}) {
        const link = xLinkIn(text);
        if (!link) return false;
        if (!state.plan) { ctx.toast('Make your reel first, then paste the X link to put that clip on a scene.', { tone: 'error' }); return false; }
        if (!window.ESAuth || !window.ESAuth.fetchWithAuth) { ctx.toast('Sign-in is still loading. Try again in a moment.', { tone: 'error' }); return false; }
        const target = beatsNow().find(b => b.id === (beatId || state.selected) && takes(b)) || beatsNow().find(b => takes(b) && !(state.photos[b.id] || []).some(isOwn)) || beatsNow().find(takes);
        if (!target) { ctx.toast('No scene in this reel takes a clip.', { tone: 'error' }); return false; }
        busy += 1;
        render();
        try {
          const response = await window.ESAuth.fetchWithAuth('/api/video-ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'clip', url: link.url }) });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data || data.ok === false) throw new Error((data && data.error) || 'That X post could not be loaded.');
          const before = remember([target.id]);
          const ok = await ctx.useXClip(target.id, { url: data.url || link.url, variants: data.variants || [], handle: data.handle || link.handle });
          if (!ok) throw new Error('That X post has no video Reels Studio can use.');
          ctx.rebuild();
          ctx.renderBeats();
          undoable(before, `X clip from @${data.handle || link.handle} added to scene ${beatNo(target.id)}.`);
          ctx.logEvent('media_add', { count: 1, images: 0, videos: 1, via: 'x-link', assigned: 1, readded: 0, skipped: 0 });
          return true;
        } catch (error) {
          ctx.toast(/fetch|network/i.test(error.message || '') ? 'The clip server is not reachable. Upload the clip instead.' : (error.message || 'That X post could not be loaded.'), { tone: 'error' });
          return false;
        } finally { busy -= 1; render(); }
      }

      function moveTo(itemId, beatId) {
        const item = items.find(i => i.id === itemId);
        if (!item || !state.plan) return;
        const from = usedOn(itemId);
        const before = remember([...from, beatId].filter(Boolean));
        from.forEach(id => { delete state.photos[id]; delete state.visualSrc[id]; });
        if (beatId) place(beatId, item);
        refresh();
        if (beatId) undoable(before, `${short(item.name, 24)} is on scene ${beatNo(beatId)}.`);
        else if (from.length) { ctx.fillVisuals({ only: from }).then(() => refresh()).catch(() => {}); ctx.toast(`${short(item.name, 24)} taken off ${sceneList(from)}.`); }
        announce(beatId ? `${item.name} moved to scene ${beatNo(beatId)}.` : `${item.name} is not used.`);
      }
      function removeItem(itemId) {
        const item = items.find(i => i.id === itemId);
        if (!item) return;
        const from = usedOn(itemId);
        from.forEach(id => { delete state.photos[id]; delete state.visualSrc[id]; });
        items = items.filter(i => i.id !== itemId);
        const asset = state.assets[itemId];
        if (asset && asset.src && asset.src.startsWith('blob:')) { try { URL.revokeObjectURL(asset.src); } catch { /* gone */ } }
        delete state.assets[itemId];
        delete state.images[itemId];
        delete state.videos[itemId];
        store.remove(state.projectId, itemId);
        if (from.length && state.plan) ctx.fillVisuals({ only: from }).then(() => refresh()).catch(() => {});
        refresh();
        render();
        announce(`${item.name} removed.`);
      }

      // A reopened reel: uploads come back from this browser; the ones that are
      // not here are listed so the person can add them again. Runs BEFORE the
      // page drops picks whose media is gone.
      async function rehydrate(saved = {}) {
        items = [];
        missing = Array.isArray(saved.mediaMissing) ? saved.mediaMissing.filter(m => m && m.id && !state.assets[m.id]).map(m => ({ id: String(m.id), kind: m.kind === 'video' ? 'video' : 'image', name: String(m.name || 'file'), size: Number(m.size) || 0, project: state.projectId, beats: Array.isArray(m.beats) ? m.beats.map(String) : [] })) : [];
        const local = Object.entries(state.assets).filter(([, a]) => a && a.local);
        store.touch(state.projectId);
        for (const [id, asset] of local) {
          const kind = asset.kind === 'clip' ? 'video' : 'image';
          const rec = await store.get(state.projectId, id);
          let item = null;
          if (rec && rec.blob) {
            const name = asset.name || rec.name || 'file';
            try { item = await makeAsset(rec.blob, { kind, type: asset.type || rec.type || rec.blob.type }, id, name); } catch { item = null; }
            if (item && kind === 'video' && asset.clipIn != null) state.assets[id].clipIn = asset.clipIn;
          }
          if (item) { item.waiting = false; items.push(item); } else {
            missing.push({ id, kind, name: asset.name || 'file', size: Number(asset.size) || 0, project: state.projectId, beats: Object.keys(state.photos).filter(b => (state.photos[b] || []).includes(id)) });
            delete state.assets[id];
          }
        }
        lastPlan = state.plan;
        render();
        if (missing.length) ctx.toast(`${missing.length} of your file${missing.length === 1 ? ' is' : 's are'} not on this device.`, { action: { label: `Re-add ${missing.length} file${missing.length === 1 ? '' : 's'}`, run: () => open() } });
        return { restored: items.length, missing: missing.length };
      }

      // ── The tray strip ──
      const live = document.createElement('div');
      live.className = 'es-sr-only';
      live.setAttribute('aria-live', 'polite');
      document.body.append(live);
      const announce = text => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); };
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.multiple = true;
      picker.accept = ACCEPT;
      picker.className = 'es-sr-only';
      picker.tabIndex = -1;
      picker.setAttribute('aria-hidden', 'true');
      picker.id = 'ri-tray-file';
      document.body.append(picker);
      picker.addEventListener('change', () => { const files = Array.from(picker.files || []); picker.value = ''; addFiles(files, { via: 'picker' }); });
      function open() { picker.click(); }

      function thumbHtml(item) {
        const img = state.images[item.id];
        return `<span class="ri-tray__thumb" data-ri-thumb="${esc(item.id)}">${img && img.src ? `<img src="${esc(img.src)}" alt="">` : (item.kind === 'video' ? ICON.film : ICON.image)}${item.kind === 'video' ? `<span class="ri-tray__badge">${ICON.film}</span>` : ''}</span>`;
      }
      function render() {
        if (!host) return;
        const beats = beatsNow();
        const targets = beats.filter(takes);
        const any = items.length || missing.length;
        host.hidden = false;
        host.classList.toggle('is-empty', !any);
        host.innerHTML = `<div class="ri-tray__head">
            <div><h3 class="ri-tray__title">Your media${items.length ? ` <span class="ri-tray__count">${items.length}</span>` : ''}</h3>
            <p class="rm-hint">${any ? 'Pick a scene for each file, or drag it onto a scene.' : 'Drop photos and clips anywhere on this page, paste them (or an X post link), or pick files.'}</p></div>
            <button class="es-btn es-btn--sm" type="button" data-ri-open ${busy ? 'aria-busy="true"' : ''}>${ICON.upload}<span>${busy ? 'Adding…' : 'Add files'}</span></button>
          </div>
          ${missing.length ? `<div class="ri-tray__missing" role="status">${ICON.warn}<p><b>${missing.length} file${missing.length === 1 ? '' : 's'} from this reel ${missing.length === 1 ? 'is' : 'are'} not on this device.</b> ${esc(missing.slice(0, 3).map(m => short(m.name, 28)).join(', '))}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}. Add ${missing.length === 1 ? 'it' : 'them'} again and ${missing.length === 1 ? 'it goes' : 'they go'} back on ${missing.length === 1 ? 'its scene' : 'their scenes'}.</p><button class="es-btn es-btn--sm" type="button" data-ri-open>Re-add ${missing.length} file${missing.length === 1 ? '' : 's'}</button><button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-ri-forget>Skip</button></div>` : ''}
          ${items.length ? `<ul class="ri-tray__list" aria-label="Your media">${items.map(item => {
            const on = usedOn(item.id);
            const sel = on[0] || '';
            return `<li class="ri-tray__item${on.length ? ' is-used' : ''}" draggable="${state.plan ? 'true' : 'false'}" data-ri-item="${esc(item.id)}">
              ${thumbHtml(item)}
              <div class="ri-tray__meta"><p class="ri-tray__name" title="${esc(item.name)}">${esc(short(item.name, 28))}</p>
              ${state.plan ? `<label class="es-sr-only" for="ri-tray-sel-${esc(item.id)}">Scene for ${esc(item.name)}</label>
              <select class="es-select ri-tray__select" id="ri-tray-sel-${esc(item.id)}" data-ri-move="${esc(item.id)}"><option value=""${sel ? '' : ' selected'}>Not used</option>${targets.map(b => `<option value="${esc(b.id)}"${b.id === sel ? ' selected' : ''}>Scene ${beatNo(b.id)}${beatNo(b.id) === 1 ? ' (hook)' : ''}</option>`).join('')}</select>` : '<p class="rm-hint">Waiting for your reel</p>'}</div>
              <button class="rm-icon-btn rm-icon-btn--sm ri-tray__remove" type="button" data-ri-remove="${esc(item.id)}" aria-label="Remove ${esc(item.name)}" title="Remove">${ICON.x}</button>
            </li>`;
          }).join('')}</ul>` : ''}`;
        // Clip posters are canvases: draw them in.
        host.querySelectorAll('[data-ri-thumb]').forEach(el => {
          const img = state.images[el.dataset.riThumb];
          if (img && img.tagName === 'CANVAS') { const c = document.createElement('canvas'); c.width = 96; c.height = 96; const k = Math.max(96 / img.width, 96 / img.height); c.getContext('2d').drawImage(img, (96 - img.width * k) / 2, (96 - img.height * k) / 2, img.width * k, img.height * k); el.querySelector('svg')?.remove(); el.prepend(c); }
        });
      }
      function mount(el) {
        if (!el) return null;
        host = el;
        host.classList.add('ri-tray');
        host.setAttribute('role', 'region');
        host.setAttribute('aria-label', 'Your media');
        host.addEventListener('click', event => {
          if (event.target.closest('[data-ri-open]')) { open(); return; }
          if (event.target.closest('[data-ri-forget]')) { missing = []; refresh(); render(); return; }
          const rm = event.target.closest('[data-ri-remove]');
          if (rm) { removeItem(rm.dataset.riRemove); host.querySelector('[data-ri-open]')?.focus(); }
        });
        host.addEventListener('change', event => {
          const sel = event.target.closest('[data-ri-move]');
          if (!sel) return;
          const id = sel.dataset.riMove;
          moveTo(id, sel.value);
          document.getElementById(`ri-tray-sel-${id}`)?.focus();
        });
        host.addEventListener('dragstart', event => {
          const li = event.target.closest('[data-ri-item]');
          if (!li || !event.dataTransfer) return;
          event.dataTransfer.setData('application/x-ri-asset', li.dataset.riItem);
          event.dataTransfer.setData('text/plain', '');
          event.dataTransfer.effectAllowed = 'move';
          document.body.classList.add('ri-dragging-item');
        });
        host.addEventListener('dragend', () => { document.body.classList.remove('ri-dragging-item'); clearDropMark(); });
        render();
        return host;
      }

      // ── Drop anywhere ──
      const overlay = document.createElement('div');
      overlay.className = 'ri-drop';
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML = `<div class="ri-drop__card">${ICON.upload}<p class="ri-drop__title">Drop to add to your reel</p><p class="ri-drop__copy" data-ri-drop-copy></p></div>`;
      document.body.append(overlay);
      let depth = 0;
      let marked = null;
      const hasFiles = event => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes('Files');
      const hasItem = event => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes('application/x-ri-asset');
      const beatAt = target => {
        const el = target && target.closest ? target.closest('[data-pick], [data-beat], [data-ri-beat]') : null;
        if (!el) return { el: null, id: '' };
        const id = el.dataset.pick || el.dataset.beat || el.dataset.riBeat || '';
        const beat = beatsNow().find(b => b.id === id);
        return beat && takes(beat) ? { el, id } : { el: null, id: '' };
      };
      function clearDropMark() { if (marked) marked.classList.remove('ri-drop-on'); marked = null; }
      function markDrop(el) { if (marked === el) return; clearDropMark(); marked = el; if (el) el.classList.add('ri-drop-on'); }
      const hideOverlay = () => { depth = 0; overlay.hidden = true; clearDropMark(); document.body.classList.remove('ri-dragging-item'); };
      document.addEventListener('dragenter', event => {
        if (!hasFiles(event)) return;
        depth += 1;
        overlay.hidden = false;
        overlay.querySelector('[data-ri-drop-copy]').textContent = state.plan ? 'Photos and clips go onto your scenes. Drop on a scene to choose it.' : 'Photos and clips wait in the tray until your reel is made.';
      });
      document.addEventListener('dragleave', event => { if (!hasFiles(event)) return; depth = Math.max(0, depth - 1); if (!depth) hideOverlay(); });
      document.addEventListener('dragover', event => {
        if (!hasFiles(event) && !hasItem(event)) return;
        event.preventDefault();
        const { el } = beatAt(event.target);
        markDrop(el);
        if (event.dataTransfer) event.dataTransfer.dropEffect = hasItem(event) ? (el ? 'move' : 'none') : 'copy';
      });
      document.addEventListener('drop', event => {
        const files = hasFiles(event);
        const item = hasItem(event);
        if (!files && !item) return;
        event.preventDefault();
        const { id } = beatAt(event.target);
        hideOverlay();
        if (item) { if (id) moveTo(event.dataTransfer.getData('application/x-ri-asset'), id); return; }
        addFiles(event.dataTransfer.files, { beatId: id, via: 'drop' });
      });
      window.addEventListener('blur', hideOverlay);
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && !overlay.hidden) hideOverlay(); });

      // ── Paste ──
      document.addEventListener('paste', event => {
        const data = event.clipboardData;
        if (!data) return;
        const files = Array.from(data.files || []).filter(f => /^(image|video)\//.test(f.type));
        const field = event.target && event.target.closest && event.target.closest('input, textarea, select, [contenteditable="true"]');
        if (files.length) { event.preventDefault(); addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now().toString(36)}-${i + 1}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }))), { via: 'paste' }); return; }
        if (field) return;
        const link = xLinkIn(data.getData('text/plain'));
        if (link) { event.preventDefault(); addLink(link.url); }
      });

      // A new plan: files waiting in the tray go onto its scenes.
      ctx.on('rebuild', () => {
        if (state.plan !== lastPlan) {
          const fresh = Boolean(state.plan) && !beatsNow().some(b => (state.photos[b.id] || []).some(isOwn));
          lastPlan = state.plan;
          // Another reel was opened: its tray is its own (rehydrate fills it). Files from the last reel stay with that reel.
          items = items.filter(i => i.project === state.projectId);
          missing = missing.filter(m => !m.project || m.project === state.projectId);
          // Only files added before a reel existed go on by themselves; the rest wait for the person.
          const waiting = items.filter(i => i.waiting && state.assets[i.id]);
          if (fresh && waiting.length) {
            const pairs = autoAssign(waiting);
            if (pairs.length) { setTimeout(() => { ctx.rebuild(); ctx.renderBeats(); ctx.toast(`Your ${pairs.length === 1 ? 'file is' : `${pairs.length} files are`} on ${sceneList(pairs.map(p => p.beat))}.`); }, 0); }
          }
        }
        render();
      });
      ctx.on('step', render);

      const api = { addFiles, addLink, open, mount, rehydrate, missing: () => missing.map(m => ({ ...m })), items: () => items.map(i => ({ ...i, beats: usedOn(i.id) })), moveTo, remove: removeItem, store, LIMITS };
      ctx.register('tray', api);
      // Temporary entry point (lane D places the tray in the new interface):
      // the strip sits under the preview's beat strip.
      const anchor = document.getElementById('rm-stripwrap');
      if (anchor && !document.getElementById('ri-tray')) {
        const el = document.createElement('section');
        el.id = 'ri-tray';
        anchor.after(el);
        mount(el);
      }
    };
    if (window.ReelMakerCtx) start(window.ReelMakerCtx);
    else document.addEventListener('reelmaker:ready', event => start((event.detail && event.detail.ctx) || window.ReelMakerCtx), { once: true });
  }

  return { LIMITS, ACCEPT, validate, skippedMessage, assign, matchScore, xLinkIn, matchMissing, createStore, openDb, DB_NAME, DB_VERSION, sizeText, attach };
}));
