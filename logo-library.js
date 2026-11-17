/*
 * FrameUp logo library: every team, club, constructor and league mark the
 * editor can drop into a design, plus search.
 *
 *   FrameUpLogos.all()                    -> every entry
 *   FrameUpLogos.get('nfl-sf')            -> one entry or null
 *   FrameUpLogos.search('niners')         -> ranked entries
 *   FrameUpLogos.search('', { league: 'nba' })
 *   FrameUpLogos.findTeam('Lakers', 'nba') -> best single match or null
 *   FrameUpLogos.srcFor(entry, { dark })  -> image URL for <img> / canvas
 *   FrameUpLogos.teamColors(entry)        -> { box, text } label colours
 *
 * Entry shape: { id, league, kind: 'team'|'league'|'badge', name, short,
 *   nickname, abbr, colors: [primary, secondary], file, darkFile, url,
 *   aliases: [] }. `file` is relative to the site root (same origin, never
 *   taints the export canvas). `url` is an ESPN CDN logo, which sends
 *   `Access-Control-Allow-Origin: *`, so it loads with crossOrigin="anonymous"
 *   and stays export-safe too. Every entry has one or the other.
 *
 * Team data is generated into logo-library-data.js by
 * scripts/build-logo-library.py; the hand-made entries (league marks, F1
 * constructors, tours) and the aliases are below.
 * UMD: window.FrameUpLogos in the browser, module.exports under Node.
 */
(function (root, factory) {
  const data = (typeof module === 'object' && module.exports)
    ? require('./logo-library-data.js')
    : root.FrameUpLogoData;
  const api = factory(Array.isArray(data) ? data : []);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpLogos = api;
}(typeof self !== 'undefined' ? self : this, function (TEAM_ROWS) {
  'use strict';

  const DIR = 'assets/logos/';
  const LEAGUE_DIR = 'assets/league-logos/';

  // Filter chips, in picker order. `group` keeps related chips together.
  const LEAGUES = [
    { id: 'nfl', label: 'NFL', group: 'pro' },
    { id: 'nba', label: 'NBA', group: 'pro' },
    { id: 'mlb', label: 'MLB', group: 'pro' },
    { id: 'nhl', label: 'NHL', group: 'pro' },
    { id: 'wnba', label: 'WNBA', group: 'pro' },
    { id: 'cfb', label: 'College Football', short: 'CFB', group: 'college' },
    { id: 'cbb', label: 'College Basketball', short: 'CBB', group: 'college' },
    { id: 'mls', label: 'MLS', group: 'soccer' },
    { id: 'epl', label: 'Premier League', short: 'EPL', group: 'soccer' },
    { id: 'laliga', label: 'LaLiga', group: 'soccer' },
    { id: 'bundesliga', label: 'Bundesliga', group: 'soccer' },
    { id: 'seriea', label: 'Serie A', group: 'soccer' },
    { id: 'ligue1', label: 'Ligue 1', group: 'soccer' },
    { id: 'f1', label: 'F1', group: 'motorsport' },
    { id: 'leagues', label: 'Leagues & tours', short: 'Leagues', group: 'marks' },
  ];
  const LEAGUE_IDS = new Set(LEAGUES.map(league => league.id));
  // Ties in search go to the league people design for most.
  const LEAGUE_RANK = new Map(['nfl', 'nba', 'cfb', 'mlb', 'nhl', 'wnba', 'cbb', 'epl', 'mls', 'f1', 'laliga', 'bundesliga', 'seriea', 'ligue1', 'leagues'].map((id, index) => [id, index]));

  // League marks: the five in assets/league-logos/ (league-logos.js) are reused,
  // the rest are vendored ESPN marks (scripts/build-logo-marks.py) or the tour
  // logos the newsletter infographics already ship.
  const mark = (id, name, file, aliases, extra) => Object.assign({ id: 'league-' + id, league: 'leagues', kind: 'league', name, short: name, nickname: '', abbr: '', colors: ['#101114', '#FFFFFF'], file, aliases }, extra || {});
  const MARKS = [
    mark('nfl', 'NFL', LEAGUE_DIR + 'nfl.svg', ['national football league']),
    mark('nba', 'NBA', DIR + 'leagues/nba.webp', ['national basketball association']),
    mark('mlb', 'MLB', LEAGUE_DIR + 'mlb.svg', ['major league baseball']),
    mark('nhl', 'NHL', DIR + 'leagues/nhl.webp', ['national hockey league']),
    mark('wnba', 'WNBA', DIR + 'leagues/wnba.webp', []),
    mark('ncaa', 'NCAA / College Football', LEAGUE_DIR + 'cfb.svg', ['ncaa', 'college football', 'ncaaf', 'cfb', 'cfp']),
    mark('mls', 'MLS', DIR + 'leagues/mls.webp', ['major league soccer']),
    mark('epl', 'Premier League', DIR + 'leagues/epl.webp', ['epl', 'english premier league', 'prem']),
    mark('laliga', 'LaLiga', DIR + 'leagues/laliga.webp', ['la liga', 'spanish league']),
    mark('bundesliga', 'Bundesliga', DIR + 'leagues/bundesliga.webp', ['german league']),
    mark('seriea', 'Serie A', DIR + 'leagues/seriea.webp', ['italian league']),
    mark('ligue1', 'Ligue 1', DIR + 'leagues/ligue1.webp', ['french league']),
    mark('ucl', 'UEFA Champions League', DIR + 'leagues/ucl.webp', ['ucl', 'champions league']),
    mark('f1', 'Formula 1', DIR + 'leagues/f1.webp', ['f1', 'formula one', 'formula 1']),
    mark('ufc', 'UFC', DIR + 'leagues/ufc.webp', ['ultimate fighting championship', 'mma']),
    mark('pga-tour', 'PGA Tour', DIR + 'leagues/pga-tour.webp', ['pga', 'pgatour']),
    mark('pga-tour-champions', 'PGA Tour Champions', 'assets/infographics/logo-pga-tour-champions.webp', ['champions tour']),
    mark('dp-world-tour', 'DP World Tour', 'assets/infographics/logo-dp-world-tour.webp', ['european tour', 'dpwt']),
    mark('lpga', 'LPGA', DIR + 'leagues/lpga.webp', ['ladies pga']),
    mark('let', 'Ladies European Tour', 'assets/infographics/logo-let.webp', ['let']),
    mark('liv-golf', 'LIV Golf', DIR + 'leagues/liv-golf.webp', ['liv']),
    mark('golf', 'Golf', LEAGUE_DIR + 'golf.svg', ['golf']),
    mark('atp', 'ATP Tour', DIR + 'leagues/atp.webp', ['atp', 'mens tennis'], { kind: 'badge', colors: ['#002865', '#FFFFFF'] }),
    mark('wta', 'WTA Tour', DIR + 'leagues/wta.webp', ['wta', 'womens tennis'], { kind: 'badge', colors: ['#5B2C83', '#FFFFFF'] }),
    mark('tennis', 'Tennis', LEAGUE_DIR + 'tennis.svg', ['tennis']),
  ];

  // F1 constructors: drawn name badges (no public CORS-safe official marks).
  const f1 = (key, name, short, colors, aliases) => ({ id: 'f1-' + key, league: 'f1', kind: 'badge', name, short, nickname: short, abbr: '', colors, file: DIR + 'f1/' + key + '.webp', aliases });
  const F1 = [
    f1('mclaren', 'McLaren Formula 1 Team', 'McLaren', ['#FF8000', '#000000'], ['papaya']),
    f1('ferrari', 'Scuderia Ferrari', 'Ferrari', ['#DC0000', '#FFF200'], ['scuderia', 'sf']),
    f1('red-bull', 'Oracle Red Bull Racing', 'Red Bull', ['#1E41FF', '#DC0000'], ['rbr', 'red bull racing']),
    f1('mercedes', 'Mercedes-AMG Petronas', 'Mercedes', ['#00A19C', '#000000'], ['merc', 'mercedes amg']),
    f1('aston-martin', 'Aston Martin Aramco', 'Aston Martin', ['#00594F', '#CEDC00'], ['amr']),
    f1('alpine', 'BWT Alpine F1 Team', 'Alpine', ['#0078C1', '#FF87BC'], []),
    f1('williams', 'Atlassian Williams Racing', 'Williams', ['#00A0DE', '#041E42'], []),
    f1('racing-bulls', 'Visa Cash App Racing Bulls', 'Racing Bulls', ['#1634CC', '#FFFFFF'], ['rb', 'vcarb']),
    f1('haas', 'MoneyGram Haas F1 Team', 'Haas', ['#B6BABD', '#DA291C'], []),
    f1('audi', 'Audi F1 Team', 'Audi', ['#1A1A1A', '#F50537'], ['sauber', 'kick sauber']),
    f1('cadillac', 'Cadillac F1 Team', 'Cadillac', ['#000000', '#C8A96A'], []),
  ];

  // Nicknames people type that are not in ESPN's names. Keys are entry ids.
  const ALIASES = {
    'nfl-sf': ['niners', '49ers', 'san fran'], 'nfl-ne': ['pats'], 'nfl-gb': ['pack'], 'nfl-tb': ['bucs'],
    'nfl-lv': ['raiders'], 'nfl-jax': ['jags'], 'nfl-phi': ['birds', 'philly'], 'nfl-kc': ['kc'],
    'nfl-wsh': ['commies', 'commanders'], 'nfl-lar': ['la rams'], 'nfl-lac': ['bolts'], 'nfl-dal': ['america\'s team'],
    'nba-lal': ['la lakers', 'lake show'], 'nba-gs': ['dubs', 'gsw', 'golden state'], 'nba-phi': ['sixers', 'philly'],
    'nba-ny': ['nyk', 'knicks'], 'nba-bkn': ['nets'], 'nba-lac': ['clips', 'la clippers'], 'nba-sa': ['sas', 'spurs'],
    'nba-okc': ['thunder'], 'nba-no': ['pels', 'nola'], 'nba-min': ['wolves', 't-wolves'], 'nba-por': ['blazers', 'rip city'],
    'nba-cle': ['cavs'], 'nba-dal': ['mavs'], 'nba-utah': ['uta'], 'nba-wsh': ['was', 'wiz'],
    'mlb-nyy': ['yanks', 'bronx bombers'], 'mlb-bos': ['sox', 'red sox'], 'mlb-chw': ['white sox', 'chisox', 'cws'], 'mlb-lad': ['dodgers', 'la dodgers'],
    'mlb-ath': ['oakland', "a's", 'as'], 'mlb-sd': ['pads', 'friars'], 'mlb-chc': ['cubbies'], 'mlb-stl': ['cards', 'redbirds'],
    'nhl-tb': ['bolts'], 'nhl-vgk': ['knights', 'vegas'], 'nhl-nyr': ['blueshirts'], 'nhl-mtl': ['habs'], 'nhl-tor': ['leafs'],
    'cfb-333': ['bama', 'roll tide', 'tide'], 'cfb-194': ['osu', 'tosu', 'buckeyes'], 'cfb-61': ['uga', 'dawgs'],
    'cfb-130': ['um', 'big blue', 'wolverines'], 'cfb-87': ['nd', 'irish'], 'cfb-251': ['ut', 'horns', 'hook em'],
    'cfb-99': ['lsu'], 'cfb-228': ['clemson'], 'cfb-30': ['usc', 'trojans'], 'cfb-2483': ['ducks'],
    'cfb-213': ['psu', 'happy valley'], 'cfb-201': ['ou', 'boomer'], 'cfb-2633': ['vols', 'rocky top'], 'cfb-245': ['tamu', 'aggies'],
    'cfb-52': ['fsu', 'noles'], 'cfb-2390': ['the u', 'canes'], 'cfb-254': ['utes'], 'cfb-57': ['gators', 'uf'],
    'cfb-2': ['war eagle'], 'cfb-145': ['ole miss', 'rebels'], 'cfb-26': ['ucla'],
    'epl-382': ['man city', 'city', 'mcfc'], 'epl-360': ['man utd', 'man united', 'united', 'mufc'], 'epl-364': ['lfc', 'reds'],
    'epl-359': ['gunners', 'afc'], 'epl-363': ['blues', 'cfc'], 'epl-367': ['spurs', 'thfc'],
    'laliga-86': ['real', 'madrid', 'rmcf', 'los blancos'], 'laliga-83': ['barca', 'fcb'], 'laliga-1068': ['atleti'],
    'bundesliga-132': ['bayern', 'fcb munich'], 'bundesliga-124': ['bvb', 'dortmund'],
    'seriea-111': ['juve'], 'seriea-110': ['inter'], 'seriea-103': ['milan', 'acm'], 'ligue1-160': ['psg'],
    'mls-20232': ['inter miami', 'miami'], 'mls-18966': ['los angeles fc'], 'mls-187': ['la galaxy', 'galaxy'],
  };

  function clean(value) {
    return String(value == null ? '' : value)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/'/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fromRow(row) {
    return {
      id: row.id,
      league: row.l,
      kind: 'team',
      name: row.n || '',
      short: row.s || '',
      nickname: row.m || '',
      abbr: row.a || '',
      colors: Array.isArray(row.c) ? row.c.slice(0, 2) : ['#101114', '#FFFFFF'],
      espnId: row.e || '',
      file: row.f ? DIR + row.f : '',
      darkFile: row.d ? DIR + row.d : '',
      url: row.u || '',
      aliases: [],
    };
  }

  const ENTRIES = TEAM_ROWS.map(fromRow).concat(F1, MARKS).map(entry => {
    const aliases = (entry.aliases || []).concat(ALIASES[entry.id] || []);
    const keys = new Set([entry.name, entry.short, entry.nickname, entry.abbr].concat(aliases).map(clean).filter(Boolean));
    return Object.freeze(Object.assign({}, entry, {
      aliases: Object.freeze(aliases.slice()),
      colors: Object.freeze(entry.colors.slice()),
      _keys: Object.freeze(Array.from(keys)),
      _name: clean(entry.name),
    }));
  });
  const BY_ID = new Map(ENTRIES.map(entry => [entry.id, entry]));

  function all() { return ENTRIES.slice(); }
  function get(id) { return BY_ID.get(String(id || '')) || null; }
  function leagueOf(id) { return LEAGUES.find(league => league.id === id) || null; }

  // Points for how well one query matches one entry; 0 = no match.
  function scoreEntry(entry, query, tokens) {
    if (!query) return 1;
    const abbr = clean(entry.abbr);
    let best = 0;
    if (abbr && abbr === query) best = 100;
    if (entry._name === query) best = Math.max(best, 100);
    for (const key of entry._keys) {
      if (key === query) best = Math.max(best, key === abbr ? 100 : 92);
      else if (key.startsWith(query)) best = Math.max(best, 70 - Math.min(10, key.length - query.length) * 0.5);
      else if (key.split(' ').some(word => word.startsWith(query))) best = Math.max(best, 58);
      else if (query.length >= 3 && key.includes(query)) best = Math.max(best, 40);
    }
    if (!best && tokens.length > 1) {
      // Every word of the query starts some word of the entry ("la lak").
      const words = entry._keys.join(' ').split(' ');
      if (tokens.every(token => words.some(word => word.startsWith(token)))) best = 50;
    }
    if (best && entry.kind !== 'team' && entry.league !== 'f1') best -= 1;
    return best;
  }

  function search(rawQuery, options) {
    const opts = options || {};
    const query = clean(rawQuery);
    const tokens = query ? query.split(' ') : [];
    const league = opts.league && LEAGUE_IDS.has(opts.league) ? opts.league : '';
    const limit = Number.isFinite(opts.limit) ? opts.limit : 60;
    const hits = [];
    for (const entry of ENTRIES) {
      if (league && entry.league !== league) continue;
      const score = scoreEntry(entry, query, tokens);
      if (score > 0) hits.push({ entry, score });
    }
    hits.sort((a, b) => b.score - a.score
      || (LEAGUE_RANK.get(a.entry.league) ?? 99) - (LEAGUE_RANK.get(b.entry.league) ?? 99)
      || a.entry.name.localeCompare(b.entry.name));
    // A school in both CFB and CBB shares one logo: show it once unless a
    // league chip asks for that league.
    const seen = new Set();
    const out = [];
    for (const hit of hits) {
      const src = hit.entry.file || hit.entry.url;
      if (!league && seen.has(src)) continue;
      seen.add(src);
      out.push(hit.entry);
      if (out.length >= limit) break;
    }
    return out;
  }

  // Map the editor's and Generate's sport words onto library leagues.
  const SPORT_HINTS = {
    nfl: 'nfl', football: 'nfl', nba: 'nba', basketball: 'nba', mlb: 'mlb', baseball: 'mlb', nhl: 'nhl', hockey: 'nhl',
    wnba: 'wnba', cfb: 'cfb', ncaaf: 'cfb', 'college football': 'cfb', ncaa: 'cfb', cbb: 'cbb', ncaab: 'cbb',
    'college basketball': 'cbb', 'cbb men': 'cbb', 'cbb women': 'cbb', mls: 'mls', soccer: 'epl', epl: 'epl', 'premier league': 'epl', f1: 'f1', 'formula 1': 'f1',
    laliga: 'laliga', 'la liga': 'laliga', bundesliga: 'bundesliga', 'serie a': 'seriea', 'ligue 1': 'ligue1',
  };
  function leagueForSport(sport) { return SPORT_HINTS[clean(sport)] || ''; }

  // One confident match for a team name (Generate, sport+team selects).
  // A league hint narrows it; without one, only an unambiguous top hit wins.
  function findTeam(name, sportOrLeague) {
    const query = clean(name);
    if (!query) return null;
    const league = LEAGUE_IDS.has(sportOrLeague) ? sportOrLeague : leagueForSport(sportOrLeague);
    const pool = search(query, { league, limit: 5 }).filter(entry => entry.kind === 'team' || entry.league === 'f1');
    if (!pool.length) return null;
    const top = pool[0];
    const topScore = scoreEntry(top, query, query.split(' '));
    if (topScore < 58) return null;
    if (!league && pool[1] && scoreEntry(pool[1], query, query.split(' ')) === topScore) {
      // "Cardinals": several leagues tie. Prefer exact full-name matches only.
      return top._name === query ? top : null;
    }
    return top;
  }

  function srcFor(entry, options) {
    if (!entry) return '';
    const dark = options && options.dark;
    if (dark && entry.darkFile) return entry.darkFile;
    return entry.file || entry.url || '';
  }

  // Remote sources need crossOrigin="anonymous" so the canvas stays exportable.
  function needsCors(src) { return /^https?:\/\//i.test(String(src || '')); }

  // Sources a saved design may carry for a library logo (validation helper for
  // template data modules).
  const LIBRARY_SRC = /^(?:assets\/logos\/[a-z0-9-]+\/[a-z0-9-]+\.webp|assets\/league-logos\/[a-z0-9-]+\.svg|assets\/infographics\/logo-[a-z0-9-]+\.webp|https:\/\/a\.espncdn\.com\/i\/teamlogos\/[a-z0-9/-]+\.png)$/i;
  function isLibrarySource(src) { return LIBRARY_SRC.test(String(src || '')); }
  function entryForSource(src) {
    const value = String(src || '');
    if (!value) return null;
    return ENTRIES.find(entry => entry.file === value || entry.darkFile === value || entry.url === value) || null;
  }

  // ── colour helpers (label box + text in team colours) ──
  function hexToRgb(hex) {
    const value = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(value)) return null;
    return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
  }
  function luminance(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;
    const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrastRatio(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // Label box in the secondary colour, text in the primary (Lakers: gold box,
  // purple text). If that pair is hard to read, the text goes black or white.
  function teamColors(entry) {
    const colors = entry && entry.colors ? entry.colors : ['#0A7DFA', '#FFFFFF'];
    const primary = String(colors[0] || '#0A7DFA').toUpperCase();
    const secondary = String(colors[1] || '#FFFFFF').toUpperCase();
    let box = secondary;
    let text = primary;
    if (contrastRatio(box, text) < 3) {
      box = primary;
      text = contrastRatio(primary, '#FFFFFF') >= contrastRatio(primary, '#000000') ? '#FFFFFF' : '#000000';
    }
    return { box, text };
  }

  return Object.freeze({
    VERSION: 1,
    ALIAS_IDS: Object.freeze(Object.keys(ALIASES)),
    LEAGUES: Object.freeze(LEAGUES.map(league => Object.freeze(Object.assign({}, league)))),
    all,
    get,
    leagueOf,
    search,
    findTeam,
    leagueForSport,
    srcFor,
    needsCors,
    isLibrarySource,
    entryForSource,
    teamColors,
    contrastRatio,
    clean,
  });
}));
