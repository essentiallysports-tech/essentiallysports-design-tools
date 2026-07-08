-- Shared ClickUp-style dashboard tasks for ES Designer.
-- Requests and exported designs both become task records that admins can
-- assign, move across kanban columns, and inspect from any browser.

create table if not exists public.es_designer_tasks (
  id text primary key,
  source_id text not null default '',
  task_type text not null default 'design_request'
    check (task_type in ('design_request', 'exported_design')),
  title text not null default '',
  status text not null default 'Backlog'
    check (status in ('Backlog', 'Assigned', 'Doing', 'Review', 'Done')),
  priority text not null default 'Normal',
  assigned_to text not null default '',
  requester_name text not null default '',
  requester_email text not null default '',
  creator_name text not null default '',
  creator_email text not null default '',
  request_type text not null default '',
  workspace text not null default '',
  workspace_variant text not null default '',
  sport text not null default '',
  team_or_league text not null default '',
  filename text not null default '',
  design_due_at timestamptz,
  publish_at timestamptz,
  brief text not null default '',
  design_copy text not null default '',
  additional_notes text not null default '',
  admin_notes text not null default '',
  reference_links text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists es_designer_tasks_status_idx
on public.es_designer_tasks(status);

create index if not exists es_designer_tasks_assigned_to_idx
on public.es_designer_tasks(assigned_to);

create index if not exists es_designer_tasks_updated_at_idx
on public.es_designer_tasks(updated_at desc);

alter table public.es_designer_tasks enable row level security;

drop policy if exists "Dashboard admins can read dashboard tasks" on public.es_designer_tasks;
create policy "Dashboard admins can read dashboard tasks"
on public.es_designer_tasks
for select
to authenticated
using (public.is_es_designer_admin());

drop policy if exists "ES users can create dashboard tasks" on public.es_designer_tasks;
create policy "ES users can create dashboard tasks"
on public.es_designer_tasks
for insert
to authenticated
with check (
  public.is_es_designer_domain_user()
  and lower(coalesce(creator_email, requester_email, '')) = lower(auth.jwt() ->> 'email')
);

drop policy if exists "Dashboard admins can update dashboard tasks" on public.es_designer_tasks;
create policy "Dashboard admins can update dashboard tasks"
on public.es_designer_tasks
for update
to authenticated
using (public.is_es_designer_admin())
with check (public.is_es_designer_admin());

grant select, insert, update on public.es_designer_tasks to authenticated;
