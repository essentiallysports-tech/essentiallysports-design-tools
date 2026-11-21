// Dashboard → Newsletter: the maths (no DOM, no network; tested by
// scripts/test-dashboard-newsletter.mjs). frameup-newsletter-view.js reads the
// rows through dashboard-data.js and draws them.
//
// Sources:
//   es_designer_tasks     image exports from the Newsletter workspace
//                         (workspace 'Newsletter', task_type 'exported_design').
//                         Since 2026-11-21 their metadata also carries
//                         newsletterAsset / newsletterAssetLabel /
//                         newsletterBrand / newsletterBrandLabel / format.
//                         Older rows: the asset comes from workspace_variant
//                         (the asset label) and the brand from team_or_league
//                         when it is a known newsletter id.
//   frameup_usage_events  tool 'newsletter', category copy / share: copied
//                         widget HTML (Trivia, Ticker, lists, Desktop News
//                         Layout) and image links. Usage 'export' rows are the
//                         same exports as the task rows, so they are skipped.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FrameUpNewsletterStats = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const DAY = 86400000;
  const WORKSPACE = 'newsletter';

  // index.html NEWSLETTER_ASSET_TYPES (id -> label). The test keeps them in step.
  const ASSETS = {
    'feature-image': 'Feature Image',
    'section-header': 'Section Header (Left)',
    'section-header-2': 'Section Header (Centred)',
    'youtube-fi': 'Video FI (Play Button)',
    'tag-fi': 'Tag FI (Corner Label)',
    'archive-page-fi': 'Archive Page FI',
    widgets: 'Desktop News Layout',
    trivia: 'Trivia',
    list2: 'Headline List (Simple)',
    list: 'Headline List (Big Numbers)',
    ticker: 'Financial Ticker',
  };
  // Older or alternative labels seen on rows.
  const ASSET_ALIASES = {
    'header option 1': 'section-header',
    'header option 2': 'section-header-2',
    'section header': 'section-header',
    'video fi': 'youtube-fi',
    'tag fi': 'tag-fi',
    widget: 'widgets',
    'widget html': 'widgets',
  };

  // index.html NEWSLETTER_BRANDS (id -> label; TICKER_BRANDS and TRIVIA_BRANDS
  // reuse these ids). The test keeps them in step.
  const BRANDS = {
    essentiallysports: 'EssentiallySports',
    'es-daily-evening-send': 'ES Daily Evening Send',
    'es-daily-morning': 'ES Daily Morning',
    'es-daily-new': 'ES Daily New',
    'essentially-cfb': 'Essentially CFB',
    'essentially-dunk': 'Essentially Dunk',
    'essentially-golf': 'Essentially Golf',
    'es-golf-evening': 'ES Golf Evening',
    'inside-talks': 'Inside Talks',
    'lucky-dog-on-track': 'Lucky Dog On Track',
    'she-got-game': 'Essentially W',
    'essentially-w-ncaa': 'Essentially W NCAA',
    'break-point': 'Break Point',
    'buckeye-daily': 'Buckeye Daily',
    'steelers-huddle': 'Steelers Huddle',
    'chiefs-huddle': 'Chiefs Huddle',
    'cowboys-huddle': 'Cowboys Huddle',
    'essentially-mma': 'Essentially MMA',
    'essentially-athletics': 'Essentially Athletics',
    'the-huddle': 'The Huddle',
    'es-think-tank': 'ES Think Tank',
  };

  const KINDS = { image: 'Image', html: 'HTML', link: 'Image link' };

  const lower = value => String(value == null ? '' : value).trim().toLowerCase();
  const clean = value => String(value == null ? '' : value).trim();
  const nameFromEmail = email => {
    const local = lower(email).split('@')[0] || '';
    return local ? local.split(/[._-]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ') : 'Someone';
  };

  const LABEL_TO_ASSET = Object.fromEntries(Object.entries(ASSETS).map(([id, label]) => [label.toLowerCase(), id]));
  function assetId(value) {
    const key = lower(value);
    if (!key) return '';
    if (ASSETS[key]) return key;
    return LABEL_TO_ASSET[key] || ASSET_ALIASES[key] || '';
  }
  const assetLabel = (id, fallback = '') => ASSETS[id] || clean(fallback) || 'Other';
  const brandLabel = (id, fallback = '') => clean(fallback) || BRANDS[id] || (id ? id.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()) : '');

  const normSize = value => {
    const match = /(\d+)\s*[x×]\s*(\d+)/i.exec(String(value || ''));
    return match ? `${match[1]} × ${match[2]}` : '';
  };
  function formatFrom(mime = '', filename = '', fallback = '') {
    const explicit = clean(fallback).toUpperCase();
    if (explicit) return explicit === 'JPG' ? 'JPEG' : explicit;
    const m = lower(mime);
    if (m.includes('png')) return 'PNG';
    if (m.includes('jpeg') || m.includes('jpg')) return 'JPEG';
    if (m.includes('webp')) return 'WebP';
    const ext = /\.([a-z0-9]+)$/i.exec(String(filename || ''))?.[1]?.toLowerCase();
    return ext === 'png' ? 'PNG' : ext === 'jpg' || ext === 'jpeg' ? 'JPEG' : ext === 'webp' ? 'WebP' : '';
  }

  // ── Rows in one shape ─────────────────────────────────────────────────────
  const isNewsletterTask = task => task && (task.type === 'exported_design' || task.task_type === 'exported_design')
    && (lower(task.workspace) === WORKSPACE || lower(task.metadata?.workspaceId) === WORKSPACE);

  // A dashboard-data.js task (normalizeTask shape).
  function fromTask(task = {}) {
    if (!isNewsletterTask(task)) return null;
    const meta = task.metadata && typeof task.metadata === 'object' ? task.metadata : {};
    const at = Date.parse(meta.exportedAt || task.createdAt || task.created_at);
    if (!Number.isFinite(at)) return null;
    const recordedAsset = assetId(meta.newsletterAsset);
    const asset = recordedAsset || assetId(task.workspaceVariant) || 'other';
    const teamBrand = BRANDS[lower(task.teamOrLeague)] ? lower(task.teamOrLeague) : '';
    const brand = lower(meta.newsletterBrand) || teamBrand;
    return {
      id: String(task.id || ''),
      taskId: String(task.id || ''),
      at,
      email: lower(task.creatorEmail || task.creator_email),
      name: clean(task.creatorName || task.creator_name),
      kind: 'image',
      asset,
      assetLabel: assetLabel(asset, meta.newsletterAssetLabel || task.workspaceVariant),
      brand,
      brandLabel: brand ? brandLabel(brand, meta.newsletterBrandLabel) : '',
      brandRecorded: Boolean(brand),
      title: clean(task.title) || clean(task.filename) || 'Untitled export',
      filename: clean(task.filename),
      size: normSize(meta.outputSize || (meta.imageWidth && meta.imageHeight ? `${meta.imageWidth}x${meta.imageHeight}` : '')),
      format: formatFrom(meta.mimeType, task.filename, meta.format),
      hasPreview: Boolean(task.previewDataUrl || meta.previewPath || meta.previewDataUrl),
      detailed: Boolean(recordedAsset),
    };
  }

  // A frameup_usage_events row.
  function fromEvent(row = {}) {
    if (lower(row.tool) !== WORKSPACE) return null;
    const category = lower(row.category);
    const action = lower(row.action);
    const kind = category === 'copy' ? 'html' : category === 'share' ? 'link' : '';
    if (!kind) return null;
    const at = Date.parse(row.created_at);
    if (!Number.isFinite(at)) return null;
    const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
    // Widget copies used to log the asset id as the label.
    const recordedAsset = assetId(meta.asset);
    const asset = recordedAsset || (action === 'widget-html' ? assetId(row.label) : '') || (action === 'widget-html' ? 'widgets' : 'other');
    const brand = lower(meta.brand);
    return {
      id: `evt-${row.id || at}`,
      taskId: '',
      at,
      email: lower(row.user_email),
      name: '',
      kind,
      asset,
      assetLabel: assetLabel(asset, meta.template),
      brand,
      brandLabel: brand ? brandLabel(brand, meta.brandLabel) : '',
      brandRecorded: Boolean(brand),
      title: kind === 'html' ? `${assetLabel(asset, meta.template)} HTML` : clean(row.label) || 'Image link',
      filename: '',
      size: normSize(meta.size),
      format: kind === 'html' ? 'HTML' : formatFrom('', row.label, meta.format) || 'Link',
      hasPreview: false,
      detailed: Boolean(recordedAsset),
    };
  }

  function combine({ tasks = [], events = [], names = {} } = {}) {
    const rows = [...tasks.map(fromTask), ...events.map(fromEvent)].filter(Boolean);
    rows.forEach(row => { row.name = names[row.email] || row.name || nameFromEmail(row.email); });
    return rows.sort((a, b) => b.at - a.at);
  }

  // ── Time windows ──────────────────────────────────────────────────────────
  // Rolling days including today (local time), like the other dashboard tabs.
  function rangeFor(days, now = Date.now()) {
    const n = Math.max(1, Number(days) || 30);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - (n - 1));
    start.setHours(0, 0, 0, 0);
    return { from: start.getTime(), to: end.getTime(), days: n };
  }
  // This week: Monday 00:00 local to now.
  function weekStart(now = Date.now()) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  }

  // ── Filters ───────────────────────────────────────────────────────────────
  function matchesSearch(row, query) {
    const q = lower(query);
    if (!q) return true;
    return [row.title, row.filename, row.name, row.email, row.assetLabel, row.brandLabel, row.size, row.format, KINDS[row.kind]]
      .some(value => lower(value).includes(q));
  }

  function applyFilters(rows = [], { person = '', asset = '', brand = '', search = '', from = -Infinity, to = Infinity } = {}) {
    const who = lower(person);
    return rows.filter(row => row.at >= from && row.at <= to
      && (!who || row.email === who)
      && (!asset || row.asset === asset)
      && (!brand || (brand === '__none' ? !row.brandRecorded : row.brand === brand))
      && matchesSearch(row, search));
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const dayKey = ms => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function tally(rows, keyOf, labelOf) {
    const map = new Map();
    rows.forEach(row => {
      const key = keyOf(row);
      if (!key) return;
      const entry = map.get(key) || { key, label: labelOf(row), count: 0, lastAt: 0 };
      entry.count += 1;
      entry.lastAt = Math.max(entry.lastAt, row.at);
      map.set(key, entry);
    });
    return [...map.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt || a.label.localeCompare(b.label));
  }

  // Daily buckets from..to (oldest first); weekly (7-day buckets ending on the
  // last day) when the range is longer than 30 days, like "Exports over time".
  function series(rows = [], from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return { weekly: false, buckets: [] };
    const days = [];
    const index = new Map();
    const cursor = new Date(from);
    cursor.setHours(0, 0, 0, 0);
    for (let guard = 0; cursor.getTime() <= to && guard < 400; guard += 1) {
      const bucket = { key: dayKey(cursor.getTime()), at: cursor.getTime(), count: 0 };
      index.set(bucket.key, bucket);
      days.push(bucket);
      cursor.setDate(cursor.getDate() + 1);
    }
    rows.forEach(row => { const b = index.get(dayKey(row.at)); if (b) b.count += 1; });
    if (days.length <= 30) return { weekly: false, buckets: days };
    const weeks = [];
    for (let end = days.length; end > 0; end -= 7) {
      const slice = days.slice(Math.max(0, end - 7), end);
      weeks.unshift({ key: slice[0].key, at: slice[0].at, count: slice.reduce((sum, b) => sum + b.count, 0), weekly: true });
    }
    return { weekly: true, buckets: weeks };
  }

  // rows: already filtered by person / asset / brand / search (not by date).
  function summarize(rows = [], { days = 30, now = Date.now() } = {}) {
    const count = since => rows.filter(row => row.at >= since).length;
    const range = rangeFor(days, now);
    const inRange = rows.filter(row => row.at >= range.from && row.at <= range.to);
    const byAsset = tally(inRange, row => row.asset, row => row.assetLabel);
    const byPerson = tally(inRange, row => row.email, row => row.name);
    const byBrand = tally(inRange.filter(row => row.brandRecorded), row => row.brand, row => row.brandLabel);
    const byKind = tally(inRange, row => row.kind, row => KINDS[row.kind] || row.kind);
    const brandMissing = inRange.filter(row => !row.brandRecorded).length;
    return {
      thisWeek: count(weekStart(now)),
      last7: count(rangeFor(7, now).from),
      last30: count(rangeFor(30, now).from),
      last90: count(rangeFor(90, now).from),
      range,
      total: inRange.length,
      people: byPerson.length,
      topAsset: byAsset[0] || null,
      topPerson: byPerson[0] || null,
      byAsset,
      byPerson,
      byBrand,
      byKind,
      brandMissing,
      series: series(inRange, range.from, range.to),
    };
  }

  // Filter menus: what is in the rows, plus every known asset.
  function filterOptions(rows = []) {
    const people = new Map();
    rows.forEach(row => { if (row.email && !people.has(row.email)) people.set(row.email, row.name); });
    const seenAssets = new Set(rows.map(row => row.asset));
    const brands = new Map();
    rows.forEach(row => { if (row.brandRecorded && !brands.has(row.brand)) brands.set(row.brand, row.brandLabel); });
    return {
      people: [...people.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
      assets: [...Object.keys(ASSETS), ...(seenAssets.has('other') ? ['other'] : [])].map(key => ({ key, label: assetLabel(key) })),
      brands: [...brands.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }

  return {
    ASSETS, BRANDS, KINDS,
    assetId, assetLabel, brandLabel, nameFromEmail, normSize, formatFrom,
    isNewsletterTask, fromTask, fromEvent, combine,
    rangeFor, weekStart, applyFilters, matchesSearch, series, summarize, filterOptions, dayKey,
  };
}));
