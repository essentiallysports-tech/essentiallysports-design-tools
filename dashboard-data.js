(function () {
  'use strict';

  const REQUESTS_KEY = 'es.designRequests.v1';
  const DESIGNS_KEY = 'es.dashboard.designs.v1';
  const ACTIVITY_KEY = 'es.dashboard.activity.v1';
  const TASKS_KEY = 'es.dashboard.tasks.v1';
  const ADMIN_CONFIG_KEY = 'es.dashboard.adminConfig.v1';
  const PROFILE_KEY = 'es.ai.profile';
  const AUTH_KEY = 'es.designerAuth.v1';
  const SUPABASE_PROFILES_TABLE = 'es_designer_profiles';
  const SUPABASE_PRESENCE_TABLE = 'es_designer_presence';
  const SUPABASE_TASKS_TABLE = 'es_designer_tasks';
  const SUPABASE_ACTIVITY_TABLE = 'es_designer_activity';
  const PENDING_TASKS_KEY = 'es.dashboard.pendingTasks.v1';
  const PENDING_ACTIVITY_KEY = 'es.dashboard.pendingActivity.v1';
  const PRESENCE_ONLINE_WINDOW_MS = 2 * 60 * 1000;
  const PRESENCE_HEARTBEAT_MS = 20 * 1000;
  const PRESENCE_MIN_GAP_MS = 10 * 1000;
  const TASK_STATUS_COLUMNS = Object.freeze(['Backlog', 'Assigned', 'Doing', 'Review', 'Done']);
  const ACCESS_ROLES = Object.freeze(['Associate', 'Admin', 'Super Admin', 'Server Owner']);
  const DASHBOARD_ACCESS_ROLES = Object.freeze(['Admin', 'Super Admin', 'Server Owner']);
  const ROLE_ASSIGNER_ROLES = Object.freeze(['Server Owner']);
  const SERVER_OWNER_EMAIL = 'suhail.quraishi@essentiallysports.com';
  // Suhail also signs in from a second account (designteam@) on some devices.
  // Both are treated as the same owner-level identity for dashboard purposes.
  const SERVER_OWNER_EMAILS = Object.freeze([SERVER_OWNER_EMAIL, 'designteam@essentiallysports.com']);
  const DASHBOARD_ADMIN_EMAILS = Object.freeze([
    ...SERVER_OWNER_EMAILS,
    'manish.kalsi@essentiallysports.com',
  ]);
  const DEFAULT_ROLE_ASSIGNMENTS = Object.freeze({
    ...Object.fromEntries(SERVER_OWNER_EMAILS.map(email => [email, 'Server Owner'])),
    'manish.kalsi@essentiallysports.com': 'Super Admin',
  });

  const DEFAULT_ADMIN_CONFIG = Object.freeze({
    adminEmails: [...DASHBOARD_ADMIN_EMAILS],
    ownerEmails: [],
  });

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function cleanString(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeAccessRole(role, email = '') {
    const normalizedEmail = normalizeEmail(email);
    if (DEFAULT_ROLE_ASSIGNMENTS[normalizedEmail]) return DEFAULT_ROLE_ASSIGNMENTS[normalizedEmail];
    const cleaned = cleanString(role);
    return ACCESS_ROLES.includes(cleaned) ? cleaned : 'Associate';
  }

  function designationFromProfile(profile = {}, sessionUser = {}) {
    const rawDesignation = cleanString(profile.designation || sessionUser.designation || profile.jobTitle || sessionUser.jobTitle);
    const oldRole = cleanString(profile.role || sessionUser.role);
    if (rawDesignation) return rawDesignation;
    return ACCESS_ROLES.includes(oldRole) ? 'Designer' : (oldRole || 'Designer');
  }

  function readJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function withTimeout(promise, timeoutMs, fallback = null) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise(resolve => window.setTimeout(() => resolve(fallback), timeoutMs)),
    ]);
  }

  function withRejectingTimeout(promise, timeoutMs, label) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((resolve, reject) => window.setTimeout(
        () => reject(new Error(`${label || 'Supabase request'} timed out.`)),
        timeoutMs,
      )),
    ]);
  }

  function getAdminConfig() {
    const stored = readJson(ADMIN_CONFIG_KEY, null);
    const config = stored && typeof stored === 'object' ? stored : DEFAULT_ADMIN_CONFIG;
    return {
      adminEmails: DEFAULT_ADMIN_CONFIG.adminEmails.map(normalizeEmail).filter(Boolean),
      ownerEmails: Array.from(new Set((Array.isArray(config.ownerEmails) ? config.ownerEmails : []).map(normalizeEmail).filter(Boolean))),
    };
  }

  // es.ai.profile (synced from the account) with the person's own Edit
  // profile changes (es.ai.profile.edits.v1, same email only) laid over it,
  // so presence shows the name and photo they chose.
  const PROFILE_EDITS_KEY = 'es.ai.profile.edits.v1';
  function getStoredProfile() {
    const base = readJson(PROFILE_KEY, {}) || {};
    const edits = readJson(PROFILE_EDITS_KEY, null);
    if (!edits || typeof edits !== 'object' || Array.isArray(edits)) return base;
    const editsEmail = normalizeEmail(edits.email);
    if (editsEmail && editsEmail !== normalizeEmail(base.email)) return base;
    const merged = { ...base };
    Object.entries(edits).forEach(([key, value]) => {
      if (key === 'email' || value === undefined || value === null || value === '') return;
      merged[key] = value;
    });
    if (!merged.avatar && merged.photo) merged.avatar = merged.photo;
    return merged;
  }

  function getProfileForSession(session) {
    const profile = getStoredProfile();
    const sessionEmail = normalizeEmail(session?.user?.email);
    return sessionEmail && normalizeEmail(profile.email) === sessionEmail ? profile : {};
  }

  function getSupabaseClient() {
    try {
      return window.ESAuth?.getSupabaseClient?.() || null;
    } catch (error) {
      return null;
    }
  }

  async function getAuthSession() {
    try {
      return await withTimeout(window.ESAuth?.getSession?.(), 5000, null);
    } catch (error) {
      return null;
    }
  }

  async function getAuthenticatedSession() {
    const authSession = await getAuthSession();
    if (authSession?.token && authSession?.user?.email) return authSession;
    return null;
  }

  async function getCurrentUser() {
    const session = await getAuthenticatedSession();
    const profile = getProfileForSession(session);
    const email = normalizeEmail(session?.user?.email);
    const name = cleanString(session?.user?.name || profile.name || email.split('@')[0] || 'ES User');
    const designation = designationFromProfile(profile, session?.user || {});
    const role = normalizeAccessRole(profile.accessRole || session?.user?.accessRole || session?.user?.role || profile.role, email);
    return { email, name, role, accessRole: role, designation, avatar: cleanString(profile.avatar) };
  }

  // Asks the database (the real gate) when the email isn't a fixed one.
  // Before migration 20261120120000 the database only knows the fixed emails,
  // so this answers exactly as before; afterwards an ES account given the
  // Admin role on the People view is an admin too.
  async function askServerBoolean(rpcName) {
    const client = getSupabaseClient();
    if (!client) return false;
    try {
      const result = await withTimeout(client.rpc(rpcName), 5000, { data: false, error: true });
      return !result?.error && result?.data === true;
    } catch (error) {
      return false;
    }
  }

  const serverRoleChecks = new Map();
  function cachedServerCheck(rpcName, email) {
    const key = `${rpcName}:${email}`;
    const cached = serverRoleChecks.get(key);
    if (cached && Date.now() - cached.at < 60000) return cached.promise;
    const promise = askServerBoolean(rpcName);
    serverRoleChecks.set(key, { at: Date.now(), promise });
    return promise;
  }

  async function isCurrentUserAdmin() {
    const session = await getAuthenticatedSession();
    const email = normalizeEmail(session?.user?.email);
    if (DASHBOARD_ADMIN_EMAILS.includes(email)) return true;
    if (!email || !email.endsWith('@essentiallysports.com')) return false;
    return cachedServerCheck('is_es_designer_admin', email);
  }

  async function canCurrentUserAssignRoles() {
    const session = await getAuthenticatedSession();
    const email = normalizeEmail(session?.user?.email);
    // The fixed owner identities, or (after the migration) an ES account the
    // database says is a Server Owner. The RPCs enforce the same rule.
    if (SERVER_OWNER_EMAILS.includes(email)) return true;
    if (!email || !email.endsWith('@essentiallysports.com')) return false;
    return cachedServerCheck('can_manage_es_designer_roles', email);
  }

  let cloudPeopleCache = [];
  let cloudTasksCache = [];
  let cloudActivityCache = [];
  let cloudSyncStatus = {
    ok: null,
    message: '',
    checkedAt: '',
  };
  let presenceTimer = null;
  let cloudRefreshInFlight = null;
  let presenceUpsertInFlight = null;
  let pendingFlushInFlight = null;

  function getCurrentWorkspaceLabel() {
    const page = document.body?.dataset?.currentPage || '';
    const path = window.location.pathname.split('/').pop() || 'index.html';
    if (page === 'instagram') return 'Social Media workspace';
    if (page === 'youtube') return 'YouTube workspace';
    if (page === 'newsletter') return 'Newsletter workspace';
    if (/dashboard\.html$/i.test(path)) return 'Dashboard';
    if (/design-request\.html$/i.test(path)) return 'Design Request';
    if (/profile\.html$/i.test(path)) return 'Profile';
    if (/settings\.html$/i.test(path)) return 'Settings';
    return document.title?.replace(/\s*\|\s*EssentiallySports\s*$/i, '').trim() || 'FrameUp';
  }

  function normalizeCloudPerson(row = {}) {
    const email = normalizeEmail(row.email);
    if (!email) return null;
    const lastSeen = row.last_seen_at || row.updated_at || '';
    const lastSeenMs = Date.parse(lastSeen);
    const isOnline = Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs <= PRESENCE_ONLINE_WINDOW_MS;
    const accessRole = normalizeAccessRole(row.access_role || row.accessRole || row.role, email);
    return {
      email,
      name: cleanString(row.name || email.split('@')[0]),
      designation: cleanString(row.designation || row.job_title || row.jobTitle || ''),
      role: accessRole,
      accessRole,
      avatar: cleanString(row.avatar_url || row.avatar || ''),
      workspace: cleanString(row.workspace || row.page_path || (isOnline ? 'FrameUp' : 'Not currently active')),
      lastSeenAt: lastSeen,
      online: isOnline,
      source: 'supabase',
    };
  }

  function normalizeTaskStatus(value, fallback = 'Backlog') {
    const cleaned = cleanString(value);
    const normalized = cleaned.toLowerCase();
    if (normalized === 'new' || normalized === 'backlog' || normalized === 'exported') return 'Backlog';
    if (normalized === 'assigned') return 'Assigned';
    if (normalized === 'in progress' || normalized === 'doing') return 'Doing';
    if (normalized === 'needs review' || normalized === 'review') return 'Review';
    if (normalized === 'done' || normalized === 'complete' || normalized === 'completed') return 'Done';
    // Declined arrives with the request workflow (20261118120000); it is not a
    // kanban column, the board shows it only when such requests exist.
    if (normalized === 'declined' || normalized === 'withdrawn') return 'Declined';
    return TASK_STATUS_COLUMNS.includes(cleaned) ? cleaned : fallback;
  }

  function taskTitleFromRequest(request = {}) {
    return cleanString(request.entities || request.title || request.brief || request.id || 'Design request');
  }

  // Previews loaded from Storage are in-memory blob: URLs that only live for
  // this page session. Keep them out of anything saved locally or synced, so a
  // dead link can never be stored or overwrite the database copy.
  function persistablePreview(value) {
    const preview = cleanString(value);
    return preview.startsWith('blob:') ? '' : preview;
  }

  function persistableMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return {};
    if (!String(metadata.previewDataUrl || '').startsWith('blob:')) return metadata;
    const { previewDataUrl, ...rest } = metadata;
    return rest;
  }

  function normalizeTask(task = {}) {
    const type = task.type === 'exported_design' || task.taskType === 'exported_design'
      ? 'exported_design'
      : 'design_request';
    const id = cleanString(task.id || makeId(type === 'exported_design' ? 'EXP' : 'REQTASK'));
    const sourceId = cleanString(task.sourceId || task.source_id || id);
    const createdAt = cleanString(task.createdAt || task.created_at || new Date().toISOString());
    const updatedAt = cleanString(task.updatedAt || task.updated_at || createdAt);
    const completedAt = cleanString(task.completedAt || task.completed_at || '');
    return {
      id,
      sourceId,
      type,
      title: cleanString(task.title || sourceId || 'Untitled task'),
      status: normalizeTaskStatus(task.status, type === 'exported_design' ? 'Assigned' : 'Backlog'),
      priority: cleanString(task.priority || 'Normal'),
      assignedTo: normalizeEmail(task.assignedTo || task.assigned_to || ''),
      requesterName: cleanString(task.requesterName || task.requester_name || ''),
      requesterEmail: normalizeEmail(task.requesterEmail || task.requester_email || ''),
      creatorName: cleanString(task.creatorName || task.creator_name || ''),
      creatorEmail: normalizeEmail(task.creatorEmail || task.creator_email || ''),
      requestType: cleanString(task.requestType || task.request_type || ''),
      workspace: cleanString(task.workspace || ''),
      workspaceVariant: cleanString(task.workspaceVariant || task.workspace_variant || ''),
      sport: cleanString(task.sport || ''),
      teamOrLeague: cleanString(task.teamOrLeague || task.team_or_league || ''),
      filename: cleanString(task.filename || ''),
      previewDataUrl: persistablePreview(task.previewDataUrl || task.preview_data_url || task.metadata?.previewDataUrl || ''),
      designDueAt: cleanString(task.designDueAt || task.design_due_at || ''),
      publishAt: cleanString(task.publishAt || task.publish_at || ''),
      brief: cleanString(task.brief || ''),
      designCopy: cleanString(task.designCopy || task.design_copy || ''),
      additionalNotes: cleanString(task.additionalNotes || task.additional_notes || ''),
      adminNotes: cleanString(task.adminNotes || task.admin_notes || ''),
      referenceLinks: Array.isArray(task.referenceLinks || task.reference_links)
        ? (task.referenceLinks || task.reference_links).map(cleanString).filter(Boolean)
        : [],
      metadata: persistableMetadata(task.metadata),
      completedAt,
      createdAt,
      updatedAt,
      source: cleanString(task.source || ''),
    };
  }

  function taskFromRequest(request = {}) {
    return normalizeTask({
      id: `task-request-${cleanString(request.id || makeId('REQ'))}`,
      sourceId: request.id,
      type: 'design_request',
      title: taskTitleFromRequest(request),
      status: request.status || 'Backlog',
      priority: request.priority || 'Normal',
      assignedTo: request.assignedTo || '',
      requesterName: request.requester?.name || '',
      requesterEmail: request.requester?.email || '',
      creatorName: request.requester?.name || '',
      creatorEmail: request.requester?.email || '',
      requestType: request.requestType || '',
      workspace: request.publication || request.socialChannel || 'Design Request',
      workspaceVariant: request.requestType || '',
      sport: request.sport || '',
      teamOrLeague: request.teamOrLeague || request.publication || request.socialChannel || '',
      designDueAt: request.designDueAt || '',
      publishAt: request.publishAt || '',
      brief: request.brief || '',
      designCopy: request.designCopy || '',
      additionalNotes: request.additionalNotes || '',
      adminNotes: request.adminNotes || '',
      referenceLinks: request.referenceLinks || [],
      metadata: {
        source: request.source || 'Web Portal',
        // Bot-mode Slack thread: status updates reply here (design-request-update.js).
        ...(request.slack?.ts ? { slackChannel: String(request.slack.channel || ''), slackThreadTs: String(request.slack.ts) } : {}),
        publication: request.publication || '',
        socialChannel: request.socialChannel || '',
        entities: request.entities || '',
      },
      createdAt: request.createdAt || new Date().toISOString(),
      updatedAt: request.updatedAt || request.createdAt || new Date().toISOString(),
      completedAt: request.completedAt || '',
      source: 'local-request',
    });
  }

  function taskFromDesign(design = {}) {
    return normalizeTask({
      id: `task-design-${cleanString(design.id || makeId('DES'))}`,
      sourceId: design.id,
      type: 'exported_design',
      title: design.title || design.filename || 'Exported design',
      status: design.status || 'Assigned',
      priority: design.priority || 'Normal',
      assignedTo: design.assignedTo || '',
      creatorName: design.ownerName || '',
      creatorEmail: design.ownerEmail || '',
      workspace: design.workspace || '',
      workspaceVariant: design.workspaceVariant || '',
      sport: design.sport || '',
      teamOrLeague: design.teamOrLeague || '',
      filename: design.filename || '',
      adminNotes: design.adminNotes || '',
      previewDataUrl: design.previewDataUrl || design.metadata?.previewDataUrl || '',
      metadata: {
        ...(design.metadata && typeof design.metadata === 'object' ? design.metadata : {}),
        filename: design.filename || '',
        previewDataUrl: design.previewDataUrl || design.metadata?.previewDataUrl || '',
      },
      createdAt: design.createdAt || new Date().toISOString(),
      updatedAt: design.updatedAt || design.createdAt || new Date().toISOString(),
      completedAt: design.completedAt || '',
      source: 'local-design',
    });
  }

  function normalizeSupabaseTask(row = {}) {
    // The bulk task list is fetched *without* the (often multi-MB, base64
    // image) metadata.previewDataUrl field — see fetchSupabaseTasks(). When
    // the full `metadata` object isn't present, rebuild a lightweight one
    // from the small aliased sub-fields that fetch *does* select, so
    // getExportDetails() etc. keep working; previewDataUrl stays empty until
    // fetchTaskPreview() lazily loads it for one task at a time.
    const metadata = row.metadata && typeof row.metadata === 'object'
      ? row.metadata
      : {
        exportedAt: row.meta_exported_at || '',
        durationMs: row.meta_duration_ms != null ? Number(row.meta_duration_ms) : undefined,
        outputSize: row.meta_output_size || '',
        mimeType: row.meta_mime_type || '',
        exportScale: row.meta_export_scale || '',
        previewPath: row.meta_preview_path || '',
        ...(row.meta_nl_asset ? { newsletterAsset: row.meta_nl_asset, newsletterAssetLabel: row.meta_nl_asset_label || '' } : {}),
        ...(row.meta_nl_brand ? { newsletterBrand: row.meta_nl_brand, newsletterBrandLabel: row.meta_nl_brand_label || '' } : {}),
        ...(row.meta_format ? { format: row.meta_format } : {}),
      };
    return normalizeTask({
      id: row.id,
      sourceId: row.source_id,
      type: row.task_type,
      title: row.title,
      status: row.status,
      priority: row.priority,
      assignedTo: row.assigned_to,
      requesterName: row.requester_name,
      requesterEmail: row.requester_email,
      creatorName: row.creator_name,
      creatorEmail: row.creator_email,
      requestType: row.request_type,
      workspace: row.workspace,
      workspaceVariant: row.workspace_variant,
      sport: row.sport,
      teamOrLeague: row.team_or_league,
      filename: row.filename,
      designDueAt: row.design_due_at,
      publishAt: row.publish_at,
      brief: row.brief,
      designCopy: row.design_copy,
      additionalNotes: row.additional_notes,
      adminNotes: row.admin_notes,
      referenceLinks: row.reference_links,
      metadata,
      previewDataUrl: row.previewDataUrl || metadata.previewDataUrl || '',
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source: 'supabase',
    });
  }

  function taskToSupabaseRow(task = {}) {
    const normalized = normalizeTask(task);
    const dateOrNull = value => {
      const cleaned = cleanString(value);
      if (!cleaned) return null;
      const date = new Date(cleaned);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    return {
      id: normalized.id,
      source_id: normalized.sourceId,
      task_type: normalized.type,
      title: normalized.title,
      status: normalized.status,
      priority: normalized.priority,
      assigned_to: normalized.assignedTo,
      requester_name: normalized.requesterName,
      requester_email: normalized.requesterEmail,
      creator_name: normalized.creatorName,
      creator_email: normalized.creatorEmail,
      request_type: normalized.requestType,
      workspace: normalized.workspace,
      workspace_variant: normalized.workspaceVariant,
      sport: normalized.sport,
      team_or_league: normalized.teamOrLeague,
      filename: normalized.filename,
      design_due_at: dateOrNull(normalized.designDueAt),
      publish_at: dateOrNull(normalized.publishAt),
      brief: normalized.brief,
      design_copy: normalized.designCopy,
      additional_notes: normalized.additionalNotes,
      admin_notes: normalized.adminNotes,
      reference_links: normalized.referenceLinks,
      metadata: {
        ...(normalized.metadata && typeof normalized.metadata === 'object' ? normalized.metadata : {}),
        previewDataUrl: normalized.previewDataUrl || normalized.metadata?.previewDataUrl || '',
      },
      completed_at: normalized.status === 'Done'
        ? (dateOrNull(normalized.completedAt) || new Date().toISOString())
        : null,
      created_at: dateOrNull(normalized.createdAt) || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  function normalizeActivityRecord(record = {}) {
    return {
      id: cleanString(record.id || makeId('ACT')),
      createdAt: cleanString(record.createdAt || record.created_at || new Date().toISOString()),
      type: cleanString(record.type || record.event_type || 'activity'),
      label: cleanString(record.label || record.type || record.event_type || 'Activity'),
      entityId: cleanString(record.entityId || record.entity_id || ''),
      entityType: cleanString(record.entityType || record.entity_type || ''),
      actorName: cleanString(record.actorName || record.actor_name || ''),
      actorEmail: normalizeEmail(record.actorEmail || record.actor_email || ''),
      meta: record.meta && typeof record.meta === 'object' ? record.meta : {},
      source: cleanString(record.source || ''),
    };
  }

  function normalizeToolFeedback(record = {}) {
    const activity = normalizeActivityRecord(record);
    const meta = activity.meta && typeof activity.meta === 'object' ? activity.meta : {};
    return {
      id: cleanString(activity.entityId || activity.id),
      createdAt: activity.createdAt,
      submitterEmail: normalizeEmail(activity.actorEmail),
      submitterName: cleanString(activity.actorName),
      feedbackType: cleanString(meta.feedbackType || 'Other'),
      tool: cleanString(meta.tool || 'General'),
      message: cleanString(meta.message || ''),
      pageUrl: cleanString(meta.pageUrl || ''),
      status: cleanString(meta.status || 'New'),
      source: cleanString(meta.source || activity.source || 'FrameUp Tool Feedback'),
    };
  }

  function getToolFeedback(activity = []) {
    return mergeActivity(activity)
      .filter(record => record.entityType === 'tool_feedback' || record.type === 'tool_feedback_submitted')
      .map(normalizeToolFeedback)
      .filter(record => record.message)
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }

  function activityToSupabaseRow(record = {}) {
    const normalized = normalizeActivityRecord(record);
    return {
      id: normalized.id,
      event_type: normalized.type,
      label: normalized.label,
      entity_id: normalized.entityId,
      entity_type: normalized.entityType,
      actor_name: normalized.actorName,
      actor_email: normalized.actorEmail,
      meta: normalized.meta,
      created_at: normalized.createdAt,
    };
  }

  function readPendingTasks() {
    const parsed = readJson(PENDING_TASKS_KEY, []);
    return Array.isArray(parsed) ? parsed.map(normalizeTask) : [];
  }

  function queuePendingTask(task) {
    const normalized = normalizeTask(task);
    const next = [normalized, ...readPendingTasks().filter(item => item.id !== normalized.id)].slice(0, 100);
    writeJson(PENDING_TASKS_KEY, next);
    return normalized;
  }

  function removePendingTask(id) {
    writeJson(PENDING_TASKS_KEY, readPendingTasks().filter(item => item.id !== id));
  }

  function readPendingActivity() {
    const parsed = readJson(PENDING_ACTIVITY_KEY, []);
    return Array.isArray(parsed) ? parsed.map(normalizeActivityRecord) : [];
  }

  function queuePendingActivity(record) {
    const normalized = normalizeActivityRecord(record);
    const next = [normalized, ...readPendingActivity().filter(item => item.id !== normalized.id)].slice(0, 150);
    writeJson(PENDING_ACTIVITY_KEY, next);
    return normalized;
  }

  function removePendingActivity(id) {
    writeJson(PENDING_ACTIVITY_KEY, readPendingActivity().filter(item => item.id !== id));
  }

  async function upsertSupabaseProfileAndPresence() {
    // This runs on both the presence-heartbeat timer (fires immediately on
    // es:auth-ready) and inside refreshCloudDashboardData() (also fired at
    // boot, with no delay) - so at boot time both call this within
    // milliseconds of each other. Two concurrent `INSERT ... ON CONFLICT
    // (email) DO UPDATE` on the exact same row raced and one lost, showing
    // up as "new row violates row-level security policy" even though the
    // write itself was legitimate. De-dupe: a call that arrives while one is
    // already in flight just awaits the same promise instead of firing a
    // second concurrent upsert.
    if (presenceUpsertInFlight) return presenceUpsertInFlight;
    presenceUpsertInFlight = runUpsertSupabaseProfileAndPresence()
      .finally(() => { presenceUpsertInFlight = null; });
    return presenceUpsertInFlight;
  }

  async function runUpsertSupabaseProfileAndPresence() {
    const session = await getAuthenticatedSession();
    const client = getSupabaseClient();
    if (!session?.user?.email || !client) return false;

    const profile = getProfileForSession(session);
    const email = normalizeEmail(session.user.email);
    const name = cleanString(profile.name || session.user.name || email.split('@')[0] || 'ES User');
    const designation = designationFromProfile(profile, session.user);
    const accessRole = normalizeAccessRole(profile.accessRole || session.user.accessRole || session.user.role || profile.role, email);
    const avatarUrl = cleanString(profile.avatar || '');
    const now = new Date().toISOString();
    const workspace = getCurrentWorkspaceLabel();
    const pagePath = `${window.location.pathname}${window.location.hash || ''}`;

    const profileRow = {
      email,
      name,
      designation,
      avatar_url: avatarUrl,
      last_seen_at: now,
      updated_at: now,
    };
    const presenceRow = {
      email,
      name,
      designation,
      avatar_url: avatarUrl,
      page_path: pagePath,
      workspace,
      device: currentDevice(),
      last_seen_at: now,
      updated_at: now,
    };

    let profileResult = await client
      .from(SUPABASE_PROFILES_TABLE)
      .upsert(profileRow, { onConflict: 'email' });
    if (profileResult.error && /designation/i.test(profileResult.error.message || '')) {
      const fallbackProfileRow = { ...profileRow };
      delete fallbackProfileRow.designation;
      profileResult = await client
        .from(SUPABASE_PROFILES_TABLE)
        .upsert(fallbackProfileRow, { onConflict: 'email' });
    }
    if (profileResult.error) throw profileResult.error;

    let presenceResult = await client
      .from(SUPABASE_PRESENCE_TABLE)
      .upsert(presenceRow, { onConflict: 'email' });
    if (presenceResult.error && /designation|device/i.test(presenceResult.error.message || '')) {
      // Older databases may lack the designation or device column.
      const fallbackPresenceRow = { ...presenceRow };
      delete fallbackPresenceRow.designation;
      delete fallbackPresenceRow.device;
      presenceResult = await client
        .from(SUPABASE_PRESENCE_TABLE)
        .upsert(fallbackPresenceRow, { onConflict: 'email' });
    }
    if (presenceResult.error) throw presenceResult.error;

    return true;
  }

  async function fetchSupabasePeople() {
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email) return [];

    const [{ data: profiles, error: profileError }, { data: presence, error: presenceError }] = await Promise.all([
      client
        .from(SUPABASE_PROFILES_TABLE)
        .select('*')
        .order('name', { ascending: true }),
      client
        .from(SUPABASE_PRESENCE_TABLE)
        .select('*')
        .order('last_seen_at', { ascending: false }),
    ]);

    if (profileError) throw profileError;
    if (presenceError) throw presenceError;

    const people = new Map();
    (Array.isArray(profiles) ? profiles : []).forEach(row => {
      const person = normalizeCloudPerson(row);
      if (person) people.set(person.email, person);
    });
    (Array.isArray(presence) ? presence : []).forEach(row => {
      const person = normalizeCloudPerson(row);
      if (!person) return;
      const existing = people.get(person.email) || {};
      people.set(person.email, {
        ...existing,
        ...person,
        name: person.name || existing.name,
        designation: person.designation || existing.designation,
        // The profile holds the role; presence rows only mirror it and can
        // lag (or default to Associate), so they never override it.
        role: existing.role || person.role,
        accessRole: existing.accessRole || person.accessRole,
        avatar: person.avatar || existing.avatar,
      });
    });
    return Array.from(people.values());
  }

  // Exported-design rows store their preview image as a base64 data URI
  // inside metadata.previewDataUrl - often several hundred KB to a few MB
  // each. A routine `select('*')` over the whole table means every poll (and
  // every admin's dashboard load) re-downloads every export's full-size
  // image just to show counts and list rows, which is what was blowing the
  // 30MB/58-row es_designer_tasks table up to a real Postgres statement
  // timeout ("Task sync timed out") even after the RLS per-row fix. This
  // list fetch pulls everything the dashboard's list/summary views need
  // *except* that image; fetchTaskPreview() below loads one export's image
  // on demand, once, when a person actually opens it.
  const TASK_LIST_COLUMNS = [
    'id', 'source_id', 'task_type', 'title', 'status', 'priority', 'assigned_to',
    'requester_name', 'requester_email', 'creator_name', 'creator_email',
    'request_type', 'workspace', 'workspace_variant', 'sport', 'team_or_league',
    'filename', 'design_due_at', 'publish_at', 'brief', 'design_copy',
    'additional_notes', 'admin_notes', 'reference_links', 'completed_at',
    'created_at', 'updated_at',
    'meta_exported_at:metadata->>exportedAt',
    'meta_duration_ms:metadata->>durationMs',
    'meta_output_size:metadata->>outputSize',
    'meta_mime_type:metadata->>mimeType',
    'meta_export_scale:metadata->>exportScale',
    'meta_preview_path:metadata->>previewPath',
    // Dashboard → Newsletter (null on older rows and other workspaces).
    'meta_nl_asset:metadata->>newsletterAsset',
    'meta_nl_asset_label:metadata->>newsletterAssetLabel',
    'meta_nl_brand:metadata->>newsletterBrand',
    'meta_nl_brand_label:metadata->>newsletterBrandLabel',
    'meta_format:metadata->>format',
  ].join(',');

  async function fetchSupabaseTasks() {
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email) return [];

    // Supabase returns at most 1,000 rows per request: page through them so
    // the Dashboard keeps every task as the table grows.
    const PAGE = 1000;
    const rows = [];
    for (let from = 0; from < PAGE * 10; from += PAGE) {
      const { data, error } = await client
        .from(SUPABASE_TASKS_TABLE)
        .select(TASK_LIST_COLUMNS)
        .order('updated_at', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(Array.isArray(data) ? data : []));
      if (!Array.isArray(data) || data.length < PAGE) break;
    }
    const tasks = rows.map(normalizeSupabaseTask).filter(task => task.id);

    // If the database shows this person only their own rows (the page treats
    // them as an admin but the database does not), show the team's Social
    // Media exports from the Gallery list so the Dashboard matches the Gallery.
    if (!tasks.some(task => task.type === 'exported_design') && await isCurrentUserAdmin()) {
      const fromGallery = await fetchGalleryExportTasks(client).catch(() => []);
      tasks.push(...fromGallery);
    }
    return tasks;
  }

  async function fetchGalleryExportTasks(client) {
    const tasks = [];
    let before = null;
    for (let page = 0; page < 5; page += 1) {
      const { data, error } = await client.rpc('list_frameup_gallery', { p_limit: 96, p_before: before });
      if (error || !Array.isArray(data) || !data.length) break;
      data.forEach(row => tasks.push(normalizeSupabaseTask({
        id: row.id,
        task_type: 'exported_design',
        title: row.title,
        status: 'Done',
        workspace: GALLERY_WORKSPACE,
        workspace_variant: row.workspace_variant,
        sport: row.sport,
        team_or_league: row.team_or_league,
        creator_name: row.creator_name,
        filename: row.filename,
        created_at: row.exported_at,
        updated_at: row.exported_at,
        meta_exported_at: row.exported_at,
        meta_output_size: row.output_size,
      })));
      if (data.length < 96) break;
      before = data[data.length - 1].exported_at;
    }
    return tasks;
  }

  async function fetchTaskPreview(taskId) {
    const id = cleanString(taskId);
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email || !id) return '';

    // Every export's preview is in Storage, so always look there first; the
    // database copy is only the fallback.
    const cached = cloudTasksCache.find(task => task.id === id);
    const stored = await loadStoragePreview(id);
    if (stored) {
      if (cached) cached.previewDataUrl = stored;
      return stored;
    }

    const { data, error } = await client
      .from(SUPABASE_TASKS_TABLE)
      .select('id, preview:metadata->>previewDataUrl')
      .eq('id', id)
      .maybeSingle();
    if (error || !data?.preview) return '';

    const preview = String(data.preview);
    if (cached) {
      cached.previewDataUrl = preview;
      if (cached.metadata && typeof cached.metadata === 'object') cached.metadata.previewDataUrl = preview;
    }
    return preview;
  }

  async function fetchSupabaseActivity() {
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email) return [];

    const { data, error } = await client
      .from(SUPABASE_ACTIVITY_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(250);

    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(row => normalizeActivityRecord({ ...row, source: 'supabase' }));
  }

  async function upsertSupabaseTask(task = {}) {
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email) return null;
    const row = taskToSupabaseRow(task);
    // Do not request the inserted row back here. Non-admin creators are
    // allowed to insert their own task, but the dashboard read policy only
    // exposes admin-wide data. Requesting a representation would therefore
    // make a valid insert fail under RLS. The server-normalized row is enough
    // for the local cache; admins receive the authoritative row on refresh.
    const { error } = await client
      .from(SUPABASE_TASKS_TABLE)
      .upsert(row, { onConflict: 'id' });
    if (error) throw error;
    return normalizeSupabaseTask({ ...row, source: 'supabase' });
  }

  async function upsertSupabaseActivity(record = {}) {
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email) return null;
    const row = activityToSupabaseRow(record);
    // Activity is append-only for non-admins (update is admin-only under RLS),
    // so a retried write must not take the ON CONFLICT DO UPDATE path:
    // DO NOTHING keeps retries idempotent instead of failing under RLS.
    const { error } = await client
      .from(SUPABASE_ACTIVITY_TABLE)
      .upsert(row, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
    return normalizeActivityRecord({ ...row, source: 'supabase' });
  }

  async function flushPendingCloudWrites() {
    // Same concurrent-call shape as upsertSupabaseProfileAndPresence above
    // (called from both the heartbeat and refreshCloudDashboardData) - dedupe
    // so two overlapping flushes don't both grab the same pending items and
    // upsert them concurrently.
    if (pendingFlushInFlight) return pendingFlushInFlight;
    pendingFlushInFlight = runFlushPendingCloudWrites()
      .finally(() => { pendingFlushInFlight = null; });
    return pendingFlushInFlight;
  }

  async function runFlushPendingCloudWrites() {
    const session = await getAuthenticatedSession();
    if (!session?.user?.email || !getSupabaseClient()) return { tasks: 0, activity: 0 };

    let syncedTasks = 0;
    for (const task of readPendingTasks()) {
      try {
        const saved = await upsertSupabaseTask(task);
        if (saved) {
          removePendingTask(task.id);
          cloudTasksCache = mergeTasks([saved], cloudTasksCache);
          uploadFullPreview(task);
          syncedTasks += 1;
        }
      } catch (error) {
        break;
      }
    }

    let syncedActivity = 0;
    for (const record of readPendingActivity()) {
      try {
        const saved = await upsertSupabaseActivity(record);
        if (saved) {
          removePendingActivity(record.id);
          cloudActivityCache = mergeActivity([saved], cloudActivityCache);
          syncedActivity += 1;
        }
      } catch (error) {
        break;
      }
    }
    return { tasks: syncedTasks, activity: syncedActivity };
  }

  async function updateSupabaseTask(id, fields = {}) {
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email) return null;
    const patch = {};
    if ('status' in fields) {
      patch.status = normalizeTaskStatus(fields.status);
      patch.completed_at = patch.status === 'Done' ? new Date().toISOString() : null;
    }
    if ('assignedTo' in fields) patch.assigned_to = normalizeEmail(fields.assignedTo);
    if ('priority' in fields) patch.priority = cleanString(fields.priority || 'Normal');
    if ('adminNotes' in fields) patch.admin_notes = cleanString(fields.adminNotes);
    const safeDate = value => {
      const cleaned = cleanString(value);
      if (!cleaned) return null;
      const date = new Date(cleaned);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    if ('designDueAt' in fields) patch.design_due_at = safeDate(fields.designDueAt);
    if ('publishAt' in fields) patch.publish_at = safeDate(fields.publishAt);
    patch.updated_at = new Date().toISOString();

    const { data, error } = await client
      .from(SUPABASE_TASKS_TABLE)
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return normalizeSupabaseTask(data);
  }

  // presence: false skips the profile upsert and pending flush (the presence
  // heartbeat already does both every 20 s); the dashboard's live sync uses it.
  async function refreshCloudDashboardData({ silent = true, fetchPeople = /dashboard\.html$/i.test(window.location.pathname), presence = true } = {}) {
    if (cloudRefreshInFlight) return cloudRefreshInFlight;
    cloudRefreshInFlight = (async () => {
      try {
        // These calls used to run one after another (profile upsert, then
        // pending-write flush, then the people/tasks/activity fetch) even
        // though none of them depend on another's result. At ~0.4-1.6s per
        // Supabase round trip, that serial chain was the main contributor to
        // slow dashboard load times. Run everything concurrently instead.
        const tasks = presence ? [
          withRejectingTimeout(upsertSupabaseProfileAndPresence(), 5000, 'Profile sync'),
          withRejectingTimeout(flushPendingCloudWrites(), 8000, 'Pending dashboard sync'),
        ] : [Promise.resolve(null), Promise.resolve(null)];
        if (fetchPeople) {
          tasks.push(
            withRejectingTimeout(fetchSupabasePeople(), 7000, 'People sync'),
            withRejectingTimeout(fetchSupabaseTasks(), 7000, 'Task sync'),
            withRejectingTimeout(fetchSupabaseActivity(), 7000, 'Activity sync'),
          );
        }
        const results = await Promise.allSettled(tasks);

        if (fetchPeople) {
          const [, , peopleResult, tasksResult, activityResult] = results;
          if (peopleResult.status === 'fulfilled') cloudPeopleCache = peopleResult.value;
          if (tasksResult.status === 'fulfilled') cloudTasksCache = tasksResult.value;
          if (activityResult.status === 'fulfilled') cloudActivityCache = activityResult.value;
        }

        const errors = results
          .filter(result => result.status === 'rejected')
          .map(result => cleanString(result.reason?.message || 'Unknown Supabase sync error'));
        if (errors.length) throw new Error(errors.join(' '));

        if (fetchPeople) {
          cloudSyncStatus = {
            ok: true,
            message: '',
            checkedAt: new Date().toISOString(),
          };
          emitDashboardChange('cloud-people', { people: cloudPeopleCache });
          emitDashboardChange('cloud-tasks', { tasks: cloudTasksCache });
          emitDashboardChange('cloud-activity', { activity: cloudActivityCache });
        }
        return cloudPeopleCache;
      } catch (error) {
        cloudSyncStatus = {
          ok: false,
          message: cleanString(error?.message || 'Supabase dashboard data could not be loaded.'),
          checkedAt: new Date().toISOString(),
        };
        emitDashboardChange('cloud-error', { message: cloudSyncStatus.message });
        if (!silent) throw error;
        return cloudPeopleCache;
      } finally {
        cloudRefreshInFlight = null;
      }
    })();
    return cloudRefreshInFlight;
  }

  async function recordPresenceHeartbeat() {
    try {
      const wrote = await upsertSupabaseProfileAndPresence();
      if (!wrote) return false; // signed out or auth not ready yet
      await flushPendingCloudWrites();
      return true;
    } catch (error) {
      return false;
    }
  }

  function shouldRunSupabasePresence() {
    return Boolean(window.ESAuth?.getSupabaseClient);
  }

  function scheduleSupabasePresence() {
    if (!shouldRunSupabasePresence()) return;
    // At boot pageshow, focus, es:auth-ready and the first timer all fired a
    // beat within ~2 s (three profile upserts and three pending flushes per
    // page view). Now one beat runs at a time, and a beat within
    // PRESENCE_MIN_GAP_MS of the last successful one is skipped unless it
    // carries news (sign-in change, a new route).
    let lastBeatAt = 0;
    let beatInFlight = null;
    const beat = ({ force = false } = {}) => {
      if (document.visibilityState === 'hidden' || beatInFlight) return;
      if (!force && Date.now() - lastBeatAt < PRESENCE_MIN_GAP_MS) return;
      beatInFlight = recordPresenceHeartbeat()
        .then(ok => { if (ok) lastBeatAt = Date.now(); })
        .finally(() => { beatInFlight = null; });
    };
    const start = () => {
      if (presenceTimer) return;
      window.setTimeout(() => beat(), 1800);
      presenceTimer = window.setInterval(() => beat(), PRESENCE_HEARTBEAT_MS);
    };
    window.addEventListener('es:auth-ready', start);
    window.addEventListener('focus', () => beat());
    window.addEventListener('pageshow', () => beat());
    window.addEventListener('hashchange', () => window.setTimeout(() => beat({ force: true }), 0));
    window.addEventListener('es:auth-ready', () => beat());
    window.addEventListener('es:auth-updated', () => beat({ force: true }));
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => window.setTimeout(start, 0), { once: true });
    } else {
      window.setTimeout(start, 0);
    }
  }

  async function showAdminNavigation() {
    const allowed = await isCurrentUserAdmin();
    document.querySelectorAll('[data-admin-only]').forEach(element => {
      element.hidden = !allowed;
      element.setAttribute('aria-hidden', allowed ? 'false' : 'true');
      element.classList.toggle('is-admin-visible', allowed);
    });
    document.documentElement.classList.toggle('has-dashboard-admin', allowed);
    return allowed;
  }

  function scheduleAdminNavigationChecks() {
    const run = () => {
      if (document.readyState === 'loading') return;
      showAdminNavigation().catch(() => {});
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        window.setTimeout(run, 0);
      }, { once: true });
    } else {
      window.setTimeout(run, 0);
    }
    window.addEventListener('focus', run);
    window.addEventListener('pageshow', () => window.setTimeout(run, 0));
    window.addEventListener('storage', event => {
      if (!event.key || [AUTH_KEY, PROFILE_KEY, ADMIN_CONFIG_KEY].includes(event.key)) run();
    });
    window.addEventListener('es:auth-updated', () => window.setTimeout(run, 0));
  }

  function readDesignRequests() {
    const parsed = readJson(REQUESTS_KEY, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function writeDesignRequests(requests) {
    return writeJson(REQUESTS_KEY, Array.isArray(requests) ? requests : []);
  }

  function readDesigns() {
    const parsed = readJson(DESIGNS_KEY, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function writeDesigns(designs) {
    return writeJson(DESIGNS_KEY, Array.isArray(designs) ? designs : []);
  }

  function readTasks() {
    const parsed = readJson(TASKS_KEY, []);
    return Array.isArray(parsed) ? parsed.map(normalizeTask) : [];
  }

  function writeTasks(tasks) {
    return writeJson(TASKS_KEY, Array.isArray(tasks) ? tasks.map(normalizeTask) : []);
  }

  function readActivity() {
    const parsed = readJson(ACTIVITY_KEY, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function writeActivity(activity) {
    return writeJson(ACTIVITY_KEY, Array.isArray(activity) ? activity : []);
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function mergeTasks(...taskGroups) {
    const tasks = new Map();
    taskGroups.flat().filter(Boolean).map(normalizeTask).forEach(task => {
      const existing = tasks.get(task.id);
      if (!existing || task.source === 'supabase' || !existing.source) {
        tasks.set(task.id, { ...existing, ...task });
      }
    });
    return Array.from(tasks.values()).sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
  }

  function mergeActivity(...activityGroups) {
    const records = new Map();
    activityGroups.flat().filter(Boolean).map(normalizeActivityRecord).forEach(record => {
      const existing = records.get(record.id);
      if (!existing || record.source === 'supabase' || !existing.source) {
        records.set(record.id, { ...existing, ...record });
      }
    });
    return Array.from(records.values())
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
      .slice(0, 250);
  }

  function getLocalTaskFallbacks({ requests = readDesignRequests(), designs = readDesigns() } = {}) {
    return mergeTasks(
      readTasks(),
      requests.map(taskFromRequest),
      designs.map(taskFromDesign),
    );
  }

  function emitDashboardChange(type, detail = {}) {
    try {
      window.dispatchEvent(new CustomEvent('es-dashboard-data-change', {
        detail: { type, ...detail },
      }));
    } catch (error) {
      // Local refresh events are helpful, not required.
    }
  }

  async function recordActivity(event = {}) {
    const user = await getCurrentUser();
    const activity = readActivity();
    const record = {
      id: makeId('ACT'),
      createdAt: new Date().toISOString(),
      type: cleanString(event.type || 'activity'),
      label: cleanString(event.label || event.type || 'Activity'),
      entityId: cleanString(event.entityId || ''),
      entityType: cleanString(event.entityType || ''),
      actorName: cleanString(event.actorName || user.name),
      actorEmail: normalizeEmail(event.actorEmail || user.email),
      meta: event.meta && typeof event.meta === 'object' ? event.meta : {},
    };
    writeActivity(mergeActivity([record], activity));
    queuePendingActivity(record);
    await upsertSupabaseActivity(record)
      .then(saved => {
        if (!saved) return;
        removePendingActivity(record.id);
        cloudActivityCache = mergeActivity([saved], cloudActivityCache);
      })
      .catch(error => {
        cloudSyncStatus = {
          ok: false,
          message: cleanString(error?.message || 'Dashboard activity is waiting to sync.'),
          checkedAt: new Date().toISOString(),
        };
      });
    emitDashboardChange('activity', { record });
    return record;
  }

  // "mobile" for phone-sized touch screens, else "desktop" (exports and presence).
  function currentDevice() {
    try {
      return window.matchMedia('(max-width: 900px) and (pointer: coarse)').matches ? 'mobile' : 'desktop';
    } catch (error) {
      return '';
    }
  }

  function generatedFrom() {
    try {
      return window.FrameUpSpec?.generatedFor?.() || null;
    } catch (error) {
      return null;
    }
  }

  // Dashboard → Usage (frameup-track.js): every editor export, whichever page
  // made it. Fire-and-forget; inside an iframe (Generate's renderer) the
  // tracker is off and the page that owns the button logs instead.
  function trackDesignExport(record) {
    try {
      const tracker = window.FrameUpTrack;
      if (!tracker?.track) return;
      const mime = String(record.metadata?.mimeType || '').toLowerCase();
      const format = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'image';
      const meta = {
        // Dashboard -> Exports loads this export's preview from its task.
        task: `task-design-${record.id}`,
        from: record.metadata?.generated ? 'generate' : '',
        // Newsletter exports: asset id and newsletter brand.
        asset: record.metadata?.newsletterAsset || '',
        brand: record.metadata?.newsletterBrand || '',
        brandLabel: record.metadata?.newsletterBrandLabel || '',
      };
      const size = String(record.metadata?.outputSize || '').replace(/\s*×\s*/, 'x').replace(/px$/, '');
      if (tracker.exported) {
        tracker.exported({
          tool: tracker.toolForWorkspace(record.workspace),
          format,
          label: record.title,
          dest: 'download',
          width: record.metadata?.imageWidth,
          height: record.metadata?.imageHeight,
          template: record.workspaceVariant,
          meta: { ...meta, ...(record.metadata?.imageWidth ? {} : { size }), file: record.filename },
        });
      } else {
        tracker.track('export', { tool: tracker.toolForWorkspace(record.workspace), action: format, label: record.title, meta: { template: record.workspaceVariant, size, ...meta } });
      }
    } catch (error) {
      // Tracking never blocks an export.
    }
  }

  async function recordDesignExport(payload = {}) {
    const design = payload.design && typeof payload.design === 'object' ? payload.design : null;
    const user = await getCurrentUser();
    const designs = readDesigns();
    const createdAt = new Date().toISOString();
    const filename = cleanString(payload.filename);
    const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    const durationMs = Number(payload.durationMs ?? metadata.durationMs);
    const imageWidth = Number(payload.imageWidth ?? metadata.imageWidth);
    const imageHeight = Number(payload.imageHeight ?? metadata.imageHeight);
    const record = {
      id: makeId('DES'),
      createdAt,
      workspace: cleanString(payload.workspace || 'workspace'),
      workspaceVariant: cleanString(payload.workspaceVariant || ''),
      title: cleanString(payload.title || filename || 'Untitled design'),
      sport: cleanString(payload.sport || ''),
      teamOrLeague: cleanString(payload.teamOrLeague || ''),
      ownerEmail: normalizeEmail(payload.ownerEmail || user.email),
      ownerName: cleanString(payload.ownerName || user.name),
      filename,
      previewDataUrl: cleanString(payload.previewDataUrl || ''),
      status: cleanString(payload.status || 'Exported'),
      assignedTo: cleanString(payload.assignedTo || ''),
      metadata: {
        ...metadata,
        exportedAt: cleanString(payload.exportedAt || metadata.exportedAt || createdAt),
        durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : '',
        imageWidth: Number.isFinite(imageWidth) && imageWidth > 0 ? Math.round(imageWidth) : '',
        imageHeight: Number.isFinite(imageHeight) && imageHeight > 0 ? Math.round(imageHeight) : '',
        outputSize: cleanString(payload.outputSize || metadata.outputSize || (Number.isFinite(imageWidth) && Number.isFinite(imageHeight) ? `${Math.round(imageWidth)} × ${Math.round(imageHeight)}px` : '')),
        exportScale: payload.exportScale || metadata.exportScale || '',
        mimeType: cleanString(payload.mimeType || metadata.mimeType || ''),
        previewDataUrl: cleanString(payload.previewDataUrl || metadata.previewDataUrl || ''),
        device: currentDevice(),
        // Made from a Generate design: the brief, so Generate can learn from it.
        ...(generatedFrom() ? { generated: generatedFrom() } : {}),
      },
    };
    writeDesigns([record, ...designs].slice(0, 500));
    trackDesignExport(record);
    const task = taskFromDesign(record);
    if (task.previewDataUrl) task.metadata = { ...task.metadata, previewPath: fullPreviewPath(task.id) };
    writeTasks(mergeTasks([task], readTasks()).slice(0, 750));
    queuePendingTask(task);
    await upsertSupabaseTask(design ? { ...task, metadata: { ...task.metadata, design } } : task)
      .then(saved => {
        if (saved) {
          removePendingTask(task.id);
          cloudTasksCache = mergeTasks([saved], cloudTasksCache);
          emitDashboardChange('task', { record: saved });
          uploadGalleryThumb(task);
          uploadFullPreview(task);
        }
      })
      .catch(error => {
        cloudSyncStatus = {
          ok: false,
          message: cleanString(error?.message || 'The export could not be shared with the dashboard.'),
          checkedAt: new Date().toISOString(),
        };
      });
    emitDashboardChange('design', { record });
    await recordActivity({
      type: 'design_exported',
      label: `Exported ${record.title}`,
      entityType: 'design',
      entityId: record.id,
      meta: { workspace: record.workspace, filename: record.filename },
    });
    return record;
  }

  async function recordDesignRequest(request = {}) {
    const user = await getCurrentUser();
    const task = normalizeTask({
      ...taskFromRequest(request),
      creatorName: user.name,
      creatorEmail: user.email,
    });
    writeTasks(mergeTasks([task], readTasks()).slice(0, 750));
    queuePendingTask(task);
    emitDashboardChange('task', { record: task });
    await upsertSupabaseTask(task)
      .then(saved => {
        if (saved) {
          removePendingTask(task.id);
          cloudTasksCache = mergeTasks([saved], cloudTasksCache);
          emitDashboardChange('task', { record: saved });
        }
      })
      .catch(error => {
        cloudSyncStatus = {
          ok: false,
          message: cleanString(error?.message || 'The request could not be shared with the dashboard.'),
          checkedAt: new Date().toISOString(),
        };
      });
    return task;
  }

  async function updateRequestAdminFields(id, fields = {}) {
    const requests = readDesignRequests();
    let updated = null;
    const next = requests.map(request => {
      if (request.id !== id) return request;
      updated = {
        ...request,
        status: cleanString(fields.status || request.status || 'New'),
        assignedTo: cleanString(fields.assignedTo ?? request.assignedTo ?? ''),
        adminNotes: String(fields.adminNotes ?? request.adminNotes ?? '').trim(),
        updatedAt: new Date().toISOString(),
      };
      return updated;
    });
    if (!updated) return null;
    writeDesignRequests(next);
    const task = taskFromRequest(updated);
    writeTasks(mergeTasks([task], readTasks()));
    updateSupabaseTask(task.id, fields)
      .then(saved => {
        if (saved) {
          cloudTasksCache = mergeTasks([saved], cloudTasksCache);
          emitDashboardChange('task', { record: saved });
        }
      })
      .catch(() => {});
    emitDashboardChange('request', { record: updated });
    await recordActivity({
      type: 'request_updated',
      label: `Updated request ${id}`,
      entityType: 'request',
      entityId: id,
      meta: { status: updated.status, assignedTo: updated.assignedTo },
    });
    return updated;
  }

  async function updateDesignAdminFields(id, fields = {}) {
    const designs = readDesigns();
    let updated = null;
    const next = designs.map(design => {
      if (design.id !== id) return design;
      updated = {
        ...design,
        status: cleanString(fields.status || design.status || 'Exported'),
        assignedTo: cleanString(fields.assignedTo ?? design.assignedTo ?? ''),
        updatedAt: new Date().toISOString(),
      };
      return updated;
    });
    if (!updated) return null;
    writeDesigns(next);
    const task = taskFromDesign(updated);
    writeTasks(mergeTasks([task], readTasks()));
    updateSupabaseTask(task.id, fields)
      .then(saved => {
        if (saved) {
          cloudTasksCache = mergeTasks([saved], cloudTasksCache);
          emitDashboardChange('task', { record: saved });
        }
      })
      .catch(() => {});
    emitDashboardChange('design', { record: updated });
    await recordActivity({
      type: 'design_updated',
      label: `Updated design ${updated.title || id}`,
      entityType: 'design',
      entityId: id,
      meta: { status: updated.status, assignedTo: updated.assignedTo },
    });
    return updated;
  }

  async function updateTaskAdminFields(id, fields = {}) {
    const currentState = getDashboardState();
    const existing = currentState.tasks.find(task => task.id === id);
    if (!existing) return null;
    const updated = normalizeTask({
      ...existing,
      status: 'status' in fields ? fields.status : existing.status,
      assignedTo: 'assignedTo' in fields ? fields.assignedTo : existing.assignedTo,
      priority: 'priority' in fields ? fields.priority : existing.priority,
      adminNotes: 'adminNotes' in fields ? fields.adminNotes : existing.adminNotes,
      designDueAt: 'designDueAt' in fields ? fields.designDueAt : existing.designDueAt,
      publishAt: 'publishAt' in fields ? fields.publishAt : existing.publishAt,
      completedAt: normalizeTaskStatus(fields.status || existing.status) === 'Done' ? (existing.completedAt || new Date().toISOString()) : '',
      updatedAt: new Date().toISOString(),
    });
    writeTasks(mergeTasks([updated], readTasks()));
    if (updated.type === 'design_request') {
      const requests = readDesignRequests();
      writeDesignRequests(requests.map(request => request.id === updated.sourceId ? {
        ...request,
        status: updated.status,
        assignedTo: updated.assignedTo,
        priority: updated.priority,
        adminNotes: updated.adminNotes,
        designDueAt: updated.designDueAt || request.designDueAt,
        publishAt: updated.publishAt || request.publishAt,
        updatedAt: updated.updatedAt,
      } : request));
    }
    if (updated.type === 'exported_design') {
      const designs = readDesigns();
      writeDesigns(designs.map(design => design.id === updated.sourceId ? {
        ...design,
        status: updated.status,
        assignedTo: updated.assignedTo,
        priority: updated.priority,
        adminNotes: updated.adminNotes,
        updatedAt: updated.updatedAt,
      } : design));
    }
    emitDashboardChange('task', { record: updated });
    queuePendingTask(updated);
    const saved = await updateSupabaseTask(id, fields).catch(() => null);
    if (saved) {
      removePendingTask(updated.id);
      cloudTasksCache = mergeTasks([saved], cloudTasksCache);
      emitDashboardChange('task', { record: saved });
      // The database logged the change (request workflow trigger); ask the
      // server to post it to the request's Slack thread. Best effort.
      if (saved.type === 'design_request') notifyRequestChange(saved.id);
    }
    await recordActivity({
      type: 'task_updated',
      label: `Updated ${updated.title}`,
      entityType: 'task',
      entityId: updated.id,
      meta: { status: updated.status, assignedTo: updated.assignedTo },
    });
    return saved || updated;
  }

  function notifyRequestChange(taskId) {
    if (!window.ESAuth?.fetchWithAuth || !taskId) return;
    window.ESAuth.fetchWithAuth('/api/design-request-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notify', requestId: taskId }),
    }).catch(() => null);
    try { window.sessionStorage.removeItem('frameup.requestCount.v1'); } catch (error) { /* ignore */ }
  }

  function isMissingRpc(error, name) {
    const message = String(error?.message || '').toLowerCase();
    const code = String(error?.code || '');
    return code === 'PGRST202' || code === '42883'
      || (message.includes(name) && (message.includes('could not find') || message.includes('does not exist') || message.includes('schema cache')));
  }

  // Server error → Error with a stable `code` from the RPC's HINT.
  function roleRpcError(error, fallback) {
    const next = new Error(String(error?.message || fallback || 'Something went wrong.'));
    next.code = String(error?.hint || error?.code || 'unknown');
    return next;
  }

  async function updatePersonAccessRole(email, role) {
    const normalizedEmail = normalizeEmail(email);
    const accessRole = cleanString(role);
    if (!normalizedEmail) throw new Error('Missing person email.');
    if (!ACCESS_ROLES.includes(accessRole)) throw Object.assign(new Error('Choose Associate, Admin, Super Admin or Server Owner.'), { code: 'invalid_role' });
    const actor = await getCurrentUser();
    if (!await canCurrentUserAssignRoles()) {
      throw Object.assign(new Error('Only a Server Owner can change roles.'), { code: 'not_allowed' });
    }
    if (normalizeEmail(actor.email) === normalizedEmail) {
      throw Object.assign(new Error('You can’t change your own role. Ask another Server Owner.'), { code: 'self_change' });
    }
    if (DEFAULT_ROLE_ASSIGNMENTS[normalizedEmail] && DEFAULT_ROLE_ASSIGNMENTS[normalizedEmail] !== accessRole) {
      throw Object.assign(new Error('Protected system role cannot be changed here.'), { code: 'protected' });
    }

    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase is not connected.');
    // Preferred: the guarded, audited RPC (migration 20261120120000).
    let result = await client.rpc('admin_set_es_designer_role', {
      target_email: normalizedEmail,
      target_role: accessRole,
    });
    if (result.error && isMissingRpc(result.error, 'admin_set_es_designer_role')) {
      // Before that migration: the older owner-only RPC.
      result = await client.rpc('set_es_designer_access_role', {
        target_email: normalizedEmail,
        target_role: accessRole,
      });
    }
    if (result.error) throw roleRpcError(result.error, 'Role could not be updated.');

    const row = result.data && typeof result.data === 'object' ? result.data : {};
    const person = normalizeCloudPerson({
      ...(cloudPeopleCache.find(item => normalizeEmail(item.email) === normalizedEmail) || {}),
      ...row,
      email: normalizedEmail,
      access_role: row.access_role || row.role || accessRole,
      role: row.access_role || row.role || accessRole,
      updated_at: new Date().toISOString(),
    });
    if (person) {
      cloudPeopleCache = [
        person,
        ...cloudPeopleCache.filter(item => normalizeEmail(item.email) !== normalizedEmail),
      ];
    }
    emitDashboardChange('person-role', { email: normalizedEmail, role: accessRole });
    await recordActivity({
      type: 'person_role_updated',
      label: `Changed ${normalizedEmail} to ${accessRole}`,
      entityType: 'person',
      entityId: normalizedEmail,
      meta: { role: accessRole },
    });
    return person;
  }

  // Everyone with an account or profile, with sign-up status, from the
  // admin-only RPC. Returns { people, source: 'directory' } or, before the
  // migration, { people: [], source: 'unavailable' } so the page falls back
  // to profiles + presence.
  async function fetchPeopleDirectory() {
    const client = getSupabaseClient();
    if (!client) return { people: [], source: 'unavailable' };
    const result = await withRejectingTimeout(client.rpc('admin_list_es_designer_people'), 8000, 'People list');
    if (result.error) {
      if (isMissingRpc(result.error, 'admin_list_es_designer_people')) return { people: [], source: 'unavailable' };
      throw roleRpcError(result.error, 'Couldn’t load people.');
    }
    const people = (Array.isArray(result.data) ? result.data : []).map(row => {
      const email = normalizeEmail(row.email);
      if (!email) return null;
      const lastSeen = row.last_seen_at || '';
      const lastSeenMs = Date.parse(lastSeen);
      return {
        email,
        name: cleanString(row.name || email.split('@')[0]),
        designation: cleanString(row.designation || ''),
        accessRole: normalizeAccessRole(row.access_role, email),
        avatar: cleanString(row.avatar_url || ''),
        workspace: cleanString(row.workspace || ''),
        lastSeenAt: lastSeen,
        online: Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs <= PRESENCE_ONLINE_WINDOW_MS,
        accountCreatedAt: row.account_created_at || '',
        emailConfirmedAt: row.email_confirmed_at || '',
        invitedAt: row.invited_at || '',
        lastSignInAt: row.last_sign_in_at || '',
        hasAccount: row.has_account === true,
        isFixedRole: row.is_fixed_role === true || Boolean(DEFAULT_ROLE_ASSIGNMENTS[email]),
        source: 'directory',
      };
    }).filter(Boolean);
    return { people, source: 'directory' };
  }

  async function confirmPersonEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new Error('Missing person email.');
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase is not connected.');
    const result = await client.rpc('admin_confirm_es_designer_email', { target_email: normalizedEmail });
    if (result.error) {
      if (isMissingRpc(result.error, 'admin_confirm_es_designer_email')) {
        throw Object.assign(new Error('Manual confirmation needs the People migration (20261120120000) to be run first.'), { code: 'unavailable' });
      }
      throw roleRpcError(result.error, 'Couldn’t confirm this account.');
    }
    emitDashboardChange('person-confirmed', { email: normalizedEmail });
    return result.data || { email: normalizedEmail, confirmed: true };
  }

  async function fetchRoleAudit({ limit = 20 } = {}) {
    const client = getSupabaseClient();
    if (!client) return { entries: [], source: 'unavailable' };
    const result = await client
      .from('es_designer_role_audit')
      .select('id,action,actor_email,target_email,from_value,to_value,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (result.error) return { entries: [], source: 'unavailable' };
    return { entries: Array.isArray(result.data) ? result.data : [], source: 'audit' };
  }

  function getPeople({ requests = readDesignRequests(), designs = readDesigns(), tasks = [] } = {}) {
    const people = new Map();
    const add = (email, name, role = '', extras = {}) => {
      const normalized = normalizeEmail(email);
      if (!normalized) return;
      const existing = people.get(normalized) || {};
      const accessRole = normalizeAccessRole(extras.accessRole || extras.access_role || role || existing.accessRole || existing.role, normalized);
      const designation = cleanString(extras.designation || existing.designation || (ACCESS_ROLES.includes(cleanString(role)) ? '' : role) || 'Designer');
      people.set(normalized, {
        ...existing,
        ...extras,
        email: normalized,
        name: cleanString(name || existing.name || normalized.split('@')[0]),
        designation,
        role: accessRole,
        accessRole,
      });
    };

    cloudPeopleCache.forEach(person => {
      add(person.email, person.name, person.role, {
        designation: person.designation || '',
        accessRole: person.accessRole || person.role || '',
        avatar: person.avatar || '',
        workspace: person.workspace || '',
        lastSeenAt: person.lastSeenAt || '',
        online: Boolean(person.online),
        source: person.source || 'supabase',
      });
    });

    const session = readJson(AUTH_KEY, null);
    const profile = getStoredProfile();
    if (normalizeEmail(profile.email) === normalizeEmail(session?.user?.email)) {
      add(profile.email, profile.name, profile.accessRole || profile.role, { designation: designationFromProfile(profile, {}) });
    }
    add(session?.user?.email, session?.user?.name, session?.user?.accessRole || session?.user?.role, { designation: designationFromProfile({}, session?.user || {}) });

    requests.forEach(request => {
      add(request.requester?.email, request.requester?.name, 'Associate', { designation: 'Requester' });
      add(request.assignedTo, request.assignedTo, 'Associate', { designation: 'Owner' });
    });
    designs.forEach(design => {
      add(design.ownerEmail, design.ownerName, 'Associate', { designation: 'Creator' });
      add(design.assignedTo, design.assignedTo, 'Associate', { designation: 'Owner' });
    });
    tasks.forEach(task => {
      add(task.requesterEmail, task.requesterName, 'Associate', { designation: 'Requester' });
      add(task.creatorEmail, task.creatorName, 'Associate', { designation: task.type === 'exported_design' ? 'Creator' : 'Requester' });
      add(task.assignedTo, task.assignedTo, 'Associate', { designation: 'Owner' });
    });

    Object.entries(DEFAULT_ROLE_ASSIGNMENTS).forEach(([email, role]) => add(email, email.split('@')[0], role, { designation: 'Design Operations' }));
    const config = getAdminConfig();
    config.adminEmails.forEach(email => add(email, email.split('@')[0], DEFAULT_ROLE_ASSIGNMENTS[email] || 'Admin', { designation: 'Design Operations' }));
    config.ownerEmails.forEach(email => add(email, email.split('@')[0], 'Admin', { designation: 'Owner' }));
    return Array.from(people.values()).sort((a, b) => {
      if (Boolean(a.online) !== Boolean(b.online)) return a.online ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  function getDashboardState() {
    const requests = readDesignRequests();
    const designs = readDesigns();
    const activity = mergeActivity(cloudActivityCache, readActivity());
    const tasks = mergeTasks(cloudTasksCache, getLocalTaskFallbacks({ requests, designs }));
    return {
      requests,
      designs,
      tasks,
      taskStatusColumns: [...TASK_STATUS_COLUMNS],
      activity,
      toolFeedback: getToolFeedback(activity),
      people: getPeople({ requests, designs, tasks }),
      adminConfig: getAdminConfig(),
      cloudSyncStatus: { ...cloudSyncStatus },
    };
  }

  function saveDashboardState(state = {}) {
    if (Array.isArray(state.requests)) writeDesignRequests(state.requests);
    if (Array.isArray(state.designs)) writeDesigns(state.designs);
    if (Array.isArray(state.tasks)) writeTasks(state.tasks);
    if (Array.isArray(state.activity)) writeActivity(state.activity);
    emitDashboardChange('state');
    return getDashboardState();
  }

  // ─── Gallery (team-wide exported Social Media posts) ─────────────────────
  // Approved ES users read the gallery through two SECURITY DEFINER RPCs that
  // expose only safe fields (see supabase/migrations/*_add_frameup_gallery.sql).
  // Until that migration is applied, admins fall back to their existing task
  // access; without Supabase (local preview), this browser's own exports show.
  const GALLERY_WORKSPACE = 'Social Media';

  function normalizeGalleryItem(item = {}) {
    return {
      id: cleanString(item.id),
      title: cleanString(item.title || 'Untitled post'),
      variant: cleanString(item.workspace_variant || item.workspaceVariant || ''),
      sport: cleanString(item.sport || ''),
      team: cleanString(item.team_or_league || item.teamOrLeague || ''),
      creator: cleanString(item.creator_name || item.creatorName || ''),
      filename: cleanString(item.filename || ''),
      outputSize: cleanString(item.output_size || item.outputSize || item.metadata?.outputSize || ''),
      workspace: cleanString(item.workspace || GALLERY_WORKSPACE),
      hasDesign: item.has_design === true || item.hasDesign === true || Boolean(item.metadata?.design),
      exportedAt: cleanString(item.exported_at || item.exportedAt || item.metadata?.exportedAt || item.createdAt || item.created_at || ''),
      previewDataUrl: cleanString(item.previewDataUrl || item.metadata?.previewDataUrl || ''),
    };
  }

  function isGalleryRpcMissing(error) {
    return /could not find the function|schema cache|does not exist/i.test(String(error?.message || ''));
  }

  async function fetchGalleryExports({ limit = 48, before = null } = {}) {
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (client && session?.user?.email) {
      const { data, error } = await client.rpc('list_frameup_gallery', { p_limit: limit, p_before: before });
      if (!error) return { items: (data || []).map(normalizeGalleryItem), source: 'gallery' };
      console.warn('[gallery] list_frameup_gallery failed:', error);
      if (await isCurrentUserAdmin()) {
        const tasks = await fetchSupabaseTasks();
        const items = tasks
          .filter(task => task.type === 'exported_design' && task.workspace === GALLERY_WORKSPACE)
          .map(normalizeGalleryItem)
          .sort((a, b) => String(b.exportedAt).localeCompare(String(a.exportedAt)))
          .filter(item => !before || item.exportedAt < before)
          .slice(0, limit);
        return { items, source: 'admin' };
      }
      if (!isGalleryRpcMissing(error)) throw error;
      return { items: [], source: 'not-ready' };
    }
    const items = readTasks()
      .filter(task => task.type === 'exported_design' && task.workspace === GALLERY_WORKSPACE)
      .map(normalizeGalleryItem)
      .sort((a, b) => String(b.exportedAt).localeCompare(String(a.exportedAt)))
      .filter(item => !before || item.exportedAt < before)
      .slice(0, limit);
    return { items, source: 'local' };
  }

  // Small thumbnails live in a private Storage bucket (thumbs/<task id>.webp)
  // and are read through short-lived signed URLs. They are extra: the full
  // previewDataUrl is still saved and remains the fallback for every post.
  const PREVIEW_BUCKET = 'frameup-previews';
  const THUMB_WIDTH = 360;
  const thumbPath = id => `thumbs/${id}.webp`;

  function makeThumbBlob(dataUrl) {
    return new Promise(resolve => {
      if (!dataUrl || typeof document === 'undefined') return resolve(null);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, THUMB_WIDTH / Math.max(img.naturalWidth, 1));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          // Browsers without webp encoding hand back PNG; skip those.
          canvas.toBlob(blob => resolve(blob?.type === 'image/webp' ? blob : null), 'image/webp', 0.8);
        } catch (error) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  // Best effort: a failed thumbnail never affects the export or its record.
  async function uploadGalleryThumb(task = {}) {
    try {
      if (task.type !== 'exported_design' || task.workspace !== GALLERY_WORKSPACE || !task.id) return;
      const client = getSupabaseClient();
      if (!client?.storage || !task.previewDataUrl) return;
      const blob = await makeThumbBlob(task.previewDataUrl);
      if (!blob) return;
      await client.storage.from(PREVIEW_BUCKET).upload(thumbPath(task.id), blob, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: false,
      });
    } catch (error) {
      // Ignore: the gallery falls back to the full preview.
    }
  }

  // Full-size previews: previews/<task id>, the same image the database holds
  // in metadata.previewDataUrl (still written, and still the fallback).
  const fullPreviewPath = id => `previews/${id}`;
  const storagePreviews = new Map();

  function dataUrlToBlob(dataUrl) {
    const value = String(dataUrl || '');
    const comma = value.indexOf(',');
    const header = value.slice(0, comma);
    const type = /^data:(image\/(?:webp|png));base64$/.exec(header)?.[1];
    if (comma < 0 || !type) return null;
    const binary = atob(value.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  // Best effort: a failed upload never affects the export or its record.
  async function uploadFullPreview(task = {}) {
    try {
      const path = task.metadata?.previewPath;
      if (task.type !== 'exported_design' || !task.id || !path) return false;
      const client = getSupabaseClient();
      const blob = client?.storage ? dataUrlToBlob(task.previewDataUrl) : null;
      if (!blob) return false;
      const { error } = await client.storage.from(PREVIEW_BUCKET).upload(path, blob, {
        contentType: blob.type,
        cacheControl: '31536000',
        upsert: false,
      });
      return !error || /exists|duplicate/i.test(error.message || '');
    } catch (error) {
      return false;
    }
  }

  // Downloaded through the signed-in session (so Storage applies the same
  // access rules as the database) and kept as an in-memory URL for the page's
  // lifetime: no expiring links. Failures aren't cached, so a preview that is
  // still uploading is picked up on the next try.
  function loadStoragePreview(id) {
    if (!storagePreviews.has(id)) {
      const pending = (async () => {
        const client = getSupabaseClient();
        if (!client?.storage) return '';
        const { data, error } = await client.storage.from(PREVIEW_BUCKET).download(fullPreviewPath(id));
        return !error && data?.size ? URL.createObjectURL(data) : '';
      })().catch(() => '');
      storagePreviews.set(id, pending);
      pending.then(url => { if (!url) storagePreviews.delete(id); });
    }
    return storagePreviews.get(id);
  }

  async function fetchGalleryThumbs(ids = []) {
    const cleanIds = ids.map(cleanString).filter(Boolean);
    const client = getSupabaseClient();
    if (!client?.storage || !cleanIds.length) return {};
    try {
      const { data, error } = await client.storage.from(PREVIEW_BUCKET).createSignedUrls(cleanIds.map(thumbPath), 3600);
      if (error || !Array.isArray(data)) return {};
      return Object.fromEntries(data
        .filter(entry => entry?.signedUrl && !entry.error)
        .map(entry => [String(entry.path || '').replace(/^thumbs\//, '').replace(/\.webp$/, ''), entry.signedUrl]));
    } catch (error) {
      return {};
    }
  }

  async function fetchGalleryPreview(id) {
    const cleanId = cleanString(id);
    if (!cleanId) return '';
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (client && session?.user?.email) {
      const stored = await loadStoragePreview(cleanId);
      if (stored) return stored;
      const { data, error } = await client.rpc('get_frameup_gallery_preview', { p_id: cleanId });
      if (!error) return cleanString(data || '');
      if (isGalleryRpcMissing(error)) return fetchTaskPreview(cleanId);
      return '';
    }
    return readTasks().find(task => task.id === cleanId)?.previewDataUrl || '';
  }

  // AI spend (admins only): one row per AI call, written by the server.
  // Returns { rows, ready }; ready is false until the frameup_ai_usage
  // migration has been applied.
  // measured is true once the 20261118120000_ai_guardrails migration added the
  // cache-token, task and run-id columns; before that the basic columns load.
  const AI_USAGE_BASIC = 'created_at,user_email,feature,model,ok,input_tokens,output_tokens,images,cost_usd';
  const AI_USAGE_MEASURED = `${AI_USAGE_BASIC},cache_read_tokens,cache_write_tokens,task,run_id`;
  let aiUsageMeasured = true;
  async function fetchAiUsage({ sinceIso } = {}) {
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email) return { rows: [], ready: false };
    const read = columns => {
      let query = client.from('frameup_ai_usage')
        .select(columns)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (sinceIso) query = query.gte('created_at', sinceIso);
      return query;
    };
    let { data, error } = await read(aiUsageMeasured ? AI_USAGE_MEASURED : AI_USAGE_BASIC);
    if (error && aiUsageMeasured && /column|42703|PGRST/i.test(`${error.code || ''} ${error.message || ''}`)) {
      aiUsageMeasured = false;
      ({ data, error } = await read(AI_USAGE_BASIC));
    }
    if (error) {
      console.warn('[ai spend] frameup_ai_usage read failed:', error.message || error);
      return { rows: [], ready: false };
    }
    return { rows: data || [], ready: true, measured: aiUsageMeasured };
  }

  // Browser error reports (admins only), written by /api/client-errors.
  // Returns { rows, ready }; ready is false until the frameup_client_errors
  // migration has been applied.
  async function fetchClientErrors({ sinceIso } = {}) {
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email) return { rows: [], ready: false };
    let query = client.from('frameup_client_errors')
      .select('created_at,user_email,kind,message,stack,page,source,line,col,status,fingerprint,occurrences,release')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (sinceIso) query = query.gte('created_at', sinceIso);
    const { data, error } = await query;
    if (error) {
      console.warn('[client errors] frameup_client_errors read failed:', error.message || error);
      return { rows: [], ready: false };
    }
    return { rows: data || [], ready: true };
  }

  // Usage log rows (admins read all; frameup_usage_events, frameup-track.js).
  // Returns { rows, ready }; ready is false before the usage-events migration
  // has run or when the read fails. tool / categories narrow the read.
  async function fetchUsageEvents({ sinceIso, tool = '', categories = [] } = {}) {
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email) return { rows: [], ready: false };
    const rows = [];
    try {
      for (let from = 0; from < 20000; from += 1000) {
        let query = client.from('frameup_usage_events')
          .select('id,created_at,user_email,category,tool,action,label,meta')
          .order('created_at', { ascending: false });
        if (sinceIso) query = query.gte('created_at', sinceIso);
        if (tool) query = query.eq('tool', tool);
        if (categories.length) query = query.in('category', categories);
        const { data, error } = await query.range(from, from + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
    } catch (error) {
      console.warn('[usage] frameup_usage_events read failed:', error?.message || error);
      return { rows: [], ready: false, error: String(error?.message || error) };
    }
    return { rows, ready: true };
  }

  // The shareable copy of an exported design (text, settings, web photo
  // links), used by "Open in editor" in the Gallery.
  async function fetchGalleryDesign(id) {
    const cleanId = cleanString(id);
    if (!cleanId) return null;
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email) return null;
    const { data, error } = await client.rpc('get_frameup_gallery_design', { p_id: cleanId });
    if (error) {
      if (!isGalleryRpcMissing(error)) console.warn('[gallery] get_frameup_gallery_design failed:', error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') return null;
    const payload = row.design && typeof row.design === 'object' ? row.design : null;
    return payload ? { payload, title: cleanString(row.title || ''), workspace: cleanString(row.workspace || '') } : null;
  }

  window.ESDashboardData = Object.freeze({
    REQUESTS_KEY,
    DESIGNS_KEY,
    ACTIVITY_KEY,
    TASKS_KEY,
    ADMIN_CONFIG_KEY,
    TASK_STATUS_COLUMNS,
    ACCESS_ROLES,
    DASHBOARD_ACCESS_ROLES,
    ROLE_ASSIGNER_ROLES,
    getAdminConfig,
    getCurrentUser,
    isCurrentUserAdmin,
    canCurrentUserAssignRoles,
    showAdminNavigation,
    getDashboardState,
    saveDashboardState,
    recordDesignExport,
    recordDesignRequest,
    updateTaskAdminFields,
    updateRequestAdminFields,
    updateDesignAdminFields,
    updatePersonAccessRole,
    fetchPeopleDirectory,
    confirmPersonEmail,
    fetchRoleAudit,
    recordActivity,
    readDesignRequests,
    writeDesignRequests,
    readDesigns,
    writeDesigns,
    readTasks,
    writeTasks,
    readActivity,
    getToolFeedback,
    getPeople,
    refreshCloudDashboardData,
    upsertSupabaseProfileAndPresence,
    recordPresenceHeartbeat,
    fetchTaskPreview,
    fetchGalleryExports,
    fetchGalleryPreview,
    fetchGalleryDesign,
    fetchAiUsage,
    fetchClientErrors,
    fetchUsageEvents,
    fetchGalleryThumbs,
    emitDashboardChange,
  });

  scheduleAdminNavigationChecks();
  scheduleSupabasePresence();
})();
