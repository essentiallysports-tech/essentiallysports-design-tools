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
//
// Reels v4 (reels4-sourcing-api.md): v4 plans (chapters) and per-beat media
// kinds (clip / presser / photo / cutout / cards / none); the confirmed-clip
// library and the retry ladder on the server; picks carry the judge's best
// segment ({start,end}) and Ken Burns boxes for photos; the motion rule
// (per beat motion + motionOk; reel clipCount / needsClips / actions / stats).
//   nextCandidate(beatId, { failed }) -> the next pick when one fails to load
//   rank(clipUrl, +1|-1, { beatId })   -> keep / swap feedback (clip-rank)
//   motionCheck(plan, picks?)          -> the motion rule again, no network
// A clip file that the browser cannot download directly comes through the
// same-origin proxy (mode clip-proxy). After a judge failure, unjudged clips
// may pass the strict caption gate instead of being dropped.
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
  // v4: the clip file, direct first (trusted CDNs answer CORS *), then the
  // same-origin proxy (mode clip-proxy, <= 3 MB a call) when the direct
  // download fails. -> { blob } | { error: 'cors'|'load-failed'|'timeout'|'dead'|'too-big' }
  const PROXY_MAX_BYTES = 24 * 1024 * 1024;
  async function fetchClipFile(url, { fetchImpl = typeof fetch === 'function' ? fetch : null, proxy = defaultProxy } = {}) {
    let directError = 'load-failed';
    if (fetchImpl) {
      try {
        const response = await fetchImpl(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (response.ok) return { blob: await response.blob(), via: 'direct' };
        directError = response.status === 404 || response.status === 410 ? 'dead' : 'load-failed';
      } catch { directError = 'cors'; } // a TypeError here is a CORS / network refusal
    }
    if (directError === 'dead' || typeof proxy !== 'function') return { error: directError };
    try {
      const parts = [];
      let start = 0;
      let total = Infinity;
      while (start < total && start < PROXY_MAX_BYTES) {
        const got = await proxy(url, start);
        if (!got || !got.bytes || !got.bytes.byteLength) break;
        parts.push(got.bytes);
        total = Number(got.total) || start + got.bytes.byteLength;
        start += got.bytes.byteLength;
      }
      if (!parts.length) return { error: directError };
      if (start < total) return { error: 'too-big' };
      const Blob_ = root && root.Blob;
      return { blob: Blob_ ? new Blob_(parts, { type: 'video/mp4' }) : parts, via: 'proxy' };
    } catch (error) {
      return { error: error && error.status === 404 ? 'dead' : directError };
    }
  }
  async function defaultProxy(url, start) {
    const auth = root && root.ESAuth;
    if (!auth || typeof auth.fetchWithAuth !== 'function') return null;
    const response = await auth.fetchWithAuth('/api/reel-maker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'clip-proxy', url, start }) });
    if (response.status !== 206 && response.status !== 200) throw Object.assign(new Error('proxy'), { status: response.status });
    const range = String(response.headers.get('content-range') || '').match(/\/(\d+)$/);
    return { bytes: new Uint8Array(await response.arrayBuffer()), total: range ? Number(range[1]) : 0 };
  }
  const videoCache = new Map();
  const loadFailures = new Map(); // clip url -> reason
  async function defaultLoadVideo(clip) {
    if (typeof document === 'undefined') return null;
    const variant = pickVariant(clip.variants || []);
    if (!variant) { loadFailures.set(clip.url, 'load-failed'); return null; }
    if (videoCache.has(variant.url)) return videoCache.get(variant.url);
    const file = await fetchClipFile(variant.url);
    if (!file.blob) { loadFailures.set(clip.url, file.error || 'load-failed'); return null; }
    const src = URL.createObjectURL(file.blob);
    const video = await new Promise(resolve => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      const done = ok => { clearTimeout(timer); resolve(ok ? v : null); };
      const timer = setTimeout(() => done(v.readyState >= 2), 15000);
      v.addEventListener('loadeddata', () => done(true), { once: true });
      v.addEventListener('error', () => done(false), { once: true });
      v.src = src;
    });
    if (video) videoCache.set(variant.url, video); else loadFailures.set(clip.url, 'timeout');
    return video;
  }
  function storage() { try { return root && root.localStorage ? root.localStorage : null; } catch { return null; } }

  const state = { last: null, spent: { judge: 0, media: 0, review: 0 }, judgeCache: null, plan: null, api: null };
  const sid = beat => (beat && beat.id) || '';
  const isClipKind = k => k === 'clip' || k === 'presser';
  const refOf = c => (c ? (isClipKind(c.kind) ? c.clip && c.clip.url : c.kind === 'photo' || c.kind === 'cutout' ? c.photo && c.photo.url : '') : '');

  // ─── mediaFor ────────────────────────────────────────────────────────
  async function mediaFor(plan, style = '', opts = {}) {
    const clips = C();
    const call = opts.api || defaultApi;
    const loadVideo = opts.loadVideo || defaultLoadVideo;
    const sample = opts.sampleClip || (clips && clips.sampleClip);
    const progress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
    const empty = { beats: {}, cost: 0, judged: 0, notes: [], esStyle: clips ? clips.styleOf(plan || {}, style) : style, clipCount: 0, needsClips: true, motionOk: false, actions: [], stats: null };
    const flat = clips && plan ? clips.beatsOf(plan) : [];
    if (!clips || !plan || !flat.length) return empty;
    const esStyle = clips.styleOf(plan, style);
    state.plan = plan;
    state.api = call;
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
    const loadFailed = new Map();
    if (media.aiPaused) notes.push('AI checks are paused, so only clips that name the subject in their post are used.');
    // Judge cache (per clip URL, 7 days) shared with the old picker.
    try { state.judgeCache = state.judgeCache || clips.makeCache(storage()); } catch { state.judgeCache = clips.makeCache(null); }
    const subjects = (media.subjects || []).map(s => ({ key: s.key, label: s.label, ...(s.type ? { type: s.type } : {}), ...(s.team ? { team: s.team } : {}), ...(s.date ? { date: s.date } : {}), ...(s.moment ? { moment: s.moment } : {}), ...(s.wants ? { wants: s.wants } : {}) }));
    const cached = url => { const j = state.judgeCache.get(url); return j && subjects.every(s => s.key in j.relevance && (!s.moment || s.key in (j.moment || {}))) ? j : null; };
    const queue = (media.judgeQueue || []).slice(0, clips.JUDGE.maxClips);
    const byUrl = new Map();
    (media.beats || []).forEach(b => (b.clips || []).forEach(c => byUrl.set(c.url, c)));
    const durs = new Map((opts.durations ? Object.entries(opts.durations) : []).map(([k, v]) => [k, Number(v) || 0]));
    const beatMs = new Map(flat.map(b => [sid(b), durs.get(sid(b)) || Number(b.durMs) || 0]));
    const wantMsOf = item => Math.max(0, ...(item.beatIds || []).map(id => beatMs.get(id) || 0)) || 2500;
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
        loadFailures.delete(item.url);
        const video = await Promise.resolve(loadVideo(clip)).catch(() => null);
        if (!video || typeof sample !== 'function') { if (!video) loadFailed.set(item.url, loadFailures.get(item.url) || 'load-failed'); return; }
        const sm = await Promise.resolve(sample(video)).catch(() => null);
        if (!sm) return;
        samples[item.url] = sm.samples || [];
        judgeTimes[item.url] = sm.times || [];
        if (!hit && (sm.frames || []).length) { frames[item.url] = sm.frames; toJudge.push({ clip, wantMs: wantMsOf(item) }); }
      }));
    }
    // The judge: batches of 4. One failed batch is retried by moving on (a
    // second failure stops); a cap or a 429 stops at once. Clips it could not
    // judge may then pass the strict text gate (judgeFailed).
    let judgeFailed = false;
    let failures = 0;
    for (let i = 0; allowAi && i < toJudge.length; i += clips.JUDGE.perCall) {
      const left = clips.JUDGE.maxUsdPerReel - state.spent.judge;
      if (left <= 0) { notes.push('The clip check reached its per-reel cap; unchecked clips use the strict caption check.'); judgeFailed = true; break; }
      const batch = toJudge.slice(i, i + clips.JUDGE.perCall);
      try {
        const data = await call({
          mode: 'clip-judge', budgetUsd: left, subjects, sport: plan.sport || '',
          clips: batch.map(({ clip: c, wantMs }) => ({ url: c.url, text: c.text, handle: c.handle, frames: frames[c.url], times: judgeTimes[c.url], durationMs: c.durationMs, wantMs, meta: metaOf(c) })),
        });
        state.spent.judge += Number(data.cost) || 0;
        Object.entries(data.judgements || {}).forEach(([url, raw]) => { const j = clips.validateJudgement(raw); if (j) { judgements[url] = j; state.judgeCache.set(url, j); } });
        if (data.capped) { notes.push('The clip check reached its per-reel cap; unchecked clips use the strict caption check.'); judgeFailed = true; break; }
      } catch (error) {
        judgeFailed = true;
        failures += 1;
        if (error && (error.status === 429 || error.status === 402 || error.status === 503 || failures >= 2)) break;
      }
    }
    // Picks under the gate (the same code as the server).
    const scenes = (media.beats || []).map(b => ({
      beatId: b.beatId, subject: b.subject, wants: b.wants, kind: b.kind, durMs: beatMs.get(b.beatId) || 0,
      beat: flat.find(x => sid(x) === b.beatId) || null,
      clips: (b.clips || []).filter(c => c && c.url && !loadFailed.has(c.url)),
      photos: (b.photos || []).filter(p => p && p.verified === true), teamPhotos: (b.teamPhotos || []).filter(p => p && p.verified === true),
      cards: b.cards || [],
      lost: (b.clips || []).filter(c => c && loadFailed.has(c.url)).map(c => loadFailed.get(c.url)),
    }));
    const judgeAvailable = Boolean(media.judge && media.judge.ready && opts.ai !== false);
    const picks = clips.gatedPicks(scenes, { judgements, samples, judgeTimes, judgeAvailable, judgeFailed, used: new Set(opts.usedClips || []) });
    const beats = {};
    const picksById = {};
    scenes.forEach(s => {
      const p = picks[s.beatId] || { kind: 'none', candidates: [], failures: [] };
      const failuresOf = [...new Set([...(p.failures || []), ...(!isClipKind(p.kind) && s.lost.length ? s.lost : [])])];
      const pick = { ...stripCandidates(p), failures: failuresOf };
      picksById[s.beatId] = pick;
      const motion = clips.motionFor(s.beat || {}, pick);
      beats[s.beatId] = { kind: s.kind || s.wants, subject: s.subject, wants: s.wants, pick, clips: s.clips, photos: s.photos, teamPhotos: s.teamPhotos, cards: s.cards, candidates: p.candidates || [], motion, motionOk: motion !== 'none', failures: failuresOf };
    });
    const used = Object.values(beats).filter(b => isClipKind(b.pick.kind)).length;
    const want = scenes.filter(s => isClipKind(s.wants)).length;
    if (want && used < want) notes.push(`${want - used} scene${want - used === 1 ? '' : 's'} had no clip confirmed for its subject and use${want - used === 1 ? 's' : ''} a verified photo, a module or a graphic instead.`);
    const summary = summarize(plan, picksById, opts);
    const result = { beats, cost: Number(((Number(media.cost) || 0) + state.spent.judge).toFixed(6)), judged: Object.keys(judgements).length, notes, esStyle, subjects, judgements, judgeFailed, ...summary };
    state.last = result;
    progress('');
    return result;
  }
  // The reel-level motion rule + stats (+ the AI b-roll offer for beats that
  // still do not move: offered with its price, never run here).
  function summarize(plan, picksById, opts = {}) {
    const clips = C();
    const sum = clips.motionSummary(plan, picksById);
    const stats = clips.sourcingStats(plan, picksById);
    const actions = [...sum.actions];
    Object.entries(sum.beats).filter(([, b]) => !b.motionOk).forEach(([beatId]) => actions.push({ action: 'ai-broll', beatId, label: 'Make an AI b-roll clip (paid)', costUsd: Number.isFinite(Number(opts.aiBrollUsd)) ? Number(opts.aiBrollUsd) : null }));
    return { clipCount: sum.clipCount, needsClips: sum.needsClips, motionOk: sum.motionOk, motion: sum.beats, actions, stats };
  }
  // The slim clip the server keeps in the confirmed-clip library.
  function metaOf(c) {
    return { handle: c.handle, text: c.text, platform: c.platform, variants: (c.variants || []).slice(0, 4), durationMs: c.durationMs, source: c.source, sourceKind: c.sourceKind, teams: c.teams, players: c.players, postedAt: c.postedAt, shortSide: c.shortSide, trust: c.trust };
  }
  function stripCandidates(p) { const out = { ...p }; delete out.candidates; return out; }
  // The plan without heavy fields (the server needs beats, team, sport, title).
  function slimBeat(b) {
    return {
      id: sid(b), kind: b.kind, text: b.text, photo: b.photo, name: b.name, visual: b.visual, subject: b.subject, block: b.block, stat: b.stat, durMs: b.durMs,
      ...(b.media ? { media: { kind: b.media.kind, subject: b.media.subject, ...(Array.isArray(b.media.cards) ? { cards: b.media.cards.slice(0, 4).map(c => ({ name: c && c.name, tag: c && c.tag, sticker: c && c.sticker })) } : {}) } } : {}),
      ...(b.module && b.module.type ? { module: { type: b.module.type } } : {}),
    };
  }
  function slimPlan(plan) {
    const base = {
      title: plan.title, sport: plan.sport, team: plan.team ? { name: plan.team.name } : null, format: plan.format,
      style: plan.style, esStyle: plan.esStyle, look: plan.look, recipe: plan.recipe,
    };
    if (Array.isArray(plan.chapters) && plan.chapters.length) {
      const flat = C().beatsOf(plan).slice(0, 32);
      return { ...base, v: plan.v, chapters: plan.chapters.map((ch, i) => ({ id: (ch && ch.id) || `c${i + 1}`, beats: flat.filter(b => b.chapterId === ((ch && ch.id) || `c${i + 1}`)).map(slimBeat) })) };
    }
    return { ...base, beats: (plan.beats || []).slice(0, 32).map((b, i) => slimBeat(b.id ? b : { ...b, id: `b${i + 1}` })) };
  }

  // ─── candidates (Swap) ───────────────────────────────────────────────
  function candidates(beatId) {
    const b = state.last && state.last.beats[beatId];
    if (!b) return [];
    const current = refOf(b.pick);
    const list = (b.candidates || []).filter(c => refOf(c) !== current);
    return current ? [...list, ...(b.candidates || []).filter(c => refOf(c) === current)] : list;
  }
  function pickFrom(candidate, b, why) {
    if (isClipKind(candidate.kind)) return { kind: candidate.kind, clip: candidate.clip, relevance: candidate.relevance, gate: candidate.gate, segment: candidate.segment || null, why };
    const kind = b && b.kind === 'cutout' ? 'cutout' : 'photo';
    return { kind, photo: candidate.photo, kenBurns: C().kenBurnsFor(candidate.photo), ...(kind === 'cutout' ? { cutout: true } : {}), why };
  }
  function refresh(beatId) {
    const last = state.last;
    const b = last && last.beats[beatId];
    if (!b || !state.plan) return;
    const beat = C().beatsOf(state.plan).find(x => sid(x) === beatId) || {};
    b.motion = C().motionFor(beat, b.pick);
    b.motionOk = b.motion !== 'none';
    const picksById = Object.fromEntries(Object.entries(last.beats).map(([id, x]) => [id, x.pick]));
    Object.assign(last, summarize(state.plan, picksById));
  }
  // The person picked a candidate: it becomes the scene's pick.
  function choose(beatId, candidate) {
    const b = state.last && state.last.beats[beatId];
    if (!b || !candidate) return null;
    const before = b.pick;
    b.pick = pickFrom(candidate, b, 'chosen in Swap');
    // Feedback for the confirmed-clip library: the swapped-out clip down, the chosen one up.
    if (before && isClipKind(before.kind) && refOf(before) !== refOf(b.pick)) rank(refOf(before), -1, { beatId });
    if (isClipKind(b.pick.kind)) rank(refOf(b.pick), 1, { beatId });
    refresh(beatId);
    return b.pick;
  }
  // The current pick failed to load or play: the next confirmed clip, then a
  // verified photo with Ken Burns (subject, then team), then the v3 fallback
  // block / none. Never a random clip. -> the new pick (or null: no beat).
  function nextCandidate(beatId, { failed = '' } = {}) {
    const b = state.last && state.last.beats[beatId];
    if (!b) return null;
    const bad = failed || refOf(b.pick);
    b.tried = [...new Set([...(b.tried || []), bad].filter(Boolean))];
    if (bad) b.failures = [...new Set([...(b.failures || []), 'load-failed'])];
    const next = (b.candidates || []).find(c => !b.tried.includes(refOf(c)) && (!isClipKind(c.kind) || c.gate));
    if (next) b.pick = pickFrom(next, b, 'next candidate (the last one did not load)');
    else {
      const team = (b.teamPhotos || []).find(p => p && p.verified === true && !b.tried.includes(p.url));
      const beat = state.plan ? C().beatsOf(state.plan).find(x => sid(x) === beatId) || {} : {};
      b.pick = team ? pickFrom({ kind: 'photo', photo: team }, b, 'team photo (no other picture loaded)')
        : { kind: 'none', fallback: beat.module ? null : C().fallbackBlock(beat), why: 'no other relevant picture' };
    }
    b.pick.failures = b.failures;
    refresh(beatId);
    return b.pick;
  }
  // Keep (+1) / swap (-1) feedback for the confirmed-clip library; fire-and-forget.
  function rank(clipId, delta, { beatId = '', keys = null, api = null } = {}) {
    const url = String(clipId || '');
    const d = Number(delta) > 0 ? 1 : Number(delta) < 0 ? -1 : 0;
    if (!/^https:\/\//.test(url) || !d) return false;
    const b = beatId && state.last ? state.last.beats[beatId] : null;
    const sub = b && b.subject;
    const ks = keys || (sub ? keysFor(sub) : []);
    const call = api || state.api || defaultApi;
    try { Promise.resolve(call({ mode: 'clip-rank', url, delta: d, keys: ks })).catch(() => {}); } catch { /* never throws */ }
    return true;
  }
  // The confirmed-library keys of a subject (same as _reel-clip-confirmed.keysFor).
  function keysFor(sub = {}) {
    const n = v => C().norm(v).slice(0, 60);
    const out = [];
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(sub.date || '')) ? sub.date : '';
    if ((sub.type === 'player' || sub.type === 'person') && sub.name) out.push(`${sub.type}:${n(sub.name)}`);
    if (sub.type === 'game' && sub.name) out.push(`game:${n(sub.name)}${date ? `|${date}` : ''}`);
    if (sub.team && date) out.push(`game:${n(sub.team)}|${date}`);
    if (sub.type === 'team' && sub.name) out.push(`team:${n(sub.name)}`); else if (sub.team) out.push(`team:${n(sub.team)}`);
    return [...new Set(out)].slice(0, 4);
  }
  // Pure re-check of the motion rule after edits (no network).
  function motionCheck(plan, picks = null) {
    const picksById = picks || (state.last ? Object.fromEntries(Object.entries(state.last.beats).map(([id, x]) => [id, x.pick])) : {});
    return summarize(plan, picksById);
  }

  // ─── review ──────────────────────────────────────────────────────────
  function picksFor(plan) {
    const out = {};
    const last = state.last;
    const c = C();
    (plan && c ? c.beatsOf(plan) : []).forEach(beat => {
      const id = sid(beat);
      const b = last && last.beats[id];
      if (!b) return;
      const p = b.pick || { kind: 'none' };
      if (isClipKind(p.kind)) out[id] = { kind: p.kind, ref: p.clip.url, relevance: p.relevance, moment: p.moment == null ? null : p.moment, gate: p.gate, note: noteOf(p.clip, last.judgements) };
      else if (p.kind === 'photo' || p.kind === 'cutout') out[id] = { kind: p.kind, ref: p.photo.url, verified: p.photo.verified === true, note: p.photo.caption || p.photo.title || '' };
      else if (p.kind === 'cards') out[id] = { kind: 'cards', ref: '', verified: (p.cards || []).every(x => !x.photo || x.photo.verified === true) };
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
      const current = refOf(b.pick);
      const next = (b.candidates || []).find(c => refOf(c) !== current && (!isClipKind(c.kind) || c.gate === 'judge' || c.gate === 'library'));
      const beat = (data.plan && data.plan.beats || []).find(x => sid(x) === issue.beatId) || {};
      const team = !next && (b.teamPhotos || []).find(p => p && p.verified === true && p.url !== current);
      b.pick = next ? pickFrom(next, b, 'review re-pick') : team ? pickFrom({ kind: 'photo', photo: team }, b, 'review re-pick (team photo)') : { kind: 'none', fallback: clips ? clips.fallbackBlock(beat) : null, why: 'review: no other relevant picture' };
      refresh(issue.beatId);
      repicks[issue.beatId] = b.pick;
      issue.fixed = true;
    });
    const ready = !(data.issues || []).some(i => i.severity === 'critical' && !i.fixed);
    return { ...data, ready, repicks };
  }

  return {
    mediaFor, candidates, choose, review, picksFor, nextCandidate, rank, motionCheck, keysFor,
    styleOf: (plan, wanted) => { const c = C(); return c ? c.styleOf(plan || {}, wanted) : ''; },
    get last() { return state.last; },
    get spent() { return { ...state.spent }; },
    _test: { state, slimPlan, pickVariant, fetchClipFile, metaOf, reset() { state.last = null; state.plan = null; state.api = null; state.spent = { judge: 0, media: 0, review: 0 }; state.judgeCache = null; videoCache.clear(); loadFailures.clear(); } },
  };
}));
