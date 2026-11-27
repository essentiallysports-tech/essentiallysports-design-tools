// Reels v3 sourcing (browser): the right picture for every scene.
// window.ReelSourcing, loaded after reel-clips.js (window.ReelClips) and
// es-auth. The page calls these instead of the old pickClips / nextClip /
// stillChain chain; see reels3-sourcing-api.md for the exact calls.
//
//   mediaFor(plan, style?, opts?)  -> { beats: { [beatId]: { subject, wants, pick, clips, photos } }, cost, judged, notes, esStyle }
//     1. POST /api/reel-maker { mode: 'scene-media' }: per scene its subject,
//        trusted clip candidates, verified photos and a first pick.
//     2. The judge queue (<= 24 clips): each clip is loaded and sampled here
//        (ReelClips.sampleClip), then rated by the vision judge in batches of
//        4 (mode clip-judge, $0.03 a reel, cached 7 days per clip URL).
//     3. Picks under the relevance gate (ReelClips.gatedPicks, the same code
//        as the server): a confirmed clip, else a verified photo, else an
//        infographic block. Never a random clip, never an unverified photo.
//   candidates(beatId)  -> gated clips + verified photos for Swap, best first
//   review(plan, { picks?, timeline? }) -> the review pass (mode review) with
//        the fixed plan; scenes whose picture failed get the next candidate
//        (repicks).
//   picksFor(plan) -> the picks map review wants (from the last mediaFor).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelSourcing = api;
}(typeof self !== 'undefined' ? self : this, root => {
  'use strict';

  const C = () => (root && root.ReelClips) || (typeof require === 'function' ? require('./reel-clips.js') : null);

  async function defaultApi(body) {
    const auth = root && root.ESAuth;
    if (!auth || typeof auth.fetchWithAuth !== 'function') throw new Error('Not signed in.');
    const response = await auth.fetchWithAuth('/api/reel-maker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok === false) throw Object.assign(new Error((data && data.error) || `Request failed (${response.status})`), { status: response.status, data });
    return data;
  }
  // The variant to download: up to 720p on the short side, else the smallest.
  function pickVariant(variants = []) {
    const ok = variants.filter(v => v && v.url && /\.mp4(\?|$)/.test(v.url));
    const list = ok.length ? ok : variants.filter(v => v && v.url);
    const side = v => Math.min(v.width || 0, v.height || 0) || 0;
    return [...list].sort((a, b) => (side(a) <= 720 ? 0 : 1) - (side(b) <= 720 ? 0 : 1) || side(b) - side(a))[0] || null;
  }
  const videoCache = new Map();
  async function defaultLoadVideo(clip) {
    if (typeof document === 'undefined') return null;
    const variant = pickVariant(clip.variants || []);
    if (!variant) return null;
    if (videoCache.has(variant.url)) return videoCache.get(variant.url);
    let src = '';
    try {
      const response = await fetch(variant.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) return null;
      src = URL.createObjectURL(await response.blob());
    } catch { return null; }
    const video = await new Promise(resolve => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      const done = ok => { clearTimeout(timer); resolve(ok ? v : null); };
      const timer = setTimeout(() => done(v.readyState >= 2), 15000);
      v.addEventListener('loadeddata', () => done(true), { once: true });
      v.addEventListener('error', () => done(false), { once: true });
      v.src = src;
    });
    if (video) videoCache.set(variant.url, video);
    return video;
  }
  function storage() { try { return root && root.localStorage ? root.localStorage : null; } catch { return null; } }

  const state = { last: null, spent: { judge: 0, media: 0, review: 0 }, judgeCache: null };
  const sid = beat => (beat && beat.id) || '';

  // ─── mediaFor ────────────────────────────────────────────────────────
  async function mediaFor(plan, style = '', opts = {}) {
    const clips = C();
    const call = opts.api || defaultApi;
    const loadVideo = opts.loadVideo || defaultLoadVideo;
    const sample = opts.sampleClip || (clips && clips.sampleClip);
    const progress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
    const empty = { beats: {}, cost: 0, judged: 0, notes: [], esStyle: clips ? clips.styleOf(plan || {}, style) : style };
    if (!clips || !plan || !Array.isArray(plan.beats) || !plan.beats.length) return empty;
    const esStyle = clips.styleOf(plan, style);
    progress('Finding the right pictures…');
    let media;
    try {
      media = await call({ mode: 'scene-media', plan: slimPlan(plan), esStyle, exclude: opts.exclude || [] });
    } catch (error) {
      return { ...empty, esStyle, notes: [error.message || 'Pictures could not be found right now.'] };
    }
    state.spent.media += Number(media.cost) || 0;
    const judgements = {};
    const samples = {};
    const judgeTimes = {};
    const notes = [];
    if (media.aiPaused) notes.push('AI checks are paused, so only clips that name the subject in their post are used.');
    // Judge cache (per clip URL, 7 days) shared with the old picker.
    try { state.judgeCache = state.judgeCache || clips.makeCache(storage()); } catch { state.judgeCache = clips.makeCache(null); }
    const subjects = (media.subjects || []).map(s => ({ key: s.key, label: s.label, ...(s.moment ? { moment: s.moment } : {}) }));
    const cached = url => { const j = state.judgeCache.get(url); return j && subjects.every(s => s.key in j.relevance && (!s.moment || s.key in (j.moment || {}))) ? j : null; };
    const queue = (media.judgeQueue || []).slice(0, clips.JUDGE.maxClips);
    const byUrl = new Map();
    (media.beats || []).forEach(b => (b.clips || []).forEach(c => byUrl.set(c.url, c)));
    const toJudge = [];
    const frames = {};
    const allowAi = opts.ai !== false && media.judge && media.judge.ready;
    if (queue.length) progress(`Checking ${queue.length} clips for relevance…`);
    // Load + sample 3 at a time (cached judgements need no frames for the judge, only motion).
    for (let i = 0; i < queue.length; i += 3) {
      await Promise.all(queue.slice(i, i + 3).map(async item => {
        const clip = byUrl.get(item.url);
        if (!clip) return;
        const hit = cached(item.url);
        if (hit) judgements[item.url] = hit;
        if (!allowAi && !hit) return;
        const video = await Promise.resolve(loadVideo(clip)).catch(() => null);
        if (!video || typeof sample !== 'function') return;
        const sm = await Promise.resolve(sample(video)).catch(() => null);
        if (!sm) return;
        samples[item.url] = sm.samples || [];
        judgeTimes[item.url] = sm.times || [];
        if (!hit && (sm.frames || []).length) { frames[item.url] = sm.frames; toJudge.push(clip); }
      }));
    }
    for (let i = 0; allowAi && i < toJudge.length; i += clips.JUDGE.perCall) {
      const left = clips.JUDGE.maxUsdPerReel - state.spent.judge;
      if (left <= 0) { notes.push('The clip check reached its per-reel cap; unchecked clips are not used.'); break; }
      const batch = toJudge.slice(i, i + clips.JUDGE.perCall);
      try {
        const data = await call({ mode: 'clip-judge', budgetUsd: left, subjects, clips: batch.map(c => ({ url: c.url, text: c.text, handle: c.handle, frames: frames[c.url], times: judgeTimes[c.url] })) });
        state.spent.judge += Number(data.cost) || 0;
        Object.entries(data.judgements || {}).forEach(([url, raw]) => { const j = clips.validateJudgement(raw); if (j) { judgements[url] = j; state.judgeCache.set(url, j); } });
        if (data.capped) { notes.push('The clip check reached its per-reel cap; unchecked clips are not used.'); break; }
      } catch { break; } // AI off, over a cap, or failing: unjudged clips are simply not used
    }
    // Picks under the gate (the same code as the server).
    const durs = new Map((opts.durations ? Object.entries(opts.durations) : []).map(([k, v]) => [k, Number(v) || 0]));
    const scenes = (media.beats || []).map(b => ({
      beatId: b.beatId, subject: b.subject, wants: b.wants, durMs: durs.get(b.beatId) || 0,
      beat: (plan.beats || []).find((x, i) => (sid(x) || `b${i + 1}`) === b.beatId) || null,
      clips: (b.clips || []).filter(c => c && c.url), photos: (b.photos || []).filter(p => p && p.verified === true),
    }));
    const judgeAvailable = Boolean(media.judge && media.judge.ready && opts.ai !== false);
    const picks = clips.gatedPicks(scenes, { judgements, samples, judgeTimes, judgeAvailable, used: new Set(opts.usedClips || []) });
    const beats = {};
    scenes.forEach(s => {
      const p = picks[s.beatId] || { kind: 'none', candidates: [] };
      beats[s.beatId] = { subject: s.subject, wants: s.wants, pick: stripCandidates(p), clips: s.clips, photos: s.photos, candidates: p.candidates || [] };
    });
    const used = Object.values(beats).filter(b => b.pick.kind === 'clip').length;
    const want = scenes.filter(s => s.wants === 'clip').length;
    if (want && used < want) notes.push(`${want - used} scene${want - used === 1 ? '' : 's'} had no clip confirmed for its subject and use${want - used === 1 ? 's' : ''} a verified photo or a graphic instead.`);
    const result = { beats, cost: Number(((Number(media.cost) || 0) + state.spent.judge).toFixed(6)), judged: Object.keys(judgements).length, notes, esStyle, subjects, judgements };
    state.last = result;
    progress('');
    return result;
  }
  function stripCandidates(p) { const out = { ...p }; delete out.candidates; return out; }
  // The plan without heavy fields (the server needs beats, team, sport, title).
  function slimPlan(plan) {
    return {
      title: plan.title, sport: plan.sport, team: plan.team ? { name: plan.team.name } : null, format: plan.format,
      style: plan.style, esStyle: plan.esStyle, look: plan.look, recipe: plan.recipe,
      beats: (plan.beats || []).slice(0, 14).map((b, i) => ({ id: sid(b) || `b${i + 1}`, kind: b.kind, text: b.text, photo: b.photo, name: b.name, visual: b.visual, subject: b.subject, block: b.block, stat: b.stat })),
    };
  }

  // ─── candidates (Swap) ───────────────────────────────────────────────
  function candidates(beatId) {
    const b = state.last && state.last.beats[beatId];
    if (!b) return [];
    const current = b.pick && (b.pick.kind === 'clip' ? b.pick.clip && b.pick.clip.url : b.pick.kind === 'photo' ? b.pick.photo && b.pick.photo.url : '');
    const list = (b.candidates || []).filter(c => (c.kind === 'clip' ? c.clip.url : c.photo.url) !== current);
    return current ? [...list, ...(b.candidates || []).filter(c => (c.kind === 'clip' ? c.clip.url : c.photo.url) === current)] : list;
  }
  // The person picked a candidate: it becomes the scene's pick.
  function choose(beatId, candidate) {
    const b = state.last && state.last.beats[beatId];
    if (!b || !candidate) return null;
    b.pick = candidate.kind === 'clip' ? { kind: 'clip', clip: candidate.clip, relevance: candidate.relevance, gate: candidate.gate, segment: candidate.segment || null, why: 'chosen in Swap' } : { kind: 'photo', photo: candidate.photo, why: 'chosen in Swap' };
    return b.pick;
  }

  // ─── review ──────────────────────────────────────────────────────────
  function picksFor(plan) {
    const out = {};
    const last = state.last;
    (plan && plan.beats || []).forEach((beat, i) => {
      const id = sid(beat) || `b${i + 1}`;
      const b = last && last.beats[id];
      if (!b) return;
      const p = b.pick || { kind: 'none' };
      if (p.kind === 'clip') out[id] = { kind: 'clip', ref: p.clip.url, relevance: p.relevance, moment: p.moment == null ? null : p.moment, gate: p.gate, note: noteOf(p.clip, last.judgements) };
      else if (p.kind === 'photo') out[id] = { kind: 'photo', ref: p.photo.url, verified: p.photo.verified === true, note: p.photo.caption || p.photo.title || '' };
      else out[id] = { kind: 'none', ref: '' };
    });
    return out;
  }
  function noteOf(clip, judgements = {}) {
    const j = judgements[clip.url];
    return [j && j.note, clip.text].filter(Boolean).join(' | ').slice(0, 160);
  }
  async function review(plan, opts = {}) {
    const call = opts.api || defaultApi;
    const clips = C();
    if (!plan || !Array.isArray(plan.beats) || !plan.beats.length) return { ok: false, ready: false, issues: [], plan, repicks: {} };
    let data;
    try {
      data = await call({ mode: 'review', plan, picks: opts.picks || picksFor(plan), corpus: opts.corpus || '', esStyle: clips ? clips.styleOf(plan, opts.style || '') : '' });
    } catch (error) {
      return { ok: false, ready: false, issues: [{ beatId: '', kind: 'brand', severity: 'warn', problem: error.message || 'The review could not run.', fix: 'none', fixed: false }], plan, repicks: {} };
    }
    state.spent.review += Number(data.cost) || 0;
    // Media problems: the next verified candidate (or the infographic block).
    const repicks = {};
    (data.issues || []).filter(i => i.kind === 'media' && i.fix === 'repick' && i.beatId).forEach(issue => {
      const b = state.last && state.last.beats[issue.beatId];
      if (!b || repicks[issue.beatId]) return;
      const current = b.pick && (b.pick.kind === 'clip' ? b.pick.clip.url : b.pick.kind === 'photo' ? b.pick.photo.url : '');
      const next = (b.candidates || []).find(c => (c.kind === 'clip' ? c.clip.url : c.photo.url) !== current && (c.kind === 'photo' || c.gate === 'judge'));
      const beat = (data.plan && data.plan.beats || []).find(x => sid(x) === issue.beatId) || {};
      b.pick = next ? (next.kind === 'clip' ? { kind: 'clip', clip: next.clip, relevance: next.relevance, gate: next.gate, why: 'review re-pick' } : { kind: 'photo', photo: next.photo, why: 'review re-pick' }) : { kind: 'none', fallback: clips ? clips.fallbackBlock(beat) : null, why: 'review: no other relevant picture' };
      repicks[issue.beatId] = b.pick;
      issue.fixed = true;
    });
    const ready = !(data.issues || []).some(i => i.severity === 'critical' && !i.fixed);
    return { ...data, ready, repicks };
  }

  return {
    mediaFor, candidates, choose, review, picksFor,
    styleOf: (plan, wanted) => { const c = C(); return c ? c.styleOf(plan || {}, wanted) : ''; },
    get last() { return state.last; },
    get spent() { return { ...state.spent }; },
    _test: { state, slimPlan, pickVariant, reset() { state.last = null; state.spent = { judge: 0, media: 0, review: 0 }; state.judgeCache = null; videoCache.clear(); } },
  };
}));
