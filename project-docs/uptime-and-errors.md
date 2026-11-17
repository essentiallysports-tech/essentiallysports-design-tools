# Uptime, error reports and cloud drafts: setup (2026-11-18)

Three reliability pieces shipped on `feature/reliability-drafts`. Everything works, or politely stays off, before any of the steps below are done.

## 1. Apply the two migrations (Supabase SQL editor, in this order)

| File | Creates | Until it's applied |
| --- | --- | --- |
| `supabase/migrations/20261118120010_frameup_drafts.sql` | `frameup_drafts` (own rows only; admins can read), a trigger that stamps `updated_at` with the server clock, `frameup_purge_old_drafts()` | Drafts stay in each browser, as before. "Your drafts" says cloud drafts aren't switched on yet. |
| `supabase/migrations/20261118120100_frameup_client_errors.sql` | `frameup_client_errors` (insert own; admins read), `frameup_purge_old_client_errors()` | Error reports are accepted and dropped. Dashboard → Errors says reporting isn't switched on yet. |

Both are idempotent and end with an `Undo:` note.

**Retention (optional, needs `pg_cron`):** schedule the purge functions once.

```sql
select cron.schedule('frameup-purge-drafts', '17 3 * * *', 'select public.frameup_purge_old_drafts()');
select cron.schedule('frameup-purge-client-errors', '27 3 * * *', 'select public.frameup_purge_old_client_errors()');
```

Without this, the editor still ignores drafts older than 30 days. Old rows just stay in the table.

## 2. Health endpoint: `GET /api/health`

- **Auth:** none. It returns no secrets, versions or user data.
- **Response:** `200 { ok: true, checks: { supabase: { ok, ms }, aiGateway: { configured } }, checkedAt }`.
- **Supabase down:** `503` with `ok: false`, so any monitor alerts on the status code.
- `aiGateway.configured` only says whether `AI_GATEWAY_API_KEY` is set (true or false). An unset key doesn't fail the check, because FrameUp falls back to its free drafts.
- `HEAD` works too.

### Option A: free external monitor (recommended, no code)

Use UptimeRobot, Better Stack or Cronitor (free tiers):

1. Add an HTTP(S) monitor for `https://frameup.essentiallysports.com/api/health` every 5 minutes.
2. Set it to alert on any status other than 2xx. You can also add a keyword check for `"ok":true`.
3. Add the alert contact: email, or the monitor's own Slack integration pointed at `#frameup-alerts`.
4. Optional: add `https://frameup.essentiallysports.com/` and `/generate.html` as plain page monitors too (research §4.1).

### Option B: Vercel cron + Slack (no third party)

1. In the **Enterprise** Vercel project (the one serving the frameup domain), set these env vars:
   - `CRON_SECRET`: any long random string. Vercel sends it as `Authorization: Bearer …` on cron calls.
   - `SLACK_OPS_WEBHOOK_URL`: a Slack incoming-webhook URL (`https://hooks.slack.com/...`) for the alerts channel.
2. Add a cron to `vercel.json`:
   ```json
   "crons": [{ "path": "/api/health", "schedule": "*/5 * * * *" }]
   ```
   This branch doesn't add it, because the branch rules forbid changes to `vercel.json` beyond function entries. Cron frequency also depends on the Vercel plan.
3. **How alerts behave:**
   - One Slack message when Supabase becomes unreachable.
   - A repeat every hour while it stays down.
   - One message when it recovers.
   - Only a request carrying the right `CRON_SECRET` can post to Slack. Anonymous visitors to `/api/health` never can.
   - Only `https://hooks.slack.com/` URLs are ever called.
4. **Test it:**
   ```sh
   curl -H "Authorization: Bearer $CRON_SECRET" https://frameup.essentiallysports.com/api/health
   ```
   The response includes `"alerted": false` while healthy. To see an alert fire, point `SUPABASE_URL` at a bad host on a preview deployment and call it again.

## 3. Error reports: `frameup-errors.js` → `POST /api/client-errors`

### What it catches

- Uncaught errors.
- Unhandled promise rejections.
- Page scripts or stylesheets that fail to load.
- Calls to FrameUp's own `/api/*` that answer 5xx or 404 (except `/api/version`), or don't answer at all.

### Privacy

- **Sent:** the message, the stack and the page path.
- **Never sent:** form contents or request bodies.
- **Removed before sending:** emails, tokens, keys, passwords and every `?query` and `#fragment`. This happens in the browser and again on the server.
- **Sentry:** gets a short hash of the person's email, never the email.

### Noise control

- Each error is sent once per page load. Repeats are counted, not resent.
- At most 5 reports a minute and 20 per page load.
- Reports are batched, up to 5 per request.

### Server side

- **Auth:** signed-in ES users only (`401` otherwise).
- **Size:** bodies over 8 KB get `413`.
- **Rate limit:** at most 20 reports a minute per person.
- Rows are written with the person's own session.

### Sentry (optional)

Set `SENTRY_DSN` (server env only) and each report is also forwarded to Sentry, tagged with the release (commit SHA), kind and page. The DSN never reaches the browser. Leave it unset to rely on the dashboard panel alone.

### Reading the reports

Dashboard → Overview → **Errors** shows the last 7 days:

- grouped by fingerprint;
- count, people affected, pages and last seen for each group;
- click a row for the stack trace.

## 4. Cloud drafts

### How syncing works

- The editor autosave still writes to the browser first.
- About 20 s after the last change, and when the tab is hidden or closed, the same work goes to `frameup_drafts`:
  - uploaded photos are left out; web photo links travel;
  - drafts over 400 KB are skipped;
  - the blank editor is about 75 KB.
- Offline or signed out: the draft waits and syncs when the person is back.

### Opening the editor elsewhere

- **The editor here is empty:** the newer draft from the other device opens straight away.
- **There's work here too:** it asks **"A newer version is on another device"** with two choices, *Keep this one* or *Open the newer one*.
- The same question appears before a save would overwrite a newer draft from another device. Otherwise the newest save wins.

### Your drafts

- The **Recent designs** dialog (clock button) now starts with **Your drafts**, the work and exports saved to the account from other devices, plus the sync status.
- Exported designs also sync, so Recent designs follows the person.
