// Past FrameUp designs as examples for Generate (background only, never shown).
//
// Reads the team's recent Social Media exports through the signed-in person's
// own access (the Gallery RPC), keeps the ones whose text is real copy, and
// picks those most similar to a brief. The AI sees them as style and template
// guidance: how ES writes covers, quotes and stat headlines. Their teams are
// not trusted (many exports keep the editor's default team) and their facts
// are never reused. Nothing is stored in the repo: this is a public codebase.
const auth = require('./_supabase-auth.js');

const CACHE_MS = 10 * 60 * 1000;
const PAGES = 4;
const PAGE_SIZE = 96;
let cache = { at: 0, designs: [] };

// Export labels, old and new, to Generate's post types.
const VARIANT_TYPES = {
  'cover image': 'cover',
  'quote image': 'quote',
  quote: 'quote',
  'long quote image': 'long-quote',
  'long quote': 'long-quote',
  'double entity quote': 'double-entity-quote',
  'two-person quote': 'double-entity-quote',
  'stats post single ent': 'stats-single-ent',
  'player stats': 'stats-single-ent',
  'stats post double ent': 'stats-double-ent',
  'head-to-head stats': 'stats-double-ent',
  'listicle type 1': 'listicle-type-1',
  'rankings table': 'listicle-type-1',
  'listicle type 2': 'listicle-type-2',
  'ranked list': 'listicle-type-2',
};

const STOP = new Set('the and for with this that from have has was were are his her their they about after before into over just what when who will your you our not but out all can its it\'s been more most than then them did does how why'.split(' '));
const words = text => String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(' ').filter(word => word.length > 2 && !STOP.has(word));
const isSlug = text => /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(text);

function normalize(rows) {
  const seen = new Set();
  const designs = [];
  const newestFirst = [...rows].sort((a, b) => String(b.at || b.exported_at || '').localeCompare(String(a.at || a.exported_at || '')));
  for (const row of newestFirst) {
    const postType = VARIANT_TYPES[String(row.variant || row.workspace_variant || '').toLowerCase().trim()];
    let text = String(row.title || '').replace(/\s+/g, ' ').trim();
    if (!postType || !text) continue;
    const slug = isSlug(text);
    // Canvas-name slugs carry a topic, not copy: only useful for rankings.
    if (slug && !postType.startsWith('listicle')) continue;
    if (slug) text = text.replace(/-/g, ' ');
    const key = `${postType}|${text.toLowerCase()}`;
    if (seen.has(key) || text.length < 6) continue;
    seen.add(key);
    const brief = String(row.brief || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    designs.push({ postType, text: text.length > 110 ? `${text.slice(0, 107).trim()}...` : text, topicOnly: slug, brief, at: String(row.at || row.exported_at || '') });
  }
  return designs;
}

// list_frameup_examples (with the brief a design came from) when its migration
// is applied, else the Gallery's list_frameup_gallery.
async function fetchGallery(token, rpc = 'list_frameup_examples') {
  if (typeof auth.authConfig !== 'function') return [];
  const { url, publishableKey } = auth.authConfig();
  const rows = [];
  let before = null;
  for (let page = 0; page < PAGES; page += 1) {
    const response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_limit: PAGE_SIZE, p_before: before }),
      signal: AbortSignal.timeout(6000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data)) {
      if (!rows.length && rpc === 'list_frameup_examples') return fetchGallery(token, 'list_frameup_gallery');
      break;
    }
    rows.push(...data.map(row => ({ variant: row.workspace_variant, title: row.title, at: row.exported_at, brief: row.brief || '' })));
    if (data.length < PAGE_SIZE) break;
    before = data[data.length - 1].exported_at;
  }
  return rows;
}

// Recent past designs (cached per server instance). Local testing can point
// GENERATE_EXAMPLES_FILE at a JSON export instead of calling Supabase.
async function loadPastDesigns(token) {
  if (cache.designs.length && Date.now() - cache.at < CACHE_MS) return cache.designs;
  let rows = [];
  try {
    if (process.env.GENERATE_EXAMPLES_FILE) {
      rows = JSON.parse(require('fs').readFileSync(process.env.GENERATE_EXAMPLES_FILE, 'utf8'));
    } else if (token) {
      rows = await fetchGallery(token);
    }
  } catch (error) {
    rows = [];
  }
  const designs = normalize(rows);
  if (designs.length) cache = { at: Date.now(), designs };
  return designs;
}

// The most relevant past designs for this brief: shared words first, then a
// few recent ones per template so the AI always sees ES's current voice.
function selectExamples(brief, designs, allowedTypes = [], max = 10) {
  const usable = designs.filter(d => !allowedTypes.length || allowedTypes.includes(d.postType));
  const briefWords = new Set(words(brief));
  const scored = usable.map((design, index) => {
    const overlap = words(design.text).filter(word => briefWords.has(word)).length;
    const briefOverlap = design.brief ? words(design.brief).filter(word => briefWords.has(word)).length : 0;
    // Confirmed pairs (a Generate design someone exported) count most.
    return { design, score: (overlap + briefOverlap) * 10 + (design.brief ? 8 : 0) - index * 0.01 };
  });
  const picked = [];
  const perType = {};
  const take = item => {
    const type = item.design.postType;
    if (picked.includes(item.design) || (perType[type] || 0) >= 4) return;
    perType[type] = (perType[type] || 0) + 1;
    picked.push(item.design);
  };
  scored.filter(item => item.score > 5).sort((a, b) => b.score - a.score).slice(0, 8).forEach(take);
  // Style anchors: the newest examples of each template.
  for (const type of ['cover', 'stats-single-ent', 'long-quote', 'quote', 'listicle-type-1', 'listicle-type-2', 'stats-double-ent', 'double-entity-quote']) {
    scored.filter(item => item.design.postType === type).slice(0, type === 'cover' ? 3 : 1).forEach(take);
    if (picked.length >= max) break;
  }
  return picked.slice(0, max);
}

const LABELS = {
  cover: 'Cover', quote: 'Quote', 'long-quote': 'Long Quote', 'double-entity-quote': 'Two-Person Quote',
  'stats-single-ent': 'Player Stats', 'stats-double-ent': 'Head-to-Head', 'listicle-type-1': 'Rankings Table', 'listicle-type-2': 'Ranked List',
};

function formatExamples(examples) {
  return examples.map(d => (d.brief
    ? `- [${LABELS[d.postType]}] brief "${d.brief}" -> the team used: ${d.text}`
    : `- [${LABELS[d.postType]}] ${d.topicOnly ? `(topic) ${d.text}` : d.text}`)).join('\n');
}

// ─── v2: the creative brain's memory (research doc C/D2) ───────────────────
// list_frameup_generate_corpus (migration 20261117140000) returns the real
// text of each export (lines, listicle rows), its sport/team, palette, the
// brief it came from and admin stars. Before that migration is applied the
// old RPCs are used and each title stands in for the lines.
const CORPUS_RPC = 'list_frameup_generate_corpus';
const CORPUS_PAGES = 2;
const CORPUS_PAGE_SIZE = 150;
let corpusCache = { at: 0, value: null };

const POST_TYPES = ['cover', 'quote', 'long-quote', 'double-entity-quote', 'stats-single-ent', 'stats-double-ent', 'listicle-type-1', 'listicle-type-2'];
const FAMILY = {
  cover: 'words', quote: 'words', 'long-quote': 'words', 'double-entity-quote': 'words',
  'stats-single-ent': 'stats', 'stats-double-ent': 'stats', 'listicle-type-1': 'list', 'listicle-type-2': 'list',
};

async function fetchCorpusPages(token) {
  const { url, publishableKey } = auth.authConfig();
  const rows = [];
  let before = null;
  const started = Date.now();
  for (let page = 0; page < CORPUS_PAGES; page += 1) {
    const response = await fetch(`${url}/rest/v1/rpc/${CORPUS_RPC}`, {
      method: 'POST',
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_limit: CORPUS_PAGE_SIZE, p_before: before }),
      signal: AbortSignal.timeout(6000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data)) {
      if (!rows.length) throw Object.assign(new Error(`corpus rpc ${response.status}`), { status: response.status });
      break;
    }
    rows.push(...data);
    // A slow first page is enough: never spend more than ~3s more on a second.
    if (data.length < CORPUS_PAGE_SIZE || Date.now() - started > 3000) break;
    before = data[data.length - 1].exported_at;
  }
  return rows;
}

// A legacy row (title only) in the corpus shape.
const legacyRow = row => ({
  id: '', exported_at: row.at || '', workspace_variant: row.variant || '', post_type: '', sport: '', team: '',
  title: row.title || '', lines: [], listicle: null, palette_idx: null, photo_url: null, brief: row.brief || '', generated: {}, status: '', stars: null,
});

// { rows, source: 'rich' | 'legacy' | 'none', designs } where designs is the
// old normalize() output (legacy source only), so the writer prompt stays
// exactly as before the migration. Never throws. Cached 10 minutes per server.
async function loadCorpus(token) {
  if (corpusCache.value && Date.now() - corpusCache.at < CACHE_MS) return corpusCache.value;
  let value = { rows: [], source: 'none', designs: [] };
  try {
    if (process.env.GENERATE_EXAMPLES_FILE) {
      const rows = JSON.parse(require('fs').readFileSync(process.env.GENERATE_EXAMPLES_FILE, 'utf8'));
      const rich = Array.isArray(rows) && rows.some(row => row && (Array.isArray(row.lines) || 'post_type' in row));
      value = rich ? { rows, source: 'rich', designs: [] } : { rows: rows.map(legacyRow), source: 'legacy', designs: normalize(rows) };
    } else if (token && typeof auth.authConfig === 'function') {
      try {
        value = { rows: await fetchCorpusPages(token), source: 'rich', designs: [] };
      } catch (error) {
        // Migration not applied yet (404 / PGRST202) or the call failed: the old examples.
        const legacy = await fetchGallery(token);
        value = { rows: legacy.map(legacyRow), source: legacy.length ? 'legacy' : 'none', designs: normalize(legacy) };
      }
    }
  } catch (error) {
    value = { rows: [], source: 'none', designs: [] };
  }
  if (!value.rows.length) value.source = 'none';
  if (value.rows.length) corpusCache = { at: Date.now(), value };
  return value;
}

const cleanText = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const sameLines = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((line, i) => cleanText(line).toLowerCase() === cleanText(b[i]).toLowerCase());

// Corpus rows -> PastPost[] (newest first, deduped, only rows with real text).
function normalizeCorpus(rows = []) {
  const seen = new Set();
  const posts = [];
  const newestFirst = [...rows].filter(Boolean).sort((a, b) => String(b.exported_at || '').localeCompare(String(a.exported_at || '')));
  for (const row of newestFirst) {
    const postType = POST_TYPES.includes(row.post_type) ? row.post_type : VARIANT_TYPES[String(row.workspace_variant || '').toLowerCase().trim()];
    if (!postType) continue;
    const lines = (Array.isArray(row.lines) ? row.lines : []).map(line => cleanText(typeof line === 'string' ? line : '')).filter(Boolean).slice(0, 8).map(line => line.slice(0, 120));
    const l = row.listicle && typeof row.listicle === 'object' ? row.listicle : null;
    const listicle = l && (cleanText(l.title) || (Array.isArray(l.rows) && l.rows.length)) ? {
      title: cleanText(l.title).slice(0, 80),
      headers: (Array.isArray(l.headers) ? l.headers : []).map(cleanText).slice(0, 3),
      rows: (Array.isArray(l.rows) ? l.rows : []).slice(0, 10).map(r => ({ entity: cleanText(r?.entity), metric1: cleanText(r?.metric1), metric2: cleanText(r?.metric2), subtitle: cleanText(r?.subtitle) })).filter(r => r.entity),
    } : null;
    const title = cleanText(row.title);
    const slug = isSlug(title);
    let text = '';
    let topicOnly = false;
    if (lines.length && !postType.startsWith('listicle')) text = lines.join(' | ');
    else if (listicle?.title) text = `${listicle.title}${listicle.rows.length ? ` — ${listicle.rows.slice(0, 3).map(r => r.entity).join(', ')}` : ''}`;
    else if (title && !slug) text = title;
    else if (title && slug && postType.startsWith('listicle')) { text = title.replace(/-/g, ' '); topicOnly = true; }
    if (text.length < 6) continue;
    const key = `${postType}|${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const generated = row.generated && typeof row.generated === 'object' ? row.generated : {};
    const aiText = Array.isArray(generated.aiText) ? generated.aiText.map(cleanText) : null;
    const stars = Number.isInteger(Number(row.stars)) && row.stars != null ? Number(row.stars) : null;
    posts.push({
      id: String(row.id || ''),
      postType,
      sport: cleanText(row.sport),
      team: cleanText(row.team),
      text: text.length > 140 ? `${text.slice(0, 137).trim()}...` : text,
      lines: lines.length ? lines : (title && !slug && !postType.startsWith('listicle') ? [title] : []),
      listicle,
      topicOnly,
      paletteIdx: Number.isInteger(row.palette_idx) ? row.palette_idx : null,
      photoUrl: String(row.photo_url || ''),
      brief: cleanText(row.brief).slice(0, 300),
      generated: { angle: cleanText(generated.angle), hook: cleanText(generated.hook), aiText, score: Number.isFinite(Number(generated.score)) && generated.score != null ? Number(generated.score) : null },
      edited: aiText ? !sameLines(aiText, lines) : null,
      stars: stars >= 1 && stars <= 5 ? stars : null,
      status: cleanText(row.status),
      at: String(row.exported_at || ''),
    });
  }
  return posts;
}

const lintHelpers = () => require('./_lint-spec.js');
const surnameOf = name => cleanText(name).split(' ').filter(Boolean).pop()?.toLowerCase() || '';
const postSearchText = post => ` ${[post.text, ...(post.lines || []), post.listicle?.title, ...(post.listicle?.rows || []).map(r => r.entity), post.brief]
  .filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
function wordJaccard(a, b) {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let shared = 0;
  x.forEach(word => { if (y.has(word)) shared += 1; });
  return shared / (x.size + y.size - shared);
}

// C6: how useful a past post is as an example for this brief.
// read: readBrief() output (+ brief). ctx: { allowedTypes, conceptTypes, now }.
function scorePastPost(post, read = {}, ctx = {}) {
  const { findTeam, findSport } = lintHelpers();
  const now = ctx.now ?? Date.now();
  const haystack = postSearchText(post);
  const names = [...(read.subjects || []).map(surnameOf), surnameOf(read.team)].filter(word => word && word.length > 2);
  const entity = names.some(word => haystack.includes(` ${word} `)) ? 4 : 0;
  const postSport = findSport(post.sport);
  const postTeam = post.team ? (findTeam(postSport, post.team) || findTeam('', post.team)) : '';
  const team = read.team && postTeam && postTeam === read.team ? 2 : 0;
  const sport = read.sport && postSport && postSport === findSport(read.sport) ? 1.5 : 0;
  const wanted = (ctx.conceptTypes?.length ? ctx.conceptTypes : ctx.allowedTypes?.length ? ctx.allowedTypes
    : Object.entries(read.fits || {}).filter(([, ok]) => ok).map(([type]) => type));
  const format = wanted.includes(post.postType) ? 1.5 : wanted.some(type => FAMILY[type] === FAMILY[post.postType]) ? 0.5 : 0;
  const briefSim = Math.min(3, 10 * wordJaccard(read.brief || '', post.brief || post.text));
  const quality = (post.stars ? (post.stars - 3) * 1.5 : 0)
    + (post.generated?.aiText && post.edited === false ? 1.5 : 0)
    + (post.brief ? 0.8 : 0)
    + (post.status === 'Done' ? 0.5 : 0);
  const at = Date.parse(post.at);
  const ageDays = Number.isFinite(at) ? Math.max(0, (now - at) / 864e5) : 365;
  const recency = 1.5 * Math.exp(-ageDays / 45);
  return entity + team + sport + format + briefSim + quality + recency;
}

// The best past posts for a brief: top scores, at most 2 per template, no
// near-duplicates, and one well-starred post for the sport when there is one.
function pickPastPosts(posts = [], read = {}, { allowedTypes = [], conceptTypes = [], max = 6, now } = {}) {
  const { findSport } = lintHelpers();
  const usable = posts.filter(post => !(post.stars != null && post.stars <= 2))
    .filter(post => !allowedTypes.length || allowedTypes.includes(post.postType));
  const scored = usable.map(post => ({ ...post, score: scorePastPost(post, read, { allowedTypes, conceptTypes, now }) }))
    .sort((a, b) => b.score - a.score);
  const picked = [];
  const perType = {};
  for (const post of scored) {
    if (picked.length >= max) break;
    if ((perType[post.postType] || 0) >= 2) continue;
    if (picked.some(other => wordJaccard(other.text, post.text) >= 0.6)) continue;
    perType[post.postType] = (perType[post.postType] || 0) + 1;
    picked.push(post);
  }
  const sport = findSport(read.sport);
  if (max > 0 && !picked.some(post => post.stars >= 4)) {
    const starred = scored.find(post => post.stars >= 4 && (!sport || findSport(post.sport) === sport) && !picked.includes(post));
    if (starred) {
      if (picked.length >= max) picked.pop();
      picked.push(starred);
    }
  }
  return picked;
}

const maskDigits = text => String(text || '').replace(/\d[\d,.]*/g, '#');

// One line per post, digits masked so their facts are never copied:
// - [Cover · NFL · Kansas City Chiefs · ★5] "Can Anyone | Stop Mahomes?" (brief: "mahomes after chiefs win")
function formatPastPosts(posts = []) {
  return posts.map(post => {
    const tags = [LABELS[post.postType], post.sport, post.team, post.stars ? `★${post.stars}` : ''].filter(Boolean).join(' · ');
    const text = maskDigits(post.topicOnly ? `(topic) ${post.text}` : post.text).slice(0, 140);
    const brief = post.brief ? ` (brief: ${JSON.stringify(maskDigits(post.brief).slice(0, 100))})` : '';
    return `- [${tags}] ${JSON.stringify(text)}${brief}`;
  }).join('\n');
}

const median = list => {
  const sorted = [...list].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Up to 5 short lines on how ES posts actually look, from good posts (starred
// 4+ or exported unedited) or else the newest 120. A line needs 8+ samples.
function houseStyle(posts = [], read = {}) {
  const { findTeam } = lintHelpers();
  const good = posts.filter(post => post.stars >= 4 || post.edited === false);
  const base = good.length >= 8 ? good : posts.slice(0, 120);
  const out = [];
  const covers = base.filter(post => post.postType === 'cover' && post.lines.length);
  if (covers.length >= 8) {
    const pills = median(covers.map(post => post.lines.length));
    const chars = median(covers.flatMap(post => post.lines.map(line => line.length)));
    out.push(`ES Covers here run ${Math.round(pills)} pills of about ${Math.round(chars)} characters.`);
    const pct = Math.round(100 * covers.filter(post => /\?\s*$/.test(post.lines[post.lines.length - 1])).length / covers.length);
    if (pct >= 25) out.push(`${pct}% of recent ES Covers are questions.`);
  }
  const stats = base.filter(post => post.postType === 'stats-single-ent' && post.lines[0]);
  if (stats.length >= 8) {
    out.push(`Player Stats headlines are ${Math.round(median(stats.map(post => post.lines[0].split(' ').filter(Boolean).length)))} words, e.g. reactions like the examples.`);
  }
  if (read.team) {
    const teamPosts = posts.filter(post => Number.isInteger(post.paletteIdx) && post.team && (findTeam('', post.team) === read.team || post.team === read.team));
    if (teamPosts.length >= 3) {
      const inverted = teamPosts.filter(post => post.paletteIdx >= 2).length;
      const useInverted = inverted * 2 > teamPosts.length;
      const pct = Math.round(100 * (useInverted ? inverted : teamPosts.length - inverted) / teamPosts.length);
      out.push(`For ${read.team}, editors use palette ${useInverted ? 'inverted' : 'primary'} ${pct}% of the time.`);
    }
  }
  const rankings = base.filter(post => post.postType.startsWith('listicle') && post.listicle?.title);
  if (rankings.length >= 8) {
    const avg = Math.round(rankings.reduce((sum, post) => sum + post.listicle.title.replace(/\n/g, ' ').length, 0) / rankings.length);
    out.push(`Rankings titles average ${avg} characters over 2 lines.`);
  }
  return out.slice(0, 5).map(line => line.slice(0, 120));
}

module.exports = {
  loadPastDesigns, selectExamples, formatExamples,
  loadCorpus, normalizeCorpus, scorePastPost, pickPastPosts, formatPastPosts, houseStyle,
  _test: {
    normalize, words, VARIANT_TYPES,
    loadCorpus, normalizeCorpus, scorePastPost, pickPastPosts, formatPastPosts, houseStyle, maskDigits,
    reset: () => { cache = { at: 0, designs: [] }; corpusCache = { at: 0, value: null }; },
  },
};
