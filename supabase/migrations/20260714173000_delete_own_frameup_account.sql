-- Allow an authenticated FrameUp user to permanently delete only their own
-- Supabase Auth account. The deleted ES email can sign up again later.

create or replace function public.delete_own_frameup_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_id uuid := auth.uid();
  requester_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
begin
  if requester_id is null or requester_email = '' then
    raise exception 'You must be signed in to delete your account.';
  end if;

  -- Presence is tied to the public profile. Keep shared requests, exports, and
  -- activity records intact as operational history, but remove personal
  -- account/profile state before deleting the Auth identity.
  delete from public.es_designer_presence
  where lower(email) = requester_email;

  delete from public.es_designer_profiles
  where lower(email) = requester_email;

  delete from auth.users
  where id = requester_id;

  if not found then
    raise exception 'Your FrameUp account could not be found.';
  end if;

  return true;
end;
$$;

revoke all on function public.delete_own_frameup_account() from public;
revoke all on function public.delete_own_frameup_account() from anon;
grant execute on function public.delete_own_frameup_account() to authenticated;
