/* Sample data for Competitor ads (local preview only). Loaded by
   video-ads-competitors.js on localhost or with ?demo=ads off production, never
   in normal use. Every brand, ad and note here is made up: the panel labels it
   "Sample data". Shapes match /api/meta-ads (modes ads and analyze). */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const today = new Date();
  const iso = days => new Date(today.getTime() - days * DAY).toISOString().slice(0, 10);
  const IMG = ['how-step-choose.webp', 'how-step-content.webp', 'how-step-format.webp', 'how-step-review.webp', 'how-step-export.webp', 'workspace-card-newsletter-assets.webp', 'workspace-card-social-media.webp', 'workspace-card-reel-captions.webp', 'login-newsletter-assets.webp', 'home-hero-banner.webp'];
  const LIB = 'https://www.facebook.com/ads/library/';

  // [pageName, pageId, domain, ads: [id, media, days, active, title, body, cta, platforms, img index or -1, cards]]
  const BRANDS = [
    ['Sample Sports Daily', '900000000001', 'samplesportsdaily.example', [
      ['101', 'video', 142, true, 'Sports news before your coffee', 'The stories every fan is talking about, in one short email. Free, every morning.', 'Sign up', ['Facebook', 'Instagram'], 0, 0],
      ['102', 'image', 96, true, 'Your teams. Your inbox.', 'Pick your teams and get only the news that matters to you. No noise, no paywall.', 'Subscribe', ['Instagram'], 1, 0],
      ['103', 'video', 61, true, 'Stop scrolling five apps', 'Scores, stories and the one stat you need, in a single email. It’s free.', 'Sign up', ['Facebook', 'Instagram', 'Audience Network'], 2, 0],
      ['104', 'carousel', 38, true, 'This week in sports', 'Swipe through the week’s biggest moments. Get the full story free in your inbox.', 'Learn more', ['Facebook'], 3, 4],
      ['105', 'video', 5, true, 'The game, explained in a minute', 'Missed the game? We break it down in a minute. Free daily email.', 'Sign up', ['Instagram'], 4, 0],
      ['106', 'image', 3, true, 'Smarter than the group chat', 'Win every sports argument. One free email a day.', 'Subscribe', ['Facebook', 'Instagram'], 5, 0],
      ['107', 'image', 2, true, 'Smarter than your group chat', 'Win every sports argument with one free email a day.', 'Subscribe', ['Facebook', 'Instagram'], -1, 0],
      ['108', 'text', 12, true, '', 'Join thousands of fans who start the day with us. Free.', 'Sign up', ['Facebook'], -1, 0],
    ]],
    ['Sample Gridiron Brief', '900000000002', 'gridironbrief.example', [
      ['201', 'video', 210, true, 'Sunday starts here', 'Every NFL storyline before kickoff, in one email. Free for fans.', 'Sign up', ['Facebook', 'Instagram'], 6, 0],
      ['202', 'carousel', 74, true, 'Fantasy help that’s actually short', 'Start, sit and sleeper notes in two minutes. Free every Thursday.', 'Learn more', ['Facebook'], 7, 3],
      ['203', 'image', 33, true, 'Know before your friends', 'Trades, injuries and rumours, checked and calm. Free email.', 'Subscribe', ['Instagram'], 8, 0],
      ['204', 'video', 6, true, 'Monday recap in a minute', 'Every game from Sunday, recapped fast. Free.', 'Sign up', ['Instagram', 'Facebook'], 9, 0],
      ['205', 'image', 1, true, 'The Monday email fans forward', 'Big plays, bad calls and what it means for your team. Free.', 'Sign up', ['Facebook'], 0, 0],
      ['206', 'image', 4, false, 'Last chance: premium picks', 'Get our premium picks before it’s too late!', 'Shop now', ['Facebook'], 1, 0],
    ]],
    ['Sample Morning Letter', '900000000003', 'morningletter.example', [
      ['301', 'video', 320, true, 'The news, without the noise', 'Smart, short and free. Read it before your coffee gets cold.', 'Subscribe', ['Facebook', 'Instagram', 'Messenger'], 2, 0],
      ['302', 'image', 128, true, 'Your five-minute morning', 'Everything you need to know today, written like a friend would tell you. Free.', 'Subscribe', ['Instagram'], 3, 0],
      ['303', 'video', 45, true, 'Why readers stay', 'Real readers on why it’s the only email they open every day.', 'Learn more', ['Facebook', 'Instagram'], 4, 0],
      ['304', 'image', 7, true, 'Trusted by busy people', 'No spin, no clickbait. One free email every morning.', 'Subscribe', ['Facebook'], 5, 0],
      ['305', 'carousel', 2, true, 'What you missed this week', 'Five stories, five swipes. The full read is free.', 'Learn more', ['Instagram'], 6, 5],
    ]],
  ];

  function adsFor(brand) {
    const [pageName, pageId, domain, list] = brand;
    return list.map(([id, mediaType, days, active, title, body, ctaText, platforms, img, cards]) => ({
      id: `9000000000${id}`, pageId, pageName, pageUrl: '', pagePicture: '',
      body, title, caption: domain, ctaText, ctaType: ctaText.toUpperCase().replace(/\s+/g, '_'),
      linkUrl: `https://${domain}/subscribe`, linkDomain: domain, mediaType, displayFormat: mediaType.toUpperCase(),
      thumbnailUrl: img >= 0 ? IMG[img % IMG.length] : '', videoUrl: '', cardCount: cards,
      platforms, startDate: iso(days), endDate: active ? '' : iso(days - 4), isActive: active, daysRunning: days,
      variants: null, adLibraryUrl: LIB,
    })).sort((a, b) => b.daysRunning - a.daysRunning);
  }
  function summarize(ads) {
    const media = { video: 0, image: 0, carousel: 0, text: 0 };
    ads.forEach(a => { media[a.mediaType] += 1; });
    const d = ads.map(a => a.daysRunning).sort((a, b) => a - b);
    const m = Math.floor(d.length / 2);
    return { total: ads.length, active: ads.filter(a => a.isActive !== false).length, media, medianDays: d.length % 2 ? d[m] : Math.round((d[m - 1] + d[m]) / 2), longestDays: d[d.length - 1], longRunning: ads.filter(a => a.daysRunning >= 30).length, newThisWeek: ads.filter(a => a.daysRunning <= 7).length, ctas: [], platforms: [], pages: [] };
  }
  const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  function ads(query, { empty = false } = {}) {
    const q = squash(query);
    const brand = BRANDS.find(b => squash(b[0]).includes(q) || q.includes(squash(b[0]))) || BRANDS[0];
    const advertisers = BRANDS.map(b => ({ pageId: b[1], pageName: b[0], adCount: b[3].length }));
    if (empty) return { ok: true, sample: true, target: { query, label: query, country: 'US', status: 'active' }, matchedPage: null, advertisers, ads: [], summary: summarize([]), adLibraryUrl: LIB, cost: { usd: 0, results: 0, cached: false, sample: true } };
    const matched = BRANDS.find(b => squash(b[0]) === q) || brand;
    const list = adsFor(matched);
    return {
      ok: true, sample: true,
      target: { query, label: query, country: 'US', status: 'active' },
      matchedPage: { pageId: matched[1], pageName: matched[0], adCount: list.length },
      advertisers, ads: list, summary: summarize(list), adLibraryUrl: LIB,
      fetchedAt: new Date().toISOString(), cost: { usd: 0, results: list.length, cached: false, sample: true },
    };
  }

  const IDEAS = [
    { brand: 'the-huddle', angle: 'Save time', headline: 'Every NFL story you need, in one short email. Free.', highlight: 'in one short email.', body: ['Skip the five apps and the endless scroll. The Huddle brings the news that matters to your Sunday, every morning.'], cta: 'SIGN UP THE HUDDLE' },
    { brand: 'essentially-cfb', angle: 'Belonging', headline: 'Your Saturday ritual starts in your inbox. Join free.', highlight: 'Join free.', body: ['College football news for fans who never miss a kickoff. Calm, clear and free.'], cta: 'SIGN UP ES CFB' },
    { brand: 'es-dugout', angle: 'Explained fast', headline: 'Missed the game? We explain it before breakfast. Free.', highlight: 'before breakfast.', body: ['ES Dugout sums up last night in plain words, so you’re ready for today’s talk.'], cta: 'SIGN UP ES DUGOUT' },
    { brand: 'the-huddle', angle: 'Know first', headline: 'Know the trades and injuries before your friends do. Free.', highlight: 'before your friends do.', body: ['Checked news, no rumours dressed up as facts. One email, every day.'], cta: 'SIGN UP THE HUDDLE' },
    { brand: 'essentially-cfb', angle: 'Recap', headline: 'All of Saturday’s games, recapped by Sunday morning. Free.', highlight: 'by Sunday morning.', body: ['The big plays, the upsets and what they mean for your team. Straight to your inbox.'], cta: 'SIGN UP ES CFB' },
  ];
  function analysis(data) {
    const ads = data.ads || [];
    const working = ads.filter(a => a.daysRunning >= 30).slice(0, 4);
    const testing = ads.filter(a => a.daysRunning <= 7).slice(0, 4);
    const WHY = ['A clear promise in the first line and the word “free” up front.', 'Speaks to one pain (too many apps) and solves it in one sentence.', 'Short video with captions: works with the sound off in the feed.', 'Carousel lets people sample stories before they sign up.'];
    const WHAT = ['Testing a quick “explained” hook against their usual news promise.', 'Two near-identical versions: they are testing a single word in the headline.', 'A more social, “group chat” tone to reach younger fans.', 'A shorter body: checking if less text lifts sign-ups.'];
    const stopped = ads.filter(a => a.isActive === false);
    return {
      ok: true, ai: true, sample: true,
      analysis: {
        headline: `${data.matchedPage?.pageName || 'This brand'} leans on short videos that promise to save fans time, and is now testing playful, social hooks.`,
        working: working.map((a, i) => ({ id: a.id, why: WHY[i % WHY.length] })),
        testing: testing.map((a, i) => ({ id: a.id, what: WHAT[i % WHAT.length] })),
        trends: [
          { label: 'Formats', detail: 'Short vertical video leads; carousels show up for weekly round-ups.' },
          { label: 'Hooks', detail: 'Time saved (“before your coffee”, “in a minute”) and being in the know.' },
          { label: 'Offers', detail: 'Every ad says it is free; none push a discount.' },
          { label: 'CTAs', detail: '“Sign up” and “Subscribe” beat “Learn more” on the long-running ads.' },
          { label: 'Length', detail: 'One or two short sentences; the long-runners stay under a tweet’s length.' },
          { label: 'Visual style', detail: 'Bold text on top of real game footage, brand colour bars, captions on.' },
        ],
        notWorking: stopped.length
          ? stopped.map(a => ({ id: a.id, pattern: 'Urgency and discount language', why: 'This ad stopped soon after it started, while the calm “free” ads keep running. Inferred, not measured.', inferred: true }))
          : [{ id: '', pattern: 'Vague “Learn more” buttons', why: 'The ads that keep running ask for the sign-up directly; the vaguer ones are newer or rarer. Inferred from patterns, not results.', inferred: true }],
        ideas: IDEAS,
        dropped: 0,
      },
      cost: { usd: 0, cached: false, sample: true },
    };
  }

  root.VideoAdsCompetitorsDemo = { brands: BRANDS.map(b => b[0]), ads, analysis };
}(typeof self !== 'undefined' ? self : this));
