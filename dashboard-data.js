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
  const PRESENCE_ONLINE_WINDOW_MS = 2 * 60 * 1000;
  const PRESENCE_HEARTBEAT_MS = 60 * 1000;
  const TASK_STATUS_COLUMNS = Object.freeze(['Backlog', 'Assigned', 'Doing', 'Review', 'Done']);
  const ACCESS_ROLES = Object.freeze(['Associate', 'Admin', 'Super Admin', 'Server Owner']);
  const DASHBOARD_ACCESS_ROLES = Object.freeze(['Admin', 'Super Admin', 'Server Owner']);
  const ROLE_ASSIGNER_ROLES = Object.freeze(['Server Owner']);
  const DEFAULT_ROLE_ASSIGNMENTS = Object.freeze({
    'suhail.quraishi@essentiallysports.com': 'Server Owner',
    'manish.kalsi@essentiallysports.com': 'Super Admin',
  });

  const DEFAULT_ADMIN_CONFIG = Object.freeze({
    adminEmails: [
      'suhail.quraishi@essentiallysports.com',
      'manish.kalsi@essentiallysports.com',
    ],
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

  function getAdminConfig() {
    const stored = readJson(ADMIN_CONFIG_KEY, null);
    const config = stored && typeof stored === 'object' ? stored : DEFAULT_ADMIN_CONFIG;
    return {
      adminEmails: DEFAULT_ADMIN_CONFIG.adminEmails.map(normalizeEmail).filter(Boolean),
      ownerEmails: Array.from(new Set((Array.isArray(config.ownerEmails) ? config.ownerEmails : []).map(normalizeEmail).filter(Boolean))),
    };
  }

  function getStoredProfile() {
    return readJson(PROFILE_KEY, {}) || {};
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
    const profile = getStoredProfile();
    const email = normalizeEmail(session?.user?.email || profile.email);
    const name = cleanString(session?.user?.name || profile.name || email.split('@')[0] || 'ES User');
    const designation = designationFromProfile(profile, session?.user || {});
    const role = normalizeAccessRole(profile.accessRole || session?.user?.accessRole || session?.user?.role || profile.role, email);
    return { email, name, role, accessRole: role, designation, avatar: cleanString(profile.avatar) };
  }

  async function isCurrentUserAdmin() {
    const user = await getCurrentUser();
    const email = normalizeEmail(user.email);
    return Boolean(email && (DASHBOARD_ACCESS_ROLES.includes(user.accessRole) || getAdminConfig().adminEmails.includes(email)));
  }

  async function canCurrentUserAssignRoles() {
    const user = await getCurrentUser();
    return ROLE_ASSIGNER_ROLES.includes(user.accessRole);
  }

  let cloudPeopleCache = [];
  let cloudTasksCache = [];
  let cloudSyncStatus = {
    ok: null,
    message: '',
    checkedAt: '',
  };
  let presenceTimer = null;
  let cloudRefreshInFlight = null;

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
    return document.title?.replace(/\s*\|\s*EssentiallySports\s*$/i, '').trim() || 'ES Designer';
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
      workspace: cleanString(row.workspace || row.page_path || (isOnline ? 'ES Designer' : 'Not currently active')),
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
    return TASK_STATUS_COLUMNS.includes(cleaned) ? cleaned : fallback;
  }

  function taskTitleFromRequest(request = {}) {
    return cleanString(request.entities || request.title || request.brief || request.id || 'Design request');
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
      previewDataUrl: cleanString(task.previewDataUrl || task.preview_data_url || task.metadata?.previewDataUrl || ''),
      designDueAt: cleanString(task.designDueAt || task.design_due_at || ''),
      publishAt: cleanString(task.publishAt || task.publish_at || ''),
      brief: cleanString(task.brief || ''),
      designCopy: cleanString(task.designCopy || task.design_copy || ''),
      additionalNotes: cleanString(task.additionalNotes || task.additional_notes || ''),
      adminNotes: cleanString(task.adminNotes || task.admin_notes || ''),
      referenceLinks: Array.isArray(task.referenceLinks || task.reference_links)
        ? (task.referenceLinks || task.reference_links).map(cleanString).filter(Boolean)
        : [],
      metadata: task.metadata && typeof task.metadata === 'object' ? task.metadata : {},
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
      metadata: row.metadata,
      previewDataUrl: row.metadata?.previewDataUrl || '',
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

  async function upsertSupabaseProfileAndPresence() {
    const session = await getAuthenticatedSession();
    const client = getSupabaseClient();
    if (!session?.user?.email || !client) return false;

    const profile = getStoredProfile();
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
    if (presenceResult.error && /designation/i.test(presenceResult.error.message || '')) {
      const fallbackPresenceRow = { ...presenceRow };
      delete fallbackPresenceRow.designation;
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
        role: person.role || existing.role,
        accessRole: person.accessRole || existing.accessRole,
        avatar: person.avatar || existing.avatar,
      });
    });
    return Array.from(people.values());
  }

  async function fetchSupabaseTasks() {
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email) return [];

    const { data, error } = await client
      .from(SUPABASE_TASKS_TABLE)
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return (Array.isArray(data) ? data : [])
      .map(normalizeSupabaseTask)
      .filter(task => task.id);
  }

  async function upsertSupabaseTask(task = {}) {
    const client = getSupabaseClient();
    const session = await getAuthenticatedSession();
    if (!client || !session?.user?.email) return null;
    const row = taskToSupabaseRow(task);
    const { data, error } = await client
      .from(SUPABASE_TASKS_TABLE)
      .upsert(row, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return normalizeSupabaseTask(data || row);
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

  async function refreshCloudDashboardData({ silent = true, fetchPeople = /dashboard\.html$/i.test(window.location.pathname) } = {}) {
    if (cloudRefreshInFlight) return cloudRefreshInFlight;
    cloudRefreshInFlight = (async () => {
      try {
        await withTimeout(upsertSupabaseProfileAndPresence(), 4000, false);
        if (fetchPeople) {
          const [people, tasks] = await Promise.all([
            withTimeout(fetchSupabasePeople().catch(() => cloudPeopleCache), 6500, cloudPeopleCache),
            withTimeout(fetchSupabaseTasks().catch(() => cloudTasksCache), 6500, cloudTasksCache),
          ]);
          cloudPeopleCache = Array.isArray(people) ? people : cloudPeopleCache;
          cloudTasksCache = Array.isArray(tasks) ? tasks : cloudTasksCache;
          cloudSyncStatus = {
            ok: true,
            message: '',
            checkedAt: new Date().toISOString(),
          };
          emitDashboardChange('cloud-people', { people: cloudPeopleCache });
          emitDashboardChange('cloud-tasks', { tasks: cloudTasksCache });
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
      await upsertSupabaseProfileAndPresence();
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
    const beat = () => {
      if (document.visibilityState === 'hidden') return;
      recordPresenceHeartbeat();
    };
    const start = () => {
      if (presenceTimer) return;
      window.setTimeout(beat, 1800);
      presenceTimer = window.setInterval(beat, PRESENCE_HEARTBEAT_MS);
    };
    window.addEventListener('es:auth-ready', start);
    window.addEventListener('focus', beat);
    window.addEventListener('pageshow', beat);
    window.addEventListener('hashchange', () => window.setTimeout(beat, 0));
    window.addEventListener('es:auth-ready', beat);
    window.addEventListener('es:auth-updated', beat);
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
    writeActivity([record, ...activity].slice(0, 250));
    emitDashboardChange('activity', { record });
    return record;
  }

  async function recordDesignExport(payload = {}) {
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
      },
    };
    writeDesigns([record, ...designs].slice(0, 500));
    const task = taskFromDesign(record);
    writeTasks(mergeTasks([task], readTasks()).slice(0, 750));
    upsertSupabaseTask(task)
      .then(saved => {
        if (saved) {
          cloudTasksCache = mergeTasks([saved], cloudTasksCache);
          emitDashboardChange('task', { record: saved });
        }
      })
      .catch(() => {});
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
    emitDashboardChange('task', { record: task });
    upsertSupabaseTask(task)
      .then(saved => {
        if (saved) {
          cloudTasksCache = mergeTasks([saved], cloudTasksCache);
          emitDashboardChange('task', { record: saved });
        }
      })
      .catch(() => {});
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
    const saved = await updateSupabaseTask(id, fields).catch(() => null);
    if (saved) {
      cloudTasksCache = mergeTasks([saved], cloudTasksCache);
      emitDashboardChange('task', { record: saved });
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

  async function updatePersonAccessRole(email, role) {
    const normalizedEmail = normalizeEmail(email);
    const accessRole = normalizeAccessRole(role, normalizedEmail);
    const actor = await getCurrentUser();
    if (!ROLE_ASSIGNER_ROLES.includes(actor.accessRole)) {
      throw new Error('Only the Server Owner can change dashboard roles.');
    }
    if (!normalizedEmail) throw new Error('Missing person email.');
    if (DEFAULT_ROLE_ASSIGNMENTS[normalizedEmail] && DEFAULT_ROLE_ASSIGNMENTS[normalizedEmail] !== accessRole) {
      throw new Error('Protected system role cannot be changed here.');
    }

    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase is not connected.');
    const profileResult = await client
      .rpc('set_es_designer_access_role', {
        target_email: normalizedEmail,
        target_role: accessRole,
      });
    if (profileResult.error) throw profileResult.error;

    const person = normalizeCloudPerson(profileResult.data || { email: normalizedEmail, role: accessRole, access_role: accessRole, updated_at: new Date().toISOString() });
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

    const profile = getStoredProfile();
    add(profile.email, profile.name, profile.accessRole || profile.role, { designation: designationFromProfile(profile, {}) });
    const session = readJson(AUTH_KEY, null);
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
    const activity = readActivity();
    const tasks = mergeTasks(cloudTasksCache, getLocalTaskFallbacks({ requests, designs }));
    return {
      requests,
      designs,
      tasks,
      taskStatusColumns: [...TASK_STATUS_COLUMNS],
      activity,
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
    recordActivity,
    readDesignRequests,
    writeDesignRequests,
    readDesigns,
    writeDesigns,
    readTasks,
    writeTasks,
    readActivity,
    getPeople,
    refreshCloudDashboardData,
    upsertSupabaseProfileAndPresence,
    recordPresenceHeartbeat,
    emitDashboardChange,
  });

  scheduleAdminNavigationChecks();
  scheduleSupabasePresence();
})();
