// My requests page (requests.html): requesters follow their requests,
// designers work their queue, admins assign. Data: design-requests.js;
// rules: request-lifecycle.js (the database enforces the same ones).
(function () {
  'use strict';

  const L = window.FrameUpRequestLifecycle;
  const API = window.FrameUpRequests;
  const $ = id => document.getElementById(id);

  const state = {
    ctx: null,
    requests: [],
    designers: [],
    view: 'mine',
    filter: 'open',
    query: '',
    selectedId: '',
    detailToken: 0,
  };

  const ICON = {
    created: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    status: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/><path d="M21 3v6h-6"/>',
    assign: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    due: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    priority: '<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
    delivery: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  };
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function personName(email, fallbackName = '') {
    const clean = L.normalizeEmail(email);
    if (fallbackName) return fallbackName;
    if (!clean) return '';
    if (clean === state.ctx?.email) return 'You';
    const designer = state.designers.find(item => item.email === clean);
    if (designer?.name) return designer.name;
    return clean.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  }

  function formatDate(value, { time = true } = {}) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, time
      ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function localInputValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function user() {
    const ctx = state.ctx || {};
    return { email: ctx.email, isAdmin: ctx.isAdmin, isDesigner: ctx.isDesigner };
  }

  function isStaff() {
    return Boolean(state.ctx?.isDesigner || state.ctx?.isAdmin);
  }

  function toast(message) {
    const node = $('rq-toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 4200);
  }

  function slackNote(slack) {
    if (!slack) return '';
    if (slack.posted && slack.threaded) return ' Posted to the Slack thread.';
    if (slack.posted) return ' Posted to Slack.';
    return '';
  }

  // ── Views and filters ─────────────────────────────────────────────────────
  function inView(request, view) {
    const me = state.ctx?.email;
    if (view === 'mine') return L.isRequester(request, user());
    if (view === 'queue') return request.assignedTo === me || (state.ctx?.isAdmin && !request.assignedTo && L.isOpen(request.status));
    return isStaff();
  }

  function matchesFilter(request) {
    const filter = state.filter;
    if (filter === 'open') return L.isOpen(request.status);
    if (filter === 'overdue') return L.dueState(request) === 'overdue';
    if (filter === 'all') return true;
    return request.status === filter;
  }

  function matchesQuery(request) {
    const query = state.query.trim().toLowerCase();
    if (!query) return true;
    return [request.title, request.requestId, request.requesterName, request.requesterEmail, request.assignedTo, request.brief, request.publication, request.channel]
      .join(' ').toLowerCase().includes(query);
  }

  function visibleRequests() {
    return state.requests
      .filter(request => inView(request, state.view) && matchesFilter(request) && matchesQuery(request))
      .sort((a, b) => {
        // Overdue and soonest-due first while open; newest first otherwise.
        if (state.filter === 'open' || state.filter === 'overdue') {
          const ad = Date.parse(a.designDueAt) || Number.MAX_SAFE_INTEGER;
          const bd = Date.parse(b.designDueAt) || Number.MAX_SAFE_INTEGER;
          if (ad !== bd) return ad - bd;
        }
        return String(b.updatedAt).localeCompare(String(a.updatedAt));
      });
  }

  function statusBadge(status) {
    return `<span class="es-badge rq-status" data-status="${esc(status)}">${esc(L.statusLabel(status))}</span>`;
  }

  function dueText(request) {
    if (!request.designDueAt) return '';
    const state_ = L.dueState(request);
    const when = formatDate(request.designDueAt);
    if (state_ === 'overdue') return `<span class="is-overdue">Overdue · ${esc(when)}</span>`;
    if (state_ === 'soon') return `<span class="is-soon">Due soon · ${esc(when)}</span>`;
    return `Due ${esc(when)}`;
  }

  function renderTabs() {
    document.querySelectorAll('#rq-views [data-view]').forEach(tab => {
      const view = tab.dataset.view;
      const selected = view === state.view;
      tab.setAttribute('aria-selected', String(selected));
      tab.classList.toggle('is-active', selected);
      tab.tabIndex = selected ? 0 : -1;
      const count = tab.querySelector('[data-view-count]');
      if (count) {
        const open = state.requests.filter(request => inView(request, view) && L.isOpen(request.status)).length;
        count.textContent = open ? String(open) : '';
      }
    });
    const designers = state.view === 'designers';
    $('rq-layout').classList.toggle('is-designers', designers);
    $('rq-designers').hidden = !designers;
    $('rq-filters').hidden = designers;
    document.querySelector('.rq-search').hidden = designers;
  }

  function renderFilters() {
    document.querySelectorAll('#rq-filters [data-filter]').forEach(chip => {
      chip.setAttribute('aria-pressed', String(chip.dataset.filter === state.filter));
    });
  }

  function emptyCopy() {
    if (state.query) return ['Nothing matches', 'Try a different word, or clear the search.'];
    if (state.view === 'queue') return ['Your queue is clear', 'Requests assigned to you show here.'];
    if (state.view === 'all') return ['No requests here', 'Try another status filter.'];
    if (state.filter === 'open') return ['No open requests', 'Everything you asked for is done. Check Done or All for history.'];
    return ['No requests yet', 'When you send the design team a request, you can follow it here.'];
  }

  function renderList() {
    const list = $('rq-list');
    const items = visibleRequests();
    list.removeAttribute('aria-busy');
    list.innerHTML = items.map(request => {
      const who = state.view === 'mine'
        ? (request.assignedTo ? `With ${esc(personName(request.assignedTo))}` : 'Not assigned yet')
        : esc(personName(request.requesterEmail, request.requesterName) || 'Unknown requester');
      const due = dueText(request);
      const step = state.ctx?.ready ? L.nextStep(request, user()) : null;
      const yourMove = Boolean(step?.action) && step.tone !== 'wait';
      return `<li><button class="rq-item" type="button" data-id="${esc(request.id)}" aria-current="${request.id === state.selectedId}">
        <span class="rq-item__top"><span class="rq-item__title">${esc(request.title)}</span><span class="rq-item__badges">${yourMove ? '<span class="es-badge es-badge--brand rq-move">Your move</span>' : ''}${statusBadge(request.status)}</span></span>
        <span class="rq-item__meta">${esc(request.requestId)} · ${who}${due ? ` · ${due}` : ''}</span>
      </button></li>`;
    }).join('');
    const empty = $('rq-empty');
    empty.hidden = items.length > 0;
    if (!items.length) {
      const [title, copy] = emptyCopy();
      $('rq-empty-title').textContent = title;
      $('rq-empty-copy').textContent = copy;
    }
  }

  function renderAll() {
    renderTabs();
    renderFilters();
    renderList();
    if (state.view === 'designers') renderDesigners();
  }

  // ── Detail ────────────────────────────────────────────────────────────────
  function selected() {
    return state.requests.find(request => request.id === state.selectedId) || null;
  }

  function select(id, { focus = false } = {}) {
    state.selectedId = id || '';
    const request = selected();
    const url = new URL(window.location.href);
    if (request) url.searchParams.set('id', request.requestId);
    else url.searchParams.delete('id');
    window.history.replaceState(null, '', url);
    $('rq-layout').classList.toggle('has-selection', Boolean(request));
    document.querySelectorAll('#rq-list .rq-item').forEach(item => item.setAttribute('aria-current', String(item.dataset.id === state.selectedId)));
    renderDetail(request);
    if (focus && request) $('rq-detail').focus({ preventScroll: false });
  }

  function stepsMarkup(request) {
    if (request.status === 'Declined') return '';
    const current = L.stepIndex(request.status);
    return `<ol class="rq-steps" aria-label="Progress">${L.STEPS.map((step, index) => {
      const cls = index < current ? 'is-done' : (index === current ? 'is-current' : '');
      return `<li class="rq-step ${cls}"${index === current ? ' aria-current="step"' : ''}>${esc(step.label)}</li>`;
    }).join('')}</ol>`;
  }

  // ── Next step: the one action that moves the request forward ─────────────
  const NEXT_LABELS = {
    claim: 'Assign to me', assign: 'Choose a designer', start: 'Start work', attach: 'Attach the design',
    review: 'Send for review', done: 'Mark done', comment: 'Ask for a change',
  };
  function nextCopy(step, request, deliveries) {
    const who = personName(step.assignee) || 'The designer';
    const due = formatDate(request.designDueAt);
    const copy = {
      done: ['Delivered', deliveries ? 'The finished designs are below.' : 'This request is done.'],
      'requester-new': ['Waiting for a designer', 'The design team has it in their queue. You can withdraw it until work starts.'],
      'requester-assigned': [`${who} has it`, 'Work starts soon. Each step shows here as it happens.'],
      'requester-doing': [`${who} is designing it`, due ? `Due ${due}. Comment below if anything changes.` : 'Comment below if anything changes.'],
      'requester-review': ['Your designs are ready to check', 'Look at the delivered designs below. Happy? There is nothing to do. Need a change? Ask in a comment.'],
      'unassigned-admin': ['Nobody has this yet', 'Pick a designer so it starts moving.'],
      unassigned: ['Nobody has this yet', 'Take it and it moves to your queue.'],
      'with-someone': [`With ${who}`, step.overdue ? 'It is past its due date. A comment is the quickest nudge.' : 'Nothing for you to do right now.'],
      'mine-start': ['Ready when you are', 'Starting it tells the requester that work has begun.'],
      'mine-attach': ['Attach the design', 'Pick your FrameUp export or paste a link. Attaching sends it for review.'],
      'mine-send': ['Send it for review', 'The requester is told to check the delivered designs.'],
      'mine-review': ['Waiting on the requester', 'When they are happy, close it out.'],
    }[step.key];
    if (!copy) return null;
    return [step.overdue ? `Overdue · ${copy[0]}` : copy[0], copy[1]];
  }
  function nextStepMarkup(request, deliveries) {
    if (!state.ctx?.ready) return '';
    const step = L.nextStep(request, user(), { deliveries });
    const copy = nextCopy(step, request, deliveries);
    if (!copy) return '';
    const label = NEXT_LABELS[step.action];
    return `<div class="rq-detail__section"><div class="rq-next" data-tone="${esc(step.tone)}" role="status">
      <div class="rq-next__copy"><span class="es-type-eyebrow">Next step</span><strong>${esc(copy[0])}</strong><span>${esc(copy[1])}</span></div>
      ${label ? `<button class="es-btn es-btn--primary es-btn--sm" type="button" data-action="next-${esc(step.action)}"${step.status ? ` data-status="${esc(step.status)}"` : ''}>${esc(label)}</button>` : ''}
    </div></div>`;
  }

  function factsMarkup(request) {
    const due = L.dueState(request) === 'overdue';
    const facts = [
      ['Requested by', personName(request.requesterEmail, request.requesterName) || '—'],
      ['Assigned to', request.assignedTo ? personName(request.assignedTo) : 'Not assigned yet'],
      ['Design needed by', formatDate(request.designDueAt) || 'Not set', due ? 'is-overdue' : ''],
      ['Publishes', formatDate(request.publishAt) || 'Not set'],
      ['Type', { newsletter: 'Newsletter graphic', 'web-feature': 'Web feature image', social: 'Social media graphic' }[request.requestType] || request.requestType || '—'],
      ['Where', [request.publication, request.channel].filter(Boolean).join(' · ') || '—'],
      ['Filed', `${formatDate(request.createdAt) || '—'}${request.source === 'Slack' ? ' (from Slack)' : ''}`],
    ];
    return `<dl class="rq-facts">${facts.map(([label, value, cls]) => `<div><dt>${esc(label)}</dt><dd class="${cls || ''}">${esc(value)}${cls ? ' (overdue)' : ''}</dd></div>`).join('')}</dl>`;
  }

  function briefMarkup(request) {
    const rows = [
      ['Entities', request.entities],
      ['What’s needed', request.brief],
      ['Copy on the design', request.designCopy],
      ['Notes', request.additionalNotes],
    ].filter(([, value]) => String(value || '').trim());
    const links = request.referenceLinks.filter(link => /^https?:\/\//i.test(link));
    if (!rows.length && !links.length) return '<p class="rq-form-status">No brief was added.</p>';
    return `<dl class="rq-brief">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
      ${links.length ? `<div><dt>References</dt><dd><ul class="rq-links">${links.map(link => `<li><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link)}</a></li>`).join('')}</ul></dd></div>` : ''}</dl>`;
  }

  function assigneeControl(request) {
    const ctx = state.ctx;
    if (ctx.isAdmin) {
      const emails = new Set(state.designers.map(item => item.email));
      if (request.assignedTo) emails.add(request.assignedTo);
      if (ctx.email) emails.add(ctx.email);
      const options = [...emails].sort().map(email => `<option value="${esc(email)}"${email === request.assignedTo ? ' selected' : ''}>${esc(personName(email))}${email === ctx.email ? '' : ` (${esc(email)})`}</option>`).join('');
      return `<label class="es-field"><span class="es-field__label">Assignee</span><select class="es-select" id="rq-assignee"><option value=""${request.assignedTo ? '' : ' selected'}>Not assigned</option>${options}</select></label>`;
    }
    if (ctx.isDesigner && !request.assignedTo) {
      return `<div class="es-field"><span class="es-field__label">Assignee</span><button class="es-btn es-btn--secondary" type="button" data-action="claim">Assign to me</button></div>`;
    }
    if (ctx.isDesigner && request.assignedTo === ctx.email) {
      return `<div class="es-field"><span class="es-field__label">Assignee</span><button class="es-btn es-btn--tertiary" type="button" data-action="handback">Hand back</button></div>`;
    }
    return '';
  }

  function manageMarkup(request) {
    const ctx = state.ctx;
    if (!ctx.ready) return '';
    const u = user();
    if (!isStaff()) {
      const withdraw = L.checkStatusChange(request, u, 'Declined');
      if (!withdraw.ok) return '';
      return `<div class="rq-detail__section"><h3 class="rq-h3">Change of plan?</h3>
        <p class="rq-form-status">You can withdraw this request until the designer starts on it.</p>
        <div class="rq-actions"><button class="es-btn es-btn--danger es-btn--sm" type="button" data-action="withdraw">Withdraw request</button></div>
        <p class="rq-form-status" id="rq-manage-status" role="status" aria-live="polite"></p></div>`;
    }
    const statuses = L.allowedStatuses(request, u);
    const plan = L.canEditPlan(request, u);
    const statusField = statuses.length
      ? `<label class="es-field"><span class="es-field__label">Status</span><select class="es-select" id="rq-status"><option value="${esc(request.status)}" selected>${esc(L.statusLabel(request.status))} (now)</option>${statuses.map(status => `<option value="${esc(status)}">${esc(L.statusLabel(status))}</option>`).join('')}</select></label>`
      : `<div class="es-field"><span class="es-field__label">Status</span><span class="rq-form-status">${request.assignedTo && request.assignedTo !== ctx.email ? `With ${esc(personName(request.assignedTo))}` : 'Assign it to yourself to move it.'}</span></div>`;
    const dueField = plan
      ? `<label class="es-field"><span class="es-field__label">Design needed by</span><input class="es-input" type="datetime-local" id="rq-due" value="${esc(localInputValue(request.designDueAt))}"></label>`
      : '';
    const priorityField = plan
      ? `<label class="es-field"><span class="es-field__label">Priority</span><select class="es-select" id="rq-priority">${L.PRIORITIES.map(priority => `<option${priority === request.priority ? ' selected' : ''}>${priority}</option>`).join('')}</select></label>`
      : '';
    const canSave = statuses.length || plan || ctx.isAdmin;
    return `<div class="rq-detail__section"><h3 class="rq-h3">Manage</h3>
      <div class="rq-controls">${statusField}${assigneeControl(request)}${dueField}${priorityField}
        ${canSave ? `<label class="es-field is-wide"><span class="es-field__label">Note for the requester (optional)</span><textarea class="es-input rq-textarea" id="rq-reason" maxlength="4000" placeholder="Shown in the history and the Slack thread. Required when declining."></textarea></label>` : ''}
      </div>
      ${canSave ? '<div class="rq-actions"><button class="es-btn es-btn--secondary" type="button" data-action="save">Save changes</button></div>' : ''}
      <p class="rq-form-status" id="rq-manage-status" role="status" aria-live="polite"></p></div>`;
  }

  function deliveriesMarkup(request, deliveries, exportsList) {
    const u = user();
    const canAttach = state.ctx.ready && L.canEditPlan(request, u);
    const list = deliveries.length
      ? `<ul class="rq-deliveries">${deliveries.map(item => {
        const label = item.label || item.url || 'FrameUp export';
        const href = item.url && /^https?:\/\//i.test(item.url) ? item.url : (item.export_task_id ? 'gallery.html' : '');
        const removable = state.ctx.isAdmin || L.normalizeEmail(item.added_by) === state.ctx.email;
        return `<li class="rq-delivery">${svg(ICON.delivery)}<span class="rq-delivery__body">${href ? `<a href="${esc(href)}"${item.url ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(label)}</a>` : `<strong>${esc(label)}</strong>`}<small>${item.export_task_id ? 'FrameUp export' : 'Link'} · ${esc(personName(item.added_by))} · ${esc(formatDate(item.created_at))}</small></span>${removable ? `<button class="es-btn es-btn--tertiary es-btn--sm" type="button" data-action="detach" data-delivery="${esc(item.id)}" aria-label="Remove ${esc(label)}">Remove</button>` : ''}</li>`;
      }).join('')}</ul>`
      : `<p class="rq-form-status">${L.isOpen(request.status) ? 'Nothing delivered yet.' : 'No designs were attached.'}</p>`;
    const form = canAttach ? `<form class="rq-attach" id="rq-attach" autocomplete="off">
        <label class="es-field"><span class="es-field__label">FrameUp export</span><select class="es-select" id="rq-attach-export"><option value="">Pick one of your recent exports</option>${exportsList.map(item => `<option value="${esc(item.id)}">${esc(item.title || item.filename || 'Export')} · ${esc(formatDate(item.created_at))}</option>`).join('')}</select></label>
        <label class="es-field"><span class="es-field__label">Or a link</span><input class="es-input" type="url" id="rq-attach-url" placeholder="https://"></label>
        <button class="es-btn es-btn--secondary" type="submit">Attach</button>
      </form><p class="rq-form-status" id="rq-attach-status" role="status" aria-live="polite">Attaching moves an in-progress request to In review.</p>` : '';
    return `<div class="rq-detail__section"><h3 class="rq-h3">Delivered designs</h3>${list}${form}</div>`;
  }

  function eventText(event) {
    const who = `<b>${esc(personName(event.actor_email, ['comment', 'created'].includes(event.kind) ? event.actor_name : ''))}</b>`;
    switch (event.kind) {
      case 'created': return `${who} filed the request.`;
      case 'status': return `${who} moved it to <b>${esc(L.statusLabel(event.to_value))}</b>.`;
      case 'assign': return event.to_value ? `${who} assigned it to <b>${esc(personName(event.to_value))}</b>.` : `${who} unassigned it.`;
      case 'due': return event.to_value ? `${who} set the due date to <b>${esc(formatDate(event.to_value))}</b>.` : `${who} cleared the due date.`;
      case 'priority': return `${who} set priority to <b>${esc(event.to_value)}</b>.`;
      case 'delivery': return `${who} attached <b>${esc(event.to_value || 'a design')}</b>.`;
      case 'comment': return `${who} commented`;
      default: return who;
    }
  }

  function activityMarkup(request, eventsResult) {
    const events = eventsResult.events || [];
    const items = events.length ? events : [{ kind: 'created', actor_email: request.requesterEmail, actor_name: request.requesterName, created_at: request.createdAt }];
    const timeline = `<ol class="rq-timeline">${items.map(event => `<li class="rq-event${event.kind === 'comment' ? ' is-comment' : ''}">
        <span class="rq-event__dot">${svg(ICON[event.kind] || ICON.status)}</span>
        <div><p class="rq-event__text">${eventText(event)} <span class="rq-event__time">· ${esc(formatDate(event.created_at))}</span></p>
        ${event.body ? `<div class="rq-comment">${esc(event.body)}</div>` : ''}</div>
      </li>`).join('')}</ol>`;
    const composer = state.ctx.ready && eventsResult.ready
      ? `<form class="rq-composer" id="rq-composer">
          <label class="es-field"><span class="es-field__label">Add a comment</span><textarea class="es-input rq-textarea" id="rq-comment" maxlength="4000" required placeholder="Ask a question or add context. ${request.slackThreaded ? 'It also goes to the Slack thread.' : ''}"></textarea></label>
          <div class="rq-composer__row"><span class="rq-composer__hint">Everyone on the request sees this.</span><button class="es-btn es-btn--secondary" type="submit">Comment</button></div>
          <p class="rq-form-status" id="rq-comment-status" role="status" aria-live="polite"></p>
        </form>`
      : '<p class="rq-form-status">Comments switch on once the request workflow update is applied.</p>';
    return `<div class="rq-detail__section"><h3 class="rq-h3">Activity</h3>${timeline}${composer}</div>`;
  }

  async function renderDetail(request) {
    const body = $('rq-detail-body');
    $('rq-detail-empty').hidden = Boolean(request);
    body.hidden = !request;
    if (!request) { body.innerHTML = ''; return; }
    const token = ++state.detailToken;
    const declinedNote = '';
    const head = `<div class="rq-detail__section">
        <button class="es-btn es-btn--tertiary es-btn--sm rq-back" type="button" data-action="back">Back to the list</button>
        <p class="rq-detail__kicker"><span>${esc(request.requestId)}</span><span class="es-badge rq-priority" data-priority="${esc(request.priority)}">${esc(request.priority)}</span>${request.slackThreaded ? '<span class="es-badge">Slack thread</span>' : ''}${statusBadge(request.status)}</p>
        <h2 class="rq-detail__title">${esc(request.title)}</h2>
        ${stepsMarkup(request)}
        <div id="rq-declined">${declinedNote}</div>
      </div>
      <div class="rq-detail__section">${factsMarkup(request)}</div>`;
    body.innerHTML = `${head}<div id="rq-next-slot"></div>${manageMarkup(request)}<div class="rq-detail__section"><h3 class="rq-h3">Brief</h3>${briefMarkup(request)}</div><div id="rq-deliveries-slot"></div><div id="rq-activity-slot"><div class="rq-detail__section"><h3 class="rq-h3">Activity</h3><p class="rq-form-status">Loading history…</p></div></div>`;

    const u = user();
    const [eventsResult, deliveries, exportsList] = await Promise.all([
      API.listEvents(request.id),
      state.ctx.ready ? API.listDeliveries(request.id) : Promise.resolve([]),
      state.ctx.ready && L.canEditPlan(request, u) ? API.recentExports() : Promise.resolve([]),
    ]);
    if (token !== state.detailToken) return;
    $('rq-next-slot').innerHTML = nextStepMarkup(request, deliveries.length);
    $('rq-deliveries-slot').innerHTML = deliveriesMarkup(request, deliveries, exportsList);
    $('rq-activity-slot').innerHTML = activityMarkup(request, eventsResult);
    if (request.status === 'Declined') {
      const last = (eventsResult.events || []).filter(event => event.kind === 'status' && event.to_value === 'Declined').pop();
      $('rq-declined').innerHTML = `<div class="es-callout rq-declined"><div><strong>Declined${last ? ` by ${esc(personName(last.actor_email))}` : ''}</strong>${last?.body ? esc(last.body) : 'Ask in the comments if you’re not sure why.'}</div></div>`;
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function setStatus(id, message, isError = false) {
    const node = $(id);
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', isError);
  }

  async function run(statusId, action, payload, doneMessage) {
    const request = selected();
    if (!request) return;
    setStatus(statusId, 'Saving…');
    document.querySelectorAll('#rq-detail-body button').forEach(button => { button.disabled = true; });
    try {
      const result = await API.mutate(action, { requestId: request.id, ...payload });
      toast(`${doneMessage}${slackNote(result.slack)}`);
      await reload({ keepSelection: true });
    } catch (error) {
      document.querySelectorAll('#rq-detail-body button').forEach(button => { button.disabled = false; });
      setStatus(statusId, API.friendlyError(error), true);
    }
  }

  function saveChanges() {
    const request = selected();
    const payload = {};
    const status = $('rq-status')?.value;
    if (status && status !== request.status) payload.status = status;
    const assignee = $('rq-assignee');
    if (assignee && L.normalizeEmail(assignee.value) !== request.assignedTo) payload.assignedTo = assignee.value;
    const due = $('rq-due');
    if (due) {
      const current = localInputValue(request.designDueAt);
      if (due.value !== current) {
        if (due.value) payload.designDueAt = new Date(due.value).toISOString();
        else payload.clearDue = true;
      }
    }
    const priority = $('rq-priority')?.value;
    if (priority && priority !== request.priority) payload.priority = priority;
    const reason = $('rq-reason')?.value.trim() || '';
    if (payload.status === 'Declined' && !reason) {
      setStatus('rq-manage-status', 'Add a short note so the requester knows why it was declined.', true);
      $('rq-reason')?.focus();
      return;
    }
    if (reason) payload.reason = reason;
    if (!Object.keys(payload).some(key => key !== 'reason')) {
      if (reason) {
        run('rq-manage-status', 'comment', { body: reason }, 'Note added.');
        return;
      }
      setStatus('rq-manage-status', 'Nothing has changed yet.');
      return;
    }
    run('rq-manage-status', 'update', payload, 'Saved.');
  }

  function onDetailClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const me = state.ctx.email;
    if (action === 'back') { select(''); $('rq-list').querySelector('.rq-item')?.focus(); return; }
    if (action === 'save') saveChanges();
    if (action === 'claim' || action === 'next-claim') run('rq-manage-status', 'update', { assignedTo: me }, 'It’s yours.');
    if (['next-start', 'next-review', 'next-done'].includes(action) && button.dataset.status) {
      const done = { Doing: 'Started. The requester can see it.', Review: 'Sent for review.', Done: 'Marked done.' }[button.dataset.status] || 'Saved.';
      run('rq-manage-status', 'update', { status: button.dataset.status }, done);
    }
    const focusTarget = { 'next-assign': 'rq-assignee', 'next-attach': 'rq-attach-export', 'next-comment': 'rq-comment' }[action];
    if (focusTarget && $(focusTarget)) {
      $(focusTarget).scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      $(focusTarget).focus({ preventScroll: true });
    }
    if (action === 'handback') run('rq-manage-status', 'update', { assignedTo: '' }, 'Handed back.');
    if (action === 'withdraw') {
      if (!window.confirm('Withdraw this request? The design team will see that you cancelled it.')) return;
      run('rq-manage-status', 'update', { status: 'Declined', reason: 'Withdrawn by the requester.' }, 'Request withdrawn.');
    }
    if (action === 'detach') {
      if (!window.confirm('Remove this design from the request?')) return;
      detach(button.dataset.delivery);
    }
  }

  async function detach(deliveryId) {
    const client = window.ESAuth?.getSupabaseClient?.();
    if (!client || !deliveryId) return;
    const { error } = await client.rpc('frameup_request_detach', { p_delivery_id: deliveryId });
    if (error) { toast(API.friendlyError(error)); return; }
    toast('Removed.');
    renderDetail(selected());
  }

  function onDetailSubmit(event) {
    if (event.target.id === 'rq-composer') {
      event.preventDefault();
      const body = $('rq-comment').value.trim();
      if (!body) { setStatus('rq-comment-status', 'Write a comment first.', true); return; }
      run('rq-comment-status', 'comment', { body }, 'Comment added.');
    }
    if (event.target.id === 'rq-attach') {
      event.preventDefault();
      const exportTaskId = $('rq-attach-export').value;
      const url = $('rq-attach-url').value.trim();
      if (!exportTaskId && !url) { setStatus('rq-attach-status', 'Pick an export or paste a link.', true); return; }
      if (url && !/^https?:\/\//i.test(url)) { setStatus('rq-attach-status', 'Links must start with https://', true); return; }
      const label = exportTaskId ? $('rq-attach-export').selectedOptions[0]?.textContent.split(' · ')[0] : '';
      run('rq-attach-status', 'attach', { exportTaskId: exportTaskId || null, url, label }, 'Design attached.');
    }
  }

  // ── Designers (admins) ───────────────────────────────────────────────────
  function renderDesigners() {
    const list = $('rq-designer-list');
    list.innerHTML = state.designers.length
      ? state.designers.map(item => `<li><span>${esc(item.name || personName(item.email))} <small>${esc(item.email)}</small></span><button class="es-btn es-btn--tertiary es-btn--sm" type="button" data-remove-designer="${esc(item.email)}">Remove</button></li>`).join('')
      : '<li><span>No designers yet. Admins can always work on requests.</span></li>';
  }

  async function onDesignerSubmit(event) {
    event.preventDefault();
    const email = $('rq-designer-email').value;
    try {
      await API.addDesigner(email, $('rq-designer-name').value);
      $('rq-designer-form').reset();
      setStatus('rq-designer-status', 'Added.');
      state.designers = await API.listDesigners();
      renderDesigners();
    } catch (error) {
      setStatus('rq-designer-status', API.friendlyError(error), true);
    }
  }

  async function onDesignerRemove(event) {
    const button = event.target.closest('[data-remove-designer]');
    if (!button) return;
    try {
      await API.removeDesigner(button.dataset.removeDesigner);
      state.designers = await API.listDesigners();
      renderDesigners();
      setStatus('rq-designer-status', 'Removed.');
    } catch (error) {
      setStatus('rq-designer-status', API.friendlyError(error), true);
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  function showSkeleton() {
    $('rq-list').setAttribute('aria-busy', 'true');
    $('rq-list').innerHTML = Array.from({ length: 4 }, () => '<li><span class="rq-item is-skeleton es-skeleton"></span></li>').join('');
  }

  async function reload({ keepSelection = false } = {}) {
    $('rq-error').hidden = true;
    state.loadedAt = Date.now();
    try {
      state.requests = await API.listRequests();
    } catch (error) {
      $('rq-error-copy').textContent = API.friendlyError(error);
      $('rq-error').hidden = false;
      $('rq-list').innerHTML = '';
      $('rq-list').removeAttribute('aria-busy');
      return;
    }
    renderAll();
    if (keepSelection && state.selectedId) select(state.selectedId);
  }

  function chooseInitialView(wantedId) {
    const ctx = state.ctx;
    const wanted = wantedId ? state.requests.find(request => request.requestId === wantedId || request.id === wantedId) : null;
    if (wanted) {
      if (L.isRequester(wanted, user())) state.view = 'mine';
      else if (isStaff()) state.view = inView(wanted, 'queue') ? 'queue' : 'all';
      if (!matchesFilter(wanted)) state.filter = 'all';
      return wanted.id;
    }
    if (isStaff() && state.requests.some(request => inView(request, 'queue') && L.isOpen(request.status))) state.view = 'queue';
    else if (ctx.isAdmin && !state.requests.some(request => inView(request, 'mine'))) state.view = 'all';
    return '';
  }

  async function init() {
    showSkeleton();
    state.ctx = await API.getContext();
    if (!state.ctx.signedIn) {
      $('rq-error-copy').textContent = 'Please sign in again to see your requests.';
      $('rq-error').hidden = false;
      $('rq-list').innerHTML = '';
      return;
    }
    $('rq-notice').hidden = state.ctx.ready;
    const staff = isStaff();
    document.querySelector('[data-view="queue"]').hidden = !staff;
    document.querySelector('[data-view="all"]').hidden = !staff;
    document.querySelector('[data-view="designers"]').hidden = !(state.ctx.isAdmin && state.ctx.ready);
    // One view only (most requesters): no need for the switcher.
    $('rq-views').hidden = !staff;
    if (staff) $('rq-intro').textContent = 'Your queue, every open request, and who has what. Requesters see status and history here too.';

    const [, designers] = await Promise.all([reload(), state.ctx.ready ? API.listDesigners() : Promise.resolve([])]);
    state.designers = designers || [];
    const wantedId = new URLSearchParams(window.location.search).get('id') || '';
    const initial = chooseInitialView(wantedId);
    renderAll();
    if (initial) select(initial);
    else if (window.matchMedia('(min-width: 1024px)').matches) {
      const first = visibleRequests()[0];
      if (first) select(first.id);
    }
    if (wantedId && !initial && state.requests.length) toast('That request isn’t in your list. It may belong to someone else.');
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  $('rq-views').addEventListener('click', event => {
    const tab = event.target.closest('[data-view]');
    if (!tab || tab.hidden) return;
    state.view = tab.dataset.view;
    renderAll();
    if (state.view !== 'designers' && !visibleRequests().some(request => request.id === state.selectedId)) select('');
  });
  $('rq-views').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('#rq-views [data-view]')].filter(tab => !tab.hidden);
    const index = tabs.findIndex(tab => tab.dataset.view === state.view);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.click();
    next.focus();
  });
  $('rq-filters').addEventListener('click', event => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    renderAll();
  });
  $('rq-search').addEventListener('input', event => { state.query = event.target.value; renderList(); });
  $('rq-list').addEventListener('click', event => {
    const item = event.target.closest('.rq-item[data-id]');
    if (item) select(item.dataset.id, { focus: !window.matchMedia('(min-width: 1024px)').matches });
  });
  // Up / Down move between requests in the list.
  $('rq-list').addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const items = [...$('rq-list').querySelectorAll('.rq-item[data-id]')];
    const index = items.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
  });
  // Coming back to the tab after a while: refresh, unless something is being typed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.ctx?.signedIn || Date.now() - (state.loadedAt || 0) < 60000) return;
    const typing = [...document.querySelectorAll('#rq-detail-body textarea, #rq-detail-body input')].some(field => field.value && field.type !== 'datetime-local');
    if (typing || $('rq-detail').contains(document.activeElement) && document.activeElement.matches('textarea, input, select')) return;
    reload({ keepSelection: true });
  });
  $('rq-detail').addEventListener('click', onDetailClick);
  $('rq-detail').addEventListener('submit', onDetailSubmit);
  $('rq-retry').addEventListener('click', () => { showSkeleton(); reload({ keepSelection: true }); });
  $('rq-designer-form').addEventListener('submit', onDesignerSubmit);
  $('rq-designer-list').addEventListener('click', onDesignerRemove);

  if (!L || !API) {
    $('rq-error').hidden = false;
    return;
  }
  init();
})();
