// Dashboard → Usage: the maths (no DOM, no network; tested by
// scripts/test-usage-tracking.mjs). frameup-usage-view.js loads the rows and
// draws them.
//
// Sources, newest first:
//   frameup_usage_events  everything taken (frameup-track.js), once the
//                         20261125120000 migration has run.
//   es_designer_tasks     editor exports (task_type 'exported_design').
//   frameup_events        export_done from Generate / Video Ads / Reels.
// The two older sources only count exports. They are used for the time before
// the first usage event, so nothing is counted twice.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FrameUpUsage = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const DAY = 86400000;

  const CATEGORY_LABELS = {
    export: 'Exports',
    download: 'Downloads',
    copy: 'Copies',
    share: 'Links shared',
    open: 'Opened in a tool',
    generate: 'Generated',
  };
  const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

  const TOOL_LABELS = {
    social: 'Social Media',
    youtube: 'YouTube',
    newsletter: 'Newsletter',
    generate: 'Generate',
    'video-ads': 'Video Ads',
    reels: 'Reel Captions',
    'reels-studio': 'Reels Studio',
    'image-pool': 'ES Image Pool',
    gallery: 'Gallery',
    trends: 'Trends',
    requests: 'Design Requests',
    home: 'Home',
    'design-system': 'UI Library',
    other: 'Other',
  };

  const ACTION_LABELS = {
    png: 'PNG', jpg: 'JPG', image: 'Image', zip: 'ZIP', mp4: 'MP4', webm: 'WebM', srt: 'Captions file',
    'image-link': 'Image link', 'photo-link': 'Photo link', photo: 'Photo', 'widget-html': 'Widget HTML',
    headline: 'Headline', text: 'Text', shortlist: 'Shortlist', token: 'Token',
    'open-in-editor': 'Open in editor', 'open-carousel': 'Open as carousel', 'make-another': 'Make another',
    'design-post': 'Design post', 'trend-post': 'Trend → post', 'trend-video': 'Trend → video ad', 'trend-reel': 'Trend → reel',
    'download-again': 'Download again', creative: 'Creative run', onbrand: 'Templates run', run: 'Run',
  };

  const WORKSPACE_TOOLS = {
    'social media': 'social', instagram: 'social', social: 'social',
    youtube: 'youtube', newsletter: 'newsletter', 'reel captions': 'reels', reels: 'reels',
  };
  const SOURCE_TOOLS = { generate: 'generate', 'video-ads': 'video-ads', reels: 'reels' };

  const lower = value => String(value == null ? '' : value).trim().toLowerCase();
  const toolLabel = key => TOOL_LABELS[key] || (key ? key.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Other');
  const categoryLabel = key => CATEGORY_LABELS[key] || key || 'Other';
  const actionLabel = key => ACTION_LABELS[key] || (key ? key.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase()) : '');
  const nameFromEmail = email => {
    const local = lower(email).split('@')[0] || '';
    return local ? local.split(/[._-]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ') : 'Someone';
  };

  // ── Rows in one shape ─────────────────────────────────────────────────────
  function fromEvent(row = {}) {
    const at = Date.parse(row.created_at);
    if (!Number.isFinite(at)) return null;
    const category = lower(row.category);
    if (!CATEGORY_LABELS[category]) return null;
    return {
      id: String(row.id || ''),
      at,
      email: lower(row.user_email),
      name: '',
      category,
      tool: lower(row.tool) || 'other',
      action: lower(row.action),
      label: String(row.label || ''),
      meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
      legacy: false,
    };
  }

  function fromTask(task = {}) {
    const at = Date.parse(task.meta_exported_at || task.created_at);
    if (!Number.isFinite(at)) return null;
    return {
      id: `task-${task.id}`,
      at,
      email: lower(task.creator_email),
      name: String(task.creator_name || ''),
      category: 'export',
      tool: WORKSPACE_TOOLS[lower(task.workspace)] || 'other',
      action: 'image',
      label: String(task.title || task.workspace_variant || ''),
      meta: { template: task.workspace_variant || '', from: task.meta_gen ? 'generate' : '' },
      legacy: true,
    };
  }

  function fromImpactEvent(event = {}) {
    if (event.event !== 'export_done' || !SOURCE_TOOLS[event.source]) return null;
    const at = Date.parse(event.created_at);
    if (!Number.isFinite(at)) return null;
    return {
      id: `evt-${event.id || `${event.source}-${at}`}`,
      at,
      email: lower(event.user_email),
      name: '',
      category: 'export',
      tool: SOURCE_TOOLS[event.source],
      action: event.source === 'generate' ? 'image' : 'mp4',
      label: String(event.meta?.template || ''),
      meta: { template: event.meta?.template || '' },
      legacy: true,
    };
  }

  // Usage events, plus older export rows from before the first usage event.
  // firstEventAt: the oldest usage event ever (the loaded range may start later).
  function combine({ events = [], tasks = [], impactEvents = [], firstEventAt = null } = {}) {
    const fresh = events.map(fromEvent).filter(Boolean);
    const first = Date.parse(firstEventAt);
    const cutoff = Number.isFinite(first) ? first : fresh.length ? Math.min(...fresh.map(row => row.at)) : Infinity;
    const legacy = [...tasks.map(fromTask), ...impactEvents.map(fromImpactEvent)]
      .filter(row => row && row.at < cutoff);
    const rows = [...fresh, ...legacy].sort((a, b) => b.at - a.at);
    return { rows, trackingSince: Number.isFinite(cutoff) ? cutoff : null, legacyCount: legacy.length };
  }

  // ── Filters ───────────────────────────────────────────────────────────────
  function rangeFor(days, now = Date.now()) {
    const n = Math.max(1, Number(days) || 30);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end.getTime() - n * DAY + 1);
    start.setHours(0, 0, 0, 0);
    return { from: start.getTime(), to: end.getTime(), days: n };
  }

  function applyFilters(rows = [], { tool = '', category = '', person = '', from = -Infinity, to = Infinity } = {}) {
    const who = lower(person);
    return rows.filter(row => row.at >= from && row.at <= to
      && (!tool || row.tool === tool)
      && (!category || row.category === category)
      && (!who || row.email === who));
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const dayKey = ms => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function countBy(rows, key) {
    const map = new Map();
    rows.forEach(row => map.set(row[key], (map.get(row[key]) || 0) + 1));
    return map;
  }

  function summarize(rows = [], { from, to, names = {}, recent = 40 } = {}) {
    const total = rows.length;
    const people = new Set(rows.map(row => row.email).filter(Boolean));

    const catCounts = countBy(rows, 'category');
    const byCategory = CATEGORY_ORDER.map(key => ({ key, label: categoryLabel(key), count: catCounts.get(key) || 0 }));

    const toolMap = new Map();
    rows.forEach(row => {
      const entry = toolMap.get(row.tool) || { key: row.tool, label: toolLabel(row.tool), count: 0, categories: {}, actions: {} };
      entry.count += 1;
      entry.categories[row.category] = (entry.categories[row.category] || 0) + 1;
      if (row.action) entry.actions[row.action] = (entry.actions[row.action] || 0) + 1;
      toolMap.set(row.tool, entry);
    });
    const byTool = [...toolMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    const personMap = new Map();
    rows.forEach(row => {
      if (!row.email) return;
      const entry = personMap.get(row.email) || { email: row.email, name: '', count: 0, tools: {}, categories: {}, lastAt: 0 };
      entry.count += 1;
      entry.tools[row.tool] = (entry.tools[row.tool] || 0) + 1;
      entry.categories[row.category] = (entry.categories[row.category] || 0) + 1;
      entry.lastAt = Math.max(entry.lastAt, row.at);
      if (!entry.name && row.name) entry.name = row.name;
      personMap.set(row.email, entry);
    });
    const topPeople = [...personMap.values()]
      .map(entry => {
        const topTool = Object.entries(entry.tools).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
        return { ...entry, name: names[entry.email] || entry.name || nameFromEmail(entry.email), topTool, topToolLabel: toolLabel(topTool) };
      })
      .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);

    // Every day in the range, oldest first, split by category.
    const series = [];
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
      const index = new Map();
      const cursor = new Date(from);
      cursor.setHours(0, 0, 0, 0);
      for (let guard = 0; cursor.getTime() <= to && guard < 400; guard += 1) {
        const key = dayKey(cursor.getTime());
        const bucket = { day: key, at: cursor.getTime(), total: 0, categories: {} };
        index.set(key, bucket);
        series.push(bucket);
        cursor.setDate(cursor.getDate() + 1);
      }
      rows.forEach(row => {
        const bucket = index.get(dayKey(row.at));
        if (!bucket) return;
        bucket.total += 1;
        bucket.categories[row.category] = (bucket.categories[row.category] || 0) + 1;
      });
    }

    const feed = rows.slice().sort((a, b) => b.at - a.at).slice(0, recent).map(row => ({
      ...row,
      name: names[row.email] || row.name || nameFromEmail(row.email),
      toolLabel: toolLabel(row.tool),
      categoryLabel: categoryLabel(row.category),
      actionLabel: actionLabel(row.action),
    }));

    return { total, people: people.size, byCategory, byTool, topPeople, series, recent: feed };
  }

  // Options for the filter menus, from what is in the data plus the known lists.
  function filterOptions(rows = [], names = {}) {
    const tools = new Set(rows.map(row => row.tool));
    const people = new Map();
    rows.forEach(row => { if (row.email && !people.has(row.email)) people.set(row.email, names[row.email] || row.name || nameFromEmail(row.email)); });
    return {
      tools: Object.keys(TOOL_LABELS).filter(key => tools.has(key) || key !== 'other').map(key => ({ key, label: toolLabel(key) })),
      categories: CATEGORY_ORDER.map(key => ({ key, label: categoryLabel(key) })),
      people: [...people.entries()].map(([email, name]) => ({ key: email, label: name })).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }

  return {
    CATEGORY_LABELS, CATEGORY_ORDER, TOOL_LABELS, ACTION_LABELS,
    toolLabel, categoryLabel, actionLabel, nameFromEmail,
    fromEvent, fromTask, fromImpactEvent, combine, rangeFor, applyFilters, summarize, filterOptions, dayKey,
  };
}));
