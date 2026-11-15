-- V4 Phase 8: customer schedule updates.
--
-- Internal schedule edits (Phases 6-7) never reach the customer. A contractor previews a customer
-- update, then explicitly publishes it. Each publication stores a frozen copy of exactly what the
-- customer sees (built on the server from the schedule; it never contains prices, costs, margins,
-- quantities, task weights, assignees or private task notes). Later schedule edits never change it:
-- the content is write-once (trigger below) and there are no direct table writes.
--
-- Access
--   * Read: follows the schedule (and so the source estimate) under existing RLS.
--   * Publish / share link / revoke / record delivery: schedule_can_edit() (Phase 6-7 rule).
--   * Customer: a secret share link (256-bit random token, only its SHA-256 is stored), looked up by
--     the server with the service role. One link per publication, expiring, revocable. A link shows
--     only its own frozen publication, so it can't reach another customer's or a newer update.
--
-- Rollback: docs/pipeline/rollback_20261116005000.sql

create table if not exists public.schedule_publications (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.project_schedules (id) on delete cascade,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  version integer not null check (version >= 1),
  schedule_revision integer not null,
  published_by uuid references auth.users (id) on delete set null,
  publisher_name text check (char_length(publisher_name) <= 200),
  published_at timestamptz not null default now(),
  options jsonb not null check (jsonb_typeof(options) = 'object'),
  content jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) < 400000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- Logo shown with this update (storage path in the private "logos" bucket), when branding was on.
  logo_path text check (char_length(logo_path) <= 500),
  -- Secure share link (optional).
  token_hash text unique check (token_hash ~ '^[0-9a-f]{64}$'),
  link_created_at timestamptz,
  link_expires_at timestamptz,
  link_revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  -- What the contractor did with it: [{method, at, by}]. An opened email draft is not a delivery.
  delivery jsonb not null default '[]'::jsonb check (jsonb_typeof(delivery) = 'array'),
  unique (schedule_id, version),
  constraint schedule_publications_link_valid check (token_hash is null or (link_created_at is not null and link_expires_at > link_created_at))
);
create index if not exists schedule_publications_schedule_idx on public.schedule_publications (schedule_id, version desc);

-- Published content is write-once.
create or replace function public.schedule_publications_freeze() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.content is distinct from old.content or new.options is distinct from old.options or new.content_hash is distinct from old.content_hash
     or new.version is distinct from old.version or new.schedule_id is distinct from old.schedule_id or new.published_at is distinct from old.published_at
     or new.published_by is distinct from old.published_by or new.schedule_revision is distinct from old.schedule_revision then
    raise exception 'publication_frozen' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists schedule_publications_freeze on public.schedule_publications;
create trigger schedule_publications_freeze before update on public.schedule_publications
  for each row execute function public.schedule_publications_freeze();

alter table public.schedule_publications enable row level security;
drop policy if exists schedule_publications_select on public.schedule_publications;
create policy schedule_publications_select on public.schedule_publications for select to authenticated
  using (exists (select 1 from public.project_schedules s where s.id = schedule_publications.schedule_id));
revoke insert, update, delete on public.schedule_publications from anon, authenticated;
revoke select on public.schedule_publications from anon;
grant select on public.schedule_publications to authenticated;

-- Publish. p: { options, content, contentHash, logoPath?, publisherName? }. The caller's preview must
-- match the saved schedule (p_base_revision), so what was reviewed is what gets published.
create or replace function public.schedule_publish(p_schedule_id uuid, p_base_revision integer, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  s record;
  v_version integer;
  v_id uuid;
  v_at timestamptz;
begin
  select * into s from public.project_schedules where id = p_schedule_id for update;
  if not found or v_uid is null or not public.schedule_can_edit(p_schedule_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if s.revision <> p_base_revision then
    raise exception 'stale_revision' using errcode = '40001', detail = s.revision::text;
  end if;
  if jsonb_typeof(p -> 'content') is distinct from 'object' or jsonb_typeof(p -> 'options') is distinct from 'object'
     or coalesce(p ->> 'contentHash', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.schedule_publications where schedule_id = p_schedule_id;
  insert into public.schedule_publications (schedule_id, estimate_id, company_id, version, schedule_revision, published_by, publisher_name,
                                            options, content, content_hash, logo_path)
  values (p_schedule_id, s.estimate_id, s.company_id, v_version, s.revision, v_uid, left(nullif(btrim(p ->> 'publisherName'), ''), 200),
          p -> 'options', p -> 'content', p ->> 'contentHash', left(nullif(btrim(p ->> 'logoPath'), ''), 500))
  returning id, published_at into v_id, v_at;
  if s.company_id is not null then
    insert into public.company_audit_log (company_id, actor_id, action, target_type, target_id, details)
    values (s.company_id, v_uid, 'schedule.update_published', 'estimate', s.estimate_id::text, jsonb_build_object('schedule_id', p_schedule_id, 'publication_id', v_id, 'version', v_version));
  end if;
  return jsonb_build_object('id', v_id, 'version', v_version, 'publishedAt', v_at);
end $$;
revoke execute on function public.schedule_publish(uuid, integer, jsonb) from public, anon;
grant execute on function public.schedule_publish(uuid, integer, jsonb) to authenticated;

-- Share link: a new token for this publication (replaces its earlier link, if any).
create or replace function public.schedule_publication_link(p_publication_id uuid, p_token_hash text, p_days integer default 30) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sched uuid;
  v_exp timestamptz := now() + make_interval(days => greatest(1, least(coalesce(p_days, 30), 90)));
begin
  select schedule_id into v_sched from public.schedule_publications where id = p_publication_id for update;
  if v_sched is null or v_uid is null or not public.schedule_can_edit(v_sched) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'invalid' using errcode = '22023'; end if;
  update public.schedule_publications
     set token_hash = p_token_hash, link_created_at = now(), link_expires_at = v_exp, link_revoked_at = null,
         delivery = (delivery || jsonb_build_array(jsonb_build_object('method', 'link_created', 'at', now(), 'by', v_uid)))
   where id = p_publication_id;
  return v_exp;
end $$;
revoke execute on function public.schedule_publication_link(uuid, text, integer) from public, anon;
grant execute on function public.schedule_publication_link(uuid, text, integer) to authenticated;

create or replace function public.schedule_publication_revoke_link(p_publication_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sched uuid;
begin
  select schedule_id into v_sched from public.schedule_publications where id = p_publication_id for update;
  if v_sched is null or auth.uid() is null or not public.schedule_can_edit(v_sched) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.schedule_publications set link_revoked_at = now() where id = p_publication_id and token_hash is not null and link_revoked_at is null;
end $$;
revoke execute on function public.schedule_publication_revoke_link(uuid) from public, anon;
grant execute on function public.schedule_publication_revoke_link(uuid) to authenticated;

-- Records what the contractor did (downloaded the PDF, opened an email draft, ...). Never "delivered".
create or replace function public.schedule_publication_delivery(p_publication_id uuid, p_method text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sched uuid;
begin
  if p_method not in ('pdf_download', 'email_draft', 'share_sheet', 'link_copied') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select schedule_id into v_sched from public.schedule_publications where id = p_publication_id for update;
  if v_sched is null or v_uid is null or not public.schedule_can_edit(v_sched) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.schedule_publications
     set delivery = case when jsonb_array_length(delivery) >= 200 then delivery
                         else delivery || jsonb_build_array(jsonb_build_object('method', p_method, 'at', now(), 'by', v_uid)) end
   where id = p_publication_id;
end $$;
revoke execute on function public.schedule_publication_delivery(uuid, text) from public, anon;
grant execute on function public.schedule_publication_delivery(uuid, text) to authenticated;
