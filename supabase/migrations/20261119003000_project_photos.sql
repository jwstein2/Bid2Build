-- Project Operations V4.3 (part 3 of 4): customer and project photos, AI label suggestions, scope
-- attachments, and private storage for photos and subcontractor quote documents.
--
--   * Two PRIVATE buckets in the existing Supabase Storage: project-photos (JPEG/WebP re-encoded by the
--     server, which strips location metadata) and project-files (subcontractor quote PDFs / images).
--     Objects live under "<company id or owner id>/..."; there are no client storage policies: the
--     server checks access and hands out short-lived signed URLs.
--   * project_photos belong to a customer (general photos) or to a bid / project, optionally attached to
--     one scope section. Labels the user approved are separate from AI suggestions, which stay marked
--     as suggestions until someone accepts or corrects them. Nothing is sent to an AI provider unless the
--     server is configured for it and the user asks (see docs/project-operations/PHOTOS.md).
--
-- Safe to run more than once. Requires 20261119002000_project_documents.sql.
-- Rollback: docs/project-operations/rollback_20261119003000.sql

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-photos', 'project-photos', false, 10485760, array['image/jpeg', 'image/webp']),
       ('project-files', 'project-files', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create table if not exists public.project_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,        -- owner of the customer / bid
  company_id uuid references public.companies (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete cascade,
  estimate_id uuid references public.estimates (id) on delete cascade,
  scope_section_id uuid references public.project_scope_sections (id) on delete set null,
  storage_path text not null unique check (char_length(storage_path) <= 500),
  thumb_path text check (char_length(thumb_path) <= 500),
  content_type text not null check (content_type in ('image/jpeg', 'image/webp')),
  bytes integer not null check (bytes > 0 and bytes <= 10485760),
  width integer, height integer,
  taken_on date,
  caption text check (char_length(caption) <= 500),
  labels text[] not null default '{}' check (cardinality(labels) <= 10),     -- confirmed by a person
  ai_labels text[] not null default '{}' check (cardinality(ai_labels) <= 10), -- suggestions only
  ai_status text not null default 'none' check (ai_status in ('none', 'suggested', 'reviewed')),
  ai_model text check (char_length(ai_model) <= 60),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint project_photos_parent check (customer_id is not null or estimate_id is not null)
);
create index if not exists project_photos_estimate_idx on public.project_photos (estimate_id, created_at desc) where estimate_id is not null;
create index if not exists project_photos_customer_idx on public.project_photos (customer_id, created_at desc) where customer_id is not null;
create index if not exists project_photos_section_idx on public.project_photos (scope_section_id) where scope_section_id is not null;
drop trigger if exists project_photos_updated on public.project_photos;
create trigger project_photos_updated before update on public.project_photos for each row execute function public.set_updated_at();

-- Read: the bid (or customer) is readable by the caller.
create or replace function public.customer_readable(p_customer_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.customers c where c.id = p_customer_id and (
      (c.user_id = auth.uid() and (c.company_id is null or c.company_id = public.my_company_id()))
      or (c.company_id is not null and (c.company_id, c.user_id) in (select v.company_id, v.user_id from public.my_visible_bid_owners() v))))
$$;
revoke execute on function public.customer_readable(uuid) from public, anon;
grant execute on function public.customer_readable(uuid) to authenticated;

create or replace function public.photo_readable(p_customer_id uuid, p_estimate_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_estimate_id is not null then public.estimate_readable(p_estimate_id) else public.customer_readable(p_customer_id) end
$$;
-- Upload / edit: "Upload photos" on the bid's (or customer's) company, or the solo owner.
create or replace function public.can_upload_photos(p_customer_id uuid, p_estimate_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_estimate_id is not null then public.estimate_permission(p_estimate_id, 'upload_photos')
    else coalesce((select case when c.company_id is null then c.user_id = auth.uid()
                               else public.customer_readable(c.id) and public.has_company_permission(c.company_id, 'upload_photos') end
                   from public.customers c where c.id = p_customer_id), false) end
$$;
revoke execute on function public.photo_readable(uuid, uuid), public.can_upload_photos(uuid, uuid) from public, anon;
grant execute on function public.photo_readable(uuid, uuid), public.can_upload_photos(uuid, uuid) to authenticated;

alter table public.project_photos enable row level security;
drop policy if exists project_photos_select on public.project_photos;
create policy project_photos_select on public.project_photos for select to authenticated using (public.photo_readable(customer_id, estimate_id));
revoke all on public.project_photos from anon, authenticated;
grant select on public.project_photos to authenticated;

-- Insert happens from the upload route after the file is validated and stored (service role), with the
-- caller's permission checked first through can_upload_photos().
create or replace function public.photo_register(p_actor uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_user uuid; v_company uuid; v_customer uuid := nullif(p ->> 'customerId', '')::uuid; v_est uuid := nullif(p ->> 'estimateId', '')::uuid;
begin
  if v_est is not null then
    select user_id, company_id, coalesce(v_customer, customer_id) into v_user, v_company, v_customer from public.estimates where id = v_est;
    if v_user is null then raise exception 'not_found' using errcode = '42501'; end if;
    -- A customer on the bid stays linked so the photo also shows in that customer's library.
  else
    select user_id, company_id into v_user, v_company from public.customers where id = v_customer;
    if v_user is null then raise exception 'not_found' using errcode = '42501'; end if;
  end if;
  if split_part(p ->> 'storagePath', '/', 1) <> coalesce(v_company, v_user)::text then raise exception 'bad_path' using errcode = '22023'; end if;
  insert into public.project_photos (id, user_id, company_id, customer_id, estimate_id, storage_path, thumb_path, content_type, bytes, width, height, taken_on, caption, uploaded_by)
  values (coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid()), v_user, v_company, v_customer, v_est, p ->> 'storagePath', nullif(p ->> 'thumbPath', ''),
          p ->> 'contentType', (p ->> 'bytes')::int, nullif(p ->> 'width', '')::int, nullif(p ->> 'height', '')::int, nullif(p ->> 'takenOn', '')::date,
          left(nullif(btrim(p ->> 'caption'), ''), 500), p_actor)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.photo_register(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.photo_register(uuid, jsonb) to service_role;

-- Edit caption / date / labels / scope section, accept AI suggestions, or archive. Labels come from a
-- fixed vocabulary checked by the app; the database bounds them.
create or replace function public.photo_update(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare ph public.project_photos; v_labels text[]; v_section uuid := nullif(p ->> 'scopeSectionId', '')::uuid;
begin
  select * into ph from public.project_photos where id = p_id for update;
  if not found or auth.uid() is null or not public.can_upload_photos(ph.customer_id, ph.estimate_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p ? 'labels' then
    select coalesce(array_agg(distinct left(lower(btrim(x)), 40)) filter (where btrim(x) <> ''), '{}') into v_labels from jsonb_array_elements_text(p -> 'labels') x;
    if cardinality(v_labels) > 10 then raise exception 'too_many_labels' using errcode = '22023'; end if;
  end if;
  if p ? 'scopeSectionId' and v_section is not null and not exists (
       select 1 from public.project_scope_sections s where s.id = v_section and s.estimate_id = ph.estimate_id) then
    raise exception 'bad_section' using errcode = '22023';
  end if;
  update public.project_photos set
    caption = case when p ? 'caption' then left(nullif(btrim(p ->> 'caption'), ''), 500) else caption end,
    taken_on = case when p ? 'takenOn' then nullif(p ->> 'takenOn', '')::date else taken_on end,
    labels = case when p ? 'labels' then v_labels else labels end,
    ai_status = case when p ? 'labels' and ai_status = 'suggested' then 'reviewed' else ai_status end,
    scope_section_id = case when p ? 'scopeSectionId' then v_section else scope_section_id end,
    archived_at = case when (p ->> 'archived')::boolean is true then coalesce(archived_at, now()) when (p ->> 'archived')::boolean is false then null else archived_at end
  where id = p_id;
end $$;
revoke execute on function public.photo_update(uuid, jsonb) from public, anon;
grant execute on function public.photo_update(uuid, jsonb) to authenticated;

-- AI suggestions are written by the server (service role) after the user asked for them.
create or replace function public.photo_set_suggestions(p_id uuid, p_labels text[], p_model text) returns void
language sql security definer set search_path = public as $$
  update public.project_photos set ai_labels = p_labels[1:10], ai_status = 'suggested', ai_model = left(p_model, 60) where id = p_id
$$;
revoke all on function public.photo_set_suggestions(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.photo_set_suggestions(uuid, text[], text) to service_role;
