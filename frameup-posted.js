// FrameUp "Posted it? Paste the link" + UTM tags + impact events.
//
// Loaded on the editor (index.html), Generate, Video Ads, Reels, Gallery and
// the Dashboard, after frameup-impact.js. Pages call:
//   FrameUpPosted.exported({ source, taskId, title, template, brand, style, angle, size, sizes, aiMade })
//     → logs export_done (with the time since the design was started) and
//       shows the quiet floating card. The editor needs no call: it listens
//       for the dashboard "design" event that recordDesignExport() sends.
//   FrameUpPosted.mount(container, { taskId, title, ... })  inline form
//   FrameUpPosted.fetchStatus(taskIds) → Map(taskId → { platforms, links, latestUrl, latestPlatform })
//   FrameUpPosted.decorateLink(url, ctx) / decorateHtml(html, ctx)   UTM when the toggle is on
//   FrameUpPosted.afterCopy({ kind, raw, copy, ctx })   card with the UTM toggle
//   FrameUpPosted.track(event, { taskId, meta })
//
// Storage: public.frameup_post_links and public.frameup_events
// (supabase/migrations/20261118124600_frameup_post_links.sql). Before that
// migration is applied, links are kept on this device and saved later, and
// events are skipped. Nothing here ever blocks an export.
(() => {
  'use strict';

  if (window.FrameUpPosted || window.top !== window) return;
  const I = window.FrameUpImpact;
  if (!I) return;

  const PENDING_KEY = 'frameup.postLinks.pending.v1';
  const UTM_KEY = 'frameup.utm.v1';
  const SESSION_ID = (() => {
    try { return crypto.randomUUID().slice(0, 18); } catch (error) { return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
  })();
  const EDITOR_ROUTES = new Set(['instagram', 'youtube', 'newsletter', 'reels']);
  const REF_PREFIX = { generate: 'gen', 'video-ads': 'vad', reels: 'reel', editor: 'ed' };

  function detectSource() {
    const path = location.pathname.toLowerCase();
    if (/generate(\.html)?$/.test(path)) return 'generate';
    if (/video-ads(\.html)?$/.test(path)) return 'video-ads';
    if (/reels(\.html)?$/.test(path)) return 'reels';
    if (/gallery(\.html)?$/.test(path)) return 'gallery';
    if (/dashboard(\.html)?$/.test(path)) return 'dashboard';
    if (/(^\/$|index(\.html)?$)/.test(path)) return 'editor';
    return '';
  }
  const SOURCE = detectSource();

  // ── Storage helpers ───────────────────────────────────────────────────────
  const readJson = (key, fallback) => {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch (error) { return fallback; }
  };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* private mode */ } };

  const tables = { frameup_post_links: 'unknown', frameup_events: 'unknown' };
  const isMissing = error => /does not exist|could not find|schema cache|PGRST20[25]|42P01|42883/i.test(`${error?.code || ''} ${error?.message || ''}`);

  async function getClient() {
    try {
      const auth = window.ESAuth;
      if (!auth) return null;
      if (auth.ensureSupabaseReady && !(await auth.ensureSupabaseReady())) return null;
      const client = auth.getSupabaseClient?.();
      if (!client?.auth) return null;
      const session = (await client.auth.getSession())?.data?.session;
      const email = String(session?.user?.email || '').toLowerCase();
      return email ? { client, email } : null;
    } catch (error) {
      return null;
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────
  async function track(event, { taskId = null, source = SOURCE, meta = {} } = {}) {
    if (tables.frameup_events === 'missing') return false;
    const ctx = await getClient();
    if (!ctx) return false;
    const cleanMeta = {};
    Object.entries(meta || {}).forEach(([key, value]) => {
      if (value == null || value === '') return;
      if (typeof value === 'number' && Number.isFinite(value)) cleanMeta[key] = Math.round(value * 100) / 100;
      else if (typeof value === 'boolean') cleanMeta[key] = value;
      else if (Array.isArray(value)) cleanMeta[key] = value.slice(0, 6).map(item => String(item).slice(0, 120));
      else cleanMeta[key] = String(value).slice(0, 120);
    });
    try {
      const { error } = await ctx.client.from('frameup_events').insert({
        user_email: ctx.email,
        event,
        source: ['editor', 'generate', 'video-ads', 'reels', 'gallery', 'dashboard'].includes(source) ? source : '',
        session_id: SESSION_ID,
        task_id: taskId || null,
        meta: cleanMeta,
      });
      if (error) {
        if (isMissing(error)) tables.frameup_events = 'missing';
        return false;
      }
      tables.frameup_events = 'ready';
      return true;
    } catch (error) {
      return false;
    }
  }

  // "Design started": the first real interaction after the page opened or
  // after the last export. Export events carry the time since then.
  let designStartedAt = null;
  function inDesignSurface(target) {
    if (!SOURCE || ['gallery', 'dashboard'].includes(SOURCE)) return false;
    if (SOURCE === 'editor' && !EDITOR_ROUTES.has(String(location.hash || '').replace(/^#/, '').split(/[?&]/)[0])) return false;
    return !(target instanceof Element && target.closest('.fp-root, .es-sidebar, .navbar, .site-nav, .tour-root, dialog'));
  }
  function markStarted(event) {
    if (designStartedAt || !inDesignSurface(event?.target)) return;
    if (event?.isTrusted === false) return;
    designStartedAt = Date.now();
    track('design_started', { meta: { route: SOURCE === 'editor' ? String(location.hash || '').slice(1, 30) : '' } });
  }
  ['pointerdown', 'keydown', 'input'].forEach(type => document.addEventListener(type, markStarted, { capture: true, passive: true }));

  // ── Post links ────────────────────────────────────────────────────────────
  function linkRow(email, info, detected) {
    const size = info.size || (Array.isArray(info.sizes) ? info.sizes.join(',') : '');
    return {
      user_email: email,
      task_id: info.taskId || null,
      source: ['editor', 'generate', 'video-ads', 'reels', 'gallery', 'dashboard'].includes(info.source) ? info.source : (SOURCE || 'editor'),
      design_ref: String(info.designRef || info.filename || info.title || '').slice(0, 200),
      platform: detected.platform,
      // Stored without tracking params (igsh, si, utm_*…), so it matches imports.
      url: detected.normalizedUrl || detected.url || '',
      external_id: detected.externalId || '',
      brand: String(info.brand || '').slice(0, 80),
      style: String(info.style || info.template || '').slice(0, 80),
      angle: String(info.angle || '').slice(0, 80),
      size: String(size).slice(0, 40),
      ad_name: String((info.adNames && info.adNames[0]) || info.adName || '').slice(0, 200),
      utm_campaign: I.utmParams({ brand: info.brand, designId: info.taskId || info.designRef || info.title }).utm_campaign,
    };
  }

  async function insertLink(row) {
    const ctx = await getClient();
    if (!ctx) return { ok: false, reason: 'signed-out' };
    if (tables.frameup_post_links === 'missing') return { ok: false, reason: 'missing' };
    try {
      const { data, error } = await ctx.client.from('frameup_post_links').insert({ ...row, user_email: ctx.email }).select('id, task_id, platform, url, external_id, posted_at').single();
      if (error) {
        if (isMissing(error)) { tables.frameup_post_links = 'missing'; return { ok: false, reason: 'missing' }; }
        return { ok: false, reason: 'error', message: error.message };
      }
      tables.frameup_post_links = 'ready';
      return { ok: true, row: data };
    } catch (error) {
      return { ok: false, reason: 'error', message: error?.message };
    }
  }

  function queuePending(row) {
    const list = readJson(PENDING_KEY, []);
    writeJson(PENDING_KEY, [{ ...row, queued_at: new Date().toISOString() }, ...(Array.isArray(list) ? list : [])].slice(0, 50));
  }

  async function flushPending() {
    const list = readJson(PENDING_KEY, []);
    if (!Array.isArray(list) || !list.length) return;
    const left = [];
    for (const item of list) {
      const { queued_at: queuedAt, ...row } = item;
      const saved = await insertLink({ ...row, posted_at: queuedAt || undefined });
      if (!saved.ok) left.push(item);
      if (saved.reason === 'missing' || saved.reason === 'signed-out') { left.push(...list.slice(list.indexOf(item) + 1)); break; }
    }
    writeJson(PENDING_KEY, left);
  }

  async function savePostedLink(info, value) {
    const detected = I.detectPlatform(value);
    if (!detected.ok) return { ok: false, message: detected.error };
    const ctx = await getClient();
    const row = linkRow(ctx?.email || '', info, detected);
    if (!ctx) {
      queuePending(row);
      return { ok: true, local: true, detected, message: 'Kept on this device. It saves when you’re signed in.' };
    }
    const saved = await insertLink(row);
    if (saved.ok) {
      track('posted_link_added', { taskId: info.taskId, source: row.source, meta: { platform: detected.platform } });
      return { ok: true, detected, row: saved.row };
    }
    if (saved.reason === 'missing') {
      queuePending(row);
      return { ok: true, local: true, detected, message: 'Kept on this device. It saves to FrameUp once link saving is switched on.' };
    }
    return { ok: false, message: `Couldn’t save the link${saved.message ? `: ${saved.message}` : ''}. Try again.` };
  }

  async function listOwnLinks(taskId) {
    const local = (readJson(PENDING_KEY, []) || []).filter(item => taskId && item.task_id === taskId)
      .map(item => ({ id: '', platform: item.platform, url: item.url, external_id: item.external_id, local: true }));
    if (!taskId) return local;
    const ctx = await getClient();
    if (!ctx || tables.frameup_post_links === 'missing') return local;
    try {
      const { data, error } = await ctx.client.from('frameup_post_links')
        .select('id, platform, url, external_id, posted_at, user_email')
        .eq('task_id', taskId)
        .order('posted_at', { ascending: false })
        .limit(20);
      if (error) { if (isMissing(error)) tables.frameup_post_links = 'missing'; return local; }
      return [...local, ...(data || []).map(row => ({ ...row, mine: String(row.user_email || '').toLowerCase() === ctx.email }))];
    } catch (error) {
      return local;
    }
  }

  async function removeLink(id) {
    const ctx = await getClient();
    if (!ctx || !id) return false;
    try {
      const { error } = await ctx.client.from('frameup_post_links').delete().eq('id', id);
      return !error;
    } catch (error) {
      return false;
    }
  }

  // Gallery: posted state for many cards in one call.
  async function fetchStatus(ids = []) {
    const clean = [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))].slice(0, 200);
    const result = new Map();
    (readJson(PENDING_KEY, []) || []).forEach(item => {
      if (!item.task_id || !clean.includes(item.task_id)) return;
      const entry = result.get(item.task_id) || { platforms: [], links: 0, latestUrl: item.url, latestPlatform: item.platform };
      if (!entry.platforms.includes(item.platform)) entry.platforms.push(item.platform);
      entry.links += 1;
      result.set(item.task_id, entry);
    });
    if (!clean.length) return result;
    const ctx = await getClient();
    if (!ctx || tables.frameup_post_links === 'missing') return result;
    try {
      const { data, error } = await ctx.client.rpc('list_frameup_post_status', { p_ids: clean });
      if (!error) {
        (data || []).forEach(row => result.set(row.task_id, {
          platforms: Array.isArray(row.platforms) ? row.platforms : [],
          links: Number(row.links) || 0,
          latestUrl: row.latest_url || '',
          latestPlatform: row.latest_platform || '',
        }));
        return result;
      }
      if (isMissing(error)) tables.frameup_post_links = 'missing';
    } catch (error) { /* fall through */ }
    return result;
  }

  // ── UTM ───────────────────────────────────────────────────────────────────
  const utmEnabled = () => readJson(UTM_KEY, { on: false })?.on === true;
  const setUtmEnabled = on => writeJson(UTM_KEY, { on: Boolean(on) });
  const utmFor = (ctx = {}) => I.utmParams({ brand: ctx.brand, designId: ctx.designId || ctx.taskId, platform: ctx.platform, workspace: ctx.workspace, template: ctx.template });
  const decorateLink = (url, ctx = {}) => (utmEnabled() ? I.buildUtmUrl(url, utmFor(ctx)) : url);
  const decorateHtml = (html, ctx = {}) => (utmEnabled() ? I.addUtmToHtml(html, utmFor(ctx)) : html);

  // ── UI ────────────────────────────────────────────────────────────────────
  const ICONS = {
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  };

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (value == null || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value; // static icon markup only
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    (Array.isArray(children) ? children : [children]).filter(Boolean).forEach(child => node.append(child));
    return node;
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (error) {
      const area = el('textarea', { readonly: true, style: 'position:fixed;opacity:0' });
      area.value = text;
      document.body.append(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      area.remove();
      return ok;
    }
  }

  let uid = 0;
  function renderLinks(list, links, { onRemove } = {}) {
    list.replaceChildren(...links.map(link => {
      const label = I.PLATFORMS[link.platform] || 'Link';
      const target = link.url
        ? el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', text: link.url.replace(/^https?:\/\/(www\.)?/, '') })
        : el('span', { class: 'fp-link__text', text: link.external_id ? `Ad ${link.external_id}` : label });
      const remove = link.id && link.mine !== false && onRemove
        ? el('button', { type: 'button', class: 'fp-icon-btn', 'aria-label': `Remove ${label} link`, html: ICONS.trash, onclick: () => onRemove(link) })
        : null;
      return el('li', { class: 'fp-link' }, [el('span', { class: 'fp-platform is-good', text: link.local ? `${label} · on this device` : label }), target, remove]);
    }));
  }

  // The form shared by the floating card and the inline panel.
  function buildForm(info, { onSaved, compact = false } = {}) {
    const id = `fp-url-${++uid}`;
    const hintId = `${id}-hint`;
    const input = el('input', {
      id,
      class: 'es-input',
      type: 'url',
      inputmode: 'url',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'Paste the post link',
      'aria-describedby': hintId,
    });
    const save = el('button', { type: 'submit', class: `es-btn es-btn--sm${compact ? '' : ' es-btn--static'}`, text: 'Save' });
    const hint = el('p', { class: 'fp-hint', id: hintId, 'aria-live': 'polite', text: 'Instagram, X, Facebook, Threads, YouTube, a newsletter issue or a Meta ad id.' });
    const list = el('ul', { class: 'fp-links', 'aria-label': 'Where it was posted' });
    const showHint = (text, tone = '') => { hint.className = `fp-hint${tone ? ` is-${tone}` : ''}`; hint.textContent = text; };
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      const value = input.value.trim();
      if (!value) { showHint('Instagram, X, Facebook, Threads, YouTube, a newsletter issue or a Meta ad id.'); return; }
      const detected = I.detectPlatform(value);
      if (detected.ok) {
        hint.className = 'fp-hint';
        hint.replaceChildren(el('span', { class: 'fp-platform', text: detected.label }), document.createTextNode(detected.externalId ? `Post ${detected.externalId}` : 'Detected from the link'));
      } else showHint('Keep pasting: a full link starts with https://');
    });
    const form = el('form', { class: 'fp-form', novalidate: true }, [
      el('label', { class: 'fp-label', for: id, text: 'Link to the post' }),
      el('div', { class: 'fp-row' }, [input, save]),
      hint,
      list,
    ]);
    const links = [];
    const refreshList = () => renderLinks(list, links, {
      onRemove: async link => {
        if (!(await removeLink(link.id))) { showHint('Couldn’t remove that link. Try again.', 'error'); return; }
        links.splice(links.indexOf(link), 1);
        refreshList();
        showHint('Link removed.');
      },
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      const value = input.value.trim();
      const detected = I.detectPlatform(value);
      if (!detected.ok) {
        input.setAttribute('aria-invalid', 'true');
        showHint(detected.error, 'error');
        input.focus();
        return;
      }
      save.disabled = true;
      save.setAttribute('aria-busy', 'true');
      const saved = await savePostedLink(info, value);
      save.disabled = false;
      save.removeAttribute('aria-busy');
      if (!saved.ok) { input.setAttribute('aria-invalid', 'true'); showHint(saved.message, 'error'); return; }
      input.removeAttribute('aria-invalid');
      links.unshift({ id: saved.row?.id || '', platform: detected.platform, url: detected.normalizedUrl || detected.url, external_id: detected.externalId, local: saved.local, mine: true });
      refreshList();
      input.value = '';
      showHint(saved.local ? saved.message : `Saved. Posted on ${detected.label}.`, saved.local ? '' : 'good');
      onSaved?.(saved);
    });
    return {
      form,
      input,
      setLinks(rows) { links.splice(0, links.length, ...rows); refreshList(); },
    };
  }

  let card = null;
  function closeCard({ restore = true } = {}) {
    if (!card) return;
    const previous = card._returnFocus;
    card.remove();
    card = null;
    if (restore && previous?.isConnected) previous.focus?.({ preventScroll: true });
  }

  function openCard(build) {
    closeCard({ restore: false });
    const returnFocus = document.activeElement;
    card = el('section', { class: 'fp-root', role: 'region', 'aria-label': 'Posted it? Paste the link' });
    card._returnFocus = returnFocus;
    build(card);
    card.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeCard(); } });
    document.body.append(card);
    return card;
  }

  function cardHead(title, sub) {
    return el('div', { class: 'fp-head' }, [
      el('span', { class: 'fp-head__icon', html: ICONS.link }),
      el('div', { class: 'fp-head__copy' }, [el('p', { class: 'fp-title', text: title }), sub ? el('p', { class: 'fp-sub', text: sub }) : null]),
      el('button', { type: 'button', class: 'fp-icon-btn', 'aria-label': 'Close', html: ICONS.close, onclick: () => closeCard() }),
    ]);
  }

  function adNameRows(info) {
    const names = Array.isArray(info.adNames) ? info.adNames.filter(Boolean) : [];
    if (!names.length) return null;
    return el('div', { class: 'fp-extra' }, [
      el('p', { class: 'fp-label', text: names.length > 1 ? 'Ad names for Meta (one per size)' : 'Ad name for Meta' }),
      ...names.slice(0, 4).map(name => {
        const button = el('button', { type: 'button', class: 'es-btn es-btn--sm es-btn--tertiary', 'aria-label': `Copy ad name ${name}`, html: `${ICONS.copy}<span>Copy</span>` });
        button.addEventListener('click', async () => {
          const ok = await copyText(name);
          button.querySelector('span').textContent = ok ? 'Copied' : 'Select it';
          setTimeout(() => { if (button.isConnected) button.querySelector('span').textContent = 'Copy'; }, 1600);
        });
        return el('div', { class: 'fp-adname' }, [el('code', { text: name, title: name }), button]);
      }),
      el('p', { class: 'fp-hint', text: 'Name the ad this way in Ads Manager and imported results match it automatically.' }),
    ]);
  }

  // Shown after an export, on every tool.
  function offer(info = {}) {
    if (!info || info.offer === false) return;
    const sub = [info.title, info.template].filter(Boolean).join(' · ').slice(0, 120);
    openCard(root => {
      const form = buildForm(info, {});
      root.append(cardHead('Posted it? Paste the link', sub || 'So FrameUp can learn what works.'), form.form);
      const adRows = adNameRows(info);
      if (adRows) root.append(adRows);
      if (info.taskId) listOwnLinks(info.taskId).then(rows => { if (rows.length && form.form.isConnected) form.setLinks(rows); });
    });
  }

  // After a link or HTML is copied: the UTM toggle (re-copies on change).
  function afterCopy({ kind = 'link', raw = '', copy, ctx = {}, title = '' } = {}) {
    if (!raw) return;
    const make = () => (kind === 'html' ? decorateHtml(raw, ctx) : decorateLink(raw, ctx));
    openCard(root => {
      const id = `fp-utm-${++uid}`;
      const toggle = el('input', { id, type: 'checkbox', role: 'switch' });
      toggle.checked = utmEnabled();
      const params = utmFor(ctx);
      const preview = el('p', { class: 'fp-utm-preview', text: `utm_source=${params.utm_source} · utm_medium=${params.utm_medium} · utm_campaign=${params.utm_campaign}` });
      const status = el('p', { class: 'fp-hint', 'aria-live': 'polite', text: '' });
      toggle.addEventListener('change', async () => {
        setUtmEnabled(toggle.checked);
        const text = make();
        const ok = copy ? await copy(text) : await copyText(text);
        status.className = `fp-hint${ok ? ' is-good' : ' is-error'}`;
        status.textContent = ok
          ? (toggle.checked ? `Copied again with UTM tags${kind === 'html' ? ' on its links' : ''}.` : 'Copied again without UTM tags.')
          : 'Couldn’t copy. Try the copy button again.';
      });
      root.append(
        cardHead(kind === 'html' ? 'HTML copied' : 'Link copied', title || (kind === 'html' ? 'Newsletter widget' : 'Image link')),
        el('div', { class: 'fp-extra' }, [
          el('label', { class: 'fp-toggle', for: id }, [el('span', { text: kind === 'html' ? 'Add UTM tags to the links in it' : 'Add UTM tags to copied links' }), toggle]),
          preview,
          status,
        ]),
      );
    });
  }

  // Inline panel for the Gallery viewer and the Dashboard drawer.
  async function mount(container, info = {}) {
    if (!container) return null;
    container.querySelectorAll(':scope > .fp-inline').forEach(node => node.remove());
    const wrap = el('div', { class: 'fp-inline', 'data-task': info.taskId || '' });
    const status = el('span', { class: 'fp-platform', hidden: true });
    const form = buildForm({ source: SOURCE, ...info }, { compact: true, onSaved: () => { status.hidden = false; status.className = 'fp-platform is-good'; status.textContent = 'Posted'; info.onChange?.(); } });
    wrap.append(el('div', { class: 'fp-inline__head' }, [el('p', { class: 'fp-title', text: 'Posted it?' }), status]), form.form);
    container.append(wrap);
    const [own, map] = await Promise.all([listOwnLinks(info.taskId), info.taskId ? fetchStatus([info.taskId]) : Promise.resolve(new Map())]);
    if (!wrap.isConnected) return wrap;
    const entry = map.get(info.taskId);
    const rows = [...own];
    // Someone else's latest link (the Gallery RPC shows it; admins see all rows).
    if (entry?.latestUrl && !rows.some(row => row.url === entry.latestUrl)) rows.push({ id: '', platform: entry.latestPlatform, url: entry.latestUrl, mine: false });
    if (rows.length || entry?.links) {
      status.hidden = false;
      status.className = 'fp-platform is-good';
      status.textContent = entry?.links > 1 ? `Posted · ${entry.links} links` : 'Posted';
    }
    form.setLinks(rows);
    return wrap;
  }

  function badge(entry) {
    if (!entry || !(entry.links || entry.platforms?.length)) return null;
    const names = (entry.platforms || []).map(p => I.PLATFORMS[p] || 'Link');
    return el('span', { class: 'fp-card-badge', title: `Posted on ${names.join(', ')}`, text: names.length === 1 ? `Posted · ${names[0]}` : `Posted · ${names.length}` });
  }

  // ── Export hook ───────────────────────────────────────────────────────────
  function exported(info = {}) {
    try {
      const elapsed = designStartedAt ? Date.now() - designStartedAt : null;
      designStartedAt = null;
      const source = info.source || SOURCE;
      // Tools without a task row get a reference id, so the export, its
      // posted links and imported results all join on the same task_id.
      const taskId = info.taskId || `${REF_PREFIX[source] || 'ref'}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      info = { ...info, taskId };
      track('export_done', {
        taskId,
        source,
        meta: {
          template: info.template,
          workspace: info.workspace,
          size: info.size || (Array.isArray(info.sizes) ? info.sizes.join(',') : ''),
          brand: info.brand,
          style: info.style,
          angle: info.angle,
          ai: info.aiMade || '',
          elapsed_ms: elapsed,
          ad_names: info.adNames,
          count: info.count,
        },
      });
      offer({ ...info, source });
    } catch (error) {
      console.warn('[posted] export hook failed:', error);
    }
  }

  // Editor exports arrive as a dashboard "design" change (recordDesignExport).
  if (SOURCE === 'editor') {
    window.addEventListener('es-dashboard-data-change', event => {
      const detail = event.detail || {};
      if (detail.type !== 'design' || !detail.record?.id) return;
      const record = detail.record;
      const brand = record.workspace === 'Newsletter' ? record.teamOrLeague : 'essentiallysports';
      exported({
        source: 'editor',
        taskId: `task-design-${record.id}`,
        title: record.title,
        template: record.workspaceVariant,
        workspace: record.workspace,
        brand,
        size: String(record.metadata?.outputSize || '').replace(/\s*×\s*/, 'x').replace(/px$/, ''),
        filename: record.filename,
        aiMade: record.metadata?.generated ? 'generate' : '',
      });
    });
  }

  // Links kept while signed out (or before the migration) go up when possible.
  window.addEventListener('es:auth-ready', () => { flushPending(); }, { once: true });
  setTimeout(() => { flushPending(); }, 4000);

  window.FrameUpPosted = Object.freeze({
    SOURCE,
    SESSION_ID,
    track,
    exported,
    offer,
    afterCopy,
    mount,
    badge,
    fetchStatus,
    savePostedLink,
    decorateLink,
    decorateHtml,
    utmEnabled,
    setUtmEnabled,
    markGenerateRun(meta = {}) {
      if (!designStartedAt) designStartedAt = Date.now();
      track('generate_run', { source: 'generate', meta });
      window.FrameUpTrack?.track?.('generate', { tool: 'generate', action: String(meta.format || 'run'), meta: { count: meta.count } });
    },
    close: closeCard,
  });
})();
