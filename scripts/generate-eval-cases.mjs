// Test bank for Generate (npm run eval:generate). Each case is a brief like the
// ones the team writes, plus checks a good result must pass. Facts here are
// test inputs, not claims.
const types = res => res.designs.map(d => d.postType);
const find = (res, type) => res.designs.find(d => d.postType === type);
const statsOf = design => (design?.fields?.stats || []).map(s => `${s.value} ${s.label}`.toUpperCase());
const allText = res => res.designs.map(d => JSON.stringify(d.fields)).join(' ');
// Every design that names a team names the same one.
const oneTeam = res => new Set(res.designs.map(d => String(d.team || '').toLowerCase()).filter(Boolean)).size <= 1;
// Nothing in the result is just the brief's instruction echoed back.
const noEcho = res => !/make a|stats post|random player/i.test(res.designs.map(d => d.lines.join(' ')).join(' '));

export const CASES = [
  {
    id: 'stats-single-exact',
    brief: 'Angel Reese 30 PTS 16 REB 3 AST in the Dream win',
    checks: {
      'makes Player Stats': res => types(res).includes('stats-single-ent'),
      'keeps exact numbers': res => ['30 PTS', '16 REB', '3 AST'].every(s => statsOf(find(res, 'stats-single-ent')).includes(s)),
      'WNBA team': res => res.designs.every(d => /wnba/i.test(d.sport) || !d.sport),
      'one team across designs': oneTeam,
    },
  },
  {
    id: 'head-to-head-exact',
    brief: 'Deadly Dream duo: Jordin Canada 23 PTS 8 AST 5 REB 0 BLK, Angel Reese 21 PTS 2 AST 7 REB 2 BLK',
    checks: {
      'makes Head-to-Head': res => types(res).includes('stats-double-ent'),
      'both players present': res => /Canada/.test(JSON.stringify(find(res, 'stats-double-ent')?.fields)) && /Reese/.test(JSON.stringify(find(res, 'stats-double-ent')?.fields)),
      'keeps exact numbers': res => ['23', '21'].every(n => JSON.stringify(find(res, 'stats-double-ent')?.fields || {}).includes(`"${n}"`)),
      'one team across designs': oneTeam,
      // The editor applies the team named in the brief ("Dream") over the AI's.
      'brief travels with every design': res => res.designs.length > 0 && res.designs.every(d => /Dream duo/.test(d.brief || '')),
    },
  },
  {
    id: 'quote-verbatim',
    brief: 'Steph Curry after the game: "I have never felt better"',
    checks: {
      'makes a quote': res => types(res).some(t => t === 'quote' || t === 'long-quote'),
      'exact words': res => /i have never\s*felt better/i.test(res.designs.filter(d => /quote/.test(d.postType)).map(d => d.lines.join(' ')).join(' ')),
      'Warriors': res => res.designs.some(d => /warriors/i.test(d.team)),
    },
  },
  {
    id: 'long-quote-verbatim',
    brief: 'Long quote from Stephanie White: "We have to be better on both ends of the floor, and it starts with me as the head coach."',
    checks: {
      'makes Long Quote or Two-Person': res => types(res).some(t => t === 'long-quote' || t === 'double-entity-quote'),
      'exact words': res => /it starts with me as the head coach/i.test(allText(res)),
    },
  },
  {
    id: 'ranking-web-table',
    brief: 'MOST SEASONS STARTING 5-0 TOGETHER IN NFL HISTORY\n\nRank\nQuarterback\nHead Coach\nSeasons Starting 5-0 Together\n1\nTom Brady\nBill Belichick\n4\n2\nPeyton Manning\nTony Dungy\n4\n3\nFran Tarkenton\nBud Grant\n3\n4\nPatrick Mahomes\nAndy Reid\n3',
    checks: {
      'ranking first': res => /listicle-type-1|listicle-type-2/.test(types(res)[0] || ''),
      'all 4 rows in order': res => (res.designs[0]?.fields?.rows || []).map(r => r.entity).join('|') === 'Tom Brady|Peyton Manning|Fran Tarkenton|Patrick Mahomes',
      'not one post per row': res => res.designs.filter(d => d.postType === 'cover').length <= 1,
    },
  },
  {
    id: 'ranking-sheet-table',
    brief: 'Most points per game this season\nRank\tPlayer\tTeam\tPPG\n1\tLuka Doncic\tLakers\t33.9\n2\tShai Gilgeous-Alexander\tThunder\t32.7\n3\tGiannis Antetokounmpo\tBucks\t30.4\n4\tNikola Jokic\tNuggets\t29.6',
    checks: {
      'ranking first': res => /listicle-type-1/.test(types(res)[0] || ''),
      'exact values': res => (res.designs[0]?.fields?.rows || []).map(r => r.metric2).join('|') === '33.9|32.7|30.4|29.6',
    },
  },
  {
    id: 'ranked-list-no-numbers',
    brief: '5 NFL QBs who could be traded before the deadline: Kirk Cousins (Falcons), Russell Wilson (Giants), Mac Jones (49ers), Joe Flacco (Browns), Tyrod Taylor (Jets)',
    checks: {
      'makes a ranking': res => types(res).some(t => t === 'listicle-type-2' || t === 'listicle-type-1'),
      'all 5 names': res => ['Cousins', 'Wilson', 'Jones', 'Flacco', 'Taylor'].every(n => allText(res).includes(n)),
    },
  },
  {
    id: 'cover-exact-headline',
    brief: "Cover: IS PURDY'S MVP CASE GETTING STRONGER?",
    checks: {
      'makes a Cover': res => types(res).includes('cover'),
      'exact headline': res => /is purdy'?s mvp case getting stronger/i.test(find(res, 'cover')?.lines.join(' ') || ''),
      '49ers': res => res.designs.some(d => /49ers/i.test(d.team)),
    },
  },
  {
    id: 'instruction-cover-hook',
    brief: 'make a post about patrick mahomes',
    checks: {
      'makes a Cover': res => types(res).includes('cover'),
      'Chiefs': res => res.designs.some(d => /chiefs/i.test(d.team)),
      'one team across designs': oneTeam,
      'does not echo the instruction': noEcho,
      'cover is a hook, not a fact list': res => {
        const text = find(res, 'cover')?.lines.join(' ') || '';
        return /\?|!|just|again|finally|can |is |are |does |did |will |why |how /i.test(text) && (text.match(/\d/g) || []).length <= 4;
      },
    },
  },
  {
    id: 'birthday',
    brief: 'happy birthday paige bueckers',
    checks: {
      'makes a Cover': res => types(res).includes('cover'),
      'says happy birthday': res => /birthday/i.test(find(res, 'cover')?.lines.join(' ') || ''),
      'Wings': res => res.designs.some(d => /wings/i.test(d.team)),
    },
  },
  {
    id: 'no-invented-stats',
    brief: 'make a stats post on a random player',
    checks: {
      'no made-up Player Stats': res => !types(res).includes('stats-single-ent') && !types(res).includes('stats-double-ent'),
      'does not echo the instruction': noEcho,
    },
  },
  {
    id: 'opponent-not-team',
    brief: 'Caitlin Clark 30 PTS 9 AST 6 REB against the Sky',
    checks: {
      'Fever, not Sky': res => res.designs.length > 0 && res.designs.every(d => !/sky/i.test(d.team)) && res.designs.some(d => /fever/i.test(d.team)),
      'keeps exact numbers': res => ['30 PTS', '9 AST', '6 REB'].every(s => statsOf(find(res, 'stats-single-ent')).includes(s)),
    },
  },
  {
    id: 'quote-about-not-by',
    brief: 'Charles Barkley on LeBron: "He done stacked his team"',
    checks: {
      'no unattributed third-person quote': res => !res.designs.some(d => (d.postType === 'quote' || d.postType === 'long-quote') && /\bhe\b|\bhis\b/i.test(d.lines.join(' '))),
    },
  },
  {
    id: 'format-filter',
    brief: 'Jalen Hurts and the Eagles beat the Cowboys 31-17',
    formats: ['cover'],
    checks: {
      'only Covers': res => res.designs.length > 0 && res.designs.every(d => d.postType === 'cover'),
      'Eagles, not Cowboys': res => res.designs.every(d => /eagles/i.test(d.team)),
    },
  },
];
