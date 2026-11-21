-- Rollback for 20270212001000_qa_cross_system.sql: restores the three functions exactly as they were before it.
-- 1. payout_plan (from 20270207001000_staff_payouts.sql)
create or replace function public.payout_plan(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payout_settings; f public.payout_fee_policies; r record; m public.staff_members; p public.payouts;
  v_mode text; v_created integer := 0; v_refreshed integer := 0; v_fee integer; fb record; v_blockers text[]; v_status text; v_gross integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('payout_plan')) then return jsonb_build_object('skipped', 'locked'); end if;
  select * into s from public.payout_settings where id;
  if s.mode = 'off' then return jsonb_build_object('skipped', 'automation_off'); end if;
  v_mode := s.mode;
  select * into f from public.payout_fee_policies where id = s.fee_policy_id;

  for r in
    select sm.id as staff_id, array_agg(st.id order by st.period_month) as statements, sum(st.total_cents)::integer as total
    from public.sales_statements st
    join public.staff_members sm on sm.sales_rep_id = st.rep_id
    where st.status = 'approved' and st.total_cents > 0
      and not exists (select 1 from public.sales_payouts sp where sp.statement_id = st.id)
      and not exists (select 1 from public.payout_items i where i.mode = v_mode and i.source_kind = 'sales_statement' and i.source_id = st.id and i.active)
      and sm.classification in ('contractor_1099', 'vendor')
    group by sm.id
  loop
    select * into m from public.staff_members where id = r.staff_id;
    v_gross := r.total;
    v_fee := public.payout_fee_cents(v_gross, 'standard', f);
    select * into fb from public.payout_fee_bearer(m, f, 'standard', v_gross, v_fee, s);
    v_blockers := public.payout_blockers(m.id, v_mode);
    if v_gross < s.min_payout_cents then v_blockers := array_append(v_blockers, 'below_minimum'); end if;
    v_status := case when cardinality(v_blockers) > 0 then 'held' when v_gross > s.review_above_cents then 'needs_approval' else 'scheduled' end;
    insert into public.payouts (ref, staff_id, mode, provider, gross_cents, fee_cents, fee_bearer, fee_reason, fee_policy_version, net_cents, status, hold_reasons,
      scheduled_for, idempotency_key, funding_source)
    values ('B2B-PO-' || to_char(p_now at time zone 'America/Chicago', 'YYYYMM') || '-' || lpad(nextval('public.payout_ref_seq')::text, 6, '0') || case when v_mode = 'test' then '-T' else '' end,
      m.id, v_mode, s.provider, v_gross, v_fee, fb.bearer, fb.reason, f.version,
      greatest(v_gross - case when fb.bearer = 'recipient' then v_fee else 0 end, 0), v_status, v_blockers,
      ((p_now at time zone 'America/Chicago')::date + s.pay_delay_days), gen_random_uuid()::text, s.funding_label)
    returning * into p;
    insert into public.payout_items (payout_id, mode, source_kind, source_id, amount_cents, description)
    select p.id, v_mode, 'sales_statement', st.id, st.total_cents, 'Sales statement ' || to_char(st.period_month, 'Mon YYYY')
    from public.sales_statements st where st.id = any (r.statements);
    v_created := v_created + 1;
  end loop;

  -- Re-check held payouts: a prerequisite fixed since the last run releases them.
  for p in select * from public.payouts where status = 'held' and mode = v_mode for update skip locked loop
    v_blockers := public.payout_blockers(p.staff_id, v_mode);
    if p.gross_cents < s.min_payout_cents then v_blockers := array_append(v_blockers, 'below_minimum'); end if;
    if cardinality(v_blockers) = 0 then
      update public.payouts set status = case when p.gross_cents > s.review_above_cents and p.approved_at is null then 'needs_approval' else 'scheduled' end,
        hold_reasons = '{}' where id = p.id;
      v_refreshed := v_refreshed + 1;
    elsif v_blockers is distinct from p.hold_reasons then
      update public.payouts set hold_reasons = v_blockers where id = p.id;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'released', v_refreshed, 'mode', v_mode);
end $$;


-- 2. admin_sales_attribution_set (from 20270107001000_sales_portal.sql)
create or replace function public.admin_sales_attribution_set(p_caller uuid, p_customer_email text, p_rep uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  prev public.sales_attributions;
  rep public.sales_reps;
begin
  perform public.sales_require_admin(p_caller);
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(coalesce(p_customer_email, ''))) limit 1;
  if v_user is null then raise exception 'customer_not_found'; end if;
  select * into rep from public.sales_reps where id = p_rep and status in ('active', 'invited', 'suspended');
  if not found then raise exception 'rep_not_found'; end if;
  if rep.user_id = v_user or exists (select 1 from public.sales_reps r where r.user_id = v_user and r.status <> 'removed') then raise exception 'customer_is_sales_staff'; end if;
  select * into prev from public.sales_attributions where user_id = v_user for update;
  if found then
    if prev.rep_id = p_rep and prev.ended_at is null then return jsonb_build_object('action', 'unchanged'); end if;
    update public.sales_attributions set rep_id = p_rep, source = 'manual', ended_at = null, ended_reason = null where user_id = v_user;
    insert into public.sales_attribution_history (user_id, from_rep, to_rep, action, reason, actor_id) values (v_user, prev.rep_id, p_rep, 'reassigned', btrim(p_reason), p_caller);
    perform public.sales_audit(p_caller, 'sales.attribution_reassigned', 'user', v_user::text, jsonb_build_object('from', prev.rep_id, 'to', p_rep, 'reason', btrim(p_reason)));
    return jsonb_build_object('action', 'reassigned');
  end if;
  insert into public.sales_attributions (user_id, rep_id, source) values (v_user, p_rep, 'manual');
  -- Bring in the current subscription so a later anniversary is recognized.
  update public.sales_attributions x set stripe_subscription_id = s.stripe_subscription_id, sub_status = s.status, plan = s.plan, company_id = s.company_id
  from (select * from public.subscriptions where user_id = v_user order by updated_at desc limit 1) s where x.user_id = v_user;
  insert into public.sales_attribution_history (user_id, to_rep, action, reason, actor_id) values (v_user, p_rep, 'assigned', btrim(p_reason), p_caller);
  perform public.sales_audit(p_caller, 'sales.attribution_assigned', 'user', v_user::text, jsonb_build_object('to', p_rep, 'reason', btrim(p_reason)));
  return jsonb_build_object('action', 'assigned');
end $$;


-- 3. admin_affiliate_dispute_resolve (from 20270211001000_affiliate_hub.sql), only while the Affiliate Hub is installed.
do $do$ begin
  if to_regclass('public.affiliate_referrals') is not null then
    execute $fn$create or replace function public.admin_affiliate_dispute_resolve(p_caller uuid, p_id uuid, p_outcome text, p_resolution text, p_target_affiliate uuid default null, p_target_rep uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x public.affiliate_disputes; r public.affiliate_referrals;
begin
  perform public.affiliate_require_admin(p_caller);
  if char_length(btrim(coalesce(p_resolution, ''))) < 5 then raise exception 'resolution_required' using errcode = '22023'; end if;
  select * into x from public.affiliate_disputes where id = p_id and status = 'open' for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if x.user_id is not null then select * into r from public.affiliate_referrals where user_id = x.user_id for update; end if;
  if p_outcome = 'reassigned_affiliate' then
    if r.user_id is null or p_target_affiliate is null then raise exception 'target_required' using errcode = '22023'; end if;
    update public.affiliate_referrals set affiliate_id = p_target_affiliate, attribution_source = 'admin' where user_id = r.user_id;
    insert into public.affiliate_referral_history (user_id, from_affiliate, to_affiliate, action, reason, actor) values (r.user_id, r.affiliate_id, p_target_affiliate, 'dispute_resolved', p_resolution, p_caller);
  elsif p_outcome = 'moved_to_sales' then
    if r.user_id is null or p_target_rep is null then raise exception 'target_required' using errcode = '22023'; end if;
    update public.affiliate_referrals set ended_at = now(), ended_reason = 'moved_to_sales: ' || left(p_resolution, 200) where user_id = r.user_id;
    insert into public.affiliate_referral_history (user_id, from_affiliate, action, reason, actor) values (r.user_id, r.affiliate_id, 'dispute_resolved', p_resolution, p_caller);
    insert into public.sales_attributions (user_id, rep_id, source) values (r.user_id, p_target_rep, 'manual') on conflict (user_id) do nothing;
    insert into public.sales_attribution_history (user_id, to_rep, action, reason) values (r.user_id, p_target_rep, 'assigned', 'affiliate dispute: ' || left(p_resolution, 200));
    update public.affiliate_commissions set status = 'canceled', reason = 'attribution_moved' where user_id = r.user_id and status in ('pending', 'payable') and payout_id is null;
  elsif p_outcome = 'removed' then
    if r.user_id is null then raise exception 'target_required' using errcode = '22023'; end if;
    update public.affiliate_referrals set ended_at = now(), ended_reason = left(p_resolution, 300) where user_id = r.user_id;
    insert into public.affiliate_referral_history (user_id, from_affiliate, action, reason, actor) values (r.user_id, r.affiliate_id, 'ended', p_resolution, p_caller);
    update public.affiliate_commissions set status = 'canceled', reason = 'attribution_removed' where user_id = r.user_id and status in ('pending', 'payable') and payout_id is null;
  elsif p_outcome = 'commission_restored' then
    update public.affiliate_commissions set status = 'pending', reason = 'restored_after_review' where id = x.commission_id and status in ('held', 'ineligible', 'canceled');
  elsif p_outcome = 'commission_canceled' then
    update public.affiliate_commissions set status = 'canceled', reason = 'canceled_after_review' where id = x.commission_id and status in ('pending', 'payable', 'held') and payout_id is null;
  elsif p_outcome not in ('kept', 'no_change') then raise exception 'bad_outcome' using errcode = '22023'; end if;
  update public.affiliate_disputes set status = 'resolved', outcome = p_outcome, resolution = left(btrim(p_resolution), 2000), resolved_by = p_caller, resolved_at = now() where id = p_id;
  perform public.affiliate_audit(p_caller, 'affiliate.dispute_resolved', coalesce(x.affiliate_id::text, x.id::text), jsonb_build_object('dispute', p_id, 'outcome', p_outcome));
  return jsonb_build_object('outcome', p_outcome);
end $$;$fn$;
  end if;
end $do$;
