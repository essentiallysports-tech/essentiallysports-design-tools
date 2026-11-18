'use strict';
// Generate imagery (v3): every design gets relevant, varied, sharp ES photos,
// cut-outs of the hero subject, headshots for grids and team / league logos.
//
//   subjectsFor(read, deps)        who the photos are of: people (cleaned, short
//                                  and ALL-CAPS names resolved through ES tags),
//                                  teams, leagues / events. Places, tours and
//                                  verbs are never searched as people.
//   gatherPhotos(subject, deps)    ES agency pool + ES article lead images + ES
//                                  media library, ES hosts only, de-duplicated
//                                  (sizes, crops, agency ids, bursts).
//   probeSizes(photos, deps)       real pixel size from the first bytes of the
//                                  file (no decoder), and the full-size original
//                                  when a WordPress size suffix was picked.
//   heuristics(photo, subject)     free signals: subject named in the caption /
//                                  title / file name, other people, graphics,
//                                  kind (action, portrait...), recency.
//   visionVerdicts(...)            one cheap vision call (Haiku) per person, only
//                                  for photos not seen before (cached 24 h per
//                                  person + photo): is it them, alone, face
//                                  visible, sharp and well lit, cut-out-able,
//                                  where the subject is (focal point).
//   scorePhoto(...)                0-1 quality score from all of the above.
//   prepareImagery(read, ctx)      the composer's input.photos / cutouts /
//                                  headshots / logos (contract shape), plus the
//                                  per-subject lists the art director picks from
//                                  and the cut-out plan the browser fulfils.
//
// Cut-outs: the server has no image decoder, and a generative model's redraw of
// a real athlete must never be shown, so the pixel work happens in the browser
// (frameup-assets.js prepareCutouts). The finished PNG is stored once under a
// deterministic name (cutoutPath(sourceUrl)); every later run, on any server,
// finds it with a HEAD request and gets the cut-out at $0.
const crypto = require('crypto');

const clock = { now: () => Date.now() };
const ES_WP_API = 'https://www.essentiallysports.com/wp-json/wp/v2';
const WP_HEADERS = { 'User-Agent': 'ES-Designer/1.0 (+https://www.essentiallysports.com/)', Accept: 'application/json' };
const proxied = url => `/api/es-image-search?image=${encodeURIComponent(url)}`;

const PHOTO_RIGHTS = {
  'es-agency': { source: 'ES image pool (agency, via ES MCP)', licence: 'ES agency licence (editorial use on ES channels)', aiGenerated: false },
  'es-article': { source: 'ES article lead image', licence: 'As used on essentiallysports.com (editorial)', aiGenerated: false },
  'es-media': { source: 'ES WordPress media library', licence: 'As used on essentiallysports.com (editorial)', aiGenerated: false },
};

const LIMITS = {
  heroes: 4, // subjects searched in full (3 sources, vision ranking)
  extras: 9, // extra people searched lightly for headshot grids
  perSubject: 8, // ranked photos kept per subject
  visionPerRun: 4, // vision calls per run at most
  visionPhotos: 8, // photos per vision call
  cutoutsPerRun: 3, // cut-outs the browser makes per run at most
};

// ─── Small helpers ─────────────────────────────────────────────────────────
const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&#8217;|&#8216;|’|‘/g, "'").replace(/&#8211;|&#8212;/g, '-').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const norm = value => ` ${clean(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const escapeRe = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const titleCase = text => String(text).toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

function fileName(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return String(url || '').split('/').pop() || ''; }
}
// Words in a file name ("Bryson-DeChambeau-LIV-Golf-1536x1024.jpg" -> "bryson dechambeau liv golf").
function fileWords(url) {
  return fileName(url).replace(/\.(?:jpe?g|png|webp|avif|gif)$/i, '').replace(/-\d{2,4}x\d{2,4}$/, '').replace(/-(?:scaled|rotated|e\d{6,})/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// One key per real image: the same file at another size / crop, and the same
// agency frame on another host (USATSI_123, imago123...).
function photoStem(url) {
  const file = fileName(url).toLowerCase();
  const agency = file.match(/(usatsi|imago|imagn|reuters|getty|afp|ap)[_-]?(\d{6,})/);
  if (agency) return `${agency[1] === 'imagn' ? 'usatsi' : agency[1]}-${agency[2]}`;
  return file.replace(/\.(?:jpe?g|png|webp|avif|gif)(?:\.(?:jpe?g|png|webp))?$/, '').replace(/-(\d{2,4})x(\d{2,4})$/, '').replace(/-(scaled|rotated|e\d{6,})/g, '').replace(/-\d+$/, '');
}
const captionKey = photo => `${String(photo.caption || '').toLowerCase().replace(/[^a-z ]/g, '').trim().slice(0, 80)}|${String(photo.credit || '').toLowerCase().trim()}`;

// Size from a WordPress size suffix (-1079x720).
function sizeFromUrl(url) {
  const m = fileName(url).match(/-(\d{3,4})x(\d{3,4})\.(?:jpe?g|png|webp)$/i);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}
// The original upload behind a WordPress size (drop -1079x720).
function originalOf(url) {
  return /-\d{3,4}x\d{3,4}\.(?:jpe?g|png|webp)$/i.test(url) ? url.replace(/-\d{3,4}x\d{3,4}(\.(?:jpe?g|png|webp))$/i, '$1') : '';
}

// ─── 1. Subjects ───────────────────────────────────────────────────────────
// Never a person: places, competitions, generic words. Tours / leagues /
// events become event subjects (venue and crowd imagery, never cut out).
const PLACES = new Set(('europe asia africa america americas australia oceania antarctica usa us uk england scotland wales ireland france spain italy germany portugal netherlands belgium '
  + 'japan china india korea mexico canada brazil argentina saudi arabia qatar dubai abu dhabi texas florida california ohio michigan georgia carolina new york boston chicago miami '
  + 'los angeles las vegas london paris madrid rome tokyo melbourne sydney augusta pebble beach st andrews wimbledon monaco silverstone').split(' '));
const PLACE_PHRASES = ['new york', 'los angeles', 'las vegas', 'saudi arabia', 'abu dhabi', 'north carolina', 'south carolina', 'st andrews', 'pebble beach', 'new jersey', 'new orleans', 'san francisco', 'kansas city', 'tampa bay', 'green bay', 'great britain', 'united states'];
const EVENT_WORD = /\b(?:tour|league|cup|open|championship|championships|series|grand prix|gp|masters|classic|invitational|bowl|playoffs?|draft|combine|olympics?|games|slam|conference|division|week|season|final|finals|derby|showdown|madness|all-star|award|awards|trophy|association|federation|club|fc|cf|sc|afc|ac|united|city|inter|real|atletico|athletic|sporting|rovers|wanderers|hotspur|galaxy|garros)\b/i;
// Venues: imagery of the place (crowd, aerial, field), never a cut-out.
const VENUE_WORD = /\b(?:stadium|arena|field|park|ballpark|center|centre|coliseum|colosseum|dome|garden|gardens|speedway|raceway|circuit|course|links|club ?house|court|bowl)\b/i;
const NOT_NAME = new Set(('breaking report reports exclusive update news sources source fans fan season week game games night day today tonight why how what who when where this that these those '
  + 'after before latest big huge major record history historic official rumor rumors trade free agent agency deal contract injury injured mvp goat coach head general manager owner commissioner '
  + 'joins join joined takes take took signs sign signed leaves leave left wins win won beats beat loses lose lost returns return named says said makes make made heads head moves move set sets '
  + 'is are was were will can could would should has have had and or the a an of in on at to for with from by vs versus against new era start starts started '
  + 'breaks break broke sets set ties tie hits hit drops drop scores score reaches reach becomes become first last north south east west afc nfc rookie assists points yards record records '
  + 'throws throw threw runs run ran catches catch caught leads lead led stuns stun shocks shock fires fire fired trades trade traded slams slam rips rip blasts blast').split(' '));

function cleanName(raw) {
  let name = clean(raw).replace(/['’]s$/i, '').replace(/[.,;:!?]+$/g, '').replace(/^(?:the|a|an)\s+/i, '').trim();
  if (!name) return '';
  // An ALL-CAPS run ("BRYSON DECHAMBEAU JOINS") keeps the leading name words only.
  if (name === name.toUpperCase() && /[A-Z]{3}/.test(name)) {
    const words = name.split(/\s+/);
    const kept = [];
    for (const w of words) { if (NOT_NAME.has(w.toLowerCase()) || /\d/.test(w)) break; kept.push(w); }
    name = titleCase(kept.slice(0, 3).join(' '));
  }
  // Drop trailing generic words ("Bryson DeChambeau Joins").
  const words = name.split(/\s+/);
  while (words.length && NOT_NAME.has(words[words.length - 1].toLowerCase())) words.pop();
  while (words.length && NOT_NAME.has(words[0].toLowerCase())) words.shift();
  return words.join(' ');
}

// A team or league the logo library knows by this exact name ("Lakers",
// "Los Angeles Lakers", "Inter Miami CF").
let LOGO_LIB;
function libraryTeam(name) {
  if (LOGO_LIB === undefined) { try { LOGO_LIB = require('../../logo-library.js'); } catch { LOGO_LIB = null; } }
  const n = norm(name).trim();
  const exact = entry => entry && [entry.name, entry.short, entry.nickname, ...(entry.aliases || [])].filter(Boolean).some(x => norm(x).trim() === n);
  const found = LOGO_LIB?.findTeam?.(clean(name));
  if (exact(found)) return found;
  return (LOGO_LIB?.search?.(clean(name), { limit: 5 }) || []).find(exact) || null;
}
function classifyName(name, { teams = [] } = {}) {
  const n = norm(name).trim();
  if (!n) return '';
  const team = teams.find(t => [t.name, t.full, t.short].filter(Boolean).some(x => norm(x).trim() === n));
  if (team) return team.kind === 'league' ? 'league' : 'team';
  if (PLACE_PHRASES.includes(n) || n.split(' ').every(w => PLACES.has(w))) return 'place';
  if (libraryTeam(name)) return 'team';
  if (VENUE_WORD.test(name)) return 'venue';
  if (EVENT_WORD.test(name)) return 'event';
  // Count words as written: "Warriors-Lakers" is one hyphenated word, not a first and last name.
  const raw = clean(name).split(/\s+/);
  const words = n.split(' ');
  if (words.some(w => NOT_NAME.has(w)) && raw.length <= 2) return '';
  if (raw.length >= 2 && raw.length <= 3) return 'person';
  if (raw.length === 1 && !raw[0].includes('-') && words[0].length >= 3) return 'short'; // "Bryson", "LeBron", "Ohtani": resolve through ES tags
  return '';
}

// The ES tag for a short or shouted name: "Bryson" -> "Bryson DeChambeau",
// "Ohtani" -> "Shohei Ohtani". The most used tag whose words contain the name.
const TAG_CACHE = new Map();
const TAG_TTL_MS = 24 * 3600e3;
async function esTagFetch(query) {
  const url = new URL(`${ES_WP_API}/tags`);
  url.searchParams.set('search', query);
  url.searchParams.set('orderby', 'count');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', '8');
  url.searchParams.set('_fields', 'id,name,count');
  const response = await fetch(url, { headers: WP_HEADERS, signal: AbortSignal.timeout(5000) });
  const tags = await response.json().catch(() => null);
  return response.ok && Array.isArray(tags) ? tags.map(t => ({ name: clean(t.name), count: Number(t.count) || 0 })) : [];
}
async function resolveName(name, deps) {
  const key = name.toLowerCase();
  const hit = TAG_CACHE.get(key);
  if (hit && clock.now() - hit.at < TAG_TTL_MS) return hit.value;
  let value = '';
  try {
    const tags = await (deps.tags || esTagFetch)(name);
    const want = norm(name);
    const parts = t => norm(t.name).trim().split(' ');
    const whole = t => (want.trim().includes(' ') ? norm(t.name) === want || norm(t.name).startsWith(want) : [parts(t)[0], parts(t)[parts(t).length - 1]].includes(want.trim()));
    const match = tags.filter(t => t.count >= 5 && whole(t) && /^\S+(?:\s+\S+){1,2}$/.test(t.name) && classifyName(t.name) === 'person')
      .sort((a, b) => b.count - a.count)[0];
    value = match ? match.name : '';
  } catch {
    return null; // ES tags unreachable: not cached, and the caller keeps its best guess
  }
  if (TAG_CACHE.size > 500) TAG_CACHE.clear();
  TAG_CACHE.set(key, { at: clock.now(), value });
  return value;
}

// read: { brief, sport, people: [names], teams: [{ name, full, kind, logo, id }], stories: [{ text, people, teams }] }
// -> { heroes: [{ name, kind: person|team|league|event, team? }], extras: [{ name, kind: 'person', team? }], dropped: [{ name, why }] }
async function subjectsFor(read = {}, deps = {}) {
  const teams = read.teams || [];
  const dropped = [];
  const people = [];
  const addPerson = (name, why) => {
    if (!name) return;
    if (people.some(p => norm(p).includes(norm(name)) || norm(name).includes(norm(p)))) {
      // Keep the longer, more specific form.
      const i = people.findIndex(p => norm(name).includes(norm(p)) && name.length > p.length);
      if (i >= 0) people[i] = name;
      return;
    }
    people.push(name);
  };
  const raw = [...new Set((read.people || []).map(String))];
  // Names hidden in an ALL-CAPS brief: two or three capitalised words in a row.
  if (!raw.length || raw.every(n => n === n.toUpperCase())) {
    const shouted = String(read.brief || '').match(/\b[A-Z][A-Z'.-]+(?:\s+[A-Z][A-Z'.-]+){1,2}\b/g) || [];
    shouted.forEach(s => raw.push(s));
  }
  const pending = [];
  const venues = [];
  for (const original of raw) {
    const shoutedName = original === original.toUpperCase() && /[A-Z]{3}/.test(original);
    if (shoutedName) {
      // ALL CAPS: the real spelling from ES tags, longest prefix first
      // ("CAITLIN CLARK BREAKS" -> "Caitlin Clark"); unknown -> not searched.
      const words = clean(original).split(/\s+/).filter(w => !/\d/.test(w));
      const tries = [3, 2].filter(k => words.length >= k).map(k => titleCase(words.slice(0, k).join(' '))).filter(t => classifyName(t, { teams }) === 'person');
      pending.push((async () => {
        let unreachable = false;
        for (const t of tries) {
          const resolved = await resolveName(t, deps);
          if (resolved) return addPerson(resolved, 'tag');
          if (resolved === null) unreachable = true;
        }
        // Tags unreachable: the cleaned leading name words are the best guess.
        const guess = cleanName(original);
        if (unreachable && classifyName(guess, { teams }) === 'person') return addPerson(guess, 'name');
        dropped.push({ name: original, why: 'shouted words that are not a known ES name' });
      })());
      continue;
    }
    const name = cleanName(original);
    const kind = classifyName(name, { teams });
    if (kind === 'person') addPerson(name, 'name');
    else if (kind === 'short') {
      pending.push((async () => {
        const resolved = await resolveName(name, deps);
        if (resolved && !teams.some(t => norm(t.name) === norm(resolved))) addPerson(resolved, 'tag');
        else dropped.push({ name: original, why: 'single word that is not a known ES name' });
      })());
    } else if (kind === 'venue') {
      if (!venues.some(v => norm(v) === norm(name))) venues.push(name);
    } else {
      dropped.push({ name: original, why: kind ? `a ${kind}, not a person` : 'not a name' });
    }
  }
  await Promise.all(pending);
  // Order: the brief's order of first mention.
  const brief = norm(read.brief || '');
  const at = name => { const i = brief.indexOf(` ${norm(name).trim().split(' ').pop()} `); return i < 0 ? 1e9 : i; };
  people.sort((a, b) => at(a) - at(b));
  const teamOf = name => {
    const story = (read.stories || []).find(s => norm(s.text).includes(` ${norm(name).trim().split(' ').pop()} `));
    const t = story && teams.find(x => x.kind === 'team' && (story.teams || []).includes(x.id));
    return t ? t.name : '';
  };
  const heroes = people.slice(0, LIMITS.heroes).map(name => ({ name, kind: 'person', team: teamOf(name) }));
  // Stories with no person: their team / league is the subject (event imagery).
  (read.stories || []).forEach(story => {
    const named = people.some(p => norm(story.text).includes(` ${norm(p).trim().split(' ').pop()} `));
    if (named) return;
    teams.filter(t => (story.teams || []).includes(t.id)).forEach(t => {
      if (heroes.length < LIMITS.heroes + 2 && !heroes.some(h => h.name === t.name)) heroes.push({ name: t.name, kind: t.kind === 'league' ? 'league' : 'team', full: t.full || '' });
    });
  });
  // A named venue is a subject of its own (stadium / course imagery).
  venues.slice(0, 1).forEach(v => { if (heroes.length < LIMITS.heroes + 2) heroes.push({ name: v, kind: 'venue' }); });
  if (!heroes.length) teams.slice(0, 2).forEach(t => heroes.push({ name: t.name, kind: t.kind === 'league' ? 'league' : 'team', full: t.full || '' }));
  const extras = people.slice(LIMITS.heroes, LIMITS.heroes + LIMITS.extras).map(name => ({ name, kind: 'person', team: teamOf(name) }));
  return { heroes, extras, dropped };
}

// ─── 2. Gather ─────────────────────────────────────────────────────────────
function photoRecord(raw, source, matched) {
  const fromUrl = sizeFromUrl(raw.sourceUrl);
  return {
    id: String(raw.id || raw.sourceUrl).slice(0, 200),
    url: proxied(raw.sourceUrl),
    sourceUrl: raw.sourceUrl,
    title: clean(raw.title).slice(0, 160),
    caption: clean(raw.caption).slice(0, 300),
    credit: clean(raw.credit).slice(0, 120),
    articleUrl: raw.articleUrl || '',
    date: raw.date || '',
    // WordPress media reports the ORIGINAL size even when a smaller size was picked.
    width: fromUrl?.width || Number(raw.width) || null,
    height: fromUrl?.height || Number(raw.height) || null,
    sized: Boolean(fromUrl),
    source,
    matched,
    rights: PHOTO_RIGHTS[source],
  };
}

function dedupe(list, exclude = []) {
  const seenStem = new Set((exclude || []).map(photoStem));
  const seenCaption = new Set();
  const out = [];
  list.forEach(photo => {
    if (!photo?.sourceUrl) return;
    const stem = photoStem(photo.sourceUrl);
    if (!stem || seenStem.has(stem)) return;
    const caption = captionKey(photo);
    if (caption.length > 12 && seenCaption.has(caption)) return; // one frame of a burst
    seenStem.add(stem);
    if (caption.length > 12) seenCaption.add(caption);
    out.push(photo);
  });
  return out;
}

const queryFor = subject => {
  if (subject.kind === 'person') return [['person', subject.name], subject.team && ['person', `${subject.name} ${subject.team}`]].filter(Boolean);
  return [['team', subject.full && subject.full !== subject.name ? subject.full : subject.name], subject.full && subject.full !== subject.name && ['team', subject.name]].filter(Boolean);
};

async function gatherPhotos(subject, deps, { light = false } = {}) {
  const gathered = [];
  await Promise.all(queryFor(subject).map(async ([matched, q], order) => {
    const [agency, articles, media] = await Promise.all([
      deps.agency(q, light ? 6 : 12).catch(() => []),
      !light && order === 0 ? deps.articles(q).catch(() => []) : Promise.resolve([]),
      deps.media(q, light ? 6 : 10).catch(() => []),
    ]);
    (agency || []).forEach(item => gathered.push({ order, weight: 3, photo: photoRecord(item, 'es-agency', matched) }));
    (articles || []).filter(a => a.image).forEach(a => gathered.push({ order, weight: 2, photo: photoRecord({ id: a.url, sourceUrl: a.image, title: a.title, articleUrl: a.url, date: a.date }, 'es-article', matched) }));
    (media || []).forEach(item => gathered.push({ order, weight: 1, photo: photoRecord(item, 'es-media', matched) }));
  }));
  gathered.sort((a, b) => a.order - b.order || b.weight - a.weight);
  return gathered.map(g => g.photo).filter(p => deps.allowed(p.sourceUrl));
}

// ─── 3. Real sizes (no decoder: the first bytes carry the size) ─────────────
const SIZE_CACHE = new Map();
const SIZE_TTL_MS = 24 * 3600e3;
function headerSize(bytes) {
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xFF) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
        i += 2 + bytes.readUInt16BE(i + 2);
      }
    }
    if (bytes.slice(0, 4).toString('latin1') === 'RIFF' && bytes.slice(8, 12).toString('latin1') === 'WEBP') {
      const chunk = bytes.slice(12, 16).toString('latin1');
      if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
      if (chunk === 'VP8L') { const b = bytes.readUInt32LE(21); return { width: (b & 0x3FFF) + 1, height: ((b >> 14) & 0x3FFF) + 1 }; }
      if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3FFF, height: bytes.readUInt16LE(28) & 0x3FFF };
    }
  } catch { /* truncated header */ }
  return null;
}
async function fetchSize(url) {
  for (const bytes of [65535, 262143]) {
    const response = await fetch(url, { headers: { ...WP_HEADERS, Accept: 'image/*', Range: `bytes=0-${bytes}` }, signal: AbortSignal.timeout(4500) });
    if (!response.ok && response.status !== 206) return null;
    const buf = Buffer.from(await response.arrayBuffer());
    const size = headerSize(buf);
    if (size && size.width > 0) return size;
    if (response.status === 200 || buf.length < bytes) return null; // the whole file and still no size
  }
  return null;
}
async function probeSize(url, deps) {
  const hit = SIZE_CACHE.get(url);
  if (hit && clock.now() - hit.at < SIZE_TTL_MS) return hit.value;
  let value = null;
  try { value = await (deps.probe || fetchSize)(url); } catch { value = null; }
  if (SIZE_CACHE.size > 2000) SIZE_CACHE.clear();
  SIZE_CACHE.set(url, { at: clock.now(), value });
  return value;
}
// Fill unknown sizes, and swap a small WordPress size for its original upload.
// The ES CDN can be slow on a cold file, so all probes share one deadline
// (default 5 s); a size not known by then stays unknown (scored neutral).
const PROBE_DEADLINE_MS = 5000;
async function probeSizes(photos, deps) {
  const deadline = Number.isFinite(deps.probeDeadlineMs) ? deps.probeDeadlineMs : PROBE_DEADLINE_MS;
  let timer;
  const stop = new Promise(resolve => { timer = setTimeout(resolve, deadline); });
  await Promise.race([stop, probeAll(photos, deps)]);
  clearTimeout(timer);
  return photos;
}
async function probeAll(photos, deps) {
  await Promise.all(photos.map(async photo => {
    const original = originalOf(photo.sourceUrl);
    const short = Math.min(photo.width || 0, photo.height || 0);
    if (original && short && short < 1080 && deps.allowed(original)) {
      const big = await probeSize(original, deps);
      if (big && Math.min(big.width, big.height) > short) {
        photo.sourceUrl = original;
        photo.url = proxied(original);
        photo.width = big.width;
        photo.height = big.height;
        photo.upgraded = true;
        return;
      }
    }
    if (!photo.width || !photo.height || !photo.sized) {
      const size = await probeSize(photo.sourceUrl, deps);
      if (size) { photo.width = size.width; photo.height = size.height; photo.sized = true; }
    }
  }));
}

// ─── 4. Free signals ───────────────────────────────────────────────────────
const GRAPHIC = /\b(?:logo|logos|graphic|graphics|collage|silhouette|screenshot|screengrab|screen grab|tweet|twitter|instagram|x post|thumbnail|illustration|poster|infographic|banner|meme|composite|split|edit|edited|vector|icon|wallpaper|cartoon|mockup|template|ai generated|photoshop)\b/i;
const KIND_WORDS = [
  ['celebration', /\b(?:celebrat\w*|fist pump\w*|lifts? the|raises? the|hoists?|kiss\w* the|wins? the|champagne|trophy celebration|jubilant)\b/i],
  ['action', /\b(?:drives?|swing\w*|tees? off|putts?|chips?|shoots?|dunks?|lay ?up|rebounds?|throws?|passes|rush\w*|runs? with|tackl\w*|catch\w*|serves?|returns? a shot|forehand|backhand|pitch\w*|bats?|swings? at|hits?|scores?|kicks?|dribbl\w*|sprints?|in action|races?|laps?|during (?:the )?(?:first|second|third|fourth|final)|during (?:round|the game|the match|the race|a game|a match)|drives to the basket|runs the ball|scrambles?)\b/i],
  ['reaction', /\b(?:reacts?|reaction|frustrat\w*|dejected|shouts?|yells?|screams?|smiles?|smiling|laughs?)\b/i],
  ['portrait', /\b(?:portrait|headshot|head shot|poses?|posing|looks? on|media day|press conference|presser|interview|speaks? (?:to|with)|listens?|walks? (?:on|off|to)|warms? up|warm-?ups?)\b/i],
  ['crowd', /\b(?:fans|crowd|supporters|spectators|gallery)\b/i],
  ['venue', /\b(?:stadium|arena|ballpark|course|clubhouse|general view|aerial|venue|field view|the green at|grandstand|circuit|track view)\b/i],
  ['object', /\b(?:trophy on|the trophy sits|ball on|jersey|shoes?|sneakers?|helmet on|car on|close-?up of (?:the )?(?:ball|trophy|shoe))\b/i],
];
function kindHint(text) {
  for (const [kind, re] of KIND_WORDS) if (re.test(text)) return kind;
  return '';
}
const surnameOf = name => norm(name).trim().split(' ').pop();
function nameTokens(subject) {
  const names = [subject.name, subject.full, subject.short].filter(Boolean);
  return names.map(n => norm(n).trim()).filter(Boolean);
}
function mentions(text, subject) {
  const t = norm(text);
  if (nameTokens(subject).some(n => t.includes(` ${n} `))) return 2; // full name
  if (subject.kind === 'person') {
    const s = surnameOf(subject.name);
    if (s.length >= 4 && t.includes(` ${s} `)) return 1; // surname
  }
  return 0;
}
// Two or more people in one photo ("Rory McIlroy and Bryson DeChambeau",
// "Bryson-and-Rahm"), or another named person in the title / file name.
function groupHint(photo, subject) {
  const words = fileWords(photo.sourceUrl);
  const head = `${photo.title} ${words}`;
  if (/\b(?:and|vs|v|versus|with|&)\b/i.test(words) && words.split(' ').length >= 3) return true;
  if (/\b(?:teammates?|team photo|group|huddle|celebrate with|embrace|hug\w*|and his|and her)\b/i.test(`${head} ${photo.caption}`)) return true;
  return subject.kind === 'person' && /\b\w+ \w+ (?:and|&) \w+ \w+\b/.test(photo.title) && mentions(photo.title, subject) > 0;
}
function yearsIn(text) {
  return (String(text).match(/\b20[0-3]\d\b/g) || []).map(Number);
}
function ageDays(photo) {
  const date = Date.parse(photo.date || '');
  if (Number.isFinite(date)) return (clock.now() - date) / 864e5;
  const path = String(photo.sourceUrl).match(/\/(20\d\d)\/(\d\d)\//);
  if (path) return (clock.now() - Date.UTC(Number(path[1]), Number(path[2]) - 1, 15)) / 864e5;
  const years = yearsIn(`${photo.caption} ${photo.title} ${fileWords(photo.sourceUrl)}`);
  if (years.length) return (clock.now() - Date.UTC(Math.max(...years), 6, 1)) / 864e5;
  return null;
}
function heuristics(photo, subject) {
  const text = `${photo.title} ${photo.caption} ${fileWords(photo.sourceUrl)}`;
  const nameHit = mentions(text, subject);
  return {
    nameHit,
    graphic: GRAPHIC.test(`${photo.title} ${fileWords(photo.sourceUrl)}`) || /\bgraphic\b|\billustration\b/i.test(photo.caption),
    group: groupHint(photo, subject),
    kind: kindHint(`${photo.caption} ${photo.title} ${fileWords(photo.sourceUrl)}`),
    age: ageDays(photo),
  };
}

// ─── 5. Vision (only where it pays: people, unseen photos) ─────────────────
const VISION_CACHE = new Map();
const VISION_TTL_MS = 24 * 3600e3;
const visionKey = (subject, url) => `${norm(subject.name).trim()}|${photoStem(url)}`;
function visionPrompt(subject) {
  const who = subject.kind === 'person' ? subject.name : `${subject.name} (a ${subject.kind}; any of its players, venue or fans count)`;
  return [
    `You pick photos for bold ES sports Instagram designs about ${who}. For EACH photo reply with:`,
    'subject (true if it clearly shows that person / team), alone (true if one person dominates the frame), face (true if their face is visible and in focus),',
    'quality 1-5 (5 = sharp, well lit, vivid; 1 = blurry, dark, murky, tiny subject), kind (action | portrait | celebration | reaction | crowd | venue | object | group),',
    'graphic (true for logos, collages, edited graphics, screenshots, text-heavy images), cutout (true if the person is alone with head and upper body fully in frame, so a clean cut-out is possible),',
    'fx, fy (the subject\'s face or centre, 0-1 from the top-left).',
    'Reply with JSON only: {"photos":[{"n":1,"subject":true,"alone":true,"face":true,"quality":4,"kind":"action","graphic":false,"cutout":true,"fx":0.5,"fy":0.3}]}',
  ].join(' ');
}
async function defaultVision({ subject, photos, track, gateway }) {
  const content = [{ type: 'text', text: visionPrompt(subject) }];
  photos.forEach((photo, i) => content.push({ type: 'text', text: `Photo ${i + 1}:` }, { type: 'image', source: { type: 'url', url: photo.sourceUrl } }));
  const { text, cost } = await gateway.aiText({ tier: 'main', messages: [{ role: 'user', content }], effort: 'low', maxTokens: 1400, timeoutMs: 18000, track: { ...track, feature: 'generate-photo-pick', task: 'gen-imagery-rank' } });
  const match = String(text).match(/\{[\s\S]*\}/);
  const rows = match ? JSON.parse(match[0])?.photos : null;
  return { rows: Array.isArray(rows) ? rows : [], cost: Number(cost) || 0 };
}
const unit = value => (Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : null);
async function visionVerdicts(subject, photos, deps, ctx) {
  const out = new Map();
  const unseen = [];
  photos.forEach(photo => {
    const hit = VISION_CACHE.get(visionKey(subject, photo.sourceUrl));
    if (hit && clock.now() - hit.at < VISION_TTL_MS) out.set(photo.sourceUrl, hit.value);
    else unseen.push(photo);
  });
  if (!unseen.length || !deps.vision) return { verdicts: out, cost: 0, called: false };
  const shown = unseen.slice(0, LIMITS.visionPhotos);
  try {
    const { rows, cost } = await deps.vision({ subject, photos: shown, track: { email: ctx.email, token: ctx.token, runId: ctx.runId } });
    rows.forEach(row => {
      const photo = shown[Number(row.n) - 1];
      if (!photo) return;
      const value = {
        subject: row.subject !== false, alone: row.alone !== false, face: row.face === true,
        quality: Math.max(1, Math.min(5, Number(row.quality ?? row.score) || 3)),
        kind: String(row.kind || '').toLowerCase().slice(0, 20), graphic: row.graphic === true, cutout: row.cutout === true,
        focal: unit(row.fx) != null && unit(row.fy) != null ? { x: unit(row.fx), y: unit(row.fy) } : null,
      };
      out.set(photo.sourceUrl, value);
      if (VISION_CACHE.size > 3000) VISION_CACHE.clear();
      VISION_CACHE.set(visionKey(subject, photo.sourceUrl), { at: clock.now(), value });
    });
    return { verdicts: out, cost, called: true };
  } catch {
    return { verdicts: out, cost: 0, called: false };
  }
}

// ─── 6. Score ──────────────────────────────────────────────────────────────
// 0-1. Weights: subject 0.35, resolution 0.2, visibility 0.15, quality 0.1,
// kind 0.1, recency 0.1. Hard drops: graphics, the wrong person, tiny files.
const KIND_VALUE = {
  person: { action: 1, celebration: 1, portrait: 0.85, reaction: 0.85, group: 0.45, crowd: 0.35, venue: 0.3, object: 0.3, '': 0.6 },
  team: { action: 1, celebration: 1, crowd: 0.85, venue: 0.85, group: 0.8, reaction: 0.75, portrait: 0.6, object: 0.5, '': 0.6 },
};
function scorePhoto(photo, subject, h, v) {
  const isPerson = subject.kind === 'person';
  const short = Math.min(photo.width || 0, photo.height || 0);
  const why = [];
  let drop = '';
  if (v?.graphic || (!v && h.graphic)) drop = 'graphic';
  else if (v && isPerson && v.subject === false) drop = 'not the person';
  else if (!v && isPerson && h.nameHit === 0 && photo.matched !== 'person') drop = 'not about the person';
  else if (short && short < 400) drop = 'too small';
  else if (v && v.quality <= 1) drop = 'blurry or murky';
  const subjectScore = v ? (v.subject ? 1 : 0) : h.nameHit === 2 ? 0.8 : h.nameHit === 1 ? 0.65 : isPerson ? 0.25 : 0.5;
  const resolution = !short ? 0.45 : short >= 1080 ? 1 : short >= 1000 ? 0.95 : short >= 900 ? 0.85 : short >= 720 ? 0.65 : short >= 540 ? 0.4 : 0.15;
  const visibility = v ? (isPerson ? (v.alone ? 0.5 : 0.1) + (v.face ? 0.5 : 0.15) : 0.8) : h.group ? (isPerson ? 0.3 : 0.7) : 0.6;
  const quality = v ? (v.quality - 1) / 4 : 0.55;
  const kind = (isPerson ? KIND_VALUE.person : KIND_VALUE.team)[v?.kind || h.kind || ''] ?? 0.6;
  const age = h.age;
  const recency = age == null ? 0.55 : age <= 120 ? 1 : age <= 365 ? 0.75 : age <= 730 ? 0.5 : 0.3;
  const score = 0.35 * subjectScore + 0.2 * resolution + 0.15 * visibility + 0.1 * quality + 0.1 * kind + 0.1 * recency;
  if (short >= 1080) why.push('sharp at 1080');
  if (v?.face) why.push('face visible');
  if (h.group && !v?.alone) why.push('group');
  return {
    score: Number(score.toFixed(3)), drop,
    parts: { subject: subjectScore, resolution, visibility, quality: Number(quality.toFixed(2)), kind, recency },
    why,
  };
}

// Greedy pick for variety: the best photo first; each next one loses points
// for repeating a kind or an article already picked.
function diversify(photos, count) {
  const left = [...photos];
  const out = [];
  while (out.length < count && left.length) {
    let bestIndex = 0;
    let best = -Infinity;
    left.forEach((photo, index) => {
      const sameKind = out.filter(p => p.kind && p.kind === photo.kind).length;
      const sameArticle = out.filter(p => p.articleUrl && p.articleUrl === photo.articleUrl).length;
      const value = photo.score - 0.08 * sameKind - 0.06 * sameArticle;
      if (value > best) { best = value; bestIndex = index; }
    });
    out.push(left.splice(bestIndex, 1)[0]);
  }
  return out;
}

// Rank one subject's pool: probe sizes, free signals, vision for people.
async function rankFor(subject, pool, deps, ctx, { allowVision = true } = {}) {
  const hs = new Map(pool.map(p => [p, heuristics(p, subject)]));
  // Sizes for the most promising photos only (the CDN is slow on cold files).
  const promising = pool.map(p => ({ p, s: scorePhoto(p, subject, hs.get(p), null) })).filter(x => !x.s.drop || x.s.drop === 'too small')
    .sort((a, b) => b.s.score - a.s.score).slice(0, 12).map(x => x.p);
  await probeSizes(promising, deps);
  let verdicts = new Map();
  let cost = 0;
  let called = false;
  if (allowVision && subject.kind === 'person' && pool.length >= 1) {
    // Vision sees the most promising photos first (by the free score).
    const pre = pool.map(p => ({ p, s: scorePhoto(p, subject, hs.get(p), null) }))
      .sort((a, b) => (a.s.drop ? 1 : 0) - (b.s.drop ? 1 : 0) || b.s.score - a.s.score).map(x => x.p);
    const res = await visionVerdicts(subject, pre.filter(p => !hs.get(p).graphic), deps, ctx);
    verdicts = res.verdicts;
    cost = res.cost;
    called = res.called;
  }
  const ranked = [];
  const dropped = [];
  pool.forEach(photo => {
    const h = hs.get(photo);
    const v = verdicts.get(photo.sourceUrl) || null;
    const s = scorePhoto(photo, subject, h, v);
    const record = {
      ...photo,
      kind: v?.kind || h.kind || (subject.kind === 'person' ? 'portrait' : 'venue'),
      focal: v?.focal || null,
      face: v ? v.face : null,
      alone: v ? v.alone : !h.group,
      checked: Boolean(v),
      nameHit: h.nameHit,
      cutoutOk: subject.kind === 'person' && !s.drop && (v ? v.cutout && v.alone : !h.group && ['action', 'portrait', 'celebration', 'reaction', ''].includes(h.kind)) && (Math.min(photo.width || 0, photo.height || 0) >= 600 || !photo.width),
      score: s.score,
      quality: s.parts,
      why: s.why,
    };
    if (s.drop) dropped.push({ sourceUrl: photo.sourceUrl, why: s.drop });
    else ranked.push(record);
  });
  ranked.sort((a, b) => b.score - a.score);
  // Without vision, a person's photo that never names them is a guess: keep it
  // only when fewer than 3 photos do name them.
  if (subject.kind === 'person') {
    const unnamed = p => !p.checked && p.nameHit === 0;
    if (ranked.filter(p => !unnamed(p)).length >= 3) {
      for (let i = ranked.length - 1; i >= 0; i -= 1) if (unnamed(ranked[i])) dropped.push({ sourceUrl: ranked.splice(i, 1)[0].sourceUrl, why: 'does not name the person' });
    }
  }
  return { ranked, dropped, cost, vision: called };
}

// ─── 7. Logos ──────────────────────────────────────────────────────────────
function logosFor(read = {}) {
  let LOGOS = null;
  try { LOGOS = require('../../logo-library.js'); } catch { LOGOS = null; }
  const out = [];
  const add = (url, team, league) => { if (url && !out.some(l => l.url === url)) out.push({ url, team: team || '', league: league || '' }); };
  (read.teams || []).forEach(t => {
    if (!t.logo) return;
    const entry = LOGOS?.get?.(t.id);
    add(t.logo, t.kind === 'league' ? '' : (t.full || t.name), t.kind === 'league' ? t.name : String(entry?.league || '').toUpperCase());
  });
  if (LOGOS && read.sport) {
    // The sport's league mark (NFL, NBA, MLB, NCAA...); never a generic sport icon.
    const leagueId = LOGOS.leagueForSport?.(read.sport);
    const mark = leagueId && (LOGOS.get(`league-${leagueId}`) || LOGOS.search(read.sport, { limit: 3 }).find(e => e.kind === 'league'));
    if (mark) add(mark.file || mark.url, '', String(read.sport).toUpperCase());
  }
  return out;
}

// ─── 8. Cut-out store (deterministic, shared by every server) ──────────────
function cutoutPath(sourceUrl) {
  return `gen-assets/cutouts/${crypto.createHash('sha256').update(`v1|${photoStem(sourceUrl)}|${String(sourceUrl)}`).digest('hex').slice(0, 40)}.png`;
}

// ─── 9. Everything for one run ─────────────────────────────────────────────
// read: the composer's readCreative output (people, teams, sport, stories, brief).
// ctx: { email, token, runId, gated, deps: { agency, media, articles, tags, probe, vision, allowed, storageHas, publicUrl, gate } }
// Returns {
//   photos:    [contract photo]  every kept photo, best first per subject, no repeats
//   bySubject: { name: [photo] }  for the art director (same records, plus src)
//   cutouts:   [contract cut-out] already made (storage), keyed by fromPhoto
//   cutoutPlan:[{ fromPhoto, sourceUrl, person, path }] the browser makes these (cap 3)
//   headshots: [{ url, person, team, focal }]
//   logos:     [{ url, team, league }]
//   subjects, dropped, cost, stats }
async function prepareImagery(read = {}, ctx = {}, deps = {}) {
  const started = clock.now();
  const { heroes, extras, dropped: droppedNames } = await subjectsFor(read, deps);
  let cost = 0;
  let visionCalls = 0;
  const gateOpen = await (async () => {
    if (!deps.vision) return false;
    if (ctx.gated || !deps.gate) return true;
    try { return !(await deps.gate(ctx, 'generate-photo-pick')); } catch { return false; }
  })();

  // Gather in parallel; assign each photo to the first subject that finds it.
  const pools = await Promise.all(heroes.map(s => gatherPhotos(s, deps).catch(() => [])));
  const extraPools = await Promise.all(extras.map(s => gatherPhotos(s, deps, { light: true }).catch(() => [])));
  const seen = new Set();
  const take = list => dedupe(list).filter(p => { const k = photoStem(p.sourceUrl); if (seen.has(k)) return false; seen.add(k); return true; });
  // People first (their photos are the most specific), then teams / events.
  const order = heroes.map((s, i) => i).sort((a, b) => (heroes[a].kind === 'person' ? 0 : 1) - (heroes[b].kind === 'person' ? 0 : 1) || a - b);
  const owned = new Array(heroes.length);
  order.forEach(i => { owned[i] = take(pools[i]).slice(0, 16); });
  const extraOwned = extraPools.map(list => take(list).slice(0, 6));

  const bySubject = {};
  const report = [];
  const rankedLists = await Promise.all(heroes.map(async (subject, i) => {
    const allowVision = gateOpen && subject.kind === 'person' && visionCalls++ < LIMITS.visionPerRun;
    const res = await rankFor(subject, owned[i], deps, ctx, { allowVision });
    cost += res.cost;
    return res;
  }));
  heroes.forEach((subject, i) => {
    const res = rankedLists[i];
    const picked = diversify(res.ranked, LIMITS.perSubject).map(p => ({ ...p, src: p.url, person: subject.kind === 'person' ? subject.name : undefined, team: subject.kind === 'person' ? (subject.team || undefined) : subject.name, subjectKind: subject.kind }));
    bySubject[subject.name] = picked;
    report.push({ subject: subject.name, kind: subject.kind, found: owned[i].length, kept: picked.length, dropped: res.dropped, vision: res.vision });
  });
  const extraRanked = await Promise.all(extras.map((subject, i) => rankFor(subject, extraOwned[i], deps, ctx, { allowVision: false })));

  // Contract photo list: subjects in order, best first.
  const photos = heroes.flatMap(s => bySubject[s.name]).map(p => contractPhoto(p));

  // Headshots: per person, the photo that shows the face best (vision face,
  // else a portrait / reaction / action with the name in the caption).
  const headshots = [];
  const faceScore = p => (p.face ? 1 : 0) + (p.alone ? 0.4 : 0) + (p.kind === 'portrait' ? 0.3 : p.kind === 'reaction' || p.kind === 'celebration' ? 0.2 : 0) + p.score;
  heroes.filter(s => s.kind === 'person').forEach(s => {
    const best = [...bySubject[s.name]].sort((a, b) => faceScore(b) - faceScore(a))[0];
    if (best) headshots.push({ url: best.url, person: s.name, team: s.team || undefined, focal: best.focal || undefined, fromPhoto: best.url });
  });
  extras.forEach((s, i) => {
    const best = extraRanked[i].ranked.sort((a, b) => faceScore(b) - faceScore(a))[0];
    if (best) headshots.push({ url: best.url, person: s.name, team: s.team || undefined, focal: best.focal || undefined, fromPhoto: best.url });
  });

  // Cut-outs: hero people's best cut-out-able photos (at most 2 each, 3 in all).
  const cutoutPlan = [];
  heroes.filter(s => s.kind === 'person').forEach((s, rank) => {
    const each = rank === 0 ? 2 : 1;
    bySubject[s.name].filter(p => p.cutoutOk).slice(0, each).forEach(p => {
      if (cutoutPlan.length < LIMITS.cutoutsPerRun) cutoutPlan.push({ fromPhoto: p.url, sourceUrl: p.sourceUrl, person: s.name, path: cutoutPath(p.sourceUrl), width: p.width, height: p.height });
    });
  });
  // Already made by anyone: $0.
  const cutouts = [];
  if (deps.storageHas) {
    await Promise.all(cutoutPlan.map(async item => {
      try {
        const url = await deps.storageHas(item.path);
        if (url) { item.done = true; cutouts.push({ url, width: item.width || null, height: item.height || null, person: item.person, fromPhoto: item.fromPhoto }); }
      } catch { /* make it in the browser */ }
    }));
  }
  const stats = {
    subjects: heroes.length, extras: extras.length, photos: photos.length,
    sharp: photos.filter(p => Math.min(p.width || 0, p.height || 0) >= 1080).length,
    checked: heroes.reduce((n, s) => n + bySubject[s.name].filter(p => p.checked).length, 0),
    cutoutsReady: cutouts.length, cutoutsPending: cutoutPlan.filter(c => !c.done).length,
    visionCalls: rankedLists.filter(r => r.vision).length, ms: clock.now() - started,
  };
  return {
    ok: true, photos, bySubject, cutouts, cutoutPlan: cutoutPlan.filter(c => !c.done), headshots, logos: logosFor(read),
    subjects: heroes, extras: extras.map(e => e.name), dropped: droppedNames, report, cost: Number(cost.toFixed(5)), stats,
  };
}

function contractPhoto(p) {
  return {
    url: p.url, width: p.width || null, height: p.height || null,
    ...(p.person ? { person: p.person } : {}), ...(p.team ? { team: p.team } : {}),
    kind: ['action', 'portrait', 'crowd', 'venue', 'object'].includes(p.kind) ? p.kind : p.kind === 'celebration' || p.kind === 'reaction' ? 'action' : p.kind === 'group' ? 'crowd' : 'portrait',
    ...(p.focal ? { focal: p.focal } : {}),
    score: p.score, source: p.source, rights: p.rights,
    sourceUrl: p.sourceUrl, title: p.title, caption: p.caption, credit: p.credit, date: p.date, cutoutOk: Boolean(p.cutoutOk), face: p.face, checked: p.checked,
  };
}

// The contract fields for one design: its subject's photos first (the chosen
// one leading), then the rest of the set's subjects; its cut-outs; headshots;
// logos. Never a photo another design in the set already uses (exclude).
function inputImagery(imagery, { person = '', team = '', main = '', exclude = [] } = {}) {
  if (!imagery?.ok) return {};
  const used = new Set((exclude || []).map(photoStem));
  const mainStem = main ? photoStem(decodeProxy(main)) : '';
  const own = (imagery.bySubject?.[person] || imagery.bySubject?.[team] || []);
  const rest = Object.entries(imagery.bySubject || {}).filter(([name]) => name !== person && name !== team).flatMap(([, list]) => list);
  const list = [...own, ...rest].filter(p => photoStem(p.sourceUrl) === mainStem || !used.has(photoStem(p.sourceUrl)));
  list.sort((a, b) => (photoStem(b.sourceUrl) === mainStem) - (photoStem(a.sourceUrl) === mainStem));
  const photos = list.slice(0, 8).map(p => ({ ...contractPhoto(p), src: p.url }));
  const cutouts = (imagery.cutouts || []).filter(c => !person || c.person === person).map(c => ({ ...c, src: c.url }));
  return { photos, cutouts, headshots: imagery.headshots || [], logos: (imagery.logos || []).map(l => ({ ...l, src: l.url, name: l.team || l.league })) };
}
function decodeProxy(url) {
  const m = String(url || '').match(/[?&]image=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : String(url || '');
}

module.exports = {
  prepareImagery, inputImagery, subjectsFor, gatherPhotos, probeSizes, rankFor, scorePhoto, heuristics, logosFor, cutoutPath, contractPhoto, diversify,
  LIMITS, PHOTO_RIGHTS,
  _test: { cleanName, classifyName, resolveName, photoStem, fileWords, sizeFromUrl, originalOf, headerSize, kindHint, groupHint, mentions, dedupe, decodeProxy, visionPrompt, defaultVision, TAG_CACHE, SIZE_CACHE, VISION_CACHE, clock },
};
