/* Sample data for the Reels ideas room and radar (local preview only). Loaded by
   reel-ideas.js and reel-radar.js on localhost or with ?demo=reels off
   production, never in normal use. Every team, player, article, account, clip
   and number here is made up: the panels label it "Sample data". Shapes match
   /api/reel-maker (mode "ideas") and /api/reel-radar (modes "find", "analyze"). */
(function (root, factory) {
  const api = factory(root.ReelES || (typeof require === 'function' ? require('./reel-es.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelSampleB = api;
}(typeof self !== 'undefined' ? self : this, ES => {
  'use strict';
  const HOUR = 3600e3;
  const iso = hoursAgo => new Date(Date.now() - hoursAgo * HOUR).toISOString();
  const day = daysAgo => iso(daysAgo * 24).slice(0, 10);
  const SITE = 'https://www.essentiallysports.com/sample/';

  // ─── Trends (made up) ───────────────────────────────────────────────────
  const TRENDS = [
    { id: 's-admirals-qb', sport: 'nfl', title: 'Harbor City Admirals give quarterback Sam Rivers a $60 million extension', team: '', fit: 90, hours: 3, angle: { lens: 'money', line: 'The $60 million question: what Admirals fans get for the money' } },
    { id: 's-foxes-upset', sport: 'cfb', title: 'Unranked Lakeshore Foxes stun the top seed on a last-second field goal', team: '', fit: 85, hours: 6, angle: { lens: 'behind-the-moment', line: 'The sideline call nobody saw before the kick' } },
    { id: 's-comets-walkoff', sport: 'mlb', title: 'Riverton Comets walk it off in the 11th to force a deciding game', team: '', fit: 80, hours: 9, angle: { lens: 'fan-reaction', line: 'How Comets fans lived the longest inning of the year' } },
    { id: 's-coach-verdict', sport: 'nfl', title: 'Hall of Fame coach Dale Whitlock says the Granite Bears "got it wrong" on fourth down', team: '', fit: 75, hours: 12, angle: { lens: 'verdict', line: 'A legend rules on the call that cost the Bears' } },
    { id: 's-tennis-final', sport: 'tennis', title: 'Mara Vance reaches her first major final after a three-set comeback', team: '', fit: 60, hours: 14 },
    { id: 's-hoops-trade', sport: 'nba', title: 'Summit City Peaks trade their captain two days before the deadline', team: '', fit: 35, hours: 20 },
    { id: 's-golf-playoff', sport: 'golf', title: 'Theo Marsh wins the Coastal Open in a three-hole playoff', team: '', fit: 60, hours: 26 },
  ];
  const trends = () => TRENDS.map(({ hours, ...t }) => ({ ...t, source: 'Sample Wire', url: '', publishedAt: iso(hours), format: 'explainer', related: [{ title: `${t.title}: what we know`, url: '', source: 'Sample Wire' }] }));

  // ─── Ideas (made up) ────────────────────────────────────────────────────
  const SOURCES = [
    { id: 't1', type: 'trend', title: 'Harbor City Admirals give quarterback Sam Rivers a $60 million extension', url: '', source: 'Sample Wire', date: day(0) },
    { id: 'n1', type: 'news', title: 'Rivers deal makes him the highest-paid player in Admirals history', url: '', source: 'Sample Wire' },
    { id: 'a1', type: 'es', title: '"I never wanted to leave": Sam Rivers on staying with the Admirals', url: `${SITE}rivers-staying`, date: day(0), mostRead: true, excerpt: 'The quarterback spoke after signing a $60 million extension.' },
    { id: 'a2', type: 'es', title: 'Admirals fans split as front office commits to Rivers through 2029', url: `${SITE}fans-split`, date: day(1), mostRead: true, excerpt: 'Season-ticket holders reacted within minutes of the news.' },
    { id: 'a3', type: 'es', title: 'Former Admirals captain Joe Tanner calls the Rivers deal "a fair price"', url: `${SITE}tanner-verdict`, date: day(1), mostRead: false, excerpt: 'The club legend gave his verdict on local radio.' },
    { id: 'g1', type: 'game', title: 'Final: Granite Bears 17, Harbor City Admirals 24.', source: 'ESPN', date: day(2) },
    { id: 'p1', type: 'player', title: 'Sam Rivers: season stats', url: '', source: 'ESPN' },
  ];
  const beat = (block, vo, text) => {
    const k = ES ? ES.cleanBlock(block) : block;
    const legacy = ES ? ES.legacyFields(k) : { kind: 'point', text: '' };
    return { ...legacy, text: text || legacy.text, vo, emphasis: '', photo: '', visual: '', block: k };
  };
  const END = () => beat({ type: 'endcard' }, '', 'What do you make of it?');
  const ink = t => ({ text: t, color: 'ink' });
  const col = (t, color) => ({ text: t, color });
  const RAW = [
    {
      lens: 'money', recipe: 'money-story', angle: 'The $60 million question: what Admirals fans actually get for the money', title: 'The $60 million question', sources: ['t1', 'n1', 'g1'],
      poll: { question: 'Is Rivers worth the money?', options: ['Worth it', 'Overpaid', 'Ask me in January'] },
      beats: [
        beat({ type: 'hook', pills: [ink('$60 MILLION.'), col('ONE ARM.', 'blue')], stamp: { text: 'PAID' } }, 'Sixty million dollars for one arm. The Admirals just got *paid* attention.', '$60 million. One arm.'),
        beat({ type: 'number', kicker: 'THE EXTENSION', value: 60, prefix: '$', suffix: 'M', label: 'FOR SAM RIVERS', color: 'green', display: '$60M' }, 'Harbor City gave Sam Rivers a $60 million extension, the *biggest* deal the club has ever signed.', 'The extension'),
        beat({ type: 'statement', lines: [ink('HIGHEST PAID'), ink('IN ADMIRALS'), col('HISTORY', 'blue')] }, 'It makes him the highest-paid player in Admirals *history*.', 'Highest paid in Admirals history'),
        beat({ type: 'compare', kicker: 'LAST TIME OUT', items: [{ label: 'ADMIRALS', value: 24, display: '24', color: 'green' }, { label: 'BEARS', value: 17, display: '17', color: 'red' }] }, 'His last game? A 24 to 17 win over the Granite *Bears*.', 'Last time out'),
        beat({ type: 'statement', lines: [ink('NOW HE HAS'), col('TO EARN IT', 'blue')] }, 'Now comes the hard part. He has to *earn* it.', 'Now he has to earn it'),
        END(),
      ],
    },
    {
      lens: 'quote-led', recipe: 'quote-reaction', angle: '"I never wanted to leave": Rivers tells fans why he stayed', title: '"I never wanted to leave"', sources: ['a1', 't1'],
      poll: { question: 'Do you believe him?', options: ['Every word', 'Money talks'] },
      beats: [
        beat({ type: 'hook', pills: [ink('HE COULD'), ink('HAVE LEFT.'), col('HE STAYED.', 'blue')] }, 'Sam Rivers could have walked. He *stayed*.', 'He could have left. He stayed.'),
        beat({ type: 'quote', text: 'I never wanted to leave', who: 'SAM RIVERS' }, 'His own words, right after he signed.', 'I never wanted to leave'),
        beat({ type: 'statement', lines: [ink('THROUGH'), col('2029', 'blue')] }, 'The deal keeps him in Harbor City through *2029*.', 'Through 2029'),
        beat({ type: 'statement', lines: [ink('FANS ARE'), col('SPLIT', 'red')] }, 'And the fans? They are *split*.', 'Fans are split'),
        END(),
      ],
    },
    {
      lens: 'verdict', recipe: 'verdict', angle: 'A club legend rules on the deal: Joe Tanner calls it "a fair price"', title: 'Tanner gives his verdict', sources: ['a3', 't1'],
      poll: { question: 'Is Tanner right?', options: ['Spot on', 'Way off'] },
      beats: [
        beat({ type: 'hook', pills: [ink('THE LEGEND'), col('HAS SPOKEN.', 'blue')] }, 'An Admirals legend just gave his *verdict* on the Rivers deal.', 'The legend has spoken.'),
        beat({ type: 'quote', text: 'a fair price', who: 'JOE TANNER' }, 'Former captain Joe Tanner did not hedge.', 'A fair price'),
        beat({ type: 'statement', lines: [ink('HE KNOWS'), ink('WHAT THE'), col('JOB COSTS', 'blue')] }, 'Tanner wore the armband. He knows what the job *costs*.', 'He knows what the job costs'),
        beat({ type: 'statement', lines: [ink('NOT EVERYONE'), col('AGREES', 'red')] }, 'Not everyone in Harbor City *agrees*.', 'Not everyone agrees'),
        END(),
      ],
    },
    {
      lens: 'fan-reaction', recipe: 'fan-pulse', angle: 'Admirals fans split within minutes of the Rivers news', title: 'Fans split on Rivers', sources: ['a2'],
      poll: { question: 'Which side are you on?', options: ['Keep Rivers', 'Should have moved on'] },
      beats: [
        beat({ type: 'hook', pills: [ink('ONE DEAL.'), col('TWO CAMPS.', 'red')] }, 'One deal. Two camps. Admirals fans are *split*.', 'One deal. Two camps.'),
        beat({ type: 'statement', lines: [ink('IT TOOK'), col('MINUTES', 'blue')] }, 'Season-ticket holders reacted within *minutes* of the news.', 'It took minutes'),
        beat({ type: 'statement', lines: [ink('COMMITTED'), ink('THROUGH'), col('2029', 'blue')] }, 'The front office is committed to Rivers through *2029*.', 'Committed through 2029'),
        beat({ type: 'statement', lines: [ink('SO WHO'), col('IS RIGHT?', 'blue')] }, 'So who is *right*?', 'So who is right?'),
        END(),
      ],
    },
    {
      lens: 'behind-the-moment', recipe: 'explainer', angle: 'The win that closed the deal: what the Bears game changed', title: 'The game behind the deal', sources: ['g1', 't1', 'a2'],
      poll: { question: 'Did one game earn the deal?', options: ['It did', 'It was coming anyway'] },
      beats: [
        beat({ type: 'hook', pills: [ink('ONE GAME'), col('CHANGED IT.', 'blue')] }, 'One game changed the conversation about Sam *Rivers*.', 'One game changed it.'),
        beat({ type: 'compare', kicker: 'THE FINAL', items: [{ label: 'ADMIRALS', value: 24, display: '24', color: 'green' }, { label: 'BEARS', value: 17, display: '17', color: 'red' }] }, 'Admirals 24, Granite Bears 17. That was the *last* thing the front office saw.', 'The final'),
        beat({ type: 'statement', lines: [ink('THEN CAME'), col('THE OFFER', 'blue')] }, 'Then came the *offer*.', 'Then came the offer'),
        beat({ type: 'number', kicker: 'THE OFFER', value: 60, prefix: '$', suffix: 'M', label: 'EXTENSION', color: 'blue', display: '$60M' }, 'A $60 million *extension*.', 'The offer'),
        END(),
      ],
    },
  ];
  const LENS_LABEL = { 'fan-first': 'Fan first', 'quote-led': 'Quote led', verdict: 'Verdict', money: 'Money', 'fan-reaction': 'Fan reaction', 'behind-the-moment': 'Behind the moment' };
  const CORPUS = [
    ...SOURCES.map(s => `${s.title}. ${s.excerpt || ''}`),
    'Harbor City gave Sam Rivers a $60 million extension, the biggest deal the club has ever signed. It keeps him in Harbor City through 2029.',
    'Sam Rivers: 2026 season: YDS 3,912, TD 28, INT 7.',
  ].join('\n');
  function angleOf(raw, index, free) {
    const text = b => {
      const k = b.block;
      if (k.type === 'number') return [k.kicker, k.display, k.label].filter(Boolean).join(' · ');
      if (k.type === 'compare') return [k.kicker, (k.items || []).map(it => `${it.label} ${it.display}`).join(' vs ')].filter(Boolean).join(': ');
      if (k.type === 'quote') return `“${k.text}”${k.who ? `, ${k.who}` : ''}`;
      if (k.type === 'endcard') return 'ES end card';
      return (ES ? ES.blockText(k) : b.text) || b.text;
    };
    const plan = { format: 'explainer', title: raw.title, angle: raw.angle, sport: 'nfl', team: null, hooks: [], steer: '', style: 'es', lens: raw.lens, recipe: raw.recipe, poll: raw.poll, beats: raw.beats.map(b => JSON.parse(JSON.stringify(b))) };
    return {
      id: `i${index + 1}`, lens: raw.lens, lensLabel: LENS_LABEL[raw.lens], angle: raw.angle, title: raw.title, recipe: raw.recipe,
      hook: { pills: raw.beats[0].block.pills, stamp: raw.beats[0].block.stamp || null },
      storyboard: raw.beats.map(b => ({ type: b.block.type, text: text(b), vo: b.vo })),
      poll: raw.poll, sources: raw.sources, plan,
      issues: index === 2 && !free ? ['A beat with 41 (not in the sources) became a plain statement.'] : [],
      downgraded: 0, free: Boolean(free),
    };
  }
  // state: live | free | over | empty
  function ideas({ topic = '', state = 'live' } = {}) {
    const free = state === 'free' || state === 'over';
    const list = state === 'empty' ? [] : (free ? RAW.filter(r => ['fan-reaction', 'behind-the-moment', 'money'].includes(r.lens)) : RAW);
    return {
      ok: true, sample: true, topic: topic || TRENDS[0].title, sport: 'nfl', newsletter: 'The Huddle', tier: 'main',
      source: free ? 'free' : 'ai', free, reason: state === 'over' ? 'weekly-limit' : free ? 'off' : '',
      notice: state === 'over' ? 'The weekly AI budget is used up, so these are free drafts built from the headlines and facts found.' : free ? 'AI is off, so these are free drafts built from the headlines and facts found.' : '',
      model: free ? '' : 'sample', sources: state === 'empty' ? [] : SOURCES,
      steps: state === 'empty'
        ? { es: { ok: true, count: 0 }, trend: { ok: true, count: 0 }, games: { ok: true, skipped: true }, player: { ok: true, skipped: true }, factCheck: { ok: true, skipped: true } }
        : { es: { ok: true, count: 3 }, trend: { ok: true, count: 2 }, games: { ok: true, count: 1 }, player: { ok: true, count: 1 }, factCheck: { ok: true, skipped: true } },
      fit: 90, factCheck: null, corpus: CORPUS, cached: false,
      angles: list.map((raw, i) => angleOf(raw, i, free)),
      dropped: state === 'live' ? ['"Fan first" was dropped: most of it was not backed by the sources.'] : [],
      issues: [], costs: { ideas: 0, factCheck: 0 }, cost: 0,
    };
  }

  // ─── Radar (made up) ────────────────────────────────────────────────────
  const IMG = ['how-step-choose.webp', 'how-step-content.webp', 'how-step-format.webp', 'how-step-review.webp', 'how-step-export.webp', 'home-hero-banner-reels.webp'];
  // [handle, source, label, caption, views, likes, hoursOld, seconds, image index or -1]
  const CLIPS = [
    ['SampleAdmirals', 'official', 'Team account', 'SIGNED. Sam Rivers is staying home.', 1840000, 61000, 3, 18, 0],
    ['SampleLeagueHQ', 'league', 'League account', 'Every throw from the drive that sealed it for Harbor City', 912000, 24000, 9, 41, 1],
    ['SampleSportsNet', 'media', 'Network', 'Rivers on the new deal: watch the full answer', 388000, 9100, 5, 56, 2],
    ['SampleAdmirals', 'official', 'Team account', 'The locker room found out like this', 301000, 15000, 2, 22, 3],
    ['SampleGridiron', 'media', 'Network', 'Where does the Rivers extension rank? Our panel reacts', 96000, 2100, 20, 74, 4],
    ['SampleLeagueHQ', 'league', 'League account', 'Mic’d up: the last two minutes against the Bears', 0, 4300, 30, 33, -1],
  ];
  // state: live | unknown | free | empty | unsupported
  function radarFind({ topic = '', sport = 'nfl', state = 'live' } = {}) {
    const query = topic || TRENDS[0].title;
    if (state === 'unsupported' || !['nfl', 'cfb', 'mlb'].includes(sport)) {
      return { ok: true, sample: true, supported: false, query, sport, clips: [], ranking: 'none', note: 'Clips can be found for NFL, college football and MLB right now. Other sports are not covered by the trusted clip sources yet.', cost: { usd: 0, cached: false } };
    }
    if (state === 'empty') return { ok: true, sample: true, supported: true, query, sport, team: '', clips: [], ranking: 'none', note: 'No official clips for this story in the last 5 days.', windowDays: 5, cost: { usd: 0, cached: false } };
    const unknown = state === 'unknown';
    const clips = CLIPS.map(([handle, source, sourceLabel, caption, views, likes, hours, seconds, img], i) => {
      const v = unknown ? 0 : views;
      const l = unknown ? 0 : likes;
      return {
        id: `c${i + 1}`, url: `https://x.com/${handle}/status/90000000000000000${i}`, handle, caption, thumb: img >= 0 ? IMG[img] : '',
        views: v, likes: l, viewsKnown: v > 0, postedAt: iso(hours), ageHours: hours, duration: seconds,
        velocity: Math.round((v || l * 25) / Math.max(1, hours)), source, sourceLabel,
      };
    });
    if (!unknown) clips.sort((a, b) => b.velocity - a.velocity).forEach((c, i) => { c.id = `c${i + 1}`; });
    else clips.sort((a, b) => a.ageHours - b.ageHours).forEach((c, i) => { c.id = `c${i + 1}`; });
    return {
      ok: true, sample: true, supported: true, query, sport, team: '', clips,
      ranking: unknown ? 'newest' : 'views-per-hour',
      note: unknown ? 'No view counts for these clips yet, so the newest are first.' : 'Some clips have no view count; they are ranked by likes.',
      windowDays: 5, fetchedAt: new Date().toISOString(), cost: { usd: 0, cached: false },
    };
  }
  function radarAnalysis({ state = 'live' } = {}) {
    const free = state === 'free' || state === 'unknown';
    const briefs = [
      { lens: 'fan-first', title: 'What it means for fans', hook: free ? '' : 'He stayed. Here is what you get.', brief: 'Open on the signing moment itself, then say what the deal means for the fans watching. One idea per beat, and end on a question for them.' },
      { lens: 'behind-the-moment', title: 'The moment behind the moment', hook: free ? '' : 'The room found out before you did.', brief: 'Skip the recap everyone has posted. Show the detail around the announcement that the highlight clips leave out, then explain why it matters.' },
      { lens: 'fan-reaction', title: 'How fans are taking it', hook: free ? '' : 'One deal. Two camps.', brief: 'Lead with how fans are reacting, only as far as the sources show it. Then give the story in three short beats and ask fans to pick a side.' },
    ];
    if (free) {
      return { ok: true, sample: true, ai: false, reason: 'off', analysis: { read: '', patterns: [
        { label: 'Length', detail: 'The typical clip here runs 33 seconds.', clips: ['c1', 'c2', 'c3'] },
        { label: 'Who posts', detail: "2 of these 6 clips come from a team's own account.", clips: [] },
      ], briefs, dropped: 0 }, cost: { usd: 0, cached: false } };
    }
    return { ok: true, sample: true, ai: true, model: 'sample', analysis: {
      read: 'The fastest clips are short, come from the team itself and open on the announcement with no build-up.',
      patterns: [
        { label: 'Hook', detail: 'The top clips state the news in the first words of the caption. No tease, no question.', clips: ['c1', 'c2'] },
        { label: 'Length', detail: 'The two fastest clips are the shortest ones. The longer panel clip is the slowest.', clips: ['c1', 'c2', 'c5'] },
        { label: 'Who posts', detail: 'The team account leads. Fans likely trust the news more from the source.', clips: ['c1', 'c2'] },
        { label: 'Format', detail: 'Reaction and behind-the-scenes clips are keeping pace with game footage.', clips: ['c2'] },
      ],
      briefs, dropped: 0,
    }, cost: { usd: 0, cached: false } };
  }

  return { trends, ideas, radarFind, radarAnalysis, SOURCES, CORPUS };
}));
