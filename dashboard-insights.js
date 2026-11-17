// Dashboard "Needs attention": the few things an admin should act on now,
// worked out from data the dashboard already loaded (no extra requests, no
// AI). Every number comes straight from those rows; nothing is estimated.
// One file for the page (window.FrameUpDashboardInsights) and the tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpDashboardInsights = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;
  const CLOSED = ['Done', 'Declined'];
  const TONE_ORDER = { bad: 0, warn: 1, info: 2, good: 3 };

  const time = value => {
    const t = Date.parse(value || '');
    return Number.isFinite(t) ? t : NaN;
  };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const ago = (ms) => {
    const days = Math.floor(ms / DAY);
    if (days >= 1) return plural(days, 'day');
    return plural(Math.max(1, Math.floor(ms / HOUR)), 'hour');
  };
  const listNames = (names, max = 3) => {
    const shown = names.slice(0, max);
    const rest = names.length - shown.length;
    return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ').replace(/, ([^,]*)$/, ' and $1');
  };

  // input:
  //   tasks:          dashboard tasks (design_request + exported_design rows)
  //   accessRequests: [{ status }]
  //   feedback:       [{ feedbackType, createdAt }]
  //   errorRows:      frameup_client_errors rows from the last 7 days, or null (not loaded)
  //   rangeDays:      the overview range (1, 7, 30, 90)
  //   exportTime(task), creatorName(task): the page's own helpers
  function computeInsights(input = {}, { now = Date.now(), limit = 5 } = {}) {
    const tasks = Array.isArray(input.tasks) ? input.tasks : [];
    const exportTime = input.exportTime || (task => time(task.createdAt));
    const creatorName = input.creatorName || (task => task.creatorName || task.creatorEmail || '');
    const rangeDays = Math.max(1, Number(input.rangeDays) || 7);
    const out = [];

    // Requests
    const requests = tasks.filter(task => task.type === 'design_request' && !CLOSED.includes(task.status));
    const overdue = requests.filter(task => time(task.designDueAt) < now)
      .sort((a, b) => time(a.designDueAt) - time(b.designDueAt));
    if (overdue.length) {
      const oldest = overdue[0];
      out.push({
        id: 'overdue', tone: 'bad',
        title: `${plural(overdue.length, 'request')} ${overdue.length === 1 ? 'is' : 'are'} overdue`,
        detail: `Oldest: “${String(oldest.title || 'Untitled request').slice(0, 60)}”, due ${ago(now - time(oldest.designDueAt))} ago.`,
        action: { label: 'Open the board', view: 'board' },
      });
    }
    const unassigned = requests.filter(task => !String(task.assignedTo || '').trim());
    if (unassigned.length) {
      out.push({
        id: 'unassigned', tone: 'warn',
        title: `${plural(unassigned.length, 'request')} ${unassigned.length === 1 ? 'has' : 'have'} no designer`,
        detail: unassigned.length === 1 ? 'Assign it so the requester knows who has it.' : 'Assign them so each requester knows who has it.',
        action: { label: 'Assign', view: 'board' },
      });
    }
    const dueSoon = requests.filter(task => {
      const due = time(task.designDueAt);
      return due >= now && due - now < DAY;
    });
    if (dueSoon.length) {
      out.push({
        id: 'due-soon', tone: 'info',
        title: `${plural(dueSoon.length, 'request')} due in the next 24 hours`,
        detail: listNames(dueSoon.map(task => `“${String(task.title || 'Untitled').slice(0, 40)}”`), 2),
        action: { label: 'See the list', view: 'list' },
      });
    }
    const stuckReview = requests.filter(task => task.status === 'Review'
      && now - time(task.statusChangedAt || task.updatedAt) > 2 * DAY);
    if (stuckReview.length) {
      out.push({
        id: 'stuck-review', tone: 'info',
        title: `${plural(stuckReview.length, 'request')} waiting in review for 2+ days`,
        detail: stuckReview.length === 1 ? 'Nudge the requester, or mark it done.' : 'Nudge the requesters, or mark them done.',
        action: { label: 'Open the board', view: 'board' },
      });
    }

    // Access
    const pending = (input.accessRequests || []).filter(request => (request.status || 'Pending') === 'Pending');
    if (pending.length) {
      out.push({
        id: 'access', tone: 'warn',
        title: `${plural(pending.length, 'person', 'people')} waiting for access`,
        detail: 'They can’t use FrameUp until you approve them.',
        action: { label: 'Review access', view: 'access' },
      });
    }

    // Bugs reported this week
    const bugs = (input.feedback || []).filter(item => item.feedbackType === 'Bug' && now - time(item.createdAt) < 7 * DAY);
    if (bugs.length) {
      out.push({
        id: 'bugs', tone: bugs.length >= 3 ? 'warn' : 'info',
        title: `${plural(bugs.length, 'bug report')} in the last 7 days`,
        detail: 'From the Tool Feedback page.',
        action: { label: 'Read them', view: 'feedback' },
      });
    }

    // Browser errors in the last 24 hours
    if (Array.isArray(input.errorRows)) {
      const recent = input.errorRows.filter(row => now - time(row.created_at) < DAY);
      const count = recent.reduce((sum, row) => sum + Math.max(1, Number(row.occurrences) || 1), 0);
      const people = new Set(recent.map(row => String(row.user_email || '').toLowerCase()).filter(Boolean)).size;
      if (count >= 5 || people >= 2) {
        out.push({
          id: 'errors', tone: people >= 3 ? 'bad' : 'warn',
          title: `${plural(count, 'error')} in the last 24 hours`,
          detail: people ? `${plural(people, 'person', 'people')} hit one.` : 'In signed-out or unknown sessions.',
          action: { label: 'See errors', anchor: 'dov-errors-title' },
        });
      }
    }

    // Exports: this range against the one before (only with enough volume to mean something)
    const exportsList = tasks.filter(task => task.type === 'exported_design');
    const span = rangeDays * DAY;
    const inWindow = (from, to) => exportsList.filter(task => {
      const t = exportTime(task);
      return t >= from && t < to;
    });
    const current = inWindow(now - span, now + 1);
    const previous = inWindow(now - 2 * span, now - span);
    if (previous.length >= 5) {
      const change = Math.round(((current.length - previous.length) / previous.length) * 100);
      const label = rangeDays === 1 ? '24 hours' : `${rangeDays} days`;
      if (change <= -30) {
        out.push({
          id: 'exports-down', tone: 'info',
          title: `Exports down ${Math.abs(change)}% on the previous ${label}`,
          detail: `${current.length} now, ${previous.length} before.`,
          action: { label: 'See exports', view: 'designs' },
        });
      } else if (change >= 30) {
        out.push({
          id: 'exports-up', tone: 'good',
          title: `Exports up ${change}% on the previous ${label}`,
          detail: `${current.length} now, ${previous.length} before.`,
          action: { label: 'See exports', view: 'designs' },
        });
      }
    }

    // Regulars who went quiet: 3+ exports in the 14 days before this week, none this week.
    const weekAgo = now - 7 * DAY;
    const before = new Map();
    const thisWeek = new Set();
    exportsList.forEach(task => {
      const t = exportTime(task);
      const name = String(creatorName(task) || '').trim();
      if (!name || !Number.isFinite(t)) return;
      if (t >= weekAgo) thisWeek.add(name);
      else if (t >= weekAgo - 14 * DAY) before.set(name, (before.get(name) || 0) + 1);
    });
    const quiet = [...before.entries()].filter(([name, n]) => n >= 3 && !thisWeek.has(name)).map(([name]) => name).sort();
    if (quiet.length) {
      out.push({
        id: 'quiet', tone: 'info',
        title: `${plural(quiet.length, 'regular')} ${quiet.length === 1 ? 'hasn’t' : 'haven’t'} exported this week`,
        detail: listNames(quiet),
        action: { label: 'See people', view: 'people' },
      });
    }

    const sorted = out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
    const needsAction = sorted.filter(item => item.tone === 'bad' || item.tone === 'warn').length;
    if (!needsAction) {
      sorted.unshift({ id: 'clear', tone: 'good', title: 'Nothing urgent', detail: 'No overdue or unassigned requests, and nobody waiting for access.', action: null });
    }
    return { items: sorted.slice(0, limit), total: sorted.length, needsAction };
  }

  return Object.freeze({ computeInsights });
}));
