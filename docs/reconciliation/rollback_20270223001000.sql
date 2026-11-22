-- Rollback for 20270223001000_commission_reconciliation.sql (Revenue & Commission Reconciliation).
-- Restores the four payout / QuickBooks functions to their previous definitions, then removes the new objects.
-- Commission, statement, payout and QuickBooks bill rows are untouched (only the three added bill columns go).
begin;
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
  -- Staff payouts only: affiliate payouts are re-checked by affiliate_payout_plan with their own blockers.
  for p in select * from public.payouts where status = 'held' and mode = v_mode and staff_id is not null for update skip locked loop
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

create or replace function public.affiliate_payout_plan(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payout_settings; cfg public.affiliate_settings; f public.payout_fee_policies; r record; p public.payouts; v_mode text; v_created integer := 0;
  v_blockers text[]; v_status text; v_fee integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('affiliate_payout_plan')) then return jsonb_build_object('skipped', 'locked'); end if;
  select * into s from public.payout_settings where id;
  select * into cfg from public.affiliate_settings where id;
  if s.mode = 'off' then return jsonb_build_object('skipped', 'automation_off'); end if;
  if not cfg.payouts_enabled then return jsonb_build_object('skipped', 'affiliate_payouts_off'); end if;
  v_mode := s.mode;
  select * into f from public.payout_fee_policies where id = s.fee_policy_id;
  for r in
    select c.affiliate_id, array_agg(c.id order by c.anniversary_date) as lines, sum(c.amount_cents)::integer as total
    from public.affiliate_commissions c
    where c.status = 'payable' and c.payout_id is null and c.amount_cents > 0
      and not exists (select 1 from public.payout_items i where i.mode = v_mode and i.source_kind = 'affiliate_commission' and i.source_id = c.id and i.active)
    group by c.affiliate_id
    having sum(c.amount_cents) >= cfg.min_payout_cents
  loop
    v_blockers := public.affiliate_payout_blockers(r.affiliate_id, v_mode);
    v_fee := public.payout_fee_cents(r.total, 'standard', f);
    v_status := case when cardinality(v_blockers) > 0 then 'held' when r.total > s.review_above_cents then 'needs_approval' else 'scheduled' end;
    insert into public.payouts (ref, affiliate_id, mode, provider, gross_cents, fee_cents, fee_bearer, fee_reason, fee_policy_version, net_cents, status, hold_reasons,
      scheduled_for, idempotency_key, funding_source)
    values ('B2B-AF-' || to_char(p_now at time zone 'America/Chicago', 'YYYYMM') || '-' || lpad(nextval('public.payout_ref_seq')::text, 6, '0') || case when v_mode = 'test' then '-T' else '' end,
      r.affiliate_id, v_mode, s.provider, r.total, v_fee, 'company', 'affiliate_program', f.version, r.total, v_status, v_blockers,
      ((p_now at time zone 'America/Chicago')::date + s.pay_delay_days), gen_random_uuid()::text, s.funding_label)
    returning * into p;
    insert into public.payout_items (payout_id, mode, source_kind, source_id, amount_cents, description)
    select p.id, v_mode, 'affiliate_commission', c.id, c.amount_cents, 'Year ' || c.year_no || ' commission (' || to_char(c.anniversary_date, 'Mon DD, YYYY') || ')'
    from public.affiliate_commissions c where c.id = any (r.lines);
    if v_mode = 'live' then update public.affiliate_commissions set payout_id = p.id where id = any (r.lines); end if;
    v_created := v_created + 1;
  end loop;
  -- Re-check held affiliate payouts.
  for p in select * from public.payouts where status = 'held' and mode = v_mode and affiliate_id is not null for update skip locked loop
    v_blockers := public.affiliate_payout_blockers(p.affiliate_id, v_mode);
    if cardinality(v_blockers) = 0 then
      update public.payouts set status = case when p.gross_cents > s.review_above_cents and p.approved_at is null then 'needs_approval' else 'scheduled' end, hold_reasons = '{}' where id = p.id;
    elsif v_blockers is distinct from p.hold_reasons then
      update public.payouts set hold_reasons = v_blockers where id = p.id;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'mode', v_mode);
end $$;

create or replace function public.qb_payout_candidates(p_env text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_live boolean;
begin
  select coalesce(mode = 'live', false) into v_live from public.payout_settings where id;
  return jsonb_build_object(
    'automation_live', coalesce(v_live, false),
    'items', coalesce((
      select jsonb_agg(x order by x->>'payee_name', x->>'period') from (
        select jsonb_build_object(
          'source_kind', 'sales_statement', 'source_id', st.id, 'payee_kind', 'sales_rep', 'payee_id', r.id,
          'payee_name', coalesce(nullif(btrim(concat_ws(' ', sm.legal_first_name, sm.legal_last_name)), ''), r.full_name),
          'given_name', sm.legal_first_name, 'family_name', sm.legal_last_name, 'email', coalesce(sm.email, r.email), 'phone', coalesce(sm.phone, r.phone),
          'line1', sm.address_line1, 'line2', sm.address_line2, 'city', sm.city, 'state', sm.state, 'postal_code', sm.postal_code,
          'amount_cents', st.total_cents, 'period', to_char(st.period_month, 'YYYY-MM'),
          'description', 'Sales commission statement ' || to_char(st.period_month, 'Mon YYYY'),
          'blockers', to_jsonb(public.qb_payee_blockers('sales_rep', r.id))) as x
        from public.sales_statements st
        join public.sales_reps r on r.id = st.rep_id
        left join public.staff_members sm on sm.sales_rep_id = r.id
        where st.status = 'approved' and st.total_cents > 0
          and not exists (select 1 from public.sales_payouts sp where sp.statement_id = st.id)
          and not exists (select 1 from public.payout_items i where i.mode = 'live' and i.source_kind = 'sales_statement' and i.source_id = st.id and i.active)
          and not exists (select 1 from public.qb_payout_bills b where b.source_kind = 'sales_statement' and b.source_id = st.id and b.environment = p_env and b.status in ('sending', 'open', 'paid'))
        union all
        select jsonb_build_object(
          'source_kind', 'affiliate_commission', 'source_id', c.id, 'payee_kind', 'affiliate', 'payee_id', a.id,
          'payee_name', coalesce(nullif(btrim(a.business_name), ''), nullif(btrim(a.legal_name), ''), nullif(btrim(a.display_name), ''), a.email),
          'given_name', null, 'family_name', null, 'email', a.email, 'phone', a.phone,
          'line1', a.address_line1, 'line2', a.address_line2, 'city', a.city, 'state', a.state, 'postal_code', a.postal_code,
          'amount_cents', c.amount_cents, 'period', to_char(c.anniversary_date, 'YYYY-MM'),
          'description', 'Affiliate commission, year ' || c.year_no || ' (' || to_char(c.anniversary_date, 'Mon YYYY') || ')',
          'blockers', to_jsonb(public.qb_payee_blockers('affiliate', a.id))) as x
        from public.affiliate_commissions c
        join public.affiliates a on a.id = c.affiliate_id
        where c.status = 'payable' and c.amount_cents > 0 and c.payout_id is null
          and (c.hold_until is null or c.hold_until <= now())
          and not exists (select 1 from public.payout_items i where i.mode = 'live' and i.source_kind = 'affiliate_commission' and i.source_id = c.id and i.active)
          and not exists (select 1 from public.qb_payout_bills b where b.source_kind = 'affiliate_commission' and b.source_id = c.id and b.environment = p_env and b.status in ('sending', 'open', 'paid'))
      ) q), '[]'::jsonb));
end $$;

create or replace function public.qb_payout_bill_reserve(p_caller uuid, p_source_kind text, p_source_id uuid, p_realm text, p_env text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_amount integer; v_payee uuid; v_pkind text; v_name text; v_desc text; v_doc text; v_block text[]; v_live boolean;
begin
  perform public.staff_require_owner(p_caller);
  if p_env not in ('sandbox', 'production') then raise exception 'invalid_env'; end if;
  select coalesce(mode = 'live', false) into v_live from public.payout_settings where id;
  if coalesce(v_live, false) then raise exception 'automation_live'; end if;
  perform pg_advisory_xact_lock(hashtext('qb_bill:' || p_source_kind || ':' || p_source_id));
  if p_source_kind = 'sales_statement' then
    select st.total_cents, r.id, coalesce(nullif(btrim(concat_ws(' ', sm.legal_first_name, sm.legal_last_name)), ''), r.full_name),
           'Sales commission statement ' || to_char(st.period_month, 'Mon YYYY'), 'B2B-S' || to_char(st.period_month, 'YYMM') || '-' || upper(left(replace(st.id::text, '-', ''), 8))
      into v_amount, v_payee, v_name, v_desc, v_doc
    from public.sales_statements st join public.sales_reps r on r.id = st.rep_id left join public.staff_members sm on sm.sales_rep_id = r.id
    where st.id = p_source_id and st.status = 'approved' and st.total_cents > 0
      and not exists (select 1 from public.sales_payouts sp where sp.statement_id = st.id)
      and not exists (select 1 from public.payout_items i where i.mode = 'live' and i.source_kind = 'sales_statement' and i.source_id = st.id and i.active)
    for update of st;
    v_pkind := 'sales_rep';
  elsif p_source_kind = 'affiliate_commission' then
    select c.amount_cents, a.id, coalesce(nullif(btrim(a.business_name), ''), nullif(btrim(a.legal_name), ''), nullif(btrim(a.display_name), ''), a.email),
           'Affiliate commission, year ' || c.year_no || ' (' || to_char(c.anniversary_date, 'Mon YYYY') || ')',
           'B2B-A' || to_char(c.anniversary_date, 'YYMM') || '-' || upper(left(replace(c.id::text, '-', ''), 8))
      into v_amount, v_payee, v_name, v_desc, v_doc
    from public.affiliate_commissions c join public.affiliates a on a.id = c.affiliate_id
    where c.id = p_source_id and c.status = 'payable' and c.amount_cents > 0 and c.payout_id is null and (c.hold_until is null or c.hold_until <= now())
      and not exists (select 1 from public.payout_items i where i.mode = 'live' and i.source_kind = 'affiliate_commission' and i.source_id = c.id and i.active)
    for update of c;
    v_pkind := 'affiliate';
  else
    raise exception 'invalid_source';
  end if;
  if v_payee is null then raise exception 'not_payable'; end if;
  v_block := public.qb_payee_blockers(v_pkind, v_payee);
  if cardinality(v_block) > 0 then raise exception 'blocked:%', array_to_string(v_block, ','); end if;
  insert into public.qb_payout_bills (source_kind, source_id, payee_kind, payee_id, payee_name, realm_id, environment, amount_cents, doc_number, description, created_by)
  values (p_source_kind, p_source_id, v_pkind, v_payee, left(v_name, 200), p_realm, p_env, v_amount, v_doc, v_desc, p_caller)
  returning id into v_id;
  perform public.staff_audit(p_caller, 'qb_payout.bill_reserved', p_source_kind, p_source_id::text, jsonb_build_object('bill', v_id, 'amount_cents', v_amount));
  return v_id;
exception when unique_violation then raise exception 'already_billed';
end $$;

drop function if exists public.qb_provider_bill_paid(uuid, text);
drop function if exists public.qb_provider_bill_reserve(uuid, text, uuid, text, text);
drop function if exists public.qb_provider_items(text);
drop function if exists public.admin_recon_period(uuid, date);
drop function if exists public.admin_recon_trace(uuid, jsonb);
drop function if exists public.admin_recon_overview(uuid);
drop function if exists public.recon_close_due(uuid, timestamptz, boolean);
drop function if exists public.recon_period_report(date);
drop function if exists public.recon_month_of(timestamptz);
drop function if exists public.recon_db_findings(timestamptz, boolean);
drop function if exists public.recon_auto_approve(timestamptz);
drop function if exists public.admin_recon_exception_ack(uuid, uuid, text);
drop function if exists public.recon_exceptions_mark_notified(uuid[]);
drop function if exists public.recon_exceptions_sync(uuid, jsonb, text[]);
drop function if exists public.recon_run_finish(uuid, text, jsonb, text);
drop function if exists public.recon_run_begin(text, uuid);
drop function if exists public.admin_recon_settings_save(uuid, jsonb);
drop function if exists public.recon_unverified_invoice_ids(integer);
drop function if exists public.recon_affiliate_ready(uuid);
drop function if exists public.recon_affiliate_line_problems(uuid, timestamptz);
drop function if exists public.recon_statement_ready(uuid);
drop function if exists public.recon_statement_problems(uuid, timestamptz);
drop function if exists public.recon_sales_line_problems(uuid, timestamptz);
drop function if exists public.recon_payment_problems(text, uuid, timestamptz);
drop function if exists public.recon_gate(text[]);
drop function if exists public.recon_review_codes();
drop function if exists public.billing_invoice_dispute(text, text);
drop function if exists public.billing_invoice_refund(text, integer, timestamptz);
drop function if exists public.billing_invoice_record(jsonb);
drop function if exists public.recon_invoice_rank(text);
drop table if exists public.recon_periods;
drop function if exists public.recon_periods_guard();
drop table if exists public.recon_exceptions;
drop table if exists public.recon_runs;
drop table if exists public.recon_settings;
drop table if exists public.billing_invoice_facts;
alter table public.qb_payout_bills drop column if exists qb_payment_id;
alter table public.qb_payout_bills drop column if exists payout_id;
alter table public.qb_payout_bills drop column if exists paid_via;
commit;
