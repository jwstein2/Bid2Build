-- Rollback for 20270209001000_sales_ten_year_term.sql. Restores the 3-year policy (as a new policy version, so
-- history is kept), the previous sales_sync_billing / sales_close_month, and removes the per-customer term column,
-- the rep portfolio function and the amendment tables. Commission lines created while the 10-year term was in force
-- are NOT deleted (they are pay records); review any year 4-10 lines by hand before running this.
begin;
drop function if exists public.sales_my_portfolio();
drop function if exists public.sales_my_amendments();
drop function if exists public.sales_my_amendment_accept(uuid, text, text, text, text);
drop function if exists public.admin_sales_amendments(uuid);
drop function if exists public.admin_sales_amendment_legal(uuid, uuid, text);
drop table if exists public.sales_amendment_acceptances;
drop table if exists public.sales_agreement_amendments;
drop function if exists public.sales_guard_immutable() cascade;

select set_config('sales.policy_note', 'Rollback of the ten-year term: back to 3 years', true);
update public.sales_settings set commission_years = 3, updated_at = now() where id and commission_years = 10;
alter table public.sales_settings alter column commission_years set default 3;

-- Previous definitions (from 20270119002000_sales_compliance.sql and 20270107001000_sales_portal.sql).
create or replace function public.sales_sync_billing(
  p_user uuid, p_subscription_id text, p_status text, p_plan text, p_company_id uuid,
  p_basis_cents integer, p_basis_detail jsonb,
  p_invoice_id text default null, p_amount_paid integer default 0, p_paid_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.sales_attributions;
  cfg public.sales_settings;
  rep public.sales_reps;
  v_month date;
  v_months integer;
  v_year integer;
  v_basis integer;
  v_created text := null;
begin
  select * into a from public.sales_attributions where user_id = p_user for update;
  if not found then return jsonb_build_object('action', 'none'); end if;
  select * into cfg from public.sales_settings where id;

  update public.sales_attributions set
    stripe_subscription_id = coalesce(p_subscription_id, stripe_subscription_id),
    sub_status = coalesce(p_status, sub_status),
    plan = coalesce(p_plan, plan),
    company_id = coalesce(p_company_id, company_id),
    basis_cents = case when p_basis_cents is not null and p_basis_cents > 0 then p_basis_cents else basis_cents end,
    basis_detail = case when p_basis_cents is not null and p_basis_cents > 0 then p_basis_detail else basis_detail end,
    basis_updated_at = case when p_basis_cents is not null and p_basis_cents > 0 then now() else basis_updated_at end
  where user_id = p_user
  returning * into a;

  if p_invoice_id is null or coalesce(p_amount_paid, 0) <= 0 or a.ended_at is not null then
    return jsonb_build_object('action', 'synced');
  end if;

  select * into rep from public.sales_reps where id = a.rep_id;
  v_month := public.sales_month_of(coalesce(p_paid_at, now()));
  v_basis := a.basis_cents;

  if a.first_paid_at is null then
    update public.sales_attributions set first_paid_at = coalesce(p_paid_at, now()), first_paid_month = v_month, last_paid_at = coalesce(p_paid_at, now())
    where user_id = p_user returning * into a;
    insert into public.sales_link_events (rep_id, kind, user_id) values (a.rep_id, 'purchase', p_user) on conflict do nothing;
    v_year := 1;
  else
    update public.sales_attributions set last_paid_at = greatest(coalesce(last_paid_at, p_paid_at), coalesce(p_paid_at, now())) where user_id = p_user;
    v_months := (extract(year from v_month) - extract(year from a.first_paid_month)) * 12 + (extract(month from v_month) - extract(month from a.first_paid_month));
    if v_months <= 0 or v_months % 12 <> 0 then return jsonb_build_object('action', 'synced'); end if;
    v_year := v_months / 12 + 1;
    if v_year > cfg.commission_years then return jsonb_build_object('action', 'synced', 'reason', 'past_commission_term'); end if;
  end if;

  insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, basis_detail, status, reason, stripe_invoice_id, stripe_subscription_id)
  values (a.rep_id, p_user, v_year, 'commission', v_month, coalesce(v_basis, 0), a.basis_detail,
          case when public.sales_rep_left_before(rep, p_paid_at) then 'ineligible' when v_basis is null then 'pending' else 'pending' end,
          case when public.sales_rep_left_before(rep, p_paid_at) then 'rep_removed' when v_basis is null then 'basis_missing' else null end,
          p_invoice_id, p_subscription_id)
  on conflict (user_id, year_no, kind) do nothing;
  if found then v_created := 'year_' || v_year; end if;
  return jsonb_build_object('action', coalesce('created_' || v_created, 'synced'));
end $$;

create or replace function public.sales_close_month(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg public.sales_settings;
  v_current date;
  v_closing date;
  a record;
  n integer;
  v_ann date;
  v_missed integer := 0;
  v_earned integer := 0;
  v_lines integer := 0;
  r record;
  v_statement uuid;
begin
  select * into cfg from public.sales_settings where id;
  v_current := public.sales_month_of(p_now);
  v_closing := (v_current - interval '1 month')::date;

  for a in select * from public.sales_attributions where first_paid_month is not null and ended_at is null loop
    for n in 2..cfg.commission_years loop
      v_ann := (a.first_paid_month + make_interval(months => 12 * (n - 1)))::date;
      exit when v_ann >= v_current;
      insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, basis_detail, status, reason)
      values (a.rep_id, a.user_id, n, 'commission', v_ann, 0, a.basis_detail, 'ineligible', 'no_paid_invoice_in_anniversary_month')
      on conflict (user_id, year_no, kind) do nothing;
      if found then v_missed := v_missed + 1; end if;
    end loop;
  end loop;

  update public.sales_commissions set status = 'earned', earned_at = p_now, updated_at = now()
  where status = 'pending' and kind = 'commission' and period_month < v_current and amount_cents > 0
    and (cfg.refund_policy <> 'hold_30_no_clawback' or created_at <= p_now - interval '30 days');
  get diagnostics v_earned = row_count;

  for r in select distinct c.rep_id from public.sales_commissions c where c.status = 'earned' and c.statement_id is null and c.period_month < v_current loop
    insert into public.sales_statements (rep_id, period_month) values (r.rep_id, v_closing) on conflict (rep_id, period_month) do nothing;
    select id into v_statement from public.sales_statements where rep_id = r.rep_id and period_month = v_closing and status = 'open';
    continue when v_statement is null; -- already approved: lines wait for next month's statement
    update public.sales_commissions set statement_id = v_statement, updated_at = now()
    where rep_id = r.rep_id and status = 'earned' and statement_id is null and period_month < v_current;
    get diagnostics n = row_count;
    v_lines := v_lines + n;
    perform public.sales_statement_refresh(v_statement);
  end loop;

  return jsonb_build_object('closing_month', v_closing, 'missed_anniversaries', v_missed, 'earned', v_earned, 'statement_lines', v_lines);
end $$;

revoke all on function public.sales_sync_billing(uuid, text, text, text, uuid, integer, jsonb, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.sales_close_month(timestamptz) from public, anon, authenticated;
grant execute on function public.sales_sync_billing(uuid, text, text, text, uuid, integer, jsonb, text, integer, timestamptz) to service_role;
grant execute on function public.sales_close_month(timestamptz) to service_role;

alter table public.sales_attributions drop column if exists commission_term_years;
commit;
