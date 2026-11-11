// FrameUp keyboard shortcuts for the editor.
//   Ctrl/⌘ + E          Export (same as the Export button, with its checks)
//   Ctrl/⌘ + Shift + L  Copy link
//   ?                   List of shortcuts
// Undo / Redo (Ctrl/⌘ + Z, Shift + Ctrl/⌘ + Z) and ⌘K search already exist.
(() => {
  'use strict';

  if (window.top !== window) return;
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const MOD = IS_MAC ? '⌘' : 'Ctrl';
  const EDITOR_PAGES = new Set(['instagram', 'youtube', 'newsletter']);

  const SHORTCUTS = [
    ['Export', [MOD, 'E']],
    ['Copy link', [MOD, 'Shift', 'L']],
    ['Undo', [MOD, 'Z']],
    ['Redo', [MOD, 'Shift', 'Z']],
    ['Search FrameUp', [MOD, 'K']],
    ['Move a selected photo', ['Arrow keys']],
    ['Move it faster', ['Shift', 'Arrow keys']],
    ['Zoom a selected photo', ['+', '−']],
    ['Finish editing a photo', ['Esc']],
    ['This list', ['?']],
  ];

  function inEditor() {
    return EDITOR_PAGES.has(document.body?.dataset.currentPage || '');
  }

  function isTyping(target) {
    return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
  }

  function visibleButton(...ids) {
    return ids.map(id => document.getElementById(id)).find(button => button && button.offsetParent !== null) || null;
  }

  function showShortcuts() {
    document.querySelectorAll('.shortcuts-dialog').forEach(stale => stale.remove());
    const dialog = document.createElement('dialog');
    dialog.className = 'es-dialog shortcuts-dialog';
    dialog.setAttribute('aria-labelledby', 'shortcuts-title');
    dialog.innerHTML = `
      <div class="shortcuts-head">
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <button class="shortcuts-close" type="button" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
      </div>
      <dl class="shortcuts-list"></dl>`;
    const list = dialog.querySelector('.shortcuts-list');
    SHORTCUTS.forEach(([label, keys]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const keysCell = document.createElement('dd');
      keys.forEach((key, index) => {
        if (index) keysCell.append(' ');
        const kbd = document.createElement('kbd');
        kbd.className = 'es-kbd';
        kbd.textContent = key;
        keysCell.appendChild(kbd);
      });
      list.append(term, keysCell);
    });
    dialog.querySelector('.shortcuts-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || !inEditor()) return;
    if (document.querySelector('dialog[open]')) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && !event.shiftKey && key === 'e') {
      event.preventDefault();
      visibleButton('studio-export-btn', 'download-btn')?.click();
      return;
    }
    if (mod && !event.altKey && event.shiftKey && key === 'l') {
      event.preventDefault();
      visibleButton('studio-link-btn')?.click();
      return;
    }
    if (!mod && !event.altKey && event.key === '?' && !isTyping(event.target)) {
      event.preventDefault();
      showShortcuts();
    }
  });

  // Show the shortcut on the buttons' tooltips.
  function labelButtons() {
    const exportButton = document.getElementById('studio-export-btn');
    if (exportButton && !exportButton.title) exportButton.title = `Export (${MOD}+E)`;
    const linkButton = document.getElementById('studio-link-btn');
    if (linkButton && !/Shift\+L/.test(linkButton.title)) linkButton.title = `${linkButton.title || 'Copy link'} (${MOD}+Shift+L)`;
  }

  // ─── Export options (PNG, 2×) ────────────────────────────────────────────
  // The setting itself lives in index.html (getExportOptions), used by every
  // export; this is the small menu that changes it.
  let menu = null;

  function exportSizeText() {
    try {
      const workspace = applyExportOptions(getWorkspace());
      const w = Math.round(workspace.width * workspace.exportScale);
      const h = Math.round(workspace.height * workspace.exportScale);
      return `You’ll get a ${w} × ${h} px ${workspace.exportExtension === 'png' ? 'PNG' : 'JPG'}`;
    } catch (error) {
      return '';
    }
  }

  function syncOptionsBadge() {
    const badge = document.querySelector('[data-export-options-badge]');
    if (!badge || typeof getExportOptions !== 'function') return;
    const options = getExportOptions();
    const text = [options.png ? 'PNG' : '', options.double ? '2×' : ''].filter(Boolean).join(' ');
    badge.textContent = text;
    badge.hidden = !text;
  }

  function closeMenu() {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    document.getElementById('studio-export-options-btn')?.setAttribute('aria-expanded', 'false');
  }

  function openMenu(button) {
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'export-options-menu';
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-label', 'Export options');
      menu.innerHTML = `
        <h3 class="export-options-title">Export settings</h3>
        <div class="export-setting">
          <span class="export-setting__label" id="export-format-label">Format</span>
          <div class="export-segment" role="radiogroup" aria-labelledby="export-format-label">
            <button type="button" role="radio" data-export-choice="png" data-value="false">JPG</button>
            <button type="button" role="radio" data-export-choice="png" data-value="true">PNG</button>
          </div>
          <p class="export-setting__hint" data-export-hint="png"></p>
        </div>
        <div class="export-setting">
          <span class="export-setting__label" id="export-size-label">Size</span>
          <div class="export-segment" role="radiogroup" aria-labelledby="export-size-label">
            <button type="button" role="radio" data-export-choice="double" data-value="false">1×</button>
            <button type="button" role="radio" data-export-choice="double" data-value="true">2×</button>
          </div>
          <p class="export-setting__hint" data-export-hint="double"></p>
        </div>
        <p class="export-options-size" data-export-options-size></p>`;
      menu.addEventListener('click', event => {
        const choice = event.target.closest('[data-export-choice]');
        if (!choice) return;
        setExportOptions({ ...getExportOptions(), [choice.dataset.exportChoice]: choice.dataset.value === 'true' });
        syncMenu();
        syncOptionsBadge();
      });
      // Arrow keys move between the two choices of a group.
      menu.addEventListener('keydown', event => {
        const choice = event.target.closest('[data-export-choice]');
        if (!choice || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const other = [...choice.parentElement.children].find(button => button !== choice);
        other.click();
        other.focus();
      });
      menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { closeMenu(); button.focus(); }
      });
      document.body.appendChild(menu);
      document.addEventListener('pointerdown', event => {
        if (menu.hidden || menu.contains(event.target) || event.target.closest('#studio-export-options-btn')) return;
        closeMenu();
      });
      window.addEventListener('resize', closeMenu);
    }
    syncMenu();
    menu.hidden = false;
    const rect = button.getBoundingClientRect();
    const width = menu.offsetWidth || 280;
    menu.style.top = `${Math.round(rect.bottom + 8)}px`;
    menu.style.left = `${Math.round(Math.max(16, Math.min(window.innerWidth - width - 16, rect.right - width)))}px`;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('[data-export-choice][aria-checked="true"]')?.focus();
  }

  const EXPORT_HINTS = {
    png: { false: 'Smaller file. Best for photos.', true: 'Sharper text and edges. Bigger file.' },
    double: { false: 'The template’s standard size.', true: 'Crisper on high-resolution screens. Bigger file.' },
  };

  function syncMenu() {
    if (!menu) return;
    const options = getExportOptions();
    menu.querySelectorAll('[data-export-choice]').forEach(choice => {
      const on = String(Boolean(options[choice.dataset.exportChoice])) === choice.dataset.value;
      choice.setAttribute('aria-checked', String(on));
      choice.tabIndex = on ? 0 : -1;
    });
    menu.querySelectorAll('[data-export-hint]').forEach(hint => {
      hint.textContent = EXPORT_HINTS[hint.dataset.exportHint][String(Boolean(options[hint.dataset.exportHint]))];
    });
    menu.querySelector('[data-export-options-size]').textContent = exportSizeText();
  }

  function setupExportOptions() {
    const button = document.getElementById('studio-export-options-btn');
    if (!button || typeof getExportOptions !== 'function') return;
    button.addEventListener('click', () => {
      if (menu && !menu.hidden) closeMenu();
      else openMenu(button);
    });
    syncOptionsBadge();
  }

  function init() {
    labelButtons();
    setupExportOptions();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  // ⌘K: editor actions, listed first while you're in an editor.
  window.FrameUpShell?.addPaletteSource?.(() => {
    if (!inEditor()) return [];
    const items = [];
    const exportButton = visibleButton('studio-export-btn', 'download-btn');
    if (exportButton) items.push({ label: 'Export', hint: `${MOD}+E`, icon: 'download', keywords: 'download save image jpg png', run: () => exportButton.click() });
    const linkButton = visibleButton('studio-link-btn');
    if (linkButton) items.push({ label: 'Copy link', hint: `${MOD}+Shift+L`, icon: 'link', keywords: 'share url upload', run: () => linkButton.click() });
    const copyHtml = visibleButton('widget-copy-btn');
    if (copyHtml) items.push({ label: 'Copy HTML', icon: 'link', keywords: 'widget beehiiv code', run: () => copyHtml.click() });
    const upload = document.querySelector('[data-background-upload]');
    if (upload && upload.offsetParent) items.push({ label: 'Upload a photo', icon: 'upload', keywords: 'image picture background', run: () => upload.click() });
    const optionsButton = visibleButton('studio-export-options-btn');
    if (optionsButton) items.push({ label: 'Export options', hint: 'PNG, 2×', icon: 'sliders', keywords: 'png size double', run: () => optionsButton.click() });
    items.push({ label: 'Browse templates', icon: 'template', keywords: 'change template post type asset picker', run: () => window.FrameUpTemplates?.openForPage?.() });
    items.push({ label: 'Recent designs', icon: 'clock', keywords: 'reopen past exports history', run: () => window.FrameUpDesigns?.showRecentDesigns?.() });
    items.push({ label: 'Keyboard shortcuts', hint: '?', icon: 'keyboard', keywords: 'keys hotkeys', run: showShortcuts });
    return [{ label: 'Actions', first: true, items }];
  });

  window.FrameUpShortcuts = Object.freeze({ show: showShortcuts });
})();
