-- Design Request workflow (branch feature/requests-slack, 2026-11-18).
--
-- Turns design requests (es_designer_tasks rows with task_type 'design_request')
-- into a tracked workflow:
--   * a Declined status next to Backlog / Assigned / Doing / Review / Done;
--   * a designer list (frameup_request_designers) managed by admins;
--   * designers read every design request; requesters keep reading their own;
--   * a history + comment thread (frameup_request_events), filled by a trigger
--     on every status / assignee / due / priority change, whoever made it;
--   * delivered designs attached to a request (frameup_request_deliveries);
--   * RPCs that enforce who may do what (mirrors request-lifecycle.js);
--   * the Slack thread id kept in es_designer_tasks.metadata
--     (slackChannel / slackThreadTs) so status updates reply in-thread.
--
-- Idempotent: safe to run more than once. Nothing here deletes data.
-- The app keeps working before this runs (read-only status, no comments).
--
-- Undo (run in this order):
--   drop function if exists public.frameup_my_open_request_count();
--   drop function if exists public.frameup_request_claim_notifications(text);
--   drop function if exists public.frameup_request_set_slack_thread(text, text, text);
--   drop function if exists public.frameup_request_detach(uuid);
--   drop function if exists public.frameup_request_attach(text, text, text, text);
--   drop function if exists public.frameup_request_comment(text, text);
--   drop function if exists public.frameup_request_update(text, text, text, timestamptz, boolean, text, text);
--   drop trigger if exists frameup_request_log_changes on public.es_designer_tasks;
--   drop trigger if exists frameup_request_status_stamp on public.es_designer_tasks;
--   drop function if exists public.frameup_request_log_changes();
--   drop function if exists public.frameup_request_status_stamp();
--   drop table if exists public.frameup_request_deliveries;
--   drop table if exists public.frameup_request_events;
--   alter policy "Dashboard admins can read dashboard tasks" on public.es_designer_tasks
--     using (is_es_designer_admin() or (is_es_designer_domain_user()
--       and lower(coalesce(creator_email, requester_email, ''::text)) = lower(((select auth.jwt()) ->> 'email'::text))));
--   drop function if exists public.frameup_can_view_request(text);
--   drop function if exists public.is_frameup_request_designer();
--   drop table if exists public.frameup_request_designers;
--   update public.es_designer_tasks set status = 'Backlog' where status = 'Declined';
--   alter table public.es_designer_tasks drop constraint if exists es_designer_tasks_status_check;
--   alter table public.es_designer_tasks add constraint es_designer_tasks_status_check
--     check (status in ('Backlog', 'Assigned', 'Doing', 'Review', 'Done'));
--   alter table public.es_designer_tasks drop column if exists status_changed_at;

-- 1) Declined status and a status timestamp ---------------------------------
alter table public.es_designer_tasks drop constraint if exists es_designer_tasks_status_check;
alter table public.es_designer_tasks add constraint es_designer_tasks_status_check
  check (status in ('Backlog', 'Assigned', 'Doing', 'Review', 'Done', 'Declined'));

alter table public.es_designer_tasks add column if not exists status_changed_at timestamptz;

create index if not exists es_designer_tasks_type_status_idx
  on public.es_designer_tasks (task_type, status);

-- 2) Designers ----------------------------------------------------------------
create table if not exists public.frameup_request_designers (
  email text primary key
    check (email = lower(email) and email like '%@essentiallysports.com'),
  name text not null default '' check (char_length(name) <= 120),
  active boolean not null default true,
  added_by text not null default '',
  created_at timestamptz not null default now()
);

alter table public.frameup_request_designers enable row level security;

drop policy if exists "ES users can read request designers" on public.frameup_request_designers;
create policy "ES users can read request designers"
  on public.frameup_request_designers for select to authenticated
  using (public.is_es_designer_domain_user());

drop policy if exists "Admins manage request designers" on public.frameup_request_designers;
create policy "Admins manage request designers"
  on public.frameup_request_designers for all to authenticated
  using (public.is_es_designer_admin())
  with check (public.is_es_designer_admin());

grant select, insert, update, delete on public.frameup_request_designers to authenticated;

create or replace function public.is_frameup_request_designer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_es_designer_admin()
    or exists (
      select 1 from public.frameup_request_designers d
      where d.active
        and d.email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    );
$$;

-- Can the signed-in person see this request? (Staff: any; others: their own.)
create or replace function public.frameup_can_view_request(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.es_designer_tasks t
    where t.id = p_request_id
      and t.task_type = 'design_request'
      and (
        public.is_frameup_request_designer()
        or lower(coalesce((select auth.jwt()) ->> 'email', '')) <> ''
          and lower(coalesce((select auth.jwt()) ->> 'email', ''))
            in (lower(t.creator_email), lower(t.requester_email))
      )
  );
$$;

-- 3) Designers read every design request -----------------------------------
-- Same policy as 20260910070000 plus one clause; one permissive policy keeps
-- the RLS performance fix (no second SELECT policy).
alter policy "Dashboard admins can read dashboard tasks"
  on public.es_designer_tasks
  using (
    is_es_designer_admin()
    or (
      is_es_designer_domain_user()
      and lower(coalesce(creator_email, requester_email, ''::text))
        = lower(((select auth.jwt()) ->> 'email'::text))
    )
    or (task_type = 'design_request' and public.is_frameup_request_designer())
  );

-- 4) History + comments -------------------------------------------------------
create table if not exists public.frameup_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.es_designer_tasks(id) on delete cascade,
  kind text not null
    check (kind in ('created', 'status', 'assign', 'due', 'priority', 'comment', 'delivery')),
  actor_email text not null default '',
  actor_name text not null default '',
  body text not null default '' check (char_length(body) <= 4000),
  from_value text not null default '',
  to_value text not null default '',
  meta jsonb not null default '{}'::jsonb,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists frameup_request_events_request_idx
  on public.frameup_request_events (request_id, created_at);
create index if not exists frameup_request_events_pending_idx
  on public.frameup_request_events (request_id) where notified_at is null;

alter table public.frameup_request_events enable row level security;

drop policy if exists "Request viewers read request events" on public.frameup_request_events;
create policy "Request viewers read request events"
  on public.frameup_request_events for select to authenticated
  using (public.frameup_can_view_request(request_id));

-- Writes only through the trigger and the RPCs below.
grant select on public.frameup_request_events to authenticated;

-- 5) Delivered designs --------------------------------------------------------
create table if not exists public.frameup_request_deliveries (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.es_designer_tasks(id) on delete cascade,
  export_task_id text,
  url text not null default '' check (char_length(url) <= 2000),
  label text not null default '' check (char_length(label) <= 200),
  added_by text not null default '',
  created_at timestamptz not null default now(),
  constraint frameup_request_deliveries_target check (export_task_id is not null or url <> '')
);

create index if not exists frameup_request_deliveries_request_idx
  on public.frameup_request_deliveries (request_id, created_at);

alter table public.frameup_request_deliveries enable row level security;

drop policy if exists "Request viewers read deliveries" on public.frameup_request_deliveries;
create policy "Request viewers read deliveries"
  on public.frameup_request_deliveries for select to authenticated
  using (public.frameup_can_view_request(request_id));

grant select on public.frameup_request_deliveries to authenticated;

-- 6) Triggers: stamp status changes, log every change -------------------------
create or replace function public.frameup_request_status_stamp()
returns trigger
language plpgsql
as $$
begin
  if new.task_type = 'design_request' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists frameup_request_status_stamp on public.es_designer_tasks;
create trigger frameup_request_status_stamp
  before update on public.es_designer_tasks
  for each row when (new.task_type = 'design_request')
  execute function public.frameup_request_status_stamp();

create or replace function public.frameup_request_log_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := lower(coalesce(
    nullif(current_setting('frameup.actor', true), ''),
    (select auth.jwt()) ->> 'email',
    'system'
  ));
  v_reason text := coalesce(current_setting('frameup.reason', true), '');
begin
  if new.task_type <> 'design_request' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- The submit endpoint already announced it in Slack.
    insert into public.frameup_request_events (request_id, kind, actor_email, actor_name, to_value, notified_at)
    values (new.id, 'created', coalesce(nullif(lower(new.requester_email), ''), v_actor), new.requester_name, new.status, now());
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.frameup_request_events (request_id, kind, actor_email, body, from_value, to_value)
    values (new.id, 'status', v_actor, left(v_reason, 4000), coalesce(old.status, ''), coalesce(new.status, ''));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.frameup_request_events (request_id, kind, actor_email, from_value, to_value)
    values (new.id, 'assign', v_actor, coalesce(old.assigned_to, ''), coalesce(new.assigned_to, ''));
  end if;
  if new.design_due_at is distinct from old.design_due_at then
    insert into public.frameup_request_events (request_id, kind, actor_email, from_value, to_value)
    values (new.id, 'due', v_actor, coalesce(old.design_due_at::text, ''), coalesce(new.design_due_at::text, ''));
  end if;
  if new.priority is distinct from old.priority then
    insert into public.frameup_request_events (request_id, kind, actor_email, from_value, to_value)
    values (new.id, 'priority', v_actor, coalesce(old.priority, ''), coalesce(new.priority, ''));
  end if;
  return new;
end;
$$;

drop trigger if exists frameup_request_log_changes on public.es_designer_tasks;
create trigger frameup_request_log_changes
  after insert or update on public.es_designer_tasks
  for each row when (new.task_type = 'design_request')
  execute function public.frameup_request_log_changes();

-- 7) RPCs ---------------------------------------------------------------------
-- Status / assignee / due / priority in one call. Rules match
-- request-lifecycle.js: admins anything; designers claim unassigned work,
-- hand back their own, and move their own requests one step at a time;
-- requesters may withdraw (Declined) before work starts.
create or replace function public.frameup_request_update(
  p_request_id text,
  p_status text default null,
  p_assigned_to text default null,
  p_design_due_at timestamptz default null,
  p_clear_due boolean default false,
  p_priority text default null,
  p_reason text default null
)
returns public.es_designer_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_admin boolean := public.is_es_designer_admin();
  v_designer boolean := public.is_frameup_request_designer();
  v_row public.es_designer_tasks;
  v_owner boolean;
  v_from text;
  v_assignee text;
  v_target text;
  v_allowed text[];
begin
  if v_me = '' or not public.is_es_designer_domain_user() then
    raise exception 'Sign in with your EssentiallySports account.' using errcode = '42501';
  end if;

  select * into v_row from public.es_designer_tasks
  where id = p_request_id and task_type = 'design_request'
  for update;
  if not found then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;

  v_owner := v_me in (lower(v_row.creator_email), lower(v_row.requester_email));
  if not (v_designer or v_owner) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;

  v_from := v_row.status;
  v_assignee := lower(coalesce(v_row.assigned_to, ''));

  -- Assignment
  if p_assigned_to is not null and lower(trim(p_assigned_to)) <> v_assignee then
    v_target := lower(trim(p_assigned_to));
    if v_admin then
      null;
    elsif v_designer and v_assignee = '' and v_target = v_me then
      null;
    elsif v_designer and v_assignee = v_me and v_target = '' then
      null;
    else
      raise exception 'Only an admin can reassign this request.' using errcode = '42501';
    end if;
    if v_target <> '' and v_target not like '%@essentiallysports.com' then
      raise exception 'Assignees need an EssentiallySports email.' using errcode = '22023';
    end if;
    v_row.assigned_to := v_target;
    v_assignee := v_target;
    if p_status is null and v_target <> '' and v_row.status = 'Backlog' then
      v_row.status := 'Assigned';
    elsif p_status is null and v_target = '' and v_row.status = 'Assigned' then
      v_row.status := 'Backlog';
    end if;
  end if;

  -- Status
  if p_status is not null and p_status <> v_from then
    if p_status not in ('Backlog', 'Assigned', 'Doing', 'Review', 'Done', 'Declined') then
      raise exception 'Unknown status %.', p_status using errcode = '22023';
    end if;
    if v_admin then
      null;
    elsif v_designer then
      if v_assignee <> v_me then
        raise exception 'Only the assigned designer or an admin can move this request.' using errcode = '42501';
      end if;
      v_allowed := case v_from
        when 'Backlog' then array['Assigned', 'Doing', 'Declined']
        when 'Assigned' then array['Backlog', 'Doing', 'Declined']
        when 'Doing' then array['Review', 'Assigned', 'Declined']
        when 'Review' then array['Done', 'Doing', 'Declined']
        when 'Done' then array['Doing']
        when 'Declined' then array['Backlog']
        else array[]::text[]
      end;
      if not (p_status = any(v_allowed)) then
        raise exception 'A request can''t go from % to %.', v_from, p_status using errcode = '22023';
      end if;
    elsif v_owner and p_status = 'Declined' and v_from in ('Backlog', 'Assigned') then
      p_reason := coalesce(nullif(trim(p_reason), ''), 'Withdrawn by the requester.');
    else
      raise exception 'Only the design team can change the status.' using errcode = '42501';
    end if;
    v_row.status := p_status;
  end if;

  -- Due date and priority
  if p_clear_due or p_design_due_at is not null or p_priority is not null then
    if not (v_admin or (v_designer and v_assignee = v_me)) then
      raise exception 'Only the assigned designer or an admin can change the due date or priority.' using errcode = '42501';
    end if;
    if p_clear_due then
      v_row.design_due_at := null;
    elsif p_design_due_at is not null then
      v_row.design_due_at := p_design_due_at;
    end if;
    if p_priority is not null then
      if p_priority not in ('Normal', 'High', 'Urgent') then
        raise exception 'Unknown priority %.', p_priority using errcode = '22023';
      end if;
      v_row.priority := p_priority;
    end if;
  end if;

  perform set_config('frameup.reason', left(coalesce(trim(p_reason), ''), 4000), true);

  update public.es_designer_tasks set
    status = v_row.status,
    assigned_to = v_row.assigned_to,
    design_due_at = v_row.design_due_at,
    priority = v_row.priority,
    completed_at = case when v_row.status = 'Done' then coalesce(completed_at, now()) else null end,
    updated_at = now()
  where id = v_row.id
  returning * into v_row;

  perform set_config('frameup.reason', '', true);
  return v_row;
end;
$$;

create or replace function public.frameup_request_comment(p_request_id text, p_body text)
returns public.frameup_request_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_body text := trim(coalesce(p_body, ''));
  v_name text;
  v_event public.frameup_request_events;
begin
  if v_me = '' or not public.frameup_can_view_request(p_request_id) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if v_body = '' then
    raise exception 'Write a comment first.' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'Comments are limited to 4,000 characters.' using errcode = '22023';
  end if;
  select name into v_name from public.es_designer_profiles where lower(email) = v_me limit 1;
  insert into public.frameup_request_events (request_id, kind, actor_email, actor_name, body)
  values (p_request_id, 'comment', v_me, coalesce(v_name, ''), v_body)
  returning * into v_event;
  update public.es_designer_tasks set updated_at = now() where id = p_request_id;
  return v_event;
end;
$$;

-- Attach a FrameUp export (by task id) or a link. Moves In progress → In review.
create or replace function public.frameup_request_attach(
  p_request_id text,
  p_url text default '',
  p_label text default '',
  p_export_task_id text default null
)
returns public.frameup_request_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_row public.es_designer_tasks;
  v_url text := trim(coalesce(p_url, ''));
  v_label text := left(trim(coalesce(p_label, '')), 200);
  v_export public.es_designer_tasks;
  v_delivery public.frameup_request_deliveries;
begin
  select * into v_row from public.es_designer_tasks
  where id = p_request_id and task_type = 'design_request';
  if not found or v_me = '' then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if not (public.is_es_designer_admin()
      or (public.is_frameup_request_designer() and lower(v_row.assigned_to) = v_me)) then
    raise exception 'Only the assigned designer or an admin can attach designs.' using errcode = '42501';
  end if;
  if v_url <> '' and (v_url !~* '^https?://' or char_length(v_url) > 2000) then
    raise exception 'Links must start with https://' using errcode = '22023';
  end if;
  if p_export_task_id is not null then
    select * into v_export from public.es_designer_tasks
    where id = p_export_task_id and task_type = 'exported_design';
    if not found then
      raise exception 'That export was not found.' using errcode = 'P0002';
    end if;
    if v_label = '' then
      v_label := left(coalesce(nullif(v_export.title, ''), nullif(v_export.filename, ''), 'FrameUp export'), 200);
    end if;
  elsif v_url = '' then
    raise exception 'Pick an export or paste a link.' using errcode = '22023';
  end if;

  insert into public.frameup_request_deliveries (request_id, export_task_id, url, label, added_by)
  values (p_request_id, p_export_task_id, v_url, v_label, v_me)
  returning * into v_delivery;

  insert into public.frameup_request_events (request_id, kind, actor_email, to_value, meta)
  values (p_request_id, 'delivery', v_me, coalesce(nullif(v_label, ''), v_url),
    jsonb_build_object('deliveryId', v_delivery.id, 'url', v_url, 'exportTaskId', p_export_task_id));

  if v_row.status = 'Doing' then
    update public.es_designer_tasks set status = 'Review', updated_at = now() where id = p_request_id;
  else
    update public.es_designer_tasks set updated_at = now() where id = p_request_id;
  end if;
  return v_delivery;
end;
$$;

create or replace function public.frameup_request_detach(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
begin
  delete from public.frameup_request_deliveries
  where id = p_delivery_id
    and (public.is_es_designer_admin() or lower(added_by) = v_me);
  return found;
end;
$$;

-- Keep the Slack thread for a request. Never overwrites an existing thread.
create or replace function public.frameup_request_set_slack_thread(
  p_request_id text,
  p_channel text,
  p_ts text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service boolean := coalesce((select auth.jwt()) ->> 'role', '') = 'service_role';
begin
  if not (v_service or public.frameup_can_view_request(p_request_id)) then
    return false;
  end if;
  if coalesce(p_ts, '') !~ '^[0-9]{6,12}\.[0-9]{1,8}$' or coalesce(p_channel, '') !~ '^[A-Z0-9]{6,20}$' then
    raise exception 'Invalid Slack thread.' using errcode = '22023';
  end if;
  update public.es_designer_tasks
  set metadata = coalesce(metadata, '{}'::jsonb)
    || jsonb_build_object('slackChannel', p_channel, 'slackThreadTs', p_ts)
  where id = p_request_id
    and task_type = 'design_request'
    and coalesce(metadata ->> 'slackThreadTs', '') = '';
  return found;
end;
$$;

-- Hand pending (not yet posted) events to the notifier exactly once.
create or replace function public.frameup_request_claim_notifications(p_request_id text)
returns setof public.frameup_request_events
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.frameup_can_view_request(p_request_id) then
    return;
  end if;
  return query
    update public.frameup_request_events
    set notified_at = now()
    where request_id = p_request_id
      and notified_at is null
      and created_at > now() - interval '1 day'
    returning *;
end;
$$;

-- Sidebar badge: open requests that need me (mine as a requester, my queue
-- as a designer, plus unassigned ones for admins).
create or replace function public.frameup_my_open_request_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select lower(coalesce((select auth.jwt()) ->> 'email', '')) as email,
      public.is_es_designer_admin() as admin,
      public.is_frameup_request_designer() as designer
  )
  select count(*)::integer
  from public.es_designer_tasks t, me
  where me.email <> ''
    and t.task_type = 'design_request'
    and t.status in ('Backlog', 'Assigned', 'Doing', 'Review')
    and (
      lower(t.assigned_to) = me.email
      or (me.admin and coalesce(t.assigned_to, '') = '')
      or (not me.designer and me.email in (lower(t.creator_email), lower(t.requester_email)))
    );
$$;

revoke all on function public.is_frameup_request_designer() from public, anon;
revoke all on function public.frameup_can_view_request(text) from public, anon;
revoke all on function public.frameup_request_update(text, text, text, timestamptz, boolean, text, text) from public, anon;
revoke all on function public.frameup_request_comment(text, text) from public, anon;
revoke all on function public.frameup_request_attach(text, text, text, text) from public, anon;
revoke all on function public.frameup_request_detach(uuid) from public, anon;
revoke all on function public.frameup_request_set_slack_thread(text, text, text) from public, anon;
revoke all on function public.frameup_request_claim_notifications(text) from public, anon;
revoke all on function public.frameup_my_open_request_count() from public, anon;

grant execute on function public.is_frameup_request_designer() to authenticated;
grant execute on function public.frameup_can_view_request(text) to authenticated;
grant execute on function public.frameup_request_update(text, text, text, timestamptz, boolean, text, text) to authenticated;
grant execute on function public.frameup_request_comment(text, text) to authenticated;
grant execute on function public.frameup_request_attach(text, text, text, text) to authenticated;
grant execute on function public.frameup_request_detach(uuid) to authenticated;
grant execute on function public.frameup_request_set_slack_thread(text, text, text) to authenticated, service_role;
grant execute on function public.frameup_request_claim_notifications(text) to authenticated;
grant execute on function public.frameup_my_open_request_count() to authenticated;
