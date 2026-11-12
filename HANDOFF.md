# FrameUp handoff (2026-11-12)

Read this first when you pick up FrameUp on another machine. It covers the background, what's done, what's in progress, and how to continue. **There are no secrets in this file. Keys live only in `.env.local` (git-ignored) and in Vercel.**

---

## 1. What FrameUp is

- **Repo:** `essentiallysports-tech/essentiallysports-design-tools`, branch `main`.
- **Live site:** https://frameup.essentiallysports.com, deployed automatically by Vercel on every push to `main`.
- **Stack:** a static vanilla JS/CSS site.
  - Serverless functions live in `netlify/functions/*.js`, with thin Vercel adapters in `api/*.js`. Each one is listed under `functions` in `vercel.json`.
  - Supabase handles auth, the database and storage.
  - Pages: Home and the editor (`index.html`: Social, YouTube, Newsletter), Generate, Trend Design, Gallery, Reels, Design Request, Tool Feedback, How it works, UI Library (`design-system.html`), Dashboard (admins), and the login/account pages (`ai-page/`).
- **Must-read files:**
  - `CLAUDE.md`: the mandatory visual QA rules after any UI change.
  - `project-docs/frameup-design-system.md`: the design rulebook.

### Local preview
- `.claude/local-serve.js` runs two servers: **http://localhost:8934** (normal, with login) and **http://localhost:8937** (skips login, for testing).
  - Start them with the Claude preview tools; the configurations are in `.claude/launch.json`.
  - Both servers read keys from `.env.local`.
- On a new machine, create `.env.local` yourself with these variable names (get the values from the dev team or Vercel, never from chat):
  - `AI_GATEWAY_API_KEY`
  - `GROQ_API_KEY` (optional backup)
  - `ES_MCP_CLIENT_ID`
  - `ES_MCP_REFRESH_TOKEN`
- **Tests:** `npm test`. Two checks were already failing before this work and are unrelated:
  - `scripts/test-reels-transcription-framework.mjs`
  - the dashboard "cache key is stale" check in `check-dashboard-ui`

### Working rules
- Always give a localhost preview before pushing. Push only when Suhail says **"push"**. "Roll back" means revert to the previous version.
- Run `git fetch` and check upstream before pushing. Never commit `.claude/launch.json`.
- **Local-only files, never pushed:**
  - `project-docs/aws-migration-handoff.md`
  - `DESIGN_PLAN.md`
  - `DESIGN_MEMORY.md`
  - `design-plans/`
  - `project-docs/basics-checklist.md`
  - everything under `.claude/`
- Never handle API keys or passwords; the user adds them. Confirm before any production database change.
- **Cache-busting:** when you change a CSS or JS file, bump its `?v=` on every page that loads it.
- Before screenshots in the preview pane, inject `*{animation:none!important;transition:none!important}`. A hidden pane pauses animations.

---

## 2. Live as of the last push (`da439b1`)

| Commit | What shipped |
|---|---|
| `7ced81e` | UI refresh: Lucide icons, clean editor panel, template picker, toasts |
| `c0c182b` | Site-wide clean outlined style, accessibility fixes |
| `bb28e66` | Trend Design page: live US sports trends with headline ideas |
| `aad2231` | Dark-mode audit fixes; pages sit flush with the window |
| `da439b1` | Profile stays in the sidebar; top bar removed |

---

## 3. Done locally, NOT pushed yet (needs a final check, then "push")

### AI through the Vercel AI Gateway
- **Setup:**
  - One key, `AI_GATEWAY_API_KEY`, with a **$20/week** spend cap. It's already added in Vercel and goes live with the next deploy.
  - Helper: `netlify/functions/_ai-gateway.js` → `aiText({ tier, system, messages, json, effort, maxTokens, timeoutMs, track })`.
- **Two tiers:**

  | Tier | Model | Used for |
  |---|---|---|
  | light | `openai/gpt-oss-20b` | Small, frequent jobs: Trend Design headline ideas |
  | main | `anthropic/claude-haiku-5.5` | Generate |

  Override either one with the `AI_LIGHT_MODEL` / `AI_MAIN_MODEL` environment variables.
- **Fallbacks:** Groq is the backup, then rule-based drafts. Video captions stay on Groq Whisper, because Claude can't transcribe audio.
- **Measured cost:**
  - Headline ideas: about $0.00015 per story on light, about $0.0003 on Haiku.
  - In testing, Haiku was faster and stuck to the facts better. The light model once invented a result.
  - **Decision pending:** move headlines to Haiku? It's one environment variable.
- **Spend tracking:**
  - Every AI call is logged to the Supabase table **`frameup_ai_usage`**. The migration `supabase/migrations/20261112120000_frameup_ai_usage.sql` is already applied in production and verified: anonymous reads and writes are blocked, signed-in users log their own calls, and admins read.
  - **Dashboard → "AI spend" panel** (`dashboard.html` `renderAiSpend`, `dashboard-data.js` `fetchAiUsage`): last 7 days against $20, broken down by feature, model and person. **Not yet checked visually** (it needs an admin login).

### Trend Design tweaks
- Stories without a photo show the publication's full-size logo on a white tile, or the site's initial if it has no logo.
- Solid "Design this" button and a plain title.
- The sidebar now highlights Trend Design (`app-shell.js` `PAGE_IDS`).

### Design rulebook
- `project-docs/frameup-design-system.md` was rewritten as the single "one family" rulebook:
  - 8 type roles
  - radii 8/10/12/16/pill
  - the `.es-btn` family
  - filter chips vs choices
  - fields and dropdowns
  - cards, dialogs, menus, badges
  - Lucide-only icons
  - motion tokens
  - one focus ring

---

## 3b. Generate as the hero product: DONE locally (not pushed)

- **Speed:** a full run takes about 7–8s instead of 21s.
  - Research now uses ES tags for the people and teams in the brief, then reads the newest tagged stories. It takes about 2s and is cached for 10 minutes.
  - The old full-text search is the fallback.
- **Waiting screen:** three progress steps with a seconds counter, an empty state, and errors that keep the brief.
- **Photos:** each card's photo button shows ES photos, and Claude (main tier) picks the best one while the copy is being written.
- **Scene image:**
  - One click makes one AI background, places only, with no people, logos or text.
  - Model `bfl/flux-3-image-klein`, about $0.011 per image, logged with `images: 1`, soft limit of 12 per user per hour.
  - Files: `netlify/functions/es-generate-image.js`, `api/es-generate-image.js`, one line in `vercel.json`.
  - Optional environment variables: `AI_IMAGE_MODEL`, `GENERATE_IMAGES=off`, `GENERATE_IMAGE_HOURLY_LIMIT`.
- **Trend Design "Design this":** generation starts automatically on arrival.
- **Recent briefs:** the last 3 show as chips.
- **Retry:** asks for a fresh take instead of repeating the same lines.
- **Copy rules:** stronger prompts; a Trend Design headline goes on the Cover word for word.
- **Budget:** when the weekly cap runs out, Groq writes the copy and the page explains it calmly.
- **Code and tests:**
  - `_ai-gateway.js` gained `aiImage` and `isBudgetError`.
  - New test `scripts/test-es-generate-fast.mjs`; `test:generate` is now part of `npm test`.
- **Visual QA:** done at 375 / 768 / 1024 / 1440, light and dark. Screenshots are in `.claude/shots/generate-*.jpg`.
- **Cost per run:** about $0.002.
- **Local:** `.claude/local-serve.js` has no-login routes for Generate, and `.claude/launch.json` has a `static-node-generate` server on port 8941.
- **Known gaps:**
  - The first card's "why" line is AI meta-commentary.
  - The ES MCP photo path wasn't tested live, because MCP isn't set up in `.env.local`.
- **Next ideas, ranked:**
  1. Stream each design to the page as soon as it's ready.
  2. "Download all", plus captions and alt text for each post.
  3. Wikipedia photo when ES has none.
  4. Groq for retries, to save Gateway spend.
  5. Learn from which designs get exported.

## 4. In progress when this was written (background agents)

Five agents were running in parallel, each on its own files. If they didn't finish, the work is partly applied in the working tree. **Check `git diff` per file, then finish or revert.**

| Workstream | Files | Goal |
|---|---|---|
| ~~Generate~~ (DONE, see 3b) | `generate.html`, `netlify/functions/es-generate.js`, `_generate-examples.js`, `_ai-gateway.js`, new `netlify/functions/es-generate-image.js` + `api/es-generate-image.js` + `vercel.json` line, `scripts/test-es-generate*.mjs` | Fastest path from an idea to a finished post: better ES-voice copy, faster or progressive results, photo suggestions for real people (Claude picks), an optional "Generate a scene image" button (scenes only, never real players or logos, cheapest image model), one-click open in the editor, Trend → Generate handoff. Budget-aware, with every call tracked |
| **Core family styles** | `design-tokens.css`, `es-ui.css`, `cta-hover.css`, `theme.css`, `site-chrome.*`, `site-mobile-chrome.*`, `app-shell.js` | Tokens: control height 40, `--es-shadow-lift`, `--es-focus-color`. Same geometry in light and dark. `.es-btn` family incl. `--link`. `.es-icon-btn --sm/--plain/--overlay`. Filter chips, segmented control, badges, cards, dialogs (one close style, backdrop .42, radius 16), dropdown menus, toasts, focus cleanup, Lucide chevrons |
| **Editor + Home** | `index.html` (UI chrome only), `editor-polish.css`, `studio-inspector.css`, `frameup-templates.js`, `frameup-extras.js` | Every editor/Home button, arrow, field, chip, swatch, switch and menu matches the rulebook. **Template rendering must not change** |
| **Content pages** | Trend Design, Gallery, How it works, Design Request, Tool Feedback, Reels, UI Library | The same, page by page |
| **Admin/Auth** | Dashboard (`dashboard*.css/html`), login, reset-password, auth-callback, 404, `ai-page/` | The same. Dashboard keeps its 14px minimum font size |

**Shared brief and evidence for these agents:**
- The brief is copied into the repo at `project-docs/family-rollout-brief.md`. In short: follow the rulebook, never change rendered design output, only edit your own files, don't touch `?v=`, preserve CRLF, keep `npm test` green.
- The four audit reports listing every inconsistency by file and line were also in the temp folder. Their conclusions are now in the rulebook.

---

## 5. Still to do (in order)

1. **Finish the agents' work** above, where it's incomplete.
2. **Bump the `?v=` cache keys** on every page for each changed CSS/JS file.
3. **Run `npm test`** and fix new failures. Ignore the two known ones.
4. **Full visual QA, per CLAUDE.md:**
   - every page at 375 / 768 / 1024 / 1440, light and dark (`FrameUpTheme.apply('dark')`)
   - every editor tab and overlay
   - overflow, clipping, focus and hover states, contrast
   - screenshots to `.claude/shots/`
   - check that exported designs and templates look identical to before
5. **Check the Dashboard "AI spend" panel** with an admin login.
6. **Localhost preview** to Suhail, then **"push"**.
7. **After the push:**
   - Check the live site: Trend Design headline ideas should work (AI on), and Generate should use Haiku.
   - Check the spend panel fills up.

### Backlog (deferred)
- **Gallery for YouTube/Newsletter:** migration `supabase/migrations/20261111120000_frameup_gallery_all_workspaces.sql` exists but isn't applied. It needs Suhail's OK.
- **Email updates:** needs SMTP / a Resend account and DNS records, which Suhail must set up.
- Larger sample photos, and Beehiiv image links.
- **Preview-image database cleanup:** do it in small batches.
- **Licensed photo API** (Getty/Imago/AP): ask whether ES has access.
- **Generate next ideas:** see the Generate agent's report if it finished. Otherwise, after the first version ships: Claude photo picking, scene images, and remembering recent briefs.
