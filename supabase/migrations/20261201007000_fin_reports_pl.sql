-- Built2Bid V6 P2-A: company Reports + Profit & Loss (by period, by project, by trade).
--
-- Read-only. Nothing is stored and nothing is posted: every figure is derived from the records that already
-- exist (issued invoices, payments, refunds, credit memos, approved vendor bills, bill payments, approved
-- expenses). Two bases, labelled everywhere in the app:
--   cash    money in  = payments received (on the date received) - refunds
--           money out = bill payments (on the date paid, split across the bill's lines) + approved expenses
--   billed  money in  = issued invoices (issue date) - issued credit memos
--           money out = approved vendor bills (bill date, by line) + approved expenses
-- "Billed" is not GAAP accrual; accrual statements wait for the general ledger (P2-F, CPA review).
-- Voided records never count. Costs without a project are overhead. Labor = cost codes typed labor /
-- labor burden (approved timesheet hours join here once time tracking lands).
--
--   1. fin_report_entries_v (security_invoker): one row per money event, for drill-down lists. Each reader
--      sees only what their RLS already allows.
--   2. fin_report_pl(book, basis, from, to): the P&L roll-up (month x project x trade x cost type) as one
--      jsonb value. Requires view_company_financials. Revenue is split across a project's trades in
--      proportion to its estimated cost per trade (exact for single-trade projects); cents are reconciled so
--      every view adds up to the same total.
--
-- Safe to run more than once. Requires 20261126001000_fin_v5_ar_job_summary.sql (fin_bill_payments).
-- Rollback: docs/financials/rollback_20261201007000.sql

-- 1. Entries -------------------------------------------------------------------------------------------------
create or replace view public.fin_report_entries_v with (security_invoker = true) as
-- CASH in: payment amounts applied to invoices, credited to the invoice's project
select 'cash'::text as basis, 'income'::text as direction, p.book_id, p.received_on as entry_date, i.job_id,
       null::uuid as cost_code_id, null::text as trade_slug, null::text as cost_type, a.amount,
       'payment'::text as source, p.id as source_id, p.number as ref,
       coalesce(i.bill_to ->> 'name', cu.name) as party, 'Payment on ' || coalesce(i.number, 'invoice') as description
  from public.fin_payment_allocations a
  join public.fin_payments p on p.id = a.payment_id
  join public.fin_invoices i on i.id = a.invoice_id
  left join public.customers cu on cu.id = p.customer_id
 where a.reversed_at is null and p.status = 'active'
union all
-- CASH in: the part of a payment not applied to any invoice (e.g. a deposit received before invoicing)
select 'cash', 'income', p.book_id, p.received_on, p.job_id, null, null, null, p.amount - coalesce(ap.applied, 0),
       'payment', p.id, p.number, cu.name, 'Payment not applied to an invoice'
  from public.fin_payments p
  left join lateral (select sum(x.amount) as applied from public.fin_payment_allocations x where x.payment_id = p.id and x.reversed_at is null) ap on true
  left join public.customers cu on cu.id = p.customer_id
 where p.status = 'active' and p.amount - coalesce(ap.applied, 0) <> 0
union all
-- CASH in (negative): refunds paid back to customers
select 'cash', 'income', r.book_id, r.refunded_on, coalesce(p.job_id, m.job_id), null, null, null, -r.amount,
       'refund', r.id, r.number, cu.name, 'Refund'
  from public.fin_refunds r
  left join public.fin_payments p on p.id = r.payment_id
  left join public.fin_credit_memos m on m.id = r.credit_memo_id
  left join public.customers cu on cu.id = coalesce(p.customer_id, m.customer_id)
 where r.status = 'active'
union all
-- CASH out: bill payments, split across the bill's lines (cent remainder on the first line)
select 'cash', 'cost', s.book_id, s.paid_on, s.job_id, s.cost_code_id, cc.trade_slug, cc.cost_type,
       s.share + case when s.rn = 1 then s.paid - s.shares else 0 end,
       'bill_payment', s.payment_id, s.bill_number, s.vendor_name, s.description
  from (
    select bp.book_id, bp.id as payment_id, bp.paid_on, bp.amount as paid, b.number as bill_number, v.name as vendor_name,
           l.job_id, l.cost_code_id, l.description,
           round(bp.amount * l.amount / b.total, 2) as share,
           sum(round(bp.amount * l.amount / b.total, 2)) over (partition by bp.id) as shares,
           row_number() over (partition by bp.id order by l.line_no) as rn
      from public.fin_bill_payments bp
      join public.fin_vendor_bills b on b.id = bp.bill_id
      join public.fin_vendor_bill_lines l on l.bill_id = b.id
      left join public.fin_vendors v on v.id = b.vendor_id
     where bp.status = 'active' and b.status <> 'void') s
  left join public.fin_cost_codes cc on cc.id = s.cost_code_id
union all
-- BILLED in: issued invoices
select 'billed', 'income', i.book_id, i.issue_date, i.job_id, null, null, null, i.total,
       'invoice', i.id, i.number, coalesce(i.bill_to ->> 'name', cu.name), initcap(i.kind) || ' invoice'
  from public.fin_invoices i
  left join public.customers cu on cu.id = i.customer_id
 where i.status = 'issued'
union all
-- BILLED in (negative): issued credit memos
select 'billed', 'income', m.book_id, m.issue_date, coalesce(m.job_id, inv.job_id), null, null, null, -m.amount,
       'credit_memo', m.id, m.number, cu.name, m.reason
  from public.fin_credit_memos m
  left join public.fin_invoices inv on inv.id = m.invoice_id
  left join public.customers cu on cu.id = m.customer_id
 where m.status = 'issued'
union all
-- BILLED out: approved vendor/subcontractor bill lines
select 'billed', 'cost', l.book_id, b.bill_date, l.job_id, l.cost_code_id, cc.trade_slug, cc.cost_type, l.amount,
       'bill', b.id, b.number, v.name, l.description
  from public.fin_vendor_bill_lines l
  join public.fin_vendor_bills b on b.id = l.bill_id
  left join public.fin_vendors v on v.id = b.vendor_id
  left join public.fin_cost_codes cc on cc.id = l.cost_code_id
 where b.status = 'approved'
union all
-- BOTH bases: approved expenses (paid when spent)
select bs.basis, 'cost', x.book_id, x.spent_on, x.job_id, x.cost_code_id, cc.trade_slug, cc.cost_type, x.amount,
       'expense', x.id, x.number, coalesce(v.name, x.payee), x.description
  from public.fin_expenses x
  cross join (values ('cash'), ('billed')) bs (basis)
  left join public.fin_vendors v on v.id = x.vendor_id
  left join public.fin_cost_codes cc on cc.id = x.cost_code_id
 where x.status = 'approved';

-- 2. The P&L roll-up -------------------------------------------------------------------------------------------
-- Returns {basis, from, to, rows: [{m, job, trade, type, dir, amount}], jobs: [...], trades: [...]}.
--   m      'YYYY-MM'
--   dir    'income' | 'cost'
--   job    fin_jobs.id, or null (overhead / payment with no project)
--   trade  trade slug, or null (general / not coded)
--   type   cost type for costs (null = not coded); null for income
-- One jsonb value, so PostgREST's row cap never truncates a long report.
create or replace function public.fin_report_pl(p_book_id uuid, p_basis text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_jobs jsonb; v_trades jsonb;
begin
  perform public.fin_require(p_book_id, 'view_company_financials', false);
  if p_basis not in ('cash', 'billed') then raise exception 'bad_basis' using errcode = '22023'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3700 then raise exception 'bad_range' using errcode = '22023'; end if;

  with e as (
    select to_char(entry_date, 'YYYY-MM') as m, direction, job_id, trade_slug, cost_type, amount
      from public.fin_report_entries_v
     where book_id = p_book_id and basis = p_basis and entry_date between p_from and p_to),
  -- Trade weights per project: estimated cost by trade from the frozen budget (positive totals only).
  w as (
    select job_id, trade_slug, sum(amount) as amt from public.fin_budget_lines
     where book_id = p_book_id group by 1, 2 having sum(amount) > 0),
  wt as (select job_id, trade_slug, amt / sum(amt) over (partition by job_id) as share from w),
  inc as (select m, job_id, sum(amount) as amt from e where direction = 'income' group by 1, 2),
  split as (
    select i.m, i.job_id, wt.trade_slug, i.amt,
           round(i.amt * coalesce(wt.share, 1), 2) as part,
           row_number() over (partition by i.m, i.job_id order by wt.share desc nulls last, wt.trade_slug) as rn
      from inc i left join wt on wt.job_id = i.job_id),
  inc_rows as (
    select m, job_id, trade_slug, null::text as cost_type, 'income'::text as dir,
           part + case when rn = 1 then amt - sum(part) over (partition by m, job_id) else 0 end as amount
      from split),
  cost_rows as (
    select m, job_id, trade_slug, cost_type, 'cost'::text as dir, sum(amount) as amount from e where direction = 'cost' group by 1, 2, 3, 4)
  select coalesce(jsonb_agg(jsonb_build_object('m', m, 'job', job_id, 'trade', trade_slug, 'type', cost_type, 'dir', dir, 'amount', amount::text)
                            order by m, dir, job_id, trade_slug, cost_type), '[]'::jsonb)
    into v_rows
    from (select * from inc_rows union all select * from cost_rows) r
   where amount <> 0;

  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'estimateId', j.estimate_id, 'number', j.job_number, 'name', j.name, 'status', j.status,
                                               'customer', cu.name, 'trades', coalesce(t.trades, '[]'::jsonb)) order by j.job_number), '[]'::jsonb)
    into v_jobs
    from public.fin_jobs j
    left join public.customers cu on cu.id = j.customer_id
    left join lateral (select jsonb_agg(distinct b.trade_slug) filter (where b.trade_slug is not null) as trades
                         from public.fin_budget_lines b where b.job_id = j.id and b.amount > 0) t on true
   where j.book_id = p_book_id;

  select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name) order by sort_order, name), '[]'::jsonb) into v_trades
    from public.trade_categories;

  return jsonb_build_object('basis', p_basis, 'from', p_from, 'to', p_to, 'rows', v_rows, 'jobs', v_jobs, 'trades', v_trades);
end $$;

-- 3. Grants --------------------------------------------------------------------------------------------------
revoke all on public.fin_report_entries_v from anon, authenticated;
grant select on public.fin_report_entries_v to authenticated;
revoke execute on function public.fin_report_pl(uuid, text, date, date) from public, anon;
grant execute on function public.fin_report_pl(uuid, text, date, date) to authenticated;
