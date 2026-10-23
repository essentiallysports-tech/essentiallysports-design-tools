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

module.exports = { loadPastDesigns, selectExamples, formatExamples, _test: { normalize, words, VARIANT_TYPES, reset: () => { cache = { at: 0, designs: [] }; } } };
