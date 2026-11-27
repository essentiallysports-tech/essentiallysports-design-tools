// Reels v4 learning loop, browser side: window.ReelFeedback.log(evt).
// Fire-and-forget: events queue, go up in batches of up to 20 (every 3 s, or
// at once when the page hides), and a failure is dropped silently. The server
// (/api/reel-maker mode 'feedback') saves them to frameup_reel_feedback; the
// daily job turns them into the house lessons the director and critic read.
//
// evt = { event, reelId, chapterId?, beatId?, style?, field?, before?, after? }
//   event: swap_media | edit_text | change_module | regenerate | delete_beat | export | posted
//   before / after: small JSON, e.g. { kind: 'clip', url, reason } or { type: 'bars' }
//   or the old and new text for edit_text (field: headline | stamp | tag | close | label).
// For the clip library: swap_media with before.url (the clip swapped out) and
// after.url (the one kept) lets clips people keep rank up and swapped ones down.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.ReelFeedback = api;
}(typeof window !== 'undefined' ? window : globalThis, root => {
  'use strict';
  const EVENTS = ['swap_media', 'edit_text', 'change_module', 'regenerate', 'delete_beat', 'export', 'posted'];
  const BATCH = 20;
  const DELAY_MS = 3000;
  const MAX_QUEUE = 200;
  const queue = [];
  let timer = null;
  const s = (v, n) => String(v == null ? '' : v).slice(0, n);
  // Before / after are kept small (the server caps them at 2 KB too).
  function small(v) {
    if (v == null) return null;
    if (typeof v === 'string') return s(v, 400);
    try { const t = JSON.stringify(v); return t.length <= 2000 ? JSON.parse(t) : { truncated: true }; } catch { return null; }
  }
  function send(batch, { keepalive = false } = {}) {
    const auth = root && root.ESAuth;
    if (!auth || typeof auth.fetchWithAuth !== 'function' || !batch.length) return Promise.resolve(false);
    return Promise.resolve()
      .then(() => auth.fetchWithAuth('/api/reel-maker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'feedback', events: batch }), keepalive }))
      .then(r => Boolean(r && r.ok))
      .catch(() => false);
  }
  function flush(opts = {}) {
    if (timer) { clearTimeout(timer); timer = null; }
    const sends = [];
    // keepalive bodies are capped at 64 KB: smaller batches on page hide.
    const size = opts.keepalive ? 8 : BATCH;
    while (queue.length) sends.push(send(queue.splice(0, size), opts));
    return Promise.all(sends);
  }
  function schedule() {
    if (timer || typeof setTimeout !== 'function') return;
    timer = setTimeout(() => { timer = null; flush(); }, DELAY_MS);
  }
  // Never throws; returns true when the event was queued.
  function log(evt) {
    try {
      const e = evt && typeof evt === 'object' ? evt : {};
      if (!EVENTS.includes(e.event)) return false;
      if (queue.length >= MAX_QUEUE) queue.shift();
      queue.push({
        event: e.event, reelId: s(e.reelId, 64), chapterId: s(e.chapterId, 16), beatId: s(e.beatId, 16),
        style: s(e.style, 20), field: s(e.field, 24), before: small(e.before), after: small(e.after),
      });
      if (queue.length >= BATCH) flush(); else schedule();
      return true;
    } catch { return false; }
  }
  if (root && typeof root.addEventListener === 'function') {
    root.addEventListener('pagehide', () => { flush({ keepalive: true }); });
  }
  return { log, flush, EVENTS, _queue: queue };
}));
