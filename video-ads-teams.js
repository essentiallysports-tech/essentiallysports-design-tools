// Video Ads: team colours for the "By colour" clip search. ES runs Meta ads by
// colour trend (red teams, green teams, ...), so a colour picks the teams whose
// videos the AI looks for. One file for the browser (window.VideoAdsTeams) and
// the server (require), like video-ads-brands.js.
//
// colors: [primary, secondary] hex from each team's official colour set (team
// and league brand pages). families: the swatch families the team belongs to,
// primary family first (families[0] is the PRIMARY colour's family).
// Team swatches are content data: purple teams (Vikings, Ravens, LSU, ...) are
// fine here even though the FrameUp UI chrome uses no purple.
(function (root, factory) {
  const teams = factory();
  if (typeof module === 'object' && module.exports) module.exports = teams;
  else root.VideoAdsTeams = teams;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const SPORTS = [
    { id: 'nfl', label: 'NFL' },
    { id: 'cfb', label: 'CFB' },
    { id: 'mlb', label: 'MLB' },
  ];

  const COLORS = [
    { id: 'red', label: 'Red', hex: '#C8102E' },
    { id: 'blue', label: 'Blue', hex: '#0057B8' },
    { id: 'green', label: 'Green', hex: '#1E6B3A' },
    { id: 'gold', label: 'Gold / Yellow', hex: '#FFB81C' },
    { id: 'orange', label: 'Orange', hex: '#F56600' },
    { id: 'purple', label: 'Purple', hex: '#4F2683' },
    { id: 'navy', label: 'Navy', hex: '#0C2340' },
    { id: 'maroon', label: 'Maroon', hex: '#6A1A2C' },
    { id: 'black', label: 'Black', hex: '#101820' },
    { id: 'silver', label: 'Silver / White', hex: '#A5ACAF' },
    { id: 'teal', label: 'Teal', hex: '#008E97' },
  ];

  const t = (sport, name, short, colors, families) => ({ name, short, sport, colors, families });

  const TEAMS = [
    // ── NFL (32) ──
    t('nfl', 'Arizona Cardinals', 'Cardinals', ['#97233F', '#000000'], ['red', 'black']),
    t('nfl', 'Atlanta Falcons', 'Falcons', ['#A71930', '#000000'], ['red', 'black']),
    t('nfl', 'Baltimore Ravens', 'Ravens', ['#241773', '#000000'], ['purple', 'black']),
    t('nfl', 'Buffalo Bills', 'Bills', ['#00338D', '#C60C30'], ['blue', 'red']),
    t('nfl', 'Carolina Panthers', 'Panthers', ['#0085CA', '#101820'], ['blue', 'black']),
    t('nfl', 'Chicago Bears', 'Bears', ['#0B162A', '#C83803'], ['navy', 'orange']),
    t('nfl', 'Cincinnati Bengals', 'Bengals', ['#FB4F14', '#000000'], ['orange', 'black']),
    // Browns brown has no swatch of its own; orange is the closest family.
    t('nfl', 'Cleveland Browns', 'Browns', ['#311D00', '#FF3C00'], ['orange']),
    t('nfl', 'Dallas Cowboys', 'Cowboys', ['#003594', '#869397'], ['blue', 'silver', 'navy']),
    t('nfl', 'Denver Broncos', 'Broncos', ['#FB4F14', '#002244'], ['orange', 'navy']),
    t('nfl', 'Detroit Lions', 'Lions', ['#0076B6', '#B0B7BC'], ['blue', 'silver']),
    t('nfl', 'Green Bay Packers', 'Packers', ['#203731', '#FFB612'], ['green', 'gold']),
    t('nfl', 'Houston Texans', 'Texans', ['#03202F', '#A71930'], ['navy', 'red']),
    t('nfl', 'Indianapolis Colts', 'Colts', ['#002C5F', '#A2AAAD'], ['blue', 'silver']),
    t('nfl', 'Jacksonville Jaguars', 'Jaguars', ['#006778', '#D7A22A'], ['teal', 'gold', 'black']),
    t('nfl', 'Kansas City Chiefs', 'Chiefs', ['#E31837', '#FFB81C'], ['red', 'gold']),
    t('nfl', 'Las Vegas Raiders', 'Raiders', ['#000000', '#A5ACAF'], ['black', 'silver']),
    t('nfl', 'Los Angeles Chargers', 'Chargers', ['#0080C6', '#FFC20E'], ['blue', 'gold']),
    t('nfl', 'Los Angeles Rams', 'Rams', ['#003594', '#FFA300'], ['blue', 'gold']),
    t('nfl', 'Miami Dolphins', 'Dolphins', ['#008E97', '#FC4C02'], ['teal', 'orange']),
    t('nfl', 'Minnesota Vikings', 'Vikings', ['#4F2683', '#FFC62F'], ['purple', 'gold']),
    t('nfl', 'New England Patriots', 'Patriots', ['#002244', '#C60C30'], ['navy', 'red', 'silver']),
    t('nfl', 'New Orleans Saints', 'Saints', ['#D3BC8D', '#101820'], ['gold', 'black']),
    t('nfl', 'New York Giants', 'Giants', ['#0B2265', '#A71930'], ['blue', 'red', 'navy']),
    t('nfl', 'New York Jets', 'Jets', ['#125740', '#FFFFFF'], ['green', 'silver']),
    t('nfl', 'Philadelphia Eagles', 'Eagles', ['#004C54', '#A5ACAF'], ['green', 'silver', 'teal']),
    t('nfl', 'Pittsburgh Steelers', 'Steelers', ['#101820', '#FFB612'], ['black', 'gold']),
    t('nfl', 'San Francisco 49ers', '49ers', ['#AA0000', '#B3995D'], ['red', 'gold']),
    t('nfl', 'Seattle Seahawks', 'Seahawks', ['#002244', '#69BE28'], ['navy', 'green']),
    t('nfl', 'Tampa Bay Buccaneers', 'Buccaneers', ['#D50A0A', '#34302B'], ['red', 'silver']),
    t('nfl', 'Tennessee Titans', 'Titans', ['#0C2340', '#4B92DB'], ['navy', 'blue']),
    t('nfl', 'Washington Commanders', 'Commanders', ['#5A1414', '#FFB612'], ['maroon', 'gold']),

    // ── MLB (30) ──
    t('mlb', 'Arizona Diamondbacks', 'D-backs', ['#A71930', '#30CED8'], ['red', 'teal']),
    t('mlb', 'Atlanta Braves', 'Braves', ['#CE1141', '#13274F'], ['red', 'navy']),
    t('mlb', 'Baltimore Orioles', 'Orioles', ['#DF4601', '#000000'], ['orange', 'black']),
    t('mlb', 'Boston Red Sox', 'Red Sox', ['#BD3039', '#0C2340'], ['red', 'navy']),
    t('mlb', 'Chicago Cubs', 'Cubs', ['#0E3386', '#CC3433'], ['blue', 'red']),
    t('mlb', 'Chicago White Sox', 'White Sox', ['#27251F', '#C4CED4'], ['black', 'silver']),
    t('mlb', 'Cincinnati Reds', 'Reds', ['#C6011F', '#000000'], ['red', 'black']),
    t('mlb', 'Cleveland Guardians', 'Guardians', ['#00385D', '#E50022'], ['navy', 'red']),
    t('mlb', 'Colorado Rockies', 'Rockies', ['#333366', '#C4CED4'], ['purple', 'silver', 'black']),
    t('mlb', 'Detroit Tigers', 'Tigers', ['#0C2340', '#FA4616'], ['navy', 'orange']),
    t('mlb', 'Houston Astros', 'Astros', ['#002D62', '#EB6E1F'], ['navy', 'orange']),
    t('mlb', 'Kansas City Royals', 'Royals', ['#004687', '#BD9B60'], ['blue', 'gold']),
    t('mlb', 'Los Angeles Angels', 'Angels', ['#BA0021', '#003263'], ['red', 'navy']),
    t('mlb', 'Los Angeles Dodgers', 'Dodgers', ['#005A9C', '#EF3E42'], ['blue', 'silver', 'red']),
    t('mlb', 'Miami Marlins', 'Marlins', ['#00A3E0', '#EF3340'], ['blue', 'red', 'black']),
    t('mlb', 'Milwaukee Brewers', 'Brewers', ['#12284B', '#FFC52F'], ['navy', 'gold']),
    t('mlb', 'Minnesota Twins', 'Twins', ['#002B5C', '#D31145'], ['navy', 'red']),
    t('mlb', 'New York Mets', 'Mets', ['#002D72', '#FF5910'], ['blue', 'orange']),
    t('mlb', 'New York Yankees', 'Yankees', ['#0C2340', '#C4CED3'], ['navy', 'silver']),
    t('mlb', 'Athletics', 'Athletics', ['#003831', '#EFB21E'], ['green', 'gold']),
    t('mlb', 'Philadelphia Phillies', 'Phillies', ['#E81828', '#002D72'], ['red', 'blue']),
    t('mlb', 'Pittsburgh Pirates', 'Pirates', ['#27251F', '#FDB827'], ['black', 'gold']),
    // Padres brown has no swatch of its own; gold is the team's other colour.
    t('mlb', 'San Diego Padres', 'Padres', ['#2F241D', '#FFC425'], ['gold']),
    t('mlb', 'San Francisco Giants', 'Giants', ['#FD5A1E', '#27251F'], ['orange', 'black']),
    t('mlb', 'Seattle Mariners', 'Mariners', ['#0C2C56', '#005C5C'], ['navy', 'teal', 'green', 'silver']),
    t('mlb', 'St. Louis Cardinals', 'Cardinals', ['#C41E3A', '#0C2340'], ['red', 'navy']),
    t('mlb', 'Tampa Bay Rays', 'Rays', ['#092C5C', '#8FBCE6'], ['navy', 'blue', 'gold']),
    t('mlb', 'Texas Rangers', 'Rangers', ['#003278', '#C0111F'], ['blue', 'red']),
    t('mlb', 'Toronto Blue Jays', 'Blue Jays', ['#134A8E', '#1D2D5C'], ['blue', 'navy', 'red']),
    t('mlb', 'Washington Nationals', 'Nationals', ['#AB0003', '#14225A'], ['red', 'navy']),

    // ── College football: top Power 4 programs + Notre Dame (50) ──
    // SEC
    t('cfb', 'Alabama Crimson Tide', 'Alabama', ['#9E1B32', '#828A8F'], ['red', 'silver']),
    t('cfb', 'Arkansas Razorbacks', 'Arkansas', ['#9D2235', '#FFFFFF'], ['red', 'silver']),
    t('cfb', 'Auburn Tigers', 'Auburn', ['#0C2340', '#E87722'], ['navy', 'orange']),
    t('cfb', 'Florida Gators', 'Florida', ['#0021A5', '#FA4616'], ['blue', 'orange']),
    t('cfb', 'Georgia Bulldogs', 'Georgia', ['#BA0C2F', '#000000'], ['red', 'black']),
    t('cfb', 'Kentucky Wildcats', 'Kentucky', ['#0033A0', '#FFFFFF'], ['blue', 'silver']),
    t('cfb', 'LSU Tigers', 'LSU', ['#461D7C', '#FDD023'], ['purple', 'gold']),
    t('cfb', 'Ole Miss Rebels', 'Ole Miss', ['#CE1126', '#14213D'], ['red', 'navy']),
    t('cfb', 'Mississippi State Bulldogs', 'Miss. State', ['#660000', '#FFFFFF'], ['maroon', 'silver']),
    t('cfb', 'Missouri Tigers', 'Missouri', ['#F1B82D', '#000000'], ['gold', 'black']),
    t('cfb', 'Oklahoma Sooners', 'Oklahoma', ['#841617', '#FDF9D8'], ['red', 'maroon', 'silver']),
    t('cfb', 'South Carolina Gamecocks', 'South Carolina', ['#73000A', '#000000'], ['maroon', 'black']),
    t('cfb', 'Tennessee Volunteers', 'Tennessee', ['#FF8200', '#58595B'], ['orange', 'silver']),
    t('cfb', 'Texas Longhorns', 'Texas', ['#BF5700', '#FFFFFF'], ['orange', 'silver']),
    t('cfb', 'Texas A&M Aggies', 'Texas A&M', ['#500000', '#FFFFFF'], ['maroon', 'silver']),
    t('cfb', 'Vanderbilt Commodores', 'Vanderbilt', ['#000000', '#CFAE70'], ['black', 'gold']),
    // Big Ten
    t('cfb', 'Illinois Fighting Illini', 'Illinois', ['#13294B', '#E84A27'], ['navy', 'orange']),
    t('cfb', 'Indiana Hoosiers', 'Indiana', ['#990000', '#EEEDEB'], ['red', 'silver']),
    t('cfb', 'Iowa Hawkeyes', 'Iowa', ['#000000', '#FFCD00'], ['black', 'gold']),
    t('cfb', 'Maryland Terrapins', 'Maryland', ['#E03A3E', '#FFD520'], ['red', 'gold', 'black']),
    t('cfb', 'Michigan Wolverines', 'Michigan', ['#00274C', '#FFCB05'], ['navy', 'gold']),
    t('cfb', 'Michigan State Spartans', 'Michigan State', ['#18453B', '#FFFFFF'], ['green', 'silver']),
    t('cfb', 'Minnesota Golden Gophers', 'Minnesota', ['#7A0019', '#FFCC33'], ['maroon', 'gold']),
    t('cfb', 'Nebraska Cornhuskers', 'Nebraska', ['#E41C38', '#FDF2D9'], ['red', 'silver']),
    t('cfb', 'Ohio State Buckeyes', 'Ohio State', ['#BB0000', '#666666'], ['red', 'silver']),
    t('cfb', 'Oregon Ducks', 'Oregon', ['#154733', '#FEE123'], ['green', 'gold']),
    t('cfb', 'Penn State Nittany Lions', 'Penn State', ['#041E42', '#FFFFFF'], ['navy', 'silver']),
    t('cfb', 'Purdue Boilermakers', 'Purdue', ['#CFB991', '#000000'], ['gold', 'black']),
    t('cfb', 'UCLA Bruins', 'UCLA', ['#2D68C4', '#F2A900'], ['blue', 'gold']),
    t('cfb', 'USC Trojans', 'USC', ['#990000', '#FFC72C'], ['red', 'gold', 'maroon']),
    t('cfb', 'Washington Huskies', 'Washington', ['#4B2E83', '#B7A57A'], ['purple', 'gold']),
    t('cfb', 'Wisconsin Badgers', 'Wisconsin', ['#C5050C', '#FFFFFF'], ['red', 'silver']),
    // ACC
    t('cfb', 'Clemson Tigers', 'Clemson', ['#F56600', '#522D80'], ['orange', 'purple']),
    t('cfb', 'Florida State Seminoles', 'Florida State', ['#782F40', '#CEB888'], ['maroon', 'gold']),
    t('cfb', 'Georgia Tech Yellow Jackets', 'Georgia Tech', ['#B3A369', '#003057'], ['gold', 'navy']),
    t('cfb', 'Louisville Cardinals', 'Louisville', ['#AD0000', '#000000'], ['red', 'black']),
    t('cfb', 'Miami Hurricanes', 'Miami', ['#F47321', '#005030'], ['orange', 'green']),
    t('cfb', 'North Carolina Tar Heels', 'North Carolina', ['#7BAFD4', '#13294B'], ['blue', 'navy']),
    t('cfb', 'SMU Mustangs', 'SMU', ['#0033A0', '#C8102E'], ['blue', 'red']),
    t('cfb', 'Virginia Tech Hokies', 'Virginia Tech', ['#630031', '#CF4420'], ['maroon', 'orange']),
    // Big 12
    t('cfb', 'Arizona State Sun Devils', 'Arizona State', ['#8C1D40', '#FFC627'], ['maroon', 'gold']),
    t('cfb', 'Baylor Bears', 'Baylor', ['#154734', '#FFB81C'], ['green', 'gold']),
    t('cfb', 'BYU Cougars', 'BYU', ['#002E5D', '#FFFFFF'], ['navy', 'silver']),
    t('cfb', 'Colorado Buffaloes', 'Colorado', ['#000000', '#CFB87C'], ['black', 'gold']),
    t('cfb', 'Kansas State Wildcats', 'Kansas State', ['#512888', '#A7A7A7'], ['purple', 'silver']),
    t('cfb', 'Oklahoma State Cowboys', 'Oklahoma State', ['#FF7300', '#000000'], ['orange', 'black']),
    t('cfb', 'TCU Horned Frogs', 'TCU', ['#4D1979', '#A3A9AC'], ['purple', 'silver']),
    t('cfb', 'Texas Tech Red Raiders', 'Texas Tech', ['#CC0000', '#000000'], ['red', 'black']),
    t('cfb', 'Utah Utes', 'Utah', ['#BE0000', '#FFFFFF'], ['red', 'silver']),
    // Independent
    t('cfb', 'Notre Dame Fighting Irish', 'Notre Dame', ['#0C2340', '#C99700'], ['navy', 'gold']),
  ];

  // Team logos, hot-linked from ESPN's public logo CDN (no files in the repo).
  // One key per team, in TEAMS order within each sport: NFL and MLB use ESPN's
  // team abbreviation, college football uses ESPN's numeric team id (the ncaa
  // path). Every key was checked against ESPN's team API so the displayName
  // matches team.name, and every URL was checked to load (HTTP 200).
  const LOGO_BASE = 'https://a.espncdn.com/i/teamlogos';
  const LOGO_PATH = { nfl: 'nfl', mlb: 'mlb', cfb: 'ncaa' };
  const LOGO_KEYS = {
    nfl: [
      'ari', 'atl', 'bal', 'buf', 'car', 'chi', 'cin', 'cle',
      'dal', 'den', 'det', 'gb', 'hou', 'ind', 'jax', 'kc',
      'lv', 'lac', 'lar', 'mia', 'min', 'ne', 'no', 'nyg',
      'nyj', 'phi', 'pit', 'sf', 'sea', 'tb', 'ten', 'wsh',
    ],
    mlb: [
      'ari', 'atl', 'bal', 'bos', 'chc', 'chw', 'cin', 'cle',
      'col', 'det', 'hou', 'kc', 'laa', 'lad', 'mia', 'mil',
      'min', 'nym', 'nyy', 'ath', 'phi', 'pit', 'sd', 'sf',
      'sea', 'stl', 'tb', 'tex', 'tor', 'wsh',
    ],
    cfb: [
      '333', '8', '2', '57', '61', '96', '99', '145', '344', '142',
      '201', '2579', '2633', '251', '245', '238', '356', '84', '2294', '120',
      '130', '127', '135', '158', '194', '2483', '213', '2509', '26', '30',
      '264', '275', '228', '52', '59', '97', '2390', '153', '2567', '259',
      '9', '239', '252', '38', '2306', '197', '2628', '2641', '254', '87',
    ],
  };
  SPORTS.forEach(({ id }) => {
    TEAMS.filter(team => team.sport === id).forEach((team, i) => {
      const key = LOGO_KEYS[id][i];
      if (key) team.logo = `${LOGO_BASE}/${LOGO_PATH[id]}/500/${key}.png`;
    });
  });

  // The team's logo URL, or '' when it has none (callers fall back to the
  // two-colour dot).
  const logoFor = team => (team && typeof team.logo === 'string' ? team.logo : '');

  const MAX_TEAMS = 12;
  const colorById = id => COLORS.find(color => color.id === id) || null;
  const sportIds = SPORTS.map(sport => sport.id);

  // Teams in a sport (all sports when none is given) whose PRIMARY family is
  // the colour come first, then teams that wear it as a secondary colour.
  // Data order is kept inside each group. Max 12.
  function teamsFor({ sport, color } = {}) {
    if (!colorById(color)) return [];
    const pool = sportIds.includes(sport) ? TEAMS.filter(team => team.sport === sport) : TEAMS;
    const primary = pool.filter(team => team.families[0] === color);
    const secondary = pool.filter(team => team.families[0] !== color && team.families.includes(color));
    return [...primary, ...secondary].slice(0, MAX_TEAMS);
  }

  // Case-insensitive lookup by full name or short name (first match in a sport).
  function findTeam(name, sport) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    const pool = sportIds.includes(sport) ? TEAMS.filter(team => team.sport === sport) : TEAMS;
    return pool.find(team => team.name.toLowerCase() === key) || pool.find(team => team.short.toLowerCase() === key) || null;
  }

  return { SPORTS, COLORS, TEAMS, MAX_TEAMS, teamsFor, colorById, findTeam, logoFor };
}));
