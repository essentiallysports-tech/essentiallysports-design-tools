# FrameUp: instructions for Claude

FrameUp is EssentiallySports' internal AI design tool (https://frameup.essentiallysports.com).
More than one person works on it, each with their own Claude. These rules keep everyone's
work visible and stop people overwriting each other. They apply to every session.

## Start of every session
1. Read the top of `project-docs/ai-edit-log.md` (the shared handoff log) to see what others are doing.
2. `git fetch origin` and compare with `origin/main` before assuming anything is current.
   Others push to `main` too; never trust a stale local copy.
3. `HANDOFF.md` is the background on the stack, pages and services.

## Working together (no overrides)
Everyone pushes straight to `main` (no pull requests). Git never silently overwrites work: a push from
an out-of-date copy is rejected. Work is lost only by force-pushing or by resolving a conflict badly,
so those are the rules that matter:
- **Work on a local branch** named `<your-name>/<short-topic>` (for example `vinay/video-ads-captions`),
  so half-done work never reaches `main` by accident. Commit there as you go.
- **Never push without the person you work for saying "push"** in this session. "Push" means:
  1. `git fetch origin` and rebase your branch on the latest `origin/main`;
  2. resolve conflicts keeping both sides (see below), then run the checks below;
  3. `git push origin HEAD:main`. If it is rejected because `main` moved, fetch, rebase, re-check and
     push again. **Never use `--force` / `--force-with-lease` on `main`**, never rewrite or revert
     someone else's commits without asking;
  4. confirm the live site (Vercel deploys `main` automatically) and update your edit-log entry.
- **Stay in your area.** Before editing a file, check `git log -5 --format='%an %ar %s' -- <file>` and the
  edit log. If someone else changed it in the last few days or has it "in progress", tell the person
  you work for before touching it.
- **Conflicts:** never resolve a conflict by dropping the other side's code. If a conflict is not a
  plain list (script tags, log entries, release notes), stop and ask.
- **Who did what:** commits carry your own git name and email (`git config user.name` / `user.email`
  must be the real person). Every edit-log entry starts with the person's name.

## Edit log (`project-docs/ai-edit-log.md`)
Add an entry at the top for every change: `## YYYY-MM-DD — <Name>: <what> (branch <branch>)`, then
status (`in progress` / `committed, not pushed` / `pushed in <sha>`), what changed and why, the tests run,
and anything unverified. Update the status when it ships.

## Security and data (non-negotiable)
- Never read, print, store or paste passwords, API keys or tokens. Keys live only in Vercel and in a
  git-ignored `.env.local`. If a secret is needed, the person pastes it in themselves.
- Never write to production Supabase from a script or test. Mock AI, Supabase and other paid calls in tests.
- Do not bypass security checks or permission prompts. If an action is blocked, stop and ask.
- Never change Vercel or Supabase settings, AI budget caps or design rules without the owner's approval.

## Code and design rules
- Stack: static HTML/CSS/JS; serverless functions in `netlify/functions/*.js` with thin adapters in
  `api/*.js` (each listed in `vercel.json`); Supabase for auth and data; AI through the Vercel AI
  Gateway (`netlify/functions/_ai-gateway.js`).
- Design system: `design-tokens.css`, `es-ui.css`, the UI Library (`design-system.html`) and
  `project-docs/frameup-design-system.md`. ES fonts only (Acumin, Roboto, Roboto Condensed), no purple,
  8px grid, tokens over hard-coded values, one primary button per view, visible focus, labels and aria,
  light and dark, no horizontal scroll at 1440 / 1280 / 1024 / 375.
- **Exports:** editor template exports (Social, YouTube, Newsletter in `index.html`) must stay
  byte-identical unless the change is intended and called out.
- **Cache keys:** when you change a client JS/CSS/JSON file, bump its `?v=` on every page that loads it
  (`python3 scripts/release/bump.py <key>` does this for everything changed vs `origin/main`).
- **AI cost:** cheapest model that works, cache results, log with `logUsage`, gate with `aiSpendGate`
  and the hourly/weekly limits. Budget policy is set in code: $20/week per person, $45 team cap, free mode
  above. Flag any change that raises cost per run.
- User-facing copy: plain English, short, no jargon. Never invent numbers, quotes or facts.
- User-visible changes get a release note in `tours/updates.json` (`node scripts/add-release-note.mjs`), dated the day it goes live (never ahead: What's new sorts by date).

## Checks before asking to push
- `bash scripts/release/run-suite.sh` runs every `scripts/test-*.mjs` and `scripts/check-*.mjs`
  (add words to run a subset, e.g. `run-suite.sh gen`). Only these may fail:
  test-color-swatch-states, test-newsletter-header-options, test-reels-transcription-framework.
  UI sweeps can be flaky under load: rerun a failing one alone before treating it as real.
- `node scripts/release/inline-syntax.mjs` checks inline scripts in every page.
- Add tests for what you build.
- Local preview: `.claude/launch.json` (`static-site`, port 8934). Use a free port and stop what you start.

## Releases (combining several branches)
`scripts/release/merge.sh <release-worktree> <branch>` merges a branch and auto-resolves only the safe
conflicts (script tags, the edit log, `tours/updates.json`, `vercel.json`); it stops on real code
conflicts. Then bump cache keys, run the suite, and ask before pushing.


## Mandatory UI Quality Assurance

After every task that changes the frontend UI, run a visual QA pass before marking the task complete.
Use the frontend-visual-qa skill and browser automation to inspect the actual rendered website.

### Required checks

1. Check horizontal and vertical overflow.
2. Detect clipped text, images, buttons, and containers.
3. Check spacing, padding, margins, and alignment consistency.
4. Verify typography hierarchy and text wrapping.
5. Check visual consistency of icons, buttons, cards, colors, and border radii.
6. Check responsive layouts at 375px, 768px, 1024px, and 1440px.
7. Detect overlapping elements, broken navigation, and misplaced components.
8. Check hover, focus, loading, and empty states where relevant.
9. Check accessibility basics, including contrast and touch target sizes.
10. Inspect screenshots visually rather than relying only on code analysis.

### Fix and recheck

- Automatically fix clear UI defects introduced by the current task.
- Re-render the affected pages after fixes.
- Repeat until no known critical or major layout defects remain.
- Do not redesign unrelated sections or change intended styling.
- Do not deploy or push changes without permission.

### Completion requirements

Do not declare a frontend task complete until visual QA has run successfully.
Provide a short report containing:

- Viewports tested
- Issues discovered
- Issues fixed
- Remaining issues, if any
- Screenshots or test evidence

### How to run it in this setup

- "frontend-visual-qa" is not installed as a skill here. Use the installed `design-review` skill (`/design-review`) with the built-in browser tools (`mcp__Claude_Browser__*`): open the page on the local server (http://localhost:8937 skips login; http://localhost:8934 is the normal preview), resize to 375 / 768 / 1024 / 1440, screenshot, and read the page structure.
- The browser pane may be hidden, which pauses CSS animations and transitions. Before screenshots or style checks, inject `*{animation:none!important;transition:none!important}`, or pages are measured mid-fade.
- Check light and dark mode (`FrameUpTheme.apply('dark')`).
- Keep screenshots in `.claude/shots/` (git-excluded).
