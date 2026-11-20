-- Rollback for 20270211001000_affiliate_hub.sql (Affiliate Hub).
-- Removes every affiliate object and restores the V8.1 payout functions and Sales attribution exactly as they were.
-- WARNING: deletes affiliate payouts (test or live) and all affiliate records. Export first if any exist.
begin;

delete from public.payout_events where payout_id in (select id from public.payouts where affiliate_id is not null);
delete from public.payout_items where payout_id in (select id from public.payouts where affiliate_id is not null) or source_kind <> 'sales_statement';
delete from public.payouts where affiliate_id is not null;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace
           and (p.proname like 'affiliate\_%' or p.proname like 'admin\_affiliate%') loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end $$;

drop table if exists public.affiliate_compliance_cases, public.affiliate_email_log, public.affiliate_outreach_events, public.affiliate_prospects,
  public.affiliate_disputes, public.affiliate_adjustments, public.affiliate_commissions, public.affiliate_invoices, public.affiliate_referral_history,
  public.affiliate_referrals, public.affiliate_clicks, public.affiliate_tin_secrets, public.affiliate_tax_profiles,
  public.affiliate_agreement_acceptances, public.affiliate_agreement_templates, public.affiliate_lessons_done, public.affiliate_invites,
  public.affiliate_channel_corrections, public.affiliate_policy_versions, public.affiliate_settings cascade;

alter table public.payouts drop constraint if exists payouts_one_payee;
drop index if exists public.payouts_affiliate;
alter table public.payouts drop column if exists affiliate_destination_id;
alter table public.payout_items drop constraint if exists payout_items_source_kind_check;
alter table public.payout_items add constraint payout_items_source_kind_check check (source_kind in ('sales_statement'));
-- affiliate_payout_destinations is referenced by payouts.affiliate_destination_id (dropped above).
drop table if exists public.affiliate_payout_destinations, public.affiliate_channels cascade;
alter table public.payouts drop column if exists affiliate_id;
drop table if exists public.affiliates cascade;
alter table public.payouts alter column staff_id set not null;

-- Restore the previous definitions.
create or replace function public.sales_record_attribution(p_user uuid, p_code text, p_visit_at timestamptz default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  rep public.sales_reps;
  cfg public.sales_settings;
  v_email text; v_created timestamptz;
begin
  if p_user is null then return 'unknown_code'; end if;
  select * into rep from public.sales_reps where code = upper(btrim(coalesce(p_code, ''))) and status = 'active';
  if not found then return 'unknown_code'; end if;
  if exists (select 1 from public.sales_attributions where user_id = p_user) then return 'already_attributed'; end if;
  select * into cfg from public.sales_settings where id;
  select lower(email), created_at into v_email, v_created from auth.users where id = p_user;
  if not found then return 'unknown_code'; end if;
  if rep.user_id = p_user or v_email = rep.email
     or exists (select 1 from public.sales_reps r where r.user_id = p_user and r.status <> 'removed') then
    return 'ineligible:sales_staff';
  end if;
  if public.referral_excluded(p_user) is not null then return 'ineligible:' || public.referral_excluded(p_user); end if;
  if exists (select 1 from public.subscriptions s where s.user_id = p_user) then return 'existing_customer'; end if;
  if v_created < coalesce(least(p_visit_at, now()), now()) - make_interval(days => cfg.attribution_window_days) then
    return 'existing_account';
  end if;
  insert into public.sales_attributions (user_id, rep_id, source, code) values (p_user, rep.id, 'link', rep.code)
  on conflict (user_id) do nothing;
  if not found then return 'already_attributed'; end if;
  insert into public.sales_attribution_history (user_id, to_rep, action) values (p_user, rep.id, 'linked');
  insert into public.sales_link_events (rep_id, kind, user_id) values (rep.id, 'signup', p_user) on conflict do nothing;
  return 'recorded';
end $$;

create or replace function public.payout_claim_due(p_limit integer default 25, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payout_settings; p public.payouts; d public.staff_payout_destinations; v_out jsonb := '[]'; v_today_cents bigint; v_blockers text[];
begin
  select * into s from public.payout_settings where id;
  if s.mode = 'off' then return jsonb_build_object('skipped', 'automation_off', 'payouts', '[]'::jsonb); end if;
  if s.paused then return jsonb_build_object('skipped', 'paused', 'payouts', '[]'::jsonb); end if;
  if s.mode = 'live' and (s.live_activated_at is null or s.provider = 'mock') then return jsonb_build_object('skipped', 'live_not_activated', 'payouts', '[]'::jsonb); end if;
  -- Submissions stuck in 'submitting' (process died mid-call) are retried with the SAME idempotency key.
  update public.payouts set status = 'scheduled', locked_at = null where status = 'submitting' and locked_at < p_now - interval '15 minutes' and mode = s.mode;
  select coalesce(sum(net_cents), 0) into v_today_cents from public.payouts
    where mode = s.mode and status in ('submitting', 'submitted', 'paid') and (submitted_at at time zone 'America/Chicago')::date = (p_now at time zone 'America/Chicago')::date;
  for p in select * from public.payouts where mode = s.mode and status = 'scheduled' and scheduled_for <= (p_now at time zone 'America/Chicago')::date
           and (next_attempt_at is null or next_attempt_at <= p_now) order by scheduled_for, created_at limit greatest(1, least(p_limit, 100)) for update skip locked loop
    v_blockers := public.payout_blockers(p.staff_id, s.mode);
    if cardinality(v_blockers) > 0 then
      update public.payouts set status = 'held', hold_reasons = v_blockers where id = p.id; continue;
    end if;
    if p.net_cents <= 0 then
      update public.payouts set status = 'held', hold_reasons = array['zero_amount'] where id = p.id; continue;
    end if;
    if p.net_cents > s.per_payout_limit_cents and p.approved_at is null then
      update public.payouts set status = 'needs_approval', hold_reasons = array['over_per_payout_limit'] where id = p.id; continue;
    end if;
    if v_today_cents + p.net_cents > s.daily_limit_cents then
      update public.payouts set next_attempt_at = date_trunc('day', p_now at time zone 'America/Chicago') at time zone 'America/Chicago' + interval '1 day', hold_reasons = array['daily_limit']
      where id = p.id; continue;
    end if;
    select * into d from public.staff_payout_destinations where staff_id = p.staff_id and mode = s.mode and is_current;
    update public.payouts set status = 'submitting', locked_at = p_now, attempts = attempts + 1, destination_id = d.id, hold_reasons = '{}' where id = p.id;
    v_today_cents := v_today_cents + p.net_cents;
    v_out := v_out || jsonb_build_object('id', p.id, 'ref', p.ref, 'net_cents', p.net_cents, 'idempotency_key', p.idempotency_key, 'provider', p.provider,
      'mode', p.mode, 'recipient_ref', d.recipient_ref, 'payout_method_ref', d.payout_method_ref, 'attempts', p.attempts + 1);
  end loop;
  return jsonb_build_object('mode', s.mode, 'provider', s.provider, 'payouts', v_out);
end $$;

create or replace function public.payout_apply_event(p_event_id text, p_provider_ref text, p_kind text, p_occurred_at timestamptz, p_failure_code text,
  p_verified boolean, p_source text default 'webhook') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.payouts; v_rank_old integer; v_rank_new integer; st record;
begin
  if not p_verified then raise exception 'unverified_event' using errcode = '42501'; end if;
  select * into p from public.payouts where provider_ref = p_provider_ref for update;
  insert into public.payout_events (event_id, payout_id, provider_ref, kind, occurred_at, failure_code, verified, source)
  values (p_event_id, p.id, p_provider_ref, p_kind, p_occurred_at, p_failure_code, p_verified, p_source) on conflict (event_id) do nothing;
  if not found then return jsonb_build_object('status', 'duplicate'); end if;
  if p.id is null then return jsonb_build_object('status', 'unknown_payout'); end if;
  v_rank_old := case p.status when 'submitted' then 1 when 'paid' then 2 when 'failed' then 3 when 'canceled' then 3 when 'returned' then 4 else 0 end;
  v_rank_new := case p_kind when 'processing' then 1 when 'posted' then 2 when 'failed' then 3 when 'canceled' then 3 when 'returned' then 4 end;
  if v_rank_new <= v_rank_old then return jsonb_build_object('status', 'stale'); end if;

  if p_kind = 'posted' then
    update public.payouts set status = 'paid', settled_at = p_occurred_at, tax_year = extract(year from p_occurred_at at time zone 'America/Chicago')::integer where id = p.id;
    if p.mode = 'live' then
      for st in select s.* from public.payout_items i join public.sales_statements s on s.id = i.source_id
                where i.payout_id = p.id and i.source_kind = 'sales_statement' and i.active and s.status = 'approved' for update of s loop
        insert into public.sales_payouts (rep_id, statement_id, amount_cents, method, reference, paid_on, recorded_by)
        values (st.rep_id, st.id, st.total_cents, 'ach', p.ref || ' / ' || p_provider_ref, (p_occurred_at at time zone 'America/Chicago')::date, null)
        on conflict (statement_id) do nothing;
        update public.sales_commissions set status = 'paid', paid_at = p_occurred_at, updated_at = now() where statement_id = st.id and status = 'approved';
        update public.sales_statements set status = 'paid', paid_at = p_occurred_at where id = st.id;
      end loop;
    end if;
  elsif p_kind in ('failed', 'canceled') then
    update public.payouts set status = p_kind, failed_at = p_occurred_at, failure_code = left(p_failure_code, 80) where id = p.id;
    update public.payout_items set active = false where payout_id = p.id;
    if p_failure_code in ('account_closed', 'invalid_account_number', 'no_account', 'recipient_rejected') then
      update public.staff_payout_destinations set status = 'failed' where id = p.destination_id;
    end if;
  elsif p_kind = 'returned' then
    -- The bank sent the money back: it is still owed. Undo the paid marks so the statement is paid again once the
    -- person fixes their bank account. Earned amounts are never reduced.
    update public.payouts set status = 'returned', failed_at = p_occurred_at, failure_code = left(p_failure_code, 80) where id = p.id;
    update public.payout_items set active = false where payout_id = p.id;
    update public.staff_payout_destinations set status = 'failed' where id = p.destination_id;
    if p.mode = 'live' then
      for st in select i.source_id from public.payout_items i where i.payout_id = p.id and i.source_kind = 'sales_statement' loop
        delete from public.sales_payouts where statement_id = st.source_id and reference like p.ref || ' / %';
        update public.sales_commissions set status = 'approved', paid_at = null, updated_at = now() where statement_id = st.source_id and status = 'paid';
        update public.sales_statements set status = 'approved', paid_at = null where id = st.source_id and status = 'paid';
      end loop;
    end if;
  else
    update public.payouts set status = case when status = 'submitting' then 'submitted' else status end where id = p.id;
  end if;
  perform public.staff_audit(null, 'payout.' || p_kind, 'payout', p.id::text, jsonb_build_object('ref', p.ref, 'mode', p.mode, 'event', p_event_id, 'source', p_source));
  return jsonb_build_object('status', 'applied', 'payout_id', p.id, 'staff_id', p.staff_id, 'kind', p_kind, 'mode', p.mode);
end $$;

create or replace function public.payout_json(p public.payouts) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) - 'idempotency_key' - 'locked_at' || jsonb_build_object(
    'staff_name', (select coalesce(m.preferred_name, m.display_name) from public.staff_members m where m.id = p.staff_id),
    'destination', (select jsonb_build_object('institution_name', d.institution_name, 'last4', d.last4, 'account_type', d.account_type) from public.staff_payout_destinations d where d.id = p.destination_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('source_kind', i.source_kind, 'source_id', i.source_id, 'amount_cents', i.amount_cents, 'description', i.description, 'active', i.active)
      order by i.created_at) from public.payout_items i where i.payout_id = p.id), '[]'::jsonb))
$$;

revoke all on function public.sales_record_attribution(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.sales_record_attribution(uuid, text, timestamptz) to service_role;
revoke all on function public.payout_claim_due(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.payout_claim_due(integer, timestamptz) to service_role;
revoke all on function public.payout_apply_event(text, text, text, timestamptz, text, boolean, text) from public, anon, authenticated;
grant execute on function public.payout_apply_event(text, text, text, timestamptz, text, boolean, text) to service_role;
revoke all on function public.payout_json(public.payouts) from public, anon, authenticated;
grant execute on function public.payout_json(public.payouts) to service_role;

commit;
