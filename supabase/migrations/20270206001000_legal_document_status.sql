-- Legal Documentation Status V1 (2026-11-20): legal-review status for Built2Bid's own published legal
-- documents (Terms, Privacy, program terms, disclosures).
--
-- The list of documents, their versions and dates lives in code (src/lib/legal/registry.ts). This SQL only
-- stores what the platform owner records about legal review: the status, the date a review was completed,
-- and internal notes. A document with no row here shows its default, "Published, legal review pending".
--
-- 1. legal_document_reviews: one row per document the owner has recorded a status for.
-- 2. legal_document_review_events: append-only history of every status change.
-- 3. admin_legal_set_status: the only write path. Platform admins only (is_admin), called by the server
--    after requireAdmin. Customer Enterprise/Team admins are not platform admins and cannot reach it.
-- 4. legal_public_statuses: what the public site reads (status + completion date, never notes).
--
-- Safe to run more than once. Nothing here touches users, acceptance records, consent logs, signed
-- documents, prices, plans or subscriptions.

create table if not exists public.legal_document_reviews (
  doc_key text primary key check (doc_key ~ '^[a-z0-9-]{1,64}$'),
  status text not null default 'published_pending'
    check (status in ('published_pending', 'in_review', 'reviewed', 'revision_required', 'archived')),
  review_completed_on date,
  internal_notes text check (internal_notes is null or length(internal_notes) <= 2000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  -- A completion date only makes sense for a finished review.
  constraint legal_document_reviews_completed_check check (review_completed_on is null or status = 'reviewed')
);

create table if not exists public.legal_document_review_events (
  id bigint generated always as identity primary key,
  doc_key text not null,
  old_status text,
  new_status text not null,
  review_completed_on date,
  internal_notes text,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists legal_document_review_events_doc_idx on public.legal_document_review_events (doc_key, created_at desc);

-- Owner-only data: RLS on with no policies, and no table grants to signed-in or anonymous users.
alter table public.legal_document_reviews enable row level security;
alter table public.legal_document_review_events enable row level security;
revoke all on public.legal_document_reviews from anon, authenticated;
revoke all on public.legal_document_review_events from anon, authenticated;

-- History is append-only.
create or replace function public.legal_review_events_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'legal_document_review_events is append-only';
end $$;
drop trigger if exists legal_review_events_no_change on public.legal_document_review_events;
create trigger legal_review_events_no_change before update or delete on public.legal_document_review_events
  for each row execute function public.legal_review_events_immutable();

create or replace function public.admin_legal_set_status(
  p_caller uuid, p_doc_key text, p_status text, p_review_completed_on date, p_internal_notes text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_notes text := nullif(btrim(coalesce(p_internal_notes, '')), '');
begin
  if p_caller is null or not public.is_admin(p_caller) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_doc_key is null or p_doc_key !~ '^[a-z0-9-]{1,64}$' then return jsonb_build_object('ok', false, 'error', 'bad_doc'); end if;
  if p_status not in ('published_pending', 'in_review', 'reviewed', 'revision_required', 'archived') then return jsonb_build_object('ok', false, 'error', 'bad_status'); end if;
  if p_status = 'reviewed' and p_review_completed_on is null then return jsonb_build_object('ok', false, 'error', 'completion_date_required'); end if;
  if p_status <> 'reviewed' and p_review_completed_on is not null then return jsonb_build_object('ok', false, 'error', 'completion_date_only_when_reviewed'); end if;
  if p_review_completed_on is not null and p_review_completed_on > current_date then return jsonb_build_object('ok', false, 'error', 'completion_date_future'); end if;
  if v_notes is not null and length(v_notes) > 2000 then return jsonb_build_object('ok', false, 'error', 'notes_too_long'); end if;

  select status into v_old from public.legal_document_reviews where doc_key = p_doc_key for update;
  insert into public.legal_document_reviews (doc_key, status, review_completed_on, internal_notes, updated_by, updated_at)
  values (p_doc_key, p_status, p_review_completed_on, v_notes, p_caller, now())
  on conflict (doc_key) do update set status = excluded.status, review_completed_on = excluded.review_completed_on,
    internal_notes = excluded.internal_notes, updated_by = excluded.updated_by, updated_at = now();
  insert into public.legal_document_review_events (doc_key, old_status, new_status, review_completed_on, internal_notes, actor_id)
  values (p_doc_key, coalesce(v_old, 'published_pending'), p_status, p_review_completed_on, v_notes, p_caller);
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.admin_legal_set_status(uuid, text, text, date, text) from public, anon, authenticated;
grant execute on function public.admin_legal_set_status(uuid, text, text, date, text) to service_role;

-- Public read: status and completion date only. Notes and who changed what stay owner-only.
create or replace function public.legal_public_statuses() returns table (doc_key text, status text, review_completed_on date)
language sql stable security definer set search_path = public as $$
  select r.doc_key, r.status, r.review_completed_on from public.legal_document_reviews r;
$$;
revoke execute on function public.legal_public_statuses() from public;
grant execute on function public.legal_public_statuses() to anon, authenticated, service_role;
