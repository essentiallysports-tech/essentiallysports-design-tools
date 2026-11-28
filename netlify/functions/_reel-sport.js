'use strict';
// Reels v4: which sport (and team) a script is about, by code ($0).
//
// Clip search only runs for a clip sport (NFL, college football, MLB): a
// plan with no sport got no clips at all (2026-11-28, "all static"). The
// brief reader finds a sport only through a full team or city name, so a
// script about "George Kittle" and "the 49ers", or "touchdowns" and a
// "tight end", came back with sport '' and every scene went to a photo.
//
//   inferSport(text)            -> { sport: 'nfl'|'cfb'|'mlb'|'', team: <video-ads team>|null, why }
//   teamIn(text, sport)         -> the first team named in the text (full name, then nickname)
//
// Teams: video-ads-teams.js (full names and nicknames, "49ers" included).
// Words: plain sport vocabulary. A nickname two sports share (Giants,
// Cardinals) counts only when the words pick the sport. College teams are
// state / school names, so they count only with college words.
const TEAMS = require('../../video-ads-teams.js');

const CLIP_SPORTS = ['nfl', 'cfb', 'mlb'];
const WORDS = {
  nfl: /\b(nfl|super bowl|touchdowns?|tds?|quarterbacks?|qbs?|tight ends?|wide receivers?|receivers?|running backs?|linebackers?|cornerbacks?|pass rush(?:er)?|edge rushers?|field goals?|sacks?|sacked|interceptions?|picks? six|(?:fourth|4th|third|3rd) (?:and|down)|end zone|red zone|first downs?|rushing yards|receiving yards|passing yards|pro bowl|afc|nfc|kickers?|punts?|offensive line|defensive coordinator|offensive coordinator|playoff berth)\b/gi,
  cfb: /\b(college football|heisman|cfp|college football playoff|sec|big ten|big 12|acc|bowl game|ncaa|transfer portal|freshman|sophomore|redshirt|national championship)\b/gi,
  mlb: /\b(mlb|home runs?|homers?|homered|innings?|pitchers?|pitched|strikeouts?|struck out|rbis?|batting|world series|bullpen|shortstop|outfielders?|grand slam|no-hitter|cy young|al mvp|nl mvp|spring training|starting rotation|walk-off|doubleheader)\b/gi,
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (re, text) => (String(text).match(new RegExp(re.source, 'gi')) || []).length;

// Every team the text names: full names first (so "Kansas City Chiefs" never
// reads as Kansas), then nicknames.
function teamsNamed(text) {
  let rest = ` ${String(text || '')} `;
  const hits = [];
  const full = [...TEAMS.TEAMS].sort((a, b) => b.name.length - a.name.length);
  full.forEach(t => {
    const re = new RegExp(`\\b${esc(t.name)}\\b`, 'i');
    if (re.test(rest)) { hits.push({ team: t, how: 'name' }); rest = rest.replace(new RegExp(re.source, 'gi'), ' '); }
  });
  const shorts = [...TEAMS.TEAMS].sort((a, b) => b.short.length - a.short.length);
  shorts.forEach(t => {
    // Nicknames are matched case-sensitively as written ("Jets", "49ers", "Red Sox").
    const re = new RegExp(`(^|[^A-Za-z0-9])${esc(t.short)}(?:['’]s?)?(?=$|[^A-Za-z0-9])`);
    if (re.test(rest) && !hits.some(h => h.team === t)) hits.push({ team: t, how: 'short' });
  });
  return hits;
}

function inferSport(text = '') {
  const s = String(text || '');
  if (!s.trim()) return { sport: '', team: null, why: 'empty' };
  const score = { nfl: 0, cfb: 0, mlb: 0 };
  CLIP_SPORTS.forEach(sp => { score[sp] += count(WORDS[sp], s); });
  const named = teamsNamed(s);
  // Shared nicknames (Giants, Cardinals, Rangers in two sports): only the words decide.
  const shortCount = {};
  named.forEach(h => { if (h.how === 'short') shortCount[h.team.short] = (shortCount[h.team.short] || 0) + 1; });
  named.forEach(h => {
    const sp = h.team.sport;
    if (!CLIP_SPORTS.includes(sp)) return;
    if (h.how === 'short' && shortCount[h.team.short] > 1) return;
    if (sp === 'cfb' && h.how === 'short') { if (score.cfb > 0) score.cfb += 1; return; }
    score[sp] += h.how === 'name' ? 3 : 2;
  });
  const ranked = CLIP_SPORTS.map(sp => [sp, score[sp]]).sort((a, b) => b[1] - a[1]);
  if (!ranked[0][1] || ranked[0][1] === ranked[1][1]) return { sport: '', team: null, why: ranked[0][1] ? 'tie' : 'no-signal' };
  const sport = ranked[0][0];
  const team = named.find(h => h.team.sport === sport && (h.how === 'name' || sport !== 'cfb' || score.cfb > 1)) || null;
  return { sport, team: team ? team.team : null, why: `words ${score[sport]}` };
}

// The first team of `sport` the text names (full name, then nickname).
function teamIn(text = '', sport = '') {
  const hit = teamsNamed(text).find(h => !sport || h.team.sport === sport);
  return hit ? hit.team : null;
}

module.exports = { inferSport, teamIn, teamsNamed, CLIP_SPORTS, WORDS };
