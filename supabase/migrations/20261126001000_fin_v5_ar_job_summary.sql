-- Built2Bid V5 / V5.1: Accounts Receivable, Project Financials summary, bill payments, two repairs.
--
-- Extends the live Financial Command Center (20261124001000-005000, 20261125001000). Nothing is rebuilt:
--   1. REPAIR fin_vendor_bills_select: the job-visibility branch compared bill_lines.bill_id to bill_lines.id
--      (unqualified `id` bound to the inner table), so a project manager who can see a job never saw that
--      job's vendor bills. Now compares to the outer bill row. (More access for the right people, none for others.)
--   2. REPAIR forecast cost: fin_job_profitability_v.projected_profit took greatest(estimated, actual+committed)
--      over the WHOLE job, so a framing overrun was hidden by trades that hadn't started yet. The forecast is
--      now per cost code (fin_job_budget_v.forecast) and summed. New columns are appended; none are removed.
--   3. fin_bill_payments: paying an approved vendor/subcontractor bill (check, ACH, card, cash...). Partial
--      payments, no overpayment, idempotency key, void with a reason (never delete). This is a record of a
--      payment made outside Built2Bid, not a payout.
--   4. fin_bill_balances_v: bill total, paid, balance.
--   5. fin_job_summary_v: the six Project Financials numbers + unbilled, forecast profit/margin, pending
--      changes and unpaid bills, from the authoritative records only. AR counts issued invoices only.
--   6. fin_ar_invoices_v: the AR table (customer, project, rep, PM, aging) for the Accounts Receivable page.
--
-- Safe to run more than once. Requires 20261125001001_fin_access_retention.sql.
-- Rollback: docs/financials/rollback_20261126001000.sql

-- 1. RLS repair ----------------------------------------------------------------------------------------------
drop policy if exists fin_vendor_bills_select on public.fin_vendor_bills;
create policy fin_vendor_bills_select on public.fin_vendor_bills for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials')
         or exists (select 1 from public.fin_vendor_bill_lines l
                     where l.bill_id = fin_vendor_bills.id and l.job_id is not null and public.fin_job_visible(l.job_id)));

-- 2. Per-line forecast ----------------------------------------------------------------------------------------
create or replace view public.fin_job_budget_v with (security_invoker = true) as
with keys as (
  select job_id, cost_code_id from public.fin_budget_lines
  union select job_id, cost_code_id from public.fin_commitments where status <> 'void'
  union select job_id, cost_code_id from public.fin_job_costs_v)
select x.*, greatest(x.estimated, x.actual + x.committed) as forecast
  from (
    select k.job_id, j.book_id, k.cost_code_id, cc.code, cc.name as cost_code_name, cc.trade_slug, cc.cost_type,
           coalesce((select sum(amount) from public.fin_budget_lines b where b.job_id = k.job_id and b.cost_code_id is not distinct from k.cost_code_id), 0) as estimated,
           coalesce((select sum(open_committed) from public.fin_commitment_balances_v c where c.job_id = k.job_id and c.cost_code_id is not distinct from k.cost_code_id), 0) as committed,
           coalesce((select sum(amount) from public.fin_job_costs_v a where a.job_id = k.job_id and a.cost_code_id is not distinct from k.cost_code_id), 0) as actual
      from keys k join public.fin_jobs j on j.id = k.job_id
      left join public.fin_cost_codes cc on cc.id = k.cost_code_id) x;

create or replace view public.fin_job_profitability_v with (security_invoker = true) as
select c.job_id, c.book_id, c.job_number, c.name, c.status,
       c.current_contract as contract_value,              -- signed contract + approved changes
       c.invoiced as invoiced_revenue,                    -- billed on issued invoices
       coalesce(b.estimated, 0) as estimated_cost,        -- frozen budget from the contract version
       coalesce(b.committed, 0) as committed_cost,        -- open commitments not yet billed
       coalesce(b.actual, 0) as actual_cost,              -- approved bills + approved expenses
       coalesce(b.actual, 0) + coalesce(b.committed, 0) as committed_plus_actual,
       c.current_contract - coalesce(b.estimated, 0) as estimated_profit,
       c.current_contract - coalesce(b.forecast, 0) as projected_profit,   -- per cost code (repair 2)
       c.invoiced - coalesce(b.actual, 0) as actual_profit_to_date,
       c.pending_changes,
       coalesce(b.forecast, 0) as forecast_cost
  from public.fin_job_contract_v c
  left join lateral (select sum(estimated) as estimated, sum(committed) as committed, sum(actual) as actual, sum(forecast) as forecast
                       from public.fin_job_budget_v x where x.job_id = c.job_id) b on true;

-- 3. Bill payments --------------------------------------------------------------------------------------------
create table if not exists public.fin_bill_payments (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  bill_id     uuid not null references public.fin_vendor_bills (id) on delete restrict,
  paid_on     date not null,
  method      text not null check (method in ('check', 'ach', 'card', 'cash', 'wire', 'other')),
  reference   text check (char_length(reference) <= 120),
  amount      numeric(14, 2) not null check (amount > 0),
  memo        text check (char_length(memo) <= 1000),
  status      text not null default 'active' check (status in ('active', 'void')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  voided_by   uuid references auth.users (id) on delete set null,
  voided_at   timestamptz,
  void_reason text check (char_length(void_reason) <= 500),
  constraint fin_bill_payments_void check ((status = 'void') = (voided_at is not null))
);
create index if not exists fin_bill_payments_bill_idx on public.fin_bill_payments (bill_id, status);
create index if not exists fin_bill_payments_book_idx on public.fin_bill_payments (book_id, paid_on desc);

drop trigger if exists fin_bill_payments_guard on public.fin_bill_payments;
create trigger fin_bill_payments_guard before update or delete on public.fin_bill_payments
  for each row execute function public.fin_guard_lifecycle('status', 'voided_by', 'voided_at', 'void_reason');

-- Commit-time backstop: active payments never exceed the bill (catches writes around the RPC).
create or replace function public.fin_check_bill_paid() returns trigger
language plpgsql set search_path = public as $$
declare v_total numeric; v_paid numeric; v_status text;
begin
  select total, status into v_total, v_status from public.fin_vendor_bills where id = new.bill_id;
  select coalesce(sum(amount), 0) into v_paid from public.fin_bill_payments where bill_id = new.bill_id and status = 'active';
  if v_paid > v_total then raise exception 'over_paid_bill' using errcode = '23514'; end if;
  if v_paid > 0 and v_status <> 'approved' then raise exception 'bill_not_approved' using errcode = '22023'; end if;
  return null;
end $$;
drop trigger if exists fin_bill_payments_total on public.fin_bill_payments;
create constraint trigger fin_bill_payments_total after insert or update on public.fin_bill_payments
  deferrable initially deferred for each row execute function public.fin_check_bill_paid();

-- p {billId, paidOn?, method, reference?, amount, memo?}
create or replace function public.fin_bill_payment_record(p_book_id uuid, p jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prior jsonb; b public.fin_vendor_bills; v_amount numeric := (p ->> 'amount')::numeric; v_paid numeric; x public.fin_bill_payments;
begin
  perform public.fin_require(p_book_id, 'record_bills', true);
  v_prior := public.fin_idem_begin(p_book_id, p_idempotency_key, 'bill.pay');
  if v_prior is not null then return v_prior; end if;
  select * into b from public.fin_vendor_bills where id = (p ->> 'billId')::uuid and book_id = p_book_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if b.status <> 'approved' then raise exception 'bill_not_approved' using errcode = '22023'; end if;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.fin_bill_payments where bill_id = b.id and status = 'active';
  if v_paid + v_amount > b.total then raise exception 'over_paid_bill' using errcode = '23514'; end if;
  insert into public.fin_bill_payments (book_id, bill_id, paid_on, method, reference, amount, memo, created_by)
  values (p_book_id, b.id, coalesce(nullif(p ->> 'paidOn', '')::date, current_date), coalesce(nullif(p ->> 'method', ''), 'check'),
          nullif(left(p ->> 'reference', 120), ''), v_amount, nullif(left(p ->> 'memo', 1000), ''), auth.uid())
  returning * into x;
  perform public.fin_audit(p_book_id, 'bill.paid', 'bill', b.id, jsonb_build_object('billPaymentId', x.id, 'amount', x.amount::text, 'method', x.method));
  return public.fin_idem_finish(p_book_id, p_idempotency_key, jsonb_build_object('billPaymentId', x.id, 'balance', (b.total - v_paid - v_amount)::text));
end $$;

create or replace function public.fin_bill_payment_void(p_bill_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare x public.fin_bill_payments;
begin
  select * into x from public.fin_bill_payments where id = p_bill_payment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(x.book_id, 'approve_vendor_bills', true);
  if x.status = 'void' then return; end if;
  update public.fin_bill_payments set status = 'void', voided_at = now(), voided_by = auth.uid(),
         void_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Voided'), 500) where id = x.id;
  perform public.fin_audit(x.book_id, 'bill.payment_voided', 'bill', x.bill_id, jsonb_build_object('billPaymentId', x.id, 'reason', p_reason));
end $$;

-- A bill with active payments can't be voided (void the payments first).
create or replace function public.fin_bill_void_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'void' and old.status <> 'void'
     and exists (select 1 from public.fin_bill_payments where bill_id = new.id and status = 'active') then
    raise exception 'has_payments' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists fin_bill_void_guard on public.fin_vendor_bills;
create trigger fin_bill_void_guard before update on public.fin_vendor_bills for each row execute function public.fin_bill_void_guard();

-- 4. Bill balances -------------------------------------------------------------------------------------------
create or replace view public.fin_bill_balances_v with (security_invoker = true) as
select b.id as bill_id, b.book_id, b.vendor_id, b.number, b.vendor_invoice_number, b.bill_date, b.due_date, b.status, b.total,
       coalesce(p.paid, 0) as paid,
       case when b.status = 'approved' then b.total - coalesce(p.paid, 0) else 0 end as balance,
       case when b.status = 'approved' and b.total - coalesce(p.paid, 0) > 0 and b.due_date < current_date then current_date - b.due_date else 0 end as days_overdue
  from public.fin_vendor_bills b
  left join lateral (select sum(amount) as paid from public.fin_bill_payments x where x.bill_id = b.id and x.status = 'active') p on true;

-- 5. Project Financials summary ------------------------------------------------------------------------------
-- The project's sales rep and PM (for AR filters). A financial viewer may not be able to read the schedule
-- itself, so this reads it as definer, but only for a job the caller can already see.
create or replace function public.fin_job_assignees(p_estimate_id uuid)
returns table (sales_rep_id uuid, project_manager_id uuid)
language sql stable security definer set search_path = public as $$
  select s.sales_rep_id, s.project_manager_id
    from public.project_schedules s
   where s.estimate_id = p_estimate_id and s.status <> 'archived'
     and exists (select 1 from public.fin_jobs j where j.estimate_id = p_estimate_id and public.fin_job_visible(j.id))
   order by s.updated_at desc
   limit 1
$$;
-- Every figure comes from one place:
--   contract_value       fin_job_contract_v.current_contract (snapshot + approved changes; pending excluded)
--   original_estimated_cost  frozen budget (fin_budget_lines) - never overwritten
--   forecast_cost        Σ per cost code greatest(estimated, actual + open committed)
--   invoiced             Σ issued invoice totals (voids and drafts excluded)
--   collected            Σ active payment allocations to this job's issued invoices
--   credited             Σ active credit applications to this job's issued invoices
--   outstanding_ar       Σ issued invoice balances (never future milestones)
--   unbilled             contract_value - invoiced (negative = billed over contract)
--   unpaid_bills         this job's share of approved bills' open balances (a bill split across jobs is
--                        shared in proportion to its lines)
create or replace view public.fin_job_summary_v with (security_invoker = true) as
select p.job_id, p.book_id, c.estimate_id, p.job_number, p.name, p.status,
       p.contract_value, c.original_contract, c.approved_changes + c.deductions + c.corrections as contract_changes,
       p.estimated_cost as original_estimated_cost,
       p.forecast_cost,
       p.actual_cost, p.committed_cost,
       p.invoiced_revenue as invoiced,
       coalesce(inv.collected, 0) as collected,
       coalesce(inv.credited, 0) as credited,
       coalesce(inv.outstanding, 0) as outstanding_ar,
       coalesce(inv.overdue, 0) as overdue_ar,
       p.contract_value - p.invoiced_revenue as unbilled,
       p.contract_value - p.estimated_cost as estimated_profit,
       p.projected_profit as forecast_profit,
       case when p.contract_value > 0 then round(p.projected_profit / p.contract_value * 100, 1) end as forecast_margin_pct,
       case when p.contract_value > 0 then round((p.contract_value - p.estimated_cost) / p.contract_value * 100, 1) end as estimated_margin_pct,
       p.pending_changes,
       coalesce(ap.unpaid, 0) as unpaid_bills,
       coalesce(ap.unpaid_sub, 0) as unpaid_sub_bills,
       ps.sales_rep_id, ps.project_manager_id
  from public.fin_job_profitability_v p
  join public.fin_job_contract_v c on c.job_id = p.job_id
  left join lateral (
    select sum(b.paid) as collected, sum(b.credited) as credited, sum(b.balance) as outstanding,
           sum(b.balance) filter (where b.days_overdue > 0) as overdue
      from public.fin_invoice_balances_v b where b.job_id = p.job_id and b.status = 'issued') inv on true
  left join lateral (
    select sum(round(l.amount * bb.balance / bb.total, 2)) as unpaid,
           sum(round(l.amount * bb.balance / bb.total, 2)) filter (where v.kind = 'subcontractor') as unpaid_sub
      from public.fin_vendor_bill_lines l
      join public.fin_bill_balances_v bb on bb.bill_id = l.bill_id and bb.balance > 0
      join public.fin_vendors v on v.id = bb.vendor_id
     where l.job_id = p.job_id) ap on true
  left join lateral public.fin_job_assignees(c.estimate_id) ps on true;

-- 6. AR table -------------------------------------------------------------------------------------------------
create or replace view public.fin_ar_invoices_v with (security_invoker = true) as
select b.invoice_id, b.book_id, b.job_id, j.estimate_id, j.job_number, j.name as job_name,
       b.customer_id, coalesce(i.bill_to ->> 'name', cu.name) as customer_name,
       b.number, b.kind, b.status, b.issue_date, b.due_date, b.total, b.paid, b.credited, b.balance, b.days_overdue, b.aging_bucket,
       ps.sales_rep_id, ps.project_manager_id
  from public.fin_invoice_balances_v b
  join public.fin_invoices i on i.id = b.invoice_id
  join public.fin_jobs j on j.id = b.job_id
  left join public.customers cu on cu.id = b.customer_id
  left join lateral public.fin_job_assignees(j.estimate_id) ps on true
 where b.status = 'issued';

-- 7. Grants + RLS -------------------------------------------------------------------------------------------
alter table public.fin_bill_payments enable row level security;
drop policy if exists fin_bill_payments_select on public.fin_bill_payments;
create policy fin_bill_payments_select on public.fin_bill_payments for select to authenticated
  using (exists (select 1 from public.fin_vendor_bills b where b.id = bill_id));   -- inherits the bill's RLS

revoke all on public.fin_bill_payments, public.fin_bill_balances_v, public.fin_job_summary_v, public.fin_ar_invoices_v,
  public.fin_job_budget_v, public.fin_job_profitability_v from anon, authenticated;
grant select on public.fin_bill_payments, public.fin_bill_balances_v, public.fin_job_summary_v, public.fin_ar_invoices_v,
  public.fin_job_budget_v, public.fin_job_profitability_v to authenticated;

revoke execute on function public.fin_bill_payment_record(uuid, jsonb, text), public.fin_bill_payment_void(uuid, text), public.fin_job_assignees(uuid) from public, anon;
grant execute on function public.fin_bill_payment_record(uuid, jsonb, text), public.fin_bill_payment_void(uuid, text), public.fin_job_assignees(uuid) to authenticated;
revoke execute on function public.fin_check_bill_paid(), public.fin_bill_void_guard() from public, anon, authenticated;
