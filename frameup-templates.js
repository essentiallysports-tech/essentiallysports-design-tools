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
  const HTML_WIDGETS = new Set(['widgets', 'trivia', 'ticker', 'list', 'list2']);
  const PICKERS = [
    {
      selectId: 'instagram-post-type-select',
      workspace: 'instagram',
      title: 'Choose a post type',
      groups: [
        ['Covers and quotes', ['cover', 'quote', 'long-quote', 'double-entity-quote']],
        ['Stats', ['stats-single-ent', 'stats-double-ent']],
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

  const ICON_GRID = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const ICON_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

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
    img.src = `${THUMB_DIR}${picker.workspace}-${option.value}.webp`;
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

  function openPicker(picker) {
    const select = document.getElementById(picker.selectId);
    if (!select) return;
    document.querySelectorAll('.template-picker').forEach(stale => stale.remove());
    const dialog = document.createElement('dialog');
    dialog.className = `es-dialog template-picker${picker.workspace === 'instagram' ? ' is-portrait' : ''}`;
    dialog.setAttribute('aria-labelledby', 'template-picker-title');
    dialog.innerHTML = `
      <div class="template-picker__head">
        <h2 id="template-picker-title"></h2>
        <button class="template-picker__close" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <label class="template-picker__search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input type="search" placeholder="Search templates" aria-label="Search templates" autocomplete="off" spellcheck="false">
      </label>
      <div class="template-picker__body"></div>
      <p class="template-picker__empty" hidden>No templates match that search.</p>`;
    dialog.querySelector('h2').textContent = picker.title;
    const body = dialog.querySelector('.template-picker__body');
    const search = dialog.querySelector('input');
    const empty = dialog.querySelector('.template-picker__empty');

    optionGroups(picker, select).forEach(group => {
      const section = document.createElement('section');
      section.className = 'template-picker__group';
      const heading = document.createElement('h3');
      heading.textContent = group.label;
      const grid = document.createElement('div');
      grid.className = 'template-picker__grid';
      group.options.forEach(option => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'template-card';
        card.dataset.search = `${option.textContent} ${group.label}`.toLowerCase();
        const current = option.value === select.value;
        if (current) {
          card.classList.add('is-current');
          card.setAttribute('aria-current', 'true');
        }
        const name = document.createElement('span');
        name.className = 'template-card__name';
        name.textContent = option.textContent.replace(/\s*\(draft\)$/, '');
        const tags = document.createElement('span');
        tags.className = 'template-card__tags';
        if (option.dataset.tag === 'locked') {
          tags.insertAdjacentHTML('beforeend', `<span class="template-tag is-locked">${ICON_LOCK}Locked</span>`);
        }
        if (window.FrameUpWhatsNew?.isNewTemplate?.(picker.workspace, option.value)) {
          tags.insertAdjacentHTML('beforeend', '<span class="es-badge es-badge--new">New</span>');
        }
        if (current) tags.insertAdjacentHTML('beforeend', '<span class="template-tag is-current">Current</span>');
        const label = document.createElement('span');
        label.className = 'template-card__label';
        label.append(name, tags);
        card.append(buildThumb(picker, option), label);
        card.setAttribute('aria-label', `${name.textContent}${option.dataset.tag === 'locked' ? ', locked: view only' : ''}${current ? ', current' : ''}`);
        card.addEventListener('click', () => {
          dialog.close();
          if (select.value !== option.value) {
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            try { syncAllCustomSelects(); } catch (error) { /* custom dropdown only */ }
          }
        });
        grid.appendChild(card);
      });
      section.append(heading, grid);
      body.appendChild(section);
    });

    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      let shown = 0;
      body.querySelectorAll('.template-picker__group').forEach(section => {
        let inGroup = 0;
        section.querySelectorAll('.template-card').forEach(card => {
          const match = !query || card.dataset.search.includes(query);
          card.hidden = !match;
          if (match) inGroup += 1;
        });
        section.hidden = inGroup === 0;
        shown += inGroup;
      });
      empty.hidden = shown > 0;
    });
    search.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      body.querySelector('.template-card:not([hidden])')?.click();
    });

    dialog.querySelector('.template-picker__close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();
    requestAnimationFrame(() => {
      fitHtmlThumbs(dialog);
      (body.querySelector('.template-card.is-current') || search).focus();
      body.querySelector('.template-card.is-current')?.scrollIntoView({ block: 'nearest' });
    });
    if ('ResizeObserver' in window) new ResizeObserver(() => fitHtmlThumbs(dialog)).observe(body);
  }

  function addBrowseButtons() {
    PICKERS.forEach(picker => {
      const select = document.getElementById(picker.selectId);
      const title = select?.closest('.card')?.querySelector('.card-title');
      if (!title || title.querySelector('.template-browse-btn')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'template-browse-btn';
      button.innerHTML = `${ICON_GRID}<span>Browse</span>`;
      button.setAttribute('aria-label', `Browse ${picker.workspace === 'newsletter' ? 'newsletter assets' : 'post types'} with previews`);
      button.title = 'See every template with a preview';
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

  window.FrameUpTemplates = Object.freeze({ open: selectId => openPicker(PICKERS.find(picker => picker.selectId === selectId)) });
})();
