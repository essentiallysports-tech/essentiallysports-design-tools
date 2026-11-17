// Design Request data for "My requests", the Dashboard and the sidebar badge.
// window.FrameUpRequests. Reads go straight to Supabase under RLS; changes go
// through /api/design-request-update (which also posts to Slack), falling back
// to the same database functions directly when the API is not reachable
// (local preview), in which case nothing is posted to Slack.
//
// Works before the request-workflow migration is applied: lists and details
// still load from es_designer_tasks; history, comments, deliveries and
// changes report "not switched on yet".
(function () {
  'use strict';

  const L = window.FrameUpRequestLifecycle;
  const TABLE = 'es_designer_tasks';
  const BASE_COLUMNS = [
    'id', 'source_id', 'title', 'status', 'priority', 'assigned_to',
    'requester_name', 'requester_email', 'creator_name', 'creator_email',
    'request_type', 'workspace', 'workspace_variant', 'team_or_league',
    'design_due_at', 'publish_at', 'brief', 'design_copy', 'additional_notes',
    'reference_links', 'completed_at', 'created_at', 'updated_at',
    'meta_publication:metadata->>publication',
    'meta_channel:metadata->>socialChannel',
    'meta_entities:metadata->>entities',
    'meta_source:metadata->>source',
    'slack_thread_ts:metadata->>slackThreadTs',
  ];
  const COUNT_CACHE_KEY = 'frameup.requestCount.v1';
  const COUNT_CACHE_MS = 60 * 1000;

  let readyState = null; // null = unknown, true/false after the first check
  let contextPromise = null;

  function client() {
    try { return window.ESAuth?.getSupabaseClient?.() || null; } catch (error) { return null; }
  }

  function isMissing(error) {
    const code = String(error?.code || '');
    return ['PGRST202', 'PGRST205', '42883', '42P01', '42703', 'PGRST204'].includes(code)
      || /does not exist|could not find/i.test(String(error?.message || ''));
  }

  function friendlyError(error) {
    if (isMissing(error)) return 'Request tracking is not switched on yet. Ask an admin to apply the request workflow update.';
    const message = String(error?.message || error || '').trim();
    return message || 'Something went wrong. Please try again.';
  }

  async function session() {
    try { return await window.ESAuth?.getSession?.(); } catch (error) { return null; }
  }

  // Who am I, and is the workflow installed? Cached per page.
  function getContext({ force = false } = {}) {
    if (contextPromise && !force) return contextPromise;
    contextPromise = (async () => {
      const auth = await session();
      const email = L.normalizeEmail(auth?.user?.email);
      const name = String(auth?.user?.name || '').trim() || email.split('@')[0] || '';
      const sb = client();
      let isAdmin = false;
      let isDesigner = false;
      if (sb && email) {
        const [admin, designer] = await Promise.all([
          sb.rpc('is_es_designer_admin').then(r => r, error => ({ error })),
          sb.rpc('is_frameup_request_designer').then(r => r, error => ({ error })),
        ]);
        isAdmin = admin?.data === true;
        if (designer?.error) {
          readyState = !isMissing(designer.error) ? readyState : false;
        } else {
          readyState = true;
          isDesigner = designer?.data === true;
        }
        if (!isAdmin && window.ESDashboardData?.isCurrentUserAdmin) {
          isAdmin = await window.ESDashboardData.isCurrentUserAdmin().catch(() => false);
        }
      }
      return { email, name, isAdmin, isDesigner: isDesigner || isAdmin, ready: readyState === true, signedIn: Boolean(email && sb) };
    })();
    return contextPromise;
  }

  function normalizeRow(row = {}) {
    return {
      id: row.id,
      requestId: row.source_id || String(row.id || '').replace(/^task-request-/, ''),
      title: row.title || row.meta_entities || row.source_id || 'Design request',
      status: L.normalizeStatus(row.status),
      priority: L.normalizePriority(row.priority),
      assignedTo: L.normalizeEmail(row.assigned_to),
      requesterName: row.requester_name || '',
      requesterEmail: L.normalizeEmail(row.requester_email),
      creatorEmail: L.normalizeEmail(row.creator_email),
      requestType: row.request_type || '',
      publication: row.meta_publication || '',
      channel: row.meta_channel || '',
      entities: row.meta_entities || '',
      source: row.meta_source || '',
      designDueAt: row.design_due_at || '',
      publishAt: row.publish_at || '',
      brief: row.brief || '',
      designCopy: row.design_copy || '',
      additionalNotes: row.additional_notes || '',
      referenceLinks: Array.isArray(row.reference_links) ? row.reference_links : [],
      completedAt: row.completed_at || '',
      statusChangedAt: row.status_changed_at || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      slackThreaded: Boolean(row.slack_thread_ts),
    };
  }

  async function listRequests() {
    const sb = client();
    if (!sb) throw new Error('Please sign in again.');
    const ctx = await getContext();
    const columns = ctx.ready ? [...BASE_COLUMNS, 'status_changed_at'] : BASE_COLUMNS;
    let { data, error } = await sb.from(TABLE)
      .select(columns.join(','))
      .eq('task_type', 'design_request')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (error && ctx.ready && isMissing(error)) {
      ({ data, error } = await sb.from(TABLE).select(BASE_COLUMNS.join(','))
        .eq('task_type', 'design_request').order('updated_at', { ascending: false }).limit(500));
    }
    if (error) throw new Error(friendlyError(error));
    return (Array.isArray(data) ? data : []).map(normalizeRow);
  }

  async function listEvents(taskId) {
    const sb = client();
    if (!sb) return { ready: false, events: [] };
    const { data, error } = await sb.from('frameup_request_events')
      .select('id,kind,actor_email,actor_name,body,from_value,to_value,meta,created_at')
      .eq('request_id', taskId)
      .order('created_at', { ascending: true })
      .limit(300);
    if (error) return { ready: !isMissing(error), events: [], error: isMissing(error) ? '' : friendlyError(error) };
    return { ready: true, events: data || [] };
  }

  async function listDeliveries(taskId) {
    const sb = client();
    if (!sb) return [];
    const { data, error } = await sb.from('frameup_request_deliveries')
      .select('id,export_task_id,url,label,added_by,created_at')
      .eq('request_id', taskId)
      .order('created_at', { ascending: true });
    return error ? [] : (data || []);
  }

  async function listDesigners() {
    const sb = client();
    if (!sb) return [];
    const { data, error } = await sb.from('frameup_request_designers')
      .select('email,name,active')
      .order('email');
    return error ? [] : (data || []).filter(row => row.active !== false);
  }

  async function addDesigner(email, name = '') {
    const sb = client();
    const clean = L.normalizeEmail(email);
    if (!/^[^@\s]+@essentiallysports\.com$/.test(clean)) throw new Error('Use an @essentiallysports.com email.');
    const ctx = await getContext();
    const { error } = await sb.from('frameup_request_designers')
      .upsert({ email: clean, name: String(name || '').trim().slice(0, 120), active: true, added_by: ctx.email }, { onConflict: 'email' });
    if (error) throw new Error(friendlyError(error));
  }

  async function removeDesigner(email) {
    const sb = client();
    const { error } = await sb.from('frameup_request_designers').delete().eq('email', L.normalizeEmail(email));
    if (error) throw new Error(friendlyError(error));
  }

  // Recent exports the signed-in person can see, to attach to a request.
  async function recentExports(limit = 24) {
    const sb = client();
    if (!sb) return [];
    const ctx = await getContext();
    let query = sb.from(TABLE)
      .select('id,title,filename,workspace,workspace_variant,creator_email,created_at')
      .eq('task_type', 'exported_design')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!ctx.isAdmin) query = query.eq('creator_email', ctx.email);
    const { data, error } = await query;
    return error ? [] : (data || []);
  }

  // Direct RPC fallback (no Slack) when the API is not reachable.
  async function mutateDirect(action, payload) {
    const sb = client();
    if (!sb) throw new Error('Please sign in again.');
    const id = L.taskIdFor(String(payload.requestId).replace(/^task-request-/, ''));
    let response;
    if (action === 'update') {
      const args = { p_request_id: id };
      if (payload.status) args.p_status = L.normalizeStatus(payload.status);
      if (payload.assignedTo !== undefined && payload.assignedTo !== null) args.p_assigned_to = L.normalizeEmail(payload.assignedTo);
      if (payload.clearDue) args.p_clear_due = true;
      else if (payload.designDueAt) args.p_design_due_at = new Date(payload.designDueAt).toISOString();
      if (payload.priority) args.p_priority = L.normalizePriority(payload.priority);
      if (payload.reason) args.p_reason = String(payload.reason).slice(0, 4000);
      response = await sb.rpc('frameup_request_update', args);
    } else if (action === 'comment') {
      response = await sb.rpc('frameup_request_comment', { p_request_id: id, p_body: String(payload.body || '').slice(0, 4000) });
    } else if (action === 'attach') {
      response = await sb.rpc('frameup_request_attach', {
        p_request_id: id,
        p_url: payload.url || '',
        p_label: payload.label || '',
        p_export_task_id: payload.exportTaskId || null,
      });
    } else {
      return { ok: true, slack: { skipped: true, mode: 'local' } };
    }
    if (response.error) throw new Error(friendlyError(response.error));
    return { ok: true, result: response.data, slack: { skipped: true, mode: 'local' } };
  }

  async function mutate(action, payload = {}) {
    sessionStorageRemove(COUNT_CACHE_KEY);
    if (window.ESAuth?.fetchWithAuth) {
      try {
        const response = await window.ESAuth.fetchWithAuth('/api/design-request-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...payload }),
        });
        if (response.status !== 404 && response.status !== 405) {
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.ok === false) throw new Error(data.error || 'Could not update the request.');
          return data;
        }
      } catch (error) {
        // A real answer from the API (403, 400…) is final; only fall back when
        // the API itself is missing or unreachable.
        if (!(error instanceof TypeError)) throw error;
      }
    }
    return mutateDirect(action, payload);
  }

  // Ask the server to post whatever changed (Dashboard edits use this).
  function notify(requestId) {
    if (!window.ESAuth?.fetchWithAuth || !requestId) return Promise.resolve(null);
    return window.ESAuth.fetchWithAuth('/api/design-request-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notify', requestId }),
    }).then(response => (response.ok ? response.json() : null)).catch(() => null);
  }

  function sessionStorageRemove(key) {
    try { window.sessionStorage.removeItem(key); } catch (error) { /* ignore */ }
  }

  // Sidebar badge count, cached for a minute. null = unknown / not installed.
  async function openCount({ force = false } = {}) {
    if (!force) {
      try {
        const cached = JSON.parse(window.sessionStorage.getItem(COUNT_CACHE_KEY) || 'null');
        if (cached && Date.now() - cached.at < COUNT_CACHE_MS) return cached.count;
      } catch (error) { /* ignore */ }
    }
    const sb = client();
    if (!sb) return null;
    const { data, error } = await sb.rpc('frameup_my_open_request_count');
    if (error || typeof data !== 'number') return null;
    try { window.sessionStorage.setItem(COUNT_CACHE_KEY, JSON.stringify({ at: Date.now(), count: data })); } catch (error) { /* ignore */ }
    return data;
  }

  window.FrameUpRequests = Object.freeze({
    getContext,
    listRequests,
    listEvents,
    listDeliveries,
    listDesigners,
    addDesigner,
    removeDesigner,
    recentExports,
    mutate,
    notify,
    openCount,
    friendlyError,
    isMissing,
  });
})();
