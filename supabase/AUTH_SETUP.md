# ES Designer Supabase Auth Setup

The website performs an immediate client-side `@essentiallysports.com` check,
but the Supabase hook is the authoritative server-side signup rule.

## Apply the migration

Link this repository to the Supabase project:

```bash
supabase login
supabase link --project-ref xtdusejokbhtjlmijdca
supabase db push
```

The migration creates:

```text
public.hook_restrict_es_signup_domain(jsonb)
```

## Enable the Auth hook

In the Supabase dashboard:

1. Open **Authentication**.
2. Open **Hooks**.
3. Select **Before User Created**.
4. Choose **Postgres function**.
5. Select `public.hook_restrict_es_signup_domain`.
6. Enable and save the hook.

After activation, signup requests using any domain other than
`essentiallysports.com` are rejected by Supabase before a user is created.

## Configure Frameup URLs

In **Authentication -> URL Configuration**, set the Site URL to:

```text
https://frameup.essentiallysports.com
```

Add the production confirmation callback to **Redirect URLs**:

```text
https://frameup.essentiallysports.com/auth-callback.html
```

For localhost testing, also add the exact preview callback currently in use:

```text
http://127.0.0.1:8911/auth-callback.html
```

The signup flow explicitly sends users to `auth-callback.html`. That page
finishes the Supabase session, removes confirmation tokens from the address
bar, shows a clear success/error state, and takes confirmed users into
Frameup. Users never need to copy or enter an OTP.

## Add the password recovery redirect

In **Authentication -> URL Configuration -> Redirect URLs**, add:

```text
https://frameup.essentiallysports.com/reset-password.html
```

For localhost testing, also add the local preview URL currently being used,
for example:

```text
http://127.0.0.1:8890/reset-password.html
```

## Email provider settings

In **Authentication -> Providers -> Email**:

- Keep Email enabled.
- Keep **Confirm email** enabled.
- Email/password is the only required login method.
- The confirmation email template should use Supabase's confirmation link
  (`{{ .ConfirmationURL }}`), not a visible OTP/code.

## Configure production SMTP

Supabase's built-in mailer is for development only. Without custom SMTP it:

- refuses to send confirmation and password-recovery emails to addresses that
  are not members of the Supabase organization;
- is limited to approximately two messages per hour; and
- provides no production delivery guarantee.

Before opening signup to the wider EssentiallySports team, configure an SMTP
provider in **Authentication -> Emails -> SMTP Settings**. Supabase supports
providers such as Resend, AWS SES, Postmark, SendGrid, Brevo, and standard
Google Workspace SMTP credentials. Use a dedicated sender such as
`no-reply@auth.essentiallysports.com` and configure SPF, DKIM, and DMARC for
reliable delivery.

After saving SMTP credentials, verify all of these with a real ES mailbox:

1. Create an account from the production login page.
2. Receive the confirmation email.
3. Open its confirmation link exactly once.
4. Confirm that `auth-callback.html` shows success and enters Frameup.
5. Request a password reset and confirm that its link opens
   `reset-password.html`.

## Current login behavior

- Email/password authentication is enabled.
- New users must confirm their email before logging in.
- The frontend only accepts `@essentiallysports.com` addresses.
- Login supports Supabase password recovery.
- Dashboard navigation is available only to:
  - `suhail.quraishi@essentiallysports.com`
  - `manish.kalsi@essentiallysports.com`

The dashboard email restriction controls UI access. When dashboard data moves
from local browser storage to Supabase tables, those tables must also have RLS
policies enforcing the same two-admin rule.

## Dashboard people and live activity

The dashboard reads signed-up users and recent active sessions from:

```text
public.es_designer_profiles
public.es_designer_presence
```

Apply the migrations with:

```bash
supabase db push
```

The dashboard people list will remain local/fallback-only until the migration
`20260708123000_add_dashboard_profiles_presence.sql` exists in the linked
Supabase project.

Security behavior:

- Every logged-in ES user can upsert only their own profile/presence heartbeat.
- Only dashboard admins can read the shared profile/presence lists:
  - `suhail.quraishi@essentiallysports.com`
  - `manish.kalsi@essentiallysports.com`
