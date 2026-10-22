-- FrameUp Gallery thumbnails: small webp thumbnails of exported Social Media
-- posts, stored in a PRIVATE Storage bucket (thumbs/<task id>.webp).
--
-- Additive only: the existing metadata.previewDataUrl is still written and
-- read exactly as before. Approved ES users may upload new thumbnails and read
-- them (through short-lived signed URLs); nobody can overwrite or delete them
-- from the browser, and anonymous visitors cannot read them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('frameup-previews', 'frameup-previews', false, 524288, array['image/webp'])
on conflict (id) do nothing;

drop policy if exists "frameup previews: approved users read" on storage.objects;
create policy "frameup previews: approved users read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'frameup-previews'
    and public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
  );

drop policy if exists "frameup previews: approved users upload" on storage.objects;
create policy "frameup previews: approved users upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'frameup-previews'
    and (storage.foldername(name))[1] = 'thumbs'
    and public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
  );
