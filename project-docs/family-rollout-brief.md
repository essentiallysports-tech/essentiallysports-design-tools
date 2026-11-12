# FrameUp "one family" rollout: shared brief for every agent

Repo: C:\Users\Suhail\Downloads\essentiallysports-design-tools (static vanilla JS + CSS site).

**Goal.** Every page, component, button, arrow and field should look like one family and follow one set of rules, so FrameUp feels like a finished product. Same look, same behaviour, every page, light and dark.

## The contract

`project-docs/frameup-design-system.md` is the rulebook. Read it fully first, and apply it exactly. When a value isn't covered, pick the nearest rule; never invent new sizes, radii, shadows or colours.

## Evidence

Four read-only audits listed every inconsistency, with file:line references. Read the parts relevant to your files. Line numbers may have drifted slightly, so re-find by class name.

| Audit | File |
|---|---|
| Buttons, links, arrows | C:\Users\Suhail\AppData\Local\Temp\claude\c2febdd1cad11c2d\82d9cfa6-f7e7-462a-9dcf-262b951fdb1a\scratchpad\audit-buttons.md |
| Form controls | C:\Users\Suhail\AppData\Local\Temp\claude\c2febdd1cad11c2d\82d9cfa6-f7e7-462a-9dcf-262b951fdb1a\scratchpad\audit-forms.md |
| Surfaces, dialogs, badges, type | C:\Users\Suhail\AppData\Local\Temp\claude\c2febdd1cad11c2d\82d9cfa6-f7e7-462a-9dcf-262b951fdb1a\scratchpad\audit-surfaces.md |
| Navigation, icons, layout, motion, focus | C:\Users\Suhail\AppData\Local\Temp\claude\c2febdd1cad11c2d\82d9cfa6-f7e7-462a-9dcf-262b951fdb1a\scratchpad\audit-nav-motion.md |

These are JSONL agent transcripts. The final report is the last assistant message in each file. Search for the heading text (e.g. "Proposed canonical set", "Canonical rules") to jump to it.

## How the CSS cascade works here

Know this before editing.

- **design-tokens.css** loads on every page. Its global rules decide a lot:
  - the focus ring (`!important`)
  - Lucide icon sizes 18/16 (`!important`; per-component icon sizes without `!important` are dead code)
  - a "Clean & outlined" block, partly scoped to `html:not([data-theme="dark"])`. That scoping is why geometry differs between light and dark mode. Geometry must be theme-independent; only colours change in dark mode.
- **es-ui.css**: shared components (`.es-btn`, `.es-chip`, `.es-card`, shell, sidebar). It is not loaded on login, reset-password, auth-callback, 404 or ai-page. Those pages must match the rulebook through their own CSS.
- **cta-hover.css**: currently forces stroke-only blue hovers and cancels shadows/transforms on about 26 legacy classes. This contradicts the rulebook (primary hover = darker fill; secondary hover = sunk + ink-3 ring).
- **Dark mode**: per-component overrides in design-tokens.css ("Dark mode audit (2026-11-12)" section) and theme.css. Keep dark mode free of light leaks.

## Approach

Prefer making existing classes match the rulebook values, or adding the canonical class alongside the old one. Don't rename classes that JS depends on; grep the JS before removing any class. Delete dead rules you find in your own files. Smallest diff that gets each component to the rulebook.

## Hard rules

1. **Never change rendered design output.** That means canvas templates, the template render code, exported image HTML, widget HTML outputs, and infographic drawing (`infographic-templates.js`, `drawInfographic`, template render functions). Only the UI around them (chrome, panels, controls, pages) changes.
2. **Only edit files you own.** If a fix needs another agent's file, describe it in your report instead.
3. **Other agents edit other files at the same time.** A separate Generate agent may make small, marked edits:
   - in `index.html`, only the code that loads a generated design into the editor
   - in `trend-design.html`, only the "Design this" hand-off

   Always re-read a file right before editing it. Never revert changes you didn't make.
4. **Don't touch `?v=` cache-busting strings.** The coordinator bumps them all at the end.
5. **Preserve line endings.** Some files are CRLF. Use exact edits. If you script edits with node, normalise CRLF and restore it, and avoid `$&` / `$1` in replacement strings (use function replacements).
6. **Don't use the browser.** Visual QA runs centrally afterwards. Verify by reading the code and running the checks: `npm test` (or the relevant `npm run check:*` / `test:*`).
   - Two checks already fail and aren't yours: `scripts/test-reels-transcription-framework.mjs`, and the dashboard "cache key is stale" assertion.
   - If a check asserts an old value the rulebook deliberately changes, update that assertion minimally and list it in your report.
7. **No commits, pushes, deploys or database changes.** Never handle secrets.

## Report back (≤ 300 words)

- What you changed, per component family
- Checks run and their results
- Anything you couldn't do, or that needs another file's owner
- Anything that might look visibly different and deserves a visual check
