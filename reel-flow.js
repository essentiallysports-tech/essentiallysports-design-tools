// Reels Studio guided flow (window.ReelFlow; Node for the tests).
// Three steps, one primary action each:
//   story   "What's the story?"  -> Make my reel
//   review  big preview + beat strip; tap a beat to edit only that beat
//   export  rights, checks, cost  -> Export MP4
// "Make my reel" runs four stages in order and reports progress:
//   script -> voice -> visuals -> build
// A stage can be skipped (voice off, no AI) or fail softly (voice failed:
// the reel still builds with captions, and Retry is offered).
//
// Data formats (Game Swing, Moment Replay, Archive; reel-formats.js
// DATA_FORMATS) use the unified flow (project-docs/reels-formats-contract.md §5):
//   format (gallery) -> source -> story -> make -> review -> export
// with a source step per kind (game / clip / player) and two extra Make
// stages: data (fetch the game digest or the player's stats and ES coverage,
// free) and frames (Replay: sample the clip and pick setup / play / reaction).
// initial() with no format, STEPS and STAGES are exactly the news-format flow,
// so today's page is unchanged; the gallery sits beside the trend-first path.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelFlow = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const STEPS = ['story', 'review', 'export'];
  const STAGES = [
    { id: 'script', label: 'Writing the script' },
    { id: 'voice', label: 'Recording the voice' },
    { id: 'visuals', label: 'Finding clips' },
    { id: 'build', label: 'Building your reel' },
  ];

  // ─── Data formats ────────────────────────────────────────────────────────
  const ALL_STEPS = ['format', 'source', 'story', 'review', 'export'];
  const ALL_STAGES = [
    { id: 'data', label: 'Getting the game data' },
    { id: 'frames', label: 'Picking the frames' },
    ...STAGES,
  ];
  // The source step for each data format (the server mode that feeds it is in
  // the contract; C builds the pickers, A the modes).
  //   game    game picker (sport tabs NFL / CFB / MLB; Live now, Final last 48 h, Search)
  //           -> { kind:'game', sport, eventId, label }
  //   clip    paste an X link, pick from the clip library, or upload an ES clip
  //           -> { kind:'clip', origin:'x'|'library'|'upload', url | assetId, segment?:{in,out}, gameRef? }
  //   player  player search (league-filtered) + an angle
  //           -> { kind:'player', sport, athleteId, name, angle }
  const SOURCE_KINDS = {
    game: { id: 'game', label: 'Pick a game', modes: ['games', 'game-data'], required: ['sport', 'eventId'] },
    clip: { id: 'clip', label: 'Pick a clip', modes: ['frame-pick'], required: ['origin'], origins: ['x', 'library', 'upload'] },
    player: { id: 'player', label: 'Pick a player', modes: ['athlete', 'archive-research'], required: ['sport', 'athleteId'], angles: ['5 best moments', 'Career in 60 s', 'Playoff runs'] },
  };
  // Per data format: the source kind, the steps and the Make stages.
  // Labels of the data stage follow the source (game data vs. career research).
  const FORMAT_FLOWS = {
    gameswing: { source: 'game', stages: ['data', 'script', 'voice', 'visuals', 'build'], labels: { data: 'Getting the game data', visuals: 'Matching clips to plays' } },
    replay: { source: 'clip', stages: ['frames', 'script', 'build'], labels: { frames: 'Picking the frames', script: 'Writing the captions' } },
    archive: { source: 'player', stages: ['data', 'script', 'voice', 'visuals', 'build'], labels: { data: 'Researching the career', visuals: 'Finding ES photos' } },
  };
  // Stages that end the run when they fail (no script, or no data to build from).
  const CRITICAL = ['script', 'data'];
  const flowFor = format => FORMAT_FLOWS[format] || null;
  const stepsFor = format => (flowFor(format) ? ALL_STEPS.slice() : STEPS.slice());
  function stagesFor(format) {
    const flow = flowFor(format);
    if (!flow) return STAGES.map(s => ({ ...s }));
    return flow.stages.map(id => ({ ...ALL_STAGES.find(s => s.id === id), ...(flow.labels[id] ? { label: flow.labels[id] } : {}) }));
  }
  const sourceKindFor = format => (flowFor(format) ? flowFor(format).source : 'trend');
  // A picked source is complete when its required fields are there.
  function sourceReady(format, source) {
    const flow = flowFor(format);
    if (!flow) return true;
    const kind = SOURCE_KINDS[flow.source];
    if (!source || source.kind !== kind.id) return false;
    if (kind.id === 'clip' && !kind.origins.includes(source.origin)) return false;
    if (kind.id === 'clip' && !(source.url || source.assetId)) return false;
    return kind.required.every(k => source[k] != null && source[k] !== '');
  }

  // initial()          the news flow, exactly as before (step 'story').
  // initial(format)    a data format: starts on its source step, with its stages.
  function initial(format) {
    if (!flowFor(format)) return { step: 'story', making: false, stages: STAGES.map(s => ({ ...s, state: 'todo', note: '' })), hasReel: false, error: '' };
    return { step: 'source', making: false, stages: stagesFor(format).map(s => ({ ...s, state: 'todo', note: '' })), hasReel: false, error: '', format, steps: stepsFor(format), source: null };
  }

  // Pure transitions. Unknown events leave the state as it was.
  function reduce(state, event) {
    const s = { ...state, stages: state.stages.map(x => ({ ...x })) };
    const stage = id => s.stages.find(x => x.id === id);
    switch (event.type) {
      case 'make':
        if (s.making) return state;
        if (s.format && !sourceReady(s.format, s.source)) return state;
        s.making = true; s.error = '';
        s.stages.forEach(x => { x.state = 'todo'; x.note = ''; });
        (stage('script') && !s.format ? stage('script') : s.stages[0]).state = 'active';
        return s;
      // Gallery: pick a format (a data format starts its own flow; a news
      // format goes back to the story step as today).
      case 'pick-format':
        if (s.making) return state;
        return initial(event.format);
      case 'set-source':
        if (s.making || !s.format) return state;
        s.source = event.source && typeof event.source === 'object' ? { ...event.source } : null;
        if (sourceReady(s.format, s.source) && s.step === 'source') s.step = 'story';
        return s;
      case 'stage-done': {
        const i = s.stages.findIndex(x => x.id === event.stage);
        if (i < 0) return state;
        s.stages[i].state = event.skipped ? 'skipped' : (event.failed ? 'failed' : 'done');
        s.stages[i].note = event.note || '';
        if (event.stage === 'script' && event.failed) { s.making = false; s.error = event.note || 'The script could not be written.'; return s; }
        if (CRITICAL.includes(event.stage) && event.failed) { s.making = false; s.error = event.note || 'The data could not be loaded.'; return s; }
        if (event.stage === 'script') s.hasReel = true;
        const next = s.stages[i + 1];
        if (next) next.state = 'active';
        else { s.making = false; s.step = 'review'; }
        return s;
      }
      case 'go': {
        const steps = s.steps || STEPS;
        if (!steps.includes(event.step)) return state;
        if (s.making) return state;
        if (event.step === 'format' || event.step === 'source') { s.step = event.step; return s; }
        if (event.step === 'story' && s.format && !sourceReady(s.format, s.source)) return state;
        if (event.step !== 'story' && !s.hasReel) return state;
        s.step = event.step;
        return s;
      }
      case 'reset':
        return initial(s.format);
      default:
        return state;
    }
  }
  const progress = state => {
    const n = state.stages.filter(x => ['done', 'skipped', 'failed'].includes(x.state)).length;
    return n / state.stages.length;
  };
  // "Ready · 52 s · $0.48 · 2 checks" (the compact status line).
  function statusLine({ critical = 0, warnings = 0, seconds = 0, usd = 0, money = v => `$${v.toFixed(2)}` } = {}) {
    const head = critical ? `${critical} to fix` : 'Ready';
    const checks = critical ? '' : (warnings ? ` · ${warnings} check${warnings > 1 ? 's' : ''}` : ' · all checks pass');
    return `${head} · ${Math.round(seconds)} s · ${money(usd)}${checks}`;
  }

  return { STEPS, STAGES, ALL_STEPS, ALL_STAGES, SOURCE_KINDS, FORMAT_FLOWS, CRITICAL, initial, reduce, progress, statusLine, stepsFor, stagesFor, sourceKindFor, sourceReady };
}));
