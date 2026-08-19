# AI Edit Log

Running handoff log for edits made to this site by any AI assistant (Claude or otherwise).
**Read this file first** before making changes, so you know what's in progress, what's finished,
and what's still uncommitted.

## Standing rules
- Repo: `essentiallysports-tech/essentiallysports-design-tools`, origin = org repo directly (not a fork).
- Always give a local preview link before pushing.
- "push" = commit + push straight to `main` (deploys live via Netlify).
- "roll back" = revert to the commit before the last push.
- No unrequested extra work — ask before doing anything beyond what was asked.
- Local preview: `python3 -m http.server 8935` via `.claude/launch.json` (config name `design-tools` lives
  in the sibling session-root repo's launch.json, since preview tooling reads from there).

---

## Entries

### 2026-08-19 — Add ASAP Template 1 to the Social Media workspace; reconciled with a parallel session's changes
- Status: `[pushed - bc1faf3, merge 8383e51]`
- Files touched (new): `asap-template-data.js`. Files touched (existing): `index.html` only.
- Ask (Suhail): given a Figma-exported JSON (`asap-template-structure.json`) plus a rendered PNG reference
  for a new social post design — a photo background, an ES logo badge top-right, and a rounded gray card
  holding a bold headline plus a dashed-divider list of dated update rows — "follow what's already
  actually there just this is a similar different design." Read that as: reuse the established
  `INSTAGRAM_POST_TYPES` architecture (same pattern as the two Listicle templates), not the literal pixel
  coordinates in the Figma export — those turned out not to be in the same coordinate space as the
  1080×1350 canvas (e.g. the background image layer is exported at its intrinsic 1700×1794 size, not its
  placed/cropped size), so the final layout was derived from the *screenshot's* proportions plus the
  site's existing `LISTICLE_CANVAS_LAYOUT`-style safe-inset convention (50px), not trusted 1:1 from the JSON.
- Researched the full Listicle Type 1 implementation first (via an Explore agent, since `index.html` is
  huge) to find every touchpoint a new post type must hook into: the post-type `<select>`, the
  `INSTAGRAM_POST_TYPES` registry, a new editor-fields block (reused the existing generic `.listicle-*`
  CSS classes directly rather than writing new ones), `createDesignerState()`, `syncPostTypeControls()`
  (text-card label, field-panel visibility, `hidePrimaryTextarea`, `colorCard` hide), the
  `onTextChange`/`setupCanvasDrag` bail-outs, and `getMainTextSlug()`. Deliberately did **not** add the new
  type to `isListicleImageControlLocked()` or the CSS `body:is([data-instagram-post-type="listicle-type-1"],
  ...])` combinator that hides `.image-tool-rail` — unlike the Listicle templates, this one needs a real
  photo background with pan/zoom controls active.
- Data model follows the exact same UMD pattern as `listicle-data.js` (`asap-template-data.js`, exposing
  `window.ESAsapTemplate1`): a title field plus up to 6 rows, each a single text string; blank rows are
  simply skipped when rendering rather than requiring dynamic add/remove row UI, so the card's height
  computes itself from however many rows are actually filled in (clamped to a sane min/max).
- Verified end-to-end in a no-auth-code srcdoc harness: zero JS errors on load; selecting "ASAP Template 1"
  correctly shows its editor fields (6 row inputs) and hides the primary textarea/color card; the canvas
  renders at 1080×1350 with the card's exact background color (`rgb(232,232,232)`) sampled from real pixel
  data; edited a row's text and confirmed state updates live; blanked all rows down to zero and confirmed
  no crash; round-tripped through a different post type and back with all visibility toggles restored
  correctly; confirmed `.image-tool-rail` stays visible (`display:flex`) so photo pan/zoom still works.
- **Mid-task reconciliation**: `git push` was rejected — `origin/main` had moved 30 commits ahead (another
  session/person had been working in parallel: a Twitter Quotes post type added to the *exact same*
  `INSTAGRAM_POST_TYPES`-adjacent code, Listicle rows expanded 5→10, a full Tool Feedback redesign +
  dashboard-inbox integration, a shared typography/design-tokens system, and a mobile editor overhaul).
  Per the standing rule from the 2026-07-29 entry below ("check `git fetch` before assuming local `main`
  is current"), fetched and merged rather than force-pushing. `index.html` had 6 real conflict hunks — all
  the same shape: my `asap-template-1` addition and their `twitter-quote` addition landing on the same
  line in a shared conditional (post-type `<option>`, the registry object, and four spots inside
  `syncPostTypeControls()`) — resolved by keeping both branches' lines side by side (never picking one
  over the other) in each hunk. Re-ran the full verification harness against the merged file afterward to
  confirm both new post types (mine and theirs) still work correctly side by side before pushing.

### 2026-08-19 — Listicle Type 1 & 2: expand to 10 rows, add per-row Hide/Unhide
- Status: `[pushed - see rollback point below]`
- Files touched: `listicle-data.js`, `listicle-type2-data.js`, `index.html`,
  `scripts/test-listicle-data.mjs`, `scripts/test-listicle-type2-data.mjs`,
  `scripts/test-listicle-rank-pill.mjs`, `scripts/test-listicle-type2-ui.mjs`,
  `scripts/test-listicle-accordion.mjs`.
- Ask (Suhail): Listicle Type 1 and Type 2 should support 10 rows instead of 5, and each row needs a
  Hide/Unhide control so a row can be excluded from the rendered post without deleting its content.
- Data layer: `ROW_COUNT` raised 5 → 10 in both `listicle-data.js` and `listicle-type2-data.js`; extended
  `DEFAULT_ACCENTS` / `DEFAULT_LOGO_SOURCES` (cycling the existing 5 placeholder logos, there are only 5
  logo assets in `assets/listicle-placeholders/`) and `DEFAULT_ROWS` to 10 entries each. Added a `hidden`
  boolean field to `normalizeRow` in both files (defaults to `false`); `updateListicleRow` already patches
  arbitrary fields so toggling `hidden` needed no other data-layer change.
- Editor UI: each row's accordion summary now has a sibling **Hide/Unhide** button (`listicle-row-header`
  wraps the existing toggle `<button>` and the new hide `<button>` as siblings, since a button can't nest
  inside a button). Hidden rows dim to 50% opacity (`.is-row-hidden`) in the row list. Click handlers added
  to both `initListicleControls` and `initListicleType2Controls` toggling `row.hidden` via
  `updateListicleRow`, then rebuilding the row controls and re-rendering.
- Canvas rendering — this was the trickiest part, and went through two passes:
  1. First pass: rows with `hidden: true` are filtered out before rendering, and the remaining visible
     rows are laid out across the fixed canvas (1080×1350), with row height/pitch shrinking as needed to
     fit however many rows are visible (`Math.min(baseRowHeight, floor(availableSpace / visibleCount))`).
     Hiding rows down to ~5 or fewer reproduces the original spacious 5-row layout exactly (rowScale = 1
     at ≤5 visible rows, so nothing changed for the existing 5-row use case).
  2. Suhail flagged the first pass as "too small" at 10 rows — the bug was scaling fonts/logos/rank-pills
     by the same linear factor as the row pitch, so 10 rows shrank content to ~53% of original size.
     Fixed by decoupling: row *pitch* (vertical spacing) still shrinks linearly to fit more rows, but
     content size (fonts, logo frame, rank pill, player cutout) uses `Math.pow(rowScale, 0.6)` — a gentler
     curve that keeps glyphs/logos meaningfully larger at high row counts (e.g. at 10 rows content lands
     at ~68% scale instead of ~53%), while still fitting inside each row's slot without overlap. At ≤5
     visible rows this curve is still an identity (rowScale = 1), so it's fully backward compatible.
  3. Type 1 (`drawListicleType1Post`): available table height computed from `rowTop` down to just above
     the always-on swipe button (`SWIPE_BUTTON_H` + `SWIPE_BUTTON_SAFE_MARGIN` + a small gap). Type 2
     (`drawListicleType2Post`, no swipe button) computes available height down to a small fixed bottom
     margin instead. `drawListicleRankPill` gained an optional `rowScale` parameter (defaults to `1`, so
     the standalone rank-pill tests calling it with the old 6-arg signature are unaffected).
  4. If every row in a template is hidden, rendering falls back to showing all rows rather than a blank
     canvas.
- Updated the existing Node test scripts (`scripts/test-listicle-*.mjs`) for the new row count (10 instead
  of 5) and added hide/unhide coverage. **Could not run them** — no Node.js available in this environment;
  only manually re-read the diffs for correctness.
- Verification note: like other pages on this site, the local `python3 -m http.server` preview is gated by
  real Supabase login (domain-restricted to `essentiallysports.com`), which the assistant does not attempt
  to bypass or log into on Suhail's behalf. Suhail is verifying visually in his own logged-in session;
  the "too small" fix above was made in response to that feedback, not independently confirmed in-browser
  by the assistant.
- **Rollback point: `1a5946c`** — HEAD before this batch, i.e. "the version before" if this needs reverting.

### 2026-08-18 — Tool Feedback focused form redesign
- Status: `[pushed - 1f4f2b8]`
- Files touched: `tool-feedback.html`, `tool-feedback.css`, `tool-feedback.js`.
- Ask (Suhail): bring Tool Feedback fully into the website's established UI language, improve its
  iconography and hierarchy, and turn it into a focused single-column form without changing feedback
  storage or submission behavior.
- Rebuilt the page around one centered `840px` panel and removed the competing right-side guidance
  card. The page now uses shared design tokens, the standard page-title scale, restrained account
  metadata, a `10px` panel radius, and the same ES-blue selected/focus/CTA language as the main site.
- Replaced the tall feedback cards with compact Bug, Idea, Praise, and Other selectors using consistent
  `24x24` viewBox line icons rendered at `18px`. The selected state uses `#E8F2FF` with an ES-blue border;
  the redundant `Signed-in users only` badge was removed.
- Added feedback-type-specific guidance below `Tell us what happened`, kept the tool preselection and
  custom dropdown contract intact, increased the textarea height, moved the character count inside its
  lower-right edge, and paired a quiet `Back to workspaces` link with the standard primary CTA. The
  dropdown also received improved keyboard handling.
- Mobile now uses `16px` page margins, a `2x2` feedback selector grid, `16px` form text, and a full-width
  submit button while preserving 44px-or-larger touch targets. Auth, API submission, validation,
  loading/error/success states, query-string tool preselection, and reset behavior remain intact.
- Verified: `node --check tool-feedback.js`, `scripts/test-design-tokens.mjs`, and
  `scripts/test-vercel-api-adapters.mjs` pass. Browser smoke passed at 1280px, 1440px, 390x844, and
  360x740 with no horizontal overflow or console errors; contextual helper changes, query preselection,
  and empty-submit validation were exercised. A real authenticated submission was not created during
  visual QA to avoid adding test feedback; the API adapter regression covers the submission contract.
- Known unrelated check: `scripts/check-site-chrome.mjs` still reports pre-existing failures for the
  missing `how-it-works.html` page and stale chrome expectations on unrelated pages. Those files were
  not changed as part of this focused redesign.

### 2026-08-17 — Newsletter widget builder: per-pick Show/Hide switches, paste-link field cleanup
- Status: `[pushed - 573da5d, 6edf0c1, 9966dbe]`
- Files touched: `index.html` only.
- Ask (Suhail): make each "Top Pick N" label more prominent/black, add a Hide/Show switch on the far
  right of that row that decides whether the story renders in the generated HTML + live preview, hide
  (not remove) the "Upload Image" button for now, and remove the WordPress/Google "Tip" line under every
  image field.
- Fix: `.widget-pick-label` set to bold black; added a small inline switch (`.widget-pick-switch`,
  reusing the same track/thumb visual language as the existing `.quote-switch` component elsewhere in
  this file) per Top Pick row, wired to `widgetBuilderState.picks[i].hidden`; `buildWidgetHtml()` now
  does `state.picks.filter(pick => !pick.hidden)` before mapping, so a hidden pick's `<table>` block and
  its divider are both actually absent from the output, not just visually dimmed. Upload buttons hidden
  via a blanket `[data-widget-upload] { display: none; }` rule (DOM untouched, one line to revert). All 7
  `.widget-inline-tip` paragraphs deleted.
- Two follow-up UI nits from the same area: removed the leading chain-link `<svg>` icon from all 5
  paste-link fields (main + 4 picks); then fixed a "two nested boxes" look on those same fields — a
  site-wide `input[type="text"]` rule (specificity `(0,1,1)`) was outranking `.widget-paste-link-input`'s
  own `border: 0` (specificity `(0,1,0)`), so the input kept its own rounded border inside the field's
  border. Fixed by bumping the selector to `input.widget-paste-link-input` (same specificity, later in
  the cascade, wins) and explicitly resetting `width`/`border-radius`/`padding` too, not just `border`.
- Verified: intercepted `navigator.clipboard.writeText` and clicked the real "Copy HTML" button
  before/after toggling a pick off — confirmed the pick's row and its divider are genuinely absent from
  the copied HTML, then restored on toggling back on. Confirmed upload buttons `display:none` but still
  present in the DOM. Confirmed computed `border` on the paste-link input is `0` after the specificity fix.

### 2026-08-17 — Bumped site-chrome cache-busting version (stale navbar icons on other accounts)
- Status: `[pushed - 979f64a]`
- Files touched: `index.html`, `reels.html`, `design-request.html`, `dashboard.html`, `login.html`,
  `ai-page/index.html`, `ai-page/settings.html`, `ai-page/profile.html`, `ai-page/logout.html`,
  `tool-feedback.html`.
- Bug (Suhail: "i can still see the old icon used for profile bar on navbar" on other accounts):
  root-caused via an Explore agent diffing `af76c5f` (the Aug 15 icon-unification commit) — it changed
  `site-chrome.js`'s `profileIcon()` glyphs (the Edit/Settings/Logout dropdown-row icons) but never
  bumped the shared `?v=20260723-profile2` / `?v=20260723-profile3` query strings on `site-chrome.js`/
  `site-chrome.css`. Any browser that had already cached those files before Aug 15 had no reason to
  re-fetch them — identical URL, identical cache key — so it kept serving the pre-unification icons
  indefinitely. Note: the top-right avatar bubble itself is CSS/initials-only (no image), so it was never
  in scope for icon unification; the "old icon" was specifically the dropdown-menu glyphs.
- Fix: bumped both to `?v=20260817-icons1` everywhere they're referenced (10 files, confirmed all were
  byte-identical `20260723` values beforehand via grep, so this was a clean global bump, not a
  per-file reconciliation).

### 2026-08-17 — New Tool Feedback page + Google Sheets integration, then reworked to match the real design language
- Status: `[pushed - 795c4a6, 07855c1, fd77195, 692ea3b]`
- Files touched (new): `tool-feedback.html`, `tool-feedback.css`, `tool-feedback.js`,
  `netlify/functions/tool-feedback-submit.js`, `api/tool-feedback-submit.js`. Files touched (existing):
  the 8 pages with a top navbar (added a "Tool Feedback" link right after FAQ), `GOOGLE_SHEETS_SETUP.md`.
- Ask (Suhail): a "Tool Feedback" nav link after FAQ on every navbar, leading to a page where anyone can
  submit feedback that lands in a specific Google Sheet (gave a link with public edit access).
- Built by reusing the exact append-to-sheet pattern already proven in
  `netlify/functions/design-request-submit.js` (signed-JWT service-account OAuth2, `sheets.googleapis.com
  ...:append`) — same `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_PRIVATE_KEY` env vars, new
  `GOOGLE_FEEDBACK_SHEETS_ID` (defaults to the sheet Suhail gave, so no extra Netlify/Vercel config is
  required to start working). Submission is auth-gated like the rest of the site; the submitter's email
  comes from their session, not a form field.
- First visual pass invented its own look (pill-shaped radio buttons, a rounded chip "eyebrow" label, a
  narrow centered card) — Suhail flagged it didn't match the site ("it doesnt visually look in our
  language"). Re-researched the *actual* design system via an Explore agent reading real CSS out of
  `design-request.html`/`reels.css` (exact hex tokens, radius scale, the `.request-dropdown` animated
  dropdown, the `.reels-style-card` selectable-card pattern, the real `.btn`/`.btn-primary` spec) and
  rebuilt the page against those, including replacing a native `<select>` with a from-scratch animated
  custom dropdown matching `.request-dropdown` exactly, since the user separately flagged the native
  dropdown ("dropdown is not in our language our animations").
- Real bug found and fixed along the way: when the Sheets integration is unconfigured, the function
  returned `{ok:false, skipped:true}` with no `error` field, so the client showed a generic, useless
  "Could not send your feedback" message. Added a real `error` string to that response so a future
  misconfiguration is actually diagnosable instead of silent.
- Verified: zero JS errors via the usual no-auth-code srcdoc harness; confirmed the deployed endpoint is
  live and reachable (`curl -X POST https://essentiallysports-design-tools.vercel.app/api/tool-feedback-submit`
  returns a proper `401 {"ok":false,"error":"Authentication required."}`, proving the function deployed
  correctly and CORS/OPTIONS handling works); confirmed the custom dropdown opens/closes, selecting an
  option updates the underlying `<select>` and closes the menu. **Not verified from this sandbox**: the
  full authenticated submit → Sheets-append path end-to-end (no way to obtain a real Supabase session
  here, same limitation noted in the widget-image-hosting entry below) — this depends on Suhail's own
  testing, which is how the missing-`error`-field bug above was actually caught.

### 2026-08-17 — Reels: fixed auto-caption freezing the tab; simplified caption style; removed safe-zone outline
- Status: `[pushed - 97e1adc, fba90d9, 1fc6497]`
- Files touched: `reels.js`, `reels.html`, `reels.css`, `reels-whisper-worker.js` (new).
- Ask (Suhail): drop the caption style picker down to one built-in style — a single centered word at a
  time — with Top/Middle/Bottom position options replacing it. Implemented (`CAPTION_STYLES` reduced to
  one entry, `drawCaption`/`getActiveCaptionWord`/`drawSingleWordCaption` replace the old multi-style pill
  layout/animation code, ~300 lines of now-dead style/animation helpers removed). Verified structurally
  (zero JS errors after the refactor, position dropdown correctly relabeled Top/Middle/Bottom, direct
  source trace confirms the position `<select>`'s `change` handler writes `state.captionPosition` which
  `getCaptionBlockTop()` reads on every draw) — pixel-level canvas verification was attempted but proved
  unreliable in this harness (the specific test video already contains substantial blue content of its
  own, confounding a blue-pixel-based pill-detection scan; documented as a known limitation rather than a
  confirmed pass).
- Bug (Suhail: tab shows Chrome's "Page Un-responsive" dialog partway through Auto-caption on longer
  clips): root cause was the on-device Whisper fallback (`@huggingface/transformers`) running its model
  load + inference directly on the main thread — long enough on a real clip to trip the browser's hang
  watchdog. Fix: moved that work into a dedicated Web Worker (`reels-whisper-worker.js`, `type: 'module'`
  so the CDN `import()` works inside it) — `transcribeLocalAudioChunks` now posts each audio chunk to the
  worker and awaits a message back instead of calling the pipeline inline.
- Verified for real (not just code review): spun up the actual worker in a browser harness, watched it
  download and load the real model via progress-callback messages, ran real inference on a sample buffer,
  and got back a correctly-shaped `{text, chunks}` result — confirming the whole path works off the main
  thread before shipping.
- Separately, removed the dotted "Caption safe zone" outline overlay on the stage frame per a one-line
  request ("in reel frame no need of that dotted outline box") — deleted the `.reels-safe-frame` div and
  its now-unused CSS.

### 2026-08-15 to 2026-08-17 — Newsletter widget image hosting: Netlify Blobs (abandoned, unverified) → Cloudinary (verified working)
- Status: `[pushed - 0250930, 58de19a, aa712c1, 2e53375]` (the WordPress/Google recommendation tip added
  here was later removed again on 2026-08-17, see the widget-builder entry above)
- Ask (Suhail): uploading a widget image from a local device didn't produce a real link, so the copied
  HTML never actually showed the image anywhere except the local preview. Wanted an auto-hosting solution,
  free if possible; had a WordPress account on the org domain as one option.
- Explored WordPress Application Passwords first — confirmed unavailable on the org's actual WP install
  (scrolled to the real bottom of the profile page; no such section exists, just the version footer).
  Abandoned that path.
- Built a Netlify Blobs solution (two functions: an auth-gated upload, and a public-but-key-validated
  read-back) with a graceful fallback to manual link-paste. **Could not verify the real success path from
  this sandbox** — `window.ESAuth` is `Object.freeze()`'d, so `fetchWithAuth` can't be mocked, and there's
  no way to fake a real logged-in Supabase session here; also no Netlify CLI/API access to check the
  actual deploy or env vars. Suhail reported it still wasn't working in production and asked directly
  whether it had been checked before pushing — it hadn't, only client-side logic and syntax had been.
- **Pivoted to Cloudinary unsigned uploads** specifically *because* it doesn't require a login step to
  test, once Suhail supplied a real cloud name + upload preset. Verified end-to-end for real this time:
  a real upload succeeded, the returned public URL was reachable with zero auth, the full widget-builder
  upload → auto-fill-link → Copy HTML flow was tested, and the copied HTML was confirmed to contain the
  real Cloudinary link. The Netlify Blobs functions and the temporary `@netlify/blobs` dependency were
  fully removed as part of the pivot (package.json is back to zero dependencies).
- **Lesson for whoever picks this up next**: when a fix can't be verified end-to-end from this sandbox
  (usually anything behind real auth or requiring a live deploy), say so plainly rather than shipping a
  second unverified guess — especially once the user has already flagged frustration with back-and-forth.
  Prefer pivoting to an approach that *can* be fully tested here over iterating blind on one that can't.

### 2026-08-15 — Icon unification, sliding hero carousel, nav label renames
- Status: `[pushed - af76c5f and others same day, see `git log --oneline` around this date]`
- This entry predates this log's most recent AI session and is reconstructed from commit subjects only
  (no first-hand verification detail available to record): unified site icons into one Lucide-based line
  family (`af76c5f`); rebuilt the homepage hero into an always-forward sliding carousel with real banner
  art across several follow-up commits; renamed nav labels site-wide ("Reels"→"Reel Captions", "Home
  Page"→"Home", "YouTube Assets"→"YouTube", "Newsletter Assets"→"Newsletter") and added a Reel Captions
  showcase card to the login page (`2c72461`); made Reels caption pills square instead of rounded
  (`8f142c8`). The hero carousel later needed a real bug fix (blank banner after navigating away and back
  while autoplay was running unboundedly in the background — fixed 2026-08-17, `f286b54`) and a top-padding
  tweak on workspace cards (`5879ea0`) — both one-off, low-context fixes not otherwise detailed here.

### 2026-07-29 — Fix caption pill shape: word/pill boxes didn't actually look like pills
- Status: `[pending push]`
- Files touched: `reels.js` only.
- Bug (Suhail: "pill styling is not right"): confirmed visually via a throwaway QA harness (no auth
  code, same approach as always) with a real uploaded clip and both a short and a longer caption.
  Two separate rendering paths both drew what's supposed to be a "pill" as a shape that didn't read as
  one at all:
  - `drawAnimatedWordBox` (the per-word animated boxes used by all 5 caption styles — ES Word Pop,
    Karaoke Box Sweep, Broadcast Step, Punch Box, Snap Stack, since they all share this one function):
    hardcoded a 6px corner radius regardless of box size. At the actual rendered box height (~120px),
    6px is imperceptible — each word rendered as a near-rectangle, and consecutive words looked like
    disconnected bricks in a row rather than a cohesive pill/capsule shape.
  - `drawCaptionPills` (the fallback path for captions with no word-level timing): used a plain
    `ctx.fillRect` with **zero** rounding — not a pill at all. In practice this path is close to
    unreachable today (word timings get synthesized for any non-empty caption text in
    `getCaptionWordBoxes`), but fixed it anyway since it's clearly the same bug in spirit.
- Fix: both now use `roundRect(..., height / 2)` — a true capsule/pill shape. Also hardened the shared
  `roundRect` helper itself to clamp `radius` to `min(radius, width/2, height/2)`, since a naive
  `height/2` radius on a *narrow* box (single short word like "A" or "IS", width can clamp down to
  54px while height is ~120px) would make the capsule ends overlap into a lens/eye shape without that
  clamp — verified this specifically by testing a caption with several short words side by side.
- Verified visually: captured actual canvas pixels (not just code review) at multiple points during
  playback, before and after the fix, for both a short one-word caption and a longer multi-word one
  that wraps to two lines. Confirmed all words — including narrow ones — now render as clean rounded
  pills with no lens artifacts, consistent across styles (spot-checked ES Word Pop and Karaoke Box
  Sweep; the other 3 styles share the same box-drawing function so inherit the fix identically).
- Note on process: initially suspected the caption wasn't rendering *at all* (a sparse full-canvas
  pixel scan missed the small text region) — don't trust a coarse scan for "is anything drawn," sample
  the actual expected region, or better, just look at a real crop of the canvas.

### 2026-07-29 — Reconciled with a major Reels rewrite pushed by someone else; reapplied 2 of 3 fixes
- Status: `[pending push]`
- Files touched: `reels.js` only.
- Context: had a local, unpushed commit (`c534991`, since discarded — see below) fixing three things in
  the *old* stub-based Reels: the invisible-video seek bug, the prompt's team-name matching, and MP4
  export preference. Before pushing it, `git push` was rejected — `origin/main` had moved 15 commits
  past what this session's local `main` was based on. Someone else (unclear who/what — possibly Suhail
  directly, possibly another AI session picking up the `reels-handoff.md` next-steps list) had built a
  **substantially more complete Reels** in the meantime: real speech-to-text via a new
  `netlify/functions/es-video-intelligence.js` backend (Groq Whisper / OpenAI / ES MCP, with graceful
  fallback), a proper 4-step UI ("Reels Studio": Upload → Speech Recognition → Transcript Review →
  Brand Styling), SRT export, and more — a near-total rewrite of `reels.js`/`reels.css`/`reels.html`.
- Rather than merge a stale 3-line-conflict-prone patch over a rewritten file, checked each of the 3
  fixes against the new code before touching anything:
  - **Seek bug**: still present, same pattern, just renamed (`onVideoReady` → `onVideoMetadata`). Reapplied
    the same fix (non-zero seek offset + 1.2s timeout fallback).
  - **Team-name matching**: already independently fixed there, and arguably better than mine — theirs
    (`findBrandCandidates`) splits the prompt into words and matches against `sport + team + variation`
    combined, not just the team name alone. Did **not** reapply my version — theirs is what's live.
  - **MP4 export preference**: still missing (their export was WebM-only, but had gained something mine
    didn't have — merging the original video's audio track into the canvas capture via
    `createCaptionedExportStream`). Reapplied MP4-preference **on top of** their audio-merging logic,
    not by reverting to my simpler export.
- Reconciliation method: `git reset --hard origin/main` (safe — the discarded local commit is fully
  described here and in the prior entries, and is recoverable via reflog if ever needed; nothing
  uncommitted was lost since it was already committed before the reset).
- Re-verified both reapplied fixes against the **actual current** `reels.html`/`reels.js` structure
  (element IDs changed — `mapElements()` now maps a different set) using a fresh throwaway QA harness,
  same no-auth-code approach as before: real video renders after upload (seek fix confirmed), and
  export produces a genuine 15KB `video/mp4;codecs=avc1,mp4a.40.2` blob downloaded as
  `es-captioned-reel.mp4` (MP4 preference confirmed). Did not attempt to test the real transcription
  backend itself (would require hitting their live Vercel deployment / real API keys, out of scope for
  verifying these two specific fixes).
- **Takeaway for whoever reads this next**: check `git fetch && git log origin/main` before assuming
  local `main` is current — this repo is apparently being worked on by more than one
  session/person right now, and the "always give a local preview before pushing" rule doesn't cover
  "check if origin moved," which is a real gap this incident exposed.

### 2026-07-28 — Reels: fix invisible video on upload, add loading feedback
- Status: `[pending push]`
- Files touched: `reels.js`, `reels.css`.
- Bug (reported by Suhail: "I can't see it even if it's getting uploaded"): `drawFrame()` ran on the
  video's `loadedmetadata` event, which only guarantees known dimensions — not an actually decoded
  frame. `drawImage` on a video with no decoded frame yet paints nothing, so the canvas just showed its
  `#05070d` background fill with the placeholder text already hidden — i.e. nothing visibly wrong, just
  nothing there. There was also no feedback at all between choosing a file and (maybe) seeing it.
- Fix: after `loadedmetadata`, force `video.currentTime = 0` and wait for the `seeked` event (which
  browsers only fire once a real frame at that time is decoded) before revealing the canvas and drawing.
  Added a spinner + "Loading clip…" state in the stage from the moment a file is chosen until that first
  real frame lands, an error state if the file fails to load (bad format/codec), and the upload button
  now reads "Change Clip" once something's loaded (previously gave no indication a clip was active).
- Still unverified in-browser (same login-gate limitation as every prior Reels entry).

### 2026-07-28 — Reels UX rework: auto-generate + timeline, contextual prompt (not a tab)
- Status: `[pushed - 6f2c831, combined with the MVP entry below into one commit]`
- Files touched: `reels.html`, `reels.js`, `reels.css` (all uncommitted, layered on top of the entry
  right below this one — no separate commit boundary between them yet).
- Suhail corrected the first pass after linking [Riverside 2.0](https://riverside.com/blog/riverside-2-0)
  as a reference product. Changes made:
  - Removed the manual "add caption" form (text box + Sport/Team/color-swatch picker). Replaced with
    a single **Auto-Generate Captions** button. Since there's no real transcription backend yet (open
    question in the plan), generation is currently a **stub**: it chunks the clip into ~2.6s segments
    with placeholder text ("Caption 1 — tap to edit", etc.) at a neutral default color. This is
    explicitly not real speech-to-text — swapping in a real provider is the very next step once that's
    decided.
  - Added an Instagram-style **caption timeline**: segments laid out proportionally along the clip's
    duration, click to select, drag either edge (pointer events, no library) to retime. Selecting a
    segment reveals a detail card with the caption's **text and start/end time still manually
    editable** — that part intentionally stayed manual, matching how Instagram's own Reel editor works.
  - Removed the standalone "Prompt" tab entirely (was the 3rd tab). There are now only two tabs
    (Captions, Lower Thirds). A **contextual "restyle with a prompt" box** appears only once something
    exists to restyle: under a selected caption's detail card, or under a lower third once one's been
    placed/selected. It's now the *only* way to change color/position — the old manual Sport/Team/color
    dropdown and manual x/y position controls were removed in favor of prompt-only restyling (per
    Suhail: "edit those without manual intervention").
  - The prompt logic itself (team-name match via `brand-kit.js` for recolor, keyword match for lower-
    third position) is unchanged from the first pass — still a local heuristic, not Claude/MCP-backed.
- Re-verified after the rewrite: bracket balance in `reels.js`, and a full `getElementById` ↔ HTML `id`
  cross-check — no mismatches. Still unverified in an actual browser (same login-gate limitation as
  before; did not attempt to bypass it).
- Plan doc (`reels-workspace-plan.md`) updated with a note on this UX correction and the Riverside
  research, so the "why" isn't lost if someone reads the plan without this log entry.

### 2026-07-28 — Reels workspace MVP (new, uncommitted)
- Status: `[pushed - 6f2c831]`
- Files touched (all new, nothing existing removed): `reels.html`, `reels.css`, `reels.js`,
  `brand-kit.js` (new). Small edits to existing `index.html` (4th `frame-card` for Reels, nav
  dropdown entry, "3 design workspaces" → "4") and `how-it-works.html` (nav dropdown entry).
- Followed the plan in [reels-workspace-plan.md](reels-workspace-plan.md), decisions confirmed by
  Suhail: client-side render/export (canvas + MediaRecorder, no new backend infra) and placement as a
  4th workspace card.
- Built as its **own top-level page** (`reels.html`), not a route inside `index.html`'s shared
  canvas-editor SPA — that shared app (`.app[data-workspace]`, one canvas/state model across
  Instagram/YouTube/Newsletter) is a ~15k-line single file and a video timeline is a different enough
  UI paradigm that bolting it on risked destabilizing the existing workspaces. Matches how
  `how-it-works.html`/`dashboard.html`/`design-request.html` already sit outside that SPA.
- `brand-kit.js`: extracted the exact `BRAND_KIT` source verbatim out of `index.html` (163 teams across
  8 sports/leagues + 4 tennis-surface variations) into a standalone shared file so Reels' team-color
  picker reads the same real data instead of a duplicate/placeholder set. `index.html` was **not**
  changed to consume this file — it keeps its own inline copy for now, so this is a live duplication.
  Follow-up noted in the plan doc: point `index.html` at the same shared file so there's one source of
  truth, once this is confirmed stable.
- MVP scope implemented: single clip upload, playhead-based caption add/edit/delete with Sport → Team
  → color-swatch picker (reusing the real brand palette), 6 lower-third templates (Name & Title, Score
  Bug, Quote Strip, Team Matchup, Location Tag, Social Handle) placed at the current playhead and
  listed/deletable, and a prompt box that edits the **selected** caption/lower-third.
- Prompt box is explicitly a stub, not real AI: local heuristic only — regex-matches a team name
  against `brand-kit.js` for recolor, and keyword-matches top/bottom/left/right/center for
  repositioning. Every apply logs what it did (or didn't) understand. Real Claude/MCP-backed
  understanding is the next step (see plan doc §3) — needs a Netlify/Vercel function decision and API
  key, not done here.
- Export: `canvas.captureStream(30)` + `MediaRecorder` records a real-time play-through of the
  composited canvas (video + active captions/lower-thirds), downloads as `.webm` on stop/end. Not yet
  validated on a real clip — MediaRecorder browser support/quality on longer footage is a real risk
  flagged in the plan and still unverified.
- Auto-transcription is **not implemented** — captions are manually typed at the current playhead.
  Needs a provider decision (plan §7, open question 2) before wiring that up.
- Verification note: same login-gate limitation as `how-it-works.html` — couldn't get past
  Supabase auth locally (no Node/`netlify dev`), and per earlier guidance did **not** attempt to bypass
  the auth gate again, even for this brand-new unpushed page. Verified what's possible without a
  browser: bracket-balance check on `reels.js`, and a full cross-check that every `getElementById` in
  `reels.js` matches an id that actually exists in `reels.html` (no mismatches found). Everything else
  (does it actually record video, does the canvas render correctly, does the swatch/prompt UI work) is
  unverified until Suhail logs in and tries it.

### 2026-07-28 — fresh clone + baseline
- Status: `[no edits yet]`
- Cloned fresh from `https://github.com/essentiallysports-tech/essentiallysports-design-tools.git`
  into `/Users/suhailquraishi/Downloads/AI Meet/essentiallysports-design-tools`.
- Baseline commit: `f744cf8` — "Rotate the hero headline word, drop the hero image".
- Confirmed local preview works at http://localhost:8935 (login page shows current "Frameup" branding).
- **Rollback point: `f744cf8`** — this is "the version before" for the first push we make.

### 2026-07-28 — How It Works hero art + newsletter ticker + first-login redirect
- Status: `[pushed - 506e2cd]`
- Files touched: `how-it-works.html`, `how-it-works.css`, `login.html`,
  `assets/how-it-works/how-hero-bg.jpg` (new), `assets/how-it-works/logos/*.svg` (new, 10 files).
- Hero (`.how-hero--art`): added the "hands reaching" dot-matrix background image supplied by Suhail,
  compressed via `sips` (4.7MB → ~750KB), with a dark scrim gradient fading to `#05070d` so it hands off
  seamlessly into the strip below. Fixed a specificity bug where `.how-hero h1 { color: var(--how-ink) }`
  (defined later in the file) was overriding the new white-text rule — resolved with `!important`.
- Hero kicker copy: "FrameUp Workflow" → "Welcome to FrameUp".
- New `.how-brand-strip` section: an infinite-scroll marquee (pure CSS `@keyframes`, respects
  `prefers-reduced-motion`) directly below the hero, same `#05070d` tone. Carries the ES mark
  (`brand-logo-blue.svg` — blue box/white text, matches the nav) plus 10 real newsletter logos supplied
  by Suhail: Essentially CFB, Essentially Golf, Essentially Dunk, Essentially W (formerly "She Got Game" —
  renamed), Break Point, The Huddle, Steelers/Cowboys/Chiefs Huddle, Lucky Dog on Track. Logos keep their
  native corners (no border-radius), all normalized to the same height via `clamp()` so mixed aspect
  ratios don't stick up/down. Strip is full-bleed at any resolution via the `left:50%; width:100vw;
  margin-left:-50vw` break-out pattern, sizing scales with `clamp()` instead of fixed breakpoints.
- `frameup-intro__credit` byline: 3px gap added between the two lines; "Suhail Quraishi" → "- Suhail Quraishi".
- First-login routing: `login.html`'s create-account submit now sends new signups' confirmation email to
  `how-it-works.html` instead of `index.html` (`auth-callback.html` already honors `?redirect=` faithfully).
  Every login after that first confirmation already falls through to the existing default (`index.html`) —
  no extra "seen onboarding" flag was needed since the confirmation link only fires once per account.
- Hero loop effect: tried a scanline-sweep + flicker first, Suhail called it "absurd and childish" —
  replaced with a slow breathing glow (`filter: brightness/saturate` pulse, 4.8s ease-in-out, peak
  brightness 1.28/saturate 1.65) so only the existing blue dots pulse brighter, no moving overlay.
- Hero CTA: "Open a Workspace" → "Learn More", now scrolls to `#intro` (added that id to
  `.frameup-intro`) instead of linking to `index.html#frames`. Style switched from `--primary` (blue
  fill) to `--secondary` (white), with a scoped smaller/down-facing chevron (`.how-arrow--down`) — kept
  scoped so the shared `.ui-arrow-right` class used elsewhere on the site is untouched.
- Viewport fit: `.how-hero--art .how-hero-stage` has `min-height: calc(100svh - header - 64px)` so hero
  + ticker together fill exactly the first screenful at any resolution — ticker stays visible on load,
  no white from the section below shows pre-scroll. (Tried a dark-to-transparent fade at the top of
  `.frameup-intro` to soften that seam — Suhail wanted a hard clean edge instead, so that fade was
  reverted.)
- Kicker color: "Welcome to FrameUp" set to white (`.how-hero--art .how-hero-kicker`), scoped so the
  blue kicker color elsewhere is unaffected.
- `.claude/launch.json` port (8934→8935) was changed locally to avoid clashing with the sibling
  session's dev server on this machine — deliberately left **out** of this commit since it's a personal
  local-dev convenience, not a real product change.
- Verification note: this page is gated by real Supabase login, which can't run against the local
  `python3 -m http.server` preview (no Node/`netlify dev` available in this environment). Suhail verified
  visually by logging in himself and screenshotting back; every fix above was made in response to those
  screenshots, not independently confirmed by the assistant in-browser.
- **Rollback point: `506e2cd`** — current HEAD, pushed to `origin/main`. Previous rollback point was
  `f744cf8` if this whole batch needs reverting.
