-- Rollback for 20261119003000_project_photos.sql. Deploy the previous app version first.
-- Photo rows are dropped. Stored files stay in the private buckets until removed in the Storage
-- dashboard (buckets project-photos and project-files), so nothing is lost by accident.
begin;
drop function if exists public.photo_set_suggestions(uuid, text[], text);
drop function if exists public.photo_update(uuid, jsonb);
drop function if exists public.photo_register(uuid, jsonb);
drop table if exists public.project_photos;
drop function if exists public.can_upload_photos(uuid, uuid);
drop function if exists public.photo_readable(uuid, uuid);
drop function if exists public.customer_readable(uuid);
commit;
