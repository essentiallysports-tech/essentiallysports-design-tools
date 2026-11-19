-- FrameUp licensed music for Video Ads (and later Reels Studio): a PRIVATE
-- Storage bucket. The GitHub repo is public, so licensed audio must never be
-- committed. Approved ES users read tracks through short-lived signed URLs;
-- nobody uploads, overwrites or deletes from the browser (admins upload in the
-- Supabase dashboard). Track list: audio-library.json (file: storage:frameup-audio/<id>.m4a).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('frameup-audio', 'frameup-audio', false, 15728640,
        array['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/x-wav'])
on conflict (id) do nothing;

drop policy if exists "frameup audio: approved users read" on storage.objects;
create policy "frameup audio: approved users read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'frameup-audio'
    and public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
  );
