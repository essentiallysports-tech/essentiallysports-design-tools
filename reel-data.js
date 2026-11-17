// Reels Studio data formats: game digest, archive and replay -> reel plans.
// Pure (no DOM, no network). One file for the browser (window.ReelData),
// the server (_reel-director.js, _reel-games.js) and the tests, like
// reel-formats.js. Contract: project-docs/reels-formats-contract.md §3, §6.
//
//   dramaScore(digest)            0..1: the biggest win-probability swing, lead
//                                 changes, late scoring and a comeback (null
//                                 when the digest has no plays and no WP)
//   wpSpark(digest, n=24)         <= n home-WP values for the game picker
//   keyPlays(digest, n=5)         the plays a Game Swing shows (scoring plays,
//                                 the biggest swings, lead changes), game order
//   scorebugAt(timeline, tMs)     the scorebug state at a time: score, period,
//                                 clock, down, possession and WP, read only
//                                 from timeline.data.game (never the model)
//   matchClipToPlay(clip, plays, opts)
//                                 X / library clip -> the play it shows, by the
//                                 post time minus the play's wallclock (1-15
//                                 min) and the posting team's handle. Returns
//                                 { playId, confidence, sure, ... } or null;
//                                 callers show a photo unless sure is true.
//   planFromGame(digest, opts)    Game Swing plan: hook, key plays, the WP
//                                 line, the final, a question. Every beat
//                                 carries refs; every number is in factsText.
//   planFromArchive(archive, athlete, opts)
//                                 Archive plan: hook, cited moments (refs to
//                                 src:/stat:/photo:), career total, question;
//                                 plus carousel slides.
//   planFromReplay(replay, opts)  Moment Replay plan: hook, the 3-frame strip,
//                                 question; plus carousel slides.
//   factsText(digest)             = ReelTimeline.digestFacts (lint extraSources)
//   archiveFacts(archive, athlete)  the same for an archive (titles, dates,
//                                 stat rows), so the lint backs every number.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelData = api;
}(typeof self !== 'undefined' ? self : this, root => {
  'use strict';

  const T = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? require('./reel-timeline.js')
    : (root && root.ReelTimeline) || null;

  const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const arr = v => (Array.isArray(v) ? v : []);
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const round = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n;
  const words = text => String(text || '').trim().split(/\s+/).filter(Boolean);
  const trimWords = (text, max) => words(text).slice(0, max).join(' ').replace(/[,;:]$/, '');
  const pct = v => Math.round(v * 100);
  const short = team => {
    const name = String(team && team.name || '').trim();
    return name ? name.split(/\s+/).pop() : String(team && team.abbr || '');
  };
  const PERIODS = { nfl: 4, cfb: 4, mlb: 9 };
  const ATTRIBUTION = (T && T.ATTRIBUTION) || { espn: 'Win probability: ESPN Analytics' };

  // ─── Drama ──────────────────────────────────────────────────────────────
  // Not a model: four plain signals from the digest, each 0..1.
  //   swing     the biggest |swing| of one play (0.5 = a coin flip moved fully)
  //   leads     lead changes (4 or more = full)
  //   late      a score in the last regulation period (or extra time) while
  //             the game was within one score
  //   comeback  the winner's lowest win probability (from 50% down to 0%)
  function dramaParts(d) {
    if (!isObj(d) || !isObj(d.teams)) return null;
    const plays = arr(d.plays);
    const points = d.wp && arr(d.wp.points);
    if (!plays.length && !(points && points.length)) return null;
    const swing = plays.reduce((m, p) => Math.max(m, Math.abs(Number(p.swing) || 0)), 0);
    const leads = plays.filter(p => arr(p.tags).includes('lead-change')).length;
    const last = PERIODS[d.sport] || 4;
    const close = d.sport === 'mlb' ? 2 : 8;
    const late = plays.some(p => p.scoring && p.period >= last && Math.abs(p.score.home - p.score.away) <= close) ? 1 : 0;
    let comeback = 0;
    if (points && points.length && d.status && d.status.final) {
      const h = d.teams.home.score;
      const a = d.teams.away.score;
      if (h !== a) {
        const homeWon = h > a;
        const low = points.reduce((m, p) => Math.min(m, homeWon ? p[1] : 1 - p[1]), 1);
        comeback = clamp01((0.5 - low) / 0.5);
      }
    }
    return { swing: clamp01(swing / 0.5), leads: clamp01(leads / 4), late, comeback };
  }
  function dramaScore(d) {
    const p = dramaParts(d);
    if (!p) return null;
    return round(clamp01(0.45 * p.swing + 0.2 * p.leads + 0.15 * p.late + 0.2 * p.comeback), 3);
  }
  function wpSpark(d, n = 24) {
    const points = d && d.wp && arr(d.wp.points);
    if (!points || points.length < 2) return null;
    if (points.length <= n) return points.map(p => round(p[1], 3));
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(round(points[Math.round((i * (points.length - 1)) / (n - 1))][1], 3));
    return out;
  }

  // ─── Key plays ──────────────────────────────────────────────────────────
  function playWeight(p, d) {
    const tags = arr(p.tags);
    const last = PERIODS[d && d.sport] || 4;
    return Math.abs(Number(p.swing) || 0) * 2
      + (p.scoring ? 0.35 : 0)
      + (tags.includes('lead-change') ? 0.3 : 0)
      + (tags.includes('final') ? 0.25 : 0)
      + (p.scoring && p.period >= last ? 0.15 : 0);
  }
  function keyPlays(d, n = 5) {
    const plays = arr(d && d.plays).filter(p => p && (p.scoring || arr(p.tags).some(t => t !== 'period-end')));
    return plays
      .map(p => ({ p, w: playWeight(p, d) }))
      .sort((a, b) => b.w - a.w || a.p.seq - b.p.seq)
      .slice(0, Math.max(0, n))
      .map(x => x.p)
      .sort((a, b) => a.seq - b.seq);
  }

  // The plays a Game Swing reel covers: the editor's ticked ids (only ids in
  // the digest; at most MAX_KEY_PLAYS, the strongest kept), else keyPlays.
  const MAX_KEY_PLAYS = 5;
  function pickPlays(d, opts = {}) {
    const ids = arr(opts.playIds).map(String);
    if (ids.length) {
      const want = new Set(ids);
      const got = arr(d && d.plays).filter(p => p && want.has(String(p.id)));
      if (got.length) {
        return got
          .map(p => ({ p, w: playWeight(p, d) }))
          .sort((a, b) => b.w - a.w || a.p.seq - b.p.seq)
          .slice(0, MAX_KEY_PLAYS)
          .map(x => x.p)
          .sort((a, b) => a.seq - b.seq);
      }
    }
    return keyPlays(d, Math.max(1, Math.min(MAX_KEY_PLAYS, Number(opts.maxPlays) || 4)));
  }

  // ─── Scorebug ───────────────────────────────────────────────────────────
  function periodLabel(sport, period, half) {
    if (!Number.isInteger(period)) return '';
    if (sport === 'mlb') return `${half === 'bottom' ? 'Bot' : 'Top'} ${period}`;
    return period > 4 ? (period === 5 ? 'OT' : `${period - 4}OT`) : `Q${period}`;
  }
  function scorebugForPlay(d, play) {
    const h = d.teams.home;
    const a = d.teams.away;
    if (!play) {
      return {
        home: { abbr: h.abbr, score: h.score }, away: { abbr: a.abbr, score: a.score },
        period: d.status.period, half: null, clock: d.status.clock || '', label: d.status.final ? 'FINAL' : periodLabel(d.sport, d.status.period, null),
        down: null, possession: null, wpHome: null, final: Boolean(d.status.final), playId: null,
      };
    }
    return {
      home: { abbr: h.abbr, score: play.score.home }, away: { abbr: a.abbr, score: play.score.away },
      period: play.period, half: play.half || null, clock: play.clock || '', label: periodLabel(d.sport, play.period, play.half),
      down: play.down || null, possession: play.team || null, wpHome: play.wpHome == null ? null : play.wpHome, final: false, playId: play.id,
    };
  }
  // The play a beat shows (a wpline's play refs are only marks on the line).
  function playOf(d, beat) {
    if (!beat || beat.kind === 'wpline') return null;
    const ref = beat.playRef || arr(beat.refs).find(r => String(r).startsWith('play:'));
    if (!ref) return null;
    const id = String(ref).slice(5);
    return arr(d.plays).find(p => String(p.id) === id) || null;
  }
  function scorebugAt(tl, tMs) {
    const d = tl && tl.data && tl.data.game;
    if (!isObj(d) || !isObj(d.teams)) return null;
    const beats = arr(tl.beats).filter(isObj);
    const at = Number(tMs) || 0;
    let idx = beats.findIndex(b => at >= (b.inMs || 0) && at < (b.outMs || 0));
    if (idx < 0) idx = at <= 0 ? 0 : beats.length - 1;
    const withPlay = beats.map(b => playOf(d, b));
    const firstAt = withPlay.findIndex(Boolean);
    let lastAt = -1;
    withPlay.forEach((p, i) => { if (p) lastAt = i; });
    if (firstAt < 0) return scorebugForPlay(d, null);
    // Before the first play beat: that play's state. After the last one: the
    // game's own status (final or live). In between: the latest play shown.
    if (idx < firstAt) return scorebugForPlay(d, withPlay[firstAt]);
    if (idx > lastAt) return d.status.final ? scorebugForPlay(d, null) : scorebugForPlay(d, withPlay[lastAt]);
    for (let i = idx; i >= 0; i -= 1) if (withPlay[i]) return scorebugForPlay(d, withPlay[i]);
    return scorebugForPlay(d, withPlay[firstAt]);
  }

  // ─── Clip -> play ───────────────────────────────────────────────────────
  // A clip posted on X shows a play from a few minutes earlier. The match is
  // by time first (posted 1-15 min after the snap), then by who posted it
  // (the play team's own account is best; the other team's account is
  // refused), then by a surname from the play text in the post. Unsure =
  // no match: the beat keeps its photo.
  const MIN_LAG = 60;
  const MAX_LAG = 15 * 60;
  const NAME_STOP = new Set(['pass', 'yard', 'yards', 'field', 'goal', 'kick', 'touchdown', 'short', 'deep', 'left', 'right', 'middle', 'from', 'run', 'rush', 'punt', 'safety', 'extra', 'point', 'good', 'penalty', 'shotgun', 'center', 'holder', 'intercepted', 'fumble', 'sacked', 'scored', 'singled', 'doubled', 'tripled', 'homered', 'walked', 'struck', 'out', 'grounded', 'flied', 'lined', 'popped', 'home', 'third', 'second', 'first', 'base', 'center', 'with', 'the', 'and', 'for', 'conversion', 'attempt', 'failed']);
  const lowerHandle = h => String(h || '').replace(/^@/, '').trim().toLowerCase();
  function surnames(text) {
    const out = new Set();
    String(text || '').replace(/\([^)]*\)/g, ' ').split(/[^A-Za-z'.-]+/).forEach(tok => {
      const last = tok.split('.').pop().replace(/[^A-Za-z'-]/g, '');
      if (last.length >= 4 && /^[A-Z]/.test(last) && !NAME_STOP.has(last.toLowerCase()) && !/^(?:Yd|Yds|Jr|Sr|II|III)$/i.test(last)) out.add(last.toLowerCase());
    });
    return out;
  }
  function matchClipToPlay(clip, plays, opts = {}) {
    const posted = Date.parse(clip && (clip.postedAt || clip.posted_at));
    if (!Number.isFinite(posted)) return null;
    const minLag = Number(opts.minLagSec) || MIN_LAG;
    const maxLag = Number(opts.maxLagSec) || MAX_LAG;
    const handle = lowerHandle(clip.handle);
    const teams = opts.teams || {};
    const own = side => arr(teams[side] && teams[side].handles).map(lowerHandle);
    const neutral = arr(opts.neutralHandles).map(lowerHandle);
    const text = String(clip.text || '').toLowerCase();
    const found = [];
    arr(plays).forEach(p => {
      const snap = Date.parse(p && p.wallclock);
      if (!Number.isFinite(snap)) return;
      const lag = Math.round((posted - snap) / 1000);
      if (lag < minLag || lag > maxLag) return;
      const reasons = ['time'];
      let c = 0.4;
      const other = p.team === 'home' ? 'away' : (p.team === 'away' ? 'home' : '');
      if (handle && p.team && own(p.team).includes(handle)) { c += 0.35; reasons.push('team-handle'); }
      else if (handle && other && own(other).includes(handle)) { c -= 0.3; reasons.push('other-team-handle'); }
      else if (handle && neutral.includes(handle)) { c += 0.1; reasons.push('league-handle'); }
      const names = surnames(p.text);
      if ([...names].some(n => text.includes(n))) { c += 0.25; reasons.push('name-in-post'); }
      if (p.scoring) { c += 0.1; reasons.push('scoring'); }
      if (lag >= 90 && lag <= 420) c += 0.1;
      found.push({ playId: String(p.id), lagSec: lag, confidence: c, reasons });
    });
    if (!found.length) return null;
    found.sort((a, b) => b.confidence - a.confidence || a.lagSec - b.lagSec);
    const best = found[0];
    if (found[1] && best.confidence - found[1].confidence < 0.1) { best.confidence -= 0.2; best.reasons.push('ambiguous'); }
    best.confidence = round(clamp01(best.confidence), 2);
    // Sure needs evidence beyond the clock: the team's own account or a name from the play.
    best.sure = best.confidence >= 0.6 && !best.reasons.includes('ambiguous') && best.reasons.some(r => r === 'team-handle' || r === 'name-in-post');
    return best;
  }

  // ─── Text helpers (numbers only from the play text or the digest) ───────
  function playHeadline(p) {
    // ESPN college play text leads with the formation and jersey numbers
    // ("No Huddle-Shotgun #16 A.Manning pass ..."): the headline keeps the play.
    const base = String(p && p.text || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*\([^)]*$/, '').replace(/…$/, '')
      .replace(/^\s*(?:(?:No Huddle|Shotgun|Pistol|Under Center)[-\s]*)+/i, '').replace(/#\d{1,2}\s*/g, '')
      .replace(/\s+/g, ' ').trim().replace(/[.!,]+$/, '');
    // A sentence end, not "Sr." / "Jr." / an initial.
    const first = base.split(/(?<=[a-z]{2})(?<!\b(?:Jr|Sr|St|vs))[.;]\s+/)[0];
    // A cut line never ends on a dangling word ("... short right to").
    let words = trimWords(first, 9).split(' ');
    while (words.length > 3 && /^(?:to|by|for|at|the|of|and|from|on|in|a)$/i.test(words[words.length - 1])) words = words.slice(0, -1);
    return words.join(' ');
  }
  const plural = name => /s$/i.test(name);

  // ─── Game Swing ─────────────────────────────────────────────────────────
  // opts: { playIds (the editor's ticked plays), maxPlays = 4 (without playIds), clips: [{ url, handle, text, postedAt }], teams:
  // { home: { handles }, away: { handles } }, neutralHandles, style, title }
  function planFromGame(d, opts = {}) {
    if (!isObj(d) || !isObj(d.teams) || !isObj(d.status)) return null;
    const H = d.teams.home;
    const A = d.teams.away;
    const final = Boolean(d.status.final);
    const points = d.wp && arr(d.wp.points);
    const hasWp = Boolean(points && points.length >= 2 && d.attribution);
    // The editor's ticked plays (opts.playIds) when given, else the key plays.
    const plays = pickPlays(d, opts);
    const beats = [];
    const add = beat => beats.push({ id: `b${beats.length + 1}`, vo: '', emphasis: '', photo: '', ...beat, refs: arr(beat.refs).slice(0, 8) });
    const homeWon = H.score > A.score;
    const W = homeWon ? H : A;
    const L = homeWon ? A : H;

    // Hook: the comeback when there was one, else the result (or the live score).
    if (final && H.score !== A.score) {
      let hook = null;
      if (hasWp) {
        let low = points[0];
        points.forEach(pt => { if ((homeWon ? pt[1] : 1 - pt[1]) < (homeWon ? low[1] : 1 - low[1])) low = pt; });
        const lowPct = pct(homeWon ? low[1] : 1 - low[1]);
        if (lowPct <= 20) hook = { text: `${short(W)} won from ${lowPct}% win odds`, refs: [`wp:${low[0]}`], emphasis: `${lowPct}%` };
      }
      if (!hook) hook = { text: `${short(W)} beat${plural(short(W)) ? '' : 's'} ${short(L)} ${W.score}-${L.score}`, refs: [], emphasis: short(W) };
      add({ kind: 'hook', ...hook, visual: 'photo', photo: W.name, holdMs: 2200 });
    } else if (final) {
      add({ kind: 'hook', text: `${short(A)} and ${short(H)} tie ${A.score}-${H.score}`, refs: [], visual: 'photo', photo: H.name, holdMs: 2200 });
    } else {
      add({ kind: 'hook', text: `Live: ${A.abbr} ${A.score}, ${H.abbr} ${H.score}`, refs: [], visual: 'photo', photo: H.name, holdMs: 2200 });
    }

    // One beat per key play: scorebug state + caption over a clip or photo.
    // Each clip is matched against every play of the game (so a clip goes to
    // the play it shows, not the first one in its time window); only sure
    // matches count.
    const matched = arr(opts.clips).map(c => ({ c, m: c && c.url ? matchClipToPlay(c, arr(d.plays), opts) : null })).filter(x => x.m && x.m.sure);
    const used = new Set();
    plays.forEach(p => {
      const refs = [`play:${p.id}`];
      if (p.wpHome != null && hasWp && points.some(pt => pt[0] === p.seq)) refs.push(`wp:${p.seq}`);
      const team = p.team === 'home' ? H : (p.team === 'away' ? A : null);
      const beat = { kind: 'play', text: playHeadline(p), refs, playRef: `play:${p.id}`, visual: 'photo', photo: team ? team.name : '', holdMs: 3200 };
      // Clip: the best sure match for this play not already used; else the photo stays.
      let best = null;
      matched.forEach(({ c, m }) => {
        if (used.has(c.url) || m.playId !== String(p.id)) return;
        if (!best || m.confidence > best.m.confidence) best = { c, m };
      });
      if (best) {
        used.add(best.c.url);
        beat.visual = 'clip';
        beat.clip = { url: String(best.c.url), handle: String(best.c.handle || ''), lagSec: best.m.lagSec, confidence: best.m.confidence, matchedBy: 'time' };
      }
      add(beat);
    });

    // The win-probability line, with the key plays marked.
    if (hasWp) {
      const first = points[0][0];
      const last = points[points.length - 1][0];
      const marks = plays.filter(p => p.wpHome != null).map(p => `play:${p.id}`).slice(0, 4);
      add({ kind: 'wpline', text: 'How the win probability swung', refs: [`wp:${first}`, `wp:${last}`, ...marks], from: first, to: last, marks, team: 'home', visual: 'chart', attribution: d.attribution, holdMs: 3200 });
    }

    // The result, from the digest's own status.
    if (final) {
      const lastPlay = arr(d.plays).slice().reverse().find(p => arr(p.tags).includes('final'));
      add({ kind: 'payoff', text: `Final: ${A.abbr} ${A.score}, ${H.abbr} ${H.score}`, refs: lastPlay ? [`play:${lastPlay.id}`] : [], visual: 'logo-tile', photo: W.name, holdMs: 2400 });
    }
    add({ kind: 'cta', text: final ? 'Best finish of the week?' : 'Who takes this one?', refs: [], visual: 'photo', photo: '', holdMs: 2200 });

    const showsWp = beats.some(b => b.kind === 'wpline' || b.refs.some(r => r.startsWith('wp:')));
    return {
      format: 'gameswing',
      title: trimWords(opts.title || `${A.abbr} at ${H.abbr}: the swing`, 12),
      angle: final ? 'The plays that swung it' : 'Live swing tracker',
      sport: d.sport,
      team: { name: W.name, abbr: W.abbr },
      style: opts.style || 'series',
      source: 'data',
      outputs: ['reel'],
      hooks: [],
      beats,
      attribution: showsWp ? d.attribution : '',
      data: { game: d, athlete: null, archive: null },
      replay: null,
      slides: [],
      weak: beats.length < 4,
    };
  }

  // ─── Archive ────────────────────────────────────────────────────────────
  // archive: the archive-research response ({ articles, photos, candidates })
  // or timeline.data.archive ({ sources, photos, moments }).
  function archiveFacts(archive, athlete) {
    const lines = [];
    const a = isObj(archive) ? archive : {};
    arr(a.sources || a.articles).forEach(s => lines.push(`ES article ${s.id} (${String(s.date || '').slice(0, 10)}): ${s.title}`));
    arr(a.photos).forEach(p => { if (p.caption) lines.push(`ES photo ${p.id}: ${p.caption}`); });
    const st = athlete && athlete.stats;
    if (isObj(st)) {
      arr(st.seasons).forEach(row => lines.push(`${row.year} season (${row.team || ''}): ${st.labels.map((l, i) => `${l} ${row.stats[i]}`).join(', ')}.`));
      if (arr(st.totals).length) lines.push(`Career: ${st.labels.map((l, i) => `${l} ${st.totals[i]}`).join(', ')}.`);
    }
    arr(a.moments || a.candidates).forEach(m => lines.push(`${m.year}: ${m.title}. ${m.line || ''}`.trim()));
    return lines.join('\n');
  }
  const TOTAL_LABELS = ['YDS', 'HR', 'TD', 'SO', 'W', 'REC'];
  function careerStat(athlete) {
    const st = athlete && athlete.stats;
    if (!isObj(st) || !arr(st.totals).length) return null;
    const label = TOTAL_LABELS.find(l => st.labels.includes(l) && /\d/.test(String(st.totals[st.labels.indexOf(l)])));
    return label ? { value: String(st.totals[st.labels.indexOf(label)]), label: `CAREER ${label}` } : null;
  }
  function angleCount(angle, fallback = 5) {
    const m = String(angle || '').match(/\b(\d{1,2})\b/) || String(angle || '').toLowerCase().match(/\b(three|four|five|six|seven|eight)\b/);
    const n = m ? (Number(m[1]) || { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }[m[1]]) : fallback;
    return Math.max(3, Math.min(8, n));
  }
  // "2001: 2,843 yards" for a stat season; "2021: <story title>" otherwise.
  function momentText(m) {
    const title = String(m.title || '').trim();
    const named = title.includes(String(m.year));
    if (named && /^\d{4} season$/i.test(title) && m.line) return trimWords(`${m.year}: ${String(m.line).split(', ')[0]}`, 9);
    return trimWords(named ? title : `${m.year}: ${title}`, 9);
  }
  function planFromArchive(archive, athlete, opts = {}) {
    if (!isObj(archive)) return null;
    const name = String(opts.name || (athlete && athlete.name) || '').trim() || 'The archive';
    const sources = arr(archive.sources || archive.articles);
    const photos = arr(archive.photos);
    const pool = arr(archive.moments || archive.candidates).filter(m => isObj(m) && Number.isInteger(m.year) && arr(m.cite).length);
    const n = angleCount(opts.angle || archive.angle, Math.min(5, pool.length || 5));
    const chosen = (opts.momentIds ? pool.filter(m => opts.momentIds.includes(m.id)) : pool.slice(0, n)).slice().sort((a, b) => a.year - b.year || String(a.date || '').localeCompare(String(b.date || '')));
    const beats = [];
    const add = beat => beats.push({ id: `b${beats.length + 1}`, vo: '', emphasis: '', photo: '', ...beat, refs: arr(beat.refs).slice(0, 8) });
    const years = chosen.map(m => m.year);
    const span = years.length >= 2 && years[0] !== years[years.length - 1] ? `, ${years[0]} to ${years[years.length - 1]}` : '';
    const coverPhoto = chosen.find(m => m.photoId) || null;
    add({ kind: 'hook', text: trimWords(`${name}${span}`, 9), refs: coverPhoto ? [`photo:${coverPhoto.photoId}`] : [], visual: coverPhoto ? 'photo' : 'headshot', photo: name, holdMs: 2400 });
    chosen.forEach(m => {
      const refs = [...arr(m.cite)];
      if (m.photoId && photos.some(p => p.id === m.photoId)) refs.push(`photo:${m.photoId}`);
      const beat = { kind: 'moment', text: momentText(m), year: m.year, title: String(m.title || ''), line: String(m.line || ''), cite: arr(m.cite), refs, visual: 'photo', photo: m.photoId ? '' : name, holdMs: 3000 };
      if (m.stat && m.stat.value) beat.stat = { value: String(m.stat.value), label: String(m.stat.label || '') };
      if (m.date) beat.date = m.date;
      add(beat);
    });
    const total = careerStat(athlete);
    if (total) add({ kind: 'stat', text: `${name}: ${total.value} career ${total.label.replace(/^CAREER /, '').toLowerCase()}`.replace(/ yds$/, ' yards'), stat: total, refs: ['stat:totals'], visual: 'chart', holdMs: 2600 });
    add({ kind: 'cta', text: 'Which moment was the best?', refs: [], visual: 'photo', photo: name, holdMs: 2200 });

    // Carousel: cover, one slide per moment, a data slide, the question.
    const slides = [];
    const slide = s => { if (slides.length < 10) slides.push({ id: `s${slides.length + 1}`, refs: [], ...s }); };
    slide({ kind: 'cover', text: beats[0].text, refs: beats[0].refs.slice() });
    beats.filter(b => b.kind === 'moment').slice(0, 7).forEach(b => slide({ kind: 'moment', text: b.text, caption: b.line || undefined, refs: b.refs.slice(), beat: b.id }));
    const statBeat = beats.find(b => b.kind === 'stat');
    if (statBeat && slides.length < 9) slide({ kind: 'data', text: statBeat.text, refs: statBeat.refs.slice(), beat: statBeat.id });
    slide({ kind: 'cta', text: beats[beats.length - 1].text });
    slides.forEach(s => { if (s.caption === undefined) delete s.caption; });

    const athleteData = athlete && isObj(athlete) ? athlete : null;
    return {
      format: 'archive',
      title: trimWords(`${name} from the archive`, 12),
      angle: String(opts.angle || archive.angle || ''),
      sport: (athlete && athlete.sport) || opts.sport || '',
      team: null,
      style: opts.style || 'countdown',
      source: 'data',
      outputs: ['reel', 'carousel'],
      hooks: [],
      beats,
      data: {
        game: null,
        athlete: athleteData,
        archive: {
          athleteId: String(archive.athleteId || (athlete && athlete.athleteId) || ''),
          angle: String(opts.angle || archive.angle || ''),
          sources: sources.map(s => ({ id: s.id, type: 'es-article', title: s.title, url: s.url, date: s.date, ...(s.entities ? { entities: s.entities } : {}) })),
          photos: photos.map(p => ({ id: p.id, url: p.url, caption: p.caption || '', credit: p.credit || '', ...(p.width ? { width: p.width } : {}) })),
          moments: chosen.map(m => ({ id: m.id, year: m.year, title: m.title, line: m.line || '', cite: arr(m.cite) })),
          thin: Boolean(archive.thin || (archive.coverage && archive.coverage.thin)),
        },
      },
      replay: null,
      slides,
      weak: chosen.length < 3,
    };
  }

  // ─── Moment Replay ──────────────────────────────────────────────────────
  // replay: { origin, clipAsset, clipUrl, segment, picker, frames: [{ role, t }] }
  // opts: { captions: { setup, play, reaction }, title, game: digest, playId }
  function planFromReplay(replay, opts = {}) {
    if (!isObj(replay)) return null;
    const frames = arr(replay.frames).filter(f => isObj(f) && ['setup', 'play', 'reaction'].includes(f.role));
    const caps = isObj(opts.captions) ? opts.captions : {};
    const cap = role => String(caps[role] || { setup: 'The setup', play: 'The play', reaction: 'The reaction' }[role]);
    const title = trimWords(opts.title || 'The moment, in three frames', 9);
    const beats = [
      { id: 'b1', kind: 'hook', text: title, vo: '', emphasis: '', photo: '', refs: frames.some(f => f.role === 'play') ? ['frame:play'] : [], visual: 'clip', holdMs: 2400 },
      { id: 'b2', kind: 'panel3', text: '', vo: '', emphasis: '', photo: '', refs: frames.map(f => `frame:${f.role}`), frames: frames.map(f => ({ role: f.role, t: f.t, caption: cap(f.role) })), visual: 'clip', holdMs: 5600 },
      { id: 'b3', kind: 'cta', text: 'Best play this week?', vo: '', emphasis: '', photo: '', refs: [], visual: 'photo', holdMs: 1600 },
    ];
    const game = isObj(opts.game) ? opts.game : null;
    const gamePlay = game && opts.playId ? arr(game.plays).find(p => String(p.id) === String(opts.playId)) : null;
    const slides = [{ id: 's1', kind: 'cover', text: title, refs: frames.some(f => f.role === 'play') ? ['frame:play'] : [] }];
    frames.forEach(f => slides.push({ id: `s${slides.length + 1}`, kind: 'panel', text: cap(f.role), refs: [`frame:${f.role}`], beat: 'b2' }));
    if (gamePlay && slides.length < 4) slides.push({ id: `s${slides.length + 1}`, kind: 'data', text: `${game.teams.away.abbr} ${gamePlay.score.away}, ${game.teams.home.abbr} ${gamePlay.score.home}`, refs: [`play:${gamePlay.id}`] });
    slides.push({ id: `s${slides.length + 1}`, kind: 'cta', text: 'Best play this week?', refs: [] });
    return {
      format: 'replay',
      title,
      angle: '',
      sport: opts.sport || (game && game.sport) || '',
      team: null,
      style: opts.style || 'classic',
      source: 'data',
      outputs: ['reel', 'carousel'],
      hooks: [],
      beats,
      data: { game, athlete: null, archive: null },
      replay: { origin: replay.origin, clipAsset: replay.clipAsset || '', clipUrl: replay.clipUrl || '', segment: replay.segment || null, picker: replay.picker || 'code', frames: frames.map(f => ({ role: f.role, t: f.t })) },
      slides: slides.slice(0, 5),
      weak: frames.length < 3,
    };
  }

  const factsText = d => (T && T.digestFacts ? T.digestFacts(d) : '');

  return {
    dramaScore, dramaParts, wpSpark, keyPlays, pickPlays, MAX_KEY_PLAYS, scorebugAt, scorebugForPlay, periodLabel, matchClipToPlay, surnames,
    planFromGame, planFromArchive, planFromReplay, factsText, archiveFacts, playHeadline, momentText, careerStat, angleCount,
    ATTRIBUTION, MIN_LAG, MAX_LAG,
  };
}));
