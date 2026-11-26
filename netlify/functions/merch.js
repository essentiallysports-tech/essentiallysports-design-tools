'use strict';
// Merch Designs: turn an ES story into fan-first merch and push it to the ES
// Fourthwall shop. Everyone signed in can design; pushing to Fourthwall is for
// admins and the emails in MERCH_PUSHERS. Products are always created HIDDEN;
// a person checks the mockups, then publishes.
//
// v2 (2026-11-26): five blanks (tee, hoodie, poster, sticker, mug), history in
// Supabase (_merch-store.js; memory until the migration runs), archive, list,
// collections, sales (webhook + daily sync), upload relay and product refresh.
//
// One endpoint, POST { mode, ... } (signed-in ES users only):
//   status      -> { configured, shop: { name, publicDomain, status } | null, canPush,
//                    caps: { person: {used, limit, left}, team: {...} }, rightsPolicy, blanks }
//   templates   { blank? } -> { templates: [{ blank, kind, label, templateId, printSpec: { ..., kind, minDpi,
//               wrap }, areas: [{ regionId, pixelsWidth, pixelsHeight, dpi, renderable, suitsLogo,
//               suitsDesign }], colors, sizes, basePrice, apparel, minDpi, wrap, logo: 'area'|'inside',
//               pricing: { suggested, margin, base } }] } (colors[].photos: up to 4 blank photos per colour,
//               merch4; no blank = all five; public Fourthwall
//               reads, cached 24 h). upload-url + register run once per image.
//   concepts    { content, trend?, collection?, count?, team?, designMode: 'basic'|'pro' }
//               -> { concepts: Concept[], plan: { idea, angle } | null, designMode, fellBack?, note? }
//               Basic: main tier (Haiku), 4 concepts, pills only. Pro: best tier (Sonnet), 6 concepts,
//               trend context, plan, optional elements; falls back to Basic on cap / free / AI error.
//               free mode: { free: true, concepts: null } (the browser uses MerchPrint.fallbackConcepts)
//   refine      { concept, instruction, content?, trend?, designMode, history? } -> { concept, note, designMode }
//               (simple instructions run in code at $0; free mode: code intents only)
//   moments     { sport? } -> { moments: [{ id, title, sport, team, kind, score, why, audience, timing, collection, lines:[{text,angle}], line, ai, trend }], at, cached }
//               (the Trends feed scored for merch: one main-tier call per batch, 30-min cache, heuristic in free mode)
//   (merch4) `content` is a string or the page's { text, url, trend }; `trend` may also be top-level.
//   brainstorm-open / -get / -turn / -line / -add / -list: the shared Brainstorm room
//               (_merch-brainstorm.js; boards in _merch-brainstorm-store.js). open { trend?, content?, designMode }
//               -> { session, context, created, cost }; turn { sessionId, prompt? | action?, designMode }
//               -> { lines, note, session, designMode, fellBack?, dropped, cost }; line { sessionId, lineId,
//               op: star|unstar|edit|remove, text? } -> { session }; add { sessionId, text } -> { line, session };
//               get { sessionId, withContext? } -> { session, context? }; list -> { sessions, storage }.
//   copy        { concept, content?, blank? } -> { copy: { title, description, retail, base, margin } }
//   upload-url  { fileName, size, contentType:'image/png' } -> { uploadUrl, fileUrl, expiresAt }   [push]
//               (the browser PUTs the PNG straight to uploadUrl)
//   register    { fileUrl, width, height, blank?, region? } -> { imageId, preview, thumbnail }             [push]
//   preview     { blank, imageId, region?, logo?: { region, imageId }, color? } -> { customizationId, images } [push]
//   create      { concept, content, blank, imageId, region?, logo?, title, description, retail, color?, ack } [push]
//               region = the design's print area (default: the front area); logo = the ES logo
//               in its own small area the person picks (templates -> areas[].suitsLogo).
//               -> { productId, state: 'HIDDEN', images, price: { retail, base, margin }, ack, productUrl }
//   publish / hide { productId } -> { product }                                                  [push]
//   product     { productId, refresh? } -> { product } (with its shop URL; refresh also updates the
//               stored mockups, variants, prices and state)
//   archive     { productId, confirm: true, confirmName? } -> { product: { productId, state: 'archived' } }
//               PERMANENT (DELETE /products/{id}); admins only; only products FrameUp made.   [admin]
//   list        { page? } -> { products: [{ productId, title, url, state ('hidden'|'public'|'private'|
//               'archived'), thumb, blank, color, createdAt, createdBy, units30, revenue30 }],
//               source: 'db'|'fourthwall', page, more }
//   collections -> { collections: [{ id, name, slug, count }] }
//   collection-create { name } -> { collection: { id, name, slug, count } }                     [push]
//   collection-set { productId, collectionIds: [] } -> { ok, collections: [{ id, name, count, has }],
//               changed: [ids] } (read-modify-write per collection: PUT replaces the whole list) [push]
//   sales       { productId? } -> { products: [{ productId, units7, revenue7, units30, revenue30,
//               unitsAll, revenueAll }], updatedAt, source: 'db'|'none' }
//   upload-relay { path: '<user id>/<file>.png', uploadUrl, size } -> { ok: true, size }          [push]
//               (the browser uploads to Supabase Storage merch-art first, when the direct PUT
//               to Fourthwall's storage fails on CORS; the server streams it on and deletes it)
//
// Env (server only): FOURTHWALL_API_USERNAME, FOURTHWALL_API_PASSWORD (Basic auth),
// MERCH_PUSHERS (comma-separated emails), MERCH_RIGHTS_POLICY ('acknowledge' default
// | 'strict'), MERCH_TEMPLATES ("tee=<template id>", optional pin), SUPABASE_SERVICE_ROLE_KEY
// (history, sales, upload relay; optional).

const crypto = require('node:crypto');
const { verifyEsUser, bearerToken, authConfig } = require('./_supabase-auth.js');
const {
  aiText, gatewayConfigured, isBudgetError, userOverHourlyLimit, aiSpendGate, featureDisabled,
  freeModeGate, inFreeMode, freeModeReason, withAiMode, logUsage,
} = require('./_ai-gateway.js');
const fourthwall = require('./_fourthwall.js');
const { BLANKS } = require('./_merch-templates.js');
const store = require('./_merch-store.js');
const { normalizeTrend, trendResearch } = require('./_trend-context.js');
// The ES merch design guidelines the AI follows (shared with the page).
const G = require('../../merch-guidelines.js');

let FrameUpRules = null;
try { FrameUpRules = require('../../frameup-rules.js'); } catch { FrameUpRules = null; }

// The DESIGN branch's merch-rules.js (rights, policy, pricing). Until it is
// merged, a minimal inline version with the same function names stands in.
let MerchRules = null;
try { MerchRules = require('../../merch-rules.js'); } catch { MerchRules = null; }

const FEATURES = Object.freeze({ concepts: 'merch-concepts', copy: 'merch-copy', refine: 'merch-refine', moments: 'merch-moments', brainstorm: 'merch-brainstorm', brainstormContext: 'merch-brainstorm-context' });
const AI_TIER = 'main'; // Haiku: the cheapest model that writes reliable JSON in ES voice
const PRO_TIER = 'best'; // Sonnet: Pro concepts and Pro refine (~$0.02 a concepts run, owner-approved)
const DESIGN_MODES = ['basic', 'pro'];
const COLLECTIONS = ['replay', 'nickname', 'quote', 'core', 'current'];
const COLOR_KEYS = ['a', 'b', 'ink', 'white', 'black'];
// A row colour: a key, or a '#RRGGBB' hex the person picked (stored uppercase). '' = invalid.
const rowColor = v => (COLOR_KEYS.includes(v) ? v : /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toUpperCase() : '');
const PALETTE_FROM_KINDS = ['team', 'es', 'custom'];
const RIGHTS_KINDS = ['name', 'nickname', 'quote', 'team'];
const LIMITS = Object.freeze({ body: 60000, content: 6000, rows: 10, rowText: 60, title: 80, desc: 600, why: 240, concepts: 6, basicConcepts: 4, elements: 3, instruction: 300, history: 4, label: 40, plan: 200, moments: 12, momentsScored: 18, momentsBatch: 6, uploadBytes: 25 * 1024 * 1024 });
const CAPS = Object.freeze({ person: 10, team: 30 });
const TEMPLATE_TTL_MS = 24 * 60 * 60 * 1000;
const SHOP_TTL_MS = 10 * 60 * 1000;
const AI_CACHE_TTL_MS = 30 * 60 * 1000;
const NOT_SET_UP = "Merch isn't connected to the ES Fourthwall shop yet. Ask an admin to add FOURTHWALL_API_USERNAME and FOURTHWALL_API_PASSWORD in Vercel. You can still design.";
const NO_PUSH = 'Only admins and approved people can send designs to the shop. Ask an admin to add you to MERCH_PUSHERS. You can still design and download.';

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
const clip = (v, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const HEX = /^#[0-9a-f]{6}$/i;
const round2 = n => Math.round(Number(n) * 100) / 100;
const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[‘’‛`]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9'%.$ ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ─── Inline rights / pricing fallback (used until merch-rules.js is merged) ──
const LEAGUE_MARKS = ['NFL', 'NBA', 'MLB', 'NHL', 'WNBA', 'NCAA', 'MLS', 'PGA', 'LPGA', 'UFC', 'NASCAR', 'FIFA', 'Super Bowl', 'World Series', 'Stanley Cup', 'March Madness', 'Final Four'];
const OFFICIAL_RE = /\b(official(ly)?|licensed|authentic|authorized|endorsed)\b|[®™©]/i;
const NUMBER_RE = /\d[\d,.]*/g;
const InlineRules = {
  RIGHTS_POLICY: 'acknowledge',
  ACK_STATEMENT: 'I checked these items. ES may print them on merch, the quotes are exact and attributed, and the numbers come from the source.',
  policyFrom(env = {}) { return String(env.MERCH_RIGHTS_POLICY || '').trim().toLowerCase() === 'strict' ? 'strict' : 'acknowledge'; },
  quoteInSource(quote, source) {
    const q = fold(quote).replace(/["']/g, '');
    return q.length >= 3 && fold(source).replace(/["']/g, '').includes(q);
  },
  scanConcept(concept = {}, { source = '', policy = 'acknowledge' } = {}) {
    const stack = Array.isArray(concept.stack) ? concept.stack : [];
    const dash = /^\s*[—–-]+\s*/;
    const lines = stack.map(r => clip(r?.text, 120)).filter(Boolean);
    const words = lines.join(' / ');
    const blocked = []; const warnings = [];
    const flag = (kind, text, reason, always = false) => {
      const list = always || policy === 'strict' ? blocked : warnings;
      if (!list.some(i => i.kind === kind && i.text === text)) list.push({ kind, text, reason });
    };
    LEAGUE_MARKS.forEach(m => { if (new RegExp(`(^|[^A-Za-z])${m}($|[^A-Za-z])`, 'i').test(words)) flag('league-mark', m, `"${m}" is a league or event trademark. ES merch can't print it.`, true); });
    if (OFFICIAL_RE.test(words)) flag('official', words.match(OFFICIAL_RE)[0], 'Words like "official" or "licensed" suggest a licence ES doesn’t have.', true);
    ((FrameUpRules && FrameUpRules.BANNED) || []).forEach(b => { if (b.re.test(words)) flag('banned', b.why, `Not ES style: ${b.why}.`, true); });
    if (concept.collection !== 'core') {
      const src = fold(source);
      const invented = [...new Set(words.match(NUMBER_RE) || [])].filter(n => !src.includes(fold(n)));
      if (invented.length) flag('number', invented.join(', '), `${invented.join(', ')} isn't in your source. Numbers on merch must come from the story.`, true);
    }
    if (concept.collection === 'quote') {
      const quote = stack.filter(r => r && !dash.test(String(r.text || ''))).map(r => r.text).join(' ');
      const by = stack.find(r => r && dash.test(String(r.text || '')));
      if (!InlineRules.quoteInSource(quote, source)) flag('quote-source', clip(quote, 300), 'A quote must be word for word from the source you pasted.', true);
      else if (!by) flag('quote-source', clip(quote, 300), 'Say who said it: quotes on ES merch are always attributed.', true);
    }
    (Array.isArray(concept.rights) ? concept.rights : []).forEach(r => {
      if (RIGHTS_KINDS.includes(r?.kind) && clip(r.text, 300)) flag(r.kind, clip(r.text, 300), r.kind === 'team' ? 'A team name is a trademark. Team colours are fine; the name means the team could object.' : 'A real person (name, nickname or words). Printing it can need their permission.');
    });
    return { policy, blocked, warnings, ok: blocked.length === 0 };
  },
  ackCovers(ack, scan) {
    if (!scan || scan.blocked?.length) return false;
    if (!scan.warnings?.length) return true;
    if (!ack || ack.accepted !== true) return false;
    const have = new Set((ack.items || []).map(i => `${i.kind}|${i.text}`));
    return scan.warnings.every(w => have.has(`${w.kind}|${w.text}`));
  },
  marginFor(retail, base) {
    const r = round2(retail); const b = round2(base);
    if (!(r > 0) || !(b >= 0)) return { ok: false, error: 'Type a price in dollars.' };
    if (r > 250) return { ok: false, error: 'Keep the price under $250.' };
    const margin = round2(r - b);
    if (margin < 1) return { ok: false, error: `The price must be at least $${(b + 1).toFixed(2)}: the blank costs $${b.toFixed(2)}.` };
    return { ok: true, retail: r, base: b, margin };
  },
};
const rules = () => ({
  policyFrom: MerchRules?.policyFrom || InlineRules.policyFrom,
  scanConcept: MerchRules?.scanConcept || InlineRules.scanConcept,
  ackCovers: MerchRules?.ackCovers || InlineRules.ackCovers,
  marginFor: MerchRules?.marginFor || InlineRules.marginFor,
  quoteInSource: MerchRules?.quoteInSource || InlineRules.quoteInSource,
  ACK_STATEMENT: MerchRules?.ACK_STATEMENT || InlineRules.ACK_STATEMENT,
});
const rightsPolicy = (env = process.env) => rules().policyFrom(env);

// ─── Who can push ───────────────────────────────────────────────────────────
function pushers(env = process.env) {
  return String(env.MERCH_PUSHERS || '').split(',').map(s => s.trim().toLowerCase()).filter(s => s.includes('@'));
}
// The database decides who is an admin (the RLS helper). Any failure = not an admin.
async function isAdmin(token) {
  if (!token) return false;
  try {
    const config = authConfig();
    const response = await fetch(`${config.url}/rest/v1/rpc/is_es_designer_admin`, {
      method: 'POST',
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return false;
    return (await response.json()) === true;
  } catch { return false; }
}
async function canPush(track, env = process.env) {
  if (pushers(env).includes(String(track.email || '').toLowerCase())) return true;
  return isAdmin(track.token);
}

// ─── Daily caps (code-side; this server's memory until the history table lands) ──
const DAILY = { day: '', team: 0, people: new Map() };
const HISTORY = []; // created products this instance knows about (newest first, max 100)
function today(now = new Date()) { return now.toISOString().slice(0, 10); }
function rollDay(now = new Date()) {
  const d = today(now);
  if (DAILY.day !== d) { DAILY.day = d; DAILY.team = 0; DAILY.people = new Map(); }
}
function caps(email, now = new Date()) {
  rollDay(now);
  const used = DAILY.people.get(String(email).toLowerCase()) || 0;
  return {
    person: { used, limit: CAPS.person, left: Math.max(0, CAPS.person - used) },
    team: { used: DAILY.team, limit: CAPS.team, left: Math.max(0, CAPS.team - DAILY.team) },
    resetsAt: `${DAILY.day}T23:59:59Z`,
  };
}
// Caps that survive cold starts: the higher of this instance's count and the
// history table's (when it exists).
async function capsFor(email, now = new Date()) {
  const c = caps(email, now);
  if (!store.available()) return c;
  const since = `${today(now)}T00:00:00Z`;
  const [mine, team] = await Promise.all([
    store.soft(() => store.createdSince(since, email), null, 'merch caps'),
    store.soft(() => store.createdSince(since), null, 'merch caps'),
  ]);
  const person = Math.max(c.person.used, Number(mine) || 0);
  const all = Math.max(c.team.used, Number(team) || 0);
  return {
    person: { used: person, limit: CAPS.person, left: Math.max(0, CAPS.person - person) },
    team: { used: all, limit: CAPS.team, left: Math.max(0, CAPS.team - all) },
    resetsAt: c.resetsAt,
  };
}
function countCreate(email, now = new Date()) {
  rollDay(now);
  const key = String(email).toLowerCase();
  DAILY.people.set(key, (DAILY.people.get(key) || 0) + 1);
  DAILY.team += 1;
}

// ─── Fourthwall client, shop and templates (cached) ─────────────────────────
let clientFactory = () => fourthwall.createClient();
const client = () => clientFactory();
const SHOP = { at: 0, data: null };
async function shopInfo() {
  if (SHOP.data && Date.now() - SHOP.at < SHOP_TTL_MS) return SHOP.data;
  const s = await client().shop();
  SHOP.data = { name: clip(s?.name, 120), publicDomain: clip(s?.publicDomain, 200), status: clip(s?.status, 40) };
  SHOP.at = Date.now();
  return SHOP.data;
}

function pinned(env = process.env) {
  const out = {};
  String(env.MERCH_TEMPLATES || '').split(',').forEach(part => {
    const [k, v] = part.split('=').map(s => String(s || '').trim());
    if (BLANKS[k] && /^[\w-]{3,80}$/.test(v)) out[k] = v;
  });
  return out;
}
// The printable area FrameUp draws on: available, backend-rendered, not embroidery.
function pickArea(template, prefer = []) {
  const areas = (Array.isArray(template?.customizableAreas) ? template.customizableAreas : []).filter(a => a && a.available
    && a.supportsBackendRendering !== false && !/EMBROIDERY/i.test(String(a.productionMethod || ''))
    && a.regionId && a.dimensions?.pixelsWidth > 0 && a.dimensions?.pixelsHeight > 0 && !/label|sleeve|wrist/i.test(a.regionId));
  for (const id of prefer) { const hit = areas.find(a => a.regionId === id); if (hit) return hit; }
  return areas.find(a => /front|default/i.test(a.regionId)) || null;
}
// Every non-embroidery print area the template offers (deduped by regionId,
// available first). Small areas (sleeves, neck labels, back neck) suit the ES
// logo; the person picks one. Only `renderable` areas can go on a product.
const LOGO_AREA_RE = /sleeve|neck|label|nape|pocket|chest_small|left_chest/i;
function listAreas(template, mainRegionId = '') {
  const out = new Map();
  (Array.isArray(template?.customizableAreas) ? template.customizableAreas : []).forEach(a => {
    if (!a?.regionId || /EMBROIDERY/i.test(String(a.productionMethod || '')) || !(a.dimensions?.pixelsWidth > 0)) return;
    const prev = out.get(a.regionId);
    if (prev && (prev.available || !a.available)) return;
    const d = a.dimensions;
    // The main print area is always the design area (a sticker's 900 x 900 is small but is the design).
    const small = a.regionId !== mainRegionId && (d.pixelsWidth * d.pixelsHeight <= 1200 * 1200 || LOGO_AREA_RE.test(a.regionId));
    out.set(a.regionId, {
      regionId: a.regionId, name: clip(a.name, 60), type: clip(a.type, 40), available: Boolean(a.available),
      renderable: a.supportsBackendRendering !== false, productionMethod: clip(a.productionMethod, 30),
      pixelsWidth: d.pixelsWidth, pixelsHeight: d.pixelsHeight, dpi: d.dpi, inchesWidth: d.inchesWidth, inchesHeight: d.inchesHeight,
      placements: (a.placements || []).map(p => ({ id: clip(p.id, 60), name: clip(p.name, 60) })).slice(0, 12),
      suitsLogo: small && a.available && a.supportsBackendRendering !== false,
      suitsDesign: !small && a.available && a.supportsBackendRendering !== false,
    });
  });
  return [...out.values()];
}
function qualifies(template, blank) {
  if (!template || template.supportsBackendRendering !== true) return false;
  if (Number(template.minimumOrdersNumber) > 0) return false;
  if (/EMBROIDERY/i.test(String(template.productionMethod || ''))) return false;
  return Boolean(pickArea(template, blank.regionPrefer));
}
// What every template reply carries per blank: print kind and checks for the
// print engine, the ES logo rule and the suggested price.
function blankInfo(kind, base) {
  const b = BLANKS[kind];
  const suggested = suggestedRetail(kind, base);
  const price = base == null ? { ok: false } : rules().marginFor(suggested, base);
  return {
    blank: kind, kind, label: b.label, apparel: b.apparel, minDpi: b.minDpi, wrap: b.wrap, logo: b.logo,
    pricing: { suggested, margin: price.ok ? price.margin : null, base: base == null ? null : round2(base) },
  };
}
// The blank's own photos for one colour (Fourthwall colorVariants[].photos[].url),
// for FrameUp's photo mockup when there is no live Fourthwall mockup.
const httpsPhoto = u => /^https:\/\/[^\s"'<>]{8,1500}$/.test(String(u || ''));
const photosOf = variant => [...new Set((Array.isArray(variant?.photos) ? variant.photos : []).map(p => String(p?.url || '')).filter(httpsPhoto))].slice(0, 4);
function normalizeTemplate(kind, t, source) {
  const blank = BLANKS[kind];
  const area = pickArea(t, blank.regionPrefer);
  const variants = (Array.isArray(t.colorVariants) ? t.colorVariants : []).filter(c => c && c.available !== false && c.color?.name && HEX.test(String(c.color.hex || '')));
  const sizes = [...new Set(variants.flatMap(c => (c.sizeVariants || []).filter(s => s.available !== false).map(s => s.size)))];
  const prices = variants.flatMap(c => (c.sizeVariants || []).map(s => Number(s?.price?.amount))).filter(n => Number.isFinite(n) && n > 0);
  const base = Number(t.priceFrom?.amount) || (prices.length ? Math.min(...prices) : null);
  // Verified on a real shop (owner's ~/fourthwall-merch, 2026-11-25): PLACEMENT_ID + largeCenter on the tee's front_large.
  const placementId = (blank.placementPrefer || []).find(id => (area.placements || []).some(p => p && p.id === id));
  return {
    ...blankInfo(kind, base), source,
    templateId: t.productId, name: clip(t.name, 120), brand: clip(t.brand, 60), productionMethod: clip(t.productionMethod, 30),
    basePrice: base == null ? null : round2(base), currency: t.priceFrom?.currency || 'USD',
    printSpec: {
      templateId: t.productId, region: 'front', regionId: area.regionId,
      pixelsWidth: area.dimensions.pixelsWidth, pixelsHeight: area.dimensions.pixelsHeight, dpi: area.dimensions.dpi,
      inchesWidth: area.dimensions.inchesWidth, inchesHeight: area.dimensions.inchesHeight,
      ...(placementId ? { placementStrategy: 'PLACEMENT_ID', placementId } : { placementStrategy: blank.placementStrategy }),
      garmentColor: '#ffffff', kind, minDpi: blank.minDpi, wrap: blank.wrap,
    },
    areas: listAreas(t, area.regionId),
    colors: variants.map(c => ({ name: clip(c.color.name, 60), hex: String(c.color.hex).toLowerCase(), photos: photosOf(c) })),
    defaultColor: blank.defaultColor, sizes,
  };
}
function snapshotTemplate(kind) {
  const b = BLANKS[kind]; const s = b.snapshot;
  return {
    ...blankInfo(kind, s.basePrice), source: 'snapshot', templateId: s.templateId, name: s.name, brand: s.brand, productionMethod: s.productionMethod,
    basePrice: s.basePrice, currency: s.currency,
    printSpec: {
      templateId: s.templateId, region: 'front', regionId: s.regionId, pixelsWidth: s.pixelsWidth, pixelsHeight: s.pixelsHeight, dpi: s.dpi, inchesWidth: s.inchesWidth, inchesHeight: s.inchesHeight,
      ...(s.placementId ? { placementStrategy: 'PLACEMENT_ID', placementId: s.placementId } : { placementStrategy: b.placementStrategy }),
      garmentColor: '#ffffff', kind, minDpi: b.minDpi, wrap: b.wrap,
    },
    areas: s.areas.map(a => ({ ...a, placements: [] })),
    colors: s.colors.map(c => ({ name: c.name, hex: c.hex, photos: (Array.isArray(c.photos) ? c.photos : []).filter(httpsPhoto).slice(0, 4) })), defaultColor: b.defaultColor, sizes: s.sizes.slice(),
  };
}
const TEMPLATES = new Map(); // kind -> { at, data }
async function templateFor(kind, env = process.env) {
  const hit = TEMPLATES.get(kind);
  if (hit && Date.now() - hit.at < TEMPLATE_TTL_MS && hit.data.source !== 'snapshot') return hit.data;
  const blank = BLANKS[kind];
  const ids = [pinned(env)[kind], ...blank.ids].filter(Boolean);
  const fw = client();
  let reached = false;
  for (const id of ids) {
    try {
      const t = await fw.template(id);
      reached = true;
      if (qualifies(t, blank)) { const data = normalizeTemplate(kind, t, id === pinned(env)[kind] ? 'pinned' : 'curated'); TEMPLATES.set(kind, { at: Date.now(), data }); return data; }
    } catch (error) { if (error.reason !== 'not-found' && error.status !== 409) continue; reached = true; }
  }
  // Fallback search: the first blank in the right category that qualifies.
  try {
    const list = await fw.searchTemplates(blank.search);
    reached = true;
    const candidates = (list?.results || []).filter(r => r.supportsBackendRendering && String(r.category || '').startsWith(blank.category) && !/EMBROIDERY/i.test(r.productionMethod)).slice(0, 4);
    for (const c of candidates) {
      const t = await fw.template(c.productId).catch(() => null);
      if (qualifies(t, blank)) { const data = normalizeTemplate(kind, t, 'search'); TEMPLATES.set(kind, { at: Date.now(), data }); return data; }
    }
  } catch { /* fall through to the snapshot */ }
  const data = { ...snapshotTemplate(kind), ...(reached ? { note: 'The usual blank is not offered right now; sizes are from the last check.' } : { note: "Couldn't reach Fourthwall; sizes are from the last check." }) };
  TEMPLATES.set(kind, { at: Date.now(), data });
  return data;
}

// ─── Content, trend and the source corpus ──────────────────────────────────
// `content` is a string or the page's { text, url, trend } (v3 pages send the
// object). The source corpus for the number / quote checks is the person's
// text plus the trend's real headlines (never its AI-written angle ideas).
function contentOf(body = {}) {
  const c = body.content;
  if (typeof c === 'string') return clip(c, LIMITS.content);
  if (c && typeof c === 'object') return clip(c.text, LIMITS.content);
  return '';
}
function trendOf(body = {}) {
  const raw = body.trend || (body.content && typeof body.content === 'object' ? body.content.trend : null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return normalizeTrend({ ...raw, category: raw.category || raw.sport || '' }, '');
}
function sourceFor(content, trend) {
  const corpus = trend ? trendResearch(trend).corpus : '';
  return [content, corpus].filter(Boolean).join('\n');
}
function designModeOf(body = {}) {
  const v = String(body.designMode || body.tier || '').toLowerCase();
  return v === 'pro' || body.pro === true ? 'pro' : 'basic';
}

// ─── Concept validation (strict) ────────────────────────────────────────────
const numberInSource = (n, source) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(String(source || ''));
// Pro elements: known types, positions, colours and icons only; at most 3, one
// of each type. A number must be 1-2 digits that are in the source; an
// invented one rejects the whole design (like an invented number in a row).
function shapeElements(list, source) {
  const out = []; let dropped = 0; let invented = '';
  for (const e of (Array.isArray(list) ? list : []).slice(0, 8)) {
    const type = String(e?.type || '');
    const R = G.ELEMENT_RULES[type];
    const color = String(e?.color || '');
    const position = String(e?.position || '');
    if (!R || !G.ELEMENT_COLORS.includes(color) || !R.positions.includes(position) || out.some(x => x.type === type) || out.length >= LIMITS.elements) { dropped += 1; continue; }
    if (type === 'number') {
      const text = String(e.text ?? '').trim();
      const style = e.style == null ? 'solid' : String(e.style);
      if (!/^\d{1,2}$/.test(text) || !R.style.includes(style)) { dropped += 1; continue; }
      if (!numberInSource(text, source)) { invented = text; break; }
      out.push({ type, text, style, color, position });
    } else if (type === 'rule') {
      const weight = e.weight == null ? 'thin' : String(e.weight);
      if (!R.weight.includes(weight)) { dropped += 1; continue; }
      out.push({ type, position, color, weight });
    } else if (type === 'block') {
      out.push({ type, position, color });
    } else if (type === 'icon') {
      const name = String(e.name || '');
      if (!G.ICONS.includes(name)) { dropped += 1; continue; }
      out.push({ type, name, position, color });
    }
  }
  return { elements: out, dropped, invented };
}
function shapeFit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const n = Number(raw.scale);
  const scale = n > 0 ? Math.min(G.LIMITS.fitScaleMax, Math.max(G.LIMITS.fitScaleMin, Math.round(n * 100) / 100)) : 1;
  const t = raw.topIn;
  const topIn = t === null || t === undefined || t === '' || !Number.isFinite(Number(t)) ? null : Math.min(G.LIMITS.fitTopMaxIn, Math.max(G.LIMITS.fitTopMinIn, Math.round(Number(t) * 10) / 10));
  return { scale, topIn };
}
// Where the pill colours came from (the page's picker): { kind: 'team'|'es'|'custom',
// sport?, team?, index? }. Anything else is dropped.
function shapePaletteFrom(raw) {
  if (!raw || typeof raw !== 'object' || !PALETTE_FROM_KINDS.includes(raw.kind)) return null;
  const out = { kind: raw.kind };
  const sport = typeof raw.sport === 'string' ? clip(raw.sport, 40) : '';
  const team = typeof raw.team === 'string' ? clip(raw.team, 80) : '';
  if (sport) out.sport = sport;
  if (team) out.team = team;
  const index = Number(raw.index);
  if (raw.index != null && raw.index !== '' && Number.isInteger(index) && index >= 0 && index < 32) out.index = index;
  return out;
}
// opts.mode: the design mode the reply is for ('basic' strips every element);
// without it the concept's own `mode` decides (copy / create keep what they get).
// opts.repair: fix pill colours that melt into the garment (off for copy / create).
// Repair only changes colour keys: a hex a person picked is kept (the page's print checks flag it).
function shapeConcept(raw, { content = '', policy = 'acknowledge', mode, repair = true } = {}) {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const collection = String(raw.collection || '').toLowerCase();
  if (!COLLECTIONS.includes(collection)) return { error: 'collection' };
  const title = clip(raw.title, LIMITS.title);
  if (!title) return { error: 'title' };
  let team = null;
  if (raw.team && typeof raw.team === 'object') {
    const name = clip(raw.team.name, 80);
    if (!name) return { error: 'team' };
    team = { id: clip(raw.team.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 60), name };
  } else if (raw.team != null) return { error: 'team' };
  const p = raw.palette || {};
  if (![p.a, p.b, p.ink].every(c => HEX.test(String(c || '')))) return { error: 'palette' };
  const palette = { a: p.a.toLowerCase(), b: p.b.toLowerCase(), ink: p.ink.toLowerCase() };
  const g = raw.garment || {};
  if (!HEX.test(String(g.color || ''))) return { error: 'garment' };
  const garment = { color: g.color.toLowerCase(), name: clip(g.name, 40) || 'White' };
  if (!Array.isArray(raw.stack) || !raw.stack.length || raw.stack.length > LIMITS.rows) return { error: 'stack' };
  const stack = [];
  for (const r of raw.stack) {
    const text = clip(r?.text, LIMITS.rowText);
    const fill = rowColor(r?.fill);
    const ink = rowColor(r?.ink);
    if (!text || !['big', 'mid', 'small'].includes(r.size) || !fill || !ink) return { error: 'row' };
    // Fill and ink compared as colours: the same key, or a hex equal to the other side.
    if (fill === ink || ((HEX.test(fill) || HEX.test(ink)) && G.colorOf(fill, palette) === G.colorOf(ink, palette))) return { error: 'row' };
    stack.push({ text, size: r.size, fill, ink });
  }
  const align = raw.align === 'center' ? 'center' : (raw.align === 'left' || raw.align == null ? 'left' : null);
  if (!align) return { error: 'align' };
  const blanks = [...new Set((Array.isArray(raw.blanks) ? raw.blanks : []).filter(b => BLANKS[b]))];
  if (!blanks.length) blanks.push('tee');
  const rights = (Array.isArray(raw.rights) ? raw.rights : []).filter(r => RIGHTS_KINDS.includes(r?.kind) && clip(r.text, 300)).map(r => ({ kind: r.kind, text: clip(r.text, 300) })).slice(0, 8);
  if (team && !rights.some(r => r.kind === 'team')) rights.push({ kind: 'team', text: team.name });
  const designMode = DESIGN_MODES.includes(mode) ? mode : (raw.mode === 'pro' ? 'pro' : 'basic');
  let concept = { id: `mc-${crypto.randomUUID().slice(0, 8)}`, collection, title, team, palette, garment, stack, align, blanks, rights, why: clip(raw.why, LIMITS.why), mode: designMode };
  const label = clip(raw.label, LIMITS.label);
  if (label) concept.label = label;
  const from = shapePaletteFrom(raw.paletteFrom);
  if (from) concept.paletteFrom = from;
  const fit = shapeFit(raw.fit);
  if (fit) concept.fit = fit;
  let droppedElements = 0;
  if (designMode === 'pro' && Array.isArray(raw.elements)) {
    const el = shapeElements(raw.elements, content);
    if (el.invented) return { error: `blocked: number (element ${el.invented})` };
    if (el.elements.length) concept.elements = el.elements;
    droppedElements = el.dropped;
  }
  // The colour rule: every pill stands off the garment, every word off its pill.
  // (copy / create keep the colours as drawn: the print file is already made.)
  if (repair) concept = G.repairContrast(concept).concept;
  const scan = rules().scanConcept(concept, { source: content, policy });
  if (scan.blocked?.length) return { error: `blocked: ${scan.blocked.map(b => b.kind).join(', ')}` };
  // Add what the scan found (names, nicknames, quotes, teams) to the rights list.
  (scan.warnings || []).forEach(w => { if (RIGHTS_KINDS.includes(w.kind) && !concept.rights.some(r => r.kind === w.kind && r.text === w.text)) concept.rights.push({ kind: w.kind, text: w.text }); });
  return { concept, droppedElements };
}
// Plain words for a shape error (refine replies show it).
function shapeErrorText(error = '') {
  if (/number/.test(error)) return "That change would put a number on the design that isn't in your story. Numbers on merch must come from the story.";
  if (/quote/.test(error)) return 'That change would use a quote that isn\'t word for word in your story. Quotes on merch must be exact.';
  if (/league-mark|official|banned/.test(error)) return 'That change would add a league mark, "official" or words ES merch never uses. Try saying it another way.';
  return "The AI's change didn't fit the ES design rules. Try saying it another way.";
}

// ─── AI: concepts, refine, moments and copy ────────────────────────────────
const VOICE = (FrameUpRules?.VOICE || []).join('\n');

function parseJson(raw) {
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch { /* fall through */ }
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; } }
  return null;
}
const AI_CACHE = new Map();
function cacheGet(key) { const hit = AI_CACHE.get(key); if (!hit || Date.now() - hit.at > AI_CACHE_TTL_MS) { AI_CACHE.delete(key); return null; } return hit.data; }
function cacheSet(key, data) { AI_CACHE.set(key, { at: Date.now(), data }); if (AI_CACHE.size > 100) AI_CACHE.delete(AI_CACHE.keys().next().value); }
const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
const usd = n => Number((Number(n) || 0).toFixed(6));

// Shared AI gate (switch-off, weekly budget -> free mode, hourly limit).
// Returns { free: reason, budget } or { reply } when the AI can't run.
async function aiGate(feature, track) {
  if (featureDisabled(feature)) return { free: 'feature-off', budget: 'feature-off' };
  const gate = process.env.AI_GATEWAY_API_KEY && !inFreeMode() ? await aiSpendGate(track.token, { feature }) : null;
  if (inFreeMode() || freeModeGate(gate)) return { free: 'free', budget: gate?.free || freeModeReason() || 'free' };
  if (gate) return { reply: json(gate.status, { ok: false, reason: gate.reason, error: gate.error }) };
  if (!gatewayConfigured()) return { free: 'off', budget: 'off' };
  if (await userOverHourlyLimit(track.token)) return { reply: json(429, { ok: false, reason: 'limit', error: "You've used a lot of AI this hour. Take a short break and try again soon." }), hourly: true };
  return null;
}
// Why Pro fell back: the person's weekly cap, or free mode / AI off for everyone.
const fellBackFor = gate => (gate?.budget === 'user-limit' ? 'cap' : 'free');
const PRO_NOTES = {
  cap: "You've used this week's AI budget, so Pro is paused. These designs are Basic, made without AI.",
  free: 'Pro needs AI, which is paused right now. These designs are Basic, made without AI.',
  ai: "Pro couldn't finish this time, so these are Basic designs. Try Pro again in a moment.",
};

// The trends feed (the Trends page's data, same cache). Tests swap it.
let trendsSource = force => require('./trend-design.js').getTrends(force);
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref?.())]);
// Pro: the chip sends { id, title, sport }; the feed has the related headlines.
async function fullTrend(trend) {
  if (!trend || trend.related.length || !trend.id) return trend;
  try {
    const feed = await withTimeout(Promise.resolve(trendsSource(false)), 3000);
    const item = (feed?.items || []).find(i => String(i?.id) === trend.id);
    return item ? (normalizeTrend(item, '') || trend) : trend;
  } catch { return trend; }
}

function shapePlan(raw, concepts) {
  const idea = clip(raw?.idea, LIMITS.plan);
  const angle = clip(raw?.angle, LIMITS.plan);
  const bad = t => OFFICIAL_RE.test(t) || ((FrameUpRules?.BANNED) || []).some(b => b.re.test(t));
  if (idea && angle && !bad(`${idea} ${angle}`)) return { idea, angle };
  const first = concepts[0];
  return first ? { idea: first.title, angle: first.why || '' } : null;
}

// One concepts run in one design mode. Returns { concepts, plan, dropped, model, cost }
// or { error: 'free' | 'ai' | 'garbled' | 'invalid', cost, dropped }.
async function runConcepts(designMode, { content, source, collection, count, team, research, policy, track }) {
  const pro = designMode === 'pro';
  const n = pro ? LIMITS.concepts : count;
  const ask = [
    `Source (the only facts, numbers and quotes you may use, plus any word or number already on the design):\n"""${content}"""`,
    research ? research.section : '',
    pro && research?.ideas ? research.ideas : '',
    collection ? `Collection: ${collection}.` : 'Mix the collections that fit the source.',
    team?.name ? `Team: ${team.name}${team.a ? `, colours ${team.a} and ${team.b || '#ffffff'}` : ''}.` : '',
    pro ? `Return the plan and ${n} concepts, each a different layout. At most half of them may use elements.` : `Return ${n} concepts.`,
  ].filter(Boolean).join('\n');
  let result;
  try {
    result = await aiText({
      tier: pro ? PRO_TIER : AI_TIER, system: pro ? G.PRO_SYSTEM : G.BASIC_SYSTEM, messages: [{ role: 'user', content: ask }], json: true,
      maxTokens: pro ? 8000 : 5000, timeoutMs: pro ? 90000 : 60000, cacheSystem: true, track: { ...track, feature: FEATURES.concepts, task: pro ? 'merch-concepts-pro' : 'merch-concepts-basic' },
    });
  } catch (error) {
    if (inFreeMode() || isBudgetError(error)) return { error: 'free', cost: 0 };
    console.error(`merch concepts (${designMode}) failed:`, error.message);
    return { error: 'ai', cost: 0 };
  }
  const cost = Number(result.cost || 0);
  const parsed = parseJson(result.text);
  const list = Array.isArray(parsed?.concepts) ? parsed.concepts.slice(0, LIMITS.concepts) : null;
  if (!list) return { error: 'garbled', cost };
  const shaped = list.map(c => shapeConcept(c, { content: source, policy, mode: designMode }));
  const concepts = shaped.filter(s => s.concept).map(s => s.concept);
  if (!concepts.length) return { error: 'invalid', cost, dropped: shaped.length };
  return { concepts, plan: pro ? shapePlan(parsed.plan, concepts) : null, dropped: shaped.length - concepts.length, model: result.model, cost };
}

async function conceptsMode(body, track) {
  let content = contentOf(body);
  const trend = trendOf(body);
  if (content.length < 20 && !(trend && content.length + trend.title.length >= 20)) return json(400, { ok: false, reason: 'input', error: 'Paste the story, quote or moment first (a sentence or more).' });
  if (content.length < 3 && trend) content = trend.title;
  const want = designModeOf(body);
  const collection = COLLECTIONS.includes(body.collection) ? body.collection : '';
  const count = Math.max(1, Math.min(LIMITS.concepts, Math.round(Number(body.count) || LIMITS.basicConcepts)));
  const team = body.team && typeof body.team === 'object' ? { name: clip(body.team.name, 80), a: HEX.test(body.team.a) ? body.team.a : '', b: HEX.test(body.team.b) ? body.team.b : '' } : null;
  const policy = rightsPolicy();
  const freeReply = (reason, fellBack = '', cost = 0, extra = {}) => json(200, {
    ok: true, free: true, reason, concepts: null, plan: null, designMode: 'basic', mode: 'basic',
    ...(fellBack ? { fellBack, note: PRO_NOTES[fellBack] } : {}), ...extra, cost: { usd: usd(cost), cached: false },
  });
  const key = `c|${hash(`${content}|${trend ? `${trend.id}|${trend.title}|${trend.related.length}` : ''}|${collection}|${count}|${JSON.stringify(team)}|${policy}|${want}|${G.VERSION}`)}`;
  const hit = cacheGet(key);
  if (hit) return json(200, { ...hit, concepts: hit.concepts.map(c => ({ ...c, id: `mc-${crypto.randomUUID().slice(0, 8)}` })), cost: { usd: 0, cached: true } });
  const gate = await aiGate(FEATURES.concepts, track);
  if (gate?.free) return freeReply(gate.free, want === 'pro' ? fellBackFor(gate) : '');
  if (gate?.reply) return gate.reply;
  const full = want === 'pro' ? await fullTrend(trend) : trend;
  const source = sourceFor(content, full);
  const research = full ? trendResearch(full) : null;
  const args = { content, source, collection, count, team, research, policy, track };
  let run = await runConcepts(want, args);
  let used = want; let fellBack = ''; let spent = run.cost || 0;
  if (run.error && want === 'pro') {
    if (run.error === 'free') return freeReply('budget', 'free', spent);
    // Pro failed (error, garbled or nothing valid): one Basic run instead.
    fellBack = 'ai'; used = 'basic';
    run = await runConcepts('basic', args);
    spent += run.cost || 0;
  }
  if (run.error === 'free') return freeReply('budget', fellBack, spent);
  if (run.error === 'ai') return json(502, { ok: false, reason: 'ai', error: "The AI couldn't come up with designs right now. Try again, or start from the ready-made designs." });
  if (run.error === 'garbled') return json(502, { ok: false, reason: 'ai', error: "The AI's answer came back garbled. Try again in a moment." });
  if (run.error === 'invalid') return freeReply('ai-invalid', fellBack, spent, { dropped: run.dropped });
  const data = { ok: true, ai: true, concepts: run.concepts, plan: run.plan, dropped: run.dropped, model: run.model, designMode: used, mode: used, ...(fellBack ? { fellBack, note: PRO_NOTES[fellBack] } : {}) };
  cacheSet(key, data);
  return json(200, { ...data, cost: { usd: usd(spent), cached: false } });
}

// ─── Refine: change one design by typing ────────────────────────────────────
// Simple instructions run in code ($0, also in free mode); anything else goes
// to the AI (Basic: main tier, Pro: best tier).
const INTENT_WORDS = [
  ['swap', /^(swap|switch|flip|reverse|invert)( the)?( two)?( team)? colou?rs?$|^colou?rs? (swapped|flipped)$/],
  ['center', /^(centre|center)( it| the (text|design|stack|words))?( align(ed)?)?$|^align (it )?(centre|center)$|^(centred|centered)$/],
  ['left', /^(left|left align(ed)?|align (it )?left|left aligned)$/],
  ['shorter', /^(shorter|make it shorter|shorten( it)?|fewer (rows|lines)|less text)$/],
  ['bigger', /^(bigger|larger|make it (bigger|larger)|scale (it )?up)$/],
  ['smaller', /^(smaller|make it smaller|scale (it )?down)$/],
  ['white', /^((on |use |make it |put it on )?(a )?white (tee|shirt|t ?shirt))$/],
  ['black', /^((on |use |make it |put it on )?(a )?black (tee|shirt|t ?shirt))$/],
];
function codeIntent(instruction) {
  const s = String(instruction || '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(please |can you |could you )+/, '').replace(/( please| thanks| thank you)+$/, '').trim();
  return (INTENT_WORDS.find(([, re]) => re.test(s)) || [])[0] || '';
}
const TEE = { white: { color: '#ffffff', name: 'White' }, black: { color: '#020202', name: 'Black' } };
// Returns { concept, note } or null when the intent changes nothing.
function applyIntent(intent, concept) {
  const c = { ...concept, stack: concept.stack.map(r => ({ ...r })), palette: { ...concept.palette }, garment: { ...concept.garment } };
  const scale = (concept.fit?.scale) || 1;
  let note = '';
  if (intent === 'swap') { c.palette = { ...c.palette, a: concept.palette.b, b: concept.palette.a }; note = 'Swapped the two team colours.'; }
  else if (intent === 'center') { if (c.align === 'center') return null; c.align = 'center'; note = 'Centred the stack.'; }
  else if (intent === 'left') { if (c.align === 'left') return null; c.align = 'left'; note = 'Aligned the stack left.'; }
  else if (intent === 'shorter') {
    const keep = c.stack.filter(r => r.size !== 'small');
    if (!keep.length || keep.length === c.stack.length) return null;
    c.stack = keep; note = 'Dropped the small rows.';
  } else if (intent === 'bigger' || intent === 'smaller') {
    const next = Math.round(Math.min(G.LIMITS.fitScaleMax, Math.max(G.LIMITS.fitScaleMin, scale * (intent === 'bigger' ? 1.15 : 0.87))) * 100) / 100;
    if (next === scale) return null;
    c.fit = { scale: next, topIn: concept.fit?.topIn ?? null }; note = intent === 'bigger' ? 'Made the print bigger.' : 'Made the print smaller.';
  } else if (intent === 'white' || intent === 'black') {
    if (c.garment.color === TEE[intent].color) return null;
    c.garment = { ...TEE[intent] }; note = `Put it on a ${intent} tee.`;
  } else return null;
  const fixed = G.repairContrast(c);
  return { concept: fixed.concept, note: fixed.fixed ? `${note} Adjusted pill colours so they stand off the shirt.` : note };
}
const FREE_REFINE = "Without AI, FrameUp can make simple changes: swap colours, centre, left, shorter, bigger, smaller, white tee or black tee. Try one of those, or edit the design yourself.";
const conceptId = id => (/^[\w-]{3,60}$/.test(String(id || '')) ? String(id) : '');

async function runRefine(designMode, { base, instruction, history, content, research, source, policy, track }) {
  const pro = designMode === 'pro';
  const { id, rights, ...design } = base;
  const ask = [
    `Source (the only facts, numbers and quotes you may use):\n"""${content}"""`,
    research ? research.section : '',
    `The design now (JSON): ${JSON.stringify(pro ? design : { ...design, elements: undefined })}`,
    history.length ? `Earlier requests in this chat (already applied): ${history.map(h => `"${h}"`).join('; ')}` : '',
    `Change: """${instruction}"""`,
  ].filter(Boolean).join('\n');
  let result;
  try {
    result = await aiText({ tier: pro ? PRO_TIER : AI_TIER, system: G.refineSystem(designMode), messages: [{ role: 'user', content: ask }], json: true, maxTokens: 3000, timeoutMs: 45000, cacheSystem: true, track: { ...track, feature: FEATURES.refine, task: pro ? 'merch-refine-pro' : 'merch-refine-basic' } });
  } catch (error) {
    if (inFreeMode() || isBudgetError(error)) return { error: 'free', cost: 0 };
    console.error(`merch refine (${designMode}) failed:`, error.message);
    return { error: 'ai', cost: 0 };
  }
  const cost = Number(result.cost || 0);
  const p = parseJson(result.text);
  if (!p?.concept || typeof p.concept !== 'object') return { error: 'garbled', cost };
  // Fields the AI left out keep their old values.
  const merged = { ...base, ...p.concept, rights: Array.isArray(p.concept.rights) ? p.concept.rights : base.rights };
  const shaped = shapeConcept(merged, { content: source, policy, mode: designMode });
  if (!shaped.concept) return { error: 'invalid', detail: shaped.error, cost };
  let note = clip(p.note, 160);
  if (!note || OFFICIAL_RE.test(note) || ((FrameUpRules?.BANNED) || []).some(b => b.re.test(note))) note = 'Updated the design.';
  return { concept: { ...shaped.concept, id: base.id }, note, model: result.model, cost };
}

async function refineMode(body, track) {
  const content = contentOf(body);
  const trend = trendOf(body);
  const source = sourceFor(content, trend);
  const want = designModeOf(body);
  const policy = rightsPolicy();
  const instruction = clip(body.instruction, LIMITS.instruction + 1);
  if (instruction.length < 2) return json(400, { ok: false, reason: 'input', error: 'Type what to change, for example "use Lakers colours" or "shorter".' });
  if (instruction.length > LIMITS.instruction) return json(400, { ok: false, reason: 'input', error: `Keep the change under ${LIMITS.instruction} characters.` });
  // Words and numbers already on the design are the person's (made by FrameUp
  // or typed in the pill editor): they count as source, so only what the AI
  // adds is checked against the story.
  const own = (Array.isArray(body.concept?.stack) ? body.concept.stack : []).map(r => clip(r?.text, LIMITS.rowText))
    .concat((Array.isArray(body.concept?.elements) ? body.concept.elements : []).map(e => clip(e?.text, 4))).filter(Boolean).join(' / ');
  const sourcePlus = own ? `${source}\n${own}` : source;
  const shaped = shapeConcept(body.concept, { content: sourcePlus, policy, mode: want });
  if (!shaped.concept) return json(400, { ok: false, reason: 'concept', error: 'The AI can’t edit this design: it has a league mark, an “official” claim or a blocked word. Change those pills yourself, then ask again.' });
  const base = { ...shaped.concept, id: conceptId(body.concept?.id) || shaped.concept.id };
  const history = (Array.isArray(body.history) ? body.history : []).slice(-LIMITS.history).map(h => clip(h, LIMITS.instruction)).filter(Boolean);
  const reply = (concept, note, extra = {}, cost = 0, cached = false) => json(200, { ok: true, concept, note, designMode: concept.mode, mode: concept.mode, ...extra, cost: { usd: usd(cost), cached } });
  const intent = codeIntent(instruction);
  const done = intent ? applyIntent(intent, base) : null;
  if (done) return reply(done.concept, done.note, { ai: false, intent });
  const freeReply = (fellBack = '', error = FREE_REFINE) => json(200, { ok: true, free: true, concept: null, error: intent && !done ? 'That is already how the design looks. Try another change.' : error, designMode: want, mode: want, ...(fellBack ? { fellBack } : {}), cost: { usd: 0, cached: false } });
  const gate = await aiGate(FEATURES.refine, track);
  if (gate?.free) return freeReply(want === 'pro' ? fellBackFor(gate) : '');
  if (gate?.reply) return gate.reply;
  const key = `r|${hash(`${JSON.stringify({ ...base, id: '' })}|${instruction}|${history.join('|')}|${source}|${want}|${policy}|${G.VERSION}`)}`;
  const hit = cacheGet(key);
  if (hit) return reply({ ...hit.concept, id: base.id }, hit.note, { ai: true, ...(hit.fellBack ? { fellBack: hit.fellBack } : {}) }, 0, true);
  const research = trend ? trendResearch(trend) : null;
  const args = { base, instruction, history, content, research, source: sourcePlus, policy, track };
  let run = await runRefine(want, args);
  let spent = run.cost || 0; let fellBack = '';
  if (run.error && run.error !== 'free' && run.error !== 'invalid' && want === 'pro') {
    fellBack = 'ai';
    run = await runRefine('basic', { ...args, base: { ...base, mode: 'basic', elements: undefined } });
    spent += run.cost || 0;
  }
  if (run.error === 'free') return freeReply(want === 'pro' ? 'free' : '');
  if (run.error === 'invalid') return json(422, { ok: false, reason: 'invalid', error: shapeErrorText(run.detail), cost: { usd: usd(spent), cached: false } });
  if (run.error) return json(502, { ok: false, reason: 'ai', error: "The AI couldn't change the design right now. Try again, or edit it yourself.", cost: { usd: usd(spent), cached: false } });
  cacheSet(key, { concept: run.concept, note: run.note, fellBack });
  return reply(run.concept, run.note, { ai: true, model: run.model, ...(fellBack ? { fellBack } : {}) }, spent);
}

// ─── Moments: merch-worthy trends ───────────────────────────────────────────
// The Trends page feed, scored for merch. One main-tier call scores the
// headlines not seen in the last 30 minutes (shared by everyone on the
// instance); free mode, AI off, the hourly limit or an AI error use the
// heuristic scorer. Never an error because of the AI.
const MOMENT_KINDS = ['quote', 'nickname', 'moment', 'era', 'stat', 'rivalry'];
const SPORT_LABEL = { nfl: 'NFL', cfb: 'College Football', mlb: 'MLB', golf: 'Golf', tennis: 'Tennis', others: 'Others' };
const MOMENT_TTL_MS = 30 * 60 * 1000;
const MOMENT_SCORES = new Map(); // 'v2:' + trend id -> { at, data: { kind, score, why, audience, timing, collection, lines, line, ai } }
const MOMENT_ANGLES = ['quote', 'nickname', 'chant', 'callback', 'pun', 'stat', 'rivalry', 'era'];
const MOMENT_TIMING = ['now', 'week', 'season', 'evergreen'];
const MOMENT_WHY = {
  quote: 'A line fans can quote back, word for word.',
  nickname: 'A name only real fans use: almost-famous merch.',
  moment: 'A moment fans will want to relive on a shirt.',
  era: 'An era fans still talk about: replay merch.',
  stat: 'A number fans will recognise at a glance.',
  rivalry: 'Rivalry week: fans pick a side.',
};
const LOW_MERCH = /\b(odds|betting|picks?|prediction|fantasy|waiver|injury report|injur(y|ies|ed)|questionable|ruled out|mock draft|power rankings?|rankings?|contract|salary|tickets?|how to watch|tv channel|live stream|start time|schedule|stats? leaders)\b/i;
const momentWords = s => fold(s).replace(/["'.%$]/g, ' ').split(' ').filter(Boolean);
const quoteIn = title => {
  const m = String(title).match(/[“"]([^”"]{3,60})[”"]/);
  return m ? m[1].trim() : '';
};
// A shirt line from the headline's own words.
function headlineLine(title) {
  const q = quoteIn(title);
  if (q && q.split(/\s+/).length <= 6) return q.toUpperCase();
  const lead = String(title).split(/\s[:|–—-]\s|:\s/)[0];
  const names = lead.match(/\b[A-Z][a-zA-Z'’.]+(?:\s+[A-Z][a-zA-Z'’.]+){0,2}\b/g) || [];
  const isMark = t => LEAGUE_MARKS.some(m => new RegExp(`^${m}$`, 'i').test(t.trim())) || /^(week|playoff|picture|the|a)$/i.test(t.trim());
  const pick = names.filter(n => !isMark(n) && !LEAGUE_MARKS.some(m => new RegExp(`(^|\\s)${m}(\\s|$)`, 'i').test(n))).sort((a, b) => b.split(' ').length - a.split(' ').length)[0] || '';
  return pick ? clip(pick, 40).toUpperCase() : '';
}
function heuristicMoment(item, maxRank = 1) {
  const title = String(item.title || '');
  let kind = 'moment';
  if (quoteIn(title)) kind = 'quote';
  else if (/\b(nickname|dubbed|known as|calls? (him|her|them))\b/i.test(title)) kind = 'nickname';
  else if (/\b(vs\.?|versus|rivalry|rivals?|feud|beat|beats|stun|stuns|sweep)\b/i.test(title)) kind = 'rivalry';
  else if (/\b(era|dynasty|legacy|retire[sd]?|retirement|throwback|anniversary|years ago)\b/i.test(title)) kind = 'era';
  else if (/\b\d+\s*(points|pts|yards|touchdowns|tds|home runs|hrs|strikeouts|goals|wins|straight|record)\b/i.test(title)) kind = 'stat';
  const bonus = { quote: 22, nickname: 22, rivalry: 14, era: 12, moment: 10, stat: 6 }[kind];
  const rank = Math.max(0, Number(item.rank) || 0) / (maxRank || 1);
  let score = 30 + Math.round(rank * 25) + bonus + (item.signal === 'hot' ? 12 : item.signal === 'rising' ? 6 : 0) + Math.min(8, (Number(item.coverage) || 0) * 2) + (item.team ? 4 : 0);
  if (LOW_MERCH.test(title)) score -= 35;
  const line = headlineLine(title);
  const lines = line ? [{ text: line, angle: kind === 'quote' ? 'quote' : kind === 'rivalry' ? 'rivalry' : 'callback' }] : [];
  const team = item.team?.name ? clip(item.team.name, 40) : '';
  return { kind, score: Math.max(0, Math.min(100, score)), why: MOMENT_WHY[kind], audience: team ? `${team} fans` : '', timing: kind === 'era' ? 'evergreen' : 'week', collection: kind === 'quote' ? 'quote' : kind === 'nickname' ? 'nickname' : kind === 'era' ? 'replay' : 'current', lines, line, ai: false };
}
// The AI's line must use only the headline's words (and its numbers).
function lineFromHeadline(line, title) {
  const text = clip(String(line || '').replace(/[“”"]/g, ''), 40);
  if (!text) return '';
  const have = new Set(momentWords(title));
  const words = momentWords(text);
  if (!words.length || words.length > 6 || !words.every(w => have.has(w))) return '';
  if (OFFICIAL_RE.test(text) || LEAGUE_MARKS.some(m => new RegExp(`(^|[^A-Za-z])${m}($|[^A-Za-z])`, 'i').test(text)) || ((FrameUpRules?.BANNED) || []).some(b => b.re.test(text))) return '';
  return text.toUpperCase();
}
// An AI shirt line: fan wording is fine, but numbers and quoted words must
// come from the headline; no league marks, "official" or banned words.
function momentLine(raw, title) {
  const text = clip(String(raw || '').replace(/[“”"«»]/g, '').replace(/\s+/g, ' '), 32).trim();
  if (!text || text.split(' ').length > 6) return '';
  const nums = new Set((String(title).match(/\d+(?:[.,]\d+)?/g) || []));
  if ((text.match(/\d+(?:[.,]\d+)?/g) || []).some(n => !nums.has(n))) return '';
  if (OFFICIAL_RE.test(text) || LEAGUE_MARKS.some(m => new RegExp(`(^|[^A-Za-z])${m}($|[^A-Za-z])`, 'i').test(text)) || ((FrameUpRules?.BANNED) || []).some(b => b.re.test(text))) return '';
  return text.toUpperCase();
}
const cleanText = (v, n) => { const t = clip(v, n); return t && !OFFICIAL_RE.test(t) && !((FrameUpRules?.BANNED) || []).some(b => b.re.test(t)) ? t : ''; };
// Complete {...} objects from a JSON reply that was cut off inside "items": [...].
function partialItems(text) {
  const s = String(text || '');
  const start = s.indexOf('[', s.indexOf('"items"'));
  if (start < 0) return [];
  const out = [];
  let depth = 0; let from = -1; let inStr = false; let esc = false;
  for (let n = start + 1; n < s.length; n += 1) {
    const ch = s[n];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) from = n; depth += 1; }
    else if (ch === '}') { depth -= 1; if (depth === 0 && from >= 0) { try { out.push(JSON.parse(s.slice(from, n + 1))); } catch { /* skip */ } from = -1; } }
    else if (ch === ']' && depth === 0) break;
  }
  return out;
}
async function scoreBatch(items, track) {
  const keys = items.map((_, n) => `m${n + 1}`);
  const lines = items.map((i, n) => `${keys[n]} | ${SPORT_LABEL[i.category] || i.category || 'Sports'}${i.team?.name ? ` | ${clip(i.team.name, 40)}` : ''} | ${clip(i.title, 200)}`).join('\n');
  const result = await aiText({ tier: AI_TIER, system: G.MOMENTS_SYSTEM, messages: [{ role: 'user', content: `Headlines:\n${lines}` }], json: true, maxTokens: 5000, timeoutMs: 40000, cacheSystem: true, allowCutoff: true, track: { ...track, feature: FEATURES.moments } });
  // A reply cut off at the limit still has its complete items: keep those.
  const parsed = parseJson(result.text) || { items: partialItems(result.text) };
  if (result.truncated) console.warn(`merch moments: reply cut off; kept ${(parsed.items || []).length} complete items`);
  const out = new Map();
  let dropped = 0;
  (Array.isArray(parsed?.items) ? parsed.items : []).forEach(e => {
    const n = keys.indexOf(String(e?.key || e?.id || '').trim().toLowerCase());
    const item = n >= 0 ? items[n] : null;
    const kind = MOMENT_KINDS.includes(e?.kind) ? e.kind : 'moment';
    if (!item || !Number.isFinite(Number(e?.score))) { dropped += 1; return; }
    const seen = new Set();
    const ls = (Array.isArray(e.lines) ? e.lines : []).map(l => ({ text: momentLine(typeof l === 'string' ? l : l?.text, item.title), angle: MOMENT_ANGLES.includes(l?.angle) ? l.angle : 'callback' }))
      .filter(l => l.text && !seen.has(l.text) && seen.add(l.text)).slice(0, 3);
    if (!ls.length && headlineLine(item.title)) ls.push({ text: headlineLine(item.title), angle: 'callback' });
    if (!ls.length) { dropped += 1; return; }
    out.set(item.id, {
      kind, score: Math.max(0, Math.min(100, Math.round(Number(e.score)))),
      why: cleanText(e.why, 220) || MOMENT_WHY[kind], audience: cleanText(e.audience, 60),
      timing: MOMENT_TIMING.includes(e.timing) ? e.timing : 'week', collection: COLLECTIONS.includes(e.collection) && e.collection !== 'core' ? e.collection : 'current',
      lines: ls, line: ls[0].text, ai: true,
    });
  });
  if (dropped || out.size < items.length) console.warn(`merch moments: ${items.length - out.size} of ${items.length} AI scores unusable`);
  return { scores: out, cost: Number(result.cost || 0) };
}
async function scoreMoments(items, track) {
  const size = LIMITS.momentsBatch;
  const batches = [];
  for (let n = 0; n < items.length; n += size) batches.push(items.slice(n, n + size));
  const results = await Promise.allSettled(batches.map(b => scoreBatch(b, track)));
  const scores = new Map();
  let cost = 0;
  results.forEach(r => { if (r.status === 'fulfilled') { cost += r.value.cost; r.value.scores.forEach((v, k) => scores.set(k, v)); } else if (!inFreeMode() && !isBudgetError(r.reason)) console.error('merch moments batch failed:', r.reason?.message); });
  if (!scores.size && results.every(r => r.status === 'rejected')) throw results[0].reason;
  return { scores, cost };
}
async function momentsMode(body, track) {
  const sport = String(body.sport || '').toLowerCase();
  const only = SPORT_LABEL[sport] ? sport : '';
  let feed;
  try { feed = await withTimeout(Promise.resolve(trendsSource(false)), 9000); } catch (error) {
    console.error('merch moments: trends feed failed:', error?.message);
    return json(200, { ok: true, moments: [], at: new Date().toISOString(), cached: false, ai: false, error: 'Trends are unavailable right now. Paste your own words instead.', cost: { usd: 0, cached: false } });
  }
  const pool = (Array.isArray(feed?.items) ? feed.items : [])
    .filter(i => i && i.id && clip(i.title, 300).length >= 3 && (!i.storyline || i.storyline.lead !== false) && (!only || i.category === only))
    .sort((a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0))
    .slice(0, LIMITS.momentsScored);
  const now = Date.now();
  const fresh = id => { const hit = MOMENT_SCORES.get(`v2:${id}`); return hit && now - hit.at < MOMENT_TTL_MS ? hit.data : null; };
  const misses = pool.filter(i => !fresh(i.id));
  let cost = 0; let ai = pool.some(i => fresh(i.id)?.ai);
  if (misses.length) {
    const gate = await aiGate(FEATURES.moments, track);
    if (!gate) {
      try {
        const r = await scoreMoments(misses, track);
        cost = r.cost;
        r.scores.forEach((data, id) => { MOMENT_SCORES.set(`v2:${id}`, { at: now, data }); ai = true; });
        // Headlines the AI scored with nothing usable keep the quick pick for the
        // cache window, so a refresh doesn't pay for them again.
        const maxR = Math.max(1, ...pool.map(i => Number(i.rank) || 0));
        misses.filter(i => !r.scores.has(i.id)).forEach(i => MOMENT_SCORES.set(`v2:${i.id}`, { at: now, data: heuristicMoment(i, maxR) }));
        if (MOMENT_SCORES.size > 400) [...MOMENT_SCORES.keys()].slice(0, MOMENT_SCORES.size - 400).forEach(k => MOMENT_SCORES.delete(k));
      } catch (error) {
        if (!inFreeMode() && !isBudgetError(error)) console.error('merch moments scoring failed:', error.message);
      }
    }
  }
  const maxRank = Math.max(1, ...pool.map(i => Number(i.rank) || 0));
  const moments = pool.map(item => {
    const s = fresh(item.id) || heuristicMoment(item, maxRank);
    const trend = normalizeTrend(item, '');
    return {
      id: String(item.id), title: clip(item.title, 300), sport: item.category || '', sportLabel: SPORT_LABEL[item.category] || '',
      team: item.team?.name ? { name: clip(item.team.name, 60), short: clip(item.team.short, 20) } : null,
      kind: s.kind, score: s.score, why: s.why, audience: s.audience || '', timing: s.timing || 'week', collection: s.collection || 'current', lines: s.lines || [{ text: s.line, angle: 'callback' }], line: s.line, ai: Boolean(s.ai), trend,
    };
  }).sort((a, b) => b.score - a.score).slice(0, LIMITS.moments);
  return json(200, { ok: true, moments, at: feed?.updatedAt || new Date(now).toISOString(), cached: misses.length === 0, ai, cost: { usd: usd(cost), cached: cost === 0 } });
}

function suggestedRetail(kind, base) {
  if (MerchRules?.suggestedPrice) { const v = Number(MerchRules.suggestedPrice(kind, base)); if (v > 0) return round2(v); }
  const b = Number(base) || 0;
  const margin = { tee: 14, hoodie: 18, poster: 10, sticker: 4, mug: 10 }[kind] || 12;
  return round2(Math.ceil(b + margin) - 0.01);
}
function codeCopy(concept, template) {
  const words = (concept.stack || []).map(r => r.text).join(' ');
  const title = clip(`${concept.title || words} ${template.label}`, 70);
  const description = clip(`${concept.why ? `${concept.why} ` : ''}Printed on a ${template.name || template.label}. Designed by EssentiallySports.`, 400);
  return { title, description };
}
async function copyMode(body, track) {
  const kind = BLANKS[body.blank] ? body.blank : 'tee';
  const source = sourceFor(contentOf(body), trendOf(body));
  const shaped = shapeConcept(body.concept, { content: source, policy: rightsPolicy(), repair: false });
  if (!shaped.concept) return json(400, { ok: false, reason: 'concept', error: "This design can't be used as it is. Pick or make another design." });
  const concept = shaped.concept;
  const template = await templateFor(kind);
  const retail = suggestedRetail(kind, template.basePrice);
  const price = rules().marginFor(retail, template.basePrice);
  const reply = (copy, extra = {}) => json(200, { ok: true, copy: { ...copy, retail, base: template.basePrice, margin: price.ok ? price.margin : null, currency: template.currency }, ...extra });
  const gate = await aiGate(FEATURES.copy, track);
  if (gate?.free) return reply(codeCopy(concept, template), { free: true, ai: false, cost: { usd: 0, cached: false } });
  if (gate?.reply) return gate.reply;
  const key = `p|${hash(`${kind}|${JSON.stringify(concept.stack)}|${concept.title}|${source}`)}`;
  const hit = cacheGet(key);
  if (hit) return reply(hit, { ai: true, cost: { usd: 0, cached: true } });
  let result;
  try {
    result = await aiText({
      tier: AI_TIER, json: true, maxTokens: 500, timeoutMs: 25000, track: { ...track, feature: FEATURES.copy },
      system: `You write shop copy for EssentiallySports fan merch. JSON only: {"title":"...","description":"..."}. Title: at most 60 characters, names the design and the product. Description: 2 or 3 short sentences for fans. Never invent numbers, facts or quotes; never call it official or licensed.\n${VOICE}`,
      messages: [{ role: 'user', content: `Product: ${template.label} (${template.name}).\nDesign rows: ${concept.stack.map(r => r.text).join(' / ')}\nDesign idea: ${concept.title}. ${concept.why}\nSource: """${source}"""` }],
    });
  } catch (error) {
    if (inFreeMode() || isBudgetError(error)) return reply(codeCopy(concept, template), { free: true, ai: false, cost: { usd: 0, cached: false } });
    console.error('merch copy failed:', error.message);
    return reply(codeCopy(concept, template), { ai: false, reason: 'ai', cost: { usd: 0, cached: false } });
  }
  const cost = { usd: Number((result.cost || 0).toFixed(6)), cached: false };
  const p = parseJson(result.text) || {};
  const copy = { title: clip(p.title, 70), description: clip(p.description, 500) };
  const allText = `${copy.title} ${copy.description}`;
  const bad = !copy.title || !copy.description || OFFICIAL_RE.test(allText)
    || ((FrameUpRules?.BANNED) || []).some(b => b.re.test(allText))
    || (allText.match(NUMBER_RE) || []).some(n => !fold(`${source} ${concept.stack.map(r => r.text).join(' ')}`).includes(fold(n)));
  if (bad) return reply(codeCopy(concept, template), { ai: false, reason: 'ai-invalid', cost });
  cacheSet(key, copy);
  return reply(copy, { ai: true, cost });
}

// ─── Fourthwall modes ───────────────────────────────────────────────────────
const fwReply = (error, fallback) => {
  if (error instanceof fourthwall.FourthwallError) return json(error.status, { ok: false, reason: error.reason, error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.retryAfterS ? { retryAfterS: error.retryAfterS } : {}) });
  console.error('merch fourthwall failed:', error?.message);
  return json(502, { ok: false, reason: 'unavailable', error: fallback || 'Fourthwall is unavailable right now. Try again in a moment.' });
};
const PRODUCT_ID = /^[\w-]{3,80}$/;
const IMAGE_ID = /^[\w-]{3,120}$/;
const COLLECTION_ID = /^[\w-]{3,80}$/;

// ─── History (Supabase when the migration has run; memory otherwise) ───────
const historyMode = () => (store.available() ? 'db' : 'memory');
async function recordCreate(record, concept, images, body) {
  if (!store.available()) return 'memory';
  const ok = await store.soft(async () => {
    const designId = await store.recordDesign({ concept, blank: record.blank, title: record.title, by: record.by, ack: record.ack, printPath: body.printPath });
    await store.upsertProduct({
      productId: record.productId, designId, title: record.title, blank: record.blank, templateId: record.templateId, color: record.color || '',
      regions: record.regions, state: 'HIDDEN', price: record.price, productUrl: record.productUrl || '', slug: record.slug || '', thumb: record.thumb || '',
      images: images.slice(0, 12), ack: record.ack, createdBy: record.by,
    });
    await store.recordEvent({ type: 'CREATED', productId: record.productId, actor: record.by, payload: { blank: record.blank, title: record.title, price: record.price } });
    return true;
  }, false, 'merch history create');
  return ok ? 'db' : 'memory';
}
async function recordAction(type, productId, track, payload = {}, patch = null) {
  if (!store.available()) return false;
  return store.soft(async () => {
    if (patch) await store.updateProduct(productId, patch);
    await store.recordEvent({ type, productId, actor: track?.email || null, payload });
    return true;
  }, false, `merch history ${type.toLowerCase()}`);
}
// Is this a product FrameUp made? DB first, then this instance's memory.
async function ourProduct(productId) {
  if (store.available()) {
    const row = await store.soft(() => store.getProduct(productId), undefined, 'merch history read');
    if (row) return { row, known: true };
    if (row === null) return { row: null, known: HISTORY.some(h => h.productId === productId) };
  }
  const mem = HISTORY.find(h => h.productId === productId);
  return { row: mem ? { product_id: mem.productId, title: mem.title, blank: mem.blank } : null, known: Boolean(mem) };
}

async function uploadUrlMode(body) {
  const size = Math.round(Number(body.size));
  if (body.contentType && body.contentType !== 'image/png') return json(400, { ok: false, reason: 'input', error: 'Print files must be PNG.' });
  if (!(size > 0) || size > LIMITS.uploadBytes) return json(400, { ok: false, reason: 'input', error: 'The print file must be a PNG under 25 MB.' });
  const fileName = `${clip(body.fileName, 80).replace(/[^\w.-]+/g, '-').replace(/\.png$/i, '') || 'frameup-merch'}.png`;
  const r = await client().uploadUrl({ fileName, contentType: 'image/png', size });
  return json(200, { ok: true, uploadUrl: r.uploadUrl, fileUrl: r.fileUrl, expiresAt: r.expiresAt || null, method: 'PUT', contentType: 'image/png' });
}

async function registerMode(body) {
  const fileUrl = String(body.fileUrl || '');
  if (!/^https:\/\/[^\s]{8,2000}$/.test(fileUrl)) return json(400, { ok: false, reason: 'input', error: 'Upload the print file first.' });
  const width = Math.round(Number(body.width)); const height = Math.round(Number(body.height));
  if (!(width > 0 && width <= 12000 && height > 0 && height <= 12000)) return json(400, { ok: false, reason: 'input', error: 'The print file size is missing.' });
  if (BLANKS[body.blank]) {
    const t = await templateFor(body.blank);
    const area = body.region ? t.areas.find(a => a.regionId === body.region) : { pixelsWidth: t.printSpec.pixelsWidth, pixelsHeight: t.printSpec.pixelsHeight, name: 'front' };
    if (!area) return json(400, { ok: false, reason: 'region', error: `This ${t.label.toLowerCase()} has no print area called "${clip(body.region, 40)}".` });
    if (width !== area.pixelsWidth || height !== area.pixelsHeight) {
      return json(400, { ok: false, reason: 'print-size', error: `The print file must be ${area.pixelsWidth} x ${area.pixelsHeight} px for the ${String(area.name).toLowerCase()} area. Export it again.` });
    }
  }
  const img = await client().registerImage({ fileUrl, width, height });
  return json(200, { ok: true, imageId: img.id, uri: img.uri, preview: img.preview, thumbnail: img.thumbnail, width: img.width, height: img.height });
}

function colorFor(template, name) {
  const want = clip(name, 60).toLowerCase();
  const hit = template.colors.find(c => c.name.toLowerCase() === want);
  return hit ? hit.name : (template.colors.find(c => c.name === template.defaultColor)?.name || template.colors[0]?.name);
}
// The design region (front by default, or a chosen area) plus an optional
// logo region with its own image. Both must be renderable areas of the template.
function regionsFor(template, body) {
  const designRegion = clip(body.region || template.printSpec.regionId, 60);
  const usable = id => template.areas.find(a => a.regionId === id && a.available && a.renderable);
  if (!IMAGE_ID.test(String(body.imageId || ''))) return { error: 'Upload the print file first.' };
  if (!usable(designRegion)) return { error: `The ${template.label.toLowerCase()} can't print the design on "${designRegion}". Pick another area.` };
  const main = designRegion === template.printSpec.regionId;
  const regions = [{ region: designRegion, imageId: body.imageId, placementStrategy: main ? template.printSpec.placementStrategy : 'FULL_REGION', ...(main && template.printSpec.placementId ? { placementId: template.printSpec.placementId } : {}) }];
  if (body.logo) {
    const logoRegion = clip(body.logo.region, 60);
    if (!IMAGE_ID.test(String(body.logo.imageId || ''))) return { error: 'Upload the logo file first.' };
    const area = usable(logoRegion);
    if (!area) return { error: `The ${template.label.toLowerCase()} can't print the logo on "${logoRegion || 'that area'}". Pick another area.` };
    if (logoRegion === designRegion) return { error: 'Put the logo in a different area from the design.' };
    regions.push({ region: logoRegion, imageId: body.logo.imageId, placementStrategy: 'FULL_REGION' });
  }
  return { regions };
}
const pipelineImages = list => (Array.isArray(list) ? list : []).map(i => ({ url: i.url, width: i.width, height: i.height, color: i.color, style: i.style, region: i.region || null })).filter(i => i.url).slice(0, 40);

async function previewMode(body) {
  const kind = BLANKS[body.blank] ? body.blank : 'tee';
  const t = await templateFor(kind);
  const reg = regionsFor(t, body);
  if (reg.error) return json(400, { ok: false, reason: 'input', error: reg.error });
  const color = colorFor(t, body.color);
  const r = await client().customize({ productTemplateId: t.templateId, regions: reg.regions, colors: color ? [color] : undefined });
  return json(200, { ok: true, customizationId: r.customizationId, images: pipelineImages(r.images), color, templateId: t.templateId, regions: reg.regions.map(x => x.region) });
}

async function createMode(body, track) {
  const kind = BLANKS[body.blank] ? body.blank : 'tee';
  const content = sourceFor(contentOf(body), trendOf(body));
  const policy = rightsPolicy();
  const shaped = shapeConcept(body.concept, { content, policy, repair: false });
  if (!shaped.concept) return json(400, { ok: false, reason: 'concept', error: "This design can't go to the shop as it is (it may use a league mark, an invented number or a quote that isn't in the source). Edit it and try again." });
  const concept = shaped.concept;
  const title = clip(body.title, 70);
  if (!title) return json(400, { ok: false, reason: 'input', error: 'Give the product a title.' });
  const description = clip(body.description, LIMITS.desc);
  // Rights: under 'acknowledge' every warning (names, nicknames, quotes, teams) needs a tick.
  const R = rules();
  const scan = R.scanConcept(concept, { source: content, policy });
  if (scan.blocked?.length) return json(400, { ok: false, reason: 'rights-blocked', error: scan.blocked[0].reason, blocked: scan.blocked });
  if (!R.ackCovers(body.ack, scan)) return json(400, { ok: false, reason: 'rights-ack', error: 'Tick the rights check first: this design uses real names, quotes or teams.', items: scan.warnings });
  const template = await templateFor(kind);
  const reg = regionsFor(template, body);
  if (reg.error) return json(400, { ok: false, reason: 'input', error: reg.error });
  const price = R.marginFor(body.retail, template.basePrice);
  if (!price.ok) return json(400, { ok: false, reason: 'price', error: price.error });
  const c = await capsFor(track.email);
  if (c.person.left <= 0) return json(429, { ok: false, reason: 'daily-cap', error: `You've sent ${CAPS.person} products to the shop today, the daily limit. More tomorrow.`, caps: c });
  if (c.team.left <= 0) return json(429, { ok: false, reason: 'daily-cap', error: `The team has sent ${CAPS.team} products to the shop today, the daily limit. More tomorrow.`, caps: c });
  const color = colorFor(template, body.color || concept.garment.name);
  const started = Date.now();
  const r = await client().createProduct({
    productTemplateId: template.templateId,
    name: title,
    description,
    regions: reg.regions,
    colors: color ? [color] : undefined,
    profitMargin: price.margin,
  });
  countCreate(track.email);
  const ack = { policy, accepted: Boolean(body.ack?.accepted) || !scan.warnings?.length, by: track.email, at: new Date().toISOString(), statement: R.ACK_STATEMENT, items: (scan.warnings || []).map(w => ({ kind: w.kind, text: w.text })) };
  let productUrl = '';
  let slug = '';
  try {
    const [p, shop] = await Promise.all([client().product(r.productId), shopInfo()]);
    slug = p?.slug || '';
    productUrl = fourthwall.productUrl(shop.publicDomain, slug);
  } catch { /* the product link fills in on the next read */ }
  const images = pipelineImages(r.images);
  const record = { productId: r.productId, conceptId: concept.id, title, blank: kind, templateId: template.templateId, color, regions: reg.regions.map(x => x.region), state: 'HIDDEN', price: { retail: price.retail, base: price.base, margin: price.margin }, ack, by: track.email, at: ack.at, productUrl, slug, thumb: images[0]?.url || '' };
  HISTORY.unshift(record); HISTORY.length = Math.min(HISTORY.length, 100);
  const history = await recordCreate(record, concept, images, body);
  await logUsage({ ...track, feature: 'merch-create', task: 'fourthwall-create' }, { model: 'fourthwall/open-api', ok: true, input_tokens: 0, output_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started });
  // `description` is an optional field of CreateDesignProductRequestV1 in both
  // Fourthwall specs (2026-11), so it is sent; it is echoed back so the UI can
  // offer "Copy description" if the live shop shows it empty.
  return json(200, { ok: true, productId: r.productId, state: 'HIDDEN', title, description, images, price: record.price, ack, productUrl, slug, caps: await capsFor(track.email), history });
}

async function stateMode(body, state, track) {
  const id = String(body.productId || '');
  if (!PRODUCT_ID.test(id)) return json(400, { ok: false, reason: 'input', error: 'Which product? The product id is missing.' });
  const p = await client().setState(id, state);
  let domain = '';
  try { domain = (await shopInfo()).publicDomain; } catch { /* link only */ }
  const product = fourthwall.normalizeProduct(p || { id }, domain);
  const rec = HISTORY.find(h => h.productId === id); if (rec) rec.state = state;
  await recordAction(state === 'PUBLIC' ? 'PUBLISHED' : 'HIDDEN', id, track, { state }, {
    state, ...(state === 'PUBLIC' ? { publishedAt: new Date().toISOString() } : {}),
    ...(product.url ? { productUrl: product.url } : {}), ...(product.thumbnail ? { thumb: product.thumbnail } : {}),
  });
  return json(200, { ok: true, product, state });
}

async function productMode(body, track) {
  const id = String(body.productId || '');
  if (!PRODUCT_ID.test(id)) return json(400, { ok: false, reason: 'input', error: 'Which product? The product id is missing.' });
  const [p, shop] = await Promise.all([client().product(id), shopInfo().catch(() => ({ publicDomain: '' }))]);
  const product = fourthwall.normalizeProduct(p, shop.publicDomain);
  if (body.refresh !== true) return json(200, { ok: true, product });
  // Refresh: store the latest mockups, variants, prices and state.
  let row = null;
  if (store.available()) {
    row = await store.soft(() => store.updateProduct(id, refreshPatch(product)), null, 'merch refresh');
    if (row) await recordAction('REFRESHED', id, track, { state: product.state });
  }
  const rec = HISTORY.find(h => h.productId === id); if (rec) { rec.state = product.state; rec.thumb = product.thumbnail || rec.thumb; }
  return json(200, { ok: true, product: { ...product, productId: id, ...(row ? { blank: row.blank, color: row.color, createdBy: row.created_by, createdAt: row.created_at, collectionIds: row.collection_ids || [] } : {}) }, refreshed: true, history: row ? 'db' : historyMode() === 'db' ? 'not-ours' : 'memory' });
}
const refreshPatch = product => store.patchFromProduct(product);

async function statusMode(track) {
  const configured = fourthwall.configured();
  let shop = null; let shopError = '';
  if (configured) { try { shop = await shopInfo(); } catch (error) { shopError = error.message || 'Fourthwall is unavailable right now.'; } }
  const push = await canPush(track);
  return json(200, {
    ok: true, configured, shop, shopError, canPush: push, caps: await capsFor(track.email), rightsPolicy: rightsPolicy(),
    blanks: Object.keys(BLANKS), history: historyMode(), canArchive: await isAdmin(track.token), notice: configured ? (push ? '' : NO_PUSH) : NOT_SET_UP,
  });
}


// ─── Archive (permanent), list, collections, sales, upload relay ───────────
async function archiveMode(body, track) {
  const id = String(body.productId || '');
  if (!PRODUCT_ID.test(id)) return json(400, { ok: false, reason: 'input', error: 'Which product? The product id is missing.' });
  if (body.confirm !== true) return json(400, { ok: false, reason: 'confirm', error: 'Archiving deletes the product from the shop for good. Confirm to go ahead.' });
  const mine = await ourProduct(id);
  if (!mine.known) return json(409, { ok: false, reason: 'not-ours', error: "FrameUp only archives products it made. Archive this one in the Fourthwall dashboard." });
  const name = clip(body.confirmName, 120);
  const title = clip(mine.row?.title, 120);
  if (body.confirmName != null && title && name.toLowerCase() !== title.toLowerCase()) {
    return json(400, { ok: false, reason: 'confirm', error: 'The name you typed does not match the product. Type it exactly to archive.' });
  }
  try { await client().archive(id); } catch (error) {
    // Already gone from the shop: record it as archived.
    if (!(error instanceof fourthwall.FourthwallError && error.reason === 'not-found')) throw error;
  }
  const at = new Date().toISOString();
  const rec = HISTORY.find(h => h.productId === id); if (rec) rec.state = 'ARCHIVED';
  await recordAction('ARCHIVED', id, track, { title }, { state: 'ARCHIVED', archivedAt: at });
  return json(200, { ok: true, product: { productId: id, id, title, state: 'archived', archivedAt: at } });
}

const lower = v => String(v || '').toLowerCase();
async function salesMap(productIds) {
  if (!store.available() || !productIds.length) return new Map();
  const orders = await store.soft(() => store.ordersFor(productIds), [], 'merch sales');
  return new Map(store.aggregateSales(orders || [], { productIds }).map(r => [r.productId, r]));
}
const LIST_SIZE = 50;
async function listMode(body) {
  const page = Math.max(0, Math.min(100, Math.round(Number(body.page) || 0)));
  const rows = store.available() ? await store.soft(() => store.listProducts({ page, size: LIST_SIZE, includeArchived: body.archived === true }), null, 'merch list') : null;
  if (Array.isArray(rows)) {
    const sales = await salesMap(rows.map(r => r.product_id));
    const products = rows.map(r => ({
      productId: r.product_id, title: r.title, url: r.product_url || '', state: lower(r.state), thumb: r.thumb || '', blank: r.blank, color: r.color || '',
      createdAt: r.created_at, createdBy: r.created_by || '', units30: sales.get(r.product_id)?.units30 || 0, revenue30: sales.get(r.product_id)?.revenue30 || 0,
      price: r.price?.retail ?? null, collectionIds: r.collection_ids || [],
    }));
    return json(200, { ok: true, products, source: 'db', page, more: rows.length === LIST_SIZE });
  }
  // No history table yet: Fourthwall's product list, only the products this server made.
  if (!fourthwall.configured()) return json(200, { ok: true, products: [], source: 'none', page, more: false, note: NOT_SET_UP });
  const known = new Map(HISTORY.map(h => [h.productId, h]));
  const [list, shop] = await Promise.all([client().listProducts({ page, size: 100 }), shopInfo().catch(() => ({ publicDomain: '' }))]);
  const products = (list?.results || []).filter(p => known.has(String(p.id))).map(p => {
    const n = fourthwall.normalizeProduct(p, shop.publicDomain);
    const h = known.get(n.id);
    return { productId: n.id, title: n.name || h.title, url: n.url || h.productUrl || '', state: lower(n.state), thumb: n.thumbnail || h.thumb || '', blank: h.blank, color: h.color || '', createdAt: n.createdAt || h.at, createdBy: h.by || '', units30: 0, revenue30: 0, price: n.price };
  });
  return json(200, { ok: true, products, source: 'fourthwall', page, more: (list?.totalPages || 1) > page + 1, note: 'Showing products made since the server last restarted. Run the merch migration to keep the full history.' });
}

const COLLECTIONS_TTL_MS = 2 * 60 * 1000;
const COLLECTIONS_CACHE = { at: 0, data: null };
async function readCollections({ fresh = false } = {}) {
  if (!fresh && COLLECTIONS_CACHE.data && Date.now() - COLLECTIONS_CACHE.at < COLLECTIONS_TTL_MS) return COLLECTIONS_CACHE.data;
  const fw = client();
  const list = await fw.collections({ size: 100 });
  const slim = (list?.results || []).filter(c => c?.id).slice(0, 40);
  // The slim list has no product ids: read each collection (in parallel) for its count.
  const full = await Promise.all(slim.map(c => fw.collection(c.id).catch(() => null)));
  const data = slim.map((c, i) => ({ id: String(c.id), name: clip(c.name, 120), slug: clip(c.slug, 120), offerIds: Array.isArray(full[i]?.offerIds) ? full[i].offerIds.map(String) : null }));
  COLLECTIONS_CACHE.at = Date.now(); COLLECTIONS_CACHE.data = data;
  return data;
}
const publicCollection = (c, productId) => ({ id: c.id, name: c.name, slug: c.slug, count: Array.isArray(c.offerIds) ? c.offerIds.length : null, ...(productId ? { has: Array.isArray(c.offerIds) && c.offerIds.includes(productId) } : {}) });
async function collectionsMode(body) {
  const data = await readCollections({ fresh: body.fresh === true });
  const pid = PRODUCT_ID.test(String(body.productId || '')) ? String(body.productId) : '';
  return json(200, { ok: true, collections: data.map(c => publicCollection(c, pid)) });
}
async function collectionCreateMode(body, track) {
  const name = clip(body.name, 80);
  if (name.length < 2) return json(400, { ok: false, reason: 'input', error: 'Give the collection a name.' });
  const existing = await readCollections().catch(() => []);
  const dupe = existing.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (dupe) return json(200, { ok: true, collection: publicCollection(dupe), existed: true });
  const c = await client().createCollection({ name, description: clip(body.description, 300) });
  COLLECTIONS_CACHE.at = 0;
  await recordAction('COLLECTION_CREATED', null, track, { id: c?.id, name });
  return json(200, { ok: true, collection: { id: String(c?.id || ''), name: clip(c?.name || name, 120), slug: clip(c?.slug, 120), count: Array.isArray(c?.offerIds) ? c.offerIds.length : 0 } });
}
// PUT /collections/{id}/products replaces the whole list, so each collection
// that changes is read fresh first and only this product is added or removed.
async function collectionSetMode(body, track) {
  const id = String(body.productId || '');
  if (!PRODUCT_ID.test(id)) return json(400, { ok: false, reason: 'input', error: 'Which product? The product id is missing.' });
  if (!Array.isArray(body.collectionIds) || body.collectionIds.length > 40 || !body.collectionIds.every(c => COLLECTION_ID.test(String(c)))) {
    return json(400, { ok: false, reason: 'input', error: 'Pick the collections from the list.' });
  }
  const want = new Set(body.collectionIds.map(String));
  const fw = client();
  const all = await readCollections({ fresh: true });
  const unknown = [...want].filter(c => !all.some(x => x.id === c));
  if (unknown.length) return json(400, { ok: false, reason: 'input', error: "One of those collections isn't in the shop any more. Reload the list." });
  const changed = [];
  for (const c of all) {
    const has = Array.isArray(c.offerIds) && c.offerIds.includes(id);
    if (has === want.has(c.id) && Array.isArray(c.offerIds)) continue;
    const fresh = await fw.collection(c.id); // read right before the write
    const ids = (Array.isArray(fresh?.offerIds) ? fresh.offerIds : []).map(String);
    const now = ids.includes(id);
    if (now === want.has(c.id)) { c.offerIds = ids; continue; }
    const next = want.has(c.id) ? [...ids, id] : ids.filter(x => x !== id);
    const saved = await fw.setCollectionProducts(c.id, next);
    c.offerIds = Array.isArray(saved?.offerIds) ? saved.offerIds.map(String) : next;
    changed.push(c.id);
  }
  COLLECTIONS_CACHE.at = Date.now(); COLLECTIONS_CACHE.data = all;
  if (changed.length) await recordAction('COLLECTIONS_SET', id, track, { collectionIds: [...want], changed }, { collectionIds: [...want] });
  return json(200, { ok: true, collections: all.map(c => publicCollection(c, id)), changed });
}

async function salesMode(body) {
  if (!store.available()) return json(200, { ok: true, products: [], updatedAt: null, source: 'none', note: 'Sales appear once the merch migration has run and SUPABASE_SERVICE_ROLE_KEY is set.' });
  const one = String(body.productId || '');
  if (one && !PRODUCT_ID.test(one)) return json(400, { ok: false, reason: 'input', error: 'Which product? The product id is missing.' });
  let ids = one ? [one] : null;
  if (!ids) {
    const rows = await store.soft(() => store.listProducts({ size: 100, includeArchived: true }), [], 'merch sales list');
    ids = (rows || []).map(r => r.product_id);
  }
  const [orders, sync] = await Promise.all([
    ids.length ? store.soft(() => store.ordersFor(ids), [], 'merch sales') : [],
    store.soft(() => store.lastEvent('SYNC'), null, 'merch sales sync'),
  ]);
  const latest = (orders || []).reduce((m, o) => (o.updated_at && o.updated_at > m ? o.updated_at : m), '');
  const updatedAt = [sync?.created_at || '', latest].sort().pop() || null;
  return json(200, { ok: true, products: store.aggregateSales(orders || [], { productIds: ids }), updatedAt, source: 'db' });
}

// Upload relay: the browser could not PUT straight to Fourthwall's storage
// (CORS), so it uploaded the PNG to Supabase Storage merch-art/<user id>/...
// The server reads it, PUTs it to the signed upload URL with the size header,
// then deletes the copy. Only Google Cloud Storage upload URLs are accepted.
const RELAY_PATH = /^[0-9a-f-]{36}\/[\w.-]{1,120}\.png$/i;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function uploadHostOk(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && !u.port
    && (u.hostname === 'storage.googleapis.com' || /^[a-z0-9.-]+\.storage\.googleapis\.com$/.test(u.hostname));
}
async function uploadRelayMode(body, track) {
  const path = String(body.path || '');
  const size = Math.round(Number(body.size));
  if (!RELAY_PATH.test(path) || path.includes('..')) return json(400, { ok: false, reason: 'input', error: 'Upload the print file first.' });
  if (!track.userId || !path.startsWith(`${track.userId}/`)) return json(403, { ok: false, reason: 'input', error: 'That file belongs to someone else.' });
  if (!uploadHostOk(body.uploadUrl)) return json(400, { ok: false, reason: 'input', error: 'Get a new upload link and try again.' });
  if (!(size > 0) || size > LIMITS.uploadBytes) return json(400, { ok: false, reason: 'input', error: 'The print file must be a PNG under 25 MB.' });
  if (!store.available()) return json(503, { ok: false, reason: 'not-set-up', error: "The upload backup isn't set up yet. Ask an admin to run the merch migration." });
  let file;
  try { file = await store.downloadArt(path, { maxBytes: LIMITS.uploadBytes }); } catch (error) {
    if (error?.status === 404) return json(404, { ok: false, reason: 'missing', error: "The uploaded file wasn't found. Upload it again." });
    if (error?.status === 413) return json(400, { ok: false, reason: 'input', error: 'The print file must be a PNG under 25 MB.' });
    return json(502, { ok: false, reason: 'storage', error: "Couldn't read the uploaded file. Try again in a moment." });
  }
  if (file.bytes.length !== size) return json(400, { ok: false, reason: 'size', error: "The uploaded file's size doesn't match. Upload it again." });
  if (!file.bytes.subarray(0, 8).equals(PNG_MAGIC)) return json(400, { ok: false, reason: 'input', error: 'Print files must be PNG.' });
  await client().putUpload(String(body.uploadUrl), file.bytes, 'image/png');
  await store.soft(() => store.removeArt(path), false, 'merch relay cleanup');
  return json(200, { ok: true, size: file.bytes.length });
}

// ─── Brainstorm room (shared boards; _merch-brainstorm.js) ───────────────────
let MerchPrint = null;
try { MerchPrint = require('../../merch-print.js'); } catch { MerchPrint = null; }
const brainstorm = require('./_merch-brainstorm.js').createBrainstorm({
  json, clip, fold, aiGate, isAdmin, fellBackFor, LEAGUE_MARKS, OFFICIAL_RE, BANNED: (FrameUpRules && FrameUpRules.BANNED) || [],
  quoteInSource: (q, s) => rules().quoteInSource(q, s), headlineLine, partialItems, parseJson, usd, SPORT_LABEL,
  designModeOf, contentOf, trendOf, fullTrend: t => fullTrend(t), G, AI_TIER, PRO_TIER, hash,
  teamPalette: MerchPrint && typeof MerchPrint.teamPalette === 'function' ? name => MerchPrint.teamPalette(name) : null,
});

// ─── Handler ────────────────────────────────────────────────────────────────
const PUSH_MODES = new Set(['upload-url', 'register', 'preview', 'create', 'publish', 'hide', 'upload-relay', 'collection-create', 'collection-set']);
const FW_MODES = new Set([...PUSH_MODES, 'product', 'archive', 'collections']);
exports.handler = withAiMode(async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
  if (String(event.body || '').length > LIMITS.body) return json(413, { ok: false, error: 'That request is too large.' });
  let body = {};
  try { body = JSON.parse(event.body || '{}') || {}; } catch { return json(400, { ok: false, error: 'Invalid request.' }); }
  const track = { email: auth.user.email, userId: String(auth.user.id || ''), token: bearerToken(event.headers), runId: `mr-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}` };
  const mode = String(body.mode || '');
  try {
    if (mode === 'status') return await statusMode(track);
    if (mode === 'templates') {
      const kinds = BLANKS[body.blank] ? [body.blank] : Object.keys(BLANKS);
      const templates = await Promise.all(kinds.map(k => templateFor(k)));
      return json(200, { ok: true, templates });
    }
    if (mode === 'concepts') return await conceptsMode(body, track);
    if (mode === 'refine') return await refineMode(body, track);
    if (mode === 'moments') return await momentsMode(body, track);
    if (mode === 'list') return await listMode(body);
    if (mode === 'sales') return await salesMode(body);
    if (mode === 'copy') return await copyMode(body, track);
    if (mode.startsWith('brainstorm-')) { const r = await brainstorm.handle(mode, body, track); if (r) return r; }
    if (FW_MODES.has(mode)) {
      if (!fourthwall.configured()) return json(503, { ok: false, reason: 'not-set-up', error: NOT_SET_UP });
      if (PUSH_MODES.has(mode) && !(await canPush(track))) return json(403, { ok: false, reason: 'no-push', error: NO_PUSH });
      if (mode === 'archive' && !(await isAdmin(track.token))) return json(403, { ok: false, reason: 'admin-only', error: 'Only admins can archive products. Ask an admin, or hide the product instead.' });
      if (mode === 'upload-url') return await uploadUrlMode(body);
      if (mode === 'register') return await registerMode(body);
      if (mode === 'preview') return await previewMode(body);
      if (mode === 'create') return await createMode(body, track);
      if (mode === 'publish') return await stateMode(body, 'PUBLIC', track);
      if (mode === 'hide') return await stateMode(body, 'HIDDEN', track);
      if (mode === 'product') return await productMode(body, track);
      if (mode === 'archive') return await archiveMode(body, track);
      if (mode === 'upload-relay') return await uploadRelayMode(body, track);
      if (mode === 'collections') return await collectionsMode(body);
      if (mode === 'collection-create') return await collectionCreateMode(body, track);
      if (mode === 'collection-set') return await collectionSetMode(body, track);
    }
    return json(400, { ok: false, error: 'Unknown request.' });
  } catch (error) {
    return fwReply(error, 'Merch is unavailable right now. Try again in a moment.');
  }
});

exports._test = {
  FEATURES, CAPS, LIMITS, COLLECTIONS, BLANKS, NOT_SET_UP, NO_PUSH, InlineRules, rules, usingDesignRules: () => Boolean(MerchRules),
  shapeConcept, pickArea, listAreas, regionsFor, qualifies, normalizeTemplate, snapshotTemplate, templateFor, suggestedRetail, codeCopy, caps, capsFor, countCreate, pushers, HISTORY,
  uploadHostOk, refreshPatch,
  contentOf, trendOf, sourceFor, designModeOf, shapeElements, shapeFit, codeIntent, applyIntent, heuristicMoment, lineFromHeadline, headlineLine, MOMENT_SCORES, G,
  setClientFactory(fn) { clientFactory = fn; },
  setTrendsSource(fn) { trendsSource = fn; },
  brainstorm, partialItems, momentLine,
  reset() { brainstorm.reset(); DAILY.day = ''; DAILY.team = 0; DAILY.people = new Map(); HISTORY.length = 0; TEMPLATES.clear(); AI_CACHE.clear(); MOMENT_SCORES.clear(); SHOP.at = 0; SHOP.data = null; COLLECTIONS_CACHE.at = 0; COLLECTIONS_CACHE.data = null; },
};
