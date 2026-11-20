// FrameUp size packs: one Social Media design -> feed, square, story, X and
// YouTube sizes, previewed in a grid and downloaded as one ZIP.
//
// How each size is made (honest about quality):
//   - "Re-laid out": templates whose drawing already adapts to any canvas
//     (Cover Image, the same renderer the Reels and YouTube workspaces use)
//     are drawn again at the new size. Story and YouTube borrow those
//     workspaces' own fade height and text position; square and X sit in
//     between, scaled from the feed post.
//   - "Cropped": when the shape is nearly the same, the export is trimmed a
//     little from the centre (never more than SAFE_CROP_LOSS of either side).
//   - "Fitted": everything else is shown whole on a soft blurred backdrop of
//     itself, so no text or logo is ever cut off.
// The layout maths is pure and exported for tests (scripts/test-size-pack.mjs).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpSizePack = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TARGETS = Object.freeze([
    { id: 'feed', label: 'Instagram feed', w: 1080, h: 1350, workspace: 'instagram', swipe: true },
    { id: 'square', label: 'Square', w: 1080, h: 1080, swipe: true },
    { id: 'story', label: 'Story / Reel cover', w: 1080, h: 1920, workspace: 'reels', swipe: false },
    { id: 'x', label: 'X / Threads', w: 1600, h: 900, swipe: false },
    { id: 'youtube', label: 'YouTube thumbnail', w: 1280, h: 720, workspace: 'youtube', swipe: false },
  ]);

  // Post types checked at every size in the browser and found to re-lay out
  // cleanly. Anything not listed is fitted, never guessed.
  const RELAYOUT_POST_TYPES = new Set(['cover']);

  // A crop may remove at most this share of the width or height.
  const SAFE_CROP_LOSS = 0.06;

  const METHOD_LABELS = Object.freeze({
    original: 'Original',
    relayout: 'Re-laid out',
    crop: 'Cropped',
    fit: 'Fitted',
  });

  // Whole image inside the target (contain) and filling it (cover), centred.
  function fitRects(src, dst) {
    const containScale = Math.min(dst.w / src.w, dst.h / src.h);
    const coverScale = Math.max(dst.w / src.w, dst.h / src.h);
    const rect = scale => {
      const w = Math.round(src.w * scale);
      const h = Math.round(src.h * scale);
      return { x: Math.round((dst.w - w) / 2), y: Math.round((dst.h - h) / 2), w, h };
    };
    return { contain: rect(containScale), cover: rect(coverScale) };
  }

  // Share of the source lost (on its cut side) when it fills the target.
  function cropLoss(src, dst) {
    const srcRatio = src.w / src.h;
    const dstRatio = dst.w / dst.h;
    if (Math.abs(srcRatio - dstRatio) < 1e-9) return 0;
    return srcRatio > dstRatio ? 1 - dstRatio / srcRatio : 1 - srcRatio / dstRatio;
  }

  // The source rectangle to keep for a centred crop.
  function cropSource(src, dst) {
    const dstRatio = dst.w / dst.h;
    if (src.w / src.h > dstRatio) {
      const w = Math.round(src.h * dstRatio);
      return { x: Math.round((src.w - w) / 2), y: 0, w, h: src.h };
    }
    const h = Math.round(src.w / dstRatio);
    return { x: 0, y: Math.round((src.h - h) / 2), w: src.w, h };
  }

  function chooseMethod({ postType, src, dst }) {
    if (src.w === dst.w && src.h === dst.h) return 'original';
    if (RELAYOUT_POST_TYPES.has(postType)) return 'relayout';
    if (cropLoss(src, dst) <= SAFE_CROP_LOSS) return 'crop';
    return 'fit';
  }

  // Layout numbers for a re-laid-out size. Uses the matching workspace's own
  // values when there is one (story = Reels, YouTube = YouTube); otherwise
  // scales the feed post's by height. The person's own text position (a
  // dragged block, a random anchor) moves with the canvas proportionally.
  function relayoutPlan({ base, target, workspaces = {}, anchor, textX, textY }) {
    const own = target.workspace && workspaces[target.workspace];
    const sy = target.h / base.height;
    const sx = target.w / base.width;
    const mistHeight = own ? own.mistHeight : Math.round(base.mistHeight * sy);
    const defaultAnchor = own ? own.defaultBottomAnchor : Math.round(base.defaultBottomAnchor * sy);
    const anchorValue = Number.isFinite(anchor) && base.defaultBottomAnchor > 0
      ? Math.round(defaultAnchor * (anchor / base.defaultBottomAnchor))
      : defaultAnchor;
    return {
      width: target.w,
      height: target.h,
      mistHeight,
      bottomAnchor: anchorValue,
      textX: textX == null ? null : textX * sx,
      textY: textY == null ? null : textY * sy,
      swipe: target.swipe !== false,
    };
  }

  function slug(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  function packFilename(stem, target, extension) {
    return `${slug(stem) || 'frameup'}-${target.id}-${target.w}x${target.h}.${extension || 'jpeg'}`;
  }

  const api = { TARGETS, RELAYOUT_POST_TYPES, SAFE_CROP_LOSS, METHOD_LABELS, fitRects, cropLoss, cropSource, chooseMethod, relayoutPlan, packFilename, slug };

  // ─── Browser: rendering and the dialog ──────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return Object.freeze(api);

  const g = window;

  /* global drawCanvas, WORKSPACES, state, activeWorkspace, render, getCanvasNameExportSlug, getMainTextSlug */
  // The editor's globals are top-level script bindings in index.html (some
  // are `let`, so not on window); typeof is safe even where they're missing.
  function editorReady() {
    try {
      return typeof drawCanvas === 'function' && typeof WORKSPACES === 'object' && typeof state === 'object' && typeof activeWorkspace === 'string';
    } catch (error) {
      return false;
    }
  }

  function available() {
    return editorReady() && activeWorkspace === 'instagram';
  }

  function blankCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return { canvas, ctx };
  }

  function renderBase() {
    const ws = WORKSPACES.instagram;
    const { canvas, ctx } = blankCanvas(ws.width, ws.height);
    const savedBounds = state.lastTextBounds;
    try {
      drawCanvas(ctx, ws.width, ws.height, 1);
    } finally {
      state.lastTextBounds = savedBounds;
    }
    return canvas;
  }

  // Draws the design again at the target size. Every change to shared state
  // is undone in `finally`, and nothing awaits in between, so the editor
  // never sees the temporary values.
  function renderRelayout(target) {
    const ws = WORKSPACES.instagram;
    const plan = relayoutPlan({
      base: ws,
      target,
      workspaces: WORKSPACES,
      anchor: state.randomBottomAnchor,
      textX: state.textBlockX,
      textY: state.textBlockY,
    });
    const savedWs = { width: ws.width, height: ws.height, mistHeight: ws.mistHeight };
    const savedState = {
      randomBottomAnchor: state.randomBottomAnchor,
      textBlockX: state.textBlockX,
      textBlockY: state.textBlockY,
      swipeButton: state.swipeButton,
      lastTextBounds: state.lastTextBounds,
    };
    const { canvas, ctx } = blankCanvas(target.w, target.h);
    try {
      ws.width = plan.width;
      ws.height = plan.height;
      ws.mistHeight = plan.mistHeight;
      state.randomBottomAnchor = plan.bottomAnchor;
      state.textBlockX = plan.textX;
      state.textBlockY = plan.textY;
      if (!plan.swipe) state.swipeButton = 'none';
      drawCanvas(ctx, target.w, target.h, 1);
    } finally {
      Object.assign(ws, savedWs);
      Object.assign(state, savedState);
    }
    return canvas;
  }

  function renderCrop(base, target) {
    const src = cropSource({ w: base.width, h: base.height }, target);
    const { canvas, ctx } = blankCanvas(target.w, target.h);
    ctx.drawImage(base, src.x, src.y, src.w, src.h, 0, 0, target.w, target.h);
    return canvas;
  }

  // Whole design on a blurred, dimmed copy of itself. Uses the canvas blur
  // filter where the browser has one; otherwise shrinks in halving steps and
  // stretches back, which blurs smoothly without blocky pixels.
  function renderFit(base, target) {
    const { canvas, ctx } = blankCanvas(target.w, target.h);
    const rects = fitRects({ w: base.width, h: base.height }, target);
    const cover = rects.cover;
    if ('filter' in ctx) {
      ctx.save();
      ctx.filter = `blur(${Math.round(Math.max(target.w, target.h) / 30)}px)`;
      // Overdraw by 10% so the blur never pulls in transparent edges.
      const grow = 0.1;
      ctx.drawImage(base, cover.x - cover.w * grow / 2, cover.y - cover.h * grow / 2, cover.w * (1 + grow), cover.h * (1 + grow));
      ctx.restore();
    } else {
      let current = blankCanvas(cover.w, cover.h);
      current.ctx.drawImage(base, 0, 0, cover.w, cover.h);
      while (current.canvas.width > 48) {
        const next = blankCanvas(Math.max(1, Math.round(current.canvas.width / 2)), Math.max(1, Math.round(current.canvas.height / 2)));
        next.ctx.drawImage(current.canvas, 0, 0, next.canvas.width, next.canvas.height);
        current = next;
      }
      while (current.canvas.width * 2 < cover.w) {
        const next = blankCanvas(current.canvas.width * 2, current.canvas.height * 2);
        next.ctx.drawImage(current.canvas, 0, 0, next.canvas.width, next.canvas.height);
        current = next;
      }
      ctx.drawImage(current.canvas, cover.x, cover.y, cover.w, cover.h);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, target.w, target.h);
    ctx.drawImage(base, rects.contain.x, rects.contain.y, rects.contain.w, rects.contain.h);
    return canvas;
  }

  function buildPack() {
    const postType = state.postType || 'cover';
    const base = renderBase();
    const src = { w: base.width, h: base.height };
    const items = TARGETS.map(target => {
      const method = chooseMethod({ postType, src, dst: target });
      const canvas = method === 'original' ? base
        : method === 'relayout' ? renderRelayout(target)
          : method === 'crop' ? renderCrop(base, target)
            : renderFit(base, target);
      return { target, method, canvas };
    });
    // Put the editor's hit-testing bounds back exactly as the preview has them.
    try { render(); } catch (error) { /* preview redraw is best effort */ }
    return items;
  }

  function exportFormat() {
    const png = typeof g.getExportOptions === 'function' ? g.getExportOptions().png === true : false;
    return png ? { type: 'image/png', ext: 'png', quality: undefined } : { type: 'image/jpeg', ext: 'jpeg', quality: 0.94 };
  }

  function toBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not create the image.'))), type, quality);
    });
  }

  function packStem() {
    // Same naming as Export: es-ig-<canvas name or headline>.
    try {
      const main = getCanvasNameExportSlug() || getMainTextSlug(`${slug(state.sport || 'es')}-${slug(state.team || 'team')}`);
      return `${WORKSPACES.instagram.filenamePrefix || 'es-ig'}-${main}`;
    } catch (error) {
      return 'es-ig-design';
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function toast(message, tone) {
    if (typeof g.showToast === 'function') g.showToast(message, tone);
  }

  const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  const ZIP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>';

  function open() {
    if (!available()) {
      toast('Size packs work in the Social Media workspace.', 'error');
      return;
    }
    if (typeof g.blockLockedExport === 'function' && g.blockLockedExport()) return;
    let items;
    try {
      items = buildPack();
    } catch (error) {
      console.error('Size pack failed:', error);
      toast('The size pack could not be made. Try again.', 'error');
      return;
    }
    const format = exportFormat();
    const stem = packStem();
    const postType = state.postType || 'cover';
    const relayout = RELAYOUT_POST_TYPES.has(postType);

    document.querySelectorAll('.size-pack-dialog').forEach(stale => stale.remove());
    const dialog = document.createElement('dialog');
    dialog.className = 'es-dialog size-pack-dialog';
    dialog.setAttribute('aria-labelledby', 'size-pack-title');
    dialog.innerHTML = `
      <div class="size-pack-head">
        <h2 id="size-pack-title">Size pack</h2>
        <button class="size-pack-close" type="button" aria-label="Close">${CLOSE_ICON}</button>
      </div>
      <p class="size-pack-copy"></p>
      <ul class="size-pack-grid" role="list"></ul>
      <div class="size-pack-actions">
        <span class="size-pack-total" aria-live="polite"></span>
        <button class="es-btn es-btn--tertiary" type="button" data-size-pack-cancel>Cancel</button>
        <button class="es-btn es-btn--primary" type="button" data-size-pack-download>${ZIP_ICON}<span>Download ZIP</span></button>
      </div>`;
    dialog.querySelector('.size-pack-copy').textContent = relayout
      ? 'Every size is drawn again for its shape. Story and YouTube use those workspaces’ own text position.'
      : 'This template is built for the feed, so other shapes show it whole on a soft backdrop. Nothing is cut off.';
    const grid = dialog.querySelector('.size-pack-grid');
    items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'size-pack-item';
      const id = `size-pack-check-${index}`;
      const thumb = item.canvas;
      const preview = document.createElement('img');
      preview.className = 'size-pack-thumb';
      preview.alt = `${item.target.label} preview`;
      preview.width = item.target.w;
      preview.height = item.target.h;
      try {
        const small = blankCanvas(Math.round(item.target.w / 4), Math.round(item.target.h / 4));
        small.ctx.drawImage(thumb, 0, 0, small.canvas.width, small.canvas.height);
        preview.src = small.canvas.toDataURL('image/jpeg', 0.8);
      } catch (error) { /* tainted canvas: the label still shows */ }
      const frame = document.createElement('div');
      frame.className = 'size-pack-frame';
      frame.appendChild(preview);
      const label = document.createElement('label');
      label.className = 'size-pack-label';
      label.setAttribute('for', id);
      label.innerHTML = '<input type="checkbox" checked><span class="size-pack-name"></span><span class="size-pack-meta"></span>';
      const box = label.querySelector('input');
      box.id = id;
      box.dataset.index = String(index);
      label.querySelector('.size-pack-name').textContent = item.target.label;
      label.querySelector('.size-pack-meta').textContent = `${item.target.w} × ${item.target.h}`;
      const badge = document.createElement('span');
      badge.className = `es-badge size-pack-method is-${item.method}`;
      badge.textContent = METHOD_LABELS[item.method];
      li.append(frame, label, badge);
      grid.appendChild(li);
    });

    const total = dialog.querySelector('.size-pack-total');
    const download = dialog.querySelector('[data-size-pack-download]');
    const checked = () => [...grid.querySelectorAll('input[type="checkbox"]')].filter(box => box.checked).map(box => items[Number(box.dataset.index)]);
    const syncTotal = () => {
      const count = checked().length;
      total.textContent = `${count} of ${items.length} sizes`;
      download.disabled = count === 0;
    };
    grid.addEventListener('change', syncTotal);
    syncTotal();

    const close = () => { if (dialog.open) dialog.close(); };
    dialog.querySelector('.size-pack-close').addEventListener('click', close);
    dialog.querySelector('[data-size-pack-cancel]').addEventListener('click', close);
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    dialog.addEventListener('close', () => dialog.remove());

    download.addEventListener('click', async () => {
      const chosen = checked();
      if (!chosen.length) return;
      download.disabled = true;
      download.setAttribute('aria-busy', 'true');
      download.querySelector('span').textContent = 'Zipping…';
      try {
        const files = [];
        for (const item of chosen) {
          const blob = await toBlob(item.canvas, format.type, format.quality);
          files.push({ name: packFilename(stem, item.target, format.ext), data: new Uint8Array(await blob.arrayBuffer()), date: new Date() });
        }
        const zipBytes = g.FrameUpZip.zip(files);
        downloadBlob(new Blob([zipBytes], { type: 'application/zip' }), `${slug(stem) || 'frameup'}-size-pack.zip`);
        toast(`Downloaded ${files.length} sizes`, 'success');
        try { g.FrameUpTrack?.track?.('export', { tool: 'social', action: 'zip', label: stem, meta: { kind: 'size-pack', count: files.length, sizes: chosen.map(item => item.target.id), format: format.ext } }); } catch (error) { /* never blocks */ }
        close();
      } catch (error) {
        console.error('Size pack download failed:', error);
        toast('The ZIP could not be made. Try again.', 'error');
        download.disabled = false;
        download.removeAttribute('aria-busy');
        download.querySelector('span').textContent = 'Download ZIP';
      }
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    download.focus();
  }

  return Object.freeze({ ...api, available, open, buildPack });
});
