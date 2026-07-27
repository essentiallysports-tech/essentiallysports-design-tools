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

### 2026-07-28 — fresh clone + baseline
- Status: `[no edits yet]`
- Cloned fresh from `https://github.com/essentiallysports-tech/essentiallysports-design-tools.git`
  into `/Users/suhailquraishi/Downloads/AI Meet/essentiallysports-design-tools`.
- Baseline commit: `f744cf8` — "Rotate the hero headline word, drop the hero image".
- Confirmed local preview works at http://localhost:8935 (login page shows current "Frameup" branding).
- **Rollback point: `f744cf8`** — this is "the version before" for the first push we make.

### 2026-07-28 — How It Works hero art + newsletter ticker + first-login redirect
- Status: `[pending push]`
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
- Not yet done: the scanline-sweep loop effect discussed for the hero background — proposed, not
  implemented pending a go-ahead.
- Verification note: this page is gated by real Supabase login, which can't run against the local
  `python3 -m http.server` preview (no Node/`netlify dev` available in this environment). Suhail is
  verifying visually by logging in himself and screenshotting back; every fix above was made in response
  to those screenshots, not independently confirmed by the assistant in-browser.
