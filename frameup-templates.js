// FrameUp template picker: a "Browse" button next to Post Type (Social Media)
// and Newsletter Asset opens a grid of previews with groups and search.
//
// The dropdowns stay the source of truth: picking a card sets the dropdown's
// value and fires its normal change event, so nothing about switching or
// rendering changes.
//
// Previews: assets/template-thumbs/<workspace>-<value>.webp (made from each
// template with sample photos). HTML widgets show a small live copy of the
// widget instead. A template without a preview image shows its name.
(() => {
  'use strict';

  const THUMB_DIR = 'assets/template-thumbs/';
  const THUMB_VERSION = '20261111-2'; // bump when previews are re-rendered
  const HTML_WIDGETS = new Set(['widgets', 'trivia', 'ticker', 'list', 'list2']);
  const PICKERS = [
    {
      selectId: 'instagram-post-type-select',
      workspace: 'instagram',
      title: 'Choose a post type',
      groups: [
        ['Covers and quotes', ['cover', 'quote', 'long-quote', 'double-entity-quote']],
        ['Stats', ['stats-single-ent', 'stats-double-ent', 'player-stat-line', 'team-record']],
        ['Lists and timelines', ['listicle-type-1', 'listicle-type-2', 'asap-template-1']],
        ['Tweets', ['twitter-quote', 'twitter-multi']],
      ],
    },
    {
      selectId: 'newsletter-asset-select',
      workspace: 'newsletter',
      title: 'Choose a newsletter asset',
      groups: null, // from the dropdown's own groups
    },
  ];

  const ICON_GRID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  function optionGroups(picker, select) {
    const options = [...select.options];
    if (picker.groups) {
      const used = new Set();
      const groups = picker.groups.map(([label, values]) => {
        const items = values.map(value => options.find(option => option.value === value)).filter(Boolean);
        items.forEach(option => used.add(option));
        return { label, options: items };
      });
      const rest = options.filter(option => !used.has(option));
      if (rest.length) groups.push({ label: 'More', options: rest });
      return groups.filter(group => group.options.length);
    }
    const groups = [];
    let current = null;
    options.forEach(option => {
      const parent = option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement : null;
      const label = parent?.label || 'Templates';
      if (!current || current.label !== label) {
        current = { label, options: [] };
        groups.push(current);
      }
      current.options.push(option);
    });
    return groups;
  }

  function widgetHtml(value) {
    try {
      if (value === 'trivia') return buildTriviaHtml(getTriviaPreviewState());
      if (value === 'list') return buildListHtml(listBuilderState);
      if (value === 'list2') return buildList2Html(list2BuilderState);
      if (value === 'ticker') return buildTickerHtml(getTickerPreviewState());
      return buildWidgetHtml(getWidgetPreviewState());
    } catch (error) {
      return '';
    }
  }

  function buildThumb(picker, option) {
    const thumb = document.createElement('span');
    thumb.className = 'template-card__thumb';
    if (picker.workspace === 'newsletter' && HTML_WIDGETS.has(option.value)) {
      thumb.classList.add('is-html');
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.setAttribute('scrolling', 'no');
      frame.loading = 'lazy';
      const html = widgetHtml(option.value);
      if (html) frame.srcdoc = wrapWidgetPreviewDoc(html);
      thumb.appendChild(frame);
      return thumb;
    }
    if (option.value.startsWith('section-header')) thumb.classList.add('is-strip');
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = `${THUMB_DIR}${picker.workspace}-${option.value}.webp?v=${THUMB_VERSION}`;
    img.addEventListener('error', () => {
      img.remove();
      thumb.classList.add('is-missing');
      thumb.textContent = option.textContent;
    }, { once: true });
    thumb.appendChild(img);
    return thumb;
  }

  // Scale live widget previews to their card.
  function fitHtmlThumbs(root) {
    root.querySelectorAll('.template-card__thumb.is-html').forEach(thumb => {
      const frame = thumb.querySelector('iframe');
      if (!frame) return;
      const scale = thumb.clientWidth / 640;
      frame.style.transform = `scale(${scale})`;
    });
  }

  // Every typed word starts a word of the card ("stat" finds "stats", "to"
  // doesn't match inside "photo"). A single word may also sit inside a name.
  function matchesQuery(haystack, query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 1 && haystack.includes(words[0])) return true;
    const tokens = haystack.split(/[^a-z0-9%]+/).filter(Boolean);
    return words.every(word => tokens.some(token => token.startsWith(word.replace(/[^a-z0-9%]/g, ''))));
  }

  function openPicker(picker) {
    const select = document.getElementById(picker.selectId);
    if (!select) return;
    document.querySelectorAll('.template-picker').forEach(stale => stale.remove());
    const dialog = document.createElement('dialog');
    dialog.className = `es-dialog template-picker${picker.workspace === 'instagram' ? ' is-portrait' : ''}`;
    dialog.setAttribute('aria-labelledby', 'template-picker-title');
    dialog.innerHTML = `
      <div class="template-picker__head">
        <div class="template-picker__titles">
          <h2 id="template-picker-title"></h2>
          <p class="template-picker__now"></p>
        </div>
        <button class="template-picker__close" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <label class="template-picker__search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
        <input type="search" placeholder="Search templates" aria-label="Search templates" autocomplete="off" spellcheck="false">
      </label>
      <div class="template-picker__filters" role="group" aria-label="Filter by category"></div>
      <div class="template-picker__body"></div>
      <p class="template-picker__empty" hidden>No templates match that search.</p>`;
    dialog.querySelector('h2').textContent = picker.title;
    const currentOption = select.options[select.selectedIndex];
    const now = dialog.querySelector('.template-picker__now');
    if (currentOption) {
      now.append('Now editing ');
      const strong = document.createElement('strong');
      strong.textContent = currentOption.textContent.replace(/\s*\(draft\)$/, '');
      now.appendChild(strong);
    } else {
      now.remove();
    }
    const filters = dialog.querySelector('.template-picker__filters');
    let activeGroup = '';
    const body = dialog.querySelector('.template-picker__body');
    const search = dialog.querySelector('input');
    const empty = dialog.querySelector('.template-picker__empty');

    const groups = optionGroups(picker, select);
    const chip = (label, count, value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'template-filter';
      button.dataset.group = value;
      button.setAttribute('aria-pressed', String(value === activeGroup));
      button.innerHTML = '<span></span><span class="template-filter__count"></span>';
      button.firstChild.textContent = label;
      button.lastChild.textContent = count;
      button.addEventListener('click', () => {
        activeGroup = value;
        filters.querySelectorAll('.template-filter').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
        applyFilter();
      });
      filters.appendChild(button);
    };
    if (groups.length > 1) {
      chip('All', groups.reduce((sum, group) => sum + group.options.length, 0), '');
      groups.forEach(group => chip(group.label, group.options.length, group.label));
    } else {
      filters.remove();
    }

    const assist = window.FrameUpEditorAssist;
    function buildCard(option, groupLabel, { why = '', assistRow = false } = {}) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'template-card';
      card.dataset.value = option.value;
      const info = assist?.templateInfo?.(picker.workspace, option.value);
      card.dataset.search = `${option.textContent} ${groupLabel} ${info?.best || ''} ${info?.keywords || ''}`.toLowerCase();
      const current = option.value === select.value;
      if (current) {
        card.classList.add('is-current');
        if (!assistRow) card.setAttribute('aria-current', 'true');
      }
      const name = document.createElement('span');
      name.className = 'template-card__name';
      name.textContent = option.textContent.replace(/\s*\(draft\)$/, '');
      // Status sits on the preview: Locked / New top-left, a check when in use.
      const thumb = buildThumb(picker, option);
      const flags = document.createElement('span');
      flags.className = 'template-card__flags';
      if (option.dataset.tag === 'locked') {
        flags.insertAdjacentHTML('beforeend', `<span class="template-tag is-locked">${ICON_LOCK}View only</span>`);
      }
      if (window.FrameUpWhatsNew?.isNewTemplate?.(picker.workspace, option.value)) {
        flags.insertAdjacentHTML('beforeend', '<span class="es-badge es-badge--new">New</span>');
      }
      if (flags.childElementCount) thumb.appendChild(flags);
      if (current) thumb.insertAdjacentHTML('beforeend', `<span class="template-card__check">${ICON_CHECK}</span>`);
      const label = document.createElement('span');
      label.className = 'template-card__label';
      label.appendChild(name);
      const note = document.createElement('span');
      if (why) {
        note.className = 'template-card__why';
        note.textContent = why;
      } else if (info?.best) {
        note.className = 'template-card__best';
        note.textContent = info.best;
      }
      if (note.textContent) label.appendChild(note);
      if (current) label.insertAdjacentHTML('beforeend', '<span class="template-card__status">Current template</span>');
      card.append(thumb, label);
      card.setAttribute('aria-label', `${name.textContent}${note.textContent ? `: ${note.textContent}` : ''}${option.dataset.tag === 'locked' ? ', locked: view only' : ''}${current ? ', current' : ''}`);
      card.addEventListener('click', () => {
        dialog.close();
        if (select.value !== option.value) {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          try { syncAllCustomSelects(); } catch (error) { /* custom dropdown only */ }
        }
      });
      return card;
    }

    function buildSection(label, cards, { assistRow = false, hint = '', key = label } = {}) {
      const section = document.createElement('section');
      section.className = `template-picker__group${assistRow ? ' is-assist' : ''}`;
      section.dataset.group = key;
      const heading = document.createElement('h3');
      heading.innerHTML = '<span></span><span class="template-picker__count"></span>';
      heading.firstChild.textContent = label;
      if (hint) {
        heading.lastChild.className = 'template-picker__hint';
        heading.lastChild.textContent = hint;
      } else {
        heading.lastChild.textContent = cards.length;
      }
      const grid = document.createElement('div');
      grid.className = 'template-picker__grid';
      cards.forEach(card => grid.appendChild(card));
      section.append(heading, grid);
      return section;
    }

    const optionByValue = value => [...select.options].find(option => option.value === value && !option.disabled);

    // Suggested: "best for this story", from the headline on the design or
    // from what's typed in search (a few words or a pasted story).
    const suggestedSlot = document.createElement('div');
    suggestedSlot.className = 'template-picker__assist';
    function storyText() {
      const typed = search.value.trim();
      if (typed.split(/\s+/).length >= 3) return { text: typed, typed: true };
      if (typed) return { text: '', typed: true }; // a short search is a name search
      const headline = picker.workspace === 'instagram' ? (document.getElementById('pill-text')?.value || '').replace(/\s+/g, ' ').trim() : '';
      return { text: headline, typed: false };
    }
    function renderSuggested() {
      suggestedSlot.textContent = '';
      if (picker.workspace !== 'instagram' || !assist?.suggestTemplates) return;
      const { text, typed } = storyText();
      const picks = assist.suggestTemplates(text, { available: [...select.options].filter(option => !option.disabled).map(option => option.value) });
      if (!picks.length) return;
      const preview = text.length > 48 ? `${text.slice(0, 46)}…` : text;
      const cards = picks.map(pick => buildCard(optionByValue(pick.value), 'Suggested', { why: pick.why, assistRow: true }));
      const section = buildSection('Best for this story', cards, { assistRow: true, hint: `${typed ? 'From your search' : 'From your headline'}: “${preview}”`, key: '__suggested' });
      section.dataset.assist = 'suggested';
      suggestedSlot.appendChild(section);
    }

    // Recent: the last templates used on this workspace (this browser).
    const recent = readRecent(picker.workspace).filter(value => value !== select.value && optionByValue(value)).slice(0, 4);
    if (recent.length) {
      const section = buildSection('Recent', recent.map(value => buildCard(optionByValue(value), 'Recent', { assistRow: true })), { assistRow: true, key: '__recent' });
      section.dataset.assist = 'recent';
      body.appendChild(section);
    }
    body.prepend(suggestedSlot);

    groups.forEach(group => {
      body.appendChild(buildSection(group.label, group.options.map(option => buildCard(option, group.label))));
    });

    function applyFilter() {
      const query = search.value.trim().toLowerCase();
      let shown = 0;
      renderSuggested();
      body.querySelectorAll('.template-picker__group').forEach(section => {
        if (section.dataset.assist) {
          // Recent shows only on the full list; Suggested always shows its picks.
          const show = section.dataset.assist === 'suggested' ? !activeGroup : !activeGroup && !query;
          section.hidden = !show;
          section.querySelectorAll('.template-card').forEach(card => { card.hidden = !show; });
          return;
        }
        const inScope = !activeGroup || section.dataset.group === activeGroup;
        let inGroup = 0;
        section.querySelectorAll('.template-card').forEach(card => {
          const match = inScope && (!query || matchesQuery(card.dataset.search, query));
          card.hidden = !match;
          if (match) inGroup += 1;
        });
        section.hidden = inGroup === 0;
        shown += inGroup;
      });
      // A pasted story matches no names, but its suggestions still show.
      const suggested = activeGroup ? 0 : suggestedSlot.querySelectorAll('.template-card').length;
      empty.hidden = shown > 0 || suggested > 0;
    }
    applyFilter();
    search.addEventListener('input', applyFilter);
    search.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      body.querySelector('.template-card:not([hidden])')?.click();
    });

    // Arrow keys move between cards like a grid; Down from search enters it.
    function visibleCards() {
      return [...body.querySelectorAll('.template-card')].filter(card => !card.hidden && card.offsetParent !== null);
    }
    search.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown') return;
      const first = visibleCards()[0];
      if (!first) return;
      event.preventDefault();
      first.focus();
    });
    body.addEventListener('keydown', event => {
      const card = event.target.closest?.('.template-card');
      if (!card || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const cards = visibleCards();
      const index = cards.indexOf(card);
      if (index < 0) return;
      let next = null;
      if (event.key === 'ArrowRight') next = cards[index + 1];
      else if (event.key === 'ArrowLeft') next = cards[index - 1];
      else if (event.key === 'Home') next = cards[0];
      else if (event.key === 'End') next = cards[cards.length - 1];
      else {
        const from = card.getBoundingClientRect();
        const down = event.key === 'ArrowDown';
        const centre = from.left + from.width / 2;
        let best = Infinity;
        cards.forEach(other => {
          const rect = other.getBoundingClientRect();
          const rowGap = down ? rect.top - from.bottom : from.top - rect.bottom;
          if (rowGap < -2) return;
          const score = rowGap * 4 + Math.abs(rect.left + rect.width / 2 - centre);
          if (score < best) { best = score; next = other; }
        });
        if (!next && !down) { search.focus(); event.preventDefault(); return; }
      }
      if (!next) return;
      event.preventDefault();
      next.focus();
      next.scrollIntoView({ block: 'nearest' });
    });

    dialog.querySelector('.template-picker__close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();
    requestAnimationFrame(() => {
      fitHtmlThumbs(dialog);
      // With suggestions, start at the top on the best one; else on the current template.
      const start = suggestedSlot.querySelector('.template-card') || body.querySelector('.template-card[aria-current="true"]');
      (start || search).focus({ preventScroll: true });
      if (start && !suggestedSlot.contains(start)) start.scrollIntoView({ block: 'nearest' });
    });
    if ('ResizeObserver' in window) new ResizeObserver(() => fitHtmlThumbs(dialog)).observe(body);
  }

  // Recent templates per workspace, in this browser only.
  const RECENT_KEY = 'frameup.templates.recent.';
  function readRecent(workspace) {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY + workspace) || '[]');
      return Array.isArray(list) ? list.filter(item => typeof item === 'string') : [];
    } catch (error) {
      return [];
    }
  }
  function rememberTemplate(workspace, value) {
    const push = window.FrameUpEditorAssist?.pushRecent;
    const next = push ? push(readRecent(workspace), value) : [value, ...readRecent(workspace).filter(item => item !== value)].slice(0, 4);
    try { localStorage.setItem(RECENT_KEY + workspace, JSON.stringify(next)); } catch (error) { /* storage is optional */ }
  }
  function trackRecent() {
    PICKERS.forEach(picker => {
      const select = document.getElementById(picker.selectId);
      if (!select || select.dataset.recentTracked) return;
      select.dataset.recentTracked = '1';
      let previous = select.value;
      select.addEventListener('change', () => {
        // The template you leave is the one you'll want back.
        if (previous && previous !== select.value) rememberTemplate(picker.workspace, previous);
        previous = select.value;
      });
    });
  }

  function addBrowseButtons() {
    trackRecent();
    PICKERS.forEach(picker => {
      const select = document.getElementById(picker.selectId);
      const title = select?.closest('.card')?.querySelector('.card-title');
      if (!title || title.querySelector('.template-browse-btn')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'template-browse-btn';
      button.innerHTML = `${ICON_GRID}<span>Browse</span>`;
      button.setAttribute('aria-label', `Browse ${picker.workspace === 'newsletter' ? 'newsletter assets' : 'post types'} with previews`);
      button.title = 'See every template with a preview (T)';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openPicker(picker);
      });
      title.classList.add('has-browse');
      title.appendChild(button);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addBrowseButtons, { once: true });
  else addBrowseButtons();

  // ⌘K: every template, from any editor page or Home. Shown once you type.
  const TEMPLATE_SOURCES = [
    { workspace: 'instagram', label: 'Social Media', selectId: 'instagram-post-type-select' },
    { workspace: 'youtube', label: 'YouTube', selectId: 'youtube-variation-select' },
    { workspace: 'newsletter', label: 'Newsletter', selectId: 'newsletter-asset-select' },
  ];

  function goToTemplate(workspace, selectId, value) {
    const apply = () => {
      const select = document.getElementById(selectId);
      if (!select || select.value === value) return;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      try { syncAllCustomSelects(); } catch (error) { /* custom dropdown only */ }
    };
    if (routeFromHash() === workspace) {
      apply();
      return;
    }
    window.addEventListener('hashchange', () => setTimeout(apply, 80), { once: true });
    location.hash = workspace;
  }

  window.FrameUpShell?.addPaletteSource?.(() => {
    const items = [];
    TEMPLATE_SOURCES.forEach(({ workspace, label, selectId }) => {
      const select = document.getElementById(selectId);
      if (!select) return;
      [...select.options].forEach(option => {
        if (option.disabled) return;
        const group = option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '';
        items.push({
          label: option.textContent.replace(/\s*\(draft\)$/, ''),
          hint: [label, option.dataset.tag === 'locked' ? 'Locked' : option.dataset.tag === 'new' ? 'New' : ''].filter(Boolean).join(' · '),
          keywords: `template ${workspace} ${group}`,
          icon: 'template',
          run: () => goToTemplate(workspace, selectId, option.value),
        });
      });
    });
    return [{ label: 'Templates', items, onlyWhenSearching: true, limit: 10 }];
  });

  window.FrameUpTemplates = Object.freeze({
    open: selectId => openPicker(PICKERS.find(picker => picker.selectId === selectId)),
    openForPage: () => {
      const picker = PICKERS.find(item => item.workspace === document.body?.dataset.currentPage);
      if (picker) openPicker(picker);
      return Boolean(picker);
    },
    goToTemplate,
  });
})();
