-- Sales Hub V8.3: dual roles and capability-based permissions.
--
-- One login can be a Sales Rep, a Sales Administrator, or both, and the platform owner can also sell.
-- Permissions are capabilities computed on the server from three separate sources, never from the
-- page the person is looking at:
--   * Sales Rep: an active sales_reps row with sells = true. Sees only their own leads and customers.
--   * Sales Administrator: an active sales_reps row with role = 'admin'. Runs the team, but cannot edit
--     commission policy, adjust commission amounts or record payouts.
--   * Platform Owner: admin_roles (is_admin). Everything, including policy and payouts.
-- An Enterprise company admin is a customer role and grants nothing here.
--
-- The "My Sales Hub | Admin Sales Hub" switcher in the app only chooses which view to show. Every
-- admin_* function still checks the caller's capabilities in the database.

-- ---------------------------------------------------------------------------------------------------
-- 1. Roles on the sales team
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_reps drop constraint if exists sales_reps_role_check;
alter table public.sales_reps add constraint sales_reps_role_check check (role in ('rep', 'manager', 'admin'));
-- false = an administrator who does not sell (no personal hub, link or commissions).
alter table public.sales_reps add column if not exists sells boolean not null default true;
-- Only administrators can be non-selling; a plain rep always sells.
alter table public.sales_reps drop constraint if exists sales_reps_sells_role;
alter table public.sales_reps add constraint sales_reps_sells_role check (sells or role = 'admin');

-- ---------------------------------------------------------------------------------------------------
-- 2. Capabilities
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_capabilities(p_user uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps; v_owner boolean; caps text[] := '{}';
begin
  if p_user is null then return caps; end if;
  v_owner := public.is_admin(p_user);
  select * into rep from public.sales_reps where user_id = p_user and status = 'active';
  if found and rep.sells then
    caps := caps || array['view_own_leads', 'edit_own_leads', 'import_own_leads', 'send_own_outreach', 'view_own_commissions'];
  end if;
  if v_owner or (found and rep.role = 'admin') then
    caps := caps || array['view_admin_hub', 'view_all_reps', 'view_all_leads', 'reassign_leads', 'approve_commissions',
                          'review_compliance', 'manage_reps', 'export_reports', 'set_team_goals'];
  end if;
  if v_owner then
    caps := caps || array['edit_commission_policies', 'adjust_commissions', 'payout_operations', 'manage_sales_admins', 'platform_owner'];
  end if;
  return caps;
end $$;

-- For the signed-in person (the app's view switcher and navigation). Read-only.
create or replace function public.sales_my_capabilities() returns text[]
language sql stable security definer set search_path = public as $$
  select public.sales_capabilities(auth.uid())
$$;

create or replace function public.sales_require_cap(p_caller uuid, p_cap text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_caller is null or not (p_cap = any (public.sales_capabilities(p_caller))) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
end $$;

-- Every admin_sales_* function calls this first. It now admits Sales Administrators as well as the
-- platform owner; the owner-only functions below add a second, stricter check.
create or replace function public.sales_require_admin(p_caller uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'view_admin_hub');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Owner-only and separation-of-duties wrappers
--    The original function is renamed to *_v82 (still service-role only) and a wrapper with the
--    original name adds the stricter check, so the tested bodies are not copied or changed.
-- ---------------------------------------------------------------------------------------------------
alter function public.admin_sales_settings_save(uuid, text, text, text, integer, integer, boolean, text, boolean) rename to admin_sales_settings_save_v82;
create or replace function public.admin_sales_settings_save(
  p_caller uuid, p_annual_basis text, p_refund_policy text, p_value_scope text, p_commission_years integer,
  p_attribution_window_days integer, p_confirm boolean, p_note text, p_first_month_cancel boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  return public.admin_sales_settings_save_v82(p_caller, p_annual_basis, p_refund_policy, p_value_scope, p_commission_years,
    p_attribution_window_days, p_confirm, p_note, p_first_month_cancel);
end $$;

-- The legacy 7-argument form (pre-V8) is retired: the app only uses the versioned form above.
alter function public.admin_sales_settings_save(uuid, text, text, text, integer, integer, boolean) rename to admin_sales_settings_save_v1;
revoke execute on function public.admin_sales_settings_save_v1(uuid, text, text, text, integer, integer, boolean) from service_role;

alter function public.admin_sales_milestone_rules_save(uuid, integer, jsonb, integer, jsonb, text) rename to admin_sales_milestone_rules_save_v82;
create or replace function public.admin_sales_milestone_rules_save(p_caller uuid, p_every integer, p_rates jsonb, p_min_cents integer, p_flat jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  return public.admin_sales_milestone_rules_save_v82(p_caller, p_every, p_rates, p_min_cents, p_flat, p_note);
end $$;

alter function public.admin_sales_payout_record(uuid, uuid, text, text, date) rename to admin_sales_payout_record_v82;
create or replace function public.admin_sales_payout_record(p_caller uuid, p_statement uuid, p_method text, p_reference text, p_paid_on date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'payout_operations');
  return public.admin_sales_payout_record_v82(p_caller, p_statement, p_method, p_reference, p_paid_on);
end $$;

alter function public.admin_sales_commission_set(uuid, uuid, text, integer, text) rename to admin_sales_commission_set_v82;
create or replace function public.admin_sales_commission_set(p_caller uuid, p_id uuid, p_status text, p_amount_cents integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'adjust_commissions');
  return public.admin_sales_commission_set_v82(p_caller, p_id, p_status, p_amount_cents, p_reason);
end $$;

-- True when the caller would be approving their own pay. Only the platform owner may do that.
create or replace function public.sales_is_own_rep(p_caller uuid, p_rep uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.is_admin(p_caller) and exists (select 1 from public.sales_reps where id = p_rep and user_id = p_caller)
$$;

alter function public.admin_sales_statement_approve(uuid, uuid) rename to admin_sales_statement_approve_v82;
create or replace function public.admin_sales_statement_approve(p_caller uuid, p_statement uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'approve_commissions');
  if public.sales_is_own_rep(p_caller, (select rep_id from public.sales_statements where id = p_statement)) then
    raise exception 'cannot_approve_own' using errcode = '42501';
  end if;
  return public.admin_sales_statement_approve_v82(p_caller, p_statement);
end $$;

alter function public.admin_sales_milestone_approve(uuid, uuid) rename to admin_sales_milestone_approve_v82;
create or replace function public.admin_sales_milestone_approve(p_caller uuid, p_award uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'approve_commissions');
  if public.sales_is_own_rep(p_caller, (select rep_id from public.sales_milestone_awards where id = p_award)) then
    raise exception 'cannot_approve_own' using errcode = '42501';
  end if;
  return public.admin_sales_milestone_approve_v82(p_caller, p_award);
end $$;

alter function public.admin_sales_milestone_void(uuid, uuid, text) rename to admin_sales_milestone_void_v82;
create or replace function public.admin_sales_milestone_void(p_caller uuid, p_award uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'approve_commissions');
  if public.sales_is_own_rep(p_caller, (select rep_id from public.sales_milestone_awards where id = p_award)) then
    raise exception 'cannot_approve_own' using errcode = '42501';
  end if;
  perform public.admin_sales_milestone_void_v82(p_caller, p_award, p_reason);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Team members: the owner can also sell, and only the owner makes someone a Sales Administrator
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_sales_member_save(
  p_caller uuid, p_id uuid, p_email text, p_full_name text, p_phone text, p_role text, p_status text, p_payout_note text, p_sells boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rep public.sales_reps;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_sells boolean := coalesce(p_sells, true) or p_role <> 'admin';
  v_old_role text;
begin
  perform public.sales_require_cap(p_caller, 'manage_reps');
  if p_role not in ('rep', 'manager', 'admin') then raise exception 'invalid_role'; end if;
  if p_status not in ('invited', 'active', 'suspended', 'removed') then raise exception 'invalid_status'; end if;
  if p_id is not null then
    select * into rep from public.sales_reps where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    v_old_role := rep.role;
  end if;
  -- Granting, changing or removing the Sales Administrator role is the platform owner's call.
  if (p_role = 'admin' or (p_id is not null and rep.role = 'admin')) and not public.is_admin(p_caller) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  -- Nobody edits their own team record (role, status or pay note) except the platform owner.
  if p_id is not null and rep.user_id = p_caller and not public.is_admin(p_caller) then
    raise exception 'cannot_edit_self' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.sales_reps (email, full_name, phone, role, sells, status, code, payout_note, invited_by, user_id, activated_at)
    values (v_email, btrim(p_full_name), nullif(btrim(coalesce(p_phone, '')), ''), p_role, v_sells, 'invited', public.sales_new_code(),
            nullif(btrim(coalesce(p_payout_note, '')), ''), p_caller, null, null)
    returning * into rep;
    perform public.sales_audit(p_caller, 'sales.rep_invited', 'sales_rep', rep.id::text, jsonb_build_object('email', v_email, 'role', p_role, 'sells', v_sells));
  else
    update public.sales_reps set
      email = case when user_id is null then v_email else email end,
      full_name = btrim(p_full_name), phone = nullif(btrim(coalesce(p_phone, '')), ''), role = p_role, sells = v_sells,
      status = case when p_status = 'active' and user_id is null then 'invited' when p_status = 'invited' and user_id is not null then 'active' else p_status end,
      payout_note = nullif(btrim(coalesce(p_payout_note, '')), ''), updated_at = now()
    where id = p_id returning * into rep;
    perform public.sales_audit(p_caller, case when v_old_role is distinct from rep.role then 'sales.rep_role_changed' else 'sales.rep_updated' end,
      'sales_rep', rep.id::text, jsonb_build_object('role', rep.role, 'status', rep.status, 'sells', rep.sells));
  end if;
  return to_jsonb(rep);
end $$;

-- The old entry point keeps working (same checks, always a selling member).
create or replace function public.admin_sales_rep_save(
  p_caller uuid, p_id uuid, p_email text, p_full_name text, p_phone text, p_role text, p_status text, p_payout_note text
) returns jsonb
language sql security definer set search_path = public as $$
  select public.admin_sales_member_save(p_caller, p_id, p_email, p_full_name, p_phone, p_role, p_status, p_payout_note, true)
$$;

-- sales_me also reports whether the person sells, so the app can route an admin-only member.
create or replace function public.sales_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rep public.sales_reps;
  v_email text; v_confirmed timestamptz;
begin
  if auth.uid() is null then return null; end if;
  select * into rep from public.sales_reps where user_id = auth.uid();
  if not found then
    select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
    if v_email is null or v_confirmed is null then return null; end if;
    update public.sales_reps set user_id = auth.uid(), status = case when status = 'invited' then 'active' else status end,
      activated_at = coalesce(activated_at, now()), updated_at = now()
    where email = v_email and user_id is null and status in ('invited', 'active')
    returning * into rep;
    if not found then return null; end if;
  end if;
  if rep.status not in ('active') then return jsonb_build_object('status', rep.status); end if;
  return jsonb_build_object('id', rep.id, 'full_name', rep.full_name, 'email', rep.email, 'role', rep.role, 'status', rep.status,
    'code', rep.code, 'sells', rep.sells);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Admin reporting (admin APIs, never impersonation)
-- ---------------------------------------------------------------------------------------------------
-- One row per selling team member. Each sale belongs to exactly one rep, so totals never double count.
-- is_admin_rep marks members who are also administrators (Sales Admin or Platform Owner) so the app
-- can include or exclude them.
create or replace function public.sales_rep_metrics(p_rep uuid, p_since timestamptz, p_until timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'leads', (select count(*) from public.sales_leads l where l.assigned_rep = p_rep),
    'leads_new', (select count(*) from public.sales_leads l where l.assigned_rep = p_rep and l.created_at >= p_since and l.created_at < p_until),
    'contacted', (select count(distinct a.lead_id) from public.sales_activities a where a.rep_id = p_rep and a.kind in ('call', 'email', 'text', 'meeting') and a.occurred_at >= p_since and a.occurred_at < p_until),
    'calls', (select count(*) from public.sales_activities a where a.rep_id = p_rep and a.kind = 'call' and a.occurred_at >= p_since and a.occurred_at < p_until),
    'emails', (select count(*) from public.sales_activities a where a.rep_id = p_rep and a.kind = 'email' and a.occurred_at >= p_since and a.occurred_at < p_until),
    'texts', (select count(*) from public.sales_activities a where a.rep_id = p_rep and a.kind = 'text' and a.occurred_at >= p_since and a.occurred_at < p_until),
    'meetings', (select count(*) from public.sales_activities a where a.rep_id = p_rep and a.kind = 'meeting' and a.occurred_at >= p_since and a.occurred_at < p_until),
    'follow_ups', (select count(distinct (a.lead_id, date_trunc('day', a.occurred_at))) from public.sales_activities a where a.rep_id = p_rep and a.kind in ('call', 'text', 'meeting', 'note') and a.occurred_at >= p_since and a.occurred_at < p_until),
    'tasks_overdue', (select count(*) from public.sales_tasks t where t.rep_id = p_rep and t.done_at is null and t.due_at < now()),
    'demos', (select count(*) from public.sales_leads l where l.assigned_rep = p_rep and l.stage = 'demo'),
    'trials', (select count(*) from public.sales_attributions x where x.rep_id = p_rep and x.sub_status = 'trialing'),
    'closed', (select count(*) from public.sales_attributions x where x.rep_id = p_rep and x.first_paid_at >= p_since and x.first_paid_at < p_until),
    'active_customers', (select count(*) from public.sales_attributions x where x.rep_id = p_rep and x.ended_at is null and x.sub_status in ('active', 'trialing', 'past_due')),
    'visits', (select count(*) from public.sales_link_events e where e.rep_id = p_rep and e.kind = 'visit' and e.created_at >= p_since and e.created_at < p_until),
    'signups', (select count(*) from public.sales_link_events e where e.rep_id = p_rep and e.kind = 'signup' and e.created_at >= p_since and e.created_at < p_until),
    'commission_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.rep_id = p_rep and c.status in ('earned', 'approved', 'paid') and c.created_at >= p_since and c.created_at < p_until),
    'pending_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.rep_id = p_rep and c.status = 'pending'),
    'unpaid_cents', (select coalesce(sum(s.total_cents), 0) from public.sales_statements s where s.rep_id = p_rep and s.status = 'approved'),
    'milestones', (select count(*) from public.sales_milestone_awards m where m.rep_id = p_rep and m.status <> 'void')
  )
$$;

create or replace function public.admin_sales_analytics(p_caller uuid, p_since timestamptz, p_until timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'view_all_reps');
  return jsonb_build_object('since', p_since, 'until', p_until, 'reps', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'full_name', r.full_name, 'role', r.role, 'status', r.status,
      'is_admin_rep', r.role = 'admin' or coalesce(public.is_admin(r.user_id), false),
      'metrics', public.sales_rep_metrics(r.id, p_since, p_until)) order by r.full_name)
    from public.sales_reps r where r.sells and r.status in ('active', 'suspended')), '[]'::jsonb));
end $$;

-- "Viewing Sarah's Sales Activity": one rep's numbers, weekly trend, leads and customers. Every view is
-- written to the audit log.
create or replace function public.admin_sales_rep_detail(p_caller uuid, p_rep uuid, p_since timestamptz, p_until timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  perform public.sales_require_cap(p_caller, 'view_all_reps');
  select * into rep from public.sales_reps where id = p_rep;
  if not found then raise exception 'not_found'; end if;
  perform public.sales_audit(p_caller, 'sales.rep_detail_viewed', 'sales_rep', p_rep::text, jsonb_build_object('since', p_since, 'until', p_until));
  return jsonb_build_object(
    'rep', jsonb_build_object('id', rep.id, 'full_name', rep.full_name, 'email', rep.email, 'role', rep.role, 'status', rep.status,
      'sells', rep.sells, 'activated_at', rep.activated_at, 'is_admin_rep', rep.role = 'admin' or coalesce(public.is_admin(rep.user_id), false)),
    'since', p_since, 'until', p_until,
    'metrics', public.sales_rep_metrics(rep.id, p_since, p_until),
    'stages', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from public.sales_leads where assigned_rep = rep.id group by stage) s), '{}'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object('week', w.wk,
        'contacted', (select count(distinct a.lead_id) from public.sales_activities a where a.rep_id = rep.id and a.kind in ('call', 'email', 'text', 'meeting') and a.occurred_at >= w.wk and a.occurred_at < w.wk + interval '7 days'),
        'calls', (select count(*) from public.sales_activities a where a.rep_id = rep.id and a.kind = 'call' and a.occurred_at >= w.wk and a.occurred_at < w.wk + interval '7 days'),
        'emails', (select count(*) from public.sales_activities a where a.rep_id = rep.id and a.kind = 'email' and a.occurred_at >= w.wk and a.occurred_at < w.wk + interval '7 days'),
        'closed', (select count(*) from public.sales_attributions x where x.rep_id = rep.id and x.first_paid_at >= w.wk and x.first_paid_at < w.wk + interval '7 days')) order by w.wk)
      from (select generate_series(date_trunc('week', p_until) - interval '11 weeks', date_trunc('week', p_until), interval '1 week') wk) w), '[]'::jsonb),
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'company_name', l.company_name, 'stage', l.stage, 'last_activity_at', l.last_activity_at,
        'next_action_at', l.next_action_at, 'do_not_contact', l.do_not_contact) order by l.last_activity_at desc nulls last)
      from (select * from public.sales_leads where assigned_rep = rep.id order by last_activity_at desc nulls last limit 50) l), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object('company', nullif(bp.company_name, ''), 'plan', x.plan, 'sub_status', x.sub_status,
        'first_paid_at', x.first_paid_at, 'ended_at', x.ended_at) order by x.attributed_at desc)
      from (select * from public.sales_attributions where rep_id = rep.id order by attributed_at desc limit 100) x
      left join public.business_profiles bp on bp.user_id = x.user_id), '[]'::jsonb),
    'statements', coalesce((
      select jsonb_agg(jsonb_build_object('period_month', s.period_month, 'status', s.status, 'total_cents', s.total_cents) order by s.period_month desc)
      from (select * from public.sales_statements where rep_id = rep.id order by period_month desc limit 12) s), '[]'::jsonb));
end $$;

-- Role details for the team list: who sells, who is an administrator, which row is the caller's own.
create or replace function public.admin_sales_members(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'view_all_reps');
  return coalesce((select jsonb_object_agg(r.id, jsonb_build_object('sells', r.sells, 'role', r.role,
    'is_owner', coalesce(public.is_admin(r.user_id), false), 'is_me', r.user_id = p_caller)) from public.sales_reps r), '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. One notification list for the signed-in person, in two categories. Personal items are about their
--    own selling; administrative items about the team. Each item appears once (no duplicates), and
--    administrative items never include the person's own pay (they can't approve it).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_my_notifications() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  caps text[] := public.sales_capabilities(auth.uid());
  rep public.sales_reps;
  v_owner boolean := public.is_admin(auth.uid());
  items jsonb := '[]'::jsonb;
  n integer;
begin
  if v_uid is null then return items; end if;
  select * into rep from public.sales_reps where user_id = v_uid and status = 'active';
  if 'view_own_leads' = any (caps) then
    select count(*) into n from public.sales_tasks where rep_id = rep.id and done_at is null and due_at < now();
    if n > 0 then items := items || jsonb_build_object('category', 'personal', 'kind', 'tasks_overdue', 'count', n, 'href', '/sales/leads'); end if;
    select count(*) into n from public.sales_milestone_awards where rep_id = rep.id and status = 'ready' and opened_at is null;
    if n > 0 then items := items || jsonb_build_object('category', 'personal', 'kind', 'box_ready', 'count', n, 'href', '/sales'); end if;
  end if;
  if 'view_admin_hub' = any (caps) then
    select count(*) into n from public.sales_statements s
      where s.status = 'open' and s.total_cents <> 0 and (v_owner or s.rep_id is distinct from rep.id);
    if n > 0 then items := items || jsonb_build_object('category', 'admin', 'kind', 'statements_to_approve', 'count', n, 'href', '/sales/admin?tab=statements'); end if;
    select count(*) into n from public.sales_milestone_awards w where w.status = 'ready' and (v_owner or w.rep_id is distinct from rep.id);
    if n > 0 then items := items || jsonb_build_object('category', 'admin', 'kind', 'boxes_to_approve', 'count', n, 'href', '/sales/admin?tab=commissions'); end if;
    select count(*) into n from public.sales_leads where assigned_rep is null and stage <> 'lost' and not do_not_contact;
    if n > 0 then items := items || jsonb_build_object('category', 'admin', 'kind', 'leads_unassigned', 'count', n, 'href', '/sales/admin?tab=leads&rep=none'); end if;
    if 'payout_operations' = any (caps) then
      select count(*) into n from public.sales_statements where status = 'approved';
      if n > 0 then items := items || jsonb_build_object('category', 'admin', 'kind', 'payouts_to_record', 'count', n, 'href', '/sales/admin?tab=statements'); end if;
    end if;
  end if;
  return items;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_capabilities(uuid)', 'public.sales_require_cap(uuid, text)', 'public.sales_is_own_rep(uuid, uuid)',
    'public.admin_sales_settings_save(uuid, text, text, text, integer, integer, boolean, text, boolean)',
    'public.admin_sales_milestone_rules_save(uuid, integer, jsonb, integer, jsonb, text)',
    'public.admin_sales_payout_record(uuid, uuid, text, text, date)', 'public.admin_sales_commission_set(uuid, uuid, text, integer, text)',
    'public.admin_sales_statement_approve(uuid, uuid)', 'public.admin_sales_milestone_approve(uuid, uuid)', 'public.admin_sales_milestone_void(uuid, uuid, text)',
    'public.admin_sales_member_save(uuid, uuid, text, text, text, text, text, text, boolean)',
    'public.admin_sales_rep_save(uuid, uuid, text, text, text, text, text, text)',
    'public.sales_rep_metrics(uuid, timestamptz, timestamptz)', 'public.admin_sales_analytics(uuid, timestamptz, timestamptz)',
    'public.admin_sales_rep_detail(uuid, uuid, timestamptz, timestamptz)', 'public.admin_sales_members(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke execute on function public.sales_my_capabilities(), public.sales_my_notifications() from public, anon;
grant execute on function public.sales_my_capabilities(), public.sales_my_notifications() to authenticated;
revoke execute on function public.sales_me() from public, anon;
grant execute on function public.sales_me() to authenticated;
