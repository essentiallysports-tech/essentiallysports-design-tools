# EssentiallySports / FrameUp — Master Brand & Site Design System

This is the single reference for how any EssentiallySports web property should look, feel, and be
structured — navbar, footer, fonts, colors, spacing, page rules, dark mode. Read this before starting
a new site or page for the brand. It documents what is **actually implemented today** in this repo
(`essentiallysports-design-tools`), not an aspirational spec, so it can be copied forward as-is.

This file supersedes the older `es-designer-brand-design-guide.md` and `frameup-design-system.md` for
anything site/chrome-level (navbar, footer, page tokens). Those two remain useful for deeper detail on
the design *tool's* internal product UI (`frameup-design-system.md`) and canvas/export creative rules
(`es-designer-brand-design-guide.md` §10–13) — this file cross-references them rather than repeating
everything.

---

## 1. How this codebase is actually structured (read this first)

- **There is no shared template/include system.** Every `.html` page (`index.html`, `dashboard.html`,
  `design-request.html`, `reels.html`, `tool-feedback.html`, etc.) is a standalone file with its own
  `<style>` block defining a page-local `:root` token set, plus its own copy of the navbar markup.
  Shared behavior comes from separately-loaded files (`site-chrome.css`, `site-chrome.js`,
  `site-mobile-chrome.css/js`, `theme.css`, `theme.js`, `es-auth.js`, `es-auth-config.js`,
  `dashboard-data.js`), but the navbar/footer **markup itself is duplicated per page**.
- **Practical implication:** if you change the navbar or footer, you must change it in every page that
  has one, or intentionally decide a new page won't carry it. There is no single file to edit once.
- **Two overlapping token systems exist side by side, on purpose, for different layers:**
  1. **Page-chrome tokens** — a `:root` block inline in each page (`--white`, `--accent`, `--border`,
     `--font-ui`, `--radius-md`, etc.) plus `--chrome-*` tokens in `site-chrome.css`. These drive the
     navbar, footer, and general page layout.
  2. **Product semantic tokens** (`design-tokens.css`, `--es-*`) — a stricter type-hierarchy system
     (display / page-title / workspace-title / panel-title / section-title / field-label / control /
     body / helper / meta) used inside the design-tool product surfaces (workspaces, dashboard, Reels).
  When building a new *page* (marketing, docs, a new tool), start from the page-chrome tokens in §3. When
  building new *product/app UI* inside an existing tool shell, use the semantic tokens — see
  `frameup-design-system.md`.
- Custom fonts (`FrameUp Acumin`) are declared via `@font-face` in `site-chrome.css`, not per-page. Any
  page that wants the display font must load `site-chrome.css`.

---

## 2. Brand personality

Sports-media native, bold and editorial, fast/clean/production-ready, ES-blue-led, high contrast,
spacious but not empty. It should read as a professional creative-production tool, not a playful SaaS
dashboard — no pastel gradients, no bubble UI, no default-gray browser styling.

---

## 3. Design tokens (page-chrome layer — use these for any new page)

Declare this block in a new page's `:root`. Values are copied verbatim from `index.html`.

```css
:root {
  --white: #FFFFFF;
  --bg-page: #FFFFFF;
  --bg-panel: #FFFFFF;
  --bg-canvas: #FFFFFF;
  --bg-canvas-soft: #FFFFFF;
  --border: #B5D8FD;
  --border-strong: #8CB9E8;
  --text-primary: #111827;
  --text-secondary: #7997B8;
  --accent: #0A7DFA;
  --accent-hover: #0A6FDE;
  --accent-light: #E8F2FF;
  --success: #2E7D32;
  --tag-blue-01: #B5D8FD;
  --tag-blue-02: #DAEBFE;
  --tag-blue-03: #E6F2FE;
  --tag-blue-04: #EFF4F9;
  --tag-cream: #FFF6E6;
  --tag-green: #EAF6EE;
  --tag-green-text: #2F6B45;
  --font-ui: 'Roboto Condensed', 'Roboto', Arial, sans-serif;
  --font-heading: 'Roboto Condensed', 'Roboto', Arial, sans-serif;
  --font-display: 'Acumin Post', 'Acumin Pro Condensed', 'Arial Narrow', sans-serif;
  --font-post: 'Acumin Post', 'Acumin Pro Condensed', 'Arial Narrow', sans-serif;
  --font-acumin-web: 'Acumin Pro Condensed Web', 'Roboto Condensed', 'Arial Narrow', sans-serif;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --button-radius: 8px;
  --shadow-sm: 0 19px 28px rgba(0,0,0,0.01);
  --shadow-md: 0 15px 27px rgba(0,0,0,0.1);
  --shadow-lg: 0 15px 27px rgba(0,0,0,0.1);
  --motion-smooth: cubic-bezier(.16, 1, .3, 1);
  --motion-standard: cubic-bezier(.22, .61, .36, 1);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; scroll-padding-top: 82px; }
html, body {
  background: var(--bg-page);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: clamp(13px, .74vw, 15px);
  letter-spacing: 0;
  min-height: 100vh;
}
```

The shared chrome files (`site-chrome.css`) use their own equivalent set with a `--chrome-` prefix so
they don't depend on a given page's exact token names:

```css
:root {
  --chrome-accent: #0a7dfa;
  --chrome-navy: #06111f;
  --chrome-muted: #6c7a89;
  --chrome-border: #dce4ed;
  --chrome-surface: #ffffff;
  --chrome-soft: #f6f8fb;
  --chrome-display: "FrameUp Acumin", "Acumin Pro Condensed Local", "Acumin Post", "Roboto Condensed", Arial, sans-serif;
  --chrome-ui: "Roboto Condensed", "Roboto", Arial, sans-serif;
  --chrome-motion: cubic-bezier(.16, 1, .3, 1);
}
```

### Core brand colors (canonical hex reference)

| Token | Hex | Use |
| --- | --- | --- |
| ES Navy | `#033162` / `#06111F` | Primary text, headings, deep brand surfaces (two navy values exist historically; `#06111F` is `--chrome-navy` / near-black, `#033162` is the older brand-guide navy — prefer `#06111F` / `--chrome-navy` for new work) |
| ES Bright Blue | `#0A7DFA` | Primary CTA, active/selected states, links-on-hover, accent border |
| ES Blue Hover | `#0A6FDE` | Hover/active state for primary blue elements |
| Border Blue | `#B5D8FD` | Card/input borders, inactive pills, dividers |
| Strong Border Blue | `#8CB9E8` | Stronger outlines |
| Accent Light | `#E8F2FF` | Selected/hover backgrounds |
| White | `#FFFFFF` | Page, card, navbar, and footer-body background |
| Text Primary | `#111827` | Body text on white |
| Text Secondary / Muted | `#7997B8` / `#6c7a89` | Secondary labels, helper text |
| Success | `#2E7D32` | Success status |

Rule: stay in the ES blue family for brand chrome. Team colors / newsletter brand colors (see
`es-designer-brand-design-guide.md` §11) are allowed *inside* generated creative assets, never for the
site chrome itself.

---

## 4. Typography

### Font families

- **Display font — "FrameUp Acumin"**: condensed, heavy, used for the navbar menu, hero/page titles, and
  all canvas/post text. Declared once via `@font-face` in `site-chrome.css`:
  ```css
  @font-face {
    font-family: "FrameUp Acumin";
    src: url("fonts/acumin-pro-condensed-bold.otf") format("opentype");
    font-style: normal;
    font-weight: 700 900;
    font-display: swap;
  }
  ```
  Reference it with fallbacks: `"FrameUp Acumin", "Acumin Pro Condensed Local", "Acumin Post", "Roboto Condensed", Arial, sans-serif`.
- **UI font — Roboto Condensed**: every interface control — nav links, buttons, labels, inputs, dropdowns,
  metadata, helper text. `'Roboto Condensed', 'Roboto', Arial, sans-serif`.
- **Body font — Roboto**: longer-form body copy where a condensed face would hurt readability.
  `'Roboto', Arial, sans-serif`.

### Rules

- Headings/titles: FrameUp Acumin, heavy weight (700–900), tight line-height, navy/strong text color.
- Everything interactive or informational (buttons, labels, nav, metadata, helper/status text): Roboto
  Condensed.
- Letter-spacing stays `0`. Uppercase is reserved for short status/meta labels and canvas text, not body
  copy.
- Never introduce a new font family. Never substitute `font-weight: 800/900` for picking the right
  semantic role.
- For the *product UI* (inside an editor/workspace/dashboard shell), use the exact semantic type scale in
  `design-tokens.css` / `frameup-design-system.md` — 10 fixed roles (display, page-title, workspace-title,
  panel-title, section-title, field-label, control, body, helper, meta), each with a fixed size/weight/
  color, and a fixed hierarchy order. Do not invent new sizes there.

---

## 5. Navbar

### Markup skeleton (copy this into a new page, adjust links as needed)

```html
<nav class="navbar">
  <a class="navbar-logo" href="index.html" aria-label="EssentiallySports home">
    <img src="brand-logo-blue.svg" alt="EssentiallySports">
  </a>
  <div class="navbar-menu">
    <div class="nav-dropdown">
      <a class="nav-trigger has-chevron" href="#intro" aria-haspopup="true" aria-expanded="false">Resources</a>
      <div class="nav-dropdown-menu" role="menu" aria-label="Resources">
        <a href="#logo-guidelines" role="menuitem">Logo Guidelines</a>
        <!-- ...more menu items... -->
      </div>
    </div>
    <a href="design-request.html">Design Request</a>
    <a href="dashboard.html" data-admin-only hidden aria-hidden="true">Dashboard</a>
    <a href="#faq">FAQ</a>
    <a href="tool-feedback.html">Tool Feedback</a>
  </div>
  <div class="navbar-right">
    <div class="profile-menu" id="profile-menu"></div>
    <a class="navbar-icon-btn" href="https://www.facebook.com/essentiallysports" aria-label="Facebook"><img src="social-icons/nav-facebook.svg" alt=""></a>
    <!-- ...X, LinkedIn, Instagram, YouTube, Google News, same pattern... -->
  </div>
</nav>
```

Notes:
- `data-admin-only hidden aria-hidden="true"` on the Dashboard link is a real pattern —
  `dashboard-data.js`'s `showAdminNavigation()` unhides any `[data-admin-only]` element only for the
  two hardcoded dashboard-admin emails. Any nav item gated to admins should use this same attribute.
- `#profile-menu` is populated by `es-auth.js`/site chrome JS with the signed-in user's avatar/menu
  (including the theme switcher — see §7). It's an empty container in markup.

### CSS

```css
.navbar {
  background: var(--white);
  border-bottom: 1px solid var(--accent);
  height: 69px;
  display: flex;
  align-items: center;
  padding: 18px 22px;
  gap: 0;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: none;
}
.navbar-logo { display: flex; align-items: center; margin-right: 52px; flex-shrink: 0; }
.navbar-logo img, .navbar-logo svg { height: 31px; width: auto; }
.navbar-menu {
  display: flex; align-items: center; gap: 26px;
  font-family: var(--font-display); font-size: 18px; font-weight: 900; color: #111;
}
.navbar-menu a, .nav-trigger { color: inherit; text-decoration: none; }
.navbar-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.navbar-icon-btn { width: 28px; height: 28px; border-radius: 0; border: 0; background: transparent; }
```

- Sticky top, 69px tall, white background, a single 1px ES-blue bottom border — no shadow.
- Menu labels use the **display font** at 900 weight (unusual — most nav systems use a UI font for nav
  links; this brand deliberately uses the heavy condensed display face for primary nav labels).
- Social icons are 28×28px, borderless, transparent background, on the right edge.
- Below **900px viewport width**, `site-mobile-chrome.css`/`.js` take over navbar layout (collapsed/
  hamburger-style chrome) — check `site-mobile-chrome.css` before hand-rolling mobile nav for a new page.

---

## 6. Footer

### Structure

The footer is **two-toned**: a blue hero band on top, a white body below. It is *not* a solid navy
block — get this right, it's a common misconception from older notes.

```
┌─────────────────────────────────────────┐
│  (blue #0A7DFA band — .footer-hero)      │
│   white ES logo (brand-logo-white.svg)   │
│   white blurb paragraph                  │
│   social icons row                       │
│   "EssentiallySports Media, Inc. © ..."  │
├─────────────────────────────────────────┤
│  (white body — .footer-links)            │
│   4-column grid: EssentiallySports /     │
│   Newsletters / Podcasts+Events /        │
│   Sports (2-col sub-grid of leagues)     │
├─────────────────────────────────────────┤
│  (white — .footer-bottom, top border)    │
│   legal links row (Privacy, Terms, ...)  │
└─────────────────────────────────────────┘
```

### Markup skeleton

```html
<footer class="site-footer">
  <div class="footer-hero">
    <a class="footer-logo-link" href="https://www.essentiallysports.com/">
      <img class="footer-logo-img" src="brand-logo-white.svg" alt="EssentiallySports">
    </a>
    <p class="footer-blurb">EssentiallySports is the home for the underserved fan...</p>
    <div class="footer-socials" aria-label="Social links">
      <a href="https://www.facebook.com/essentiallysports" aria-label="Facebook"><img src="social-icons/footer-facebook.svg" alt=""></a>
      <!-- ...X, LinkedIn, Instagram, YouTube, Google News... -->
    </div>
    <div class="footer-copy">EssentiallySports Media, Inc. © 2026 | All Rights Reserved</div>
  </div>
  <div class="footer-links">
    <div class="footer-col">
      <span>EssentiallySports</span>
      <a href="https://www.essentiallysports.com/about-us/">About Us</a>
      <!-- ... -->
    </div>
    <div class="footer-col"><span>Newsletters</span><!-- ... --></div>
    <div class="footer-col"><span>Podcasts</span><!-- ... --><span>Events</span><!-- ... --></div>
    <div class="footer-col sports"><span>Sports</span><span></span><!-- 2-col league links --></div>
  </div>
  <div class="footer-bottom">
    <a href="https://www.essentiallysports.com/privacy-policy/">Privacy Policy</a>
    <a href="https://www.essentiallysports.com/press/">ES Pressroom</a>
    <a href="https://www.essentiallysports.com/ethics-policy/">Ethics Policy</a>
    <a href="https://www.essentiallysports.com/fact-checking-policy/">Fact-Checking Policy</a>
    <a href="https://www.essentiallysports.com/corrections-policy/">Corrections Policy</a>
    <a href="https://www.essentiallysports.com/cookies-policy/">Cookies Policy</a>
    <a href="https://www.essentiallysports.com/gdpr-compliance/">GDPR Compliance</a>
    <a href="https://www.essentiallysports.com/terms-of-use/">Terms of Use</a>
    <a href="https://www.essentiallysports.com/editorial-policies/">Editorial Guidelines</a>
    <a href="https://www.essentiallysports.com/ownership-and-funding-information/">Ownership and funding Information</a>
  </div>
</footer>
```

### Key CSS (from `site-chrome.css`, all `!important` in the source since it must win over per-page styles)

```css
.site-footer { background: #ffffff; color: #111111; font-family: var(--chrome-ui); }
.site-footer .footer-hero { padding: 74px 24px 28px; background: var(--chrome-accent); color: #fff; text-align: center; }
.site-footer .footer-logo-img { height: clamp(30px, 6vw, 48px); margin: 0 auto; }
.site-footer .footer-blurb { width: min(980px, 100%); margin: 18px auto 22px; color: #fff; font-size: 14px; line-height: 1.45; }
.site-footer .footer-socials img { width: 24px; height: 24px; }
.site-footer .footer-copy { color: #fff; font-size: 14px; font-weight: 700; }
.site-footer .footer-links {
  width: min(1200px, calc(100% - 48px));
  display: grid; grid-template-columns: 1.1fr 1.1fr 1.1fr 1.4fr; gap: 44px;
  margin: 0 auto; padding: 34px 0 44px;
}
.site-footer .footer-col { color: #111; font-size: 14px; }
.site-footer .footer-col > span { font-size: 16px; font-weight: 800; }
.site-footer .footer-col a:hover { color: var(--chrome-accent); }
.site-footer .footer-col.sports { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); column-gap: 24px; }
.site-footer .footer-bottom {
  width: min(1200px, calc(100% - 48px));
  display: flex; flex-wrap: wrap; gap: 14px 24px;
  padding: 22px 0 30px; border-top: 1px solid var(--chrome-border);
  font-size: 14px; text-align: center;
}
```

- White ES logo (`brand-logo-white.svg`) only ever sits on the blue hero band.
- Column headings (`.footer-col > span`) are bold 16px navy-on-white; links are 14px regular, hover to
  ES blue.
- Always load `site-chrome.css` for any new page that includes `.site-footer` — the footer's real
  styling lives there, not per-page.

---

## 7. Dark mode

- Toggled by `theme.js`, which sets `document.documentElement.dataset.theme = 'dark' | 'light'` and
  `document.documentElement.style.colorScheme`, persisted to `localStorage['frameup.theme.v1']`. Default
  is **light** — dark mode is opt-in, applied before first paint to avoid a flash.
- A `frameup-theme-change` custom event fires on toggle for any page-specific reactions.
- The switcher UI auto-injects itself: into `.profile-dropdown` if present (as a menu row), otherwise as
  a floating pill next to `.navbar`. Don't hand-build a separate toggle — just load `theme.js`.
- **The navbar and footer intentionally do NOT reskin for dark mode** — `theme.css` explicitly keeps
  `.site-footer` and the shared navbar as-is in light mode; only *product* chrome (dashboard sidebar/
  topbar, studio rail/topbar) and page backgrounds switch to the dark palette:
  ```css
  html[data-theme="dark"] { --theme-dark-base: #080808; --theme-dark-surface: #121212; --theme-dark-text: #F3F5F7; /* ...etc */ }
  html[data-theme="dark"] .dashboard-topbar, .dashboard-sidebar, .studio-topbar, .studio-rail, .site-footer {
    background: var(--theme-dark-surface) !important; color: var(--theme-dark-text) !important;
  }
  ```
  Wait — note `.site-footer` *is* listed there for product-shell pages; check the live page before
  assuming footer dark-mode behavior on a brand-new page that isn't one of the app shells. When in doubt,
  test both themes.
- The semantic `--es-text-*` tokens in `design-tokens.css` already remap correctly under
  `html[data-theme="dark"]` — prefer those tokens for new product-UI text so dark mode "just works."

---

## 8. Spacing, radius, shadows

| Token | Value |
| --- | --- |
| `--radius-sm` | 6px |
| `--radius-md` | 10px |
| `--radius-lg` | 12px |
| `--button-radius` | 8px |
| `--shadow-sm` | `0 19px 28px rgba(0,0,0,0.01)` |
| `--shadow-md` / `--shadow-lg` | `0 15px 27px rgba(0,0,0,0.1)` |
| Small gap | 8px |
| Standard gap | 12–16px |
| Card inner padding | 24–36px |
| Section spacing | 48–80px |
| Large hero spacing | 80–120px max |

Borders: 1–1.5px, `#B5D8FD` (light) / `#8CB9E8` (strong). Crisp corners over large pill radii, except
toggles/badges. Shadows used sparingly — the brand reads as border-first, not shadow-heavy.

---

## 9. Buttons

**Primary**: `#0A7DFA` background → `#0A6FDE` hover, white text, `8px` radius, Roboto Condensed bold,
generous height (48–76px depending on context).

```css
.primary-cta {
  background: #0A7DFA; color: #fff; border: 1.5px solid #0A7DFA; border-radius: 8px;
  font-family: 'Roboto Condensed', 'Roboto', Arial, sans-serif; font-weight: 800;
}
.primary-cta:hover { background: #0A6FDE; border-color: #0A6FDE; }
```

**Secondary**: white background, `#8CB9E8`/`#B5D8FD` border, `#033162` text, hover text/border → `#0A7DFA`.

**Pills/mode toggles**: inactive = white fill + light-blue border + navy text; active = blue fill + white
text. Never rely on color alone — active state also changes fill/border.

---

## 10. Cards & forms

- Cards: white fill, light-blue border, `10–12px` radius, optional soft shadow, Acumin/Roboto-Condensed
  title, muted blue-gray metadata.
- Forms: white fields, `#B5D8FD` border, `#0A7DFA` focus border, navy text, Roboto Condensed labels,
  large tap targets. Errors red, success `#2E7D32`.

---

## 11. Responsive breakpoints

Consistent across `site-chrome.css` / `site-mobile-chrome.css`:

| Breakpoint | Meaning |
| --- | --- |
| `max-width: 420px` | Small phones — tightest layout |
| `max-width: 560px` | Phones |
| `max-width: 900px` | Mobile chrome takes over (nav collapses) — `site-mobile-chrome.css` is the source of truth below this width |
| `min-width: 901px` | Desktop chrome (`site-chrome.css` base rules) |
| `min-width: 901px and max-width: 1260px` | Compact desktop / laptop adjustments |

`prefers-reduced-motion: reduce` is respected — disable non-essential animation under it.

---

## 12. Canvas / exported-creative rules

Out of scope for site chrome, but any new tool that generates downloadable social/newsletter/video
assets should follow the existing canvas rules (exact canvas dimensions per format, Acumin Condensed
Bold for on-canvas text, dynamic pill sizing, consistent logo placement, `.webp`/`.svg` asset
preference). See `es-designer-brand-design-guide.md` §10–12 for the full spec — it's unchanged and still
authoritative for that layer.

---

## 13. Do / Don't

**Do**
- Use ES Bright Blue (`#0A7DFA`) as the one accent color for site chrome; keep everything else white/navy/
  muted-blue-gray.
- Use FrameUp Acumin (heavy) for navbar labels, hero titles, and canvas text; Roboto Condensed for
  everything else interactive.
- Keep the navbar sticky, 69px, white, one blue bottom border, no shadow.
- Keep the footer two-toned: blue hero band, white body.
- Load `site-chrome.css`, `site-chrome.js`, `theme.css`, `theme.js` on any new page that wants the shared
  navbar/footer/dark-mode toggle — don't reimplement them.
- Gate admin-only nav links with `data-admin-only hidden aria-hidden="true"`.

**Don't**
- Don't invent a new blue. Don't use purple/gradient SaaS styling.
- Don't make the footer a solid navy block — it's white with a blue top band.
- Don't build a new toggle/switcher for dark mode — load `theme.js`.
- Don't assume a shared navbar/footer file exists to edit once — it's copied per page; update every page
  that needs the change.
- Don't mix the page-chrome tokens (§3) with the product semantic tokens (`--es-*`) in the same
  component — pick the layer that matches what you're building (see §1).

---

## 14. Quick-start checklist for a brand-new page

1. Copy the `:root` token block from §3 into the page's `<style>`.
2. `<link>` or `<script>` in, in this order: `design-tokens.css` (if it touches product UI),
   `site-chrome.css`, `theme.css`, then `theme.js`, `site-chrome.js`, `es-auth-config.js`, `es-auth.js`
   as needed for auth-aware chrome.
3. Paste the navbar markup (§5), update the active link/menu items for the new page.
4. Paste the footer markup (§6) verbatim — it rarely needs to change page-to-page.
5. Use Roboto Condensed for all UI, FrameUp Acumin only for the hero/page title and any canvas text.
6. Stay inside the color table in §3 — no new hexes without a reason.
7. Test the page at `≤420px`, `≤560px`, `≤900px`, and `≥901px`, and in both light and dark mode.
