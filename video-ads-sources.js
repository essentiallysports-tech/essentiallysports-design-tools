// Video Ads: verified clip sources. The official X account of every team in
// video-ads-teams.js, plus each sport's league / conference and network
// highlight accounts. Clip search aims at these first and ranks their posts
// above everyone else's. One file for the browser (window.VideoAdsSources) and
// the server (require), like video-ads-teams.js.
//
// Every handle below was checked on 2026-11-17 against the public fxtwitter
// profile endpoint (the account exists, its display name is the team / outlet).
// Leave a team out rather than guess: a team with no handle simply has no
// "official" targeting and its clips rank as league / media / other.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VideoAdsSources = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // Full team name (as in video-ads-teams.js) -> official X handle.
  const TEAM_HANDLES = {
    // NFL
    'Arizona Cardinals': 'AZCardinals', 'Atlanta Falcons': 'AtlantaFalcons', 'Baltimore Ravens': 'Ravens',
    'Buffalo Bills': 'BuffaloBills', 'Carolina Panthers': 'Panthers', 'Chicago Bears': 'ChicagoBears',
    'Cincinnati Bengals': 'Bengals', 'Cleveland Browns': 'Browns', 'Dallas Cowboys': 'dallascowboys',
    'Denver Broncos': 'Broncos', 'Detroit Lions': 'Lions', 'Green Bay Packers': 'packers',
    'Houston Texans': 'HoustonTexans', 'Indianapolis Colts': 'Colts', 'Jacksonville Jaguars': 'Jaguars',
    'Kansas City Chiefs': 'Chiefs', 'Las Vegas Raiders': 'Raiders', 'Los Angeles Chargers': 'chargers',
    'Los Angeles Rams': 'RamsNFL', 'Miami Dolphins': 'MiamiDolphins', 'Minnesota Vikings': 'Vikings',
    'New England Patriots': 'Patriots', 'New Orleans Saints': 'Saints', 'New York Giants': 'Giants',
    'New York Jets': 'nyjets', 'Philadelphia Eagles': 'Eagles', 'Pittsburgh Steelers': 'steelers',
    'San Francisco 49ers': '49ers', 'Seattle Seahawks': 'Seahawks', 'Tampa Bay Buccaneers': 'Buccaneers',
    'Tennessee Titans': 'Titans', 'Washington Commanders': 'Commanders',
    // MLB
    'Arizona Diamondbacks': 'Dbacks', 'Atlanta Braves': 'Braves', 'Baltimore Orioles': 'Orioles',
    'Boston Red Sox': 'RedSox', 'Chicago Cubs': 'Cubs', 'Chicago White Sox': 'whitesox',
    'Cincinnati Reds': 'Reds', 'Cleveland Guardians': 'CleGuardians', 'Colorado Rockies': 'Rockies',
    'Detroit Tigers': 'tigers', 'Houston Astros': 'astros', 'Kansas City Royals': 'Royals',
    'Los Angeles Angels': 'Angels', 'Los Angeles Dodgers': 'Dodgers', 'Miami Marlins': 'Marlins',
    'Milwaukee Brewers': 'Brewers', 'Minnesota Twins': 'Twins', 'New York Mets': 'Mets',
    'New York Yankees': 'Yankees', Athletics: 'Athletics', 'Philadelphia Phillies': 'Phillies',
    'Pittsburgh Pirates': 'Pirates', 'San Diego Padres': 'Padres', 'San Francisco Giants': 'SFGiants',
    'Seattle Mariners': 'Mariners', 'St. Louis Cardinals': 'Cardinals', 'Tampa Bay Rays': 'RaysBaseball',
    'Texas Rangers': 'Rangers', 'Toronto Blue Jays': 'BlueJays', 'Washington Nationals': 'Nationals',
    // College football (the football program's account, not the athletics department)
    'Alabama Crimson Tide': 'AlabamaFTBL', 'Arkansas Razorbacks': 'RazorbackFB', 'Auburn Tigers': 'AuburnFootball',
    'Florida Gators': 'GatorsFB', 'Georgia Bulldogs': 'GeorgiaFootball', 'Kentucky Wildcats': 'UKFootball',
    'LSU Tigers': 'LSUfootball', 'Ole Miss Rebels': 'OleMissFB', 'Mississippi State Bulldogs': 'HailStateFB',
    'Missouri Tigers': 'MizzouFootball', 'Oklahoma Sooners': 'OU_Football', 'South Carolina Gamecocks': 'GamecockFB',
    'Tennessee Volunteers': 'Vol_Football', 'Texas Longhorns': 'TexasFootball', 'Texas A&M Aggies': 'AggieFootball',
    'Vanderbilt Commodores': 'VandyFootball',
    'Illinois Fighting Illini': 'IlliniFootball', 'Indiana Hoosiers': 'IndianaFootball', 'Iowa Hawkeyes': 'HawkeyeFootball',
    'Maryland Terrapins': 'TerpsFootball', 'Michigan Wolverines': 'UMichFootball', 'Michigan State Spartans': 'MSU_Football',
    'Minnesota Golden Gophers': 'GopherFootball', 'Nebraska Cornhuskers': 'HuskerFootball', 'Ohio State Buckeyes': 'OhioStateFB',
    'Oregon Ducks': 'oregonfootball', 'Penn State Nittany Lions': 'PennStateFball', 'Purdue Boilermakers': 'BoilerFootball',
    'UCLA Bruins': 'UCLAFootball', 'USC Trojans': 'uscfb', 'Washington Huskies': 'UW_Football', 'Wisconsin Badgers': 'BadgerFootball',
    'Clemson Tigers': 'ClemsonFB', 'Florida State Seminoles': 'FSUFootball', 'Georgia Tech Yellow Jackets': 'GeorgiaTechFB',
    'Louisville Cardinals': 'LouisvilleFB', 'Miami Hurricanes': 'CanesFootball', 'North Carolina Tar Heels': 'UNCFootball',
    'SMU Mustangs': 'SMUFB', 'Virginia Tech Hokies': 'HokiesFB',
    'Arizona State Sun Devils': 'ASUFootball', 'Baylor Bears': 'BUFootball', 'BYU Cougars': 'BYUfootball',
    'Colorado Buffaloes': 'CUBuffsFootball', 'Kansas State Wildcats': 'KStateFB', 'Oklahoma State Cowboys': 'CowboyFB',
    'TCU Horned Frogs': 'TCUFootball', 'Texas Tech Red Raiders': 'TexasTechFB', 'Utah Utes': 'Utah_Football',
    'Notre Dame Fighting Irish': 'NDFootball',
  };

  // Per sport: league / conference accounts ('league') and network or
  // highlight accounts ('media'), most useful first.
  const SPORT_SOURCES = {
    nfl: {
      league: ['NFL', 'nflnetwork'],
      media: ['NFLonFOX', 'NFLonCBS', 'SNFonNBC', 'ESPNNFL', 'SportsCenter', 'espn'],
    },
    mlb: {
      league: ['MLB', 'MLBNetwork'],
      media: ['MLBONFOX', 'SportsCenter', 'espn'],
    },
    cfb: {
      league: ['CFBPlayoff', 'SEC', 'bigten', 'Big12Conference', 'theACC', 'SECNetwork', 'BigTenNetwork', 'accnetwork'],
      media: ['CFBONFOX', 'ESPNCFB', 'CBSSportsCFB', 'SportsCenter', 'espn'],
    },
  };

  const lower = h => String(h || '').replace(/^@/, '').trim().toLowerCase();
  const TEAM_BY_HANDLE = new Map(Object.entries(TEAM_HANDLES).map(([name, handle]) => [lower(handle), name]));

  // The team's official handle, or '' (accepts a team object or a full name).
  function handleFor(team) {
    const name = typeof team === 'string' ? team : team?.name;
    return TEAM_HANDLES[name] || '';
  }

  // League + media handles of a sport ({ league: [], media: [] }).
  function sourcesFor(sport) {
    const s = SPORT_SOURCES[sport];
    return s ? { league: [...s.league], media: [...s.media] } : { league: [], media: [] };
  }

  // 'official' (a team account in the registry), 'league', 'media' or 'other'.
  // Without a sport, every sport's league / media lists are checked.
  function classifyHandle(handle, sport) {
    const key = lower(handle);
    if (!key) return 'other';
    if (TEAM_BY_HANDLE.has(key)) return 'official';
    const pools = SPORT_SOURCES[sport] ? [SPORT_SOURCES[sport]] : Object.values(SPORT_SOURCES);
    if (pools.some(p => p.league.some(h => lower(h) === key))) return 'league';
    if (pools.some(p => p.media.some(h => lower(h) === key))) return 'media';
    return 'other';
  }

  // The team (full name) behind an official handle, or ''.
  const teamForHandle = handle => TEAM_BY_HANDLE.get(lower(handle)) || '';

  const isVerifiedSource = (handle, sport) => classifyHandle(handle, sport) !== 'other';

  return { TEAM_HANDLES, SPORT_SOURCES, handleFor, sourcesFor, classifyHandle, teamForHandle, isVerifiedSource };
}));
