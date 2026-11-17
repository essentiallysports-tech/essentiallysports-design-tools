// Shell first: paint the page frame (sidebar, header) and a loading
// skeleton straight away, instead of a blank window while the sign-in check
// runs (ESAuth.requireAuth hides the whole page until it finishes, which is
// 1–4 s on a cold load: the Supabase SDK download plus the session check).
//
// Security is unchanged: the page's own content (#main) stays hidden and
// unclickable until the same check passes ('es:auth-ready'); if it fails,
// requireAuth sends the visitor to the login page exactly as before. The
// account name and AI usage in the sidebar also wait for the check, since
// they come from a previous session. Nothing private is fetched or shown
// earlier than before.
//
// Load right after the requireAuth() call:
//   <script src="frameup-shell-first.js?v=…" data-skeleton="studio|grid"></script>
(() => {
  'use strict';

  const html = document.documentElement;
  // Only while requireAuth is holding the page (it sets visibility: hidden).
  if (html.style.visibility !== 'hidden' || html.classList.contains('es-auth-pending')) return;
  const variant = document.currentScript?.dataset.skeleton === 'grid' ? 'grid' : 'studio';
  const started = performance.now();

  const style = document.createElement('style');
  style.id = 'es-shell-first-style';
  style.textContent = `
    html.es-auth-pending { visibility: visible !important; }
    html.es-auth-pending #main { position: relative; min-height: min(70vh, 640px); }
    html.es-auth-pending #main > :not(.es-auth-skeleton, .es-auth-live),
    html.es-auth-pending :is([data-profile-name], [data-profile-initial], [data-profile-sub], .profile-trigger, .profile-menu, [data-shell-usage], .es-usage) {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    .es-auth-skeleton { position: absolute; inset: var(--es-space-8, 32px) var(--es-space-6, 24px) auto; display: grid; gap: var(--es-space-4, 16px); visibility: visible; pointer-events: none; }
    .es-auth-skeleton span { display: block; border-radius: var(--es-radius-control, 10px); background: rgb(14 16 20 / .07); }
    html[data-theme="dark"] .es-auth-skeleton span { background: rgb(255 255 255 / .08); }
    .es-auth-skeleton .is-title { width: min(360px, 60%); height: 32px; }
    .es-auth-skeleton .is-line { width: min(560px, 85%); height: 14px; }
    .es-auth-skeleton .is-card { height: 200px; border-radius: var(--es-radius-container, 16px); }
    .es-auth-skeleton .is-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--es-space-4, 16px); }
    html .es-auth-skeleton span.is-row { background: none; }
    .es-auth-skeleton .is-row > span { height: 120px; border-radius: var(--es-radius-container, 16px); }
    .es-auth-skeleton.is-grid .is-row { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .es-auth-skeleton.is-grid .is-row > span { height: auto; aspect-ratio: 4 / 5; }
    @media (max-width: 640px) {
      .es-auth-skeleton { inset: var(--es-space-6, 24px) var(--es-space-4, 16px) auto; }
      .es-auth-skeleton .is-row, .es-auth-skeleton.is-grid .is-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .es-auth-skeleton .is-card { height: 160px; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .es-auth-skeleton span:not(.is-row) { animation: es-auth-skeleton-pulse 1.4s ease-in-out infinite; }
      @keyframes es-auth-skeleton-pulse { 50% { opacity: .55; } }
    }
  `;
  document.head.appendChild(style);
  html.classList.add('es-auth-pending');

  const skeleton = document.createElement('div');
  skeleton.className = `es-auth-skeleton is-${variant}`;
  skeleton.setAttribute('aria-hidden', 'true');
  skeleton.innerHTML = variant === 'grid'
    ? '<span class="is-title"></span><span class="is-line"></span><span class="is-row"><span></span><span></span><span></span><span></span></span><span class="is-row"><span></span><span></span><span></span><span></span></span>'
    : '<span class="is-title"></span><span class="is-line"></span><span class="is-card"></span><span class="is-row"><span></span><span></span><span></span></span>';

  // Screen readers hear that the page is loading, not silence.
  const live = document.createElement('p');
  live.className = 'es-auth-live';
  live.setAttribute('role', 'status');
  live.textContent = 'Loading…';
  live.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;';

  let placed = false;
  function place() {
    const main = document.getElementById('main');
    if (!main || placed) return Boolean(main);
    main.prepend(skeleton, live);
    placed = true;
    return true;
  }
  let observer = null;
  if (!place()) {
    observer = new MutationObserver(() => { if (place()) observer.disconnect(); });
    observer.observe(html, { childList: true, subtree: true });
  }

  function reveal() {
    observer?.disconnect();
    skeleton.remove();
    live.remove();
    html.classList.remove('es-auth-pending');
    try { performance.measure?.('frameup:auth-wait', { start: started, end: performance.now() }); } catch (error) { /* timing only */ }
  }
  window.addEventListener('es:auth-ready', reveal, { once: true });
})();
