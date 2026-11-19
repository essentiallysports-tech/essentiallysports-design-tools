'use strict';
// Generate v5 (gen5-photos): is this photo really of the person (or team /
// league) a design names, are they the main subject, and what kind of shot is
// it? Two layers:
//
//   1. Free text evidence (every run, also in free mode): who the caption,
//      the headline or the file name says is in the photo, in what order, and
//      for which team. A photo whose caption leads with someone else ("Kansas
//      City Chiefs quarterback Patrick Mahomes 15 pats ... Josh Allen"), whose
//      headline is about someone else ("ESPN's Laura Rutledge fires back..."),
//      whose only match is a namesake ("Josh Hines-Allen", "Lamar Jackson 38
//      of the Atlanta Falcons") or that names nobody is never labelled as the
//      person.
//   2. A vision check (production, Claude Sonnet through the Gateway, one call
//      per subject with up to 8 photos, cached per photo for 7 days). The model
//      is never asked to recognise a face: it reads the uniform, the team
//      colours, the number, the setting and the caption, and says how
//      many people are in the frame, who the main subject is, the kind of shot,
//      the focus box and whether a clean cut-out is possible.
//
// decide() combines both into the fields the plan carries for every photo:
//   verified (true only with positive evidence and nothing against it),
//   verifiedBy ('vision' | 'caption' | 'title' | 'file'), main (the person is
//   the main subject), kind (action | portrait | celebration | reaction |
//   offfield | group | crowd | venue | object), focus ({ x, y, w, h } 0-1),
//   cutoutOk, and why (a short reason when it is not verified).

const clock = { now: () => Date.now() };

// ─── Text helpers ────────────────────────────────────────────────────────────
const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&#8217;|&#8216;|’|‘/g, "'").replace(/&#8220;|&#8221;/g, '"').replace(/&#8211;|&#8212;/g, '-').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const norm = value => ` ${clean(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const words = value => norm(value).trim().split(' ').filter(Boolean);

// Words that are never part of a person's name in an agency caption or title.
const STOP = new Set(('a an the and or of in on at to for with from by vs versus during after before against between as is are was were his her their its this that '
  + 'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec '
  + 'monday tuesday wednesday thursday friday saturday sunday today tonight '
  + 'sport sports news bilder tages themen woche des der die das und herren damen kw credits credit image images courtesy imago getty gettyimages photo photos press wire zuma icon smi usa today via source untitled design copy msn '
  + 'nfl nba mlb nhl wnba mls ncaa pga lpga liv atp wta fifa uefa afc nfc espn fox cbs nbc abc tnt mnf snf sideline reporter reporters host anchor broadcaster '
  + 'american football basketball baseball soccer golf tennis hockey formula grand prix race racing motorsports motorsport fussball weltmeisterschaft wm finale spiele olympische '
  + 'super bowl playoff playoffs championship championships open tour cup series draft training camp preseason regular season stadium arena field park center centre club course '
  + 'wild card divisional conference olympic olympics games world final finals round day week game match half quarter inning set lap '
  + 'quarterback running back wide receiver tight end linebacker cornerback safety defensive offensive tackle end guard center kicker punter forward point shooting '
  + 'pitcher catcher outfielder infielder shortstop baseman hitter designated right left fielder goalkeeper striker midfielder defender driver golfer '
  + 'head coach coaches assistant general manager owner president commissioner executive vice chairman ceo gm hc qb wr te rb cb de dt lb edge '
  + 'former star rookie veteran captain singer actor actress rapper winner tournament team teams fans fan crowd media day press conference ceremony award awards trophy '
  + 'east west north south new los las san santa st fort jr sr ii iii iv vs. mr mrs ms dr '
  + 'live breaking report watch exclusive photo gallery side referee umpire official officials editorial use ny sf la kc tb gb lv fia formel dutch british spanish french german italian japanese brazilian mexican canadian australian '
  + 'reveals admits issues says said slams sends shares makes urges names calls explains confirms claims reacts responds fires breaks drops hits gets takes gives wins loses beats leads joins signs returns opens addresses praises blasts rips defends denies insists warns mount '
  + 'alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland '
  + 'massachusetts michigan minnesota mississippi missouri montana nebraska nevada hampshire jersey mexico york carolina dakota ohio oklahoma oregon pennsylvania rhode island '
  + 'tennessee texas utah vermont virginia wisconsin wyoming united states america detroit chicago boston miami atlanta seattle '
  + 'philadelphia pittsburgh cleveland cincinnati baltimore buffalo nashville tampa inglewood arlington foxborough foxboro jacksonville indianapolis minneapolis milwaukee '
  + 'oakland sacramento anaheim brooklyn queens manhattan madrid barcelona munich muenchen bayern deutschland germany england spain france italy canada toronto montreal vancouver').split(' '));
// ALL-CAPS words kept as acronyms (never title-cased into a "name").
const ACRONYM = /^(?:NFL|NBA|MLB|NHL|WNBA|MLS|NCAA|PGA|LPGA|LIV|ATP|WTA|FIFA|UEFA|AFC|NFC|USA|US|UK|USATSI|ESPN|FOX|CBS|NBC|ABC|TNT|MNF|SNF|QB|WR|TE|RB|CB|DE|DT|LB|GM|HC|MVP|TV|AP|II|III|IV|JR|SR|EDGE|GC|FC|CF|SC|ESP|ARG|GBR|NED|NLD|JPN|USA|CAN|MEX|FRA|GER|ITA|SRB|SPA|LA|NY|KC|OKC|GOLF)$/;
const titleWord = w => (w.length >= 2 && w === w.toUpperCase() && /[A-Z]{2}/.test(w) && !ACRONYM.test(w.replace(/[^A-Z]/g, '')) ? w.charAt(0) + w.slice(1).toLowerCase().replace(/([-'][a-z])/g, m => m.toUpperCase()) : w);
const decap = text => clean(text).split(' ').map(titleWord).join(' ');

// Teams the logo library knows, by their full name (and multi-word keys):
// "Buffalo Bills", "Inter Miami CF", "Wyoming Cowboys". Built once.
let TEAM_INDEX = null;
function teamIndex() {
  if (TEAM_INDEX) return TEAM_INDEX;
  TEAM_INDEX = new Map();
  let lib = null;
  try { lib = require('../../logo-library.js'); } catch { lib = null; }
  (lib?.all?.() || []).forEach(e => {
    if (!e || (e.kind !== 'team' && e.kind !== 'badge' && e.kind !== 'league')) return;
    [e.name, ...(e._keys || []), ...(e.aliases || [])].filter(Boolean).forEach(k => {
      const n = norm(k).trim();
      if (n.split(' ').length >= 2 && !TEAM_INDEX.has(n)) TEAM_INDEX.set(n, { id: e.id, name: e.name, short: e.short || e.name, colors: e.colors || [], league: e.league || '', kind: e.kind });
    });
  });
  return TEAM_INDEX;
}
// Every team named in a text, with character positions in the cleaned text.
function teamsIn(text) {
  const t = clean(text);
  const index = teamIndex();
  const out = [];
  const re = /[A-Za-z0-9.'&-]+/g;
  const toks = [];
  let m;
  while ((m = re.exec(t))) toks.push({ w: norm(m[0]).trim(), at: m.index, end: m.index + m[0].length });
  for (let i = 0; i < toks.length; i += 1) {
    for (let len = 4; len >= 2; len -= 1) {
      if (i + len > toks.length) continue;
      const key = toks.slice(i, i + len).map(x => x.w).join(' ');
      const hit = index.get(key);
      if (hit) { out.push({ ...hit, at: toks[i].at, end: toks[i + len - 1].end }); i += len - 1; break; }
    }
  }
  return out;
}
// One id per team, however it is written ("Bills", "Buffalo Bills").
let LOGOS = null;
function teamId(name) {
  const n = norm(name).trim();
  if (!n) return '';
  const hit = teamIndex().get(n);
  if (hit) return hit.id;
  if (LOGOS === null) { try { LOGOS = require('../../logo-library.js'); } catch { LOGOS = false; } }
  const found = LOGOS?.findTeam?.(clean(name));
  return found && [found.name, found.short, found.nickname].filter(Boolean).some(x => norm(x).trim() === n) ? found.id : `name:${n}`;
}
const sameTeam = (a, b) => Boolean(a && b) && teamId(a) === teamId(b);

// Levenshtein distance <= 1 (typos: "Otani" for "Ohtani", "Stever Kerr").
function nearlySame(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}
// Is this name the subject? "Shai Gilgeous Alexander" = "Shai Gilgeous-Alexander",
// "Lionel Messi Argentina" contains first + last, "Josh Hines-Allen" is not "Josh Allen".
function isPerson(candidate, name) {
  const c = words(candidate);
  const s = words(name);
  if (!c.length || s.length < 2) return false;
  if (c.join(' ') === s.join(' ')) return true;
  const first = s[0];
  const last = s[s.length - 1];
  // Surname first, as motorsport and Olympic agencies write it ("VERSTAPPEN Max nld", "JAMES LeBron").
  if (c.length >= 2 && nearlySame(c[0], last) && c[1] === first) return true;
  const fi = c.indexOf(first);
  if (fi < 0) return false;
  // first + last adjacent (or one middle word), allowing a one-letter typo in the last name.
  for (let j = fi + 1; j <= Math.min(c.length - 1, fi + s.length); j += 1) {
    if (nearlySame(c[j], last) && j - fi <= s.length) {
      // A hyphenated surname in the original ("Hines-Allen") is a different name.
      const raw = clean(candidate);
      if (new RegExp(`[A-Za-z]-${last}\\b`, 'i').test(raw)) return false;
      return true;
    }
  }
  return false;
}

// People named in a caption-like text, in order: [{ name, at }].
const NAME_RUN = /[A-Z][a-zA-Z'.]*(?:-[A-Z][a-zA-Z'.]*)*(?:\s+(?:(?:de|van|von|da|di|del|la|le|al)\s+)?[A-Z][a-zA-Z'.]*(?:-[A-Z][a-zA-Z'.]*)*)+/g;
// The dateline an agency caption opens with ("KANSAS CITY, MO - OCTOBER 16:",
// "January 11, 2026: ", "November 3, 2024, Orchard Park, New York, USA: ").
const MONTH = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
function stripDateline(text) {
  const t = clean(text);
  const colon = t.indexOf(':');
  if (colon > 0 && colon < 110) {
    const head = t.slice(0, colon);
    if (MONTH.test(head) || /\b(?:19|20)\d\d\b/.test(head) || /^[A-Z .'-]+,\s*[A-Z .]+\s*[-–]/.test(head)) return t.slice(colon + 1).trim();
  }
  return t;
}
let IMAGERY = null;
const classify = name => {
  if (IMAGERY === null) { try { IMAGERY = require('./_imagery.js'); } catch { IMAGERY = false; } }
  return IMAGERY?._test?.classifyName ? IMAGERY._test.classifyName(name) : 'person';
};
function peopleIn(text, opts = {}) {
  return peopleInRaw(decap(stripDateline(text)), opts);
}
function peopleInRaw(raw, { subject = '' } = {}) {
  // Teams out first, so "Buffalo Bills quarterback Josh Allen" never yields "Buffalo Bills".
  let masked = raw;
  teamsIn(raw).forEach(t => { masked = masked.slice(0, t.at) + '|'.repeat(t.end - t.at) + masked.slice(t.end); });
  const out = [];
  let m;
  NAME_RUN.lastIndex = 0;
  while ((m = NAME_RUN.exec(masked))) {
    let toks = m[0].split(/\s+/);
    const at = m.index;
    const posOf = tok => at + Math.max(0, m[0].indexOf(tok));
    // Trim stop words at both ends ("Head Coach Nick Nurse", "Josh Allen Issues").
    while (toks.length && (STOP.has(words(toks[0])[0] || '') || /\d/.test(toks[0]))) toks = toks.slice(1);
    while (toks.length && (STOP.has(words(toks[toks.length - 1]).slice(-1)[0] || '') || /\d/.test(toks[toks.length - 1]))) toks = toks.slice(0, -1);
    // Split at inner stop words ("Josh Allen Joe Burrow" stays one run: handled below).
    const parts = [];
    let cur = [];
    toks.forEach(tok => {
      const w = words(tok)[0] || '';
      if (STOP.has(w)) { if (cur.length) parts.push(cur); cur = []; } else cur.push(tok);
    });
    if (cur.length) parts.push(cur);
    parts.forEach(part => {
      const name = part.join(' ').replace(/[.,;:]+$/, '').replace(/'s$/i, '');
      if (part.length < 2) return;
      if (part.length <= 3 && !(subject && isPerson(name, subject)) && !['person', 'short'].includes(classify(name))) return;
      // A run with the subject inside ("Stephen Curry Draymond Green"): the subject, then the rest.
      if (subject && part.length >= 4) {
        const n = words(subject).length;
        for (const len of [n, n + 1]) {
          for (let i = 0; i + len <= part.length; i += 1) {
            const chunk = part.slice(i, i + len).join(' ');
            if (isPerson(chunk, subject)) {
              const before = part.slice(0, i);
              const after = part.slice(i + len);
              if (before.length >= 2) out.push({ name: before.slice(-3).join(' '), at: posOf(before[0]) });
              out.push({ name: chunk, at: posOf(part[i]) });
              if (after.length >= 2) out.push({ name: after.slice(0, 3).join(' '), at: posOf(after[0]) });
              return;
            }
          }
        }
      }
      if (part.length > 3) {
        // Four or more name words with no subject inside: two people ("Lamar Jackson Joe Burrow").
        for (let i = 0; i + 1 < part.length; i += 2) out.push({ name: part.slice(i, i + 2).join(' '), at: posOf(part[i]) });
        return;
      }
      out.push({ name, at: posOf(part[0]) });
    });
  }
  return out.filter((p, i) => out.findIndex(q => norm(q.name) === norm(p.name)) === i);
}

// The team a caption ties a person to: "Buffalo Bills quarterback Josh Allen",
// "Josh Allen 17 of the Buffalo Bills", "Terrion Arnold, a Detroit Lions
// cornerback", "Aidan Hutchinson EDGE Detroit Lions", "Lionel Messi (Inter Miami)".
function teamOfIn(text, person) {
  const raw = decap(stripDateline(text));
  const teams = teamsIn(raw);
  if (!teams.length) return '';
  const people = peopleInRaw(raw, { subject: person.name || person });
  const target = people.find(p => isPerson(p.name, person.name || person));
  if (!target) return '';
  const start = target.at;
  const end = target.at + target.name.length;
  // After the name.
  const after = teams.filter(t => t.at >= end).sort((a, b) => a.at - b.at)[0];
  if (after) {
    const gap = raw.slice(end, after.at);
    if (/^\s*\(?#?\d{0,3}\)?\s*,?\s*(?:(?:of|for|from)\s+the\s+|of\s+|\(|,\s*an?\s+|[A-Z]{2,5}\s+)$/.test(gap) || /^\s*\(?#?\d{1,3}\)?\s*,?\s*$/.test(gap)) return after.name;
  }
  // Before the name: only position words in between.
  const before = teams.filter(t => t.end <= start).sort((a, b) => b.end - a.end)[0];
  if (before) {
    const gap = raw.slice(before.end, start);
    if (gap.length <= 40 && /^[\s']*(?:s\s+)?(?:[a-z-]+\s+){0,4}$/.test(gap) && !/\b(?:vs|at|and|against|beat|beats|over)\b/.test(gap)) return before.name;
  }
  return '';
}

// An article headline's lead person ("“We're Not Playing...”: Josh Allen
// Issues...", "ESPN's Laura Rutledge Fires Back", "NFL Week 11 MVP Ladder:
// Patrick Mahomes Re-Enters"): { lead: 'subject' | 'other' | 'none', name, relation }.
const RELATION = /^(?:wife|husband|girlfriend|boyfriend|fianc[eé]e?|son|sons|daughter|daughters|kid|kids|mom|mother|dad|father|brother|sister|family|parents|caddie|caddy|agent|ex|ex-girlfriend|ex-wife|teammate|teammates|coach|trainer|bodyguard|lawyer|house|mansion)$/i;
function headlineLead(title, subject) {
  let t = clean(title);
  t = t.replace(/^\s*["“'][^"”]*["”']\s*[:\-–—]?\s*/, ''); // a leading quote
  t = t.replace(/^\s*["“][^"”]*$/, '');
  const colon = t.indexOf(':');
  if (colon > 0 && colon < 70) {
    const head = t.slice(0, colon);
    const headPeople = peopleIn(head, { subject: subject.name });
    // "Rob Manfred: MLB owners..." keeps the head; "NFL Week 11 MVP Ladder: Patrick Mahomes..." the tail.
    if (!headPeople.length || headPeople[0].at > 3) t = t.slice(colon + 1).trim();
  }
  // Possessive outlets / roles before the name ("ESPN's", "FOX's", "Yankees GM", "Ex-LIV Pro").
  t = t.replace(/^(?:[A-Z]{2,6}'s|[A-Z][a-z]+'s\s+(?:GM|HC|Coach|Owner|Insider|Boss|Star)|Ex-[A-Za-z]+\s+(?:Pro|Star|Coach))\s+/, '');
  const toks = t.split(/\s+/);
  const sub = words(subject.name);
  const head = toks.slice(0, sub.length).join(' ');
  if (isPerson(head.replace(/'s?$/i, ''), subject.name)) {
    const last = toks[sub.length - 1] || '';
    const next = (toks[sub.length] || '').replace(/[^A-Za-z-]/g, '');
    const possessive = /'s?$/i.test(last);
    return { lead: 'subject', name: subject.name, relation: possessive && RELATION.test(next) };
  }
  const first = peopleIn(toks.slice(0, 4).join(' '), { subject: subject.name })[0];
  if (first && first.at <= 2) return { lead: isPerson(first.name, subject.name) ? 'subject' : 'other', name: first.name, relation: false };
  return { lead: 'none', name: '', relation: false };
}

// File names: "Josh-Allen-Bills.jpg" (subject), "Stephen-Curry-Draymond-Green-5"
// (two people), "Untitled-design-647" (nothing).
function fileWordsOf(url) {
  let file = '';
  try { file = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { file = String(url || '').split('/').pop() || ''; }
  return file.replace(/\.(?:jpe?g|png|webp|avif|gif)(?:\.(?:jpe?g|png|webp))?$/i, '').replace(/-\d{2,4}x\d{2,4}$/, '').replace(/-(?:scaled|rotated|e\d{6,})/g, '')
    .replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// An agency caption's first sentence (the photographer credit and the
// background that follow name other people: "... in Jacksonville, FL. Romeo T Guzman/CSM").
function firstSentence(caption) {
  const text = clean(caption).replace(/\((?:photo|credit|image)[^)]*\)/gi, ' ').replace(/\b(?:photo by|credit:|image credit)[\s\S]*$/i, '');
  const re = /[.!?]\s+(?=[A-Z(])/g;
  let m;
  while ((m = re.exec(text))) {
    if (m.index < 40) continue;
    const before = text.slice(Math.max(0, m.index - 4), m.index + 1);
    if (/\b(?:Jr|Sr|St|Mt|Dr|Mr|Ms|Mrs|vs|No|[A-Z])\.$/.test(before) && !/\b[A-Z]{2}\.$/.test(before)) continue;
    return text.slice(0, m.index + 1);
  }
  return text;
}

const IN_FRAME_BEFORE = /(?:\b(?:agent|and|vs|versus|v|with|by|from|to|alongside|beside|next to|greets?|pats?|hugs?|embraces?|congratulates?|high[- ]fives?|shakes hands with|talks (?:to|with)|speaks (?:to|with)|chats with|celebrates with|guarded by|tackled by|tacked by|sacked by|hit by|defends?|guards?|reporter|host|coach|teammate|quarterback|receiver|back|end|tackle|linebacker|cornerback|safety|guard|forward|center|pitcher|catcher|outfielder|fielder|wife|husband|girlfriend|fianc\w*|son|daughter|caddie|referee|umpire|official)|[,&(]|\b(?:L|R)\))\s*/gi;
function inFrame(text, name) {
  const i = text.indexOf(name);
  if (i < 0) return false;
  const after = text.slice(i + name.length, i + name.length + 14);
  if (/^\s*\(?#?\d{1,3}\b/.test(after) || /^\s*,?\s*\(?(?:left|right|center|centre|l|r)\)?\b/i.test(after)) return true;
  // A linking word, then only capitalised words (a role or a team) up to the name.
  const window = text.slice(Math.max(0, i - 48), i);
  return [...window.matchAll(IN_FRAME_BEFORE)].some(m => /^(?:[A-Z][a-zA-Z.'-]*\s+){0,4}$/.test(window.slice(m.index + m[0].length)));
}

const BYSTANDER = /\b(?:reporter|host|anchor|broadcaster|interview(?:ed|s)? (?:by|with)|wife|husband|girlfriend|boyfriend|fianc\w*|family|mother|father|son|daughter|kids|singer|actress|actor|rapper|celebrity|fans?)\b/i;

// ─── Layer 1: text evidence ─────────────────────────────────────────────────
// photo: { title, caption, sourceUrl, source }. subject: { name, kind, team?, teams?, opponents?, others? }.
// -> { named: 'caption'|'title'|'file'|'', lead: 'subject'|'other'|'none', others: [names], team: '', relation, people }
function evidence(photo, subject) {
  const caption = clean(photo.caption);
  const title = clean(photo.title);
  const isArticle = photo.source === 'es-article';
  const out = { named: '', lead: 'none', others: [], team: '', relation: false, leadName: '', where: '' };
  const fromPeople = (list, where) => {
    if (!list.length) return false;
    const hit = list.findIndex(p => isPerson(p.name, subject.name));
    out.where = where;
    out.leadName = list[0].name;
    if (hit < 0) { out.lead = 'other'; out.others = list.map(p => p.name); return true; }
    out.lead = hit === 0 ? 'subject' : 'other';
    out.named = hit === 0 ? where : '';
    out.others = list.filter((p, i) => i !== hit).map(p => p.name);
    return true;
  };
  // A real caption (agency / media): who it names, in order.
  const lead = firstSentence(caption);
  const capPeople = lead && !/^(?:credits?|image|source|via|photo)\b/i.test(lead) ? peopleIn(lead, { subject: subject.name }) : [];
  if (capPeople.length) {
    fromPeople(capPeople, 'caption');
    out.team = teamOfIn(lead, subject);
    // Only people the caption puts in the frame count ("... is interviewed by MNF
    // sideline reporter Laura Rutledge", "Calais Campbell 93", "Kristaps Porzingis 7 and ...");
    // a venue ("Empower Field at Mile High") or a name in passing does not.
    if (out.lead === 'subject') out.others = out.others.filter(name => inFrame(decap(stripDateline(lead)), name));
    // Someone who is not a player shares the frame (a sideline reporter, a host, family).
    if (out.lead === 'subject' && out.others.length && BYSTANDER.test(lead)) out.bystander = true;
  } else if (isArticle && title) {
    // An ES article's lead image is of the headline's lead person, when there is one.
    const h = headlineLead(title, subject);
    out.where = 'title';
    out.leadName = h.name;
    out.lead = h.lead;
    out.relation = h.relation;
    if (h.lead === 'subject' && !h.relation) out.named = 'title';
    const bare = title.replace(/["“][^"”]*["”]/g, ' ');
    const all = peopleIn(bare, { subject: subject.name }).filter(p => !isPerson(p.name, subject.name));
    if (h.lead !== 'subject') out.others = all.map(p => p.name);
    else {
      // A second person the headline is also about ("... Gave Jazz Chisholm Jr. Stern
      // Warnings", "... Sends Message to Yaxel Lendeborg", "Joe Burrow, Jaxon Smith-Njigba"):
      // the lead image may be of them.
      const plain = clean(bare);
      const found = [];
      const take = name => {
        const n = clean(name).replace(/'s?$/i, '').replace(/\s+(?:Jr|Sr|II|III)\.?$/, '');
        const ws = words(n);
        if (ws.length < 2 || ws.some(w => STOP.has(w)) || isPerson(n, subject.name) || teamsIn(n).length || !['person', 'short'].includes(classify(n))) return;
        if (!found.some(f => norm(f) === norm(n))) found.push(n);
      };
      const NAME2 = "([A-Z][a-zA-Z'.-]+\\s+[A-Z][a-zA-Z'.-]+(?:\\s+(?:Jr|Sr|II|III)\\.?)?)";
      const ci = list => list.map(w => w.replace(/(^|\s)([a-z])/g, (x, sp, c) => `${sp}[${c}${c.toUpperCase()}]`)).join('|');
      const LINK = ci(['to', 'on', 'by', 'about', 'for', 'against', 'after', 'around', 'amid', 'as', 'behind', 'than', 'of', 'from', 'at', 'under', 'like', 'toward', 'towards', 'with', 'over', 'and', 'vs', 'gave', 'gives', 'tells', 'slams', 'praises', 'joins', 'rips', 'blasts', 'calls out', 'thanks', 'replaces', 'beats', 'trades for', 'meets', 'faces', 'hugs', 'defends']);
      for (const m of plain.matchAll(new RegExp(`(?:,|&|\\b(?:${LINK}))\\s+${NAME2}`, 'g'))) take(m[1]);
      for (const m of plain.matchAll(new RegExp(`${NAME2}'(?:s\\b|(?=\\s))`, 'g'))) take(m[1]);
      out.others = found;
    }
  } else {
    // A short media title ("Shohei Ohtani", "Lamar Jackson Joe Burrow", "Micah Parsons and Jalen Hurts"), then the file name.
    const tPeople = title && title.split(' ').length <= 9 ? peopleIn(title, { subject: subject.name }) : [];
    if (!fromPeople(tPeople, 'title')) fromPeople(peopleIn(fileWordsOf(photo.sourceUrl).replace(/\b([a-z])/g, c => c.toUpperCase()), { subject: subject.name }), 'file');
    if (title && !out.team) out.team = teamOfIn(title, subject);
  }
  // "... to introduce Shohei Ohtani not pictured": the caption says he is not in it.
  const last = words(subject.name).slice(-1)[0];
  if (last && new RegExp(`${last}\\b[^.]{0,30}\\bnot pictured\\b`, 'i').test(caption)) { out.lead = 'other'; out.named = ''; out.leadName = out.others[0] || 'someone else'; }
  // "Josh Allen and his wife", "with", "interviewed by": someone else shares the frame.
  if (out.lead === 'subject' && !out.others.length && /\b(?:and (?:his|her) (?:wife|husband|family|son|daughter|kids|girlfriend|fianc\w*)|interviewed by|with (?:his|her) (?:wife|husband|family|son|daughter|kids))\b/i.test(caption)) out.others.push('(someone)');
  return out;
}

// The team a person plays for, by vote over every caption that ties them to
// one, among the brief's teams first: { team, votes }.
function consensusTeam(photos, subject) {
  const votes = new Map();
  photos.forEach(photo => {
    const ev = photo._ev || evidence(photo, subject);
    if (ev.lead === 'subject' && ev.team) votes.set(ev.team, (votes.get(ev.team) || 0) + 1);
  });
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const briefTeams = (subject.teams || []).filter(Boolean);
  const inBrief = ranked.find(([team]) => briefTeams.some(b => sameTeam(b, team)));
  if (inBrief) return { team: inBrief[0], votes: inBrief[1], fromBrief: true };
  return ranked[0] ? { team: ranked[0][0], votes: ranked[0][1], fromBrief: false } : { team: '', votes: 0, fromBrief: false };
}

// Team / league subjects: the photo must show a person of that team (caption
// ties them to it) or name the league / its event ("LIV Golf Indianapolis").
function teamEvidence(photo, subject) {
  const caption = clean(photo.caption);
  const title = clean(photo.title);
  const out = { named: '', lead: 'none', others: [], team: '', where: '', leadName: '' };
  if (photo.source === 'es-article') { out.why = 'an article image (not checked against the team)'; return out; }
  const text = caption && !/^(?:credits?|image|source|via|photo)\b/i.test(caption) ? caption : title;
  const names = [subject.name, subject.full, subject.short].filter(Boolean);
  const mentionsSubject = names.some(n => norm(`${title} ${text}`).includes(norm(n)));
  const people = peopleIn(text);
  if (!people.length) {
    if (mentionsSubject) { out.named = 'caption'; out.lead = 'none'; out.where = 'caption'; }
    else out.why = 'does not name the team';
    return out;
  }
  out.where = 'caption';
  out.leadName = people[0].name;
  const leadTeam = teamOfIn(text, { name: people[0].name });
  out.team = leadTeam;
  if (subject.kind === 'league' || subject.kind === 'event') {
    if (mentionsSubject) { out.named = 'caption'; out.lead = 'subject'; } else out.why = `${people[0].name}: not tied to ${subject.name}`;
    return out;
  }
  if (leadTeam && names.some(n => sameTeam(n, leadTeam))) { out.named = 'caption'; out.lead = 'subject'; return out; }
  out.lead = 'other';
  out.why = leadTeam ? `${people[0].name} plays for the ${leadTeam}` : `${people[0].name} is not tied to the ${subject.name}`;
  return out;
}

// ─── Layer 2: vision (production) ───────────────────────────────────────────
// Smaller images for the check (enough to read a number and a uniform): fewer tokens.
function visionUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'image-cdn.essentiallysports.com') { parsed.searchParams.set('width', '1024'); return parsed.toString(); }
    return url;
  } catch { return url; }
}
const colourWords = colors => (colors || []).slice(0, 2).join(' and ');
function verifyPrompt(subject, photos) {
  const person = subject.kind === 'person';
  const lines = [];
  if (person) {
    lines.push(`Check sports photos for a design about ${subject.name}.`);
    if (subject.team) lines.push(`${subject.name} plays for the ${subject.team}${subject.teamColors?.length ? ` (team colours ${colourWords(subject.teamColors)})` : ''}${subject.number ? `, jersey number ${subject.number}` : ''}.`);
    if (subject.opponents?.length) lines.push(`Opponents in this story: ${subject.opponents.join(', ')}. A player in an opponent's uniform is NOT ${subject.name}.`);
    if (subject.others?.length) lines.push(`Other people in this story (not ${subject.name}): ${subject.others.join(', ')}.`);
    lines.push('Do not identify anyone from their face. Decide from evidence you can see or read: the uniform and team colours, the jersey number, name bars, the setting, and the caption given with each photo. If the evidence does not settle it, answer "unsure".');
  } else {
    lines.push(`Check sports photos for a design about the ${subject.full || subject.name} (${subject.kind}).`);
    if (subject.teamColors?.length) lines.push(`Team colours: ${colourWords(subject.teamColors)}.`);
    lines.push('Do not identify anyone from their face. Use the uniform, colours, branding, setting and caption.');
  }
  lines.push('For EACH photo return:',
    person ? `"match": "yes" | "no" | "unsure" (is the MAIN subject ${subject.name}?), "evidence": a few words (e.g. "Bills #17, caption"),`
      : `"match": "yes" | "no" | "unsure" (does the main subject belong to the ${subject.name}: their uniform or branding?), "evidence": a few words,`,
    '"people": how many people are clearly visible, "main": true if one person clearly dominates the frame,',
    '"role": player | coach | official | reporter | fan | family | executive | other (of the main subject),',
    '"kind": action | portrait | celebration | reaction | offfield | group | crowd | venue | object,',
    '"box": [x, y, w, h] the main subject (0-1 from the top-left), "cutout": true if the main subject is alone with head and upper body in frame,',
    '"quality": 1-5 (5 = sharp, well lit; 1 = blurry, dark, tiny), "graphic": true for logos, collages, edited graphics or screenshots.',
    'Reply with JSON only: {"photos":[{"n":1,"match":"yes","evidence":"Bills #17, caption","people":1,"main":true,"role":"player","kind":"action","box":[0.3,0.1,0.4,0.8],"cutout":true,"quality":4,"graphic":false}]}');
  return lines.join(' ');
}
const VERDICTS = new Map();
const VERDICT_TTL_MS = 7 * 24 * 3600e3;
const VERDICT_MAX = 5000;
const verdictKey = (subject, stem) => `${norm(subject.name).trim()}|${norm(subject.team || '').trim()}|${stem}`;
const unit = v => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : null);
function parseRows(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return [];
  try { const rows = JSON.parse(match[0])?.photos; return Array.isArray(rows) ? rows : []; } catch { return []; }
}
function normalizeRow(row) {
  const box = Array.isArray(row.box) && row.box.length === 4 ? row.box.map(unit) : null;
  return {
    match: ['yes', 'no', 'unsure'].includes(String(row.match).toLowerCase()) ? String(row.match).toLowerCase() : 'unsure',
    evidence: clean(row.evidence).slice(0, 80),
    people: Math.max(0, Math.min(30, Number(row.people) || 0)),
    main: row.main === true,
    role: String(row.role || '').toLowerCase().slice(0, 20),
    kind: String(row.kind || '').toLowerCase().slice(0, 20),
    focus: box && box.every(v => v != null) ? { x: box[0], y: box[1], w: box[2], h: box[3] } : null,
    cutout: row.cutout === true,
    quality: Math.max(1, Math.min(5, Number(row.quality) || 3)),
    graphic: row.graphic === true,
  };
}
// One call for a subject's photos. deps.gateway: _ai-gateway.js; deps.model: a tier.
// Returns { verdicts: Map(stem -> verdict), cost, called, cached }.
const VISION_TIER = () => process.env.GENERATE_PHOTO_VERIFY_TIER || 'best';
async function verifyWithVision(subject, photos, { gateway, track = {}, stemOf = p => p.sourceUrl, max = 8, timeoutMs = 16000 } = {}) {
  const verdicts = new Map();
  const unseen = [];
  photos.forEach(photo => {
    const hit = VERDICTS.get(verdictKey(subject, stemOf(photo)));
    if (hit && clock.now() - hit.at < VERDICT_TTL_MS) verdicts.set(stemOf(photo), hit.value);
    else unseen.push(photo);
  });
  if (!unseen.length || !gateway?.aiText) return { verdicts, cost: 0, called: false, cached: verdicts.size };
  const shown = unseen.slice(0, max);
  const content = [{ type: 'text', text: verifyPrompt(subject, shown) }];
  shown.forEach((photo, i) => {
    const caption = clean(photo.caption) || clean(photo.title);
    content.push({ type: 'text', text: `Photo ${i + 1}${caption ? ` (caption: ${caption.slice(0, 220)})` : ''}:` }, { type: 'image', source: { type: 'url', url: visionUrl(photo.sourceUrl) } });
  });
  try {
    const { text, cost } = await gateway.aiText({ tier: VISION_TIER(), messages: [{ role: 'user', content }], effort: 'low', maxTokens: 1600, timeoutMs, track: { ...track, feature: 'generate-photo-pick', task: 'gen-photo-verify' } });
    parseRows(text).forEach(row => {
      const photo = shown[Number(row.n) - 1];
      if (!photo) return;
      const value = normalizeRow(row);
      verdicts.set(stemOf(photo), value);
      if (VERDICTS.size > VERDICT_MAX) VERDICTS.delete(VERDICTS.keys().next().value);
      VERDICTS.set(verdictKey(subject, stemOf(photo)), { at: clock.now(), value });
    });
    return { verdicts, cost: Number(cost) || 0, called: true, cached: photos.length - unseen.length };
  } catch {
    return { verdicts, cost: 0, called: false, cached: photos.length - unseen.length };
  }
}

// ─── Decision ───────────────────────────────────────────────────────────────
const OFF_FIELD = /\b(?:wife|husband|girlfriend|boyfriend|fianc[eé]e?|wedding|engaged|engagement|red carpet|gala|premiere|hollywood|met gala|fashion|vacation|baby|daughter|son|family|kids|mom|mother|dad|father|house|mansion|podcast|commercial|empire state|actress|actor|singer|rapper|celebrity|courtroom|court hearing|circuit court|sets bond|bond hearing|arrest\w*|mugshot|trial|sentenc\w*|lawsuit|charged with|espys|awards show|attends the)\b/i;
// ev: evidence(); v: a vision verdict or null; ctx: { team (consensus), briefTeams }.
// -> { verified, verifiedBy, main, kind, focus, cutoutOk, drop, why }
function decide(photo, subject, ev, v, ctx = {}) {
  const person = subject.kind === 'person';
  const res = { verified: false, verifiedBy: '', main: false, kind: '', focus: null, cutoutOk: false, drop: '', why: '' };
  const text = `${photo.title || ''} ${photo.caption || ''}`;
  if (person) {
    // Text that says it is someone else wins over everything.
    if (ev.lead === 'other' && ev.where === 'caption') { res.drop = `the caption is about ${ev.leadName || 'someone else'}`; return res; }
    if (ev.lead === 'other') { res.drop = `the ${ev.where === 'title' ? 'headline' : ev.where || 'title'} is about ${ev.leadName || 'someone else'}`; return res; }
    if (ev.relation) { res.drop = `a photo for a story about ${subject.name}'s family or team`; return res; }
    if (ev.bystander && !(v && v.match === 'yes' && v.main)) { res.drop = 'a reporter, host or family member shares the frame'; return res; }
    // An article's lead image when the headline is also about someone else
    // ("Micah Parsons Stunned by Shedeur Sanders' Postgame Act"): it is often of them.
    if (photo.source === 'es-article' && ev.where === 'title' && ev.others.length && !(v && v.match === 'yes')) { res.drop = `the headline is also about ${ev.others[0]}`; return res; }
    // A media item titled with two names and no caption ("Micah Parsons and Jalen Hurts") is
    // usually a collage, and not always of the people it names.
    if (photo.source !== 'es-article' && ['title', 'file'].includes(ev.where) && ev.others.length && !(v && v.match === 'yes')) { res.drop = `titled with ${ev.others[0]} too (a pair or collage)`; return res; }
    // A namesake on another team ("Lamar Jackson 38 of the Atlanta Falcons"), or an old team.
    if (ev.team && ctx.team && !sameTeam(ev.team, ctx.team)) {
      if ((ctx.opponents || []).some(o => sameTeam(o, ev.team))) { res.drop = `in an opponent's uniform (${ev.team})`; return res; }
      if (!(ctx.briefTeams || []).some(b => sameTeam(b, ev.team))) res.otherTeam = ev.team;
    }
  } else if (ev.lead === 'other' || (!ev.named && !v)) {
    res.drop = ev.why || 'not tied to the team';
    return res;
  } else if (OFF_FIELD.test(text) || /\b(?:reporter|host|anchor|broadcaster|interview(?:ed|s)? (?:by|with))\b/i.test(firstSentence(photo.caption))) {
    res.drop = 'off the field, or a reporter / family member in the frame';
    return res;
  }
  if (v) {
    if (v.graphic) { res.drop = 'a graphic or collage'; return res; }
    if (v.match === 'no') { res.drop = `not ${subject.name} (${v.evidence || 'vision'})`; return res; }
    if (person && ['reporter', 'fan', 'family', 'official'].includes(v.role) && v.match !== 'yes') { res.drop = `the main subject is a ${v.role}`; return res; }
    res.kind = v.kind || '';
    res.focus = v.focus;
    res.main = v.main && v.people <= 3;
    res.verified = v.match === 'yes' || (v.match === 'unsure' && Boolean(ev.named) && ev.lead === 'subject' && !ev.others.length);
    res.verifiedBy = v.match === 'yes' ? 'vision' : res.verified ? ev.named : '';
    res.cutoutOk = person && res.verified && v.cutout && res.main && v.quality >= 3;
    if (v.quality <= 1) res.drop = 'blurry or murky';
    if (!res.verified && !res.drop) res.why = v.evidence || 'not confirmed';
  } else {
    res.verified = Boolean(ev.named) && (ev.lead === 'subject' || !person) && !res.otherTeam;
    res.verifiedBy = res.verified ? ev.named : '';
    res.main = res.verified && !ev.others.length;
    if (!res.verified) res.why = res.otherTeam ? `with another team (${res.otherTeam})` : person ? 'nothing says it is them' : 'not tied to the team';
  }
  if (person && OFF_FIELD.test(text) && !['action', 'celebration'].includes(res.kind)) res.kind = 'offfield';
  if (person && res.main === false && res.verified && ev.others.length && !res.kind) res.kind = 'group';
  return res;
}

module.exports = {
  evidence, teamEvidence, consensusTeam, decide, verifyWithVision, verifyPrompt, visionUrl,
  peopleIn, teamOfIn, teamsIn, headlineLead, isPerson, sameTeam, decap,
  VERDICTS, OFF_FIELD,
  _test: { clock, norm, nearlySame, normalizeRow, parseRows, fileWordsOf, teamIndex },
};
