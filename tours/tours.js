// FrameUp tours, as data. The engine is frameup-tour.js; when and where they
// open is tours/tour-launcher.js. Step fields are documented at the top of
// frameup-tour.js. Copy rule: a short title, one line of text, no fluff.
// Targets were checked against the live markup on 2026-11-17 (Video Ads v2,
// Generate format cards, sidebar usage card).
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

  // Lucide icons (ISC), one small illustration per step.
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const I = {
    sparkles: svg('<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>'),
    grid: svg('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'),
    briefcase: svg('<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>'),
    menu: svg('<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>'),
    search: svg('<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>'),
    gauge: svg('<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>'),
    user: svg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    home: svg('<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    image: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    sliders: svg('<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>'),
    download: svg('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'),
    pen: svg('<path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>'),
    trending: svg('<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>'),
    video: svg('<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>'),
    dashboard: svg('<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>'),
    flag: svg('<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>'),
    steps: svg('<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>'),
    phone: svg('<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>'),
    type: svg('<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>'),
    palette: svg('<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>'),
    film: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>'),
    scissors: svg('<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>'),
    layers: svg('<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
    zoom: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>'),
    lightbulb: svg('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'),
    filter: svg('<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>'),
    map: svg('<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>'),
  };
  window.FrameUpTourIcons = Object.freeze({ ...I });

  // ─── Welcome to FrameUp (offered on first visit; replay from the menu) ─
  Tour.register({
    id: 'welcome',
    label: 'Welcome to FrameUp',
    description: 'A one-minute look around: tools, search, editor, AI.',
    kicker: 'Welcome',
    icon: I.map,
    steps: [
      { target: '.es-sidebar__section--ai', media: DESKTOP, placement: 'right', icon: I.sparkles, title: 'AI Studio', text: 'Posts from a brief, live trends and video ads.' },
      { target: '.es-sidebar__section--create', media: DESKTOP, placement: 'right', icon: I.grid, title: 'Create', text: 'The editors: Social Media, YouTube, Newsletter and Reels.' },
      { target: '.es-sidebar__section--work', media: DESKTOP, placement: 'right', icon: I.briefcase, title: 'Work', text: 'Request a design from the team, or browse the Gallery.' },
      { target: '.navbar .mobile-menu-toggle', media: PHONE, icon: I.menu, title: 'Menu', text: 'Every tool lives here.' },
      { target: '[data-shell-palette]', media: DESKTOP, placement: 'right', icon: I.search, title: 'Search', text: 'Jump to any page, template or action. Press ⌘K or /.' },
      { target: '.es-sidebar [data-shell-usage]', media: DESKTOP, placement: 'right', icon: I.gauge, title: 'AI usage', text: 'Your AI spend this week, out of $20. It resets every Monday.' },
      { target: ['.es-sidebar__account', '.navbar .profile-trigger'], placement: 'right', icon: I.user, title: 'Your profile', text: 'Profile, light or dark, the UI Library, and these tours.' },
      { page: 'index.html', pageLabel: 'Home', route: '#frames', navTarget: '.es-sidebar [data-shell-id="frames"]', target: '#frame-instagram', icon: I.home, title: 'Pick a workspace', text: 'Each card opens an editor with the approved sizes and layouts.' },
      { page: 'index.html', route: '#instagram', target: ['.canvas-wrap', '.canvas-stage'], icon: I.image, title: 'Canvas', text: 'Your design, live. Click any text or photo to edit it.' },
      { page: 'index.html', target: ['.app > .panel', '.studio-control-dock'], media: DESKTOP, placement: 'left', icon: I.sliders, title: 'Inspector', text: 'Post type, text, photos and colours. Changes show instantly.' },
      { page: 'index.html', target: '.mobile-editor-nav', media: PHONE, icon: I.sliders, title: 'Edit', text: 'Content, photos, format and brand. Tap a tab to open it.' },
      { page: 'index.html', target: ['[data-studio-export-section]', '#studio-export-btn', '.mobile-editor-export'], icon: I.download, title: 'Export', text: 'Download, set the format, or copy a share link.' },
      { page: 'generate.html', pageLabel: 'Generate', navTarget: '.es-sidebar [data-shell-id="generate"]', target: '#gen-form', icon: I.pen, title: 'Generate', text: 'Describe the story. Pick a format, or leave it on Auto.' },
      { page: 'generate.html', target: ['.es-sidebar [data-shell-id="trends"]', '#gen-empty'], placement: 'right', icon: I.trending, title: 'Trends', text: 'What US fans read right now. Turn any trend into a design.' },
      { page: 'video-ads.html', pageLabel: 'Video Ads', navTarget: '.es-sidebar [data-shell-id="video-ads"]', target: '.va-steps', icon: I.video, title: 'Video Ads', text: 'Copy, Clip, Export. Ask AI writes and checks the copy.' },
      // Only admins see the Dashboard link; hidden links are skipped.
      { target: '.es-sidebar [data-shell-id="dashboard"]', media: DESKTOP, placement: 'right', icon: I.dashboard, title: 'Dashboard', text: 'Team activity, exports and AI spend. Admins only.' },
      { icon: I.flag, title: 'You’re all set', text: 'Replay this or any page tour from your profile menu.', nextLabel: 'Done' },
    ],
  });

  // ─── Generate ────────────────────────────────────────────────────────
  Tour.register({
    id: 'generate',
    label: 'Generate',
    description: 'Brief, format, the creative director, on-brand checks, trends.',
    kicker: 'Generate',
    icon: I.pen,
    steps: [
      { page: 'generate.html', target: '#gen-brief', icon: I.pen, title: 'Your brief', text: 'Who, what happened, and a quote or stats. Your words stay as written.' },
      { page: 'generate.html', target: '#gen-found', icon: I.steps, title: 'What FrameUp found', text: 'Who, quotes and stats light up as you type.' },
      { page: 'generate.html', target: '#gen-formats', icon: I.grid, title: 'Format', text: 'Auto picks the best mix, or choose a format card.' },
      { page: 'generate.html', target: '#gen-steer', icon: I.sliders, title: 'Steer the director', text: 'Set the tone and audience. Directions first shows the plan before designs.' },
      { page: 'generate.html', target: '#gen-submit', icon: I.sparkles, title: 'Generate', text: 'The director proposes 2–4 directions. Pick, edit or make them all. ⌘↵.' },
      { page: 'generate.html', target: ['#gen-director:not([hidden])', '#gen-submit'], icon: I.lightbulb, title: 'Creative directions', text: 'Each has an angle, a hook, why it works and the past ES posts behind it.' },
      { page: 'generate.html', target: ['#gen-grid .gen-note', '#gen-grid'], icon: I.flag, title: 'Director’s note', text: 'What works on each design, plus one fix you can apply in a click.' },
      { page: 'generate.html', target: '#gen-onbrand-open', icon: I.image, title: 'Bring it on-brand', text: 'Drop any design or carousel. The director flags what is off-guide and remakes it.' },
      { page: 'generate.html', target: '#gen-quick', icon: I.lightbulb, title: 'Starters', text: 'Try one to see how a good brief looks.' },
      { page: 'generate.html', target: ['#gen-grid .gen-card', '#gen-empty'], icon: I.trending, title: 'Start from a live trend', text: 'What fans read right now, one click from a design.' },
    ],
  });

  // ─── Trends (the other view of generate.html) ────────────────────────
  Tour.register({
    id: 'trends',
    label: 'Trends',
    description: 'Live US sports trends, by league.',
    kicker: 'Trends',
    icon: I.trending,
    steps: [
      { page: 'generate.html', target: '#trends-live', icon: I.trending, title: 'Live trends', text: 'What US fans search and read, kept fresh.' },
      { page: 'generate.html', target: '#trends-filters', icon: I.filter, title: 'By league', text: 'Filter to the sport you cover.' },
      { page: 'generate.html', target: ['#trends-body .trend-row', '#trends-body', '#trends-empty'], icon: I.sparkles, title: 'Design this', text: 'Pick a headline idea and Generate starts on it.' },
    ],
  });

  // ─── Video Ads (v2: Copy → Clip → Export) ────────────────────────────
  Tour.register({
    id: 'video-ads',
    label: 'Video Ads',
    description: 'Copy, Ask AI, clips and export.',
    kicker: 'Video Ads',
    icon: I.video,
    steps: [
      { page: 'video-ads.html', target: '.va-steps', icon: I.steps, title: 'Three steps', text: 'Copy, Clip, Export. Click a step to jump to it.' },
      { page: 'video-ads.html', target: ['.va-toolbar', '#va-brands'], icon: I.phone, title: 'Newsletter and size', text: 'Pick the newsletter, the ad size and the Meta preview.' },
      { page: 'video-ads.html', target: ['#va-device', '.va-canvas-wrap'], placement: 'right', icon: I.video, title: 'Live preview', text: 'The ad as it will run. It updates as you edit.' },
      { page: 'video-ads.html', target: '#va-headline', placement: 'left', icon: I.type, title: 'Your copy', text: 'Headline, highlight, body and button. Checks flag problems as you type.' },
      { page: 'video-ads.html', target: '#va-ask-ai', placement: 'left', icon: I.sparkles, title: 'Ask AI', text: 'Write 3 options, check grammar, shorten or punch it up. ⌘J.' },
      { page: 'video-ads.html', target: '#va-styles', placement: 'left', icon: I.palette, title: 'Style', text: 'Simple, Condensed or Highlight.' },
      { page: 'video-ads.html', target: '.va-step[data-step="clip"]', icon: I.film, title: 'Find a clip', text: 'By team, colour, moment or link. Fresh clips from the last 5 days.' },
      { page: 'video-ads.html', target: '#va-transport', placement: 'top', icon: I.scissors, title: 'Trim', text: 'Drag the handles to keep the best seconds. Space plays.' },
      { page: 'video-ads.html', target: '.va-step[data-step="export"]', icon: I.download, title: 'Export', text: 'MP4 in 9:16, 4:5 and 1:1.' },
    ],
  });

  // ─── Reels Studio (Story → Review → Export) ──────────────────────────
  Tour.register({
    id: 'reels-studio',
    label: 'Reels Studio',
    description: 'One click from a trend to a voiced reel with clips, in four ES styles.',
    kicker: 'Reels Studio',
    icon: I.film,
    steps: [
      { page: 'reel-maker.html', pageLabel: 'Reels Studio', navTarget: '.es-sidebar [data-shell-id="reel-maker"]', target: '#rm-steps', icon: I.steps, title: 'Story, Review, Export', text: 'Three steps, one main button each.' },
      { page: 'reel-maker.html', target: '#rm-topic', placement: 'left', icon: I.trending, title: "What's the story?", text: 'Pick a trend from the last 48 hours, or write a brief.' },
      { page: 'reel-maker.html', target: '#rm-write', placement: 'left', icon: I.sparkles, title: 'Make my reel', text: 'Script, voice, clips and captions, made for you.' },
      { page: 'reel-maker.html', target: '#rm-settings', placement: 'left', icon: I.grid, title: 'Settings, when you want them', text: 'Style, voice, clips and cost. Auto picks for you.' },
      { page: 'reel-maker.html', target: '#rm-stage', placement: 'right', icon: I.phone, title: 'Review it big', text: 'Tap a beat under the preview to change just that beat.' },
      { page: 'reel-maker.html', target: '.rm-step[data-step="export"]', icon: I.download, title: 'Check and export', text: 'Rights, checks and cost, then an MP4 with voice.' },
    ],
  });

  // ─── Editor (Social Media, YouTube, Newsletter on index.html) ────────
  Tour.register({
    id: 'editor',
    label: 'Editor',
    description: 'Format, layers, canvas, inspector, export.',
    kicker: 'Editor',
    icon: I.image,
    steps: [
      { page: 'index.html', route: editorRoute, target: ['.studio-primary-controls', '#post-type-control'], placement: 'left', icon: I.grid, title: 'Format', text: 'Pick the template or layout for this design.' },
      { page: 'index.html', target: '#layers-panel', media: DESKTOP, placement: 'right', icon: I.layers, title: 'Layers', text: 'Show, hide or lock parts of the design.' },
      { page: 'index.html', target: ['.canvas-wrap', '.canvas-stage'], icon: I.image, title: 'Canvas', text: 'Click any text or photo to edit it.' },
      { page: 'index.html', target: '.canvas-bottom-actions', placement: 'top', icon: I.zoom, title: 'Zoom, slides and photos', text: 'Upload a photo or pull one from the ES Image Pool.' },
      { page: 'index.html', target: '.studio-history-group', media: DESKTOP, icon: I.history, title: 'Undo and recent', text: 'Undo, redo, and reopen anything you exported.' },
      { page: 'index.html', target: ['.app > .panel', '.studio-control-dock'], media: DESKTOP, placement: 'left', icon: I.sliders, title: 'Inspector', text: 'Text, photos, brand and colours, top to bottom.' },
      { page: 'index.html', target: '.mobile-editor-nav', media: PHONE, icon: I.sliders, title: 'Edit', text: 'Content, photos, format and brand. Tap a tab to open it.' },
      { page: 'index.html', target: ['[data-studio-export-section]', '#studio-export-btn', '.mobile-editor-export'], icon: I.download, title: 'Export', text: 'Download or copy a share link. ⌘E exports. Your work autosaves.' },
    ],
  });
})();
