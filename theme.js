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
    if (document.querySelector('[data-theme-switcher]')) return;

    const navbar = document.querySelector('.navbar');
    const profileMenu = document.querySelector('.profile-dropdown');
    const switcher = document.createElement('div');
    switcher.className = profileMenu ? 'profile-theme-option' : 'theme-switcher' + (navbar ? '' : ' theme-switcher--floating');
    switcher.dataset.themeSwitcher = 'true';
    switcher.innerHTML = `${profileMenu ? '<span class="profile-theme-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3v2.2M12 18.8V21M5.64 5.64l1.56 1.56M16.8 16.8l1.56 1.56M3 12h2.2M18.8 12H21M5.64 18.36l1.56-1.56M16.8 7.2l1.56-1.56" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="3.8" stroke="currentColor" stroke-width="1.8"/></svg></span><span class="profile-theme-label">Appearance</span>' : ''}
      <button class="theme-switch" type="button" role="switch" aria-checked="false" aria-label="Switch to dark mode" title="Switch to dark mode">
        <span class="theme-switch-sun" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </span>
        <span class="theme-switch-thumb" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M20.5 15.2A8.6 8.6 0 0 1 8.8 3.5a8.6 8.6 0 1 0 11.7 11.7Z" fill="currentColor"/></svg>
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderSwitcher, { once: true });
  else renderSwitcher();
}());
