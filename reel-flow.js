// Reels Studio guided flow (window.ReelFlow; Node for the tests).
// Three steps, one primary action each:
//   story   "What's the story?"  -> Make my reel
//   review  big preview + beat strip; tap a beat to edit only that beat
//   export  rights, checks, cost  -> Export MP4
// "Make my reel" runs four stages in order and reports progress:
//   script -> voice -> visuals -> build
// A stage can be skipped (voice off, no AI) or fail softly (voice failed:
// the reel still builds with captions, and Retry is offered).
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

  function initial() {
    return { step: 'story', making: false, stages: STAGES.map(s => ({ ...s, state: 'todo', note: '' })), hasReel: false, error: '' };
  }

  // Pure transitions. Unknown events leave the state as it was.
  function reduce(state, event) {
    const s = { ...state, stages: state.stages.map(x => ({ ...x })) };
    const stage = id => s.stages.find(x => x.id === id);
    switch (event.type) {
      case 'make':
        if (s.making) return state;
        s.making = true; s.error = '';
        s.stages.forEach(x => { x.state = 'todo'; x.note = ''; });
        stage('script').state = 'active';
        return s;
      case 'stage-done': {
        const i = s.stages.findIndex(x => x.id === event.stage);
        if (i < 0) return state;
        s.stages[i].state = event.skipped ? 'skipped' : (event.failed ? 'failed' : 'done');
        s.stages[i].note = event.note || '';
        if (event.stage === 'script' && event.failed) { s.making = false; s.error = event.note || 'The script could not be written.'; return s; }
        if (event.stage === 'script') s.hasReel = true;
        const next = s.stages[i + 1];
        if (next) next.state = 'active';
        else { s.making = false; s.step = 'review'; }
        return s;
      }
      case 'go': {
        if (!STEPS.includes(event.step)) return state;
        if (event.step !== 'story' && !s.hasReel) return state;
        if (s.making) return state;
        s.step = event.step;
        return s;
      }
      case 'reset':
        return initial();
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

  return { STEPS, STAGES, initial, reduce, progress, statusLine };
}));
