# Design Requests: Slack setup (owner steps)

FrameUp posts design requests to Slack and, with a Slack app, replies in each request's thread when its status, assignee, due date or priority changes, when a design is attached, and when someone comments. People can also file requests with `/frameup`.

Everything is **off until the env vars below are set**. Nothing in the code holds a secret.

## Modes

| Mode | Env vars | What you get |
| --- | --- | --- |
| Off | none | Requests still land in FrameUp (Dashboard, My requests). No Slack. |
| Webhook (today) | `SLACK_DESIGN_REQUEST_WEBHOOK_URL` | New requests post to the channel. Updates post as separate messages that name the request (webhooks can't thread). No comments in Slack. |
| Bot (recommended) | `SLACK_BOT_TOKEN` + `SLACK_DESIGN_REQUEST_CHANNEL` | New requests post as the FrameUp app. Every update and comment replies **in that request's thread**. Bot wins when both are set. |
| Slash command | `SLACK_SIGNING_SECRET` (+ bot vars + `SUPABASE_SERVICE_ROLE_KEY` to file directly) | `/frameup request …`, `/frameup status DR-…`, `/frameup help`. |

Optional: `SLACK_THREAD_COMMENTS=0` stops comments going to the thread. `FRAMEUP_APP_URL` (default `https://frameup.essentiallysports.com`) sets the "Track in FrameUp" links.

## 1. Apply the database update first

Run `supabase/migrations/20261118120030_request_workflow.sql` in the Supabase SQL editor (project xtdusejokbhtjlmijdca). It is idempotent; its header has the Undo steps. Then add designers on **My requests → Designers** (admins are designers already).

## 2. Create the Slack app (a Slack workspace admin may need to approve)

1. Go to <https://api.slack.com/apps> → **Create New App** → **From scratch**. Name: `FrameUp`. Workspace: EssentiallySports.
2. **OAuth & Permissions → Bot Token Scopes**, add:
   - `chat:write` (post requests and thread replies)
   - `users:read` and `users:read.email` (slash command: find the person's ES email)
   - `commands` (slash command)
3. **Install to Workspace**. Copy the **Bot User OAuth Token** (`xoxb-…`).
4. In Slack, open the design-requests channel → channel name → **Integrations → Add apps → FrameUp**. Copy the **Channel ID** (bottom of the channel's About tab, starts with `C`).
5. **Basic Information → App Credentials**: copy the **Signing Secret**.
6. **Slash Commands → Create New Command**:
   - Command: `/frameup`
   - Request URL: `https://frameup.essentiallysports.com/api/slack-command`
   - Short description: `File or check a FrameUp design request`
   - Usage hint: `request <what you need> [priority:urgent] [due:2026-11-20]`
   - Reinstall the app if Slack asks.

## 3. Set the env vars on Vercel

On the **Enterprise** Vercel project that serves frameup.essentiallysports.com (Settings → Environment Variables, Production):

| Name | Value |
| --- | --- |
| `SLACK_BOT_TOKEN` | the `xoxb-…` token |
| `SLACK_DESIGN_REQUEST_CHANNEL` | the channel ID (`C…`) |
| `SLACK_SIGNING_SECRET` | the signing secret |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key. Only needed for filing straight from `/frameup`; without it the command replies with a pre-filled form link instead. Server-side only. |

Keep `SLACK_DESIGN_REQUEST_WEBHOOK_URL` as a fallback or remove it. Redeploy.

## 4. Check it

1. Submit a test request in FrameUp. It appears in the channel with a "Track in FrameUp" link, and the success screen links to My requests.
2. On My requests, assign it and move it to In progress. A reply appears **in the thread**.
3. Comment on it. The comment appears in the thread.
4. In Slack, run `/frameup help`, then `/frameup status <the ID>`.
5. Requests filed before the bot was set up have no thread: their first update starts one, and later updates reply there.

## Security notes

- `/api/slack-command` refuses everything when `SLACK_SIGNING_SECRET` is missing, and rejects any request whose signature or timestamp (5-minute window) doesn't verify.
- Slash-command filing only works for Slack accounts whose email ends in `@essentiallysports.com`.
- Status changes, comments and attachments run as the signed-in person through database functions that enforce the rules (requesters: own requests, comment, withdraw before work starts; designers: claim, move their own, attach; admins: everything). Slack text is built from the database's own history rows, never from what a browser sends.
