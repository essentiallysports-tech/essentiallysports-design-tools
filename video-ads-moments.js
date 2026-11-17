// Video Ads "By moment": the most popular sports clips of the last 5 days.
// One file for the browser (window.VideoAdsMoments) and the server (require),
// like video-ads-teams.js. Pure functions, no network, no DOM.
//
// A moment is one play (or one story) seen from one or more angles: the same
// touchdown posted by @NFL, the team account and a network is one moment with
// its best version first and the others as "+N more angles".
//
//   clusterClips   near-duplicates -> groups (media key, soft key, caption
//                  similarity + same teams + posted within a few hours)
//   velocityOf     engagement per hour since posting (views, else likes)
//   trendScore     velocity, engagement, recency, source, quality, angles
//   cleanTitle     the post text as a short title (never invents anything)
//   groundedTitle  is an AI title only a summary of the post text?
//   buildMoments   clips -> ranked moments, with a "thin" flag when there is
//                  not enough engagement data to rank by (newest instead)
//   filterMoments / sortMoments / momentFacets   the page's sport, team,
//                  colour filters and Trending / Newest / Most viewed sort
//   handoffFilter  the Trends page hand-off (frameup.videoAdMoment.v1) -> filters
(function (root, factory) {
  let teams = null;
  if (typeof module === 'object' && module.exports) {
    try { teams = require('./video-ads-teams.js'); } catch (error) { teams = null; }
    module.exports = factory(teams);
  } else {
    root.VideoAdsMoments = factory(root.VideoAdsTeams || null);
  }
}(typeof self !== 'undefined' ? self : this, TEAMS_MODULE => {
  'use strict';

  const SPORTS = ['nfl', 'cfb', 'mlb'];
  const CONFIG = {
    windowHours: 120, // the last 5 days
    clusterHours: 6, // two posts of one play are this close in time
    minShared: 2, // distinctive caption words two posts must share
    minOverlap: 0.5, // ... as a share of the shorter caption
    likesToViews: 25, // a like is worth ~25 views when a platform gives no view count
    minEngaged: 3, // fewer moments with engagement numbers than this: rank by newest
    titleMax: 72,
  };
  const SOURCE_POINTS = { official: 15, league: 13, media: 11, other: 0, fan: 0 };

  const teamsList = () => (TEAMS_MODULE && Array.isArray(TEAMS_MODULE.TEAMS) ? TEAMS_MODULE.TEAMS : []);
  const findTeam = (name, sport) => {
    if (!name) return null;
    if (TEAMS_MODULE && typeof TEAMS_MODULE.findTeam === 'function') {
      try { const t = TEAMS_MODULE.findTeam(name, sport); if (t) return t; } catch (error) { /* fall through */ }
    }
    const n = String(name).toLowerCase();
    return teamsList().find(t => (!sport || t.sport === sport) && (t.name.toLowerCase() === n || String(t.short || '').toLowerCase() === n)) || null;
  };

  // ── Small helpers ────────────────────────────────────────────────────────
  const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const hoursBetween = (from, to) => {
    const a = new Date(from).getTime();
    const b = new Date(to).getTime();
    return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 3600e3 : NaN;
  };
  const ageHours = (clip, now = Date.now()) => {
    const h = hoursBetween(clip.postedAt, now);
    return Number.isFinite(h) ? Math.max(0, h) : Infinity;
  };
  function hash(text) {
    let h = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  // 12400 -> "12k", 1250000 -> "1.3M"
  function compact(n) {
    const v = num(n);
    if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '')}k`;
    return String(Math.round(v));
  }
  // "12k views", or "900 likes" when the platform gave no view count; '' when unknown.
  function engagementLabel({ views = 0, likes = 0 } = {}) {
    if (num(views) > 0) return `${compact(views)} view${num(views) === 1 ? '' : 's'}`;
    if (num(likes) > 0) return `${compact(likes)} like${num(likes) === 1 ? '' : 's'}`;
    return '';
  }

  // ── Keys (same video) ────────────────────────────────────────────────────
  // The same video re-posted by several X accounts shares its media id.
  function mediaKey(clip) {
    if (clip.mediaKey) return String(clip.mediaKey);
    for (const v of clip.variants || []) {
      const m = String(v && v.url).match(/\/(?:amplify_video|ext_tw_video|tweet_video)\/(\d+)\//);
      if (m) return `m${m[1]}`;
    }
    const thumb = String(clip.thumb || '').replace(/\?.*$/, '');
    return thumb ? `t${thumb}` : `u${clip.url}`;
  }
  // A mirror on another platform: the same length to the second and the same
  // opening words of a caption long enough to be distinctive.
  function softKey(clip) {
    const text = String(clip.text || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!clip.durationMs || text.length < 24) return '';
    return `s${Math.round(clip.durationMs / 1000)}|${text.slice(0, 40)}`;
  }

  // ── Caption words ────────────────────────────────────────────────────────
  const STOP = new Set(('the and for with from this that what when where who how his her their our your its into onto over under after before '
    + 'just about than then them they you are was were has have had will would can could not but all out off get got gets one two three '
    + 'big huge wow watch video clip highlight highlights replay play plays game games week today tonight now here there more most '
    + 'via let lets live first last next new time year years season team teams win wins won loss lose lost vs').split(' '));
  // Play words every highlight shares: two home runs are not one play.
  const PLAY_WORDS = new Set(('touchdown touchdowns score scores scoring yard yards yarder run runs runner home homer homers walk walkoff grand slam '
    + 'catch catches grab pass passes throw throws dime sack sacks pick interception fumble kick field goal punt return tackle block '
    + 'hit hits double triple single strikeout strikeouts struck inning innings pitch pitcher pitches swing bomb blast shot drive '
    + 'go-ahead goahead ahead game-winning winning winner clutch late final quarter half half-time overtime ninth deep ball end zone '
    + 'insane unreal incredible amazing crazy wild nasty filthy beautiful perfect great nice').split(' '));
  const teamWords = (() => {
    const cache = new Map();
    return sport => {
      if (cache.has(sport)) return cache.get(sport);
      const set = new Set();
      teamsList().filter(t => !sport || t.sport === sport).forEach(t => `${t.name} ${t.short || ''}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).forEach(w => w && set.add(w)));
      cache.set(sport, set);
      return set;
    };
  })();
  // Distinctive words of a caption: no links, handles, stop words or team words
  // (every Chiefs clip says "Chiefs"; that alone doesn't make two clips one play).
  function captionWords(text, sport = '') {
    const tw = teamWords(sport);
    const words = String(text || '').toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/@\w+/g, ' ')
      .replace(/#/g, ' ')
      .split(/[^\p{L}\p{N}']+/u)
      .map(w => w.replace(/'s$/, '').replace(/'/g, ''))
      .filter(w => w.length >= 3 && !STOP.has(w) && !PLAY_WORDS.has(w) && !tw.has(w) && !/^\d+$/.test(w));
    return new Set(words);
  }
  // Names: words written with a capital (or in an ALL CAPS post) that are not
  // play or team words. Two posts of one play name the same player.
  function nameWords(text, sport = '') {
    const all = captionWords(text, sport);
    const out = new Set();
    String(text || '').replace(/https?:\/\/\S+/g, ' ').replace(/@\w+/g, ' ').split(/[^\p{L}\p{N}'’]+/u).forEach(raw => {
      const w = raw.toLowerCase().replace(/['’]s$/, '').replace(/['’]/g, '');
      if (/^\p{Lu}/u.test(raw) && all.has(w)) out.add(w);
    });
    return out;
  }

  // Are two clips the same play? Same sport, posted close together, compatible
  // teams, and enough distinctive caption words in common.
  function samePlay(a, b, { clusterHours = CONFIG.clusterHours } = {}) {
    if ((a.sport || '') !== (b.sport || '')) return false;
    const gap = Math.abs(hoursBetween(a.postedAt, b.postedAt));
    if (!Number.isFinite(gap) || gap > clusterHours) return false;
    const ta = (a.teams || []).map(t => String(t).toLowerCase());
    const tb = (b.teams || []).map(t => String(t).toLowerCase());
    if (ta.length && tb.length && !ta.some(t => tb.includes(t))) return false;
    const wa = a._words || captionWords(a.text, a.sport);
    const wb = b._words || captionWords(b.text, b.sport);
    if (!wa.size || !wb.size) return false;
    let shared = 0;
    wa.forEach(w => { if (wb.has(w)) shared += 1; });
    if (shared < CONFIG.minShared) return false;
    // At least one shared name (a player), not just common words.
    const na = a._names || nameWords(a.text, a.sport);
    const nb = b._names || nameWords(b.text, b.sport);
    let names = 0;
    na.forEach(w => { if (nb.has(w)) names += 1; });
    if (!names) return false;
    return shared / Math.min(wa.size, wb.size) >= CONFIG.minOverlap || shared >= 4;
  }

  // ── Engagement, velocity, score ──────────────────────────────────────────
  // Views when known, else likes in view-equivalents. 0 when unknown.
  const engagementOf = c => (num(c.views) > 0 ? num(c.views) : num(c.likes) * CONFIG.likesToViews);
  // Engagement per hour between posting and when the numbers were read
  // (checkedAt for library rows, else now). At least one hour.
  function velocityOf(clip, now = Date.now()) {
    const eng = engagementOf(clip);
    if (!eng) return 0;
    const at = clip.checkedAt && Number.isFinite(new Date(clip.checkedAt).getTime()) ? clip.checkedAt : now;
    const hours = hoursBetween(clip.postedAt, at);
    return eng / Math.max(1, Number.isFinite(hours) ? hours : 1);
  }
  const shortSide = c => num(c.shortSide) || (c.variants && c.variants[0] ? Math.min(num(c.variants[0].width), num(c.variants[0].height)) : 0);
  const qualityPoints = c => { const s = shortSide(c); return s >= 1080 ? 10 : s >= 720 ? 7 : s >= 480 ? 3 : 1; };
  const sourceKind = c => c.sourceKind || (c.source === 'other' ? 'fan' : c.source) || 'fan';
  const sourcePoints = c => (SOURCE_POINTS[sourceKind(c)] ?? 0) + (sourceKind(c) === 'fan' && /^(organization|business|government)$/i.test(c.verifiedType || '') ? 3 : 0);
  // The best single version of a play: official first, then quality, then reach.
  const versionScore = c => sourcePoints(c) * 2 + qualityPoints(c) + Math.min(6, Math.log10(1 + engagementOf(c)));

  // Trending score of a moment (0-~100): velocity 30, engagement 20, recency 20,
  // source 15, quality 10, +3 per extra angle (many accounts posting a play is
  // a signal in itself), up to +9.
  function trendScore({ velocity = 0, engagement = 0, ageHours: age = 0, best = {}, angles = 0 } = {}) {
    let s = 30 * Math.min(1, Math.log10(1 + velocity) / 5);
    s += 20 * Math.min(1, Math.log10(1 + engagement) / 6.5);
    s += 20 * Math.max(0, 1 - (Number.isFinite(age) ? age : CONFIG.windowHours) / CONFIG.windowHours);
    s += sourcePoints(best);
    s += qualityPoints(best);
    s += Math.min(9, 3 * angles);
    return Math.round(s * 10) / 10;
  }

  // ── Clustering ───────────────────────────────────────────────────────────
  // -> [[clip, ...], ...] (each group in input order). Union-find over every
  // pair: fine for the few hundred clips a 5-day pool holds.
  function clusterClips(clips, opts = {}) {
    const list = (clips || []).filter(Boolean).map(c => ({ c, words: captionWords(c.text, c.sport), names: nameWords(c.text, c.sport) }));
    const parent = list.map((_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const join = (i, j) => { const a = find(i); const b = find(j); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
    const byKey = new Map();
    list.forEach((x, i) => {
      [`u${x.c.url}`, mediaKey(x.c), softKey(x.c)].filter(Boolean).forEach(k => {
        if (byKey.has(k)) join(i, byKey.get(k)); else byKey.set(k, i);
      });
    });
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (find(i) === find(j)) continue;
        if (samePlay({ ...list[i].c, _words: list[i].words, _names: list[i].names }, { ...list[j].c, _words: list[j].words, _names: list[j].names }, opts)) join(i, j);
      }
    }
    const groups = new Map();
    list.forEach((x, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(x.c);
    });
    return [...groups.values()];
  }

  // ── Titles ───────────────────────────────────────────────────────────────
  const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);
  const titleCase = text => text.toLowerCase().replace(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu, (w, i) => (i > 0 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
  function cutAt(text, max) {
    if (text.length <= max) return { text, cut: false };
    const head = text.slice(0, max + 1);
    const space = head.lastIndexOf(' ');
    return { text: `${head.slice(0, space > max * 0.5 ? space : max).replace(/[\s,;:–—-]+$/, '')}…`, cut: true };
  }
  // The post text as a title: no links, handles, hashtag piles, emoji,
  // broadcast tags or "WATCH:" prefixes; ALL CAPS calmed to title case; the
  // first line or sentence when long. -> { title, cut, empty }
  function cleanTitle(raw, { max = CONFIG.titleMax } = {}) {
    let text = String(raw || '')
      .replace(/https?:\/\/\S+|pic\.twitter\.com\/\S+/gi, ' ')
      .replace(/^\s*RT\s+@\w+:?\s*/i, '');
    // The first non-empty line that still has words once tidied.
    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const tidy = line => line
      .replace(/(?:📺|🎥|📽️?|🎬)\s*:?\s*.*$/u, ' ') // "📺: CBS" broadcast tags
      .replace(/\(\s*(?:via|h\/t|🎥|📸)\s*[:@]?[^)]*\)/giu, ' ')
      .replace(/\b(?:via|h\/t)\s+@\w+/gi, ' ')
      .replace(/^(?:\s*@\w+)+[\s:,]*/, ' ') // leading reply handles
      .replace(/(?:\s+[@#][\w]+)+[\s.!]*$/u, ' ') // trailing hashtag / handle piles
      .replace(/@(\w+)/g, '$1')
      .replace(/#(\w+)/g, '$1')
      .replace(/\s*(?:➡️|➡|→|->)\s*/gu, ' to ')
      .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, ' ')
      .replace(/^\s*(?:watch|video|replay|highlight|breaking|wow|omg)\s*[:!-]+\s*/i, ' ')
      .replace(/([!?.])\1+/g, '$1')
      .replace(/\s+([!?.,:;])/g, '$1')
      .replace(/^[\s:,.;–—-]+|[\s:,;–—-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    let title = '';
    for (const line of lines) {
      const t = tidy(line);
      if ((t.match(/\p{L}/gu) || []).length >= 4) { title = t; break; }
    }
    if (!title) return { title: '', cut: false, empty: true };
    const letters = title.match(/\p{L}/gu) || [];
    const upper = title.match(/\p{Lu}/gu) || [];
    if (letters.length > 10 && upper.length / letters.length > 0.7) title = titleCase(title);
    // Long: the first sentence, when it carries the point on its own.
    if (title.length > max) {
      const first = title.match(/^.{12,}?[.!?](?=\s|$)/u);
      if (first && first[0].length <= max) return { title: first[0].replace(/\.$/, ''), cut: true, empty: false };
    }
    const done = cutAt(title, max);
    return { title: done.text.replace(/\.$/, ''), cut: done.cut, empty: false };
  }
  // A title for a group with no usable text: the team or sport (no invented facts).
  function fallbackTitle({ teams = [], sport = '' } = {}) {
    const team = teams[0] ? findTeam(teams[0], sport) : null;
    const name = team ? (team.short || team.name) : String(teams[0] || '');
    return name ? `${name} highlight` : `${({ nfl: 'NFL', cfb: 'College football', mlb: 'MLB' })[sport] || 'Sports'} highlight`;
  }
  // An AI title is kept only if it summarises the post: every number and every
  // capitalised word (names, teams) must be in the post text, it is short, and
  // it is not empty or hype.
  function groundedTitle(title, source) {
    const t = String(title || '').replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '');
    if (t.length < 6 || t.length > CONFIG.titleMax) return '';
    const words = t.split(' ');
    if (words.length > 11) return '';
    const hay = String(source || '').toLowerCase().replace(/[#@]/g, '').replace(/[’]/g, "'");
    const hayNums = (hay.match(/\d[\d,.]*/g) || []).map(n => n.replace(/[,]/g, '').replace(/\.$/, ''));
    const nums = (t.match(/\d[\d,.]*/g) || []).map(n => n.replace(/[,]/g, '').replace(/\.$/, ''));
    if (nums.some(n => !hayNums.includes(n))) return '';
    const caps = words.slice(1).concat(words[0]).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(w => /^\p{Lu}/u.test(w));
    const small = new Set(['A', 'An', 'The', 'And', 'To', 'Of', 'In', 'On', 'At', 'For', 'With', 'Vs', 'His', 'Her', 'Their', 'After', 'From', 'Big', 'Late', 'Early', 'Huge', 'Game', 'Win', 'Play', 'Catch', 'Run', 'Touchdown', 'Goal', 'Score', 'Highlight', 'Home', 'Walk-off', 'First', 'Second', 'Third']);
    const words0 = words[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (caps.some(w => !(w === words0 && small.has(w)) && !small.has(w) && !hay.includes(w.toLowerCase().replace(/'s$/, '')))) return '';
    if (/\b(shocking|insane|unbelievable|must[- ]see|jaw[- ]dropping|mind[- ]blowing)\b/i.test(t)) return '';
    return t.replace(/\.$/, '');
  }

  // ── Moments ──────────────────────────────────────────────────────────────
  // clips -> { moments, thin }. Each moment:
  //   { id, title, titleBy: 'post' | 'fallback', titleCut, sourceText, sport,
  //     teams: [name], score, velocity, views, likes, engagement, postedAt,
  //     latestAt, ageHours, angles, clips: [best, ...alts], via? }
  // thin: fewer than CONFIG.minEngaged moments have engagement numbers, so
  // they are ranked newest first (and labelled so) instead of by trending.
  function buildMoments(clips, { now = Date.now(), windowHours = CONFIG.windowHours, sort = 'trending' } = {}) {
    const pool = (clips || []).filter(c => c && c.url && Array.isArray(c.variants) && c.variants.length && ageHours(c, now) <= Math.max(windowHours, 168));
    const groups = clusterClips(pool);
    const moments = groups.map(group => {
      const ordered = [...group].sort((a, b) => versionScore(b) - versionScore(a) || ageHours(a, now) - ageHours(b, now));
      const best = ordered[0];
      const sport = best.sport || group.find(c => c.sport)?.sport || '';
      const teams = [...new Set(group.flatMap(c => c.teams || []))].slice(0, 6);
      const posted = group.map(c => new Date(c.postedAt).getTime()).filter(Number.isFinite);
      const postedAt = posted.length ? new Date(Math.min(...posted)).toISOString() : best.postedAt;
      const latestAt = posted.length ? new Date(Math.max(...posted)).toISOString() : best.postedAt;
      const views = group.reduce((n, c) => n + num(c.views), 0);
      const likes = group.reduce((n, c) => n + num(c.likes), 0);
      const engagement = group.reduce((n, c) => n + engagementOf(c), 0);
      const velocity = group.reduce((n, c) => n + velocityOf(c, now), 0);
      const age = ageHours({ postedAt: latestAt }, now);
      // Title: the best version's text, else the next one with usable text.
      let titled = { title: '', cut: false, empty: true };
      let sourceText = '';
      for (const c of ordered) {
        const t = cleanTitle(c.text);
        if (!t.empty) { titled = t; sourceText = c.text; break; }
      }
      const via = group.every(c => c.via) ? best.via : undefined;
      return {
        id: `mo_${hash(ordered.map(c => mediaKey(c)).sort()[0])}`,
        title: titled.empty ? fallbackTitle({ teams, sport }) : titled.title,
        titleBy: titled.empty ? 'fallback' : 'post',
        titleCut: titled.cut,
        sourceText: String(sourceText || '').slice(0, 400),
        sport,
        teams,
        score: trendScore({ velocity, engagement, ageHours: age, best, angles: ordered.length - 1 }),
        velocity: Math.round(velocity),
        views, likes, engagement,
        postedAt, latestAt,
        ageHours: Math.round(age),
        angles: ordered.length - 1,
        clips: ordered,
        ...(via ? { via } : {}),
      };
    });
    const engaged = moments.filter(m => m.engagement > 0).length;
    const thin = engaged < Math.min(CONFIG.minEngaged, moments.length || CONFIG.minEngaged) || engaged === 0;
    return { moments: sortMoments(moments, thin && sort === 'trending' ? 'newest' : sort), thin, engaged };
  }

  function sortMoments(list, sort = 'trending') {
    const at = m => new Date(m.latestAt || m.postedAt || 0).getTime() || 0;
    const viaLast = m => (m.via ? 1 : 0);
    const by = {
      trending: (a, b) => viaLast(a) - viaLast(b) || b.score - a.score || at(b) - at(a),
      newest: (a, b) => viaLast(a) - viaLast(b) || at(b) - at(a) || b.score - a.score,
      views: (a, b) => viaLast(a) - viaLast(b) || b.engagement - a.engagement || b.score - a.score,
    }[sort === 'popular' || sort === 'viewed' ? 'views' : sort] || ((a, b) => b.score - a.score);
    return [...(list || [])].sort(by);
  }

  // The colour families of a moment (its teams' families).
  function familiesOf(moment) {
    const out = new Set();
    (moment.teams || []).forEach(name => {
      const t = findTeam(typeof name === 'string' ? name : name && name.name, moment.sport);
      (t && Array.isArray(t.families) ? t.families : []).forEach(f => out.add(f));
    });
    return [...out];
  }
  const teamNames = m => (m.teams || []).map(t => (typeof t === 'string' ? t : t && t.name)).filter(Boolean);

  // filters: { sport: 'all' | id, team: name, color: family id }
  function filterMoments(list, { sport = 'all', team = '', color = '' } = {}) {
    return (list || []).filter(m => (!sport || sport === 'all' || m.sport === sport)
      && (!team || teamNames(m).some(n => n.toLowerCase() === String(team).toLowerCase()))
      && (!color || familiesOf(m).includes(color)));
  }

  // Team and colour options over a list (after the sport filter), with counts.
  function momentFacets(list) {
    const teams = new Map();
    const colors = new Map();
    (list || []).forEach(m => {
      teamNames(m).forEach(n => {
        const t = findTeam(n, m.sport);
        const key = t ? t.name : n;
        const had = teams.get(key) || { name: key, short: t ? t.short : n, sport: m.sport, colors: t ? t.colors : [], count: 0 };
        had.count += 1;
        teams.set(key, had);
      });
      familiesOf(m).forEach(f => colors.set(f, (colors.get(f) || 0) + 1));
    });
    const colorList = (TEAMS_MODULE && Array.isArray(TEAMS_MODULE.COLORS) ? TEAMS_MODULE.COLORS : [])
      .filter(c => colors.has(c.id)).map(c => ({ id: c.id, label: c.label, hex: c.hex, count: colors.get(c.id) }));
    return {
      teams: [...teams.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      colors: colorList.sort((a, b) => b.count - a.count),
    };
  }

  // The team a story title names first (full or short name), for the hand-off.
  function teamInTitle(title, sport) {
    const text = String(title || '').toLowerCase();
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = name => (name ? text.search(new RegExp(`(?<![\\p{L}\\p{N}])${esc(String(name).toLowerCase())}(?![\\p{L}\\p{N}])`, 'u')) : -1);
    let best = null;
    teamsList().filter(t => !sport || t.sport === sport).forEach(team => {
      const found = [at(team.name), at(team.short)].filter(i => i >= 0);
      if (found.length && (!best || Math.min(...found) < best.index)) best = { team, index: Math.min(...found) };
    });
    return best ? best.team : null;
  }
  // Trends hand-off ({ id, title, sport, team? }) -> the By moment filters:
  // that story's sport and team (named, else the team its title names first).
  function handoffFilter(h) {
    if (!h || typeof h !== 'object') return null;
    const sport = SPORTS.includes(h.sport) ? h.sport : '';
    if (!sport) return null;
    const named = h.team ? findTeam(String(h.team).slice(0, 80), sport) : null;
    const team = named || teamInTitle(h.title, sport);
    return { sport, team: team ? team.name : '', color: '', title: String(h.title || '').slice(0, 200) };
  }

  return {
    CONFIG, SPORTS,
    hash, compact, engagementLabel, mediaKey, softKey, captionWords, nameWords, samePlay,
    engagementOf, velocityOf, versionScore, trendScore, clusterClips,
    cleanTitle, fallbackTitle, groundedTitle,
    buildMoments, sortMoments, familiesOf, filterMoments, momentFacets, teamInTitle, handoffFilter,
  };
}));
