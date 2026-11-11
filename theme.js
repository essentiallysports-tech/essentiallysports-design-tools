/* Shared FrameUp theme controller.
   The site intentionally defaults to the established light interface. A user
   choice is persisted locally and applied before the page paints. */
(function () {
  const STORAGE_KEY = 'frameup.theme.v1';
  const DARK_THEME = 'dark';
  const LIGHT_THEME = 'light';

  function readTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY) === DARK_THEME ? DARK_THEME : LIGHT_THEME;
    } catch {
      return LIGHT_THEME;
    }
  }

  function applyTheme(theme) {
    const normalizedTheme = theme === DARK_THEME ? DARK_THEME : LIGHT_THEME;
    document.documentElement.dataset.theme = normalizedTheme;
    document.documentElement.style.colorScheme = normalizedTheme;
    try {
      localStorage.setItem(STORAGE_KEY, normalizedTheme);
    } catch {}
    window.dispatchEvent(new CustomEvent('frameup-theme-change', { detail: { theme: normalizedTheme } }));
    return normalizedTheme;
  }

  // Apply as soon as the script is parsed to avoid a light-frame flash.
  document.documentElement.dataset.theme = readTheme();
  document.documentElement.style.colorScheme = document.documentElement.dataset.theme;

  function themeLabel(theme) {
    return theme === DARK_THEME ? 'Switch to light mode' : 'Switch to dark mode';
  }

  function renderSwitcher() {
    if (document.querySelector('[data-profile-theme-choice]')) return;
    if (document.querySelector('[data-theme-switcher]')) return;

    const navbar = document.querySelector('.navbar');
    const profileMenu = document.querySelector('.profile-dropdown');
    const switcher = document.createElement('div');
    switcher.className = profileMenu ? 'profile-theme-option' : 'theme-switcher' + (navbar ? '' : ' theme-switcher--floating');
    switcher.dataset.themeSwitcher = 'true';
    switcher.innerHTML = `${profileMenu ? '<span class="profile-theme-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v2"/><path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715"/><path d="M16 12a4 4 0 0 0-4-4"/><path d="m19 5-1.256 1.256"/><path d="M20 12h2"/></svg></span><span class="profile-theme-label">Appearance</span>' : ''}
      <button class="theme-switch" type="button" role="switch" aria-checked="false" aria-label="Switch to dark mode" title="Switch to dark mode">
        <span class="theme-switch-sun" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
        </span>
        <span class="theme-switch-thumb" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>
        </span>
      </button>
    `;

    if (profileMenu) {
      profileMenu.insertBefore(switcher, profileMenu.lastElementChild);
    } else if (navbar) {
      navbar.insertAdjacentElement('afterend', switcher);
      document.body.classList.add('has-theme-navbar');
    } else {
      document.body.append(switcher);
    }

    const button = switcher.querySelector('.theme-switch');
    const updateButton = () => {
      const isDark = document.documentElement.dataset.theme === DARK_THEME;
      button.setAttribute('aria-checked', String(isDark));
      button.setAttribute('aria-label', themeLabel(document.documentElement.dataset.theme));
      button.setAttribute('title', themeLabel(document.documentElement.dataset.theme));
    };

    button.addEventListener('click', () => {
      applyTheme(document.documentElement.dataset.theme === DARK_THEME ? LIGHT_THEME : DARK_THEME);
      updateButton();
    });
    updateButton();
  }

  window.FrameUpTheme = { apply: applyTheme, current: () => document.documentElement.dataset.theme || LIGHT_THEME };
  const scheduleSwitcher = () => requestAnimationFrame(renderSwitcher);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleSwitcher, { once: true });
  else scheduleSwitcher();
}());
