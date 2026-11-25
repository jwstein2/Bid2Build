-- Delete a bid without losing the record (James 2026-11-25).
--
-- People make mistakes and need them gone from My bids, but records shouldn't vanish. A "deleted" bid is
-- hidden everywhere the app reads bids and kept in the database, with who deleted it, when and why in an
-- audit trail. The bid's author or a company admin can see it under Recently deleted and restore it.
--
--   1. estimates.deleted_at / deleted_by / deleted_reason / deleted_prev_status.
--   2. estimate_deletions: one row per delete or restore (audit trail; never edited by users).
--   3. RLS: deleted bids drop out of every signed-in read (My bids, Table, Analytics, reports, the editor,
--      the customer hub). Nobody can set deleted_at with a plain update: only delete_estimate() can.
--      The row also gets status 'archived', so the database's own reports (which skip archived bids)
--      leave it out too. Restore puts the old status back.
--   4. delete_estimate(): same who-may-edit rule as pipeline moves (author, or Edit team estimates).
--      Refused for bids that were e-signed, won (or later), have a project schedule, change orders, or a
--      Financials job (invoices / payments hang off it): use Lost / Declined or Archive instead.
--      Open customer signing links are revoked.
--   5. restore_estimate() and deleted_estimates_list(): the author, people with Edit team estimates who can
--      see the bid, and company admins (Manage users / owner).
-- Safe to run more than once.

-- 1. Columns -------------------------------------------------------------------------------------------
alter table public.estimates add column if not exists deleted_at timestamptz;
alter table public.estimates add column if not exists deleted_by uuid references auth.users (id) on delete set null;
alter table public.estimates add column if not exists deleted_reason text check (deleted_reason is null or char_length(deleted_reason) <= 500);
alter table public.estimates add column if not exists deleted_prev_status text check (deleted_prev_status is null or deleted_prev_status in ('draft', 'finalized', 'archived'));
create index if not exists estimates_deleted_idx on public.estimates (deleted_at desc) where deleted_at is not null;

-- 2. Audit trail ---------------------------------------------------------------------------------------
create table if not exists public.estimate_deletions (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  owner_id    uuid references auth.users (id) on delete set null,
  company_id  uuid references public.companies (id) on delete cascade,
  action      text not null check (action in ('deleted', 'restored')),
  actor_id    uuid references auth.users (id) on delete set null,
  reason      text check (reason is null or char_length(reason) <= 500),
  snapshot    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists estimate_deletions_estimate_idx on public.estimate_deletions (estimate_id, created_at desc);
create index if not exists estimate_deletions_company_idx on public.estimate_deletions (company_id, created_at desc) where company_id is not null;
alter table public.estimate_deletions enable row level security;
-- Read: whoever acted, the bid's owner, and company admins. Written only by the functions below.
drop policy if exists estimate_deletions_select on public.estimate_deletions;
create policy estimate_deletions_select on public.estimate_deletions for select to authenticated
  using (actor_id = (select auth.uid()) or owner_id = (select auth.uid())
         or (company_id is not null and public.has_company_permission(company_id, 'manage_users')));
revoke insert, update, delete on public.estimate_deletions from anon, authenticated;

-- 3. Hide deleted bids from signed-in reads --------------------------------------------------------------
drop policy if exists estimates_own_all on public.estimates;
create policy estimates_own_all on public.estimates for all to authenticated
  using (user_id = (select auth.uid()) and (company_id is null or company_id = (select public.my_company_id())) and deleted_at is null)
  with check (user_id = (select auth.uid()) and (company_id is null or company_id = (select public.my_company_id())) and deleted_at is null);
drop policy if exists estimates_company_select on public.estimates;
create policy estimates_company_select on public.estimates for select to authenticated
  using (company_id is not null and deleted_at is null
         and (company_id, user_id) in (select v.company_id, v.user_id from public.my_visible_bid_owners() v));

-- Who may restore / see a deleted bid (shared by restore and the list).
create or replace function public.can_manage_deleted_estimate(p_owner uuid, p_company uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if p_company is null then return p_owner = v_uid; end if;
  if public.my_company_id() is distinct from p_company then return false; end if;
  if p_owner = v_uid then return true; end if;
  if exists (select 1 from public.companies c where c.id = p_company and c.owner_user_id = v_uid) then return true; end if;
  if public.has_company_permission(p_company, 'manage_users') then return true; end if;
  return public.has_company_permission(p_company, 'edit_team_estimates')
    and exists (select 1 from public.my_visible_bid_owners() v where v.company_id = p_company and v.user_id = p_owner);
end $$;
revoke execute on function public.can_manage_deleted_estimate(uuid, uuid) from public, anon;
grant execute on function public.can_manage_deleted_estimate(uuid, uuid) to authenticated;

-- 4. Delete --------------------------------------------------------------------------------------------
create or replace function public.delete_estimate(p_estimate_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.estimates%rowtype;
  v_uid uuid := auth.uid();
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_visible boolean;
  v_total numeric;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into e from public.estimates where id = p_estimate_id for update;
  if not found then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
  if e.deleted_at is not null then return; end if;   -- already deleted: nothing to do

  -- Same who-may-edit rule as set_estimate_stage.
  if e.company_id is null then
    if e.user_id <> v_uid then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
  else
    if public.my_company_id() is distinct from e.company_id then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
    v_visible := exists (select 1 from public.my_visible_bid_owners() v where v.company_id = e.company_id and v.user_id = e.user_id);
    if not (e.user_id = v_uid or v_visible) then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
    if not (e.user_id = v_uid or public.has_company_permission(e.company_id, 'edit_team_estimates')) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  -- Records that must stay visible: use Lost / Declined or Archive instead.
  if exists (select 1 from public.signatures s where s.estimate_id = e.id) then
    raise exception 'delete_signed' using errcode = '42501';
  end if;
  if e.pipeline_stage in ('won', 'scheduled', 'in_progress', 'completed') then
    raise exception 'delete_won' using errcode = '42501';
  end if;
  if exists (select 1 from public.project_schedules ps where ps.estimate_id = e.id)
     or exists (select 1 from public.change_orders co where co.estimate_id = e.id) then
    raise exception 'delete_has_project' using errcode = '42501';
  end if;
  if exists (select 1 from public.fin_jobs j where j.estimate_id = e.id) then
    raise exception 'delete_has_invoices' using errcode = '42501';
  end if;

  select ev.total into v_total from public.estimate_versions ev where ev.estimate_id = e.id order by ev.version_number desc limit 1;

  update public.estimates set deleted_at = now(), deleted_by = v_uid, deleted_reason = v_reason,
    deleted_prev_status = e.status, status = 'archived'
  where id = e.id;

  -- A customer can't sign a bid that's gone.
  update public.signing_requests set status = 'revoked', revoked_at = now(), revoked_by = v_uid, revoke_reason = 'contractor'
  where estimate_id = e.id and status = 'pending';

  insert into public.estimate_deletions (estimate_id, owner_id, company_id, action, actor_id, reason, snapshot)
  values (e.id, e.user_id, e.company_id, 'deleted', v_uid, v_reason, jsonb_build_object(
    'title', e.title, 'customer', e.customer_name, 'number', e.estimate_number,
    'stage', e.pipeline_stage, 'status', e.status, 'total', v_total));
  if e.company_id is not null then
    perform public.company_audit(e.company_id, 'bid.deleted', 'estimate', e.id::text,
      jsonb_build_object('title', e.title, 'number', e.estimate_number, 'reason', v_reason));
  end if;
end $$;
revoke execute on function public.delete_estimate(uuid, text) from public, anon;
grant execute on function public.delete_estimate(uuid, text) to authenticated;

-- 5. Restore + list ------------------------------------------------------------------------------------
create or replace function public.restore_estimate(p_estimate_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.estimates%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into e from public.estimates where id = p_estimate_id for update;
  if not found or not public.can_manage_deleted_estimate(e.user_id, e.company_id) then
    raise exception 'estimate_not_found' using errcode = 'P0002';
  end if;
  if e.deleted_at is null then return; end if;   -- not deleted: nothing to do

  update public.estimates set status = coalesce(e.deleted_prev_status, 'draft'),
    deleted_at = null, deleted_by = null, deleted_reason = null, deleted_prev_status = null
  where id = e.id;

  insert into public.estimate_deletions (estimate_id, owner_id, company_id, action, actor_id, snapshot)
  values (e.id, e.user_id, e.company_id, 'restored', v_uid, jsonb_build_object(
    'title', e.title, 'customer', e.customer_name, 'number', e.estimate_number, 'deletedAt', e.deleted_at));
  if e.company_id is not null then
    perform public.company_audit(e.company_id, 'bid.restored', 'estimate', e.id::text,
      jsonb_build_object('title', e.title, 'number', e.estimate_number));
  end if;
end $$;
revoke execute on function public.restore_estimate(uuid) from public, anon;
grant execute on function public.restore_estimate(uuid) to authenticated;

-- Deleted bids the caller may restore (newest first), with their delete/restore history.
create or replace function public.deleted_estimates_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."deletedAt" desc), '[]'::jsonb)
  from (
    select e.id, coalesce(nullif(e.title, ''), 'Untitled bid') as title, e.customer_name as customer, e.estimate_number as number,
      e.pipeline_stage as stage, e.deleted_at as "deletedAt", e.deleted_reason as reason, (e.user_id = auth.uid()) as mine,
      case when e.deleted_by = auth.uid() then 'You'
           else coalesce((select coalesce(m.display_name, m.email) from public.company_members m
                          where m.company_id = e.company_id and m.user_id = e.deleted_by limit 1), 'A team member') end as "deletedBy",
      case when e.user_id = auth.uid() then 'You'
           else coalesce((select coalesce(m.display_name, m.email) from public.company_members m
                          where m.company_id = e.company_id and m.user_id = e.user_id limit 1), 'A team member') end as "owner",
      (select ev.total from public.estimate_versions ev where ev.estimate_id = e.id order by ev.version_number desc limit 1) as total,
      (select coalesce(jsonb_agg(jsonb_build_object('action', d.action, 'at', d.created_at, 'reason', d.reason,
          'by', case when d.actor_id = auth.uid() then 'You'
                     else coalesce((select coalesce(m.display_name, m.email) from public.company_members m
                                    where m.company_id = e.company_id and m.user_id = d.actor_id limit 1), 'A team member') end)
        order by d.created_at desc), '[]'::jsonb)
       from public.estimate_deletions d where d.estimate_id = e.id) as history
    from public.estimates e
    where e.deleted_at is not null
      and ((e.company_id is null and e.user_id = auth.uid())
           or (e.company_id is not null and e.company_id = public.my_company_id()))
      and public.can_manage_deleted_estimate(e.user_id, e.company_id)
    order by e.deleted_at desc
    limit 500
  ) x
$$;
revoke execute on function public.deleted_estimates_list() from public, anon;
grant execute on function public.deleted_estimates_list() to authenticated;

-- Rollback (manual):
--   restore the two estimates policies from 20261114005000_enterprise_workspace.sql (without deleted_at);
--   update public.estimates set status = coalesce(deleted_prev_status, status) where deleted_at is not null;
--   drop function public.deleted_estimates_list(); drop function public.restore_estimate(uuid);
--   drop function public.delete_estimate(uuid, text); drop function public.can_manage_deleted_estimate(uuid, uuid);
--   drop table public.estimate_deletions;
--   alter table public.estimates drop column deleted_prev_status, drop column deleted_reason, drop column deleted_by, drop column deleted_at;
