// Video Ads: verified clip sources. The official X account of every team in
// video-ads-teams.js, plus each sport's league / conference and network
// highlight accounts. Clip search aims at these first and ranks their posts
// above everyone else's. One file for the browser (window.VideoAdsSources) and
// the server (require), like video-ads-teams.js.
//
// Every handle below was checked on 2026-11-17 (additions on 2026-11-19) against the public fxtwitter
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
    // Added 2026-11-19 (the rest of the Big Ten, ACC and Big 12, plus top Group of Five
    // programs), each checked against the public fxtwitter profile endpoint.
    'Boston College Eagles': 'BCFootball', 'California Golden Bears': 'CalFootball', 'Duke Blue Devils': 'DukeFOOTBALL',
    'NC State Wolfpack': 'PackFootball', 'Pittsburgh Panthers': 'Pitt_FB', 'Stanford Cardinal': 'StanfordFball',
    'Syracuse Orange': 'CuseFootball', 'Virginia Cavaliers': 'UVAFootball', 'Wake Forest Demon Deacons': 'WakeFB',
    'Arizona Wildcats': 'ArizonaFBall', 'Cincinnati Bearcats': 'GoBearcatsFB', 'Houston Cougars': 'UHCougarFB',
    'Iowa State Cyclones': 'CycloneFB', 'Kansas Jayhawks': 'KU_Football', 'UCF Knights': 'UCF_Football',
    'West Virginia Mountaineers': 'WVUfootball',
    'Boise State Broncos': 'BroncoSportsFB', 'Memphis Tigers': 'MemphisFB', 'Tulane Green Wave': 'GreenWaveFB',
    'UNLV Rebels': 'unlvfootball', 'James Madison Dukes': 'JMUFootball',
    'Northwestern Wildcats': 'NUFBFamily', 'Rutgers Scarlet Knights': 'RFootball',
  };

  // College football: each program's conference accounts (network first, it
  // posts the most game video), so a team search asks its own conference.
  const CONFERENCE_SOURCES = {
    sec: ['SECNetwork', 'SEC'],
    big10: ['BigTenNetwork', 'bigten'],
    acc: ['accnetwork', 'theACC'],
    big12: ['Big12Conference'],
  };
  const CONFERENCE_TEAMS = {
    sec: ['Alabama Crimson Tide', 'Arkansas Razorbacks', 'Auburn Tigers', 'Florida Gators', 'Georgia Bulldogs', 'Kentucky Wildcats', 'LSU Tigers', 'Ole Miss Rebels', 'Mississippi State Bulldogs', 'Missouri Tigers', 'Oklahoma Sooners', 'South Carolina Gamecocks', 'Tennessee Volunteers', 'Texas Longhorns', 'Texas A&M Aggies', 'Vanderbilt Commodores'],
    big10: ['Illinois Fighting Illini', 'Indiana Hoosiers', 'Iowa Hawkeyes', 'Maryland Terrapins', 'Michigan Wolverines', 'Michigan State Spartans', 'Minnesota Golden Gophers', 'Nebraska Cornhuskers', 'Ohio State Buckeyes', 'Oregon Ducks', 'Penn State Nittany Lions', 'Purdue Boilermakers', 'UCLA Bruins', 'USC Trojans', 'Washington Huskies', 'Wisconsin Badgers', 'Northwestern Wildcats', 'Rutgers Scarlet Knights'],
    acc: ['Clemson Tigers', 'Florida State Seminoles', 'Georgia Tech Yellow Jackets', 'Louisville Cardinals', 'Miami Hurricanes', 'North Carolina Tar Heels', 'SMU Mustangs', 'Virginia Tech Hokies', 'Boston College Eagles', 'California Golden Bears', 'Duke Blue Devils', 'NC State Wolfpack', 'Pittsburgh Panthers', 'Stanford Cardinal', 'Syracuse Orange', 'Virginia Cavaliers', 'Wake Forest Demon Deacons'],
    big12: ['Arizona State Sun Devils', 'Baylor Bears', 'BYU Cougars', 'Colorado Buffaloes', 'Kansas State Wildcats', 'Oklahoma State Cowboys', 'TCU Horned Frogs', 'Texas Tech Red Raiders', 'Utah Utes', 'Arizona Wildcats', 'Cincinnati Bearcats', 'Houston Cougars', 'Iowa State Cyclones', 'Kansas Jayhawks', 'UCF Knights', 'West Virginia Mountaineers'],
  };
  const CONFERENCE_OF = new Map(Object.entries(CONFERENCE_TEAMS).flatMap(([conf, names]) => names.map(n => [n, conf])));

  // Per sport: league / conference accounts ('league') and network or
  // highlight accounts ('media'), most useful first.
  const SPORT_SOURCES = {
    nfl: {
      league: ['NFL', 'nflnetwork'],
      media: ['NFLonFOX', 'NFLonCBS', 'SNFonNBC', 'ESPNNFL', 'SportsCenter', 'espn'],
    },
    mlb: {
      league: ['MLB', 'MLBNetwork', 'Cut4'],
      media: ['MLBONFOX', 'CBSSportsMLB', 'SportsCenter', 'espn'],
    },
    cfb: {
      // Networks that post the most game video first (a sport-wide search
      // names the first ones in its queries).
      league: ['SECNetwork', 'BigTenNetwork', 'accnetwork', 'Big12Conference', 'CFBPlayoff', 'SEC', 'bigten', 'theACC', 'NCAAFootball'],
      media: ['ESPNCFB', 'CFBONFOX', 'CBSSportsCFB', 'SportsCenter', 'espn'],
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

  // A college team's conference accounts ([] for independents / Group of Five).
  function conferenceFor(team) {
    const name = typeof team === 'string' ? team : team?.name;
    const conf = CONFERENCE_OF.get(name);
    return conf ? [...CONFERENCE_SOURCES[conf]] : [];
  }

  // Handle counts per sport (the report / tests read these).
  function coverage(teams = []) {
    const out = {};
    Object.keys(SPORT_SOURCES).forEach(sport => {
      const list = teams.filter(t => t.sport === sport);
      out[sport] = { teams: list.length, withHandle: list.filter(t => handleFor(t)).length, league: SPORT_SOURCES[sport].league.length, media: SPORT_SOURCES[sport].media.length };
    });
    return out;
  }

  return { TEAM_HANDLES, SPORT_SOURCES, CONFERENCE_SOURCES, handleFor, sourcesFor, classifyHandle, teamForHandle, isVerifiedSource, conferenceFor, coverage };
}));
