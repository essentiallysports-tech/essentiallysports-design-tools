/* Dashboard → People: search, status filters, role menu, access requests and
 * manual email confirmation, for admins. UMD: window.ESPeopleAdmin /
 * module.exports (the pure helpers are unit-tested in Node).
 *
 * The UI only mirrors the rules; the database enforces them
 * (admin_set_es_designer_role, admin_confirm_es_designer_email,
 * review_es_designer_access_request; migration 20261120120000).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ESPeopleAdmin = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROLES = Object.freeze(['Associate', 'Admin', 'Super Admin', 'Server Owner']);
  const ADMIN_ROLES = Object.freeze(['Admin', 'Super Admin', 'Server Owner']);
  const ROLE_HELP = Object.freeze({
    Associate: 'Uses FrameUp tools. No dashboard.',
    Admin: 'Dashboard, requests and access reviews.',
    'Super Admin': 'Dashboard access, senior admin.',
    'Server Owner': 'Dashboard, and can change roles.',
  });
  const FIXED_ROLES = Object.freeze({
    'suhail.quraishi@essentiallysports.com': 'Server Owner',
    'designteam@essentiallysports.com': 'Server Owner',
    'manish.kalsi@essentiallysports.com': 'Super Admin',
  });
  const ES_DOMAIN = 'essentiallysports.com';

  const STATUS = Object.freeze({
    active: { label: 'Active', tone: 'good' },
    'pending-confirmation': { label: 'Pending confirmation', tone: 'warn' },
    invited: { label: 'Invited', tone: 'brand' },
    'pending-request': { label: 'Access request', tone: 'warn' },
  });
  const FILTERS = Object.freeze([
    ['all', 'All'],
    ['active', 'Active'],
    ['pending-confirmation', 'Pending confirmation'],
    ['invited', 'Invited'],
    ['pending-request', 'Access requests'],
  ]);

  const MESSAGES = Object.freeze({
    not_allowed: 'Only a Server Owner can change roles.',
    self_change: 'You can’t change your own role. Ask another Server Owner.',
    protected: 'This person’s role is fixed and can’t be changed here.',
    invalid_email: 'Only EssentiallySports emails can hold a dashboard role.',
    invalid_role: 'Choose Associate, Admin, Super Admin or Server Owner.',
    owner_only: 'Only a founding Server Owner can grant or remove Server Owner.',
    last_admin: 'FrameUp needs at least one admin. Promote someone else first.',
    no_change: 'That’s already their role.',
  });

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function isAdminRole(role) {
    return ADMIN_ROLES.includes(role);
  }

  function normalizeRole(role, email, fixedRoles = FIXED_ROLES) {
    const fixed = fixedRoles[normalizeEmail(email)];
    if (fixed) return fixed;
    const clean = String(role || '').trim();
    return ROLES.includes(clean) ? clean : 'Associate';
  }

  function initials(name, email) {
    const source = String(name || '').trim() || normalizeEmail(email).split('@')[0] || '?';
    const parts = source.replace(/[._-]+/g, ' ').split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2);
    return letters.toUpperCase();
  }

  // 'active' | 'pending-confirmation' | 'invited' | 'pending-request'
  function personStatus(person = {}) {
    if (person.requestStatus === 'Pending' && !person.hasAccount) return 'pending-request';
    if (person.source === 'directory') {
      if (!person.hasAccount) return 'invited'; // approved / role set, no account yet
      if (person.emailConfirmedAt) return 'active';
      return person.invitedAt ? 'invited' : 'pending-confirmation';
    }
    return 'active';
  }

  // One list from the admin directory (or, before the migration, profiles +
  // presence) plus pending access requests. Rejected requests stay in the
  // Access view only.
  function mergePeople({ directory = null, fallbackPeople = [], accessRequests = [] } = {}) {
    const byEmail = new Map();
    const base = Array.isArray(directory) ? directory : fallbackPeople;
    base.forEach(person => {
      const email = normalizeEmail(person.email);
      if (!email) return;
      byEmail.set(email, { ...person, email, accessRole: normalizeRole(person.accessRole || person.role, email) });
    });
    accessRequests.forEach(request => {
      const email = normalizeEmail(request.email);
      if (!email || request.status !== 'Pending') return;
      const existing = byEmail.get(email);
      if (existing && existing.hasAccount !== false && existing.source === 'directory') return;
      byEmail.set(email, {
        ...(existing || {}),
        email,
        name: (existing && existing.name) || request.name || email.split('@')[0],
        accessRole: (existing && existing.accessRole) || 'Associate',
        hasAccount: Boolean(existing && existing.hasAccount),
        requestStatus: 'Pending',
        requestedAt: request.requestedAt || request.updatedAt || '',
        requestSource: request.source || '',
        source: (existing && existing.source) || 'request',
      });
    });
    return Array.from(byEmail.values()).map(person => ({ ...person, status: personStatus(person) }));
  }

  function filterPeople(people = [], { query = '', status = 'all' } = {}) {
    const needle = String(query || '').trim().toLowerCase();
    return people.filter(person => {
      if (status !== 'all' && person.status !== status) return false;
      if (!needle) return true;
      return [person.name, person.email, person.accessRole, person.designation]
        .some(value => String(value || '').toLowerCase().includes(needle));
    });
  }

  function statusCounts(people = []) {
    const counts = { all: people.length };
    Object.keys(STATUS).forEach(key => { counts[key] = 0; });
    people.forEach(person => { counts[person.status] = (counts[person.status] || 0) + 1; });
    return counts;
  }

  // Admins left if `excludeEmail` stopped being one. Fixed identities always
  // count (the database treats them as admins whatever their row says).
  function countAdmins(people = [], excludeEmail = '', fixedRoles = FIXED_ROLES) {
    const exclude = normalizeEmail(excludeEmail);
    const admins = new Set(Object.keys(fixedRoles).filter(email => email !== exclude && isAdminRole(fixedRoles[email])));
    people.forEach(person => {
      const email = normalizeEmail(person.email);
      if (email && email !== exclude && person.status !== 'pending-request' && isAdminRole(normalizeRole(person.accessRole, email, fixedRoles))) admins.add(email);
    });
    return admins.size;
  }

  // Mirrors admin_set_es_designer_role's guards so the menu can explain a
  // disabled choice before anyone clicks.
  function planRoleChange({ actorEmail = '', canManage = false, person = {}, nextRole = '', people = [], fixedRoles = FIXED_ROLES } = {}) {
    const email = normalizeEmail(person.email);
    const actor = normalizeEmail(actorEmail);
    const current = normalizeRole(person.accessRole, email, fixedRoles);
    const deny = reason => ({ allowed: false, reason, message: MESSAGES[reason] });
    if (!canManage) return deny('not_allowed');
    if (!ROLES.includes(nextRole)) return deny('invalid_role');
    if (email && email === actor) return deny('self_change');
    if (fixedRoles[email]) return deny('protected');
    if (email.split('@')[1] !== ES_DOMAIN) return deny('invalid_email');
    if (current === nextRole) return deny('no_change');
    if ((current === 'Server Owner' || nextRole === 'Server Owner') && fixedRoles[actor] !== 'Server Owner') return deny('owner_only');
    if (isAdminRole(current) && !isAdminRole(nextRole) && countAdmins(people, email, fixedRoles) < 1) return deny('last_admin');
    const crossesAdmin = isAdminRole(current) !== isAdminRole(nextRole) || current === 'Server Owner' || nextRole === 'Server Owner';
    return {
      allowed: true,
      from: current,
      to: nextRole,
      needsConfirm: crossesAdmin,
      direction: ROLES.indexOf(nextRole) > ROLES.indexOf(current) ? 'promote' : 'demote',
    };
  }

  function canEditRole(context, person) {
    const email = normalizeEmail(person.email);
    if (!context.canManage || person.status === 'pending-request') return false;
    if (email === normalizeEmail(context.actorEmail) || FIXED_ROLES[email]) return false;
    return email.split('@')[1] === ES_DOMAIN;
  }

  function relativeTime(value, now = Date.now()) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return '';
    const seconds = Math.max(0, Math.round((now - time) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} d ago`;
    return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function seenText(person, now = Date.now()) {
    if (person.status === 'pending-request') return person.requestedAt ? `Asked ${relativeTime(person.requestedAt, now)}` : 'Asked for access';
    if (person.online) return 'Online now';
    const seen = person.lastSeenAt || person.lastSignInAt;
    if (seen) return `Last seen ${relativeTime(seen, now)}`;
    return person.hasAccount === false ? 'No account yet' : 'Never signed in';
  }

  function auditText(entry = {}) {
    const actor = entry.actor_email || 'Someone';
    const target = entry.target_email || 'someone';
    if (entry.action === 'role_change') return `${actor} changed ${target} from ${entry.from_value} to ${entry.to_value}`;
    if (entry.action === 'email_confirmed') return `${actor} confirmed ${target}’s email`;
    if (entry.action === 'access_request') return `${actor} marked ${target}’s access request ${String(entry.to_value || '').toLowerCase()}`;
    return `${actor} updated ${target}`;
  }

  // ---------------------------------------------------------------------
  // DOM controller (browser only)
  // ---------------------------------------------------------------------

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const ICON_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  function mount(container, deps = {}) {
    if (!container || typeof document === 'undefined') return null;
    const state = {
      query: '',
      status: 'all',
      directory: null,
      directorySource: 'loading', // 'loading' | 'directory' | 'unavailable' | 'error'
      fallbackPeople: [],
      accessRequests: [],
      actorEmail: '',
      canManage: false,
      roleOverrides: new Map(),
      statusOverrides: new Map(),
      busy: new Set(),
      audit: [],
      auditSource: 'loading',
      lastLoad: 0,
      dirty: false,
    };
    let people = [];
    let openMenu = null;

    container.innerHTML = `
      <div class="pv">
        <div class="pv-toolbar">
          <label class="pv-search">
            ${ICON_SEARCH}
            <span class="sr-only">Search people</span>
            <input type="search" class="pv-search-input" placeholder="Search name, email or role" autocomplete="off" spellcheck="false">
          </label>
          <div class="pv-filters" role="group" aria-label="Filter people by status"></div>
        </div>
        <p class="pv-notice" hidden></p>
        <p class="pv-count" aria-live="polite"></p>
        <div class="pv-list" role="list"></div>
        <details class="pv-audit">
          <summary>Recent changes</summary>
          <ol class="pv-audit-list"></ol>
        </details>
        <dialog class="pv-dialog" aria-labelledby="pv-dialog-title">
          <form method="dialog" class="pv-dialog-body">
            <h3 id="pv-dialog-title" class="pv-dialog-title"></h3>
            <p class="pv-dialog-text"></p>
            <div class="pv-dialog-actions">
              <button class="es-btn es-btn--secondary" value="cancel" type="submit">Cancel</button>
              <button class="es-btn es-btn--primary es-btn--static pv-dialog-confirm" value="confirm" type="submit">Confirm</button>
            </div>
          </form>
        </dialog>
        <div class="es-toast-region pv-toasts" aria-live="polite"></div>
      </div>`;

    const root = container.querySelector('.pv');
    const searchInput = root.querySelector('.pv-search-input');
    const filtersEl = root.querySelector('.pv-filters');
    const listEl = root.querySelector('.pv-list');
    const noticeEl = root.querySelector('.pv-notice');
    const countEl = root.querySelector('.pv-count');
    const auditList = root.querySelector('.pv-audit-list');
    const dialog = root.querySelector('.pv-dialog');
    const toasts = root.querySelector('.pv-toasts');

    function toast(message, tone = 'info') {
      const item = document.createElement('div');
      item.className = `es-toast${tone === 'error' ? ' is-error' : ''}`;
      item.setAttribute('role', tone === 'error' ? 'alert' : 'status');
      item.textContent = message;
      toasts.append(item);
      window.setTimeout(() => item.remove(), tone === 'error' ? 7000 : 4000);
    }

    // Promise<boolean>: a native <dialog> so focus is trapped and Esc cancels.
    function confirmDialog({ title, text, confirmLabel = 'Confirm', danger = false }) {
      return new Promise(resolve => {
        root.querySelector('.pv-dialog-title').textContent = title;
        root.querySelector('.pv-dialog-text').textContent = text;
        const confirmButton = root.querySelector('.pv-dialog-confirm');
        confirmButton.textContent = confirmLabel;
        confirmButton.classList.toggle('es-btn--danger', danger);
        confirmButton.classList.toggle('es-btn--primary', !danger);
        const returnFocus = document.activeElement;
        const onClose = () => {
          dialog.removeEventListener('close', onClose);
          resolve(dialog.returnValue === 'confirm');
          if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
          if (state.dirty) render();
        };
        dialog.addEventListener('close', onClose);
        dialog.returnValue = '';
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else resolve(window.confirm(`${title}\n\n${text}`));
        root.querySelector('.pv-dialog-actions [value="cancel"]').focus();
      });
    }

    function context() {
      return { actorEmail: state.actorEmail, canManage: state.canManage };
    }

    function computePeople() {
      people = mergePeople({
        directory: state.directorySource === 'directory' ? state.directory : null,
        fallbackPeople: state.fallbackPeople,
        accessRequests: state.accessRequests,
      }).map(person => {
        const next = { ...person };
        if (state.roleOverrides.has(person.email)) next.accessRole = state.roleOverrides.get(person.email);
        if (state.statusOverrides.has(person.email)) next.status = state.statusOverrides.get(person.email);
        return next;
      }).filter(person => person.status !== 'removed');
      people.sort((a, b) => {
        const rank = person => (person.status === 'pending-request' ? 0 : person.status === 'pending-confirmation' ? 1 : person.online ? 2 : 3);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        const seen = person => Date.parse(person.lastSeenAt || person.lastSignInAt || person.requestedAt || '') || 0;
        if (seen(b) !== seen(a)) return seen(b) - seen(a);
        return String(a.name || a.email).localeCompare(String(b.name || b.email));
      });
    }

    function renderFilters(counts) {
      filtersEl.innerHTML = FILTERS.map(([key, label]) => `
        <button type="button" class="es-chip pv-filter" data-pv-filter="${key}" aria-pressed="${state.status === key}">
          ${esc(label)} <span class="pv-filter-count">${counts[key] || 0}</span>
        </button>`).join('');
    }

    function roleControl(person) {
      const role = person.accessRole;
      const roleClass = `is-${role.toLowerCase().replace(/[^a-z]+/g, '-')}`;
      if (!canEditRole(context(), person)) {
        const why = FIXED_ROLES[person.email] ? 'Fixed role' : person.email === state.actorEmail ? 'Your role' : '';
        return `<span class="pv-role-chip ${roleClass}"${why ? ` title="${esc(why)}"` : ''}>${esc(role)}</span>`;
      }
      const saving = state.busy.has(`role:${person.email}`);
      return `
        <div class="pv-role-menu-wrap">
          <button type="button" class="pv-role-chip pv-role-btn ${roleClass}" data-pv-role-open="${esc(person.email)}"
            aria-haspopup="menu" aria-expanded="false" aria-label="Role: ${esc(role)}. Change role for ${esc(person.name || person.email)}"${saving ? ' aria-busy="true" disabled' : ''}>
            <span>${esc(role)}</span>${ICON_CHEVRON}
          </button>
        </div>`;
    }

    function actionsFor(person) {
      const email = esc(person.email);
      if (person.status === 'pending-request') {
        const busy = state.busy.has(`request:${person.email}`);
        return `
          <button type="button" class="es-btn es-btn--secondary es-btn--sm" data-pv-request="Approved" data-email="${email}"${busy ? ' disabled aria-busy="true"' : ''}>Approve</button>
          <button type="button" class="es-btn es-btn--danger es-btn--sm" data-pv-request="Rejected" data-email="${email}"${busy ? ' disabled' : ''}>Deny</button>`;
      }
      if (person.status === 'pending-confirmation' && state.directorySource === 'directory') {
        const busy = state.busy.has(`confirm:${person.email}`);
        return `<button type="button" class="es-btn es-btn--secondary es-btn--sm" data-pv-confirm="${email}"${busy ? ' disabled aria-busy="true"' : ''}>Confirm email</button>`;
      }
      return '';
    }

    function rowHtml(person) {
      const status = STATUS[person.status] || STATUS.active;
      const name = person.name || person.email.split('@')[0];
      const avatar = person.avatar && /^(https:|data:image\/)/i.test(person.avatar)
        ? `<img src="${esc(person.avatar)}" alt="" loading="lazy">`
        : esc(initials(name, person.email));
      const meta = [person.designation, person.status === 'pending-request' && person.requestSource ? `via ${person.requestSource}` : '']
        .filter(Boolean).join(' · ');
      return `
        <article class="pv-row" role="listitem" data-email="${esc(person.email)}">
          <span class="pv-avatar" aria-hidden="true">${avatar}</span>
          <div class="pv-who">
            <strong class="pv-name">${esc(name)}${person.email === state.actorEmail ? ' <span class="pv-you">(you)</span>' : ''}</strong>
            <span class="pv-email">${esc(person.email)}</span>
            ${meta ? `<span class="pv-meta">${esc(meta)}</span>` : ''}
          </div>
          <div class="pv-role">${roleControl(person)}</div>
          <div class="pv-seen"><span class="pv-dot${person.online ? ' is-online' : ''}" aria-hidden="true"></span>${esc(seenText(person))}</div>
          <div class="pv-status"><span class="es-badge es-badge--${status.tone} pv-badge">${esc(status.label)}</span></div>
          <div class="pv-actions">${actionsFor(person)}</div>
        </article>`;
    }

    function renderNotice() {
      let text = '';
      if (state.directorySource === 'unavailable') {
        text = 'Showing people from profiles and presence. Run migration 20261120120000_people_roles_admin.sql to add sign-up status, manual email confirmation and the change history.';
      } else if (state.directorySource === 'error') {
        text = 'Couldn’t load the full people list. Showing what this browser already has.';
      }
      noticeEl.hidden = !text;
      noticeEl.textContent = text;
    }

    function renderAudit() {
      if (state.auditSource !== 'audit') {
        auditList.innerHTML = `<li class="pv-audit-empty">${state.auditSource === 'loading' ? 'Loading…' : 'The change history appears once the People migration has run.'}</li>`;
        return;
      }
      auditList.innerHTML = state.audit.length
        ? state.audit.map(entry => `<li><span>${esc(auditText(entry))}</span><time datetime="${esc(entry.created_at)}">${esc(relativeTime(entry.created_at))}</time></li>`).join('')
        : '<li class="pv-audit-empty">No changes yet.</li>';
    }

    function render() {
      if (openMenu || dialog.open) {
        state.dirty = true;
        return;
      }
      state.dirty = false;
      computePeople();
      renderFilters(statusCounts(people));
      renderNotice();
      const visible = filterPeople(people, { query: state.query, status: state.status });
      countEl.textContent = state.directorySource === 'loading' && !people.length
        ? 'Loading people…'
        : `${visible.length} of ${people.length} ${people.length === 1 ? 'person' : 'people'}`;
      if (state.directorySource === 'loading' && !people.length) {
        listEl.innerHTML = Array.from({ length: 4 }, () => '<div class="pv-row pv-row--skeleton" aria-hidden="true"><span class="pv-avatar"></span><span class="pv-line"></span></div>').join('');
      } else if (!visible.length) {
        listEl.innerHTML = `<div class="es-empty pv-empty"><p>${people.length ? 'No one matches. Try another name or clear the filter.' : 'No people yet.'}</p></div>`;
      } else {
        listEl.innerHTML = visible.map(rowHtml).join('');
      }
      renderAudit();
    }

    function closeMenu({ focus = true } = {}) {
      if (!openMenu) return;
      const { menu, button } = openMenu;
      menu.remove();
      button.setAttribute('aria-expanded', 'false');
      openMenu = null;
      if (focus && document.contains(button)) button.focus();
      if (state.dirty) render();
    }

    function openRoleMenu(button) {
      closeMenu({ focus: false });
      const email = button.dataset.pvRoleOpen;
      const person = people.find(item => item.email === email);
      if (!person) return;
      const menu = document.createElement('div');
      menu.className = 'es-menu pv-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', `Role for ${person.name || person.email}`);
      menu.innerHTML = ROLES.map(role => {
        const plan = planRoleChange({ ...context(), person, nextRole: role, people });
        const current = role === person.accessRole;
        const disabled = !current && !plan.allowed;
        return `
          <button type="button" class="es-menu__item pv-menu-item${current ? ' is-current' : ''}" role="menuitemradio"
            aria-checked="${current}" data-pv-role="${esc(role)}"${disabled ? ` aria-disabled="true" title="${esc(plan.message || '')}"` : ''} tabindex="-1">
            <span class="pv-menu-check">${current ? ICON_CHECK : ''}</span>
            <span class="pv-menu-text"><strong>${esc(role)}</strong><small>${esc(disabled ? plan.message : ROLE_HELP[role])}</small></span>
          </button>`;
      }).join('');
      button.parentElement.append(menu);
      button.setAttribute('aria-expanded', 'true');
      openMenu = { menu, button, email };
      const items = Array.from(menu.querySelectorAll('[role="menuitemradio"]'));
      (items.find(item => item.getAttribute('aria-checked') === 'true') || items[0]).focus();
    }

    async function changeRole(email, nextRole) {
      const person = people.find(item => item.email === email);
      if (!person) return;
      const plan = planRoleChange({ ...context(), person, nextRole, people });
      if (!plan.allowed) {
        if (plan.reason !== 'no_change') toast(plan.message, 'error');
        return;
      }
      const name = person.name || person.email;
      if (plan.needsConfirm) {
        const promoting = plan.direction === 'promote';
        const ok = await confirmDialog({
          title: promoting ? `Make ${name} ${nextRole}?` : `Change ${name} to ${nextRole}?`,
          text: promoting
            ? `${name} will be able to open the Dashboard and see every request, export, person and access request.${nextRole === 'Server Owner' ? ' As Server Owner they can also change anyone’s role.' : ''}`
            : `${name} will lose Dashboard access${plan.from === 'Server Owner' ? ' and the ability to change roles' : ''}. Their tools and designs stay as they are.`,
          confirmLabel: promoting ? `Make ${nextRole}` : `Change to ${nextRole}`,
          danger: !promoting,
        });
        if (!ok) return;
      }
      // Optimistic: show the new role now, put it back if the server says no.
      state.roleOverrides.set(email, nextRole);
      state.busy.add(`role:${email}`);
      render();
      try {
        await deps.data.updatePersonAccessRole(email, nextRole);
        state.busy.delete(`role:${email}`);
        if (state.directory) state.directory = state.directory.map(item => (item.email === email ? { ...item, accessRole: nextRole } : item));
        state.fallbackPeople = state.fallbackPeople.map(item => (item.email === email ? { ...item, accessRole: nextRole, role: nextRole } : item));
        state.roleOverrides.delete(email);
        toast(`${name} is now ${nextRole}.`);
        loadAudit();
      } catch (error) {
        state.busy.delete(`role:${email}`);
        state.roleOverrides.delete(email);
        toast(error?.message || 'Role could not be updated.', 'error');
      }
      render();
    }

    async function reviewRequest(email, status) {
      const person = people.find(item => item.email === email);
      const name = person?.name || email;
      if (status === 'Rejected') {
        const ok = await confirmDialog({
          title: `Deny access for ${name}?`,
          text: `${email} won’t be able to create a FrameUp account. You can approve them later from Access requests.`,
          confirmLabel: 'Deny access',
          danger: true,
        });
        if (!ok) return;
      }
      state.statusOverrides.set(email, status === 'Approved' ? 'invited' : 'removed');
      state.busy.add(`request:${email}`);
      render();
      try {
        await deps.auth.reviewAccessRequest(email, status);
        state.accessRequests = state.accessRequests.map(item => (item.email === email ? { ...item, status } : item));
        state.statusOverrides.delete(email);
        toast(status === 'Approved' ? `${name} can now create an account.` : `Access denied for ${name}.`);
        deps.onAccessChange?.();
        state.lastLoad = 0;
        load();
      } catch (error) {
        state.statusOverrides.delete(email);
        toast(error?.message || 'Access request could not be updated.', 'error');
      } finally {
        state.busy.delete(`request:${email}`);
        render();
      }
    }

    async function confirmEmail(email) {
      const person = people.find(item => item.email === email);
      const name = person?.name || email;
      const ok = await confirmDialog({
        title: `Confirm ${name}’s email?`,
        text: `Only do this if ${name} told you directly (Slack or in person) that they created this account and can’t find the email. It lets whoever chose the password log in as ${email}.`,
        confirmLabel: 'Confirm email',
      });
      if (!ok) return;
      state.statusOverrides.set(email, 'active');
      state.busy.add(`confirm:${email}`);
      render();
      try {
        await deps.data.confirmPersonEmail(email);
        if (state.directory) state.directory = state.directory.map(item => (item.email === email ? { ...item, emailConfirmedAt: new Date().toISOString() } : item));
        state.statusOverrides.delete(email);
        toast(`${name} can log in now.`);
        loadAudit();
      } catch (error) {
        state.statusOverrides.delete(email);
        toast(error?.message || 'Couldn’t confirm this account.', 'error');
      } finally {
        state.busy.delete(`confirm:${email}`);
        render();
      }
    }

    async function loadAudit() {
      try {
        const result = await deps.data.fetchRoleAudit?.({ limit: 20 });
        state.audit = result?.entries || [];
        state.auditSource = result?.source || 'unavailable';
      } catch (error) {
        state.auditSource = 'unavailable';
      }
      renderAudit();
    }

    async function load({ force = false } = {}) {
      if (!force && Date.now() - state.lastLoad < 30000) return;
      state.lastLoad = Date.now();
      try {
        const result = await deps.data.fetchPeopleDirectory?.();
        state.directory = result?.people || null;
        state.directorySource = result?.source === 'directory' ? 'directory' : 'unavailable';
      } catch (error) {
        state.directorySource = 'error';
      }
      render();
      loadAudit();
    }

    // Events
    searchInput.addEventListener('input', () => {
      state.query = searchInput.value;
      render();
    });
    filtersEl.addEventListener('click', event => {
      const chip = event.target.closest('[data-pv-filter]');
      if (!chip) return;
      state.status = chip.dataset.pvFilter;
      render();
      filtersEl.querySelector(`[data-pv-filter="${state.status}"]`)?.focus();
    });
    root.addEventListener('click', event => {
      const opener = event.target.closest('[data-pv-role-open]');
      if (opener) {
        if (openMenu && openMenu.button === opener) closeMenu();
        else openRoleMenu(opener);
        return;
      }
      const item = event.target.closest('[data-pv-role]');
      if (item && openMenu) {
        if (item.getAttribute('aria-disabled') === 'true') return;
        const email = openMenu.email;
        const role = item.dataset.pvRole;
        closeMenu();
        changeRole(email, role);
        return;
      }
      const requestButton = event.target.closest('[data-pv-request]');
      if (requestButton) {
        reviewRequest(requestButton.dataset.email, requestButton.dataset.pvRequest);
        return;
      }
      const confirmButton = event.target.closest('[data-pv-confirm]');
      if (confirmButton) confirmEmail(confirmButton.dataset.pvConfirm);
    });
    root.addEventListener('keydown', event => {
      if (!openMenu) return;
      const items = Array.from(openMenu.menu.querySelectorAll('[role="menuitemradio"]'));
      const index = items.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
      if (event.key === 'Tab') { closeMenu({ focus: false }); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const next = event.key === 'Home' ? 0
          : event.key === 'End' ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
    });
    document.addEventListener('click', event => {
      if (openMenu && !event.target.closest('.pv-role-menu-wrap')) closeMenu({ focus: false });
    });

    const controller = {
      // Called on every dashboard render with what the page already has.
      update({ fallbackPeople = [], accessRequests = [], actorEmail = '', canManage = false } = {}) {
        state.fallbackPeople = (fallbackPeople || []).map(person => ({
          ...person,
          email: normalizeEmail(person.email),
          accessRole: person.accessRole || person.role,
        }));
        state.accessRequests = accessRequests || [];
        state.actorEmail = normalizeEmail(actorEmail);
        state.canManage = Boolean(canManage);
        render();
        load();
      },
      reload: () => load({ force: true }),
      get people() { return people.slice(); },
    };
    render();
    return controller;
  }

  return {
    ROLES,
    ADMIN_ROLES,
    ROLE_HELP,
    FIXED_ROLES,
    STATUS,
    MESSAGES,
    normalizeRole,
    isAdminRole,
    initials,
    personStatus,
    mergePeople,
    filterPeople,
    statusCounts,
    countAdmins,
    planRoleChange,
    canEditRole,
    relativeTime,
    seenText,
    auditText,
    mount,
  };
});
