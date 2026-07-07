(function () {
  'use strict';

  const REQUESTS_KEY = 'es.designRequests.v1';
  const DESIGNS_KEY = 'es.dashboard.designs.v1';
  const ACTIVITY_KEY = 'es.dashboard.activity.v1';
  const ADMIN_CONFIG_KEY = 'es.dashboard.adminConfig.v1';
  const PROFILE_KEY = 'es.ai.profile';
  const AUTH_KEY = 'es.designerAuth.v1';
  const SUPABASE_PROFILES_TABLE = 'es_designer_profiles';
  const SUPABASE_PRESENCE_TABLE = 'es_designer_presence';
  const PRESENCE_ONLINE_WINDOW_MS = 2 * 60 * 1000;
  const PRESENCE_HEARTBEAT_MS = 30 * 1000;

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
      return await window.ESAuth?.getSession?.();
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
    const role = cleanString(session?.user?.role || profile.role || '');
    return { email, name, role, avatar: cleanString(profile.avatar) };
  }

  async function isCurrentUserAdmin() {
    const session = await getAuthenticatedSession();
    const email = normalizeEmail(session?.user?.email);
    return Boolean(email && getAdminConfig().adminEmails.includes(email));
  }

  let cloudPeopleCache = [];
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
    return {
      email,
      name: cleanString(row.name || email.split('@')[0]),
      role: cleanString(row.role || ''),
      avatar: cleanString(row.avatar_url || row.avatar || ''),
      workspace: cleanString(row.workspace || row.page_path || (isOnline ? 'ES Designer' : 'Not currently active')),
      lastSeenAt: lastSeen,
      online: isOnline,
      source: 'supabase',
    };
  }

  async function upsertSupabaseProfileAndPresence() {
    const session = await getAuthenticatedSession();
    const client = getSupabaseClient();
    if (!session?.user?.email || !client) return false;

    const profile = getStoredProfile();
    const email = normalizeEmail(session.user.email);
    const name = cleanString(profile.name || session.user.name || email.split('@')[0] || 'ES User');
    const role = cleanString(profile.role || session.user.role || 'Designer');
    const avatarUrl = cleanString(profile.avatar || '');
    const now = new Date().toISOString();
    const workspace = getCurrentWorkspaceLabel();
    const pagePath = `${window.location.pathname}${window.location.hash || ''}`;

    const profileRow = {
      email,
      name,
      role,
      avatar_url: avatarUrl,
      last_seen_at: now,
      updated_at: now,
    };
    const presenceRow = {
      email,
      name,
      role,
      avatar_url: avatarUrl,
      page_path: pagePath,
      workspace,
      last_seen_at: now,
      updated_at: now,
    };

    const profileResult = await client
      .from(SUPABASE_PROFILES_TABLE)
      .upsert(profileRow, { onConflict: 'email' });
    if (profileResult.error) throw profileResult.error;

    const presenceResult = await client
      .from(SUPABASE_PRESENCE_TABLE)
      .upsert(presenceRow, { onConflict: 'email' });
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
        .select('email,name,role,avatar_url,last_seen_at,updated_at')
        .order('name', { ascending: true }),
      client
        .from(SUPABASE_PRESENCE_TABLE)
        .select('email,name,role,avatar_url,page_path,workspace,last_seen_at,updated_at')
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
        role: person.role || existing.role,
        avatar: person.avatar || existing.avatar,
      });
    });
    return Array.from(people.values());
  }

  async function refreshCloudDashboardData({ silent = true, fetchPeople = /dashboard\.html$/i.test(window.location.pathname) } = {}) {
    if (cloudRefreshInFlight) return cloudRefreshInFlight;
    cloudRefreshInFlight = (async () => {
      try {
        await upsertSupabaseProfileAndPresence();
        if (fetchPeople) {
          cloudPeopleCache = await fetchSupabasePeople();
          emitDashboardChange('cloud-people', { people: cloudPeopleCache });
        }
        return cloudPeopleCache;
      } catch (error) {
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
    return /dashboard\.html$/i.test(window.location.pathname);
  }

  function scheduleSupabasePresence() {
    if (!shouldRunSupabasePresence()) return;
    const beat = () => {
      if (document.visibilityState === 'hidden') return;
      recordPresenceHeartbeat();
    };
    const start = () => {
      if (presenceTimer) return;
      beat();
      presenceTimer = window.setInterval(beat, PRESENCE_HEARTBEAT_MS);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      window.setTimeout(start, 0);
    }
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
      status: cleanString(payload.status || 'Exported'),
      assignedTo: cleanString(payload.assignedTo || ''),
    };
    writeDesigns([record, ...designs].slice(0, 500));
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

  function getPeople({ requests = readDesignRequests(), designs = readDesigns() } = {}) {
    const people = new Map();
    const add = (email, name, role = '', extras = {}) => {
      const normalized = normalizeEmail(email);
      if (!normalized) return;
      const existing = people.get(normalized) || {};
      people.set(normalized, {
        ...existing,
        ...extras,
        email: normalized,
        name: cleanString(name || existing.name || normalized.split('@')[0]),
        role: cleanString(role || existing.role || ''),
      });
    };

    cloudPeopleCache.forEach(person => {
      add(person.email, person.name, person.role, {
        avatar: person.avatar || '',
        workspace: person.workspace || '',
        lastSeenAt: person.lastSeenAt || '',
        online: Boolean(person.online),
        source: person.source || 'supabase',
      });
    });

    const profile = getStoredProfile();
    add(profile.email, profile.name, profile.role);
    const session = readJson(AUTH_KEY, null);
    add(session?.user?.email, session?.user?.name, session?.user?.role);

    requests.forEach(request => {
      add(request.requester?.email, request.requester?.name, 'Requester');
      add(request.assignedTo, request.assignedTo, 'Owner');
    });
    designs.forEach(design => {
      add(design.ownerEmail, design.ownerName, 'Creator');
      add(design.assignedTo, design.assignedTo, 'Owner');
    });

    const config = getAdminConfig();
    config.adminEmails.forEach(email => add(email, email.split('@')[0], 'Admin'));
    config.ownerEmails.forEach(email => add(email, email.split('@')[0], 'Owner'));
    return Array.from(people.values()).sort((a, b) => {
      if (Boolean(a.online) !== Boolean(b.online)) return a.online ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  function getDashboardState() {
    const requests = readDesignRequests();
    const designs = readDesigns();
    const activity = readActivity();
    return {
      requests,
      designs,
      activity,
      people: getPeople({ requests, designs }),
      adminConfig: getAdminConfig(),
    };
  }

  function saveDashboardState(state = {}) {
    if (Array.isArray(state.requests)) writeDesignRequests(state.requests);
    if (Array.isArray(state.designs)) writeDesigns(state.designs);
    if (Array.isArray(state.activity)) writeActivity(state.activity);
    emitDashboardChange('state');
    return getDashboardState();
  }

  window.ESDashboardData = Object.freeze({
    REQUESTS_KEY,
    DESIGNS_KEY,
    ACTIVITY_KEY,
    ADMIN_CONFIG_KEY,
    getAdminConfig,
    getCurrentUser,
    isCurrentUserAdmin,
    showAdminNavigation,
    getDashboardState,
    saveDashboardState,
    recordDesignExport,
    updateRequestAdminFields,
    updateDesignAdminFields,
    recordActivity,
    readDesignRequests,
    writeDesignRequests,
    readDesigns,
    writeDesigns,
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
