/*
 * FrameUp Generate: learning capture (gen4-learning, 2026-11-21).
 *
 * Generate learns after every run from what goes FINAL and what gets CHANGED.
 * This file is the page side:
 *
 *   window.FrameUpLearning.capture({ event, designId, ... })
 *     event: 'export' | 'download' | 'edit' | 'assist' | 'reject' | 'apply'
 *     For 'export' / 'download' it reads the design's version history
 *     (window.FrameUpCreative.design(id).history) and sends the structured
 *     diff between the design as Generate delivered it (history entry 0) and
 *     as it was downloaded: headline / kicker / body words, photo swapped (and
 *     what kind it was), size switched, palette flipped, composition
 *     shuffled, fixes applied, assistant asks. An unchanged download is the
 *     strongest signal there is: it shipped as is.
 *     Fire-and-forget to POST /api/es-generate { mode: 'creative-signal' }.
 *     One export capture per design version (PNG then JPG counts once).
 *
 *   Shuffles are captured here without any hook: a 'frameup:design-changed'
 *   event with source 'another' that changes the archetype sends one
 *   'reject' for the composition left behind (once per design and archetype).
 *
 *   window.FrameUpLearning.diffScenes(first, final, opts)  pure, for tests.
 *   window.FrameUpLearning.mountAdmin(el)  the dashboard's "Generate learning"
 *     card: the repeat-change rate trend, ship-as-is rate, what people change
 *     every time, what ships. Auto-mounts into #gen-learning.
 *
 * Server side: netlify/functions/_creative-memory.js (lessons, decay,
 * injection, ranking, trend). Never throws; learning is optional.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpLearning = api;
}(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const words = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const ROLES = ['headline', 'kicker', 'body', 'quote', 'name'];
  const CROWD = /crowd|fans?\b|stadium|arena|venue|course|trophy|gavel|court(?:room)?|ball\b|logo|generic|stock|celebrat/i;

  // The text a scene shows per role (first layer of each role).
  function textByRole(scene) {
    const out = {};
    (scene?.layers || []).forEach(layer => {
      if (!(layer && (layer.type === 'text' || layer.type === 'pill') && ROLES.includes(layer.role))) return;
      if (out[layer.role] == null) out[layer.role] = String(layer.text || '');
    });
    return out;
  }
  const mainPhoto = scene => (scene?.layers || []).find(l => l && l.type === 'photo' && l.role !== 'art' && !String(l.src || '').startsWith('proc:')) || null;
  const cutoutOf = scene => (scene?.layers || []).find(l => l && l.type === 'cutout') || null;
  function sizeKey(scene) {
    const w = Number(scene?.size?.w) || 0;
    const h = Number(scene?.size?.h) || 0;
    if (!w || !h) return '';
    if (Math.abs(w - h) < 2) return 'square';
    return h / w > 1.6 ? 'story' : 'portrait';
  }
  // What kind of photo a design led with: a cut-out, a photo of the named
  // person (it is in the direction's photo list with a person), a no-person
  // scene shot (crowd, venue, objects), or none.
  function photoKind(scene, photos = []) {
    const cut = cutoutOf(scene);
    if (cut?.src) return 'cutout';
    const photo = mainPhoto(scene);
    if (!photo?.src) return 'none';
    const known = (photos || []).find(p => p && (p.src === photo.src || p.cutout === photo.src));
    return known?.person ? 'person' : 'scene';
  }

  // first: the design as delivered; final: as downloaded.
  // opts: { photos (the direction's ES photos), history: { entries, index } }
  function diffScenes(first, final, { photos = [], history = null } = {}) {
    const diff = {};
    if (!first || !final) return diff;
    const a = textByRole(first);
    const b = textByRole(final);
    ROLES.forEach(role => {
      if (a[role] == null && b[role] == null) return;
      const before = String(a[role] || '');
      const after = String(b[role] || '');
      if (before.trim().toUpperCase() === after.trim().toUpperCase()) return;
      diff[role] = { before: before.slice(0, 120), after: after.slice(0, 120), beforeWords: words(before), afterWords: words(after), removed: Boolean(before.trim()) && !after.trim() };
    });
    const p1 = mainPhoto(first)?.src || '';
    const p2 = mainPhoto(final)?.src || '';
    const c1 = cutoutOf(first)?.src || '';
    const c2 = cutoutOf(final)?.src || '';
    if ((p1 || p2 || c1 || c2) && (p1 !== p2 || c1 !== c2)) {
      diff.photo = { from: photoKind(first, photos), to: photoKind(final, photos), crowd: CROWD.test(decodeURIComponent(String(p1).split('/').pop() || '').replace(/[-_]+/g, ' ')) };
    }
    const s1 = sizeKey(first);
    const s2 = sizeKey(final);
    if (s1 && s2 && s1 !== s2) diff.size = { from: s1, to: s2 };
    const m1 = first.palette?.mode || '';
    const m2 = final.palette?.mode || '';
    if (m1 && m2 && m1 !== m2) diff.palette = { from: m1, to: m2 };
    if (first.archetype && final.archetype && first.archetype !== final.archetype) diff.archetype = { from: first.archetype, to: final.archetype };
    if (history && Array.isArray(history.entries)) {
      const steps = history.entries.slice(1, (Number(history.index) || 0) + 1);
      diff.steps = steps.length;
      diff.fixes = steps.filter(e => e && e.source === 'fix').length;
      diff.asks = steps.filter(e => e && e.source === 'assistant').length;
    }
    return diff;
  }
  // The diff says nothing changed (edited and undone back counts as unchanged).
  const isUnchanged = diff => !Object.keys(diff || {}).some(k => !['steps', 'fixes', 'asks'].includes(k)) && !diff?.fixes && !diff?.asks;

  // ── Sending ────────────────────────────────────────────────────────────
  const Creative = () => root?.FrameUpCreative;
  let sender = body => {
    const auth = root?.ESAuth;
    if (!auth?.fetchWithAuth) return null;
    return auth.fetchWithAuth('/api/es-generate', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })?.catch?.(() => {});
  };
  const sentExports = new Set();
  const sentRejects = new Set();

  function runInfo() {
    const plan = Creative()?.state?.run?.plan || {};
    return { runId: plan.runId || '', sport: plan.read?.sport || '', injected: (plan.lessons || []).map(l => l && l.key).filter(Boolean).slice(0, 16) };
  }

  // capture(signal): the contract shape { runId, designId, archetype, tone, event, diff? }.
  function capture(signal = {}) {
    try {
      const event = String(signal.event || '');
      if (!['export', 'download', 'edit', 'assist', 'reject', 'apply'].includes(event)) return false;
      const info = runInfo();
      const d = signal.designId ? Creative()?.design?.(signal.designId) : null;
      const scene = d?.getScene?.() || null;
      const out = {
        event,
        designId: String(signal.designId || ''),
        runId: signal.runId || d?.runId || info.runId,
        archetype: signal.archetype || scene?.archetype || '',
        archetypeName: signal.archetypeName || scene?.archetypeName || '',
        tone: signal.tone || scene?.tone || '',
        sport: signal.sport || info.sport,
      };
      ['text', 'before', 'after', 'format', 'value'].forEach(k => { if (signal[k] != null) out[k] = signal[k]; });
      if (event === 'export' || event === 'download') {
        const h = d?.history;
        const first = h?.entries?.[0]?.scene || null;
        const diff = signal.diff || (first && scene ? diffScenes(first, scene, { photos: d?.photos?.() || [], history: h }) : null);
        if (diff) out.diff = diff;
        out.injected = info.injected;
        // One capture per design version: PNG then JPG of the same version counts once.
        const version = `${out.designId}|${h ? h.index : 0}|${h?.entries?.length || 0}`;
        if (out.designId && sentExports.has(version)) return false;
        if (out.designId) sentExports.add(version);
      }
      sender({ mode: 'creative-signal', signal: out });
      return out;
    } catch (error) {
      return false; // learning is optional
    }
  }

  // Shuffle away = reject the composition left behind (no hook needed).
  const lastScene = new Map();
  function onChanged(event) {
    try {
      const detail = event?.detail || {};
      if (detail.origin !== 'generate' || !detail.designId || !detail.scene) return;
      const id = detail.designId;
      const before = lastScene.get(id) || Creative()?.design?.(id)?.history?.entries?.[0]?.scene || null;
      lastScene.set(id, detail.scene);
      if (detail.source !== 'another' || !before?.archetype || before.archetype === detail.scene.archetype) return;
      const key = `${id}|${before.archetype}`;
      if (sentRejects.has(key)) return;
      sentRejects.add(key);
      capture({ event: 'reject', designId: id, archetype: before.archetype, archetypeName: before.archetypeName || '', tone: before.tone || '', text: '' });
    } catch (error) { /* optional */ }
  }
  if (root?.document?.addEventListener) root.document.addEventListener('frameup:design-changed', onChanged);

  // ── Admin card (dashboard.html #gen-learning) ──────────────────────────
  const CHANGE_LABEL = {
    'chg-headline-shorter': 'Shortened the headline', 'chg-headline-longer': 'Lengthened the headline', 'chg-headline-rewrite': 'Rewrote the headline',
    'chg-kicker-cut': 'Deleted the kicker', 'chg-kicker-edit': 'Rewrote the kicker', 'chg-body-cut': 'Cut the body copy', 'chg-body-edit': 'Rewrote the body copy',
    'chg-text-edit': 'Fixed a quote or name', 'chg-photo-scene': 'Swapped a no-person photo', 'chg-photo-person': 'Swapped the player photo', 'chg-photo-cutout': 'Replaced the cut-out',
    'chg-size-story': 'Resized to 9:16 story', 'chg-size-square': 'Resized to 1:1 square', 'chg-size-portrait': 'Resized to 4:5 portrait',
    'chg-palette-light': 'Flipped to a light field', 'chg-palette-dark': 'Flipped to a dark field', 'chg-shuffle': 'Shuffled the composition', 'chg-fix': 'Applied a director fix', 'chg-ask': 'Asked the assistant',
  };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pct = value => (value == null ? '–' : `${Math.round(value * 100)}%`);

  function adminHtml(data) {
    if (!data) return '<div class="empty">The learning data did not load. Try again in a moment.</div>';
    const trend = data.trend;
    if (!trend) return '<div class="empty">Admins only: the trend reads the whole team’s exports.</div>';
    if (!trend.totals.exports) return '<div class="empty">No Generate downloads logged yet. Every download from Generate adds one here.</div>';
    const weeks = trend.weeks || [];
    const latest = [...weeks].reverse().find(w => w.exports) || null;
    const delta = trend.repeatRateDelta;
    const deltaText = delta == null ? 'One week of data so far' : delta < 0 ? `${Math.abs(Math.round(delta * 100))} points lower than the first week (learning)` : delta > 0 ? `${Math.round(delta * 100)} points higher than the first week` : 'Same as the first week';
    const bar = w => `<li class="gl-week" title="${esc(`Week of ${w.weekStart}: ${w.exports} downloads, ${w.repeat} repeat changes, ${w.shipAsIs} shipped as is`)}"><span class="gl-bar"><span style="height:${w.exports ? Math.max(4, Math.round((w.repeatRate || 0) * 100)) : 0}%"></span></span><span class="gl-week-label">${esc(w.weekStart.slice(5))}</span></li>`;
    const changes = (trend.topChanges || []).map(c => `<li><span>${esc(CHANGE_LABEL[c.topic] || c.topic)}</span><b>${c.count}</b></li>`).join('');
    const lessons = (data.changes || []).slice(0, 6).map(l => `<li>${esc(l.text)}${l.hitRate != null ? ` <span class="gl-muted">· held ${pct(l.hitRate)}</span>` : ''}</li>`).join('');
    const prefs = Object.entries(data.preferences?.archetypes || {});
    const ships = prefs.filter(([, v]) => v > 0).slice(0, 4).map(([id]) => id);
    const shuffled = prefs.filter(([, v]) => v < 0).slice(-3).map(([id]) => id);
    return `
      <div class="ai-spend-summary">
        <div class="ai-spend-stat"><strong>${pct(latest?.repeatRate)}</strong><span>Repeat-change rate, latest week</span></div>
        <div class="ai-spend-stat"><strong>${pct(trend.totals.shipRate)}</strong><span>Shipped as is (no changes)</span></div>
        <div class="ai-spend-stat"><strong>${trend.totals.exports}</strong><span>Generate downloads, ${weeks.length} weeks</span></div>
        <div class="ai-spend-stat"><strong>${data.totals?.active ?? 0}</strong><span>Active lessons in prompts</span></div>
      </div>
      <p class="ai-spend-note gl-first">${esc(deltaText)}. A repeat change is one the model already had a lesson for, so lower is better.</p>
      <ol class="gl-weeks" aria-label="Repeat-change rate by week">${weeks.map(bar).join('')}</ol>
      <div class="ai-spend-groups">
        <div><h3>What people change before downloading</h3>${changes ? `<ul class="gl-list">${changes}</ul>` : '<p class="gl-muted">Nothing yet.</p>'}</div>
        <div><h3>Lessons the director now follows</h3>${lessons ? `<ul class="gl-lessons">${lessons}</ul>` : '<p class="gl-muted">None active yet (a change needs to repeat to become a lesson).</p>'}</div>
        <div><h3>Compositions</h3><p class="gl-muted">${ships.length ? `Ship most: ${esc(ships.join(', '))}.` : 'No clear favourite yet.'}${shuffled.length ? ` Shuffled away from: ${esc(shuffled.join(', '))}.` : ''}</p></div>
      </div>
      <p class="ai-spend-note">${trend.source === 'team' ? 'From the team’s logged downloads.' : 'From this server’s recent downloads only (the team log did not answer).'} Lessons fade with a 21-day half-life.</p>`;
  }
  function injectStyles(doc) {
    if (!doc || doc.getElementById('gl-styles')) return;
    const style = doc.createElement('style');
    style.id = 'gl-styles';
    style.textContent = `
      #gen-learning:not(:has(> .empty)) { padding: var(--es-space-6, 24px); }
      .gl-first { margin: 0 0 16px; }
      .gl-weeks { list-style: none; margin: 0 0 24px; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(28px, 1fr)); gap: 8px; align-items: end; }
      .gl-week { display: grid; gap: 6px; justify-items: center; }
      .gl-bar { display: flex; align-items: flex-end; width: 100%; max-width: 40px; height: 72px; border-radius: 6px; background: var(--es-sunk, #f5f6f8); overflow: hidden; }
      html[data-theme="dark"] .gl-bar { background: var(--theme-dark-border, #303030); }
      .gl-bar > span { display: block; width: 100%; background: var(--es-brand-fill, #0a6bd8); border-radius: 6px 6px 0 0; }
      .gl-week-label { font-size: 12px; color: var(--es-text-muted, #646a76); font-variant-numeric: tabular-nums; }
      .gl-list, .gl-lessons { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 14px; color: var(--es-text-secondary, #464c57); }
      .gl-list li { display: flex; justify-content: space-between; gap: 12px; }
      .gl-list b { font-variant-numeric: tabular-nums; color: var(--es-text-strong, #0e1014); }
      .gl-muted { margin: 0; font-size: 14px; color: var(--es-text-muted, #646a76); }`;
    doc.head.append(style);
  }
  async function mountAdmin(el, { tries = 6 } = {}) {
    if (!el) return false;
    injectStyles(el.ownerDocument);
    for (let i = 0; i < tries; i += 1) {
      const auth = root?.ESAuth;
      if (auth?.fetchWithAuth) {
        try {
          const response = await auth.fetchWithAuth('/api/es-generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'creative-lessons' }) });
          const data = response.ok ? await response.json() : null;
          el.innerHTML = adminHtml(data);
          return true;
        } catch (error) { /* session not ready: retry */ }
      }
      await new Promise(resolve => setTimeout(resolve, 1500 * (i + 1)));
    }
    el.innerHTML = adminHtml(null);
    return false;
  }
  const doc = root?.document;
  if (doc?.getElementById) {
    const auto = () => { const el = doc.getElementById('gen-learning'); if (el) mountAdmin(el); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', auto);
    else auto();
  }

  return Object.freeze({
    capture, diffScenes, isUnchanged, photoKind, sizeKey, adminHtml, mountAdmin, CHANGE_LABEL,
    _test: { setSender: fn => { sender = fn; }, reset: () => { sentExports.clear(); sentRejects.clear(); lastScene.clear(); }, onChanged },
  });
}));
