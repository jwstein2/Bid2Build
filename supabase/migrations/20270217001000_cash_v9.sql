-- V9 cash-flow forecasting and early warnings (2026-11-21). ADDITIVE ONLY.
--
-- Nothing existing changes: no table, column, constraint, view or function from earlier releases is altered.
-- The forecast keeps reading the authoritative records (invoices, payments, milestones, commitments, bills,
-- expenses, schedules, shifts, time entries, bank balances). This file only adds:
--   1. fin_cash_settings            company forecast assumptions + alert thresholds (one row per book)
--   2. fin_customer_collection_terms per-customer "usually pays N days after issue/due" overrides
--   3. fin_milestone_progress_rules  links a signed milestone to a verified Gantt completion % (contract untouched)
--      fin_milestone_progress_confirm() records the milestone trigger through the existing fin_milestone_triggers
--   4. fin_commitment_terms         when a subcontract / PO is paid (days after completion, deposit, retainage)
--   5. fin_forecast_overrides       per job x cost code forecast-at-completion override, with reason + history
--   6. fin_cash_alerts              early-warning alerts (dedupe, acknowledge, snooze, resolve)
--   7. fin_forecast_snapshots       daily forecast snapshots for forecast-accuracy tracking
--   8. fin_forecast_labor()         scheduled + clocked labor cost by day (sums only, never a person's rate)
-- Browsers read through RLS and write only through SECURITY DEFINER functions that check the existing financial
-- permissions. Alert sync and snapshots are written by the server (service role) only. Re-runnable.

-- 1. Settings ------------------------------------------------------------------------------------------------------
create table if not exists public.fin_cash_settings (
  book_id               uuid primary key references public.fin_books (id) on delete restrict,
  min_cash              numeric(14, 2) check (min_cash is null or min_cash >= 0),
  target_gross_margin   numeric(5, 2) check (target_gross_margin is null or target_gross_margin between 0 and 100),
  target_net_margin     numeric(5, 2) check (target_net_margin is null or target_net_margin between -100 and 100),
  collection_days       integer not null default 7 check (collection_days between 0 and 365),
  collection_basis      text not null default 'due' check (collection_basis in ('issue', 'due')),
  use_history           boolean not null default true,
  history_min_sample    integer not null default 3 check (history_min_sample between 1 and 50),
  expense_mode          text not null default 'known' check (expense_mode in ('known', 'historical', 'benchmark')),
  benchmark             jsonb not null default '{}'::jsonb check (jsonb_typeof(benchmark) = 'object' and pg_column_size(benchmark) <= 4096),
  payroll_from_schedule boolean not null default false,
  payroll_pay_lag_days  integer not null default 5 check (payroll_pay_lag_days between 0 and 31),
  payroll_burden_pct    numeric(5, 2) not null default 0 check (payroll_burden_pct between 0 and 100),
  sub_pay_days          integer not null default 7 check (sub_pay_days between 0 and 180),
  supplier_pay_days     integer not null default 30 check (supplier_pay_days between 0 and 180),
  conservative_late_days integer not null default 14 check (conservative_late_days between 0 and 180),
  conservative_cost_pct numeric(5, 2) not null default 10 check (conservative_cost_pct between 0 and 100),
  ar_grace_days         integer not null default 7 check (ar_grace_days between 0 and 120),
  concentration_days    integer not null default 7 check (concentration_days between 1 and 31),
  concentration_pct     numeric(5, 2) not null default 50 check (concentration_pct between 1 and 1000),
  alert_email           boolean not null default false,
  alert_recipients      uuid[] not null default '{}' check (cardinality(alert_recipients) <= 20),
  alert_kinds_off       text[] not null default '{}' check (cardinality(alert_kinds_off) <= 20),
  updated_by            uuid references auth.users (id) on delete set null,
  updated_at            timestamptz not null default now()
);

-- 2. Customer collection overrides -----------------------------------------------------------------------------------
create table if not exists public.fin_customer_collection_terms (
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  days        integer not null check (days between 0 and 365),
  basis       text not null default 'due' check (basis in ('issue', 'due')),
  note        text check (char_length(note) <= 300),
  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (book_id, customer_id)
);

-- 3. Milestone progress rules ----------------------------------------------------------------------------------------
-- "Due at 30% actual completion": the signed milestone (fin_payment_milestones) is never edited. This row says how
-- verified schedule progress maps to it. Reaching the threshold only makes it eligible; a person with invoice rights
-- confirms it, which records the existing milestone trigger (and so the existing status view says ready_to_invoice).
create table if not exists public.fin_milestone_progress_rules (
  milestone_id uuid primary key references public.fin_payment_milestones (id) on delete restrict,
  book_id      uuid not null references public.fin_books (id) on delete restrict,
  job_id       uuid not null references public.fin_jobs (id) on delete restrict,
  threshold    numeric(5, 2) not null check (threshold > 0 and threshold <= 100),
  method       text not null default 'duration' check (method in ('duration', 'weight', 'financial')),
  section_key  text check (char_length(section_key) <= 80),   -- schedule section (estimate group id): % of that phase only
  note         text check (char_length(note) <= 300),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now()
);
create index if not exists fin_milestone_progress_rules_job on public.fin_milestone_progress_rules (job_id);

-- 4. Commitment payment terms ----------------------------------------------------------------------------------------
create table if not exists public.fin_commitment_terms (
  commitment_id  uuid primary key references public.fin_commitments (id) on delete restrict,
  book_id        uuid not null references public.fin_books (id) on delete restrict,
  pay_basis      text not null default 'completion' check (pay_basis in ('completion', 'start', 'date')),
  pay_days       integer not null default 7 check (pay_days between 0 and 180),
  pay_date       date,
  section_key    text check (char_length(section_key) <= 80),
  retainage_pct  numeric(5, 2) not null default 0 check (retainage_pct between 0 and 50),
  deposit_amount numeric(14, 2) check (deposit_amount is null or deposit_amount > 0),
  deposit_on     date,
  note           text check (char_length(note) <= 300),
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now(),
  constraint fin_commitment_terms_date check (pay_basis <> 'date' or pay_date is not null),
  constraint fin_commitment_terms_deposit check ((deposit_amount is null) = (deposit_on is null))
);

-- 5. Forecast overrides (append-only history: a new row supersedes the previous one) -----------------------------
create table if not exists public.fin_forecast_overrides (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.fin_books (id) on delete restrict,
  job_id        uuid not null references public.fin_jobs (id) on delete restrict,
  cost_code_id  uuid references public.fin_cost_codes (id) on delete restrict,
  amount        numeric(14, 2) check (amount is null or amount >= 0),   -- null = override removed
  reason        text not null check (char_length(btrim(reason)) between 3 and 500),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  superseded_at timestamptz
);
create index if not exists fin_forecast_overrides_job on public.fin_forecast_overrides (job_id, cost_code_id) where superseded_at is null;

-- 6. Alerts ----------------------------------------------------------------------------------------------------------
create table if not exists public.fin_cash_alerts (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.fin_books (id) on delete restrict,
  kind          text not null check (kind in ('low_cash', 'payroll_coverage', 'milestone_delayed', 'milestone_progress_reached', 'cost_overrun',
                                              'margin_low', 'receivable_late', 'expense_concentration', 'forecast_confidence')),
  dedupe_key    text not null check (char_length(dedupe_key) <= 200),
  fingerprint   text not null check (char_length(fingerprint) <= 200),
  severity      text not null check (severity in ('info', 'warning', 'critical')),
  title         text not null check (char_length(title) between 1 and 300),
  body          text not null default '' check (char_length(body) <= 2000),
  details       jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 16384),
  actions       jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array' and pg_column_size(actions) <= 4096),
  status        text not null default 'open' check (status in ('open', 'acknowledged', 'snoozed', 'resolved')),
  snoozed_until date,
  status_reason text check (char_length(status_reason) <= 500),
  status_by     uuid references auth.users (id) on delete set null,
  status_at     timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  notified_at   timestamptz,
  unique (book_id, dedupe_key),
  constraint fin_cash_alerts_snooze check ((status = 'snoozed') = (snoozed_until is not null))
);
create index if not exists fin_cash_alerts_open on public.fin_cash_alerts (book_id, status, last_seen_at desc);

-- 7. Snapshots -------------------------------------------------------------------------------------------------------
create table if not exists public.fin_forecast_snapshots (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references public.fin_books (id) on delete restrict,
  taken_on   date not null,
  kind       text not null default 'daily' check (kind in ('daily', 'manual')),
  assumptions jsonb not null default '{}'::jsonb check (jsonb_typeof(assumptions) = 'object' and pg_column_size(assumptions) <= 8192),
  summary    jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 16384),
  items      jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and pg_column_size(items) <= 1048576),
  created_at timestamptz not null default now(),
  unique (book_id, taken_on, kind)
);

-- RLS: read with the existing capabilities; no direct writes from browsers.
alter table public.fin_cash_settings enable row level security;
alter table public.fin_customer_collection_terms enable row level security;
alter table public.fin_milestone_progress_rules enable row level security;
alter table public.fin_commitment_terms enable row level security;
alter table public.fin_forecast_overrides enable row level security;
alter table public.fin_cash_alerts enable row level security;
alter table public.fin_forecast_snapshots enable row level security;

drop policy if exists fin_cash_settings_select on public.fin_cash_settings;
create policy fin_cash_settings_select on public.fin_cash_settings for select to authenticated
  using (public.tb_can(book_id, 'cash.view_forecast') or public.fin_has_permission(book_id, 'view_project_financials'));
drop policy if exists fin_customer_collection_terms_select on public.fin_customer_collection_terms;
create policy fin_customer_collection_terms_select on public.fin_customer_collection_terms for select to authenticated
  using (public.tb_can(book_id, 'cash.view_forecast'));
drop policy if exists fin_milestone_progress_rules_select on public.fin_milestone_progress_rules;
create policy fin_milestone_progress_rules_select on public.fin_milestone_progress_rules for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials') or public.fin_job_visible(job_id));
drop policy if exists fin_commitment_terms_select on public.fin_commitment_terms;
create policy fin_commitment_terms_select on public.fin_commitment_terms for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials')
         or exists (select 1 from public.fin_commitments c where c.id = fin_commitment_terms.commitment_id and public.fin_job_visible(c.job_id)));
drop policy if exists fin_forecast_overrides_select on public.fin_forecast_overrides;
create policy fin_forecast_overrides_select on public.fin_forecast_overrides for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials') or public.fin_job_visible(job_id));
drop policy if exists fin_cash_alerts_select on public.fin_cash_alerts;
create policy fin_cash_alerts_select on public.fin_cash_alerts for select to authenticated using (public.tb_can(book_id, 'cash.view_forecast'));
drop policy if exists fin_forecast_snapshots_select on public.fin_forecast_snapshots;
create policy fin_forecast_snapshots_select on public.fin_forecast_snapshots for select to authenticated using (public.tb_can(book_id, 'cash.view_forecast'));

do $$ declare t text; begin
  foreach t in array array['fin_cash_settings', 'fin_customer_collection_terms', 'fin_milestone_progress_rules', 'fin_commitment_terms',
                           'fin_forecast_overrides', 'fin_cash_alerts', 'fin_forecast_snapshots'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 8. Write functions ---------------------------------------------------------------------------------------------------
create or replace function public.fin_cash_settings_save(p_book_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_kinds text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'alertKindsOff', '[]'::jsonb))), '{}');
        v_recip uuid[] := coalesce(array(select (jsonb_array_elements_text(coalesce(p -> 'alertRecipients', '[]'::jsonb)))::uuid), '{}');
        v_bench jsonb := coalesce(p -> 'benchmark', '{}'::jsonb); k text;
begin
  perform public.fin_require(p_book_id, 'manage_financial_config', true);
  if jsonb_typeof(v_bench) <> 'object' then raise exception 'bad_benchmark' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(v_bench) loop
    if not (k = any (public.fin_cost_types())) or jsonb_typeof(v_bench -> k) <> 'number' or (v_bench ->> k)::numeric not between 0 and 100 then
      raise exception 'bad_benchmark' using errcode = '22023';
    end if;
  end loop;
  -- Recipients must be people who can see the forecast for this book.
  if exists (select 1 from unnest(v_recip) r where not exists (
       select 1 from public.fin_books b
        where b.id = p_book_id and (b.owner_user_id = r or exists (select 1 from public.fin_seats s where s.book_id = b.id and s.user_id = r)
                                     or exists (select 1 from public.company_members m where m.company_id = b.company_id and m.user_id = r and m.status = 'active' and m.role = 'owner')))) then
    raise exception 'bad_recipient' using errcode = '22023';
  end if;
  insert into public.fin_cash_settings as s (book_id, min_cash, target_gross_margin, target_net_margin, collection_days, collection_basis, use_history,
      history_min_sample, expense_mode, benchmark, payroll_from_schedule, payroll_pay_lag_days, payroll_burden_pct, sub_pay_days, supplier_pay_days,
      conservative_late_days, conservative_cost_pct, ar_grace_days, concentration_days, concentration_pct, alert_email, alert_recipients, alert_kinds_off,
      updated_by, updated_at)
  values (p_book_id, nullif(p ->> 'minCash', '')::numeric, nullif(p ->> 'targetGrossMargin', '')::numeric, nullif(p ->> 'targetNetMargin', '')::numeric,
      coalesce(nullif(p ->> 'collectionDays', '')::integer, 7), coalesce(nullif(p ->> 'collectionBasis', ''), 'due'), coalesce((p ->> 'useHistory')::boolean, true),
      coalesce(nullif(p ->> 'historyMinSample', '')::integer, 3), coalesce(nullif(p ->> 'expenseMode', ''), 'known'), v_bench,
      coalesce((p ->> 'payrollFromSchedule')::boolean, false), coalesce(nullif(p ->> 'payrollPayLagDays', '')::integer, 5),
      coalesce(nullif(p ->> 'payrollBurdenPct', '')::numeric, 0), coalesce(nullif(p ->> 'subPayDays', '')::integer, 7), coalesce(nullif(p ->> 'supplierPayDays', '')::integer, 30),
      coalesce(nullif(p ->> 'conservativeLateDays', '')::integer, 14), coalesce(nullif(p ->> 'conservativeCostPct', '')::numeric, 10),
      coalesce(nullif(p ->> 'arGraceDays', '')::integer, 7), coalesce(nullif(p ->> 'concentrationDays', '')::integer, 7), coalesce(nullif(p ->> 'concentrationPct', '')::numeric, 50),
      coalesce((p ->> 'alertEmail')::boolean, false), v_recip, v_kinds, auth.uid(), now())
  on conflict (book_id) do update set min_cash = excluded.min_cash, target_gross_margin = excluded.target_gross_margin, target_net_margin = excluded.target_net_margin,
      collection_days = excluded.collection_days, collection_basis = excluded.collection_basis, use_history = excluded.use_history,
      history_min_sample = excluded.history_min_sample, expense_mode = excluded.expense_mode, benchmark = excluded.benchmark,
      payroll_from_schedule = excluded.payroll_from_schedule, payroll_pay_lag_days = excluded.payroll_pay_lag_days, payroll_burden_pct = excluded.payroll_burden_pct,
      sub_pay_days = excluded.sub_pay_days, supplier_pay_days = excluded.supplier_pay_days, conservative_late_days = excluded.conservative_late_days,
      conservative_cost_pct = excluded.conservative_cost_pct, ar_grace_days = excluded.ar_grace_days, concentration_days = excluded.concentration_days,
      concentration_pct = excluded.concentration_pct, alert_email = excluded.alert_email, alert_recipients = excluded.alert_recipients,
      alert_kinds_off = excluded.alert_kinds_off, updated_by = excluded.updated_by, updated_at = now();
  perform public.fin_audit(p_book_id, 'cash.settings_saved', 'book', p_book_id, p - 'alertRecipients');
end $$;

create or replace function public.fin_collection_terms_save(p_book_id uuid, p_customer_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.fin_require(p_book_id, 'manage_financial_config', true);
  if not exists (select 1 from public.customers c join public.fin_books b on b.id = p_book_id
                  where c.id = p_customer_id and (c.company_id is not distinct from b.company_id and (b.company_id is not null or c.user_id = b.owner_user_id))) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if coalesce((p ->> 'remove')::boolean, false) then
    delete from public.fin_customer_collection_terms where book_id = p_book_id and customer_id = p_customer_id;
  else
    insert into public.fin_customer_collection_terms as t (book_id, customer_id, days, basis, note, updated_by, updated_at)
    values (p_book_id, p_customer_id, (p ->> 'days')::integer, coalesce(nullif(p ->> 'basis', ''), 'due'), nullif(left(p ->> 'note', 300), ''), auth.uid(), now())
    on conflict (book_id, customer_id) do update set days = excluded.days, basis = excluded.basis, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform public.fin_audit(p_book_id, 'cash.collection_terms_saved', 'customer', p_customer_id, p);
end $$;

create or replace function public.fin_milestone_progress_rule_save(p_milestone_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m public.fin_payment_milestones;
begin
  select * into m from public.fin_payment_milestones where id = p_milestone_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(m.book_id, 'create_invoices', true);
  if coalesce((p ->> 'remove')::boolean, false) then
    delete from public.fin_milestone_progress_rules where milestone_id = m.id;
    perform public.fin_audit(m.book_id, 'milestone.progress_rule_removed', 'milestone', m.id, null);
    return;
  end if;
  -- Only milestones that wait on work being done can follow schedule progress.
  if m.trigger_kind not in ('phase_completed_verified', 'custom_approved', 'final_completion_confirmed') then
    raise exception 'trigger_not_progress' using errcode = '22023';
  end if;
  insert into public.fin_milestone_progress_rules as r (milestone_id, book_id, job_id, threshold, method, section_key, note, created_by, updated_by)
  values (m.id, m.book_id, m.job_id, (p ->> 'threshold')::numeric, coalesce(nullif(p ->> 'method', ''), 'duration'), nullif(left(p ->> 'sectionKey', 80), ''),
          nullif(left(p ->> 'note', 300), ''), auth.uid(), auth.uid())
  on conflict (milestone_id) do update set threshold = excluded.threshold, method = excluded.method, section_key = excluded.section_key, note = excluded.note,
      updated_by = excluded.updated_by, updated_at = now();
  perform public.fin_audit(m.book_id, 'milestone.progress_rule_saved', 'milestone', m.id, p);
end $$;

-- Confirm that verified progress reached the rule's threshold: records the milestone's own trigger once (no duplicates).
-- p {percent, method, asOf?, note?}. The percent comes from the schedule's progress engine (shown to the person confirming).
create or replace function public.fin_milestone_progress_confirm(p_milestone_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.fin_payment_milestones; r public.fin_milestone_progress_rules; v_pct numeric := (p ->> 'percent')::numeric; v_id uuid;
begin
  select * into m from public.fin_payment_milestones where id = p_milestone_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(m.book_id, 'create_invoices', true);
  select * into r from public.fin_milestone_progress_rules where milestone_id = m.id;
  if not found then raise exception 'no_progress_rule' using errcode = '22023'; end if;
  if v_pct is null or v_pct < r.threshold or v_pct > 100 then raise exception 'below_threshold' using errcode = '22023'; end if;
  if public.fin_milestone_triggered_at(m.id) is not null then raise exception 'already_triggered' using errcode = '22023'; end if;
  insert into public.fin_milestone_triggers (book_id, job_id, milestone_id, trigger_kind, occurred_at, note, recorded_by)
  values (m.book_id, m.job_id, m.id, m.trigger_kind, coalesce(nullif(p ->> 'asOf', '')::timestamptz, now()),
          left(format('Verified progress %s%% (%s) reached the %s%% milestone.%s', round(v_pct, 1), coalesce(nullif(p ->> 'method', ''), r.method), round(r.threshold, 1),
                      coalesce(' ' || nullif(btrim(p ->> 'note'), ''), '')), 500), auth.uid())
  returning id into v_id;
  perform public.fin_audit(m.book_id, 'milestone.progress_confirmed', 'milestone', m.id,
    jsonb_build_object('percent', v_pct, 'threshold', r.threshold, 'method', coalesce(nullif(p ->> 'method', ''), r.method), 'triggerId', v_id));
  update public.fin_cash_alerts set status = 'resolved', status_reason = 'Confirmed', status_by = auth.uid(), status_at = now()
   where book_id = m.book_id and dedupe_key = 'milestone_progress_reached:' || m.id and status <> 'resolved';
  return v_id;
end $$;

create or replace function public.fin_commitment_terms_save(p_commitment_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c public.fin_commitments;
begin
  select * into c from public.fin_commitments where id = p_commitment_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(c.book_id, 'record_bills', true);
  insert into public.fin_commitment_terms as t (commitment_id, book_id, pay_basis, pay_days, pay_date, section_key, retainage_pct, deposit_amount, deposit_on, note, updated_by, updated_at)
  values (c.id, c.book_id, coalesce(nullif(p ->> 'payBasis', ''), 'completion'), coalesce(nullif(p ->> 'payDays', '')::integer, 7), nullif(p ->> 'payDate', '')::date,
          nullif(left(p ->> 'sectionKey', 80), ''), coalesce(nullif(p ->> 'retainagePct', '')::numeric, 0), nullif(p ->> 'depositAmount', '')::numeric,
          nullif(p ->> 'depositOn', '')::date, nullif(left(p ->> 'note', 300), ''), auth.uid(), now())
  on conflict (commitment_id) do update set pay_basis = excluded.pay_basis, pay_days = excluded.pay_days, pay_date = excluded.pay_date, section_key = excluded.section_key,
      retainage_pct = excluded.retainage_pct, deposit_amount = excluded.deposit_amount, deposit_on = excluded.deposit_on, note = excluded.note,
      updated_by = excluded.updated_by, updated_at = now();
  perform public.fin_audit(c.book_id, 'commitment.terms_saved', 'commitment', c.id, p);
end $$;

create or replace function public.fin_forecast_override_save(p_job_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare j public.fin_jobs; v_cc uuid := nullif(p ->> 'costCodeId', '')::uuid; v_id uuid; v_amt numeric := nullif(p ->> 'amount', '')::numeric;
begin
  select * into j from public.fin_jobs where id = p_job_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(j.book_id, 'manage_financial_config', true);
  if v_cc is not null and not exists (select 1 from public.fin_cost_codes where id = v_cc and book_id = j.book_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_amt is not null and (v_amt < 0 or v_amt <> round(v_amt, 2)) then raise exception 'bad_amount' using errcode = '22023'; end if;
  update public.fin_forecast_overrides set superseded_at = now()
   where job_id = j.id and cost_code_id is not distinct from v_cc and superseded_at is null;
  insert into public.fin_forecast_overrides (book_id, job_id, cost_code_id, amount, reason, created_by)
  values (j.book_id, j.id, v_cc, v_amt, btrim(p ->> 'reason'), auth.uid()) returning id into v_id;
  perform public.fin_audit(j.book_id, 'forecast.override_saved', 'job', j.id, jsonb_build_object('costCodeId', v_cc, 'amount', v_amt::text, 'reason', p ->> 'reason'));
  return v_id;
end $$;

-- Acknowledge, snooze (until a date) or resolve an alert. Never changes any financial record.
create or replace function public.fin_cash_alert_set(p_alert_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a public.fin_cash_alerts; v_status text := p ->> 'status'; v_until date := nullif(p ->> 'snoozeUntil', '')::date;
begin
  select * into a from public.fin_cash_alerts where id = p_alert_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(a.book_id, 'view_company_financials', true);
  if v_status not in ('open', 'acknowledged', 'snoozed', 'resolved') then raise exception 'bad_status' using errcode = '22023'; end if;
  if v_status = 'snoozed' and (v_until is null or v_until <= current_date or v_until > current_date + 90) then raise exception 'bad_snooze' using errcode = '22023'; end if;
  update public.fin_cash_alerts set status = v_status, snoozed_until = case when v_status = 'snoozed' then v_until end,
         status_reason = nullif(left(p ->> 'reason', 500), ''), status_by = auth.uid(), status_at = now()
   where id = a.id;
  perform public.fin_audit(a.book_id, 'cash.alert_' || v_status, 'cash_alert', a.id, jsonb_build_object('kind', a.kind, 'until', v_until));
end $$;

-- Server-only: store the alerts the forecast found for one book. p_alerts [{kind, key, fingerprint, severity, title, body,
-- details, actions}]. A condition seen again with the same fingerprint keeps its status (no repeat notification). A changed
-- fingerprint re-opens an acknowledged/resolved alert. An expired snooze re-opens. Alerts no longer found resolve themselves.
-- Returns the ids that are newly open (to notify).
create or replace function public.fin_cash_alerts_sync(p_book_id uuid, p_alerts jsonb) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare x jsonb; v_new uuid[] := '{}'; v_id uuid; v_keys text[] := '{}'; a public.fin_cash_alerts;
begin
  if jsonb_typeof(p_alerts) <> 'array' or jsonb_array_length(p_alerts) > 500 then raise exception 'bad_alerts' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_alerts) loop
    v_keys := v_keys || (x ->> 'key');
    select * into a from public.fin_cash_alerts where book_id = p_book_id and dedupe_key = x ->> 'key' for update;
    if not found then
      insert into public.fin_cash_alerts (book_id, kind, dedupe_key, fingerprint, severity, title, body, details, actions)
      values (p_book_id, x ->> 'kind', left(x ->> 'key', 200), left(x ->> 'fingerprint', 200), x ->> 'severity', left(x ->> 'title', 300), left(coalesce(x ->> 'body', ''), 2000),
              coalesce(x -> 'details', '{}'::jsonb), coalesce(x -> 'actions', '[]'::jsonb))
      returning id into v_id;
      v_new := v_new || v_id;
    else
      update public.fin_cash_alerts set severity = x ->> 'severity', title = left(x ->> 'title', 300), body = left(coalesce(x ->> 'body', ''), 2000),
             details = coalesce(x -> 'details', '{}'::jsonb), actions = coalesce(x -> 'actions', '[]'::jsonb), last_seen_at = now(),
             fingerprint = left(x ->> 'fingerprint', 200),
             status = case when a.status = 'snoozed' and a.snoozed_until <= current_date then 'open'
                           when a.status in ('acknowledged', 'resolved') and a.fingerprint <> left(x ->> 'fingerprint', 200) then 'open'
                           when a.status = 'resolved' and a.status_by is null then 'open'
                           else a.status end,
             snoozed_until = case when a.status = 'snoozed' and a.snoozed_until > current_date then a.snoozed_until end,
             status_reason = case when a.status = 'resolved' and a.status_by is null then null else a.status_reason end
       where id = a.id
       returning id into v_id;
      if (a.status = 'snoozed' and a.snoozed_until <= current_date) or (a.status in ('acknowledged', 'resolved') and a.fingerprint <> left(x ->> 'fingerprint', 200))
         or (a.status = 'resolved' and a.status_by is null) then
        v_new := v_new || v_id;
      end if;
    end if;
  end loop;
  -- Conditions that cleared resolve themselves (status_by null marks "resolved automatically").
  update public.fin_cash_alerts set status = 'resolved', snoozed_until = null, status_reason = 'The condition cleared', status_by = null, status_at = now()
   where book_id = p_book_id and status in ('open', 'acknowledged', 'snoozed') and not (dedupe_key = any (v_keys));
  return v_new;
end $$;

create or replace function public.fin_cash_alerts_mark_notified(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.fin_cash_alerts set notified_at = now() where id = any (p_ids)
$$;

create or replace function public.fin_forecast_snapshot_save(p_book_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.fin_forecast_snapshots as s (book_id, taken_on, kind, assumptions, summary, items)
  values (p_book_id, coalesce(nullif(p ->> 'takenOn', '')::date, current_date), coalesce(nullif(p ->> 'kind', ''), 'daily'),
          coalesce(p -> 'assumptions', '{}'::jsonb), coalesce(p -> 'summary', '{}'::jsonb), coalesce(p -> 'items', '[]'::jsonb))
  on conflict (book_id, taken_on, kind) do update set assumptions = excluded.assumptions, summary = excluded.summary, items = excluded.items, created_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- 9. Labor forecast input ------------------------------------------------------------------------------------------
-- Scheduled hours (shifts + project assignments, the same source the worker app shows) and clocked hours (time entries
-- not rejected) by day, category and project, costed at each person's hourly cost. Returns sums only: never a person,
-- a rate or a name. Same audience as timesheet labor cost (company financials). Range at most 400 days.
create or replace function public.fin_forecast_labor(p_book_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b public.fin_books; s public.pm_pay_settings; g public.pm_gps_settings; v_sched jsonb := '[]'::jsonb; r record; v_from timestamptz; v_to timestamptz;
begin
  select * into b from public.fin_books where id = p_book_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.fin_has_permission(p_book_id, 'view_company_financials') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'bad_range' using errcode = '22023'; end if;
  s := public.pm_pay_settings_for(b.company_id, case when b.company_id is null then b.owner_user_id end);
  g := public.pm_gps_settings_for(b.company_id, case when b.company_id is null then b.owner_user_id end);
  v_from := p_from::timestamp at time zone g.timezone; v_to := (p_to + 1)::timestamp at time zone g.timezone;
  for r in select x.id from public.pm_resources x
            where x.company_id is not distinct from b.company_id and (b.company_id is not null or x.owner_id = b.owner_user_id)
              and x.kind = 'staff' and x.status = 'active' loop
    v_sched := v_sched || (select coalesce(jsonb_agg(i || jsonb_build_object('resourceId', r.id)), '[]'::jsonb)
                             from jsonb_array_elements(public.pm_worker_schedule_raw(r.id, greatest(p_from, current_date), p_to)) i
                            where i ->> 'category' not in ('time_off', 'unpaid'));
  end loop;
  return jsonb_build_object(
    'timezone', g.timezone, 'payFrequency', s.pay_frequency, 'periodAnchor', s.period_anchor, 'otMultiplier', s.ot_multiplier,
    'staff', (select count(*) from public.pm_resources x where x.company_id is not distinct from b.company_id and (b.company_id is not null or x.owner_id = b.owner_user_id) and x.kind = 'staff' and x.status = 'active'),
    'uncostedStaff', (select count(*) from public.pm_resources x left join public.pm_employee_profiles p on p.resource_id = x.id
                       where x.company_id is not distinct from b.company_id and (b.company_id is not null or x.owner_id = b.owner_user_id) and x.kind = 'staff' and x.status = 'active' and p.hourly_cost is null),
    'scheduled', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'category', category, 'scheduleId', schedule_id, 'hours', round(h, 2), 'cost', round(c, 2)) order by d)
        from (select (i ->> 'date')::date as d, i ->> 'category' as category, nullif(i ->> 'scheduleId', '') as schedule_id,
                     sum((i ->> 'hours')::numeric) as h, sum((i ->> 'hours')::numeric * coalesce(p.hourly_cost, 0)) as c
                from jsonb_array_elements(v_sched) i left join public.pm_employee_profiles p on p.resource_id = (i ->> 'resourceId')::uuid
               group by 1, 2, 3) z), '[]'::jsonb),
    'actual', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'category', category, 'scheduleId', schedule_id, 'hours', round(h, 2), 'cost', round(c, 2), 'approved', approved) order by d)
        from (select (e.clock_in at time zone g.timezone)::date as d, coalesce(e.work_category, 'other_paid') as category, e.schedule_id::text as schedule_id,
                     e.status = 'approved' as approved,
                     sum(greatest(extract(epoch from (coalesce(e.clock_out, now()) - e.clock_in)) / 3600.0 - e.break_minutes / 60.0, 0)) as h,
                     sum(greatest(extract(epoch from (coalesce(e.clock_out, now()) - e.clock_in)) / 3600.0 - e.break_minutes / 60.0, 0) * coalesce(p.hourly_cost, 0)) as c
                from public.pm_time_entries e left join public.pm_employee_profiles p on p.resource_id = e.resource_id
               where e.company_id is not distinct from b.company_id and (b.company_id is not null or e.owner_id = b.owner_user_id)
                 and e.status <> 'rejected' and coalesce(e.work_category, '') <> 'unpaid'
                 and e.clock_in >= v_from - interval '45 days' and e.clock_in < v_to
               group by 1, 2, 3, 4) z), '[]'::jsonb));
end $$;

revoke execute on function public.fin_cash_settings_save(uuid, jsonb), public.fin_collection_terms_save(uuid, uuid, jsonb),
  public.fin_milestone_progress_rule_save(uuid, jsonb), public.fin_milestone_progress_confirm(uuid, jsonb), public.fin_commitment_terms_save(uuid, jsonb),
  public.fin_forecast_override_save(uuid, jsonb), public.fin_cash_alert_set(uuid, jsonb), public.fin_forecast_labor(uuid, date, date) from public, anon;
grant execute on function public.fin_cash_settings_save(uuid, jsonb), public.fin_collection_terms_save(uuid, uuid, jsonb),
  public.fin_milestone_progress_rule_save(uuid, jsonb), public.fin_milestone_progress_confirm(uuid, jsonb), public.fin_commitment_terms_save(uuid, jsonb),
  public.fin_forecast_override_save(uuid, jsonb), public.fin_cash_alert_set(uuid, jsonb), public.fin_forecast_labor(uuid, date, date) to authenticated;
-- Server-only writers (the page and the daily job call these with the service role after computing from RLS-scoped data).
revoke execute on function public.fin_cash_alerts_sync(uuid, jsonb), public.fin_cash_alerts_mark_notified(uuid[]), public.fin_forecast_snapshot_save(uuid, jsonb)
  from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fin_cash_alerts_sync(uuid, jsonb), public.fin_cash_alerts_mark_notified(uuid[]), public.fin_forecast_snapshot_save(uuid, jsonb),
      public.fin_forecast_labor(uuid, date, date) to service_role;
    grant select on public.fin_cash_settings, public.fin_customer_collection_terms, public.fin_milestone_progress_rules, public.fin_commitment_terms,
      public.fin_forecast_overrides, public.fin_cash_alerts, public.fin_forecast_snapshots to service_role;
  end if;
end $$;
