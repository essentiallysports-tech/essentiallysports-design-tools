// Reels Studio timeline schema v2: the canvas, the data block (game digest,
// athlete stats, archive sources with citations), per-beat refs to data
// points, the replay frames and the carousel slides. One file for the
// browser (window.ReelTimeline), the server and the tests (require), like
// reel-formats.js. Pure: no DOM, no network.
//
// Phase 0 contract (project-docs/reels-formats-contract.md §3). Owned by the
// integrator: agents A, B and C read it; changes go through one PR.
//
//   normalizeTimeline(tl)   v1 or v2 in -> v2 out. Lossless for v1 (every v1
//                           field is kept as it was), idempotent, never mutates.
//   validateTimeline(tl)    -> { ok, errors: [{ path, msg }], warnings: [...] }
//   validateDigest(d)       -> same shape, for a GameDigest on its own (<= 8 KB)
//   digestFacts(d)          -> the text block the lint reads as extraSources
//   resolveRef(tl, ref)     'play:<id>' | 'wp:<seq>' | 'src:<id>' | 'stat:<id>' |
//                           'photo:<id>' | 'frame:<role>' -> the data point or null
//   canvasFor(tl)           -> { w, h, safe } (1080x1920 reel or 1080x1350 slide)
//
// v1 timelines (reel-render.js buildTimeline today: { v: 1, size: [1080, 1920],
// beats, tracks, assets, ... }) keep rendering exactly as before: the renderer
// does not call normalizeTimeline until Agent B wires the canvas through.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelTimeline = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const VERSION = 2;
  // Canvases. The reel safe zone matches reel-render.js SAFE; the slide safe
  // area is 60 px in on every side (IG 4:5 grid crop keeps the centre).
  const CANVASES = {
    reel: { w: 1080, h: 1920, safe: { left: 65, right: 1015, top: 270, bottom: 1580 } },
    slide: { w: 1080, h: 1350, safe: { left: 60, right: 1020, top: 60, bottom: 1290 } },
  };
  const SPORTS = ['nfl', 'cfb', 'mlb', 'golf'];
  const GAME_SPORTS = ['nfl', 'cfb', 'mlb']; // Game Swing (no NBA yet; golf has no plays or WP)
  const PROVIDERS = ['espn', 'cfbd', 'nflverse', 'mlb-statsapi'];
  const LIMITS = {
    timelineBytes: 200 * 1024, // frameup_reel_projects.timeline cap
    digestBytes: 8 * 1024,
    plays: 30,
    playText: 100,
    wpPoints: 120,
    sources: 30,
    photos: 30,
    statRows: 40,
    statLabels: 16,
    moments: 12,
    slides: 20,
    refsPerBeat: 8,
    frames: 3,
  };
  const ATTRIBUTION = { espn: 'Win probability: ESPN Analytics', nflverse: 'Win probability: nflfastR model', cfbd: 'Win probability: CollegeFootballData', 'mlb-statsapi': 'Win probability: MLB' };
  const REF_RE = /^(play|wp|src|stat|photo|frame):([A-Za-z0-9_.-]{1,40})$/;
  const FRAME_ROLES = ['setup', 'play', 'reaction'];
  const SLIDE_KINDS = ['cover', 'panel', 'moment', 'data', 'cta'];
  const ISO = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?$/;
  const HEX6 = /^#[0-9a-f]{6}$/i;

  const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const bytes = v => {
    const text = JSON.stringify(v == null ? null : v);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length; // eslint-disable-line no-undef
  };
  const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

  function canvasOf(raw, size) {
    const w = Number(raw && raw.w) || (Array.isArray(size) ? Number(size[0]) : 0) || 1080;
    const h = Number(raw && raw.h) || (Array.isArray(size) ? Number(size[1]) : 0) || 1920;
    const known = Object.values(CANVASES).find(c => c.w === w && c.h === h);
    return known ? { w: known.w, h: known.h } : { w, h };
  }
  function canvasFor(tl) {
    const c = canvasOf(tl && tl.canvas, tl && tl.size);
    const known = Object.values(CANVASES).find(k => k.w === c.w && k.h === c.h);
    return { w: c.w, h: c.h, safe: { ...(known || CANVASES.reel).safe } };
  }

  // ─── Normalise (v1 -> v2) ────────────────────────────────────────────────
  // Adds the v2 fields with empty defaults; keeps every v1 field untouched.
  function normalizeTimeline(input) {
    if (!isObj(input)) return null;
    const tl = clone(input);
    const canvas = canvasOf(tl.canvas, tl.size);
    tl.v = VERSION;
    tl.canvas = canvas;
    tl.size = [canvas.w, canvas.h]; // the v1 field the renderer reads today
    tl.outputs = Array.isArray(tl.outputs) && tl.outputs.length ? tl.outputs.filter(o => o === 'reel' || o === 'carousel') : ['reel'];
    if (!tl.outputs.length) tl.outputs = ['reel'];
    tl.data = isObj(tl.data) ? {
      game: isObj(tl.data.game) ? tl.data.game : null,
      athlete: isObj(tl.data.athlete) ? tl.data.athlete : null,
      archive: isObj(tl.data.archive) ? tl.data.archive : null,
    } : { game: null, athlete: null, archive: null };
    tl.replay = isObj(tl.replay) ? tl.replay : null;
    tl.slides = Array.isArray(tl.slides) ? tl.slides : [];
    if (Array.isArray(tl.beats)) tl.beats = tl.beats.map(b => (isObj(b) ? { ...b, refs: Array.isArray(b.refs) ? b.refs.map(String) : [] } : b));
    return tl;
  }

  // ─── Refs ────────────────────────────────────────────────────────────────
  function parseRef(ref) {
    const m = String(ref || '').match(REF_RE);
    return m ? { type: m[1], id: m[2] } : null;
  }
  function resolveRef(tl, ref) {
    const r = parseRef(ref);
    if (!r || !isObj(tl)) return null;
    const data = isObj(tl.data) ? tl.data : {};
    const game = isObj(data.game) ? data.game : null;
    const archive = isObj(data.archive) ? data.archive : null;
    const athlete = isObj(data.athlete) ? data.athlete : null;
    if (r.type === 'play') return game && Array.isArray(game.plays) ? game.plays.find(p => String(p.id) === r.id) || null : null;
    if (r.type === 'wp') {
      const points = game && game.wp && Array.isArray(game.wp.points) ? game.wp.points : [];
      const hit = points.find(p => String(p[0]) === r.id);
      return hit ? { seq: hit[0], wpHome: hit[1] } : null;
    }
    if (r.type === 'src') return archive && Array.isArray(archive.sources) ? archive.sources.find(s => String(s.id) === r.id) || null : null;
    if (r.type === 'photo') return archive && Array.isArray(archive.photos) ? archive.photos.find(p => String(p.id) === r.id) || null : null;
    if (r.type === 'stat') {
      const rows = athlete && athlete.stats && Array.isArray(athlete.stats.seasons) ? athlete.stats.seasons : [];
      if (r.id === 'totals' && athlete && athlete.stats && Array.isArray(athlete.stats.totals)) return { id: 'totals', stats: athlete.stats.totals };
      return rows.find(row => String(row.id) === r.id) || null;
    }
    if (r.type === 'frame') return tl.replay && Array.isArray(tl.replay.frames) ? tl.replay.frames.find(f => f.role === r.id) || null : null;
    return null;
  }

  // ─── Validation ──────────────────────────────────────────────────────────
  function collector() {
    const errors = [];
    const warnings = [];
    return { errors, warnings, err: (path, msg) => errors.push({ path, msg }), warn: (path, msg) => warnings.push({ path, msg }) };
  }
  const num01 = v => typeof v === 'number' && v >= 0 && v <= 1;

  // GameDigest (contract §3.2). Field by field, so a shape change in the
  // adapter is caught by the tests, not by the renderer on a game day.
  function checkDigest(d, c, at = 'data.game') {
    if (!isObj(d)) { c.err(at, 'not an object'); return; }
    if (d.v !== 1) c.err(`${at}.v`, 'digest version must be 1');
    if (!PROVIDERS.includes(d.provider)) c.err(`${at}.provider`, `unknown provider ${d.provider}`);
    if (!GAME_SPORTS.includes(d.sport)) c.err(`${at}.sport`, `sport must be one of ${GAME_SPORTS.join(', ')}`);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(d.eventId || ''))) c.err(`${at}.eventId`, 'missing or invalid');
    if (!ISO.test(String(d.fetchedAt || ''))) c.err(`${at}.fetchedAt`, 'ISO date-time required');
    const st = d.status;
    if (!isObj(st) || !['pre', 'in', 'post'].includes(st.state) || typeof st.final !== 'boolean') c.err(`${at}.status`, '{ state: pre|in|post, final, detail, period, clock } required');
    ['home', 'away'].forEach(side => {
      const t = d.teams && d.teams[side];
      if (!isObj(t)) { c.err(`${at}.teams.${side}`, 'missing'); return; }
      if (!/^[A-Z0-9&]{2,5}$/.test(String(t.abbr || ''))) c.err(`${at}.teams.${side}.abbr`, '2-5 capitals');
      if (!(Number.isInteger(t.score) && t.score >= 0)) c.err(`${at}.teams.${side}.score`, 'integer >= 0');
      if (!Array.isArray(t.linescore) || t.linescore.some(n => !(Number.isInteger(n) && n >= 0))) c.err(`${at}.teams.${side}.linescore`, 'integers per period');
      if (t.colors != null && (!Array.isArray(t.colors) || t.colors.some(x => !HEX6.test(String(x))))) c.err(`${at}.teams.${side}.colors`, '#rrggbb list');
      if (t.logo != null) c.err(`${at}.teams.${side}.logo`, 'no logo URLs in a digest (logos come from FrameUp\'s logo library by logoId)');
    });
    const wp = d.wp;
    if (wp != null) {
      if (!isObj(wp) || !Array.isArray(wp.points)) c.err(`${at}.wp`, '{ points: [[seq, wpHome]] } or null');
      else {
        if (wp.points.length > LIMITS.wpPoints) c.err(`${at}.wp.points`, `at most ${LIMITS.wpPoints} points`);
        let last = -2; // seq -1 is the pregame value
        wp.points.forEach((p, i) => {
          if (!Array.isArray(p) || p.length !== 2 || !Number.isInteger(p[0]) || p[0] < -1 || !num01(p[1])) c.err(`${at}.wp.points[${i}]`, '[seq int >= -1, wpHome 0-1]');
          else if (p[0] <= last) c.err(`${at}.wp.points[${i}]`, 'seq must increase');
          else last = p[0];
        });
        if (wp.points.length && !String(d.attribution || '').trim()) c.err(`${at}.attribution`, 'required when the digest has win probability');
      }
    }
    if (!Array.isArray(d.plays)) c.err(`${at}.plays`, 'array required');
    else {
      if (d.plays.length > LIMITS.plays) c.err(`${at}.plays`, `at most ${LIMITS.plays} plays`);
      const ids = new Set();
      let lastSeq = -1;
      d.plays.forEach((p, i) => {
        const pa = `${at}.plays[${i}]`;
        if (!isObj(p)) { c.err(pa, 'not an object'); return; }
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(p.id || ''))) c.err(`${pa}.id`, 'missing');
        if (ids.has(String(p.id))) c.err(`${pa}.id`, 'duplicate');
        ids.add(String(p.id));
        if (!Number.isInteger(p.seq) || p.seq <= lastSeq) c.err(`${pa}.seq`, 'integer, increasing (game order)');
        else lastSeq = p.seq;
        if (!(Number.isInteger(p.period) && p.period >= 1)) c.err(`${pa}.period`, 'integer >= 1');
        if (typeof p.clock !== 'string') c.err(`${pa}.clock`, 'string ("" when unknown)');
        if (p.half != null && !['top', 'bottom'].includes(p.half)) c.err(`${pa}.half`, 'top|bottom (MLB) or null');
        if (typeof p.text !== 'string' || !p.text || p.text.length > LIMITS.playText) c.err(`${pa}.text`, `1-${LIMITS.playText} chars`);
        if (!isObj(p.score) || !Number.isInteger(p.score.home) || !Number.isInteger(p.score.away)) c.err(`${pa}.score`, '{ home, away } integers after the play');
        if (p.wallclock != null && !ISO.test(String(p.wallclock))) c.err(`${pa}.wallclock`, 'ISO or null');
        if (p.wpHome != null && !num01(p.wpHome)) c.err(`${pa}.wpHome`, '0-1 or null');
        if (p.swing != null && !(typeof p.swing === 'number' && p.swing >= -1 && p.swing <= 1)) c.err(`${pa}.swing`, '-1..1 or null');
        if (typeof p.scoring !== 'boolean') c.err(`${pa}.scoring`, 'boolean');
        if (p.team != null && !['home', 'away'].includes(p.team)) c.err(`${pa}.team`, 'home|away|null');
        if (!Array.isArray(p.tags)) c.err(`${pa}.tags`, 'array');
      });
    }
    const size = bytes(d);
    if (size > LIMITS.digestBytes) c.err(at, `digest is ${size} bytes; the cap is ${LIMITS.digestBytes}`);
  }
  function validateDigest(d) {
    const c = collector();
    checkDigest(d, c, 'digest');
    return { ok: !c.errors.length, errors: c.errors, warnings: c.warnings, bytes: bytes(d) };
  }

  function checkAthlete(a, c, at = 'data.athlete') {
    if (!isObj(a)) { c.err(at, 'not an object'); return; }
    if (!PROVIDERS.includes(a.provider)) c.err(`${at}.provider`, 'unknown provider');
    if (!SPORTS.includes(a.sport)) c.err(`${at}.sport`, 'unknown sport');
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(a.athleteId || ''))) c.err(`${at}.athleteId`, 'missing');
    if (!String(a.name || '').trim()) c.err(`${at}.name`, 'missing');
    const s = a.stats;
    if (s != null) {
      if (!isObj(s) || !Array.isArray(s.labels) || !Array.isArray(s.seasons)) { c.err(`${at}.stats`, '{ category, labels, seasons, totals } or null'); return; }
      if (s.labels.length > LIMITS.statLabels) c.err(`${at}.stats.labels`, `at most ${LIMITS.statLabels}`);
      if (s.seasons.length > LIMITS.statRows) c.err(`${at}.stats.seasons`, `at most ${LIMITS.statRows} rows`);
      s.seasons.forEach((row, i) => {
        if (!isObj(row) || !/^s\d{4}(?:-[a-z0-9]{1,8})?$/.test(String(row.id || ''))) c.err(`${at}.stats.seasons[${i}].id`, '"s<year>" (or "s<year>-<team>" for a split season)');
        else if (!Number.isInteger(row.year)) c.err(`${at}.stats.seasons[${i}].year`, 'integer');
        else if (!Array.isArray(row.stats) || row.stats.length !== s.labels.length) c.err(`${at}.stats.seasons[${i}].stats`, 'one string per label');
      });
      if (s.totals != null && (!Array.isArray(s.totals) || s.totals.length !== s.labels.length)) c.err(`${at}.stats.totals`, 'one string per label');
    }
  }
  function checkArchive(a, c, at = 'data.archive') {
    if (!isObj(a)) { c.err(at, 'not an object'); return; }
    const sources = Array.isArray(a.sources) ? a.sources : null;
    if (!sources) { c.err(`${at}.sources`, 'array required'); return; }
    if (sources.length > LIMITS.sources) c.err(`${at}.sources`, `at most ${LIMITS.sources}`);
    sources.forEach((s, i) => {
      const pa = `${at}.sources[${i}]`;
      if (!isObj(s) || !/^a\d{1,3}$/.test(String(s.id || ''))) { c.err(`${pa}.id`, '"a<n>"'); return; }
      if (s.type !== 'es-article') c.err(`${pa}.type`, 'es-article');
      if (!/^https:\/\/(?:www\.)?essentiallysports\.com\//.test(String(s.url || ''))) c.err(`${pa}.url`, 'an essentiallysports.com article URL');
      if (!String(s.title || '').trim()) c.err(`${pa}.title`, 'missing');
      if (!ISO.test(String(s.date || ''))) c.err(`${pa}.date`, 'publish date (ISO) required');
    });
    (Array.isArray(a.photos) ? a.photos : []).forEach((p, i) => {
      const pa = `${at}.photos[${i}]`;
      if (!isObj(p) || !/^p\d{1,3}$/.test(String(p.id || ''))) { c.err(`${pa}.id`, '"p<n>"'); return; }
      if (!/^https:\/\/image-cdn\.essentiallysports\.com\//.test(String(p.url || ''))) c.err(`${pa}.url`, 'ES image pool only (image-cdn.essentiallysports.com)');
      if (!String(p.credit || '').trim()) c.warn(`${pa}.credit`, 'no photo credit');
    });
    if (Array.isArray(a.photos) && a.photos.length > LIMITS.photos) c.err(`${at}.photos`, `at most ${LIMITS.photos}`);
    (Array.isArray(a.moments) ? a.moments : []).forEach((m, i) => {
      const pa = `${at}.moments[${i}]`;
      if (!isObj(m) || !Array.isArray(m.cite) || !m.cite.length) c.err(`${pa}.cite`, 'every moment cites at least one src: or stat: ref');
      else m.cite.forEach(ref => { const r = parseRef(ref); if (!r || !['src', 'stat'].includes(r.type)) c.err(`${pa}.cite`, `bad cite ${ref}`); });
      if (!isObj(m) || !Number.isInteger(m.year)) c.err(`${pa}.year`, 'integer year from a cited source');
    });
    if (Array.isArray(a.moments) && a.moments.length > LIMITS.moments) c.err(`${at}.moments`, `at most ${LIMITS.moments}`);
  }
  function checkReplay(r, c, at = 'replay') {
    if (!isObj(r)) { c.err(at, 'not an object'); return; }
    if (!['x', 'library', 'upload'].includes(r.origin)) c.err(`${at}.origin`, 'x|library|upload');
    if (!r.clipAsset && !r.clipUrl) c.err(at, 'clipAsset or clipUrl required');
    if (r.segment != null && !(isObj(r.segment) && r.segment.in >= 0 && r.segment.out > r.segment.in)) c.err(`${at}.segment`, '{ in, out } seconds, out > in');
    if (!['ai', 'code', 'manual'].includes(r.picker)) c.err(`${at}.picker`, 'ai|code|manual');
    const frames = Array.isArray(r.frames) ? r.frames : [];
    if (frames.length > LIMITS.frames) c.err(`${at}.frames`, 'three frames: setup, play, reaction');
    frames.forEach((f, i) => {
      if (!isObj(f) || !FRAME_ROLES.includes(f.role) || !(typeof f.t === 'number' && f.t >= 0)) c.err(`${at}.frames[${i}]`, '{ role: setup|play|reaction, t: seconds }');
    });
  }

  function validateTimeline(input) {
    const c = collector();
    if (!isObj(input)) return { ok: false, errors: [{ path: '', msg: 'not a timeline' }], warnings: [] };
    if (input.v != null && input.v !== 1 && input.v !== 2) c.err('v', 'version must be 1 or 2');
    const tl = normalizeTimeline(input);
    const canvas = tl.canvas;
    if (!Object.values(CANVASES).some(k => k.w === canvas.w && k.h === canvas.h)) c.err('canvas', 'canvas must be 1080x1920 (reel) or 1080x1350 (slide)');
    if (tl.outputs.includes('reel') && canvas.h !== 1920) c.err('canvas', 'a reel output needs the 1080x1920 canvas');
    if (tl.data.game) checkDigest(tl.data.game, c);
    if (tl.data.athlete) checkAthlete(tl.data.athlete, c);
    if (tl.data.archive) checkArchive(tl.data.archive, c);
    if (tl.replay) checkReplay(tl.replay, c);

    // Beats: refs resolve; data beats carry the refs they draw from.
    (Array.isArray(tl.beats) ? tl.beats : []).forEach((b, i) => {
      if (!isObj(b)) { c.err(`beats[${i}]`, 'not an object'); return; }
      if (b.refs.length > LIMITS.refsPerBeat) c.err(`beats[${i}].refs`, `at most ${LIMITS.refsPerBeat}`);
      b.refs.forEach(ref => {
        if (!parseRef(ref)) c.err(`beats[${i}].refs`, `bad ref ${ref}`);
        else if (!resolveRef(tl, ref)) c.err(`beats[${i}].refs`, `${ref} does not resolve`);
      });
      if (b.kind === 'play' && !b.refs.some(r => r.startsWith('play:'))) c.err(`beats[${i}]`, 'a play beat needs a play: ref');
      if (b.kind === 'wpline' && !(tl.data.game && tl.data.game.wp && tl.data.game.wp.points && tl.data.game.wp.points.length)) c.err(`beats[${i}]`, 'a wpline beat needs win probability in data.game');
      if (b.kind === 'moment' && !b.refs.some(r => r.startsWith('src:') || r.startsWith('stat:'))) c.err(`beats[${i}]`, 'a moment cites a src: or stat: ref');
      if (b.kind === 'panel3' && !b.refs.some(r => r.startsWith('frame:'))) c.err(`beats[${i}]`, 'a panel3 beat needs frame: refs');
    });
    const showsWp = (tl.beats || []).some(b => b && (b.kind === 'wpline' || (b.refs || []).some(r => r.startsWith('wp:'))));
    if (showsWp && !String(tl.data.game && tl.data.game.attribution || '').trim()) c.err('data.game.attribution', 'win probability on screen needs its attribution');

    // Slides (carousel, 1080x1350 each).
    if (tl.slides.length > LIMITS.slides) c.err('slides', `at most ${LIMITS.slides} slides (Instagram's limit)`);
    if (tl.slides.length && !tl.outputs.includes('carousel')) c.warn('slides', 'slides without the carousel output');
    if (tl.outputs.includes('carousel') && !tl.slides.length) c.warn('slides', 'carousel output with no slides yet');
    const slideIds = new Set();
    tl.slides.forEach((s, i) => {
      const pa = `slides[${i}]`;
      if (!isObj(s)) { c.err(pa, 'not an object'); return; }
      if (!/^s\d{1,2}$/.test(String(s.id || '')) || slideIds.has(s.id)) c.err(`${pa}.id`, 'unique "s<n>"');
      slideIds.add(s.id);
      if (!SLIDE_KINDS.includes(s.kind)) c.err(`${pa}.kind`, SLIDE_KINDS.join('|'));
      if (s.beat != null && !(tl.beats || []).some(b => b && b.id === s.beat)) c.err(`${pa}.beat`, 'unknown beat id');
      (Array.isArray(s.refs) ? s.refs : []).forEach(ref => { if (!resolveRef(tl, ref)) c.err(`${pa}.refs`, `${ref} does not resolve`); });
    });
    if (tl.slides.length && tl.slides[0].kind !== 'cover') c.warn('slides[0]', 'the first slide is usually the cover');

    const size = bytes(input);
    if (size > LIMITS.timelineBytes) c.err('', `timeline is ${size} bytes; the cloud cap is ${LIMITS.timelineBytes}`);
    return { ok: !c.errors.length, errors: c.errors, warnings: c.warnings, bytes: size };
  }

  // ─── Facts (lint extraSources) ───────────────────────────────────────────
  // Deterministic text built only from the digest, so every number a Game
  // Swing beat shows (scores, periods, clock, down and distance, WP percent)
  // is backed. WP percentages are written as whole numbers for both teams.
  const pct = v => `${Math.round(v * 100)}%`;
  function digestFacts(d) {
    if (!isObj(d) || !isObj(d.teams)) return '';
    const h = d.teams.home || {};
    const a = d.teams.away || {};
    const lines = [];
    lines.push(`${a.name || a.abbr} ${a.score} at ${h.name || h.abbr} ${h.score}${d.status && d.status.final ? ' (final)' : ''}.`);
    if (Array.isArray(h.linescore) && Array.isArray(a.linescore)) lines.push(`By period: ${a.abbr} ${a.linescore.join('-')}; ${h.abbr} ${h.linescore.join('-')}.`);
    (Array.isArray(d.plays) ? d.plays : []).forEach(p => {
      const when = [p.half ? `${p.half} ${p.period}` : `period ${p.period}`, p.clock].filter(Boolean).join(' ');
      const wp = p.wpHome != null ? ` Win probability ${h.abbr} ${pct(p.wpHome)}, ${a.abbr} ${pct(1 - p.wpHome)}.` : '';
      lines.push(`${when}: ${p.down ? `${p.down}. ` : ''}${/[.!?]$/.test(p.text) ? p.text : `${p.text}.`} Score ${a.abbr} ${p.score.away}, ${h.abbr} ${p.score.home}.${wp}`);
    });
    const pts = d.wp && Array.isArray(d.wp.points) ? d.wp.points : [];
    if (pts.length) {
      const lows = pts.reduce((m, p) => (p[1] < m[1] ? p : m), pts[0]);
      const highs = pts.reduce((m, p) => (p[1] > m[1] ? p : m), pts[0]);
      lines.push(`Lowest ${h.abbr} win probability ${pct(lows[1])} (${a.abbr} ${pct(1 - lows[1])}); highest ${pct(highs[1])} (${a.abbr} ${pct(1 - highs[1])}).`);
    }
    if (d.attribution) lines.push(`${d.attribution}.`);
    return lines.join('\n');
  }

  return {
    VERSION, CANVASES, SPORTS, GAME_SPORTS, PROVIDERS, LIMITS, ATTRIBUTION, FRAME_ROLES, SLIDE_KINDS, REF_RE,
    normalizeTimeline, validateTimeline, validateDigest, digestFacts, resolveRef, parseRef, canvasFor, bytes,
  };
}));
