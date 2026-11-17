// AI usage summary for the Dashboard's "AI usage" panel (admins only).
// Pure functions over frameup_ai_usage rows; no network. Works in the browser
// (window.ESAIUsageSummary) and in Node tests (module.exports).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ESAIUsageSummary = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Monday 00:00 UTC on or before `now`: the week the caps count (same as the server).
  function weekStartUtc(now = new Date()) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    return start;
  }

  const num = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const isSonnet = model => /sonnet/i.test(String(model || ''));
  const isAnthropic = model => /^anthropic\//i.test(String(model || '')) || /claude/i.test(String(model || ''));
  // "generate-backup" counts under "generate".
  const baseFeature = feature => String(feature || 'other').replace(/-backup$/, '');

  function topBy(rows, keyOf, limit = 5) {
    const map = new Map();
    rows.forEach(row => {
      const key = keyOf(row) || 'unknown';
      const entry = map.get(key) || { key, cost: 0, calls: 0 };
      entry.cost += num(row.cost_usd);
      entry.calls += 1;
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost || b.calls - a.calls).slice(0, limit);
  }

  // rows: frameup_ai_usage rows for the week. exports: number of exports in the
  // same window. teamLimit / userLimit: the caps in USD (0 = off).
  function summarize(rows, { exports = 0, teamLimit = 0, userLimit = 0 } = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const total = list.reduce((sum, row) => sum + num(row.cost_usd), 0);
    const failed = list.filter(row => row.ok === false).length;
    const sonnet = list.filter(row => isSonnet(row.model)).reduce((sum, row) => sum + num(row.cost_usd), 0);
    // Prompt-cache hit rate on Claude calls: cached input / all input. Only rows
    // written after the measurement migration carry cache columns.
    const measuredRows = list.filter(row => isAnthropic(row.model) && row.cache_read_tokens != null);
    const cacheRead = measuredRows.reduce((sum, row) => sum + num(row.cache_read_tokens), 0);
    const cacheWrite = measuredRows.reduce((sum, row) => sum + num(row.cache_write_tokens), 0);
    const uncached = measuredRows.reduce((sum, row) => sum + num(row.input_tokens), 0);
    const promptTokens = cacheRead + cacheWrite + uncached;
    const runs = new Set(list.map(row => row.run_id).filter(Boolean));
    const runCost = list.filter(row => row.run_id).reduce((sum, row) => sum + num(row.cost_usd), 0);
    const allUsers = topBy(list, row => String(row.user_email || '').toLowerCase(), Infinity).map(user => ({
      ...user,
      shareOfCap: userLimit > 0 ? user.cost / userLimit : null,
    }));
    return {
      total,
      calls: list.length,
      failed,
      teamLimit,
      teamShare: teamLimit > 0 ? total / teamLimit : null,
      exports,
      costPerExport: exports > 0 ? total / exports : null,
      sonnetShare: total > 0 ? sonnet / total : null,
      cacheHitRate: measuredRows.length && promptTokens > 0 ? cacheRead / promptTokens : null,
      cacheMeasured: measuredRows.length > 0,
      costPerRun: runs.size ? runCost / runs.size : null,
      runs: runs.size,
      features: topBy(list, row => baseFeature(row.feature)),
      users: allUsers.slice(0, 5),
      models: topBy(list, row => String(row.model || '').replace(/^[a-z-]+\//, '')),
      usersNearCap: userLimit > 0 ? allUsers.filter(user => user.cost * 100 >= userLimit * 80 - 1e-9).length : 0,
    };
  }

  return { weekStartUtc, summarize, isSonnet, baseFeature };
}));
