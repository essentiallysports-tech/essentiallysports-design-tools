// Merch Designs: the shared rules (browser: window.MerchRules; server and tests:
// require). No DOM, no network.
//
//   Rights      one policy for the whole feature (RIGHTS_POLICY), the scan that
//               turns a design's words into blocked items and warnings, and
//               the acknowledgement a pusher ticks (who / when / what).
//   Blanks      the curated product kinds (tee, hoodie, poster, sticker, mug)
//               and which Fourthwall templates qualify.
//   Pricing     retail price -> profitMargin (Fourthwall adds it to the base).
//   Shapes      Fourthwall template / product -> the small shapes the page uses.
//   Sample mode where the page uses merch-demo.js instead of the API.
//
// Owner decisions (2026-11-25): products are created HIDDEN and published by a
// person; rights policy 'acknowledge' (player names, nicknames, exact
// attributed quotes and team colours are allowed with a per-item warning the
// pusher must acknowledge); team logos, league marks and "official" claims are
// blocked under every policy. 'strict' blocks names, teams, nicknames and
// quotes too: switching is this one line (or MERCH_RIGHTS_POLICY on the server).
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./frameup-rules.js') : root.FrameUpRules);
  if (isNode) module.exports = api;
  else root.MerchRules = api;
}(typeof self !== 'undefined' ? self : this, (FrameUpRules) => {
  'use strict';

  const VERSION = '2026-11-25';
  const RIGHTS_POLICY = 'acknowledge'; // 'acknowledge' | 'strict'
  const POLICIES = ['acknowledge', 'strict'];
  function policyFrom(env = {}) {
    const v = String(env.MERCH_RIGHTS_POLICY || '').trim().toLowerCase();
    return POLICIES.includes(v) ? v : RIGHTS_POLICY;
  }

  // ─── Collections and print archetypes (the owner's merch board) ──────────
  // Concept.collection ids (merch contract).
  const COLLECTIONS = [
    { id: 'replay', label: 'Replay', blurb: 'An era or a moment fans still talk about.' },
    { id: 'nickname', label: 'Nicknames', blurb: 'Almost famous: the name only real fans know.' },
    { id: 'quote', label: 'In their own words', blurb: 'An exact quote, attributed.' },
    { id: 'core', label: 'Core ES', blurb: 'Essentially Sports: lines that are ours.' },
    { id: 'current', label: 'Current', blurb: 'This week’s story, while it’s hot.' },
  ];
  const COLLECTION_IDS = COLLECTIONS.map(c => c.id);
  // Stack colour keys (Concept.stack[].fill / .ink) and rights kinds.
  const COLOR_KEYS = ['a', 'b', 'ink', 'white'];
  const RIGHTS_KINDS = ['name', 'nickname', 'quote', 'team'];
  // Original ES lines for the Core collection (the board's own words).
  const CORE_LINES = [
    ['WE CENTER', 'FANS'],
    ['DEEP KNOWLEDGE', 'TRUE LOVE'],
    ['THE MOMENTS', 'THAT', 'MATTER'],
    ['ESSENTIALLY', 'SPORTS'],
  ];
  const ES_PALETTE = { a: '#0A7DFA', b: '#033162', ink: '#FFFFFF' };

  // ─── Blanks ───────────────────────────────────────────────────────────
  // q: Fourthwall template searches, first that qualifies wins (cached on the
  // server). MERCH_TEMPLATES="tee=<id>,mug=<id>" pins exact ids instead.
  const BLANKS = {
    // retail: the suggested shop price for the curated blank (owner: tee $29.99 on the
    // $15.85 Stanley/Stella base, a $14.14 margin). margin: the least a suggestion adds
    // when a pricier blank is in use. Suggested = the higher of the two, ending .99.
    tee: { label: 'T-shirt', q: ['t-shirt', 'tee'], apparel: true, minDpi: 150, margin: 12, retail: 29.99 },
    hoodie: { label: 'Hoodie', q: ['hoodie'], apparel: true, minDpi: 150, margin: 18, retail: 49.99 },
    poster: { label: 'Poster', q: ['poster'], apparel: false, minDpi: 300, margin: 10, retail: 17.99 },
    sticker: { label: 'Sticker', q: ['sticker'], apparel: false, minDpi: 300, margin: 4, retail: 5.99 },
    mug: { label: 'Mug', q: ['mug'], apparel: false, minDpi: 300, margin: 10, retail: 17.99 },
  };
  const BLANK_IDS = Object.keys(BLANKS);
  function pinnedTemplates(env = {}) {
    const out = {};
    String(env.MERCH_TEMPLATES || '').split(',').forEach(part => {
      const [k, v] = part.split('=').map(s => String(s || '').trim());
      if (BLANKS[k] && /^[\w-]{3,80}$/.test(v)) out[k] = v;
    });
    return out;
  }

  // ─── Text helpers ─────────────────────────────────────────────────────
  const clip = (v, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[‘’‛`]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9'%.$ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasWord = (text, word) => new RegExp(`(^|[^a-z0-9])${escapeRe(word)}($|[^a-z0-9])`).test(text);

  // Words ES merch never prints: FrameUp's banned list (hype, links, emojis...).
  function bannedIn(text) {
    const list = (FrameUpRules && FrameUpRules.BANNED) || [];
    return list.filter(b => b.re.test(String(text || ''))).map(b => b.why);
  }

  // Numbers on a design must come from the source (never invented).
  const NUMBER_RE = /\d[\d,.]*/g;
  const normNum = s => s.replace(/,/g, '').replace(/\.$/, '').replace(/\.0+$/, '');
  function inventedNumbers(lines, source) {
    const allowed = new Set((String(source || '').match(NUMBER_RE) || []).map(normNum));
    return [...new Set((lines.join(' ').match(NUMBER_RE) || []).map(normNum).filter(n => n && !allowed.has(n)))];
  }
  // A quote must appear word for word in the source (case and quote marks aside).
  function quoteInSource(quote, source) {
    const q = fold(quote).replace(/["']/g, '');
    const s = fold(source).replace(/["']/g, '');
    return q.length >= 3 && s.includes(q);
  }

  // ─── Rights ───────────────────────────────────────────────────────────
  // League and event marks: never printed (both policies).
  const LEAGUE_MARKS = ['NFL', 'NBA', 'MLB', 'NHL', 'WNBA', 'NCAA', 'MLS', 'PGA', 'LPGA', 'UFC', 'NASCAR', 'ATP', 'WTA', 'FIFA', 'SEC', 'Big Ten', 'ACC', 'Big 12',
    'Super Bowl', 'March Madness', 'Final Four', 'World Series', 'Stanley Cup', 'Pro Bowl', 'College Football Playoff', 'Heisman', 'Premier League', 'Formula 1', 'F1', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1', 'Unrivaled'];
  const OFFICIAL_RE = /\b(official(ly)?|licensed|authentic|authorized|endorsed)\b|[®™©]/i;
  // Team nicknames that are also plain words: only a match with the city.
  const COMMON = new Set(['heat', 'magic', 'thunder', 'giants', 'kings', 'sky', 'fever', 'sun', 'wings', 'sparks', 'storm', 'mercury', 'dream', 'liberty', 'lynx', 'aces', 'valkyries', 'jazz', 'nets', 'suns', 'bulls', 'bears', 'lions', 'eagles', 'jets', 'chiefs', 'rams', 'saints', 'titans', 'giants', 'pirates', 'royals', 'reds', 'twins', 'rays', 'angels', 'tigers', 'cardinals', 'braves', 'rockets', 'pistons', 'spurs', 'hawks', 'kings', 'warriors', 'pelicans', 'packers', 'bills', 'browns', 'texans', 'colts', 'commanders', 'vikings', 'ravens', 'dolphins', 'panthers', 'falcons', 'buccaneers', 'cowboys', 'chargers', 'raiders', 'broncos', 'seahawks', 'steelers', 'patriots', 'bengals', 'jaguars', 'ducks', 'wildcats', 'bulldogs', 'gators', 'tide', 'trojans', 'longhorns', 'sooners', 'buckeyes', 'wolverines', 'cougars', 'cyclones', 'huskies', 'volunteers', 'razorbacks', 'gamecocks', 'aggies', 'hurricanes', 'mavericks', 'grizzlies', 'clippers', 'lakers', 'celtics', 'knicks', 'cavaliers', 'hornets', 'wizards', 'timberwolves', 'blazers', 'raptors', '76ers', 'bucks', 'nuggets', 'pacers', 'astros', 'dodgers', 'yankees', 'mets', 'cubs', 'orioles', 'mariners', 'padres', 'phillies', 'brewers', 'marlins', 'nationals', 'rangers', 'guardians', 'athletics', 'rockies', 'diamondbacks', 'white sox', 'red sox', 'blue jays']);
  // Nicknames distinctive enough to flag on their own (a fan reads "LAKERS" as the team).
  const DISTINCT_OK = new Set(['lakers', 'celtics', 'knicks', 'cavaliers', 'clippers', 'mavericks', 'grizzlies', 'timberwolves', 'raptors', '76ers', 'nuggets', 'pacers', 'astros', 'dodgers', 'yankees', 'mets', 'cubs', 'orioles', 'mariners', 'padres', 'phillies', 'brewers', 'marlins', 'diamondbacks', 'red sox', 'white sox', 'blue jays', 'packers', 'steelers', 'cowboys', 'patriots', 'seahawks', 'broncos', 'buccaneers', 'buckeyes', 'wolverines', 'longhorns', 'crimson tide', 'razorbacks', 'gamecocks', 'sooners', 'commanders', 'bengals', 'jaguars', 'raiders', 'chargers']);

  // index: { teams: [{ name, short, sport, city }] } from brand-kit.js and
  // video-ads-teams.js (the repo's team lists).
  function buildRightsIndex({ brandKit = [], vaTeams = [] } = {}) {
    const seen = new Map();
    const add = (name, sport, short) => {
      const full = clip(name, 80);
      if (!full || seen.has(full.toLowerCase())) return;
      const words = full.split(' ');
      const nick = short && short !== full && !full.startsWith(short) ? short : (/(red|white|blue) sox$|blue jays$|crimson tide$|trail blazers$/i.test(full) ? words.slice(-2).join(' ') : words[words.length - 1]);
      const city = full.slice(0, full.length - nick.length).trim();
      seen.set(full.toLowerCase(), { name: full, short: nick, city, sport: String(sport || '') });
    };
    (Array.isArray(brandKit) ? brandKit : []).forEach(t => t && t.team && add(t.team, t.sport));
    (Array.isArray(vaTeams) ? vaTeams : []).forEach(t => t && t.name && add(t.name, t.sport, t.short));
    return { teams: [...seen.values()] };
  }
  function teamsIn(text, index) {
    const t = fold(text);
    const hits = [];
    (index?.teams || []).forEach(team => {
      const full = fold(team.name);
      const nick = fold(team.short);
      const city = fold(team.city);
      if (hasWord(t, full)) hits.push(team);
      else if (nick.length >= 4 && hasWord(t, nick) && (!COMMON.has(nick) || DISTINCT_OK.has(nick) || (city && hasWord(t, city)))) hits.push(team);
    });
    return hits;
  }
  function leagueMarksIn(text) {
    const t = fold(text);
    return LEAGUE_MARKS.filter(m => hasWord(t, fold(m)));
  }
  // Capitalised runs of 2-3 words in the source look like people ("Kobe Bryant").
  const NOT_NAMES = new Set(['The', 'A', 'An', 'And', 'In', 'On', 'At', 'For', 'Of', 'To', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'Essentially', 'Sports', 'EssentiallySports', 'ES', 'Game', 'Week', 'Today', 'This', 'That', 'When', 'After', 'Before', 'He', 'She', 'They', 'We', 'I']);
  function peopleIn(source, index) {
    const teamWords = new Set((index?.teams || []).flatMap(t => t.name.split(' ')));
    const nickWords = new Set((index?.teams || []).flatMap(t => t.short.split(' ')));
    const out = new Set();
    const re = /\b([A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){1,2})\b/g;
    let m;
    while ((m = re.exec(String(source || '')))) {
      const words = m[1].split(/\s+/).filter(w => !NOT_NAMES.has(w) && !nickWords.has(w));
      if (words.length >= 2 && !words.every(w => teamWords.has(w))) out.add(words.join(' '));
    }
    return [...out];
  }

  // Scans a design. input: { lines: [string], source, collection, people: [names the
  // AI said it used], attribution }. Returns { blocked, warnings } where each item is
  // { kind, text, reason } in plain English; ok = nothing blocked.
  function scanRights(input = {}, { policy = RIGHTS_POLICY, index } = {}) {
    const lines = (input.lines || []).map(l => clip(typeof l === 'string' ? l : l?.text, 120)).filter(Boolean);
    const words = lines.join(' / ');
    const source = String(input.source || '');
    const blocked = [];
    const warnings = [];
    const strict = policy === 'strict';
    const flag = (kind, text, reason, alwaysBlock = false) => {
      const list = alwaysBlock || strict ? blocked : warnings;
      if (!list.some(i => i.kind === kind && i.text === text)) list.push({ kind, text, reason });
    };
    leagueMarksIn(words).forEach(m => flag('league-mark', m, `"${m}" is a league or event trademark. ES merch can't print league marks or names of official events.`, true));
    if (OFFICIAL_RE.test(words)) flag('official', words.match(OFFICIAL_RE)[0], 'Words like "official" or "licensed", and ® / ™ symbols, suggest a licence ES doesn’t have.', true);
    if (input.hasImage) flag('logo', 'image', 'Logos, photos and cut-outs can’t go on ES merch: designs are ES pills and type only.', true);
    bannedIn(words).forEach(why => flag('banned', why, `Not ES style: ${why}.`, true));
    teamsIn(words, index).forEach(team => flag('team', team.name, `${team.name} is a team name (a trademark). Team colours are fine; using the name means the team could object.`));
    const people = new Set((input.people || []).map(p => clip(p, 60)).filter(Boolean));
    peopleIn(source, index).forEach(name => {
      const parts = name.split(' ').map(fold).filter(p => p.length >= 3);
      if (parts.some(p => hasWord(fold(words), p))) people.add(name);
    });
    people.forEach(name => flag('name', name, `"${name}" is a real person. Printing a name or likeness can need their permission (right of publicity).`));
    (input.nicknames || []).forEach(n => flag('nickname', clip(n, 60), `"${clip(n, 60)}" points to a real person, like a name does (right of publicity).`));
    if (input.collection === 'nickname' && !(input.nicknames || []).length) flag('nickname', lines[0] || '', 'A nickname points to a real person, like a name does (right of publicity).');
    (input.teams || []).forEach(name => { if (!blocked.concat(warnings).some(i => i.kind === 'team' && i.text.toLowerCase() === String(name).toLowerCase())) flag('team', clip(name, 80), `${clip(name, 80)} is a team (a trademark). Team colours are fine; using the name or a nickname means the team could object.`); });
    if (input.collection === 'quote' || input.quote) {
      const quote = clip(input.quote || lines.join(' '), 300);
      if (!quoteInSource(quote, source)) flag('quote-source', quote, 'A quote must be word for word from the source you pasted. Paste the exact quote with who said it.', true);
      else if (!clip(input.attribution, 80)) flag('quote-source', quote, 'Say who said it: quotes on ES merch are always attributed.', true);
      else flag('quote', `${quote} — ${clip(input.attribution, 80)}`, 'A real person’s words. Printing them on merch can need their permission.');
    }
    const invented = inventedNumbers(lines, `${source} ${input.attribution || ''}`);
    if (invented.length && !(input.collection === 'core')) flag('number', invented.join(', '), `${invented.join(', ')} isn't in your source. Numbers on merch must come from the story.`, true);
    return { policy, blocked, warnings, ok: blocked.length === 0 };
  }

  // A Concept (merch contract) -> its scan. The concept's own rights list
  // (what the AI or the code says it used) is added to what the scan finds.
  // Quote concepts: big rows are the quote, a small row starting with a dash
  // is the attribution.
  const DASH_RE = /^\s*[—–-]+\s*/;
  function conceptLines(concept = {}) {
    return (Array.isArray(concept.stack) ? concept.stack : []).map(r => clip(typeof r === 'string' ? r : r?.text, 120)).filter(Boolean);
  }
  function scanConcept(concept = {}, { source = '', policy = RIGHTS_POLICY, index, hasImage = false } = {}) {
    const stack = Array.isArray(concept.stack) ? concept.stack : [];
    const rights = Array.isArray(concept.rights) ? concept.rights : [];
    const isQuote = concept.collection === 'quote';
    const attributionRow = isQuote ? stack.find(r => r && DASH_RE.test(String(r.text || ''))) : null;
    const quoteRows = isQuote ? stack.filter(r => r && r !== attributionRow) : [];
    const attribution = attributionRow ? clip(String(attributionRow.text).replace(DASH_RE, ''), 80) : clip(rights.find(r => r?.kind === 'quote' && r.by)?.by, 80);
    const lines = conceptLines({ stack: stack.filter(r => r !== attributionRow) });
    return scanRights({
      lines,
      source: `${source || ''} ${concept.source || ''}`.trim(),
      collection: concept.collection,
      quote: isQuote ? quoteRows.map(r => r.text).join(' ') : '',
      attribution,
      people: rights.filter(r => r?.kind === 'name').map(r => r.text).concat(isQuote && attribution ? [attribution] : []),
      nicknames: rights.filter(r => r?.kind === 'nickname').map(r => r.text),
      teams: rights.filter(r => r?.kind === 'team').map(r => r.text),
      hasImage,
    }, { policy, index });
  }

  const ACK_STATEMENT ='I checked these items. ES may print them on merch, the quotes are exact and attributed, and the numbers come from the source. Legal should review the first collection.';
  // What the pusher ticks; the server stamps who and when.
  function ackFor(scan, { email = '', at = new Date().toISOString(), accepted = false } = {}) {
    return { policy: scan.policy, accepted: Boolean(accepted), by: email, at, statement: ACK_STATEMENT, items: (scan.warnings || []).map(w => ({ kind: w.kind, text: w.text })) };
  }
  // Does an acknowledgement cover every warning of this scan?
  function ackCovers(ack, scan) {
    if (!scan || scan.blocked?.length) return false;
    if (!scan.warnings?.length) return true;
    if (!ack || ack.accepted !== true) return false;
    const have = new Set((ack.items || []).map(i => `${i.kind}|${i.text}`));
    return scan.warnings.every(w => have.has(`${w.kind}|${w.text}`));
  }

  // ─── Pricing ──────────────────────────────────────────────────────────
  const round2 = n => Math.round(Number(n) * 100) / 100;
  const MIN_MARGIN = 1;
  const MAX_PRICE = 250;
  function marginFor(retail, base) {
    const r = round2(retail);
    const b = round2(base);
    if (!(r > 0) || !(b >= 0)) return { ok: false, error: 'Type a price in dollars.' };
    if (r > MAX_PRICE) return { ok: false, error: `Keep the price under $${MAX_PRICE}.` };
    const margin = round2(r - b);
    if (margin < MIN_MARGIN) return { ok: false, error: `The price must be at least $${(b + MIN_MARGIN).toFixed(2)}: the blank costs $${b.toFixed(2)}.` };
    return { ok: true, retail: r, base: b, margin, earnText: `You earn about $${margin.toFixed(2)} per sale (before Fourthwall fees).` };
  }
  function suggestedPrice(kind, base) {
    const b = Number(base) || 0;
    const m = BLANKS[kind]?.margin || 10;
    const byMargin = Math.ceil(b + m) - 0.01 > b + MIN_MARGIN ? round2(Math.ceil(b + m) - 0.01) : round2(b + m);
    const target = Number(BLANKS[kind]?.retail) || 0;
    return target - b >= MIN_MARGIN ? Math.max(round2(target), byMargin) : byMargin;
  }

  // ─── Fourthwall shapes ────────────────────────────────────────────────
  const money = m => (m && Number.isFinite(Number(m.amount ?? m.value)) ? { amount: round2(m.amount ?? m.value), currency: String(m.currency || 'USD') } : null);
  const EMBROIDERY = /embroider/i;
  function normalizeTemplate(raw = {}) {
    const areas = (Array.isArray(raw.customizableAreas) ? raw.customizableAreas : []).map(a => ({
      regionId: clip(a.regionId, 60), name: clip(a.name, 60), type: clip(a.type, 40), available: a.available !== false,
      productionMethod: clip(a.productionMethod, 40), supportsBackendRendering: a.supportsBackendRendering !== false,
      dpi: Number(a.dimensions?.dpi) || 0, pixelsWidth: Number(a.dimensions?.pixelsWidth) || 0, pixelsHeight: Number(a.dimensions?.pixelsHeight) || 0,
      inchesWidth: Number(a.dimensions?.inchesWidth) || 0, inchesHeight: Number(a.dimensions?.inchesHeight) || 0,
      placements: (Array.isArray(a.placements) ? a.placements : []).map(p => ({ id: clip(p.id, 80), name: clip(p.name, 60) })).filter(p => p.id),
    })).filter(a => a.regionId);
    const colors = (Array.isArray(raw.colorVariants) ? raw.colorVariants : []).filter(c => c && c.available !== false).map(c => ({
      name: clip(c.color?.name, 40), hex: /^#[0-9a-f]{6}$/i.test(c.color?.hex || '') ? c.color.hex.toUpperCase() : '#FFFFFF',
      photo: clip(c.photos?.[0]?.url, 400),
      sizes: (Array.isArray(c.sizeVariants) ? c.sizeVariants : []).filter(s => s && s.available !== false).map(s => ({ size: clip(s.size, 20), price: money(s.price)?.amount ?? null })),
    })).filter(c => c.name);
    const base = money(raw.priceFrom) || money(raw.basePrice);
    return {
      id: clip(raw.productId || raw.id, 80), name: clip(raw.name, 120), category: clip(raw.category, 40), brand: clip(raw.brand, 60),
      productionMethod: clip(raw.productionMethod, 40), basePrice: base ? base.amount : null, currency: base ? base.currency : 'USD',
      minimumOrdersNumber: Number(raw.minimumOrdersNumber) || 0, supportsBackendRendering: raw.supportsBackendRendering === true,
      thumbnail: clip(raw.thumbnail || colors[0]?.photo, 400), colors, areas,
    };
  }
  // Only templates Fourthwall renders itself, with no minimum order and a
  // printable (not embroidered) area with known pixel sizes.
  function templateEligible(t) {
    if (!t || !t.id) return { ok: false, why: 'missing' };
    if (!t.supportsBackendRendering) return { ok: false, why: 'Fourthwall can’t render mockups for it' };
    if (t.minimumOrdersNumber > 1) return { ok: false, why: 'needs a minimum order' };
    if (EMBROIDERY.test(t.productionMethod)) return { ok: false, why: 'embroidery only' };
    const areas = printAreas(t);
    if (!areas.length) return { ok: false, why: 'no printable area' };
    return { ok: true, why: '' };
  }
  function printAreas(t) {
    return (t?.areas || []).filter(a => a.available && a.supportsBackendRendering && !EMBROIDERY.test(a.productionMethod) && !EMBROIDERY.test(a.type) && a.pixelsWidth > 0 && a.pixelsHeight > 0);
  }
  const ACCESS = { PUBLIC: 'public', HIDDEN: 'hidden', PRIVATE: 'hidden', ARCHIVED: 'archived' };
  function productUrl(shop, slug) {
    const domain = String(shop?.publicDomain || shop?.domain || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return domain && slug ? `https://${domain}/products/${encodeURIComponent(slug)}` : '';
  }
  function normalizeProduct(o = {}, shop = null) {
    const variants = (Array.isArray(o.variants) ? o.variants : []).map(v => ({
      id: clip(v.id, 80), sku: clip(v.sku, 80), name: clip(v.name, 120),
      color: clip(v.attributes?.color?.name, 40), swatch: clip(v.attributes?.color?.swatch, 20), size: clip(v.attributes?.size?.name, 20),
      price: v.unitPrice ? round2(v.unitPrice.value) : null, cost: v.unitCost ? round2(v.unitCost.value) : null, currency: v.unitPrice?.currency || 'USD',
      stock: v.stock?.type === 'LIMITED' || v.stock?.inStock !== undefined ? (Number(v.stock?.inStock) || 0) : 'unlimited',
      image: clip(v.images?.[0]?.transformedUrl || v.images?.[0]?.url, 400),
    }));
    const images = (Array.isArray(o.images) ? o.images : []).map(i => clip(i.transformedUrl || i.url, 400)).filter(Boolean);
    const state = ACCESS[String(o.access?.type || '').toUpperCase()] || 'hidden';
    return {
      id: clip(o.id, 80), name: clip(o.name, 200), slug: clip(o.slug, 200), url: productUrl(shop, o.slug), state,
      soldOut: o.state?.type === 'SOLD_OUT', thumbnail: clip(o.thumbnailImage?.transformedUrl || o.thumbnailImage?.url || images[0], 400),
      images, variants, updatedAt: clip(o.updatedAt, 40), createdAt: clip(o.createdAt, 40),
    };
  }

  // ─── Sample mode ──────────────────────────────────────────────────────
  const PROD_HOSTS = ['frameup.essentiallysports.com'];
  function isSampleMode(loc) {
    if (!loc) return false;
    const flag = new URLSearchParams(loc.search || '').get('demo');
    if (flag === 'off') return false;
    if (/^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$|\.test$/.test(loc.hostname || '')) return true;
    return flag === 'merch' && !PROD_HOSTS.includes(loc.hostname);
  }

  return {
    VERSION, RIGHTS_POLICY, POLICIES, policyFrom, COLLECTIONS, COLLECTION_IDS, COLOR_KEYS, RIGHTS_KINDS, CORE_LINES, ES_PALETTE,
    BLANKS, BLANK_IDS, pinnedTemplates, clip, fold, bannedIn, inventedNumbers, quoteInSource,
    LEAGUE_MARKS, buildRightsIndex, teamsIn, leagueMarksIn, peopleIn, scanRights, conceptLines, scanConcept, ACK_STATEMENT, ackFor, ackCovers,
    MIN_MARGIN, MAX_PRICE, marginFor, suggestedPrice, round2,
    normalizeTemplate, templateEligible, printAreas, normalizeProduct, productUrl, PROD_HOSTS, isSampleMode,
  };
}));
