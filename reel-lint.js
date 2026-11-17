// Reels Studio quality lint (research §5.1): checks a reel timeline before
// export. Pure, for the browser (window.ReelLint) and the server
// (netlify/functions/_reel-lint.js requires this file).
//
//   lintTimeline(timeline, { boxes, target, extraSources }) ->
//     { issues: [{ id, severity, beat, message, fix }], critical, warnings, ok }
//
// severity 'critical' blocks export; 'warning' and 'info' only show.
// Critical: no on-screen claim in the first 2 s, text outside the safe zone,
// low caption contrast, a length far outside 8–90 s, numbers with no source,
// assets without rights that cover the target (organic / paid).
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(
    node ? require('./reel-formats.js') : root.ReelFormats,
    node ? require('./reel-render.js') : root.ReelRender,
    node ? require('./frameup-rules.js') : root.FrameUpRules,
  );
  if (node) module.exports = api;
  else root.ReelLint = api;
}(typeof self !== 'undefined' ? self : this, (F, R, RULES) => {
  'use strict';

  const LIMITS = {
    hookMs: 2000,
    voStartMs: 200,
    minSeconds: 8,
    maxSeconds: 90,
    shotMaxMs: 4000,
    beatMaxMs: 7500,
    captionWordsPerCard: 7,
    contrastMin: 4.5,
    textWords: F.PACE.textMaxWords,
    voWords: F.PACE.voMaxWords,
  };

  const issue = (id, severity, message, fix = '', beat = '') => ({ id, severity, message, fix, beat });

  // Every asset the reel actually uses (shots, audio, logos the renderer draws).
  function usedAssets(timeline) {
    const ids = new Set(['graphics:es', 'logo:es']);
    timeline.tracks.video.forEach(shot => {
      if (!shot.asset) return; // plain black: nothing to clear
      const a = timeline.assets[shot.asset];
      ids.add(a && a.kind === 'design' ? 'bg:generated' : shot.asset);
      if (a && a.kind === 'tile' && a.logo) ids.add(a.logo);
    });
    timeline.tracks.audio.forEach(clip => ids.add(clip.asset));
    // Pictures inside the data components (versus headshots, tile logos).
    timeline.tracks.graphics.forEach(g => {
      (g.data.versus || []).forEach(v => { if (v.asset) ids.add(v.asset); });
      (g.data.tiles || []).forEach(t => { if (t.asset) ids.add(t.asset); });
      if (g.data.cutout) ids.add(g.data.cutout);
    });
    if (timeline.team && timeline.team.logo && timeline.tracks.graphics.some(g => g.template === 'stat')) ids.add('logo:team');
    return [...ids];
  }

  function lintTimeline(timeline, { boxes = null, target = 'organic', extraSources = '' } = {}) {
    const issues = [];
    if (!timeline || !Array.isArray(timeline.beats) || !timeline.beats.length) {
      return { issues: [issue('empty', 'critical', 'The reel has no beats yet.', 'Write the reel first.')], critical: 1, warnings: 0, ok: false };
    }
    const fmt = F.FORMATS[timeline.format] || F.FORMATS.explainer;
    const seconds = timeline.durationMs / 1000;
    // Long-form styles (Data Explainer, Analytics Series) run to 120 s.
    const maxSeconds = Math.max(LIMITS.maxSeconds, (timeline.limits && timeline.limits.maxSeconds) || 0);
    const span = timeline.limits && timeline.limits.targetSeconds && timeline.limits.targetSeconds[1] > fmt.targetSeconds[1] ? timeline.limits.targetSeconds : fmt.targetSeconds;
    const longForm = span !== fmt.targetSeconds;

    // Length.
    if (seconds < LIMITS.minSeconds || seconds > maxSeconds) {
      issues.push(issue('length', 'critical', `The reel runs ${seconds.toFixed(1)} s. Keep it between ${LIMITS.minSeconds} and ${maxSeconds} s.`, seconds > maxSeconds ? 'Cut a beat or shorten the voiceover.' : 'Add a beat.'));
    } else if (seconds > Math.max(fmt.maxSeconds, longForm ? span[1] : 0)) {
      issues.push(issue('length', 'warning', `${seconds.toFixed(0)} s is long for a ${fmt.short}. Aim for ${span[0]}–${span[1]} s.`, 'Try "Shorter" in Revise.'));
    } else if (!longForm && (seconds < F.PACE.reelMinSeconds || seconds > F.PACE.reelMaxSeconds)) {
      issues.push(issue('length', 'info', `${seconds.toFixed(0)} s. Most reels that travel are ${F.PACE.reelMinSeconds}–${F.PACE.reelMaxSeconds} s.`));
    }

    // Hook in the first 2 s, VO from the first frames.
    const first = timeline.beats[0];
    const firstGraphic = timeline.tracks.graphics[0];
    if (!firstGraphic || firstGraphic.inMs > LIMITS.hookMs || !String(firstGraphic.data.text || firstGraphic.data.stat?.value || '').trim()) {
      issues.push(issue('hook', 'critical', 'No claim on screen in the first 2 seconds.', 'Give the first beat a short on-screen line.', first.id));
    } else if (first.kind !== 'hook') {
      issues.push(issue('hook', 'warning', 'The reel does not open on a hook beat.', 'Move the strongest line or number to beat 1.', first.id));
    }
    const vo1 = timeline.tracks.audio.find(a => a.kind === 'vo');
    if (vo1 && vo1.inMs > LIMITS.voStartMs) issues.push(issue('hook-vo', 'warning', `The voiceover starts at ${(vo1.inMs / 1000).toFixed(1)} s. Start it in the first 0.2 s.`, 'Give beat 1 a voiceover line.', vo1.beat));
    if (first.text && F.wordCount(first.text) > 7) issues.push(issue('hook-length', 'warning', 'The hook is long. 5–7 words land fastest.', 'Shorten the first line.', first.id));

    // Text length per beat; banned words.
    timeline.beats.forEach((beat, index) => {
      const n = F.wordCount(beat.text);
      if (n > LIMITS.textWords) issues.push(issue('text-length', 'warning', `Beat ${index + 1}: ${n} words on screen. Keep it to ${LIMITS.textWords}.`, 'Shorten the on-screen line; the voiceover carries the rest.', beat.id));
      const v = F.wordCount(beat.vo);
      if (v > LIMITS.voWords) issues.push(issue('vo-length', 'warning', `Beat ${index + 1}: ${v} voiceover words is one idea too many.`, 'Split it into two beats or trim it.', beat.id));
      const dur = beat.outMs - beat.inMs;
      if (dur > LIMITS.beatMaxMs) issues.push(issue('pacing', 'warning', `Beat ${index + 1} holds for ${(dur / 1000).toFixed(1)} s.`, 'Split it: one idea per beat.', beat.id));
      (RULES && RULES.BANNED ? RULES.BANNED : []).forEach(rule => {
        if (rule.re.test(`${beat.text} ${beat.vo}`)) issues.push(issue('style', 'warning', `Beat ${index + 1}: ${rule.why}.`, 'Rewrite the line in the ES voice.', beat.id));
      });
    });
    const last = timeline.beats[timeline.beats.length - 1];
    if (last.kind !== 'cta') issues.push(issue('ending', 'warning', 'The reel does not end on a question or end card.', 'End with a question that invites comments.', last.id));

    // Pacing: a visual change every few seconds.
    timeline.tracks.video.forEach(shot => {
      if (!shot.clip && shot.outMs - shot.inMs > LIMITS.shotMaxMs) issues.push(issue('pacing', 'warning', `A shot holds ${((shot.outMs - shot.inMs) / 1000).toFixed(1)} s with one move.`, 'Add a second photo to this beat.', shot.beat));
    });

    // Safe zones (boxes from ReelRender.textBoxes with the real font metrics).
    if (Array.isArray(boxes)) {
      const S = R.SAFE;
      const out = boxes.filter(b => b.x < S.left - 0.5 || b.x + b.w > S.right + 0.5 || b.y < S.top - 0.5 || b.y + b.h > S.bottom + 0.5);
      const seen = new Set();
      out.forEach(b => {
        const key = `${b.beat}:${b.role}`;
        if (seen.has(key)) return;
        seen.add(key);
        issues.push(issue('safe-zone', 'critical', `“${String(b.text).slice(0, 24)}” runs outside the safe zone, under the app's buttons.`, 'Shorten the line.', b.beat));
      });
    }

    // Captions: contrast and card size.
    const hl = timeline.highlight || R.ES_BLUE;
    if (timeline.captionStyle !== 'box' && R.contrast('#FFFFFF', hl) < LIMITS.contrastMin) {
      issues.push(issue('caption-contrast', 'critical', `White captions on ${hl} are ${R.contrast('#FFFFFF', hl).toFixed(1)}:1. They need ${LIMITS.contrastMin}:1.`, 'Switch the caption colour to ES Blue.'));
    }
    const words = timeline.tracks.captions.words;
    timeline.tracks.captions.cards.forEach(card => {
      if (card.words.length > LIMITS.captionWordsPerCard) issues.push(issue('captions', 'warning', 'A caption card has too many words to read at a glance.', 'Use the Highlight caption style.', card.beat));
    });
    if (!words.length) issues.push(issue('captions', 'warning', 'No captions: most people watch with the sound off.', 'Add voiceover lines to the beats.'));
    if (timeline.voice.mode === 'off') issues.push(issue('voice', 'info', 'Captions only, no voiceover. Voiceover is what makes a reel count as original on Instagram and Facebook.'));

    // Facts: every number must come from the sources (blocking). The walk
    // covers every component field (bars, versus, dot rank, chips, tiles,
    // roles…) and the plan-level eyebrow, series tag and data strip.
    const sourceSet = F.numberSet(`${timeline.corpus || ''} ${extraSources || ''}`);
    timeline.beats.forEach((beat, index) => {
      const bad = F.unsourcedNumbers(beat, sourceSet, timeline.format);
      if (bad.length) issues.push(issue('numbers', 'critical', `Beat ${index + 1}: ${bad.join(', ')} ${bad.length > 1 ? 'are' : 'is'} not in the sources.`, 'Fix the number, or add where it comes from under Sources.', beat.id));
    });
    const planBad = F.unsourcedPlanNumbers({ eyebrow: timeline.eyebrow, series: timeline.series, strip: timeline.strip }, sourceSet);
    if (planBad.length) issues.push(issue('numbers', 'critical', `The eyebrow, series tag or data strip shows ${planBad.join(', ')}, not in the sources.`, 'Fix the number in Settings, or add its source.'));

    // Visuals: every beat should show a clip or a picture (an empty slot is
    // plain black). A shot pointing at a missing asset would draw nothing.
    timeline.tracks.video.forEach(shot => {
      if (shot.asset && !timeline.assets[shot.asset]) issues.push(issue('visual', 'critical', 'A beat points at a clip or picture that is gone.', 'Pick another visual for it.', shot.beat));
    });
    timeline.beats.forEach((beat, index) => {
      if (beat.kind === 'cta') return;
      const shots = timeline.tracks.video.filter(s => s.beat === beat.id);
      if (shots.length && shots.every(s => !s.asset)) issues.push(issue('visual', 'warning', `Beat ${index + 1} has no clip or picture yet (it shows plain black).`, 'Use "Fill visuals", or pick a clip, photo or team graphic.', beat.id));
    });
    const used = usedAssets(timeline).map(id => timeline.assets[id]).filter(Boolean);
    if (used.some(a => a.kind === 'clip' && a.rights && a.rights.x)) {
      issues.push(issue('rights', 'info', target === 'paid' ? 'This ad uses clips from official X posts. Cleared by ES for Meta paid ads; the source links are kept in the rights table.' : 'Clips come from official X posts; their source links are kept in the rights table.'));
    }
    if (used.some(a => a.rights && a.rights.ai)) issues.push(issue('ai-label', 'info', 'This reel has AI-generated scenes (no real people). Turn on the platform\'s AI label when you post it.'));

    // Rights: every asset in use needs a record that covers the target.
    usedAssets(timeline).forEach(id => {
      const asset = timeline.assets[id];
      const rights = asset && asset.rights;
      if (!rights || !rights.source || !rights.licence) {
        issues.push(issue('rights', 'critical', `${asset?.label || id} has no ${rights && rights.source ? 'licence recorded' : 'rights record'}.`, 'Add where it comes from and its licence, or swap it.'));
      } else if (target === 'paid' && rights.paid !== true) {
        issues.push(issue('rights', 'critical', `${asset.label || id} is not cleared for paid ads (${rights.licence}).`, 'Export as organic, or swap it for an asset cleared for paid use.'));
      } else if (rights.organic !== true) {
        issues.push(issue('rights', 'critical', `${asset.label || id} is not cleared for social posts.`, 'Swap it.'));
      }
    });

    const critical = issues.filter(i => i.severity === 'critical').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    return { issues, critical, warnings, ok: critical === 0 };
  }

  // The rights table for the export step: one row per asset in use.
  function rightsSummary(timeline, target = 'organic') {
    return usedAssets(timeline).map(id => {
      const asset = timeline.assets[id] || {};
      const rights = asset.rights || {};
      return {
        id, label: asset.label || id, kind: asset.kind || '', source: rights.source || 'Unknown', licence: rights.licence || 'No licence recorded',
        credit: rights.credit || '', organic: rights.organic === true, paid: rights.paid === true,
        covered: Boolean(rights.source && rights.licence && rights.organic === true && (target !== 'paid' || rights.paid === true)),
      };
    });
  }

  return { LIMITS, lintTimeline, rightsSummary, usedAssets };
}));
