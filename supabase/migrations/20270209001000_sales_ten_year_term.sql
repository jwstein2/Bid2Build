-- Sales Hub: recurring commission term extended from 3 to 10 years (James, 2026-11-20). Safe to re-run.
--
-- What changes (and nothing else):
--   * sales_settings.commission_years 3 -> 10. The settings trigger writes a new policy version, so every
--     commission line already created keeps the version (and 3-year rules) it was created under.
--   * Each customer's term is now recorded on the customer (sales_attributions.commission_term_years), set from
--     the policy at the customer's first qualifying payment. A later policy change never shortens a term a
--     customer already started. Existing paid customers (prod had none when this was written) get 10 years.
--   * sales_sync_billing / sales_close_month read the customer's own term (falling back to the policy).
--
-- What does NOT change: one month of subscription value per eligible year (sale month + anniversaries, never
-- 12 monthly payments, never paid up front); the monthly-anniversary rule (a paid invoice in the anniversary
-- month); the basis and annual-plan rule; upgrades/downgrades counted at the anniversary; 30-day hold, no
-- clawback, first-month cancellation; attribution (90 days, first rep wins); statements and payouts; milestone
-- bonuses (V3) and accelerators; employee vs contractor handling. The term starts at the first qualifying paid
-- invoice and never restarts on upgrade, billing-cycle change, cancellation or reactivation.
--
-- No retroactive payouts: this migration creates no commission lines. Anniversaries that already passed without
-- a line stay as they were; the next ones are created by the normal billing flow.
--
-- Also adds a versioned rep amendment (legal review pending) that reps accept in the Sales Hub, with immutable
-- acceptance records. Acceptance is evidence only: it never blocks or changes pay.
-- Rollback: docs/sales-portal/rollback_20270209001000.sql

-- ---------------------------------------------------------------------------------------------------
-- 1. Per-customer term
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_attributions add column if not exists commission_term_years integer
  check (commission_term_years is null or commission_term_years between 1 and 10);

-- ---------------------------------------------------------------------------------------------------
-- 2. Policy: 10 years (new policy version with a note). Only moves a 3-year policy, so a later owner change
--    in the Policy tab is never undone by re-running this file.
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_settings alter column commission_years set default 10;
do $$
begin
  if exists (select 1 from public.sales_settings where id and commission_years = 3) then
    perform set_config('sales.policy_note', 'Ten-year recurring term (James, 2026-11-20): one month of subscription value per eligible year for up to 10 years (sale month + 9 anniversaries). Nothing else changed.', true);
    update public.sales_settings set commission_years = 10, updated_at = now() where id;
  end if;
end $$;

-- Existing customers with a first payment carry the new term (they were all inside the old term: the program
-- started in 2026). Customers who haven't paid yet get theirs at first payment.
update public.sales_attributions set commission_term_years = 10 where first_paid_at is not null and commission_term_years is null;

-- ---------------------------------------------------------------------------------------------------
-- 3. Billing hook: identical to 20270119002000 except the term comes from the customer.
-- ---------------------------------------------------------------------------------------------------
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
    update public.sales_attributions set first_paid_at = coalesce(p_paid_at, now()), first_paid_month = v_month, last_paid_at = coalesce(p_paid_at, now()),
      commission_term_years = coalesce(commission_term_years, cfg.commission_years)
    where user_id = p_user returning * into a;
    insert into public.sales_link_events (rep_id, kind, user_id) values (a.rep_id, 'purchase', p_user) on conflict do nothing;
    v_year := 1;
  else
    update public.sales_attributions set last_paid_at = greatest(coalesce(last_paid_at, p_paid_at), coalesce(p_paid_at, now())) where user_id = p_user;
    v_months := (extract(year from v_month) - extract(year from a.first_paid_month)) * 12 + (extract(month from v_month) - extract(month from a.first_paid_month));
    if v_months <= 0 or v_months % 12 <> 0 then return jsonb_build_object('action', 'synced'); end if;
    v_year := v_months / 12 + 1;
    if v_year > coalesce(a.commission_term_years, cfg.commission_years) then return jsonb_build_object('action', 'synced', 'reason', 'past_commission_term'); end if;
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

-- ---------------------------------------------------------------------------------------------------
-- 4. Month-end close: identical to 20270107001000 except the term comes from the customer.
-- ---------------------------------------------------------------------------------------------------
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
    for n in 2..coalesce(a.commission_term_years, cfg.commission_years) loop
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

-- ---------------------------------------------------------------------------------------------------
-- 5. Rep portfolio: every attributed customer with their own term and commission lines, so the Sales Hub can
--    draw the 10-year timeline. Same limited customer fields as sales_my_overview (no billing details).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_my_portfolio() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps; cfg public.sales_settings;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into cfg from public.sales_settings where id;
  return jsonb_build_object(
    'policy_years', cfg.commission_years,
    'current_month', public.sales_month_of(now()),
    'customers', coalesce((select jsonb_agg(jsonb_build_object(
        'key', substr(md5(x.user_id::text || rep.id::text), 1, 10),
        'business', nullif(bp.company_name, ''), 'email', u.email, 'plan', x.plan, 'sub_status', x.sub_status,
        'attributed_at', x.attributed_at, 'first_paid_at', x.first_paid_at, 'first_paid_month', x.first_paid_month,
        'term_years', coalesce(x.commission_term_years, cfg.commission_years), 'basis_cents', x.basis_cents,
        'ended', x.ended_at is not null, 'cancel_requested_at', x.cancel_requested_at,
        'lines', coalesce((select jsonb_agg(jsonb_build_object('year_no', c.year_no, 'kind', c.kind, 'period_month', c.period_month,
            'amount_cents', c.amount_cents, 'status', c.status, 'reason', c.reason, 'paid_at', c.paid_at) order by c.year_no, c.kind)
          from public.sales_commissions c where c.user_id = x.user_id and c.rep_id = rep.id and c.kind in ('commission', 'clawback')), '[]'::jsonb)
      ) order by x.attributed_at desc)
      from public.sales_attributions x join auth.users u on u.id = x.user_id left join public.business_profiles bp on bp.user_id = x.user_id
      where x.rep_id = rep.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Versioned rep amendment (DRAFT pending counsel) + immutable acceptances
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_agreement_amendments (
  id           uuid primary key default gen_random_uuid(),
  code         text not null check (code ~ '^[a-z0-9_]{3,60}$'),
  version      integer not null check (version > 0),
  title        text not null check (char_length(title) between 1 and 200),
  body         text not null check (char_length(body) between 1 and 20000),
  policy_version integer,                       -- the commission policy version the amendment describes
  legal_status text not null default 'draft_pending_counsel' check (legal_status in ('draft_pending_counsel', 'counsel_approved')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (code, version)
);
create unique index if not exists sales_agreement_amendments_one_active on public.sales_agreement_amendments (code) where active;

create table if not exists public.sales_amendment_acceptances (
  id           uuid primary key default gen_random_uuid(),
  rep_id       uuid not null references public.sales_reps (id) on delete restrict,
  amendment_id uuid not null references public.sales_agreement_amendments (id) on delete restrict,
  body_sha256  text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  typed_name   text not null check (char_length(btrim(typed_name)) between 2 and 120),
  ip           text check (char_length(ip) <= 64),
  user_agent   text check (char_length(user_agent) <= 300),
  accepted_at  timestamptz not null default now(),
  unique (rep_id, amendment_id)
);
create or replace function public.sales_guard_immutable() returns trigger language plpgsql as $$
begin raise exception 'immutable_record' using errcode = '42501'; end $$;
drop trigger if exists sales_amendment_acceptances_immutable on public.sales_amendment_acceptances;
create trigger sales_amendment_acceptances_immutable before update or delete on public.sales_amendment_acceptances
  for each row execute function public.sales_guard_immutable();

alter table public.sales_agreement_amendments enable row level security;
alter table public.sales_amendment_acceptances enable row level security;
revoke all on public.sales_agreement_amendments, public.sales_amendment_acceptances from public, anon, authenticated;
grant all on public.sales_agreement_amendments, public.sales_amendment_acceptances to service_role;

insert into public.sales_agreement_amendments (code, version, title, body, policy_version)
select 'ten_year_term', 1, 'Amendment No. 1 to the Sales Compensation Agreement: Ten-Year Recurring Commission Term',
$body$DRAFT pending attorney review. Not final until approved by counsel.

1. Purpose. This amendment changes one term of your Built2Bid sales compensation: how many years a referred customer can earn you a recurring commission. Every other term of your agreement and of the commission policy stays exactly as it is.

2. Change. The recurring commission term increases from three (3) years to ten (10) years. For each customer attributed to you, you may earn one commission per eligible year: in the sale month (year 1) and in each anniversary month (years 2 through 10).

3. Amount. Each commission equals one month of the customer's qualifying subscription value as calculated under the commission policy in force (currently the monthly list price basis, before tax, for every recurring item). If the customer's qualifying value changes, the next eligible anniversary uses the value at that anniversary. Commissions are never paid for all ten years up front and are never paid monthly.

4. Eligibility. An anniversary commission is earned only if the customer is active and has paid in that anniversary month, under the same rules as before (30-day refund hold, no clawback after the hold, first-month cancellation, policy version stamped on each line). The ten-year term starts with the customer's first qualifying paid subscription and does not restart after an upgrade, downgrade, billing-cycle change, cancellation or reactivation. The term ends early if the customer stops being eligible under the policy.

5. Unchanged terms. Attribution rules, the commission basis, the 30-day hold, monthly statements and payout schedule, milestone bonuses, accelerators (if ever enabled), employee or contractor classification, and what happens to payments received after you leave are all unchanged.

6. Existing customers. Customers already attributed to you stay attributed to you and receive the ten-year term. This amendment does not create any payment for a past period.

7. Records. Your acceptance is recorded with the date, time and the exact text you accepted.$body$,
  (select public.sales_policy_current_version())
where not exists (select 1 from public.sales_agreement_amendments where code = 'ten_year_term');

-- Rep: amendments still to accept (active ones), plus the ones already accepted.
create or replace function public.sales_my_amendments() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'version', m.version, 'title', m.title, 'body', m.body,
      'legal_status', m.legal_status, 'accepted_at', a.accepted_at) order by m.created_at)
    from public.sales_agreement_amendments m left join public.sales_amendment_acceptances a on a.amendment_id = m.id and a.rep_id = rep.id
    where m.active or a.id is not null), '[]'::jsonb);
end $$;

create or replace function public.sales_my_amendment_accept(p_id uuid, p_body_sha256 text, p_typed_name text, p_ip text default null, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; m public.sales_agreement_amendments;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into m from public.sales_agreement_amendments where id = p_id and active;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if encode(sha256(convert_to(m.body, 'UTF8')), 'hex') <> p_body_sha256 then raise exception 'agreement_changed' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_typed_name, ''))) < 2 then raise exception 'name_required' using errcode = '22023'; end if;
  insert into public.sales_amendment_acceptances (rep_id, amendment_id, body_sha256, typed_name, ip, user_agent)
  values (rep.id, m.id, p_body_sha256, btrim(p_typed_name), left(p_ip, 64), left(p_user_agent, 300)) on conflict (rep_id, amendment_id) do nothing;
  if found then perform public.sales_audit(auth.uid(), 'sales.amendment_accepted', 'sales_amendment', m.id::text, jsonb_build_object('code', m.code, 'version', m.version, 'rep', rep.id)); end if;
  return jsonb_build_object('accepted', true);
end $$;

-- Owner: who has accepted each amendment.
create or replace function public.admin_sales_amendments(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'version', m.version, 'title', m.title, 'legal_status', m.legal_status, 'active', m.active,
      'accepted', coalesce((select jsonb_agg(jsonb_build_object('rep', r.full_name, 'email', r.email, 'typed_name', a.typed_name, 'accepted_at', a.accepted_at) order by a.accepted_at)
        from public.sales_amendment_acceptances a join public.sales_reps r on r.id = a.rep_id where a.amendment_id = m.id), '[]'::jsonb),
      'pending', coalesce((select jsonb_agg(jsonb_build_object('rep', r.full_name, 'email', r.email) order by r.full_name)
        from public.sales_reps r where r.status = 'active' and coalesce(r.sells, true)
          and not exists (select 1 from public.sales_amendment_acceptances a where a.amendment_id = m.id and a.rep_id = r.id)), '[]'::jsonb))
    order by m.created_at desc) from public.sales_agreement_amendments m), '[]'::jsonb);
end $$;

-- Owner marks an amendment counsel-approved (the text itself never changes: a new text is a new version).
create or replace function public.admin_sales_amendment_legal(p_caller uuid, p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  if p_status not in ('draft_pending_counsel', 'counsel_approved') then raise exception 'bad_status' using errcode = '22023'; end if;
  update public.sales_agreement_amendments set legal_status = p_status where id = p_id;
  perform public.sales_audit(p_caller, 'sales.amendment_legal_status', 'sales_amendment', p_id::text, jsonb_build_object('status', p_status));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.sales_sync_billing(uuid, text, text, text, uuid, integer, jsonb, text, integer, timestamptz)',
    'public.sales_close_month(timestamptz)', 'public.admin_sales_amendments(uuid)', 'public.admin_sales_amendment_legal(uuid, uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.sales_my_portfolio()', 'public.sales_my_amendments()', 'public.sales_my_amendment_accept(uuid, text, text, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
