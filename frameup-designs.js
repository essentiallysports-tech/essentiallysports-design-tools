// FrameUp designs: reopen what you exported.
//
// Every export keeps a copy of the design that was on screen:
//   * on this device (browser database, with photos), listed under
//     "Recent designs" (clock button next to Undo / Redo), last 30 kept;
//   * with the export record (text, settings and web photo links only, no
//     uploaded files), so anyone can reopen it from the Gallery.
//
// Opening a design puts it into the editor through the same steps Undo uses.
// It goes onto an empty Social slide when the current one has content, and
// the change is one Undo step, so nothing on screen is lost.
(() => {
  'use strict';

  if (window.top !== window) return;
  const A = window.FrameUpAutosave;
  if (!A) return;

  const LOCAL_PREFIX = 'design:';
  const MAX_LOCAL = 30;
  const FORMAT = 1;
  const BUILDER_FOR_ASSET = { widgets: 'widget', trivia: 'trivia', ticker: 'ticker', list: 'list', list2: 'list2' };
  const CONTEXT_MAPS = ['textByContext', 'designByContext', 'protectedPillDesignByContext', 'mediaByContext'];
  const WORKSPACE_LABELS = { instagram: 'Social Media', youtube: 'YouTube', newsletter: 'Newsletter', reels: 'Reel Captions' };

  // ─── Capture the design on screen ─────────────────────────────────────────
  function currentDesign() {
    try { flushPendingTextChange?.(); } catch (error) { /* keep going */ }
    const key = getTextContextKey();
    const copy = {};
    Object.keys(state).forEach(name => {
      if (CONTEXT_MAPS.includes(name)) {
        const map = state[name] || {};
        copy[name] = key in map ? { [key]: map[key] } : {};
      } else if (name === 'infographic') {
        const template = activeWorkspace === 'newsletter' && isInfographicAsset() ? getInfographicTemplate() : null;
        const store = template ? state.infographic?.[template.id] : null;
        copy.infographic = store ? { [template.id]: store } : {};
      } else {
        copy[name] = state[name];
      }
    });
    const builderName = activeWorkspace === 'newsletter' ? BUILDER_FOR_ASSET[activeNewsletterAsset] : null;
    return {
      format: FORMAT,
      workspace: activeWorkspace,
      youtubeVariation: activeYoutubeVariation,
      newsletterAsset: activeNewsletterAsset,
      canvasName: getCurrentCanvasName() || '',
      state: copy,
      builder: builderName ? { name: builderName, data: A.builderState(builderName) } : null,
    };
  }

  function countLocalPhotos(value, seen = new Set(), depth = 0) {
    if (!value || typeof value !== 'object' || depth > 30) return seen.size;
    if (value instanceof HTMLImageElement) {
      const src = value.currentSrc || value.src || '';
      if (!/^https?:/i.test(src)) seen.add(src);
      return seen.size;
    }
    if (Array.isArray(value)) value.forEach(item => countLocalPhotos(item, seen, depth + 1));
    else if (Object.getPrototypeOf(value) === Object.prototype) Object.keys(value).forEach(key => countLocalPhotos(value[key], seen, depth + 1));
    return seen.size;
  }

  // Called at export time. Returns the device copy (with photos) and the
  // shareable copy (web photo links only) of the design on screen.
  function capture() {
    try {
      const design = currentDesign();
      const needed = new Map();
      const local = A.encodeValue(design, needed);
      const cloud = A.encodeValue(design, new Map(), { webOnly: true });
      cloud.localPhotos = countLocalPhotos(design.state) + countLocalPhotos(design.builder);
      return { local, needed, cloud };
    } catch (error) {
      console.warn('[designs] could not capture the design:', error);
      return null;
    }
  }

  // ─── Device copies ────────────────────────────────────────────────────────
  async function storeLocal(id, captured, meta = {}) {
    if (!id || !captured) return;
    try {
      const blobs = [];
      for (const [imageId, source] of captured.needed) {
        if (A.isImageStored(imageId)) continue;
        const blob = await A.sourceToBlob(source);
        if (blob) blobs.push([imageId, blob]);
      }
      const db = await A.openDb();
      const tx = db.transaction(['records', 'images'], 'readwrite');
      blobs.forEach(([imageId, blob]) => tx.objectStore('images').put(blob, imageId));
      tx.objectStore('records').put({
        format: FORMAT,
        kind: 'design',
        id,
        savedAt: Date.now(),
        title: meta.title || 'Untitled design',
        workspace: captured.local.workspace,
        variant: meta.variant || '',
        size: meta.size || '',
        thumb: meta.thumb || '',
        payload: captured.local,
      }, LOCAL_PREFIX + id);
      await A.txDone(tx);
      A.markImagesStored(blobs.map(([imageId]) => imageId));
      await trimLocal();
    } catch (error) {
      console.warn('[designs] could not keep a copy of this design:', error);
    }
  }

  async function listLocal() {
    const rows = await A.dbGetAll('records').catch(() => []);
    return rows
      .filter(row => String(row.key).startsWith(LOCAL_PREFIX) && row.value?.kind === 'design')
      .map(row => row.value)
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  async function getLocal(id) {
    const record = await A.dbGet('records', LOCAL_PREFIX + id).catch(() => null);
    return record?.kind === 'design' ? record : null;
  }

  async function removeLocal(ids) {
    if (!ids.length) return;
    const db = await A.openDb();
    const tx = db.transaction('records', 'readwrite');
    ids.forEach(id => tx.objectStore('records').delete(LOCAL_PREFIX + id));
    await A.txDone(tx);
    await A.pruneImages().catch(() => {});
  }

  async function trimLocal() {
    const all = await listLocal();
    await removeLocal(all.slice(MAX_LOCAL).map(record => record.id));
  }

  // ─── Opening a design ─────────────────────────────────────────────────────
  function mergeIntoState(target, saved) {
    Object.keys(saved || {}).forEach(name => {
      if (CONTEXT_MAPS.includes(name) || name === 'infographic') {
        const incoming = { ...(saved[name] || {}) };
        if (name === 'infographic') {
          // Photos that could not travel (uploaded files) fall back to the template.
          Object.values(incoming).forEach(store => {
            if (!store?.photos) return;
            Object.keys(store.photos).forEach(layerId => { if (!store.photos[layerId]?.img) delete store.photos[layerId]; });
          });
        }
        target[name] = { ...(target[name] || {}), ...incoming };
      } else {
        target[name] = saved[name];
      }
    });
    target.isDraggingText = false;
    target.lastTextBounds = null;
    target.textHitRects = [];
  }

  function waitForRoute(workspace) {
    if (routeFromHash() === workspace) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { window.removeEventListener('hashchange', done); setTimeout(resolve, 60); };
      window.addEventListener('hashchange', done);
      location.hash = workspace;
      setTimeout(done, 600);
    });
  }

  async function openDesign(payload, getBlob, { title = '', source = 'device' } = {}) {
    if (!payload || payload.format !== FORMAT || !WORKSPACES[payload.workspace]) throw new Error('This design can no longer be opened.');
    const lookup = await A.loadImagesFor(payload, getBlob);
    const design = A.decodeValue(payload, lookup);
    const workspace = design.workspace;
    await waitForRoute(workspace);
    if (activeWorkspace !== workspace) activateWorkspace(workspace);

    let target;
    let movedToSlide = -1;
    if (workspace === 'instagram') {
      let index = activeInstagramSlide;
      if (slideHasContent(instagramSlideStates[index])) {
        const empty = instagramSlideStates.findIndex(slide => !slideHasContent(slide));
        if (empty >= 0) index = empty;
      }
      if (index !== activeInstagramSlide) { switchInstagramSlide(index); movedToSlide = index; }
      target = instagramSlideStates[index];
    } else if (workspace === 'youtube') {
      if (youtubeVariationStates[design.youtubeVariation] && design.youtubeVariation !== activeYoutubeVariation) switchYoutubeVariation(design.youtubeVariation);
      target = youtubeVariationStates[activeYoutubeVariation];
    } else if (workspace === 'newsletter') {
      target = newsletterState;
    } else {
      target = reelsState;
    }

    // One Undo step back to what was there before.
    try { recordDesignHistoryNow(); } catch (error) { /* history is optional */ }
    mergeIntoState(target, design.state);
    if (workspace === 'newsletter' && NEWSLETTER_ASSET_TYPES[design.newsletterAsset]) {
      newsletterState.newsletterAsset = design.newsletterAsset;
      activeNewsletterAsset = design.newsletterAsset;
    }
    if (design.builder?.name) A.applyBuilders({ [design.builder.name]: design.builder.data });
    A.resyncEditor({ keepHistory: true });
    if (workspace === 'newsletter') {
      // Switching asset rebuilds its controls (brand list, panel, canvas size).
      switchNewsletterAsset(activeNewsletterAsset);
    }
    if (design.canvasName) {
      setCurrentCanvasName(design.canvasName);
      syncCanvasNameField();
    }
    render();

    const missing = source === 'shared' ? Number(payload.localPhotos || 0) : 0;
    const where = movedToSlide >= 0 ? ` on slide ${movedToSlide + 1}` : '';
    showToast(missing
      ? `Opened${title ? ` "${title}"` : ''}${where}. Add the ${missing === 1 ? 'photo' : `${missing} photos`} again: uploaded files aren't shared.`
      : `Opened${title ? ` "${title}"` : ''}${where}. Undo goes back.`, 'success');
  }

  async function openLocal(record) {
    await openDesign(record.payload, imageId => A.dbGet('images', imageId), { title: record.title, source: 'device' });
  }

  // index.html?open=<gallery id>: open a design from the Gallery.
  async function openFromLink() {
    const params = new URLSearchParams(location.search);
    const id = params.get('open');
    if (!id) return;
    params.delete('open');
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
    try {
      const local = await getLocal(id);
      if (local) { await openLocal(local); return; }
      await window.ESAuth?.ensureSupabaseReady?.();
      const shared = await window.ESDashboardData?.fetchGalleryDesign?.(id);
      if (!shared?.payload) {
        showToast('This post can only be opened in the editor on the browser it was exported from.', 'error');
        return;
      }
      await openDesign(shared.payload, () => Promise.resolve(null), { title: shared.title, source: 'shared' });
    } catch (error) {
      console.warn('[designs] could not open the design:', error);
      showToast(error?.message || 'This design could not be opened.', 'error');
    }
  }

  // ─── Recent designs dialog ────────────────────────────────────────────────
  function timeAgo(timestamp) {
    const mins = Math.round((Date.now() - timestamp) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  async function showRecentDesigns() {
    document.querySelectorAll('.recent-designs-dialog').forEach(stale => stale.remove());
    const dialog = document.createElement('dialog');
    dialog.className = 'es-dialog recent-designs-dialog';
    dialog.setAttribute('aria-labelledby', 'recent-designs-title');
    dialog.innerHTML = `
      <div class="recent-designs-head">
        <h2 id="recent-designs-title">Recent designs</h2>
        <button class="recent-designs-close" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <p class="recent-designs-copy">Your last ${MAX_LOCAL} exports on this browser. Open one to edit it again; it opens as a new copy.</p>
      <div class="recent-designs-list" role="list"></div>`;
    const list = dialog.querySelector('.recent-designs-list');
    dialog.querySelector('.recent-designs-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();

    const records = await listLocal();
    if (!records.length) {
      list.innerHTML = '<div class="recent-designs-empty"><strong>Nothing here yet</strong><span>Designs you export appear here, so you can reopen and change them later.</span></div>';
      return;
    }
    records.forEach(record => {
      const row = document.createElement('div');
      row.className = 'recent-design';
      row.setAttribute('role', 'listitem');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'recent-design__open';
      const thumb = document.createElement('span');
      thumb.className = 'recent-design__thumb';
      if (record.thumb) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = record.thumb;
        thumb.appendChild(img);
      }
      const text = document.createElement('span');
      text.className = 'recent-design__text';
      const title = document.createElement('strong');
      title.textContent = record.title;
      const meta = document.createElement('small');
      meta.textContent = [WORKSPACE_LABELS[record.workspace] || record.workspace, record.variant, timeAgo(record.savedAt)].filter(Boolean).join(' · ');
      text.append(title, meta);
      const cta = document.createElement('span');
      cta.className = 'recent-design__cta';
      cta.textContent = 'Open';
      open.append(thumb, text, cta);
      open.setAttribute('aria-label', `Open ${record.title}`);
      open.addEventListener('click', async () => {
        dialog.close();
        try { await openLocal(record); } catch (error) { showToast(error?.message || 'This design could not be opened.', 'error'); }
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'recent-design__remove';
      remove.setAttribute('aria-label', `Remove ${record.title} from Recent designs`);
      remove.title = 'Remove from this list';
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      remove.addEventListener('click', async () => {
        await removeLocal([record.id]).catch(() => {});
        row.remove();
        if (!list.querySelector('.recent-design')) list.innerHTML = '<div class="recent-designs-empty"><strong>Nothing here yet</strong><span>Designs you export appear here, so you can reopen and change them later.</span></div>';
      });
      row.append(open, remove);
      list.appendChild(row);
    });
  }

  document.querySelectorAll('[data-recent-designs]').forEach(button => button.addEventListener('click', showRecentDesigns));

  window.FrameUpDesigns = Object.freeze({ capture, storeLocal, listLocal, showRecentDesigns, openDesign });

  A.restored.then(() => openFromLink()).catch(() => {});
})();
