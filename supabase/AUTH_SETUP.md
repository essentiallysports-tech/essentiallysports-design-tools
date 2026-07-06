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
