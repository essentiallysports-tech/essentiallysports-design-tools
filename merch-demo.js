/* Merch Designs sample data (local preview and tests only). merch.js uses it
   on localhost, or with ?demo=merch off production, instead of /api/merch;
   ?demo=off turns it off. Everything here is made up and labelled "Sample
   data". scripts/check-merch-ui.mjs serves the same replies as a mocked
   /api/merch, so the shapes follow feature/merch-server (netlify/functions/merch.js). */
(function (root) {
  'use strict';
  const MOCK = 'how-step-review.webp';
  const area = (regionId, name, w, h, design, logo, dpi = 150) => ({ regionId, name, pixelsWidth: w, pixelsHeight: h, dpi, renderable: true, available: true, suitsDesign: design, suitsLogo: logo });
  const spec = (id, regionId, w, h, dpi) => ({ templateId: id, region: 'front', regionId, pixelsWidth: w, pixelsHeight: h, dpi, placementStrategy: 'CENTER', garmentColor: '#FFFFFF' });
  const WHITE = [{ name: 'White', hex: '#FFFFFF' }];
  // Fourthwall's real blank photos for the tee (photo 0 is the front view).
  const FW = 'https://imgproxy.fourthwall.dev/';
  const TEE_COLORS = [
        { name: 'White', hex: '#FFFFFF', photos: [FW + 'JlZRh3G_d1lJumNzXOzkpo2GgDIYeuGxb2UEGgsCSzc/w:720/sm:1/enc/ERAphWI7I36oSWoy/udPg3mNxudmNlzuK/i5PwUYEAHD_8SjLz/jgzD6wg4yoCTY0BR/XSXdVtdzA0I5O_DJ/b75OYDimSstX_kor/o-UWDtIZ1Ut5QHbX/0nld0jyssdSMdrvd/6xUUPKdRiJs8wnxc/XnKweTt5ZQ9AxSYr/SzDpZshOHmpkUBzB/XG-YOW92R78jMqme/9rmCRR2WqVo5VjU1/aDUvgg.jpg'] },
        { name: 'Black', hex: '#020202', photos: [FW + 'MMkocS1sfnAe7TJiwEvc6svDULAzZSayTmAIqTs94kM/w:720/sm:1/enc/Exv6_LUDaRavTScr/HV1DqT4cczNl4z-h/G12I2AqgrBUz-17I/V7sLI0QIRC7eRtCZ/GlPfetqfo6CF4a6L/wcOEFVFikY4BnvXq/3jt9lAImnWTQYdHz/8xSjI3OJM3n3JZ0N/A6D51P9od3jIpWsc/bz-dTleE3P9UnK96/t6BewbO1C6lqzv7F/ZnbVHrQKIkdVuGHA/9rly4ZjYnUQ9L92o/L4Vq2w.jpg'] },
        { name: 'French Navy', hex: '#020718', photos: [FW + 'ohX-EfccCc2jqvKFL1Aptt8SLIK7M-PdQ1o6be15Kzo/w:720/sm:1/enc/Y7VUOiCEhepgefWZ/rbToa4TTCtSbocDk/5nwc0RTg1epJhjTC/HI3w15Wcl5G4BGIO/Kn8H0QRYzY9ZmJ9X/2YKWbGFQD3vSheDu/q5IaDjJ6zQqgVAfS/6nYD76ggxV-RlJLE/zTn_WsgCrEU738OY/-REeYUsqS1dzFKof/sW3Ge5AIK0g7XSJe/ofoXuNmoxdt-0us9/WvZ0Oi9Pj5K7yil_/_30CRw.jpg'] },
        { name: 'Red', hex: '#ED0739', photos: [FW + '6CYnUsgTJMxjbFuKypOJC-fbqwyNqWtcTjYMMN0zq8M/w:720/sm:1/enc/iJDk1mowjSLhINna/uGGBlBOkqF8LS96T/fPPWhgP_OXXRveuE/JTMMlecqDqim8SAy/P2JQuXXU0h8nkrlI/kIcO6yA92NiXPheS/VvHcgQrPcmRB5lsj/rJ0g28m6awyhcwvh/kxAy_-phAD9_nNJ1/kuI9YsNtdH7NOYtE/_SuPNain8fgEFz43/gDVmYOgyUVKp0oqO/hqOLHcmhpr9aog62/g5blxw.jpg'] },
        { name: 'Heather Grey', hex: '#CFCBC8', photos: [FW + '0-9FmA0gFVYWrWYTkIKE56mg3uQWu24hp3XcP7ejdqo/w:720/sm:1/enc/pGFUFHlOM34bdj9t/eYX7CGQbcqGQnuH7/LHhkLzUAOC8qXYUn/KtVwiVpRvL3PvDLF/fJCXYZ_CVg_SsOvx/EZUovwVLnbm9g-m9/1Op03cEPl6EUrgVK/Nt2pctFTMz_2X8NM/pM3z3VjE75GCvZf6/oLHwx-6oE7rtN-ZE/DqwPPRfrNFbjAi47/xmgg2v24LrbwxrpG/1NgswBbBva4LB6wW/w17aow.jpg'] },
      ];
  // Server v2 fields: kind, apparel, minDpi, wrap, logo 'area'|'inside', pricing { suggested, margin, base }.
  const v2 = (t, apparel, minDpi, wrap = false) => ({ ...t, apparel, minDpi, wrap, logo: apparel ? 'area' : 'inside', printSpec: { ...t.printSpec, kind: t.kind, minDpi, wrap }, pricing: { suggested: t.suggestedPrice, base: t.basePrice, margin: Math.round((t.suggestedPrice - t.basePrice) * 100) / 100 } });
  // One sample template per blank (merch v2: templates with no `blank` = all blanks).
  const TEMPLATES = [
    { blank: 'tee', kind: 'tee', label: 'T-shirt', templateId: 'tpl-tee-sample', name: 'Classic tee (sample)', basePrice: 13.5, suggestedPrice: 25.99, source: 'sample', defaultColor: 'White',
      printSpec: spec('tpl-tee-sample', 'front_large', 2250, 2700, 150),
      colors: TEE_COLORS,
      sizes: ['S', 'M', 'L', 'XL', '2XL'],
      areas: [area('front_large', 'Front', 2250, 2700, true, false), area('back_large', 'Back', 2250, 2700, true, false), area('sleeve_left', 'Left sleeve', 600, 525, false, true), area('sleeve_right', 'Right sleeve', 600, 525, false, true)] },
    { blank: 'hoodie', kind: 'hoodie', label: 'Hoodie', templateId: 'tpl-hoodie-sample', name: 'Pullover hoodie (sample)', basePrice: 29.5, suggestedPrice: 47.99, source: 'sample', defaultColor: 'Black',
      printSpec: spec('tpl-hoodie-sample', 'front_large', 1650, 1650, 150),
      colors: [{ name: 'Black', hex: '#101114' }, { name: 'White', hex: '#FFFFFF' }, { name: 'Navy', hex: '#0B1F3A' }, { name: 'Grey', hex: '#8A8D8F' }],
      sizes: ['S', 'M', 'L', 'XL', '2XL'],
      areas: [area('front_large', 'Front', 1650, 1650, true, false), area('back_large', 'Back', 2250, 2700, true, false), area('sleeve_left', 'Left sleeve', 600, 525, false, true), area('back_neck', 'Back neck', 750, 300, false, true)] },
    { blank: 'poster', kind: 'poster', label: 'Poster', templateId: 'tpl-poster-sample', name: 'Matte poster 5×7 (sample)', basePrice: 11.2, suggestedPrice: 21.99, source: 'sample', defaultColor: 'White',
      printSpec: spec('tpl-poster-sample', 'default', 1500, 2100, 300), colors: WHITE, sizes: ['5×7'],
      areas: [area('default', 'Print', 1500, 2100, true, false, 300)] },
    { blank: 'sticker', kind: 'sticker', label: 'Sticker', templateId: 'tpl-sticker-sample', name: 'Kiss-cut sticker 3×3 (sample)', basePrice: 2.6, suggestedPrice: 6.99, source: 'sample', defaultColor: 'White',
      printSpec: spec('tpl-sticker-sample', 'default', 900, 900, 300), colors: WHITE, sizes: ['3×3'],
      areas: [area('default', 'Print', 900, 900, false, true, 300)] },
    { blank: 'mug', kind: 'mug', label: 'Mug', templateId: 'tpl-mug-sample', name: 'Ceramic mug 11 oz (sample)', basePrice: 7.9, suggestedPrice: 15.99, source: 'sample', defaultColor: 'White',
      printSpec: spec('tpl-mug-sample', 'default', 2700, 1050, 300), colors: WHITE, sizes: ['11 oz'],
      areas: [area('default', 'Wrap', 2700, 1050, true, false, 300)] },
  ].map(t => v2(t, ['tee', 'hoodie'].includes(t.kind), ['tee', 'hoodie'].includes(t.kind) ? 150 : 300, t.kind === 'mug'));
  const CONCEPTS = [
    { id: 's1', collection: 'replay', title: 'Sample Lakers bench era', team: { id: 'lal', name: 'Los Angeles Lakers' }, palette: { a: '#552583', b: '#FDB927', ink: '#FFFFFF' }, garment: { color: '#FFFFFF', name: 'White' },
      stack: [{ text: 'Kobe', size: 'big', fill: 'a', ink: 'ink' }, { text: 'Smush', size: 'big', fill: 'b', ink: 'ink' }, { text: 'Luke', size: 'big', fill: 'a', ink: 'ink' }, { text: 'Kwame', size: 'big', fill: 'b', ink: 'ink' }, { text: 'Mihm', size: 'big', fill: 'a', ink: 'ink' }],
      align: 'center', blanks: ['tee'], rights: [{ kind: 'name', text: 'Kobe, Smush, Luke, Kwame, Mihm' }, { kind: 'team', text: 'Lakers colours' }], why: 'A roster only real fans remember.' },
    { id: 's2', collection: 'quote', title: 'Ball don’t lie', team: null, palette: { a: '#FFFFFF', b: '#033162', ink: '#1257B8' }, garment: { color: '#ED0739', name: 'Red' },
      stack: [{ text: 'Ball don’t lie', size: 'big', fill: 'white', ink: 'ink' }], align: 'center', blanks: ['tee'], rights: [{ kind: 'quote', text: 'Ball don’t lie' }], why: 'Short, exact and instantly known.' },
    { id: 's3', collection: 'nickname', title: 'Megatron', team: { id: 'det', name: 'Detroit Lions' }, palette: { a: '#B0B7BC', b: '#0076B6', ink: '#0076B6' }, garment: { color: '#020718', name: 'French Navy' },
      stack: [{ text: 'Megatron', size: 'big', fill: 'a', ink: 'ink' }], align: 'center', blanks: ['tee'], rights: [{ kind: 'nickname', text: 'Megatron' }, { kind: 'team', text: 'Lions colours' }], why: 'Almost famous: one word, one era.' },
    { id: 's4', collection: 'core', title: 'We center fans', team: null, palette: { a: '#0A7DFA', b: '#033162', ink: '#FFFFFF' }, garment: { color: '#FFFFFF', name: 'White' },
      // merch5: one pill in a custom colour (a hex row; the engine never swaps it).
      stack: [{ text: 'We center', size: 'big', fill: 'a', ink: 'ink' }, { text: 'fans', size: 'big', fill: '#E4002B', ink: '#FFFFFF' }], align: 'left', blanks: ['tee'], rights: [], why: 'An ES line, ours to sell, with one pill in a custom red.' },
  ];
  // Pro adds a plan and richer layouts, two with extras (elements) beside the pills.
  const PRO_CONCEPTS = [
    { id: 'p1', collection: 'current', label: 'Big number', title: 'Sample: 50 on the night', team: { id: 'lal', name: 'Los Angeles Lakers' }, palette: { a: '#552583', b: '#FDB927', ink: '#FFFFFF' }, garment: { color: '#FFFFFF', name: 'White' },
      stack: [{ text: 'Fifty', size: 'big', fill: 'a', ink: 'white' }, { text: 'On the night', size: 'mid', fill: 'b', ink: 'ink' }], align: 'center', blanks: ['tee'], rights: [{ kind: 'team', text: 'Lakers colours' }], why: 'The number fans repeat, big behind the words.', mode: 'pro',
      elements: [{ type: 'number', text: '50', style: 'outline', color: 'b', position: 'behind' }, { type: 'rule', position: 'below', color: 'a', weight: 'thick' }] },
    { id: 'p2', collection: 'replay', label: 'Crowned', title: 'Sample: the comeback', team: null, palette: { a: '#0A7DFA', b: '#033162', ink: '#FFFFFF' }, garment: { color: '#020202', name: 'Black' },
      stack: [{ text: 'The comeback', size: 'big', fill: 'a', ink: 'white' }, { text: 'Nobody saw it coming', size: 'small', fill: 'white', ink: 'a' }], align: 'left', blanks: ['tee'], rights: [], why: 'A crown over the line says it all without a logo.', mode: 'pro',
      elements: [{ type: 'icon', name: 'crown', position: 'above', color: 'white' }] },
  ];
  const PLAN = {
    basic: { idea: 'Keep the line whole and let the pills do the work.', angle: 'Clean ES stacks in team colours.' },
    pro: { idea: 'Sell the moment fans are already quoting: the line in full, then the number and the comeback.', angle: 'Lead with the exact words; add one bold extra where it helps the story.' },
  };
  const MOMENTS = [
    { id: 'm1', audience: 'Sample City fans and rookie-card collectors', timing: 'now', collection: 'current', ai: true, lines: [{ text: 'FIFTY ON THE NIGHT', angle: 'stat' }, { text: 'ROOKIE NIGHT', angle: 'callback' }, { text: '50 AND COUNTING', angle: 'chant' }], title: 'Sample: a rookie drops 50 in his first start', sport: 'nba', sportLabel: 'NBA', team: { name: 'Sample City', short: 'Sample City' }, kind: 'stat', score: 91, why: 'A rookie scoring 50 is the night fans retell for years; a round number reads from across the street.', line: 'FIFTY ON THE NIGHT', trend: { id: 't1', title: 'Sample: a rookie’s 50-point night', sport: 'nba' } },
    { id: 'm2', audience: 'NBA fans who grew up on the line', timing: 'season', collection: 'quote', ai: true, lines: [{ text: 'BALL DON’T LIE', angle: 'quote' }, { text: 'THE BALL KNEW', angle: 'pun' }, { text: 'KARMA ON THE COURT', angle: 'callback' }], title: 'Sample: “Ball don’t lie” is back after a wild finish', sport: 'nba', sportLabel: 'NBA', team: null, kind: 'quote', score: 86, why: 'The phrase is already part of how fans talk, so the shirt explains itself at a glance.', line: 'BALL DON’T LIE', trend: { id: 't4', title: 'Sample: “Ball don’t lie” after a wild finish', sport: 'nba' } },
    { id: 'm3', audience: 'Packers fans after a cold-weather home win', timing: 'week', collection: 'current', ai: true, lines: [{ text: 'FROZEN TUNDRA', angle: 'nickname' }, { text: 'SNOW GAME SZN', angle: 'chant' }, { text: 'LAMBEAU OR BUST', angle: 'city' }], title: 'Sample: the Packers beat the Rams in the Lambeau snow', sport: 'nfl', sportLabel: 'NFL', team: { name: 'Green Bay Packers', short: 'Packers' }, kind: 'moment', score: 78, why: 'A snow game at Lambeau turns a whole fan base into storytellers for a week, and they want something to wear to the next home game.', line: 'FROZEN TUNDRA', trend: { id: 't2', title: 'Sample: Packers top the Rams 24-17 in the Lambeau snow', sport: 'nfl' } },
    { id: 'm4', audience: 'Fans who were there for the first save', timing: 'season', collection: 'nickname', ai: true, lines: [{ text: 'THE CLOSER', angle: 'nickname' }, { text: 'LOCK IT DOWN', angle: 'chant' }, { text: 'NINTH INNING MAN', angle: 'callback' }], title: 'Sample: “The Closer” earns his nickname', sport: 'mlb', sportLabel: 'MLB', team: null, kind: 'nickname', score: 72, why: 'A nickname fans are just starting to use feels like an inside joke; early merch rides that.', line: 'THE CLOSER', trend: { id: 't3', title: 'Sample: a walk-off in extra innings', sport: 'mlb' } },
    { id: 'm5', audience: 'Both clubs’ fans, derby week', timing: 'week', collection: 'current', ai: true, lines: [{ text: 'DERBY DAY', angle: 'rivalry' }, { text: 'PICK A SIDE', angle: 'chant' }, { text: 'ONE CITY TWO COLOURS', angle: 'rivalry' }], title: 'Sample: the rivalry renewed in the derby', sport: 'others', sportLabel: 'Soccer', team: null, kind: 'rivalry', score: 64, why: 'Derby week is when both sides buy to pick a side, and both can wear the same line.', line: 'DERBY DAY', trend: { id: 't5', title: 'Sample: the derby rivalry renewed', sport: 'soccer' } },
  ];
  // Free-mode style intents, done in code (the real server uses the AI first).
  const INTENTS = [
    [/short|trim|less/i, c => { const keep = c.stack.filter((r, i) => i === 0 || r.size !== 'small'); return keep.length < c.stack.length ? [{ ...c, stack: keep }, 'Dropped the small lines so the main words carry it.'] : c.stack.length > 1 ? [{ ...c, stack: c.stack.slice(0, -1) }, 'Removed the last pill.'] : [c, 'It’s already one pill.']; }],
    [/team colou?r/i, c => (c.team?.id === 'lal' ? [{ ...c, palette: { ...c.palette, a: c.palette.b, b: c.palette.a } }, 'Switched to the other Lakers colour first.'] : [{ ...c, palette: { a: '#552583', b: '#FDB927', ink: '#FFFFFF' } }, 'Used Lakers purple and gold (sample team colours).'])],
    [/nickname/i, c => (c.stack.length >= 10 ? [c, 'That’s already 10 pills, the most a design can have.'] : [{ ...c, stack: [...c.stack, { text: (c.rights || []).find(r => r.kind === 'nickname')?.text || 'Showtime', size: 'small', fill: 'b', ink: 'ink' }], rights: [...(c.rights || []), { kind: 'nickname', text: 'Showtime' }] }, 'Added the nickname as a small line under it.'])],
    [/bold|big/i, c => [{ ...c, stack: c.stack.map(r => ({ ...r, size: 'big' })), fit: { ...(c.fit || {}), scale: Math.min(1.6, ((c.fit && c.fit.scale) || 1) * 1.2) } }, 'Made every pill big and the print 20% larger.']],
    [/smaller/i, c => [{ ...c, fit: { ...(c.fit || {}), scale: Math.max(0.6, ((c.fit && c.fit.scale) || 1) * 0.85) } }, 'Made the print 15% smaller.']],
    [/cent(re|er)/i, c => [{ ...c, align: 'center' }, 'Centred the stack.']],
    [/left/i, c => [{ ...c, align: 'left' }, 'Lined the pills up on the left.']],
    [/dark|black tee/i, c => [{ ...c, garment: { color: '#020202', name: 'Black' } }, 'Put it on a black tee. Pills that melt into black switch to white.']],
    [/white tee|light/i, c => [{ ...c, garment: { color: '#FFFFFF', name: 'White' } }, 'Put it on a white tee.']],
    [/swap/i, c => [{ ...c, palette: { ...c.palette, a: c.palette.b, b: c.palette.a } }, 'Swapped the two pill colours.']],
  ];
  // Refine keeps custom (hex) rows as they are: intents copy rows ({ ...r }) and
  // only change palette keys, alignment, size or the garment (like the server).
  function refine(body, scenario) {
    const c = body.concept;
    if (!c || !Array.isArray(c.stack)) return [400, { ok: false, error: 'Pick a design first.' }];
    const text = String(body.instruction || '').slice(0, 300);
    const hit = INTENTS.find(([re]) => re.test(text));
    const simple = hit && !/team colou?r|nickname|bold/.test(String(hit[0]));
    if (scenario === 'free' && !simple) return [200, { ok: true, free: true, concept: null, designMode: body.designMode === 'pro' ? 'pro' : 'basic', error: 'Free mode can do: shorter, centre or left, swap colours, bigger or smaller, white or dark tee.' }];
    const pro = body.designMode === 'pro' && scenario !== 'pro-cap';
    if (!hit) return scenario === 'free' ? [200, { ok: true, free: true, concept: null, designMode: body.designMode === 'pro' ? 'pro' : 'basic', error: 'Free mode can do: shorter, centre or left, swap colours, bigger or smaller, white or dark tee.' }] : [200, { ok: true, concept: { ...c, title: c.title }, note: `Sample data: “${text.slice(0, 60)}” would go to the ${pro ? 'Pro' : 'Basic'} AI. Nothing changed.`, designMode: pro ? 'pro' : 'basic', mode: pro ? 'pro' : 'basic', ai: true, cost: { usd: 0, cached: false } }];
    const [next, note] = hit[1]({ ...c, stack: c.stack.map(r => ({ ...r })) });
    if (!pro) delete next.elements;
    return [200, { ok: true, concept: { ...next, mode: pro ? (next.mode || 'pro') : 'basic' }, note, designMode: pro ? 'pro' : 'basic', mode: pro ? 'pro' : 'basic', ai: !/short|cent|left|swap|smaller|dark|white/i.test(text), ...(body.designMode === 'pro' && !pro ? { fellBack: 'ai' } : {}), cost: { usd: 0, cached: false } }];
  }
  function concepts(body, scenario) {
    if (scenario === 'free') return [200, { ok: true, concepts: null, free: true }];
    if (body.designMode === 'pro' && scenario === 'pro-cap') return [200, { ok: true, free: true, concepts: null, plan: null, designMode: 'basic', fellBack: 'cap', note: 'Pro is paused: you’ve reached this week’s AI limit, so these are Basic designs.' }];
    const pro = body.designMode === 'pro';
    const list = pro ? [...CONCEPTS, ...PRO_CONCEPTS].map(c => ({ ...c, mode: 'pro' })) : CONCEPTS.map(c => ({ ...c, mode: 'basic' }));
    return [200, { ok: true, concepts: list, plan: PLAN[pro ? 'pro' : 'basic'], designMode: pro ? 'pro' : 'basic', mode: pro ? 'pro' : 'basic', ai: true, model: pro ? 'sample-best' : 'sample-main', cost: { usd: 0, cached: false } }];
  }
  const TRENDS = [
    { id: 't1', title: 'Sample: a rookie’s 50-point night', category: 'nba', rank: 90 },
    { id: 't2', title: 'Sample: the comeback nobody saw coming', category: 'nfl', rank: 80 },
    { id: 't3', title: 'Sample: a walk-off in extra innings', category: 'mlb', rank: 70 },
  ];
  const IMAGES = ['White', 'White', 'Black', 'Black', 'Navy', 'Heather grey'].map((color, i) => ({ url: MOCK, width: 1000, height: 1000, color, region: i % 2 ? 'back' : 'front_large' }));
  let product = null;
  const SHOP = 'https://sample-shop.example/products/';
  const COLLECTIONS = [{ id: 'col_fan', name: 'Fan favourites (sample)', count: 4 }, { id: 'col_replay', name: 'Replay era (sample)', count: 2 }, { id: 'col_core', name: 'Core ES (sample)', count: 3 }];
  const memberOf = {}; // productId -> collection ids
  const day = n => new Date(Date.UTC(2026, 10, 25 - n, 15)).toISOString();
  const LIST = [
    { productId: 'prod_s1', title: 'Ball don’t lie Tee (sample)', url: SHOP + 'ball-dont-lie-tee', state: 'PUBLIC', thumb: MOCK, blank: 'tee', color: 'Red', createdAt: day(2), createdBy: 'qa@essentiallysports.com', units30: 14, revenue30: 364 },
    { productId: 'prod_s2', title: 'Megatron Hoodie (sample)', url: SHOP + 'megatron-hoodie', state: 'HIDDEN', thumb: MOCK, blank: 'hoodie', color: 'Black', createdAt: day(5), createdBy: 'qa@essentiallysports.com', units30: 0, revenue30: 0 },
    { productId: 'prod_s3', title: 'We center fans Mug (sample)', url: SHOP + 'we-center-fans-mug', state: 'PUBLIC', thumb: MOCK, blank: 'mug', color: 'White', createdAt: day(9), createdBy: 'designer@essentiallysports.com', units30: 6, revenue30: 95.94 },
    { productId: 'prod_s4', title: 'Sample Lakers bench era Poster (sample)', url: '', state: 'ARCHIVED', thumb: '', blank: 'poster', color: 'White', createdAt: day(21), createdBy: 'designer@essentiallysports.com', units30: 1, revenue30: 21.99 },
  ];
  const listNow = () => LIST.map(p => ({ ...p, state: String(p.state).toLowerCase() })); // the server's list uses lowercase states
  // ─── Brainstorm room (modes brainstorm-open / -turn / -line / -add / -list) ─
  // A shared board per trend. The sample board is a Packers–Rams snow game;
  // any other trend or line gets lines built from its own words. Everything is
  // made up. The signed-in person is ME; two sample teammates seed the board.
  const ME = 'qa@essentiallysports.com';
  const MAYA = 'maya@essentiallysports.com';
  const JORDAN = 'jordan@essentiallysports.com';
  const ago = min => new Date(Date.now() - min * 60000).toISOString();
  const words = t => String(t || '').trim().split(/\s+/).filter(Boolean);
  const okLine = t => { const s = String(t || '').trim(); return s.length >= 2 && s.length <= 32 && words(s).length <= 6; };
  const normLine = t => String(t || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const hashKey = t => { let h = 0; for (const c of normLine(t)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); };
  const BANNED_LINE = /\b(NFL|NBA|MLB|NHL|NCAA|OFFICIAL|LICENSED)\b/i;
  const PACKERS = {
    context: {
      title: 'Sample: Packers top the Rams 24-17 in the Lambeau snow', sport: 'nfl', sportLabel: 'NFL', team: { name: 'Green Bay Packers', short: 'Packers' },
      colours: ['#203731', '#FFB612'], palette: { a: '#203731', b: '#FFB612', ink: '#000000' },
      headlines: [{ title: 'Sample: Packers top the Rams 24-17 in the Lambeau snow', source: 'Sample wire', url: '' }, { title: 'Sample: Rams fall short on a late fourth-down try', source: 'Sample wire', url: '' }, { title: 'Sample: the Lambeau crowd stays to the end in the snow', source: 'Sample wire', url: '' }, { title: 'Sample: Green Bay moves to 9-4 and into a playoff spot', source: 'Sample wire', url: '' }],
      esArticles: [{ title: 'Sample ES: how the Packers won the snow game', url: 'https://www.essentiallysports.com/', date: '2026-11-26' }, { title: 'Sample ES: the Rams’ fourth-down call, explained', url: 'https://www.essentiallysports.com/', date: '2026-11-26' }],
      facts: ['Sample check: the final score was 24-17.', 'Sample check: it was the coldest home game of the season so far.'], factUrls: [],
      nicknames: ['Frozen Tundra', 'Titletown', 'Cheeseheads'], notes: [],
    },
    pools: {
      chant: ['GO PACK GO', 'PACK IN THE SNOW', 'LOUDER IN THE COLD', 'HOLD THE LINE', 'SNOW GAME SZN'],
      pun: ['SNOW PROBLEM', 'BRRR-ILLIANT', 'CHEESE ON ICE', 'FROST AND FOUND', 'ICE COLD PACK'],
      nickname: ['FROZEN TUNDRA', 'TITLETOWN', 'THE PACK IS BACK', 'TUNDRA TOUGH'],
      stat: ['24-17 IN THE SNOW', 'IT ENDED 24-17', '9-4 AND COLD', '24 POINTS OF FROST'],
      rivalry: ['RAMS MELTED', 'TOO COLD FOR LA', 'WELCOME TO WINTER', 'LA GOT SNOWED'],
      era: ['FOOTBALL WEATHER', 'OLD SCHOOL FOOTBALL', 'SNOW GAMES NEVER DIE', 'THE WAY IT USED TO BE'],
      city: ['LAMBEAU OR BUST', 'GREEN BAY GROWN', 'SMALL TOWN BIG GAME', 'TITLETOWN WINTERS'],
      player: ['ICE IN HIS VEINS', 'QB1 IN THE SNOW', 'GLOVES OFF', 'BUILT FOR THIS'],
      troll: ['BRING A COAT LA', 'SUNSCREEN WON’T HELP', 'SEE YOU IN JANUARY', 'NO PALM TREES HERE'],
      funnier: ['SNOW PROBLEM', 'BRING A COAT LA', 'CHEESE ON ICE', 'BRRR-ILLIANT', 'FROSTBITE SZN'],
      emotional: ['WE STAYED', 'THROUGH THE SNOW', 'HOME IS LAMBEAU', 'COLD HANDS FULL HEARTS', 'WORTH THE FROSTBITE'],
      shorter: ['GO PACK', 'BRRR', 'FROZEN', 'STAYED', 'TUNDRA'],
      neutral: ['FOOTBALL WEATHER', 'SNOW GAMES HIT DIFFERENT', 'REAL FOOTBALL', 'COLD GAME HOT TAKE'],
    },
    rights: { 'FROZEN TUNDRA': [{ kind: 'nickname', text: 'Frozen Tundra' }], TITLETOWN: [{ kind: 'nickname', text: 'Titletown' }], 'TITLETOWN WINTERS': [{ kind: 'nickname', text: 'Titletown' }], 'CHEESEHEADS DON’T MELT': [{ kind: 'nickname', text: 'Cheeseheads' }] },
    why: { chant: 'A chant fans already shout, short enough to read from the stands.', pun: 'Wordplay on the snow: the joke lands before the second look.', nickname: 'The stadium’s nickname, worn like a badge after a home win.', stat: 'The score from the headline, so it’s exact.', rivalry: 'Pokes the Rams without a logo or a cheap shot.', era: 'Calls back to old-school cold-weather football.', city: 'Green Bay pride: small town, big game.', player: 'About the quarterback’s night without naming him.', troll: 'A friendly jab at the visitors from the warm side of the country.', funnier: 'Funnier: a joke a fan would say out loud.', emotional: 'For the fans who stayed to the end in the snow.', shorter: 'One or two words: the biggest type on the shirt.', neutral: 'Works for any football fan, not just Packers fans.' },
  };
  const ANGLES = ['quote', 'nickname', 'chant', 'callback', 'pun', 'stat', 'rivalry', 'era', 'city', 'player', 'troll'];
  // Lines for any other trend or line: built from its own words.
  const GENERIC_WHY = { chant: 'Short and loud: a line fans can shout.', pun: 'Wordplay on the moment.', nickname: 'A name fans already use.', stat: 'Numbers only from the sources.', rivalry: 'Picks a side without a logo.', era: 'Calls back to a moment fans remember.', city: 'Hometown pride.', player: 'About the player, no name needed.', troll: 'A friendly jab, in good taste.', callback: 'Brings back the moment in a few words.' };
  function genericPools(title) {
    const w = words(normLine(title).replace(/^(SAMPLE|YOUR LINE)\s*/, '')).filter(x => x.length > 3 && !/^(THE|AND|WITH|FROM|AFTER|THIS|THAT|NIGHT|YOUR|LINE|DONT)$/.test(x));
    const k = w[0] || 'THIS';
    const k2 = w[1] || 'MOMENT';
    return {
      chant: [`${k} ${k} ${k}`, `LET’S GO ${k}`, `${k} SZN`], pun: [`${k} OF THE YEAR`, `${k}-ING HAPPENS`], nickname: [`THE ${k}`, `MR ${k}`], stat: [`${k} BY THE NUMBERS`],
      rivalry: ['PICK A SIDE', 'NOT EVEN CLOSE'], era: ['ONE FOR THE ARCHIVE', 'REMEMBER THIS ONE'], city: ['HOMETOWN PROUD', 'OUR TOWN OUR TEAM'], player: ['BUILT FOR THIS', 'BIG GAME ENERGY'],
      troll: ['CALL IT A COMEBACK', 'SEE YOU NEXT YEAR'], funnier: [`${k} HAPPENED`, 'I WAS TOLD THERE’D BE DEFENSE'], emotional: ['WE WERE THERE', 'NEVER STOPPED BELIEVING'], shorter: [k, 'BELIEVE'], neutral: ['WHAT A GAME', `${k} ${k2}`.slice(0, 32)],
    };
  }
  const sessions = new Map(); // key -> { session, context }
  let lineSeq = 0;
  const line = (text, angle, by, source, extra = {}) => ({ id: `bl${++lineSeq}`, text, angle, why: extra.why || '', by, at: extra.at || new Date().toISOString(), starred: extra.starred || [], source, rights: extra.rights || [] });
  const peopleOf = s => [...new Set([...s.lines.map(l => l.by), ...s.turns.map(t => t.by), s.createdBy].filter(Boolean))];
  const publicSession = s => { const { pools, packers, ...rest } = s; return JSON.parse(JSON.stringify({ ...rest, people: peopleOf(s) })); };
  function seed(key, trend, content) {
    const packers = trend && (trend.id === 't2' || /packers|lambeau/i.test(trend.title || ''));
    const title = trend?.title || (content?.text ? String(content.text).slice(0, 60) : 'Your line');
    const ctx = packers ? { ...PACKERS.context } : { title, sport: String(trend?.sport || ''), sportLabel: String(trend?.sport || '').toUpperCase(), team: trend?.team || null, colours: [], palette: null, headlines: trend ? [{ title: trend.title, source: '', url: '' }] : [], esArticles: [], facts: [], factUrls: [], nicknames: [], notes: ['ES articles: none found (sample)', 'Web check: skipped (sample)'] };
    const context = { ...ctx, gatheredAt: new Date().toISOString(), sources: { trend: Boolean(trend), es: ctx.esArticles.length > 0, web: ctx.facts.length > 0 } };
    const s = { id: `bs-${hashKey(key)}`, key, storage: 'db', trendId: trend?.id || null, title: context.title, sport: context.sport, team: context.team, createdBy: packers ? MAYA : ME, createdAt: ago(packers ? 95 : 0), updatedAt: ago(packers ? 12 : 0), lines: [], turns: [], contextAt: context.gatheredAt, pools: packers ? PACKERS.pools : genericPools(title), packers };
    if (packers) {
      const a = [line('FROZEN TUNDRA', 'nickname', MAYA, 'ai', { at: ago(90), starred: [MAYA, JORDAN], why: PACKERS.why.nickname, rights: PACKERS.rights['FROZEN TUNDRA'] }), line('SNOW GAME SZN', 'chant', MAYA, 'ai', { at: ago(90), starred: [MAYA], why: PACKERS.why.chant }), line('LAMBEAU OR BUST', 'city', MAYA, 'ai', { at: ago(90), why: PACKERS.why.city }), line('24-17 IN THE SNOW', 'stat', MAYA, 'ai', { at: ago(90), why: PACKERS.why.stat })];
      const b = [line('CHEESEHEADS DON’T MELT', 'pun', JORDAN, 'person', { at: ago(40), starred: [JORDAN, MAYA], rights: PACKERS.rights['CHEESEHEADS DON’T MELT'] })];
      const c = [line('BRING A COAT LA', 'troll', JORDAN, 'ai', { at: ago(12), starred: [JORDAN], why: PACKERS.why.troll }), line('TOO COLD FOR LA', 'rivalry', JORDAN, 'ai', { at: ago(12), why: PACKERS.why.rivalry }), line('WE STAYED', 'callback', JORDAN, 'ai', { at: ago(12), why: PACKERS.why.emotional })];
      s.lines = [...a, ...b, ...c];
      s.turns = [
        { id: 'bt-seed1', ai: true, by: MAYA, at: ago(90), prompt: 'Lines for the snow game, Packers fans first', note: 'Leaned on the snow and Lambeau: the cold is the story fans are retelling. The score is from the headline.', lineIds: a.map(l => l.id), designMode: 'basic' },
        { id: 'bt-seed2', ai: true, by: JORDAN, at: ago(12), action: { kind: 'angle', angle: 'troll' }, note: 'Friendly jabs at the visitors, nothing mean, no logos.', lineIds: c.map(l => l.id), designMode: 'pro' },
      ];
    }
    sessions.set(key, { session: s, context });
    return sessions.get(key);
  }
  const TONE = { funnier: 'funnier', emotional: 'emotional', shorter: 'shorter' };
  // Pool keys that aren't angles map to one for the chip on the card.
  const POOL_ANGLE = { funnier: 'pun', emotional: 'callback', shorter: 'callback', neutral: 'callback' };
  // Round-robin across the pools, so padding mixes angles.
  const allOf = P => { const e = Object.entries(P); const out = []; for (let i = 0; i < 6; i++) e.forEach(([k, list]) => { if (list[i]) out.push([list[i], POOL_ANGLE[k] || k]); }); return out; };
  function pick(pool, board, n) {
    const have = new Set(board.map(l => normLine(l.text)));
    const out = [];
    for (const [t, a] of pool) { if (out.length >= n) break; const k = normLine(t); if (okLine(t) && !BANNED_LINE.test(t) && !have.has(k)) { out.push([t, a]); have.add(k); } }
    return out;
  }
  function mixOf(a, b) {
    const wa = words(a.text);
    const wb = words(b.text);
    const half = x => Math.max(1, Math.ceil(x.length / 2));
    return [[...wa.slice(0, half(wa)), ...wb.slice(-half(wb))], [...wb.slice(0, half(wb)), ...wa.slice(-half(wa))], [...wa.slice(0, 1), ...wb.slice(0, 2)]].map(x => x.join(' ').slice(0, 32).trim());
  }
  function turn(body, scenario) {
    const entry = [...sessions.values()].find(e => e.session.id === body.sessionId);
    if (!entry) return [404, { ok: false, reason: 'not-found', error: 'This board is gone. Open it again from the moment.' }];
    const s = entry.session;
    const act = body.action && typeof body.action === 'object' ? body.action : null;
    const prompt = act ? '' : String(body.prompt || '').trim().slice(0, 300);
    if (!act && !prompt) return [400, { ok: false, error: 'Ask for something, or pick an angle.' }];
    const P = s.pools;
    let pool = [];
    let angleFor = () => 'callback';
    let note = '';
    if (act?.kind === 'angle') { const a = act.angle === 'wordplay' ? 'pun' : act.angle; pool = P[a] || []; angleFor = () => (ANGLES.includes(a) ? a : 'callback'); note = { chant: 'Chants first: short lines fans can shout in rhythm.', pun: 'Wordplay on the moment, each one readable at a glance.', nickname: 'Built around the nicknames in the sources.', stat: 'Only numbers that are in the headlines or the fact check.', rivalry: 'Rivalry lines that poke without a logo or a cheap shot.', era: 'Callbacks to the old days, no dates I couldn’t check.', city: 'City pride: where the fans are from.', player: 'Player lines that don’t need a name on the shirt.', troll: 'Troll lines, in good taste: friendly jabs, nothing mean.' }[a] || 'New lines on that angle.'; }
    else if (act?.kind === 'tone') { pool = P[TONE[act.tone]] || P.funnier; angleFor = () => (act.tone === 'funnier' ? 'pun' : 'callback'); note = { funnier: 'Funnier: jokes a fan would actually say out loud.', emotional: 'More emotional: lines for the fans who were there.', shorter: 'Shorter: one or two words, so the type prints biggest.' }[act.tone] || 'Changed the tone.'; }
    else if (act?.kind === 'audience') { pool = P.neutral; angleFor = () => 'callback'; note = 'For neutral fans: lines any football fan would wear, no team needed.'; }
    else if (act?.kind === 'more-like') {
      const base = s.lines.filter(l => (act.lineIds || []).includes(l.id));
      const a = base[0]?.angle || 'callback';
      const w = words(base[0]?.text || '');
      pool = [...(P[a] || []), `${w.slice(0, 2).join(' ')} FOREVER`, `STILL ${base[0]?.text || ''}`, `${base[0]?.text || ''} SZN`];
      angleFor = () => a;
      note = `More like “${base[0]?.text || 'that line'}”: same angle, new words.`;
    } else if (act?.kind === 'mix') {
      const base = s.lines.filter(l => (act.lineIds || []).includes(l.id)).slice(0, 2);
      if (base.length < 2) return [400, { ok: false, error: 'Pick two lines to mix.' }];
      pool = mixOf(base[0], base[1]);
      angleFor = i => (i % 2 ? base[1].angle : base[0].angle);
      note = `Mixed “${base[0].text}” with “${base[1].text}”.`;
    } else {
      const hit = Object.keys(P).find(k => new RegExp(k === 'pun' ? 'pun|wordplay' : k === 'emotional' ? 'emotion|heart' : k, 'i').test(prompt));
      pool = hit ? P[hit] : [];
      angleFor = () => POOL_ANGLE[hit] || hit || 'callback';
      note = `Played on “${prompt.slice(0, 60)}”. Numbers only from the headlines and the fact check.`;
    }
    const free = scenario === 'free';
    const capped = body.designMode === 'pro' && scenario === 'pro-cap';
    const tagged = pool.map((t, i) => [t, angleFor(i)]);
    const picked = pick(free ? Object.values(P).map(x => [x[x.length - 1], 'callback']) : tagged.concat(allOf(P)), s.lines, free ? 3 : 4 + (s.lines.length % 3));
    const by = ME;
    const at = new Date().toISOString();
    const fresh = picked.map(([t, a]) => line(t, a, by, free ? 'code' : 'ai', { at, why: free ? 'A quick pick from the headline, made without AI.' : (s.packers ? PACKERS.why[a] : '') || GENERIC_WHY[a] || 'Fits the moment and the ES voice.', rights: s.packers ? PACKERS.rights[t] || [] : [] }));
    const mode = free ? 'basic' : body.designMode === 'pro' && !capped ? 'pro' : 'basic';
    const finalNote = free ? 'Free mode: no AI this time. These are quick picks made from the headline in code.' : capped ? `Pro is paused (this week’s AI limit), so Basic wrote these. ${note}` : note;
    s.lines.push(...fresh);
    if (!free) fresh.forEach(l => { l.designMode = mode; });
    s.turns.push({ id: `bt-${++lineSeq}`, by, at, ...(act ? { action: act } : { prompt }), note: finalNote, lineIds: fresh.map(l => l.id), designMode: mode, ai: !free, ...(free ? { fellBack: 'free' } : capped ? { fellBack: 'cap' } : {}) });
    s.turns = s.turns.slice(-40);
    s.updatedAt = at;
    return [200, { ok: true, lines: fresh, note: finalNote, session: publicSession(s), designMode: mode, ...(free ? { free: true, fellBack: 'free' } : capped ? { fellBack: 'cap' } : {}), cost: { usd: 0, cached: false } }];
  }
  function brainstorm(m, body, scenario) {
    if (m === 'brainstorm-list') return [200, { ok: true, storage: 'db', sessions: [...sessions.values()].map(({ session: s }) => ({ id: s.id, key: s.key, trendId: s.trendId, title: s.title, sport: s.sport, lines: s.lines.length, starred: s.lines.filter(l => l.starred.length).length, updatedAt: s.updatedAt, people: peopleOf(s).length })).sort((x, y) => String(y.updatedAt).localeCompare(x.updatedAt)).slice(0, 20) }];
    if (m === 'brainstorm-open') {
      const trend = body.trend && typeof body.trend === 'object' ? body.trend : null;
      const text = String(body.content?.text || '').trim();
      if (!trend && text.length < 2) return [400, { ok: false, error: 'Pick a moment or write a line first.' }];
      const key = trend?.id ? String(trend.id) : `line:${hashKey(text)}`;
      const created = !sessions.has(key);
      const e = sessions.get(key) || seed(key, trend, body.content);
      return [200, { ok: true, created, session: publicSession(e.session), context: { ...e.context }, me: ME, cost: { usd: 0, cached: true } }];
    }
    if (m === 'brainstorm-get') {
      const e = [...sessions.values()].find(x => x.session.id === body.sessionId);
      if (!e) return [404, { ok: false, reason: 'not-found', error: 'This board is gone. Open it again from the moment.' }];
      return [200, { ok: true, session: publicSession(e.session), ...(body.withContext ? { context: { ...e.context } } : {}) }];
    }
    if (m === 'brainstorm-turn') return turn(body, scenario);
    const entry = [...sessions.values()].find(e => e.session.id === body.sessionId);
    if (!entry) return [404, { ok: false, reason: 'not-found', error: 'This board is gone. Open it again from the moment.' }];
    const s = entry.session;
    if (m === 'brainstorm-add') {
      const t = String(body.text || '').trim().replace(/\s+/g, ' ');
      if (t.length < 1 || t.length > 60) return [400, { ok: false, reason: 'input', error: 'Keep your line to 60 characters.' }];
      if (BANNED_LINE.test(t)) return [400, { ok: false, reason: 'rules', error: 'No league names or “official” on ES merch.' }];
      if (s.lines.some(l => normLine(l.text) === normLine(t))) return [400, { ok: false, reason: 'duplicate', error: 'That line is already on the board.' }];
      const added = line(t, 'callback', ME, 'person');
      s.lines.push(added);
      s.updatedAt = new Date().toISOString();
      return [200, { ok: true, line: { ...added }, session: publicSession(s) }];
    }
    if (m === 'brainstorm-line') {
      const l = s.lines.find(x => x.id === body.lineId);
      if (!l) return [404, { ok: false, reason: 'not-found', error: 'That line was removed.' }];
      if (body.op === 'star' && !l.starred.includes(ME)) l.starred.push(ME);
      else if (body.op === 'unstar') l.starred = l.starred.filter(x => x !== ME);
      else if (body.op === 'edit') {
        const t = String(body.text || '').trim().replace(/\s+/g, ' ');
        if (l.by !== ME) return [403, { ok: false, reason: 'forbidden', error: 'Only the person who added this line (or an admin) can change it.' }];
        if ((l.source === 'person' ? t.length > 60 : !okLine(t)) || BANNED_LINE.test(t)) return [400, { ok: false, reason: 'rules', error: BANNED_LINE.test(t) ? 'No league names or “official” on ES merch.' : 'Keep a line to 32 characters and 6 words.' }];
        l.text = l.source === 'person' ? t : t.toUpperCase();
        l.edited = true;
      } else if (body.op === 'remove') {
        if (l.by !== ME && scenario !== 'admin') return [403, { ok: false, reason: 'forbidden', error: 'Only the person who added this line (or an admin) can change it.' }];
        s.lines = s.lines.filter(x => x !== l);
      }
      s.updatedAt = new Date().toISOString();
      return [200, { ok: true, session: publicSession(s) }];
    }
    return [400, { ok: false, error: 'Unknown brainstorm action.' }];
  }
  // A teammate adds a line (the UI check uses it to test the 20 s refresh).
  function teammateAdds(sessionId, text) {
    const e = [...sessions.values()].find(x => x.session.id === sessionId);
    if (!e) return false;
    e.session.lines.push(line(text, 'chant', MAYA, 'person'));
    e.session.updatedAt = new Date().toISOString();
    return true;
  }
  // reply(body, scenario) -> [httpStatus, json]. Shapes follow netlify/functions/merch.js.
  function reply(body = {}, scenario = 'ok') {
    const m = body.mode;
    const pushModes = ['upload-url', 'upload-relay', 'register', 'preview', 'create', 'publish', 'hide', 'archive', 'collection-create', 'collection-set'];
    if (scenario === 'not-set-up' && (pushModes.includes(m) || m === 'templates' || m === 'product')) return [503, { ok: false, reason: 'not-set-up', error: 'Fourthwall isn’t set up yet. Ask an admin to add FOURTHWALL_API_USERNAME / PASSWORD in Vercel.' }];
    if (scenario === 'error' && m !== 'status') return [502, { ok: false, reason: 'fourthwall', error: 'Fourthwall didn’t answer. Try again in a moment.' }];
    if (scenario === 'cant-push' && pushModes.includes(m)) return [403, { ok: false, reason: 'cant-push', error: 'Only admins can put merch on Fourthwall. Ask an admin to publish this.' }];
    if (scenario === 'cap' && m === 'create') return [429, { ok: false, reason: 'daily-cap', error: 'You’ve sent 10 products to the shop today, the daily limit. More tomorrow.' }];
    if (/^brainstorm-/.test(m || '')) return brainstorm(m, body, scenario);
    switch (m) {
      case 'status': return [200, { ok: true, configured: scenario !== 'not-set-up', shop: scenario === 'not-set-up' ? null : { name: 'Sample shop', publicDomain: 'sample-shop.example', status: 'ACTIVE' }, canPush: scenario !== 'cant-push', canArchive: scenario !== 'cant-push', history: scenario === 'no-db' ? 'memory' : 'db', caps: { person: { used: 0, limit: 10, left: 10 }, team: { used: 0, limit: 30, left: 30 } }, rightsPolicy: 'acknowledge', blanks: ['tee', 'hoodie', 'poster', 'sticker', 'mug'], notice: '' }];
      case 'templates': return [200, { ok: true, templates: body.blank ? TEMPLATES.filter(t => t.blank === body.blank) : TEMPLATES }];
      case 'concepts': return concepts(body, scenario);
      case 'refine': return refine(body, scenario);
      case 'moments': return scenario === 'no-moments' ? [200, { ok: true, moments: [], error: 'Trends are unavailable right now.', at: new Date().toISOString(), cached: false }] : [200, { ok: true, moments: MOMENTS.filter(m => !body.sport || m.sport === body.sport).map(m => ({ ...m, trend: { ...m.trend } })), at: new Date().toISOString(), cached: true, ai: false, cost: { usd: 0, cached: true } }];
      case 'copy': {
        const t = TEMPLATES.find(x => x.blank === body.blank) || TEMPLATES[0];
        const name = { tee: 'Tee', hoodie: 'Hoodie', poster: 'Poster', sticker: 'Sticker', mug: 'Mug' }[t.blank];
        return [200, { ok: true, copy: { title: `${body.concept?.title || 'ES'} ${name}`, description: `The ES stacked-pill design on a ${t.label.toLowerCase()}. Made to order.`, retail: t.suggestedPrice, base: t.basePrice, margin: Math.round((t.suggestedPrice - t.basePrice) * 100) / 100 } }];
      }
      case 'upload-url': return [200, { ok: true, uploadUrl: '/__qa/upload', fileUrl: 'https://storage.example/sample.png', expiresAt: null, method: 'PUT' }];
      case 'upload-relay': return /^merch-art\/|^[\w-]+\/[\w.-]+\.png$/.test(String(body.path || '')) && body.uploadUrl && Number(body.size) > 0 ? [200, { ok: true }] : [400, { ok: false, error: 'Missing the uploaded file.' }];
      case 'register': return [200, { ok: true, imageId: 'img_' + Math.random().toString(36).slice(2, 9) }];
      case 'preview': return [200, { ok: true, customizationId: 'cus_sample', images: IMAGES, color: body.color }];
      case 'create': {
        product = { id: 'prod_' + Date.now().toString(36), state: 'HIDDEN' };
        const retail = Number(body.retail) || 30;
        const base = (TEMPLATES.find(x => x.blank === body.blank) || TEMPLATES[0]).basePrice;
        if (Array.isArray(body.collectionIds)) memberOf[product.id] = body.collectionIds.slice();
        LIST.unshift({ productId: product.id, title: body.title, url: SHOP + 'sample-product', state: 'HIDDEN', thumb: MOCK, blank: body.blank || 'tee', color: body.color || 'White', createdAt: new Date().toISOString(), createdBy: 'qa@essentiallysports.com', units30: 0, revenue30: 0 });
        return [200, { ok: true, productId: product.id, state: 'HIDDEN', title: body.title, description: body.description, images: IMAGES, price: { retail, base, margin: Math.round((retail - base) * 100) / 100 }, ack: body.ack, productUrl: SHOP + 'sample-product', collectionIds: memberOf[product.id] || [], caps: { person: { used: 1, limit: 10, left: 9 }, team: { used: 1, limit: 30, left: 29 } } }];
      }
      case 'publish': case 'hide': {
        const state = m === 'publish' ? 'PUBLIC' : 'HIDDEN';
        if (product) product.state = state;
        return [200, { ok: true, state, product: { id: body.productId, state, url: 'https://sample-shop.example/products/sample-product', images: IMAGES } }];
      }
      case 'product': {
        const row = LIST.find(p => p.productId === body.productId);
        const state = product?.id === body.productId ? product.state : row?.state || 'HIDDEN';
        return [200, { ok: true, product: { id: body.productId, productId: body.productId, state, url: row?.url || SHOP + 'sample-product', images: IMAGES, thumb: MOCK, refreshed: Boolean(body.refresh), collectionIds: memberOf[body.productId] || [] } }];
      }
      case 'archive': {
        if (body.confirm !== true) return [400, { ok: false, reason: 'confirm', error: 'Archiving is permanent. Confirm it first.' }];
        const row = LIST.find(p => p.productId === body.productId);
        if (!row) return [409, { ok: false, reason: 'not-ours', error: 'FrameUp only archives products it made. Archive this one in the Fourthwall dashboard.' }];
        if (body.confirmName != null && String(body.confirmName).trim().toLowerCase() !== String(row.title).trim().toLowerCase()) return [400, { ok: false, reason: 'confirm', error: 'The name you typed does not match the product. Type it exactly to archive.' }];
        if (row) row.state = 'ARCHIVED';
        if (product?.id === body.productId) product.state = 'ARCHIVED';
        return [200, { ok: true, product: { productId: body.productId, id: body.productId, title: row.title, state: 'archived' } }];
      }
      case 'list': return scenario === 'empty-list' ? [200, { ok: true, products: [], source: 'db' }] : [200, { ok: true, products: listNow(), source: scenario === 'no-db' ? 'fourthwall' : 'db' }];
      case 'collections': return [200, { ok: true, collections: COLLECTIONS.map(c => ({ ...c })) }];
      case 'collection-create': {
        const name = String(body.name || '').trim().slice(0, 60);
        if (name.length < 2) return [400, { ok: false, error: 'Give the collection a name.' }];
        const same = COLLECTIONS.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (same) return [200, { ok: true, collection: { ...same }, existed: true }];
        const collection = { id: 'col_' + name.toLowerCase().replace(/\W+/g, '-').slice(0, 24) + '_' + COLLECTIONS.length, name, count: 0 };
        COLLECTIONS.push(collection);
        return [200, { ok: true, collection }];
      }
      case 'collection-set': {
        const ids = (Array.isArray(body.collectionIds) ? body.collectionIds : []).filter(id => COLLECTIONS.some(c => c.id === id));
        memberOf[body.productId] = ids;
        return [200, { ok: true, collections: COLLECTIONS.map(c => ({ ...c, has: ids.includes(c.id) })), changed: ids }];
      }
      case 'sales': {
        const rows = LIST.filter(p => !body.productId || p.productId === body.productId).map(p => ({ productId: p.productId, units7: Math.round(p.units30 / 3), revenue7: Math.round(p.revenue30 / 3 * 100) / 100, units30: p.units30, revenue30: p.revenue30, unitsAll: p.units30 + 2, revenueAll: Math.round((p.revenue30 * 1.2) * 100) / 100 }));
        return [200, { ok: true, products: rows, updatedAt: new Date().toISOString(), source: 'db' }];
      }
      default: return [200, { ok: true }];
    }
  }
  // Sample stand-in for Supabase Storage (merch-art/<user>/<file>.png): records the path only.
  const stored = [];
  async function storageUpload(path, blob) { stored.push({ path, size: blob?.size || 0 }); return { path }; }
  root.MerchDemo = { BRAINSTORM_ME: ME, teammateAdds, TEMPLATES, CONCEPTS, PRO_CONCEPTS, MOMENTS, PLAN, TRENDS, COLLECTIONS, LIST, stored, storageUpload, reply };
}(typeof self !== 'undefined' ? self : this));
