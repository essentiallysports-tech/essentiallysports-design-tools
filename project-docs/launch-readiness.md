# FrameUp launch readiness (2026-11-17)

Walkthrough as a new team member on day one: sign-in → Home → editor → Generate → Trends → Video Ads → Reels → Gallery → Design Request → Tool Feedback → Profile / Settings → log out. Checked in the local preview (`:8935`, signed in) at 1280 and 375, light and dark, with console, network and an automated pass for missing labels, nameless buttons, broken images, page-level sideways scroll and eager heavy assets.

Local-only noise, not launch issues: `/api/*` returns 404 on the static preview server (Generate trends, Reels transcription, Request submit). Pages also sit faded in a hidden preview pane because entrance animations are throttled there.

## Fixed in this pass (agent `launch`, uncommitted, `?v=20261117-ready1`)

| Page | What changed | File |
| --- | --- | --- |
| All (dark) | Bare `p / label / li / small` muting no longer greys design-system text roles or light islands (Meta feed preview, canvas); `data-surface="light"` opts a surface out | `theme.css` |
| All (dark) | `--es-hairline` / `--es-outline` / `--es-surface` restated in dark and in every scope that changes `--es-line` | `design-tokens.css` |
| All | Keyboard focus on buttons can no longer be cancelled by the button layer's `outline: none` | `design-tokens.css` |
| All | Field outlines 3.2:1 (`--es-line-2` `#8A919E`; dark fields Slate 400), placeholders 4.6:1 (`#6E7581`) | `design-tokens.css`, `theme.css`, `es-ui.css` |
| All | One selected-chip style (blue tint), brand blues on the scale, one card radius (16), one big-number role, dark status badges, visible skeletons, `.es-select`, `.es-error-state`, `.es-field__error`, `.es-team-logo`, `.es-tile--cyan` | `design-tokens.css`, `es-ui.css` |
| All (phones) | `overflow-x: clip` so sticky headers work | `site-mobile-chrome.css` |
| All | Demo links without a nav id are never marked current; phone menu NEW tags use the sidebar markup (shine once) | `app-shell.js` |
| Dashboard | KPI numbers use the shared big-number role; pills use the shared status colours | `dashboard-ui-system.css` |
| Gallery | Real error state with **Try again** (was a callout saying "Refresh the page"); a failed later page keeps the grid and lets Load more retry; `aria-busy` while loading | `gallery.html` |
| Design Request | Success message no longer shows setup jargon ("…once Netlify environment variables are added"); says "Request DR-… sent" and where to follow it | `design-request.html` |
| Design Request | Name and work email prefilled from the signed-in profile (the next two sections were locked until people retyped them) | `design-request.html` |
| Design Request | The hidden copy of the Home view no longer downloads ~350 KB of workspace art on every visit | `design-request.html` |
| How FrameUp works | Mentions Trends and Video Ads (new user guide skipped them); cyan tiles renamed | `how-frameup-works.html` |
| Tool Feedback | Placeholder shows an example instead of an instruction | `tool-feedback.html` |
| Profile / Settings | Display name no longer shows the email handle ("first.last") when the sidebar shows "First Last"; sentence-case title; "Back to Home" and start page "Home" match the nav | `ai-page/account.js`, `ai-page/profile.html`, `ai-page/settings.html` |
| Log out | After logging out, the only action is **Sign in again** (the "FrameUp home" link bounced back to login) | `ai-page/logout.html` |

## Still open

### P0: blocks launch

None found in the flows above. The two that came closest were fixed: the Design Request success text with developer setup wording, and Gallery having no way to recover from a failed load.

### P1: should fix before people rely on it

| # | Page | Issue | Fix | Owner file |
| --- | --- | --- | --- | --- |
| 1 | Generate, Video Ads, Gallery, Dashboard | The content column paints 1–4 s after the sidebar (blank white area while the session and data load). New users read it as broken. | Paint the page shell immediately and show skeletons in place; only data regions wait for auth. Dashboard KPIs already do this; copy that pattern. | `es-auth*.js` boot, `generate.html`, `video-ads.js` |
| 2 | Home, editor | `index.html` is 1.0 MB of inline HTML, CSS and JS, parsed before first paint on every Home and editor visit. | Move the editor's inline CSS and JS into cached files (`?v=` keyed), defer editor-only scripts until a workspace route opens. | `index.html` (owner) |
| 3 | Reel Captions (phone) | The phone **Export** button is enabled before a clip is uploaded; it calls `.click()` on the disabled desktop button, so tapping it does nothing and says nothing. | Mirror `disabled` from `#reels-export-btn` onto `[data-reels-mobile-export]`, or show "Upload a clip first" on tap. | `reels.js` |
| 4 | Editor | The ES Image Pool search field has no label (placeholder only). | Add `aria-label="Search ES images"` to `input[data-ai-image-query-input]` (line ~23439). | `index.html` (owner) |
| 5 | Editor | No `h1` on editor routes, so screen reader users land without a page name. | Add a visually hidden `<h1 class="es-sr-only">` with the workspace name, updated on route change. | `index.html` (owner) |
| 6 | Design Request | If the server sync fails the request still reaches the dashboard through Supabase, but nothing tells the requester when that also fails (`cloudSyncStatus` is only stored). | When `recordDesignRequest` rejects, show the error status and keep the form filled so they can retry. | `dashboard-data.js`, `design-request.html` |
| 7 | Video Ads | Focus is defined three ways (see "Lines for other owners" below). | Delete the two superseded blocks; keep the quiet-focus block. | `video-ads.css` |
| 8 | Generate | Team logos in "Found in your brief" duplicate the Video Ads chip CSS. | Use the shared `.es-team-logo` (see below). | `generate.html` |
| 9 | Home, Generate, Video Ads | These three pages still load the previous cache keys, so they will not pick up this pass's token and focus fixes until bumped. | Bump the lines listed below. | `index.html`, `generate.html`, `video-ads.html` |

### P2: nice to have

| # | Page | Issue | Fix | Owner file |
| --- | --- | --- | --- | --- |
| 1 | Generate | The idle prewarm loads the whole editor (`index.html?embed=generate`, ~1.5 MB with scripts) on every visit, phones included. | Start the renderer on the first focus of the brief box, not on idle. | `generate.html` |
| 2 | Design Request | The page is a 238 KB fork of `index.html` with dead editor views and routing (`routeFromHash()` always returns `requests`). | Strip the hidden Home and editor markup and their scripts. | `design-request.html` |
| 3 | Sidebar (laptops ~800px tall) | The Help group (Guidelines, What's new, Tool Feedback) sits below the scroll fold; only its label shows. | Let the AI usage card collapse to one line under 820px tall, or pin Help above the footer. | `es-ui.css`, `app-shell.js` |
| 4 | Dashboard | The tab row clips at 1280 ("Access Requ…") with no scroll cue. | Add the same edge fade the sidebar uses, or move People/Access into a "More" menu. | `dashboard-ui-system.css` |
| 5 | Repo | Unused large assets ship with every deploy: `login-reel-captions.webp` 1.1 MB, `login-artwork.webp` 420 KB, `how-hero-art-2412.webp` 417 KB. | Delete them (no references in any page, CSS or JS). | assets |
| 6 | Profile menu | The menu says "Edit Profile"; the page title is now "Edit profile". | Sentence case in the menu. | `site-chrome.js` |
| 7 | Profile, Design Request | `isDemoProfileName()` treats the real name "Suhail Quraishi" as demo data and discards it (falls back to the email handle). | Drop the hard-coded name; clear old demo profiles once by a version flag instead. | `ai-page/account.js`, `design-request.html` |
| 8 | Settings | Start page options omit Reel Captions and Generate. | Add them. | `ai-page/settings.html`, `ai-page/account.js` |
| 9 | Design Request (phone) | Dropdown options are 35px tall; touch targets should be 44px. | `min-height: 44px` on `.request-dropdown-option` under 640px. | `design-request.html` |
| 10 | Editor (Home) | Two `.es-tile--purple` uses still on Home. | Rename to `.es-tile--cyan` (the alias keeps them working meanwhile). | `index.html` |

## Lines for other owners

### `index.html` (owner WIP)
- Cache keys (lines ~7804–7817): `site-mobile-chrome.css`, `studio-inspector.css`, `theme.css`, `site-chrome.css`, `design-tokens.css`, `es-ui.css` and `app-shell.js` → `?v=20261117-ready1`.
- Line ~7992 and ~8017: `es-tile--purple` → `es-tile--cyan`.
- Line ~23439: add `aria-label="Search ES images"` to the ES Image Pool input.

### `generate.html`
- Cache keys (lines 19–24, 48): `site-mobile-chrome.css`, `theme.css`, `site-chrome.css`, `design-tokens.css`, `es-ui.css`, `app-shell.js` → `?v=20261117-ready1`.
- Delete the `.gen-found__team` rules (lines 136–139); `.es-team-logo` in `es-ui.css` replaces them.
- Line ~1680: `class="gen-found__team"` → `class="es-team-logo"`.
- Line ~1686: `img.parentElement?.classList.add('is-dot')` → `img.parentElement?.classList.add('es-team-logo--dot')`.

### `video-ads.html`
- Cache keys (lines 19–24, 31): `site-mobile-chrome.css`, `theme.css`, `site-chrome.css`, `design-tokens.css`, `es-ui.css`, `app-shell.js` → `?v=20261117-ready1`.

### `video-ads.css` (focus defined three ways)
Keep the "Quiet focus" block (lines ~1450–1459) as the one definition. Delete the superseded rules it overrides:
- line ~412 `.va-input:focus { outline: none; box-shadow: inset 0 0 0 2px var(--va-accent), 0 0 0 4px var(--va-accent-soft); }`
- line ~663 `.va-compose:focus-within { box-shadow: inset 0 0 0 2px … }`
- line ~677 `.va-switch input:focus-visible + .va-switch__track { outline: 2px solid var(--va-accent-text); … }`
- line ~798 `html body .va-page .va-panel :is(a, button, input, textarea, summary, [role="tab"], [role="radio"], [tabindex]):focus-visible { outline: 2px solid var(--va-accent-text) !important; … }`
- line ~799 `.va-input:focus { box-shadow: inset 0 0 0 1.5px var(--va-accent-text), 0 0 0 4px rgb(10 125 250 / .2); }`
- line ~1199 `.va-ai .va-compose:focus-within { box-shadow: inset 0 0 0 2px … }`
- line ~1319 `html body .va-steps .va-step:focus-visible { outline: 2px solid var(--va-accent-text) !important; … }`
- lines ~1439 and ~1443 `.va-ask-ai:focus-visible { … }` and its dark twin

Keep the over-video white outlines (lines ~137, 288, 298, 731 and the light-mode recolour at ~948–950): they sit on the video, not on the panel.

Optional: map `.va-logo` / `.va-logo--dot` onto `.es-team-logo` / `.es-team-logo--dot` so both pages share one chip.
