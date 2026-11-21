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
//
// 2026-11-21, the ES video team's system (reel-es.js): every reel keeps words
// inside the ES safe frame (x 40-1040, y 300-1640) and carries the 80 px ES
// mark on the hook and the end card. ES-style reels add the kit's checklist
// (signal colours, copy lengths, numbers as spoken, end card + source, frame
// one, banned items) via ReelES.checks.
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(
    node ? require('./reel-formats.js') : root.ReelFormats,
    node ? require('./reel-render.js') : root.ReelRender,
    node ? require('./frameup-rules.js') : root.FrameUpRules,
    node ? require('./reel-es.js') : root.ReelES,
  );
  if (node) module.exports = api;
  else root.ReelLint = api;
}(typeof self !== 'undefined' ? self : this, (F, R, RULES, ES) => {
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

  function lintTimeline(timeline, { boxes = null, target = 'organic', extraSources = '', marks = null, measure = null } = {}) {
    const issues = [];
    if (!timeline || !Array.isArray(timeline.beats) || !timeline.beats.length) {
      return { issues: [issue('empty', 'critical', 'The reel has no beats yet.', 'Write the reel first.')], critical: 1, warnings: 0, ok: false };
    }
    const fmt = F.FORMATS[timeline.format] || F.FORMATS.explainer;
    const es = Boolean(ES && R.isEs && R.isEs(timeline));
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
    if (es) { /* ES: the frame-one check (ReelES.checks) covers the hook. */ } else if (!firstGraphic || firstGraphic.inMs > LIMITS.hookMs || !String(firstGraphic.data.text || firstGraphic.data.stat?.value || '').trim()) {
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
    if (!es && last.kind !== 'cta') issues.push(issue('ending', 'warning', 'The reel does not end on a question or end card.', 'End with a question that invites comments.', last.id));

    // Pacing: a visual change every few seconds.
    // (ES: one photo per scene, drifting 1 -> 1.1, is the system's own pace.)
    if (!es) timeline.tracks.video.forEach(shot => {
      if (!shot.clip && shot.outMs - shot.inMs > LIMITS.shotMaxMs) issues.push(issue('pacing', 'warning', `A shot holds ${((shot.outMs - shot.inMs) / 1000).toFixed(1)} s with one move.`, 'Add a second photo to this beat.', shot.beat));
    });

    // Safe zones (boxes from ReelRender.textBoxes with the real font metrics).
    if (Array.isArray(boxes) && !es) {
      const S = R.SAFE;
      // (The ES mark follows its own rule below: right 60, top 330.)
      const out = boxes.filter(b => b.role !== 'es-mark').filter(b => b.x < S.left - 0.5 || b.x + b.w > S.right + 0.5 || b.y < S.top - 0.5 || b.y + b.h > S.bottom + 0.5);
      const seen = new Set();
      out.forEach(b => {
        const key = `${b.beat}:${b.role}`;
        if (seen.has(key)) return;
        seen.add(key);
        issues.push(issue('safe-zone', 'critical', `“${String(b.text).slice(0, 24)}” runs outside the safe zone, under the app's buttons.`, 'Shorten the line.', b.beat));
      });
    }

    // Brand (ES video system, 2026-11-21): the official ES mark as an 80 px
    // blue square, right 60, top 330, on the hook (beat 1) and the end card,
    // nothing in its clear space (half its height). A missing or misplaced
    // mark blocks export.
    const OFFICIAL_MARK = /(^|\/)assets\/brand-logos\/essentiallysports-mark\.svg$/;
    const placed = Array.isArray(marks) ? marks : (R.logoPlacements ? R.logoPlacements(timeline) : []);
    const esAsset = timeline.assets && timeline.assets['logo:es'];
    if (!esAsset || !OFFICIAL_MARK.test(String(esAsset.src || ''))) issues.push(issue('logo', 'critical', 'The ES logo is not the official mark.', 'Use the ES mark from assets/brand-logos (the renderer draws it for you).'));
    const spec = es ? ES.markRect(timeline.size) : (R.ES_MARK || { w: 80, h: 80, x: 940, y: 330, clear: 40 });
    const markBeats = timeline.beats.map((b, i) => ({ b, i })).filter(({ b, i }) => i === 0 || b.kind === 'cta');
    markBeats.forEach(({ b: beat, i: index }) => {
      const m = placed.find(x => x.beat === beat.id);
      if (!m) { issues.push(issue('logo', 'critical', `Beat ${index + 1} has no ES logo.`, index === 0 ? 'The ES mark sits top-right on the hook.' : 'The ES mark sits top-right on the end card.', beat.id)); return; }
      if (Math.abs(m.w - spec.w) > 0.5 || Math.abs(m.h - spec.h) > 0.5) issues.push(issue('logo', 'critical', `Beat ${index + 1}: the ES logo is ${Math.round(m.w)}x${Math.round(m.h)}, not ${spec.w}x${spec.h}.`, 'Never scale the logo.', beat.id));
      if (Math.abs(m.x - spec.x) > 0.5 || Math.abs(m.y - spec.y) > 0.5) issues.push(issue('logo', 'critical', `Beat ${index + 1}: the ES logo is not top-right (right 60, top 330).`, 'Never move the mark.', beat.id));
    });
    if (Array.isArray(boxes) && placed.length) {
      const seen = new Set();
      placed.forEach(m => {
        const c = m.clear != null ? m.clear : spec.clear;
        const zone = { x: m.x - c, y: m.y - c, w: m.w + 2 * c, h: m.h + 2 * c };
        boxes.filter(b => b.beat === m.beat && b.role !== 'es-mark' && b.x < zone.x + zone.w - 0.5 && b.x + b.w > zone.x + 0.5 && b.y < zone.y + zone.h - 0.5 && b.y + b.h > zone.y + 0.5).forEach(b => {
          const key = `${b.beat}:${b.role}`;
          if (seen.has(key)) return;
          seen.add(key);
          issues.push(issue('logo', 'critical', `“${String(b.text || b.role).slice(0, 24)}” sits in the ES logo's clear space.`, `Keep ${c} px clear round the logo: shorten the line.`, b.beat));
        });
      });
    }
    // The ES safe frame for every style: no words above y 300, within 40 px
    // of the sides, or below y 1640 (the ES checks below cover ES reels).
    if (Array.isArray(boxes) && ES && !es && timeline.v !== 2) {
      const seen = new Set();
      boxes.filter(b => b.text && ES.outsideSafe(b, timeline.size)).forEach(b => {
        const key = `${b.beat}:${b.role}`;
        if (seen.has(key)) return;
        seen.add(key);
        issues.push(issue('safe-frame', 'critical', `“${String(b.text).slice(0, 24)}” is outside the ES safe frame (no words above y 300 or below y 1640).`, 'Shorten the line.', b.beat));
      });
    }
    // The ES system's checklist (ES-style reels).
    if (es) issues.push(...ES.checks(timeline, { boxes, measure: typeof measure === 'function' ? measure : null, layout: R.layoutGraphic }));

    // Captions: contrast and card size.
    const hl = timeline.highlight || R.ES_BLUE;
    if (!['box', 'es'].includes(timeline.captionStyle) && R.contrast('#FFFFFF', hl) < LIMITS.contrastMin) {
      issues.push(issue('caption-contrast', 'critical', `White captions on ${hl} are ${R.contrast('#FFFFFF', hl).toFixed(1)}:1. They need ${LIMITS.contrastMin}:1.`, 'Switch the caption colour to ES Blue.'));
    }
    const words = timeline.tracks.captions.words;
    timeline.tracks.captions.cards.forEach(card => {
      if (card.words.length > LIMITS.captionWordsPerCard) issues.push(issue('captions', 'warning', 'A caption card has too many words to read at a glance.', 'Use the Highlight caption style.', card.beat));
    });
    if (!words.length) issues.push(issue('captions', 'warning', 'No captions: most people watch with the sound off.', 'Add voiceover lines to the beats.'));
    if (timeline.voice.mode === 'off') issues.push(issue('voice', 'info', 'Captions only, no voiceover. Voiceover is what makes a reel count as original on Instagram and Facebook.'));
    if (es && timeline.timing && timeline.timing.estimate) issues.push(issue('timing', 'info', timeline.timing.voLengthMs ? `Scene times are spread over your ${(timeline.timing.voLengthMs / 1000).toFixed(0)} s voiceover by word count: estimates until the voice is recorded.` : 'Scene times are estimates (2.6 words a second) until the voiceover is recorded.', 'Record or load the voiceover to lock the cuts to it.'));

    // Facts: every number must come from the sources (blocking). The walk
    // covers every component field (bars, versus, dot rank, chips, tiles,
    // roles…) and the plan-level eyebrow, series tag and data strip.
    const v2 = timeline.v === 2 && R.provenanceNumbers;
    const sourceSet = F.numberSet(`${timeline.corpus || ''} ${extraSources || ''}`);
    // v2: a beat with no refs (hook, payoff) may use any fact of the data block;
    // a beat with refs only its own refs (so 2001 cannot borrow 2022's yards).
    const wholeData = v2 ? new Set([...sourceSet, ...F.numberSet(dataFacts(timeline))]) : sourceSet;
    timeline.beats.forEach((beat, index) => {
      // v2 (data formats): a beat's own refs back the numbers it shows.
      const set = v2 && Array.isArray(beat.refs) && beat.refs.length ? new Set([...sourceSet, ...R.provenanceNumbers(timeline, beat.refs)]) : wholeData;
      const bad = F.unsourcedNumbers(beat, set, timeline.format);
      if (bad.length) issues.push(issue('numbers', 'critical', `Beat ${index + 1}: ${bad.join(', ')} ${bad.length > 1 ? 'are' : 'is'} not in the sources.`, 'Fix the number, or add where it comes from under Sources.', beat.id));
    });
    const planBad = F.unsourcedPlanNumbers({ eyebrow: timeline.eyebrow, series: timeline.series, strip: timeline.strip }, wholeData);
    if (planBad.length) issues.push(issue('numbers', 'critical', `The eyebrow, series tag or data strip shows ${planBad.join(', ')}, not in the sources.`, 'Fix the number in Settings, or add its source.'));

    // Visuals: every beat should show a clip or a picture (an empty slot is
    // plain black). A shot pointing at a missing asset would draw nothing.
    timeline.tracks.video.forEach(shot => {
      if (shot.asset && !timeline.assets[shot.asset]) issues.push(issue('visual', 'critical', 'A beat points at a clip or picture that is gone.', 'Pick another visual for it.', shot.beat));
    });
    if (!es) timeline.beats.forEach((beat, index) => {
      if (beat.kind === 'cta' || SELF_VISUAL.has(beat.kind)) return;
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
        issues.push(issue('rights', 'critical', `${asset.label || id} is not cleared for paid ads (${String(rights.licence).replace(/\.\s*$/, '')}).`, 'Export as organic, or swap it for an asset cleared for paid use.'));
      } else if (rights.organic !== true) {
        issues.push(issue('rights', 'critical', `${asset.label || id} is not cleared for social posts.`, 'Swap it.'));
      }
    });

    if (timeline.v === 2) issues.push(...dataIssues(timeline, { target, boxes }));

    const critical = issues.filter(i => i.severity === 'critical').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    return { issues, critical, warnings, ok: critical === 0 };
  }

  // ─── Data formats (v2 timelines and carousel slides) ────────────────────
  // The data block as facts, so a v2 reel lints on its own: the digest's
  // facts (ReelTimeline.digestFacts), the athlete's season years and career
  // totals, and the cited archive moments (the server drops uncited ones).
  function dataFacts(timeline) {
    const T = typeof self !== 'undefined' && self.ReelTimeline ? self.ReelTimeline : (typeof require === 'function' ? require('./reel-timeline.js') : null);
    const d = timeline.data || {};
    const out = [];
    if (T && d.game) out.push(T.digestFacts(d.game));
    const st = d.athlete && d.athlete.stats;
    if (st && Array.isArray(st.seasons)) out.push(st.seasons.map(r => r.year).join(' '));
    if (st && Array.isArray(st.totals)) out.push(st.totals.join(' '));
    const arch = d.archive;
    if (arch && Array.isArray(arch.moments)) arch.moments.filter(m => Array.isArray(m.cite) && m.cite.length).forEach(m => out.push(`${m.year} ${m.title || ''} ${m.line || ''}`));
    return out.join('\n');
  }
  // Data beats that draw their own pictures (chart, year rail, frame strip).
  const SELF_VISUAL = new Set(['wpline', 'moment', 'panel3']);
  const BAD_HOST = /(?:^|\/\/|\.)(?:[a-z0-9-]+\.)*(?:espncdn\.com|mlb\.com|mlbstatic\.com)(?:[/:?#]|$)/i;
  const YEAR_RE = /\b(18[5-9]\d|19\d\d|20\d\d)\b/g;
  // Rules (contract §4):
  //   data-numbers       every number a data element draws resolves to a data ref (critical)
  //   data-attribution   WP on screen carries "Win probability: ESPN Analytics" (critical)
  //   archive-cite       a moment cites a src: or stat: ref that resolves (critical)
  //   archive-date       a year on a moment is a year of its cited source (critical)
  //   asset-host         no espncdn / mlb.com images (critical)
  //   replay-real-frames the strip's frames are times inside the project's own clip (critical)
  //   scorebug-clear     the scorebug keeps out of the ES mark's clear space (critical)
  //   paid-league-footage a paid export of a clip from X or the library warns
  function dataIssues(timeline, { target = 'organic', boxes = null } = {}) {
    const out = [];
    const T = typeof self !== 'undefined' && self.ReelTimeline ? self.ReelTimeline : (typeof require === 'function' ? require('./reel-timeline.js') : null);
    const beatsById = new Map((timeline.beats || []).map((b, i) => [b.id, { b, i }]));
    const label = id => { const x = beatsById.get(id); return x ? `Beat ${x.i + 1}` : (timeline.slide ? `Slide ${(timeline.slide.index || 0) + 1}` : 'A beat'); };
    // Numbers drawn by data elements.
    if (R.unbackedNumbers) {
      const seen = new Set();
      R.unbackedNumbers(null, timeline).forEach(u => {
        const key = `${u.beat}:${u.role}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(issue('data-numbers', 'critical', `${label(u.beat)}: “${String(u.text).slice(0, 32)}” shows ${u.numbers.join(', ')} with no data behind it.`, 'Numbers on data elements come from the game, the stats or the sources; re-link the beat to its data.', u.beat));
      });
    }
    // WP attribution.
    const game = timeline.data && timeline.data.game;
    const want = String((game && game.attribution) || (F.FORMATS.gameswing && F.FORMATS.gameswing.attribution) || '').trim();
    const official = T && game && T.ATTRIBUTION ? T.ATTRIBUTION[game.provider] : '';
    if (R.wpOnScreen) {
      R.wpOnScreen(null, timeline).forEach(w => {
        const kind = (beatsById.get(w.beat) || {}).b;
        if (!w.wp && kind && kind.kind === 'wpline') { out.push(issue('data-attribution', 'critical', `${label(w.beat)}: the win-probability chart is hidden because the game has no attribution line.`, 'Reload the game data: win probability always carries its credit.', w.beat)); return; }
        if (!w.wp) return;
        if (!want || !w.attribution.includes(want)) out.push(issue('data-attribution', 'critical', `${label(w.beat)} shows win probability without “${want || 'its attribution'}”.`, 'Win probability is always credited on screen.', w.beat));
        else if (official && want !== official) out.push(issue('data-attribution', 'critical', `${label(w.beat)}: the attribution reads “${want}”, not “${official}”.`, 'Use the provider\'s attribution line exactly.', w.beat));
      });
    }
    // Archive: cites and dates.
    const archiveBeats = (timeline.beats || []).filter(b => b.kind === 'moment' || b.kind === 'slide-moment');
    archiveBeats.forEach(b => {
      const refs = Array.isArray(b.refs) ? b.refs : [];
      const cites = refs.filter(r => /^(src|stat):/.test(r));
      const ok = T ? cites.filter(r => T.resolveRef(timeline, r)) : [];
      if (!ok.length) { out.push(issue('archive-cite', 'critical', `${label(b.id)}: this moment cites no ES article or stat row.`, 'Every archive moment needs a source: pick one in Sources.', b.id)); return; }
      const years = new Set();
      ok.forEach(r => {
        const v = T.resolveRef(timeline, r);
        if (r.startsWith('stat:') && Number.isInteger(v.year)) years.add(String(v.year));
        if (r.startsWith('src:') && /^\d{4}/.test(String(v.date || ''))) years.add(String(v.date).slice(0, 4));
        if (r.startsWith('src:')) (String(v.title || '').match(YEAR_RE) || []).forEach(y => years.add(y));
      });
      const arch = timeline.data && timeline.data.archive;
      (arch && Array.isArray(arch.moments) ? arch.moments : []).filter(m => Array.isArray(m.cite) && m.cite.some(c => ok.includes(c))).forEach(m => {
        if (Number.isInteger(m.year) && !years.has(String(m.year))) out.push(issue('archive-date', 'critical', `${label(b.id)}: the moment says ${m.year}, but its source is from ${[...years].join(', ') || 'another year'}.`, 'Use the year of the cited source, or cite the right one.', b.id));
      });
      const shown = String(b.text || '').match(YEAR_RE) || [];
      const bad = shown.filter(y => !years.has(y));
      if (bad.length) out.push(issue('archive-date', 'critical', `${label(b.id)}: ${bad.join(', ')} is not a year of the cited source.`, 'Use the year of the cited source, or cite the right one.', b.id));
    });
    // Image hosts: ESPN and MLB images are never drawn (logos come from FrameUp's library).
    const urls = [];
    Object.entries(timeline.assets || {}).forEach(([id, a]) => { if (a && a.src) urls.push([id, a.src]); if (a && a.url) urls.push([id, a.url]); });
    const arch = timeline.data && timeline.data.archive;
    (arch && Array.isArray(arch.photos) ? arch.photos : []).forEach(p => urls.push([`photo:${p.id}`, p.url]));
    urls.filter(([, u]) => BAD_HOST.test(String(u || ''))).forEach(([id]) => out.push(issue('asset-host', 'critical', `${id} is an ESPN or MLB image. FrameUp never draws those.`, 'Use an ES photo, or a logo from FrameUp\'s library.')));
    // Replay: real frames of the project's own clip.
    const rp = timeline.replay;
    const strips = (timeline.beats || []).filter(b => b.kind === 'panel3' || ((b.refs || []).some(r => r.startsWith('frame:'))));
    if (strips.length) {
      const clipId = rp && rp.clipAsset;
      const clip = clipId && timeline.assets ? timeline.assets[clipId] : null;
      if (!rp || (!clip && !rp.clipUrl)) out.push(issue('replay-real-frames', 'critical', 'The frame strip has no clip behind it.', 'Pick the clip again: the three frames are taken from it.', strips[0].id));
      else {
        const seg = rp.segment || null;
        const dur = clip && Number(clip.durationMs) > 0 ? clip.durationMs / 1000 : null;
        (rp.frames || []).forEach(f => {
          const outside = (seg && (f.t < seg.in - 0.05 || f.t > seg.out + 0.05)) || (dur != null && f.t > dur + 0.05);
          if (outside) out.push(issue('replay-real-frames', 'critical', `The ${f.role} frame (${f.t} s) is outside the clip's chosen moment.`, 'Scrub the panel back inside the segment.', strips[0].id));
        });
        const frames = rp.frames || [];
        if (frames.length === 3 && !(frames[0].t <= frames[1].t && frames[1].t <= frames[2].t)) out.push(issue('replay-real-frames', 'warning', 'The setup, play and reaction frames are out of order.', 'Scrub the panels so they run in time order.', strips[0].id));
      }
    }
    // Paid export with league footage (owner, 2026-11-18: warn, do not block).
    const fmt = F.FORMATS[timeline.format] || {};
    if (target === 'paid' && fmt.rights && fmt.rights.paidWithLeagueFootage === 'warn') {
      const league = (rp && ['x', 'library'].includes(rp.origin)) || Object.values(timeline.assets || {}).some(a => a && a.kind === 'clip' && a.rights && (a.rights.x || a.rights.league));
      if (league) out.push(issue('paid-league-footage', 'warning', 'This paid export uses league footage (an X post or a library clip).', 'Check the clip is cleared for paid use, or export it as an organic post.'));
    }
    // The scorebug keeps out of the ES mark and its clear space.
    const marks = R.logoPlacements ? R.logoPlacements(timeline) : [];
    const m = marks[0];
    if (m) {
      const zone = { x: m.x - m.clear, y: m.y - m.clear, w: m.w + 2 * m.clear, h: m.h + 2 * m.clear };
      const list = Array.isArray(boxes) ? boxes : (R.allBoxes ? R.allBoxes((t, f) => String(t).length * Number((String(f).match(/([\d.]+)px/) || [0, 40])[1]) * 0.55, timeline) : []);
      const seen = new Set();
      list.filter(b => ['scorebug', 'team-chip', 'clock', 'score', 'down', 'status'].includes(b.role) && b.x < zone.x + zone.w - 0.5 && b.x + b.w > zone.x + 0.5 && b.y < zone.y + zone.h - 0.5 && b.y + b.h > zone.y + 0.5).forEach(b => {
        if (seen.has(b.beat)) return;
        seen.add(b.beat);
        out.push(issue('scorebug-clear', 'critical', `${label(b.beat)}: the scorebug runs into the ES logo's clear space.`, 'The scorebug ends 50 px left of the logo.', b.beat));
      });
    }
    return out;
  }
  // A carousel (ReelReplay.buildSlides output): the data rules per slide,
  // text inside the 4:5 safe area, and the ES mark on every slide.
  function lintSlides(slides, { target = 'organic', measure = null } = {}) {
    const issues = [];
    const list = Array.isArray(slides) ? slides : [];
    if (!list.length) issues.push(issue('slides', 'critical', 'The carousel has no slides yet.', 'Build the carousel first.'));
    if (list.length > 20) issues.push(issue('slides', 'critical', `${list.length} slides: Instagram allows 20.`, 'Remove a slide.'));
    const m = measure || ((t, f) => String(t).length * Number((String(f).match(/([\d.]+)px/) || [0, 40])[1]) * 0.55);
    list.forEach((s, i) => {
      dataIssues(s, { target }).forEach(x => issues.push({ ...x, beat: s.slide ? s.slide.id : x.beat, message: x.message.replace(/^(Beat|A beat) ?\d*/, `Slide ${i + 1}`) }));
      const safe = R.SLIDE_SAFE || { left: 60, right: 1020, top: 60, bottom: 1290 };
      const seen = new Set();
      R.allBoxes(m, s).filter(b => b.role !== 'es-mark' && b.role !== 'bg' && b.text != null && (b.x < safe.left - 0.5 || b.x + b.w > safe.right + 0.5 || b.y < safe.top - 0.5 || b.y + b.h > safe.bottom + 0.5)).forEach(b => {
        if (seen.has(b.role)) return;
        seen.add(b.role);
        issues.push(issue('safe-zone', 'critical', `Slide ${i + 1}: “${String(b.text).slice(0, 24)}” runs outside the 4:5 safe area.`, 'Shorten the line.', s.slide ? s.slide.id : ''));
      });
      const marks = R.logoPlacements(s);
      if (!marks.length || marks.some(k => !k.slide)) issues.push(issue('logo', 'critical', `Slide ${i + 1} has no ES logo.`, 'The ES mark must be on every slide.', s.slide ? s.slide.id : ''));
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

  return { LIMITS, lintTimeline, lintSlides, dataIssues, rightsSummary, usedAssets };
}));
