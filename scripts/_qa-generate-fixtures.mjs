// Generate QA fixtures: 24 briefs across sports and story types, and a creative
// plan for each built by the real composer (_composer.js) with no AI and no
// network: a fake asset service hands it local SVG figures as ES photos and
// cut-outs (/__qa/photo/..., /__qa/cutout/..., drawn by figureSvg). Numbers in
// the briefs are sample facts for layout review only.
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, figureSvg } from './_qa-chrome.mjs';

const require = createRequire(import.meta.url);

export const BRIEFS = [
  { id: 'allen-1000', text: 'Josh Allen goes over 1000+ rushing yards as the Bills beat the Chiefs 30-21.\nSport: NFL' },
  { id: 'mahomes-stats', text: 'Patrick Mahomes threw for 312 yards and 4 touchdowns with a 118.6 passer rating as the Chiefs moved to 9-2.\nSport: NFL' },
  { id: 'burrow-409', text: 'Bengals rout Steelers 38-18 on Sunday Night Football and sit alone atop the AFC North at 7-2. Joe Burrow threw for 409 yards and 4 touchdowns.\nSport: NFL' },
  { id: 'kelce-record', text: 'Travis Kelce breaks the Chiefs record with 12,000 receiving yards, the most by a tight end in franchise history.\nSport: NFL' },
  { id: 'clark-30', text: 'Caitlin Clark scores 30 PTS 9 AST against the Sky. Clark: "I just love playing in front of this crowd."\nSport: WNBA' },
  { id: 'lebron-40k', text: 'LeBron James becomes the first player to reach 40,000 points as the Lakers beat the Nuggets 124-114.\nSport: NBA' },
  { id: 'curry-threes', text: 'Stephen Curry hits 12 threes in a 51-point night as the Warriors beat the Kings 132-120.\nSport: NBA' },
  { id: 'sga-mvp', text: 'Shai Gilgeous-Alexander averages 32.7 points as the Thunder go 68-14, the best record in the West.\nSport: NBA' },
  { id: 'judge-hr', text: 'Aaron Judge hits his 58th home run of the season as the Yankees clinch the AL East.\nSport: MLB' },
  { id: 'ohtani-50-50', text: 'Shohei Ohtani becomes the first player with 50 home runs and 50 stolen bases in one season.\nSport: MLB' },
  { id: 'scheffler-masters', text: 'Scottie Scheffler wins the Masters at -11, his 4th major title, by 4 shots.\nSport: Golf' },
  { id: 'bryson-europe', text: 'Bryson DeChambeau takes his game to Europe after a $4 million season on the LIV Golf tour.\nSport: Golf' },
  { id: 'alcaraz-slam', text: 'Carlos Alcaraz wins his 6th Grand Slam title at 22, beating Jannik Sinner 6-4, 7-6, 6-3.\nSport: Tennis' },
  { id: 'messi-goals', text: 'Lionel Messi scores twice to reach 850 career goals as Inter Miami win 3-1.\nSport: Soccer' },
  { id: 'verstappen-wins', text: 'Max Verstappen takes his 63rd Formula 1 win from pole in Brazil, 12 seconds clear.\nSport: F1' },
  { id: 'arch-preview', text: 'Arch Manning faces his biggest test yet as No. 3 Texas host No. 1 Georgia on Saturday.\nSport: CFB' },
  { id: 'prize-money', text: 'The LPGA Tour season ends with a $4 million prize for the CME Group Tour Championship winner.\nSport: Golf' },
  { id: 'quote-only', text: 'Steve Kerr on the Warriors\' slow start: "We have to be better, and it starts with me."\nSport: NBA' },
  { id: 'trade', text: 'The Lakers trade for Zach LaVine in a three-team deal with the Bulls and Hornets.\nSport: NBA' },
  { id: 'record-team', text: 'The Detroit Lions improve to 12-2, their best start in franchise history, after a 34-17 win over the Bears.\nSport: NFL' },
  { id: 'pct', text: 'Nikola Jokic shoots 72% from the field in a triple-double: 31 points, 14 rebounds and 11 assists.\nSport: NBA' },
  { id: 'short-number', text: 'Patrick Mahomes wins his 3rd Super Bowl MVP as the Chiefs beat the Eagles.\nSport: NFL' },
  { id: 'long-headline', text: 'In a wild double-overtime thriller that nobody in the building will ever forget, the Indiana Fever edge the Connecticut Sun 101-99 behind Aliyah Boston\'s 24 points.\nSport: WNBA' },
  { id: 'versus', text: 'Josh Allen has 41 total touchdowns while Lamar Jackson has 38 heading into the MVP vote.\nSport: NFL' },
];

const POSES = ['stand', 'bust', 'swing'];
const COLOURS = ['#1D428A', '#C8102E', '#00338D', '#552583', '#006241', '#E31837', '#0C2340', '#BF5700'];
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// /__qa/photo/<who>-<n>.svg and /__qa/cutout/<who>-<n>.svg: the same figure,
// the cut-out on a transparent background (so it registers on its photo).
export function qaFile(url) {
  const m = url.pathname.match(/^\/__qa\/(photo|cutout)\/([a-z0-9-]+)-(\d)\.svg$/);
  if (!m) return null;
  const [, kind, who, n] = m;
  const pose = POSES[(hash(who) + Number(n)) % POSES.length];
  const colour = COLOURS[hash(who) % COLOURS.length];
  return { type: 'image/svg+xml', body: figureSvg({ pose, colour, cutout: kind === 'cutout' }) };
}

const fakeAssets = {
  async findPhotos({ person = '', team = '' } = {}) {
    if (team || !person) return { photos: [], cutouts: [], headshots: [], logos: [] };
    const who = slug(person);
    const photos = [1, 2, 3].map(n => ({ url: `/__qa/photo/${who}-${n}.svg`, person, kind: n === 2 ? 'portrait' : 'action', score: 0.9 - n * 0.1, width: 900, height: 1200, source: 'es', rights: 'es-licensed' }));
    const cutouts = [1, 2].map(n => ({ url: `/__qa/cutout/${who}-${n}.svg`, fromPhoto: photos[n - 1].url, person, width: 900, height: 1200 }));
    return { photos, cutouts, headshots: [{ url: `/__qa/photo/${who}-2.svg`, person }], logos: [] };
  },
};

let composer = null;
// proxied: photos as production sends them (ES CDN URLs through the
// same-origin image proxy), so the page's own cut-out step runs on them.
const PROXY = /^\/__qa\/(photo|cutout)\/([a-z0-9-]+-\d)\.svg$/;
const toProxied = url => url.replace(PROXY, (m, kind, name) => `/api/es-image-search?image=${encodeURIComponent(`https://image-cdn.essentiallysports.com/qa/${kind}/${name}.jpg`)}`);
export function proxiedPlan(plan) {
  return JSON.parse(JSON.stringify(plan, (key, value) => (typeof value === 'string' && PROXY.test(value) && !/cutout/.test(value) ? toProxied(value) : value)));
}
// The proxy stub: /api/es-image-search?image=…/qa/photo/<name>.jpg -> the SVG figure.
export function qaProxyFile(url) {
  const m = String(url.searchParams.get('image') || '').match(/\/qa\/(photo|cutout)\/([a-z0-9-]+-\d)\.jpg$/);
  return m ? qaFile(new URL(`http://x/__qa/${m[1]}/${m[2]}.svg`)) : null;
}

export async function buildPlan(text, { want = 4 } = {}) {
  if (!composer) {
    composer = require(path.join(ROOT, 'netlify/functions/_composer.js'));
    composer.setAssetService(fakeAssets);
  }
  // No network while planning (the composer has no AI key here either way).
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('no network in QA fixtures'); };
  try {
    const plan = await composer.plan({ brief: text, found: { articles: [], digest: '', corpus: '' }, steer: {}, want, track: null, localFind: null, nameCandidates: null, lessons: [], cacheKey: `qa|${want}|${text}` });
    return { ...plan, runId: `qa-${hash(text)}`, research: { articles: [{ title: 'Sample ES story for this brief', url: 'https://www.essentiallysports.com/', date: '2026-11-20' }] }, notes: [] };
  } finally {
    globalThis.fetch = realFetch;
  }
}
