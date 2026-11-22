-- Revenue & Commission Reconciliation (James 2026-11-22).
-- Connects the systems that already exist (Stripe webhook, Sales Hub commissions/statements, Affiliate Hub commissions,
-- the V8.1 payout ledger + Stripe Global Payouts adapter, and the QuickBooks platform bills) into one verified flow:
--
--   1. billing_invoice_facts: Stripe's own record of every Built2Bid customer invoice (paid, refunded, disputed),
--      written by the webhook and re-checked daily against Stripe. Evidence only: NOT a second commission ledger.
--   2. Payment gate: no LIVE payout or production QuickBooks bill for a commission unless its Stripe invoice is
--      verified paid (live mode, USD, > $0, right customer, no open/lost dispute, not fully refunded unless the
--      agreement keeps it). payout_plan, affiliate_payout_plan, qb_payout_candidates and qb_payout_bill_reserve are
--      copied from their latest definitions with that one extra condition. Test mode / sandbox are unchanged.
--   3. Standing authorization (off by default): ordinary sales statements are approved automatically by rules
--      instead of a monthly click. Anything unusual stays for the owner (exception-only).
--   4. Daily reconciliation runs, a deduplicated exception queue, and an automatic month-end close that refuses to
--      close while a material discrepancy is open. Closed months are immutable; later changes land in later months.
--   5. QuickBooks: optional automatic bills (standing authorization) and accounting entries (bill + bill payment) for
--      payouts the payout provider has actually settled. Bill payments here are bookkeeping, never money movement.
--
-- Nothing here moves money or changes existing rows. Safe to run more than once.
-- Rollback: docs/reconciliation/rollback_20270223001000.sql

-- ---------------------------------------------------------------------------------------------------
-- 1. Stripe invoice evidence
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.billing_invoice_facts (
  invoice_id         text primary key check (char_length(invoice_id) between 3 and 255),
  livemode           boolean not null,
  user_id            uuid references auth.users (id) on delete set null,
  stripe_customer_id text check (char_length(stripe_customer_id) <= 255),
  subscription_id    text check (char_length(subscription_id) <= 255),
  status             text not null check (status in ('draft', 'open', 'paid', 'uncollectible', 'void')),
  billing_reason     text check (char_length(billing_reason) <= 60),
  currency           text not null default 'usd' check (char_length(currency) = 3),
  amount_due_cents   integer not null default 0 check (amount_due_cents >= 0),
  amount_paid_cents  integer not null default 0 check (amount_paid_cents >= 0),
  pretax_paid_cents  integer not null default 0 check (pretax_paid_cents >= 0),
  refunded_cents     integer not null default 0 check (refunded_cents >= 0),
  dispute_status     text check (dispute_status in ('open', 'won', 'lost')),
  paid_at            timestamptz,
  failed_at          timestamptz,
  refunded_at        timestamptz,
  period_start       timestamptz,
  period_end         timestamptz,
  stripe_created     timestamptz,
  first_source       text not null check (first_source in ('webhook', 'reconcile')),
  last_source        text not null check (last_source in ('webhook', 'reconcile')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists billing_invoice_facts_user on public.billing_invoice_facts (user_id, paid_at desc);
create index if not exists billing_invoice_facts_paid on public.billing_invoice_facts (paid_at) where status = 'paid';
alter table public.billing_invoice_facts enable row level security;
revoke all on public.billing_invoice_facts from public, anon, authenticated;
grant all on public.billing_invoice_facts to service_role;

create or replace function public.recon_invoice_rank(p_status text) returns integer
language sql immutable as $$ select case p_status when 'draft' then 0 when 'open' then 1 when 'uncollectible' then 2 when 'paid' then 3 when 'void' then 3 else 0 end $$;

-- Upsert one invoice from a Stripe invoice object (webhook or daily reconciliation). Out-of-order safe: a paid or void
-- invoice never goes back to open, amounts only grow, and the first known customer is kept.
create or replace function public.billing_invoice_record(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.billing_invoice_facts; v_id text := p->>'invoice_id'; v_status text := coalesce(p->>'status', 'open'); v_user uuid; v_src text;
  v_new_status text;
begin
  if v_id is null or char_length(v_id) not between 3 and 255 then return jsonb_build_object('action', 'invalid'); end if;
  if v_status not in ('draft', 'open', 'paid', 'uncollectible', 'void') then v_status := 'open'; end if;
  v_src := case when p->>'source' = 'reconcile' then 'reconcile' else 'webhook' end;
  v_user := nullif(p->>'user_id', '')::uuid;
  if v_user is null and p->>'customer' is not null then select user_id into v_user from public.billing_customers where stripe_customer_id = p->>'customer'; end if;
  if v_user is null and p->>'subscription_id' is not null then select user_id into v_user from public.subscriptions where stripe_subscription_id = p->>'subscription_id'; end if;
  select * into o from public.billing_invoice_facts where invoice_id = v_id for update;
  if not found then
    insert into public.billing_invoice_facts (invoice_id, livemode, user_id, stripe_customer_id, subscription_id, status, billing_reason, currency, amount_due_cents,
      amount_paid_cents, pretax_paid_cents, paid_at, failed_at, period_start, period_end, stripe_created, first_source, last_source)
    values (v_id, coalesce((p->>'livemode')::boolean, false), v_user, left(p->>'customer', 255), left(p->>'subscription_id', 255), v_status, left(p->>'billing_reason', 60),
      lower(coalesce(left(p->>'currency', 3), 'usd')), greatest(coalesce((p->>'amount_due')::integer, 0), 0), greatest(coalesce((p->>'amount_paid')::integer, 0), 0),
      greatest(coalesce((p->>'pretax_paid')::integer, 0), 0), (p->>'paid_at')::timestamptz, (p->>'failed_at')::timestamptz,
      (p->>'period_start')::timestamptz, (p->>'period_end')::timestamptz, (p->>'created')::timestamptz, v_src, v_src);
    return jsonb_build_object('action', 'inserted', 'status', v_status);
  end if;
  v_new_status := case when o.status in ('paid', 'void') then o.status
                       when public.recon_invoice_rank(v_status) >= public.recon_invoice_rank(o.status) then v_status else o.status end;
  update public.billing_invoice_facts set
    status = v_new_status,
    user_id = coalesce(o.user_id, v_user),
    stripe_customer_id = coalesce(o.stripe_customer_id, left(p->>'customer', 255)),
    subscription_id = coalesce(o.subscription_id, left(p->>'subscription_id', 255)),
    billing_reason = coalesce(o.billing_reason, left(p->>'billing_reason', 60)),
    amount_due_cents = greatest(o.amount_due_cents, coalesce((p->>'amount_due')::integer, 0)),
    amount_paid_cents = greatest(o.amount_paid_cents, coalesce((p->>'amount_paid')::integer, 0)),
    pretax_paid_cents = greatest(o.pretax_paid_cents, coalesce((p->>'pretax_paid')::integer, 0)),
    paid_at = coalesce(o.paid_at, (p->>'paid_at')::timestamptz),
    failed_at = coalesce((p->>'failed_at')::timestamptz, o.failed_at),
    period_start = coalesce(o.period_start, (p->>'period_start')::timestamptz),
    period_end = coalesce(o.period_end, (p->>'period_end')::timestamptz),
    last_source = v_src, updated_at = now()
  where invoice_id = v_id;
  return jsonb_build_object('action', case when v_new_status <> o.status or coalesce((p->>'amount_paid')::integer, 0) > o.amount_paid_cents then 'updated' else 'unchanged' end, 'status', v_new_status);
end $$;

-- A refund on the invoice's charge (cumulative amount, as Stripe reports it). 'unknown' = record the invoice first.
create or replace function public.billing_invoice_refund(p_invoice text, p_refunded_cents integer, p_at timestamptz default now()) returns text
language plpgsql security definer set search_path = public as $$
declare o public.billing_invoice_facts;
begin
  select * into o from public.billing_invoice_facts where invoice_id = p_invoice for update;
  if not found then return 'unknown'; end if;
  if coalesce(p_refunded_cents, 0) <= o.refunded_cents then return 'unchanged'; end if;
  update public.billing_invoice_facts set refunded_cents = p_refunded_cents, refunded_at = coalesce(p_at, now()), updated_at = now() where invoice_id = p_invoice;
  return 'changed';
end $$;

create or replace function public.billing_invoice_dispute(p_invoice text, p_status text) returns text
language plpgsql security definer set search_path = public as $$
declare o public.billing_invoice_facts;
begin
  if p_status not in ('open', 'won', 'lost') then return 'invalid'; end if;
  select * into o from public.billing_invoice_facts where invoice_id = p_invoice for update;
  if not found then return 'unknown'; end if;
  if o.dispute_status is not distinct from p_status then return 'unchanged'; end if;
  update public.billing_invoice_facts set dispute_status = p_status, updated_at = now() where invoice_id = p_invoice;
  return 'changed';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Payment verification (the non-negotiable rule)
-- ---------------------------------------------------------------------------------------------------
-- Problems with the customer payment behind one commission line. Codes in recon_review_codes() only stop AUTOMATIC
-- approval (a person can still approve under the existing policy); every other code blocks live payment entirely.
create or replace function public.recon_review_codes() returns text[]
language sql immutable as $$ select array['partial_refund', 'in_refund_hold', 'bonus_line', 'above_auto_limit', 'own_statement']::text[] $$;

create or replace function public.recon_gate(p text[]) returns text[]
language sql immutable as $$ select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(p, '{}')) x where not (x = any (public.recon_review_codes())) $$;

create or replace function public.recon_payment_problems(p_invoice text, p_user uuid, p_now timestamptz default now()) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare f public.billing_invoice_facts; v text[] := '{}';
begin
  if p_invoice is null then return array['no_invoice']; end if;
  select * into f from public.billing_invoice_facts where invoice_id = p_invoice;
  if not found then return array['invoice_not_verified']; end if;
  if not f.livemode then v := array_append(v, 'not_live_payment'); end if;
  if f.status <> 'paid' then v := array_append(v, 'invoice_not_paid'); end if;
  if f.amount_paid_cents <= 0 then v := array_append(v, 'zero_payment'); end if;
  if f.currency <> 'usd' then v := array_append(v, 'currency_mismatch'); end if;
  if p_user is not null and f.user_id is not null and f.user_id <> p_user then v := array_append(v, 'customer_mismatch'); end if;
  if f.dispute_status in ('open', 'lost') then v := array_append(v, 'dispute_' || f.dispute_status); end if;
  if f.amount_paid_cents > 0 and f.refunded_cents >= f.amount_paid_cents then v := array_append(v, 'fully_refunded');
  elsif f.refunded_cents > 0 then v := array_append(v, 'partial_refund'); end if;
  if f.paid_at is null or f.paid_at > p_now - interval '30 days' then v := array_append(v, 'in_refund_hold'); end if;
  return v;
end $$;

-- One Sales Hub line. Bonus / accelerator lines come from collected revenue, not one invoice: they always go to a person.
-- A refund the agreement keeps (never_reverse, or after the 30-day hold under hold_30_no_clawback) doesn't block.
create or replace function public.recon_sales_line_problems(p_id uuid, p_now timestamptz default now()) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare c public.sales_commissions; cfg public.sales_settings; f public.billing_invoice_facts; v text[];
begin
  select * into c from public.sales_commissions where id = p_id;
  if not found then return array['not_found']; end if;
  if c.kind = 'clawback' or c.amount_cents <= 0 then return '{}'; end if;
  if c.kind <> 'commission' then return array['bonus_line']; end if;
  v := public.recon_payment_problems(c.stripe_invoice_id, c.user_id, p_now);
  if 'fully_refunded' = any (v) then
    select * into cfg from public.sales_settings where id;
    select * into f from public.billing_invoice_facts where invoice_id = c.stripe_invoice_id;
    if cfg.refund_policy = 'never_reverse' or (cfg.refund_policy = 'hold_30_no_clawback' and f.refunded_at >= c.created_at + interval '30 days') then
      v := array_remove(v, 'fully_refunded');
    end if;
  end if;
  return v;
end $$;

create or replace function public.recon_statement_problems(p_statement uuid, p_now timestamptz default now()) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x order by x), '{}') from public.sales_commissions c
  cross join lateral unnest(public.recon_sales_line_problems(c.id, p_now)) x
  where c.statement_id = p_statement and c.status in ('earned', 'approved')
$$;

create or replace function public.recon_statement_ready(p_statement uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select cardinality(public.recon_gate(public.recon_statement_problems(p_statement, now()))) = 0
$$;

create or replace function public.recon_affiliate_line_problems(p_id uuid, p_now timestamptz default now()) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare c public.affiliate_commissions;
begin
  select * into c from public.affiliate_commissions where id = p_id;
  if not found then return array['not_found']; end if;
  if c.amount_cents <= 0 then return '{}'; end if;
  return public.recon_payment_problems(c.invoice_id, c.user_id, p_now);
end $$;

create or replace function public.recon_affiliate_ready(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select cardinality(public.recon_gate(public.recon_affiliate_line_problems(p_id, now()))) = 0
$$;

-- Invoices a commission points at that Stripe hasn't confirmed to us yet (the daily run fetches them from Stripe).
create or replace function public.recon_unverified_invoice_ids(p_limit integer default 200) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(i), '{}') from (
    select distinct x.i from (
      select c.stripe_invoice_id i from public.sales_commissions c where c.stripe_invoice_id is not null and c.status in ('pending', 'earned', 'approved', 'paid')
      union all select a.invoice_id from public.affiliate_commissions a where a.invoice_id is not null and a.status in ('pending', 'payable', 'paid', 'held')
    ) x where not exists (select 1 from public.billing_invoice_facts f where f.invoice_id = x.i)
    limit greatest(1, least(p_limit, 1000))) q
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Settings (standing authorization), runs, exceptions, periods
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.recon_settings (
  id                         boolean primary key default true check (id),
  auto_approve_statements    boolean not null default false,
  auto_approve_limit_cents   integer not null default 150000 check (auto_approve_limit_cents between 100 and 100000000),
  auto_approve_from_day      integer not null default 3 check (auto_approve_from_day between 1 and 28),
  qb_auto_bills              boolean not null default false,
  qb_record_provider_payouts boolean not null default false,
  qb_payment_account_id      text check (qb_payment_account_id ~ '^\d{1,32}$'),
  qb_payment_account_name    text check (char_length(qb_payment_account_name) <= 200),
  close_grace_days           integer not null default 3 check (close_grace_days between 1 and 20),
  authorized_by              uuid references auth.users (id) on delete set null,
  authorized_at              timestamptz,
  updated_by                 uuid references auth.users (id) on delete set null,
  updated_at                 timestamptz not null default now()
);
insert into public.recon_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.recon_runs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('daily', 'manual')),
  status       text not null default 'running' check (status in ('running', 'passed', 'exceptions', 'failed')),
  triggered_by uuid references auth.users (id) on delete set null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  steps        jsonb not null default '{}'::jsonb,
  error        text check (char_length(error) <= 1000)
);
create index if not exists recon_runs_started on public.recon_runs (started_at desc);

create table if not exists public.recon_exceptions (
  id              uuid primary key default gen_random_uuid(),
  fingerprint     text not null check (char_length(fingerprint) between 3 and 300),
  scope           text not null check (scope in ('verify', 'db', 'approve', 'stripe', 'quickbooks', 'close')),
  kind            text not null check (char_length(kind) between 3 and 60),
  severity        text not null check (severity in ('material', 'action', 'info')),
  entity_type     text check (char_length(entity_type) <= 60),
  entity_id       text check (char_length(entity_id) <= 200),
  period_month    date,
  amount_cents    bigint,
  summary         text not null check (char_length(summary) between 1 and 500),
  detail          jsonb,
  status          text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  occurrences     integer not null default 1,
  last_run_id     uuid references public.recon_runs (id) on delete set null,
  notified_at     timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null,
  acknowledged_at timestamptz,
  ack_note        text check (char_length(ack_note) <= 1000),
  resolved_at     timestamptz,
  resolution      text check (char_length(resolution) <= 300)
);
-- One live exception per problem: a repeat sighting bumps the count instead of a new row (and a new email).
create unique index if not exists recon_exceptions_once on public.recon_exceptions (fingerprint) where status <> 'resolved';
create index if not exists recon_exceptions_status on public.recon_exceptions (status, severity, last_seen_at desc);

create table if not exists public.recon_periods (
  period_month    date primary key check (extract(day from period_month) = 1),
  status          text not null default 'open' check (status in ('open', 'blocked', 'closed')),
  report          jsonb,
  report_sha256   text check (report_sha256 ~ '^[0-9a-f]{64}$'),
  blocked_reasons text[] not null default '{}',
  attempts        integer not null default 0,
  last_attempt_at timestamptz,
  closed_at       timestamptz,
  run_id          uuid references public.recon_runs (id) on delete set null
);
create or replace function public.recon_periods_guard() returns trigger language plpgsql as $$
begin
  if old.status = 'closed' then raise exception 'period_closed' using errcode = '42501'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists recon_periods_immutable on public.recon_periods;
create trigger recon_periods_immutable before update or delete on public.recon_periods for each row execute function public.recon_periods_guard();

do $$ declare t text; begin
  foreach t in array array['recon_settings', 'recon_runs', 'recon_exceptions', 'recon_periods'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- QuickBooks: bills recorded for payouts the provider already settled (bookkeeping only).
alter table public.qb_payout_bills add column if not exists paid_via text not null default 'quickbooks' check (paid_via in ('quickbooks', 'provider'));
alter table public.qb_payout_bills add column if not exists payout_id uuid references public.payouts (id) on delete restrict;
alter table public.qb_payout_bills add column if not exists qb_payment_id text check (qb_payment_id ~ '^\d{1,32}$');

create or replace function public.admin_recon_settings_save(p_caller uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.recon_settings; v_turning_on boolean;
begin
  perform public.staff_require_owner(p_caller);
  select * into s from public.recon_settings where id for update;
  v_turning_on := (coalesce((p->>'auto_approve_statements')::boolean, s.auto_approve_statements) and not s.auto_approve_statements)
    or (coalesce((p->>'qb_auto_bills')::boolean, s.qb_auto_bills) and not s.qb_auto_bills)
    or (coalesce((p->>'qb_record_provider_payouts')::boolean, s.qb_record_provider_payouts) and not s.qb_record_provider_payouts)
    or (coalesce((p->>'auto_approve_limit_cents')::integer, s.auto_approve_limit_cents) > s.auto_approve_limit_cents);
  if v_turning_on and coalesce((p->>'confirm')::boolean, false) is not true then raise exception 'confirm_required' using errcode = '22023'; end if;
  update public.recon_settings set
    auto_approve_statements = coalesce((p->>'auto_approve_statements')::boolean, auto_approve_statements),
    auto_approve_limit_cents = coalesce((p->>'auto_approve_limit_cents')::integer, auto_approve_limit_cents),
    auto_approve_from_day = coalesce((p->>'auto_approve_from_day')::integer, auto_approve_from_day),
    qb_auto_bills = coalesce((p->>'qb_auto_bills')::boolean, qb_auto_bills),
    qb_record_provider_payouts = coalesce((p->>'qb_record_provider_payouts')::boolean, qb_record_provider_payouts),
    qb_payment_account_id = case when p ? 'qb_payment_account_id' then nullif(p->>'qb_payment_account_id', '') else qb_payment_account_id end,
    qb_payment_account_name = case when p ? 'qb_payment_account_name' then left(nullif(p->>'qb_payment_account_name', ''), 200) else qb_payment_account_name end,
    close_grace_days = coalesce((p->>'close_grace_days')::integer, close_grace_days),
    authorized_by = case when v_turning_on then p_caller else authorized_by end,
    authorized_at = case when v_turning_on then now() else authorized_at end,
    updated_by = p_caller, updated_at = now()
  where id returning * into s;
  perform public.staff_audit(p_caller, 'recon.settings_saved', 'recon_settings', 'singleton', p - 'confirm');
  return to_jsonb(s);
end $$;

-- One run at a time. A run left 'running' for 20+ minutes (timeout, deploy) is marked failed and a new one starts.
create or replace function public.recon_run_begin(p_kind text, p_caller uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('recon_run_begin'));
  update public.recon_runs set status = 'failed', finished_at = now(), error = 'interrupted' where status = 'running' and started_at < now() - interval '20 minutes';
  if exists (select 1 from public.recon_runs where status = 'running') then return null; end if;
  insert into public.recon_runs (kind, triggered_by) values (case when p_kind = 'manual' then 'manual' else 'daily' end, p_caller) returning id into v_id;
  return v_id;
end $$;

create or replace function public.recon_run_finish(p_run uuid, p_status text, p_steps jsonb, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.recon_runs set status = case when p_status in ('passed', 'exceptions', 'failed') then p_status else 'failed' end, steps = coalesce(p_steps, '{}'::jsonb),
    error = left(p_error, 1000), finished_at = now() where id = p_run and status = 'running'
$$;

-- Applies one run's findings. A finding seen again bumps its count; an open/acknowledged exception in a checked scope that
-- is no longer found is resolved as 'cleared' (the underlying records changed). Nothing is ever resolved by editing money.
-- Returns the exceptions to tell the owner about (new material/action ones; open ones re-sent once a week).
create or replace function public.recon_exceptions_sync(p_run uuid, p_findings jsonb, p_scopes text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f jsonb; v_new integer := 0; v_resolved integer := 0; v_seen text[] := '{}';
begin
  for f in select * from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) loop
    continue when f->>'fingerprint' is null;
    v_seen := array_append(v_seen, f->>'fingerprint');
    update public.recon_exceptions set last_seen_at = now(), occurrences = occurrences + 1, last_run_id = p_run,
      severity = coalesce(f->>'severity', severity), summary = left(coalesce(f->>'summary', summary), 500), detail = coalesce(f->'detail', detail),
      amount_cents = coalesce((f->>'amount_cents')::bigint, amount_cents)
    where fingerprint = f->>'fingerprint' and status <> 'resolved';
    if not found then
      insert into public.recon_exceptions (fingerprint, scope, kind, severity, entity_type, entity_id, period_month, amount_cents, summary, detail, last_run_id)
      values (left(f->>'fingerprint', 300), f->>'scope', left(f->>'kind', 60), coalesce(f->>'severity', 'material'), left(f->>'entity_type', 60), left(f->>'entity_id', 200),
        (f->>'period_month')::date, (f->>'amount_cents')::bigint, left(coalesce(f->>'summary', f->>'kind'), 500), f->'detail', p_run);
      v_new := v_new + 1;
    end if;
  end loop;
  update public.recon_exceptions set status = 'resolved', resolved_at = now(), resolution = 'cleared: no longer detected'
  where status <> 'resolved' and scope = any (p_scopes) and not (fingerprint = any (v_seen));
  get diagnostics v_resolved = row_count;
  return jsonb_build_object('new', v_new, 'resolved', v_resolved,
    'open_material', (select count(*) from public.recon_exceptions where status = 'open' and severity = 'material'),
    'notify', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'severity', e.severity, 'summary', e.summary, 'amount_cents', e.amount_cents,
        'first_seen_at', e.first_seen_at, 'repeat', e.notified_at is not null) order by e.severity, e.first_seen_at)
      from public.recon_exceptions e
      where e.status = 'open' and e.severity in ('material', 'action')
        -- Outages retry quietly; only a problem seen on 3 runs is worth an email.
        and (e.kind not in ('stripe_unavailable', 'quickbooks_unavailable') or e.occurrences >= 3)
        and (e.notified_at is null or e.notified_at < now() - interval '7 days')), '[]'::jsonb));
end $$;

create or replace function public.recon_exceptions_mark_notified(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$ update public.recon_exceptions set notified_at = now() where id = any (p_ids) $$;

create or replace function public.admin_recon_exception_ack(p_caller uuid, p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.recon_exceptions;
begin
  perform public.staff_require_cap(p_caller, 'reconcile');
  if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'note_required' using errcode = '22023'; end if;
  update public.recon_exceptions set status = 'acknowledged', acknowledged_by = p_caller, acknowledged_at = now(), ack_note = left(btrim(p_note), 1000)
  where id = p_id and status = 'open' returning * into e;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  perform public.staff_audit(p_caller, 'recon.exception_acknowledged', 'recon_exception', p_id::text, jsonb_build_object('kind', e.kind, 'note', e.ack_note));
  return to_jsonb(e);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Automatic statement approval (standing authorization, exception-only)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.recon_auto_approve(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.recon_settings; cfg public.sales_settings; st public.sales_statements; v text[]; g text[]; v_ok integer := 0; v_findings jsonb := '[]'::jsonb;
  v_month date; v_rep text;
begin
  if not pg_try_advisory_xact_lock(hashtext('recon_auto_approve')) then return jsonb_build_object('skipped', 'locked'); end if;
  select * into s from public.recon_settings where id;
  if not s.auto_approve_statements then return jsonb_build_object('skipped', 'off', 'findings', v_findings); end if;
  if s.authorized_by is null or not public.is_admin(s.authorized_by) then
    return jsonb_build_object('skipped', 'authorization_missing', 'findings', jsonb_build_array(jsonb_build_object('fingerprint', 'auto_approve_unauthorized', 'scope', 'approve',
      'kind', 'auto_approve_unauthorized', 'severity', 'action', 'summary', 'Automatic approval is on, but the person who authorized it is no longer an owner. Turn it on again.')));
  end if;
  select * into cfg from public.sales_settings where id;
  if cfg.policy_confirmed_at is null then return jsonb_build_object('skipped', 'policy_not_confirmed', 'findings', v_findings); end if;
  if extract(day from p_now at time zone 'America/Chicago') < s.auto_approve_from_day then return jsonb_build_object('skipped', 'before_approval_day', 'findings', v_findings); end if;
  v_month := public.sales_month_of(p_now);
  for st in select * from public.sales_statements where status = 'open' and period_month < v_month order by period_month for update skip locked loop
    perform public.sales_statement_refresh(st.id);
    select * into st from public.sales_statements where id = st.id;
    continue when st.total_cents <= 0;
    v := public.recon_statement_problems(st.id, p_now);
    if st.total_cents > s.auto_approve_limit_cents then v := array_append(v, 'above_auto_limit'); end if;
    if exists (select 1 from public.sales_reps r where r.id = st.rep_id and r.user_id = s.authorized_by) then v := array_append(v, 'own_statement'); end if;
    if cardinality(v) = 0 then
      update public.sales_commissions set status = 'approved', approved_at = now(), updated_at = now() where statement_id = st.id and status = 'earned';
      update public.sales_statements set status = 'approved', approved_at = now(), approved_by = s.authorized_by where id = st.id;
      perform public.sales_audit(s.authorized_by, 'sales.statement_auto_approved', 'sales_statement', st.id::text, jsonb_build_object('total_cents', st.total_cents, 'rep', st.rep_id,
        'rule', 'standing_authorization', 'authorized_at', s.authorized_at, 'limit_cents', s.auto_approve_limit_cents));
      v_ok := v_ok + 1;
    else
      g := public.recon_gate(v);
      select full_name into v_rep from public.sales_reps where id = st.rep_id;
      v_findings := v_findings || jsonb_build_object('fingerprint', 'statement_needs_review:' || st.id, 'scope', 'approve', 'kind', 'statement_needs_review',
        'severity', case when cardinality(g) > 0 then 'material' when v = array['in_refund_hold'] then 'info' else 'action' end,
        'entity_type', 'sales_statement', 'entity_id', st.id::text, 'period_month', st.period_month, 'amount_cents', st.total_cents,
        'summary', left(coalesce(v_rep, 'Rep') || ' ' || to_char(st.period_month, 'Mon YYYY') || ' statement waits: ' || array_to_string(v, ', '), 500),
        'detail', jsonb_build_object('problems', v, 'rep', st.rep_id));
    end if;
  end loop;
  return jsonb_build_object('approved', v_ok, 'findings', v_findings);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Database-side reconciliation checks (Stripe facts -> attribution -> ledgers -> statements -> payouts -> QuickBooks)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.recon_db_findings(p_now timestamptz default now(), p_stripe_ok boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; cfg public.sales_settings; v_payment_codes text[] := array['no_invoice', 'invoice_not_verified', 'not_live_payment', 'invoice_not_paid', 'zero_payment', 'currency_mismatch', 'customer_mismatch'];
begin
  select * into cfg from public.sales_settings where id;
  with f(fingerprint, scope, kind, severity, entity_type, entity_id, period_month, amount_cents, summary, detail) as (
    -- Approved or paid sales commission without a verified customer payment (paid lines: only the payment itself counts here).
    select 'commission_unverified:sales:' || c.id, 'verify', 'commission_unverified', 'material', 'sales_commission', c.id::text, c.period_month, c.amount_cents::bigint,
      'Sales commission ' || c.status || ' without a verified customer payment (' || array_to_string(x.g, ', ') || ')', jsonb_build_object('invoice', c.stripe_invoice_id, 'problems', x.g)
    from public.sales_commissions c
    cross join lateral (select case when c.status = 'paid' then (select coalesce(array_agg(y), '{}') from unnest(public.recon_gate(public.recon_sales_line_problems(c.id, p_now))) y where y = any (v_payment_codes))
                                    else public.recon_gate(public.recon_sales_line_problems(c.id, p_now)) end g) x
    where p_stripe_ok and c.kind = 'commission' and c.amount_cents > 0 and c.status in ('approved', 'paid') and cardinality(x.g) > 0
      and (c.user_id is null or not public.is_demo_account(c.user_id))
    union all
    select 'commission_unverified:affiliate:' || c.id, 'verify', 'commission_unverified', 'material', 'affiliate_commission', c.id::text, date_trunc('month', c.anniversary_date)::date, c.amount_cents::bigint,
      'Affiliate commission ' || c.status || ' without a verified customer payment (' || array_to_string(x.g, ', ') || ')', jsonb_build_object('invoice', c.invoice_id, 'problems', x.g)
    from public.affiliate_commissions c
    cross join lateral (select case when c.status = 'paid' then (select coalesce(array_agg(y), '{}') from unnest(public.recon_gate(public.recon_affiliate_line_problems(c.id, p_now))) y where y = any (v_payment_codes))
                                    else public.recon_gate(public.recon_affiliate_line_problems(c.id, p_now)) end g) x
    where p_stripe_ok and c.amount_cents > 0 and c.status in ('payable', 'paid') and cardinality(x.g) > 0 and not public.is_demo_account(c.user_id)
    union all
    -- Refunded / charged back after the commission was paid, and no recovery or adjustment is on record yet.
    select 'paid_after_refund:sales:' || c.id, 'db', 'paid_after_refund', 'material', 'sales_commission', c.id::text, c.period_month, c.amount_cents::bigint,
      'Sales commission was paid, then the customer payment was ' || case when fi.dispute_status = 'lost' then 'charged back' else 'refunded' end || '. Record a recovery or acknowledge.',
      jsonb_build_object('invoice', c.stripe_invoice_id, 'policy', cfg.refund_policy)
    from public.sales_commissions c join public.billing_invoice_facts fi on fi.invoice_id = c.stripe_invoice_id
    where c.kind = 'commission' and c.status = 'paid' and c.amount_cents > 0
      and (fi.dispute_status = 'lost' or (fi.amount_paid_cents > 0 and fi.refunded_cents >= fi.amount_paid_cents))
      and cfg.refund_policy <> 'never_reverse'
      and not (cfg.refund_policy = 'hold_30_no_clawback' and fi.dispute_status is distinct from 'lost' and fi.refunded_at >= c.created_at + interval '30 days')
      and not exists (select 1 from public.sales_commissions k where k.user_id = c.user_id and k.year_no = c.year_no and k.kind = 'clawback')
    union all
    select 'paid_after_refund:affiliate:' || c.id, 'db', 'paid_after_refund', 'material', 'affiliate_commission', c.id::text, date_trunc('month', c.anniversary_date)::date, c.amount_cents::bigint,
      'Affiliate commission was paid, then the customer payment was ' || case when fi.dispute_status = 'lost' then 'charged back' else 'refunded' end || '. Record a recovery or acknowledge.',
      jsonb_build_object('invoice', c.invoice_id, 'review_flag', c.review_flag)
    from public.affiliate_commissions c join public.billing_invoice_facts fi on fi.invoice_id = c.invoice_id
    where c.status = 'paid' and c.amount_cents > 0
      and (fi.dispute_status = 'lost' or (fi.amount_paid_cents > 0 and fi.refunded_cents >= fi.amount_paid_cents))
      and not exists (select 1 from public.affiliate_adjustments a where a.commission_id = c.id and a.status <> 'void')
    union all
    -- A paid subscription invoice of a referred customer that the commission systems never recorded (missed event).
    select 'paid_invoice_unprocessed:sales:' || fi.invoice_id, 'db', 'paid_invoice_unprocessed', 'material', 'stripe_invoice', fi.invoice_id, date_trunc('month', fi.paid_at)::date, fi.amount_paid_cents::bigint,
      'Paid invoice of a Sales Hub customer was not recorded for commissions', jsonb_build_object('user', fi.user_id, 'rep', a.rep_id)
    from public.billing_invoice_facts fi join public.sales_attributions a on a.user_id = fi.user_id
    where fi.status = 'paid' and fi.livemode and fi.amount_paid_cents > 0 and fi.subscription_id is not null
      and fi.paid_at between p_now - interval '90 days' and p_now - interval '2 days' and a.ended_at is null and a.attributed_at <= fi.paid_at
      and not exists (select 1 from public.sales_revenue r where r.invoice_id = fi.invoice_id)
    union all
    select 'paid_invoice_unprocessed:affiliate:' || fi.invoice_id, 'db', 'paid_invoice_unprocessed', 'material', 'stripe_invoice', fi.invoice_id, date_trunc('month', fi.paid_at)::date, fi.amount_paid_cents::bigint,
      'Paid invoice of an affiliate-referred customer was not recorded for commissions', jsonb_build_object('user', fi.user_id, 'affiliate', r.affiliate_id)
    from public.billing_invoice_facts fi join public.affiliate_referrals r on r.user_id = fi.user_id
    where fi.status = 'paid' and fi.livemode and fi.amount_paid_cents > 0 and fi.subscription_id is not null
      and fi.paid_at between p_now - interval '90 days' and p_now - interval '2 days' and r.ended_at is null and r.attributed_at <= fi.paid_at
      and not exists (select 1 from public.affiliate_invoices ai where ai.invoice_id = fi.invoice_id)
    union all
    -- Statement total must equal its lines.
    select 'statement_total_mismatch:' || st.id, 'db', 'statement_total_mismatch', 'material', 'sales_statement', st.id::text, st.period_month, (st.total_cents - x.lines)::bigint,
      'Statement total ' || to_char(st.total_cents / 100.0, 'FM$999,999,990.00') || ' does not match its lines ' || to_char(x.lines / 100.0, 'FM$999,999,990.00'), jsonb_build_object('rep', st.rep_id)
    from public.sales_statements st
    cross join lateral (select coalesce(sum(c.amount_cents), 0)::bigint lines from public.sales_commissions c where c.statement_id = st.id and c.status in ('earned', 'approved', 'paid')) x
    where st.status in ('approved', 'paid') and st.total_cents <> x.lines
    union all
    -- Two payment routes for one obligation (automatic payout AND a QuickBooks bill).
    select 'duplicate_payment_route:' || r.source_kind || ':' || r.source_id, 'db', 'duplicate_payment_route', 'material', r.source_kind, r.source_id::text, null::date, null::bigint,
      'One obligation has both an automatic payout and a QuickBooks bill. Pay it only once.', jsonb_build_object('routes', r.routes)
    from (select source_kind, source_id, array_agg(distinct route) routes from (
        select i.source_kind, i.source_id, 'provider' route from public.payout_items i join public.payouts p on p.id = i.payout_id
        where p.mode = 'live' and i.active and p.status in ('scheduled', 'needs_approval', 'held', 'submitting', 'submitted', 'paid')
        union all
        select b.source_kind, b.source_id, 'quickbooks' from public.qb_payout_bills b where b.environment = 'production' and b.paid_via = 'quickbooks' and b.status in ('sending', 'open', 'paid')
      ) z group by source_kind, source_id having count(distinct route) > 1) r
    union all
    -- QuickBooks bill amount must equal the obligation.
    select 'qb_amount_mismatch:' || b.id, 'quickbooks', 'qb_amount_mismatch', 'material', 'qb_bill', b.id::text, null::date, (b.amount_cents - x.amt)::bigint,
      'QuickBooks bill ' || b.doc_number || ' is ' || to_char(b.amount_cents / 100.0, 'FM$999,999,990.00') || ' but the obligation is ' || to_char(x.amt / 100.0, 'FM$999,999,990.00'),
      jsonb_build_object('source_kind', b.source_kind, 'source_id', b.source_id)
    from public.qb_payout_bills b
    cross join lateral (select case when b.source_kind = 'sales_statement' then (select total_cents from public.sales_statements where id = b.source_id)
                                    else (select amount_cents from public.affiliate_commissions where id = b.source_id) end::bigint amt) x
    where b.environment = 'production' and b.status in ('open', 'paid') and x.amt is distinct from b.amount_cents::bigint
    union all
    -- An open QuickBooks bill whose obligation is no longer payable: do not pay it in QuickBooks.
    select 'qb_bill_ineligible:' || b.id, 'quickbooks', 'qb_bill_ineligible', 'material', 'qb_bill', b.id::text, null::date, b.amount_cents::bigint,
      'Don''t pay QuickBooks bill ' || b.doc_number || ': its commission is no longer payable (' || x.why || '). Void it in QuickBooks.', jsonb_build_object('source_kind', b.source_kind, 'source_id', b.source_id)
    from public.qb_payout_bills b
    cross join lateral (select case
        when b.source_kind = 'sales_statement' then (select case when s.status <> 'approved' then 'statement ' || s.status when not public.recon_statement_ready(s.id) then 'payment not verified' end from public.sales_statements s where s.id = b.source_id)
        else (select case when c.status <> 'payable' then 'commission ' || c.status when not public.recon_affiliate_ready(c.id) then 'payment not verified' end from public.affiliate_commissions c where c.id = b.source_id) end why) x
    where b.environment = 'production' and b.paid_via = 'quickbooks' and b.status = 'open' and x.why is not null
    union all
    -- Paid in QuickBooks but not marked paid here.
    select 'qb_paid_source_unpaid:' || b.id, 'quickbooks', 'qb_paid_source_unpaid', 'material', 'qb_bill', b.id::text, null::date, b.amount_cents::bigint,
      'QuickBooks shows bill ' || b.doc_number || ' paid, but its commission is not marked paid in Built2Bid', jsonb_build_object('source_kind', b.source_kind, 'source_id', b.source_id)
    from public.qb_payout_bills b
    where b.environment = 'production' and b.paid_via = 'quickbooks' and b.status = 'paid'
      and not exists (select 1 from public.sales_statements s where b.source_kind = 'sales_statement' and s.id = b.source_id and s.status = 'paid')
      and not exists (select 1 from public.affiliate_commissions c where b.source_kind = 'affiliate_commission' and c.id = b.source_id and c.status = 'paid')
    union all
    -- A live payout marked paid without a verified provider confirmation.
    select 'payout_paid_unverified:' || p.id, 'db', 'payout_paid_unverified', 'material', 'payout', p.id::text, null::date, p.net_cents::bigint,
      'Payout ' || p.ref || ' is marked paid without a verified confirmation from the payment provider', null::jsonb
    from public.payouts p
    where p.mode = 'live' and p.status = 'paid'
      and not exists (select 1 from public.payout_events e where e.payout_id = p.id and e.kind = 'posted' and e.verified and e.source in ('webhook', 'poll'))
    union all
    -- A live payout's amount must equal the obligations on it.
    select 'payout_amount_mismatch:' || p.id, 'db', 'payout_amount_mismatch', 'material', 'payout', p.id::text, null::date, (p.gross_cents - x.items)::bigint,
      'Payout ' || p.ref || ' gross ' || to_char(p.gross_cents / 100.0, 'FM$999,999,990.00') || ' differs from its obligations ' || to_char(x.items / 100.0, 'FM$999,999,990.00'), null::jsonb
    from public.payouts p
    cross join lateral (select coalesce(sum(i.amount_cents), 0)::bigint items from public.payout_items i where i.payout_id = p.id and i.active) x
    where p.mode = 'live' and p.status in ('scheduled', 'needs_approval', 'held', 'submitting', 'submitted', 'paid') and p.gross_cents::bigint <> x.items
    union all
    select 'payout_stuck:' || p.id, 'db', 'payout_stuck', 'action', 'payout', p.id::text, null::date, p.net_cents::bigint,
      'Payout ' || p.ref || ' was sent ' || to_char(p.submitted_at at time zone 'America/Chicago', 'Mon DD') || ' and has not settled', null::jsonb
    from public.payouts p where p.mode = 'live' and p.status in ('submitting', 'submitted') and coalesce(p.submitted_at, p.created_at) < p_now - interval '5 days'
    union all
    -- The same customer credited to both a sales rep and an affiliate.
    select 'duplicate_attribution:' || a.user_id, 'db', 'duplicate_attribution', 'material', 'customer', a.user_id::text, null::date, null::bigint,
      'Customer is attributed to both a sales rep and an affiliate. Resolve it in Affiliates → Disputes.', jsonb_build_object('rep', a.rep_id, 'affiliate', r.affiliate_id)
    from public.sales_attributions a join public.affiliate_referrals r on r.user_id = a.user_id
    where a.ended_at is null and r.ended_at is null and not public.is_demo_account(a.user_id)
    union all
    -- A Stripe event that arrived but never finished processing (missed update).
    select 'stripe_event_unprocessed:' || e.id, 'db', 'stripe_event_unprocessed', 'material', 'stripe_event', e.id, null::date, null::bigint,
      'Stripe event ' || e.type || ' was received but not processed' || coalesce(': ' || left(e.error, 200), ''), null::jsonb
    from public.stripe_events e where e.processed_at is null and e.received_at < p_now - interval '1 hour' and e.received_at > p_now - interval '30 days'
    union all
    select 'quickbooks_reauth', 'quickbooks', 'quickbooks_reauth', 'action', 'qb_connection', 'platform', null::date, null::bigint,
      'QuickBooks asked to sign in again (Payments & Payouts → QuickBooks → Reconnect)', null::jsonb
    from public.qb_platform_connection q where q.status = 'needs_reauth'
  )
  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into v from f;
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Monthly report + automatic close
-- ---------------------------------------------------------------------------------------------------
create or replace function public.recon_month_of(p_at timestamptz) returns date
language sql stable as $$ select date_trunc('month', p_at at time zone 'America/Chicago')::date $$;

create or replace function public.recon_period_report(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s timestamptz := (p_month::timestamp at time zone 'America/Chicago'); e timestamptz := ((p_month + interval '1 month')::timestamp at time zone 'America/Chicago');
  v jsonb;
begin
  select jsonb_build_object(
    'period', to_char(p_month, 'YYYY-MM'), 'generated_at', now(),
    'revenue', (select jsonb_build_object(
        'invoices_paid', count(*) filter (where f.status = 'paid' and f.paid_at >= s and f.paid_at < e),
        'collected_cents', coalesce(sum(f.amount_paid_cents) filter (where f.status = 'paid' and f.paid_at >= s and f.paid_at < e), 0),
        'collected_pretax_cents', coalesce(sum(f.pretax_paid_cents) filter (where f.status = 'paid' and f.paid_at >= s and f.paid_at < e), 0),
        'refunded_cents', coalesce(sum(f.refunded_cents) filter (where f.refunded_at >= s and f.refunded_at < e), 0),
        'disputes_open', count(*) filter (where f.dispute_status = 'open'),
        'disputes_lost', count(*) filter (where f.dispute_status = 'lost' and f.updated_at >= s and f.updated_at < e),
        'failed_invoices', count(*) filter (where f.failed_at >= s and f.failed_at < e and f.status <> 'paid'),
        'failed_due_cents', coalesce(sum(f.amount_due_cents) filter (where f.failed_at >= s and f.failed_at < e and f.status <> 'paid'), 0))
      from public.billing_invoice_facts f where f.livemode and (f.user_id is null or not public.is_demo_account(f.user_id))),
    'cancellations', (select count(*) from public.subscriptions x where x.canceled_at >= s and x.canceled_at < e and not public.is_demo_account(x.user_id)),
    'sales', (select jsonb_build_object(
        'earned_cents', coalesce(sum(c.amount_cents) filter (where c.earned_at >= s and c.earned_at < e), 0),
        'approved_cents', coalesce(sum(c.amount_cents) filter (where c.approved_at >= s and c.approved_at < e), 0),
        'paid_cents', coalesce(sum(c.amount_cents) filter (where c.paid_at >= s and c.paid_at < e), 0),
        'reversed_cents', coalesce(sum(c.amount_cents) filter (where c.reversed_at >= s and c.reversed_at < e), 0),
        'pending_cents', coalesce(sum(c.amount_cents) filter (where c.status = 'pending'), 0),
        'outstanding_cents', coalesce(sum(c.amount_cents) filter (where c.status in ('earned', 'approved')), 0))
      from public.sales_commissions c where c.user_id is null or not public.is_demo_account(c.user_id)),
    'affiliates', (select jsonb_build_object(
        'accrued_cents', coalesce(sum(c.amount_cents) filter (where c.created_at >= s and c.created_at < e), 0),
        'payable_cents', coalesce(sum(c.amount_cents) filter (where c.payable_at >= s and c.payable_at < e), 0),
        'paid_cents', coalesce(sum(c.amount_cents) filter (where c.paid_at >= s and c.paid_at < e), 0),
        'reversed_cents', coalesce(sum(c.amount_cents) filter (where c.status in ('reversed', 'canceled') and c.updated_at >= s and c.updated_at < e), 0),
        'outstanding_cents', coalesce(sum(c.amount_cents) filter (where c.status in ('pending', 'payable')), 0),
        'recurring_customers', (select count(*) from public.affiliate_referrals r where r.first_paid_at is not null and r.ended_at is null and not public.is_demo_account(r.user_id)))
      from public.affiliate_commissions c where not public.is_demo_account(c.user_id)),
    'payouts', (select jsonb_build_object(
        'paid_count', count(*) filter (where p.status = 'paid' and p.settled_at >= s and p.settled_at < e),
        'paid_gross_cents', coalesce(sum(p.gross_cents) filter (where p.status = 'paid' and p.settled_at >= s and p.settled_at < e), 0),
        'paid_net_cents', coalesce(sum(p.net_cents) filter (where p.status = 'paid' and p.settled_at >= s and p.settled_at < e), 0),
        'provider_fees_cents', coalesce(sum(p.fee_cents) filter (where p.status = 'paid' and p.settled_at >= s and p.settled_at < e), 0),
        'failed_or_returned', count(*) filter (where p.status in ('failed', 'returned') and p.failed_at >= s and p.failed_at < e),
        'scheduled_cents', coalesce(sum(p.net_cents) filter (where p.status in ('scheduled', 'needs_approval', 'held')), 0),
        'in_transit_cents', coalesce(sum(p.net_cents) filter (where p.status in ('submitting', 'submitted')), 0))
      from public.payouts p where p.mode = 'live'),
    'quickbooks', (select jsonb_build_object(
        'bills_created', count(*) filter (where b.created_at >= s and b.created_at < e),
        'bills_open', count(*) filter (where b.status = 'open'),
        'open_cents', coalesce(sum(b.amount_cents) filter (where b.status = 'open'), 0),
        'bills_paid', count(*) filter (where b.status = 'paid' and b.paid_at >= s and b.paid_at < e),
        'paid_cents', coalesce(sum(b.amount_cents) filter (where b.status = 'paid' and b.paid_at >= s and b.paid_at < e), 0),
        'bills_voided', count(*) filter (where b.status = 'voided' and b.updated_at >= s and b.updated_at < e),
        'bills_failed', count(*) filter (where b.status = 'failed'))
      from public.qb_payout_bills b where b.environment = 'production'),
    'exceptions', (select jsonb_build_object(
        'open_material', count(*) filter (where x.status = 'open' and x.severity = 'material'),
        'open_action', count(*) filter (where x.status = 'open' and x.severity = 'action'),
        'acknowledged', count(*) filter (where x.status = 'acknowledged'),
        'difference_cents', coalesce(sum(abs(x.amount_cents)) filter (where x.status <> 'resolved' and x.severity = 'material'), 0),
        'items', coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'severity', x.severity, 'status', x.status, 'summary', x.summary, 'amount_cents', x.amount_cents,
            'ack_note', x.ack_note) order by x.severity, x.first_seen_at) filter (where x.status <> 'resolved'), '[]'::jsonb))
      from public.recon_exceptions x where x.period_month is null or x.period_month <= p_month)
  ) into v;
  return v;
end $$;

-- Close every finished month (Central time) once its grace days pass, oldest first. Closes only when no material exception
-- is open for that month or earlier (acknowledged ones are documented in the report) and today's Stripe check succeeded.
create or replace function public.recon_close_due(p_run uuid, p_now timestamptz default now(), p_stripe_ok boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.recon_settings; m date; v_first date; v_last date; v_report jsonb; v_reasons text[]; v_closed integer := 0; v_blocked integer := 0; v_findings jsonb := '[]'::jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('recon_close_due')) then return jsonb_build_object('skipped', 'locked'); end if;
  select * into s from public.recon_settings where id;
  v_last := (public.recon_month_of(p_now - make_interval(days => s.close_grace_days)) - interval '1 month')::date;
  select least(
      (select min(public.recon_month_of(paid_at)) from public.billing_invoice_facts where livemode and paid_at is not null),
      (select min(period_month) from public.sales_commissions),
      (select min(date_trunc('month', anniversary_date)::date) from public.affiliate_commissions)) into v_first;
  -- Never earlier than the month this feature shipped, and nothing to close without data.
  v_first := greatest(coalesce(v_first, v_last + 1), date '2026-11-01');
  m := coalesce((select min(period_month) from public.recon_periods where status <> 'closed' and period_month >= v_first), v_first);
  m := least(m, coalesce((select (max(period_month) + interval '1 month')::date from public.recon_periods where status = 'closed'), v_first));
  m := greatest(m, v_first);
  while m <= v_last and v_closed + v_blocked < 6 loop
    if exists (select 1 from public.recon_periods where period_month = m and status = 'closed') then m := (m + interval '1 month')::date; continue; end if;
    v_reasons := '{}';
    if not p_stripe_ok then v_reasons := array_append(v_reasons, 'stripe_check_failed_today'); end if;
    v_reasons := v_reasons || coalesce((select array_agg(distinct x.kind order by x.kind) from public.recon_exceptions x
      where x.status = 'open' and x.severity = 'material' and (x.period_month is null or x.period_month <= m)), '{}');
    v_report := public.recon_period_report(m);
    insert into public.recon_periods (period_month) values (m) on conflict (period_month) do nothing;
    if cardinality(v_reasons) = 0 then
      update public.recon_periods set status = 'closed', report = v_report || jsonb_build_object('status', 'passed'),
        report_sha256 = encode(sha256(convert_to((v_report || jsonb_build_object('status', 'passed'))::text, 'UTF8')), 'hex'),
        blocked_reasons = '{}', attempts = attempts + 1, last_attempt_at = now(), closed_at = now(), run_id = p_run
      where period_month = m;
      perform public.staff_audit(null, 'recon.period_closed', 'recon_period', to_char(m, 'YYYY-MM'), jsonb_build_object('run', p_run));
      v_closed := v_closed + 1;
      m := (m + interval '1 month')::date;
    else
      update public.recon_periods set status = 'blocked', report = v_report || jsonb_build_object('status', 'failed'), blocked_reasons = v_reasons,
        attempts = attempts + 1, last_attempt_at = now(), run_id = p_run
      where period_month = m;
      v_findings := v_findings || jsonb_build_object('fingerprint', 'close_blocked:' || to_char(m, 'YYYY-MM'), 'scope', 'close', 'kind', 'close_blocked',
        -- Only worth an email once the month has waited a week past its grace days.
        'severity', case when p_now > (m + interval '1 month' + make_interval(days => s.close_grace_days + 7)) then 'action' else 'info' end,
        'entity_type', 'recon_period', 'entity_id', to_char(m, 'YYYY-MM'), 'period_month', m,
        'summary', to_char(m, 'Mon YYYY') || ' can''t close yet: ' || array_to_string(v_reasons, ', '), 'detail', jsonb_build_object('reasons', v_reasons));
      v_blocked := v_blocked + 1;
      exit; -- later months wait for this one
    end if;
  end loop;
  return jsonb_build_object('closed', v_closed, 'blocked', v_blocked, 'findings', v_findings);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Admin reads (Payments & Payouts → Reconciliation). Demo / Practice accounts are left out.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_recon_overview(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m date := public.recon_month_of(now()); s timestamptz; e timestamptz;
begin
  perform public.staff_require_cap(p_caller, 'payouts.view');
  s := m::timestamp at time zone 'America/Chicago'; e := (m + interval '1 month')::timestamp at time zone 'America/Chicago';
  return jsonb_build_object(
    'month', to_char(m, 'YYYY-MM'),
    'settings', (select to_jsonb(x) from public.recon_settings x where id),
    'cards', jsonb_build_object(
      'verified_revenue_cents', (select coalesce(sum(amount_paid_cents), 0) from public.billing_invoice_facts where livemode and status = 'paid' and paid_at >= s and paid_at < e and (user_id is null or not public.is_demo_account(user_id))),
      'accrued_sales_cents', (select coalesce(sum(amount_cents), 0) from public.sales_commissions where status in ('earned', 'approved') and (user_id is null or not public.is_demo_account(user_id))),
      'accrued_affiliate_cents', (select coalesce(sum(amount_cents), 0) from public.affiliate_commissions where status in ('pending', 'payable') and not public.is_demo_account(user_id)),
      'awaiting_customer_payment_cents', (select coalesce(sum(amount_due_cents), 0) from public.billing_invoice_facts where livemode and status in ('open', 'uncollectible') and failed_at is not null and (user_id is null or not public.is_demo_account(user_id))),
      'pending_approval_cents', (select coalesce(sum(total_cents), 0) from public.sales_statements where status = 'open' and period_month < public.sales_month_of(now())),
      'qb_awaiting_payment_cents', (select coalesce(sum(amount_cents), 0) from public.qb_payout_bills where environment = 'production' and status = 'open'),
      'payouts_scheduled_cents', (select coalesce(sum(net_cents), 0) from public.payouts where mode = 'live' and status in ('scheduled', 'needs_approval', 'held')),
      'payouts_processing_cents', (select coalesce(sum(net_cents), 0) from public.payouts where mode = 'live' and status in ('submitting', 'submitted')),
      'paid_this_month_cents', (select coalesce(sum(net_cents), 0) from public.payouts where mode = 'live' and status = 'paid' and settled_at >= s and settled_at < e)
        + (select coalesce(sum(amount_cents), 0) from public.qb_payout_bills where environment = 'production' and paid_via = 'quickbooks' and status = 'paid' and paid_at >= s and paid_at < e),
      'reversed_this_month_cents', (select coalesce(sum(amount_cents), 0) from public.sales_commissions where reversed_at >= s and reversed_at < e)
        + (select coalesce(sum(amount_cents), 0) from public.affiliate_commissions where status in ('reversed', 'canceled') and updated_at >= s and updated_at < e),
      'open_exceptions', (select count(*) from public.recon_exceptions where status = 'open' and severity in ('material', 'action'))),
    'last_run', (select to_jsonb(r) from public.recon_runs r order by started_at desc limit 1),
    'last_good_run', (select to_jsonb(r) from public.recon_runs r where status in ('passed', 'exceptions') order by started_at desc limit 1),
    'qb', (select jsonb_build_object('status', status, 'environment', environment, 'last_check_at', last_check_at) from public.qb_platform_connection where id),
    'periods', coalesce((select jsonb_agg(jsonb_build_object('period_month', p.period_month, 'status', p.status, 'closed_at', p.closed_at, 'blocked_reasons', p.blocked_reasons,
        'attempts', p.attempts, 'report_sha256', p.report_sha256) order by p.period_month desc) from (select * from public.recon_periods order by period_month desc limit 24) p), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(to_jsonb(x) order by case x.severity when 'material' then 0 when 'action' then 1 else 2 end, x.first_seen_at)
      from (select id, kind, severity, status, summary, entity_type, entity_id, period_month, amount_cents, first_seen_at, last_seen_at, occurrences, ack_note, acknowledged_at
            from public.recon_exceptions where status <> 'resolved' order by first_seen_at limit 200) x), '[]'::jsonb));
end $$;

-- Every commission with its whole chain: customer -> attribution -> Stripe invoice -> commission -> statement/payout -> QuickBooks.
create or replace function public.admin_recon_trace(p_caller uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := lower(btrim(coalesce(p->>'q', ''))); v_status text := nullif(p->>'status', ''); v_program text := nullif(p->>'program', '');
  v_from date := nullif(p->>'from', '')::date; v_to date := nullif(p->>'to', '')::date;
begin
  perform public.staff_require_cap(p_caller, 'payouts.view');
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.period desc, t.customer) from (
    select * from (
      select 'sales' program, c.id, u.email customer, r.full_name payee, a.source attribution, a.attributed_at, c.stripe_invoice_id invoice, fi.status invoice_status,
        fi.amount_paid_cents invoice_paid_cents, fi.paid_at invoice_paid_at, fi.refunded_cents, fi.dispute_status, c.kind, c.year_no, c.period_month period, c.amount_cents, c.status,
        c.policy_version, c.basis_detail->>'rule' rate_rule,
        c.statement_id, st.status statement_status, po.ref payout_ref, po.status payout_status, qb.doc_number qb_bill, qb.status qb_status,
        public.recon_sales_line_problems(c.id, now()) problems
      from public.sales_commissions c
      left join auth.users u on u.id = c.user_id
      left join public.sales_reps r on r.id = c.rep_id
      left join public.sales_attributions a on a.user_id = c.user_id
      left join public.billing_invoice_facts fi on fi.invoice_id = c.stripe_invoice_id
      left join public.sales_statements st on st.id = c.statement_id
      left join lateral (select p2.ref, p2.status from public.payout_items i join public.payouts p2 on p2.id = i.payout_id where i.source_kind = 'sales_statement' and i.source_id = c.statement_id and p2.mode = 'live' order by p2.created_at desc limit 1) po on true
      left join lateral (select b.doc_number, b.status from public.qb_payout_bills b where b.source_kind = 'sales_statement' and b.source_id = c.statement_id and b.environment = 'production' order by b.created_at desc limit 1) qb on true
      where c.user_id is null or not public.is_demo_account(c.user_id)
      union all
      select 'affiliate', c.id, u.email, coalesce(af.display_name, af.email), ar.attribution_source, ar.attributed_at, c.invoice_id, fi.status,
        fi.amount_paid_cents, fi.paid_at, fi.refunded_cents, fi.dispute_status, 'commission', c.year_no, c.anniversary_date, c.amount_cents, c.status,
        c.policy_version, c.basis->>'annual_basis',
        null::uuid, null::text, po.ref, po.status, qb.doc_number, qb.status,
        public.recon_affiliate_line_problems(c.id, now())
      from public.affiliate_commissions c
      left join auth.users u on u.id = c.user_id
      left join public.affiliates af on af.id = c.affiliate_id
      left join public.affiliate_referrals ar on ar.user_id = c.user_id
      left join public.billing_invoice_facts fi on fi.invoice_id = c.invoice_id
      left join lateral (select p2.ref, p2.status from public.payout_items i join public.payouts p2 on p2.id = i.payout_id where i.source_kind = 'affiliate_commission' and i.source_id = c.id and p2.mode = 'live' order by p2.created_at desc limit 1) po on true
      left join lateral (select b.doc_number, b.status from public.qb_payout_bills b where b.source_kind = 'affiliate_commission' and b.source_id = c.id and b.environment = 'production' order by b.created_at desc limit 1) qb on true
      where not public.is_demo_account(c.user_id)
    ) z
    where (v_program is null or z.program = v_program) and (v_status is null or z.status = v_status)
      and (v_from is null or z.period >= v_from) and (v_to is null or z.period <= v_to)
      and (v_q = '' or lower(coalesce(z.customer, '')) like '%' || v_q || '%' or lower(coalesce(z.payee, '')) like '%' || v_q || '%'
           or lower(coalesce(z.invoice, '')) = v_q or lower(coalesce(z.qb_bill, '')) = v_q or lower(coalesce(z.payout_ref, '')) = v_q)
    order by z.period desc limit 300) t), '[]'::jsonb);
end $$;

create or replace function public.admin_recon_period(p_caller uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.recon_periods;
begin
  perform public.staff_require_cap(p_caller, 'payouts.view');
  select * into r from public.recon_periods where period_month = date_trunc('month', p_month)::date;
  if found and r.status = 'closed' then return r.report || jsonb_build_object('closed_at', r.closed_at, 'report_sha256', r.report_sha256, 'period_status', 'closed'); end if;
  return public.recon_period_report(date_trunc('month', p_month)::date) || jsonb_build_object('period_status', coalesce(r.status, 'open'), 'blocked_reasons', coalesce(r.blocked_reasons, '{}'));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 8. QuickBooks bookkeeping for payouts the provider settled (no money moves: the bill payment records what was paid)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.qb_provider_items(p_env text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('payout_id', p.id, 'payout_ref', p.ref, 'provider_ref', p.provider_ref, 'settled_at', p.settled_at, 'source_kind', i.source_kind, 'source_id', i.source_id,
      'amount_cents', i.amount_cents, 'payee_kind', case when i.source_kind = 'sales_statement' then 'sales_rep' else 'affiliate' end,
      'payee_id', case when i.source_kind = 'sales_statement' then (select rep_id from public.sales_statements where id = i.source_id) else p.affiliate_id end,
      'bill_id', b.id, 'bill_status', b.status) order by p.settled_at), '[]'::jsonb)
  from public.payouts p join public.payout_items i on i.payout_id = p.id and i.active
  left join public.qb_payout_bills b on b.source_kind = i.source_kind and b.source_id = i.source_id and b.environment = p_env and b.status in ('sending', 'open', 'paid')
  where p.mode = 'live' and p.status = 'paid' and p_env = 'production' and i.amount_cents > 0
    and (b.id is null or (b.paid_via = 'provider' and b.status = 'open'))
$$;

create or replace function public.qb_provider_bill_reserve(p_payout uuid, p_source_kind text, p_source_id uuid, p_realm text, p_env text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.payouts; i public.payout_items; v_id uuid; v_pkind text; v_payee uuid; v_name text; v_desc text; v_doc text;
begin
  if p_env <> 'production' then raise exception 'production_only'; end if;
  select * into p from public.payouts where id = p_payout and mode = 'live' and status = 'paid';
  if not found then raise exception 'payout_not_settled'; end if;
  select * into i from public.payout_items where payout_id = p_payout and source_kind = p_source_kind and source_id = p_source_id and active;
  if not found then raise exception 'not_on_payout'; end if;
  perform pg_advisory_xact_lock(hashtext('qb_bill:' || p_source_kind || ':' || p_source_id));
  if p_source_kind = 'sales_statement' then
    select r.id, coalesce(nullif(btrim(concat_ws(' ', sm.legal_first_name, sm.legal_last_name)), ''), r.full_name), 'Sales commission statement ' || to_char(st.period_month, 'Mon YYYY'),
      'B2B-S' || to_char(st.period_month, 'YYMM') || '-' || upper(left(replace(st.id::text, '-', ''), 8))
      into v_payee, v_name, v_desc, v_doc
    from public.sales_statements st join public.sales_reps r on r.id = st.rep_id left join public.staff_members sm on sm.sales_rep_id = r.id where st.id = p_source_id;
    v_pkind := 'sales_rep';
  else
    select a.id, coalesce(nullif(btrim(a.business_name), ''), nullif(btrim(a.legal_name), ''), nullif(btrim(a.display_name), ''), a.email),
      'Affiliate commission, year ' || c.year_no || ' (' || to_char(c.anniversary_date, 'Mon YYYY') || ')', 'B2B-A' || to_char(c.anniversary_date, 'YYMM') || '-' || upper(left(replace(c.id::text, '-', ''), 8))
      into v_payee, v_name, v_desc, v_doc
    from public.affiliate_commissions c join public.affiliates a on a.id = c.affiliate_id where c.id = p_source_id;
    v_pkind := 'affiliate';
  end if;
  if v_payee is null then raise exception 'not_found'; end if;
  insert into public.qb_payout_bills (source_kind, source_id, payee_kind, payee_id, payee_name, realm_id, environment, amount_cents, doc_number, description, paid_via, payout_id, created_by)
  values (p_source_kind, p_source_id, v_pkind, v_payee, left(v_name, 200), p_realm, p_env, i.amount_cents, v_doc, left(v_desc || ' (paid by ' || p.ref || ')', 300), 'provider', p.id, null)
  returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'already_billed';
end $$;

create or replace function public.qb_provider_bill_paid(p_bill uuid, p_payment_id text) returns text
language plpgsql security definer set search_path = public as $$
declare b public.qb_payout_bills;
begin
  select * into b from public.qb_payout_bills where id = p_bill and paid_via = 'provider' for update;
  if not found or b.status <> 'open' then return 'skipped'; end if;
  update public.qb_payout_bills set status = 'paid', qb_payment_id = p_payment_id, paid_at = coalesce((select settled_at from public.payouts where id = b.payout_id), now()),
    last_check_at = now(), updated_at = now() where id = b.id;
  perform public.staff_audit(null, 'qb_payout.provider_payment_recorded', b.source_kind, b.source_id::text, jsonb_build_object('bill', b.id, 'payout', b.payout_id, 'qb_payment', p_payment_id));
  return 'paid';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 9. The payment gate in the existing payout and QuickBooks paths (latest definitions + one condition each;
--    live mode / production QuickBooks only, so practice runs behave exactly as before)
-- ---------------------------------------------------------------------------------------------------
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
      -- Reconciliation gate: a live payout only for statements whose customer payments are verified in Stripe.
      and (v_mode <> 'live' or public.recon_statement_ready(st.id))
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
      and (v_mode <> 'live' or public.recon_affiliate_ready(c.id))   -- reconciliation gate (verified customer payment)
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
          and (p_env <> 'production' or public.recon_statement_ready(st.id))
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
          and (p_env <> 'production' or public.recon_affiliate_ready(c.id))
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
  if p_env = 'production' and not (case when p_source_kind = 'sales_statement' then public.recon_statement_ready(p_source_id) else public.recon_affiliate_ready(p_source_id) end) then
    raise exception 'payment_not_verified';
  end if;
  v_block := public.qb_payee_blockers(v_pkind, v_payee);
  if cardinality(v_block) > 0 then raise exception 'blocked:%', array_to_string(v_block, ','); end if;
  insert into public.qb_payout_bills (source_kind, source_id, payee_kind, payee_id, payee_name, realm_id, environment, amount_cents, doc_number, description, created_by)
  values (p_source_kind, p_source_id, v_pkind, v_payee, left(v_name, 200), p_realm, p_env, v_amount, v_doc, v_desc, p_caller)
  returning id into v_id;
  perform public.staff_audit(p_caller, 'qb_payout.bill_reserved', p_source_kind, p_source_id::text, jsonb_build_object('bill', v_id, 'amount_cents', v_amount));
  return v_id;
exception when unique_violation then raise exception 'already_billed';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 10. Grants: everything is server-side (service role); admin reads check the caller's staff capability.
-- ---------------------------------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'public.billing_invoice_record(jsonb)', 'public.billing_invoice_refund(text, integer, timestamptz)', 'public.billing_invoice_dispute(text, text)',
    'public.recon_payment_problems(text, uuid, timestamptz)', 'public.recon_sales_line_problems(uuid, timestamptz)', 'public.recon_statement_problems(uuid, timestamptz)',
    'public.recon_statement_ready(uuid)', 'public.recon_affiliate_line_problems(uuid, timestamptz)', 'public.recon_affiliate_ready(uuid)', 'public.recon_unverified_invoice_ids(integer)',
    'public.admin_recon_settings_save(uuid, jsonb)', 'public.recon_run_begin(text, uuid)', 'public.recon_run_finish(uuid, text, jsonb, text)',
    'public.recon_exceptions_sync(uuid, jsonb, text[])', 'public.recon_exceptions_mark_notified(uuid[])', 'public.admin_recon_exception_ack(uuid, uuid, text)',
    'public.recon_auto_approve(timestamptz)', 'public.recon_db_findings(timestamptz, boolean)', 'public.recon_period_report(date)', 'public.recon_close_due(uuid, timestamptz, boolean)',
    'public.admin_recon_overview(uuid)', 'public.admin_recon_trace(uuid, jsonb)', 'public.admin_recon_period(uuid, date)',
    'public.qb_provider_items(text)', 'public.qb_provider_bill_reserve(uuid, text, uuid, text, text)', 'public.qb_provider_bill_paid(uuid, text)',
    'public.payout_plan(timestamptz)', 'public.affiliate_payout_plan(timestamptz)', 'public.qb_payout_candidates(text)', 'public.qb_payout_bill_reserve(uuid, text, uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
