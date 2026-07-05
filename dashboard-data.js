(function () {
  'use strict';

  const REQUESTS_KEY = 'es.designRequests.v1';
  const DESIGNS_KEY = 'es.dashboard.designs.v1';
  const ACTIVITY_KEY = 'es.dashboard.activity.v1';
  const ADMIN_CONFIG_KEY = 'es.dashboard.adminConfig.v1';
  const PROFILE_KEY = 'es.ai.profile';
  const AUTH_KEY = 'es.designerAuth.v1';
  const DASHBOARD_ENABLED = false;

  const DEFAULT_ADMIN_CONFIG = Object.freeze({
    adminEmails: ['suhail.quraishi@essentiallysports.com'],
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
      adminEmails: Array.from(new Set([
        ...DEFAULT_ADMIN_CONFIG.adminEmails,
        ...(Array.isArray(config.adminEmails) ? config.adminEmails : []),
      ].map(normalizeEmail).filter(Boolean))),
      ownerEmails: Array.from(new Set((Array.isArray(config.ownerEmails) ? config.ownerEmails : []).map(normalizeEmail).filter(Boolean))),
    };
  }

  function getStoredProfile() {
    return readJson(PROFILE_KEY, {}) || {};
  }

  function getLocalSession() {
    try {
      return JSON.parse(window.sessionStorage.getItem(AUTH_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  async function getCurrentUser() {
    let session = null;
    try {
      session = await window.ESAuth?.getSession?.();
    } catch (error) {
      session = null;
    }
    session = session || getLocalSession();
    const profile = getStoredProfile();
    const email = normalizeEmail(session?.user?.email || profile.email);
    const name = cleanString(session?.user?.name || profile.name || email.split('@')[0] || 'ES User');
    const role = cleanString(session?.user?.role || profile.role || '');
    return { email, name, role };
  }

  async function isCurrentUserAdmin() {
    if (!DASHBOARD_ENABLED) return false;
    const user = await getCurrentUser();
    return getAdminConfig().adminEmails.includes(normalizeEmail(user.email));
  }

  function isDashboardEnabled() {
    return DASHBOARD_ENABLED;
  }

  async function showAdminNavigation() {
    const allowed = await isCurrentUserAdmin();
    document.querySelectorAll('[data-admin-only]').forEach(element => {
      element.hidden = !allowed;
      element.classList.toggle('is-admin-visible', allowed);
    });
    document.documentElement.classList.toggle('has-dashboard-admin', allowed);
    return allowed;
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
    const add = (email, name, role = '') => {
      const normalized = normalizeEmail(email);
      if (!normalized) return;
      const existing = people.get(normalized) || {};
      people.set(normalized, {
        email: normalized,
        name: cleanString(name || existing.name || normalized.split('@')[0]),
        role: cleanString(role || existing.role || ''),
      });
    };

    const profile = getStoredProfile();
    add(profile.email, profile.name, profile.role);
    const session = getLocalSession();
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
    return Array.from(people.values()).sort((a, b) => a.name.localeCompare(b.name));
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
    isDashboardEnabled,
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
    emitDashboardChange,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showAdminNavigation);
  } else {
    showAdminNavigation();
  }
})();
