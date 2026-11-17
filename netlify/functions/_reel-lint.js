'use strict';
// Reels Studio lint, server entry. The rules live in /reel-lint.js (UMD) so the
// browser runs the very same checks on every edit (files under /netlify are
// not served to the browser). This file adds the plan-level check the API
// runs before it returns a script: build a timeline with estimated timings
// and lint it (no font metrics on the server, so no safe-zone boxes here;
// the browser re-checks those with the real fonts).
const LINT = require('../../reel-lint.js');
const R = require('../../reel-render.js');

function lintPlan(plan, { corpus = '', target = 'organic', voiceMode = 'off' } = {}) {
  const timeline = R.buildTimeline(plan, { corpus, voiceMode, team: plan && plan.team });
  return { ...LINT.lintTimeline(timeline, { target }), durationMs: timeline.durationMs };
}

module.exports = { ...LINT, lintPlan };
