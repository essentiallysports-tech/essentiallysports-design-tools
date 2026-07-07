# ES Designer Website Logic Overview

Last updated: July 1, 2026

This document explains the structure and working logic of the EssentiallySports design tools website. It is meant as a handoff/reference file for future development so the next person can understand what each page does, how the canvas tools work, and how the Design Request integrations are connected.

## 1. Project purpose

ES Designer is a browser-based internal design tool for creating and managing EssentiallySports visual assets. It combines:

- A Supabase-backed login entry page.
- A main design workspace for Social Media, YouTube, Newsletter, and guideline pages.
- A Design Request workflow for submitting creative requests.
- Canvas-based generators for image exports.
- External request notifications through Slack, email Lambda, and optional Google Sheets integration (server-side, via a serverless function).

The website is intentionally mostly static HTML/CSS/JS, so it can run on Vercel or Netlify without a heavy app framework.

## 2. Main files

| File / folder | Purpose |
| --- | --- |
| `index.html` | Main ES Designer app. Contains the homepage, workspaces, guidelines, FAQ, canvas generators, Design Request section copy, and most UI logic. |
| `design-request.html` | Standalone Design Request page with request form, saved request list, and its own compact canvas/support logic. |
| `login.html` | Supabase login/create-account/password-recovery page with ES-domain gating. |
| `api/design-request-submit.js` | Serverless adapter (Vercel) for authenticated Google Sheets, Slack, and email sync. |
| `netlify/functions/design-request-submit.js` | Equivalent Netlify Function, kept for Netlify deployments. |
| `vercel.json` | Vercel configuration (headers). |
| `netlify.toml` | Netlify configuration. |
| `ai-page/` | Account/profile/settings support pages. |
| `fonts/` | Local Acumin/brand font files. |
| `newsletter-brand-assets/` | Newsletter-specific artwork/background assets. |
| `social-icons/` | Navigation/footer social icons. |
| `*.webp`, `*.svg`, `*.json` assets | Optimized images, logos, icons, quote/stats templates, and structure files used by the canvas tools. |

## 3. Navigation and page routing

The site uses static sections and hash/data-attribute routing rather than a full SPA router.

In `index.html`, page state is controlled mainly by:

- `body[data-current-page="..."]`
- hash links like `#newsletter`, `#social-guidelines`, `#faq`
- navigation setup functions such as `setupNavigation()` and `setupPageTransitions()`

CSS then shows/hides or changes sections based on the current page. Example patterns:

- `body[data-current-page="newsletter"]`
- `body[data-current-page="youtube"]`
- `body[data-current-page="faq"]`
- `body[data-current-page="newsletter"][data-newsletter-asset="tag-fi"]`

This keeps the site simple: no React/Vue build step, no client router dependency.

## 4. Login page logic

File: `login.html`

The login page uses Supabase email/password authentication:

- User must create an account with an approved `@essentiallysports.com` email.
- Supabase remains the source of truth for account creation, login, password reset, and logout.
- Local browser storage is only used to mirror lightweight UI/profile state.
- There is no browser-local password/account fallback; if Supabase is unavailable, login fails closed.
- After login, the user is redirected back to the original target using a `redirect` query param, defaulting to the homepage.

Visual logic:

- ES full blue logo sits top-left.
- Main heading: “Log in to ES Designer”.
- Feature cards showcase Social Media, YouTube Assets, and Newsletter Assets.
- Login artwork and feature card imagery are optimized `.webp` assets.

## 5. Main workspace state model

File: `index.html`

The main design app uses one large JS state object created by `createDesignerState()`.

Important state areas include:

- Active workspace/page.
- Current uploaded background/entity images.
- Text/pill inputs.
- Post type selection.
- Newsletter asset type.
- Canvas drag/zoom offsets.
- Stats post inputs.
- Selected colors and newsletter branding.
- History slide index for multi-post workflows.

The `WORKSPACES` constant defines core workspace properties like:

- canvas dimensions
- export file prefix
- export type/extension
- active render behavior

The render pipeline generally follows this shape:

1. User changes UI input or uploads image.
2. State is updated.
3. Control sync functions update UI visibility/values.
4. `render()` redraws the canvas.
5. `downloadImage()` exports the current canvas.

## 6. Canvas rendering logic

Most generator output is drawn directly on a `<canvas>`.

Key functions in `index.html`:

- `drawCanvas(ctx, W, H, scale)` chooses the correct drawing mode.
- `render()` clears and redraws the current canvas.
- `downloadImage()` exports the current canvas as an image.
- `drawCoverImage()`, `drawCoverImageInRect()`, `drawScalableCoverImage()` handle image placement.
- `drawPills()` handles dynamic text pill drawing.
- `drawLogo()` and `drawEsLogoMark()` draw the ES logo in the correct position.
- `setupCanvasDrag()` enables moving uploaded images inside canvas areas.
- `syncPhotoControls()` and related sync functions show/hide upload/position controls.

Canvas output uses deterministic drawing rather than DOM screenshots. This makes downloads more stable and avoids browser layout inconsistencies.

## 7. Social Media workspace

The Social Media workspace supports multiple post types:

- Cover Image
- Quote Image
- Long Quote Image
- Double Entity Quote
- Stats Post Single Entity
- Stats Post Double Entity

Important logic:

- Post type selection is now handled with a dropdown-style UI.
- Each post type has separate state where needed, preventing leakage between templates.
- Pill positions and text are synced per context.
- Canvas history states/slides are shown beside the Upload Image CTA.
- Upload image CTA is placed below the canvas bottom-left, with history controls to the right.

Important drawing functions include:

- `drawCoverPost()`
- `drawQuotePost()`
- `drawLongQuotePost()`
- `drawDoubleEntityQuotePost()`
- `drawStatsSingleEntPost()`
- `drawStatsDoubleEntPost()`

Stats post notes:

- Single entity stats have dynamic title pill sizing.
- Text/pill padding follows the shared pill logic so the pill width adjusts to text.
- Stats fields sync both ways between raw lines and separate stat/title inputs.

## 8. YouTube workspace

The YouTube workspace creates YouTube-style visual assets.

Core concepts:

- Variation controls switch between layout modes.
- Entity images can be uploaded and moved/scaled.
- Quote mode has separate UI controls.
- Canvas export uses the YouTube-specific workspace dimensions/prefix.

Main helper patterns:

- Variation switchers update state.
- Entity photo controls are conditionally shown.
- Canvas render uses the selected layout variation.

## 9. Newsletter workspace

The Newsletter workspace has multiple asset types selected through `activeNewsletterAsset`.

Current asset types include:

- Feature Image
- Section Header
- Video FI
- Tag FI

The active newsletter asset is reflected in:

- `body[data-newsletter-asset="..."]`
- `state.newsletterAsset`
- UI visibility rules
- export file naming
- canvas draw function selection

### 9.1 Feature Image

Standard newsletter feature-style image, using brand palette and background/photo logic.

### 9.2 Section Header

Creates section header graphics with editable text and newsletter brand styling.

### 9.3 Video FI

Added as a simple video feature image:

- Size: `900 × 675`
- One background image.
- A play button centered over the background.
- Play button fill comes from the selected newsletter branding color at low opacity.
- The play icon itself is stored as `newsletter-youtube-fi-play-icon.svg`.

### 9.4 Tag FI

Added as a simple tag feature image:

- Size: `900 × 675`
- One background image.
- Editable pill/tag text on top.
- Pill treatment:
  - white fill
  - light blue stroke
  - strong ES navy text
  - dynamic sizing based on text

## 10. Guidelines pages

Guidelines are present inside the main site and are routed through the same static navigation approach.

Guideline sections include:

- Logo Guidelines
- Social Media Guidelines
- Video Guidelines

Typography was adjusted so guideline titles use the intended brand font treatment instead of the old Roboto Condensed look.

These pages are mostly content/static image sections with optimized `.webp` guide assets.

## 11. Design Request form logic

Design Request exists in both:

- `index.html`
- `design-request.html`

Important functions:

- `validateRequestForm()`
- `createDesignRequestRecord()`
- `generateDesignRequestId()`
- `renderDesignRequestRecords()`
- `exportDesignRequests()`
- `syncDesignRequest()`
- `syncDesignRequestToSheet()`
- `designRequestIntegrationMessage()`

### 11.1 Request record shape

The form creates a record with fields such as:

- `schemaVersion`
- `id`
- `createdAt`
- `source`
- `status`
- `requestType`
- `requester.name`
- `requester.email`
- `publication`
- `socialChannel`
- `sport`
- `teamOrLeague`
- `title`
- `entities`
- `brief`
- `designCopy`
- `referenceLinks`
- `referenceFiles` where available
- `additionalNotes`
- `priority`
- `designDueAt`
- `publishAt`

### 11.2 Request ID logic

IDs are generated in this style:

```text
DR-YYYYMMDD-001
```

The sequence number is calculated from locally stored requests for that day.

### 11.3 Local persistence

Submitted requests are saved in browser storage for the session/browser so the user sees a local list even if external integrations fail.

The form can also export saved submissions as JSON.

## 12. Design Request external integrations

The submit flow is intentionally non-blocking:

1. Create the design request record.
2. Save the request locally so the user does not lose the submission.
3. Try authenticated server-side sync (`/api/design-request-submit`, a serverless function).
4. The serverless function posts to Google Sheets, Slack, and/or email only when the corresponding environment variables are configured.
5. Show a status message summarizing what succeeded.

This means a temporary integration failure should not erase the user’s request locally.

### 12.1 Serverless sync function

Files: `api/design-request-submit.js` (Vercel) and `netlify/functions/design-request-submit.js` (Netlify) — identical logic, different handler signatures for each platform.

This optional server-side route supports:

- Google Sheets append
- Slack webhook post
- Design request email POST
- Email notification POST

It verifies the Supabase bearer token first and expects environment variables for secure server-side operation.

When configured, it returns integration statuses like:

```js
{
  integrations: {
    googleSheets: { ok, skipped, ... },
    slack: { ok, skipped, ... },
    email: { ok, skipped, ... }
  }
}
```

### 12.2 Server-side Slack integration

File: `netlify/functions/design-request-submit.js`

The authenticated submit function builds a rich Slack message payload with:

- request ID
- priority
- request type
- requester details
- publication/channel
- title/entities
- creative brief
- design copy
- notes
- due/publish dates
- reference links/files.

Slack delivery is enabled with `SLACK_DESIGN_REQUEST_WEBHOOK_URL`. Keep the webhook only in platform environment variables.

### 12.3 Server-side email integration

File: `netlify/functions/design-request-submit.js`

The authenticated submit function can POST the Design Request record to an email endpoint configured with `DESIGN_REQUEST_EMAIL_ENDPOINT`.

Body signature:

```ts
{
  id?: string;
  priority?: string;
  requestType?: string;
  status?: string;
  publication?: string;
  socialChannel?: string;
  sport?: string;
  teamOrLeague?: string;
  requester?: { name?: string; email?: string };
  title?: string;
  entities?: string;
  brief?: string;
  designCopy?: string;
  additionalNotes?: string;
  designDueAt?: string;
  publishAt?: string;
  referenceLinks?: string[];
  createdAt?: string;
}
```

Behavior:

- Removes empty values before sending.
- Sends JSON from the serverless function only after Supabase bearer-token verification passes.
- Does not include uploaded file metadata because the provided email body signature does not include files.

### 12.4 Status message logic

`designRequestIntegrationMessage(sync)` builds the final user-facing status:

- “added to Google Sheets”
- “sent to Slack”
- “sent by email”
- or a warning if external sync needs attention

## 13. Upload and image placement logic

Across workspaces:

- Upload image CTAs are styled consistently with the homepage/banner CTA language.
- Uploaded images are stored as browser `Image` objects.
- Drag and zoom controls modify image offsets and scale.
- Canvas draw functions use cover-fit logic so images fill their target area.
- For some layouts, different image roles exist:
  - background image
  - entity image
  - second entity image
  - newsletter background

The upload button placement was adjusted so the canvas, toolbar, upload CTA, and history controls can be seen better on laptops.

## 14. Export/download logic

Exports are done from the active canvas.

`downloadImage()`:

- Determines the active workspace.
- Builds a filename from workspace type, text, slide, post type, variation, and newsletter asset type.
- Exports as the configured MIME/extension.
- Uses optimized canvas export flow with visual feedback.

## 15. Asset optimization conventions

Current asset direction:

- Use `.webp` for raster images wherever possible.
- Use `.svg` for logos/icons/vector shapes.
- Keep large guide images and workspace cards optimized.
- Avoid reintroducing `.jpg`/`.png` unless required by a specific export or source.

Most visible imagery has already been converted/kept in web-friendly formats.

## 16. Key implementation principles used

### Keep leakage isolated

The post/canvas modes store separate state or context where required. This prevents changes in one canvas type from corrupting another mode.

### Canvas is source of truth for export

The UI controls are only inputs. The final asset is rendered directly on canvas, then exported.

### External integrations should not block local submission

The Design Request form saves locally even if Slack, email, Netlify, or Google Sheets fail.

### Prefer static deploy simplicity

Most features are plain HTML/CSS/JS so Netlify can host the site easily.

### Use data attributes for layout modes

Page/workspace variants are reflected on `<body>` with data attributes. CSS reacts to those states.

## 17. Known security / production notes

- Slack/email/Google Sheets submission should be routed through `/api/design-request-submit` so integrations can run server-side with environment variables.
- Supabase Auth is active in the frontend, and protected serverless endpoints verify the Supabase bearer token before processing private requests.
- Dashboard UI access is restricted to configured admin emails only.
- Browser local storage is useful for demo/session history but is not a durable database.

## 18. Recommended future improvements

- Move dashboard/request/design history from local browser storage to Supabase tables with RLS.
- Add a real database or Google Sheets-backed request list instead of only local browser history.
- Split the large `index.html` into smaller JS/CSS modules when the app stabilizes.
- Add regression checks for:
  - switching between Social Media post types
  - dynamic pill sizing
  - newsletter asset rendering
  - design request server-side submit integrations
- Move dashboard data from local browser storage to Supabase-backed tables.
- Add server-side role/RLS policies for dashboard data once Supabase tables are connected.

## 19. Quick developer checklist

When changing the site:

1. Confirm whether the change belongs in `index.html`, `design-request.html`, or both.
2. If changing Design Request submit logic, update both pages.
3. If changing external request messaging, update:
   - `netlify/functions/design-request-submit.js`
   - `api/design-request-submit.js` only if the Vercel adapter shape changes
4. If adding a new canvas type:
   - add state defaults
   - add UI controls
   - add body data attribute rules if needed
   - add draw function
   - connect it in `drawCanvas()`
   - add export naming suffix
5. Test at laptop width and desktop width.
6. Verify download output, not just on-screen canvas preview.
