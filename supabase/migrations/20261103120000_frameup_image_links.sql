-- Shareable image links: "Copy link" in the FrameUp editor uploads the
-- exported design to this PUBLIC bucket and copies its permanent URL.
--
-- Public = anyone with a link can view the image (needed for emails and
-- websites). Only approved, signed-in FrameUp users can upload. There is no
-- select/update/delete policy, so nobody can list, overwrite or delete files
-- from the browser.
--
-- Undo:
--   drop policy if exists "frameup links: approved users upload" on storage.objects;
--   -- then empty and delete the bucket from the Storage dashboard.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('frameup-links', 'frameup-links', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "frameup links: approved users upload" on storage.objects;
create policy "frameup links: approved users upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'frameup-links'
    and public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
  );
