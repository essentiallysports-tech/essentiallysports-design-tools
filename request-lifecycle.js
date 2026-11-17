// Design Request lifecycle: statuses, allowed moves and who may do what.
// One file for the browser (window.FrameUpRequestLifecycle), the serverless
// functions (require) and the tests. The database enforces the same rules in
// frameup_request_update() (supabase/migrations/20261118120030_request_workflow.sql);
// keep the two in step.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpRequestLifecycle = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Stored values (es_designer_tasks.status). The Dashboard kanban already uses
  // the first five; Declined is new with the request workflow migration.
  const STATUSES = Object.freeze(['Backlog', 'Assigned', 'Doing', 'Review', 'Done', 'Declined']);
  const OPEN_STATUSES = Object.freeze(['Backlog', 'Assigned', 'Doing', 'Review']);

  // What people see. "New" covers Backlog; Assigned is still waiting to start.
  const STATUS_LABELS = Object.freeze({
    Backlog: 'New',
    Assigned: 'Assigned',
    Doing: 'In progress',
    Review: 'In review',
    Done: 'Done',
    Declined: 'Declined',
  });

  // The four steps a requester sees on the timeline.
  const STEPS = Object.freeze([
    { key: 'new', label: 'New', statuses: ['Backlog', 'Assigned'] },
    { key: 'doing', label: 'In progress', statuses: ['Doing'] },
    { key: 'review', label: 'In review', statuses: ['Review'] },
    { key: 'done', label: 'Done', statuses: ['Done'] },
  ]);

  // Designers move one step at a time (or back one). Admins may jump anywhere.
  const TRANSITIONS = Object.freeze({
    Backlog: ['Assigned', 'Doing', 'Declined'],
    Assigned: ['Backlog', 'Doing', 'Declined'],
    Doing: ['Review', 'Assigned', 'Declined'],
    Review: ['Done', 'Doing', 'Declined'],
    Done: ['Doing'],
    Declined: ['Backlog'],
  });

  const PRIORITIES = Object.freeze(['Normal', 'High', 'Urgent']);

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeStatus(value, fallback = 'Backlog') {
    const raw = String(value || '').trim();
    const key = raw.toLowerCase();
    if (!key) return fallback;
    if (key === 'new' || key === 'backlog' || key === 'exported') return 'Backlog';
    if (key === 'assigned') return 'Assigned';
    if (key === 'in progress' || key === 'doing' || key === 'in-progress') return 'Doing';
    if (key === 'in review' || key === 'review' || key === 'needs review') return 'Review';
    if (key === 'done' || key === 'complete' || key === 'completed' || key === 'delivered') return 'Done';
    if (key === 'declined' || key === 'rejected' || key === 'withdrawn' || key === 'cancelled' || key === 'canceled') return 'Declined';
    return STATUSES.includes(raw) ? raw : fallback;
  }

  function statusLabel(value) {
    return STATUS_LABELS[normalizeStatus(value)] || 'New';
  }

  function isOpen(status) {
    return OPEN_STATUSES.includes(normalizeStatus(status));
  }

  function stepIndex(status) {
    const normalized = normalizeStatus(status);
    return STEPS.findIndex(step => step.statuses.includes(normalized));
  }

  function normalizePriority(value) {
    const raw = String(value || '').trim().toLowerCase();
    return PRIORITIES.find(priority => priority.toLowerCase() === raw) || 'Normal';
  }

  // role: 'admin' | 'designer' | 'requester'. A designer who also filed the
  // request is still a designer for it.
  function roleFor(user = {}) {
    if (user.isAdmin) return 'admin';
    if (user.isDesigner) return 'designer';
    return 'requester';
  }

  function isRequester(request = {}, user = {}) {
    const email = normalizeEmail(user.email);
    if (!email) return false;
    return [request.requesterEmail, request.creatorEmail, request.requester_email, request.creator_email]
      .map(normalizeEmail)
      .includes(email);
  }

  function assigneeOf(request = {}) {
    return normalizeEmail(request.assignedTo ?? request.assigned_to);
  }

  function canView(request = {}, user = {}) {
    const role = roleFor(user);
    if (role === 'admin' || role === 'designer') return true;
    return isRequester(request, user);
  }

  // Returns { ok, reason } for a status move.
  function checkStatusChange(request = {}, user = {}, nextStatus) {
    const from = normalizeStatus(request.status);
    const to = normalizeStatus(nextStatus, '');
    if (!to) return { ok: false, reason: 'Unknown status.' };
    if (from === to) return { ok: false, reason: 'The request is already in that status.' };
    const role = roleFor(user);
    if (role === 'admin') return { ok: true };
    if (role === 'designer') {
      const assignee = assigneeOf(request);
      const me = normalizeEmail(user.email);
      if (!assignee) return { ok: false, reason: 'Assign the request to yourself first.' };
      if (assignee !== me) return { ok: false, reason: 'Only the assigned designer or an admin can move this request.' };
      if (!(TRANSITIONS[from] || []).includes(to)) {
        return { ok: false, reason: `A request can’t go from ${statusLabel(from)} to ${statusLabel(to)}.` };
      }
      return { ok: true };
    }
    // Requesters can withdraw their own request before work starts.
    if (isRequester(request, user) && to === 'Declined' && (from === 'Backlog' || from === 'Assigned')) {
      return { ok: true, withdraw: true };
    }
    return { ok: false, reason: 'Only the design team can change the status.' };
  }

  function allowedStatuses(request = {}, user = {}) {
    return STATUSES.filter(status => checkStatusChange(request, user, status).ok);
  }

  // Admins assign anyone (or nobody). Designers can claim an unassigned
  // request or hand back their own.
  function checkAssign(request = {}, user = {}, nextAssignee) {
    const role = roleFor(user);
    const target = normalizeEmail(nextAssignee);
    const current = assigneeOf(request);
    const me = normalizeEmail(user.email);
    if (target === current) return { ok: false, reason: 'No change.' };
    if (role === 'admin') return { ok: true };
    if (role === 'designer') {
      if (!current && target === me) return { ok: true };
      if (current === me && !target) return { ok: true };
      return { ok: false, reason: 'Designers can take unassigned requests or hand back their own. Ask an admin to reassign.' };
    }
    return { ok: false, reason: 'Only the design team can assign requests.' };
  }

  // Due date, priority and delivered designs.
  function canEditPlan(request = {}, user = {}) {
    const role = roleFor(user);
    if (role === 'admin') return true;
    return role === 'designer' && assigneeOf(request) === normalizeEmail(user.email);
  }

  function canComment(request = {}, user = {}) {
    return canView(request, user);
  }

  // The design team's "queue": open requests assigned to me, plus unassigned
  // ones for admins (they hand them out).
  function inQueue(request = {}, user = {}) {
    if (!isOpen(request.status)) return false;
    const role = roleFor(user);
    if (role === 'requester') return false;
    const assignee = assigneeOf(request);
    if (assignee === normalizeEmail(user.email)) return true;
    return role === 'admin' && !assignee;
  }

  // The sidebar badge: what needs this person's attention.
  function openCount(requests = [], user = {}) {
    return requests.filter(request => isOpen(request.status)
      && (inQueue(request, user) || (roleFor(user) === 'requester' && isRequester(request, user)))).length;
  }

  function dueState(request = {}, now = Date.now()) {
    const due = Date.parse(request.designDueAt || request.design_due_at || '');
    if (!Number.isFinite(due) || !isOpen(request.status)) return 'none';
    if (due < now) return 'overdue';
    if (due - now < 24 * 3600 * 1000) return 'soon';
    return 'later';
  }

  // Request IDs: DR-YYYYMMDD-XXXX. The random tail keeps two browsers that
  // file on the same day from colliding (the old per-browser counter could).
  const ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  function makeRequestId(date = new Date(), random = Math.random) {
    const day = date.toISOString().slice(0, 10).replace(/-/g, '');
    let tail = '';
    for (let i = 0; i < 4; i += 1) tail += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length) % ID_ALPHABET.length];
    return `DR-${day}-${tail}`;
  }

  function isRequestId(value) {
    return /^DR-\d{8}-[0-9A-Z]{3,6}$/.test(String(value || ''));
  }

  // Dashboard task ids wrap the request id.
  function taskIdFor(requestId) {
    return `task-request-${requestId}`;
  }

  return Object.freeze({
    STATUSES,
    OPEN_STATUSES,
    STATUS_LABELS,
    STEPS,
    TRANSITIONS,
    PRIORITIES,
    normalizeEmail,
    normalizeStatus,
    normalizePriority,
    statusLabel,
    isOpen,
    stepIndex,
    roleFor,
    isRequester,
    canView,
    checkStatusChange,
    allowedStatuses,
    checkAssign,
    canEditPlan,
    canComment,
    inQueue,
    openCount,
    dueState,
    makeRequestId,
    isRequestId,
    taskIdFor,
  });
}));
