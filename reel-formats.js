// Reels Studio: the reel formats, the code-first format router, pacing, the
// number-provenance helpers and the per-reel cost estimate. One file for the
// browser (window.ReelFormats) and the server (require), like video-ads-brands.js.
//
// project-docs/ai-reels-research.md §1.2-1.4 (formats, craft norms, router),
// §5.1 (lint rules) and §7.1 (costs). Formats need no game footage: ES photos,
// team logos, stat cards drawn by the renderer, a voiceover and captions.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelFormats = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const SPORTS = [
    { id: 'nfl', label: 'NFL' },
    { id: 'cfb', label: 'College Football' },
    { id: 'mlb', label: 'MLB' },
    { id: 'golf', label: 'Golf' },
  ];

  // Beat kinds the director may write and the renderer draws.
  //   hook     the claim or number, visible from frame 0
  //   context  what happened (label: WHAT HAPPENED)
  //   point    one idea per beat
  //   stat     a big number + label (kinetic count-up)
  //   rank     a Top-5 entry (#5 … #1)
  //   quote    a quote card (never a cloned voice; the VO reads context, not the quote as the speaker)
  //   payoff   why it matters
  //   cta      the end card: a question that invites comments
  //   …and the data beats the styles add (reel-styles.js COMPONENT_KINDS):
  //   bars, versus, dotrank, chips, steps, tiles, roles, mystery
  const STORY_KINDS = ['hook', 'context', 'point', 'stat', 'rank', 'quote', 'payoff', 'cta'];
  const COMPONENT_KINDS = ['bars', 'versus', 'dotrank', 'chips', 'steps', 'tiles', 'roles', 'mystery'];
  const KINDS = [...STORY_KINDS, ...COMPONENT_KINDS];
  // What a beat shows (the director plans it; the page fills it, never empty):
  //   clip (a video clip), photo (ES image pool), headshot (a person's photo),
  //   logo-tile (team logo on a team-colour field), scene (stadium, crowd…;
  //   an AI scene image or b-roll clip when nothing real is found), chart
  //   (the data component itself over a dimmed clip or the style background).
  const VISUALS = ['clip', 'photo', 'headshot', 'logo-tile', 'scene', 'chart'];
  // Scene subjects an AI image or b-roll clip may show. A closed list: the
  // prompt is built from it, never from the script, so no names get in.
  const SCENES = ['stadium', 'crowd', 'field', 'ball', 'trophy', 'skyline', 'locker', 'scoreboard'];

  const FORMATS = {
    explainer: {
      id: 'explainer',
      label: 'Explained in 30s',
      short: 'Explainer',
      tag: 'EXPLAINED',
      blurb: 'What happened and why it matters, in five to seven beats.',
      beats: { min: 5, max: 8 },
      kinds: ['hook', 'context', 'point', 'stat', 'quote', 'payoff', 'cta'],
      targetSeconds: [24, 40],
      maxSeconds: 60,
    },
    stat: {
      id: 'stat',
      label: 'Stat / Record alert',
      short: 'Stat alert',
      tag: 'STAT ALERT',
      blurb: 'One surprising number, counted up, then the context.',
      beats: { min: 4, max: 7 },
      kinds: ['hook', 'stat', 'context', 'point', 'quote', 'payoff', 'cta'],
      targetSeconds: [20, 35],
      maxSeconds: 60,
    },
    top5: {
      id: 'top5',
      label: 'Top-5 countdown',
      short: 'Top 5',
      tag: 'TOP 5',
      blurb: 'Five ranked entries, #5 to #1. Viewers stay for #1.',
      beats: { min: 7, max: 8 },
      kinds: ['hook', 'rank', 'cta'],
      targetSeconds: [28, 50],
      maxSeconds: 75,
    },
    quote: {
      id: 'quote',
      label: 'Quote reel',
      short: 'Quote',
      tag: 'IN THEIR WORDS',
      blurb: 'A real quote as kinetic type, with context. Never a cloned voice.',
      beats: { min: 4, max: 7 },
      kinds: ['hook', 'quote', 'context', 'point', 'payoff', 'cta'],
      targetSeconds: [20, 40],
      maxSeconds: 60,
    },
  };
  // The news formats (trend-first path; the format picker lists these).
  const FORMAT_IDS = Object.keys(FORMATS);

  // ─── Data formats (Phase 0 contract: project-docs/reels-formats-contract.md) ─
  // Built from live game data, a clip, or a player's career, not from a trend.
  // They sit BESIDE the trend-first path (a format gallery), so FORMAT_IDS
  // above stays the four news formats and the existing picker is unchanged.
  // Every server and renderer check that clamps an unknown format to
  // 'explainer' reads FORMATS, so registering them here is the whole "enum"
  // change (the DB column is char_length <= 40, no migration).
  //
  // Data beat kinds the new formats add (drawn by reel-render.js once Agent B
  // lands them; until then buildTimeline treats them as 'point'):
  //   play    one play of a game: scorebug state + play caption over a clip or photo
  //           { playRef: 'play:<id>' } (score, clock, WP come from timeline.data.game, never the model)
  //   wpline  the win-probability line (full-screen payoff or a band under the scorebug)
  //           { from: <seq>, to: <seq>, marks: ['play:<id>'] }
  //   moment  one career moment on a year rail { year, title, line, cite: ['src:a1'|'stat:2001'] }
  //   panel3  the 3-frame strip (setup / play / reaction) { frames: ['frame:setup', 'frame:play', 'frame:reaction'] }
  const DATA_KINDS = ['play', 'wpline', 'moment', 'panel3'];
  const ALL_KINDS = [...KINDS, ...DATA_KINDS];
  // Carousel slide kinds (1080x1350, timeline.slides[]).
  const SLIDE_KINDS = ['cover', 'panel', 'moment', 'data', 'cta'];
  // Where a format's material comes from (reel-flow.js SOURCE_KINDS has the step).
  const SOURCE_KINDS = ['trend', 'game', 'clip', 'player'];
  const OUTPUTS = ['reel', 'carousel'];

  const DATA_FORMATS = {
    gameswing: {
      id: 'gameswing',
      family: 'data',
      label: 'Game Swing',
      short: 'Game Swing',
      tag: 'GAME SWING',
      blurb: 'The plays that swung the game, with a live scorebug, the win-probability line and the clock over the clips.',
      description: 'Pick a finished or live game. FrameUp picks the biggest win-probability swings and the scoring plays, draws an ES scorebug, clock and win-probability line over each clip, and writes short captions from the play-by-play.',
      source: 'game',
      sports: ['nfl', 'cfb', 'mlb'],
      defaultStyle: 'es', // ES Reels (2026-11-25: the older styles are retired; the look re-skins it)
      outputs: ['reel'],
      beats: { min: 4, max: 8 },
      // Story kinds keep today's director and renderer working; dataKinds are
      // what the format is really made of once the data agents land.
      kinds: ['hook', 'context', 'point', 'stat', 'payoff', 'cta'],
      dataKinds: ['play', 'wpline'],
      targetSeconds: [18, 30],
      maxSeconds: 45,
      voice: 'off', // music only by default; VO optional
      attribution: 'Win probability: ESPN Analytics', // on screen whenever a wpline or WP number shows
      cost: { data: true, framePick: false, archiveResearch: false, hint: 'about $0.002 per reel' },
      rights: { footage: 'organic', paidWithLeagueFootage: 'warn' },
    },
    replay: {
      id: 'replay',
      family: 'data',
      label: 'Moment Replay',
      short: 'Replay',
      tag: 'MOMENT REPLAY',
      blurb: 'One moment as three frames: the setup, the play, the reaction. A reel and a swipeable carousel from one clip.',
      description: 'Paste an X clip, pick one from the clip library, or upload an ES clip. FrameUp finds the setup, the play and the reaction frames (code first, an optional AI pick), lays them out as a 3-panel strip, and exports a short reel and a 1080x1350 carousel.',
      source: 'clip',
      sports: ['nfl', 'cfb', 'mlb', 'golf'],
      defaultStyle: 'es', // ES Reels (2026-11-25: the older styles are retired; the look re-skins it)
      outputs: ['reel', 'carousel'],
      beats: { min: 3, max: 5 },
      kinds: ['hook', 'point', 'payoff', 'cta'],
      dataKinds: ['panel3'],
      targetSeconds: [8, 15],
      maxSeconds: 20,
      voice: 'off',
      attribution: '',
      cost: { data: false, framePick: true, archiveResearch: false, hint: 'about $0.002 per reel with the AI frame pick, free without' },
      // X / library / upload are allowed for organic posts (existing rights
      // checks apply); a paid export with league footage warns.
      rights: { footage: 'organic', paidWithLeagueFootage: 'warn', clipSources: ['x', 'library', 'upload'] },
      carousel: { slides: { min: 4, max: 5 } },
    },
    archive: {
      id: 'archive',
      family: 'data',
      label: 'Hall-of-Fame Archive',
      short: 'Archive',
      tag: 'FROM THE ARCHIVE',
      blurb: 'A career told in moments, each one cited to ES coverage or a stat row.',
      description: 'Search a player. FrameUp gathers ES articles, ES photos and career stats, proposes the best moments with a source for every year and number, and builds a year-by-year reel and a carousel.',
      source: 'player',
      sports: ['nfl', 'cfb', 'mlb', 'golf'],
      defaultStyle: 'es', // ES Reels (2026-11-25: the older styles are retired; the look re-skins it)
      outputs: ['reel', 'carousel'],
      beats: { min: 5, max: 8 },
      kinds: ['hook', 'context', 'point', 'stat', 'payoff', 'cta'],
      dataKinds: ['moment'],
      targetSeconds: [30, 50],
      maxSeconds: 60,
      voice: 'optional',
      attribution: '',
      cost: { data: true, framePick: false, archiveResearch: true, hint: 'about $0.003 per reel' },
      rights: { footage: 'none', photos: 'es-pool-only' },
      carousel: { slides: { min: 4, max: 10 } },
    },
  };
  Object.assign(FORMATS, DATA_FORMATS);
  const DATA_FORMAT_IDS = Object.keys(DATA_FORMATS);
  const ALL_FORMAT_IDS = [...FORMAT_IDS, ...DATA_FORMAT_IDS];
  const isDataFormat = id => Object.prototype.hasOwnProperty.call(DATA_FORMATS, id);
  // A beat kind the format may hold (story kinds, the style components the
  // director already writes, and the format's own data kinds).
  function formatKinds(id) {
    const f = FORMATS[id] || FORMATS.explainer;
    return [...new Set([...f.kinds, ...(f.dataKinds || [])])];
  }

  // Labels drawn above context / point / payoff beats.
  const KIND_LABELS = { context: 'WHAT HAPPENED', point: 'THE DETAIL', payoff: 'WHY IT MATTERS', stat: '', rank: '', quote: '', hook: '', cta: '', bars: '', versus: '', dotrank: '', chips: '', steps: '', tiles: '', roles: '', mystery: '', play: '', wpline: '', moment: '', panel3: '' };

  // Pacing (research §1.3): about 2.6 words a second for VO, a visual change
  // every 1.5-3 s, one idea per beat. On-screen text 1-9 words; VO up to 28.
  const PACE = {
    wordsPerSecond: 2.6,
    beatMinMs: { hook: 1800, stat: 2200, rank: 2400, cta: 2200, default: 1600 },
    beatMaxMs: 7000,
    tailMs: 260, // air after the VO before the next beat
    endTailMs: 700, // the last beat holds a little longer (loop-friendly)
    voLeadMs: 100, // VO starts 0.1 s into the reel (hook rule: <= 0.2 s)
    shotMaxMs: 3200, // longer beats get a second shot (punch-in or a second photo)
    textMaxWords: 9,
    voMaxWords: 28,
    reelMinSeconds: 20,
    reelMaxSeconds: 45,
  };

  // ─── Router (code first; the director is the tiebreaker) ───────────────
  const ROUTES = [
    { format: 'top5', re: /\b(?:top[\s-]?(?:5|five|10|ten)|best|worst|power rankings?|ranked|rankings?|mvp race|heisman race|cy young race|biggest|longest)\b/i },
    { format: 'stat', re: /\b(?:first|most|record|since|fastest|youngest|oldest|career[- ]high|all[- ]time|history|historic|streak|milestone)\b|\d[\d,.]*\s*(?:yards|yds|tds?|touchdowns|hrs?|home runs|strikeouts|points|birdies|under par|shots|strokes|wins)\b/i },
    { format: 'quote', re: /[“"][^”"]{12,}[”"]|\b(?:said|says|slams|responds|blasts|admits|reveals|told reporters|press conference)\b/i },
    { format: 'explainer', re: /\b(?:trade[ds]?|injur(?:y|ed|ies)|contract|extension|signs?|signed|fired|firing|suspend(?:ed|ion)|release[ds]?|waive[ds]?|benched|explained|why)\b/i },
  ];
  // Data-format hints for a trend card ("this story could be a Game Swing").
  // Kept apart from ROUTES: routeFormat() only ever returns a news format, so
  // the trend-first path behaves exactly as before.
  const DATA_ROUTES = [
    { format: 'gameswing', re: /\b(?:comeback|rall(?:y|ied|ies)|walk[\s-]?off|game[\s-]?winn(?:er|ing)|buzzer[\s-]?beater|overtime|ot thriller|last[\s-]second|late[\s-]game|collapse|blew a \d+)\b/i },
    { format: 'replay', re: /\b(?:catch of the (?:year|season)|one[\s-]handed|highlight|viral (?:play|catch|clip)|insane (?:catch|throw|play)|ace|hole[\s-]in[\s-]one|robbed|diving)\b/i },
    { format: 'archive', re: /\b(?:hall of fame|hof|retire[ds]?|retirement|legacy|career|anniversary|years? ago|throwback|on this day|goat)\b/i },
  ];
  function suggestDataFormat(text) {
    const source = String(text || '');
    const hit = DATA_ROUTES.find(route => route.re.test(source));
    return hit ? hit.format : '';
  }
  function routeFormat(text) {
    const source = String(text || '');
    const hits = ROUTES.filter(route => route.re.test(source)).map(route => route.format);
    return { format: hits[0] || 'explainer', candidates: hits.length ? hits : ['explainer'], ruled: Boolean(hits.length) };
  }

  // ─── Numbers: provenance (research §5.1 "Facts", blocking) ─────────────
  // Every number in on-screen text, VO and stat cards must appear in the
  // sources (the brief, the trend, ES facts or the capped fact check).
  const NUMBER_RE = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
  const normNumber = raw => String(raw).replace(/,/g, '').replace(/^0+(?=\d)/, '').replace(/\.0+$/, '');
  function numbersIn(text) {
    return [...String(text || '').matchAll(NUMBER_RE)].map(match => normNumber(match[0]));
  }
  // Spelled-out small numbers are words, not facts; ordinals keep their digits.
  function numberSet(text) {
    return new Set(numbersIn(text));
  }
  // Numbers that need no source: the rank of a Top-5 entry and its "Top 5",
  // and a step tracker's own "step 2 of 3" (it counts the reel's parts).
  function structuralNumbers(format, beat) {
    const allowed = new Set();
    if (format === 'top5') { allowed.add('5'); ['1', '2', '3', '4', '5'].forEach(n => { if (beat && String(beat.rank) === n) allowed.add(n); }); }
    if (beat && beat.kind === 'steps' && beat.steps) {
      const total = Number(beat.steps.total);
      if (Number.isInteger(total) && total >= 1 && total <= 9) for (let i = 1; i <= total; i += 1) allowed.add(String(i));
    }
    return allowed;
  }
  const arr = v => (Array.isArray(v) ? v : []);
  // Every field of a beat that can carry a number, the data components
  // included (the lint and the director both walk this list).
  function numberFields(beat) {
    const b = beat || {};
    const out = [b.text, b.vo, b.stat && b.stat.value, b.stat && b.stat.label, b.detail, b.name, b.quote && b.quote.text];
    arr(b.bars).forEach(x => out.push(x && x.label, x && x.value, x && x.note));
    arr(b.versus).forEach(x => out.push(x && x.name, x && x.value, x && x.note));
    if (b.dotrank) out.push(b.dotrank.total, b.dotrank.rank, b.dotrank.label, b.dotrank.note);
    if (b.chips) out.push(b.chips.filled, b.chips.total, b.chips.label);
    if (b.steps) out.push(b.steps.label, ...(b.kind === 'steps' ? [] : [b.steps.current, b.steps.total]));
    arr(b.tiles).forEach(x => out.push(x && x.label, x && x.chip));
    arr(b.roles).forEach(x => out.push(x && x.role, x && x.value, x && x.note));
    // ES Reels blocks (reel-es.js): every on-screen field of the block.
    const k = b.block;
    if (k && typeof k === 'object') {
      arr(k.pills).forEach(x => out.push(x && x.text));
      if (k.stamp) out.push(k.stamp.text);
      arr(k.lines).forEach(x => out.push(x && x.text));
      if (k.type === 'number') out.push(k.display || `${k.prefix || ''}${k.value}${k.suffix || ''}`, k.label, k.kicker);
      if (k.type === 'dots') out.push(k.count, k.highlight, k.label, k.note);
      if (k.type === 'compare') { out.push(k.kicker); arr(k.items).forEach(x => out.push(x && x.label, x && x.display, x && x.value)); }
      if (k.type === 'quote') out.push(k.text, k.who);
    }
    return out.filter(v => v != null && v !== '').map(String);
  }
  // Plan-level fields drawn on screen (eyebrow, the series tag, the data strip).
  function planNumberFields(plan) {
    const p = plan || {};
    const out = [p.eyebrow, p.series && p.series.tag];
    if (p.strip) out.push(p.strip.label, p.strip.value, p.strip.of, p.strip.note);
    return out.filter(v => v != null && v !== '').map(String);
  }
  function unsourcedPlanNumbers(plan, sourceSet) {
    const out = [];
    planNumberFields(plan).forEach(f => numbersIn(f).forEach(n => { if (!sourceSet.has(n) && !out.includes(n)) out.push(n); }));
    return out;
  }
  // Returns the numbers in a beat that the sources do not back.
  function unsourcedNumbers(beat, sourceSet, format) {
    const allowed = structuralNumbers(format, beat);
    const fields = numberFields(beat);
    const out = [];
    fields.forEach(field => numbersIn(field).forEach(n => {
      if (!sourceSet.has(n) && !allowed.has(n) && !out.includes(n)) out.push(n);
    }));
    return out;
  }

  // ─── Words ──────────────────────────────────────────────────────────────
  const words = text => String(text || '').trim().split(/\s+/).filter(Boolean);
  const wordCount = text => words(text).length;
  function estimateVoMs(vo) {
    const n = wordCount(vo);
    if (!n) return 0;
    const pauses = (String(vo).match(/[,;:—–-]\s/g) || []).length * 140 + (String(vo).match(/[.!?](\s|$)/g) || []).length * 220;
    return Math.round((n / PACE.wordsPerSecond) * 1000 + pauses);
  }

  // ─── Cost estimate per reel (research §7.1, Gateway list prices 2026-11) ─
  // Shown in the UI before anything is spent. Real costs come back from the
  // server on every call and are logged in frameup_ai_usage (feature reels-*).
  const money = usd => (usd < 0.01 ? `$${(Math.max(0, usd)).toFixed(3)}` : `$${usd.toFixed(2)}`);
  const PRICES = {
    directorHaiku: 0.002,
    directorSonnet: 0.02,
    revise: 0.0015,
    factCheckCap: 0.03, // two web searches, hard-capped on the server
    // Gateway list prices (ai-gateway.vercel.sh/v1/models, 2026-11-17):
    // elevenlabs/eleven-flash-v2.5 $0.00004/char; scribe-v2 alignment $0.000061/s.
    voicePerChar: { elevenlabs: 0.00008, gateway: 0.00008, off: 0 },
    alignPerSecond: { elevenlabs: 0, gateway: 0.000061112, off: 0 },
    // Per speech model (gateway list prices, 2026-11-17). Eleven v4 is the
    // default house model: the most human, expressive ElevenLabs voice.
    voiceModels: {
      'elevenlabs/eleven-v4': 0.00008, 'elevenlabs/eleven-v3': 0.00008, 'elevenlabs/eleven-multilingual-v2': 0.00008,
      'elevenlabs/eleven-v4-turbo': 0.00004, 'elevenlabs/eleven-flash-v2.5': 0.00004, 'openai/tts-1': 0.000015, 'microsoft/mai-voice-2-flash': 0.000015,
    },
    musicPerSecond: 0.0025,
    clipSearch: 0.06, // one capped x.com search (Video Ads find-clips); cached 30 min, often free
    sceneImage: 0.011, // bfl/flux-3-image-klein, one AI scene still
    aiClipPerSecond: 0.03, // google/veo-3.1-lite-generate-001, 720p, no audio
    aiClipSeconds: 4,
    // Data formats (research §D.3, §G.2): game data and ES coverage cost $0
    // in fees; the AI frame pick is one small vision call, hard-capped.
    data: 0,
    archiveResearch: 0,
    framePick: 0.002, // google/gemini-3.5-flash-lite, 9 frames at 320 px
    framePickCap: 0.02,
  };
  function estimateCost({ tier = 'standard', factCheck = false, voiceMode = 'off', voiceModel = '', voChars = 450, revisions = 0, musicSeconds = 0, clipSearches = 0, scenes = 0, aiClips = 0, longForm = false, clipJudge = 0, data = false, framePick = 0, archiveResearch = false } = {}) {
    const base = tier === 'economy' ? PRICES.directorHaiku : PRICES.directorHaiku + 0.35 * PRICES.directorSonnet; // standard escalates to Sonnet only on a weak plan
    const director = longForm ? base * 2.2 : base; // a 90-120 s script is about twice the tokens
    const perChar = voiceMode === 'off' ? 0 : (PRICES.voiceModels[voiceModel] ?? PRICES.voicePerChar[voiceMode] ?? 0);
    const lines = [
      // Data-format lines first (only when asked for, so news reels are unchanged).
      ...(data ? [{ id: 'data', label: 'Game and stats data (free)', usd: PRICES.data }] : []),
      ...(archiveResearch ? [{ id: 'archive', label: 'ES articles and photos search (free)', usd: PRICES.archiveResearch }] : []),
      ...(framePick ? [{ id: 'framepick', label: `Pick the 3 frames with AI (capped at ${money(PRICES.framePickCap)})`, usd: Math.min(PRICES.framePickCap, framePick * PRICES.framePick) }] : []),
      { id: 'director', label: tier === 'economy' ? 'Script (Haiku)' : 'Script (Haiku, Sonnet if weak)', usd: director },
      { id: 'factcheck', label: 'Fact check (2 searches, capped)', usd: factCheck ? PRICES.factCheckCap : 0 },
      { id: 'voice', label: voiceMode === 'off' ? 'Voiceover (captions only)' : 'Voiceover + caption timing', usd: perChar * Math.max(0, voChars) + (PRICES.alignPerSecond[voiceMode] || 0) * (Math.max(0, voChars) / 15) },
      ...(clipSearches ? [{ id: 'clips', label: `Find official X clips (${clipSearches} search${clipSearches > 1 ? 'es' : ''}, often cached)`, usd: clipSearches * PRICES.clipSearch }] : []),
      ...(clipJudge ? [{ id: 'clipjudge', label: 'Pick the best clips (vision check, capped at $0.10, cached per clip)', usd: clipJudge }] : []),
      ...(aiClips ? [{ id: 'aiclips', label: `AI b-roll clips (${aiClips} × ${PRICES.aiClipSeconds} s)`, usd: aiClips * PRICES.aiClipSeconds * PRICES.aiClipPerSecond }] : []),
      ...(scenes ? [{ id: 'scenes', label: `AI scene images (${scenes})`, usd: scenes * PRICES.sceneImage }] : []),
      { id: 'revise', label: 'Revisions', usd: revisions * PRICES.revise },
      ...(musicSeconds ? [{ id: 'music', label: 'Generated music bed', usd: musicSeconds * PRICES.musicPerSecond }] : []),
      { id: 'render', label: 'Render and export (in your browser)', usd: 0 },
    ];
    const total = lines.reduce((sum, line) => sum + line.usd, 0);
    return { lines, total: Math.round(total * 10000) / 10000 };
  }

  // estimateCost() options for a format's defaults (the gallery card and the
  // Make step pass these, plus the editor's own choices).
  function formatCostOptions(id, { aiFramePick = true } = {}) {
    const f = FORMATS[id];
    if (!f || !f.cost) return {};
    const out = { data: Boolean(f.cost.data), archiveResearch: Boolean(f.cost.archiveResearch), framePick: f.cost.framePick && aiFramePick ? 1 : 0 };
    if (f.voice === 'off') out.voiceMode = 'off';
    return out;
  }

  // ─── Music library ───────────────────────────────────────────────────────
  // The shared FrameUp audio library (audio-library.json, tracks in
  // assets/audio/, licence { organic, paid }) first, else reels-music.json
  // (licence text + organic / paid flags). Either shape becomes
  //   { id, title, artist, src, mood, sports, licence: text, organic, paid }
  // and a track without a licence or a same-origin file is dropped, so the
  // rights checks (organic / paid) always have something to read.
  const MUSIC_FILES = ['audio-library.json', 'reels-music.json'];
  function musicTracks(data) {
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.tracks) ? data.tracks : []);
    return list.map(t => {
      if (!t || !t.id || !t.src) return null;
      const src = String(t.src);
      if (/^(?:[a-z]+:)?\/\//i.test(src) || /^data:/i.test(src)) return null; // same origin only (the mix reads the bytes)
      const lic = t.licence && typeof t.licence === 'object' ? t.licence : null;
      const text = String(lic ? (lic.name || lic.text || lic.label || lic.source || lic.id || '') : (t.licence || '')).trim();
      const organic = lic ? lic.organic === true : t.organic !== false;
      const paid = lic ? lic.paid === true : t.paid === true;
      const licence = text || (lic ? 'FrameUp audio library' : '');
      if (!licence) return null;
      return {
        id: String(t.id).slice(0, 60), title: String(t.title || t.name || t.id).slice(0, 80), artist: String(t.artist || t.library || '').slice(0, 60),
        src, mood: String(t.mood || ''), sports: Array.isArray(t.sports) ? t.sports : [], licence, organic, paid,
      };
    }).filter(Boolean);
  }

  // ─── Clips vs images (Suhail: "80% clips and 20% images") ─────────────
  // Decides per beat whether the picture is a clip or a still, so about
  // `target` of the reel's time is moving video. Data beats sit over a dimmed
  // clip (they count as clip time); the end card is the style's own design.
  // Stills go first to beats where a specific face matters (quotes, versus
  // cards, a headshot), then to the shortest beats.
  //   beats: [{ id, kind, visual, durMs }]  ->  { mode: { id: 'clip'|'image'|'design' }, clipMs, totalMs, share }
  const STILL_FIRST = { quote: 3, versus: 3, rank: 1 };
  // Reels Studio v3: each style's clip share (ReelES.STYLES[id].media.clips).
  // Stat Card and Receipts draw no clips: their scenes are photos or graphics.
  const STYLE_CLIP_SHARE = { gametape: 0.9, statcard: 0, receipts: 0, hypecut: 0.6 };
  const visualMixFor = styleId => (Object.prototype.hasOwnProperty.call(STYLE_CLIP_SHARE, styleId) ? STYLE_CLIP_SHARE[styleId] : 0.8);
  function planVisualMix(beats, { target: target0 = 0.8, clipsAvailable = Infinity, style = '' } = {}) {
    const target = style ? visualMixFor(style) : target0;
    const list = (beats || []).map(b => ({ id: b.id, kind: b.kind, visual: b.visual || '', durMs: Math.max(0, Number(b.durMs) || 0) }));
    const mode = {};
    const eligible = [];
    let totalMs = 0;
    list.forEach(b => {
      totalMs += b.durMs;
      if (b.kind === 'cta') { mode[b.id] = 'design'; return; }
      mode[b.id] = 'image';
      eligible.push(b);
    });
    // Order: beats that want motion first; beats where a face matters last.
    const wantsStill = b => (b.kind === 'hook' ? -2 : 0) + (STILL_FIRST[b.kind] || 0) + (b.visual === 'headshot' || b.visual === 'logo-tile' ? 2 : 0) + (b.visual === 'photo' ? 1 : 0);
    const order = [...eligible].sort((a, b) => wantsStill(a) - wantsStill(b) || b.durMs - a.durMs);
    let clipMs = 0;
    let used = 0;
    const goal = target * totalMs;
    const slack = 0.06 * totalMs;
    for (const b of order) {
      if (clipMs >= goal - 1 || used >= clipsAvailable) break;
      // Do not overshoot by much: skip a long beat when a shorter one fits.
      // and never overshoot further than stopping short would undershoot.
      if (clipMs + b.durMs > goal + slack && (order.some(o => mode[o.id] === 'image' && o !== b && clipMs + o.durMs <= goal + slack) || goal - clipMs < clipMs + b.durMs - goal)) continue;
      mode[b.id] = 'clip';
      clipMs += b.durMs;
      used += 1;
    }
    return { mode, clipMs, totalMs, share: totalMs ? clipMs / totalMs : 0 };
  }

  // ─── AI scene prompts (never names, people, logos or text) ─────────────
  // Built only from the closed SCENES list, the sport and a colour mood. Any
  // free text is ignored, so a player's or team's name can never reach the
  // image or video model.
  const SPORT_WORDS = { nfl: 'American football', cfb: 'college American football', mlb: 'baseball', golf: 'golf', '': 'sports' };
  const SCENE_TEXT = {
    stadium: 'a vast empty {sport} stadium at dusk, floodlights glowing, seats in soft focus',
    crowd: 'blurred silhouettes of a stadium crowd under bright lights, bokeh, no faces visible',
    field: 'a low-angle close-up of a freshly lined {sport} field, dew and stadium lights',
    ball: 'a single {sport} ball resting on the turf, dramatic rim light, shallow depth of field',
    trophy: 'a gleaming plain silver trophy on a pedestal, no engraving, dark studio backdrop',
    skyline: 'a city skyline at blue hour seen from above a stadium roof, no signage',
    locker: 'an empty locker room bench with plain unmarked towels, moody light',
    scoreboard: 'a blank unlit stadium scoreboard frame against the night sky',
  };
  const COLOR_WORDS = [['red', [200, 40, 40]], ['blue', [30, 70, 200]], ['navy', [20, 30, 80]], ['green', [30, 140, 70]], ['gold', [230, 180, 40]], ['orange', [240, 120, 30]], ['black', [20, 20, 20]], ['silver', [170, 170, 175]], ['teal', [0, 128, 128]], ['maroon', [110, 20, 40]]];
  function colorWord(hex) {
    const m = String(hex || '').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return '';
    const rgb = m.slice(1).map(x => parseInt(x, 16));
    let best = '';
    let d = Infinity;
    COLOR_WORDS.forEach(([name, c]) => { const dd = c.reduce((s, v, i) => s + (v - rgb[i]) ** 2, 0); if (dd < d) { d = dd; best = name; } });
    return best;
  }
  const NO_PEOPLE = 'Photorealistic, cinematic, vertical 9:16. No people, no faces, no players, no athletes, no logos, no jerseys, no team names, no text, no letters, no numbers, no watermarks.';
  function scenePrompt({ scene = 'stadium', sport = '', colors = [], motion = false } = {}) {
    const s = SCENES.includes(scene) ? scene : 'stadium';
    const words = (Array.isArray(colors) ? colors : []).map(colorWord).filter(Boolean).slice(0, 2);
    const base = SCENE_TEXT[s].replace('{sport}', SPORT_WORDS[SPORTS.some(x => x.id === sport) ? sport : '']);
    const mood = words.length ? ` Lighting accents in ${[...new Set(words)].join(' and ')}.` : '';
    const move = motion ? ' Slow, smooth camera push-in, steady, 4 seconds.' : '';
    return { scene: s, prompt: `${base}.${mood}${move} ${NO_PEOPLE}` };
  }

  // ─── Sentences and stats from free text (the no-AI draft) ──────────────
  const STAT_WORDS = { yards: 'YDS', yds: 'YDS', touchdowns: 'TD', touchdown: 'TD', tds: 'TD', interceptions: 'INT', 'home runs': 'HR', 'home run': 'HR', hr: 'HR', rbis: 'RBI', rbi: 'RBI', strikeouts: 'SO', points: 'PTS', wins: 'WINS', birdies: 'BIRDIES', sacks: 'SACKS', era: 'ERA', 'under par': 'UNDER PAR' };
  function statsIn(text) {
    const out = [];
    const re = /(\d[\d,.]*%?)\s+(home runs?|under par|[A-Za-z]{2,13})\b/gi;
    let match;
    while ((match = re.exec(String(text || '')))) {
      const label = STAT_WORDS[match[2].toLowerCase()];
      if (!label || out.some(stat => stat.label === label)) continue;
      out.push({ value: match[1].replace(/[.,]$/, ''), label });
      if (out.length >= 4) break;
    }
    return out;
  }
  function sentences(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+(?=[A-Z“"0-9])/)
      .map(s => s.trim())
      .filter(s => s.length > 3);
  }
  const trimWords = (text, max) => {
    const list = words(text);
    return list.length > max ? `${list.slice(0, max).join(' ').replace(/[,;:]$/, '')}` : list.join(' ');
  };
  const stripLabel = line => String(line || '').replace(/^\s*(?:headline|story|context|why fans care|team|sport|brief)\s*:\s*/i, '').trim();

  // A grounded draft with no AI: every line comes from the brief, so every
  // number is sourced. Used when AI is off, over the cap, or fails.
  function fallbackPlan({ brief = '', title = '', format = '', sport = '', team = '' } = {}) {
    const text = [title, brief].filter(Boolean).join('. ');
    const fmt = FORMATS[format] ? format : routeFormat(text).format;
    const lines = String(brief || '').split('\n').map(stripLabel).filter(Boolean);
    const sentence = s => (/[.!?]$/.test(s) ? s : `${s}.`);
    const seen = new Set();
    const all = sentences([title, ...lines].filter(Boolean).map(sentence).join(' '))
      .filter(s => { const k = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (seen.has(k)) return false; seen.add(k); return true; });
    const pool = all.length ? all : [title || 'Here is what happened'];
    const beats = [];
    const hookLine = pool[0];
    beats.push({ kind: 'hook', text: trimWords(hookLine.replace(/[.]$/, ''), PACE.textMaxWords), vo: trimWords(hookLine, PACE.voMaxWords), emphasis: '', photo: '' });
    // One sentence per beat. In a stat reel a sentence with a stat becomes a
    // stat card (at most two), the rest are context and points.
    let statBeats = 0;
    pool.slice(1, 6).forEach((line, index) => {
      const vo = trimWords(line, PACE.voMaxWords);
      const stat = fmt === 'stat' && statBeats < 2 ? statsIn(line)[0] : null;
      if (stat) {
        statBeats += 1;
        beats.push({ kind: 'stat', text: trimWords(line.replace(/[.]$/, ''), PACE.textMaxWords), vo, stat, photo: '' });
        return;
      }
      const kind = index === 0 ? 'context' : (index >= 3 ? 'payoff' : 'point');
      beats.push({ kind, text: trimWords(line.replace(/[.]$/, ''), PACE.textMaxWords), vo, photo: '' });
    });
    while (beats.length < 3) beats.push({ kind: beats.length === 1 ? 'context' : 'payoff', text: beats.length === 1 ? 'Here is the story' : 'What comes next', vo: beats.length === 1 ? 'Here is the story.' : 'Keep an eye on what comes next.', photo: '' });
    beats.push({ kind: 'cta', text: 'What do you make of it?', vo: 'What do you make of it? Tell us below.', photo: '' });
    return {
      format: fmt === 'top5' ? 'explainer' : fmt, // a Top-5 needs five sourced entries: only the director writes those
      title: trimWords(title || hookLine, 12),
      sport, team, angle: '', source: 'draft', beats,
    };
  }

  return {
    SPORTS, KINDS, STORY_KINDS, COMPONENT_KINDS, VISUALS, SCENES, FORMATS, FORMAT_IDS, KIND_LABELS, PACE, ROUTES, PRICES,
    DATA_KINDS, ALL_KINDS, SLIDE_KINDS, SOURCE_KINDS, OUTPUTS, DATA_FORMATS, DATA_FORMAT_IDS, ALL_FORMAT_IDS, DATA_ROUTES,
    isDataFormat, formatKinds, suggestDataFormat, formatCostOptions,
    routeFormat, numbersIn, numberSet, normNumber, unsourcedNumbers, structuralNumbers, numberFields, planNumberFields, unsourcedPlanNumbers,
    planVisualMix, visualMixFor, STYLE_CLIP_SHARE, scenePrompt, colorWord,
    MUSIC_FILES, musicTracks,
    words, wordCount, estimateVoMs, estimateCost, money, statsIn, sentences, trimWords, fallbackPlan,
  };
}));
