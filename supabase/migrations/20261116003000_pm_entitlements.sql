-- V4 Phase 5: Project management (scheduling) entitlements and add-on billing.
--
-- Pricing model (Stripe prices are configured separately; see docs/pipeline/V4_SALES_PIPELINE.md):
--   Standard Unlimited   optional PM add-on, $4.99/month, one scheduling editor (the subscriber).
--   Enterprise           one PM editor included; extra editors $1.99/month each (subscription item quantity).
--   Complimentary        Unlimited grants do NOT include PM; Enterprise grants include 1 editor.
--                        A platform admin can override either with complimentary_grants.pm_editors.
-- PM editors are separate from Enterprise licensed users and never change them. An editor must be an
-- active licensed member of the company.
--
-- Removal policy:
--   Standard add-on: removed from the subscription with no refund; editing stays on until the end of the
--   period already paid for (pm_addon_until), then the account keeps read-only access to its schedules.
--   Enterprise extra editors: removed immediately with a prorated credit (same as licensed users).
-- Schedule data is never deleted when an add-on ends.
--
-- Safe to run more than once.

-- 1. Billing mirror on subscriptions (written only by the Stripe webhook / server through apply_pm_update).
alter table public.subscriptions add column if not exists pm_addon boolean not null default false;
alter table public.subscriptions add column if not exists pm_addon_until timestamptz;
alter table public.subscriptions add column if not exists pm_extra_editors integer not null default 0;
do $$ begin
  alter table public.subscriptions add constraint subscriptions_pm_extra_editors_check check (pm_extra_editors between 0 and 1000);
exception when duplicate_object then null; end $$;

create or replace function public.apply_pm_update(
  p_stripe_subscription_id text,
  p_pm_addon boolean,
  p_pm_extra_editors integer,
  p_event_created timestamptz
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  update public.subscriptions s set
    -- Turning the add-on off keeps editing until the end of the paid period.
    pm_addon_until = case
      when coalesce(p_pm_addon, false) then null
      when s.pm_addon then coalesce(s.current_period_end, now())
      else s.pm_addon_until end,
    pm_addon = coalesce(p_pm_addon, false),
    pm_extra_editors = greatest(coalesce(p_pm_extra_editors, 0), 0)
  where s.stripe_subscription_id = p_stripe_subscription_id
    and s.source_event_created <= p_event_created;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;
revoke all on function public.apply_pm_update(text, boolean, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_pm_update(text, boolean, integer, timestamptz) to service_role;

-- 2. Complimentary exception: null = plan default (Unlimited 0, Enterprise 1).
alter table public.complimentary_grants add column if not exists pm_editors integer;
do $$ begin
  alter table public.complimentary_grants add constraint complimentary_grants_pm_editors_check check (pm_editors is null or pm_editors between 0 and 50);
exception when duplicate_object then null; end $$;

-- 3. Enterprise editor assignments.
create table if not exists public.pm_editors (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
alter table public.pm_editors enable row level security;
drop policy if exists pm_editors_member_select on public.pm_editors;
create policy pm_editors_member_select on public.pm_editors for select to authenticated
  using (public.is_active_company_member(company_id));
-- No insert/update/delete policies: changes go through company_pm_assign().

-- 4. Entitlement. scope: company | individual | none.
--    editor_limit: editors the account may have; can_edit: this person may edit schedules now.
create or replace function public.pm_entitlement(p_user_id uuid)
returns table (scope text, company_id uuid, editor_limit integer, editors_assigned integer, can_edit boolean, source text, edit_until timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid; v_ent record; v_paid integer; v_comp integer; v_limit integer; v_rank integer; v_assigned integer;
  v_sub record; v_grant integer;
begin
  if p_user_id is null then return query select 'none'::text, null::uuid, 0, 0, false, null::text, null::timestamptz; return; end if;

  select m.company_id into v_company from public.company_members m where m.user_id = p_user_id and m.status = 'active';
  if v_company is not null then
    select * into v_ent from public.company_entitlement(v_company);
    if v_ent.active then
      select case when count(*) > 0 then 1 + coalesce(max(s.pm_extra_editors), 0) end into v_paid from public.subscriptions s
       where s.company_id = v_company and s.plan = 'enterprise' and s.status in ('active', 'trialing', 'past_due')
         and (s.current_period_end is null or s.current_period_end > now());
      select max(coalesce(g.pm_editors, 1)) into v_comp from public.complimentary_grants g
       where g.company_id = v_company and g.plan = 'enterprise' and g.status = 'active'
         and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now());
      -- Paid: 1 included + extra editors bought. Complimentary: grant setting (default 1). Best of both.
      v_limit := greatest(coalesce(v_paid, 0), coalesce(v_comp, 0));
      -- Only active members count; the earliest assignments win if the limit drops.
      select count(*)::int into v_assigned from public.pm_editors e
        join public.company_members m on m.company_id = e.company_id and m.user_id = e.user_id and m.status = 'active'
       where e.company_id = v_company;
      select r.rn into v_rank from (
        select e.user_id, row_number() over (order by e.assigned_at, e.user_id) rn from public.pm_editors e
          join public.company_members m on m.company_id = e.company_id and m.user_id = e.user_id and m.status = 'active'
         where e.company_id = v_company) r where r.user_id = p_user_id;
      return query select 'company'::text, v_company, v_limit, v_assigned, coalesce(v_rank <= v_limit, false), v_ent.source, v_ent.expires_at;
      return;
    end if;
  end if;

  -- Individual: add-on on the person's own Unlimited subscription (or within the paid period after removal).
  select s.pm_addon, s.pm_addon_until, s.current_period_end into v_sub from public.subscriptions s
   where s.user_id = p_user_id and coalesce(s.plan, '') <> 'enterprise'
     and s.status in ('active', 'trialing', 'past_due') and (s.current_period_end is null or s.current_period_end > now())
     and (s.pm_addon or (s.pm_addon_until is not null and s.pm_addon_until > now()))
   order by s.pm_addon desc, s.current_period_end desc nulls first limit 1;
  if found then
    return query select 'individual'::text, null::uuid, 1, 1, true, 'subscription'::text,
      case when v_sub.pm_addon then v_sub.current_period_end else v_sub.pm_addon_until end;
    return;
  end if;

  -- Owner-authorized complimentary exception on a personal grant.
  select max(g.pm_editors) into v_grant from public.complimentary_grants g
   where g.user_id = p_user_id and g.status = 'active' and coalesce(g.pm_editors, 0) > 0
     and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now());
  if v_grant is not null then
    return query select 'individual'::text, null::uuid, 1, 1, true, 'complimentary'::text,
      (select max(g.expires_at) from public.complimentary_grants g where g.user_id = p_user_id and g.status = 'active' and coalesce(g.pm_editors, 0) > 0);
    return;
  end if;

  return query select 'none'::text, null::uuid, 0, 0, false, null::text, null::timestamptz;
end $$;
revoke execute on function public.pm_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.pm_entitlement(uuid) to service_role;

-- Browser-safe: the caller's own PM access plus add-on billing state.
create or replace function public.my_pm_access() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e record; s record;
begin
  select * into e from public.pm_entitlement(auth.uid());
  select sub.pm_addon, sub.pm_addon_until, sub.pm_extra_editors, sub.plan, sub.current_period_end into s
    from public.subscriptions sub where sub.user_id = auth.uid() and sub.status in ('active', 'trialing', 'past_due')
    order by sub.current_period_end desc nulls first limit 1;
  return jsonb_build_object(
    'scope', e.scope, 'companyId', e.company_id, 'editorLimit', e.editor_limit, 'editorsAssigned', e.editors_assigned,
    'canEdit', e.can_edit, 'source', e.source, 'editUntil', e.edit_until,
    'addon', coalesce(s.pm_addon, false), 'addonUntil', s.pm_addon_until, 'extraEditors', coalesce(s.pm_extra_editors, 0)
  );
end $$;
revoke execute on function public.my_pm_access() from public, anon;
grant execute on function public.my_pm_access() to authenticated;

-- Server-side checks for later phases (schedule edits validate with this).
create or replace function public.can_edit_schedules() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select e.can_edit from public.pm_entitlement(auth.uid()) e), false)
$$;
revoke execute on function public.can_edit_schedules() from public, anon;
grant execute on function public.can_edit_schedules() to authenticated;

-- 5. Assign / unassign an Enterprise editor (manage_users or manage_billing).
create or replace function public.company_pm_assign(p_user_id uuid, p_assign boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_limit integer; v_assigned integer;
begin
  v_company := public.my_company_id();
  if v_company is null or not (public.has_company_permission(v_company, 'manage_users') or public.has_company_permission(v_company, 'manage_billing')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = p_user_id and m.status = 'active') then
    raise exception 'not_member' using errcode = 'P0002';
  end if;
  if p_assign then
    if exists (select 1 from public.pm_editors where company_id = v_company and user_id = p_user_id) then
      return jsonb_build_object('ok', true, 'changed', false);
    end if;
    select e.editor_limit, e.editors_assigned into v_limit, v_assigned
      from public.pm_entitlement((select m.user_id from public.company_members m where m.company_id = v_company and m.role = 'owner')) e;
    if coalesce(v_assigned, 0) >= coalesce(v_limit, 0) then
      raise exception 'editor_limit' using errcode = 'P0001';
    end if;
    insert into public.pm_editors (company_id, user_id, assigned_by) values (v_company, p_user_id, auth.uid());
  else
    delete from public.pm_editors where company_id = v_company and user_id = p_user_id;
    if not found then return jsonb_build_object('ok', true, 'changed', false); end if;
  end if;
  insert into public.company_audit_log (company_id, actor_id, action, target_type, target_id, details)
    values (v_company, auth.uid(), case when p_assign then 'pm.editor_assigned' else 'pm.editor_removed' end, 'user', p_user_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'changed', true);
end $$;
revoke execute on function public.company_pm_assign(uuid, boolean) from public, anon;
grant execute on function public.company_pm_assign(uuid, boolean) to authenticated;

-- Admin rows now include the PM editor setting.
create or replace function public.comp_admin_row(g public.complimentary_grants) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', g.id, 'email', g.email, 'user_id', g.user_id, 'plan', g.plan, 'state', public.comp_grant_state(g),
    'status', g.status, 'duration_days', g.duration_days, 'included_seats', g.included_seats, 'extra_seats', g.extra_seats,
    'company_id', g.company_id, 'starts_at', g.starts_at, 'expires_at', g.expires_at, 'paused_at', g.paused_at,
    'activated_at', g.activated_at, 'invite_expires_at', g.invite_expires_at, 'invite_sent_at', g.invite_sent_at,
    'invite_send_count', g.invite_send_count, 'pm_editors', g.pm_editors, 'note', g.note, 'created_at', g.created_at,
    'revoked_at', g.revoked_at, 'revoke_reason', g.revoke_reason,
    'granted_by_email', (select u.email from auth.users u where u.id = g.granted_by),
    'account_name', (select nullif(bp.company_name, '') from public.business_profiles bp where bp.user_id = g.user_id),
    'last_activity_at', greatest(
      (select max(e.updated_at) from public.estimates e where e.user_id = g.user_id),
      (select u.last_sign_in_at from auth.users u where u.id = g.user_id)),
    'paid_now', g.user_id is not null and public.has_paid_subscription(g.user_id),
    'converted', g.user_id is not null and not g.had_paid_subscription and exists (
      select 1 from public.subscriptions s where s.user_id = g.user_id
        and s.status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'paused'))
  )
$$;

-- 6. Platform owner: set a grant's PM editors (null = plan default).
create or replace function public.admin_comp_set_pm_editors(p_caller uuid, p_id uuid, p_editors integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.complimentary_grants; v_old integer;
begin
  perform public.comp_require_admin(p_caller);
  if p_editors is not null and (p_editors < 0 or p_editors > 50) then raise exception 'invalid_seats' using errcode = '22023'; end if;
  select * into g from public.complimentary_grants where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if g.status = 'revoked' then raise exception 'revoked' using errcode = 'P0001'; end if;
  v_old := g.pm_editors;
  update public.complimentary_grants set pm_editors = p_editors where id = p_id returning * into g;
  perform public.comp_audit(p_caller, 'comp.pm_editors', g.id, jsonb_build_object('old', v_old, 'new', p_editors));
  return public.comp_admin_row(g);
end $$;
revoke all on function public.admin_comp_set_pm_editors(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_comp_set_pm_editors(uuid, uuid, integer) to service_role;
