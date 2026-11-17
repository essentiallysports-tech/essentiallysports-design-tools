// FrameUp tours, as data. The engine is frameup-tour.js; when and where they
// open is tours/tour-launcher.js. Step fields are documented at the top of
// frameup-tour.js. Copy rule: a short title, one line of text, no fluff.
(() => {
  'use strict';

  const Tour = window.FrameUpTour;
  if (!Tour) return;

  const DESKTOP = '(min-width: 901px)';
  const PHONE = '(max-width: 900px)';
  const EDITOR_ROUTES = ['#instagram', '#youtube', '#newsletter'];

  // The editor tour stays in the workspace you're in; from anywhere else on
  // index.html it opens Social Media.
  const editorRoute = () => (EDITOR_ROUTES.includes(window.location.hash) ? null : '#instagram');

  // ─── Welcome to FrameUp (first visit; replay from the profile menu) ───
  Tour.register({
    id: 'welcome',
    label: 'Welcome to FrameUp',
    steps: [
      {
        title: 'Welcome to FrameUp',
        text: 'On-brand sports designs in minutes. Here’s a one-minute look around.',
        nextLabel: 'Start',
      },
      {
        target: '.es-sidebar__section--ai',
        media: DESKTOP,
        placement: 'right',
        title: 'AI Studio',
        text: 'Posts from a brief, live trends and video ads.',
      },
      {
        target: '.es-sidebar__section--create',
        media: DESKTOP,
        placement: 'right',
        title: 'Create',
        text: 'The editors: Social Media, YouTube, Newsletter and Reels.',
      },
      {
        target: '.es-sidebar__section--work',
        media: DESKTOP,
        placement: 'right',
        title: 'Work',
        text: 'Request a design from the team, or browse every export in Gallery.',
      },
      {
        target: '.navbar .mobile-menu-toggle',
        media: PHONE,
        title: 'Menu',
        text: 'Every tool lives here.',
      },
      {
        target: '[data-shell-palette]',
        media: DESKTOP,
        placement: 'right',
        title: 'Search',
        text: 'Jump to any page, template or action. Press ⌘K or /.',
      },
      {
        page: 'index.html',
        pageLabel: 'Home',
        route: '#frames',
        navTarget: '.es-sidebar [data-shell-id="frames"]',
        target: '#frame-instagram',
        title: 'Pick a workspace',
        text: 'Each card opens an editor with the approved sizes and layouts.',
      },
      {
        page: 'index.html',
        route: '#instagram',
        target: ['.canvas-wrap', '.canvas-stage'],
        title: 'Canvas',
        text: 'Your design, live. Click any text or photo to edit it.',
      },
      {
        page: 'index.html',
        target: ['.app > .panel', '.studio-control-dock'],
        media: DESKTOP,
        placement: 'left',
        title: 'Inspector',
        text: 'Post type, text, photos and colours. Changes show instantly.',
      },
      {
        page: 'index.html',
        target: '.mobile-editor-nav',
        media: PHONE,
        title: 'Edit',
        text: 'Content, photos, format and brand. Tap a tab to open it.',
      },
      {
        page: 'index.html',
        target: ['[data-studio-export-section]', '#studio-export-btn', '.mobile-editor-export'],
        title: 'Export',
        text: 'Download, set the format, or copy a share link.',
      },
      {
        page: 'generate.html',
        pageLabel: 'Generate',
        navTarget: '.es-sidebar [data-shell-id="generate"]',
        target: '#gen-form',
        title: 'Generate',
        text: 'Type a quote, stat or headline. Get editable, on-brand posts.',
      },
      {
        page: 'generate.html',
        target: ['.es-sidebar [data-shell-id="trends"]', '#gen-empty a'],
        placement: 'right',
        title: 'Trends',
        text: 'What US fans search right now. One click turns a trend into a design.',
      },
      {
        page: 'video-ads.html',
        pageLabel: 'Video Ads',
        navTarget: '.es-sidebar [data-shell-id="video-ads"]',
        target: ['.va-steps', '#va-steps'],
        title: 'Video Ads',
        text: 'Trend, clip, copy, score, MP4. Five steps, left to right.',
      },
      {
        // Only admins see the Dashboard link; hidden links are skipped.
        target: '.es-sidebar [data-shell-id="dashboard"]',
        media: DESKTOP,
        placement: 'right',
        title: 'Dashboard',
        text: 'Team activity, exports and AI spend. Admins only.',
      },
      {
        target: ['.es-sidebar__account', '.navbar .profile-trigger'],
        placement: 'right',
        title: 'Your profile',
        text: 'Profile, light or dark mode, and this tour again.',
      },
    ],
  });

  // ─── Generate ────────────────────────────────────────────────────────
  Tour.register({
    id: 'generate',
    label: 'Generate tour',
    kicker: 'Generate',
    steps: [
      { page: 'generate.html', target: '#gen-brief', title: 'Your brief', text: 'A quote, a stat line or a headline. Your words stay as written.' },
      { page: 'generate.html', target: '#gen-formats', title: 'Formats', text: 'Pick the post types you want back.' },
      { page: 'generate.html', target: '#gen-quick', title: 'Starter prompts', text: 'Not sure where to start? Tap one.' },
      { page: 'generate.html', target: '#gen-submit', title: 'Generate', text: 'Facts come only from ES coverage. Ctrl/⌘ + Enter works too.' },
      { page: 'generate.html', target: ['#gen-grid .gen-card', '#gen-empty'], title: 'Your designs', text: 'Edit one in the editor, download it, or refine the copy.' },
      { page: 'generate.html', target: ['.es-sidebar [data-shell-id="trends"]', '#gen-empty a'], placement: 'right', title: 'Trends', text: 'Short of ideas? Start from what fans search right now.' },
    ],
  });

  // ─── Trends (the other view of generate.html) ────────────────────────
  Tour.register({
    id: 'trends',
    label: 'Trends tour',
    kicker: 'Trends',
    steps: [
      { page: 'generate.html', target: '#trends-live', title: 'Live trends', text: 'US searches and stories, refreshed every 5 minutes.' },
      { page: 'generate.html', target: '#trends-filters', title: 'By sport', text: 'Filter to the sport you cover.' },
      { page: 'generate.html', target: ['#trends-body .trend-row', '#trends-body', '#trends-empty'], title: 'Design this', text: 'Pick a headline idea and Generate starts on it.' },
    ],
  });

  // ─── Video Ads ───────────────────────────────────────────────────────
  Tour.register({
    id: 'video-ads',
    label: 'Video Ads tour',
    kicker: 'Video Ads',
    steps: [
      { page: 'video-ads.html', target: '.va-steps', title: 'Five steps', text: 'Moment, clip, copy, score, export.' },
      { page: 'video-ads.html', target: ['.va-toolbar', '#va-brands'], title: 'Newsletter and size', text: 'Pick the newsletter and the ad size: 9:16, 4:5 or 1:1.' },
      { page: 'video-ads.html', target: ['#va-device', '.va-canvas-wrap'], placement: 'right', title: 'Live preview', text: 'The ad as it will run. Meta preview shows it in the feed.' },
      { page: 'video-ads.html', target: '#va-transport', placement: 'top', title: 'Trim the clip', text: 'Drag the handles to keep the best seconds. Space plays.' },
      { page: 'video-ads.html', target: ['.va-pane:not([hidden])', '#va-panel'], placement: 'left', title: 'Step panel', text: 'Each step’s choices live here.' },
      { page: 'video-ads.html', target: ['#va-next', '.va-pane-nav'], placement: 'top', title: 'Next step', text: 'Move on when you’re ready. Export is MP4 in 3 sizes.' },
    ],
  });

  // ─── Editor (Social Media, YouTube, Newsletter on index.html) ────────
  Tour.register({
    id: 'editor',
    label: 'Editor tour',
    kicker: 'Editor',
    steps: [
      { page: 'index.html', route: editorRoute, target: ['.studio-primary-controls', '#post-type-control'], placement: 'left', title: 'Format', text: 'Pick the template or layout for this design.' },
      { page: 'index.html', target: '#layers-panel', media: DESKTOP, placement: 'right', title: 'Layers', text: 'Show, hide or lock parts of the design.' },
      { page: 'index.html', target: ['.canvas-wrap', '.canvas-stage'], title: 'Canvas', text: 'Click any text or photo to edit it.' },
      { page: 'index.html', target: '.canvas-bottom-actions', placement: 'top', title: 'Zoom, slides and photos', text: 'Upload a photo or pull one from the ES Image Pool.' },
      { page: 'index.html', target: '.studio-history-group', media: DESKTOP, title: 'Undo and recent', text: 'Undo, redo, and reopen anything you exported.' },
      { page: 'index.html', target: ['.app > .panel', '.studio-control-dock'], media: DESKTOP, placement: 'left', title: 'Inspector', text: 'Text, photos, brand and colours, top to bottom.' },
      { page: 'index.html', target: '.mobile-editor-nav', media: PHONE, title: 'Edit', text: 'Content, photos, format and brand. Tap a tab to open it.' },
      { page: 'index.html', target: ['[data-studio-export-section]', '#studio-export-btn', '.mobile-editor-export'], title: 'Export', text: 'Download or copy a share link. ⌘E exports. Your work autosaves.' },
    ],
  });
})();
