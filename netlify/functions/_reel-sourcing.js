'use strict';
// Reels v3 sourcing (server): the right picture for every scene, and the
// review pass that makes a reel "Ready to post" in one go.
//
//   sceneMedia({ plan, esStyle, judgements, exclude }, ctx)
//     Per scene: its subject (the director's, else derived), what the style
//     wants there (clip / photo / none), trusted clip candidates for that
//     subject (video-ads find-clips: the shared library first, live search
//     for at most LIMITS.liveSearches subjects; _clip-trust.js unchanged),
//     verified photos (_asset-service findPhotos -> _photo-verify: only
//     photos verified to show the person / team, with their focus and head
//     boxes) and the pick. A clip is picked only when the vision judge
//     confirmed its subject and moment (reel-clips.js GATE); the browser
//     samples the frames of `judgeQueue` and sends them to clip-judge. No
//     relevant clip -> a verified photo -> an infographic block. Never a
//     random clip, never an unverified photo.
//   review({ plan, picks, corpus }, ctx)
//     Code checks (media relevance, sourced numbers, text on the scale,
//     brand colours and order) plus one cheap model call (Haiku, feature
//     reels-review, capped by maxTokens) that reads the scenes against their
//     pictures and sources. Safe fixes are applied; media problems come back
//     as 'repick'.
//
// Costs (logged in frameup_ai_usage): clip search as video-ads-find-clips
// (cached 30 min per team, library first, $0.06 cap a live search), photo
// verification as reels-photo-verify (vision for at most LIMITS.visionSubjects
// subjects, ~$0.01 each; the rest by caption evidence, $0), the clip judge as
// reels-clip-judge ($0.03 a reel), the review as reels-review (~$0.001).
const C = require('../../reel-clips.js');
const F = require('../../reel-formats.js');
const RULES = require('../../frameup-rules.js');
const gatewayModule = () => require('./_ai-gateway.js');

const PHOTO_FEATURE = 'reels-photo-verify';
const REVIEW_FEATURE = 'reels-review';
const LIMITS = {
  scenes: 14,
  subjects: 6, // clip / photo searches per reel
  liveSearches: 2, // paid live clip searches per reel (the rest: library + free sources)
  visionSubjects: 3, // photo vision checks per reel (~$0.01 each)
  clipsPerScene: 12,
  photosPerSubject: 4,
  searchMs: 40000,
  photoMs: 25000,
  reviewCorpus: 3000,
};
const CLIP_SPORTS = ['nfl', 'cfb', 'mlb'];
const AWAY_VIA = ['sport', 'colorx', 'color']; // find-clips widening: other teams' clips, never about the subject

const clean = (v, n = 200) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const money = usd => Number((Number(usd) || 0).toFixed(6));
const withTimeout = (promise, ms, fallback) => {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback).finally(() => clearTimeout(timer)),
    new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]);
};

// ─── Defaults (tests inject their own) ──────────────────────────────────
function defaultDeps() {
  return {
    findClips: (body, track) => require('./video-ads.js').findClipsFor(body, track),
    findPhotos: (args, ctx) => require('./_asset-service.js').findPhotos(args, ctx),
    verifyWithVision: (subject, photos, opts) => require('./_photo-verify.js').verifyWithVision(subject, photos, opts),
    judgeCache: require('./_reel-clip-judge.js').CACHE,
    teams: require('../../video-ads-teams.js'),
    gateway: gatewayModule(),
  };
}

// The Gateway with every call logged under the Reels feature (photo-verify
// logs as generate-photo-pick by itself; read-only reuse, no change there).
function trackedGateway(gateway, feature) {
  return { ...gateway, aiText: args => gateway.aiText({ ...args, track: { ...(args && args.track), feature } }) };
}

const CLIP_FIELDS = ['url', 'handle', 'text', 'variants', 'durationMs', 'source', 'sourceKind', 'platform', 'teams', 'players', 'postedAt', 'ageHours', 'shortSide', 'via', 'subjectHit', 'trust', 'quality'];
const slimClip = c => Object.fromEntries(CLIP_FIELDS.filter(k => c[k] !== undefined).map(k => [k, c[k]]));
function photoOut(p) {
  return {
    url: p.url || p.src, sourceUrl: p.sourceUrl, verified: true, verifiedBy: p.verifiedBy || '',
    focus: p.focus || null, head: p.focal || p.head || null, kind: p.kind || '', shot: p.shot || p.detail || '',
    title: clean(p.title, 160), caption: clean(p.caption, 220), credit: clean(p.credit, 120), width: p.width || null, height: p.height || null,
    main: Boolean(p.main), rights: p.rights || null,
  };
}

// The search one subject needs: its team (one search per team, shared by
// every scene of that team) or, with no team, the moment as a query.
function searchKey(subject, sport, teams) {
  const teamName = subject.type === 'team' ? subject.name : subject.team;
  const team = teamName && teams && teams.findTeam ? teams.findTeam(teamName, sport) : null;
  return team ? `team:${team.name}` : `q:${C.norm([subject.name, subject.moment].filter(Boolean).join(' ')).slice(0, 80)}`;
}
const subjectHitLocal = (clip, subject) => {
  const name = C.norm(subject.name);
  if (!name) return false;
  return ` ${C.norm([clip.text, ...(clip.players || [])].join(' '))} `.includes(` ${name} `);
};

async function sceneMedia(body = {}, ctx = {}) {
  const deps = { ...defaultDeps(), ...(ctx.deps || {}) };
  const plan = body.plan && typeof body.plan === 'object' ? body.plan : null;
  if (!plan || !Array.isArray(plan.beats) || !plan.beats.length) return { ok: false, status: 400, error: 'There is no reel to find pictures for yet.' };
  const style = C.styleOf(plan, body.esStyle || (C.STYLE_IDS.includes(body.style) ? body.style : ''));
  const exclude = new Set((Array.isArray(body.exclude) ? body.exclude : []).map(u => clean(u, 400)).filter(Boolean));
  const track = ctx.track || null;
  const aiAllowed = ctx.aiAllowed !== false;
  const sport = CLIP_SPORTS.includes(plan.sport) ? plan.sport : '';
  const capped = { clips: false, photos: false };
  const costs = { clips: 0, photos: 0 };

  const scenes = plan.beats.slice(0, LIMITS.scenes).map((beat, i) => {
    const b = beat && typeof beat === 'object' ? beat : {};
    const subject = C.subjectOfBeat(b, plan);
    return { beatId: clean(b.id, 40) || `b${i + 1}`, beat: b, block: b.block ? b.block.type || '' : '', subject, wants: C.wantsFor(b, style), durMs: Number(b.durMs) || 0, clips: [], photos: [] };
  });
  const uniq = list => [...new Map(list.map(s => [s.subject.key, s.subject])).values()];
  // Clip subjects (only where the style wants a clip, and the sport has clips).
  const clipSubjects = sport ? uniq(scenes.filter(s => s.wants === 'clip')).slice(0, LIMITS.subjects) : [];
  if (sport && uniq(scenes.filter(s => s.wants === 'clip')).length > LIMITS.subjects) capped.clips = true;
  // Photo subjects: photo scenes, and clip scenes (their fallback).
  const photoSubjects = uniq(scenes.filter(s => s.wants === 'photo' || s.wants === 'clip')).slice(0, LIMITS.subjects);

  // ── Clips: one search per team / query, ranked per subject ──
  const searches = new Map();
  clipSubjects.forEach(sub => {
    const key = searchKey(sub, sport, deps.teams);
    if (!searches.has(key)) searches.set(key, { key, subject: sub, subjects: [] });
    searches.get(key).subjects.push(sub);
  });
  let live = 0;
  const clipWork = [...searches.values()].map(async search => {
    const freeOnly = !aiAllowed || live >= LIMITS.liveSearches;
    if (!freeOnly) live += 1; else if (aiAllowed) capped.clips = true;
    const res = await withTimeout(deps.findClips({ mode: 'find-clips', sport, subject: search.subject }, { ...(track || {}), freeOnly }), LIMITS.searchMs, null);
    if (!res || !res.ok) return;
    costs.clips += Number(res.cost) || 0;
    const pool = (res.clips || []).filter(c => c && c.url && Array.isArray(c.variants) && c.variants.length && !AWAY_VIA.includes(c.via) && !exclude.has(c.url));
    search.subjects.forEach(sub => {
      const ranked = pool.map(c => ({ ...slimClip(c), subjectHit: subjectHitLocal(c, sub) })).sort((a, b) => b.subjectHit - a.subjectHit).slice(0, LIMITS.clipsPerScene);
      scenes.filter(s => s.wants === 'clip' && s.subject.key === sub.key).forEach(s => { s.clips = ranked; });
    });
  });

  // ── Photos: verified only ──
  const photoGateway = deps.gateway && deps.gateway.gatewayConfigured && deps.gateway.gatewayConfigured() ? trackedGateway(deps.gateway, PHOTO_FEATURE) : null;
  const names = photoSubjects.filter(s => s.type === 'player').map(s => s.name);
  const photoWork = photoSubjects.map(async (sub, i) => {
    const vision = aiAllowed && photoGateway && i < LIMITS.visionSubjects;
    if (aiAllowed && photoGateway && i >= LIMITS.visionSubjects) capped.photos = true;
    const args = sub.type === 'player'
      ? { person: sub.name, sport: plan.sport || '', teams: sub.team ? [sub.team] : [], others: names.filter(n => n !== sub.name), count: LIMITS.photosPerSubject }
      : sub.type === 'team' ? { team: sub.name, query: sub.name, sport: plan.sport || '', count: LIMITS.photosPerSubject }
        : { query: sub.name, team: sub.team || '', sport: plan.sport || '', count: LIMITS.photosPerSubject };
    const photoCtx = {
      email: track && track.email, token: track && track.token, gated: true,
      deps: { verify: vision ? (subject, photos, opts) => deps.verifyWithVision(subject, photos, { ...opts, gateway: photoGateway }) : null, vision: null },
    };
    const res = await withTimeout(deps.findPhotos(args, photoCtx), LIMITS.photoMs, null);
    if (!res || res.ok === false) return;
    costs.photos += Number(res.cost) || 0;
    const verified = (res.photos || []).filter(p => p && p.verified === true && (p.url || p.src) && p.sourceUrl && !exclude.has(p.sourceUrl) && !exclude.has(p.url)).map(photoOut);
    scenes.filter(s => (s.wants === 'photo' || s.wants === 'clip') && s.subject.key === sub.key).forEach(s => { s.photos = verified; });
  });
  await Promise.all([...clipWork, ...photoWork]);

  // ── Judgements: what the browser sent (validated) + this server's cache ──
  const judgements = {};
  const sent = body.judgements && typeof body.judgements === 'object' ? body.judgements : {};
  Object.entries(sent).slice(0, 60).forEach(([url, raw]) => { const j = C.validateJudgement(raw); if (j) judgements[clean(url, 400)] = j; });
  const now = Date.now();
  scenes.forEach(s => s.clips.forEach(c => {
    if (judgements[c.url]) return;
    const hit = deps.judgeCache && deps.judgeCache.get(c.url);
    if (hit && now - hit.at < 6 * 3600e3) judgements[c.url] = hit.j;
  }));
  const gw = deps.gateway;
  const judgeAvailable = Boolean(aiAllowed && gw && gw.gatewayConfigured && gw.gatewayConfigured() && !(gw.featureDisabled && gw.featureDisabled('reels-clip-judge')));
  const picks = C.gatedPicks(scenes, { judgements, judgeAvailable });
  const judgedFor = (url, key) => Boolean(judgements[url] && judgements[url].relevance && key in judgements[url].relevance);
  const judgeQueue = judgeAvailable ? C.judgeQueue(scenes.filter(s => s.wants === 'clip'), { judged: judgedFor }) : [];

  const subjects = uniq(scenes).map(s => ({ key: s.key, label: s.name, ...(s.moment ? { moment: s.moment } : {}), type: s.type }));
  const beats = scenes.map(s => {
    const p = picks[s.beatId] || { kind: 'none' };
    const j = url => judgements[url];
    return {
      beatId: s.beatId, block: s.block, wants: s.wants, subject: s.subject,
      clips: s.clips.map(c => {
        const jj = j(c.url);
        const rel = jj && jj.relevance && Number.isFinite(jj.relevance[s.subject.key]) ? jj.relevance[s.subject.key] : null;
        const mom = jj && jj.moment && Number.isFinite(jj.moment[s.subject.key]) ? jj.moment[s.subject.key] : null;
        const pass = rel != null ? C.passesGate(jj, s.subject) : (!judgeAvailable && C.textGate(c, s.subject));
        return { ...c, relevance: rel, moment: mom, judged: rel != null, gate: pass ? (rel != null ? 'judge' : 'text') : '', score: C.judgedScore(c, C.subjectFor({ subject: s.subject }, plan), jj || null).score };
      }),
      photos: s.photos,
      pick: {
        kind: p.kind,
        ref: p.kind === 'clip' ? p.clip.url : p.kind === 'photo' ? p.photo.url : '',
        ...(p.segment ? { segment: p.segment } : {}),
        ...(p.kind === 'clip' ? { relevance: p.relevance, moment: p.moment, gate: p.gate } : {}),
        ...(p.kind === 'none' && s.wants !== 'none' ? { fallback: p.fallback } : {}),
        why: p.why || '',
      },
    };
  });
  const cost = costs.clips + costs.photos;
  return {
    ok: true, esStyle: style, beats, judgeQueue, subjects,
    judge: { ready: judgeAvailable, maxClips: C.JUDGE.maxClips, perCall: C.JUDGE.perCall, maxUsdPerReel: C.JUDGE.maxUsdPerReel, threshold: { relevance: C.GATE.relevance, moment: C.GATE.moment } },
    cost: money(cost), costs: { clips: money(costs.clips), photos: money(costs.photos) }, capped,
  };
}

// ─── Review ─────────────────────────────────────────────────────────────
// Numbers in the v3 blocks' fields (reel-formats numberFields knows the
// older blocks; these are checked here so a statTile cannot carry an
// unsourced number).
function v3BlockStrings(block) {
  const b = block && typeof block === 'object' ? block : {};
  const arr = v => (Array.isArray(v) ? v : []);
  const out = [];
  if (b.type === 'photoCard') out.push(b.label);
  if (b.type === 'statTiles') arr(b.tiles).forEach(t => out.push(t && t.value, t && t.label, t && t.chip));
  if (b.type === 'dotGrid') { out.push(b.total, b.title); arr(b.groups).forEach(g => out.push(g && g.n, g && g.label)); }
  if (b.type === 'streak') out.push(b.label);
  if (b.type === 'rankTile') out.push(b.kicker, b.rank, b.pos, b.chip);
  if (b.type === 'tagPill' || b.type === 'clipLabel') out.push(b.text);
  return out.filter(v => v != null && v !== '').map(String);
}
function unsourcedIn(beat, sourceSet, format) {
  const bad = new Set(F.unsourcedNumbers(beat, sourceSet, format));
  v3BlockStrings(beat.block).forEach(s => F.numbersIn(s).forEach(n => { if (!sourceSet.has(n)) bad.add(n); }));
  return [...bad];
}
const LINE_MAX = 14; // ES line / pill characters (reel-es LIMITS.lineChars)
const TEXT_WORDS = 9;
const SIGNALS = ['green', 'red'];
const KNOWN_BLOCKS = ['hook', 'statement', 'number', 'dots', 'compare', 'quote', 'endcard', 'photoCard', 'statTiles', 'dotGrid', 'streak', 'rankTile', 'tagPill', 'clipLabel'];

function wrapLines(text, max = LINE_MAX, n = 3) {
  const out = [];
  let line = '';
  String(text || '').split(/\s+/).filter(Boolean).forEach(w => {
    if (!line) line = w; else if (`${line} ${w}`.length <= max) line = `${line} ${w}`; else { out.push(line); line = w; }
  });
  if (line) out.push(line);
  return out.slice(0, n).map(l => l.slice(0, max + 6));
}
const stripNumber = (text, n) => String(text || '').replace(new RegExp(`[$#]?${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,/g, ',?')}[%MK]?`, 'g'), '').replace(/\s+/g, ' ').trim();

// Code checks + safe fixes on a copy of the plan. -> { plan, issues }
function codeReview(planIn, { picks = {}, corpus = '', style = '' } = {}) {
  const plan = JSON.parse(JSON.stringify(planIn));
  const issues = [];
  const add = (beatId, kind, severity, problem, fix, fixed) => issues.push({ beatId, kind, severity, problem, fix, fixed: Boolean(fixed) });
  const sourceSet = F.numberSet(corpus);
  const haveCorpus = Boolean(String(corpus || '').trim());
  const beats = plan.beats || [];
  // Order: hook first, end card last.
  const hookAt = beats.findIndex(b => b && b.kind === 'hook');
  if (hookAt > 0) { beats.unshift(beats.splice(hookAt, 1)[0]); add(beats[0].id || 'b1', 'brand', 'warn', 'The hook was not the first scene.', 'reorder', true); }
  const ctaAt = beats.findIndex(b => b && b.kind === 'cta');
  if (ctaAt >= 0 && ctaAt !== beats.length - 1) { beats.push(beats.splice(ctaAt, 1)[0]); add(beats[beats.length - 1].id || '', 'brand', 'warn', 'The end card was not last.', 'reorder', true); }

  beats.forEach((beat, i) => {
    const id = beat.id || `b${i + 1}`;
    const block = beat.block && typeof beat.block === 'object' ? beat.block : null;
    // ── media ──
    const pick = picks[id];
    if (pick && pick.kind === 'clip') {
      const judgedOk = pick.gate === 'judge' && Number(pick.relevance) >= C.GATE.relevance && (pick.moment == null || Number(pick.moment) >= C.GATE.moment);
      if (!judgedOk && pick.gate !== 'text') add(id, 'media', 'critical', 'This clip was not confirmed to show the scene\'s subject.', 'repick', false);
    } else if (pick && pick.kind === 'photo' && pick.verified !== true) {
      add(id, 'media', 'critical', 'This photo is not verified to show the subject.', 'repick', false);
    }
    // ── blocks we do not know draw as unknown boxes ──
    if (block && !KNOWN_BLOCKS.includes(block.type)) {
      beat.block = C.fallbackBlock({ ...beat, block: null });
      add(id, 'brand', 'critical', `Unknown block "${clean(block.type, 20)}".`, 'statement', true);
    }
    // ── facts ──
    if (haveCorpus) {
      const bad = unsourcedIn(beat, sourceSet, plan.format);
      if (bad.length) {
        const b = beat.block;
        if (b && b.type === 'statTiles') b.tiles = (b.tiles || []).filter(t => !bad.some(n => F.numbersIn(`${t.value} ${t.label} ${t.chip || ''}`).includes(n)));
        if (b && b.type === 'dotGrid' && bad.some(n => F.numbersIn(String(b.total)).includes(n))) beat.block = C.fallbackBlock({ ...beat, block: null, stat: null });
        if (b && b.type === 'rankTile' && bad.some(n => F.numbersIn(`${b.rank} ${b.chip}`).includes(n))) beat.block = C.fallbackBlock({ ...beat, block: null, stat: null });
        if (b && b.type === 'statTiles' && !b.tiles.length) beat.block = C.fallbackBlock({ ...beat, block: null, stat: null });
        bad.forEach(n => { beat.text = stripNumber(beat.text, n); beat.vo = stripNumber(beat.vo, n); });
        if (beat.stat && bad.some(n => F.numbersIn(String(beat.stat.value)).includes(n))) delete beat.stat;
        const still = unsourcedIn(beat, sourceSet, plan.format);
        add(id, 'fact', still.length ? 'critical' : 'warn', `Number${bad.length > 1 ? 's' : ''} not in the sources: ${bad.join(', ')}.`, 'drop-number', !still.length);
      }
    }
    // ── text on the scale ──
    if (F.wordCount(beat.text) > TEXT_WORDS) { beat.text = F.trimWords(beat.text, TEXT_WORDS); add(id, 'text', 'warn', 'On-screen line too long.', 'shorten', true); }
    const b = beat.block;
    if (b && Array.isArray(b.lines) && b.lines.some(l => String(l.text || '').length > LINE_MAX)) {
      const blue = (b.lines.find(l => l.color === 'blue') || {}).text || '';
      const lines = wrapLines(b.lines.map(l => l.text).join(' '));
      b.lines = lines.map((t, k) => ({ text: t, color: blue && blue.includes(t) ? 'blue' : (k === lines.length - 1 && lines.length > 1 && !blue ? 'blue' : 'ink') }));
      add(id, 'text', 'warn', 'A headline line was over 14 characters.', 'shorten', true);
    }
    if (b && Array.isArray(b.pills) && b.pills.some(p => String(p.text || '').length > LINE_MAX)) {
      b.pills = b.pills.map(p => ({ ...p, text: wrapLines(p.text, LINE_MAX, 1)[0] || p.text }));
      add(id, 'text', 'warn', 'A pill was over 14 characters.', 'shorten', true);
    }
    if (b && b.type === 'statTiles' && Array.isArray(b.tiles)) {
      if (b.tiles.length > 3) { b.tiles = b.tiles.slice(0, 3); add(id, 'brand', 'warn', 'More than 3 stat tiles.', 'trim', true); }
      b.tiles.forEach(t => { if (String(t.label || '').length > 18) { t.label = F.trimWords(t.label, 3).slice(0, 18); add(id, 'text', 'warn', 'A tile label was too long.', 'shorten', true); } });
    }
    if (b && (b.type === 'tagPill' || b.type === 'clipLabel') && String(b.text || '').length > 28) { b.text = String(b.text).slice(0, 28).replace(/\s+\S*$/, ''); add(id, 'text', 'warn', 'The pill text was too long.', 'shorten', true); }
    // ── brand colours: never yellow on screen; at most 2 signals ──
    if (b) {
      const colored = [...(b.pills || []), ...(b.lines || []), ...(b.items || []), ...(b.tiles || []), ...(b.type === 'number' ? [b] : [])];
      let yellow = false;
      colored.forEach(x => { ['color', 'tone'].forEach(k => { if (x[k] === 'yellow') { x[k] = 'blue'; yellow = true; } }); });
      if (b.type === 'tagPill' && b.tone === 'yellow') { b.tone = 'red'; yellow = true; }
      if (yellow) add(id, 'brand', 'warn', 'Yellow is for captions only.', 'recolor', true);
      const signals = new Set();
      let over = false;
      colored.forEach(x => ['color', 'tone'].forEach(k => {
        if (!SIGNALS.includes(x[k])) return;
        if (signals.size >= 2 && !signals.has(x[k])) { x[k] = 'ink'; over = true; } else signals.add(x[k]);
      }));
      if (over) add(id, 'brand', 'warn', 'More than two signal colours.', 'recolor', true);
    }
    // ── banned wording ──
    RULES.BANNED.forEach(rule => { if (rule.re.test(`${beat.text} ${beat.vo}`)) add(id, 'text', 'warn', rule.why, 'rewrite', false); });
  });
  // Game Tape is video-first: most media scenes should carry a clip.
  if (style === 'gametape') {
    const media = beats.filter(b => picks[b.id] && picks[b.id].kind !== undefined);
    const clips = media.filter(b => picks[b.id].kind === 'clip').length;
    if (media.length >= 3 && clips / media.length < 0.5) add('', 'media', 'warn', `Only ${clips} of ${media.length} scenes have a relevant clip; the rest use verified photos or graphics.`, 'none', false);
  }
  plan.beats = beats;
  return { plan, issues };
}

const REVIEW_SYSTEM = [
  'You review an EssentiallySports vertical sports reel before it is posted. Each scene has on-screen words, a voiceover line, a block and the picture chosen for it (a clip with what a vision check saw, a verified photo with its caption, or a graphic).',
  'Report only real problems: the picture does not fit the words (wrong player, wrong team, wrong moment); a claim the SOURCES do not support; on-screen words that are vague, too long or do not match the voiceover.',
  'For a words problem you may give a fixed on-screen line ("text", 2-9 words, numbers only from SOURCES) and/or a fixed voiceover ("vo"). Never add a number that is not in SOURCES. For a picture problem give no text, only the problem.',
  'Reply with JSON only: {"issues":[{"beat":"<id>","kind":"media|fact|text","problem":"<= 14 words","text":"optional","vo":"optional"}]}. No problems: {"issues":[]}.',
].join('\n');

function reviewRequest(plan, picks, corpus) {
  const lines = (plan.beats || []).map((b, i) => {
    const id = b.id || `b${i + 1}`;
    const p = picks[id] || {};
    const pic = p.kind === 'clip' ? `clip: "${clean(p.note || p.text, 120)}"${p.relevance != null ? ` (judge ${p.relevance}/10)` : ''}` : p.kind === 'photo' ? `photo: "${clean(p.note || p.caption || p.title, 120)}"` : 'graphic only';
    const block = b.block && b.block.type ? b.block.type : b.kind;
    return `- ${id} [${block}] subject: ${clean(b.subject && b.subject.name, 60) || '-'} | text: "${clean(b.text, 90)}" | vo: "${clean(b.vo, 220)}" | picture: ${pic}`;
  });
  return ['SCENES:', ...lines, 'SOURCES:', '<<<', clean(corpus, LIMITS.reviewCorpus) || '(none)', '>>>'].join('\n');
}

async function review(body = {}, ctx = {}) {
  const planIn = body.plan && typeof body.plan === 'object' ? body.plan : null;
  if (!planIn || !Array.isArray(planIn.beats) || !planIn.beats.length) return { ok: false, status: 400, error: 'There is no reel to review yet.' };
  const picksIn = body.picks && typeof body.picks === 'object' ? body.picks : {};
  const picks = {};
  Object.entries(picksIn).slice(0, 40).forEach(([id, p]) => {
    if (!p || typeof p !== 'object') return;
    picks[clean(id, 40)] = {
      kind: ['clip', 'photo', 'none'].includes(p.kind) ? p.kind : 'none', ref: clean(p.ref, 400),
      relevance: Number.isFinite(Number(p.relevance)) && p.relevance !== null ? Number(p.relevance) : null,
      moment: Number.isFinite(Number(p.moment)) && p.moment !== null ? Number(p.moment) : null,
      gate: ['judge', 'text'].includes(p.gate) ? p.gate : '', verified: p.verified === true, note: clean(p.note, 160),
    };
  });
  const corpus = clean(body.corpus, 12000);
  const style = C.styleOf(planIn, body.esStyle);
  const checked = codeReview(planIn, { picks, corpus, style });
  const plan = checked.plan;
  const issues = checked.issues;
  let cost = 0;
  let model = '';
  const gw = (ctx.deps && ctx.deps.gateway) || gatewayModule();
  if (ctx.aiAllowed !== false && gw && gw.gatewayConfigured && gw.gatewayConfigured()) {
    try {
      const reply = await gw.aiText({
        tier: 'main', system: REVIEW_SYSTEM, cacheSystem: true, json: true,
        messages: [{ role: 'user', content: reviewRequest(plan, picks, corpus) }],
        effort: 'low', maxTokens: 700, timeoutMs: 15000,
        track: ctx.track ? { ...ctx.track, feature: REVIEW_FEATURE } : undefined,
      });
      cost = Number(reply.cost) || 0;
      model = reply.model || '';
      const m = String(reply.text || '').match(/\{[\s\S]*\}/);
      let parsed = null;
      try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
      const sourceSet = F.numberSet(corpus);
      (Array.isArray(parsed && parsed.issues) ? parsed.issues : []).slice(0, 10).forEach(row => {
        const beat = plan.beats.find((b, i) => (b.id || `b${i + 1}`) === clean(row && row.beat, 40));
        if (!beat) return;
        const id = beat.id || `b${plan.beats.indexOf(beat) + 1}`;
        const kind = ['media', 'fact', 'text'].includes(row.kind) ? row.kind : 'text';
        const problem = clean(row.problem, 120) || 'Flagged by the review.';
        if (kind === 'media') { add(id, 'media', 'critical', problem, 'repick', false); return; }
        const next = { ...beat, text: row.text ? F.trimWords(clean(row.text, 90), TEXT_WORDS) : beat.text, vo: row.vo ? F.trimWords(clean(row.vo, 260), 40) : beat.vo };
        const safe = (row.text || row.vo) && !F.unsourcedNumbers({ text: next.text, vo: next.vo }, sourceSet, plan.format).length && !RULES.BANNED.some(r => r.re.test(`${next.text} ${next.vo}`));
        if (safe) {
          beat.text = next.text;
          beat.vo = next.vo;
          if (row.text && beat.block && beat.block.type === 'statement') {
            const lines = wrapLines(next.text.toUpperCase());
            beat.block.lines = lines.map((t, k) => ({ text: t, color: k === lines.length - 1 && lines.length > 1 ? 'blue' : 'ink' }));
          }
        }
        add(id, kind, kind === 'fact' && !safe ? 'critical' : 'warn', problem, 'rewrite', Boolean(safe));
      });
    } catch (error) {
      model = '';
    }
  }
  function add(beatId, kind, severity, problem, fix, fixed) { issues.push({ beatId, kind, severity, problem, fix, fixed: Boolean(fixed) }); }
  const ready = !issues.some(i => i.severity === 'critical' && !i.fixed);
  return { ok: true, ready, issues: issues.slice(0, 40), plan, cost: money(cost), model, esStyle: style };
}

module.exports = { sceneMedia, review, codeReview, reviewRequest, REVIEW_SYSTEM, PHOTO_FEATURE, REVIEW_FEATURE, LIMITS, v3BlockStrings, unsourcedIn, _test: { searchKey, trackedGateway, photoOut, wrapLines, stripNumber } };
