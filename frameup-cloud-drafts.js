// FrameUp cloud drafts: your editor work follows you to any browser.
//
// The browser autosave (frameup-autosave.js) stays the source of truth: it
// saves locally first, every time. This file then copies the same work to
// your account (Supabase table frameup_drafts), about 20 s after you stop
// editing, when the tab is hidden or closed, and when the connection comes
// back. Uploaded photos stay on the device; web photos (ES Image Pool) travel
// as links, like the Gallery copy of an export.
//
// Opening the editor on another device: if your account holds a newer draft
// saved elsewhere, it opens it (empty editor) or asks which one to keep.
// Saving over a newer draft from another device asks first, too
// ("Keep this one" / "Open the newer one"). Otherwise the newest save wins.
//
// Before the database table exists, or when signed out or offline, nothing
// changes: drafts stay in this browser exactly as before.
// Drafts not touched for 30 days are removed (see the migration).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document) api.install(window);
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const TABLE = 'frameup_drafts';
  const EDITOR_KEY = 'editor';
  const DESIGN_PREFIX = 'design:';
  const DEBOUNCE_MS = 20000;
  const MAX_BYTES = 400 * 1024;
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const CLOCK_SLACK_MS = 2000;
  const RETRY_MS = [30000, 60000, 120000, 300000];
  const LIST_COLUMNS = 'draft_key,kind,workspace,variant,title,local_photos,device_id,updated_at';

  function isMissingTable(error) {
    if (!error) return false;
    const code = String(error.code || '');
    const text = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
    return code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || code === '42703'
      || /does not exist|could not find the table|schema cache/i.test(text);
  }

  function byteSize(value) {
    try {
      const text = JSON.stringify(value);
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
      return Buffer.byteLength(text, 'utf8');
    } catch (error) {
      return Infinity;
    }
  }

  const time = value => {
    const t = typeof value === 'number' ? value : Date.parse(value || '');
    return Number.isFinite(t) ? t : 0;
  };

  // ─── Sync engine (no browser globals, so it can be tested in Node) ────────
  //   getClient(): a supabase-js client or null
  //   getUser():   { id, email } of the signed-in person, or null
  //   onConflict({ key, local, remote }): 'mine' | 'theirs'
  //   onApplyRemote(row): put a remote draft into the editor
  //   onStatus(status): 'idle' | 'pending' | 'saving' | 'synced' | 'offline'
  //                     | 'signed-out' | 'error' | 'too-large' | 'off'
  function createDraftSync({
    getClient,
    getUser,
    deviceId,
    onConflict = async () => 'mine',
    onApplyRemote = () => {},
    onStatus = () => {},
    isOnline = () => true,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id),
    debounceMs = DEBOUNCE_MS,
    maxBytes = MAX_BYTES,
  } = {}) {
    const pending = new Map(); // key -> record waiting to go up
    const base = new Map();    // key -> server updated_at we last wrote or read
    let timer = null;
    let retryIndex = 0;
    let flushing = null;
    let disabled = false;
    let status = 'idle';
    let lastSyncedAt = 0;
    let conflictOpen = false;

    function setStatus(next, detail) {
      status = next;
      try { onStatus(next, detail); } catch (error) { /* UI only */ }
    }

    function schedule(ms = debounceMs) {
      if (timer) clearTimer(timer);
      timer = setTimer(() => { timer = null; flush(); }, ms);
    }

    // record: { kind, workspace, variant, title, design, localPhotos, savedAt }
    function queue(key, record, { immediate = false } = {}) {
      if (disabled || !key || !record?.design) return false;
      const size = byteSize(record.design);
      if (size > maxBytes) {
        pending.delete(key);
        setStatus('too-large', { key, size });
        return false;
      }
      pending.set(key, { ...record, size, savedAt: record.savedAt || now() });
      setStatus('pending');
      schedule(immediate ? 0 : debounceMs);
      return true;
    }

    async function context() {
      const client = await getClient();
      const user = client ? await getUser() : null;
      return client && user?.id ? { client, user } : null;
    }

    async function readMeta(client, user, key) {
      return client.from(TABLE)
        .select('updated_at,device_id')
        .eq('owner_id', user.id)
        .eq('draft_key', key)
        .maybeSingle();
    }

    async function readRow(client, user, key) {
      return client.from(TABLE)
        .select(`${LIST_COLUMNS},design`)
        .eq('owner_id', user.id)
        .eq('draft_key', key)
        .maybeSingle();
    }

    // A conflict: the cloud copy came from another device, and it is newer
    // than what this device last saw (or, never synced here, newer than
    // this device's own save).
    function isConflict(key, remote, record) {
      if (!remote || remote.device_id === deviceId) return false;
      const known = base.get(key);
      if (known) return remote.updated_at !== known && time(remote.updated_at) > time(known);
      return time(remote.updated_at) > time(record.savedAt) + CLOCK_SLACK_MS;
    }

    async function pushOne(ctx, key, record) {
      const { client, user } = ctx;
      if (record.kind !== 'design') {
        const meta = await readMeta(client, user, key);
        if (meta.error) throw meta.error;
        if (isConflict(key, meta.data, record)) {
          if (conflictOpen) return 'waiting';
          const full = await readRow(client, user, key);
          if (full.error) throw full.error;
          conflictOpen = true;
          let choice = 'mine';
          try {
            choice = await onConflict({ key, local: record, remote: full.data || meta.data });
          } finally {
            conflictOpen = false;
          }
          if (choice === 'theirs') {
            base.set(key, (full.data || meta.data).updated_at);
            if (pending.get(key) === record) pending.delete(key);
            await onApplyRemote(full.data || meta.data);
            return 'applied';
          }
          if (choice !== 'mine') return 'waiting';
        }
      }
      const row = {
        owner_id: user.id,
        owner_email: String(user.email || '').toLowerCase(),
        draft_key: key,
        kind: record.kind === 'design' ? 'design' : 'editor',
        workspace: String(record.workspace || '').slice(0, 40),
        variant: String(record.variant || '').slice(0, 120),
        title: String(record.title || '').slice(0, 200),
        design: record.design,
        local_photos: Math.max(0, Number(record.localPhotos) || 0),
        device_id: deviceId,
        size_bytes: record.size || 0,
        deleted_at: null,
      };
      const result = await client.from(TABLE)
        .upsert(row, { onConflict: 'owner_id,draft_key' })
        .select('updated_at')
        .single();
      if (result.error) throw result.error;
      base.set(key, result.data?.updated_at || new Date(now()).toISOString());
      // Only clear it if nothing newer was queued while this one was saving.
      if (pending.get(key) === record) pending.delete(key);
      return 'saved';
    }

    async function runFlush() {
      if (disabled || !pending.size) return;
      if (!isOnline()) { setStatus('offline'); return; }
      const ctx = await context().catch(() => null);
      if (!ctx) { setStatus('signed-out'); return; }
      setStatus('saving');
      let waiting = false;
      for (const [key, record] of Array.from(pending.entries())) {
        try {
          const outcome = await pushOne(ctx, key, record);
          if (outcome === 'waiting') waiting = true;
        } catch (error) {
          if (isMissingTable(error)) {
            disabled = true;
            pending.clear();
            setStatus('off');
            return;
          }
          const delay = RETRY_MS[Math.min(retryIndex, RETRY_MS.length - 1)];
          retryIndex += 1;
          setStatus('error', { message: String(error?.message || error) });
          schedule(delay);
          return;
        }
      }
      retryIndex = 0;
      lastSyncedAt = now();
      setStatus(pending.size || waiting ? 'pending' : 'synced');
      if (pending.size && !waiting) schedule();
    }

    function flush() {
      if (timer) { clearTimer(timer); timer = null; }
      if (flushing) return flushing.then(() => (pending.size && !disabled ? runFlush() : undefined));
      flushing = runFlush().finally(() => { flushing = null; });
      return flushing;
    }

    // Startup / tab comes back: a newer draft from another device?
    async function newerRemote(key, localSavedAt) {
      if (disabled) return null;
      const ctx = await context().catch(() => null);
      if (!ctx) return null;
      const { data, error } = await readRow(ctx.client, ctx.user, key);
      if (error) {
        if (isMissingTable(error)) { disabled = true; setStatus('off'); }
        return null;
      }
      if (!data) return null;
      const known = base.get(key);
      if (!known || time(data.updated_at) > time(known)) {
        const fromElsewhere = data.device_id !== deviceId;
        const newer = time(data.updated_at) > time(localSavedAt) + CLOCK_SLACK_MS;
        const fresh = now() - time(data.updated_at) < MAX_AGE_MS;
        const changedSinceSeen = !known || data.updated_at !== known;
        if (fromElsewhere && newer && fresh && changedSinceSeen) return data;
      }
      if (!known) base.set(key, data.updated_at);
      return null;
    }

    async function list() {
      if (disabled) return { ready: false, rows: [] };
      const ctx = await context().catch(() => null);
      if (!ctx) return { ready: false, rows: [], signedOut: true };
      const since = new Date(now() - MAX_AGE_MS).toISOString();
      const { data, error } = await ctx.client.from(TABLE)
        .select(LIST_COLUMNS)
        .eq('owner_id', ctx.user.id)
        .is('deleted_at', null)
        .gte('updated_at', since)
        .order('updated_at', { ascending: false })
        .limit(60);
      if (error) {
        if (isMissingTable(error)) { disabled = true; setStatus('off'); return { ready: false, rows: [] }; }
        return { ready: false, rows: [], failed: true };
      }
      return { ready: true, rows: data || [] };
    }

    async function get(key) {
      if (disabled) return null;
      const ctx = await context().catch(() => null);
      if (!ctx) return null;
      const { data, error } = await readRow(ctx.client, ctx.user, key);
      return error ? null : data;
    }

    async function remove(key) {
      pending.delete(key);
      if (disabled) return false;
      const ctx = await context().catch(() => null);
      if (!ctx) return false;
      const { error } = await ctx.client.from(TABLE).delete().eq('owner_id', ctx.user.id).eq('draft_key', key);
      if (error && isMissingTable(error)) { disabled = true; setStatus('off'); }
      if (!error) base.delete(key);
      return !error;
    }

    return {
      queue,
      flush,
      newerRemote,
      list,
      get,
      remove,
      markSeen: (key, updatedAt) => base.set(key, updatedAt),
      status: () => ({ status, lastSyncedAt, disabled, pending: pending.size }),
      isDisabled: () => disabled,
    };
  }

  // ─── Browser wiring (editor only) ─────────────────────────────────────────
  function deviceIdFor(win) {
    try {
      let id = win.localStorage.getItem('frameup.deviceId');
      if (!id) {
        id = `d-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
        win.localStorage.setItem('frameup.deviceId', id);
      }
      return id;
    } catch (error) {
      return 'd-unknown';
    }
  }

  function timeAgo(value, nowMs = Date.now()) {
    const mins = Math.round((nowMs - time(value)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(time(value)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const WORKSPACE_LABELS = { instagram: 'Social Media', youtube: 'YouTube', newsletter: 'Newsletter', reels: 'Reel Captions' };

  const STYLE = `
    .cloud-drafts { display: grid; gap: var(--es-space-2, 8px); margin: 0 0 var(--es-space-4, 16px); }
    .cloud-drafts__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--es-space-3, 12px); flex-wrap: wrap; }
    .cloud-drafts__title { margin: 0; font: 700 var(--es-type-label-size, 14px)/1.4 var(--es-font-ui, inherit); color: var(--es-ink, #0e1014); }
    .cloud-drafts__status { font-size: 13px; color: var(--es-ink-3, #646a76); }
    .cloud-drafts__status[data-tone="warn"] { color: var(--es-warn, #b25e09); }
    .cloud-drafts__note { margin: 0; font-size: 13px; color: var(--es-ink-3, #646a76); }
    .cloud-drafts__list { display: grid; gap: var(--es-space-2, 8px); }
    .cloud-drafts__skel { height: 56px; border-radius: var(--es-radius-control, 10px); }
    .recent-designs-subhead { margin: var(--es-space-2, 8px) 0 0; font: 700 var(--es-type-label-size, 14px)/1.4 var(--es-font-ui, inherit); color: var(--es-ink, #0e1014); }
    html[data-theme="dark"] .cloud-drafts__title, html[data-theme="dark"] .recent-designs-subhead { color: var(--es-ink, #f2f4f7); }
    .recent-design__thumb.is-icon { display: grid; place-items: center; color: var(--es-ink-3, #646a76); }
    .recent-design__thumb.is-icon svg { width: 22px; height: 22px; }
  `;

  const CLOUD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>';

  function install(win) {
    if (!win || win.top !== win || win.FrameUpCloudDrafts) return;
    const A = win.FrameUpAutosave;
    if (!A || typeof A.cloudSnapshot !== 'function') return;
    const doc = win.document;
    const deviceId = deviceIdFor(win);
    let lastLocalSavedAt = 0;
    let lastStatus = 'idle';
    const statusListeners = new Set();

    async function getClient() {
      const auth = win.ESAuth;
      if (!auth?.ensureSupabaseReady || !(await auth.ensureSupabaseReady())) return null;
      return auth.getSupabaseClient?.() || null;
    }
    let cachedUser = null;
    async function getUser() {
      if (cachedUser) return cachedUser;
      const client = await getClient();
      const { data } = await client.auth.getSession();
      const user = data?.session?.user;
      if (!user?.id) return null;
      cachedUser = { id: user.id, email: user.email };
      return cachedUser;
    }
    win.addEventListener('es:auth-updated', () => { cachedUser = null; });

    function toast(message, tone = 'success') {
      if (typeof win.showToast === 'function') win.showToast(message, tone);
    }

    function askWhichDraft(remote, localSavedAt) {
      return new Promise(resolve => {
        if (typeof win.showEsDialog !== 'function') { resolve('mine'); return; }
        const photos = Number(remote.local_photos || 0);
        win.showEsDialog({
          title: 'A newer version is on another device',
          body: `Your draft was saved on another device ${timeAgo(remote.updated_at)}. The version in this browser is from ${localSavedAt ? timeAgo(localSavedAt) : 'earlier'}. Which one do you want to keep working on?${photos ? ` Uploaded photos stay on the device they were added on (${photos === 1 ? '1 photo' : `${photos} photos`} to add again).` : ''}`,
          actions: [
            { label: 'Keep this one', variant: 'quiet', onClick: () => resolve('mine') },
            { label: 'Open the newer one', variant: 'primary', onClick: () => resolve('theirs') },
          ],
          onClose: () => resolve('mine'),
        });
      });
    }

    async function applyRemote(row) {
      if (!row?.design) return;
      try {
        await A.applyCloudPayload(row.design);
        lastLocalSavedAt = time(row.updated_at);
        const photos = Number(row.local_photos || 0);
        toast(photos
          ? `Opened your draft from another device. Add the ${photos === 1 ? 'photo' : `${photos} photos`} again: uploaded files stay on the device.`
          : 'Opened your draft from another device.', 'success');
      } catch (error) {
        console.warn('[cloud drafts] could not open the draft:', error);
        toast('That draft could not be opened. Your work in this browser is unchanged.', 'error');
      }
    }

    const sync = createDraftSync({
      getClient,
      getUser,
      deviceId,
      isOnline: () => win.navigator.onLine !== false,
      onConflict: ({ remote, local }) => askWhichDraft(remote, local.savedAt),
      onApplyRemote: applyRemote,
      onStatus: next => { lastStatus = next; statusListeners.forEach(fn => { try { fn(next); } catch (error) { /* UI only */ } }); },
    });

    // Every successful local save goes up (debounced).
    win.addEventListener('frameup:autosaved', event => {
      lastLocalSavedAt = event.detail?.savedAt || Date.now();
      let snapshot = null;
      try { snapshot = A.cloudSnapshot(); } catch (error) { return; }
      if (!snapshot?.payload) return;
      sync.queue(EDITOR_KEY, {
        kind: 'editor',
        workspace: snapshot.workspace || '',
        title: snapshot.title || 'Work in progress',
        design: snapshot.payload,
        localPhotos: snapshot.localPhotos || 0,
        savedAt: lastLocalSavedAt,
      });
    });

    const flushNow = () => { sync.flush().catch(() => {}); };
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') flushNow();
      else checkForNewer();
    });
    win.addEventListener('pagehide', flushNow);
    win.addEventListener('online', flushNow);

    // Opening the editor, or coming back to the tab: newer work elsewhere?
    let checking = false;
    let lastCheck = 0;
    async function checkForNewer({ initial = false } = {}) {
      if (checking || (!initial && Date.now() - lastCheck < 30000)) return;
      checking = true;
      lastCheck = Date.now();
      try {
        const remote = await sync.newerRemote(EDITOR_KEY, lastLocalSavedAt);
        if (!remote) return;
        const empty = initial && !A.hasLocalWork?.();
        const choice = empty ? 'theirs' : await askWhichDraft(remote, lastLocalSavedAt);
        sync.markSeen(EDITOR_KEY, remote.updated_at);
        if (choice === 'theirs') await applyRemote(remote);
        else if (A.cloudSnapshot) {
          // Keep this one: it becomes the newest copy everywhere.
          const snapshot = A.cloudSnapshot();
          if (snapshot?.payload) sync.queue(EDITOR_KEY, { kind: 'editor', workspace: snapshot.workspace, title: 'Work in progress', design: snapshot.payload, localPhotos: snapshot.localPhotos, savedAt: Date.now() }, { immediate: true });
        }
      } catch (error) {
        console.warn('[cloud drafts] check failed:', error);
      } finally {
        checking = false;
      }
    }

    A.restored.then(record => {
      lastLocalSavedAt = record?.savedAt || 0;
      return checkForNewer({ initial: true });
    }).catch(() => {});

    // ─── "Your drafts" in the Recent designs dialog ─────────────────────────
    function ensureStyle() {
      if (doc.getElementById('cloud-drafts-style')) return;
      const style = doc.createElement('style');
      style.id = 'cloud-drafts-style';
      style.textContent = STYLE;
      doc.head.appendChild(style);
    }

    function statusText() {
      switch (lastStatus) {
        case 'synced': return ['Synced to your account', ''];
        case 'saving': return ['Saving to your account…', ''];
        case 'pending': return ['Saved in this browser · syncing soon', ''];
        case 'offline': return ['Offline · saved in this browser, syncs when you\'re back', 'warn'];
        case 'error': return ['Couldn\'t reach your account · saved in this browser, retrying', 'warn'];
        case 'too-large': return ['Too large to sync · saved in this browser only', 'warn'];
        case 'signed-out': return ['Sign in to sync drafts', 'warn'];
        case 'off': return ['Cloud drafts aren\'t switched on yet · saved in this browser', ''];
        default: return ['Saved in this browser · syncs to your account', ''];
      }
    }

    function row({ title, meta, ariaLabel, onOpen, onRemove, removeLabel }) {
      const item = doc.createElement('div');
      item.className = 'recent-design';
      item.setAttribute('role', 'listitem');
      const open = doc.createElement('button');
      open.type = 'button';
      open.className = 'recent-design__open';
      open.setAttribute('aria-label', ariaLabel);
      const thumb = doc.createElement('span');
      thumb.className = 'recent-design__thumb is-icon';
      thumb.innerHTML = CLOUD_ICON;
      const text = doc.createElement('span');
      text.className = 'recent-design__text';
      const strong = doc.createElement('strong');
      strong.textContent = title;
      strong.title = title;
      const small = doc.createElement('small');
      small.textContent = meta;
      text.append(strong, small);
      const cta = doc.createElement('span');
      cta.className = 'recent-design__cta';
      cta.textContent = 'Open';
      open.append(thumb, text, cta);
      open.addEventListener('click', onOpen);
      item.appendChild(open);
      if (onRemove) {
        const remove = doc.createElement('button');
        remove.type = 'button';
        remove.className = 'recent-design__remove';
        remove.setAttribute('aria-label', removeLabel);
        remove.title = 'Remove from your account';
        remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          if (await onRemove()) item.remove();
          else remove.disabled = false;
        });
        item.appendChild(remove);
      }
      return item;
    }

    // Renders "Your drafts" at the top of the Recent designs dialog.
    // localIds: ids of exports already listed from this browser.
    async function renderInto(dialog, { localIds = new Set(), close } = {}) {
      ensureStyle();
      const anchor = dialog.querySelector('.recent-designs-copy');
      if (!anchor) return;
      const section = doc.createElement('section');
      section.className = 'cloud-drafts';
      section.setAttribute('aria-labelledby', 'cloud-drafts-title');
      section.innerHTML = `
        <div class="cloud-drafts__head">
          <h3 class="cloud-drafts__title" id="cloud-drafts-title">Your drafts</h3>
          <span class="cloud-drafts__status" role="status"></span>
        </div>
        <div class="cloud-drafts__list" role="list" aria-busy="true"><span class="es-skeleton cloud-drafts__skel"></span></div>
        <p class="cloud-drafts__note">Drafts sync to your account, so they open on any browser you sign in to. Uploaded photos stay on the device they were added on. Drafts not opened for 30 days are removed.</p>`;
      anchor.before(section);
      const sub = doc.createElement('h3');
      sub.className = 'recent-designs-subhead';
      sub.textContent = 'Exported on this browser';
      anchor.before(sub);
      const statusEl = section.querySelector('.cloud-drafts__status');
      const paintStatus = () => {
        const [label, tone] = statusText();
        statusEl.textContent = label;
        if (tone) statusEl.dataset.tone = tone; else delete statusEl.dataset.tone;
      };
      paintStatus();
      statusListeners.add(paintStatus);
      dialog.addEventListener('close', () => statusListeners.delete(paintStatus), { once: true });

      const list = section.querySelector('.cloud-drafts__list');
      const { ready, rows, signedOut, failed } = await sync.list();
      list.removeAttribute('aria-busy');
      list.innerHTML = '';
      paintStatus();
      if (!ready) {
        section.querySelector('.cloud-drafts__note').textContent = signedOut
          ? 'Sign in to see drafts saved on your other devices.'
          : failed
            ? 'Couldn\'t reach your account just now. Your work is still kept in this browser; reopen this list to try again.'
            : 'Cloud drafts aren\'t switched on yet. Your work is still kept in this browser.';
        list.remove();
        return;
      }
      const shown = rows.filter(item => item.draft_key === EDITOR_KEY
        ? item.device_id !== deviceId
        : !localIds.has(item.draft_key.slice(DESIGN_PREFIX.length)));
      if (!shown.length) {
        const empty = doc.createElement('p');
        empty.className = 'cloud-drafts__note';
        empty.textContent = 'Nothing from your other devices yet. Work you do here is synced as you go.';
        list.replaceWith(empty);
        return;
      }
      shown.forEach(item => {
        const isEditor = item.draft_key === EDITOR_KEY;
        const title = isEditor ? 'Work in progress' : (item.title || 'Untitled design');
        const where = item.device_id === deviceId ? 'this browser' : 'another device';
        const meta = [isEditor ? 'All workspaces' : (WORKSPACE_LABELS[item.workspace] || item.workspace), item.variant, `${where} · ${timeAgo(item.updated_at)}`].filter(Boolean).join(' · ');
        list.appendChild(row({
          title,
          meta,
          ariaLabel: `Open ${title}, saved on ${where} ${timeAgo(item.updated_at)}`,
          removeLabel: `Remove ${title} from your account`,
          onRemove: isEditor ? null : () => sync.remove(item.draft_key),
          onOpen: async () => {
            close?.();
            const full = await sync.get(item.draft_key);
            if (!full?.design) { toast('That draft could not be opened.', 'error'); return; }
            if (isEditor) {
              const choice = A.hasLocalWork?.() ? await askWhichDraft(full, lastLocalSavedAt) : 'theirs';
              if (choice === 'theirs') { sync.markSeen(EDITOR_KEY, full.updated_at); await applyRemote(full); }
              return;
            }
            try {
              await win.FrameUpDesigns?.openDesign(full.design, () => Promise.resolve(null), { title: full.title, source: 'shared' });
            } catch (error) {
              toast(error?.message || 'This design could not be opened.', 'error');
            }
          },
        }));
      });
    }

    win.FrameUpCloudDrafts = Object.freeze({
      // Exported designs: the shareable copy (web photo links only) goes up too.
      queueDesign(id, cloudPayload, meta = {}) {
        if (!id || !cloudPayload) return false;
        return sync.queue(DESIGN_PREFIX + id, {
          kind: 'design',
          workspace: cloudPayload.workspace || '',
          variant: meta.variant || '',
          title: meta.title || 'Untitled design',
          design: cloudPayload,
          localPhotos: cloudPayload.localPhotos || 0,
        }, { immediate: true });
      },
      removeDesign: id => sync.remove(DESIGN_PREFIX + id),
      renderInto,
      flush: () => sync.flush(),
      status: () => ({ ...sync.status(), deviceId }),
    });
  }

  return { createDraftSync, isMissingTable, byteSize, install, EDITOR_KEY, DESIGN_PREFIX, DEBOUNCE_MS, MAX_BYTES };
}));
