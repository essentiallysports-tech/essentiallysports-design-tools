// Reels Studio format gallery and source pickers (window.ReelGallery; Node
// for the tests). Pure helpers and HTML builders only: no DOM access, no
// network. reel-maker.js owns the events, the requests and the page state.
//
//   Format gallery   two rows of tiles: the four news formats (the trend-first
//                    path, unchanged) and the data formats (Game Swing, Moment
//                    Replay, Archive). The Story step's "Start from data" panel
//                    renders the same tiles and expands in place to show all. A data tile is "coming soon" until the
//                    server modes it needs are live (config.formatModes).
//   Source pickers   game list (Live now / Last 48 h sorted by drama / Search),
//                    player search with an angle, clip link / library / upload.
//   Briefs           the facts text each data format hands the script writer,
//                    built only from the picked data (no invented numbers).
//
// Contract: project-docs/reels-formats-contract.md (§2.1 shapes, §5 flow).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelGallery = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ART = id => `assets/reels/formats/${id}.svg`;
  const SPORT_LABEL = { nfl: 'NFL', cfb: 'CFB', mlb: 'MLB', golf: 'Golf' };

  // Server modes a data format cannot run without (contract §2). Replay's AI
  // frame pick is optional: the code pick is always there.
  const REQUIRED_MODES = { gameswing: ['games', 'game-data'], replay: [], archive: ['athlete', 'archive-research'] };
  const OPTIONAL_MODES = { gameswing: [], replay: ['frame-pick'], archive: [] };
  const SOURCE_LABEL = { game: 'Game', clip: 'Clip', player: 'Player', trend: 'Story' };

  // 'ready' | 'soon' for one format. News formats are always ready.
  function formatStatus(id, formatModes) {
    const need = REQUIRED_MODES[id];
    if (!need) return 'ready';
    const modes = formatModes && typeof formatModes === 'object' ? formatModes : {};
    return need.every(mode => modes[mode] === true) ? 'ready' : 'soon';
  }
  const modeOn = (formatModes, mode) => Boolean(formatModes && formatModes[mode] === true);

  // "≈ $0.002" for a tile: the format's own defaults with an Economy script.
  function costHint(F, id, { aiFramePick = true } = {}) {
    if (!F || !F.FORMATS[id]) return '';
    const est = F.estimateCost({ tier: 'economy', voiceMode: 'off', ...(F.formatCostOptions ? F.formatCostOptions(id, { aiFramePick }) : {}) });
    return `≈ ${F.money(est.total)}`;
  }
  const outputsLabel = outputs => ((outputs || ['reel']).includes('carousel') ? 'Reel + carousel' : 'Reel');

  function galleryModel(F, formatModes, { aiFramePick = true } = {}) {
    const tile = id => {
      const f = F.FORMATS[id];
      const data = F.isDataFormat ? F.isDataFormat(id) : false;
      return {
        id, label: f.label, short: f.short, blurb: f.blurb, family: data ? 'data' : 'news',
        outputs: f.outputs || ['reel'], outputsLabel: outputsLabel(f.outputs), art: ART(id),
        cost: costHint(F, id, { aiFramePick: aiFramePick && modeOn(formatModes, 'frame-pick') }),
        source: data ? f.source : 'trend', sports: f.sports || ['nfl', 'cfb', 'mlb', 'golf'],
        status: formatStatus(id, formatModes),
      };
    };
    return { news: F.FORMAT_IDS.map(tile), data: (F.DATA_FORMAT_IDS || []).map(tile) };
  }

  // One line under each tile title (shortened from reel-formats.js blurbs; the
  // registry is frozen, so the short copy lives here).
  const SUMMARY = {
    explainer: 'What happened and why it matters.',
    stat: 'One big number, then the context.',
    top5: 'Five ranked entries, #5 to #1.',
    quote: 'A real quote as kinetic type.',
    gameswing: 'The plays that swung a game.',
    replay: 'Setup, play, reaction from one clip.',
    archive: 'A career year by year, all cited.',
  };
  const summaryOf = t => SUMMARY[t.id] || t.blurb || '';

  // One format tile: the one renderer for the Format step gallery and the
  // "Start from data" panel on the Story step. Coming-soon tiles stay
  // focusable (aria-disabled) so keyboard and screen-reader users hear why
  // they cannot be picked. prefix keeps ids unique when both are in the DOM;
  // compact drops the cost chip and uses the short name (narrow panel).
  function tileHtml(t, { selected = '', prefix = 'rm-gt', compact = false } = {}) {
    const soon = t.status === 'soon';
    const on = selected === t.id;
    const sports = (t.sports || []).map(s => SPORT_LABEL[s] || s).join(compact ? '\u200a·\u200a' : ' · ');
    const did = `${prefix}-${esc(t.id)}-d`;
    const name = compact ? (t.short || t.label) : t.label;
    return `<li class="rm-gtile${compact ? ' rm-gtile--compact' : ''}${soon ? ' is-soon' : ''}${on ? ' is-on' : ''}">
      <button class="rm-gtile__btn" type="button" data-gformat="${esc(t.id)}" aria-describedby="${did}"${soon ? ' aria-disabled="true"' : ''}${on ? ' aria-current="true"' : ''}>
        <span class="rm-gtile__art"><img src="${esc(t.art)}" alt="" width="200" height="250" loading="lazy" decoding="async">${soon ? '<span class="es-badge rm-gtile__soon">Coming soon</span>' : ''}${on ? '<span class="es-badge es-badge--brand rm-gtile__on">Selected</span>' : ''}</span>
        <span class="rm-gtile__name">${esc(name)}</span>
      </button>
      <p class="rm-gtile__blurb" id="${did}">${esc(summaryOf(t))}${soon ? ' Coming soon: its data server lands next.' : ''}</p>
      <p class="rm-gtile__chips"><span class="rm-gchip">${esc(t.outputsLabel)}</span>${compact ? '' : `<span class="rm-gchip">${esc(t.cost)} a reel</span>`}<span class="rm-gchip rm-gchip--quiet rm-gtile__sports" title="${t.family === 'data' ? esc(sports) : 'From a trend or a brief'}">${t.family === 'data' ? esc(sports) : 'Trend or brief'}</span></p>
    </li>`;
  }
  function galleryHtml(model, opts = {}) {
    return `<section class="rm-ggroup" aria-labelledby="rm-gg-news"><h4 class="rm-ggroup__title" id="rm-gg-news">From the news</h4><p class="rm-ggroup__hint">Start from a trend or your brief.</p><ul class="rm-gtiles">${model.news.map(t => tileHtml(t, opts)).join('')}</ul></section>
      <section class="rm-ggroup" aria-labelledby="rm-gg-data"><h4 class="rm-ggroup__title" id="rm-gg-data">From live data and the archive <span class="es-badge es-badge--new">New</span></h4><p class="rm-ggroup__hint">Start from a game, a clip or a career. Every number comes from the data.</p><ul class="rm-gtiles">${model.data.map(t => tileHtml(t, opts)).join('')}</ul></section>`;
  }
  // The "Start from data" panel on the Story step (beside the trend-first
  // path). Collapsed: the data formats in one row. "All formats" expands the
  // same panel downward (no step change) to add the news formats below.
  const ENTRY_TITLE = { closed: 'Start from data', open: 'From live data and the archive' };
  const ENTRY_TOGGLE = { closed: 'All formats', open: 'Show less' };
  const ENTRY_MORE_ID = 'rm-fe-more';
  function entryHtml(model, { expanded = false, selected = '' } = {}) {
    const k = expanded ? 'open' : 'closed';
    const opts = { selected, prefix: 'rm-fe', compact: true };
    return `<div class="rm-fmt-entry__head"><span class="rm-fmt-entry__title"><span class="rm-fmt-entry__label" id="rm-fe-title" data-gtitle>${ENTRY_TITLE[k]}</span> <span class="es-badge es-badge--new">New</span></span><button class="rm-link rm-fmt-entry__toggle" type="button" data-gall aria-expanded="${expanded}" aria-controls="${ENTRY_MORE_ID}">${ENTRY_TOGGLE[k]}</button></div>
      <ul class="rm-gtiles rm-gtiles--row" aria-labelledby="rm-fe-title">${model.data.map(t => tileHtml(t, opts)).join('')}</ul>
      <div class="rm-fmt-entry__more" id="${ENTRY_MORE_ID}" role="region" aria-labelledby="rm-fe-news"${expanded ? '' : ' inert'}><div class="rm-fmt-entry__inner">
        <section class="rm-ggroup"><h4 class="rm-ggroup__title" id="rm-fe-news">From the news</h4><p class="rm-ggroup__hint">Start from a trend or your brief.</p><ul class="rm-gtiles rm-gtiles--grid">${model.news.map(t => tileHtml(t, opts)).join('')}</ul></section>
      </div></div>`;
  }

  // ─── Games ───────────────────────────────────────────────────────────────
  // Drama: max |WP swing| (0..1) or null when no digest is cached yet.
  const swingPct = drama => (typeof drama === 'number' && Number.isFinite(drama) ? Math.round(Math.max(0, Math.min(1, drama)) * 100) : null);
  function dramaBadge(drama) {
    const p = swingPct(drama);
    if (p == null) return null;
    if (p >= 40) return { label: `Big swing · ${p}%`, tone: 'hot', pct: p };
    if (p >= 20) return { label: `Swing · ${p}%`, tone: 'warm', pct: p };
    return { label: `Steady · ${p}%`, tone: 'calm', pct: p };
  }
  // Live first, then by drama (high first, unknown last), then newest.
  function sortGames(list) {
    const live = g => (g.status && g.status.state === 'in' ? 0 : 1);
    const d = g => (typeof g.drama === 'number' ? g.drama : -1);
    return [...(list || [])].sort((a, b) => live(a) - live(b) || d(b) - d(a) || String(b.startsAt || '').localeCompare(String(a.startsAt || '')));
  }
  function filterGames(list, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return list || [];
    return (list || []).filter(g => [g.name, g.teams?.home?.name, g.teams?.home?.abbr, g.teams?.away?.name, g.teams?.away?.abbr].some(s => String(s || '').toLowerCase().includes(q)));
  }
  function gameLabel(g) {
    const a = g.teams?.away || {};
    const h = g.teams?.home || {};
    const pre = g.status?.state === 'pre';
    return pre ? `${a.abbr} at ${h.abbr}` : `${a.abbr} ${a.score} at ${h.abbr} ${h.score}`;
  }
  const PERIOD = { nfl: 'Q', cfb: 'Q', mlb: 'Inn ' };
  function statusText(g, { now = Date.now() } = {}) {
    const st = g.status || {};
    if (st.state === 'in') return [st.period ? `${PERIOD[g.sport] || 'P'}${st.period}` : '', st.clock || ''].filter(Boolean).join(' · ') || 'Live';
    if (st.state === 'pre') {
      const t = new Date(g.startsAt || 0);
      return Number.isFinite(t.getTime()) && t.getTime() > 0 ? `Starts ${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Not started';
    }
    const t = new Date(g.startsAt || 0).getTime();
    const h = t ? Math.round((now - t) / 3600e3) : null;
    return `${st.detail || 'Final'}${h != null && h >= 0 && h < 72 ? ` · ${h < 24 ? `${Math.max(1, h)}h ago` : `${Math.round(h / 24)}d ago`}` : ''}`;
  }
  // SVG path for the home WP sparkline (values 0..1, y flipped).
  function sparkPath(values, w = 72, h = 24) {
    const v = (values || []).filter(x => typeof x === 'number' && Number.isFinite(x));
    if (v.length < 2) return '';
    const step = w / (v.length - 1);
    return v.map((x, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(h - Math.max(0, Math.min(1, x)) * h).toFixed(1)}`).join(' ');
  }
  // logo(team, sport) -> { src, a, b } (reel-maker passes the logo library).
  function teamHtml(team, sport, logo, winner) {
    const l = logo ? logo(team, sport) : null;
    const dot = !l || !l.src;
    return `<span class="rm-gteam${winner ? ' is-win' : ''}"><span class="es-team-logo${dot ? ' es-team-logo--dot' : ''}" style="--logo:28px${l && l.a ? `;--a:${esc(l.a)}` : ''}${l && l.b ? `;--b:${esc(l.b)}` : ''}">${dot ? '' : `<img src="${esc(l.src)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('es-team-logo--dot')">`}</span><span class="rm-gteam__abbr">${esc(team.abbr || '')}</span><span class="rm-gteam__score">${team.score != null ? esc(team.score) : ''}</span></span>`;
  }
  function gameRowHtml(g, { selected = '', tab = false, logo = null, now, still = false } = {}) {
    const on = selected === g.id;
    const a = g.teams?.away || {};
    const h = g.teams?.home || {};
    const done = g.status?.state === 'post';
    const badge = dramaBadge(g.drama);
    const spark = sparkPath(g.wpSpark);
    const live = g.status?.state === 'in';
    const label = esc(`${a.name || a.abbr} ${a.score ?? ''} at ${h.name || h.abbr} ${h.score ?? ''}. ${statusText(g, { now })}.${badge ? ` Biggest win-probability swing ${badge.pct}%.` : ''}`);
    const open = still ? `<div class="rm-game is-static" role="group" aria-label="${label}">` : `<li role="none"><button class="rm-game${on ? ' is-on' : ''}" type="button" role="radio" aria-checked="${on}" tabindex="${tab ? 0 : -1}" data-game="${esc(g.id)}" aria-label="${label}">`;
    return `${open}
      <span class="rm-game__teams">${teamHtml(a, g.sport, logo, done && a.score > h.score)}${teamHtml(h, g.sport, logo, done && h.score > a.score)}</span>
      <span class="rm-game__side">
        <span class="rm-game__status${live ? ' is-live' : ''}">${live ? '<span class="rm-live-dot" aria-hidden="true"></span>' : ''}${esc(statusText(g, { now }))}</span>
        ${spark ? `<svg class="rm-game__spark" viewBox="0 0 72 24" width="72" height="24" aria-hidden="true"><path d="M0 12H72" class="rm-spark__mid"/><path d="${spark}" class="rm-spark__line"/></svg>` : ''}
        ${badge ? `<span class="rm-swing is-${badge.tone}">${esc(badge.label)}</span>` : '<span class="rm-swing is-none">Swing not measured yet</span>'}
      </span>${still ? '</div>' : '</button></li>'}`;
  }

  // Key plays a Game Swing pre-checks: scoring plays and the biggest WP
  // swings, at most n, in game order. reel-data.js keyPlays() wins when Agent
  // A's module is on the page.
  function keyPlays(digest, n = 5) {
    const plays = Array.isArray(digest && digest.plays) ? digest.plays : [];
    const score = p => (Math.abs(p.swing || 0) * 2) + (p.scoring ? 0.5 : 0) + ((p.tags || []).includes('lead-change') ? 0.4 : 0) + ((p.tags || []).includes('final') ? 0.3 : 0);
    return [...plays].sort((a, b) => score(b) - score(a) || a.seq - b.seq).slice(0, n).sort((a, b) => a.seq - b.seq).map(p => p.id);
  }
  function playWhen(p, sport) {
    if (p.half) return `${p.half === 'top' ? 'Top' : 'Bot'} ${p.period}`;
    return [`${PERIOD[sport] || 'P'}${p.period}`, p.clock].filter(Boolean).join(' ');
  }
  const TAG_LABEL = { scoring: 'Score', swing: 'Swing', 'lead-change': 'Lead change', 'period-end': 'End of period', final: 'Final' };

  // ─── Players and the archive ────────────────────────────────────────────
  function playerRowHtml(c, { selected = '', tab = false, still = false } = {}) {
    const on = selected === c.athleteId;
    const meta = [SPORT_LABEL[c.sport] || c.sport, c.position, c.years].filter(Boolean).join(' · ');
    const inner = `<span class="rm-player__mono" aria-hidden="true">${esc(String(c.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span><span class="rm-player__body"><span class="rm-player__name">${esc(c.name)}</span><span class="rm-player__meta">${esc(meta)}</span></span>`;
    if (still) return `<div class="rm-player is-static">${inner}</div>`;
    return `<li role="none"><button class="rm-player${on ? ' is-on' : ''}" type="button" role="radio" aria-checked="${on}" tabindex="${tab ? 0 : -1}" data-athlete="${esc(c.athleteId)}">${inner}</button></li>`;
  }
  // An ESPN athlete id typed or pasted (".../player/_/id/2330/tom-brady" or
  // "2330"): ESPN's search drops many retired players, the id never does.
  function parseAthleteId(raw) {
    const text = String(raw || '').trim();
    const url = /espn\.com\//i.test(text) ? text.match(/\/id\/(\d{1,12})(?:[/?#]|$)/i) : null;
    if (url) return url[1];
    return /^\d{1,12}$/.test(text) ? text : '';
  }
  const yearOf = iso => { const m = String(iso || '').match(/^(\d{4})/); return m ? Number(m[1]) : null; };
  // Every source the archive can cite: ES articles (year from the publish
  // date), the career stat rows and ES photos. cited = used by a moment now.
  function archiveSources(archive, athlete, moments) {
    const cites = new Set((moments || []).flatMap(m => m.cite || []));
    const rows = [];
    (archive?.sources || archive?.articles || []).forEach(a => rows.push({ kind: 'article', ref: `src:${a.id}`, id: a.id, year: yearOf(a.date), title: a.title, url: a.url, label: 'ES article', cited: cites.has(`src:${a.id}`) }));
    const seasons = athlete?.stats?.seasons || [];
    const statCites = [...cites].filter(c => c.startsWith('stat:'));
    statCites.forEach(ref => {
      const id = ref.slice(5);
      const row = id === 'totals' ? { id: 'totals', year: null } : seasons.find(s => s.id === id);
      if (row) rows.push({ kind: 'stat', ref, id, year: row.year ?? null, title: id === 'totals' ? 'Career totals' : `${row.year} season stats`, url: athlete?.source?.url || '', label: athlete?.source?.name ? `${athlete.source.name} stats` : 'Stats', cited: true });
    });
    (archive?.photos || []).forEach(p => rows.push({ kind: 'photo', ref: `photo:${p.id}`, id: p.id, year: null, title: p.caption || 'ES photo', url: p.url, label: p.credit ? `ES photo · ${p.credit}` : 'ES photo', cited: false }));
    return rows;
  }
  // The moments a fresh archive reel starts with: the first n candidates,
  // years in order ("5 best moments" keeps the server's ranking order).
  function pickMoments(candidates, angle, n = 5) {
    const list = (candidates || []).filter(c => Array.isArray(c.cite) && c.cite.length && Number.isInteger(c.year)).slice(0, n);
    return /best/i.test(String(angle || '')) ? list : [...list].sort((a, b) => a.year - b.year);
  }
  function coverageText(coverage, dropped = 0) {
    if (!coverage) return '';
    const a = Number(coverage.articles) || 0;
    const p = Number(coverage.photos) || 0;
    const d = Number(dropped) || 0;
    return `${a} ES article${a === 1 ? '' : 's'} · ${p} ES photo${p === 1 ? '' : 's'}${d ? ` · ${d} unsourced moment${d === 1 ? '' : 's'} dropped` : ''}`;
  }

  // ─── Clips (Moment Replay) ──────────────────────────────────────────────
  // An X post link: x.com or twitter.com /<handle>/status/<id>.
  function parseClipLink(raw) {
    const text = String(raw || '').trim();
    if (!text) return { ok: false, error: 'Paste a link to an X post with a video.' };
    const m = text.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:[/?#].*)?$/i);
    if (!m) return { ok: false, error: 'That is not an X post link. It looks like x.com/team/status/123….' };
    return { ok: true, url: `https://x.com/${m[1]}/status/${m[2]}`, handle: m[1], id: m[2] };
  }
  const fmtSec = t => {
    const s = Math.max(0, Number(t) || 0);
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  };
  // The free code pick: one frame in each third of the segment (setup early,
  // the play in the middle, the reaction late). reel-replay.js
  // candidateFrames() refines it when Agent B's module is on the page.
  function codeFrames(segment) {
    const a = Math.max(0, Number(segment && segment.in) || 0);
    const b = Math.max(a + 0.3, Number(segment && segment.out) || a + 6);
    const len = b - a;
    const r = v => Math.round(v * 10) / 10;
    return [{ role: 'setup', t: r(a + len * 0.15) }, { role: 'play', t: r(a + len * 0.5) }, { role: 'reaction', t: r(a + len * 0.85) }];
  }
  // frame-pick response (indices into the sampled frames) -> frames, or null
  // when an index is missing or out of range (then the code pick stands).
  function framesFromPick(pick, times) {
    if (!pick || !Array.isArray(times)) return null;
    const out = [];
    for (const role of ['setup', 'play', 'reaction']) {
      const i = pick[role];
      if (!Number.isInteger(i) || i < 0 || i >= times.length) return null;
      out.push({ role, t: Math.round(times[i] * 10) / 10 });
    }
    return out;
  }
  // Evenly spaced sample times over a segment (for the AI pick).
  function sampleTimes(segment, count = 9) {
    const a = Math.max(0, Number(segment && segment.in) || 0);
    const b = Math.max(a + 0.3, Number(segment && segment.out) || a + 6);
    return Array.from({ length: count }, (_, i) => Math.round((a + (b - a) * ((i + 0.5) / count)) * 100) / 100);
  }
  const ROLE_LABEL = { setup: 'Setup', play: 'The play', reaction: 'Reaction' };
  function clipRowHtml(c, i, { selected = '', tab = false, now = Date.now() } = {}) {
    const on = selected === c.url;
    const age = c.postedAt ? Math.round((now - new Date(c.postedAt).getTime()) / 3600e3) : null;
    const meta = [c.handle ? `@${c.handle}` : '', age != null && age >= 0 ? (age < 24 ? `${Math.max(1, age)}h ago` : `${Math.round(age / 24)}d ago`) : '', c.duration ? `${Math.round(c.duration)} s` : ''].filter(Boolean).join(' · ');
    return `<li role="none"><button class="rm-clip${on ? ' is-on' : ''}" type="button" role="radio" aria-checked="${on}" tabindex="${tab ? 0 : -1}" data-clip="${i}"><span class="rm-clip__thumb">${c.thumb ? `<img src="${esc(c.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span><span class="rm-clip__body"><span class="rm-clip__text">${esc(c.text || c.title || 'Clip')}</span><span class="rm-clip__meta">${esc(meta)}</span></span></button></li>`;
  }

  // ─── Briefs: the facts text the script writer gets ──────────────────────
  // Game Swing: digestFacts over the plays the editor kept (all when none).
  function briefFromGame(digest, keep, TL) {
    if (!digest) return '';
    const ids = new Set(keep && keep.length ? keep : (digest.plays || []).map(p => p.id));
    const d = { ...digest, plays: (digest.plays || []).filter(p => ids.has(p.id)) };
    const facts = TL && TL.digestFacts ? TL.digestFacts(d) : '';
    return String(facts).slice(0, 2400);
  }
  function briefFromArchive(athlete, archive, moments, angle) {
    const name = athlete?.name || '';
    const lines = [`${name}${athlete?.position ? `, ${athlete.position}` : ''}. Angle: ${angle || 'career'}.`];
    (moments || []).forEach(m => lines.push(`${m.year}: ${m.title}. ${m.line || ''}`.trim()));
    (archive?.sources || archive?.articles || []).slice(0, 8).forEach(a => lines.push(`ES, ${yearOf(a.date) || ''}: ${a.title}`));
    return lines.join('\n').slice(0, 2400);
  }
  function briefFromReplay(clip, captions, angle) {
    const lines = [];
    if (clip?.text) lines.push(String(clip.text).slice(0, 280));
    if (clip?.handle) lines.push(`Clip posted by @${clip.handle}.`);
    if (captions) ['setup', 'play', 'reaction'].forEach(r => { if (captions[r]) lines.push(`${ROLE_LABEL[r]}: ${captions[r]}.`); });
    if (angle) lines.push(`Angle: ${angle}`);
    return (lines.join('\n') || 'One moment as three frames: the setup, the play and the reaction.').slice(0, 2400);
  }

  // Format thumbnails are drawn as <img> first (fast, cacheable), then swapped
  // for the same SVG inline so its text uses the page's web fonts (Roboto
  // Condensed): an <img> SVG cannot load web fonts and would fall back to Arial.
  // Each copy gets its own id prefix, and its <style> is scoped to that copy,
  // so nothing leaks into the page or clashes when a tile appears twice.
  const artCache = new Map();
  let artSeq = 0;
  function scopeSvg(text, uid) {
    return text
      .replace(/<style>([^<]*)<\/style>/, (m, css) => `<style>${css.split('}').filter(r => r.trim()).map(r => {
        const [sel, decl] = r.split('{');
        return `${sel.split(',').map(s => `#${uid} ${s.trim()}`).join(',')}{${decl}`;
      }).join('}')}}</style>`)
      .replace(/\bid="([\w-]+)"/g, (m, id) => `id="${uid}-${id}"`)
      .replace(/url\(#([\w-]+)\)/g, (m, id) => `url(#${uid}-${id})`)
      .replace(/href="#([\w-]+)"/g, (m, id) => `href="#${uid}-${id}"`)
      .replace(/^<svg\b/, `<svg id="${uid}" aria-hidden="true" focusable="false"`);
  }
  function inlineArt(root) {
    if (typeof document === 'undefined' || typeof fetch !== 'function') return;
    (root || document).querySelectorAll('.rm-gtile__art img[src$=".svg"], .rm-gtile__art img[src*=".svg?"]').forEach(img => {
      const src = img.getAttribute('src');
      if (!artCache.has(src)) artCache.set(src, fetch(src).then(r => (r.ok ? r.text() : '')).catch(() => ''));
      artCache.get(src).then(text => {
        if (!text || !text.trim().startsWith('<svg') || !img.isConnected) return;
        const box = document.createElement('span');
        box.innerHTML = scopeSvg(text.trim(), `rm-art-${++artSeq}`);
        const svg = box.firstElementChild;
        if (!svg) return;
        svg.setAttribute('class', 'rm-gtile__svg');
        img.replaceWith(svg);
      });
    });
  }
  if (typeof document !== 'undefined' && typeof MutationObserver === 'function') {
    const watch = () => {
      inlineArt(document);
      new MutationObserver(list => { if (list.some(m => m.addedNodes.length)) inlineArt(document); })
        .observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch);
  }

  return {
    inlineArt, scopeSvg,
    ART, SPORT_LABEL, SOURCE_LABEL, REQUIRED_MODES, OPTIONAL_MODES, ROLE_LABEL, TAG_LABEL,
    formatStatus, modeOn, costHint, outputsLabel, galleryModel, tileHtml, galleryHtml, entryHtml,
    SUMMARY, ENTRY_TITLE, ENTRY_TOGGLE, ENTRY_MORE_ID,
    swingPct, dramaBadge, sortGames, filterGames, gameLabel, statusText, sparkPath, gameRowHtml, keyPlays, playWhen,
    playerRowHtml, archiveSources, pickMoments, coverageText, yearOf,
    parseAthleteId, parseClipLink, fmtSec, codeFrames, framesFromPick, sampleTimes, clipRowHtml,
    briefFromGame, briefFromArchive, briefFromReplay, esc,
  };
}));
