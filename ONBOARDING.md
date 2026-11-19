# Working on FrameUp with Claude Code

Welcome! This gets you set up to change FrameUp (https://frameup.essentiallysports.com) with your own
Claude, the same way the rest of the team does, without anyone overwriting anyone else.

## 1. One-time setup (about 15 minutes)
1. **GitHub access:** ask Suhail to add you to `essentiallysports-tech/essentiallysports-design-tools`.
2. **Clone the repo** (your own fresh copy, never someone else's folder):
   ```bash
   git clone https://github.com/essentiallysports-tech/essentiallysports-design-tools.git frameup
   cd frameup
   ```
3. **Your identity:** commits must show who you are.
   ```bash
   git config user.name "Your Name"
   git config user.email "you@essentiallysports.com"
   ```
4. **Tools:** Node 22 or newer, Python 3 and Google Chrome (the UI checks drive a headless Chrome).
   Nothing to `npm install`.
5. **Claude Code:** open Claude Code in the `frameup` folder. It reads `CLAUDE.md` automatically:
   that file holds the team rules, so your Claude follows the same process as everyone else's.
6. **FrameUp account:** sign up on the live site with your @essentiallysports.com email. You get your
   own AI budget ($20 a week).
7. **No keys needed.** You don't need Vercel or Supabase admin access or any API key to make changes:
   tests mock the paid services. Never paste a key into a chat or a file.

## 2. How a change works
1. **Say what you're taking on**, so two people don't edit the same thing (tell Suhail, and Claude adds
   it to `project-docs/ai-edit-log.md`).
2. **Ask Claude for the change.** It works on a branch named `<your-name>/<topic>`, never on `main`.
3. **Preview it locally:** Claude starts the local site (port 8934) and checks it in the browser.
4. **Run the checks:** `bash scripts/release/run-suite.sh` (Claude does this before asking to push).
5. **Say "push"** when you're happy. Claude rebases on the latest `main`, pushes your branch and opens a
   pull request. Nothing goes live until the PR is merged into `main` (Vercel deploys `main`
   automatically).

## 3. Who did what
- `git log --author="Your Name"` or GitHub's history and blame show each person's commits.
- Each pull request records what changed, why and who approved it.
- `project-docs/ai-edit-log.md` is the shared handoff log; every entry starts with a name.

## 4. Things never to do
- Push or commit straight to `main`, or force-push.
- Put passwords, API keys or tokens in chat, files or commits.
- Change Vercel or Supabase settings, AI budget caps or the design rules without Suhail's OK.
- Resolve a merge conflict by deleting someone else's code. Ask instead.

## 5. Where things are
- `HANDOFF.md`: the stack, pages and services.
- `project-docs/frameup-design-system.md` and `design-system.html` (UI Library): the design rules.
- `scripts/test-*.mjs`, `scripts/check-*.mjs`: tests and UI sweeps. `scripts/release/`: release helpers.
