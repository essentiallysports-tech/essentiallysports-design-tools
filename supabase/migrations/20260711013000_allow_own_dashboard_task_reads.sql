-- Let an ES user read back tasks they created while keeping the shared task
-- board readable only by dashboard admins. This is required for Supabase
-- upserts that need to complete under RLS and lets creators verify their own
-- submissions/exports without exposing other users' tasks.

drop policy if exists "ES users can read own dashboard tasks" on public.es_designer_tasks;
create policy "ES users can read own dashboard tasks"
on public.es_designer_tasks
for select
to authenticated
using (
  public.is_es_designer_domain_user()
  and lower(coalesce(creator_email, requester_email, '')) = lower(auth.jwt() ->> 'email')
);
