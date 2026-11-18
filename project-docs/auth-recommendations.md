# FrameUp sign-in: recommendations

Written 2026-11-20 on branch `feature/auth-roles`. Supabase project `xtdusejokbhtjlmijdca`. Nothing here has been changed in Supabase: every step below is for the owner to do in the dashboard.

## Where we are

- Email + password, email confirmation on, Before User Created hook restricting sign-up to approved emails.
- Public settings (`/auth/v1/settings`, checked read-only on 2026-11-18): email provider on, `mailer_autoconfirm: false`, every external provider off (no Google), SAML off, passkeys off.
- Emails go through Supabase's **built-in sender** (custom SMTP off). It is meant for testing: a few emails per hour for the whole project, sent from `noreply@mail.app.supabase.io`. Company mail filters may quarantine it. In October 2 of 5 sign-ups never confirmed.

What shipped on this branch to soften that (no settings changed): repeated sign-up detection, resend cooldowns with honest limit messages, spam and quarantine help naming the sender, magic-link sign-in for existing accounts, "send a new link" on expired-link pages, and an admin-only **Confirm email** on Dashboard → People (migration `20261120120000_people_roles_admin.sql`).

## 1. Custom SMTP (do this first)

Custom SMTP removes the built-in sender's hourly cap (Supabase then defaults to 30 emails per hour, adjustable), sends from an ES address that company filters trust, and lets us brand the emails.

### Option A: Resend (simplest)

1. Create a Resend account with the design team's shared mailbox. Add the domain `mail.essentiallysports.com` (a subdomain keeps it apart from staff mail).
2. Add the DNS records Resend shows (SPF `TXT`, DKIM `CNAME`s, optional DMARC) at the DNS host. Wait until Resend marks the domain Verified.
3. Create an API key with **Sending access** only, limited to that domain.
4. Supabase dashboard → **Authentication → Emails → SMTP Settings** → Enable custom SMTP:
   - Sender email: `frameup@mail.essentiallysports.com`
   - Sender name: `FrameUp`
   - Host: `smtp.resend.com` · Port: `465` · Username: `resend` · Password: the API key
   - Minimum interval between emails: keep `60` seconds (the page's cooldowns assume 60).
5. **Authentication → Rate Limits** → "Rate limit for sending emails": set to around `30` per hour (raise later if needed).
6. Send yourself a password reset from the login page and check the headers show `mail.essentiallysports.com` with SPF/DKIM pass.

Cost: Resend's free tier (3,000 emails/month, 100/day) is far above FrameUp's volume.

### Option B: Google Workspace SMTP relay

1. Google Admin → **Apps → Google Workspace → Gmail → Routing → SMTP relay service** → Add: allowed senders "Only addresses in my domains", authentication "Require SMTP Authentication", "Require TLS encryption".
2. Create (or reuse) a mailbox such as `frameup@essentiallysports.com` and an **App password** for it (needs 2-Step Verification on that account).
3. Supabase → **Authentication → Emails → SMTP Settings**: Host `smtp-relay.gmail.com`, Port `587`, Username the mailbox, Password the app password, Sender `frameup@essentiallysports.com`, Sender name `FrameUp`.
4. Same rate-limit step as above. Google's relay limits (10,000 recipients a day) are not a concern.

Pick B if IT prefers no third party; A if DNS changes are easier than Admin console access.

## 2. Email templates

**Authentication → Emails → Templates**. Use the same short structure for each: FrameUp logo (hosted image from frameup.essentiallysports.com), one sentence, one button, a plain link underneath, and "If you didn't ask for this, ignore this email."

- **Confirm signup**: subject "Confirm your FrameUp account". Button "Confirm email" → `{{ .ConfirmationURL }}`.
- **Magic Link**: subject "Your FrameUp sign-in link". Mention it works once, in the same browser.
- **Reset Password**: subject "Reset your FrameUp password".
- **Invite user**: subject "You're invited to FrameUp". The link lands on `auth-callback.html`, which now sends invites on to set a password.
- **Change Email Address**: subject "Confirm your new FrameUp email".

Keep `{{ .ConfirmationURL }}` (not a hand-built URL) so the redirect allowlist and link type keep working.

## 3. Rate limits and URLs

- **Authentication → Rate Limits**: emails ~30/hour after custom SMTP; token refreshes and sign-ins can stay at defaults.
- **Authentication → URL Configuration**: Site URL `https://frameup.essentiallysports.com`; Redirect URLs should list exactly `https://frameup.essentiallysports.com/auth-callback.html`, `https://frameup.essentiallysports.com/reset-password.html` (plus the Vercel preview host if previews need sign-in). No wildcards on other hosts.
- **Email OTP expiration**: 1 hour (default) is fine; the expired-link pages now offer a new link in place.

## 4. Admin manual confirm (shipped, needs the migration)

Run `supabase/migrations/20261120120000_people_roles_admin.sql`. Dashboard → People then shows **Pending confirmation** for accounts that never confirmed, with **Confirm email**. It is a `security definer` RPC that only admins can call, only for approved emails and unconfirmed accounts, and it is written to the audit trail. The dialog tells admins to confirm only after the person has told them directly (Slack or in person) that they made the account, because confirming lets whoever chose that password log in.

## 5. Login loop: what to watch

`/api/auth-bounce` logs every trip back to the login page with a reason and a few facts (`[auth-bounce]` lines in the Vercel function logs). Set `SUPABASE_SERVICE_ROLE_KEY` on the Enterprise Vercel project to also see them on Dashboard → Errors. Once people get in, their earlier bounces are sent to `/api/client-errors` too.

## 6. SSO later

- **Google sign-in** is the cheapest win: everyone already has an ES Google account. Supabase → **Authentication → Providers → Google**, with an OAuth client from Google Cloud Console (Internal app on the ES Workspace, authorised redirect `https://xtdusejokbhtjlmijdca.supabase.co/auth/v1/callback`). Keep the Before User Created hook so only ES addresses get in. The login page would then show "Continue with Google" (it is not shown today because the provider is off).
- **SAML SSO** (Supabase Pro add-on) only if IT wants central deprovisioning. Google sign-in covers most of the benefit.
- Either way email+password can stay as a fallback for approved external collaborators.
