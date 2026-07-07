-- Enforce the ES Designer email-domain rule inside Supabase Auth.
-- After applying this migration, enable this function under:
-- Authentication -> Hooks -> Before User Created -> Postgres function.

create or replace function public.hook_restrict_es_signup_domain(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  signup_email text;
  signup_domain text;
begin
  signup_email := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
  signup_domain := split_part(signup_email, '@', 2);

  if signup_email = '' or signup_domain <> 'essentiallysports.com' then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 403,
        'message', 'Only @essentiallysports.com email addresses can create an ES Designer account.'
      )
    );
  end if;

  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;

grant execute
  on function public.hook_restrict_es_signup_domain(jsonb)
  to supabase_auth_admin;

revoke execute
  on function public.hook_restrict_es_signup_domain(jsonb)
  from authenticated, anon, public;
