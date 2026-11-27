// Reels Studio (reel-maker.html): trend or brief -> script of beats -> ES
// photos, logos and stat cards -> voiceover (or captions only) -> music ->
// JSON timeline -> live preview -> lint -> MP4 in the browser.
// project-docs/ai-reels-research.md (MVP). The renderer, timeline and lint are
// pure modules shared with the server and the tests:
//   reel-formats.js (formats, router, pacing, costs), reel-render.js
//   (timeline + drawing), reel-lint.js (quality checks).
// Server: /api/reel-maker (netlify/functions/reel-maker.js).
// Export: WebCodecs + Mediabunny (frame-exact, faster than real time), else
// the Video Ads path (canvas.captureStream + MediaRecorder, real time).
//
// 2026-11-18 (reels-styles): one guided flow (Story -> Review -> Export) with
// a single "Make my reel" that writes the script, records the voice, finds
// clips and builds the reel; four styles (reel-styles.js) with live
// thumbnails; four voices with previews; the voiceover is made automatically
// and re-made for edited lines only; every beat gets a visual through the
// fill chain (official X clips about 80% of the time, then ES photos,
// headshots, team graphics, AI scenes or AI b-roll, then the style's designed
// background; nothing chosen yet shows plain black).
(() => {
  'use strict';

  const F = window.ReelFormats;
  const R = window.ReelRender;
  const L = window.ReelLint;
  const S = window.ReelStyles;
  const X = window.ReelExport;
  const FLOW = window.ReelFlow;
  const TEAMS = window.VideoAdsTeams;
  const LOGOS = window.LeagueLogos;
  const LOGOLIB = window.FrameUpLogos;
  const CUT = window.FrameUpCutout;
  // Data formats (2026-11-18, reels-fmt-ui): the gallery and source pickers
  // (reel-gallery.js) and timeline v2 (reel-timeline.js). Without them the
  // page is exactly the news flow.
  const G = window.ReelGallery || null;
  const TL = window.ReelTimeline || null;
  // ES Reels (2026-11-21): the ES video team's design system (reel-es.js),
  // the house style. "Script": the person's own words, never rewritten.
  const ES = window.ReelES || null;
  if (!F || !R || !L || !S || !X || !FLOW) return;

  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  // Lucide icons (ISC licence).
  const ICON = {
    sparkles: svg('<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>'),
    explainer: svg('<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>'),
    stat: svg('<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>'),
    top5: svg('<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/><path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
    quote: svg('<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>'),
    up: svg('<path d="m18 15-6-6-6 6"/>'),
    down: svg('<path d="m6 9 6 6 6-6"/>'),
    trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
    plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
    image: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    alert: svg('<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'),
    warn: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    chevronRight: svg('<path d="m9 18 6-6-6-6"/>'),
    link: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    refresh: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
    play: svg('<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>'),
    stop: svg('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
    film: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>'),
    upload: svg('<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'),
    shield: svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
    scissors: svg('<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>'),
    // ── Reels 2.0: D (interface) ── Start tiles, storyboard and versions.
    trend: svg('<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>'),
    words: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
    game: svg('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'),
    player: svg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    idea: svg('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'),
    left: svg('<path d="m15 18-6-6 6-6"/>'),
    grip: svg('<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>'),
    layers: svg('<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>'),
  };
  const KIND_NAME = { hook: 'Hook', context: 'Context', point: 'Point', stat: 'Stat', rank: 'Rank', quote: 'Quote', payoff: 'Why it matters', cta: 'End card', bars: 'Bars', versus: 'Versus', dotrank: 'Dot ranking', chips: 'Squares', steps: 'Steps', tiles: 'Team tiles', roles: 'Position cards', mystery: 'Mystery card', play: 'Play', wpline: 'Win probability', moment: 'Moment', panel3: '3 frames' };
  // Where a beat's picture came from (the fill chain), in plain words.
  const SOURCE_NAME = { 'x-clip': 'Official X clip', upload: 'Your upload', 'upload-clip': 'Your clip', photo: 'ES photo', headshot: 'ES photo', tile: 'Team graphic', scene: 'AI scene', 'ai-clip': 'AI b-roll clip', design: 'Designed background', paper: 'ES paper (no photo)', none: 'Nothing yet (plain black)' };
  // ── Reels 2.0: D (interface) ── trends cover NBA, WNBA, tennis and NASCAR too (lane B).
  const SPORT_LABEL = { nfl: 'NFL', cfb: 'College FB', mlb: 'MLB', golf: 'Golf', nba: 'NBA', wnba: 'WNBA', tennis: 'Tennis', nascar: 'NASCAR' };
  const TREND_SPORTS = Object.keys(SPORT_LABEL);
  const LOCAL_KEY = 'frameup.reels.projects.v1';
  const HANDOFF_KEY = 'frameup.reelMoment.v1';
  const MEDIABUNNY = 'https://cdn.jsdelivr.net/npm/mediabunny@1.62.1/+esm';

  const els = {
    steps: $('rm-steps'), canvas: $('rm-canvas'), emptyStage: $('rm-empty-stage'), safe: $('rm-safe'),
    play: $('rm-play'), scrub: $('rm-scrub'), time: $('rm-time'), mute: $('rm-mute'), safeToggle: $('rm-safe-toggle'), stageMeta: $('rm-stage-meta'),
    panes: { source: $('rm-pane-source'), topic: $('rm-pane-topic'), edit: $('rm-pane-edit'), export: $('rm-pane-export') },
    work: document.querySelector('.rm-work'), sourceStep: $('rm-source-step'),
    // ── Reels Studio v3 (UI) ── Create: one prompt card, four style cards, one button, trends, "Need an idea?".
    prompt: $('rm-prompt'), promptCard: $('rm-prompt-card'), scriptMode: $('rm-script-mode'), promptHint: $('rm-prompt-hint'),
    styles4: $('rm-styles4'), styleWhy: $('rm-style-why'), makeHint: $('rm-make-hint'), trendrow: $('rm-trendrow'),
    inspireLink: $('rm-inspire-link'), ideasDialog: $('rm-ideas'), inspoSoon: $('rm-inspo-soon'), radarHost: $('rm-radar-host'), ideasHost: $('rm-ideas-host'),
    makingCard: $('rm-makingcard'), makingTime: $('rm-making-time'), makingAbout: $('rm-making-about'), makingTitle: $('rm-making-title'),
    // Review: the scene strip, the picked scene, the Ready to post badge, one panel with folds.
    scenes: $('rm-scenes'), sceneEdit: $('rm-scene-edit'), ready: $('rm-ready'), readyText: $('rm-ready-text'), details: $('rm-details'), detailsMeta: $('rm-details-meta'), admin: $('rm-admin'),
    sources: $('rm-sources'), costMeta: $('rm-cost-meta'), captionsMeta: $('rm-captions-meta'), captionsNote: $('rm-captions-note'),
    addBeat: $('rm-add-beat'), sbScroll: $('rm-sb-scroll'), exportWhat: $('rm-export-what'),
    // Export: one MP4, plus "Also export" (4:5, captions, carousel).
    export45: $('rm-export-45'), export45Text: $('rm-export-45-text'), exportCaptions: $('rm-export-captions'), captionsHost: $('rm-captions-host'), rightsMeta: $('rm-rights-meta'), backText: $('rm-back-text'),
    calm: $('rm-calm'), calmNote: $('rm-calm-note'),
    ticks: $('rm-ticks'), size: $('rm-size'), sizeText: $('rm-size-text'), findClips: $('rm-findclips'),
    dataStory: $('rm-data-story'), dataReview: $('rm-data-review'), view: $('rm-view'), device: $('rm-device'), transport: $('rm-transport'),
    slidenav: $('rm-slidenav'), slidePos: $('rm-slide-pos'), slideDots: $('rm-slide-dots'), slidePrev: $('rm-slide-prev'), slideNext: $('rm-slide-next'),
    carouselOut: $('rm-carousel-out'), carouselBtn: $('rm-export-carousel'), carouselNote: $('rm-carousel-note'), carouselStatus: $('rm-carousel-status'),
    leagues: $('rm-leagues'), trends: $('rm-trends'), picked: $('rm-picked'),
    sport: $('rm-sport'), tier: $('rm-tier'), factcheck: $('rm-factcheck'), factcheckRow: $('rm-factcheck-row'),
    cost: $('rm-cost'), write: $('rm-make'), writeText: $('rm-write-text'), writeStatus: $('rm-write-status'), recent: $('rm-recent'), recentList: $('rm-recent-list'),
    notice: $('rm-notice'), summary: $('rm-summary'), askForm: $('rm-ask'), askInput: $('rm-ask-input'), beats: $('rm-beats'), beatsMeta: $('rm-beats-meta'),
    voiceBadge: $('rm-voice-badge'), voiceNote: $('rm-voice-note'), voiceBtn: $('rm-voice-btn'), voiceProgress: $('rm-voice-progress'), capstyle: $('rm-capstyle'),
    musicPick: $('rm-music-pick'), musicFile: $('rm-music-file'), musicName: $('rm-music-name'), licence: $('rm-licence'), licenceNote: $('rm-licence-note'), licencePaid: $('rm-licence-paid'),
    sourcesList: $('rm-sources-list'), extraSource: $('rm-extra-source'), issues: $('rm-issues'),
    target: $('rm-target'), rights: $('rm-rights-table'), gate: $('rm-gate'), spend: $('rm-spend'), exportBtn: $('rm-export'), exportText: $('rm-export-text'), exportProgress: $('rm-export-progress'), exportStatus: $('rm-export-status'), files: $('rm-files'),
    back: $('rm-back'), next: $('rm-next'), nextText: $('rm-next-text'),
    photos: $('rm-photos'), photosForm: $('rm-photos-search'), photosQ: $('rm-photos-q'), photosGrid: $('rm-photos-grid'), photosNone: $('rm-photos-none'),
    toasts: $('rm-toasts'),
    topic: $('rm-topic'), length: $('rm-length'), voiceChoice: $('rm-voicechoice'), voiceChoiceHint: $('rm-voicechoice-hint'),
    meterWords: $('rm-meter-words'), meterSec: $('rm-meter-sec'), meterTarget: $('rm-meter-target'), meter: $('rm-script-meter'), makingChapters: $('rm-making-chapters'),
    making: $('rm-making'), makingLive: $('rm-making-live'),
    voiceEdit: $('rm-voice-edit'), voiceState: $('rm-voice-state'),
    clipsOn: $('rm-clips-on'), aiclipsOn: $('rm-aiclips-on'), aiclipsRow: $('rm-aiclips-row'), aiclipsNote: $('rm-aiclips-note'),
    statuslineText: $('rm-statusline-text'), lint: $('rm-lint'),
    musicMeta: $('rm-music-meta'), sourcesMeta: $('rm-sources-meta'), visualFile: $('rm-visual-file'), capstyleField: $('rm-capstyle-field'),
    checklist: $('rm-checklist'), guide: $('rm-guide'), guideBody: $('rm-guide-body'), aspect: $('rm-aspect'), aspectSec: $('rm-aspect-sec'),
  };
  // One prompt card serves every way in: the brief, the script (with "Use my
  // exact words") and the notes on a picked trend. Modules that read the old
  // fields (the voice input reads els.script) get the prompt.
  els.brief = els.prompt;
  els.script = els.prompt;
  const ctx = els.canvas.getContext('2d');

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
  const state = {
    step: 'topic', source: 'trend', league: 'all', trends: [], trendsState: 'loading', trend: null,
    format: 'auto', sport: '', tier: 'standard', factCheck: false,
    config: { ai: true, voice: { mode: 'off', ready: false, label: 'Captions only', reason: '' }, offline: false },
    projectId: uuid(), status: 'draft',
    plan: null, planSource: '', notice: '', corpus: '', sources: [], extraSource: '',
    photos: {}, assets: {}, images: {}, voice: {}, buffers: {},
    music: null, musicLibrary: [], captionStyle: 'highlight', target: 'organic',
    spent: { director: 0, factCheck: 0, revise: 0, voice: 0, clipJudge: 0 },
    timeline: null, lint: null, t: 0, playing: false, busy: '',
    cloud: true,
    // reels-styles
    style: 'auto', styleSuggested: { id: (S.DEFAULT_STYLE || 'classic'), why: '' }, aspect: '9:16',
    voiceOn: true, voiceId: 'brian', voiceError: '', voiceMaking: false,
    useClips: true, aiClips: false, aiClipsUsed: 0, clipAudio: false,
    videos: {}, cutouts: {}, visualSrc: {}, clipPool: [], clipPoolKey: '', selected: '',
    flow: FLOW.initial(),
  };
  state.spent.clips = 0;
  state.spent.scenes = 0;
  // ── Reels 2.0: A (looks) ── ES is the only style now; a retired or unknown one resolves to it.
  const styleId = () => S.currentStyle((state.plan && state.plan.style) || (state.style === 'auto' ? state.styleSuggested.id : state.style));
  // The reel's look (reel-es-themes.js). Picked before a plan exists it waits
  // in state.look; the plan carries it from its first build on (so it saves).
  state.look = 'paper';
  const lookId = () => {
    if (!ES) return 'paper';
    if (state.plan && !ES.LOOKS[state.plan.look]) state.plan.look = ES.themes.lookId(state.look);
    return state.plan ? state.plan.look : ES.themes.lookId(state.look);
  };
  // The ES house style is on (and reel-es.js loaded).
  const esOn = () => Boolean(ES && S.get(styleId()).engine === 'es' && !(state.plan && F.isDataFormat && F.isDataFormat(state.plan.format)));
  const scriptLocked = () => Boolean(state.plan && state.plan.script && state.plan.script.locked);
  // ── Reels 2.0: C (inputs) ── the person's own voiceover (reel-voice-input.js) is on this plan.
  const ownVoice = () => (state.voiceOwn && state.voiceOwn.plan === state.plan ? state.voiceOwn : null);
  // A beat's name in the strip and the editor (its ES block in the ES style).
  const beatName = beat => (v4Beat(beat) ? (beat.module && MODULE_LABEL[beat.module.type]) || MEDIA_LABEL[beat.media && beat.media.kind] || 'Scene' : (esOn() ? ES.BLOCKS[ES.blockOf(beat).type].label : (KIND_NAME[beat.kind] || beat.kind)));
  // ── Reels 2.0: D (interface) ── what the reel starts from (a Start tile), the words tab last used,
  // the recipe ('' = Auto), the versions of this reel and a calm (cuts, no wipes) preview.
  Object.assign(state, { start: 'words', words: 'brief', inspo: 'radar', recipe: '', lookPicked: false, versions: null, version: 0, versionsBusy: false, calm: false, scene: -1 });
  // ── Reels Studio v4 (UI) ── the style picked on Create (Breakdown by default), the scene being edited, the AI review.
  Object.assign(state, { esStyle: 'breakdown', stylePicked: false, review: null, swapOpen: '' });
  state.source = 'brief';
  const mods = () => (window.ReelMakerCtx ? window.ReelMakerCtx.modules : {});
  const emit = (event, data) => { if (window.ReelMakerCtx) window.ReelMakerCtx.emit(event, data); };
  const A11Y = window.ReelA11yCore || null;
  // ── Reels v4 (UI) ── chapters, motion, the script meter (reel-storyboard.js core, pure).
  const SBC = window.ReelStoryboardCore || null;
  const v4 = (plan = state.plan) => Boolean(SBC && SBC.isV4(plan));
  const ensureV4 = plan => (SBC ? SBC.ensureV4(plan, ES) : plan);
  // A v4 scene's module and media, in plain words.
  const MODULE_LABEL = { scoreboard: 'Scoreboard', bars: 'Bars', numberLine: 'Number line', dotGrid: 'Dot grid', scatter: 'Scatter', wl: 'Wins & losses', rankList: 'Rank list', statTiles: 'Stat tiles', reveal: 'Reveal', compare: 'Compare', tally: 'Tally', calendar: 'Calendar', timeline: 'Timeline', playDiagram: 'Play diagram', flow: 'Flow chart', checklist: 'Checklist', quote: 'Quote', lineChart: 'Line chart' };
  const MEDIA_LABEL = { clip: 'Clip', presser: 'Press clip', photo: 'Photo', cards: 'Name cards', cutout: 'Cut-out', none: 'No media' };
  // Is this a v4 scene (media / module fields), not a v3 block?
  const v4Beat = beat => Boolean(beat && v4() && (beat.module || beat.media || !beat.block));
  // Does a scene take a clip or a photo?
  const takesMediaOf = beat => (v4Beat(beat) ? Boolean(beat.media && beat.media.kind && beat.media.kind !== 'none') : (!esOn() || ES.takesMedia(beat)));
  // Changes the flat scene list (v3 and v4 alike): a copy is edited and assigned back.
  function editBeats(fn) { const list = state.plan.beats.slice(); const out = fn(list); state.plan.beats = list; return out; }
  // The learning loop (AI lane): every change a person makes, fire and forget.
  function feedback(event, { beatId = '', before = null, after = null } = {}) {
    try {
      const plan = state.plan;
      const chapter = plan && v4(plan) ? (plan.chapters.find(c => (c.beats || []).some(b => b.id === beatId)) || {}).id || '' : '';
      window.ReelFeedback?.log?.({ event, reelId: state.projectId, beatId: beatId || '', chapterId: chapter, before, after, style: curStyle() });
    } catch { /* the reel never waits on feedback */ }
  }

  // ─── Small helpers ───────────────────────────────────────────────────────
  function toast(text, { tone = '', action = null } = {}) {
    const el = document.createElement('div');
    el.className = `es-toast rm-toast${tone === 'error' ? ' is-error' : ''}`;
    el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span>${esc(text)}</span>${action ? `<button class="es-toast-action" type="button">${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').addEventListener('click', () => { action.run(); el.remove(); });
    // Side by side (wide screens): toasts sit centred under the preview, never
    // over the panel's Back / Next / Export. Stacked (phones): under the top bar.
    const wide = window.matchMedia?.('(min-width: 901px)').matches;
    const stageEl = $('rm-stage');
    const sr = wide && stageEl ? stageEl.getBoundingClientRect() : null;
    els.toasts.classList.toggle('is-stage', Boolean(sr && sr.width));
    els.toasts.style.left = sr && sr.width ? `${Math.round(sr.left + sr.width / 2)}px` : '';
    els.toasts.style.maxWidth = sr && sr.width ? `${Math.round(sr.width - 32)}px` : '';
    // Review v4: in the preview column just under the transport bar (over its quiet meta
    // line), clear of the frame, the playback controls, the timeline's buttons and the panel.
    const trr = sr && sr.width && els.transport ? els.transport.getBoundingClientRect() : null;
    els.toasts.style.top = trr && trr.height ? `${Math.round(Math.max(16, Math.min(window.innerHeight - 72, trr.bottom + 6)))}px` : '';
    els.toasts.style.bottom = trr && trr.height ? 'auto' : '';
    if (trr && trr.height) els.toasts.style.maxWidth = `${Math.round(Math.min(440, sr.width - 32))}px`;
    els.toasts.append(el);
    setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 260); }, action ? 5000 : 3200);
  }
  const fmtTime = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const debounce = (fn, ms) => { let t = 0; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
  };
  const totalSpent = () => Object.values(state.spent).reduce((a, b) => a + (Number(b) || 0), 0);

  function friendlyError(status, data) {
    if (data?.reason === 'weekly-limit') return data.error || 'You have reached this week’s AI limit. It resets Monday.';
    if (status === 429 || data?.reason === 'limit') return 'You’ve hit this hour’s AI limit. Try again in a little while.';
    if (data?.reason === 'budget') return 'The team’s AI budget is used up for now. Try again later.';
    if (status === 401) return 'Your sign-in expired. Refresh the page and try again.';
    return data?.error || `Something went wrong (${status}). Try again.`;
  }
  async function api(body) {
    if (!window.ESAuth?.fetchWithAuth) throw Object.assign(new Error('Sign-in is still loading. Try again in a moment.'), { offline: true });
    let response;
    try {
      response = await window.ESAuth.fetchWithAuth('/api/reel-maker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (error) {
      throw Object.assign(new Error('Reels Studio’s server is not reachable.'), { offline: true });
    }
    const data = await response.json().catch(() => null);
    if (response.status === 404 && !data) throw Object.assign(new Error('Reels Studio’s server is not reachable.'), { offline: true, status: 404 });
    if (!response.ok || data?.ok === false) throw Object.assign(new Error(friendlyError(response.status, data)), { status: response.status, reason: data?.reason, data });
    return data;
  }
  function logEvent(type, payload = {}) {
    if (state.config.offline || !state.cloud) return;
    api({ mode: 'event', type, projectId: state.projectId, format: state.plan?.format, payload }).catch(() => {});
  }

  // Text measuring with the real fonts, cached (layouts run every frame).
  const measureCtx = document.createElement('canvas').getContext('2d');
  const measureCache = new Map();
  function measure(text, fontStr) {
    const key = `${fontStr}|${text}`;
    let w = measureCache.get(key);
    if (w === undefined) {
      measureCtx.font = fontStr;
      w = measureCtx.measureText(text).width;
      if (measureCache.size > 6000) measureCache.clear();
      measureCache.set(key, w);
    }
    return w;
  }
  // A small noise tile for film grain on the animated backgrounds.
  const grain = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    return c;
  })();
  let layoutCache = new Map();
  let captionCache = new Map();
  const env = {
    measure,
    images: state.images,
    videos: state.videos,
    cutouts: state.cutouts,
    grain,
    layoutCache: g => { const key = `${g.id}|${g.inMs}`; let v = layoutCache.get(key); if (!v) { v = R.layoutGraphic(measure, g, state.timeline); layoutCache.set(key, v); } return v; },
    captionCache: card => { const key = `${card.s}`; let v = captionCache.get(key); if (!v) { v = R.layoutCaption(measure, card, state.timeline); captionCache.set(key, v); } return v; },
  };

  function loadImage(src, cors = false) {
    return new Promise(resolve => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  loadImage('assets/brand-logos/essentiallysports-mark.svg').then(img => { if (img) { state.images['logo:es'] = img; draw(); } });
  // Text is measured with the real artwork fonts: when a font finishes
  // loading, cached widths and layouts are thrown away and the frame redrawn.
  // The 4:5 export draws its own timeline: no caches built for the 9:16 one.
  const envFor = tl => (tl === state.timeline ? env : { ...env, layoutCache: null, captionCache: null });
  const fontsChanged = () => { measureCache.clear(); layoutCache = new Map(); captionCache = new Map(); if (state.timeline) rebuild(); };
  document.fonts?.addEventListener?.('loadingdone', fontsChanged);
  Promise.all([`700 120px "Acumin Pro Condensed Local"`, '800 120px "Roboto Condensed"', '700 50px Roboto', '600 48px Roboto', '500 44px Roboto'].map(f => document.fonts.load(f).catch(() => {}))).then(fontsChanged);

  // ─── Voice cache (IndexedDB): re-renders and reopened reels never re-bill ─
  const VoiceCache = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((resolve, reject) => {
      // ── Reels 2.0: C (inputs) ── v2 adds the 'media' store (your uploads and voiceover, reel-media-tray.js).
      const req = indexedDB.open('frameup-reels', 2);
      req.onupgradeneeded = () => ['vo', 'media'].forEach(name => { if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name); });
      req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); dbp = null; }; resolve(req.result); };
      req.onerror = () => reject(req.error);
    }));
    return {
      async get(key) { try { const db = await open(); return await new Promise(res => { const q = db.transaction('vo').objectStore('vo').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } },
      async set(key, value) { try { const db = await open(); db.transaction('vo', 'readwrite').objectStore('vo').put(value, key); } catch { /* best effort */ } },
    };
  })();

  // ─── Steps ───────────────────────────────────────────────────────────────
  // ── Reels Studio v3 (UI) ── three steps: Create, Review, Export. Create is
  // one centred column (no preview, no settings); Review and Export show the
  // phone with its scene strip beside one panel. A reel from a game, a clip or
  // a player picks its source on the 'source' pane; the nav shows it as Create.
  const NAV_STEPS = ['topic', 'edit', 'export'];
  const FLOW_STEP = { source: 'source', topic: 'story', edit: 'review', export: 'export' };
  function goStep(step, { focus = true } = {}) {
    if (step === 'format') step = 'topic';
    if (step !== 'topic' && step !== 'source' && !state.plan) return;
    const fmt = G && TL ? dataFmt() : '';
    if (step === 'source' && !fmt) step = 'topic';
    if (step === 'topic' && fmt && !FLOW.sourceReady(fmt, state.flow.source)) step = 'source';
    const was = state.step;
    state.step = step;
    if (fmt && !state.flow.making) state.flow = { ...state.flow, step: FLOW_STEP[step] };
    Object.entries(els.panes).forEach(([id, pane]) => { pane.hidden = id !== step; });
    const starting = step === 'topic' || step === 'source';
    els.work.dataset.step = step;
    els.work.classList.toggle('is-picking', step === 'source');
    els.work.classList.toggle('has-reel', Boolean(state.plan));
    const navStep = starting ? 'topic' : step;
    els.steps.querySelectorAll('.rm-step').forEach(btn => {
      const id = btn.dataset.step;
      btn.toggleAttribute('aria-current', id === navStep);
      if (id === navStep) btn.setAttribute('aria-current', 'step');
      btn.disabled = id === 'topic' ? false : !state.plan || state.flow.making;
      btn.classList.toggle('is-done', NAV_STEPS.indexOf(id) < NAV_STEPS.indexOf(navStep) && Boolean(state.plan));
    });
    els.back.hidden = starting || step === 'edit';
    els.backText.textContent = 'Back to Review';
    els.next.hidden = step !== 'edit';
    els.nextText.textContent = 'Next: Export';
    els.next.classList.toggle('es-btn--primary', step === 'edit');
    if (step === 'export') renderExport();
    if (step === 'edit') renderSceneEditor();
    previewsRun(step === 'topic');
    renderResume();
    if (G && TL) { if (step === 'source') syncLive(); else stopLive(); }
    renderRail();
    if (focus) focusStep(step);
    if (was !== step) emit('step', { step, from: was });
  }
  // Where the keyboard lands on each step: the prompt, the picked scene, the export button.
  function focusStep(step) {
    const target = step === 'topic' ? els.prompt
      : step === 'edit' ? (els.beats.querySelector('.rm-card.is-on [data-sb-face]') || els.beats.querySelector('[data-sb-face]'))
        : step === 'export' ? els.exportBtn
          : els.panes[step].querySelector('button:not(:disabled), input, textarea, select');
    target?.focus({ preventScroll: true });
  }
  els.steps.addEventListener('click', event => { const btn = event.target.closest('.rm-step'); if (!btn || btn.disabled) return; goStep(btn.dataset.step); });
  els.back.addEventListener('click', () => goStep({ export: 'edit', edit: 'topic' }[state.step] || 'topic'));
  els.next.addEventListener('click', () => goStep(state.step === 'topic' ? 'edit' : 'export'));

  function radios(group, attr, value) {
    if (!group) return;
    group.querySelectorAll('[role="radio"]').forEach(btn => {
      const on = btn.dataset[attr] === value;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
    });
  }
  // Arrow keys move between radios in a group.
  document.addEventListener('keydown', event => {
    const radio = event.target.closest?.('[role="radio"]');
    if (!radio || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const group = radio.closest('[role="radiogroup"]');
    const list = [...group.querySelectorAll('[role="radio"]:not([disabled])')];
    const i = list.indexOf(radio);
    const next = list[(i + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + list.length) % list.length];
    event.preventDefault();
    next.focus();
    next.click();
  });

  // ─── Admins ──────────────────────────────────────────────────────────────
  // Cost, the script model, the fact check, clip switches and the calm /
  // safe-zone preview toggles are for admins only (the server's config says
  // so; the app shell's admin link is the fallback; ?admin=1 on localhost).
  const isAdmin = () => Boolean(state.config.admin)
    || Boolean(document.querySelector('.navbar [data-admin-only]:not([hidden])'))
    || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]admin=1\b/.test(location.search));
  function syncAdmin() {
    const on = isAdmin();
    document.querySelectorAll('.rm-page [data-admin]').forEach(el => { el.hidden = !on; });
  }

  // ─── Styles v4: Breakdown, Case File, The Outlier, Hot Seat ──────────────
  // The engine lane publishes ReelES.STYLES (reel-es-themes.js) with a
  // previewPlan per style. Until it lands a local stand-in with the same ids,
  // labels and blurbs draws each card from the v3 blocks. The v4 styles
  // replace Game Tape / Stat Card / Receipts / Hype Cut; old reels open in the
  // closest one (contract legacy map).
  const STYLE_IDS = ['breakdown', 'casefile', 'outlier', 'hotseat'];
  const DEFAULT_STYLE_ID = 'breakdown';
  const STYLE_HINT = { breakdown: 'hook, 2–4 chapters, payoff, your call', casefile: 'evidence, a 3·2·1 countdown, a checklist close', outlier: 'one player against the data', hotseat: 'a person under pressure, a fan vote close' };
  const STYLE_MEDIA = { breakdown: 'Clips + data', casefile: 'Scrapbook', outlier: 'Dot grid · scatter', hotseat: 'Press clips + vote' };
  const STUB_LOOK = { breakdown: 'paper', casefile: 'paper', outlier: 'data', hotseat: 'paper' };
  const sb = (type, fields, vo) => ({ type, fields, vo });
  const STYLE_STUB = {
    breakdown: { id: 'breakdown', label: 'Breakdown', skin: 'clean', blurb: 'A contradiction up front, then the chapters that explain it and a payoff number.', media: { clips: 0.7, photos: 0.2 }, seconds: 90,
      preview: [sb('hook', { pills: [{ text: 'THEY BLEW A', color: 'ink' }, { text: '21-POINT LEAD.', color: 'blue' }] }, 'They blew a twenty-one point lead.'), sb('compare', { kicker: 'Win chance', items: [{ label: 'Before', display: '47%', value: 47 }, { label: 'After', display: '57%', value: 57, color: 'blue' }] }, 'Forty-seven to fifty-seven.')] },
    casefile: { id: 'casefile', label: 'Case File', skin: 'scrapbook', blurb: 'An argument built from evidence: a 3·2·1 countdown and a checklist close.', media: { clips: 0.4, photos: 0.4 }, seconds: 90,
      preview: [sb('statement', { lines: [{ text: 'WHO SHOULD', color: 'ink' }, { text: 'CALL IT?', color: 'blue' }] }, 'Who should call it?'), sb('number', { kicker: 'EXHIBIT', value: 3, prefix: '#', label: 'Reason three', color: 'blue' }, 'Reason number three.')] },
    outlier: { id: 'outlier', label: 'The Outlier', skin: 'clean', blurb: 'One player against the data: a dot grid or a scatter where they should not exist.', media: { clips: 0.4, photos: 0.3 }, seconds: 90,
      preview: [sb('dots', { count: 67, highlight: 1, label: 'Comebacks', note: 'One should not exist' }, 'One in sixty-seven.'), sb('statement', { lines: [{ text: 'SHOULDN’T', color: 'ink' }, { text: 'EXIST.', color: 'blue' }] }, 'He should not exist.')] },
    hotseat: { id: 'hotseat', label: 'Hot Seat', skin: 'clean', blurb: 'A person under pressure: press-conference clips, a timeline and a fan vote close.', media: { clips: 0.8, photos: 0.1 }, seconds: 90,
      preview: [sb('hook', { pills: [{ text: 'FANS:', color: 'ink' }, { text: 'YOUR CALL.', color: 'blue' }], stamp: { text: 'HOT SEAT' } }, 'Fans, your call.'), sb('statement', { lines: [{ text: 'ONE MORE', color: 'ink' }, { text: 'OFFSEASON?', color: 'red' }] }, 'One more offseason?')] },
  };
  const realStyles = () => Boolean(ES && ES.STYLES && STYLE_IDS.every(id => ES.STYLES[id]));
  const styleDef = id => {
    const sid = STYLE_IDS.includes(id) ? id : DEFAULT_STYLE_ID;
    const real = realStyles() ? ES.STYLES[sid] : null;
    return { ...STYLE_STUB[sid], ...(real || {}), id: sid };
  };
  // Length: Full (80–100 s, the reference reels) or Short (30–45 s). With your
  // script the words set the real length; the target guides the meter.
  const LENGTHS = { full: { label: 'Full', min: 80, max: 100, about: 90 }, short: { label: 'Short', min: 30, max: 45, about: 40 } };
  const WORDS_PER_SEC = 2.6;
  state.length = 'full';
  // The style a plan is in: the engine's styleOf, else the plan's own field,
  // else the contract's legacy map (v3 styles, Reels 2.0 looks and recipes).
  const DATA_BLOCKS = ['dots', 'dotGrid'];
  function planHasClips(plan) { return Boolean(plan && plan.beats && plan.beats.some(b => (state.photos[b.id] || []).some(a => state.assets[a] && state.assets[a].kind === 'clip'))); }
  // receipts / statcard -> The Outlier when the plan has a dot grid or a scatter, else Breakdown; everything else -> Breakdown.
  function legacyStyle(plan) {
    if (!plan) return state.esStyle;
    if (ES && typeof ES.legacyStyle === 'function') { try { const id = ES.legacyStyle(plan.look, plan.recipe, plan); if (STYLE_IDS.includes(id)) return id; } catch { /* fall through */ } }
    const old = plan.esStyle || ({ data: 'receipts', photo: 'statcard' }[plan.look]) || '';
    const dotty = (plan.beats || []).some(b => (b.block && DATA_BLOCKS.includes(b.block.type)) || b.kind === 'dotrank' || (b.module && ['dotGrid', 'scatter'].includes(b.module.type)));
    return ['receipts', 'statcard'].includes(old) && dotty ? 'outlier' : DEFAULT_STYLE_ID;
  }
  function styleOfPlan(plan) {
    if (!plan) return state.esStyle;
    if (ES && typeof ES.styleOf === 'function') { try { const id = ES.styleOf(plan); if (STYLE_IDS.includes(id)) return id; } catch { /* fall through */ } }
    return STYLE_IDS.includes(plan.esStyle) ? plan.esStyle : legacyStyle(plan);
  }
  // Puts a style on a plan. plan.style stays 'es'; the style rides on
  // plan.esStyle (and, until the engine lane lands, on the closest look).
  // reshape: a plan made by code takes the style's blocks by code ($0, words unchanged).
  function applyStyle(plan, id, { reshape = false } = {}) {
    if (!plan) return;
    if (reshape && realStyles() && window.ReelRecipes && typeof window.ReelRecipes.applyStyle === 'function') {
      try { const out = window.ReelRecipes.applyStyle(plan, id); if (out && out.plan && Array.isArray(out.plan.beats)) { plan.beats = out.plan.beats; delete plan.recipe; } } catch (error) { window.FrameUpErrors?.report?.(error, 'reels applyStyle'); }
    }
    plan.esStyle = STYLE_IDS.includes(id) ? id : DEFAULT_STYLE_ID;
    plan.skin = styleDef(plan.esStyle).skin || 'clean';
    if (!realStyles() && ES && ES.LOOKS && ES.LOOKS[STUB_LOOK[plan.esStyle]]) plan.look = STUB_LOOK[plan.esStyle];
  }
  const curStyle = () => (state.plan ? styleOfPlan(state.plan) : state.esStyle);
  // The style's preview plan: the engine's previewPlan, else the stand-in's blocks.
  const previewCache = new Map();
  function previewTimeline(id) {
    if (previewCache.has(id)) return previewCache.get(id);
    const def = styleDef(id);
    let plan = def.previewPlan ? ensureV4(JSON.parse(JSON.stringify(def.previewPlan))) : null;
    if (!plan && ES) plan = { format: 'explainer', title: def.label, sourceLine: 'Source: ES', beats: def.preview.map((x, i) => ({ id: `p${i}`, ...ES.legacyFields(ES.cleanBlock ? ES.cleanBlock({ type: x.type, ...x.fields }) : { type: x.type, ...x.fields }), vo: x.vo, emphasis: '', photo: '' })) };
    if (!plan) return null;
    applyStyle(plan, id);
    let tl = null;
    try { tl = R.buildTimeline(plan, { style: 'es', look: plan.look, esStyle: id, team: SAMPLE_TEAM, photos: {}, assets: {}, voiceMode: 'off', captionStyle: 'highlight' }); } catch (error) { window.FrameUpErrors?.report?.(error, 'reels style preview'); }
    previewCache.set(id, tl);
    return tl;
  }
  const SAMPLE_TEAM = { name: 'Sample', colors: ['#0A2342', '#0A6FDE'] };
  // The cards' previews show the ES safe frame (where every word sits): y 290 to 1650.
  const CROP = { y: 290, h: 1360 };
  function drawPreview(canvas, id, t) {
    const tl = previewTimeline(id);
    if (!tl || !canvas) return;
    const c = canvas.getContext('2d');
    const k = canvas.width / 1080;
    c.save();
    c.setTransform(k, 0, 0, k, 0, -CROP.y * k);
    // Loop the style's own scenes, not the shared end card.
    const scenes = (tl.beats || []).filter(b => b.kind !== 'cta');
    const loop = scenes.length ? scenes[scenes.length - 1].outMs : tl.durationMs;
    try { R.drawFrame(c, tl, t % Math.max(1, loop), { measure, images: state.images, videos: {}, cutouts: {}, grain }); } catch (error) { /* a preview never breaks the page */ }
    c.restore();
  }
  function renderStyles4() {
    const cur = state.esStyle;
    const refocus = els.styles4.contains(document.activeElement) ? document.activeElement.dataset.style4 : '';
    const sig = `${realStyles()}|${cur}`;
    if (els.styles4.dataset.sig !== sig || !els.styles4.childElementCount) {
      els.styles4.dataset.sig = sig;
      els.styles4.innerHTML = STYLE_IDS.map(id => {
        const def = styleDef(id);
        const on = id === cur;
        return `<button class="rm-style4 ais-card" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-style4="${id}" aria-describedby="rm-style4-${id}-blurb">
          <span class="rm-style4__frame"><canvas class="rm-style4__preview" width="432" height="544" data-preview="${id}" aria-hidden="true"></canvas>${on ? `<span class="rm-style4__check" aria-hidden="true">${ICON.check}</span>` : ''}</span>
          <span class="rm-style4__body"><span class="rm-style4__name">${esc(def.label)}</span>
          <span class="rm-style4__blurb" id="rm-style4-${id}-blurb">${esc(def.blurb)}</span>
          <span class="rm-style4__media">${esc(STYLE_MEDIA[id])}</span></span></button>`;
      }).join('');
      els.styles4.querySelectorAll('[data-preview]').forEach(cv => drawPreview(cv, cv.dataset.preview, 1500));
    }
    els.styleWhy.textContent = styleDef(cur).blurb;
    if (refocus) els.styles4.querySelector(`[data-style4="${refocus}"]`)?.focus({ preventScroll: true });
    renderMakeHint();
  }
  // Looping previews: one clock, about 24 frames a second, only while Create
  // shows and the cards are on screen; a still frame with reduced motion.
  let previewRaf = 0;
  let previewOn = false;
  let previewSeen = true;
  const previewT0 = performance.now();
  let previewLast = 0;
  function previewTick(now) {
    previewRaf = 0;
    if (!previewOn || document.hidden || !previewSeen) return;
    if (now - previewLast > 40) {
      previewLast = now;
      els.styles4.querySelectorAll('[data-preview]').forEach((cv, i) => drawPreview(cv, cv.dataset.preview, now - previewT0 + i * 700));
    }
    previewRaf = requestAnimationFrame(previewTick);
  }
  function previewsRun(on) {
    previewOn = Boolean(on) && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (previewOn && !previewRaf) previewRaf = requestAnimationFrame(previewTick);
  }
  if (window.IntersectionObserver) new IntersectionObserver(entries => { previewSeen = entries.some(e => e.isIntersecting); if (previewSeen) previewsRun(state.step === 'topic'); }).observe(els.styles4);
  document.addEventListener('visibilitychange', () => previewsRun(state.step === 'topic'));
  function setStyle4(id, { quiet = false } = {}) {
    if (!STYLE_IDS.includes(id)) return;
    const was = curStyle();
    state.esStyle = id;
    state.stylePicked = true;
    if (state.plan && was !== id) {
      applyStyle(state.plan, id);
      rebuild();
      if (!quiet) logEvent('edit', { what: 'style', style: id });
    }
    renderStyles4();
    if (was !== id) emit('style', { style: id });
  }
  els.styles4.addEventListener('click', event => {
    const btn = event.target.closest('[data-style4]');
    if (!btn || state.flow.making) return;
    setStyle4(btn.dataset.style4);
    els.styles4.querySelector(`[data-style4="${btn.dataset.style4}"]`)?.focus({ preventScroll: true });
  });
  // Kept for the modules and the data formats (one name, the v3 picker).
  function renderStyles() { renderStyles4(); }
  function renderAutoline() { renderRail(); }

  // ─── The prompt: topic, trend, link or script ────────────────────────────
  // "Use my exact words" makes it a script (never rewritten); a picked trend
  // makes the words notes on that story; otherwise it is a brief.
  // v4: the person's script is the only way in (the AI never writes it); a picked trend is a source.
  function syncSource() {
    els.scriptMode.checked = true;
    state.source = 'script';
    state.words = 'script';
    state.start = 'words';
  }
  const startOf = () => { const f = G && TL ? dataFmt() : ''; return f ? ({ gameswing: 'game', replay: 'clip', archive: 'player' }[f] || f) : state.start; };
  function renderMakeHint() {
    const def = styleDef(state.esStyle);
    const ai = state.config.ai && !state.config.offline;
    const bits = [def.label, STYLE_HINT[def.id], 'your words, word for word'];
    if (!ai) bits.push('visuals by code (AI is off)');
    els.makeHint.textContent = bits.join(' · ');
    els.promptHint.textContent = 'Wrap a key word in *asterisks* to make it pop in the captions.';
    renderMeter();
  }
  // The script meter: words, seconds at 2.6 words a second, and the length target.
  function renderMeter() {
    if (!els.meterWords || !SBC) return;
    const L = LENGTHS[state.length] || LENGTHS.full;
    const m = SBC.scriptMeter(els.prompt.value, L, WORDS_PER_SEC);
    els.meterWords.textContent = `${m.words.toLocaleString('en-US')} word${m.words === 1 ? '' : 's'}`;
    els.meterSec.textContent = m.words ? `about ${m.sec >= 60 ? `${Math.floor(m.sec / 60)}:${String(m.sec % 60).padStart(2, '0')}` : `${m.sec} s`}` : '0 s';
    els.meterTarget.textContent = m.state === 'empty' ? `${L.label}: ${L.min}–${L.max} s is ${m.need.min}–${m.need.max} words` : m.state === 'ok' ? `On target for ${L.label.toLowerCase()}` : m.state === 'short' ? `Short of ${L.label.toLowerCase()} (${L.min}–${L.max} s)` : `Longer than ${L.label.toLowerCase()} (${L.min}–${L.max} s)`;
    els.meter.dataset.state = m.state;
  }
  // Full or Short: the target the meter (and the AI's pacing) aims for.
  els.length?.addEventListener('click', event => {
    const btn = event.target.closest('[data-length]');
    if (!btn) return;
    state.length = btn.dataset.length === 'short' ? 'short' : 'full';
    radios(els.length, 'length', state.length);
    renderMeter();
    logEvent('edit', { what: 'length', length: state.length });
  });
  // Voice: an ES AI voice reads the script, or the person records their own.
  state.voiceChoice = 'ai';
  els.voiceChoice?.addEventListener('click', event => {
    const btn = event.target.closest('[data-voicechoice]');
    if (!btn) return;
    state.voiceChoice = btn.dataset.voicechoice === 'own' ? 'own' : 'ai';
    radios(els.voiceChoice, 'voicechoice', state.voiceChoice);
    if (state.voiceChoice === 'own') { const vi = mods().voiceInput; if (vi && typeof vi.open === 'function') vi.open(); else toast('Recording opens on Review, under Voice & music.'); }
    else state.voiceOn = true;
    els.voiceChoiceHint.textContent = state.voiceChoice === 'own' ? 'Record or upload your read; the captions follow your timing.' : 'An ES voice reads your script. Captions are always on.';
  });
  // With a reel open, Create offers the way back to it.
  function renderResume() {
    let btn = $('rm-resume');
    if (!state.plan || state.flow.making) { btn?.remove(); return; }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'rm-resume';
      btn.className = 'es-btn es-btn--tertiary rm-resume';
      btn.addEventListener('click', () => goStep('edit'));
      els.write.after(btn);
    }
    btn.innerHTML = `<span>Back to your reel</span>${ICON.chevronRight}`;
  }
  // The picked trend sits in the prompt card as a chip.
  function renderPicked() {
    const t = state.trend;
    els.picked.hidden = !t;
    els.promptCard.classList.toggle('has-trend', Boolean(t));
    if (!t) { els.picked.innerHTML = ''; return; }
    els.picked.innerHTML = `${leagueTile(t.sport, 24)}<span class="rm-picked__body"><span class="rm-picked__eyebrow">Source</span><span class="rm-picked__title">${esc(t.title)}</span></span>
      <button class="rm-icon-btn rm-icon-btn--sm" type="button" id="rm-unpick" aria-label="Clear the story" title="Clear the story">${ICON.x}</button>`;
    $('rm-unpick').addEventListener('click', () => {
      state.trend = null; syncSource(); renderTrends(); renderPicked(); renderMakeHint();
      els.prompt.focus();
    });
  }
  function syncStart() {
    syncSource();
    renderPicked();
    renderMakeHint();
    renderCost();
  }
  // Back to the news flow from a game, a clip or a player (the data formats
  // have no tile on Create any more; they open from links and saved reels).
  function leaveData() {
    if (!(G && TL) || !dataFmt()) return;
    if (state.plan && F.isDataFormat(state.plan.format)) startFresh();
    state.flow = FLOW.reduce(state.flow, { type: 'pick-format', format: 'explainer' });
    leaveDataPrefs();
    renderDataStory();
  }
  function setStart(id) {
    if (state.flow.making) return;
    leaveData();
    if (id === 'trend') els.scriptMode.checked = false;
    syncStart();
    goStep('topic', { focus: false });
  }
  function renderStart() { syncStart(); }
  els.prompt.addEventListener('input', debounce(() => { renderCost(); renderMeter(); }, 120));
  els.prompt.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); makeReel(); } });

  // ─── Need an idea? (lane B's radar and ideas room, in one dialog) ────────
  const inspoMounted = { radar: false, ideas: false };
  const inspoTabs = $('rm-inspo-tabs');
  function mountInspo(show = '') {
    const { radar, ideas } = mods();
    els.inspoSoon.hidden = Boolean(radar || ideas);
    if (radar && !inspoMounted.radar) { inspoMounted.radar = true; radar.mount(els.radarHost); }
    if (ideas && !inspoMounted.ideas) { inspoMounted.ideas = true; ideas.mount(els.ideasHost); }
    if (show) state.inspo = show;
    if (!mods()[state.inspo]) state.inspo = radar ? 'radar' : 'ideas';
    inspoTabs.hidden = !(radar && ideas);
    radios(inspoTabs, 'inspo', state.inspo);
    els.radarHost.hidden = !radar || state.inspo !== 'radar';
    els.ideasHost.hidden = !ideas || state.inspo !== 'ideas';
  }
  // The ideas room starts from what is on Create: the picked trend, else the words in the prompt.
  function seedIdeas() {
    const ideas = mods().ideas;
    if (!ideas) return;
    const trend = state.trend || null;
    const topic = els.prompt.value.trim() || (trend ? trend.title : '');
    if (topic || trend) ideas.open({ trend, topic, sport: (trend && trend.sport) || state.sport || '' });
  }
  inspoTabs.addEventListener('click', event => {
    const btn = event.target.closest('[data-inspo]');
    if (!btn) return;
    mountInspo(btn.dataset.inspo);
    if (btn.dataset.inspo === 'ideas') seedIdeas();
  });
  function openInspo(show = '') {
    mountInspo(show);
    if (!els.ideasDialog.open) els.ideasDialog.showModal();
    if (state.inspo === 'ideas') seedIdeas();
    else if (state.inspo === 'radar' && state.trend && mods().radar) mods().radar.open({ trend: state.trend });
    logEvent('edit', { what: 'inspiration' });
  }
  els.inspireLink.addEventListener('click', () => openInspo());
  // "Draft a script" (AI lane, mode script-draft, one Haiku call): a first
  // draft from the topic (the sources field, a picked story, or the words
  // typed so far). It lands in the editor for the person to change; the
  // director only ever reads what they keep. Undo puts the old words back.
  const draftBtn = $('rm-draft-btn');
  const draftStatus = $('rm-draft-status');
  async function draftScript() {
    if (state.busy || state.flow.making) return;
    const typed = els.prompt.value.trim();
    const topic = [els.topic ? els.topic.value.trim() : '', typed].filter(Boolean).join('\n');
    if (!topic && !state.trend) { draftStatus.textContent = 'Say what the reel is about first: type a topic above, add sources, or pick a story below.'; els.prompt.focus(); return; }
    if (!aiOn()) { draftStatus.textContent = 'Drafting needs AI, which is off right now. Write your script above.'; return; }
    state.busy = 'draft';
    draftBtn.disabled = true;
    draftBtn.setAttribute('aria-busy', 'true');
    draftStatus.textContent = 'Drafting a script from your topic…';
    try {
      const data = await api({ mode: 'script-draft', topic, trend: state.trend || null, length: state.length });
      const text = String(data.script || '').trim();
      if (!text) throw new Error('No draft came back. Try a more specific topic.');
      state.spent.director += Number(data.cost) || 0;
      els.prompt.value = text;
      els.prompt.dispatchEvent(new Event('input', { bubbles: true }));
      renderMeter();
      els.prompt.focus({ preventScroll: true });
      draftStatus.textContent = (data.issues || []).length ? `Draft ready. ${data.issues.length} line${data.issues.length > 1 ? 's were' : ' was'} left out: ${data.issues[0]}` : 'Draft ready. Edit it into your own words; it is your script from here.';
      toast('A first draft is in the editor. Change anything before you build.', typed ? { action: { label: 'Undo', run: () => { els.prompt.value = typed; renderMeter(); } } } : {});
      logEvent('edit', { what: 'script-draft', cost: data.cost || 0 });
    } catch (error) {
      draftStatus.textContent = error.message || 'Drafting is unavailable right now. Write your script above.';
    } finally {
      state.busy = '';
      draftBtn.disabled = false;
      draftBtn.removeAttribute('aria-busy');
    }
  }
  draftBtn?.addEventListener('click', draftScript);
  els.ideasDialog.addEventListener('click', event => { if (event.target === els.ideasDialog) els.ideasDialog.close(); });
  // Esc, the close button or a backdrop click: focus goes back to "Need an idea?".
  els.ideasDialog.addEventListener('close', () => { if (state.step === 'topic') els.inspireLink.focus({ preventScroll: true }); });

  // ─── Start from a trend ──────────────────────────────────────────────────
  function leagueTile(sport, size = 20) {
    const logo = LOGOS ? LOGOS.logoFor(sport) : null;
    if (!logo) return size >= 24 ? `<span class="rm-league rm-league--none" style="--size:${size}px" aria-hidden="true">${esc((SPORT_LABEL[sport] || '?').slice(0, 3))}</span>` : '';
    return `<span class="rm-league" style="--tile:${esc(logo.bg)};--size:${size}px" title="${esc(logo.label)}"><img src="${esc(logo.src)}" alt="" loading="lazy"></span>`;
  }
  function renderLeagues() {
    // The four core leagues always show; the newer ones show when they have a story.
    const extra = ['nba', 'wnba', 'tennis', 'nascar'].filter(id => state.trends.some(t => t.sport === id) || state.league === id).map(id => [id, SPORT_LABEL[id]]);
    const list = [['all', 'All'], ['nfl', 'NFL'], ['cfb', 'CFB'], ['mlb', 'MLB'], ['golf', 'Golf'], ...extra];
    els.leagues.innerHTML = list.map(([id, label]) => `<button class="es-chip" type="button" role="radio" aria-checked="${state.league === id}" tabindex="${state.league === id ? 0 : -1}" data-league="${id}">${id === 'all' ? '' : leagueTile(id, 16)}${label}</button>`).join('');
  }
  els.leagues.addEventListener('click', event => {
    const btn = event.target.closest('[data-league]');
    if (!btn) return;
    const refocus = els.leagues.contains(document.activeElement);
    state.league = btn.dataset.league;
    renderLeagues();
    renderTrends();
    if (refocus) els.leagues.querySelector(`[data-league="${state.league}"]`)?.focus();
    els.trends.scrollLeft = 0;
  });
  const ago = iso => {
    const t = new Date(iso).getTime();
    if (!t) return '';
    const h = Math.round((Date.now() - t) / 3600e3);
    return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  };
  function renderTrends() {
    els.trends.setAttribute('aria-busy', String(state.trendsState === 'loading'));
    if (state.trendsState === 'loading') {
      els.trends.innerHTML = Array.from({ length: 4 }, () => '<li class="rm-trend is-skeleton"><span class="es-skeleton rm-sk-a"></span><span class="es-skeleton rm-sk-b"></span></li>').join('');
      return;
    }
    if (state.trendsState === 'error') {
      els.trends.innerHTML = `<li class="es-error-state rm-trends-state" role="alert"><p class="es-error-state__title">Trends did not load</p><p class="es-error-state__copy">Describe the reel above instead, or try again.</p><button class="es-btn es-btn--sm" type="button" id="rm-trends-retry">Try again</button></li>`;
      $('rm-trends-retry')?.addEventListener('click', loadTrends);
      return;
    }
    const items = state.trends.filter(item => state.league === 'all' || item.sport === state.league).slice(0, 10);
    if (!items.length) {
      els.trends.innerHTML = '<li class="es-empty rm-trends-state"><p class="es-empty__title">No fresh stories here</p><p class="es-empty__copy">Try another league, or describe the reel above.</p></li>';
      return;
    }
    // Roving tabindex: one Tab stop (the picked card, else the first); arrows move.
    const tabId = items.some(item => item.id === state.trend?.id) ? state.trend.id : items[0].id;
    els.trends.innerHTML = items.map(item => {
      const on = state.trend?.id === item.id;
      return `<li role="none"><button class="rm-trend" type="button" role="radio" aria-checked="${on}" tabindex="${item.id === tabId ? 0 : -1}" data-trend="${esc(item.id)}">
        <span class="rm-trend__top">${leagueTile(item.sport, 24)}<span class="rm-trend__meta">${esc([SPORT_LABEL[item.sport] || '', item.publishedAt ? ago(item.publishedAt) : ''].filter(Boolean).join(' · '))}</span></span>
        <span class="rm-trend__title">${esc(item.title)}</span>
      </button></li>`;
    }).join('');
  }
  // "NFL · 2h ago" (kept for the data formats and modules).
  function trendMeta(item) {
    const bits = [SPORT_LABEL[item.sport] || '', item.publishedAt ? ago(item.publishedAt) : ''].filter(Boolean).join(' · ');
    return `<span class="rm-trend__meta"><span>${esc(bits)}</span></span>`;
  }
  els.trends.setAttribute('role', 'radiogroup');
  els.trends.addEventListener('click', event => {
    const btn = event.target.closest('[data-trend]');
    if (!btn || state.flow.making) return;
    const item = state.trends.find(t => t.id === btn.dataset.trend);
    if (!item) return;
    state.trend = state.trend?.id === item.id ? null : item;
    syncStart();
    renderTrends();
    if (state.trend) { els.promptCard.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
    logEvent('edit', { what: 'trend', picked: Boolean(state.trend) });
  });
  els.trends.addEventListener('keydown', event => {
    if (!['Home', 'End'].includes(event.key) || !event.target.closest('[data-trend]')) return;
    const list = [...els.trends.querySelectorAll('[data-trend]')];
    event.preventDefault();
    (event.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
  });
  async function loadTrends() {
    state.trendsState = 'loading';
    renderTrends();
    try {
      const data = await api({ mode: 'trends' });
      state.trends = data.items || [];
      state.trendsState = 'ready';
      renderLeagues();
    } catch (error) {
      // Static previews have no API: the public trends endpoint is tried too.
      try {
        const response = await fetch('/api/trend-design');
        const data = await response.json();
        state.trends = (data.items || []).filter(i => TREND_SPORTS.includes(i.category)).map(i => ({ id: i.id, sport: i.category, title: i.title, url: i.url, publishedAt: i.publishedAt, team: i.team?.name || '', format: F.routeFormat(i.title).format, related: (i.related || []).slice(0, 4) }));
        state.trendsState = 'ready';
      } catch {
        state.trendsState = 'error';
      }
    }
    renderTrends();
  }

  const topicText = () => [state.trend?.title, ...(state.trend?.related || []).map(r => r.title), els.prompt.value].filter(Boolean).join(' ');
  function renderFormats() { renderMakeHint(); }

  // A saved reel from Reels 2.0 (a look and a recipe, or a retired style)
  // opens in the closest v3 style. Each beat gets its ES block from the
  // fields it already has (ReelES.blockOf), so no words change. Returns the
  // line for the toast ('' when nothing changed).
  function adoptLook(plan, savedStyle = '') {
    if (!plan || !ES) return '';
    const old = [savedStyle, plan.style].find(id => S.isLegacy(id)) || '';
    plan.style = S.currentStyle(plan.style);
    if (old && !plan.look) plan.look = ES.lookForStyle(old);
    if (old && !(F.isDataFormat && F.isDataFormat(plan.format))) {
      (plan.beats || []).forEach(beat => {
        if (beat.block && ES.BLOCK_TYPES.includes(beat.block.type)) return;
        const block = ES.blockOf(beat);
        beat.block = block;
        beat.kind = ES.KIND_FOR[block.type];
      });
    }
    if (STYLE_IDS.includes(plan.esStyle)) { applyStyle(plan, plan.esStyle); return ''; }
    const id = legacyStyle(plan);
    applyStyle(plan, id);
    return `This reel was made before the four styles. It now opens in ${styleDef(id).label}.`;
  }
  // Published as ctx.modules.styles (registered where the page context is made).
  const stylesApi = {
    list: () => STYLE_IDS.map(id => { const d = styleDef(id); return { id, label: d.label, blurb: d.blurb, media: d.media }; }),
    set: id => setStyle4(id),
    current: () => curStyle(),
    preview: (canvas, id, t = 1500) => drawPreview(canvas, id || curStyle(), t),
  };

  // ── Details fold (Review): size, sources, and the admin rows. The rail of
  // Reels 2.0 is gone; renderRail keeps its name for the modules.
  function renderRail() {
    const data = G && TL ? dataFmt() : '';
    const planData = state.plan && F.isDataFormat && F.isDataFormat(state.plan.format) ? state.plan.format : '';
    els.aspectSec.hidden = !esOn() || Boolean(data || planData);
    radios(els.aspect, 'aspect', state.aspect);
    els.sources.hidden = !state.plan;
    els.capstyleField.hidden = S.get(styleId()).caption.mode !== 'user';
    els.captionsMeta.textContent = 'Always on';
    els.detailsMeta.textContent = [state.aspect === '4:5' ? 'Feed 4:5' : 'Reel 9:16', state.sources.length ? `${state.sources.length} source${state.sources.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
    syncAdmin();
  }

  // ─── Voice picker (Story settings and Review fold share it) ─────────────
  let sampleSource = null;
  function voicePickerHtml(where) {
    const v = state.config.voice || {};
    // The rail's own note (#rm-voice-note) already says why; one line, not two.
    if (!v.ready) return '';
    const list = v.voices || [];
    const est = F.estimateCost({ voiceMode: v.mode, voiceModel: v.model, voChars: voChars(), tier: 'economy' }).lines.find(l => l.id === 'voice').usd;
    return `<div class="rm-sec__head"><span class="es-field__label" id="rm-aivoice-label">AI voice</span>
      <label class="rm-switch"><input type="checkbox" role="switch" data-voice-on aria-labelledby="rm-aivoice-label" ${state.voiceOn ? 'checked' : ''}><span>${state.voiceOn ? 'On' : 'Off'}</span></label></div>
      ${list.length ? `<div class="rm-voices" role="radiogroup" aria-label="Voice" ${state.voiceOn ? '' : 'aria-disabled="true"'}>${list.map(x => {
        const on = state.voiceId === x.id;
        return `<div class="rm-voice${on ? ' is-on' : ''}"><button class="rm-voice__pick" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-voice="${x.id}" ${state.voiceOn ? '' : 'disabled'}><span class="rm-voice__name">${esc(x.name)}</span><span class="rm-voice__line">${esc(x.line)}</span></button><button class="rm-icon-btn rm-icon-btn--sm rm-voice__play" type="button" data-sample="${x.id}" aria-label="Hear ${esc(x.name)}" title="Hear a short sample">${ICON.play}</button></div>`;
      }).join('')}</div>` : ''}
      <p class="rm-hint">${state.voiceOn ? `Human-sounding AI voices (${esc(v.model.replace('elevenlabs/', 'ElevenLabs '))}), never a clone. About ${F.money(est)} for this reel; unchanged lines are reused for free.` : 'Off: the reel exports with captions only.'}</p>`;
  }
  function renderVoicePickers() {
    els.voiceEdit.innerHTML = voicePickerHtml('edit');
    els.voiceEdit.hidden = !els.voiceEdit.childElementCount;
    if (!state.plan) renderVoice();
    renderAutoline();
  }
  async function playSample(id, btn) {
    try { sampleSource?.stop(); } catch { /* ended */ }
    btn.disabled = true;
    try {
      const key = `sample|${state.config.voice.model}|${id}`;
      let rec = await VoiceCache.get(key);
      if (!rec) {
        const data = await api({ mode: 'voice-sample', voice: id });
        state.spent.voice += Number(data.cost) || 0;
        rec = { bytes: b64ToBytes(data.audio).buffer, mime: data.mime, words: [] };
        VoiceCache.set(key, rec);
      }
      const ac = audioContext();
      await ac.resume().catch(() => {});
      const buffer = await ac.decodeAudioData(rec.bytes.slice(0));
      sampleSource = ac.createBufferSource();
      sampleSource.buffer = buffer;
      sampleSource.connect(ac.destination);
      sampleSource.start();
    } catch (error) {
      toast(error.message || 'The sample could not play.', { tone: 'error' });
    } finally { btn.disabled = false; }
  }
  function onVoiceUi(event) {
    const sample = event.target.closest('[data-sample]');
    if (sample) { playSample(sample.dataset.sample, sample); return; }
    const pick = event.target.closest('[data-voice]');
    if (pick && pick.dataset.voice !== state.voiceId) {
      // ── Reels 2.0: C (inputs) ── an AI voice never talks over the person's own recording.
      if (ownVoice()) { toast('Your own voiceover is on this reel. Remove it under Voice in Settings to use an AI voice.'); return; }
      state.voiceId = pick.dataset.voice;
      renderVoicePickers();
      if (state.plan && state.voiceOn) { state.voice = {}; rebuild(); renderVoice(); voiceSoon(0); }
      logEvent('edit', { what: 'voice', voice: state.voiceId });
    }
  }
  function onVoiceToggle(event) {
    const box = event.target.closest('[data-voice-on]');
    if (!box) return;
    state.voiceOn = box.checked;
    renderVoicePickers();
    if (state.plan) { rebuild(); renderVoice(); if (state.voiceOn) voiceSoon(0); }
  }
  [els.voiceEdit].forEach(root => { root.addEventListener('click', onVoiceUi); root.addEventListener('change', onVoiceToggle); });
  els.clipsOn.addEventListener('change', () => { state.useClips = els.clipsOn.checked; renderAutoline(); renderCost(); });
  els.aiclipsOn.addEventListener('change', () => { state.aiClips = els.aiclipsOn.checked; renderCost(); });
  // Original clip audio: off by default (clips are muted in preview and export).
  const clipAudioBox = document.getElementById('rm-clip-audio');
  if (clipAudioBox) {
    clipAudioBox.checked = false;
    clipAudioBox.addEventListener('change', async () => {
      state.clipAudio = clipAudioBox.checked;
      if (state.clipAudio) {
        const n = await clipSounds();
        if (!n) toast('These clips have no sound to add. They stay muted.');
      }
      rebuild();
    });
  }
  els.brief.addEventListener('input', debounce(() => { renderFormats(); renderStyles(); renderCost(); }, 250));
  els.script.addEventListener('input', debounce(() => { renderFormats(); renderCost(); }, 250));
  els.sport.addEventListener('change', () => { state.sport = els.sport.value; });
  els.tier.addEventListener('click', event => {
    const btn = event.target.closest('[data-tier]');
    if (!btn) return;
    state.tier = btn.dataset.tier;
    radios(els.tier, 'tier', state.tier);
    renderCost();
    renderAutoline();
  });
  els.factcheck.addEventListener('change', () => { state.factCheck = els.factcheck.checked; renderCost(); renderAutoline(); });

  function voChars() {
    if (state.plan) return state.plan.beats.reduce((n, b) => n + (b.vo || '').length, 0);
    return 450;
  }
  function costEstimate() {
    const v = state.config.voice || {};
    const long = S.get(styleId()).seconds.max > 90;
    const ai = state.config.ai && !state.config.offline;
    const sceneBeats = state.plan ? state.plan.beats.filter(b => b.visual === 'scene').length : 1;
    return F.estimateCost({
      tier: state.tier, factCheck: state.factCheck, voiceMode: v.ready && state.voiceOn ? v.mode : 'off', voiceModel: v.model, voChars: voChars() || (long ? 1100 : 450),
      clipSearches: state.useClips && ai ? 1 : 0, aiClips: state.useClips && state.aiClips && state.config.aiClips?.ready ? Math.min(state.config.aiClips.max, Math.max(1, sceneBeats)) : 0,
      scenes: ai ? Math.min(2, sceneBeats) : 0, longForm: long,
      clipJudge: state.useClips && ai && CLIPS && state.config.clipJudge?.ready !== false ? CLIPS.reelJudgeEstimate(CLIPS.JUDGE.maxClips) : 0,
      ...dataCostOptions(),
    });
  }
  // A data format adds its own lines: game data and ES research (free), the
  // AI frame pick (capped). Empty for the news formats.
  function dataCostOptions() {
    const fmt = G && TL ? (dataFmt() || (state.plan && F.isDataFormat(state.plan.format) ? state.plan.format : '')) : '';
    if (!fmt) return {};
    const o = F.formatCostOptions(fmt, { aiFramePick: G.modeOn(state.config.formatModes, 'frame-pick') && state.config.ai && !state.config.offline });
    return { data: o.data, framePick: o.framePick, archiveResearch: o.archiveResearch };
  }
  function costHtml(title = 'Estimated cost for this reel') {
    const est = costEstimate();
    const ai = state.config.ai && !state.config.offline;
    return `<details class="rm-cost__fold"><summary><span>${esc(title)}</span><b>${ai ? `≈ ${F.money(est.total)}` : 'Free draft'}</b></summary>
      <ul>${est.lines.map(line => `<li><span>${esc(line.label)}</span><span>${F.money(line.usd)}</span></li>`).join('')}</ul>
      <p>Counts toward your weekly AI limit. Official X clips are free once found. ${ai ? '' : 'AI is off here, so you get a draft built from your words.'}</p></details>`;
  }
  // ── Reels 2.0: D (interface) ── the rail's Cost row: the estimate, then what this reel has spent.
  function renderCost() {
    const est = costEstimate();
    const ai = state.config.ai && !state.config.offline;
    const script = state.source === 'script' && !(G && TL && dataFmt()) && !state.plan;
    els.costMeta.textContent = state.plan ? `${F.money(totalSpent())} spent` : (ai ? (script ? 'Free script' : `≈ ${F.money(est.total)}`) : 'Free draft');
    els.cost.innerHTML = `<p class="rm-cost__title">Estimate for this reel <b>${ai ? `≈ ${F.money(est.total)}` : 'Free draft'}</b></p>
      <ul class="rm-cost__list">${est.lines.map(line => `<li><span>${esc(line.label)}</span><span>${F.money(line.usd)}</span></li>`).join('')}</ul>
      <p class="rm-hint">Counts toward your weekly AI limit. Official X clips are free once found. ${ai ? '' : 'AI is off here, so you get a draft built from your words.'}</p>`;
    els.spend.hidden = !state.plan;
    if (state.plan) renderSpend();
  }

  // ─── Write the reel ──────────────────────────────────────────────────────
  function setBusy(button, textEl, busy, label) {
    button.disabled = busy;
    button.classList.toggle('is-busy', busy);
    button.setAttribute('aria-busy', String(busy));
    if (label) textEl.textContent = label;
  }
  // ─── Make my reel: script -> voice -> visuals -> build -> review ─────────
  // The primary button stays a filled primary while busy (aria-disabled, not
  // disabled, so it never falls back to the outline look) and counts the steps.
  const writeLabel = () => (state.config.ai ? 'Make my reel' : 'Make a draft reel');
  function setWriteBusy(busy) {
    els.write.classList.toggle('is-busy', busy);
    els.write.setAttribute('aria-busy', String(busy));
    if (busy) els.write.setAttribute('aria-disabled', 'true'); else els.write.removeAttribute('aria-disabled');
    if (!busy) els.writeText.textContent = writeLabel();
  }
  const STATE_WORD = { done: 'done', active: 'in progress', todo: 'to do', failed: 'needs a look', skipped: 'skipped' };
  // ── Reels Studio v3 (UI) ── a news reel ends with the AI review ("approved
  // in one go"); the data formats keep their own stages.
  const STAGE_LABEL = { script: 'Planning chapters around your script', voice: 'Recording the voiceover', visuals: 'Finding clips and photos', build: 'Building your reel' };
  function withReview(flow) {
    if (flow.format || flow.stages.some(x => x.id === 'review')) return flow;
    if (els.makingChapters) { els.makingChapters.hidden = true; els.makingChapters.innerHTML = ''; }
    return { ...flow, stages: [...flow.stages.map(x => (STAGE_LABEL[x.id] ? { ...x, label: STAGE_LABEL[x.id] } : x)), { id: 'review', label: 'Checking every scene', state: 'todo', note: '' }] };
  }
  let makingClock = 0;
  let makingT0 = 0;
  function renderMaking() {
    const f = state.flow;
    els.makingCard.hidden = !f.making;
    els.panes.topic.classList.toggle('is-making', f.making);
    els.prompt.readOnly = f.making;
    els.steps.querySelectorAll('.rm-step:not([data-step="topic"])').forEach(btn => { btn.disabled = f.making || !state.plan; });
    if (f.making && !makingClock) {
      makingT0 = Date.now();
      makingClock = setInterval(() => { els.makingTime.textContent = `${Math.round((Date.now() - makingT0) / 1000)} s`; }, 1000);
      els.makingTime.textContent = '0 s';
    } else if (!f.making && makingClock) { clearInterval(makingClock); makingClock = 0; }
    const fmt = G && TL ? dataFmt() : '';
    els.makingTitle.textContent = fmt ? `Making your ${F.FORMATS[fmt].label} reel` : `Building your ${styleDef(state.esStyle).label} reel`;
    const about = els.prompt.value.trim();
    els.makingAbout.textContent = fmt ? '' : F.trimWords ? F.trimWords(about.replace(/\s+/g, ' '), 18) : about.slice(0, 120);
    els.makingAbout.hidden = !els.makingAbout.textContent;
    const mark = { done: ICON.check, failed: ICON.warn, skipped: '<span class="rm-making__dash"></span>', active: '<span class="rm-spin"></span>', todo: '' };
    els.making.innerHTML = f.stages.map(x => `<li class="rm-making__step is-${x.state}"${x.state === 'active' ? ' aria-current="step"' : ''}><span class="rm-making__mark" aria-hidden="true">${mark[x.state]}</span><span class="rm-making__text"><span class="rm-making__label">${esc(x.label)}</span>${x.note ? `<small>${esc(x.note)}</small>` : ''}</span><span class="es-sr-only">, ${STATE_WORD[x.state] || x.state}</span></li>`).join('');
    const i = f.stages.findIndex(x => x.state === 'active');
    if (f.making && i >= 0) {
      els.writeText.textContent = `Making your reel · ${i + 1} of ${f.stages.length}`;
      if (els.makingLive) els.makingLive.textContent = `Step ${i + 1} of ${f.stages.length}: ${f.stages[i].label}`;
    }
  }
  const flowEvent = event => { state.flow = FLOW.reduce(state.flow, event); if (event.type === 'make') state.flow = withReview(state.flow); renderMaking(); };
  function startMaking() {
    setWriteBusy(true);
    flowEvent({ type: 'make' });
    els.writeStatus.textContent = '';
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    els.makingCard.scrollIntoView?.({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  }
  // v4: the person's script is the reel. The AI plans chapters, modules and
  // media around it and never rewrites a word (a plan that changes the words
  // is not used); with AI off or capped the scenes come from the script by
  // code ($0). The optional sources field and a picked trend feed the fact
  // checks and the sourcing.
  async function makeReel() {
    if (state.flow.making) return;
    if (G && TL && dataFmt()) { await makeDataReel(); return; }
    syncSource();
    const script = els.prompt.value.trim();
    if (F.wordCount(script) < 6) { els.writeStatus.textContent = 'Paste your script first: a sentence or two at least.'; els.prompt.focus(); return; }
    if (!ES) { els.writeStatus.textContent = 'Reels Studio did not load fully. Reload the page.'; return; }
    startMaking();
    const started = Date.now();
    const style = state.esStyle;
    const topic = els.topic ? els.topic.value.trim() : '';
    const trend = state.trend || null;
    const corpus = [script, topic, trend?.title, ...(trend?.related || []).map(r => r.title)].filter(Boolean).join('\n');
    const sources = [{ type: 'script', title: 'Your script' }, ...(topic ? [{ type: 'brief', title: 'Your sources', text: topic.slice(0, 300) }] : []), ...(trend ? [{ type: 'trend', title: trend.title, url: trend.url, source: trend.source }] : [])];
    if (topic && els.extraSource && !els.extraSource.value.includes(topic)) els.extraSource.value = [els.extraSource.value, topic].filter(Boolean).join('\n');
    logStart();
    let made = null;
    let why = '';
    // The server plans in every mode it can answer (AI on: the director; AI off or capped: its code plan).
    if (!state.config.offline) {
      try {
        const data = await api({ mode: 'plan', v: 4, script, scriptLocked: true, brief: topic, trend, length: state.length, format: state.format, sport: state.sport, tier: state.tier, factCheck: state.factCheck, style: state.style, esStyle: style, ...(realStyles() ? {} : { look: STUB_LOOK[style] }) });
        state.spent.director += Number(data.costs?.director) || 0;
        state.spent.factCheck += Number(data.costs?.factCheck) || 0;
        const plan = data.plan ? ensureV4(data.plan) : null;
        // The server's plan is used whenever it keeps the words: the AI's, or its own code plan
        // (AI off or capped: one beat per sentence, chapters, sourced headlines). Only the old
        // v3 'draft' (a plan written from a brief, not the script) gives way to the page's code plan.
        const planned = plan && String(data.source || '') !== 'draft';
        if (planned && SBC && SBC.keepsScript(plan, script)) {
          plan.script = { text: script.replace(/\s+/g, ' ').trim(), locked: true };
          applyStyle(plan, style);
          made = { ...data, plan, corpus: [data.corpus, corpus, ...sourceClaims(plan)].filter(Boolean).join('\n'), sources: [...sources, ...(data.sources || []).filter(x => x && x.type !== 'brief')] };
        } else if (planned) why = 'The AI plan changed some of your words, so the scenes were built from your script by code.';
      } catch (error) {
        why = error.offline ? '' : 'The AI planner is unavailable right now, so the scenes were built from your script by code.';
      }
    }
    if (!made) {
      let plan = ES.scriptToPlan(script, { sourceLine: '', voLengthSec: 0, sport: state.sport, format: state.format === 'auto' ? 'explainer' : state.format });
      plan.style = 'es';
      applyStyle(plan, style, { reshape: true });
      plan = ensureV4(plan);
      made = { plan, source: 'script', notice: why || (aiOn() ? '' : 'AI is off, so the scenes were built from your script by code. Your words are exactly as written.'), corpus, sources };
    }
    applyPlan(made, { brief: script, trend, go: false });
    logEvent('plan', { source: made.source, format: made.plan.format, style: made.plan.style, esStyle: style, beats: made.plan.beats.length, chapters: v4(made.plan) ? made.plan.chapters.length : 0, length: state.length, cost: made.cost || 0 });
    const groups = SBC ? SBC.chaptersOf(made.plan) : [];
    showChapters(groups);
    flowEvent({ type: 'stage-done', stage: 'script', note: `${v4(made.plan) ? `${made.plan.chapters.length} chapters · ` : ''}${made.plan.beats.length} scenes · your words` });
    await finishMake(started);
  }
  // What the plan's own sources say (title, claim, text): numbers on screen may come from them.
  function sourceClaims(plan) {
    return (Array.isArray(plan && plan.sources) ? plan.sources : []).map(x => (x && typeof x === 'object' ? [x.title, x.source, x.claim, x.text].filter(Boolean).join(' · ') : String(x || ''))).filter(Boolean);
  }
  // The making checklist lists the chapters as they are planned.
  let chapterTimer = 0;
  function showChapters(groups) {
    const el = els.makingChapters;
    if (!el) return;
    clearInterval(chapterTimer);
    const list = (groups || []).filter(g => g.headline || g.n);
    el.hidden = !list.length || !(state.plan && v4());
    el.innerHTML = '';
    if (el.hidden) return;
    let k = 0;
    const add = () => {
      const g = list[k];
      if (!g) { clearInterval(chapterTimer); return; }
      const li = document.createElement('li');
      li.className = 'rm-makingch__item';
      li.innerHTML = `<span class="rm-makingch__marker">${esc(g.marker)}</span><span class="rm-makingch__title">${esc(g.headline || `Chapter ${g.n}`)}</span><span class="rm-meta">${g.beats.length} scene${g.beats.length === 1 ? '' : 's'}</span>`;
      el.append(li);
      k += 1;
    };
    add();
    chapterTimer = setInterval(add, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 240);
  }
  // Your script (ES video system): your words, word for word, split into
  // scenes with a block each (code only, $0). Nothing is rewritten. The
  // length follows your words (or your own recording): no seconds to type.
  async function makeFromScript() {
    const script = els.prompt.value.trim();
    if (F.wordCount(script) < 6) { els.writeStatus.textContent = 'Paste your script first: a sentence or two at least.'; els.prompt.focus(); return; }
    startMaking();
    const started = Date.now();
    const plan = ES.scriptToPlan(script, { sourceLine: '', voLengthSec: 0, sport: state.sport, format: state.format === 'auto' ? 'explainer' : state.format });
    plan.style = state.style === 'auto' ? 'es' : state.style;
    applyStyle(plan, state.esStyle, { reshape: true });
    logStart();
    const made = { plan, source: 'script', notice: 'Your script, word for word: each line is a scene. Change a scene’s block or its on-screen words; your voiceover lines stay as you wrote them.', corpus: script, sources: [{ type: 'script', title: 'Your script' }] };
    applyPlan(made, { brief: script, go: false });
    logEvent('plan', { source: 'script', format: plan.format, style: plan.style, esStyle: plan.esStyle, beats: plan.beats.length, cost: 0 });
    flowEvent({ type: 'stage-done', stage: 'script', note: `${made.plan.beats.length} scenes from your words · $0` });
    await finishMake(started);
  }
  function logStart() {
    logEvent('start', { source: startOf(), words: startOf() === 'words' ? state.source : '', style: state.esStyle });
  }
  async function finishMake(started) {
    // 2. Voice (automatic when it is set up and on).
    if (state.config.voice.ready && state.voiceOn) {
      const out = await makeVoice({ auto: true });
      flowEvent({ type: 'stage-done', stage: 'voice', failed: Boolean(out.failed), note: out.failed ? 'Captions only for now. Retry in Review.' : `${out.made + out.reused} lines` });
    } else flowEvent({ type: 'stage-done', stage: 'voice', skipped: true, note: state.config.voice.ready ? 'Voice is off' : 'Captions only' });
    // 3. Visuals: verified clips and photos per scene (ReelSourcing).
    try {
      const v = await fillVisuals();
      flowEvent({ type: 'stage-done', stage: 'visuals', note: v.note });
    } catch (error) {
      flowEvent({ type: 'stage-done', stage: 'visuals', failed: true, note: 'Some scenes use an infographic instead' });
    }
    // 4. Build.
    rebuild();
    if (S.get(styleId()).cutout) autoCutout();
    flowEvent({ type: 'stage-done', stage: 'build', note: `${(state.timeline.durationMs / 1000).toFixed(0)} s` });
    // 5. The AI review: picture matches words, facts sourced, text on the scale, brand checks. Fixes land before you see the reel.
    if (state.flow.stages.some(x => x.id === 'review')) {
      const rv = await runReview();
      const cr = await runCritic();
      flowEvent({ type: 'stage-done', stage: 'review', note: [rv.note, cr.note].filter(Boolean).join(' · '), skipped: Boolean(rv.skipped && cr.skipped), failed: Boolean(rv.failed) });
    }
    setWriteBusy(false);
    if (els.makingLive) els.makingLive.textContent = 'Your reel is ready.';
    renderEdit();
    goStep('edit', { focus: true });
    const rd = state.ready;
    toast(rd && rd.state === 'draft' ? 'Your draft is ready. Find clips before it can post.' : rd && rd.needsClips ? 'Your reel is built. It needs at least one clip before it is ready to post.' : rd && rd.still ? 'Your reel is built. Some scenes need motion before it is ready to post.' : (state.lint && state.lint.ok ? 'Your reel is ready to post. Change any scene in the timeline.' : 'Your reel is ready. One thing needs a look before it exports.'));
    logEvent('make', { ms: Date.now() - started, style: styleId(), esStyle: curStyle(), seconds: Math.round(state.timeline.durationMs / 1000), clipShare: clipShare().share, start: startOf(), review: state.review ? (state.review.issues || []).length : -1 });
  }
  els.write.addEventListener('click', makeReel);

  // ── The AI review (sourcing lane: ReelSourcing.review → server mode
  // 'review', one cheap call plus code checks). Fixed text comes back as a
  // plan; scenes whose picture does not match get their media re-picked.
  async function runReview() {
    const SRC_ = window.ReelSourcing;
    if (!SRC_ || typeof SRC_.review !== 'function' || !state.plan) { state.review = null; return { skipped: true, note: 'Code checks ran' }; }
    const plan = state.plan;
    try {
      const picks = typeof SRC_.picksFor === 'function' ? SRC_.picksFor(plan) : undefined;
      const out = (await SRC_.review(plan, { picks, corpus: [state.corpus, els.extraSource.value].filter(Boolean).join('\n'), style: curStyle() })) || {};
      if (state.plan !== plan) return { skipped: true, note: '' };
      // The review could not run (AI off, over a cap, offline): the code checks stand on their own.
      if (out.ok === false) { state.review = null; return { skipped: true, note: 'AI review unavailable; the code checks ran' }; }
      state.spent.review = (Number(state.spent.review) || 0) + (Number(out.cost) || 0);
      const issues = (Array.isArray(out.issues) ? out.issues : []).filter(i => i && typeof i === 'object').map(i => ({ ...i, message: i.problem || i.message || '' }));
      // The fixed plan (text shortened, unsourced numbers dropped, colours, order): beats keep their ids, media and voice.
      let fixed = 0;
      if (out.plan && Array.isArray(out.plan.beats) && out.plan.beats.length) {
        const byId = new Map(plan.beats.map(b => [b.id, b]));
        const next = out.plan.beats.filter(b => b && byId.has(b.id)).map(b => {
          const old = byId.get(b.id);
          const merged = { ...old, ...b };
          if (JSON.stringify(merged) !== JSON.stringify(old)) fixed += 1;
          return Object.assign(old, b);
        });
        if (next.length >= 2) plan.beats = next;
        if (out.plan.sourceLine) plan.sourceLine = out.plan.sourceLine;
      }
      // Scenes whose picture failed: ReelSourcing's next verified candidate (or the infographic).
      const repicks = Object.entries(out.repicks || {});
      for (const [beatId, pick] of repicks) {
        const beat = plan.beats.find(b => b.id === beatId);
        if (beat) { await applyPick(beat, pick, state.cands[beatId]?.subject); fixed += 1; }
      }
      state.review = { ok: out.ok !== false, ready: out.ready !== false, issues, fixed, at: Date.now() };
      rebuild();
      const open = issues.filter(i => !i.fixed).length;
      return { note: fixed ? `${fixed} fix${fixed > 1 ? 'es' : ''} made${open ? ` · ${open} to look at` : ''}` : (open ? `${open} to look at` : 'Every scene checks out') };
    } catch (error) {
      state.review = null;
      return { failed: true, note: 'The AI review is unavailable; the code checks ran.' };
    }
  }

  // The critic (AI lane, mode 'critique', Haiku): hook, one idea per chapter,
  // media ↔ words, module ↔ claim, pacing, close. Safe fixes come back as a
  // plan and are applied only when every word of the script is unchanged.
  async function runCritic() {
    state.critic = null;
    if (!state.plan || !aiOn()) return { skipped: true, note: '' };
    const plan = state.plan;
    try {
      const out = await api({ mode: 'critique', plan, esStyle: curStyle(), length: state.length, corpus: [state.corpus, els.extraSource.value].filter(Boolean).join('\n') });
      if (state.plan !== plan || !out || typeof out.pass !== 'boolean') return { skipped: true, note: '' };
      state.spent.review = (Number(state.spent.review) || 0) + (Number(out.cost) || 0);
      let fixed = 0;
      if (out.plan && SBC) {
        const next = ensureV4(out.plan);
        const words = plan.script ? plan.script.text : plan.beats.map(b => b.vo).join(' ');
        if (SBC.keepsScript(next, words)) {
          const byId = new Map(next.beats.map(b => [b.id, b]));
          plan.beats.forEach(b => { const n = byId.get(b.id); if (n) { const vo = b.vo; const was = JSON.stringify(b); Object.assign(b, n, { vo }); if (JSON.stringify(b) !== was) fixed += 1; } });
          if (v4(plan) && v4(next)) plan.chapters.forEach(c => { const n = next.chapters.find(x => x.id === c.id); if (n && n.headline) c.headline = n.headline; });
        }
      }
      state.critic = { pass: out.pass, score: out.score ?? null, notes: Array.isArray(out.issues) ? out.issues : (Array.isArray(out.fixes) ? out.fixes : []), fixed };
      if (fixed) rebuild();
      return { note: out.pass ? `critic passed${fixed ? ` (${fixed} fixed)` : ''}` : 'critic flagged the story' };
    } catch {
      return { skipped: true, note: '' };
    }
  }
  function teamFor(plan) {
    const t = plan.team;
    if (t && t.name) return { name: t.name, colors: t.colors || [], logo: t.logo || '' };
    return null;
  }
  function applyPlan(data, { brief = '', trend = null, go = true } = {}) {
    stop();
    const plan = ensureV4(data.plan);
    plan.beats.forEach((beat, i) => { beat.id = beat.id || `b${i + 1}-${Math.random().toString(36).slice(2, 6)}`; });
    plan.team = teamFor(plan);
    plan.style = S.STYLES[plan.style] ? plan.style : (state.style === 'auto' ? state.styleSuggested.id : state.style);
    state.selected = plan.beats[0]?.id || '';
    state.visualSrc = {};
    state.aiClipsUsed = 0;
    state.plan = plan;
    state.planSource = data.source || '';
    state.notice = data.notice || (data.source === 'draft' ? 'This is a draft built from your words. Edit the beats, or write again when AI is available.' : '');
    state.corpus = data.corpus || [brief, trend?.title].filter(Boolean).join('\n');
    sourceClaims(plan).forEach(c => { if (!state.corpus.includes(c)) state.corpus += `\n${c}`; });
    state.sources = data.sources || [];
    // A code plan (free mode, a draft, your script) has no source line: it comes from the sources it used.
    if (!plan.sourceLine) { const line = sourceLineFrom([...(trend && trend.source ? [{ source: trend.source }] : []), ...state.sources], [brief, trend && trend.title].filter(Boolean).join(' ')); if (line) plan.sourceLine = line; }
    state.brief = brief;
    state.trendRef = trend ? { id: trend.id, title: trend.title, sport: trend.sport, url: trend.url } : null;
    state.photos = {};
    state.voice = {};
    state.status = 'draft';
    state.t = 0;
    state.versions = null; state.version = 0; state.scene = -1; // ── Reels 2.0: D (interface) ──
    if (!STYLE_IDS.includes(plan.esStyle)) applyStyle(plan, state.esStyle);
    state.esStyle = plan.esStyle;
    state.review = null; state.swapOpen = ''; state.motion = {}; state.serverMotion = {}; state.critic = null;
    loadTeamLogo();
    rebuild();
    renderEdit();
    emit('plan', { source: state.planSource }); // ── Reels 2.0: D (interface) ──
    if (go) { goStep('edit', { focus: false }); fillVisuals().then(() => rebuild()); }
    if (data.issues?.length) els.writeStatus.textContent = '';
  }
  // "Source: ESPN" from a trend's outlet, a link's site or a "Source: …" line in the words. '' when none.
  function sourceLineFrom(sources = [], words = '') {
    const said = String(words || '').match(/(?:^|\n|\.\s)\s*(?:source|sources|via|per)\s*:\s*([^\n.]{2,80})/i);
    if (said) return `Source: ${said[1].trim()}`;
    const names = [];
    const host = url => { try { return new URL(url).hostname.replace(/^www\./, '').split('.').slice(-2, -1)[0]; } catch { return ''; } };
    (sources || []).forEach(s => { const n = s.source || s.outlet || (s.url ? host(s.url) : ''); if (n && !names.includes(n)) names.push(n); });
    (String(words || '').match(/https?:\/\/[^\s]+/g) || []).forEach(u => { const n = host(u); if (n && !names.includes(n)) names.push(n); });
    const pretty = n => (n.length <= 4 ? n.toUpperCase() : n[0].toUpperCase() + n.slice(1));
    return names.length ? `Source: ${names.slice(0, 3).map(pretty).join(', ')}` : '';
  }
  async function loadTeamLogo() {
    delete state.images['logo:team'];
    const logo = state.plan?.team?.logo;
    if (!logo) return;
    const img = await loadImage(logo, true);
    if (img && state.plan?.team?.logo === logo) { state.images['logo:team'] = img; draw(); }
  }

  // ─── Photos (ES image pool, like the editor's ES Image Pool search) ──────
  const photoCache = new Map();
  async function searchPhotos(query) {
    const q = String(query || '').trim().slice(0, 120);
    if (!q) return [];
    if (photoCache.has(q)) return photoCache.get(q);
    let results = [];
    let source = '';
    try {
      if (!window.ESAuth?.fetchWithAuth) throw new Error('no auth');
      const response = await window.ESAuth.fetchWithAuth(`/api/es-image-search?query=${encodeURIComponent(q)}&per_page=18`);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      results = Array.isArray(data.results) ? data.results : [];
      source = data.source || '';
    } catch {
      results = [];
    }
    const list = results.filter(r => r.proxyUrl || r.sourceUrl).map(r => ({
      id: `img:${r.id || r.sourceUrl}`, src: r.proxyUrl || r.sourceUrl, title: r.title || q, credit: r.credit || '', width: r.width, height: r.height, source,
    }));
    photoCache.set(q, list);
    return list;
  }
  function photoAsset(photo) {
    return {
      kind: 'photo', label: photo.title || 'ES photo', src: photo.src,
      rights: {
        source: photo.source === 'mcp-agency' ? 'ES image pool (agency photo)' : 'ES image pool',
        licence: 'Editorial licence via ES. Fine for organic posts; confirm social-video and paid scope before paid use.',
        credit: photo.credit || '', organic: true, paid: false,
      },
    };
  }
  async function usePhoto(beatId, photo, { quiet = false } = {}) {
    if (!photo) { if (esOn()) setVisual(beatId, [], 'paper'); else setVisual(beatId, [designAsset()], 'design'); rebuild(); renderBeats(); return; }
    state.assets[photo.id] = photoAsset(photo);
    setVisual(beatId, [photo.id], 'photo');
    if (!quiet) { rebuild(); renderBeats(); }
    if (!state.images[photo.id]) {
      const img = await loadImage(photo.src, !photo.src.startsWith('/'));
      if (img) { state.images[photo.id] = img; layoutCache = new Map(); draw(); if (!quiet) renderBeats(); } else {
        delete state.photos[beatId];
        delete state.visualSrc[beatId];
        if (!quiet) { rebuild(); renderBeats(); }
      }
    }
  }
  // ─── Visuals: the fill chain (no beat is left empty) ─────────────────────
  //   clip beats (about 80% of the time): an official X clip (Video Ads'
  //   verified search, cached 30 min) -> an AI b-roll clip for scene beats
  //   (when on, capped) -> the still chain below
  //   still beats: ES image pool (the director's query, then the team, then
  //   the league) -> the team graphic (logo on team colours) -> an AI scene
  //   (scene beats only, never people) -> the style's designed background.
  const slugOf = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  function setVisual(beatId, assetIds, source) {
    state.photos[beatId] = assetIds;
    state.visualSrc[beatId] = source;
  }
  function designAsset() {
    state.assets['design:bg'] = { kind: 'design', label: `${S.get(styleId()).label} designed background`, rights: { source: 'FrameUp renderer', licence: 'ES-owned graphic', organic: true, paid: true } };
    return 'design:bg';
  }
  function clipShare() {
    const tl = state.timeline;
    if (!tl) return { share: 0, clipMs: 0, totalMs: 0 };
    let clipMs = 0;
    tl.tracks.video.forEach(shot => { if (shot.clip) clipMs += shot.outMs - shot.inMs; });
    return { share: tl.durationMs ? clipMs / tl.durationMs : 0, clipMs, totalMs: tl.durationMs };
  }

  // Clips: one verified search per reel (team, else the story), via Video Ads.
  const CLIP_SPORTS = ['nfl', 'cfb', 'mlb'];
  async function clipPool(plan) {
    const sport = CLIP_SPORTS.includes(plan.sport) ? plan.sport : '';
    if (!sport || !state.useClips || state.config.offline || !window.ESAuth?.fetchWithAuth) return [];
    const team = plan.team?.name || '';
    const key = `${sport}|${team || plan.title}`;
    if (state.clipPoolKey === key) return state.clipPool;
    try {
      const response = await window.ESAuth.fetchWithAuth('/api/video-ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(team ? { mode: 'find-clips', sport, team } : { mode: 'find-clips', sport, query: F.trimWords(plan.title, 8) }) });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) return [];
      state.spent.clips += Number(data.cost) || 0;
      state.clipPool = (data.clips || []).filter(c => c.variants?.length);
      state.clipPoolKey = key;
      return state.clipPool;
    } catch { return []; }
  }
  // The variant to download: up to 720p on the short side, else the smallest.
  const pickVariant = variants => {
    const ok = variants.filter(v => v.url && /\.mp4(\?|$)/.test(v.url));
    const list = ok.length ? ok : variants;
    const side = v => Math.min(v.width || 0, v.height || 0) || 0;
    return [...list].sort((a, b) => (side(a) <= 720 ? 0 : 1) - (side(b) <= 720 ? 0 : 1) || side(b) - side(a))[0];
  };
  function videoFrom(src) {
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.loop = false;
      const done = ok => { clearTimeout(timer); resolve(ok ? v : null); };
      const timer = setTimeout(() => done(v.readyState >= 2), 15000);
      v.addEventListener('loadeddata', () => done(true), { once: true });
      v.addEventListener('error', () => done(false), { once: true });
      v.src = src;
    });
  }
  const clipBlobs = new Map();
  // Decodes the sound of every clip in use (once), for "Original clip audio".
  // A clip with no audio track just stays muted.
  async function clipSounds() {
    let n = 0;
    for (const [id, asset] of Object.entries(state.assets)) {
      if (asset.kind !== 'clip' || !asset.src) continue;
      const key = `clipaudio:${id}`;
      if (!(key in state.buffers)) {
        try { state.buffers[key] = await audioContext().decodeAudioData(await (await fetch(asset.src)).arrayBuffer()); } catch { state.buffers[key] = null; }
      }
      if (state.buffers[key]) n += 1;
    }
    return n;
  }
  async function addClipAsset(id, { blob, url = '', label, rights, remote = '', post = '' }) {
    let src = url;
    if (blob) src = URL.createObjectURL(blob);
    const video = await videoFrom(src);
    if (!video) return false;
    const durationMs = Math.round((video.duration || 6) * 1000);
    state.videos[id] = video;
    // A poster for the strip and thumbnails.
    try { video.currentTime = Math.min(0.5, (video.duration || 1) / 3); await new Promise(r => video.addEventListener('seeked', r, { once: true })); } catch { /* keep going */ }
    const poster = document.createElement('canvas');
    poster.width = 160; poster.height = Math.round(160 * (video.videoHeight || 9) / (video.videoWidth || 16));
    try { poster.getContext('2d').drawImage(video, 0, 0, poster.width, poster.height); state.images[id] = poster; } catch { /* no poster */ }
    // Trim: skip the first moment (team intros, black frames); the beat plays from there.
    const clipIn = durationMs > 4000 ? 0.4 : 0;
    state.assets[id] = { kind: 'clip', label, src, remote, post, durationMs, clipIn, rights };
    return true;
  }
  async function useXClip(beatId, clip, segment = null) {
    const id = await loadClip(clip);
    if (!id) return false;
    let use = id;
    // The picker's best segment for this beat (the same clip on two beats plays two different parts).
    if (segment && segment.outSec > segment.inSec) {
      use = `${id}@${Math.round(segment.inSec * 10)}`;
      state.assets[use] = { ...state.assets[id], clipIn: segment.inSec, clipOut: segment.outSec };
      state.videos[use] = state.videos[id];
      if (state.images[id]) state.images[use] = state.images[id];
    }
    setVisual(beatId, [use], 'x-clip');
    return true;
  }
  // Downloads an X clip once (browser side, no referrer) -> its asset id.
  async function loadClip(clip) {
    const variant = pickVariant(clip.variants || []);
    if (!variant) return '';
    const id = `clip:${slugOf(clip.url || variant.url).slice(-24)}`;
    if (!state.assets[id]) {
      let blob = clipBlobs.get(variant.url);
      if (!blob) {
        try {
          const response = await fetch(variant.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
          if (!response.ok) return '';
          blob = await response.blob();
          clipBlobs.set(variant.url, blob);
        } catch { return ''; }
      }
      const ok = await addClipAsset(id, {
        blob, remote: variant.url, post: clip.url, label: `Clip from @${clip.handle || 'x'}`,
        rights: { source: `Official X post (${clip.url})`, licence: 'Official team, league or network post on X. ES clears these for organic posts and Meta paid ads; keep the source link.', organic: true, paid: true, x: true, credit: clip.handle ? `@${clip.handle}` : '' },
      });
      if (!ok) return '';
    }
    return id;
  }
  // Best clip per beat (reel-clips.js): the strongest candidates are
  // downloaded and sampled here (frames + motion), a vision model rates them
  // when AI is on (capped per reel, cached per clip URL), then each beat gets
  // its best free clip and the best segment of it for the beat's length.
  const CLIPS = window.ReelClips || null;
  // Stills.
  async function teamTile(beatId, team, { key = '' } = {}) {
    if (!team || !team.name) return '';
    const entry = LOGOLIB ? LOGOLIB.findTeam(team.name, state.plan?.sport || '') : null;
    const logoSrc = entry ? LOGOLIB.srcFor(entry) : (team.logo || '');
    const slug = slugOf(team.name);
    const logoId = `logo:lib:${slug}`;
    if (logoSrc && !state.images[logoId]) {
      const img = await loadImage(logoSrc, /^https?:/.test(logoSrc));
      if (img) state.images[logoId] = img;
    }
    if (logoSrc) state.assets[logoId] = { kind: 'logo', label: `${team.name} logo`, src: logoSrc, rights: { source: entry ? 'FrameUp logo library' : 'Team mark (ESPN logo CDN)', licence: 'Editorial use of a team mark', organic: true, paid: true } };
    const id = `tile:${slug}`;
    state.assets[id] = { kind: 'tile', label: `${team.name} team graphic`, colors: (team.colors && team.colors.length ? team.colors : (entry?.colors || [])).slice(0, 2), logo: state.images[logoId] ? logoId : '', rights: { source: 'FrameUp renderer + team mark', licence: 'ES-owned graphic with an editorial team mark', organic: true, paid: true } };
    if (key) state.photos[key] = [id]; else setVisual(beatId, [id], 'tile');
    return id;
  }
  async function aiScene(beat) {
    if (!state.config.ai || state.config.offline) return '';
    try {
      const data = await api({ mode: 'scene', scene: beat.scene || 'stadium', sport: state.plan.sport, colors: state.plan.team?.colors || [] });
      state.spent.scenes += Number(data.cost) || 0;
      const img = await loadImage(data.dataUrl);
      if (!img) return '';
      const id = `scene:${data.scene}:${slugOf((state.plan.team?.colors || []).join(''))}`;
      state.images[id] = img;
      state.assets[id] = { kind: 'scene', label: `AI scene (${data.scene})`, src: '', rights: { ...data.rights, credit: 'AI-generated' } };
      setVisual(beat.id, [id], 'scene');
      return id;
    } catch { return ''; }
  }
  // Component pictures: versus headshots and tile logos.
  async function componentVisuals(beat) {
    for (const [i, v] of (beat.versus || []).entries()) {
      if (v.name === '?' || state.photos[`${beat.id}#v${i}`]) continue;
      const list = await searchPhotos(v.photo || v.name);
      const pick = list[0];
      if (pick) { state.assets[pick.id] = photoAsset(pick); const img = await loadImage(pick.src, !pick.src.startsWith('/')); if (img) { state.images[pick.id] = img; state.photos[`${beat.id}#v${i}`] = [pick.id]; } }
    }
    for (const [i, t] of (beat.tiles || []).entries()) {
      if (state.photos[`${beat.id}#t${i}`]) continue;
      const entry = LOGOLIB ? LOGOLIB.findTeam(t.name || t.team, state.plan.sport || '') : null;
      const src = entry ? LOGOLIB.srcFor(entry) : t.logo;
      if (!src) continue;
      const id = `logo:lib:${slugOf(t.name || t.team)}`;
      const img = state.images[id] || await loadImage(src, /^https?:/.test(src));
      if (!img) continue;
      state.images[id] = img;
      state.assets[id] = { kind: 'logo', label: `${t.team} logo`, src, rights: { source: entry ? 'FrameUp logo library' : 'Team mark', licence: 'Editorial use of a team mark', organic: true, paid: true } };
      state.photos[`${beat.id}#t${i}`] = [id];
      if (!t.colors?.length && entry?.colors) t.colors = entry.colors.slice(0, 2);
    }
  }
  // An AI b-roll clip (async job, polled). Shows the AI scene still while it renders.
  async function aiClip(beat, { wait = false } = {}) {
    const cfg = state.config.aiClips;
    if (!cfg?.ready || state.aiClipsUsed >= cfg.max) return false;
    if (!state.photos[beat.id]?.length) await aiScene(beat);
    let start;
    try {
      start = await api({ mode: 'ai-clip-start', scene: beat.scene || 'stadium', sport: state.plan.sport, colors: state.plan.team?.colors || [], used: state.aiClipsUsed });
    } catch (error) { toast(error.message, { tone: 'error' }); return false; }
    state.aiClipsUsed += 1;
    state.spent.clips += Number(start.cost) || 0;
    state.visualNote = { ...(state.visualNote || {}), [beat.id]: 'AI clip rendering…' };
    renderBeats();
    const poll = async () => {
      let st = start.status === 'completed' ? start : null;
      for (let i = 0; !st && i < 40; i += 1) {
        await new Promise(r => setTimeout(r, 5000));
        try { const s2 = await api({ mode: 'ai-clip-status', job: start.job, operation: start.operation }); if (s2.status !== 'pending') st = s2; } catch (error) { st = { ok: false, error: error.message }; }
      }
      delete state.visualNote[beat.id];
      if (!st || !st.ok) { toast(st?.error || 'The AI clip took too long. The scene still stays.', { tone: 'error' }); renderBeats(); return false; }
      let blob = null;
      try {
        if (st.data) blob = new Blob([b64ToBytes(st.data)], { type: st.mediaType || 'video/mp4' });
        else blob = await (await fetch(st.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' })).blob();
      } catch { blob = null; }
      const id = `aiclip:${beat.id}`;
      if (!blob || !await addClipAsset(id, { blob, label: `AI b-roll (${st.scene || beat.scene || 'scene'})`, rights: { ...st.rights, credit: 'AI-generated' } })) { toast('The AI clip could not be loaded. The scene still stays.', { tone: 'error' }); renderBeats(); return false; }
      setVisual(beat.id, [id], 'ai-clip');
      rebuild(); renderBeats();
      return true;
    };
    if (wait) return poll();
    poll();
    return true;
  }

  // ── Reels Studio v3 (UI) ── media per scene comes from the sourcing lane
  // (window.ReelSourcing, reel-sourcing.js): per-scene subjects, the relevance
  // gate, verified photos only, no random fallback. A scene with nothing
  // relevant becomes an infographic (ES paper), never a random clip.
  //   mediaFor(plan, style) -> per beat { beatId, subject, clips, photos, pick }
  //   candidates(beatId)    -> the other verified picks, for Swap
  //   review(plan)          -> { ok, issues, plan? } (see runReview)
  // Without the module (until it is merged) the Reels 2.0 chain runs, minus
  // its random "first free clip" fallback.
  const SRC = () => window.ReelSourcing || null;
  const srcOn = () => { const s = SRC(); return Boolean(s && typeof s.mediaFor === 'function'); };
  state.cands = {};
  function photoFrom(p, subject) {
    const url = typeof p === 'string' ? p : (p.proxyUrl || p.url || p.src || '');
    return { id: `img:${p.id || url}`, src: url, title: p.title || subject?.name || 'ES photo', credit: p.credit || '', width: p.width, height: p.height, source: p.source || '', focus: p.focus || null, head: p.head || null, verified: p.verified === true };
  }
  function markAsset(beatId, extra) {
    const a = state.assets[(state.photos[beatId] || [])[0]];
    if (a) Object.assign(a, extra);
  }
  async function useSourcedPhoto(beatId, p, subject) {
    const photo = photoFrom(p, subject);
    if (!photo.src) return false;
    await usePhoto(beatId, photo, { quiet: true });
    if (!(state.photos[beatId] || []).length) return false;
    markAsset(beatId, { verified: photo.verified, focus: photo.focus, head: photo.head, subject: subject || null });
    return true;
  }
  // One pick from ReelSourcing: { kind:'clip', clip, segment, relevance, gate } |
  // { kind:'photo', photo:{ url, sourceUrl, focus, head, … } } | { kind:'none', fallback:<block> }.
  // One pick from ReelSourcing (v4): { kind: 'clip'|'presser', clip, segment, relevance, gate, rung } |
  // { kind: 'photo'|'cutout', photo, kenBurns } | { kind: 'cards', cards: [{ name, photo, kenBurns }] } |
  // { kind: 'none', fallback? }. A clip that fails to load (or clips switched off) asks
  // ReelSourcing.nextCandidate for the next pick: the next confirmed clip, then a Ken Burns
  // photo, then the team photo, then the fallback module. Never plain paper while one is left.
  async function applyPick(beat, pick, subject, usedClips = new Set()) {
    const src = SRC();
    for (let tries = 0; pick && tries < 8; tries += 1) {
      const isClip = (pick.kind === 'clip' || pick.kind === 'presser') && pick.clip;
      if (isClip && state.useClips && !usedClips.has(pick.clip.url)) {
        if (await useXClip(beat.id, pick.clip, pick.segment || null)) {
          usedClips.add(pick.clip.url);
          state.visualSrc[beat.id] = 'x-clip';
          markAsset(beat.id, { verified: pick.gate === 'judge' || pick.gate === 'text' || pick.gate === 'library' || pick.clip.judged === true, gate: pick.gate || '', relevance: pick.relevance ?? null, subject: subject || null, presser: pick.kind === 'presser', rung: pick.rung || '', short: Boolean(pick.segment && pick.segment.short) });
          return 'clip';
        }
      }
      const photo = pick.photo || (pick.kind === 'cards' && Array.isArray(pick.cards) && pick.cards[0] ? pick.cards[0].photo : null);
      if (!isClip && photo && ['photo', 'cutout', 'cards'].includes(pick.kind)) {
        const kb = pick.kenBurns || (pick.cards && pick.cards[0] && pick.cards[0].kenBurns) || null;
        if (await useSourcedPhoto(beat.id, { ...photo, id: photo.sourceUrl || photo.url, verified: photo.verified !== false }, subject)) {
          markAsset(beat.id, { kenBurns: kb, checkedBy: photo.checkedBy || photo.verifiedBy || '', cards: pick.kind === 'cards' ? pick.cards : null, cutout: pick.kind === 'cutout' });
          if (pick.kind === 'cutout' || (beat.media && beat.media.kind === 'cutout')) cutoutFor(beat.id);
          state.visualSrc[beat.id] = 'photo';
          return 'photo';
        }
      }
      if (pick.kind === 'none') break;
      // This pick could not be used (it did not load, or clips are off): the next one.
      const next = src && typeof src.nextCandidate === 'function' ? src.nextCandidate(beat.id, { failed: (pick.clip && pick.clip.url) || (photo && photo.url) || '' }) : null;
      if (!next || next === pick) { pick = null; break; }
      pick = next;
    }
    // Nothing that moves is left: the module the sourcing proposes (v3: an infographic block).
    if (pick && pick.kind === 'none' && pick.fallback && typeof pick.fallback === 'object' && pick.fallback.type) {
      beat.block = { ...pick.fallback };
      if (ES && ES.BLOCKS[pick.fallback.type]) { try { Object.assign(beat, ES.legacyFields(ES.cleanBlock({ ...pick.fallback }))); } catch { /* the engine draws it */ } }
    }
    setVisual(beat.id, [], 'paper');
    return 'none';
  }
  // A scene that asks for a photo or a cut-out gets the first verified photo the
  // sourcing found for it when the pick itself came back empty (never paper while
  // a checked photo of the subject exists).
  function stillPick(beat, row) {
    const pick = row && row.pick;
    const kind = beat && beat.media && beat.media.kind;
    if (!(pick && pick.kind === 'none' && ['photo', 'cutout'].includes(kind))) return pick;
    const fromCands = (row.candidates || []).find(c => c && c.kind === 'photo' && c.photo && c.photo.verified === true);
    const photo = fromCands ? fromCands.photo : (row.photos || []).find(p => p && p.verified === true && p.url);
    if (!photo) return pick;
    const C = window.ReelClips;
    return { kind, photo, kenBurns: C && typeof C.kenBurnsFor === 'function' ? C.kenBurnsFor(photo) : null, ...(kind === 'cutout' ? { cutout: true } : {}), why: 'verified photo for a scene with no pick' };
  }
  // A cut-out scene: the plain-backdrop cut when the photo has one, else the
  // whole photo stands in (the engine draws state.cutouts[asset]).
  function cutoutFor(beatId) {
    const id = (state.photos[beatId] || [])[0];
    const img = id && state.images[id];
    if (!img || state.cutouts[id]) return;
    let cut = null;
    if (CUT && typeof CUT.plainBackdropMask === 'function') {
      try {
        const c = document.createElement('canvas');
        const k = Math.min(1, 1200 / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
        c.width = Math.round((img.naturalWidth || img.width) * k); c.height = Math.round((img.naturalHeight || img.height) * k);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, c.width, c.height);
        const px = g.getImageData(0, 0, c.width, c.height);
        const mask = CUT.plainBackdropMask(px.data, c.width, c.height);
        if (mask && mask.ok) { for (let i = 0; i < mask.alpha.length; i += 1) px.data[i * 4 + 3] = Math.min(px.data[i * 4 + 3], mask.alpha[i]); g.putImageData(px, 0, 0); cut = c; }
      } catch { /* a cross-site photo cannot be read: the whole photo stands in */ }
    }
    state.cutouts[id] = cut || img;
  }
  // The clip loader ReelSourcing uses to sample clips for the judge (shares this page's cache).
  async function sourcingVideo(clip) { const id = await loadClip(clip).catch(() => ''); return id ? state.videos[id] || null : null; }
  // The page's API for ReelSourcing, keeping scene-media's per-beat verdict (motionOk, motionWhy) from the server.
  let broadenRun = false;
  async function sourcingApi(body) {
    const data = await api(body && body.mode === 'scene-media' && broadenRun ? { ...body, broaden: true, ladder: 'broad', findClips: true } : body);
    if (body && body.mode === 'scene-media' && data && Array.isArray(data.beats)) {
      const seen = {};
      data.beats.forEach(b => { if (b && b.beatId && typeof b.motionOk === 'boolean') seen[b.beatId] = { motionOk: b.motionOk, why: b.motionWhy || '' }; });
      state.serverMotion = { ...(state.serverMotion || {}), ...seen };
    }
    return data;
  }
  async function fillFromSourcing(plan, beats, { force = false, broaden = false } = {}) {
    broadenRun = Boolean(broaden);
    try { return await fillFromSourcingRun(plan, beats, { force, broaden }); } finally { broadenRun = false; }
  }
  async function fillFromSourcingRun(plan, beats, { force = false, broaden = false } = {}) {
    for (const beat of beats) { if (state.plan !== plan) return { note: '' }; await componentVisuals(beat).catch(() => {}); }
    const todo = beats.filter(b => b.kind !== 'cta' && (force || !state.photos[b.id]?.length));
    if (!todo.length) return { note: 'Nothing new needed' };
    const durations = {};
    (state.timeline ? state.timeline.beats : []).forEach(b => { durations[b.id] = b.outMs - b.inMs; });
    const usedList = plan.beats.filter(b => !todo.includes(b)).flatMap(b => state.photos[b.id] || []).map(id => state.assets[id]?.post).filter(Boolean);
    const out = await SRC().mediaFor(plan, curStyle(), { loadVideo: sourcingVideo, durations, usedClips: usedList, ai: aiOn(), api: sourcingApi, ...(broaden ? { broaden: true, ladder: 'broad' } : {}), onProgress: text => { if (text && els.makingLive) els.makingLive.textContent = text; } }).catch(() => null);
    if (state.plan !== plan) return { note: '' };
    if (out && Number(out.cost)) state.spent.clips += Number(out.cost);
    const rows = (out && out.beats) || {};
    // v4 sourcing: per scene motionOk (clip, Ken Burns photo, or a module that animates) and the reel's clip count.
    Object.entries(rows).forEach(([id, row]) => { if (row && typeof row.motionOk === 'boolean') state.motion = { ...(state.motion || {}), [id]: { motionOk: row.motionOk } }; });
    if (out && typeof out.clipCount === 'number') state.sourcing = { clipCount: out.clipCount, needsClips: Boolean(out.needsClips), motionOk: out.motionOk !== false, actions: Array.isArray(out.actions) ? out.actions : [], stats: out.stats || null };
    const usedClips = new Set(usedList);
    const n = { clip: 0, photo: 0, none: 0 };
    for (const [i, beat] of todo.entries()) {
      if (state.plan !== plan) return { note: '' };
      const row = rows[beat.id];
      if (row) state.cands[beat.id] = { subject: row.subject || null };
      n[await applyPick(beat, row ? stillPick(beat, row) : null, row && row.subject, usedClips)] += 1;
      if (i % 2 === 1) { rebuild(); renderBeats(); }
    }
    rebuild();
    renderBeats();
    if (out && (out.notes || []).length) state.sourcingNotes = out.notes.slice(0, 3);
    const bits = [n.clip ? `${n.clip} clip${n.clip > 1 ? 's' : ''}` : '', n.photo ? `${n.photo} photo${n.photo > 1 ? 's' : ''}` : '', n.none ? `${n.none} infographic${n.none > 1 ? 's' : ''}` : ''].filter(Boolean);
    return { note: bits.length ? `${bits.join(' · ')}, all checked` : 'Nothing new needed', share: clipShare().share };
  }

  // Swap: the other verified picks for a scene (clips and photos).
  // Candidates in one shape: { kind, key, thumb, label, by, verified, data } (data = what ReelSourcing.choose takes).
  function candList(out) {
    const rows = Array.isArray(out) ? out : [...((out && out.clips) || []).map(c => ({ kind: 'clip', clip: c })), ...((out && out.photos) || []).map(p => ({ kind: 'photo', photo: p }))];
    return rows.filter(Boolean).map(c => {
      if (c.kind === 'clip' && c.clip) { const k = c.clip; return { kind: 'clip', key: k.url, thumb: k.thumb || k.thumbnail || '', label: k.text || (k.handle ? `@${k.handle}` : 'Official clip'), by: k.handle ? `@${k.handle}` : '', verified: c.gate === 'judge' || c.gate === 'text' || k.judged === true, data: c }; }
      const ph = c.photo || c;
      const url = ph.proxyUrl || ph.url || ph.src || '';
      return { kind: 'photo', key: url, thumb: url, label: ph.title || 'ES photo', by: ph.credit || '', verified: ph.verified === true, data: { kind: 'photo', photo: ph } };
    }).filter(c => c.key && (c.kind === 'photo' ? c.verified || !srcOn() : true));
  }
  async function swapCandidates(beatId) {
    const beat = state.plan && state.plan.beats.find(b => b.id === beatId);
    if (!beat) return [];
    let list = [];
    const src = SRC();
    if (src && typeof src.candidates === 'function') {
      try { list = candList(await src.candidates(beatId)); } catch { list = []; }
    }
    if (!list.length && !srcOn()) list = await legacyCandidates(beat);
    return list.slice(0, 12);
  }
  // Until the sourcing lane lands: the reel's clip pool ranked for this scene
  // (no random fill) and the ES image pool, both marked "not checked".
  async function legacyCandidates(beat) {
    const pool = await clipPool(state.plan).catch(() => []);
    const subject = CLIPS ? CLIPS.subjectFor(beat, state.plan) : null;
    const clips = CLIPS && subject ? pool.map(c => ({ c, s: CLIPS.heuristicScore(c, subject).score })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 6).map(x => x.c) : [];
    const photos = await searchPhotos(beat.photo || state.plan.team?.name || '').catch(() => []);
    return [...candList({ clips }), ...photos.slice(0, 6).map(p => ({ kind: 'photo', key: p.src, thumb: p.src, label: p.title, by: p.credit, verified: false, data: { kind: 'photo', photo: { ...p, url: p.src } } }))];
  }
  // The key of what a scene shows now (marks the picked candidate).
  function mediaKey(beatId) {
    const a = state.assets[(state.photos[beatId] || [])[0]];
    return a ? (a.post || a.src || '') : '';
  }
  async function useCandidate(beatId, cand) {
    if (!cand || !state.plan) return false;
    state.visualNote = { ...(state.visualNote || {}), [beatId]: 'Swapping…' };
    renderBeats();
    let ok = false;
    const was = mediaKey(beatId);
    try {
      const subject = state.cands[beatId]?.subject || null;
      const beat = state.plan.beats.find(x => x.id === beatId);
      const pick = cand.kind === 'clip' ? { kind: 'clip', clip: cand.data.clip, segment: cand.data.segment || null, relevance: cand.data.relevance, gate: cand.data.gate || (cand.verified ? 'judge' : '') } : { kind: 'photo', photo: { ...cand.data.photo, verified: cand.verified } };
      ok = Boolean(beat) && (await applyPick(beat, pick, subject)) !== 'none';
      if (ok) { SRC()?.choose?.(beatId, cand.data); feedback('swap_media', { beatId, before: { key: was }, after: { key: cand.key, kind: cand.kind } }); }
      if (!ok) toast(cand.kind === 'clip' ? 'That clip did not load. Try another.' : 'That photo did not load. Try another.', { tone: 'error' });
    } finally {
      delete state.visualNote[beatId];
      motionRecheck();
      rebuild();
      renderBeats();
      renderSceneEditor();
      logEvent('visuals', { action: 'swap', kind: cand.kind, verified: Boolean(cand.verified) });
    }
    return ok;
  }
  // No picture: the scene becomes an infographic on ES paper.
  function useNoMedia(beatId) {
    setVisual(beatId, [], 'paper');
    rebuild();
    renderBeats();
    renderSceneEditor();
    logEvent('visuals', { action: 'none' });
  }
  function renderSceneEditor() { mods().storyboard?.editor?.(); }

  async function fillVisuals({ only = null, force = false, broaden = false } = {}) {
    const plan = state.plan;
    if (!plan) return { note: '' };
    if (!state.timeline) rebuild();
    // ES: media only on the blocks that take it; the rest sit on ES paper.
    const beats = plan.beats.filter(b => (!only || only.includes(b.id)) && takesMediaOf(b));
    if (srcOn() && !(F.isDataFormat && F.isDataFormat(plan.format))) return fillFromSourcing(plan, beats, { force, broaden });
    return legacyFill(plan, beats, { force });
  }
  // Data formats (Game Swing plays keep their matched clip) and the page
  // without ReelSourcing: verified-sourcing first for every other scene,
  // the ES image pool / team graphic chain only when the module is missing.
  async function legacyFill(plan, beats, { force = false } = {}) {
    const usedClips = new Set(plan.beats.flatMap(b => state.photos[b.id] || []).map(id => state.assets[id]?.post).filter(Boolean));
    const swingPlay = b => plan.format === 'gameswing' && b.kind === 'play';
    const rest = [];
    let n = 0;
    for (const beat of beats) {
      if (state.plan !== plan) return { note: '' };
      await componentVisuals(beat).catch(() => {});
      if (!force && state.photos[beat.id]?.length) continue;
      if (beat.kind === 'cta') { setVisual(beat.id, [designAsset()], 'design'); continue; }
      let done = false;
      if (swingPlay(beat)) {
        const m = state.useClips && beat.clip?.url ? state.clipMatches.find(c => c.url === beat.clip.url) : null;
        if (m && !usedClips.has(m.url)) { usedClips.add(m.url); done = await useXClip(beat.id, m); }
      }
      if (done) continue;
      if (srcOn()) { rest.push(beat); continue; }
      // No sourcing module: the scene stays an infographic (never an unchecked photo).
      setVisual(beat.id, [], 'paper');
      n += 1;
      if (n % 2 === 0) { rebuild(); renderBeats(); }
    }
    if (rest.length) await fillFromSourcing(plan, rest, { force: true });
    rebuild();
    renderBeats();
    const share = clipShare();
    const empty = plan.beats.filter(b => b.kind !== 'cta' && !(state.photos[b.id] || []).length).length;
    return { note: `${Math.round(share.share * 100)}% clips${empty ? ` · ${empty} infographic${empty > 1 ? 's' : ''}` : ''}`, share: share.share };
  }

  // Cut-out player for styles that stand one over the frame (hook beat):
  // a free plain-backdrop cut first; the AI "Remove background" on request.
  async function autoCutout({ ai = false } = {}) {
    const plan = state.plan;
    const beat = plan?.beats[0];
    if (!beat || !CUT || !S.get(styleId()).cutout) return false;
    const key = `${beat.id}#cut`;
    if (state.photos[key] && state.cutouts[state.photos[key][0]] && !ai) return true;
    const list = await searchPhotos(beat.photo || plan.team?.name || '');
    for (const photo of list.slice(0, ai ? 1 : 4)) {
      const img = state.images[photo.id] || await loadImage(photo.src, !photo.src.startsWith('/'));
      if (!img) continue;
      try {
        let cut = null;
        if (ai) {
          const session = await window.ESAuth?.getSession?.();
          const out = await CUT.removeWithModel(img, session?.token);
          if (out.ok) cut = out.image;
          else { toast('That photo could not be cut out cleanly. The framed photo stays.', { tone: 'error' }); return false; }
        } else {
          const c = document.createElement('canvas');
          const k = Math.min(1, 1200 / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
          c.width = Math.round((img.naturalWidth || img.width) * k); c.height = Math.round((img.naturalHeight || img.height) * k);
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0, c.width, c.height);
          const px = g.getImageData(0, 0, c.width, c.height);
          const mask = CUT.plainBackdropMask(px.data, c.width, c.height);
          if (!mask.ok) continue;
          for (let i = 0; i < mask.alpha.length; i += 1) px.data[i * 4 + 3] = Math.min(px.data[i * 4 + 3], mask.alpha[i]);
          g.putImageData(px, 0, 0);
          cut = c;
        }
        state.images[photo.id] = img;
        state.assets[photo.id] = photoAsset(photo);
        state.cutouts[photo.id] = cut;
        state.photos[key] = [photo.id];
        rebuild();
        renderBeats();
        return true;
      } catch { /* cross-site photo or no mask: keep the framed photo */ }
    }
    return false;
  }

  // Per-beat visual actions (Review).
  async function visualAction(beatId, action) {
    const beat = state.plan.beats.find(b => b.id === beatId);
    if (!beat) return;
    state.visualNote = { ...(state.visualNote || {}), [beatId]: 'Working…' };
    renderBeats();
    try {
      if (action === 'swap-clip' || action === 'swap') {
        // Swap opens the scene's candidates in the panel (verified picks only).
        delete state.visualNote[beatId];
        state.swapOpen = beatId;
        selectBeat(beatId, { seek: true });
        renderSceneEditor();
        els.sceneEdit.querySelector('[data-swap-list] button, [data-swap-list]')?.focus({ preventScroll: true });
        return;
      } else if (action === 'ai-clip') {
        if (!await aiClip({ ...beat, scene: beat.scene || 'stadium' })) toast(state.config.aiClips?.ready ? `This reel already has ${state.config.aiClips.max} AI clips.` : 'AI b-roll is off for now.', { tone: 'error' });
      } else if (action === 'photo') {
        delete state.visualNote[beatId];
        openPhotos(beatId);
        return;
      } else if (action === 'tile') {
        if (!await teamTile(beatId, state.plan.team)) toast('This reel has no team for a team graphic.', { tone: 'error' });
      } else if (action === 'scene') {
        if (!await aiScene({ ...beat, scene: beat.scene || 'stadium' })) toast('The AI scene could not be made right now.', { tone: 'error' });
      } else if (action === 'upload') {
        uploadTarget = beatId;
        delete state.visualNote[beatId];
        els.visualFile.click();
        return;
      } else if (action === 'cutout') {
        await autoCutout({ ai: true });
      } else if (action === 'design' || action === 'none') {
        if (esOn()) setVisual(beatId, [], 'paper'); else setVisual(beatId, [designAsset()], 'design');
      }
    } finally {
      delete state.visualNote[beatId];
      rebuild();
      renderBeats();
      logEvent('visuals', { action, source: state.visualSrc[beatId] || '' });
    }
  }
  let uploadTarget = '';
  els.visualFile.addEventListener('change', async () => {
    const file = els.visualFile.files[0];
    els.visualFile.value = '';
    if (!file || !uploadTarget) return;
    // ── Reels 2.0: C (inputs) ── the media tray takes every upload (validation, persistence, Undo).
    if (window.ReelMakerCtx?.modules.tray) { window.ReelMakerCtx.modules.tray.addFiles([file], { beatId: uploadTarget, via: 'beat' }); return; }
    if (file.size > 120 * 1024 * 1024) { toast('That file is too large (120 MB at most).', { tone: 'error' }); return; }
    const rights = { source: 'Uploaded by you', licence: 'You confirmed ES may use it', organic: true, paid: true, credit: '' };
    const id = `up:${Date.now().toString(36)}`;
    if (file.type.startsWith('video/')) {
      if (await addClipAsset(id, { blob: file, label: `Your clip: ${file.name.slice(0, 40)}`, rights })) setVisual(uploadTarget, [id], 'upload-clip');
      else toast('That clip could not be read. Try an MP4.', { tone: 'error' });
    } else {
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      if (!img) { toast('That image could not be read.', { tone: 'error' }); return; }
      state.images[id] = img;
      state.assets[id] = { kind: 'upload', label: `Your image: ${file.name.slice(0, 40)}`, src: url, rights };
      setVisual(uploadTarget, [id], 'upload');
    }
    rebuild();
    renderBeats();
  });

  let photoTarget = null;
  async function openPhotos(beatId) {
    photoTarget = beatId;
    const beat = state.plan.beats.find(b => b.id === beatId);
    els.photosQ.value = beat?.photo || state.plan.team?.name || '';
    els.photosNone.textContent = esOn() ? 'No photo: use ES paper' : 'Use the designed background';
    els.photos.showModal();
    els.photosQ.focus();
    runPhotoSearch();
  }
  async function runPhotoSearch() {
    els.photosGrid.innerHTML = Array.from({ length: 6 }, () => '<li><span class="es-skeleton rm-photo-sk"></span></li>').join('');
    const list = await searchPhotos(els.photosQ.value);
    if (!list.length) {
      els.photosGrid.innerHTML = '<li class="es-empty rm-photos__empty"><p class="es-empty__title">No photos found</p><p class="es-empty__copy">Try a full name or a team name.</p></li>';
      return;
    }
    els.photosGrid.innerHTML = list.map((p, i) => `<li><button class="rm-photo" type="button" data-photo-i="${i}" aria-label="${esc(p.title)}"><img src="${esc(p.src)}" alt="" loading="lazy"></button></li>`).join('');
    els.photosGrid.dataset.query = els.photosQ.value;
  }
  els.photosForm.addEventListener('submit', event => { event.preventDefault(); runPhotoSearch(); });
  els.photosGrid.addEventListener('click', event => {
    const btn = event.target.closest('[data-photo-i]');
    if (!btn) return;
    const list = photoCache.get(els.photosGrid.dataset.query) || [];
    const photo = list[Number(btn.dataset.photoI)];
    const beat = state.plan.beats.find(b => b.id === photoTarget);
    if (beat) beat.photo = els.photosQ.value.trim().slice(0, 60);
    els.photos.close();
    usePhoto(photoTarget, photo);
    logEvent('edit', { what: 'photo' });
  });
  els.photosNone.addEventListener('click', () => { els.photos.close(); usePhoto(photoTarget, null); });
  els.photos.addEventListener('close', () => { if (state.plan) { renderBeats(); } });

  // ─── Timeline + lint ─────────────────────────────────────────────────────
  function voiceFor() {
    // Only clips whose text (and voice) still match the beat's VO line are used.
    const out = {};
    if (!state.voiceOn) return out;
    const own = ownVoice();
    (state.plan?.beats || []).forEach(beat => {
      const v = state.voice[beat.id];
      // ── Reels 2.0: C (inputs) ── the person's own recording stays on its scene; if they
      // changed the words after recording, the captions pace evenly over the same audio.
      if (v && v.own) { if (own) out[beat.id] = v.text === beat.vo ? v : { ...v, words: [] }; return; }
      if (v && v.text === beat.vo && v.voiceId === state.voiceId) out[beat.id] = v;
    });
    return out;
  }
  function buildOptions(extra = {}) {
    const voice = voiceFor();
    // ── Reels 2.0: C (inputs) ── a person's own recording counts as a voiced reel (the renderer knows 'gateway' / 'elevenlabs' / 'off').
    const voiceMode = Object.keys(voice).length ? (ownVoice() && !['elevenlabs', 'gateway'].includes(state.config.voice.mode) ? 'gateway' : state.config.voice.mode) : 'off';
    return {
      style: styleId(), look: lookId(), esStyle: curStyle(), voice, photos: state.photos, assets: { ...state.assets }, team: state.plan.team, captionStyle: state.captionStyle,
      voiceMode, music: state.music ? { asset: 'music' } : null, sources: state.sources, corpus: state.corpus,
      // Clip sound is muted unless "Original clip audio" is on (then only clips that have a sound track).
      clipAudio: state.clipAudio ? Object.keys(state.buffers).filter(k => k.startsWith('clipaudio:') && state.buffers[k]).map(k => k.slice(10)) : false,
      ...dataBuildOptions(),
      // ── Reels 2.0: D (interface) ── the preview is the size that exports (ES 9:16 or its 4:5 feed version).
      ...(esOn() && state.aspect === '4:5' ? { aspect: '4:5' } : {}),
      ...extra,
    };
  }
  function rebuild() {
    if (!state.plan) return;
    state.timeline = R.buildTimeline(state.plan, buildOptions());
    // Data formats: timeline v2 fields (data, replay, outputs); the lint reads
    // the data's facts as a source. News reels are built exactly as before.
    const facts = G && TL ? dataFacts() : '';
    if (G && TL) dataTimeline(state.timeline);
    layoutCache = new Map();
    captionCache = new Map();
    state.lint = L.lintTimeline(state.timeline, { boxes: R.textBoxes(measure, state.timeline), measure, target: state.target, extraSources: facts ? [els.extraSource.value, facts].filter(Boolean).join('\n') : els.extraSource.value });
    // A script reel keeps the person's words: say so if an edit changed them.
    if (scriptLocked() && ES && !ES.voMatchesScript(state.plan)) state.lint.issues.push({ id: 'script', severity: 'info', message: 'The voiceover lines no longer match your original script word for word.', fix: 'That is fine if you edited them yourself.', beat: '' });
    // ── Reels 2.0: D (interface) ── captions are always on: a voiced scene with no caption words is an error.
    if (A11Y) A11Y.captionGaps(state.timeline).forEach(id => {
      const n = state.plan.beats.findIndex(b => b.id === id) + 1;
      state.lint.issues.push({ id: 'captions', severity: 'critical', message: `Scene ${n} has a voiceover but no captions.`, fix: 'Every spoken word shows on screen. Edit the line, or make the voiceover again.', beat: id });
      state.lint.critical = (state.lint.critical || 0) + 1;
      state.lint.ok = false;
    });
    state.mix = null;
    // A clip added while "Original clip audio" is on gets its sound decoded, then the mix is rebuilt.
    if (state.clipAudio && Object.entries(state.assets).some(([id, a]) => a.kind === 'clip' && a.src && !(`clipaudio:${id}` in state.buffers))) clipSounds().then(n => { if (n) rebuild(); });
    els.emptyStage.hidden = true;
    els.play.disabled = false;
    els.scrub.disabled = false;
    state.t = Math.min(state.t, state.timeline.durationMs - 1);
    syncCanvasSize();
    els.work.classList.add('has-reel');
    renderLint();
    renderMeta();
    renderCost();
    renderStrip();
    if (state.step === 'export') renderExport();
    draw();
    autosave();
    window.ReelMakerCtx?.emit('rebuild', {}); // ── Reels 2.0: C (inputs) ──
  }
  const rebuildSoon = debounce(rebuild, 220);
  // Extra buildTimeline options for a data format (the v2 canvas and data
  // for the renderer; ignored by a renderer that does not read them yet).
  function dataBuildOptions() {
    const fmt = G && TL && state.plan && F.isDataFormat(state.plan.format) ? state.plan.format : '';
    if (!fmt) return {};
    return { canvas: { w: 1080, h: 1920 }, outputs: F.FORMATS[fmt].outputs.slice(), data: { game: fmt === 'gameswing' ? state.data.game : null, athlete: fmt === 'archive' ? state.data.athlete : null, archive: fmt === 'archive' ? state.data.archive : null }, replay: fmt === 'replay' ? state.replay : null, ...(Array.isArray(state.plan.slides) ? { slides: state.plan.slides } : {}) };
  }

  // ── Reels 2.0: D (interface) ── the preview canvas is the timeline's size (1080×1920, or 1080×1350 for 4:5).
  function syncCanvasSize() {
    if (state.view === 'carousel') return;
    const h = (state.timeline && state.timeline.size && state.timeline.size[1]) || 1920;
    if (els.canvas.height !== h) els.canvas.height = h;
    els.device.classList.toggle('is-45', h === 1350);
    const geo = ES && h !== 1920 ? ES.geometry([1080, h]) : null;
    els.safe.style.top = geo ? `${(geo.safe.top / h * 100).toFixed(2)}%` : '';
    els.safe.style.bottom = geo ? `${((h - geo.safe.bottom) / h * 100).toFixed(2)}%` : '';
  }
  function renderMeta() {
    const tl = state.timeline;
    if (!tl) return;
    const sec = tl.durationMs / 1000;
    els.beatsMeta.textContent = `${tl.beats.length} scenes · ${sec.toFixed(0)} s`;
    els.stageMeta.textContent = `${F.FORMATS[tl.format].label} · ${sec.toFixed(1)} s · ${(tl.size || [1080, 1920]).join('×')}${tl.timing && tl.timing.estimate ? ' · times estimated' : ''}`;
    els.time.textContent = `${fmtTime(state.t)} / ${fmtTime(tl.durationMs)}`;
    // Review v4: a tick on the scrubber at every chapter (v4) or scene (v3) start.
    if (els.ticks) {
      const starts = chapterStarts(tl);
      els.ticks.innerHTML = starts.map(x => `<i class="rm-tick${x.chapter ? ' is-chapter' : ''}" style="left:${(x.ms / tl.durationMs * 100).toFixed(2)}%"></i>`).join('');
    }
    if (els.sizeText) { els.sizeText.textContent = state.aspect; els.size.setAttribute('aria-label', `Preview size: ${state.aspect === '4:5' ? 'Feed 4:5' : 'Reel 9:16'}. Switch to ${state.aspect === '4:5' ? 'Reel 9:16' : 'Feed 4:5'}`); els.size.hidden = els.aspectSec.hidden; }
    // Beat times in the list.
    els.beats.querySelectorAll('[data-beat]').forEach(li => {
      const b = tl.beats.find(x => x.id === li.dataset.beat);
      const time = li.querySelector('.rm-beat__time');
      if (b && time) time.textContent = `${fmtTime(b.inMs)}–${fmtTime(b.outMs)}`;
    });
  }

  // Scrubber ticks: where each chapter starts (v4 plan), else each scene after the first.
  function chapterStarts(tl) {
    const plan = state.plan;
    const SB = window.ReelStoryboardCore;
    if (plan && Array.isArray(plan.chapters) && plan.chapters.length && SB) {
      return SB.chaptersOf(plan).slice(1).map(g => { const b = tl.beats.find(x => x.id === (g.beats[0] && g.beats[0].id)); return b ? { ms: b.inMs, chapter: true } : null; }).filter(Boolean);
    }
    return tl.beats.slice(1).map(b => ({ ms: b.inMs, chapter: false }));
  }
  // ── Review v4: honest readiness ── every scene moves (a confirmed clip, a
  // verified photo with Ken Burns, or a data block that builds), the reel has
  // at least one confirmed clip, and a free draft says it is a draft.
  function beatMotion(beat) {
    const SB = window.ReelStoryboardCore;
    if (!SB || !beat) return { ok: true, why: '' };
    if (ES && ES.blockOf(beat).type === 'endcard') return { ok: true, why: 'end' };
    // A scene is static when ANY check says so: the engine's per-beat moves flag,
    // the sourcing (browser or the server's own verdict) with no clip or photo of
    // the page's own on it, or the v4 lint's static-beat. Otherwise it moves when
    // the engine / lint says so, or it has a confirmed clip or a checked photo.
    // "Has a module" alone never counts as moving.
    const tb = state.timeline && Array.isArray(state.timeline.beats) ? state.timeline.beats.find(x => x.id === beat.id) : null;
    if (tb && tb.moves === false) return { ok: false, why: 'static' };
    const a = state.assets[(state.photos[beat.id] || [])[0]];
    const media = a ? (a.kind === 'clip' ? 'clip' : ((a.verified || a.kind === 'upload') ? 'photo' : '')) : '';
    const row = state.motion && state.motion[beat.id];
    const srv = state.serverMotion && state.serverMotion[beat.id];
    // The sourcing (browser or server) found nothing that moves for this scene, and the page has no clip or photo on it.
    if (!media && ((row && row.motionOk === false) || (srv && srv.motionOk === false))) return { ok: false, why: 'static' };
    const v4tl = Boolean(state.timeline && (state.timeline.v === 4 || Array.isArray(state.timeline.layers)));
    if (v4tl && state.lint && state.lint.issues.some(i => i.id === 'static-beat' && i.beat === beat.id)) return { ok: false, why: 'static' };
    if (tb && tb.moves === true) return { ok: true, why: media || 'engine' };
    if (v4tl && state.lint) return { ok: true, why: media || 'lint' };
    if (media) return { ok: true, why: media };
    // A v3 data block counts up, fills or grows on the v3 engine; a v4 module waits for the engine's word.
    return SB.motionOf({ media: '', block: !v4Beat(beat) && ES ? ES.blockOf(beat).type : '' });
  }
  // Exported clips rank up in the confirmed library (a Swap ranks the old one down by itself).
  function rankKept() {
    const src = SRC();
    if (!src || typeof src.rank !== 'function' || !state.plan) return;
    state.plan.beats.forEach(b => { const a = state.assets[(state.photos[b.id] || [])[0]]; if (a && a.kind === 'clip' && a.post) { try { src.rank(a.post, +1, { beatId: b.id }); } catch { /* fire and forget */ } } });
  }
  // After an edit or a swap: the sourcing's own motion re-check (pure, no network).
  function motionRecheck() {
    const src = SRC();
    if (!src || typeof src.motionCheck !== 'function' || !state.plan) return;
    try {
      const mc = src.motionCheck(state.plan, typeof src.picksFor === 'function' ? src.picksFor(state.plan) : undefined);
      if (mc && mc.beats) state.motion = Object.fromEntries(Object.entries(mc.beats).map(([id, m]) => [id, { motionOk: Boolean(m && m.motionOk) }]));
    } catch { /* the page's own check stands */ }
  }
  const clipCount = () => (state.plan ? state.plan.beats.filter(b => { const a = state.assets[(state.photos[b.id] || [])[0]]; return a && a.kind === 'clip'; }).length : 0);
  function readyNow(critical, warnings) {
    const SB = window.ReelStoryboardCore;
    const gated = esOn() && Boolean(SB);
    if (!SB) return null;
    return SB.readiness({ draft: state.planSource === 'draft', beats: (state.plan ? state.plan.beats : []).map(b => ({ id: b.id, ...beatMotion(b) })), clipCount: clipCount(), critic: state.critic || null, critical, warnings, gated });
  }
  // The sourcing's next steps under the checklist: Find clips (the broader ladder),
  // Swap media for a static scene, and AI b-roll with its price (offered, never run by itself).
  function renderActions(rd) {
    let host = $('rm-actions');
    if (!host) { host = document.createElement('div'); host.id = 'rm-actions'; host.className = 'rm-actions'; els.checklist.after(host); }
    const acts = (state.sourcing && state.sourcing.actions) || [];
    const n = id => (state.plan ? state.plan.beats.findIndex(b => b.id === id) + 1 : 0);
    const still = state.plan ? state.plan.beats.filter(b => !beatMotion(b).ok) : [];
    const list = [];
    if (rd && rd.needsClips) list.push(`<button class="es-btn es-btn--sm" type="button" data-find-clips>${ICON.film}<span>Find clips</span></button>`);
    const swaps = new Set([...acts.filter(a => a.action === 'swap-media').map(a => a.beatId), ...still.map(b => b.id)]);
    [...swaps].filter(id => n(id) > 0).slice(0, 4).forEach(id => list.push(`<button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-goto-swap="${esc(id)}">${ICON.refresh}<span>Swap media · scene ${n(id)}</span></button>`));
    if (state.config.aiClips?.ready) acts.filter(a => a.action === 'ai-broll' && n(a.beatId) > 0).slice(0, 2).forEach(a => list.push(`<button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-broll="${esc(a.beatId)}">${ICON.sparkles}<span>AI b-roll · scene ${n(a.beatId)}${Number(a.costUsd) ? ` · $${Number(a.costUsd).toFixed(2)}` : ''}</span></button>`));
    host.hidden = !list.length;
    host.innerHTML = list.length ? `<span class="rm-bf__label">Next steps</span><div class="rm-actions__row">${list.join('')}</div>` : '';
  }
  els.lint.addEventListener('click', event => {
    const br = event.target.closest('[data-broll]');
    if (br) { visualAction(br.dataset.broll, 'ai-clip'); return; }
    const sw = event.target.closest('[data-goto-swap]');
    if (sw) visualAction(sw.dataset.gotoSwap, 'swap');
  });
  // "Find clips": the sourcing again for every scene without a clip, on the broader ladder (player → game → team).
  async function findClips() {
    if (!state.plan || state.busy) return;
    state.busy = 'clips';
    const btns = [...document.querySelectorAll('[data-find-clips]')];
    btns.forEach(b => { b.disabled = true; b.querySelector('span') && (b.querySelector('span').textContent = 'Finding clips…'); });
    const before = clipCount();
    try {
      const only = state.plan.beats.filter(b => { const a = state.assets[(state.photos[b.id] || [])[0]]; return !(a && a.kind === 'clip') && takesMediaOf(b); }).map(b => b.id);
      await fillVisuals({ only, force: true, broaden: true });
      const found = clipCount() - before;
      toast(found > 0 ? `${found} clip${found > 1 ? 's' : ''} found and checked.` : 'No confirmed clip yet. Try a different angle in your words, or upload a clip.', { tone: found > 0 ? '' : 'error' });
      feedback('find_clips', { before: { clips: before }, after: { clips: clipCount() } });
    } finally {
      state.busy = '';
      rebuild();
      renderBeats();
    }
  }
  document.addEventListener('click', event => { if (event.target.closest('[data-find-clips]')) findClips(); });
  // ── Reels Studio v3 (UI) ── the checks are one "Ready to post" badge that
  // expands to the checklist: the ES checks, the AI review and every issue.
  const REVIEW_KIND = { media: 'Picture', fact: 'Fact', text: 'Words', brand: 'Brand' };
  function renderLint() {
    const lint = state.lint;
    if (!lint) return;
    const sevIcon = { critical: ICON.alert, warning: ICON.warn, info: ICON.info };
    const order = { critical: 0, warning: 1, info: 2 };
    const list = [...lint.issues].sort((a, b) => order[a.severity] - order[b.severity]);
    const tl = state.timeline;
    const rv = state.review;
    const rvOpen = rv ? (rv.issues || []).filter(i => !i.fixed) : [];
    const rvCritical = rvOpen.filter(i => i.severity === 'critical').length;
    const GATED = ['needs-clips', 'static-beat'];
    const gatedN = window.ReelStoryboardCore && esOn() ? lint.issues.filter(i => i.severity === 'critical' && GATED.includes(i.id)).length : 0;
    const critical = Math.max(0, lint.critical - gatedN) + rvCritical;
    const warnings = lint.warnings + rvOpen.length - rvCritical;
    const rd = readyNow(critical, warnings);
    state.ready = rd;
    const tone = rd ? rd.tone : (critical ? 'bad' : (warnings ? 'warn' : 'good'));
    els.ready.dataset.tone = tone;
    els.ready.dataset.state = rd ? rd.state : '';
    els.readyText.textContent = rd ? rd.label : (critical ? `${critical} to fix before posting` : (warnings ? `Ready to post · ${warnings} to review` : 'Ready to post'));
    if (els.findClips) { els.findClips.hidden = !(rd && (rd.needsClips || rd.still)); els.findClips.classList.toggle('is-go', Boolean(rd && rd.needsClips)); }
    // ES: the kit's "Check" result, "Safe frame ✓" when every word is inside it.
    const safeOk = esOn() && !lint.issues.some(i => i.id === 'safe-frame' || i.id === 'safe-zone');
    els.statuslineText.textContent = FLOW.statusLine({ critical: lint.critical, warnings: lint.warnings, seconds: tl ? tl.durationMs / 1000 : 0, usd: totalSpent(), money: isAdmin() ? F.money : (() => '') }).replace(/\s*·\s*$/, '') + (esOn() ? (safeOk ? ' · Safe frame ✓' : ' · Safe frame ✗') : '') + (state.voiceError && state.voiceOn ? ' · voice failed, captions only' : '');
    const row = (ok, label, severity = 'warning', n = 0) => `<li class="rm-check-row${ok ? ' is-ok' : ` is-${severity}`}"><span class="rm-check-row__mark" aria-hidden="true">${ok ? ICON.check : (severity === 'critical' ? ICON.alert : ICON.warn)}</span><span>${esc(label)}${!ok && n > 1 ? ` (${n})` : ''}</span><span class="es-sr-only">${ok ? ', passes' : ', needs a look'}</span></li>`;
    const rows = rd ? rd.checks.map(c => row(c.ok, c.label, c.severity)) : [];
    if (esOn()) rows.push(...ES.checklist(lint.issues).map(r => row(r.ok, r.label, r.severity, r.n)));
    rows.push(rv ? row(!rvOpen.length, rvOpen.length ? 'AI review: some scenes need a look' : `AI review: pictures match their words, facts are sourced${rv.fixed ? ` (${rv.fixed} fixed for you)` : ''}`, rvCritical ? 'critical' : 'warning', rvOpen.length)
      : row(true, window.ReelSourcing ? 'AI review did not run (AI is off or capped); the code checks above did' : 'Code checks: words, safe frame, captions, rights'));
    els.checklist.innerHTML = rows.join('');
    renderActions(rd);
    const beatN = id => (state.plan ? state.plan.beats.findIndex(b => b.id === id) : -1);
    const go = (id, n) => (n >= 0 ? `<button class="es-btn es-btn--tertiary es-btn--sm" type="button" data-goto="${esc(id)}">Scene ${n + 1}</button>` : '');
    const items = [
      ...list.map(issue => `<li class="rm-issue is-${issue.severity}">${sevIcon[issue.severity]}<div><p>${esc(issue.message)}</p>${issue.fix ? `<span>${esc(issue.fix)}</span>` : ''}</div>${go(issue.beat, beatN(issue.beat))}</li>`),
      ...rvOpen.map(i => `<li class="rm-issue is-${i.severity === 'critical' ? 'critical' : 'warning'}">${i.severity === 'critical' ? ICON.alert : ICON.warn}<div><p>${esc(REVIEW_KIND[i.kind] || 'Review')}: ${esc(i.message || 'needs a look')}</p></div>${go(i.beatId, beatN(i.beatId))}</li>`),
    ];
    els.issues.innerHTML = items.length ? items.join('') : `<li class="rm-issue is-good">${ICON.check}<div><p>Hook, safe frame, captions, sources and rights all check out.</p></div></li>`;
    // Flags on the scene cards.
    els.beats.querySelectorAll('[data-beat]').forEach(li => {
      const own = lint.issues.filter(i => i.beat === li.dataset.beat && i.severity !== 'info');
      const rvOwn = rvOpen.filter(i => i.beatId === li.dataset.beat);
      li.classList.toggle('has-critical', own.some(i => i.severity === 'critical'));
      li.classList.toggle('has-warning', !own.some(i => i.severity === 'critical') && Boolean(own.length || rvOwn.length));
      const flag = li.querySelector('.rm-beat__flag');
      if (flag) flag.textContent = own.length ? own[0].message : (rvOwn[0] ? (rvOwn[0].message || rvOwn[0].fix || '') : '');
    });
    const sel = state.selected;
    const flag = els.sceneEdit.querySelector('[data-scene-flag]');
    if (flag) { const own = lint.issues.filter(i => i.beat === sel && i.severity !== 'info'); const r = rvOpen.find(i => i.beatId === sel); flag.textContent = own.length ? own[0].message : (r ? (r.message || r.fix || '') : ''); flag.hidden = !flag.textContent; }
  }
  els.issues.addEventListener('click', event => {
    const btn = event.target.closest('[data-goto]');
    if (!btn) return;
    selectBeat(btn.dataset.goto, { seek: true, focus: true });
  });
  els.ready.addEventListener('click', () => {
    const open = els.lint.hidden;
    els.lint.hidden = !open;
    els.ready.setAttribute('aria-expanded', String(open));
  });

  // ─── Step 2: Review ──────────────────────────────────────────────────────
  // The fan-pulse poll idea that comes with a plan from the ideas room (a caption idea, not part of the video).
  function pollHtml(poll) {
    const q = poll && String(poll.question || (typeof poll === 'string' ? poll : '')).trim();
    if (!q) return '';
    const options = Array.isArray(poll.options) ? poll.options.map(o => String(o).trim()).filter(Boolean).slice(0, 4) : [];
    return `<p class="rm-poll"><span class="rm-poll__tag">Poll idea</span><span>${esc(q)}${options.length ? ` <span class="rm-meta">${options.map(esc).join(' · ')}</span>` : ''}</span></p>`;
  }
  function renderEdit() {
    const plan = state.plan;
    const fmt = F.FORMATS[plan.format];
    els.notice.hidden = !state.notice;
    els.notice.innerHTML = state.notice ? `${ICON.info}<p>${esc(state.notice)}</p>` : '';
    const data = F.isDataFormat && F.isDataFormat(plan.format);
    const label = data ? fmt.label : styleDef(curStyle()).label;
    els.summary.innerHTML = `<p class="rm-summary__eyebrow">${esc(label)}${plan.sport ? ` · ${esc(SPORT_LABEL[plan.sport] || plan.sport)}` : ''}${state.planSource === 'director-sonnet' && isAdmin() ? ' · <span class="ais-badge" title="Sonnet improved a weak first draft">Sonnet</span>' : ''}</p>
      <p class="rm-summary__title">${esc(plan.title || 'Untitled reel')}</p>
      ${plan.angle ? `<p class="rm-summary__angle">${esc(plan.angle)}</p>` : ''}
      ${pollHtml(plan.poll)}
      ${plan.hooks?.length ? `<div class="rm-hooks"><span>Other hooks</span>${plan.hooks.map((h, i) => `<button class="es-chip" type="button" data-hook="${i}">${esc(h)}</button>`).join('')}</div>` : ''}`;
    renderBeats();
    renderSceneEditor();
    renderVoice();
    renderVoicePickers();
    renderSources();
    renderStyles4();
    syncSafe();
    // Your script is never rewritten: no AI revise on a script reel.
    $('rm-revise').hidden = !state.config.ai || state.config.offline;
    if (G && TL) renderDataReview();
    renderRail();
  }
  els.summary.addEventListener('click', event => {
    const btn = event.target.closest('[data-hook]');
    if (!btn) return;
    const hook = state.plan.beats[0];
    const alt = state.plan.hooks[Number(btn.dataset.hook)];
    state.plan.hooks[Number(btn.dataset.hook)] = hook.text;
    setHook(hook, alt);
    rebuild();
    renderEdit();
    logEvent('edit', { what: 'hook-swap' });
  });
  function setHook(beat, text) {
    beat.text = text;
    if (esOn()) Object.assign(beat, ES.legacyFields(ES.blockOf({ kind: 'hook', text, emphasis: '' })));
  }
  // Reels 2.0's versions (other looks) are gone with the looks; the names stay for the page context.
  function useVersion() {}
  function makeVersions() {}
  const aiOn = () => Boolean(state.config.ai && !state.config.offline);

  // Calm preview: cuts in place of the wipe (also on by itself when the system asks for less motion).
  function setCalm(on) {
    state.calm = Boolean(on);
    els.calm.setAttribute('aria-pressed', String(state.calm));
    els.calmNote.hidden = !state.calm;
    draw();
  }
  els.calm.addEventListener('click', () => { setCalm(!state.calm); try { localStorage.setItem('frameup.reels.calm.v1', state.calm ? '1' : '0'); } catch { /* per-browser convenience only */ } });

  const count = (text, max) => { const n = F.wordCount(text); return `<span class="rm-count${n > max ? ' is-over' : ''}">${n}/${max}</span>`; };
  // ES Reels: each beat edits as its block, with exactly the block's fields.
  const COLOR_HINT = 'Add | blue, | red or | green after a line to colour it (red and green mean loss and win).';
  const rowsOf = list => list.map(x => `${x.text}${x.color && x.color !== 'ink' ? ` | ${x.color}` : ''}`).join('\n');
  function esFields(beat) {
    const id = beat.id;
    const b = ES.blockOf(beat);
    const f = (field, label, value, { area = false, maxlength = 120, placeholder = '', type = 'text', hint = '', rows = 2 } = {}) => `
      <div class="rm-bf"><div class="rm-bf__row"><label class="rm-bf__label" for="rm-${field.replace(/\./g, '-')}-${esc(id)}">${label}</label></div>
      ${area ? `<textarea class="es-input rm-bf__input" id="rm-${field.replace(/\./g, '-')}-${esc(id)}" data-field="${field}" rows="${rows}" maxlength="${maxlength}" placeholder="${esc(placeholder)}"${hint ? ` aria-describedby="rm-${field.replace(/\./g, '-')}-${esc(id)}-hint"` : ''}>${esc(value)}</textarea>` : `<input class="es-input rm-bf__input" id="rm-${field.replace(/\./g, '-')}-${esc(id)}" data-field="${field}" type="${type}" maxlength="${maxlength}" value="${esc(value)}" placeholder="${esc(placeholder)}"${type === 'number' ? ' inputmode="decimal" step="any"' : ''}${hint ? ` aria-describedby="rm-${field.replace(/\./g, '-')}-${esc(id)}-hint"` : ''}>`}
      ${hint ? `<p class="es-field__hint" id="rm-${field.replace(/\./g, '-')}-${esc(id)}-hint">${esc(hint)}</p>` : ''}</div>`;
    const colorSel = (field, value) => `<div class="rm-bf"><label class="rm-bf__label" for="rm-${field.replace(/\./g, '-')}-${esc(id)}">Colour</label><select class="es-select rm-bf__input" id="rm-${field.replace(/\./g, '-')}-${esc(id)}" data-field="${field}">${['blue', 'ink', 'green', 'red'].map(c => `<option value="${c}"${c === value ? ' selected' : ''}>${c[0].toUpperCase()}${c.slice(1)}</option>`).join('')}</select></div>`;
    const parts = [`<div class="rm-bf"><label class="rm-bf__label" for="rm-estype-${esc(id)}">Block</label><select class="es-select rm-bf__input" id="rm-estype-${esc(id)}" data-field="es.type">${ES.BLOCK_TYPES.map(t => `<option value="${t}"${t === b.type ? ' selected' : ''}>${ES.BLOCKS[t].label}</option>`).join('')}</select></div>`];
    if (b.type === 'hook') {
      parts.push(f('es.pills', 'Pills (one per line, about 14 characters each)', rowsOf(b.pills || []), { area: true, rows: 3, maxlength: 140, hint: COLOR_HINT }));
      parts.push(`<div class="rm-bf-pair">${f('es.stamp.text', 'Stamp word', b.stamp ? b.stamp.text : '', { maxlength: 20, placeholder: 'Optional, one word' })}${f('es.stamp.at', 'Stamp lands at (s)', b.stamp && b.stamp.at != null ? b.stamp.at : '', { type: 'number', maxlength: 5, placeholder: 'When it is said' })}</div>`);
    } else if (b.type === 'statement') {
      parts.push(f('es.lines', 'Lines (1 to 3, under 14 characters each)', rowsOf(b.lines || []), { area: true, rows: 3, maxlength: 140, hint: COLOR_HINT }));
    } else if (b.type === 'number') {
      parts.push(`<div class="rm-bf-pair">${f('es.kicker', 'Kicker', b.kicker || '', { maxlength: 40 })}${f('es.label', 'Label', b.label || '', { maxlength: 40 })}</div>`);
      parts.push(`<div class="rm-bf-trio">${f('es.prefix', 'Before', b.prefix || '', { maxlength: 3, placeholder: '$' })}${f('es.value', 'Number', b.value, { type: 'number', maxlength: 12 })}${f('es.suffix', 'After', b.suffix || '', { maxlength: 4, placeholder: '% or M' })}</div>`, colorSel('es.color', b.color || 'blue'));
    } else if (b.type === 'dots') {
      parts.push(`<div class="rm-bf-pair">${f('es.count', 'Dots', b.count, { type: 'number', maxlength: 5, hint: 'Up to 2,600.' })}${f('es.highlight', 'Green ones', b.highlight, { type: 'number', maxlength: 5 })}</div>`);
      parts.push(`<div class="rm-bf-pair">${f('es.label', 'Label', b.label || '', { maxlength: 40 })}${f('es.note', 'Note', b.note || '', { maxlength: 40 })}</div>`);
    } else if (b.type === 'compare') {
      parts.push(f('es.kicker', 'Kicker', b.kicker || '', { maxlength: 40 }));
      parts.push(f('es.items', 'Bars (label = value as shown, 2 to 4 lines)', (b.items || []).map(it => `${it.label} = ${it.display || it.value}${it.color ? ` | ${it.color}` : ''}`).join('\n'), { area: true, rows: 4, maxlength: 200, hint: 'Bars scale to the biggest value. Add | red or | green for meaning.' }));
    } else if (b.type === 'quote') {
      parts.push(f('es.text', 'Quote (their exact words, under 70 characters)', b.text || '', { area: true, maxlength: 200 }), f('es.who', 'Who said it', b.who || '', { maxlength: 60 }));
    } else if (b.type === 'endcard') {
      const cta = b.cta || ES.DEFAULT_CTA;
      parts.push(`<div class="rm-bf-pair">${f('es.cta.0', 'Line 1', cta[0] || '', { maxlength: 30 })}${f('es.cta.1', 'Line 2', cta[1] || '', { maxlength: 30 })}</div>`);
      parts.push(f('plan.sourceLine', 'Source line', state.plan.sourceLine || state.timeline?.sourceLine || '', { maxlength: 120, placeholder: 'Source: ESPN, Kalshi', hint: 'Shown on the end card. Every claim needs a source.' }));
      return parts.join('');
    }
    parts.push(`<div class="rm-bf"><div class="rm-bf__row"><label class="rm-bf__label" for="rm-vo-${esc(id)}">${scriptLocked() ? 'Voiceover (your words)' : 'Voiceover'}</label>${count(beat.vo, F.PACE.voMaxWords)}</div><textarea class="es-input rm-bf__input" id="rm-vo-${esc(id)}" data-field="vo" rows="2" maxlength="300" aria-describedby="rm-vo-${esc(id)}-hint">${esc(beat.vo)}</textarea><p class="es-field__hint" id="rm-vo-${esc(id)}-hint">Wrap the key word in *asterisks* to make it yellow in the captions.</p></div>`);
    return parts.join('');
  }
  // Applies an edit to the beat's ES block (and the fields the rest of Reels Studio reads).
  function setEsField(beat, field, value) {
    const key = field.slice(3);
    let b = ES.blockOf(beat);
    if (key === 'type') b = ES.blockOf({ ...beat, block: null, kind: ES.KIND_FOR[value] });
    // ── Reels 2.0: D (interface) ── structured values from the storyboard cards: rows of
    // { text, color } (pills, lines) or { label, display, color } (compare bars), a stamp object or null.
    else if (Array.isArray(value) && (key === 'pills' || key === 'lines')) b[key] = value.map(x => ({ ...(b[key] || []).find(o => o.text === x.text && o.size), text: String(x.text || '').trim(), color: String(x.color || 'ink').toLowerCase() })).filter(x => x.text);
    else if (Array.isArray(value) && key === 'items') b.items = value.map(x => { const display = String(x.display == null ? '' : x.display).trim(); return { label: String(x.label || '').trim(), display, value: display, ...(x.color ? { color: String(x.color).toLowerCase() } : {}) }; }).filter(x => x.label);
    else if (key === 'stamp') b.stamp = value && String(value.text || '').trim() ? { ...(b.stamp || {}), ...value, text: String(value.text).trim() } : undefined;
    else if (key === 'pills' || key === 'lines') b[key] = String(value).split('\n').map(line => { const [t, c] = line.split('|'); return { text: t.trim(), color: (c || 'ink').trim().toLowerCase() }; }).filter(x => x.text);
    else if (key === 'items') b.items = String(value).split('\n').map(line => { const [main, c] = line.split('|'); const [label, ...rest] = main.split('='); const display = rest.join('=').trim(); return { label: label.trim(), display, value: display, ...(c ? { color: c.trim().toLowerCase() } : {}) }; }).filter(x => x.label);
    else if (key.startsWith('stamp.')) { const k = key.slice(6); const st = { ...(b.stamp || {}) }; if (value === '' || value == null) delete st[k]; else st[k] = k === 'at' ? Number(value) : value; b.stamp = st.text ? st : undefined; }
    else if (key.startsWith('cta.')) { const cta = (b.cta || ES.DEFAULT_CTA).slice(); cta[Number(key.slice(4))] = value; b.cta = cta; }
    // ── Reels Studio v3 (UI) ── fields of the engine's new blocks: list.N.prop (stat tiles, streak items…) and obj.prop (a label pill).
    else if (/^\w+\.\d+\.\w+$/.test(key) && Array.isArray(b[key.split('.')[0]])) { const [k, n, prop] = key.split('.'); const arr = b[k].map(x => (x && typeof x === 'object' ? { ...x } : x)); const item = arr[Number(n)]; if (item && typeof item === 'object') item[prop] = typeof item[prop] === 'number' && value !== '' && Number.isFinite(Number(value)) ? Number(value) : value; b[k] = arr; }
    else if (/^\w+\.\w+$/.test(key) && b[key.split('.')[0]] && typeof b[key.split('.')[0]] === 'object') { const [k, prop] = key.split('.'); b[k] = { ...b[k], [prop]: value }; }
    else b[key] = value;
    if (b.type === 'number' && key !== 'type') delete b.display;
    const legacy = ES.legacyFields(ES.cleanBlock(b));
    ['stat', 'bars', 'dotrank', 'quote', 'chips', 'versus', 'roles'].forEach(k => { delete beat[k]; });
    Object.assign(beat, legacy);
  }
  function beatFields(beat, i) {
    if (esOn()) return esFields(beat);
    const id = beat.id;
    const f = (field, label, value, { max = 0, area = false, maxlength = 120, placeholder = '' } = {}) => `
      <div class="rm-bf"><div class="rm-bf__row"><label class="rm-bf__label" for="rm-${field}-${esc(id)}">${label}</label>${max ? count(value, max) : ''}</div>
      ${area ? `<textarea class="es-input rm-bf__input" id="rm-${field}-${esc(id)}" data-field="${field}" rows="2" maxlength="${maxlength}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="es-input rm-bf__input" id="rm-${field}-${esc(id)}" data-field="${field}" type="text" maxlength="${maxlength}" value="${esc(value)}" placeholder="${esc(placeholder)}">`}</div>`;
    const parts = [f('text', 'On screen', beat.text, { max: F.PACE.textMaxWords, maxlength: 90 }), f('vo', 'Voiceover', beat.vo, { max: F.PACE.voMaxWords, area: true, maxlength: 300 })];
    if (beat.kind === 'stat') parts.push(`<div class="rm-bf-pair">${f('stat.value', 'Number', beat.stat?.value || '', { maxlength: 16 })}${f('stat.label', 'Label', beat.stat?.label || '', { maxlength: 24 })}</div>`);
    if (beat.kind === 'rank') parts.push(`<div class="rm-bf-pair">${f('name', `#${beat.rank} name`, beat.name || '', { maxlength: 60 })}${f('detail', 'Detail', beat.detail || '', { maxlength: 110 })}</div>`);
    if (beat.kind === 'quote') parts.push(f('quote.text', 'Quote (exact words)', beat.quote?.text || '', { area: true, maxlength: 220 }), f('quote.by', 'Said by', beat.quote?.by || '', { maxlength: 60 }));
    if (beat.kind !== 'cta') parts.push(f('emphasis', 'Highlight word', beat.emphasis || '', { maxlength: 30, placeholder: 'One word from the line' }));
    // Data components: each row edits as "label = value" (numbers must be in a source).
    const rows = (list, a, b2) => (list || []).map(x => `${x[a] || ''} = ${x[b2] || ''}`).join('\n');
    if (beat.kind === 'bars') parts.push(f('rows.bars', 'Bars (label = value, one per line)', rows(beat.bars, 'label', 'value'), { area: true, maxlength: 200 }));
    if (beat.kind === 'versus') parts.push(f('rows.versus', 'Cards (name = value, "?" for a mystery card)', rows(beat.versus, 'name', 'value'), { area: true, maxlength: 200 }));
    if (beat.kind === 'roles') parts.push(f('rows.roles', 'Positions (role = value)', rows(beat.roles, 'role', 'value'), { area: true, maxlength: 200 }));
    if (beat.kind === 'tiles') parts.push(f('rows.tiles', 'Teams (team = line)', rows(beat.tiles, 'team', 'label'), { area: true, maxlength: 200 }));
    if (beat.kind === 'dotrank') parts.push(`<div class="rm-bf-pair">${f('dotrank.rank', 'Rank', beat.dotrank?.rank || '', { maxlength: 8 })}${f('dotrank.total', 'Out of', beat.dotrank?.total || '', { maxlength: 8 })}</div>`, f('dotrank.label', 'Callout', beat.dotrank?.label || '', { maxlength: 32 }));
    if (beat.kind === 'chips' || (beat.kind === 'stat' && beat.chips)) parts.push(`<div class="rm-bf-pair">${f('chips.filled', 'Filled', beat.chips?.filled || '', { maxlength: 6 })}${f('chips.total', 'Out of', beat.chips?.total || '', { maxlength: 6 })}</div>`, f('chips.label', 'Label', beat.chips?.label || '', { maxlength: 40 }));
    if (beat.kind === 'steps') parts.push(`<div class="rm-bf-pair">${f('steps.current', 'Step', beat.steps?.current || '', { maxlength: 2 })}${f('steps.total', 'Of', beat.steps?.total || '', { maxlength: 2 })}</div>`);
    if (['bars', 'stat', 'mystery', 'context', 'point', 'payoff', 'hook'].includes(beat.kind) && S.get(styleId()).engine !== 'classic') parts.push(f('detail', 'Small line', beat.detail || '', { maxlength: 110 }));
    return parts.join('');
  }
  function visualCard(beat) {
    const ids = state.photos[beat.id] || [];
    const asset = ids[0] ? state.assets[ids[0]] : null;
    const img = ids[0] && state.images[ids[0]];
    const src = state.visualSrc[beat.id] || (asset ? (asset.kind === 'clip' ? 'x-clip' : 'photo') : 'none');
    const note = state.visualNote?.[beat.id];
    const clip = asset && asset.kind === 'clip';
    const canAi = state.config.aiClips?.ready && state.aiClipsUsed < state.config.aiClips.max;
    const cutable = beat === state.plan.beats[0] && S.get(styleId()).cutout && CUT && state.config.ai;
    const btn = (action, label, icon, extra = '') => `<button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-visual="${action}" ${extra}>${icon}<span>${label}</span></button>`;
    return `<div class="rm-visual">
      <button class="rm-thumb${img ? '' : ' is-empty'}" type="button" data-photo aria-label="Choose a photo for this beat">${img ? (img.tagName === 'CANVAS' ? '<span class="rm-thumb__canvas" data-thumb-canvas></span>' : `<img src="${esc(img.src)}" alt="">`) : ICON.image}${clip ? `<span class="rm-thumb__badge">${ICON.film}</span>` : ''}</button>
      <div class="rm-visual__meta"><p class="rm-visual__src">${esc(SOURCE_NAME[src] || src)}${asset?.rights?.credit ? ` · ${esc(asset.rights.credit)}` : ''}</p>
        <p class="rm-hint">${note ? esc(note) : (src === 'none' || src === 'paper' ? (esOn() ? 'The scene sits on ES paper until you pick a photo.' : 'Plain black until you pick something.') : esc(asset?.label || ''))}</p>
        <div class="rm-visual__actions">
          ${btn('swap-clip', clip ? 'Swap clip' : 'Use a clip', ICON.film)}
          ${btn('photo', 'Use photo', ICON.image)}
          ${state.plan.team ? btn('tile', 'Team graphic', ICON.shield) : ''}
          ${canAi ? btn('ai-clip', 'Use AI clip', ICON.sparkles) : (state.config.ai ? btn('scene', 'AI scene', ICON.sparkles) : '')}
          ${btn('upload', 'Upload', ICON.upload)}
          ${cutable ? btn('cutout', 'Cut out the player', ICON.scissors) : ''}
        </div></div></div>`;
  }
  // ── Reels 2.0: D (interface) ── the storyboard (reel-storyboard.js) took the
  // beat strip's place: every scene is a card. renderStrip stays for the page
  // context; it refreshes the cards' thumbnails and marks.
  function renderStrip() { renderStoryboardSoon(); }
  const renderStoryboardSoon = debounce(() => { mods().storyboard?.refresh(); }, 60);
  function selectBeat(id, { seek: doSeek = false, focus = false } = {}) {
    const changed = state.selected !== id;
    state.selected = id;
    const sb = mods().storyboard;
    if (sb) sb.select(id, { focus }); else { renderBeats(); if (focus) els.beats.querySelector('input, textarea')?.focus(); }
    if (doSeek) seekBeat(id);
    if (changed) emit('beat', { id });
  }
  function addBeat() {
    const at = Math.max(1, state.plan.beats.findIndex(b => b.id === state.selected) + 1 || state.plan.beats.length - 1);
    const beat = esOn()
      ? { id: `b${Date.now().toString(36)}`, ...ES.legacyFields({ type: 'statement', lines: [{ text: 'NEW POINT', color: 'ink' }] }), vo: scriptLocked() ? '' : 'Say what this beat adds.', emphasis: '', photo: '' }
      : { id: `b${Date.now().toString(36)}`, kind: 'point', text: 'New point', vo: 'Say what this beat adds.', emphasis: '', photo: state.plan.team?.name || '' };
    editBeats(list => list.splice(Math.min(at, list.length - 1), 0, beat));
    state.selected = beat.id;
    rebuild();
    renderBeats();
    fillVisuals({ only: [beat.id] }).then(() => { rebuild(); renderBeats(); });
    const card = els.beats.querySelector(`[data-beat="${CSS.escape(beat.id)}"]`);
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    card?.querySelector('input:not([type="hidden"]), textarea')?.select();
    emit('beat', { id: beat.id, added: true });
  }
  els.addBeat.addEventListener('click', addBeat);
  function renderBeats() {
    if (!state.plan) return;
    // ── Reels 2.0: D (interface) ── every scene is a card on the storyboard.
    els.addBeat.disabled = state.plan.beats.length >= S.get(styleId()).beats.max;
    if (mods().storyboard) { if (!state.plan.beats.some(b => b.id === state.selected)) state.selected = state.plan.beats[0]?.id || ''; mods().storyboard.render(); renderLint(); return; }
    const tl = state.timeline;
    const active = document.activeElement;
    const keepId = active && els.beats.contains(active) ? active.id : '';
    if (!state.plan.beats.some(b => b.id === state.selected)) state.selected = state.plan.beats[0]?.id || '';
    const i = state.plan.beats.findIndex(b => b.id === state.selected);
    const beat = state.plan.beats[i];
    const b = tl?.beats.find(x => x.id === beat.id);
    const voiced = state.voice[beat.id] && state.voice[beat.id].text === beat.vo;
    els.beats.innerHTML = `<li class="rm-beat" data-beat="${esc(beat.id)}" data-kind="${esc(beat.kind)}">
        <div class="rm-beat__head">
          <button class="rm-beat__seek" type="button" data-seek="${esc(beat.id)}" aria-label="Play from beat ${i + 1}"><span class="rm-beat__n">${i + 1}</span><span class="rm-beat__kind">${esc(beatName(beat))}${beat.kind === 'rank' && !esOn() ? ` #${beat.rank}` : ''}</span><span class="rm-beat__time">${b ? `${fmtTime(b.inMs)}–${fmtTime(b.outMs)}` : ''}</span>${voiced ? '<span class="rm-beat__vo" title="Voiceover ready">VO</span>' : ''}</button>
          <span class="rm-beat__tools">
            <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-move="-1" aria-label="Move beat ${i + 1} earlier" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
            <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-move="1" aria-label="Move beat ${i + 1} later" ${i === state.plan.beats.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
            <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-remove aria-label="Delete beat ${i + 1}" ${state.plan.beats.length <= 2 ? 'disabled' : ''}>${ICON.trash}</button>
          </span>
        </div>
        ${beat.kind === 'cta' ? '' : (esOn() && !ES.takesMedia(beat) ? '<p class="rm-hint rm-beat__paper">This block sits on ES paper: no photo needed.</p>' : visualCard(beat))}
        <div class="rm-beat__fields">${beatFields(beat, i)}</div>
        <p class="rm-beat__flag" aria-live="polite"></p>
      </li>`;
    const holder = els.beats.querySelector('[data-thumb-canvas]');
    const img = state.images[(state.photos[beat.id] || [])[0]];
    if (holder && img) { const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d'); const k = Math.max(128 / img.width, 128 / img.height); g.drawImage(img, (128 - img.width * k) / 2, (128 - img.height * k) / 2, img.width * k, img.height * k); holder.replaceWith(c); }
    renderLint();
    if (keepId) { const el = $(keepId); if (el) { el.focus(); const len = el.value.length; try { el.setSelectionRange(len, len); } catch { /* not a text field */ } } }
  }
  // Sets a dotted path on an object (creating the parents); a number stays a number.
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach((k, i) => { const nextIsIndex = /^\d+$/.test(keys[i + 1]); if (o[k] == null || typeof o[k] !== 'object') o[k] = nextIsIndex ? [] : {}; o = o[k]; });
    const last = keys[keys.length - 1];
    o[last] = typeof o[last] === 'number' && value !== '' && Number.isFinite(Number(value)) ? Number(value) : value;
  }
  // Module change (v4): the new module keeps the fields it shares with the old one; numbers stay sourced.
  // A module change keeps the scene's sourced figures: the old module's label/value
  // pairs move into the new shape (bars, rank list, scoreboard, stat tiles, number
  // line, compare, checklist). Nothing is invented; a shape that cannot take them
  // starts empty and the lint asks for its data.
  function moduleRows(m) {
    if (!m || typeof m !== 'object') return [];
    const pair = x => (x && typeof x === 'object' ? { label: String(x.label ?? x.team ?? x.text ?? x.name ?? '').trim(), value: x.value ?? x.n ?? '' } : null);
    if (Array.isArray(m.rows)) return m.rows.map(pair).filter(Boolean);
    if (Array.isArray(m.marks)) return m.marks.map(pair).filter(Boolean);
    if (Array.isArray(m.tiles)) return m.tiles.map(pair).filter(Boolean);
    if (Array.isArray(m.groups)) return m.groups.map(pair).filter(Boolean);
    if (m.from && m.to) return [pair(m.from), pair(m.to)].filter(Boolean);
    if (m.to != null && m.label) return [{ label: String(m.label), value: m.to }];
    return [];
  }
  function convertModule(old, type) {
    const keep = old ? ['title', 'label', 'caption'].reduce((o, k) => (old[k] != null && typeof old[k] !== 'object' ? { ...o, [k]: old[k] } : o), {}) : {};
    const rows = moduleRows(old).filter(r => r.label || r.value !== '');
    const num = v => { const n = Number(String(v).replace(/[^0-9.+-]/g, '')); return Number.isFinite(n) ? n : null; };
    const out = { ...keep, type };
    if (!rows.length) return out;
    if (type === 'bars') out.rows = rows.map(r => ({ label: r.label, value: num(r.value) ?? r.value }));
    else if (type === 'rankList') out.rows = rows.map((r, i) => ({ rank: i + 1, label: r.label, value: r.value }));
    else if (type === 'scoreboard') out.rows = rows.map(r => ({ team: r.label, value: r.value }));
    else if (type === 'statTiles') out.tiles = rows.slice(0, 3).map(r => ({ label: r.label, value: r.value }));
    else if (type === 'checklist') out.rows = rows.map(r => ({ text: [r.label, r.value].filter(x => x !== '' && x != null).join(' '), checked: true }));
    else if (type === 'numberLine') { const marks = rows.map(r => ({ label: r.label, value: num(r.value) })).filter(r => r.value != null); if (marks.length) { const vs = marks.map(m => m.value); Object.assign(out, { min: Math.min(0, ...vs), max: Math.max(...vs), marks }); } }
    else if (type === 'compare' && rows.length >= 2) Object.assign(out, { from: { value: rows[0].value, label: rows[0].label }, to: { value: rows[1].value, label: rows[1].label } });
    else if (type === 'reveal') Object.assign(out, { from: '?', to: String(rows[rows.length - 1].value), label: rows[rows.length - 1].label });
    return out;
  }
  function setModule(beat, type) {
    const before = beat.module ? beat.module.type : '';
    if (!type) delete beat.module;
    else if (!beat.module || beat.module.type !== type) beat.module = convertModule(beat.module, type);
    feedback('change_module', { beatId: beat.id, before: { module: before }, after: { module: type || '' } });
    motionRecheck();
    rebuild();
    renderBeats();
  }
  // The words before an edit (for the learning loop).
  const voWas = {};
  const voBefore = id => { const b = state.plan && state.plan.beats.find(x => x.id === id); if (b && !(id in voWas)) voWas[id] = b.vo || ''; };
  const voLogged = debounce(id => { const b = state.plan && state.plan.beats.find(x => x.id === id); if (b && id in voWas && voWas[id] !== b.vo) feedback('edit_text', { beatId: id, before: { vo: voWas[id] }, after: { vo: b.vo } }); delete voWas[id]; }, 2500);
  function setField(beat, field, value) {
    if (field === 'plan.sourceLine') { state.plan.sourceLine = value; return; }
    if (field === 'chap.headline' && v4()) {
      const ch = state.plan.chapters.find(c => (c.beats || []).some(b => b.id === beat.id));
      if (ch) { const before = ch.headline || ''; ch.headline = value; feedbackSoon('edit_text', beat.id, { headline: before }, { headline: value }); }
      return;
    }
    if (field.startsWith('v4.')) { const path = field.slice(3); const before = JSON.stringify(path.split('.').reduce((o, k) => (o == null ? o : o[k]), beat) ?? ''); setPath(beat, path, value); feedbackSoon('edit_text', beat.id, { [path]: JSON.parse(before) }, { [path]: value }); return; }
    if (field === 'vo') { voBefore(beat.id); beat.vo = value; voLogged(beat.id); return; }
    if (field.startsWith('es.') && ES) { setEsField(beat, field, value); return; }
    if (field.startsWith('rows.')) {
      const kind = field.slice(5);
      const keys = { bars: ['label', 'value'], versus: ['name', 'value'], roles: ['role', 'value'], tiles: ['team', 'label'] }[kind];
      const old = beat[kind] || [];
      beat[kind] = String(value).split('\n').map((line, i) => { const [a, ...rest] = line.split('='); return { ...(old[i] || {}), [keys[0]]: a.trim(), [keys[1]]: rest.join('=').trim() }; }).filter(x => x[keys[0]]).slice(0, 4);
      return;
    }
    if (field.includes('.')) {
      const [a, b] = field.split('.');
      beat[a] = { ...(beat[a] || {}), [b]: value };
    } else beat[field] = value;
  }
  const fbTimers = {};
  function feedbackSoon(event, beatId, before, after) {
    const key = `${event}:${beatId}:${Object.keys(after || {})[0] || ''}`;
    if (!fbTimers[key]) fbTimers[key] = { before };
    clearTimeout(fbTimers[key].t);
    fbTimers[key].t = setTimeout(() => { const b = fbTimers[key].before; delete fbTimers[key]; feedback(event, { beatId, before: b, after }); }, 2500);
  }
  const onSceneInput = event => {
    const input = event.target.closest('[data-field]');
    if (!input) return;
    const li = input.closest('[data-beat]');
    const beat = state.plan.beats.find(b => b.id === li.dataset.beat);
    if (!beat) return;
    setField(beat, input.dataset.field, input.value);
    if (input.dataset.field === 'es.type') { feedback('change_module', { beatId: beat.id, after: { block: input.value } }); rebuild(); renderBeats(); document.getElementById(`rm-estype-${beat.id}`)?.focus(); fillVisuals({ only: [beat.id] }).then(() => { rebuild(); renderBeats(); }); return; }
    if (beat.kind === 'rank' && input.dataset.field === 'name') beat.text = input.value;
    if (input.dataset.field === 'vo') voiceSoon();
    const counter = input.closest('.rm-bf')?.querySelector('.rm-count');
    if (counter) { const max = input.dataset.field === 'vo' ? F.PACE.voMaxWords : F.PACE.textMaxWords; const n = F.wordCount(input.value); counter.textContent = `${n}/${max}`; counter.classList.toggle('is-over', n > max); }
    rebuildSoon();
    editedSoon();
  };
  els.beats.addEventListener('input', onSceneInput);
  els.sceneEdit.addEventListener('input', onSceneInput);
  const editedSoon = debounce(() => logEvent('edit', { what: 'text' }), 4000);
  const onSceneClick = event => {
    const li = event.target.closest('[data-beat]');
    if (!li) return;
    const vis = event.target.closest('[data-visual]');
    if (vis) { visualAction(li.dataset.beat, vis.dataset.visual); return; }
    const i = state.plan.beats.findIndex(b => b.id === li.dataset.beat);
    if (event.target.closest('[data-seek]')) { seekBeat(li.dataset.beat); return; }
    if (event.target.closest('[data-photo]')) { openPhotos(li.dataset.beat); return; }
    const move = event.target.closest('[data-move]');
    if (move) {
      const j = i + Number(move.dataset.move);
      if (j < 0 || j >= state.plan.beats.length) return;
      editBeats(list => { const [beat] = list.splice(i, 1); list.splice(j, 0, beat); });
      rebuild();
      renderBeats();
      els.beats.querySelector(`[data-move="${move.dataset.move}"]`)?.focus();
      return;
    }
    if (event.target.closest('[data-remove]')) {
      const [removed] = editBeats(list => list.splice(i, 1));
      feedback('delete_beat', { beatId: removed.id, before: { vo: removed.vo || '', module: removed.module ? removed.module.type : (removed.block ? removed.block.type : '') } });
      state.selected = (state.plan.beats[i] || state.plan.beats[i - 1]).id;
      rebuild();
      renderBeats();
      els.beats.querySelector(`[data-beat="${CSS.escape(state.selected)}"] [data-sb-face]`)?.focus();
      toast(`Scene ${i + 1} deleted`, { action: { label: 'Undo', run: () => { editBeats(list => list.splice(i, 0, removed)); state.selected = removed.id; rebuild(); renderBeats(); } } });
    }
 };
  els.beats.addEventListener('click', onSceneClick);
  els.sceneEdit.addEventListener('click', onSceneClick);
  function seekBeat(id) {
    const b = state.timeline?.beats.find(x => x.id === id);
    if (!b) return;
    // ES: land just after the slab wipe, so the picked scene shows (not the cut).
    seek(b.inMs + (esOn() && b.inMs > 0 ? Math.min(700, Math.max(1, b.outMs - b.inMs - 1)) : 1));
  }

  // Revise (Ask AI). Your script is never rewritten: on a script reel the AI
  // changes the visuals (media, modules, on-screen words) and every voiceover
  // line comes back exactly as written, or the change is not used.
  async function revise(instruction) {
    if (!state.plan || state.busy) return;
    state.busy = 'revise';
    const chips = [...document.querySelectorAll('[data-revise], #rm-ask button')];
    chips.forEach(c => { c.disabled = true; });
    els.askForm.setAttribute('aria-busy', 'true');
    const locked = scriptLocked();
    try {
      const data = await api({ mode: 'revise', plan: state.plan, instruction, corpus: `${state.corpus}\n${els.extraSource.value}`, keepVo: locked, v: v4() ? 4 : 3 });
      if (!data.plan || !Array.isArray(data.plan.beats || (data.plan.chapters && [])) ) throw new Error('The AI did not send a revised reel. Try again.');
      const next = ensureV4(data.plan);
      const old = state.plan;
      if (locked && !(SBC && SBC.keepsScript(next, old.script ? old.script.text : old.beats.map(b => b.vo).join(' ')))) {
        // Same scenes: put your lines back; otherwise the change is not used.
        if (next.beats.length === old.beats.length) next.beats.forEach((b, i) => { b.vo = old.beats[i].vo; });
        else throw new Error('The AI tried to change your script, so that change was not used. Your reel is as it was.');
      }
      next.beats.forEach(beat => { const o = old.beats.find(x => x.photo && x.photo === beat.photo && state.visualSrc[x.id]); if (o) beat._from = o.id; });
      state.spent.revise += Number(data.cost) || 0;
      next.beats.forEach((beat, i) => {
        if (!(v4(next) && old.beats.some(o => o.id === beat.id))) beat.id = `b${i + 1}-${Math.random().toString(36).slice(2, 6)}`;
        const same = beat._from ? old.beats.find(o => o.id === beat._from) : old.beats.find(o => o.id === beat.id || (o.photo && o.photo === beat.photo));
        delete beat._from;
        if (same && state.photos[same.id] && same.id !== beat.id) { state.photos[beat.id] = state.photos[same.id]; state.visualSrc[beat.id] = state.visualSrc[same.id]; }
      });
      next.team = old.team;
      next.style = old.style;
      next.esStyle = old.esStyle;
      if (old.script) next.script = old.script;
      if (old.look) next.look = old.look;
      if (old.recipe) next.recipe = old.recipe;
      state.plan = next;
      if (state.versions) state.versions[state.version].plan = state.plan; // ── Reels 2.0: D (interface) ──
      state.selected = next.beats[0]?.id || '';
      rebuild();
      renderEdit();
      pickPhotosMissing();
      voiceSoon(0);
      toast(locked ? 'Revised. Your words stayed exactly as you wrote them.' : 'Revised. Your photos were kept where the beat still matches.');
      logEvent('revise', { instruction: String(instruction).slice(0, 80), cost: data.cost });
      feedback('regenerate', { before: { instruction: String(instruction).slice(0, 120) } });
    } catch (error) {
      toast(error.message, { tone: 'error' });
    } finally {
      state.busy = '';
      chips.forEach(c => { c.disabled = false; });
      els.askForm.removeAttribute('aria-busy');
    }
  }
  // Ask AI about one scene: only that scene's visuals change (its words never).
  async function reviseBeat(beatId, instruction, form) {
    if (!state.plan || state.busy) return;
    const beat = state.plan.beats.find(b => b.id === beatId);
    if (!beat) return;
    const n = state.plan.beats.indexOf(beat) + 1;
    state.busy = 'revise';
    const btn = form && form.querySelector('button');
    if (btn) btn.disabled = true;
    form?.setAttribute('aria-busy', 'true');
    try {
      const data = await api({ mode: 'revise', plan: state.plan, beatId, scope: 'beat', keepVo: true, v: v4() ? 4 : 3, instruction: `Scene ${n} only: ${instruction}. Keep every voiceover word exactly.`, corpus: `${state.corpus}\n${els.extraSource.value}` });
      const next = data.plan ? ensureV4(data.plan) : null;
      const got = next && (next.beats.find(b => b.id === beatId) || next.beats[n - 1]);
      if (!got) throw new Error('The AI did not change this scene. Try asking another way.');
      const before = { module: beat.module ? beat.module.type : (beat.block ? beat.block.type : ''), media: beat.media ? beat.media.kind : '' };
      const vo = beat.vo;
      const keep = { id: beat.id, vo };
      Object.keys(beat).forEach(k => { if (!(k in keep)) delete beat[k]; });
      Object.assign(beat, got, keep);
      state.spent.revise += Number(data.cost) || 0;
      rebuild();
      renderBeats();
      fillVisuals({ only: [beatId] }).then(() => { rebuild(); renderBeats(); });
      toast(`Scene ${n} changed. Your words stayed as written.`);
      feedback('regenerate', { beatId, before, after: { module: beat.module ? beat.module.type : (beat.block ? beat.block.type : ''), media: beat.media ? beat.media.kind : '', instruction: instruction.slice(0, 120) } });
    } catch (error) {
      toast(error.message || 'Ask AI is unavailable right now.', { tone: 'error' });
    } finally {
      state.busy = '';
      if (btn) btn.disabled = false;
      form?.removeAttribute('aria-busy');
    }
  }
  const pickPhotosMissing = () => fillVisuals();
  document.querySelectorAll('[data-revise]').forEach(btn => btn.addEventListener('click', () => revise(btn.dataset.revise)));
  els.askForm.addEventListener('submit', event => { event.preventDefault(); const v = els.askInput.value.trim(); if (v.length >= 3) { revise(v); els.askInput.value = ''; } });

  // ─── Voice ───────────────────────────────────────────────────────────────
  function voiceCounts() {
    const beats = state.plan?.beats || [];
    const withVo = beats.filter(b => (b.vo || '').trim() && !(esOn() && ES.blockOf(b).type === 'endcard')).length;
    const voiced = beats.filter(b => state.voice[b.id] && state.voice[b.id].text === b.vo && state.voice[b.id].voiceId === state.voiceId).length;
    // ── Reels 2.0: C (inputs) ── with the person's own recording on, nothing is left for the AI voice.
    if (ownVoice()) return { withVo, voiced: withVo, own: beats.filter(b => state.voice[b.id]?.own).length };
    return { withVo, voiced };
  }
  function renderVoice() {
    const v = state.config.voice || {};
    const { withVo, voiced } = voiceCounts();
    // ── Reels 2.0: C (inputs) ── the person's own recording: its own badge, no AI voice button.
    const mine = ownVoice();
    if (mine) {
      els.voiceBadge.className = `es-badge ${state.voiceOn ? (mine.timing === 'estimated' ? 'es-badge--warn' : 'es-badge--good') : ''}`;
      els.voiceBadge.textContent = state.voiceOn ? (mine.timing === 'estimated' ? 'Your recording · estimated timing' : 'Your recording') : 'Captions only';
      els.voiceNote.textContent = state.voiceOn ? '' : 'Voice is off: the reel exports with captions only.';
      els.voiceState.innerHTML = '';
      els.voiceBtn.hidden = true;
      return;
    }
    const on = v.ready && state.voiceOn;
    const all = voiced && voiced === withVo;
    els.voiceBadge.className = `es-badge ${on ? (all ? 'es-badge--good' : (state.voiceError ? 'es-badge--bad' : 'es-badge--brand')) : ''}`;
    els.voiceBadge.textContent = !on ? 'Captions only' : (state.voiceMaking ? 'Recording…' : (all ? 'Voice ready' : (state.voiceError ? 'Voice failed' : `${voiced} of ${withVo} voiced`)));
    els.voiceNote.textContent = on
      ? ((v.voices || []).length ? '' : `${v.label}. Edited lines are re-voiced automatically; unchanged ones are reused for free.`)
      : (v.ready ? 'Voice is off: the reel exports with captions only.' : (v.reason || `No voice is set up. The reel exports with captions${state.music ? ' and music' : ''}.`));
    // Failure: clear, non-blocking, with Retry. Captions-only export still works.
    els.voiceState.innerHTML = on && state.voiceError && !state.voiceMaking
      ? `<div class="rm-voicefail">${ICON.warn}<div><p><b>The voiceover didn't record.</b> ${esc(state.voiceError)}</p><span>You can still export with captions only.</span></div><button class="es-btn es-btn--sm" type="button" data-voice-retry>Retry</button></div>`
      : '';
    // ── Reels 2.0: D (interface) ── before a reel exists the rail's Voice row names the voice it will use.
    if (!state.plan && on) { els.voiceBadge.className = 'es-badge es-badge--brand'; els.voiceBadge.textContent = ((v.voices || []).find(x => x.id === state.voiceId) || {}).name || 'AI voice'; }
    els.voiceBtn.hidden = !on || all || state.voiceMaking || Boolean(state.voiceError) || !state.plan;
    els.voiceBtn.disabled = Boolean(state.busy) || !withVo || all;
    els.voiceBtn.textContent = voiced ? 'Voice the edited lines' : 'Make the voiceover';
  }
  els.voiceState.addEventListener('click', event => { if (event.target.closest('[data-voice-retry]')) { state.voiceError = ''; makeVoice({ auto: false }); } });
  function audioContext() {
    if (!state.ac) state.ac = new (window.AudioContext || window.webkitAudioContext)();
    return state.ac;
  }
  const b64ToBytes = b64 => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i); return out; };
  // Voices every line that has no matching clip yet (the per-line cache makes
  // unchanged lines free). Returns { made, reused, failed }.
  let voiceRun = null;
  async function makeVoice({ auto = false } = {}) {
    if (!state.plan || !state.config.voice.ready || !state.voiceOn) return { made: 0, reused: 0, failed: '' };
    if (ownVoice() || window.ReelMakerCtx?.modules.voiceInput?.pending()) return { made: 0, reused: 0, failed: '' }; // ── Reels 2.0: C (inputs) ── never bill an AI voice over the person's own
    if (voiceRun) return voiceRun;
    voiceRun = (async () => {
      state.voiceMaking = true;
      state.voiceError = '';
      const voiceId = state.voiceId;
      const beats = state.plan.beats.filter(b => (b.vo || '').trim() && !(esOn() && ES.blockOf(b).type === 'endcard') && !(state.voice[b.id] && state.voice[b.id].text === b.vo && state.voice[b.id].voiceId === voiceId));
      const bar = els.voiceProgress.querySelector('span');
      els.voiceProgress.hidden = false;
      bar.style.width = '4%';
      renderVoice();
      let done = 0;
      let made = 0;
      let reused = 0;
      let failed = '';
      const ac = audioContext();
      for (const beat of beats) {
        const hook = state.plan.beats.indexOf(beat) === 0;
        const key = `${state.config.voice.mode}|${state.config.voice.model}|${voiceId}|${hook ? 'h' : ''}|${beat.vo}`;
        els.writeStatus.textContent = auto ? `Recording the voiceover… ${done + 1} of ${beats.length}` : '';
        try {
          let rec = await VoiceCache.get(key);
          if (!rec) {
            const data = await api({ mode: 'voice', text: ES ? ES.plainVo(beat.vo) : beat.vo, beat: beat.id, voice: voiceId, hook });
            state.spent.voice += Number(data.cost) || 0;
            if (data.alignedBy) state.alignedBy = data.alignedBy;
            rec = { bytes: b64ToBytes(data.audio).buffer, mime: data.mime, words: data.words || [], model: data.model };
            VoiceCache.set(key, rec);
            made += 1;
          } else reused += 1;
          const buffer = await ac.decodeAudioData(rec.bytes.slice(0));
          const asset = `vo:${beat.id}`;
          state.buffers[asset] = buffer;
          const name = (state.config.voice.voices || []).find(x => x.id === voiceId)?.name || 'ES house voice';
          state.assets[asset] = {
            kind: 'vo', label: `Voiceover, beat ${state.plan.beats.indexOf(beat) + 1}`,
            rights: { source: state.config.voice.mode === 'elevenlabs' ? 'ElevenLabs direct (ES house voice)' : `Vercel AI Gateway, ${rec.model || state.config.voice.model} (${name}, an ElevenLabs library voice)`, licence: 'AI voice, not a clone of any person; commercial use under the provider terms', organic: true, paid: true },
          };
          state.voice[beat.id] = { text: beat.vo, voiceId, durationMs: Math.round(buffer.duration * 1000), words: rec.words, asset };
        } catch (error) {
          failed = error.message || 'The voiceover could not be made.';
          if (error.status === 429 || error.reason === 'budget' || error.status === 503 || error.offline) break;
        }
        done += 1;
        bar.style.width = `${Math.round((done / Math.max(1, beats.length)) * 100)}%`;
      }
      state.voiceMaking = false;
      state.voiceError = failed;
      setTimeout(() => { els.voiceProgress.hidden = true; }, 600);
      if (auto) els.writeStatus.textContent = '';
      rebuild();
      renderBeats();
      renderVoice();
      if (failed && !auto) toast(failed, { tone: 'error', action: { label: 'Retry', run: () => { state.voiceError = ''; makeVoice(); } } });
      else if (!failed && made && !auto) toast('Voiceover updated. Captions follow the voice word by word.');
      if (beats.length) logEvent('voice', { beats: beats.length, made, reused, failed: Boolean(failed), mode: state.config.voice.mode, voice: voiceId, model: state.config.voice.model });
      return { made, reused, failed };
    })();
    try { return await voiceRun; } finally { voiceRun = null; }
  }
  // Edited lines are re-voiced after a pause in typing; always before play and export.
  let voiceTimer = 0;
  function voiceSoon(ms = 1800) {
    clearTimeout(voiceTimer);
    if (!state.config.voice.ready || !state.voiceOn) return;
    voiceTimer = setTimeout(() => { makeVoice(); }, ms);
  }
  async function ensureVoice() {
    clearTimeout(voiceTimer);
    if (!state.config.voice.ready || !state.voiceOn || state.voiceError) return;
    const { withVo, voiced } = voiceCounts();
    if (voiced < withVo) await makeVoice();
  }
  els.voiceBtn.addEventListener('click', () => makeVoice());
  els.capstyle.addEventListener('click', event => {
    const btn = event.target.closest('[data-cap]');
    if (!btn) return;
    state.captionStyle = btn.dataset.cap;
    radios(els.capstyle, 'cap', state.captionStyle);
    rebuild();
  });

  // ─── Music ───────────────────────────────────────────────────────────────
  // Optional generated bed (REELS_MUSIC=gateway): organic-only rights.
  async function generateMusic() {
    if (!state.timeline || state.busy) return;
    const btn = $('rm-music-gen');
    state.busy = 'music';
    setBusy(btn, btn.querySelector('span'), true, 'Making the music…');
    try {
      const seconds = Math.min(60, Math.ceil(state.timeline.durationMs / 1000) + 1);
      const data = await api({ mode: 'music', mood: $('rm-music-mood').value, seconds });
      state.spent.music = (state.spent.music || 0) + (Number(data.cost) || 0);
      const bytes = b64ToBytes(data.audio).buffer;
      const buffer = await audioContext().decodeAudioData(bytes);
      await setMusic({ buffer, title: `Generated ${data.mood} bed`, source: 'generated' });
      state.assets.music.rights = { ...data.rights };
      els.licence.hidden = true;
      rebuild();
      toast('Music bed ready. It is cleared for organic posts only.');
    } catch (error) {
      toast(error.message, { tone: 'error' });
    } finally {
      state.busy = '';
      setBusy(btn, btn.querySelector('span'), false, 'Generate a music bed');
    }
  }

  async function loadMusicLibrary() {
    state.musicLibrary = [];
    for (const file of F.MUSIC_FILES || ['reels-music.json']) {
      try {
        const response = await fetch(file, { cache: 'no-cache' });
        if (!response.ok) continue;
        const tracks = F.musicTracks ? F.musicTracks(await response.json()) : [];
        if (tracks.length) { state.musicLibrary = tracks; break; }
      } catch { /* try the next file */ }
    }
    els.musicPick.innerHTML = `<option value="">No music</option>${state.musicLibrary.map(t => `<option value="${esc(t.id)}">${esc(t.title)}${t.artist ? ` · ${esc(t.artist)}` : ''}</option>`).join('')}${state.music?.source === 'upload' ? `<option value="__upload" selected>${esc(state.music.title)} (uploaded)</option>` : ''}`;
    els.musicPick.disabled = false;
    if (!state.musicLibrary.length) $('rm-music-hint').textContent = 'The ES music library is empty for now. Upload a track you have the rights to. It sits under the voice, 14 dB down.';
  }
  async function setMusic({ buffer, title, source, licence = '', paid = false }) {
    state.buffers.music = buffer;
    state.music = { title, source };
    state.assets.music = { kind: 'music', label: `Music: ${title}`, rights: { source: source === 'library' ? 'ES music library' : 'Uploaded by you', licence, organic: Boolean(licence), paid: Boolean(licence) && paid } };
    els.musicName.textContent = title;
    els.musicMeta.textContent = title;
    els.licence.hidden = source !== 'upload';
    if (source === 'upload') { els.licenceNote.value = licence; els.licencePaid.checked = paid; }
    rebuild();
    renderVoice();
  }
  els.musicPick.addEventListener('change', async () => {
    const id = els.musicPick.value;
    if (!id) { state.music = null; delete state.assets.music; delete state.buffers.music; els.musicName.textContent = ''; els.musicMeta.textContent = 'None'; els.licence.hidden = true; rebuild(); return; }
    if (id === '__upload') return;
    const track = state.musicLibrary.find(t => t.id === id);
    try {
      const bytes = await (await fetch(track.src)).arrayBuffer();
      const buffer = await audioContext().decodeAudioData(bytes);
      setMusic({ buffer, title: track.title, source: 'library', licence: track.licence, paid: track.paid === true });
      state.assets.music.rights.organic = track.organic === true;
      rebuild();
    } catch { toast('That track could not be loaded.', { tone: 'error' }); }
  });
  els.musicFile.addEventListener('change', async () => {
    const file = els.musicFile.files[0];
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { toast('That file is too large. Keep it under 40 MB.', { tone: 'error' }); return; }
    try {
      const buffer = await audioContext().decodeAudioData(await file.arrayBuffer());
      await setMusic({ buffer, title: file.name.replace(/\.[^.]+$/, '').slice(0, 60), source: 'upload' });
      loadMusicLibrary();
      els.licenceNote.focus();
      toast('Add the track’s licence to export with it.');
    } catch { toast('That audio file could not be read.', { tone: 'error' }); }
    els.musicFile.value = '';
  });
  const updateLicence = () => {
    if (!state.assets.music || state.music?.source === 'library') return;
    const licence = els.licenceNote.value.trim();
    state.assets.music.rights = { ...state.assets.music.rights, licence, organic: Boolean(licence), paid: Boolean(licence) && els.licencePaid.checked };
    rebuildSoon();
  };
  els.licenceNote.addEventListener('input', updateLicence);
  els.licencePaid.addEventListener('change', updateLicence);

  // ─── Sources ─────────────────────────────────────────────────────────────
  function renderSources() {
    els.sourcesMeta.textContent = state.sources.length ? `${state.sources.length}` : '';
    els.sourcesList.innerHTML = state.sources.length ? state.sources.map(s => `<li><span class="rm-src__type">${esc({ brief: 'Brief', trend: 'Trend', news: 'News', 'fact-check': 'Fact check', script: 'Script' }[s.type] || 'Source')}</span>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}${ICON.link}</a>` : `<span>${esc(s.title)}</span>`}</li>`).join('') : '<li class="rm-hint">No sources yet.</li>';
  }
  els.extraSource.addEventListener('input', debounce(() => { state.extraSource = els.extraSource.value; rebuild(); }, 300));

  // ─── Audio mix (Web Audio, offline: the same mix for preview and export) ─
  async function renderMix() {
    const tl = state.timeline;
    const clips = tl.tracks.audio.filter(a => state.buffers[a.asset]);
    if (!clips.length) return null;
    if (state.mix && state.mixFor === tl) return state.mix;
    const rate = 48000;
    const off = new OfflineAudioContext(2, Math.ceil((tl.durationMs / 1000) * rate), rate);
    clips.forEach(clip => {
      const src = off.createBufferSource();
      src.buffer = state.buffers[clip.asset];
      const gain = off.createGain();
      if (clip.kind === 'music' || (clip.kind === 'clip' && clip.envelope)) {
        if (clip.kind === 'music') src.loop = src.buffer.duration < tl.durationMs / 1000;
        else if (clip.loopEndSec > (clip.offsetSec || 0) + 0.5 && clip.loopEndSec <= src.buffer.duration) { src.loop = true; src.loopStart = clip.offsetSec || 0; src.loopEnd = clip.loopEndSec; }
        const env = clip.envelope || [];
        gain.gain.setValueAtTime(R.dbToGain(env[0]?.db ?? -60), 0);
        env.forEach(p => gain.gain.linearRampToValueAtTime(R.dbToGain(p.db), p.t / 1000));
      } else {
        gain.gain.value = R.dbToGain(clip.gainDb || 0);
      }
      src.connect(gain).connect(off.destination);
      if (clip.kind === 'clip') src.start(clip.inMs / 1000, Math.min(clip.offsetSec || 0, Math.max(0, src.buffer.duration - 0.05)), (clip.durMs || 0) / 1000);
      else src.start(clip.inMs / 1000);
    });
    // A gentle limiter so VO peaks stay under -1 dBTP.
    const mix = await off.startRendering();
    let peak = 0;
    for (let c = 0; c < mix.numberOfChannels; c += 1) { const d = mix.getChannelData(c); for (let i = 0; i < d.length; i += 64) peak = Math.max(peak, Math.abs(d[i])); }
    const ceiling = 0.89; // -1 dBFS
    if (peak > ceiling) for (let c = 0; c < mix.numberOfChannels; c += 1) { const d = mix.getChannelData(c); for (let i = 0; i < d.length; i += 1) d[i] *= ceiling / peak; }
    state.mix = mix;
    state.mixFor = tl;
    return mix;
  }

  // ─── Preview ─────────────────────────────────────────────────────────────
  // Clips follow the preview clock: playing, they run and are nudged back when
  // they drift; paused or scrubbing, they seek and the frame redraws.
  let redrawQueued = false;
  const redrawSoon = () => { if (redrawQueued) return; redrawQueued = true; requestAnimationFrame(() => { redrawQueued = false; draw(); }); };
  function syncClips(t, playing) {
    const want = state.timeline ? R.clipTimes(state.timeline, t) : [];
    const active = new Set(want.map(w => w.asset));
    Object.entries(state.videos).forEach(([id, v]) => { if (!active.has(id) && !v.paused) v.pause(); });
    want.forEach(({ asset, time }) => {
      const v = state.videos[asset];
      if (!v) return;
      if (playing) {
        if (v.paused) { try { v.currentTime = time; } catch { /* not ready */ } v.play().catch(() => {}); } else if (Math.abs(v.currentTime - time) > 0.35) v.currentTime = time;
      } else if (Math.abs(v.currentTime - time) > 0.04) {
        if (!v.paused) v.pause();
        v.currentTime = time;
        v.addEventListener('seeked', redrawSoon, { once: true });
      }
    });
  }
  // Export: every clip on screen shows exactly its frame before drawing.
  async function seekClipsExact(t) {
    const want = state.timeline ? R.clipTimes(state.timeline, t) : [];
    await Promise.all(want.map(({ asset, time }) => {
      const v = state.videos[asset];
      if (!v || Math.abs(v.currentTime - time) < 0.5 / 30) return null;
      return new Promise(resolve => {
        const timer = setTimeout(resolve, 1000);
        v.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
        v.currentTime = time;
      });
    }));
  }
  function draw() {
    if (state.view === 'carousel' && state.timeline) { drawSlide(); return; }
    if (!state.timeline) {
      ctx.fillStyle = '#101114';
      ctx.fillRect(0, 0, 1080, 1920);
      return;
    }
    if (!state.exporting) syncClips(state.t, state.playing);
    // ── Reels 2.0: D (interface) ── a calm preview cuts between scenes (no wipe). Exports draw their own frames.
    const tDraw = state.calm && A11Y ? A11Y.calmTime(state.timeline, state.t, wipeMs()) : state.t;
    R.drawFrame(ctx, state.timeline, tDraw, env);
    const d = state.timeline.durationMs;
    els.scrub.value = String(Math.round((state.t / d) * 1000));
    els.scrub.style.setProperty('--p', `${Math.min(100, (state.t / d) * 100).toFixed(2)}%`);
    const scene = sceneAt(state.t);
    els.scrub.setAttribute('aria-valuetext', A11Y && state.plan ? A11Y.valueText({ t: state.t, index: scene, total: state.plan.beats.length, name: state.plan.beats[scene] ? beatName(state.plan.beats[scene]) : '' }) : fmtTime(state.t));
    els.time.textContent = `${fmtTime(state.t)} / ${fmtTime(d)}`;
    if (scene !== state.scene) { state.scene = scene; emit('scene', { index: scene, id: state.plan && state.plan.beats[scene] ? state.plan.beats[scene].id : '' }); }
    emit('time', { t: state.t });
  }
  // The scene on screen at t (the beat whose time holds t).
  function sceneAt(t) {
    const beats = state.timeline ? state.timeline.beats : [];
    let at = 0;
    beats.forEach((b, i) => { if (t >= b.inMs) at = i; });
    return at;
  }
  // The length of this style's cut between scenes (0 when it has none).
  function wipeMs() {
    const st = S.get(styleId());
    return st.engine !== 'classic' && ['slide', 'wipe', 'flip', 'slab'].includes(st.motion.transition) ? (st.motion.transitionMs || 0) : 0;
  }
  let raf = 0;
  let playSource = null;
  let playGain = null;
  let clock = null;
  async function play() {
    if (!state.timeline) return;
    if (state.t >= state.timeline.durationMs - 40) state.t = 0;
    state.playing = true;
    els.play.classList.add('is-playing');
    els.play.setAttribute('aria-label', 'Pause');
    // The preview speaks: edited lines are voiced first.
    if (voiceCounts().voiced < voiceCounts().withVo && state.voiceOn && state.config.voice.ready && !state.voiceError) {
      els.stageMeta.textContent = 'Recording the voiceover for the edited lines…';
      await ensureVoice();
      renderMeta();
      if (!state.playing) return;
    }
    const mix = await renderMix().catch(() => null);
    if (!state.playing) return;
    const ac = audioContext();
    await ac.resume().catch(() => {});
    const offset = state.t / 1000;
    if (mix) {
      playSource = ac.createBufferSource();
      playSource.buffer = mix;
      playGain = ac.createGain();
      playGain.gain.value = els.mute.getAttribute('aria-pressed') === 'true' ? 0 : 1;
      playSource.connect(playGain).connect(ac.destination);
      playSource.start(0, offset);
      clock = { audio: true, start: ac.currentTime - offset };
    } else {
      clock = { audio: false, start: performance.now() - state.t };
    }
    const tick = () => {
      if (!state.playing) return;
      state.t = clock.audio ? (audioContext().currentTime - clock.start) * 1000 : performance.now() - clock.start;
      if (state.t >= state.timeline.durationMs) { state.t = state.timeline.durationMs - 1; draw(); stop(); return; }
      draw();
      raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function stop() {
    state.playing = false;
    cancelAnimationFrame(raf);
    try { playSource?.stop(); } catch { /* already stopped */ }
    playSource = null;
    Object.values(state.videos).forEach(v => { try { v.pause(); } catch { /* fine */ } });
    els.play.classList.remove('is-playing');
    els.play.setAttribute('aria-label', 'Play');
  }
  function seek(t) {
    const was = state.playing;
    stop();
    state.t = Math.max(0, Math.min((state.timeline?.durationMs || 1) - 1, t));
    draw();
    if (was) play();
  }
  els.play.addEventListener('click', () => (state.playing ? stop() : play()));
  els.scrub.addEventListener('input', () => { if (state.timeline) seek((Number(els.scrub.value) / 1000) * state.timeline.durationMs); });
  els.mute.addEventListener('click', () => {
    const on = els.mute.getAttribute('aria-pressed') !== 'true';
    els.mute.setAttribute('aria-pressed', String(on));
    els.mute.setAttribute('aria-label', on ? 'Unmute preview' : 'Mute preview');
    if (playGain) playGain.gain.value = on ? 0 : 1;
  });
  els.safeToggle.addEventListener('click', () => {
    const on = els.safeToggle.getAttribute('aria-pressed') !== 'true';
    els.safeToggle.setAttribute('aria-pressed', String(on));
    els.safe.hidden = !on;
    syncSafe();
  });
  // ES Reels: the ES safe frame (no words above y 300, within 40 px of the
  // sides, or below y 1640), the caption line (y 1172) and the ES mark's spot.
  function syncSafe() {
    const es = esOn();
    els.safe.classList.toggle('rm-safe--es', es);
    const label = els.safe.querySelector('span');
    if (label) label.textContent = es ? 'Safe frame' : 'Safe zone';
  }
  document.addEventListener('keydown', event => {
    if (event.key !== ' ' || event.target.closest('input, textarea, select, button, [contenteditable], dialog')) return;
    if (!state.timeline) return;
    event.preventDefault();
    if (state.playing) stop(); else play();
  });

  // ─── ES video guidelines (the ES video team's system, in plain English) ──
  function openGuide(event) {
    if (!els.guide || !ES) return;
    if (!els.guideBody.childElementCount) {
      els.guideBody.innerHTML = ES.GUIDELINES.map(sec => `<section class="rm-guide__sec"><h3>${esc(sec.title)}</h3><ul>${sec.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>`).join('');
    }
    els.guide.showModal();
    if (event) logEvent('edit', { what: 'es-guidelines' });
  }
  document.querySelectorAll('[data-open-guide]').forEach(btn => btn.addEventListener('click', openGuide));

  // ─── Step 3: Export ──────────────────────────────────────────────────────
  els.aspect?.addEventListener('click', event => {
    const btn = event.target.closest('[data-aspect]');
    if (!btn) return;
    state.aspect = btn.dataset.aspect === '4:5' ? '4:5' : '9:16';
    radios(els.aspect, 'aspect', state.aspect);
    // ── Reels 2.0: D (interface) ── the preview and the storyboard show the size that exports.
    if (state.plan) { rebuild(); if (!state.lint.ok && state.aspect === '4:5') toast('The 4:5 version needs a fix before it exports. See the quality checks.'); }
    logEvent('edit', { what: 'size', aspect: state.aspect });
  });
  // The transport's size button flips the same choice as Details › Size.
  els.size?.addEventListener('click', () => { els.aspect?.querySelector(`[data-aspect="${state.aspect === '4:5' ? '9:16' : '4:5'}"]`)?.click(); renderMeta(); });
  els.target.addEventListener('click', event => {
    const btn = event.target.closest('[data-target]');
    if (!btn) return;
    state.target = btn.dataset.target;
    radios(els.target, 'target', state.target);
    rebuild();
  });
  function renderExport() {
    if (!state.timeline) return;
    renderRail();
    // ── Reels Studio v3 (UI) ── one Export (the size on screen), plus "Also export": the other size, caption files, a carousel.
    const both = esOn() && !(F.isDataFormat && F.isDataFormat(state.plan.format));
    const is45 = Boolean(state.timeline.size && state.timeline.size[1] === 1350);
    const size = (state.timeline.size || [1080, 1920]).join('×');
    els.exportText.textContent = state.exporting && !state.exportingAll ? 'Cancel export' : `Export MP4 · ${is45 ? '4:5' : '9:16'}`;
    els.exportWhat.textContent = `${size}, ${(state.timeline.durationMs / 1000).toFixed(0)} s${state.config.voice.ready && state.voiceOn ? ', with the voiceover' : ''}${state.music ? ' and music' : ''}. Made in your browser.`;
    els.export45.hidden = !both;
    if (!state.exportingAll) els.export45Text.textContent = is45 ? 'Reel 9:16 MP4' : 'Feed 4:5 MP4';
    els.exportCaptions.hidden = !mods().captions;
    // One row per kind of asset with the same rights (6 voiceover clips = 1 row).
    const KIND_PLURAL = { photo: 'ES photos', vo: 'Voiceover clips', logo: 'Logos', graphic: 'Graphics', clip: 'Official X clips', scene: 'AI scenes', tile: 'Team graphics' };
    const groups = new Map();
    L.rightsSummary(state.timeline, state.target).forEach(row => {
      // X clips group into one row; each keeps its source link.
      const x = row.kind === 'clip' && /^Official X post/.test(row.source);
      const key = x ? `clip|x|${row.covered}` : [row.kind, row.source, row.licence, row.covered, row.paid].join('|');
      const g = groups.get(key);
      if (g) { g.n += 1; g.credits.add(row.credit); g.links.add(state.timeline.assets[row.id]?.post || ''); } else groups.set(key, { ...row, source: x ? 'Official X posts' : row.source, n: 1, credits: new Set([row.credit]), links: new Set([x ? state.timeline.assets[row.id]?.post || '' : '']) });
    });
    const rows = [...groups.values()].map(g => ({ ...g, label: g.n > 1 ? `${KIND_PLURAL[g.kind] || g.label} (${g.n})` : g.label, credit: [...g.credits].filter(Boolean).join(', '), links: [...g.links].filter(Boolean) }));
    els.rights.innerHTML = `<ul class="rm-rights__list">${rows.map(r => `<li class="${r.covered ? 'is-ok' : 'is-bad'}"><span class="rm-rights__mark">${r.covered ? ICON.check : ICON.x}<span class="es-sr-only">${r.covered ? 'Cleared' : 'Not cleared'}</span></span><div><p>${esc(r.label)}</p><span>${esc(r.source)} · ${esc(r.licence)}${r.credit ? ` · Credit: ${esc(r.credit)}` : ''}</span>${r.links.length ? `<span class="rm-rights__links">${r.links.map((u, k) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Source ${k + 1}</a>`).join(' · ')}</span>` : ''}</div><span class="rm-rights__use">${r.paid ? 'Organic + paid' : (r.organic ? 'Organic only' : 'Not cleared')}</span></li>`).join('')}</ul>
      <p class="rm-hint">Clips come only from official team, league and network posts on X, or your uploads; ES clears X clips for organic posts and Meta paid ads (keep the source links). ES photos are editorial: confirm before paid use.</p>`;
    const lint = state.lint;
    const critical = lint.issues.filter(i => i.severity === 'critical');
    els.gate.innerHTML = critical.length
      ? `<div class="rm-gate__bad">${ICON.alert}<div><p><b>${critical.length} ${critical.length > 1 ? 'things block' : 'thing blocks'} the export</b></p><ul>${critical.map(i => `<li>${esc(i.message)}</li>`).join('')}</ul><button class="es-btn es-btn--sm" type="button" id="rm-fix">Fix in Review</button></div></div>`
      : `<div class="rm-gate__ok">${ICON.check}<p><b>Ready to export.</b> ${lint.warnings ? `${lint.warnings} suggestion${lint.warnings > 1 ? 's' : ''} in Quality checks.` : 'Every check passes.'}</p></div>`;
    $('rm-fix')?.addEventListener('click', () => { goStep('edit'); els.lint.hidden = false; els.ready.setAttribute('aria-expanded', 'true'); els.lint.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    renderSpend();
    const busy = Boolean(state.exporting && !state.exporting.cancel) || Boolean(state.exportingAll);
    els.exportBtn.disabled = Boolean(critical.length) || busy;
    els.export45.disabled = Boolean(critical.length) || Boolean(state.exporting && !state.exportingAll);
    els.rightsMeta.textContent = rows.every(r => r.covered) ? (state.target === 'paid' ? 'Cleared for paid' : 'Cleared for organic') : `${rows.filter(r => !r.covered).length} not cleared`;
    if (rows.some(r => !r.covered)) $('rm-rights').open = true;
    if (G && TL) renderDataExport();
  }
  // What this reel has spent so far (the rail's Cost row).
  function renderSpend() {
    if (!state.plan) return;
    const est = F.estimateCost({ tier: state.tier, voiceMode: state.config.voice.ready ? state.config.voice.mode : 'off', voChars: voChars() });
    const voiceLeft = state.config.voice.ready && !state.spent.voice && !Object.keys(voiceFor()).length ? est.lines.find(l => l.id === 'voice').usd : 0;
    els.spend.innerHTML = `<p class="rm-cost__title">Spent on this reel <b>${F.money(totalSpent())}</b></p><ul class="rm-spend__list">
      <li><span>Script</span><span>${F.money(state.spent.director)}</span></li>
      ${state.spent.factCheck ? `<li><span>Fact check</span><span>${F.money(state.spent.factCheck)}</span></li>` : ''}
      ${state.spent.revise ? `<li><span>Revisions</span><span>${F.money(state.spent.revise)}</span></li>` : ''}
      ${state.spent.music ? `<li><span>Generated music</span><span>${F.money(state.spent.music)}</span></li>` : ''}
      <li><span>Voiceover</span><span>${state.spent.voice ? F.money(state.spent.voice) : (voiceLeft ? `≈ ${F.money(voiceLeft)} if you add it` : '$0')}</span></li>
      ${G && TL ? dataSpendRows() : ''}
      <li><span>Render and export</span><span>$0 (in your browser)</span></li></ul>`;
  }
  function dataSpendRows() {
    const fmt = state.plan && F.isDataFormat(state.plan.format) ? state.plan.format : '';
    if (!fmt) return '';
    const rows = [];
    if (fmt === 'gameswing') rows.push(['Game data', 'Free']);
    if (fmt === 'archive') rows.push(['ES articles, photos and stats', state.spent.archive ? F.money(state.spent.archive) : 'Free']);
    if (fmt === 'replay') rows.push(['Frame pick', state.spent.framePick ? F.money(state.spent.framePick) : 'Free (code pick)']);
    return rows.map(([a, b]) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`).join('');
  }

  function pickRecorderFormat() {
    const options = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
    return options.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }
  async function ensureImages() {
    await document.fonts.ready;
    await Promise.all([
      document.fonts.load(`700 120px ${R.CONDENSED}`).catch(() => {}),
      document.fonts.load('800 120px "Roboto Condensed"').catch(() => {}),
      document.fonts.load('700 50px Roboto').catch(() => {}),
      document.fonts.load('600 48px Roboto').catch(() => {}),
      document.fonts.load('500 44px Roboto').catch(() => {}),
    ]);
    measureCache.clear();
    layoutCache = new Map();
    captionCache = new Map();
  }
  // Frame-exact export: WebCodecs (H.264 + AAC) muxed by Mediabunny.
  async function encodeWebCodecs(tl, mix, onProgress, job) {
    if (typeof window.VideoEncoder !== 'function') throw new Error('no-webcodecs');
    const MB = await import(MEDIABUNNY);
    const [cw, ch] = tl.size || [1080, 1920];
    if (!(await MB.canEncodeVideo('avc', { width: cw, height: ch }))) throw new Error('no-avc');
    if (mix && !(await MB.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 }))) throw new Error('no-aac');
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const c = canvas.getContext('2d');
    job.cancel = async () => { job.cancelled = true; };
    Object.values(state.videos).forEach(v => { try { v.pause(); } catch { /* fine */ } });
    const out = await X.encodeMediabunny({ MB, canvas, durationMs: tl.durationMs, mix, fps: 30, onProgress, job, prepare: seekClipsExact, draw: t => R.drawFrame(c, tl, t, envFor(tl)) });
    return { blob: new Blob([out.buffer], { type: 'video/mp4' }), ext: 'mp4', how: 'webcodecs', hasAudio: out.hasAudio };
  }
  // Fallback: the Video Ads path, real time (MediaRecorder).
  async function recordRealtime(tl, mix, onProgress, job) {
    const mimeType = pickRecorderFormat();
    if (!mimeType) throw new Error('This browser cannot record video. Use Chrome or Edge.');
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = tl.size || [1080, 1920];
    const c = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    const ac = audioContext();
    await ac.resume();
    const src = X.attachAudio(stream, ac, mix);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12e6, audioBitsPerSecond: 192000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    R.drawFrame(c, tl, 0, envFor(tl));
    recorder.start(500);
    const t0 = ac.currentTime + 0.06;
    if (src) src.start(t0);
    job.cancel = () => { job.cancelled = true; };
    await new Promise(resolve => {
      const tick = () => {
        const t = (ac.currentTime - t0) * 1000;
        if (job.cancelled || t >= tl.durationMs) { resolve(); return; }
        syncClips(Math.max(0, t), true);
        R.drawFrame(c, tl, Math.max(0, t), envFor(tl));
        onProgress(t / tl.durationMs);
        requestAnimationFrame(tick);
      };
      tick();
    });
    try { src?.stop(); } catch { /* ended */ }
    Object.values(state.videos).forEach(v => { try { v.pause(); } catch { /* fine */ } });
    recorder.stop();
    await stopped;
    const hasAudio = stream.getAudioTracks().length > 0;
    stream.getTracks().forEach(t => t.stop());
    if (job.cancelled) throw new Error('cancelled');
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), ext, how: 'realtime', hasAudio };
  }
  const slug = text => String(text || 'reel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'reel';
  // ── Reels 2.0: D (interface) ── Export: one MP4 in the size on screen, or
  // "Export all": the reel in 9:16 and 4:5 plus the caption files, in one zip.
  let fileUrl = '';
  const saveFile = (url, name) => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); setTimeout(() => a.remove(), 1000); };
  const sizeOf = tl => (tl.size || [1080, 1920]);
  // The timeline for one size, checked again before it is encoded (the ES rules, scaled).
  function timelineFor(aspect) {
    const now = sizeOf(state.timeline)[1] === 1350 ? '4:5' : '9:16';
    if (aspect === now) return { tl: state.timeline, lint: state.lint };
    const tl = R.buildTimeline(state.plan, buildOptions({ aspect }));
    return { tl, lint: L.lintTimeline(tl, { boxes: R.textBoxes(measure, tl), measure, target: state.target, extraSources: els.extraSource.value }) };
  }
  // Encodes one timeline: frame-exact MP4 first, real-time recording as the fallback.
  async function encodeTimeline(tl, mix, progress, job) {
    try {
      els.exportStatus.textContent = `Encoding MP4 ${sizeOf(tl).join('×')} (frame by frame)…`;
      return await encodeWebCodecs(tl, mix, progress, job);
    } catch (error) {
      if (error.message === 'cancelled') throw error;
      els.exportStatus.textContent = 'Recording in real time. Keep this tab open and visible.';
      return recordRealtime(tl, mix, progress, job);
    }
  }
  const exportName = (tl, ext) => `es-reel-${slug(state.plan.title)}-${sizeOf(tl).join('x')}.${ext}`;
  // Brings the voice up to date and checks the reel. False when it cannot export yet.
  async function readyToExport() {
    if (state.voiceOn && state.config.voice.ready && !state.voiceError) {
      els.exportStatus.textContent = 'Recording the voiceover for the edited lines…';
      await ensureVoice();
    }
    rebuild();
    if (!state.lint.ok) { renderExport(); logEvent('lint_blocked', { issues: state.lint.issues.filter(i => i.severity === 'critical').map(i => i.id) }); return false; }
    stop();
    return true;
  }
  function exportUi(job, all) {
    state.exporting = job;
    state.exportingAll = Boolean(job && all);
    const bar = els.exportProgress.querySelector('span');
    if (job) {
      els.exportProgress.hidden = false;
      bar.style.width = '0%';
      els.files.hidden = true;
      (all ? els.export45Text : els.exportText).textContent = 'Cancel export';
      (all ? els.export45 : els.exportBtn).classList.add('es-btn--danger');
      (all ? els.exportBtn : els.export45).disabled = true;
      els.exportStatus.textContent = 'Preparing fonts, photos and audio…';
    } else {
      els.exportBtn.classList.remove('es-btn--danger');
      els.export45.classList.remove('es-btn--danger');
      setTimeout(() => { els.exportProgress.hidden = true; }, 800);
      renderExport();
      draw();
    }
    return p => { bar.style.width = `${Math.min(100, Math.round(p * 100))}%`; };
  }
  const audioLine = (result, tl) => (result.hasAudio ? (X.mixPlan(tl, state.buffers).vo ? ' with the voiceover' : ' with music') : ' with captions only (no audio)');
  const aiLine = tl => (L.usedAssets(tl).some(id => tl.assets[id]?.rights?.ai) ? 'It has AI-generated scenes: turn on the platform’s AI label when you post.' : 'No AI-generated video in it.');
  async function exportReel() {
    if (state.exporting) { state.exporting.cancel?.(); return; }
    if (!await readyToExport()) return;
    const tl = state.timeline;
    const job = { cancelled: false };
    const progress = exportUi(job, false);
    try {
      await ensureImages();
      const mix = await renderMix();
      const plan = X.mixPlan(tl, state.buffers);
      if (plan.missingVo && state.voiceOn && state.config.voice.ready) els.exportStatus.textContent = `${plan.missingVo} line${plan.missingVo > 1 ? 's have' : ' has'} no voice yet; exporting with captions for ${plan.missingVo > 1 ? 'them' : 'it'}.`;
      const result = await encodeTimeline(tl, mix, progress, job);
      progress(1);
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      fileUrl = URL.createObjectURL(result.blob);
      const name = exportName(tl, result.ext);
      saveFile(fileUrl, name);
      feedback('export', { after: { format: result.ext, seconds: Math.round(tl.durationMs / 1000), clips: clipCount() } });
      rankKept();
      window.FrameUpTrack?.exported?.({ tool: 'reels-studio', format: result.ext, dest: 'download', label: name, width: (tl.size || [1080, 1920])[0], height: (tl.size || [1080, 1920])[1], bytes: result.blob.size, seconds: Math.round(tl.durationMs / 1000), template: state.plan.format, thumb: els.canvas, meta: { audio: Boolean(result.hasAudio), esStyle: curStyle() } });
      els.files.hidden = false;
      els.files.innerHTML = `<li><span class="rm-files__icon">${window.FrameUpMotion ? window.FrameUpMotion.check() : ICON.check}</span><span class="rm-files__name">${esc(name)}</span><span class="rm-meta">${(result.blob.size / 1048576).toFixed(1)} MB · ${(tl.durationMs / 1000).toFixed(1)} s</span><a class="rm-link" href="${fileUrl}" download="${esc(name)}">Download again</a></li>`;
      els.files.querySelector('a[download]')?.addEventListener('click', () => window.FrameUpTrack?.track?.('download', { tool: 'reels-studio', action: 'download-again', label: name }));
      els.exportStatus.textContent = `${result.ext === 'mp4' ? 'Exported' : 'Exported as WebM (this browser can’t make MP4; use Chrome or Edge)'}${audioLine(result, tl)}. ${aiLine(tl)}`;
      state.status = 'exported';
      autosave(true);
      toast('Reel exported', { tone: 'good' });
      logEvent('export', { esStyle: curStyle(), audio: Boolean(result.hasAudio), clipShare: clipShare().share, style: tl.style, how: result.how, ext: result.ext, seconds: Math.round(tl.durationMs / 1000), format: tl.format, beats: tl.beats.length, voice: tl.voice.mode, music: Boolean(state.music), target: state.target, warnings: state.lint.warnings, cost: totalSpent(), size: sizeOf(tl).join('x'), recipe: state.plan.recipe || '', look: state.plan.look || '', version: state.versions ? state.versions[state.version].kind : '' });
    } catch (error) {
      els.exportStatus.textContent = error.message === 'cancelled' ? 'Export cancelled.' : (error.message || 'The export failed. Try again.');
    } finally {
      exportUi(null);
    }
  }
  // "Also export": the reel in the other size (4:5 feed or 9:16), checked again before it encodes.
  async function exportOther() {
    if (state.exporting) { state.exporting.cancel?.(); return; }
    if (!await readyToExport()) return;
    const aspect = sizeOf(state.timeline)[1] === 1350 ? '9:16' : '4:5';
    const x = timelineFor(aspect);
    if (!x.lint.ok) { els.exportStatus.textContent = `The ${aspect} version needs a fix first: ${x.lint.issues.find(i => i.severity === 'critical').message}`; return; }
    const job = { cancelled: false };
    const progress = exportUi(job, true);
    try {
      await ensureImages();
      const mix = await renderMix();
      const result = await encodeTimeline(x.tl, mix, progress, job);
      progress(1);
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      fileUrl = URL.createObjectURL(result.blob);
      const name = exportName(x.tl, result.ext);
      saveFile(fileUrl, name);
      feedback('export', { after: { format: result.ext, size: aspect, clips: clipCount() } });
      window.FrameUpTrack?.exported?.({ tool: 'reels-studio', format: result.ext, dest: 'download', label: name, width: (x.tl.size || [1080, 1920])[0], height: (x.tl.size || [1080, 1920])[1], bytes: result.blob.size, seconds: Math.round(x.tl.durationMs / 1000), template: state.plan.format, thumb: els.canvas, meta: { audio: Boolean(result.hasAudio), size: aspect, esStyle: curStyle() } });
      els.files.hidden = false;
      els.files.insertAdjacentHTML('beforeend', `<li><span class="rm-files__icon">${window.FrameUpMotion ? window.FrameUpMotion.check() : ICON.check}</span><span class="rm-files__name">${esc(name)}</span><span class="rm-meta">${(result.blob.size / 1048576).toFixed(1)} MB · ${(x.tl.durationMs / 1000).toFixed(1)} s</span><a class="rm-link" href="${fileUrl}" download="${esc(name)}">Download again</a></li>`);
      els.exportStatus.textContent = `Exported the ${aspect} version${audioLine(result, x.tl)}. ${aiLine(x.tl)}`;
      state.status = 'exported';
      autosave(true);
      toast(`${aspect} version exported`, { tone: 'good' });
      logEvent('export', { how: 'other-size', ext: result.ext, size: sizeOf(x.tl).join('x'), seconds: Math.round(x.tl.durationMs / 1000), format: x.tl.format, target: state.target, esStyle: curStyle() });
    } catch (error) {
      els.exportStatus.textContent = error.message === 'cancelled' ? 'Export cancelled.' : (error.message || 'The export failed. Try again.');
    } finally {
      exportUi(null);
    }
  }
  els.export45.addEventListener('click', exportOther);
  // Caption files (reel-captions-export.js): SRT, VTT and a transcript, shown under "Also export".
  els.exportCaptions.addEventListener('click', () => {
    const open = els.captionsHost.hidden;
    els.captionsHost.hidden = !open;
    els.exportCaptions.setAttribute('aria-expanded', String(open));
    if (open) els.captionsHost.querySelector('button')?.focus({ preventScroll: true });
  });
  els.exportBtn.addEventListener('click', exportReel);

  // ─── Projects: local first, cloud when the table exists ─────────────────
  function snapshot() {
    const assets = {};
    // Photos, team tiles and clips with a remote source come back on reopen
    // (uploads and AI media live in this tab only).
    Object.entries(state.assets).forEach(([id, a]) => { if (a.kind === 'photo' || a.kind === 'tile' || a.kind === 'design' || (a.kind === 'logo' && id.startsWith('logo:lib:')) || (a.kind === 'clip' && a.remote)) assets[id] = { ...a, src: a.kind === 'clip' ? '' : a.src }; });
    // ── Reels 2.0: C (inputs) ── your own uploads keep their details (the files stay in this browser, reel-media-tray.js).
    Object.entries(state.assets).forEach(([id, a]) => { if (a.local) assets[id] = { ...a, src: '' }; });
    const inputs = window.ReelMakerCtx?.modules || {};
    return {
      id: state.projectId, title: state.plan?.title || 'Untitled reel', format: state.plan?.format || 'explainer', sport: state.plan?.sport || null,
      status: state.status, cost_usd: totalSpent(), updatedAt: Date.now(),
      timeline: {
        v: 1, plan: state.plan, corpus: state.corpus.slice(0, 12000), sources: state.sources, extraSource: els.extraSource.value,
        photos: state.photos, assets, captionStyle: state.captionStyle, target: state.target, spent: state.spent,
        style: state.plan?.style || '', voiceId: state.voiceId, voiceOn: state.voiceOn, visualSrc: state.visualSrc, useClips: state.useClips,
        trend: state.trendRef || null, brief: state.brief || '', planSource: state.planSource,
        music: state.music ? { title: state.music.title, source: state.music.source } : null,
        durationMs: state.timeline?.durationMs || 0,
        ...(inputs.voiceInput?.snapshot() ? { voiceOwn: inputs.voiceInput.snapshot() } : {}),
        ...(inputs.tray?.missing().length ? { mediaMissing: inputs.tray.missing() } : {}),
        ...(G && TL ? dataSnapshot() || {} : {}),
      },
    };
  }
  const saveCloud = debounce(project => {
    if (!state.cloud || state.config.offline) return;
    api({ mode: 'project-save', project: { ...project, updatedAt: undefined } }).then(data => { if (data.cloud === false) state.cloud = false; }).catch(() => { state.cloud = false; });
  }, 4000);
  const autosave = debounce(() => {
    if (!state.plan) return;
    const project = snapshot();
    const list = store.get(LOCAL_KEY, []).filter(p => p.id !== project.id);
    list.unshift(project);
    store.set(LOCAL_KEY, list.slice(0, 12));
    saveCloud(project);
  }, 600);
  function renderRecent() {
    const list = store.get(LOCAL_KEY, []);
    els.recent.hidden = !list.length;
    els.recentList.innerHTML = list.slice(0, 5).map(p => `<li><button class="rm-recent__item" type="button" data-project="${esc(p.id)}"><span class="rm-recent__title">${esc(p.title)}</span><span class="rm-meta">${esc(F.FORMATS[p.format]?.short || '')} · ${p.timeline?.durationMs ? `${Math.round(p.timeline.durationMs / 1000)} s · ` : ''}${p.status === 'exported' ? 'Exported' : 'Draft'}</span></button></li>`).join('');
  }
  els.recentList.addEventListener('click', event => {
    const btn = event.target.closest('[data-project]');
    if (!btn) return;
    const p = store.get(LOCAL_KEY, []).find(x => x.id === btn.dataset.project);
    if (p) restore(p);
  });
  async function restore(p) {
    // v1 and v2 projects both load: normalizeTimeline adds the v2 fields.
    const t = (TL ? TL.normalizeTimeline(p.timeline || {}) : p.timeline) || {};
    if (!t.plan) return;
    stop();
    if (G && TL) { restoreData(t, p.format || t.plan.format); if (state.view !== 'reel') setView('reel'); }
    state.projectId = p.id;
    state.status = p.status || 'draft';
    state.plan = ensureV4(t.plan);
    state.corpus = t.corpus || '';
    state.sources = t.sources || [];
    els.extraSource.value = t.extraSource || '';
    state.photos = t.photos || {};
    Object.assign(state.assets, t.assets || {});
    state.visualSrc = t.visualSrc || {};
    if (t.voiceId) state.voiceId = t.voiceId;
    if (typeof t.voiceOn === 'boolean') state.voiceOn = t.voiceOn;
    // ── Reels 2.0: A (looks) ── a reel saved in a retired style opens in the closest look.
    const lookNote = adoptLook(state.plan, t.style);
    state.look = state.plan.look || 'paper';
    state.esStyle = curStyle();
    state.review = null; state.swapOpen = ''; state.motion = {}; state.serverMotion = {}; state.critic = null;
    if (lookNote) toast(lookNote);
    state.selected = state.plan.beats[0]?.id || '';
    // ── Reels 2.0: C (inputs) ── your uploads come back from this browser first; the ones
    // that are not here are dropped below and asked for again ("Re-add N files").
    const inputs = window.ReelMakerCtx?.modules || {};
    if (inputs.tray && (Object.values(t.assets || {}).some(a => a && a.local) || t.mediaMissing?.length)) await inputs.tray.rehydrate(t);
    // Drop picks whose media is gone (uploads, AI media): those beats refill.
    Object.keys(state.photos).forEach(k => { state.photos[k] = (state.photos[k] || []).filter(id => state.assets[id]); if (!state.photos[k].length) { delete state.photos[k]; delete state.visualSrc[k]; } });
    state.captionStyle = t.captionStyle === 'box' ? 'box' : 'highlight';
    radios(els.capstyle, 'cap', state.captionStyle);
    state.target = t.target === 'paid' ? 'paid' : 'organic';
    radios(els.target, 'target', state.target);
    state.spent = { director: 0, factCheck: 0, revise: 0, voice: 0, ...(t.spent || {}) };
    state.trendRef = t.trend;
    state.brief = t.brief;
    state.planSource = t.planSource || '';
    state.notice = t.music ? `Re-add the music track “${t.music.title}” to export with it.` : '';
    state.voice = {};
    state.versions = null; state.version = 0; state.scene = -1; // ── Reels 2.0: D (interface) ──
    loadTeamLogo();
    rebuild();
    renderEdit();
    syncStart();
    goStep('edit', { focus: false });
    emit('plan', { source: 'restore' }); // ── Reels 2.0: D (interface) ──
    // Photos load again; the voiceover comes back from this browser's cache for free.
    Object.values(state.photos).flat().forEach(id => {
      const a = state.assets[id];
      if (!a || state.images[id] || state.videos[id]) return;
      if (a.kind === 'clip' && a.remote) {
        fetch(a.remote, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }).then(r => (r.ok ? r.blob() : null)).then(blob => blob && addClipAsset(id, { blob, label: a.label, rights: a.rights, remote: a.remote, post: a.post })).then(() => { rebuild(); renderBeats(); }).catch(() => {});
      } else if (a.src) loadImage(a.src, !a.src.startsWith('/')).then(img => { if (img) { state.images[id] = img; draw(); renderBeats(); } });
    });
    Object.values(state.assets).filter(a => a.kind === 'logo' && a.src).forEach(a => { const id = Object.keys(state.assets).find(k => state.assets[k] === a); if (!state.images[id]) loadImage(a.src, /^https?:/.test(a.src)).then(img => { if (img) { state.images[id] = img; draw(); } }); });
    fillVisuals();
    // ── Reels 2.0: C (inputs) ── a reel with the person's own voiceover gets it back (never the AI voice over it).
    if (t.voiceOwn && inputs.voiceInput) { if (!await inputs.voiceInput.restore(t.voiceOwn) && state.config.voice.ready && !inputs.voiceInput.snapshot()) restoreVoiceFromCache(); return; }
    inputs.voiceInput?.restore(null);
    if (state.config.voice.ready) restoreVoiceFromCache();
  }
  async function restoreVoiceFromCache() {
    let found = 0;
    const ac = audioContext();
    for (const beat of state.plan.beats) {
      const hook = state.plan.beats.indexOf(beat) === 0;
      const rec = await VoiceCache.get(`${state.config.voice.mode}|${state.config.voice.model}|${state.voiceId}|${hook ? 'h' : ''}|${beat.vo}`);
      if (!rec) continue;
      try {
        const buffer = await ac.decodeAudioData(rec.bytes.slice(0));
        const asset = `vo:${beat.id}`;
        state.buffers[asset] = buffer;
        state.assets[asset] = { kind: 'vo', label: `Voiceover, beat ${state.plan.beats.indexOf(beat) + 1}`, rights: { source: 'ES house voice (AI)', licence: 'AI voice, not a clone of any person; commercial use under the provider terms', organic: true, paid: true } };
        state.voice[beat.id] = { text: beat.vo, voiceId: state.voiceId, durationMs: Math.round(buffer.duration * 1000), words: rec.words, asset };
        found += 1;
      } catch { /* skip */ }
    }
    if (found) { rebuild(); renderBeats(); renderVoice(); }
    voiceSoon(0);
  }

  // ─── Data formats: gallery, source, story, make, review, export ─────────
  // Game Swing, Moment Replay and Hall-of-Fame Archive (reel-formats.js
  // DATA_FORMATS) run the unified flow from reel-flow.js:
  //   format (gallery) -> source -> story -> make -> review -> export.
  // The news flow above is untouched: state.flow.format is empty for it, and
  // every branch below checks dataFmt() first. Server modes come from the
  // contract (project-docs/reels-formats-contract.md §2.1); a mode that is not
  // built yet answers 501 coming-soon, and its tile says "Coming soon".
  const dataFmt = () => (G && TL && state.flow.format && F.isDataFormat(state.flow.format) ? state.flow.format : '');
  const srcKind = () => FLOW.sourceKindFor(dataFmt());
  const modes = () => state.config.formatModes || {};
  const modeOn = mode => G.modeOn(modes(), mode);
  const isSoon = error => error && (error.status === 501 || error.reason === 'coming-soon');
  const calmMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // The editor's news-flow choices, put back when they leave a data format.
  let newsPrefs = null;
  Object.assign(state, {
    data: { game: null, athlete: null, archive: null }, research: null, replay: null, angle: '',
    gp: { sport: 'nfl', tab: 'recent', query: '', date: '', status: 'idle', list: [], error: '', selected: '', updatedAt: '', seq: 0 },
    pp: { sport: 'nfl', query: '', status: 'idle', list: [], error: '', selected: '', candidate: null, angle: '5 best moments', custom: '', seq: 0 },
    cp: { origin: 'x', link: '', status: 'idle', error: '', clip: null, list: [], libSport: 'nfl', libStatus: 'idle', libError: '', asset: '', duration: 0, segment: null, rightsOk: false, file: null },
    keyPlays: [], clipMatches: [], digestState: 'idle', digestError: '', researchState: 'idle', view: 'reel', slide: 0, slides: null,
  });

  // ── Start tiles ── (Reels 2.0, lane D: Game, Clip and Player on the Start
  // screen took the place of the format gallery and its "Start from data" panel.)
  function renderGallery() { renderStart(); }
  function openGallery() { if (!state.flow.making) goStep('topic'); }
  // A new reel when the editor switches format family or data format while a
  // reel is open (the old one is kept under "Continue a reel").
  function startFresh() {
    if (!state.plan) return;
    autosave();
    stop();
    const title = state.plan.title;
    state.plan = null; state.timeline = null; state.lint = null; state.photos = {}; state.visualSrc = {}; state.voice = {};
    state.projectId = uuid(); state.status = 'draft'; state.t = 0; state.slides = null;
    setView('reel');
    els.emptyStage.hidden = false; els.play.disabled = true; els.scrub.disabled = true;
    els.stageMeta.textContent = '';
    state.versions = null; state.version = 0;
    els.work.classList.remove('has-reel');
    syncCanvasSize();
    draw();
    renderRecent();
    toast(`“${title}” is saved under Continue a reel.`);
  }
  function pickFormat(id) {
    if (state.flow.making || !F.FORMATS[id]) return;
    const was = dataFmt();
    const planFmt = state.plan?.format || '';
    if (F.isDataFormat(id)) {
      if (planFmt && planFmt !== id) startFresh();
      if (!was) newsPrefs = { voiceOn: state.voiceOn, useClips: state.useClips, style: state.style };
      if (was !== id) {
        state.flow = FLOW.reduce(state.flow, { type: 'pick-format', format: id });
        resetSources();
      }
      // Format defaults (owner): ES style per format, music only, clip audio muted.
      state.style = 'auto';
      state.voiceOn = F.FORMATS[id].voice !== 'off' ? state.voiceOn : false;
      state.useClips = id === 'gameswing';
      renderStepsNav();
      renderSourceStep();
      renderDataStory();
      renderStyles();
      renderVoicePickers();
      renderCost();
      syncStart();
      goStep(FLOW.sourceReady(id, state.flow.source) && was === id ? 'topic' : 'source', { focus: false });
      logEvent('edit', { what: 'format', format: id });
      return;
    }
    // A news format: back to the Story step as today, with that format set.
    if (was) {
      if (planFmt && F.isDataFormat(planFmt)) startFresh();
      state.flow = FLOW.reduce(state.flow, { type: 'pick-format', format: id });
      leaveDataPrefs();
    }
    state.format = id;
    renderStepsNav();
    renderDataStory();
    renderFormats();
    renderStyles();
    renderCost();
    syncStart();
    goStep('topic');
  }
  function leaveDataPrefs() {
    stopLive();
    if (newsPrefs) { state.voiceOn = newsPrefs.voiceOn; state.useClips = newsPrefs.useClips; state.style = newsPrefs.style; newsPrefs = null; }
    els.clipsOn.checked = state.useClips;
    renderVoicePickers();
  }
  function resetSources() {
    state.data = { game: null, athlete: null, archive: null };
    state.research = null; state.replay = null; state.keyPlays = []; state.clipMatches = []; state.digestState = 'idle'; state.researchState = 'idle';
    state.gp.selected = ''; state.pp.selected = ''; state.pp.candidate = null; state.cp.clip = null; state.cp.asset = ''; state.cp.segment = null;
  }

  // Steps: always Start, Storyboard, Export (the source of a game, clip or
  // player reel is picked on the Start screen).
  function renderStepsNav() { /* three fixed steps */ }

  // ── Source step ──
  const seg = (id, label, items, value, attr) => `<div class="es-segmented rm-seg" role="radiogroup" aria-label="${esc(label)}" id="${id}">${items.map(([v, l]) => `<button class="es-segmented__item" type="button" role="radio" aria-checked="${v === value}" tabindex="${v === value ? 0 : -1}" data-${attr}="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const SPORTS_FOR = { game: [['nfl', 'NFL'], ['cfb', 'CFB'], ['mlb', 'MLB']], player: [['nfl', 'NFL'], ['cfb', 'CFB'], ['mlb', 'MLB'], ['golf', 'Golf']] };
  function soonHtml(what) {
    return `<div class="es-empty rm-src-state"><p class="es-empty__title">${esc(what)} is coming soon</p><p class="es-empty__copy">The data server for this format lands next. Until then, start from a trend or a brief.</p><button class="es-btn es-btn--sm" type="button" data-news>Use a trend or a brief</button></div>`;
  }
  function errorHtml(title, copy, retry = 'retry') {
    return `<div class="es-error-state rm-src-state" role="alert"><span class="es-error-state__icon">${ICON.alert}</span><p class="es-error-state__title">${esc(title)}</p><p class="es-error-state__copy">${esc(copy)}</p><button class="es-btn es-btn--sm" type="button" data-${retry}>Try again</button></div>`;
  }
  const skeletonRows = (n, cls) => Array.from({ length: n }, () => `<li class="${cls} is-skeleton" aria-hidden="true"><span class="es-skeleton rm-sk-a"></span><span class="es-skeleton rm-sk-b"></span></li>`).join('');
  function renderSourceStep() {
    const fmt = dataFmt();
    if (!fmt) { els.sourceStep.innerHTML = ''; return; }
    const kind = srcKind();
    const f = F.FORMATS[fmt];
    const head = (title, meta) => `<div class="rm-sec__head"><h3 class="rm-sec__title" id="rm-src-title">${esc(title)}</h3><span class="rm-meta">${esc(meta)}</span></div>`;
    if (kind === 'game') {
      const g = state.gp;
      els.sourceStep.innerHTML = `${head('Pick a game', `${f.label} · game data is free`)}
        <div class="rm-src-controls">${seg('rm-g-sport', 'Sport', SPORTS_FOR.game, g.sport, 'gsport')}
        ${seg('rm-g-tab', 'Games', [['live', 'Live now'], ['recent', 'Last 48 h'], ['search', 'Search']], g.tab, 'gtab')}</div>
        <form class="rm-g-search" id="rm-g-search" ${g.tab === 'search' ? '' : 'hidden'}>
          <div class="es-field"><label class="es-field__label" for="rm-g-q">Team</label><input class="es-input" id="rm-g-q" type="search" maxlength="60" placeholder="Cowboys or DAL" value="${esc(g.query)}" autocomplete="off"></div>
          <div class="es-field"><label class="es-field__label" for="rm-g-date">Date</label><input class="es-input" id="rm-g-date" type="date" value="${esc(g.date ? `${g.date.slice(0, 4)}-${g.date.slice(4, 6)}-${g.date.slice(6, 8)}` : '')}"></div>
        </form>
        <p class="rm-hint" id="rm-g-note"></p>
        <ul class="rm-games" id="rm-games" role="radiogroup" aria-labelledby="rm-src-title"></ul>`;
      renderGameList();
      if (g.status === 'idle') loadGames();
      syncLive();
      return;
    }
    if (kind === 'player') {
      const p = state.pp;
      const angles = FLOW.SOURCE_KINDS.player.angles;
      els.sourceStep.innerHTML = `${head('Pick a player', `${f.label} · ES coverage and career stats, free`)}
        ${seg('rm-p-sport', 'League', SPORTS_FOR.player, p.sport, 'psport')}
        <div class="es-field"><label class="es-field__label" for="rm-p-q">Player</label><input class="es-input" id="rm-p-q" type="search" maxlength="60" placeholder="Tom Brady" value="${esc(p.query)}" autocomplete="off" aria-describedby="rm-p-hint"><p class="es-field__hint" id="rm-p-hint">Type two letters or more. Position and years tell players with the same name apart.</p></div>
        <ul class="rm-players" id="rm-players" role="radiogroup" aria-label="Players"></ul>
        <details class="rm-fold rm-p-byid"${p.byId ? ' open' : ''}><summary><span class="rm-fold__title">Not found? Use the ESPN player link</span></summary><div class="rm-fold__body">
          <form class="rm-c-xform" id="rm-p-idform" novalidate><div class="es-field"><label class="es-field__label" for="rm-p-id">ESPN player link or id</label>
          <div class="rm-c-xrow"><input class="es-input" id="rm-p-id" type="text" inputmode="url" maxlength="300" placeholder="espn.com/nfl/player/_/id/2330/tom-brady" value="${esc(p.byId || '')}" aria-describedby="rm-p-idhint"><button class="es-btn" type="submit">Look up</button></div>
          <p class="es-field__hint" id="rm-p-idhint">ESPN’s search misses many retired players. Their ESPN page link always works.</p></div></form></div></details>
        <div class="es-field"><span class="es-field__label" id="rm-angle-label">Angle</span>
          <div class="rm-chips rm-angles" role="radiogroup" aria-labelledby="rm-angle-label" id="rm-angles">${[...angles, 'Your own'].map(a => { const on = (p.angle === a) || (a === 'Your own' && !angles.includes(p.angle)); return `<button class="es-chip" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-angle="${esc(a)}">${esc(a)}</button>`; }).join('')}</div>
          <input class="es-input" id="rm-angle-own" type="text" maxlength="80" placeholder="His playoff comebacks" value="${esc(angles.includes(p.angle) ? '' : p.angle)}" ${angles.includes(p.angle) ? 'hidden' : ''} aria-label="Your own angle"></div>`;
      renderPlayerList();
      return;
    }
    // clip
    const c = state.cp;
    els.sourceStep.innerHTML = `${head('Pick a clip', `${f.label} · one clip, three frames`)}
      ${seg('rm-c-origin', 'Clip from', [['x', 'X link'], ['library', 'Clip library'], ['upload', 'Upload']], c.origin, 'corigin')}
      <div class="rm-c-panel" id="rm-c-panel"></div>
      <div class="rm-c-pick" id="rm-c-pick"></div>`;
    renderClipPanel();
    renderClipPick();
  }
  function onSourceClick(event) {
    const t = event.target;
    if (t.closest('[data-news]')) { setStart('trend'); return; }
    const gs = t.closest('[data-gsport]');
    if (gs) { state.gp.sport = gs.dataset.gsport; radios($('rm-g-sport'), 'gsport', state.gp.sport); loadGames(); return; }
    const gt = t.closest('[data-gtab]');
    if (gt) { state.gp.tab = gt.dataset.gtab; radios($('rm-g-tab'), 'gtab', state.gp.tab); $('rm-g-search').hidden = state.gp.tab !== 'search'; if (state.gp.tab === 'search') $('rm-g-q')?.focus(); loadGames(); syncLive(); return; }
    if (t.closest('[data-retry]')) { loadGames({ force: true }); return; }
    const game = t.closest('[data-game]');
    if (game) { pickGame(game.dataset.game); return; }
    const ps = t.closest('[data-psport]');
    if (ps) { state.pp.sport = ps.dataset.psport; radios($('rm-p-sport'), 'psport', state.pp.sport); state.pp.list = []; searchPlayers(); return; }
    if (t.closest('[data-pretry]')) { searchPlayers({ now: true }); return; }
    const pl = t.closest('[data-athlete]');
    if (pl) { pickPlayer(pl.dataset.athlete); return; }
    const ang = t.closest('[data-angle]');
    if (ang) {
      const own = ang.dataset.angle === 'Your own';
      radios($('rm-angles'), 'angle', ang.dataset.angle);
      $('rm-angle-own').hidden = !own;
      state.pp.angle = own ? ($('rm-angle-own').value.trim() || '') : ang.dataset.angle;
      if (own) $('rm-angle-own').focus();
      updatePlayerSource();
      return;
    }
    const co = t.closest('[data-corigin]');
    if (co) { state.cp.origin = co.dataset.corigin; radios($('rm-c-origin'), 'corigin', state.cp.origin); renderClipPanel(); return; }
    const cs = t.closest('[data-csport]');
    if (cs) { state.cp.libSport = cs.dataset.csport; radios($('rm-c-sport'), 'csport', state.cp.libSport); loadLibrary(); return; }
    if (t.closest('[data-cretry]')) { loadLibrary(); return; }
    const lc = t.closest('[data-clip]');
    if (lc) { useLibraryClip(Number(lc.dataset.clip)); return; }
    if (t.closest('[data-cuse]')) { confirmClip(); return; }
    if (t.closest('[data-cclear]')) { state.cp.clip = null; state.cp.asset = ''; state.cp.segment = null; renderClipPick(); renderClipPanel(); }
  }
  els.sourceStep.addEventListener('click', onSourceClick);
  els.sourceStep.addEventListener('input', event => {
    if (event.target.id === 'rm-g-q') { state.gp.query = event.target.value; renderGameList(); }
    if (event.target.id === 'rm-p-q') { state.pp.query = event.target.value; searchPlayers(); }
    if (event.target.id === 'rm-angle-own') { state.pp.angle = event.target.value.trim(); updatePlayerSourceSoon(); }
    if (event.target.dataset.seg) onSegmentInput(event.target);
  });
  els.sourceStep.addEventListener('change', event => {
    if (event.target.id === 'rm-g-date') { state.gp.date = String(event.target.value || '').replace(/-/g, ''); loadGames(); }
    if (event.target.id === 'rm-c-file') onClipFile(event.target);
    if (event.target.id === 'rm-c-rights') { state.cp.rightsOk = event.target.checked; renderClipPick(); }
  });
  els.sourceStep.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.id === 'rm-c-xform') resolveXLink();
    if (event.target.id === 'rm-g-search') loadGames();
    if (event.target.id === 'rm-p-idform') lookupAthlete();
  });
  // Home / End on the long lists (arrows are handled for every radiogroup).
  els.sourceStep.addEventListener('keydown', event => {
    const row = event.target.closest?.('[data-game], [data-athlete], [data-clip]');
    if (!row || !['Home', 'End'].includes(event.key)) return;
    const list = [...row.closest('[role="radiogroup"]').querySelectorAll('[role="radio"]')];
    event.preventDefault();
    (event.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
  });

  // Games: one request per sport + list, cached for the response's TTL.
  const gameCache = new Map();
  function logoFor(team, sport) {
    const entry = LOGOLIB?.findTeam ? LOGOLIB.findTeam(team.name || team.abbr || '', sport) : null;
    const dark = document.documentElement.dataset.theme === 'dark';
    const colors = entry?.colors || team.colors || [];
    return { src: entry ? LOGOLIB.srcFor(entry, { dark }) : '', a: colors[0] || '', b: colors[1] || '' };
  }
  async function loadGames({ force = false } = {}) {
    const g = state.gp;
    const when = g.tab === 'live' ? 'live' : (g.tab === 'search' && g.date ? 'date' : 'recent');
    const key = `${g.sport}|${when}|${when === 'date' ? g.date : ''}`;
    const hit = gameCache.get(key);
    if (hit && !force && Date.now() - hit.at < hit.ttl * 1000) { g.list = hit.games; g.updatedAt = hit.updatedAt; g.status = 'ready'; renderGameList(); return; }
    const seq = ++g.seq;
    if (!force || g.status !== 'ready') { g.status = 'loading'; renderGameList(); }
    try {
      const data = await api({ mode: 'games', sport: g.sport, when, ...(when === 'date' ? { date: g.date } : {}) });
      if (seq !== g.seq) return;
      g.list = Array.isArray(data.games) ? data.games : [];
      g.updatedAt = data.updatedAt || '';
      g.status = 'ready';
      gameCache.set(key, { at: Date.now(), ttl: Number(data.ttlSec) || (when === 'live' ? 15 : 60), games: g.list, updatedAt: g.updatedAt });
    } catch (error) {
      if (seq !== g.seq) return;
      g.status = isSoon(error) ? 'soon' : (error.offline ? 'offline' : 'error');
      g.error = error.message;
      if (isSoon(error)) markSoon('games');
    }
    renderGameList();
  }
  function markSoon(mode) {
    state.config.formatModes = { ...modes(), [mode]: false };
    renderStart();
  }
  function renderGameList() {
    const list = $('rm-games');
    if (!list) return;
    const g = state.gp;
    const note = $('rm-g-note');
    list.setAttribute('aria-busy', String(g.status === 'loading'));
    if (note) note.textContent = g.tab === 'live' ? 'Live games refresh every 30 seconds.' : (g.tab === 'recent' ? 'Finals from the last 48 hours, biggest win-probability swing first.' : 'Filter by team, or pick a date.');
    if (g.status === 'loading' || g.status === 'idle') { list.innerHTML = skeletonRows(4, 'rm-game'); return; }
    if (g.status === 'soon') { list.innerHTML = `<li role="none">${soonHtml('Game Swing')}</li>`; return; }
    if (g.status === 'error' || g.status === 'offline') { list.innerHTML = `<li role="none">${errorHtml(g.status === 'offline' ? 'The game list is not reachable' : 'Games did not load', g.status === 'offline' ? 'Reels Studio’s server is not reachable from here.' : (g.error || 'Try again in a moment.'))}</li>`; return; }
    const games = G.sortGames(G.filterGames(g.list, g.tab === 'search' ? g.query : ''));
    if (!games.length) {
      const empty = g.tab === 'live' ? ['No live games right now', 'See the finals from the last 48 hours.', '<button class="es-btn es-btn--sm" type="button" data-gtab="recent">Last 48 h</button>'] : (g.tab === 'search' ? ['No games match', 'Try a team name or abbreviation, or another date.', ''] : ['No finals in the last 48 hours', 'Try another league, or pick a date in Search.', '']);
      list.innerHTML = `<li role="none" class="es-empty rm-src-state"><p class="es-empty__title">${empty[0]}</p><p class="es-empty__copy">${empty[1]}</p>${empty[2]}</li>`;
      return;
    }
    const tabId = games.some(x => x.id === g.selected) ? g.selected : games[0].id;
    list.innerHTML = games.map(x => G.gameRowHtml(x, { selected: g.selected, tab: x.id === tabId, logo: logoFor })).join('');
  }
  let liveTimer = 0;
  function syncLive() {
    clearInterval(liveTimer);
    if (dataFmt() === 'gameswing' && state.gp.tab === 'live' && state.step === 'source') liveTimer = setInterval(() => { if (!document.hidden) loadGames({ force: true }); }, 30000);
  }
  function stopLive() { clearInterval(liveTimer); }
  function pickGame(id) {
    const g = state.gp;
    const game = g.list.find(x => x.id === id);
    if (!game) return;
    g.selected = id;
    renderGameList();
    $('rm-games')?.querySelector(`[data-game="${CSS.escape(id)}"]`)?.focus();
    if (state.data.game?.eventId !== id) { state.data.game = null; state.keyPlays = []; state.clipMatches = []; state.digestState = 'idle'; }
    state.gameSummary = game;
    setSource({ kind: 'game', sport: game.sport || g.sport, eventId: id, label: G.gameLabel(game) });
    loadDigest().catch(() => {}).then(() => renderDataStory());
  }
  // The digest of the picked game (free, cached on the server; here per tab).
  const digestCache = new Map();
  async function loadDigest() {
    const src = state.flow.source;
    if (!src || src.kind !== 'game') return null;
    const key = `${src.sport}|${src.eventId}`;
    const hit = digestCache.get(key);
    if (hit && (hit.final || Date.now() - hit.at < 20000)) { state.data.game = hit.digest; state.clipMatches = hit.clips; state.digestState = 'ready'; if (!state.keyPlays.length) state.keyPlays = keyPlaysOf(hit.digest); return hit.digest; }
    state.digestState = 'loading';
    renderDataStory();
    try {
      // clips: true -> sure clip-library matches per play (Game Swing plays them under the scorebug).
      const data = await api({ mode: 'game-data', sport: src.sport, eventId: src.eventId, clips: true });
      const check = TL.validateDigest(data.digest);
      if (!check.ok) throw Object.assign(new Error('The game data came back incomplete. Try another game, or use a brief.'), { reason: 'bad-digest' });
      const ids = new Set(data.digest.plays.map(p => p.id));
      const clips = (Array.isArray(data.clipMatches) ? data.clipMatches : []).filter(c => c && ids.has(c.playId) && /^https:\/\//.test(String(c.url || '')) && c.variants?.length);
      digestCache.set(key, { at: Date.now(), digest: data.digest, clips, final: Boolean(data.digest.status?.final) });
      if (state.flow.source?.eventId !== src.eventId) return null;
      state.data.game = data.digest;
      state.clipMatches = clips;
      state.digestState = 'ready';
      state.keyPlays = keyPlaysOf(data.digest);
      return data.digest;
    } catch (error) {
      state.digestState = isSoon(error) ? 'soon' : 'error';
      state.digestError = error.reason === 'data-unavailable' ? 'Game data is unavailable for this game. Use a brief instead.' : error.message;
      if (isSoon(error)) markSoon('game-data');
      throw error;
    }
  }
  const keyPlaysOf = digest => (window.ReelData?.keyPlays ? window.ReelData.keyPlays(digest).map(p => (typeof p === 'string' ? p : p.id)) : G.keyPlays(digest, 5));

  // Players: search (debounced), then stats and ES coverage for the pick.
  let playerTimer = 0;
  function searchPlayers({ now = false } = {}) {
    clearTimeout(playerTimer);
    const q = state.pp.query.trim();
    if (q.length < 2) { state.pp.status = 'idle'; state.pp.list = []; renderPlayerList(); return; }
    playerTimer = setTimeout(async () => {
      const p = state.pp;
      const seq = ++p.seq;
      p.status = 'loading';
      renderPlayerList();
      try {
        const data = await api({ mode: 'athlete', sport: p.sport, query: q });
        if (seq !== p.seq) return;
        p.list = (data.candidates || []).slice(0, 8);
        p.status = 'ready';
      } catch (error) {
        if (seq !== p.seq) return;
        p.status = isSoon(error) ? 'soon' : (error.offline ? 'offline' : 'error');
        p.error = error.message;
        if (isSoon(error)) markSoon('athlete');
      }
      renderPlayerList();
    }, now ? 0 : 350);
  }
  function renderPlayerList() {
    const list = $('rm-players');
    if (!list) return;
    const p = state.pp;
    list.setAttribute('aria-busy', String(p.status === 'loading'));
    if (p.status === 'idle') { list.innerHTML = p.candidate ? G.playerRowHtml(p.candidate, { selected: p.selected, tab: true }) : ''; return; }
    if (p.status === 'loading') { list.innerHTML = skeletonRows(3, 'rm-player'); return; }
    if (p.status === 'soon') { list.innerHTML = `<li role="none">${soonHtml('Hall-of-Fame Archive')}</li>`; return; }
    if (p.status === 'error' || p.status === 'offline') { list.innerHTML = `<li role="none">${errorHtml('Player search did not work', p.status === 'offline' ? 'Reels Studio’s server is not reachable from here.' : p.error, 'pretry')}</li>`; return; }
    if (!p.list.length) { list.innerHTML = `<li role="none" class="es-empty rm-src-state"><p class="es-empty__title">No players found</p><p class="es-empty__copy">Check the spelling, or try another league.</p></li>`; return; }
    const tabId = p.list.some(c => c.athleteId === p.selected) ? p.selected : p.list[0].athleteId;
    list.innerHTML = p.list.map(c => G.playerRowHtml(c, { selected: p.selected, tab: c.athleteId === tabId })).join('');
  }
  // A player by ESPN id (typed, or pulled from a pasted ESPN player link).
  async function lookupAthlete() {
    const p = state.pp;
    const raw = $('rm-p-id')?.value || '';
    p.byId = raw;
    const id = G.parseAthleteId(raw);
    const hint = $('rm-p-idhint');
    const fail = msg => { if (hint) { hint.textContent = msg; hint.classList.add('rm-err'); hint.setAttribute('role', 'alert'); } $('rm-p-id')?.focus(); };
    if (!id) { fail('Paste an ESPN player link, or type the number after /id/.'); return; }
    p.status = 'loading';
    renderPlayerList();
    try {
      const data = await api({ mode: 'athlete', sport: p.sport, athleteId: id });
      const a = data.athlete;
      athleteCache.set(`${a.sport || p.sport}|${a.athleteId}`, a);
      const seasons = a.stats?.seasons || [];
      const c = { athleteId: a.athleteId, name: a.name, sport: a.sport || p.sport, position: a.position || '', years: seasons.length ? `${seasons[0].year}-${seasons[seasons.length - 1].year}` : '' };
      p.list = [c];
      p.status = 'ready';
      renderPlayerList();
      pickPlayer(c.athleteId);
    } catch (error) {
      p.status = 'idle';
      renderPlayerList();
      fail(isSoon(error) ? 'Player lookup is coming soon.' : (error.message || 'That player was not found.'));
    }
  }
  function pickPlayer(id) {
    const p = state.pp;
    const c = p.list.find(x => x.athleteId === id) || (p.candidate?.athleteId === id ? p.candidate : null);
    if (!c) return;
    if (p.selected !== id) { state.data.athlete = null; state.research = null; state.researchState = 'idle'; }
    p.selected = id;
    p.candidate = c;
    renderPlayerList();
    $('rm-players')?.querySelector(`[data-athlete="${CSS.escape(id)}"]`)?.focus();
    updatePlayerSource({ advance: true });
  }
  function updatePlayerSource({ advance = false } = {}) {
    const c = state.pp.candidate;
    if (!c) return;
    const angle = state.pp.angle || '5 best moments';
    if (state.research && state.research.angle !== angle) { state.research = null; state.researchState = 'idle'; }
    setSource({ kind: 'player', sport: c.sport || state.pp.sport, athleteId: c.athleteId, name: c.name, angle }, { advance });
    if (advance) loadArchive().catch(() => {}).then(() => renderDataStory());
  }
  const updatePlayerSourceSoon = debounce(() => updatePlayerSource(), 400);
  const athleteCache = new Map();
  const researchCache = new Map();
  async function loadArchive() {
    const src = state.flow.source;
    if (!src || src.kind !== 'player') return null;
    state.researchState = 'loading';
    renderDataStory();
    try {
      const aKey = `${src.sport}|${src.athleteId}`;
      const rKey = `${aKey}|${src.angle}`;
      const [athlete, research] = await Promise.all([
        athleteCache.get(aKey) || api({ mode: 'athlete', sport: src.sport, athleteId: src.athleteId }).then(d => { athleteCache.set(aKey, d.athlete); return d.athlete; }).catch(() => null),
        researchCache.get(rKey) || api({ mode: 'archive-research', sport: src.sport, athleteId: src.athleteId, name: src.name, angle: src.angle }).then(d => { researchCache.set(rKey, d); state.spent.archive = (state.spent.archive || 0) + (Number(d.cost) || 0); return d; }),
      ]);
      if (state.flow.source?.athleteId !== src.athleteId) return null;
      state.data.athlete = research.athlete || athlete;
      if (!state.data.athlete) throw new Error('The player’s career stats did not load. Try again.');
      state.research = research;
      state.researchState = 'ready';
      const moments = G.pickMoments(research.candidates, src.angle, /best/i.test(src.angle) ? 5 : F.FORMATS.archive.beats.max - 2);
      state.data.archive = {
        athleteId: src.athleteId, angle: src.angle,
        sources: (research.articles || []).slice(0, TL.LIMITS.sources),
        photos: (research.photos || []).slice(0, TL.LIMITS.photos),
        moments: moments.map(({ id, year, title, line, cite }) => ({ id, year, title, line, cite })),
        thin: Boolean(research.coverage?.thin),
      };
      return state.data.archive;
    } catch (error) {
      state.researchState = isSoon(error) ? 'soon' : 'error';
      state.digestError = error.message;
      if (isSoon(error)) markSoon(error.data?.mode || 'archive-research');
      throw error;
    }
  }

  // Clips: an X link (resolved by Video Ads' free 'clip' mode), the clip
  // library (Video Ads' free 'library' mode) or an ES upload.
  async function videoAds(body) {
    if (!window.ESAuth?.fetchWithAuth) throw Object.assign(new Error('Sign-in is still loading. Try again in a moment.'), { offline: true });
    let response;
    try { response = await window.ESAuth.fetchWithAuth('/api/video-ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch { throw Object.assign(new Error('The clip server is not reachable.'), { offline: true }); }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok === false) throw Object.assign(new Error(data?.error || `That did not work (${response.status}).`), { status: response.status, reason: data?.reason, offline: response.status === 404 && !data });
    return data;
  }
  function renderClipPanel() {
    const panel = $('rm-c-panel');
    if (!panel) return;
    const c = state.cp;
    if (c.origin === 'x') {
      panel.innerHTML = `<form class="rm-c-xform" id="rm-c-xform" novalidate>
        <div class="es-field"><label class="es-field__label" for="rm-c-link">X post link</label>
        <div class="rm-c-xrow"><input class="es-input" id="rm-c-link" type="url" inputmode="url" maxlength="400" placeholder="https://x.com/NFL/status/1855…" value="${esc(c.link)}" aria-describedby="rm-c-xhint" ${c.status === 'error' ? 'aria-invalid="true"' : ''}><button class="es-btn" type="submit" ${c.status === 'loading' ? 'aria-busy="true"' : ''}>${c.status === 'loading' ? '<span class="rm-spin" aria-hidden="true"></span>Finding' : 'Find the clip'}</button></div>
        <p class="es-field__hint${c.status === 'error' ? ' rm-err' : ''}" id="rm-c-xhint" ${c.status === 'error' ? 'role="alert"' : ''}>${esc(c.status === 'error' ? c.error : 'A team, league or network post with a video. Allowed for organic posts.')}</p></div></form>`;
      return;
    }
    if (c.origin === 'library') {
      panel.innerHTML = `${seg('rm-c-sport', 'League', [['nfl', 'NFL'], ['cfb', 'CFB'], ['mlb', 'MLB']], c.libSport, 'csport')}<p class="rm-hint">Official clips from the last few days. Free.</p><ul class="rm-clips" id="rm-clips" role="radiogroup" aria-label="Clips in the library"></ul>`;
      renderLibrary();
      if (c.libStatus === 'idle') loadLibrary();
      return;
    }
    panel.innerHTML = `<div class="rm-upload rm-c-upload"><input type="file" id="rm-c-file" accept="video/mp4,video/quicktime,video/webm" class="es-sr-only"><label class="es-btn" for="rm-c-file">${ICON.upload}<span>Choose a video</span></label><span class="rm-meta">${c.file ? esc(c.file.name) : 'MP4, MOV or WebM, up to 120 MB'}</span></div>
      <label class="rm-check rm-check--sm"><input type="checkbox" id="rm-c-rights" ${c.rightsOk ? 'checked' : ''}><span><b>ES owns this clip or has the rights to it</b><small>Required for uploads.</small></span></label>`;
  }
  async function loadLibrary() {
    const c = state.cp;
    c.libStatus = 'loading';
    renderLibrary();
    try {
      const data = await videoAds({ mode: 'library', sport: c.libSport, sort: 'newest', limit: 18 });
      c.list = (data.clips || []).filter(x => x.variants?.length);
      c.libStatus = 'ready';
    } catch (error) {
      c.libStatus = error.offline ? 'offline' : 'error';
      c.libError = error.message;
    }
    renderLibrary();
  }
  function renderLibrary() {
    const list = $('rm-clips');
    if (!list) return;
    const c = state.cp;
    list.setAttribute('aria-busy', String(c.libStatus === 'loading'));
    if (c.libStatus === 'loading' || c.libStatus === 'idle') { list.innerHTML = skeletonRows(3, 'rm-clip'); return; }
    if (c.libStatus !== 'ready') { list.innerHTML = `<li role="none">${errorHtml('The clip library did not load', c.libStatus === 'offline' ? 'The clip server is not reachable from here. Paste an X link or upload instead.' : c.libError, 'cretry')}</li>`; return; }
    if (!c.list.length) { list.innerHTML = '<li role="none" class="es-empty rm-src-state"><p class="es-empty__title">No fresh clips in this league</p><p class="es-empty__copy">Paste an X link or upload a clip instead.</p></li>'; return; }
    const sel = c.clip?.url || '';
    const tabI = Math.max(0, c.list.findIndex(x => x.url === sel));
    list.innerHTML = c.list.map((x, i) => G.clipRowHtml(x, i, { selected: sel, tab: i === tabI })).join('');
  }
  async function resolveXLink() {
    const c = state.cp;
    c.link = $('rm-c-link')?.value || '';
    const parsed = G.parseClipLink(c.link);
    if (!parsed.ok) { c.status = 'error'; c.error = parsed.error; renderClipPanel(); $('rm-c-link')?.focus(); return; }
    c.status = 'loading';
    renderClipPanel();
    try {
      const data = await videoAds({ mode: 'clip', url: parsed.url });
      c.status = 'ready';
      await loadReplayClip({ origin: 'x', url: data.url || parsed.url, variants: data.variants, handle: data.handle || parsed.handle, text: data.text || '', thumb: data.thumbnail || '', postedAt: data.postedAt || '', durationMs: data.durationMs || 0 });
    } catch (error) {
      c.status = 'error';
      c.error = error.offline ? 'The clip server is not reachable from here. Upload the clip instead.' : error.message;
    }
    renderClipPanel();
  }
  function useLibraryClip(i) {
    const clip = state.cp.list[i];
    if (!clip) return;
    loadReplayClip({ origin: 'library', url: clip.url, variants: clip.variants, handle: clip.handle, text: clip.text, thumb: clip.thumb, postedAt: clip.postedAt, durationMs: clip.durationMs });
  }
  function onClipFile(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > 120 * 1024 * 1024) { toast('That file is too large (120 MB at most).', { tone: 'error' }); return; }
    state.cp.file = file;
    renderClipPanel();
    loadReplayClip({ origin: 'upload', file, text: file.name.replace(/\.[^.]+$/, '').slice(0, 80) });
  }
  // Downloads (or reads) the clip once into a clip: asset; the preview video
  // and the segment trimmer use it.
  async function loadReplayClip(clip) {
    const c = state.cp;
    c.clip = { ...clip, loading: true };
    c.asset = '';
    renderClipPick();
    let id = '';
    if (clip.origin === 'upload') {
      id = `clip:replay-up-${Date.now().toString(36)}`;
      const ok = await addClipAsset(id, { blob: clip.file, label: `Your clip: ${clip.file.name.slice(0, 40)}`, rights: { source: 'Uploaded by you', licence: 'You confirmed ES owns it or has the rights', organic: true, paid: true, credit: '' } });
      if (!ok) id = '';
    } else {
      const variant = pickVariant(clip.variants || []);
      if (variant) {
        id = `clip:replay-${slugOf(clip.url).slice(-24)}`;
        if (!state.assets[id]) {
          try {
            const response = await fetch(variant.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
            const blob = response.ok ? await response.blob() : null;
            const ok = blob && await addClipAsset(id, { blob, remote: variant.url, post: clip.url, label: `Clip from @${clip.handle || 'x'}`, rights: { source: `X post (${clip.url})`, licence: 'Clip from an X post. Allowed for organic posts; a paid ad with league footage needs a rights check. Keep the source link.', organic: true, paid: true, x: true, credit: clip.handle ? `@${clip.handle}` : '' } });
            if (!ok) id = '';
          } catch { id = ''; }
        }
      }
    }
    if (c.clip?.url !== clip.url || c.clip?.file !== clip.file) return;
    if (!id) {
      c.clip = { ...clip, loading: false, failed: true };
      renderClipPick();
      return;
    }
    const dur = (state.assets[id].durationMs || 6000) / 1000;
    c.asset = id;
    c.duration = dur;
    c.segment = { in: Math.round(Math.min(0.4, dur / 10) * 10) / 10, out: Math.round(Math.min(dur, 12) * 10) / 10 };
    c.clip = { ...clip, loading: false };
    renderClipPick();
    renderLibrary();
  }
  function renderClipPick() {
    const box = $('rm-c-pick');
    if (!box) return;
    const c = state.cp;
    if (!c.clip) { box.innerHTML = ''; return; }
    if (c.clip.loading) { box.innerHTML = `<div class="rm-c-card is-loading" role="status"><span class="rm-spin" aria-hidden="true"></span><span>Loading the clip…</span></div>`; return; }
    if (c.clip.failed) { box.innerHTML = errorHtml('That clip could not be loaded', c.clip.origin === 'upload' ? 'Try an MP4 file.' : 'Its video did not download. Try another post, or upload the clip.', 'cclear'); return; }
    const a = state.assets[c.asset];
    const s = c.segment;
    const needRights = c.clip.origin === 'upload' && !c.rightsOk;
    box.innerHTML = `<div class="rm-c-card">
      <div class="rm-c-video"><video id="rm-c-video" src="${esc(a?.src || '')}" muted playsinline controls preload="metadata" aria-label="Clip preview"></video></div>
      <div class="rm-c-meta"><p class="rm-c-title">${esc(c.clip.text || a?.label || 'Clip')}</p><p class="rm-meta">${esc([c.clip.handle ? `@${c.clip.handle}` : (c.clip.origin === 'upload' ? 'Your upload' : ''), `${c.duration.toFixed(1)} s`].filter(Boolean).join(' · '))}</p></div>
      <fieldset class="rm-trim"><legend class="es-field__label">The moment</legend>
        <label class="rm-trim__row"><span>Starts</span><input type="range" data-seg="in" min="0" max="${c.duration.toFixed(1)}" step="0.1" value="${s.in}" aria-valuetext="${G.fmtSec(s.in)}"><output id="rm-seg-in">${G.fmtSec(s.in)}</output></label>
        <label class="rm-trim__row"><span>Ends</span><input type="range" data-seg="out" min="0" max="${c.duration.toFixed(1)}" step="0.1" value="${s.out}" aria-valuetext="${G.fmtSec(s.out)}"><output id="rm-seg-out">${G.fmtSec(s.out)}</output></label>
        <p class="rm-hint">Three frames come from this stretch: the setup, the play and the reaction.</p></fieldset>
      <div class="rm-c-actions"><button class="es-btn es-btn--tertiary" type="button" data-cclear>Pick another</button><button class="es-btn es-btn--primary" type="button" data-cuse ${needRights ? 'aria-disabled="true"' : ''}>Use this clip</button></div>
      ${needRights ? '<p class="rm-hint rm-err">Tick the rights box above to use an upload.</p>' : ''}
    </div>`;
  }
  function onSegmentInput(input) {
    const c = state.cp;
    if (!c.segment) return;
    const v = Number(input.value);
    if (input.dataset.seg === 'in') c.segment.in = Math.min(v, c.segment.out - 1);
    else c.segment.out = Math.max(v, c.segment.in + 1);
    input.value = String(c.segment[input.dataset.seg]);
    input.setAttribute('aria-valuetext', G.fmtSec(c.segment[input.dataset.seg]));
    const out = $(`rm-seg-${input.dataset.seg}`);
    if (out) out.textContent = G.fmtSec(c.segment[input.dataset.seg]);
    const video = $('rm-c-video');
    if (video) { try { video.currentTime = c.segment[input.dataset.seg]; } catch { /* not ready */ } }
  }
  function confirmClip() {
    const c = state.cp;
    if (!c.clip || !c.asset) return;
    if (c.clip.origin === 'upload' && !c.rightsOk) { $('rm-c-rights')?.focus(); return; }
    const src = { kind: 'clip', origin: c.clip.origin, segment: { ...c.segment } };
    if (c.clip.origin === 'upload') src.assetId = c.asset; else { src.url = c.clip.url; src.assetId = c.asset; }
    state.replay = null;
    setSource(src);
  }

  // The flow's source; a complete source moves the editor to the Story step.
  function setSource(source, { advance = true } = {}) {
    state.flow = FLOW.reduce(state.flow, { type: 'set-source', source });
    renderStepsNav();
    renderDataStory();
    if (advance && state.flow.step === 'story' && state.step === 'source') goStep('topic');
  }

  // ── Story step for a data format ──
  const EMPTY_HINT = { game: 'Pick a game, then Make my reel.', clip: 'Pick a clip, then Make my reel.', player: 'Pick a player, then Make my reel.' };
  function renderDataStory() {
    const fmt = dataFmt();
    const box = els.dataStory;
    const hint = els.emptyStage.querySelector('span');
    if (hint) hint.textContent = fmt ? EMPTY_HINT[srcKind()] : 'Describe it, pick a style, then Make my reel.';
    els.panes.topic.classList.toggle('is-data', Boolean(fmt));
    els.factcheckRow.hidden = Boolean(fmt) || !state.config.ai;
    els.recent.hidden = Boolean(fmt) || !store.get(LOCAL_KEY, []).length;
    box.hidden = !fmt;
    if (!fmt) { box.innerHTML = ''; return; }
    const f = F.FORMATS[fmt];
    const src = state.flow.source;
    const change = `<button class="es-btn es-btn--tertiary es-btn--sm" type="button" data-dsrc>Change</button>`;
    let body = '';
    if (!src) body = `<p class="rm-hint">Pick a ${esc(G.SOURCE_LABEL[srcKind()].toLowerCase())} first.</p><button class="es-btn es-btn--sm" type="button" data-dsrc>Pick one</button>`;
    else if (src.kind === 'game') {
      const g = state.gameSummary;
      const d = state.data.game;
      const teams = d ? d.teams : g?.teams;
      const head = teams ? `<div class="rm-ds-game">${G.gameRowHtml({ id: src.eventId, sport: src.sport, teams, status: (d || g).status, startsAt: (d || g).startsAt, drama: g?.drama ?? null, wpSpark: g?.wpSpark || null }, { logo: logoFor, still: true })}</div>` : `<p class="rm-ds-label">${esc(src.label)}</p>`;
      let plays = '';
      if (state.digestState === 'loading') plays = `<p class="rm-hint" role="status"><span class="rm-spin" aria-hidden="true"></span> Reading the play-by-play…</p>`;
      else if (state.digestState === 'error' || state.digestState === 'soon') plays = `<p class="rm-hint rm-err" role="alert">${esc(state.digestState === 'soon' ? 'Game data is coming soon.' : state.digestError)}</p>`;
      else if (d) {
        plays = `<fieldset class="rm-keyplays"><legend class="es-field__label">Key plays <span class="rm-meta">${state.keyPlays.length} of ${d.plays.length} picked</span></legend>${d.plays.length ? d.plays.map(p => `<label class="rm-keyplay"><input type="checkbox" data-keyplay="${esc(p.id)}" ${state.keyPlays.includes(p.id) ? 'checked' : ''}><span class="rm-keyplay__when">${esc(G.playWhen(p, d.sport))}</span><span class="rm-keyplay__text">${esc(p.text)}</span><span class="rm-keyplay__tags">${(p.tags || []).filter(t => G.TAG_LABEL[t]).slice(0, 2).map(t => `<span class="es-badge${t === 'swing' || t === 'lead-change' ? ' es-badge--warn' : ''}">${esc(G.TAG_LABEL[t])}</span>`).join('')}${typeof p.swing === 'number' ? `<span class="rm-keyplay__swing">${p.swing > 0 ? '+' : ''}${Math.round(p.swing * 100)}%</span>` : ''}</span></label>`).join('') : '<p class="rm-hint">No key plays in this game’s data yet.</p>'}</fieldset>
          ${d.wp?.points?.length ? `<p class="rm-attrib">${esc(d.attribution || TL.ATTRIBUTION.espn)}</p>` : '<p class="rm-hint">No win probability for this game, so the reel leaves the line out.</p>'}`;
      }
      body = `${head}${plays}`;
    } else if (src.kind === 'player') {
      const c = state.pp.candidate;
      const r = state.research;
      let cov = '';
      if (state.researchState === 'loading') cov = `<p class="rm-hint" role="status"><span class="rm-spin" aria-hidden="true"></span> Searching ES coverage and career stats…</p>`;
      else if (state.researchState === 'error' || state.researchState === 'soon') cov = `<p class="rm-hint rm-err" role="alert">${esc(state.researchState === 'soon' ? 'Archive research is coming soon.' : state.digestError)}</p>`;
      else if (r) {
        const a = Number(r.coverage?.articles) || 0;
        const level = Math.min(1, a / 12);
        cov = `<div class="rm-coverage${r.coverage?.thin ? ' is-thin' : ''}"><span class="rm-coverage__bar" aria-hidden="true"><span style="width:${Math.round(level * 100)}%"></span></span><span>${esc(G.coverageText(r.coverage, r.dropped))} · ${(r.candidates || []).length} moments with a source</span></div>${r.coverage?.thin ? `<p class="rm-callout-warn">${ICON.warn}<span>Thin ES coverage: the moments lean on career stat rows. Check every year before you post.</span></p>` : ''}`;
      }
      body = `<div class="rm-ds-player">${G.playerRowHtml(c || { athleteId: src.athleteId, name: src.name, sport: src.sport }, { still: true })}</div><p class="rm-ds-angle"><span class="rm-meta">Angle</span> ${esc(src.angle)}</p>${cov}`;
    } else if (src.kind === 'clip') {
      const a = state.assets[src.assetId];
      const img = state.images[src.assetId];
      body = `<div class="rm-ds-clip"><span class="rm-clip__thumb" data-ds-poster>${img && img.src ? `<img src="${esc(img.src)}" alt="">` : ''}</span><span class="rm-clip__body"><span class="rm-clip__text">${esc(state.cp.clip?.text || a?.label || 'Clip')}</span><span class="rm-clip__meta">${esc({ x: 'X link', library: 'Clip library', upload: 'Your upload' }[src.origin])} · ${esc(G.fmtSec(src.segment?.in))}–${esc(G.fmtSec(src.segment?.out))}</span></span></div>`;
    }
    box.innerHTML = `<div class="rm-sec__head"><h3 class="rm-sec__title">${esc(f.label)}</h3>${src ? change : ''}</div>
      <p class="rm-hint">${esc(f.blurb)}</p>
      <div class="rm-ds-card">${body}</div>
      ${src ? `<div class="es-field"><label class="es-field__label" for="rm-angle">Angle <span class="rm-meta">optional</span></label><input class="es-input" id="rm-angle" type="text" maxlength="200" value="${esc(state.angle)}" placeholder="${esc({ gameswing: 'Lead with the fourth-quarter comeback', replay: 'The catch that sealed it', archive: 'Why he is the greatest' }[fmt])}"></div>` : ''}
      <p class="rm-ds-outputs">${f.outputs.map(o => `<span class="rm-gchip">${o === 'carousel' ? 'Carousel 1080×1350' : 'Reel 1080×1920'}</span>`).join('')}<span class="rm-gchip">${esc(S.get(S.suggestStyle({ format: fmt }).id).label)} style</span>${f.voice === 'off' ? '<span class="rm-gchip">Music only</span>' : ''}</p>`;
    const poster = box.querySelector('[data-ds-poster]');
    const pimg = src?.assetId && state.images[src.assetId];
    if (poster && pimg && pimg.tagName === 'CANVAS') { const cv = document.createElement('canvas'); cv.width = pimg.width; cv.height = pimg.height; cv.getContext('2d').drawImage(pimg, 0, 0); poster.append(cv); }
  }
  els.dataStory.addEventListener('click', event => {
    if (event.target.closest('[data-dsrc]')) goStep('source');
  });
  els.dataStory.addEventListener('change', event => {
    const box = event.target.closest('[data-keyplay]');
    if (!box) return;
    const id = box.dataset.keyplay;
    const max = window.ReelData?.MAX_KEY_PLAYS || 5;
    if (box.checked && state.keyPlays.length >= max) {
      box.checked = false;
      els.writeStatus.textContent = `A Game Swing reel covers up to ${max} plays. Untick one first.`;
      return;
    }
    els.writeStatus.textContent = '';
    state.keyPlays = box.checked ? [...new Set([...state.keyPlays, id])] : state.keyPlays.filter(x => x !== id);
    const order = (state.data.game?.plays || []).map(p => p.id);
    state.keyPlays.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const legend = els.dataStory.querySelector('.rm-keyplays .rm-meta');
    if (legend) legend.textContent = `${state.keyPlays.length} of ${order.length} picked`;
  });
  els.dataStory.addEventListener('input', event => { if (event.target.id === 'rm-angle') state.angle = event.target.value; });

  // ── Make (data formats): data / frames -> script -> voice -> visuals -> build ─
  async function makeDataReel() {
    const fmt = dataFmt();
    if (!FLOW.sourceReady(fmt, state.flow.source)) { els.writeStatus.textContent = `Pick a ${G.SOURCE_LABEL[srcKind()].toLowerCase()} first.`; goStep('source'); return; }
    if (fmt === 'gameswing' && state.data.game && !state.keyPlays.length) { els.writeStatus.textContent = 'Tick at least one key play.'; els.dataStory.querySelector('[data-keyplay]')?.focus(); return; }
    setWriteBusy(true);
    flowEvent({ type: 'make' });
    els.writeStatus.textContent = '';
    els.making.scrollIntoView?.({ block: 'nearest', behavior: calmMotion() ? 'auto' : 'smooth' });
    const started = Date.now();
    logStart();
    const ctxRun = { brief: '', title: '' };
    for (const stage of state.flow.stages.map(s => s.id)) {
      if (!state.flow.making) break;
      // eslint-disable-next-line no-await-in-loop
      await runStage(stage, fmt, ctxRun);
    }
    setWriteBusy(false);
    if (!state.flow.hasReel || state.flow.making || !state.timeline) {
      if (state.flow.error) { els.writeStatus.innerHTML = `${esc(state.flow.error)} <button class="rm-link" type="button" data-news>Use a brief instead</button>`; toast(state.flow.error, { tone: 'error' }); }
      return;
    }
    if (els.makingLive) els.makingLive.textContent = 'Your reel is ready.';
    renderEdit();
    goStep('edit', { focus: true });
    toast(F.FORMATS[fmt].outputs.includes('carousel') ? 'Your reel and carousel are ready.' : 'Your reel is ready. Change any scene on its card.');
    logEvent('make', { ms: Date.now() - started, style: styleId(), seconds: Math.round(state.timeline.durationMs / 1000), format: fmt, clipShare: clipShare().share, start: startOf() });
  }
  // "Use a brief instead": the news flow with a brief seeded from what the
  // data step did get (the game line, the player), never invented.
  els.writeStatus.addEventListener('click', event => {
    if (!event.target.closest('[data-news]')) return;
    const seed = (dataBrief() || state.flow.source?.label || state.flow.source?.name || '').slice(0, 2400);
    state.words = 'brief';
    setStart('words');
    if (!els.brief.value.trim()) els.brief.value = seed;
    els.writeStatus.textContent = '';
    els.brief.focus();
  });
  const done = (stage, note, extra = {}) => flowEvent({ type: 'stage-done', stage, note, ...extra });
  function dataBrief() {
    const fmt = dataFmt();
    const src = state.flow.source || {};
    if (fmt === 'gameswing') return G.briefFromGame(state.data.game, state.keyPlays, TL);
    if (fmt === 'archive') return G.briefFromArchive(state.data.athlete || { name: src.name }, state.data.archive, state.data.archive?.moments, src.angle);
    if (fmt === 'replay') return G.briefFromReplay(state.cp.clip, state.replay?.captions, state.angle);
    return '';
  }
  function dataTitle() {
    const src = state.flow.source || {};
    const d = state.data.game;
    if (src.kind === 'game' && d) return `${d.teams.away.name} at ${d.teams.home.name}`;
    if (src.kind === 'player') return `${src.name}: ${src.angle}`;
    return state.cp.clip?.text ? F.trimWords(state.cp.clip.text, 10) : 'The moment';
  }
  async function runStage(stage, fmt, run) {
    const src = state.flow.source;
    if (stage === 'data') {
      try {
        if (fmt === 'gameswing') {
          const d = state.data.game || await loadDigest();
          if (!d) throw new Error('Game data is unavailable; use the brief.');
          logEvent('data', { kind: 'game', sport: d.sport, eventId: d.eventId, plays: d.plays.length, wp: Boolean(d.wp?.points?.length) });
          done('data', `Free · ${d.plays.length} plays${d.wp?.points?.length ? ' · win probability' : ''}`);
        } else {
          const a = (state.researchState === 'ready' && state.data.archive) ? state.data.archive : await loadArchive();
          if (!a) throw new Error('The career data did not load.');
          if (!a.moments.length) throw new Error('No sourced moments were found for this player. Try another angle.');
          logEvent('data', { kind: 'archive', sport: src.sport, athleteId: src.athleteId, articles: a.sources.length, photos: a.photos.length, moments: a.moments.length, thin: a.thin });
          done('data', `Free · ${G.coverageText(state.research?.coverage)} · ${a.moments.length} moments`);
        }
      } catch (error) {
        const note = isSoon(error) ? `${F.FORMATS[fmt].label} data is coming soon.` : (error.reason === 'data-unavailable' ? 'Game data is unavailable; use the brief.' : error.message);
        done('data', note, { failed: true });
      }
      renderDataStory();
      return;
    }
    if (stage === 'frames') {
      const out = await pickFrames({ ai: true });
      done('frames', out.note, out.failed ? { failed: true } : {});
      return;
    }
    if (stage === 'script') {
      run.brief = dataBrief();
      run.title = dataTitle();
      const body = { mode: 'plan', brief: run.brief, format: fmt, sport: src.sport || '', tier: state.tier, style: state.style, look: lookId(), steer: state.angle.slice(0, 300), source: src, title: run.title.slice(0, 90), ...planData(fmt) };
      try {
        const data = await api(body);
        state.spent.director += Number(data.costs?.director) || 0;
        if (data.suggestedStyle) state.styleSuggested = data.suggestedStyle;
        data.plan.format = fmt;
        applyPlan(data, { brief: run.brief, go: false });
        done('script', `${data.plan.beats.length} beats · ${S.get(data.plan.style).label} · ${F.money(Number(data.costs?.director) || 0)}`);
      } catch (error) {
        if (!error.offline) { done('script', error.message, { failed: true }); return; }
        const plan = localPlan(fmt, run);
        applyPlan({ plan, source: 'draft', notice: 'The AI server is not reachable here, so the script is a draft built from the data.', corpus: run.brief, sources: [] }, { brief: run.brief, go: false });
        done('script', 'Draft from the data · free');
      }
      state.sources = [...dataSources(), ...state.sources];
      return;
    }
    if (stage === 'voice') {
      if (state.config.voice.ready && state.voiceOn) {
        const out = await makeVoice({ auto: true });
        done('voice', out.failed ? 'Captions only for now. Retry in Review.' : `${out.made + out.reused} lines`, out.failed ? { failed: true } : {});
      } else done('voice', state.config.voice.ready ? 'Music only (voice off)' : 'Captions only', { skipped: true });
      return;
    }
    if (stage === 'visuals') {
      try {
        if (fmt === 'archive') await archivePhotos();
        const v = await fillVisuals();
        done('visuals', v.note);
      } catch { done('visuals', 'Some beats still need a picture', { failed: true }); }
      return;
    }
    if (stage === 'build') {
      if (fmt === 'replay') replayVisuals();
      rebuild();
      if (S.get(styleId()).cutout && fmt !== 'replay') autoCutout();
      done('build', `${(state.timeline.durationMs / 1000).toFixed(0)} s${F.FORMATS[fmt].outputs.includes('carousel') ? ' · reel + carousel' : ''}`);
    }
  }
  // Offline or before the director knows the data formats: a free plan from
  // the data (reel-data.js when Agent A's module is here, else the draft).
  // What the data director plans from (contract §2.1 + A's plan hand-off):
  // the digest, the archive and athlete, or the replay frames and captions.
  function planData(fmt) {
    const src = state.flow.source || {};
    if (fmt === 'gameswing') return { digest: state.data.game, playIds: state.keyPlays.slice(), clips: state.useClips ? state.clipMatches.map(c => ({ url: c.url, handle: c.handle, text: c.text || '', postedAt: c.postedAt })) : [] };
    if (fmt === 'archive') {
      const a = state.data.archive || {};
      return { angle: src.angle, name: src.name, athlete: state.data.athlete, archive: { athleteId: a.athleteId, angle: a.angle, articles: a.sources || [], photos: a.photos || [], candidates: a.moments || [], coverage: state.research?.coverage || null, thin: Boolean(a.thin) } };
    }
    if (fmt === 'replay' && state.replay) return { replay: { origin: state.replay.origin, clipAsset: state.replay.clipAsset, clipUrl: state.replay.clipUrl, segment: state.replay.segment, picker: state.replay.picker, frames: state.replay.frames }, captions: state.replay.captions || undefined };
    return {};
  }
  // Offline draft: the server's sure clip matches go on their plays (the
  // server re-matches them itself when it plans).
  function attachMatchedClips(plan) {
    if (!state.useClips || !Array.isArray(plan?.beats)) return;
    const used = new Set();
    plan.beats.forEach(b => {
      const ref = b.kind === 'play' && (b.refs || []).find(r => r.startsWith('play:'));
      const m = ref && state.clipMatches.find(c => c.playId === ref.slice(5) && !used.has(c.url));
      if (!m) return;
      used.add(m.url);
      b.visual = 'clip';
      b.clip = { url: m.url, handle: m.handle || '', lagSec: m.lagSec, confidence: m.confidence, matchedBy: 'time' };
    });
  }
  function localPlan(fmt, run) {
    const RD = window.ReelData;
    let plan = null;
    try {
      if (fmt === 'gameswing' && RD?.planFromGame && state.data.game) { plan = RD.planFromGame(state.data.game, { title: run.title, playIds: state.keyPlays.slice() }); attachMatchedClips(plan); }
      if (fmt === 'archive' && RD?.planFromArchive && state.data.archive) plan = RD.planFromArchive(state.data.archive, state.data.athlete, { angle: state.flow.source?.angle, name: state.flow.source?.name, momentIds: state.data.archive.moments.map(m => m.id) });
      if (fmt === 'replay' && RD?.planFromReplay && state.replay) plan = RD.planFromReplay(state.replay, { captions: state.replay.captions || undefined, title: run.title });
    } catch { plan = null; }
    if (!plan || !Array.isArray(plan.beats) || !plan.beats.length) plan = F.fallbackPlan({ brief: run.brief, title: run.title, format: fmt, sport: state.flow.source?.sport || '' });
    plan.format = fmt;
    plan.style = state.style === 'auto' ? S.suggestStyle({ format: fmt }).id : state.style;
    if (fmt === 'gameswing' && state.data.game && !plan.team) {
      const d = state.data.game;
      const winner = d.teams.home.score >= d.teams.away.score ? d.teams.home : d.teams.away;
      const entry = LOGOLIB?.findTeam?.(winner.name, d.sport);
      plan.team = { name: winner.name, colors: entry?.colors || winner.colors || [], logo: '' };
    }
    return plan;
  }
  function dataSources() {
    const out = [];
    const d = state.data.game;
    if (dataFmt() === 'gameswing' && d) out.push({ type: 'data', title: `${d.source?.name || 'ESPN'} play-by-play and win probability`, url: d.source?.url || '' });
    if (dataFmt() === 'archive') {
      if (state.data.athlete?.source) out.push({ type: 'data', title: `${state.data.athlete.source.name} career stats`, url: state.data.athlete.source.url });
      (state.data.archive?.sources || []).forEach(a => out.push({ type: 'es-article', title: a.title, url: a.url }));
    }
    return out;
  }
  // Archive: ES photos from the research go on the beats first (moment
  // photo, then the rest in order); the fill chain covers what is left.
  async function archivePhotos() {
    const photos = state.data.archive?.photos || [];
    if (!photos.length || !state.plan) return;
    // Every ES photo is an asset photo:<id> (with its rights), so refs and
    // carousel slides draw it and the rights check covers it.
    photos.forEach(p => {
      const id = `photo:${p.id}`;
      if (!state.assets[id]) state.assets[id] = photoAsset({ src: p.url, title: p.caption || 'ES photo', credit: p.credit || '', source: 'es-archive' });
      if (!state.images[id]) loadImage(p.url, true).then(img => { if (img) { state.images[id] = img; draw(); } });
    });
    const queue = [...(state.research?.candidates || []).filter(c => c.photoId).map(c => photos.find(p => p.id === c.photoId)).filter(Boolean), ...photos];
    const used = new Set();
    for (const beat of state.plan.beats) {
      if (beat.kind === 'cta' || state.photos[beat.id]?.length) continue;
      const photo = queue.find(p => !used.has(p.id));
      if (!photo) break;
      used.add(photo.id);
      // eslint-disable-next-line no-await-in-loop
      await usePhoto(beat.id, { id: `photo:${photo.id}`, src: photo.url, title: photo.caption || 'ES photo', credit: photo.credit || '', source: 'es-archive' }, { quiet: true });
    }
  }

  // ── Replay frames: code pick (free), AI pick when it is on (capped) ──
  let frameVideo = null;
  async function replayVideo() {
    const id = state.flow.source?.assetId;
    const a = id && state.assets[id];
    if (!a?.src) return null;
    if (frameVideo && frameVideo.dataset.src === a.src) return frameVideo;
    frameVideo = await videoFrom(a.src);
    if (frameVideo) frameVideo.dataset.src = a.src;
    return frameVideo;
  }
  const seekTo = (v, t) => new Promise(resolve => {
    if (Math.abs(v.currentTime - t) < 0.02) { resolve(); return; }
    const timer = setTimeout(resolve, 1500);
    v.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
    try { v.currentTime = t; } catch { clearTimeout(timer); resolve(); }
  });
  async function grabFrame(t, width = 320) {
    const v = await replayVideo();
    if (!v) return null;
    await seekTo(v, t);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round(width * (v.videoHeight || 9) / (v.videoWidth || 16));
    try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch { return null; }
    return c;
  }
  // Each sampled frame stays under ~23K base64 characters so nine fit the
  // server's 220 KB body cap (it rejects anything over 60K per frame).
  const FRAME_B64_MAX = 23000;
  function smallJpeg(canvas) {
    let c = canvas;
    for (let q = 0.72; q >= 0.3; q -= 0.14) {
      const url = c.toDataURL('image/jpeg', q);
      if (url.length - 23 <= FRAME_B64_MAX) return url;
    }
    const s = document.createElement('canvas');
    s.width = 240; s.height = Math.round(240 * c.height / c.width);
    s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
    c = s;
    return c.toDataURL('image/jpeg', 0.4);
  }
  const RP = window.ReelReplay || null;
  // Full-size frames for the renderer (env.images['frame:<role>']).
  async function grabReplayFrames() {
    if (!RP?.grabFrames || !state.replay) return;
    const v = await replayVideo();
    if (!v) return;
    Object.assign(state.images, await RP.grabFrames(v, state.replay.frames));
    draw();
  }
  const grabReplaySoon = debounce(() => grabReplayFrames(), 300);
  // ReelReplay (Agent B): sample the segment, code pick, AI pick request
  // under the body cap, apply the answer (bad indices fall back to code).
  async function pickFramesRP(ai) {
    const src = state.flow.source;
    const v = await replayVideo();
    const segment = state.replay.segment;
    const samples = v ? await RP.sampleSegment(v, segment) : [];
    const cands = RP.candidateFrames(samples, { segment });
    const code = RP.codePick(cands);
    if (code.length === 3) state.replay.frames = code;
    const canAi = ai && modeOn('frame-pick') && state.config.ai && !state.config.offline && cands.candidates.length;
    let note = `Code pick · free${modeOn('frame-pick') ? '' : ' (AI pick coming soon)'}`;
    let failed = false;
    if (canAi) {
      let response = null;
      try { response = await api(RP.pickRequest(cands, { clipUrl: src.url || '', segment, budgetUsd: F.PRICES.framePickCap })); } catch (error) { if (isSoon(error)) markSoon('frame-pick'); failed = true; note = `Code pick used: ${isSoon(error) ? 'the AI pick is coming soon' : (error.message || 'the AI pick failed')}`; }
      if (response) {
        const out = RP.applyPick(cands, response.picker === 'code' ? null : response);
        state.replay.frames = out.frames;
        state.replay.picker = out.picker;
        state.replay.captions = Object.keys(out.captions || {}).length ? out.captions : null;
        state.spent.framePick = (state.spent.framePick || 0) + (Number(response.cost) || 0);
        note = out.picker === 'ai' ? `AI pick · ${F.money(Number(response.cost) || 0)}${response.cached ? ' (cached)' : ''}` : `Code pick · free${response.capped ? ' (AI cap reached)' : ''}`;
      }
    }
    logEvent('frames', { picker: state.replay.picker, cost: state.spent.framePick || 0 });
    await grabReplayFrames();
    return { note, failed };
  }
  async function pickFrames({ ai = true } = {}) {
    const src = state.flow.source;
    const segment = src.segment || { in: 0, out: (state.assets[src.assetId]?.durationMs || 6000) / 1000 };
    state.replay = { origin: src.origin, clipAsset: src.assetId, clipUrl: src.url || '', segment: { ...segment }, picker: 'code', frames: G.codeFrames(segment), captions: state.replay?.captions || null };
    if (RP?.candidateFrames && RP.sampleSegment && RP.applyPick) return pickFramesRP(ai);
    const canAi = ai && modeOn('frame-pick') && state.config.ai && !state.config.offline;
    if (!canAi) { logEvent('frames', { picker: 'code' }); return { note: `Code pick · free${modeOn('frame-pick') ? '' : ' (AI pick coming soon)'}` }; }
    try {
      const times = G.sampleTimes(segment, 9);
      const frames = [];
      for (const t of times) {
        // eslint-disable-next-line no-await-in-loop
        const c = await grabFrame(t, 320);
        if (!c) throw new Error('The clip frames could not be read.');
        frames.push(smallJpeg(c));
      }
      const data = await api({ mode: 'frame-pick', clipUrl: src.url || '', segment, frames, times, budgetUsd: F.PRICES.framePickCap });
      // Over the cap (or AI off on the server) the server answers with its own code pick.
      if (data.picker === 'code') { logEvent('frames', { picker: 'code', capped: Boolean(data.capped) }); return { note: `Code pick · free${data.capped ? ' (AI cap reached)' : ''}` }; }
      const picked = G.framesFromPick(data, times);
      if (!picked) throw new Error('The AI pick came back incomplete.');
      state.replay.frames = picked;
      state.replay.picker = 'ai';
      state.replay.captions = data.captions || null;
      state.spent.framePick = (state.spent.framePick || 0) + (Number(data.cost) || 0);
      logEvent('frames', { picker: 'ai', cost: Number(data.cost) || 0, cached: Boolean(data.cached) });
      return { note: `AI pick · ${F.money(Number(data.cost) || 0)}${data.cached ? ' (cached)' : ''}` };
    } catch (error) {
      if (isSoon(error)) markSoon('frame-pick');
      logEvent('frames', { picker: 'code', aiFailed: true });
      return { failed: true, note: `Code pick used: ${isSoon(error) ? 'the AI pick is coming soon' : (error.message || 'the AI pick failed')}` };
    }
  }
  // Every beat plays its stretch of the replay clip (the strip and slides
  // are drawn from timeline.replay by the renderer).
  function replayVisuals() {
    const r = state.replay;
    const base = r && state.assets[r.clipAsset];
    if (!base || !state.plan) return;
    const use = `${r.clipAsset}@seg`;
    state.assets[use] = { ...base, clipIn: r.segment.in, clipOut: r.segment.out };
    state.videos[use] = state.videos[r.clipAsset];
    if (state.images[r.clipAsset]) state.images[use] = state.images[r.clipAsset];
    state.plan.beats.forEach(b => { if (b.kind !== 'cta') setVisual(b.id, [use], r.origin === 'upload' ? 'upload-clip' : 'x-clip'); else setVisual(b.id, [designAsset()], 'design'); });
  }

  // ── What the timeline carries for a data format (contract §3) ──
  function dataTimeline(tl) {
    const fmt = dataFmt() || (state.plan && F.isDataFormat(state.plan.format) ? state.plan.format : '');
    if (!fmt || !TL || !tl) return tl;
    tl.v = 2;
    tl.canvas = tl.canvas || { w: 1080, h: 1920 };
    tl.outputs = F.FORMATS[fmt].outputs.slice();
    tl.data = { game: fmt === 'gameswing' ? state.data.game : null, athlete: fmt === 'archive' ? state.data.athlete : null, archive: fmt === 'archive' ? state.data.archive : null };
    tl.replay = fmt === 'replay' && state.replay ? { origin: state.replay.origin, clipAsset: state.replay.clipAsset, clipUrl: state.replay.clipUrl, segment: state.replay.segment, picker: state.replay.picker, frames: state.replay.frames } : null;
    if (!Array.isArray(tl.slides)) tl.slides = [];
    if (Array.isArray(tl.beats)) tl.beats.forEach(b => { if (!Array.isArray(b.refs)) b.refs = (state.plan.beats.find(x => x.id === b.id)?.refs || []).slice(); });
    return tl;
  }
  // Facts the lint reads for a data format: the digest's facts text, the
  // archive's cited lines and stat rows, the frame-pick captions.
  function dataFacts() {
    const fmt = dataFmt() || (state.plan && F.isDataFormat(state.plan.format) ? state.plan.format : '');
    if (!fmt || !TL) return '';
    if (fmt === 'gameswing') return TL.digestFacts(state.data.game);
    if (fmt === 'archive') {
      const a = state.data.athlete;
      const rows = (a?.stats?.seasons || []).map(s => `${s.year}: ${a.stats.labels.map((l, i) => `${s.stats[i]} ${l}`).join(', ')}.`);
      return [dataBrief(), ...rows, a?.stats?.totals ? `Career: ${a.stats.labels.map((l, i) => `${a.stats.totals[i]} ${l}`).join(', ')}.` : ''].join('\n');
    }
    return dataBrief();
  }

  // ── Review: the data panel per format ──
  function renderDataReview() {
    const fmt = state.plan && F.isDataFormat(state.plan.format) ? state.plan.format : '';
    const box = els.dataReview;
    box.hidden = !fmt || !G;
    els.view.hidden = !fmt || !F.FORMATS[fmt].outputs.includes('carousel');
    if (!fmt || !G) { box.innerHTML = ''; return; }
    if (fmt === 'gameswing') box.innerHTML = gameReviewHtml();
    if (fmt === 'replay') { box.innerHTML = replayReviewHtml(); drawFrameThumbs(); }
    if (fmt === 'archive') box.innerHTML = archiveReviewHtml();
  }
  function gameReviewHtml() {
    const d = state.data.game;
    if (!d) return `<div class="rm-sec__head"><h3 class="rm-sec__title">The game</h3></div><p class="rm-hint">The game data is not loaded. Make the reel again to fetch it.</p>`;
    const beats = state.plan.beats.map((b, i) => ({ b, i, ref: (b.refs || []).find(r => r.startsWith('play:')) })).filter(x => x.ref);
    const opts = sel => d.plays.map(p => `<option value="${esc(p.id)}" ${`play:${p.id}` === sel ? 'selected' : ''}>${esc(`${G.playWhen(p, d.sport)} · ${p.text}`.slice(0, 80))}</option>`).join('');
    const line = ['away', 'home'].map(s => `<tr><th scope="row">${esc(d.teams[s].abbr)}</th>${d.teams[s].linescore.map(n => `<td>${esc(n)}</td>`).join('')}<td class="rm-ls__t">${esc(d.teams[s].score)}</td></tr>`).join('');
    return `<div class="rm-sec__head"><h3 class="rm-sec__title">The game</h3><span class="rm-meta">${esc(d.source?.name || 'ESPN')} data · free</span></div>
      <div class="rm-ls-wrap"><table class="rm-ls"><caption class="es-sr-only">Score by period</caption><thead><tr><th scope="col"><span class="es-sr-only">Team</span></th>${d.teams.home.linescore.map((_, i) => `<th scope="col">${d.sport === 'mlb' ? i + 1 : `Q${i + 1}`}</th>`).join('')}<th scope="col">T</th></tr></thead><tbody>${line}</tbody></table></div>
      ${d.wp?.points?.length ? `<p class="rm-attrib">${esc(d.attribution)}</p>` : ''}
      ${beats.length ? `<div class="rm-swaps"><p class="es-field__label">Swap a play</p>${beats.map(x => `<div class="rm-swap"><label class="rm-swap__label" for="rm-swap-${esc(x.b.id)}">Beat ${x.i + 1}</label><select class="es-select es-select--sm" id="rm-swap-${esc(x.b.id)}" data-swapplay="${esc(x.b.id)}">${opts(x.ref)}</select></div>`).join('')}<p class="rm-hint">The score, clock and win probability on screen come from the play you pick, never typed.</p></div>`
        : `<div class="rm-swaps"><p class="es-field__label">Key plays in this reel</p><ul class="rm-playlist">${d.plays.filter(p => state.keyPlays.includes(p.id)).map(p => `<li><span class="rm-keyplay__when">${esc(G.playWhen(p, d.sport))}</span><span>${esc(p.text)}</span></li>`).join('')}</ul><button class="es-btn es-btn--sm" type="button" data-remake>Change the plays</button></div>`}`;
  }
  function replayReviewHtml() {
    const r = state.replay;
    if (!r) return `<div class="rm-sec__head"><h3 class="rm-sec__title">The three frames</h3></div><p class="rm-hint">Make the reel to pick the frames.</p>`;
    const canAi = modeOn('frame-pick') && state.config.ai && !state.config.offline;
    const picker = { ai: 'AI pick', code: 'Code pick · free', manual: 'Adjusted by you' }[r.picker] || '';
    return `<div class="rm-sec__head"><h3 class="rm-sec__title">The three frames</h3><span class="rm-meta">${esc(picker)}</span></div>
      <div class="rm-frames">${r.frames.map(fr => `<div class="rm-frame" data-role="${esc(fr.role)}"><div class="rm-frame__img"><canvas width="320" height="180" data-framethumb="${esc(fr.role)}" aria-hidden="true"></canvas><span class="rm-frame__chip">${esc(G.ROLE_LABEL[fr.role])}</span></div>
        <label class="rm-frame__row"><span class="es-sr-only">${esc(G.ROLE_LABEL[fr.role])} frame time</span><input type="range" data-frame="${esc(fr.role)}" min="${r.segment.in}" max="${r.segment.out}" step="0.1" value="${fr.t}" aria-valuetext="${G.fmtSec(fr.t)}"><output>${G.fmtSec(fr.t)}</output></label>
        ${r.captions?.[fr.role] ? `<p class="rm-frame__cap">${esc(r.captions[fr.role])}</p>` : ''}</div>`).join('')}</div>
      <p class="rm-hint">Drag a slider to move that panel’s frame inside the moment.</p>
      ${canAi ? `<button class="es-btn es-btn--sm" type="button" data-repick>${ICON.sparkles}<span>Re-pick with AI · about ${F.money(F.PRICES.framePick)}</span></button>` : ''}`;
  }
  let thumbJob = 0;
  async function drawFrameThumbs(only = '') {
    const job = ++thumbJob;
    for (const fr of state.replay?.frames || []) {
      if (only && fr.role !== only) continue;
      // eslint-disable-next-line no-await-in-loop
      const c = await grabFrame(fr.t, 320);
      if (job !== thumbJob && !only) return;
      const cv = els.dataReview.querySelector(`[data-framethumb="${fr.role}"]`);
      if (!cv || !c) continue;
      const g = cv.getContext('2d');
      g.fillStyle = '#101114'; g.fillRect(0, 0, cv.width, cv.height);
      const k = Math.min(cv.width / c.width, cv.height / c.height);
      g.drawImage(c, (cv.width - c.width * k) / 2, (cv.height - c.height * k) / 2, c.width * k, c.height * k);
    }
  }
  const frameThumbSoon = debounce(role => drawFrameThumbs(role), 120);
  function archiveReviewHtml() {
    const a = state.data.archive;
    if (!a) return `<div class="rm-sec__head"><h3 class="rm-sec__title">Moments</h3></div><p class="rm-hint">The archive data is not loaded. Make the reel again to fetch it.</p>`;
    const cands = state.research?.candidates || [];
    const srcRows = G.archiveSources(a, state.data.athlete, a.moments);
    const citeHtml = m => (m.cite || []).map(ref => {
      const row = srcRows.find(r => r.ref === ref);
      return row ? (row.url ? `<a class="rm-cite" href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">${esc(row.kind === 'article' ? `ES ${row.year || ''}` : row.label)}</a>` : `<span class="rm-cite">${esc(row.label)}</span>`) : `<span class="rm-cite is-bad">${esc(ref)}</span>`;
    }).join('');
    return `<div class="rm-sec__head"><h3 class="rm-sec__title">Moments</h3><span class="rm-meta">${esc(G.coverageText(state.research?.coverage))}</span></div>
      ${a.thin ? `<p class="rm-callout-warn">${ICON.warn}<span>Thin ES coverage. Every moment still cites a source; check the years before you post.</span></p>` : ''}
      <ol class="rm-moments">${a.moments.map((m, i) => `<li class="rm-moment"><span class="rm-moment__year">${esc(m.year)}</span><div class="rm-moment__body"><p class="rm-moment__title">${esc(m.title)}</p>${m.line ? `<p class="rm-hint">${esc(m.line)}</p>` : ''}<p class="rm-moment__cites">${citeHtml(m)}</p></div>
        ${cands.length > a.moments.length ? `<label class="es-sr-only" for="rm-mswap-${i}">Swap moment ${i + 1}</label><select class="es-select es-select--sm rm-moment__swap" id="rm-mswap-${i}" data-swapmoment="${i}"><option value="">Swap…</option>${cands.filter(c => !a.moments.some(x => x.id === c.id)).map(c => `<option value="${esc(c.id)}">${esc(`${c.year} · ${c.title}`.slice(0, 60))}</option>`).join('')}</select>` : ''}</li>`).join('')}</ol>
      <details class="rm-fold rm-arch-sources" id="rm-arch-sources" open><summary><span class="rm-fold__title">Sources</span><span class="rm-fold__meta">${srcRows.length} · every year and number links here</span></summary>
        <div class="rm-fold__body">${srcRows.length ? `<ul class="rm-srclist">${srcRows.map(r => `<li class="${r.cited ? 'is-cited' : ''}"><span class="rm-srclist__year">${esc(r.year || '—')}</span><span class="rm-srclist__body"><span class="rm-srclist__kind">${esc(r.label)}${r.cited ? ' · <b>cited</b>' : ''}</span>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>` : `<span>${esc(r.title)}</span>`}</span></li>`).join('')}</ul>` : '<p class="rm-hint">No sources yet.</p>'}</div></details>`;
  }
  els.dataReview.addEventListener('input', event => {
    const input = event.target.closest('[data-frame]');
    if (!input || !state.replay) return;
    if (RP?.scrubberModel && RP.scrub) {
      // Each panel keeps the three frames in order (setup, play, reaction).
      const model = RP.scrub(RP.scrubberModel(state.replay), input.dataset.frame, Number(input.value));
      const caps = Object.fromEntries(state.replay.frames.map(f => [f.role, f.caption]));
      state.replay.frames = RP.framesOf(model).map(f => (caps[f.role] ? { ...f, caption: caps[f.role] } : f));
      input.value = String(state.replay.frames.find(f => f.role === input.dataset.frame).t);
    } else state.replay.frames.find(f => f.role === input.dataset.frame).t = Number(input.value);
    const fr = state.replay.frames.find(f => f.role === input.dataset.frame);
    state.replay.picker = 'manual';
    grabReplaySoon();
    input.setAttribute('aria-valuetext', G.fmtSec(fr.t));
    const out = input.parentNode.querySelector('output');
    if (out) out.textContent = G.fmtSec(fr.t);
    const meta = els.dataReview.querySelector('.rm-sec__head .rm-meta');
    if (meta) meta.textContent = 'Adjusted by you';
    frameThumbSoon(fr.role);
    rebuildSoon();
  });
  els.dataReview.addEventListener('change', event => {
    const sp = event.target.closest('[data-swapplay]');
    if (sp) {
      const beat = state.plan.beats.find(b => b.id === sp.dataset.swapplay);
      const play = state.data.game.plays.find(p => p.id === sp.value);
      if (!beat || !play) return;
      beat.refs = [...(beat.refs || []).filter(r => !r.startsWith('play:') && !r.startsWith('wp:')), `play:${play.id}`];
      if (play.wpHome != null && state.data.game.wp?.points?.some(p => p[0] === play.seq)) beat.refs.push(`wp:${play.seq}`);
      beat.text = F.trimWords(play.text, F.PACE.textMaxWords);
      rebuild(); renderBeats();
      logEvent('edit', { what: 'swap-play' });
      return;
    }
    const sm = event.target.closest('[data-swapmoment]');
    if (sm && sm.value) swapMoment(Number(sm.dataset.swapmoment), sm.value);
  });
  els.dataReview.addEventListener('click', event => {
    if (event.target.closest('[data-remake]')) { goStep('topic'); return; }
    const re = event.target.closest('[data-repick]');
    if (re) {
      re.disabled = true;
      pickFrames({ ai: true }).then(out => { toast(out.note, out.failed ? { tone: 'error' } : {}); rebuild(); renderDataReview(); });
    }
  });
  function swapMoment(i, candId) {
    const a = state.data.archive;
    const cand = (state.research?.candidates || []).find(c => c.id === candId);
    if (!a || !cand) return;
    const old = a.moments[i];
    a.moments[i] = { id: cand.id, year: cand.year, title: cand.title, line: cand.line, cite: cand.cite.slice() };
    // The beat that told the old moment now tells the new one (its refs and words come from the candidate).
    const beat = state.plan.beats.find(b => (b.refs || []).some(r => (old.cite || []).includes(r))) || state.plan.beats.find(b => b.text && old.title && b.text.includes(String(old.year)));
    if (beat) {
      beat.refs = [...(beat.refs || []).filter(r => !(old.cite || []).includes(r)), ...cand.cite];
      beat.text = F.trimWords(`${cand.year}: ${cand.title}`, F.PACE.textMaxWords);
      if (cand.line) beat.vo = F.trimWords(`${cand.year}. ${cand.line}.`, F.PACE.voMaxWords);
      voiceSoon();
    }
    rebuild(); renderEdit();
    logEvent('edit', { what: 'swap-moment' });
  }

  // ── Carousel preview (Replay and Archive) ──
  // Slides come from the renderer's buildSlides (Agent B); until it lands the
  // Carousel view explains that and the reel still exports.
  const hasSlides = () => typeof R.buildSlides === 'function';
  function buildSlidesNow() {
    if (!hasSlides() || !state.plan) return null;
    try {
      const out = R.buildSlides(state.timeline, { style: styleId() });
      return Array.isArray(out) ? out : (out?.slides || null);
    } catch (error) { console.warn('buildSlides failed', error); return null; }
  }
  function setView(view) {
    state.view = view;
    radios(els.view, 'view', view);
    const slide = view === 'carousel';
    els.device.classList.toggle('is-slide', slide);
    els.canvas.height = slide ? 1350 : ((state.timeline && state.timeline.size && state.timeline.size[1]) || 1920);
    els.device.classList.toggle('is-45', !slide && els.canvas.height === 1350);
    els.transport.hidden = slide;
    els.slidenav.hidden = !slide;
    els.canvas.setAttribute('aria-label', slide ? 'Carousel slide preview' : 'Reel preview');
    if (slide) { stop(); state.slides = buildSlidesNow(); state.slide = Math.min(state.slide, Math.max(0, (state.slides?.length || 1) - 1)); }
    renderSlideNav();
    if (slide) els.stageMeta.textContent = `Carousel · ${state.slides?.length || 0} slides · 1080×1350`; else renderMeta();
    draw();
  }
  function renderSlideNav() {
    const n = state.slides?.length || 0;
    els.slidePos.textContent = n ? `Slide ${state.slide + 1} of ${n}` : 'Slides coming soon';
    els.slideDots.innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i === state.slide ? 'is-on' : ''}"></span>`).join('');
    els.slidePrev.disabled = !n || state.slide === 0;
    els.slideNext.disabled = !n || state.slide >= n - 1;
  }
  function drawSlide() {
    ctx.fillStyle = '#101114';
    ctx.fillRect(0, 0, 1080, 1350);
    const slide = state.slides?.[state.slide];
    if (!slide) {
      ctx.fillStyle = '#BFC8D9';
      ctx.font = '500 40px Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('The carousel preview arrives', 540, 640);
      ctx.fillText('with the slide renderer.', 540, 696);
      ctx.textAlign = 'start';
      return;
    }
    const slideEnv = { ...env, layoutCache: g => R.layoutGraphic(measure, g, slide), captionCache: card => R.layoutCaption(measure, card, slide) };
    try { R.drawFrame(ctx, slide, Math.max(0, (slide.durationMs || 1) - 1), slideEnv); } catch (error) { console.warn('slide draw failed', error); }
  }
  els.view.addEventListener('click', event => { const b = event.target.closest('[data-view]'); if (b && b.dataset.view !== state.view) setView(b.dataset.view); });
  els.slidePrev.addEventListener('click', () => { state.slide = Math.max(0, state.slide - 1); renderSlideNav(); draw(); });
  els.slideNext.addEventListener('click', () => { state.slide = Math.min((state.slides?.length || 1) - 1, state.slide + 1); renderSlideNav(); draw(); });
  els.device.addEventListener('keydown', event => {
    if (state.view !== 'carousel' || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    (event.key === 'ArrowLeft' ? els.slidePrev : els.slideNext).click();
  });
  // Swipe between slides on touch screens.
  let swipeX = null;
  els.device.addEventListener('pointerdown', event => { if (state.view === 'carousel') swipeX = event.clientX; });
  els.device.addEventListener('pointerup', event => {
    if (swipeX == null) return;
    const dx = event.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) > 40) (dx > 0 ? els.slidePrev : els.slideNext).click();
  });

  // ── Export: carousel PNG zip, paid-ad warning for league footage ──
  function renderDataExport() {
    const fmt = state.plan && F.isDataFormat(state.plan.format) ? state.plan.format : '';
    const carousel = Boolean(fmt) && F.FORMATS[fmt].outputs.includes('carousel');
    els.carouselBtn.hidden = !carousel;
    els.carouselNote.hidden = !carousel;
    if (carousel) {
      const ready = hasSlides() && typeof X.exportStills === 'function';
      els.carouselBtn.disabled = !ready || Boolean(state.lint && !state.lint.ok) || Boolean(state.exportingStills);
      const n = ready ? (buildSlidesNow()?.length || 0) : 0;
      els.carouselNote.textContent = ready ? `${n} slides, 1080×1350, as a PNG zip with a cover JPEG. Every slide keeps the ES mark and the sources.` : 'The carousel export arrives with the slide renderer. The reel exports today.';
    }
    const warn = $('rm-paid-warn');
    const league = fmt === 'replay' && state.target === 'paid' && F.FORMATS.replay.rights.paidWithLeagueFootage === 'warn' && state.replay?.origin !== 'upload';
    if (warn) warn.remove();
    if (league) els.rights.insertAdjacentHTML('afterbegin', `<p class="rm-callout-warn" id="rm-paid-warn">${ICON.warn}<span>This paid ad uses league footage from X. Check the footage rights before it runs.</span></p>`);
    const attrib = fmt === 'gameswing' && state.data.game?.wp?.points?.length;
    if (attrib && !$('rm-attrib-export')) els.rights.insertAdjacentHTML('beforeend', `<p class="rm-attrib" id="rm-attrib-export">On screen: ${esc(state.data.game.attribution)}</p>`);
  }
  async function exportCarousel() {
    if (state.exportingStills) return;
    const slides = buildSlidesNow();
    if (!slides?.length || typeof X.exportStills !== 'function') return;
    state.exportingStills = true;
    els.carouselBtn.setAttribute('aria-busy', 'true');
    els.carouselStatus.textContent = `Drawing ${slides.length} slides…`;
    try {
      await ensureImages();
      const blob = await X.exportStills(slides, { env, R, onProgress: (i, total) => { els.carouselStatus.textContent = `Drawing slide ${i} of ${total}…`; } });
      const url = URL.createObjectURL(blob);
      const name = `es-carousel-${slug(state.plan.title)}-1080x1350.zip`;
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.append(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
      els.carouselStatus.textContent = `Exported ${slides.length} slides (${(blob.size / 1048576).toFixed(1)} MB).`;
      logEvent('carousel_export', { slides: slides.length, format: state.plan.format, target: state.target });
      window.FrameUpTrack?.exported?.({ tool: 'reels-studio', format: 'zip', dest: 'download', label: name, width: 1080, height: 1350, bytes: blob.size, count: slides.length, template: state.plan.format, thumb: els.canvas, meta: { kind: 'carousel' } });
      toast('Carousel exported', { tone: 'good' });
    } catch (error) {
      els.carouselStatus.textContent = error.message || 'The carousel export failed. Try again.';
    } finally {
      state.exportingStills = false;
      els.carouselBtn.removeAttribute('aria-busy');
    }
  }
  els.carouselBtn.addEventListener('click', exportCarousel);

  // ── Projects: what a data reel keeps (timeline v2 fields) ──
  function dataSnapshot() {
    const fmt = state.plan && F.isDataFormat(state.plan.format) ? state.plan.format : '';
    if (!fmt) return null;
    return { v: 2, outputs: F.FORMATS[fmt].outputs.slice(), data: { ...state.data }, replay: state.replay, source: state.flow.source, angle: state.angle, keyPlays: state.keyPlays, research: state.research ? { candidates: state.research.candidates, coverage: state.research.coverage, angle: state.research.angle } : null, game: state.gameSummary || null };
  }
  function restoreData(t, format) {
    if (!G || !TL || !F.isDataFormat(format)) {
      if (dataFmt()) { state.flow = FLOW.initial(); leaveDataPrefs(); }
      renderStepsNav(); renderDataStory(); renderStart();
      return;
    }
    if (!dataFmt()) newsPrefs = { voiceOn: state.voiceOn, useClips: state.useClips, style: state.style };
    state.flow = { ...FLOW.initial(format), source: t.source || null, step: 'review', hasReel: true };
    state.flow.stages = state.flow.stages.map(s => ({ ...s, state: 'done' }));
    state.data = { game: t.data?.game || null, athlete: t.data?.athlete || null, archive: t.data?.archive || null };
    state.replay = t.replay || null;
    state.angle = t.angle || '';
    state.keyPlays = Array.isArray(t.keyPlays) ? t.keyPlays : [];
    state.research = t.research || null;
    state.gameSummary = t.game || null;
    state.digestState = state.data.game ? 'ready' : 'idle';
    state.researchState = state.research ? 'ready' : 'idle';
    if (t.source?.kind === 'player') { state.pp.selected = t.source.athleteId; state.pp.candidate = { athleteId: t.source.athleteId, name: t.source.name, sport: t.source.sport }; state.pp.angle = t.source.angle; }
    if (t.source?.kind === 'game') state.gp.selected = t.source.eventId;
    renderStepsNav(); renderSourceStep(); renderDataStory(); renderStart();
  }

  // ─── Boot ────────────────────────────────────────────────────────────────
  async function loadConfig() {
    try {
      const data = await api({ mode: 'config' });
      // A partial or old config reply (no voice block) must never break the page: captions only.
      state.config = { ai: data.ai, voice: { mode: 'off', ready: false, label: 'Captions only', ...(data.voice && typeof data.voice === 'object' ? data.voice : {}) }, music: data.music || null, aiClips: data.aiClips || null, offline: false, formatModes: data.formatModes || {}, dataFormats: data.dataFormats || [] };
      if (data.voice?.defaultVoice && !(data.voice.voices || []).some(v => v.id === state.voiceId)) state.voiceId = data.voice.defaultVoice;
      if (data.admin === true) state.config.admin = true;
    } catch (error) {
      state.config = { ai: false, voice: { mode: 'off', ready: false, label: 'Captions only', reason: 'The voice server is not reachable from here.' }, offline: Boolean(error.offline), formatModes: {} };
    }
    if (G && TL) renderDataStory();
    syncStart();
    els.factcheckRow.hidden = !state.config.ai;
    const gen = $('rm-music-gen-row');
    if (gen) {
      gen.hidden = !data_music(state.config);
      $('rm-music-gen').onclick = generateMusic;
    }
    els.aiclipsRow.hidden = !state.config.aiClips?.ready;
    if (state.config.aiClips?.ready) els.aiclipsNote.textContent = `Stadium, crowd or field shots, never people or logos. Up to ${state.config.aiClips.max} a reel, about ${F.money(state.config.aiClips.perClip)} each.`;
    if (!state.flow.making) els.writeText.textContent = writeLabel();
    renderCost();
    renderVoicePickers();
    if (state.plan) { renderVoice(); renderEdit(); }
    renderStyles4();
    syncAdmin();
  }
  const data_music = config => Boolean(config.music && config.music.ready);
  function readHandoff() {
    try {
      const q = new URLSearchParams(location.search);
      const h = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null');
      const m = h && (!q.get('trend') || h.id === q.get('trend')) ? h
        : q.get('moment') ? { id: q.get('trend') || 'trend-link', title: q.get('moment'), sport: q.get('sport') || '', team: q.get('team') || '', related: [] } : null;
      if (q.get('brief')) {
        state.source = 'brief'; state.words = 'brief'; state.start = 'words';
        els.brief.value = q.get('brief').slice(0, 2400);
      } else if (m && m.title) {
        state.trend = { id: String(m.id || 'trend-link'), title: String(m.title).slice(0, 300), sport: TREND_SPORTS.includes(m.sport) ? m.sport : '', team: m.team || '', url: m.url || '', why: m.why || '', related: Array.isArray(m.related) ? m.related.slice(0, 4) : [] };
        if (!state.trends.some(t => t.id === state.trend.id)) state.trends.unshift({ ...state.trend, format: F.routeFormat(state.trend.title).format });
      }
      sessionStorage.removeItem(HANDOFF_KEY);
      if (m || q.get('brief')) history.replaceState(null, '', location.pathname);
    } catch { /* no hand-off */ }
    syncStart();
  }

  renderLeagues();
  readHandoff();
  renderTrends();
  renderPicked();
  renderFormats();
  renderStyles();
  renderVoicePickers();
  renderCost();
  renderRecent();
  draw();
  goStep('topic', { focus: false });
  syncAdmin();
  // The app shell shows its admin link after sign-in: the admin rows follow.
  setTimeout(syncAdmin, 2600);
  loadConfig();
  loadMusicLibrary();
  loadTrends().then(() => {
    if (state.trend && !state.trends.some(t => t.id === state.trend.id)) state.trends.unshift({ ...state.trend, format: F.routeFormat(state.trend.title).format });
    renderTrends();
    renderPicked();
  });
  window.addEventListener('beforeunload', () => { if (state.plan) store.set(LOCAL_KEY, [snapshot(), ...store.get(LOCAL_KEY, []).filter(p => p.id !== state.projectId)].slice(0, 12)); });

  window.ReelMakerPage = { pickFormat: G && TL ? pickFormat : null, openGallery: G && TL ? openGallery : null, setSource: G && TL ? setSource : null, setView: G && TL ? setView : null, state, rebuild, applyPlan, draw, seek, play, stop, goStep, renderMix, exportReel, makeVoice, restore, loadConfig, loadTrends, makeReel, fillVisuals, selectBeat, renderEdit, renderStyles, visualAction, addClipAsset, setVisual, clipShare };
  // ── Page context for add-on modules (Reels Studio 2.0) ────────────────────
  // New features (storyboard, media tray, voice input, ideas room, radar,
  // a11y) live in their own files and attach here instead of growing this
  // one. No behaviour change: this only publishes what the page already has.
  //   ctx.on(event, fn) / ctx.emit(event, data): 'plan' (a plan was applied),
  //   'rebuild' (timeline rebuilt), 'beat' (selection changed), 'step'.
  //   ctx.register(name, api): a module publishes its own API for others.
  const ctxListeners = new Map();
  const pageCtx = {
    state, els, store, F, R, ES: window.ReelES || null,
    api, toast, logEvent, goStep, rebuild, draw, seek, play, stop, applyPlan, restore, snapshot,
    selectBeat, addBeat, renderBeats, renderStrip, renderEdit, renderExport, renderLint, renderAutoline, renderStyles, renderTrends, renderRecent,
    setEsField, setField, esFields, beatFields, visualCard, visualAction, setVisual,
    addClipAsset, loadClip, useXClip, usePhoto, searchPhotos, fillVisuals, setMusic,
    makeReel, makeFromScript, makeVoice, ensureVoice, restoreVoiceFromCache, renderMix, exportReel, exportCarousel, costHtml, readHandoff,
    modules: {},
    register(name, moduleApi) { pageCtx.modules[name] = moduleApi; pageCtx.emit('module', { name }); return moduleApi; },
    on(event, fn) { if (!ctxListeners.has(event)) ctxListeners.set(event, new Set()); ctxListeners.get(event).add(fn); return () => ctxListeners.get(event)?.delete(fn); },
    emit(event, data) { (ctxListeners.get(event) || []).forEach(fn => { try { fn(data); } catch (error) { window.FrameUpErrors?.report?.(error, `reels ctx ${event}`); } }); },
  };
  // ── Reels 2.0: D (interface) ── what the storyboard and accessibility modules
  // read from the page (additive: nothing above changes shape).
  pageCtx.ui = {
    ICON, esc, fmtTime, debounce, measure, envFor, grain,
    esOn, scriptLocked, beatName, styleId, seekBeat, sceneAt, wipeMs, setCalm, setStart, syncStart, useVersion, makeVersions,
    // ── Reels Studio v3 (UI) ── the scene strip and the picked scene's editor (reel-storyboard.js).
    swapCandidates, useCandidate, useNoMedia, mediaKey, curStyle, styleDef, isAdmin, renderSceneEditor, sourcingOn: srcOn,
    edited: () => { rebuildSoon(); editedSoon(); },
    motionOf: beatMotion,
    voiceSoon, openPhotos, count,
    // ── Reels v4 (UI) ── scenes with media / module fields, module change, per-scene Ask AI, the learning loop.
    v4Beat, takesMedia: takesMediaOf, moduleLabel: MODULE_LABEL, setModule, reviseBeat, voBefore, feedback,
  };
  // Where each add-on module sits in the new interface. A module registers
  // (ctx.register) and is mounted at once into its place: the media tray under
  // the storyboard, "Use my own voice" in the rail's Voice row, the caption
  // files on the Export step, the looks in the rail, lane B's panels on Start.
  pageCtx.on('module', ({ name }) => {
    const m = pageCtx.modules[name];
    if (name === 'tray') m.mount($('ri-tray'));
    if (name === 'voiceInput') {
      m.mount($('ri-voice-panel'));
      // "Record or upload your voiceover" on the prompt card (scenes and captions follow your words).
      if (!$('ri-script-voice')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'ri-script-voice';
        btn.className = 'es-btn es-btn--sm es-btn--tertiary ri-script-voice';
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg><span>Record your voiceover</span>`;
        btn.addEventListener('click', () => m.open());
        $('rm-prompt-tools')?.append(btn);
      }
    }
    if (name === 'captions') m.mount($('rm-captions-host'));
    // Lane B's panels: their temporary buttons under the trend list give way to the Inspiration tile and "Brainstorm angles".
    if (name === 'ideas' || name === 'radar') { queueMicrotask(() => document.getElementById('rb-entry')?.remove()); syncStart(); if (els.ideasDialog.open) mountInspo(); }
    if (name === 'storyboard' && state.plan) renderBeats();
  });
  // Lane B: "Make our version" in the radar hands over to the ideas room.
  pageCtx.on('radar-handoff', () => { if (els.ideasDialog.open) mountInspo('ideas'); });
  // A plan from the ideas room closes "Need an idea?".
  pageCtx.on('plan', () => { if (els.ideasDialog.open) els.ideasDialog.close(); renderResume(); });
  // Room for the rail in a column of its own? (The work area's own width: the app sidebar takes a share of the window.)
  if (window.ResizeObserver) new ResizeObserver(entries => { const w = entries[0].contentRect.width; els.work.classList.toggle('is-wide', w >= 1340); els.work.classList.toggle('is-tight', w < 900 && w > 0); }).observe(els.work);
  try { if (localStorage.getItem('frameup.reels.calm.v1') === '1' || (localStorage.getItem('frameup.reels.calm.v1') == null && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)) setCalm(true); } catch { /* default: full motion */ }
  // ── Reels 2.0: C (inputs) ── the voice badge and pickers follow the person's own voiceover.
  pageCtx.on('voice-own', () => { renderVoicePickers(); renderVoice(); renderCost(); });
  pageCtx.register('styles', stylesApi); // ── Reels Studio v3 (UI) ── the four styles
  window.ReelMakerCtx = pageCtx;
  document.dispatchEvent(new CustomEvent('reelmaker:ready', { detail: { ctx: pageCtx } }));
})();
