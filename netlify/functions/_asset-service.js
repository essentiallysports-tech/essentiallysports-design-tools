'use strict';
// FrameUp asset service: the images Generate's composer (Creative mode) builds
// designs from. Server module; the browser calls it through /api/gen-assets
// (netlify/functions/gen-assets.js) and frameup-assets.js.
//
//   generateBackground({ prompt, style, palette, size, seed, quality, space, referenceUrl })
//   generateConceptArt({ concept, sport, palette, avoid, size, seed, quality })
//   cutout({ imageUrl | image, size })   mask only, see below
//   findPhotos({ person, team, sport, query, count, exclude })
//
// Every function takes an optional second argument, ctx:
//   { email, token, runId, gated, maxCostUsd, deps }
//   email/token: the signed-in person (usage rows are written with their session).
//   gated: true when the caller already ran aiSpendGate for this request.
//   maxCostUsd: the most one call may spend; a dearer model steps down to its
//               economy model, else the call is refused with reason 'budget'.
// and resolves to the contract shape:
//   { ok, url | dataUrl, width, height, cost, cached, rights: { source, licence, aiGenerated } }
// plus model, prompt (as sent), guard, and on failure { ok: false, reason, error }.
//
// RULES (project-docs/gen-assets.md):
//   - AI never draws people. Prompts are sanitised (names, teams, leagues,
//     brands, numbers and person words removed; a no-people / no-logo / no-text
//     clause added), and every generated image is checked by a cheap vision
//     call before it is returned (one retry, then refused).
//   - Real athletes only come from the ES image pool (findPhotos), and their
//     cut-outs keep the ORIGINAL pixels (cutout returns a mask only).
//   - Image-to-image (referenceUrl) is for backgrounds only, and only from an
//     image this service made: never an athlete photo.
//
// Storage: generated images are uploaded to the existing public Supabase bucket
// (GEN_ASSETS_BUCKET, default "frameup-links", prefix gen-assets/) with the
// person's own session; the object name is the hash of the inputs, so a second
// identical request (any server, any person) is a HEAD request, not a new
// image. Served with a one-year immutable cache header. If the upload fails or
// GEN_ASSETS_STORAGE=off, the image comes back as a data URL and is kept in
// this server's memory cache only. Cut-out masks are never uploaded (the
// model's redrawn pixels of a real person must not be published).

const crypto = require('node:crypto');
const gateway = require('./_ai-gateway.js');
const { authConfig } = require('./_supabase-auth.js');

const GATEWAY = 'https://ai-gateway.vercel.sh/v1';
const clock = { now: () => Date.now() };
const envFlag = (name, env = process.env) => /^(1|true|yes|on)$/i.test(String(env[name] || '').trim());

// ─── Models (live Gateway list, ai-gateway.vercel.sh/v1/models, 2026-11-17) ───
// Why each one: project-docs/gen-assets.md "Model choice".
const STYLE_MODELS = {
  photo: { model: 'bfl/flux-3-image', economy: 'bfl/flux-3-image-klein' },
  illustration: { model: 'recraft/recraft-v4.1', economy: 'recraft/recraft-v4.1-flash' },
  texture: { model: 'bfl/flux-3-image-klein', economy: 'bfl/flux-3-image-klein' },
  abstract: { model: 'recraft/recraft-v4.1-flash', economy: 'bfl/flux-3-image-klein' },
  concept: { model: 'google/gemini-nano-banana-2.1', economy: 'bfl/flux-3-image-klein' },
};
// A model that errors (not a policy refusal) is tried once more on this one.
const FALLBACK_MODEL = 'bfl/flux-3-image-klein';
const STYLES = ['photo', 'illustration', 'texture', 'abstract'];

// USD per image, Gateway list prices (2026-11-17). Size classes are the longest
// side the pixel count fits in (BFL bills by resolution class).
const IMAGE_PRICES = {
  'bfl/flux-3-image': { classes: { 768: 0.041, 1024: 0.048, 1536: 0.07, 2048: 0.1 } },
  'bfl/flux-3-image-klein': { classes: { 768: 0.008, 1024: 0.009, 1536: 0.011, 2048: 0.014 } },
  'recraft/recraft-v4.1': { flat: 0.035 },
  'recraft/recraft-v4.1-flash': { flat: 0.007 },
  'recraft/recraft-v4.1-pro': { flat: 0.21 },
  'google/gemini-nano-banana-2.1': { standard: 0.0336, high: 0.0504 },
  'google/gemini-3.1-flash-image': { standard: 0.067, high: 0.101 },
  'google/gemini-3.1-flash-lite-image': { standard: 0.034, high: 0.034 },
  'bytedance/seedream-4.5': { flat: 0.04 },
  'openai/gpt-image-1-mini': { flat: 0.011 },
};
const UNKNOWN_PRICE = 0.07;

// Canvas sizes the composer uses, and the size each model family is asked for.
// standard ~1 MP (the cheap class), high ~2 MP (crisp full-bleed at 1080 wide).
const CANVAS = {
  '1080x1350': { aspect: '4:5', standard: '912x1136', high: '1232x1536', recraft: '1024x1280' },
  '1080x1920': { aspect: '9:16', standard: '768x1360', high: '1152x2048', recraft: '1024x1820' },
  '1080x1080': { aspect: '1:1', standard: '1024x1024', high: '1536x1536', recraft: '1024x1024' },
  '1920x1080': { aspect: '16:9', standard: '1360x768', high: '2048x1152', recraft: '1820x1024' },
};
const DEFAULT_CANVAS = '1080x1350';

function envModel(style, env = process.env) {
  const name = String(env[`GEN_ASSETS_MODEL_${style.toUpperCase()}`] || '').trim();
  return /^[a-z0-9-]+\/[a-z0-9.-]+$/i.test(name) ? name : '';
}
function economy(env = process.env) {
  return envFlag('GEN_ASSETS_ECONOMY', env) || gateway.economyMode();
}
function modelForStyle(style, env = process.env) {
  const entry = STYLE_MODELS[style] || STYLE_MODELS.photo;
  return envModel(style, env) || (economy(env) ? entry.economy : entry.model);
}
function family(model) {
  if (model.startsWith('google/')) return 'google';
  if (model.startsWith('recraft/')) return 'recraft';
  if (model.startsWith('bfl/')) return 'bfl';
  return 'other';
}
function canvasFor(size) {
  return CANVAS[size] ? size : DEFAULT_CANVAS;
}
function modelSize(model, size, quality = 'standard') {
  const canvas = CANVAS[canvasFor(size)];
  if (family(model) === 'recraft') return canvas.recraft;
  return quality === 'high' ? canvas.high : canvas.standard;
}
function priceFor(model, size = '1024x1024', quality = 'standard') {
  const entry = IMAGE_PRICES[model];
  if (!entry) return UNKNOWN_PRICE;
  if (entry.flat != null) return entry.flat;
  if (entry.standard != null) return quality === 'high' ? entry.high : entry.standard;
  const [w, h] = String(size).split('x').map(Number);
  const pixels = (w || 1024) * (h || 1024);
  const side = Object.keys(entry.classes).map(Number).sort((a, b) => a - b).find(s => s * s >= pixels * 0.999) || 2048;
  return entry.classes[side];
}

// ─── Prompt sanitising: never people, names, brands, numbers or text ────────
const LEAGUES_AND_BRANDS = [
  'nba', 'wnba', 'nfl', 'mlb', 'nhl', 'mls', 'ncaa', 'ncaaf', 'ncaab', 'pga', 'pga tour', 'lpga', 'liv', 'liv golf', 'dp world', 'ufc', 'wwe', 'aew',
  'fifa', 'uefa', 'premier league', 'la liga', 'atp', 'wta', 'f1', 'formula one', 'formula 1', 'nascar', 'indycar', 'olympic', 'olympics', 'espn', 'fox', 'cbs', 'nbc', 'tnt',
  'nike', 'adidas', 'puma', 'under armour', 'jordan', 'gatorade', 'rolex', 'titleist', 'callaway', 'taylormade', 'ping', 'spalding', 'wilson', 'new balance', 'red bull',
  'super bowl', 'world series', 'stanley cup', 'masters', 'the masters', 'wimbledon', 'us open', 'u.s. open', 'open championship', 'ryder cup', 'solheim cup',
  'march madness', 'final four', 'all-star', 'all star', 'world cup', 'champions league', 'daytona', 'indy', 'augusta', 'tour championship', 'fedex', 'fedex cup',
  'lakers', 'celtics', 'warriors', 'knicks', 'bulls', 'heat', 'cowboys', 'chiefs', 'eagles', 'patriots', 'packers', 'yankees', 'dodgers', 'red sox', 'cubs',
  'fever', 'liberty', 'aces', 'sky', 'lynx', 'mercury', 'storm', 'wings', 'sparks', 'valkyries',
];
const PERSON_WORDS = [
  'player', 'players', 'athlete', 'athletes', 'golfer', 'golfers', 'quarterback', 'qb', 'pitcher', 'batter', 'striker', 'goalkeeper', 'boxer', 'fighter', 'driver', 'drivers', 'racer',
  'coach', 'coaches', 'manager', 'referee', 'umpire', 'caddie', 'caddy', 'rookie', 'rookies', 'veteran', 'star', 'stars', 'superstar', 'legend', 'legends', 'goat', 'mvp',
  'champion', 'champions', 'winner', 'winners', 'captain', 'team-mate', 'teammate', 'teammates', 'fan', 'fans', 'spectator', 'spectators', 'supporter', 'supporters',
  'man', 'men', 'woman', 'women', 'boy', 'boys', 'girl', 'girls', 'guy', 'lady', 'person', 'people', 'human', 'humans', 'figure', 'figures', 'body', 'bodies', 'silhouette', 'silhouettes',
  'face', 'faces', 'head', 'heads', 'hand', 'hands', 'arm', 'arms', 'portrait', 'portraits', 'selfie', 'headshot', 'celebrity', 'celebrities', 'model', 'models',
  'someone', 'somebody', 'anyone', 'anybody', 'everyone', 'everybody', 'nobody', 'he', 'she', 'him', 'her', 'his', 'hers', 'they', 'them', 'their', 'himself', 'herself', 'dunking', 'celebrating', 'swinging', 'holding', 'kissing', 'hugging', 'crying', 'smiling',
  // Action verbs imply a person doing them.
  'dunk', 'dunks', 'shoots', 'shooting', 'scores', 'scoring', 'throws', 'throwing', 'catches', 'catching', 'tackles', 'tackling', 'runs', 'running', 'sprints', 'sprinting',
  'jumps', 'jumping', 'blocks', 'blocking', 'swings', 'celebrates', 'wins', 'winning', 'earns', 'earn', 'lifts', 'lifting', 'kneels', 'kneeling', 'punches', 'punching',
  'kicks', 'kicking', 'pitching', 'batting', 'serving', 'plays', 'playing', 'waves', 'waving', 'points', 'pointing', 'roars', 'roaring', 'cheering', 'cheers', 'screams',
];
const RENDER_WORDS = [
  'logo', 'logos', 'jersey', 'jerseys', 'uniform', 'uniforms', 'kit', 'kits', 'text', 'texts', 'letter', 'letters', 'lettering', 'word', 'words', 'headline', 'headlines',
  'caption', 'captions', 'title', 'typography', 'font', 'sign', 'signs', 'signage', 'banner', 'banners', 'billboard', 'number', 'numbers', 'wordmark', 'emblem', 'crest', 'badge',
  'mascot', 'brand', 'brands', 'branded', 'trademark', 'watermark', 'sponsor', 'sponsors', 'autograph', 'signature', 'name', 'names',
];
// Big-money words make models print figures; the concept hints carry the idea instead.
const AMOUNT_WORDS = ['million', 'millions', 'billion', 'billions', 'thousand', 'grand', 'k', 'm', 'usd', 'dollar-sign'];
const COMMON_STARTS = new Set([
  'a', 'an', 'the', 'empty', 'golden', 'giant', 'huge', 'massive', 'dramatic', 'dark', 'bright', 'abstract', 'stacks', 'stack', 'pile', 'rows', 'row', 'close-up', 'macro',
  'aerial', 'wide', 'night', 'dawn', 'dusk', 'sunset', 'sunrise', 'rain', 'storm', 'snow', 'fog', 'misty', 'glowing', 'gleaming', 'shiny', 'polished', 'vintage', 'modern',
  'trophy', 'trophies', 'cup', 'ball', 'balls', 'stadium', 'arena', 'court', 'course', 'field', 'pitch', 'green', 'fairway', 'track', 'rink', 'ring', 'crowd', 'money',
  'light', 'lights', 'speed', 'motion', 'texture', 'concrete', 'grass', 'turf', 'ice', 'clay', 'gold', 'silver', 'blue', 'red', 'black', 'white', 'final', 'last', 'one',
]);
const PERSON_SET = new Set(PERSON_WORDS);
const AMOUNT_SET = new Set(AMOUNT_WORDS);
const RENDER_SET = new Set(RENDER_WORDS);
// Concepts that need a safe phrasing rather than removal.
const SAFE_PHRASES = [
  [/\bcrowds?\b/g, 'a distant out-of-focus stadium crowd reduced to soft bokeh lights'],
  [/\b(?:money|cash|dollars?|bills?|banknotes?)\b/g, 'neat stacks of blank unmarked banknotes'],
];

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns { text, removed: [...] }. text is lowercase plain words only.
function sanitizePrompt(value, { avoid = [] } = {}) {
  const removed = [];
  let text = String(value || '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().slice(0, 400);
  // Phrases the caller knows are names (the brief's people and teams).
  (Array.isArray(avoid) ? avoid : []).map(item => String(item || '').trim()).filter(item => item.length >= 2).slice(0, 30).forEach(term => {
    const re = new RegExp(`\\b${escapeRegExp(term)}(?:'s)?\\b`, 'gi');
    if (re.test(text)) removed.push(term.toLowerCase());
    text = text.replace(re, ' ');
  });
  // Capitalised words are names, teams, leagues or brands. A capital at the
  // start of a sentence is kept only for common scene words ("Empty", "Golden").
  const words = text.split(' ').filter(Boolean);
  const kept = [];
  words.forEach((word, index) => {
    const bare = word.replace(/[^A-Za-z0-9$'&.-]/g, '');
    if (!bare) return;
    const sentenceStart = index === 0 || /[.!?:;]$/.test(words[index - 1]);
    const lower = bare.toLowerCase().replace(/[^a-z-]/g, '');
    const capital = /[A-Z]/.test(bare) && !(sentenceStart && /^[A-Z][a-z-]*$/.test(bare) && COMMON_STARTS.has(lower));
    if (capital) { removed.push(bare.toLowerCase()); return; }
    if (/\d|\$/.test(bare)) { removed.push(bare.toLowerCase()); return; }
    kept.push(bare.toLowerCase().replace(/'s$/, ''));
  });
  text = ` ${kept.join(' ')} `;
  // Multi-word leagues and brands first, then single words.
  [...LEAGUES_AND_BRANDS].sort((a, b) => b.length - a.length).forEach(term => {
    const re = new RegExp(`(?<=\\s)${escapeRegExp(term)}(?=\\s)`, 'g');
    if (re.test(text)) removed.push(term);
    text = text.replace(re, ' ');
  });
  text = text.split(' ').filter(Boolean).filter(word => {
    const plain = word.replace(/[^a-z-]/g, '');
    if (PERSON_SET.has(plain) || RENDER_SET.has(plain) || AMOUNT_SET.has(plain)) { removed.push(plain); return false; }
    return /[a-z]/.test(plain);
  }).join(' ');
  SAFE_PHRASES.forEach(([re, phrase]) => { text = text.replace(re, phrase); });
  text = text.replace(/[^a-z ,'-]/g, ' ').replace(/\s+/g, ' ').replace(/\b(and|with|of|the|a|an|in|on|at|for)( \1)+\b/g, '$1').trim();
  // Drop dangling little words left where names were ("at the", "on a").
  const list = text.split(' ').filter(Boolean);
  while (list.length && STOP.has(list[0])) list.shift();
  while (list.length && STOP.has(list[list.length - 1])) list.pop();
  text = list.join(' ');
  return { text: text.slice(0, 220), removed: [...new Set(removed)] };
}
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'with', 'of', 'in', 'on', 'at', 'for', 'to', 'by', 'from', 'as', 'is', 'are', 'its', 'this', 'that', 'over', 'into']);
// Enough real words left to describe a picture?
const contentWords = text => String(text || '').split(' ').filter(word => word && !STOP.has(word)).length;

// Last line of defence on the final prompt text (the template's own words are
// known safe; this is for the subject part only). True when it is clean.
function subjectIsClean(text) {
  const words = String(text || '').toLowerCase().split(/[^a-z-]+/).filter(Boolean);
  return !words.some(word => PERSON_SET.has(word) || RENDER_SET.has(word)) && !/[A-Z0-9$]/.test(String(text || ''));
}

const NO_PEOPLE = 'Strictly no people: no human figures, no faces, no hands, no silhouettes, no players, no spectators in focus.';
const NO_MARKS = 'No logos, no brand marks, no team names, no jerseys or uniforms, no flags, no text, no letters, no numbers, no signage, no watermark.';

// ─── Colour words for the palette ──────────────────────────────────────────
const NAMED = [
  ['black', [0, 0, 0]], ['charcoal', [40, 44, 52]], ['white', [255, 255, 255]], ['silver grey', [170, 175, 182]],
  ['electric blue', [10, 125, 250]], ['deep navy', [3, 49, 98]], ['sky blue', [110, 180, 240]], ['teal', [0, 128, 128]],
  ['emerald green', [0, 140, 70]], ['fairway green', [60, 130, 60]], ['lime', [170, 220, 40]], ['gold', [212, 175, 55]],
  ['amber', [255, 176, 0]], ['orange', [255, 120, 0]], ['signal red', [215, 25, 40]], ['crimson', [150, 15, 40]],
  ['maroon', [110, 20, 30]], ['violet', [100, 50, 140]], ['pink', [240, 100, 160]], ['brown', [120, 80, 40]], ['cream', [245, 235, 210]],
];
function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function colourName(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  let best = NAMED[0];
  let bestD = Infinity;
  NAMED.forEach(entry => {
    const d = entry[1].reduce((sum, v, i) => sum + (v - rgb[i]) ** 2, 0);
    if (d < bestD) { bestD = d; best = entry; }
  });
  return best[0];
}
const ES_PALETTE = ['#0A7DFA', '#033162', '#000000', '#FFFFFF'];
function cleanPalette(palette) {
  const list = (Array.isArray(palette) ? palette : []).map(hex => String(hex || '').trim()).filter(hex => hexToRgb(hex)).map(hex => `#${hex.replace('#', '').toUpperCase()}`);
  return [...new Set(list)].slice(0, 4).length ? [...new Set(list)].slice(0, 4) : ES_PALETTE;
}
function paletteText(palette) {
  return cleanPalette(palette).map(hex => `${colourName(hex)} (${hex})`).join(', ');
}

// ─── Prompt templates ──────────────────────────────────────────────────────
// Default subjects per sport when the caller's words sanitise to nothing.
const SPORT_SCENES = {
  golf: 'a manicured golf green at golden hour with a flagstick and long shadows',
  basketball: 'an empty hardwood basketball court under arena lights, polished floor reflections',
  football: 'an empty american football stadium at night under floodlights, field turf and yard lines',
  baseball: 'an empty baseball diamond at dusk, infield dirt and chalk lines under lights',
  tennis: 'an empty tennis court with a net in crisp afternoon light',
  soccer: 'an empty soccer pitch at night under floodlights, striped grass',
  hockey: 'an empty ice hockey rink with fresh ice under arena lights',
  racing: 'an empty race track at dusk with tyre marks and pit lane lights',
  boxing: 'an empty boxing ring under a single overhead spotlight',
  sports: 'an empty sports stadium at night under bright floodlights',
};
function sportKey(sport) {
  const s = String(sport || '').toLowerCase();
  if (/golf|pga|lpga|liv/.test(s)) return 'golf';
  if (/basket|nba|wnba|cbb/.test(s)) return 'basketball';
  if (/football|nfl|cfb|ncaaf/.test(s) && !/soccer/.test(s)) return 'football';
  if (/baseball|mlb/.test(s)) return 'baseball';
  if (/tennis|atp|wta/.test(s)) return 'tennis';
  if (/soccer|mls|premier|fifa|uefa/.test(s)) return 'soccer';
  if (/hockey|nhl/.test(s)) return 'hockey';
  if (/f1|formula|nascar|indy|racing|motor/.test(s)) return 'racing';
  if (/box|ufc|mma|fight/.test(s)) return 'boxing';
  return 'sports';
}
const SPACE_TEXT = {
  top: 'Keep the top third calm and uncluttered for a headline.',
  bottom: 'Keep the bottom third calm and uncluttered for a headline.',
  left: 'Keep the left half calm and uncluttered for type.',
  right: 'Keep the right half calm and uncluttered for type.',
  center: 'Keep the centre calm and uncluttered for a large number.',
  none: '',
};
const FRAME_TEXT = { '4:5': 'Vertical 4:5 frame.', '9:16': 'Tall vertical 9:16 frame.', '1:1': 'Square frame.', '16:9': 'Wide 16:9 frame.' };

const STYLE_TEMPLATES = {
  photo: ({ subject, palette, space, frame }) => [
    `Editorial sports photograph used as a social media background: ${subject}.`,
    'Shot on a full-frame camera with a 35mm lens, cinematic stadium or natural light, deep contrast, shallow depth of field, fine film grain.',
    `Colour grade leaning toward ${palette}.`,
    frame, space,
    'Photorealistic, high detail, premium sports magazine quality.',
  ],
  illustration: ({ subject, palette, space, frame }) => [
    `Bold editorial sports poster illustration: ${subject}.`,
    'Flat graphic shapes, clean vector edges, strong geometric composition, dynamic diagonals, subtle risograph paper grain.',
    `Limited palette of ${palette} only.`,
    frame, space,
    'Modern, confident, graphic; no realistic rendering.',
  ],
  texture: ({ subject, palette, frame }) => [
    `Full-frame background texture: ${subject}.`,
    'Even lighting, no focal object, no horizon, subtle tonal variation, high-resolution surface detail, suitable under type.',
    `Tones of ${palette}.`,
    frame,
  ],
  abstract: ({ subject, palette, space, frame }) => [
    `Abstract motion background evoking ${subject}.`,
    'Sweeping light trails, speed streaks and soft glow, layered gradients, haze and depth, strong diagonal energy from lower left to upper right.',
    `Palette of ${palette}.`,
    frame, space,
    'No recognisable objects; pure energy and light.',
  ],
};
const STYLE_DEFAULTS = {
  texture: sport => ({
    golf: 'macro of freshly cut fairway grass', basketball: 'macro of polished hardwood court grain', football: 'macro of stadium field turf',
    baseball: 'macro of infield clay and chalk dust', tennis: 'macro of hard court acrylic surface', soccer: 'macro of pitch grass blades',
    hockey: 'macro of scratched rink ice', racing: 'macro of asphalt and tyre rubber', boxing: 'macro of worn ring canvas', sports: 'macro of worn concrete with subtle grit',
  })[sportKey(sport)],
  abstract: sport => `the speed and energy of ${sportKey(sport) === 'sports' ? 'a big game night' : sportKey(sport)}`,
};

function buildBackgroundPrompt({ prompt, style = 'photo', palette, size, space = 'top', sport, avoid } = {}) {
  const chosen = STYLES.includes(style) ? style : 'photo';
  const clean = sanitizePrompt(prompt, { avoid });
  let subject = clean.text;
  if (contentWords(subject) < 2) subject = chosen === 'photo' || chosen === 'illustration' ? SPORT_SCENES[sportKey(sport)] : STYLE_DEFAULTS[chosen](sport);
  const canvas = CANVAS[canvasFor(size)];
  const lines = STYLE_TEMPLATES[chosen]({
    subject,
    palette: paletteText(palette),
    space: SPACE_TEXT[space] ?? SPACE_TEXT.top,
    frame: FRAME_TEXT[canvas.aspect],
  });
  return { prompt: [...lines, NO_PEOPLE, NO_MARKS].filter(Boolean).join(' '), subject, style: chosen, removed: clean.removed };
}

// Allowed concept families (contract): trophies, money, stadiums, balls, crowds, weather, abstract motion.
const CONCEPT_HINTS = [
  [/trophy|cup|title|championship|medal|belt|ring/, 'a gleaming trophy as the hero object'],
  [/money|cash|prize|purse|million|dollar|payday|contract|salary/, 'stacks of blank banknotes and a sense of a huge prize'],
  [/stadium|arena|venue|course|court|field|pitch|ballpark|track/, 'a monumental empty venue'],
  [/ball|puck|club|bat|racket|glove|helmet|tee/, 'the sport\'s equipment as a sculptural hero object'],
  [/crowd|atmosphere|noise|sold out|sellout/, 'an electric atmosphere of distant out-of-focus lights'],
  [/rain|storm|snow|wind|heat|weather|fog|sun/, 'dramatic weather as the mood'],
  [/speed|motion|race|chase|clutch|momentum|comeback/, 'abstract motion and light trails'],
  [/end|final|finale|last|season|countdown|deadline/, 'a sense of an ending: last light of the day, long shadows'],
  [/card|cut|qualify|status|ranking|list|top/, 'a precise, orderly arrangement of identical blank cards'],
];
const SPORT_PROPS = {
  golf: 'golf ball, flagstick, green', basketball: 'basketball, hoop and net', football: 'american football, goalposts', baseball: 'baseball, bat, diamond',
  tennis: 'tennis ball, racket, net', soccer: 'soccer ball, goal net', hockey: 'puck, stick, ice', racing: 'tyres, chequered pattern, asphalt',
  boxing: 'gloves, ring ropes', sports: 'stadium lights',
};
function buildConceptPrompt({ concept, sport, palette, avoid, size, space = 'top' } = {}) {
  const clean = sanitizePrompt(concept, { avoid });
  const key = sportKey(sport);
  const hints = CONCEPT_HINTS.filter(([re]) => re.test(String(concept || '').toLowerCase())).map(([, hint]) => hint).slice(0, 2);
  const subject = contentWords(clean.text) >= 2 ? clean.text : (hints[0] || 'a gleaming trophy as the hero object');
  const canvas = CANVAS[canvasFor(size)];
  const lines = [
    `Conceptual sports art for a social media post: ${subject}.`,
    hints.length ? `Visual idea: ${hints.join('; ')}.` : '',
    `Set in a ${key === 'sports' ? 'big-game' : key} world (${SPORT_PROPS[key]}).`,
    'One clear hero object, dramatic rim lighting, premium studio still-life or polished 3D render, dark backdrop with gentle falloff, symbolic and bold like a magazine cover concept.',
    `Colour palette: ${paletteText(palette)}.`,
    FRAME_TEXT[canvas.aspect], SPACE_TEXT[space] ?? SPACE_TEXT.top,
    NO_PEOPLE, NO_MARKS,
  ];
  return { prompt: lines.filter(Boolean).join(' '), subject, removed: clean.removed, sport: key };
}

// ─── Image bytes ───────────────────────────────────────────────────────────
function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  return match ? { mime: match[1], base64: match[2], bytes: Buffer.from(match[2], 'base64') } : null;
}
function sniffMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
  if (bytes.slice(0, 4).toString('latin1') === 'RIFF' && bytes.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return '';
}
// Width and height from PNG / JPEG / WebP headers (no decoder needed).
function imageSize(bytes) {
  try {
    const mime = sniffMime(bytes);
    if (mime === 'image/png') return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xFF) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
          return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
        }
        i += 2 + bytes.readUInt16BE(i + 2);
      }
    }
    if (mime === 'image/webp') {
      const chunk = bytes.slice(12, 16).toString('latin1');
      if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
      if (chunk === 'VP8L') {
        const b = bytes.readUInt32LE(21);
        return { width: (b & 0x3FFF) + 1, height: ((b >> 14) & 0x3FFF) + 1 };
      }
      if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3FFF, height: bytes.readUInt16LE(28) & 0x3FFF };
    }
  } catch { /* unknown header */ }
  return { width: 0, height: 0 };
}

// ─── Gateway request shapes ────────────────────────────────────────────────
// Docs (checked 2026-11-17):
//   image-only models  POST /v1/images/generations {model, prompt, n, size, response_format:'b64_json', providerOptions}
//     https://vercel.com/docs/ai-gateway/modalities/image-generation/openai#image-only-models
//   reference images   POST /v1/images/edits JSON {model, prompt, images:[{image_url}]}
//     https://vercel.com/docs/ai-gateway/modalities/image-generation/openai#reference-images-by-url
//   Gemini (Nano Banana) POST /v1/chat/completions {model, modalities:['text','image'], messages}
//     -> choices[0].message.images[0].image_url.url (a data URL)
//     https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/image-generation
//   Not documented, so sent best-effort and dropped on a 400: providerOptions.google.imageConfig
//   {aspectRatio, imageSize} (the AI SDK's Google option names) and a top-level seed.
function imageRequest({ model, prompt, size, aspect, quality, seed, referenceUrl, plain = false }) {
  if (family(model) === 'google') {
    const content = referenceUrl ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: referenceUrl } }] : prompt;
    return {
      url: `${GATEWAY}/chat/completions`,
      body: {
        model,
        modalities: ['text', 'image'],
        messages: [{ role: 'user', content }],
        ...(plain ? {} : { providerOptions: { google: { imageConfig: { aspectRatio: aspect, imageSize: quality === 'high' ? '2K' : '1K' } } } }),
      },
    };
  }
  const providerOptions = family(model) === 'bfl' ? { blackForestLabs: { outputFormat: 'jpeg', safetyTolerance: 2 } } : {};
  const common = { model, prompt, n: 1, size, response_format: 'b64_json', ...(Object.keys(providerOptions).length ? { providerOptions } : {}) };
  if (referenceUrl) return { url: `${GATEWAY}/images/edits`, body: { ...common, images: [{ image_url: referenceUrl }] } };
  return { url: `${GATEWAY}/images/generations`, body: { ...common, ...(seed != null && !plain ? { seed } : {}) } };
}

function imageFromResponse(model, data) {
  if (family(model) === 'google') {
    const url = String(data?.choices?.[0]?.message?.images?.[0]?.image_url?.url || '');
    return parseDataUrl(url);
  }
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) return null;
  const bytes = Buffer.from(b64, 'base64');
  const mime = sniffMime(bytes);
  return mime ? { mime, base64: b64, bytes } : null;
}

const isPolicyError = error => /safety|moderation|content policy|nsfw|blocked/i.test(String(error?.message || ''));

async function callImageModel({ model, prompt, size, aspect, quality, seed, referenceUrl, timeoutMs = 55000 }) {
  const send = async plain => {
    const request = imageRequest({ model, prompt, size, aspect, quality, seed, referenceUrl, plain });
    const response = await fetch(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  };
  let { response, data } = await send(false);
  // Our best-effort extras (seed, Gemini imageConfig) are dropped on a 400.
  if (response.status === 400 && !isPolicyError({ message: data?.error?.message })) ({ response, data } = await send(true));
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || `Image request failed: ${response.status}`), { status: response.status });
  const image = imageFromResponse(model, data);
  if (!image) throw new Error('The image model returned no image.');
  return image;
}

// ─── The never-people check (vision, cheapest Claude tier) ─────────────────
const GUARD_PROMPT = [
  'You check AI-generated background art for a sports media brand before it is used.',
  'Look at the image. Reply with JSON only:',
  '{"people": true if any human, face, hand, body or human silhouette is visible (even small or blurred enough to read as a person),',
  '"text": true if any legible letters, words or numbers appear, "logo": true if any logo, brand mark, team crest or jersey appears,',
  '"note": "at most 12 words on what you see"}',
].join(' ');
function guardEnabled(env = process.env) {
  return String(env.GEN_ASSETS_GUARD || '').toLowerCase() !== 'off';
}
async function checkImage(image, track) {
  if (!guardEnabled() || !gateway.gatewayConfigured()) return { checked: false, ok: true, cost: 0 };
  try {
    const { text, cost } = await gateway.aiText({
      tier: 'main',
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } },
        { type: 'text', text: GUARD_PROMPT },
      ] }],
      effort: 'low', maxTokens: 300, timeoutMs: 15000,
      track: { ...track, feature: 'generate-asset-guard' },
    });
    const match = String(text).match(/\{[\s\S]*\}/);
    const verdict = match ? JSON.parse(match[0]) : null;
    if (!verdict) return { checked: false, ok: true, cost };
    const flags = ['people', 'logo', 'text'].filter(key => verdict[key] === true);
    return { checked: true, ok: flags.length === 0, flags, note: String(verdict.note || '').slice(0, 120), cost };
  } catch (error) {
    return { checked: false, ok: true, cost: 0, error: String(error.message || error).slice(0, 120) };
  }
}
const strictGuard = (env = process.env) => envFlag('GEN_ASSETS_GUARD_STRICT', env);

// ─── Cache: memory (per warm server) + Supabase Storage (shared) ───────────
const CACHE = new Map();
const INFLIGHT = new Map();
const CACHE_TTL_MS = 6 * 3600e3;
const CACHE_MAX = 40;
function cacheKey(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (clock.now() - hit.at > CACHE_TTL_MS) { CACHE.delete(key); return null; }
  return hit.value;
}
function cacheSet(key, value) {
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, { at: clock.now(), value });
}
// One request at a time per key: parallel identical asks share one image.
function once(key, make) {
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const promise = make().finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, promise);
  return promise;
}

function storageConfig(env = process.env) {
  const mode = String(env.GEN_ASSETS_STORAGE || 'supabase').toLowerCase();
  const bucket = String(env.GEN_ASSETS_BUCKET || 'frameup-links').trim();
  return { on: mode !== 'off' && /^[a-z0-9-]+$/.test(bucket), bucket, prefix: 'gen-assets' };
}
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
function publicUrl(path, env = process.env) {
  const { bucket } = storageConfig(env);
  return `${authConfig().url}/storage/v1/object/public/${bucket}/${path}`;
}
// Was this exact image made before (by anyone)? A HEAD per likely type.
async function storageLookup(hash) {
  const config = storageConfig();
  if (!config.on) return null;
  const found = await Promise.all(['jpg', 'png', 'webp'].map(async ext => {
    const url = publicUrl(`${config.prefix}/${hash}.${ext}`);
    try {
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
      return response.ok ? url : null;
    } catch {
      return null; // not there, or storage is slow: just generate
    }
  }));
  return found.find(Boolean) || null;
}
async function storageUpload(hash, image, token) {
  const config = storageConfig();
  if (!config.on || !token) return null;
  const path = `${config.prefix}/${hash}.${EXT[image.mime] || 'jpg'}`;
  try {
    const { url, publishableKey } = authConfig();
    const response = await fetch(`${url}/storage/v1/object/${config.bucket}/${path}`, {
      method: 'POST',
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': image.mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-upsert': 'false' },
      body: image.bytes,
      signal: AbortSignal.timeout(8000),
    });
    const text = response.ok ? '' : await response.text().catch(() => '');
    // Already there (same inputs, made by someone else a moment ago) is fine.
    if (response.ok || /duplicate|already exists/i.test(text)) return publicUrl(path);
    return null;
  } catch {
    return null;
  }
}

// ─── Shared generation path ────────────────────────────────────────────────
function fail(reason, error, extra = {}) {
  return { ok: false, reason, error, cost: 0, cached: false, ...extra };
}
const AI_RIGHTS = model => ({ source: `AI generated (${model}) via Vercel AI Gateway`, licence: 'FrameUp-generated art, no real people or marks; free to use in ES designs', aiGenerated: true });

async function gate(ctx, feature) {
  if (ctx.gated) return null;
  return gateway.aiSpendGate(ctx.token, { feature });
}

// Picks the model within ctx.maxCostUsd (steps down to economy, else refuses).
function chooseModel(style, size, quality, ctx) {
  const entry = STYLE_MODELS[style];
  const first = modelForStyle(style);
  const options = [first, entry.economy].filter((m, i, list) => m && list.indexOf(m) === i);
  const cap = Number(ctx.maxCostUsd);
  for (const model of options) {
    const price = priceFor(model, modelSize(model, size, quality), quality);
    if (!(cap >= 0) || price <= cap) return { model, price };
  }
  return null;
}

async function generate(kind, built, args, ctx) {
  const feature = `generate-asset-${kind}`;
  const size = canvasFor(args.size);
  const quality = args.quality === 'high' ? 'high' : 'standard';
  const style = kind === 'concept' ? 'concept' : built.style;
  const picked = chooseModel(style, size, quality, ctx);
  if (!picked) return fail('budget', 'This image would cost more than the run allows.');
  if (!subjectIsClean(built.subject)) return fail('unsafe', 'That prompt could not be made safe (no people, names or marks).');
  if (!gateway.gatewayConfigured() || String(process.env.GENERATE_IMAGES || '').toLowerCase() === 'off') {
    return fail('off', 'AI images are not available right now. ES photos still work.');
  }
  if (gateway.featureDisabled(feature)) return fail('feature-off', gateway.featureOffMessage(feature));
  const seed = Number.isInteger(args.seed) ? args.seed : null;
  const referenceUrl = args.referenceUrl || '';
  const hash = cacheKey({ v: 1, kind, model: picked.model, prompt: built.prompt, size, quality, seed, referenceUrl });
  const meta = { model: picked.model, prompt: built.prompt, removed: built.removed, hash };

  const hit = cacheGet(hash);
  if (hit) return { ...hit, cost: 0, cached: true };
  return once(hash, async () => {
    const stored = await storageLookup(hash);
    if (stored) {
      const [width, height] = modelSize(picked.model, size, quality).split('x').map(Number);
      const value = { ok: true, url: stored, width, height, rights: AI_RIGHTS(picked.model), guard: { checked: true, ok: true, stored: true }, ...meta };
      cacheSet(hash, value);
      return { ...value, cost: 0, cached: true };
    }
    const blocked = await gate(ctx, feature);
    if (blocked) return fail(blocked.reason, blocked.error, { status: blocked.status });

    const track = { feature, email: ctx.email, token: ctx.token, runId: ctx.runId, task: style };
    let cost = 0;
    let model = picked.model;
    let prompt = built.prompt;
    let guard = null;
    let image = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const modelPx = modelSize(model, size, quality);
      const started = clock.now();
      try {
        image = await callImageModel({ model, prompt, size: modelPx, aspect: CANVAS[size].aspect, quality, seed: seed == null ? null : seed + attempt, referenceUrl });
        const price = priceFor(model, modelPx, quality);
        cost += price;
        await gateway.logUsage(track, { model, ok: true, input_tokens: 0, output_tokens: 0, images: 1, cost_usd: price, duration_ms: clock.now() - started });
      } catch (error) {
        await gateway.logUsage(track, { model, ok: false, input_tokens: 0, output_tokens: 0, images: 0, cost_usd: 0, duration_ms: clock.now() - started, error: String(error.message || error).slice(0, 200) });
        if (gateway.isBudgetError(error)) return fail('budget', "This week's AI budget is used up, so AI images are paused until it resets. ES photos still work.", { cost });
        if (isPolicyError(error)) return fail('unsafe', 'The image model refused this prompt.', { cost });
        // One retry on the cheap, reliable model when the chosen one errors.
        if (attempt === 0 && model !== FALLBACK_MODEL && !referenceUrl) { model = FALLBACK_MODEL; continue; }
        return fail('error', 'The image could not be made. Try again in a moment.', { cost });
      }
      guard = await checkImage(image, track);
      cost += guard.cost || 0;
      if (guard.ok && (guard.checked || !strictGuard())) break;
      if (!guard.checked && strictGuard()) return fail('guard', 'The image could not be checked, so it was not used.', { cost });
      // Flagged: one more try, firmer, then give up.
      image = null;
      prompt = `${built.prompt} Absolutely no human figures, faces, lettering or marks anywhere in the frame; objects and environment only.`;
    }
    if (!image) return fail('guard', 'The image showed people, text or a logo, so it was not used.', { cost, guard });

    const size2 = imageSize(image.bytes);
    const url = await storageUpload(hash, image, ctx.token);
    const value = {
      ok: true,
      ...(url ? { url } : { dataUrl: `data:${image.mime};base64,${image.base64}` }),
      width: size2.width, height: size2.height,
      rights: AI_RIGHTS(model),
      guard: { checked: guard.checked, ok: guard.ok, ...(guard.note ? { note: guard.note } : {}) },
      ...meta, model, prompt,
    };
    cacheSet(hash, value);
    return { ...value, cost: Number(cost.toFixed(5)), cached: false };
  });
}

// Image-to-image is for backgrounds only, from an image this service made
// (our storage prefix, or a data URL we produced in this server's cache).
function referenceAllowed(referenceUrl) {
  if (!referenceUrl) return true;
  const config = storageConfig();
  const ours = `${authConfig().url}/storage/v1/object/public/${config.bucket}/${config.prefix}/`;
  if (String(referenceUrl).startsWith(ours) && !/\.\./.test(referenceUrl)) return true;
  if (String(referenceUrl).startsWith('data:image/')) return [...CACHE.values()].some(entry => entry.value?.dataUrl === referenceUrl);
  return false;
}

async function generateBackground(args = {}, ctx = {}) {
  const built = buildBackgroundPrompt(args);
  if (args.referenceUrl && !referenceAllowed(args.referenceUrl)) {
    return fail('reference', 'Style transfer only works from a background FrameUp generated, never from a photo.');
  }
  return generate('background', built, args, ctx);
}

async function generateConceptArt(args = {}, ctx = {}) {
  const built = buildConceptPrompt(args);
  return generate('concept', built, { ...args, referenceUrl: '' }, ctx);
}

// ─── Cut-outs (mask only) ──────────────────────────────────────────────────
// The browser (frameup-assets.js) pads the ES photo to the model's size, sends
// it here as `image` (a data URL) with `size`, and puts the returned mask's
// alpha on the ORIGINAL pixels after checking it lines up (frameup-cutout.js).
// The server has no image decoder, so a bare https imageUrl is refused with
// reason 'client' (call FrameUpAssets.cutout in the browser instead).
const MASK_CACHE = new Map();
const MASK_TTL_MS = 30 * 60 * 1000;
async function cutout(args = {}, ctx = {}) {
  const dataUrl = String(args.image || (String(args.imageUrl || '').startsWith('data:') ? args.imageUrl : ''));
  if (!dataUrl) return fail('client', 'Cut-outs are made in the browser (FrameUpAssets.cutout) so the original photo pixels are kept.');
  const removeBg = ctx.deps?.removeBg || require('./remove-bg.js');
  const { _test: rb } = removeBg;
  const parsed = rb.parseImage(dataUrl);
  if (parsed.error) return fail(parsed.tooLarge ? 'too-large' : 'bad-image', parsed.error);
  if (!rb.configured()) return fail('off', 'Remove background is not set up yet.', { envVar: rb.envVar() });
  const size = ['1024x1024', '1024x1536', '1536x1024'].includes(args.size) ? args.size : '1024x1024';
  const hash = cacheKey({ v: 1, kind: 'cutout', model: rb.model(), size, image: crypto.createHash('sha256').update(parsed.bytes).digest('hex') });
  const rights = { source: args.source || 'ES image pool (original pixels; AI used only for the mask)', licence: args.licence || 'As the source photo', aiGenerated: false };
  const hit = MASK_CACHE.get(hash);
  if (hit && clock.now() - hit.at < MASK_TTL_MS) return { ...hit.value, rights, cost: 0, cached: true };
  return once(hash, async () => {
    const blocked = await gate(ctx, 'remove-bg');
    if (blocked) return fail(blocked.reason, blocked.error, { status: blocked.status });
    const track = { feature: 'remove-bg', task: 'gen-assets', email: ctx.email, token: ctx.token, runId: ctx.runId };
    const started = clock.now();
    try {
      const result = await removeBg.removeBackgroundMask(dataUrl, size);
      await gateway.logUsage(track, { model: result.model, ok: true, input_tokens: Number(result.usage?.input_tokens) || 0, output_tokens: Number(result.usage?.output_tokens) || 0, images: 1, cost_usd: result.cost, duration_ms: clock.now() - started });
      const bytes = parseDataUrl(result.dataUrl)?.bytes || Buffer.alloc(0);
      const dims = imageSize(bytes);
      const value = { ok: true, dataUrl: result.dataUrl, maskOnly: true, size, width: dims.width, height: dims.height, model: result.model };
      if (MASK_CACHE.size > 30) MASK_CACHE.delete(MASK_CACHE.keys().next().value);
      MASK_CACHE.set(hash, { at: clock.now(), value });
      return { ...value, rights, cost: Number(result.cost) || 0, cached: false };
    } catch (error) {
      await gateway.logUsage(track, { model: `openai/${rb.model()}`, ok: false, input_tokens: 0, output_tokens: 0, images: 0, cost_usd: 0, duration_ms: clock.now() - started, error: String(error.message || error).slice(0, 200) });
      if (error.moderation) return fail('moderation', 'This photo couldn’t be processed by the cut-out model.');
      return fail('error', 'The background could not be removed. Try again in a moment.');
    }
  });
}

// ─── ES photos: several DIFFERENT candidates ───────────────────────────────
const proxied = url => `/api/es-image-search?image=${encodeURIComponent(url)}`;
// The same photo at another size / crop / host has the same stem:
// .../player-name-1536x1024.jpg, .../player-name-scaled.jpg, ...?w=800
function photoStem(url) {
  try {
    const parsed = new URL(url);
    const file = decodeURIComponent(parsed.pathname.split('/').pop() || '').toLowerCase();
    return file.replace(/\.(jpe?g|png|webp|avif|gif)$/, '').replace(/-(\d{2,4})x(\d{2,4})$/, '').replace(/-(scaled|rotated|e\d{6,})$/, '').replace(/-\d+$/, '');
  } catch {
    return String(url || '').toLowerCase();
  }
}
const captionKey = photo => `${String(photo.caption || '').toLowerCase().replace(/[^a-z ]/g, '').trim().slice(0, 80)}|${String(photo.credit || '').toLowerCase().trim()}`;

function dedupePhotos(list, exclude = []) {
  const seenStem = new Set((exclude || []).map(photoStem));
  const seenCaption = new Set();
  const out = [];
  list.forEach(photo => {
    if (!photo?.sourceUrl) return;
    const stem = photoStem(photo.sourceUrl);
    if (!stem || seenStem.has(stem)) return;
    const caption = captionKey(photo);
    // One frame of a burst (same caption and credit) is enough.
    if (caption.length > 12 && seenCaption.has(caption)) return;
    seenStem.add(stem);
    if (caption.length > 12) seenCaption.add(caption);
    out.push(photo);
  });
  return out;
}

const PHOTO_RIGHTS = {
  'es-agency': { source: 'ES image pool (agency, via ES MCP)', licence: 'ES agency licence (editorial use on ES channels)', aiGenerated: false },
  'es-article': { source: 'ES article lead image', licence: 'As used on essentiallysports.com (editorial)', aiGenerated: false },
  'es-media': { source: 'ES WordPress media library', licence: 'As used on essentiallysports.com (editorial)', aiGenerated: false },
};
function photoRecord(raw, source, matched) {
  return {
    id: String(raw.id || raw.sourceUrl).slice(0, 200),
    url: proxied(raw.sourceUrl),
    sourceUrl: raw.sourceUrl,
    title: String(raw.title || '').slice(0, 160),
    caption: String(raw.caption || '').slice(0, 300),
    credit: String(raw.credit || '').slice(0, 120),
    articleUrl: raw.articleUrl || '',
    date: raw.date || '',
    width: Number(raw.width) || null,
    height: Number(raw.height) || null,
    source,
    matched,
    rights: PHOTO_RIGHTS[source],
  };
}

function defaultPhotoDeps() {
  const search = require('./es-image-search.js')._internals;
  const generate = require('./es-generate.js')._test;
  return {
    allowed: url => { try { return search.isAllowedImageUrl(new URL(url)); } catch { return false; } },
    agency: (query, n) => search.callMcpSearchImages(query, n),
    media: (query, n) => search.searchWordPressMedia(query, n),
    articles: query => generate.esCoverage(query).then(found => found.articles || []),
    rank: rankPhotos,
  };
}

// Vision ranking (extends es-generate's pickPhoto: one call scores every
// photo instead of naming one). Cached 30 minutes per person + photo set.
const RANK_CACHE = new Map();
const RANK_TTL_MS = 30 * 60 * 1000;
const RANK_MAX = 8;
async function rankPhotos({ person, photos, track }) {
  if (photos.length < 2 || !gateway.gatewayConfigured()) return { ranked: false, cost: 0, scores: [] };
  const shown = photos.slice(0, RANK_MAX);
  const key = `${String(person || '').toLowerCase()}|${shown.map(p => p.sourceUrl).join('|')}`;
  const hit = RANK_CACHE.get(key);
  if (hit && clock.now() - hit.at < RANK_TTL_MS) return { ...hit.value, cost: 0, cached: true };
  const who = person ? `${person} clearly visible and recognisable (alone, face visible, sharp)` : 'a strong, sharp sports moment';
  const content = [{ type: 'text', text: [
    `Score each photo for a bold sports Instagram design. We want ${who}.`,
    'For each photo give: subject (true if it shows that person, or for no person: a usable sports moment), score 1-5 (sharpness, drama, room to crop), kind (action | portrait | celebration | reaction | venue | object | group),',
    'graphic (true for collages, graphics, screenshots, text-heavy images or photos of other people).',
    'Reply with JSON only: {"photos":[{"n":1,"subject":true,"score":4,"kind":"action","graphic":false}]}',
  ].join(' ') }];
  shown.forEach((photo, index) => content.push({ type: 'text', text: `Photo ${index + 1}:` }, { type: 'image', source: { type: 'url', url: photo.sourceUrl } }));
  try {
    const { text, cost } = await gateway.aiText({ tier: 'main', messages: [{ role: 'user', content }], effort: 'low', maxTokens: 1200, timeoutMs: 15000, track: { ...track, feature: 'generate-photo-pick', task: 'gen-assets-rank' } });
    const match = String(text).match(/\{[\s\S]*\}/);
    const rows = match ? JSON.parse(match[0])?.photos : null;
    if (!Array.isArray(rows)) return { ranked: false, cost, scores: [] };
    const scores = rows.map(row => ({ n: Number(row.n), subject: row.subject !== false, score: Math.max(1, Math.min(5, Number(row.score) || 3)), kind: String(row.kind || '').toLowerCase().slice(0, 20), graphic: row.graphic === true }))
      .filter(row => row.n >= 1 && row.n <= shown.length);
    const value = { ranked: true, scores };
    if (RANK_CACHE.size > 200) RANK_CACHE.clear();
    RANK_CACHE.set(key, { at: clock.now(), value });
    return { ...value, cost };
  } catch {
    return { ranked: false, cost: 0, scores: [] };
  }
}

// Greedy pick for variety: the best photo first, then each next one loses
// points for repeating a kind or an article already picked.
function diversify(photos, count) {
  const left = [...photos];
  const out = [];
  while (out.length < count && left.length) {
    let bestIndex = 0;
    let best = -Infinity;
    left.forEach((photo, index) => {
      const sameKind = out.filter(p => p.kind && p.kind === photo.kind).length;
      const sameArticle = out.filter(p => p.articleUrl && p.articleUrl === photo.articleUrl).length;
      const value = (photo.rank ?? 0) - 0.8 * sameKind - 0.6 * sameArticle;
      if (value > best) { best = value; bestIndex = index; }
    });
    out.push(left.splice(bestIndex, 1)[0]);
  }
  return out;
}

const PHOTO_CACHE = new Map();
const PHOTO_TTL_MS = 15 * 60 * 1000;
const cleanQuery = value => String(value || '').replace(/[^\w\s.'’&-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

async function findPhotos(args = {}, ctx = {}) {
  const person = cleanQuery(args.person);
  const team = cleanQuery(args.team);
  const sport = cleanQuery(args.sport);
  const query = cleanQuery(args.query);
  const count = Math.max(1, Math.min(12, Number(args.count) || 6));
  const exclude = (Array.isArray(args.exclude) ? args.exclude : []).map(String).slice(0, 50);
  const queries = [
    person && ['person', person],
    person && team && ['person', `${person} ${team}`],
    team && ['team', team],
    query && query !== person && ['query', query],
    !person && !team && !query && sport && ['sport', sport],
  ].filter(Boolean);
  if (!queries.length) return fail('empty', 'Name a person, team or topic to find ES photos.');
  const deps = { ...defaultPhotoDeps(), ...(ctx.deps || {}) };

  const key = JSON.stringify({ queries, count, exclude });
  const hit = PHOTO_CACHE.get(key);
  if (hit && clock.now() - hit.at < PHOTO_TTL_MS) return { ...hit.value, cost: 0, cached: true };

  const gathered = [];
  await Promise.all(queries.map(async ([matched, q], order) => {
    const [agency, articles, media] = await Promise.all([
      deps.agency(q, 12).catch(() => []),
      order === 0 || matched === 'query' ? deps.articles(q).catch(() => []) : Promise.resolve([]),
      deps.media(q, 10).catch(() => []),
    ]);
    agency.forEach(item => gathered.push({ order, weight: 3, photo: photoRecord(item, 'es-agency', matched) }));
    articles.filter(a => a.image).forEach(a => gathered.push({ order, weight: 2, photo: photoRecord({ id: a.url, sourceUrl: a.image, title: a.title, articleUrl: a.url, date: a.date }, 'es-article', matched) }));
    media.forEach(item => gathered.push({ order, weight: 1, photo: photoRecord(item, 'es-media', matched) }));
  }));
  // Person matches first, agency before article before library, then dedupe.
  gathered.sort((a, b) => a.order - b.order || b.weight - a.weight);
  const unique = dedupePhotos(gathered.map(entry => entry.photo).filter(photo => deps.allowed(photo.sourceUrl)), exclude);
  if (!unique.length) return { ok: true, photos: [], cost: 0, cached: false, ranked: false, rights: PHOTO_RIGHTS['es-media'] };

  // Rank with vision when it can pay off (more photos than asked for, or a person to check).
  let cost = 0;
  let ranked = false;
  const pool = unique.slice(0, Math.max(count + 2, RANK_MAX));
  pool.forEach((photo, index) => { photo.rank = 3 - index * 0.05; });
  if (pool.length >= 2 && (person || pool.length > count) && gateway.gatewayConfigured()) {
    const blocked = await gate(ctx, 'generate-photo-pick');
    if (!blocked) {
      const result = await deps.rank({ person, photos: pool, track: { email: ctx.email, token: ctx.token, runId: ctx.runId } });
      cost += result.cost || 0;
      if (result.ranked) {
        ranked = true;
        result.scores.forEach(row => {
          const photo = pool[row.n - 1];
          if (!photo) return;
          photo.kind = row.kind;
          photo.subject = row.subject;
          photo.graphic = row.graphic;
          photo.rank = row.score + (row.subject ? 2 : -3) + (row.graphic ? -4 : 0) - (row.n - 1) * 0.02;
        });
      }
    }
  }
  const usable = ranked ? pool.filter(photo => photo.graphic !== true && (photo.subject !== false || !person)) : pool;
  const photos = diversify(usable.length ? usable : pool, count).map(({ rank, ...photo }) => ({ ...photo, score: Number((rank ?? 0).toFixed(2)) }));
  const first = photos[0];
  const value = { ok: true, url: first?.url, width: first?.width, height: first?.height, rights: first?.rights, photos, ranked };
  if (PHOTO_CACHE.size > 100) PHOTO_CACHE.delete(PHOTO_CACHE.keys().next().value);
  PHOTO_CACHE.set(key, { at: clock.now(), value });
  return { ...value, cost: Number(cost.toFixed(5)), cached: false };
}

// ─── Imagery v3 (Generate): photos, cut-outs, headshots, logos per run ─────
// See _imagery.js. Default deps are the same ES sources findPhotos uses, the
// vision ranker (only with a Gateway key, behind the spend gate), and a HEAD on
// the shared cut-out store.
const IMAGERY = require('./_imagery.js');
const IMAGERY_CACHE = new Map();
const IMAGERY_TTL_MS = 15 * 60 * 1000;
function imageryDeps(ctx = {}) {
  const base = defaultPhotoDeps();
  const storage = storageConfig();
  return {
    allowed: base.allowed,
    agency: base.agency,
    media: base.media,
    articles: base.articles,
    vision: gateway.gatewayConfigured() ? args => IMAGERY._test.defaultVision({ ...args, gateway }) : null,
    gate: (c, feature) => gate(c, feature),
    storageHas: storage.on ? async path => {
      const url = publicUrl(path);
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
      return response.ok ? url : null;
    } : null,
    ...(ctx.deps || {}),
  };
}
async function prepareImagery(read = {}, ctx = {}) {
  try {
    const key = JSON.stringify({ people: read.people || [], teams: (read.teams || []).map(t => t.name), sport: read.sport || '', stories: (read.stories || []).map(s => s.text) });
    const hit = IMAGERY_CACHE.get(key);
    // A cached answer with cut-outs still to make is rebuilt (finding new ones costs $0).
    if (hit && clock.now() - hit.at < IMAGERY_TTL_MS && !hit.value.cutoutPlan.length) return { ...hit.value, cost: 0, cached: true };
    const value = await IMAGERY.prepareImagery(read, ctx, imageryDeps(ctx));
    // An empty answer (ES search down or slow) is never cached: the next run tries again.
    if (value.photos.length) {
      if (IMAGERY_CACHE.size > 60) IMAGERY_CACHE.delete(IMAGERY_CACHE.keys().next().value);
      IMAGERY_CACHE.set(key, { at: clock.now(), value });
    }
    return { ...value, cached: false };
  } catch (error) {
    return fail('error', 'ES photos could not be gathered.', { photos: [], bySubject: {}, cutouts: [], cutoutPlan: [], headshots: [], logos: [] });
  }
}

// The browser made a cut-out (original pixels, AI mask): store it once under
// the deterministic name for that photo, so every later run finds it at $0.
// Only a PNG with an alpha channel, at most 4 MB, for an ES photo.
const MAX_CUTOUT_BYTES = 4 * 1024 * 1024;
async function storeCutout(args = {}, ctx = {}) {
  const sourceUrl = String(args.sourceUrl || '');
  let allowed = false;
  try { allowed = (ctx.deps?.allowed || defaultPhotoDeps().allowed)(sourceUrl); } catch { allowed = false; }
  if (!allowed) return fail('reference', 'Only cut-outs of ES photos are stored.');
  const parsed = parseDataUrl(String(args.image || ''));
  if (!parsed || sniffMime(parsed.bytes) !== 'image/png') return fail('bad-image', 'Send the cut-out as a PNG.');
  if (parsed.bytes.length > MAX_CUTOUT_BYTES) return fail('too-large', 'That cut-out is too large to store.');
  // PNG colour type 6 (RGBA) or 4 (grey + alpha): a cut-out must have alpha.
  if (![4, 6].includes(parsed.bytes[25])) return fail('bad-image', 'A cut-out needs a transparent background.');
  const dims = imageSize(parsed.bytes);
  if (!dims.width || !dims.height || dims.width > 4096 || dims.height > 4096) return fail('bad-image', 'Unexpected cut-out size.');
  const hash = IMAGERY.cutoutPath(sourceUrl).replace(/^gen-assets\//, '').replace(/\.png$/, '');
  const url = await storageUpload(hash, { mime: 'image/png', bytes: parsed.bytes }, ctx.token);
  if (!url) return fail('error', 'The cut-out could not be stored (it still works for this session).');
  return { ok: true, url, width: dims.width, height: dims.height, cost: 0, cached: false, rights: { source: 'ES photo (original pixels; AI used only for the mask)', licence: 'As the source photo', aiGenerated: false } };
}

// What is set up, for GET /api/gen-assets (no secrets).
function status(env = process.env) {
  const storage = storageConfig(env);
  let cutoutOn = false;
  try { cutoutOn = require('./remove-bg.js')._test.configured(env); } catch { /* optional */ }
  return {
    images: gateway.gatewayConfigured() && String(env.GENERATE_IMAGES || '').toLowerCase() !== 'off',
    cutout: cutoutOn,
    photos: true,
    economy: economy(env),
    guard: guardEnabled(env) ? (strictGuard(env) ? 'strict' : 'on') : 'off',
    storage: storage.on ? `supabase:${storage.bucket}/${storage.prefix}` : 'memory',
    models: Object.fromEntries(Object.keys(STYLE_MODELS).map(style => {
      const model = modelForStyle(style, env);
      return [style, { model, usd: priceFor(model, modelSize(model, DEFAULT_CANVAS)) }];
    })),
  };
}

module.exports = {
  generateBackground, generateConceptArt, cutout, findPhotos, status,
  prepareImagery, storeCutout, inputImagery: IMAGERY.inputImagery, IMAGERY,
  prepareImagery, storeCutout, inputImagery: IMAGERY.inputImagery, IMAGERY,
  STYLE_MODELS, IMAGE_PRICES, CANVAS, STYLES,
  _test: {
    sanitizePrompt, subjectIsClean, buildBackgroundPrompt, buildConceptPrompt, paletteText, colourName, cleanPalette, sportKey,
    imageRequest, imageFromResponse, imageSize, priceFor, modelSize, modelForStyle, chooseModel, referenceAllowed,
    photoStem, dedupePhotos, diversify, rankPhotos, cacheKey, storageConfig, publicUrl,
    CACHE, INFLIGHT, MASK_CACHE, PHOTO_CACHE, RANK_CACHE, IMAGERY_CACHE, IMAGERY_CACHE, clock, NO_PEOPLE, NO_MARKS,
  },
};
