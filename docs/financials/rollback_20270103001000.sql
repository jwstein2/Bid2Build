-- Rollback for 20270103001000_fin_timesheet_labor.sql (timesheet labor in job costing and the billed P&L).
-- Restores the earlier view definitions, then drops the new objects. No records are lost (views + one setting).
-- Safe to run more than once.
create or replace view public.fin_job_costs_v with (security_invoker = true) as
select 'bill_line'::text as source, l.id as source_id, l.book_id, l.job_id, l.cost_code_id, l.commitment_id, b.bill_date as cost_date, l.amount, b.vendor_id, l.description
  from public.fin_vendor_bill_lines l join public.fin_vendor_bills b on b.id = l.bill_id
 where b.status = 'approved' and l.job_id is not null
union all
select 'expense', x.id, x.book_id, x.job_id, x.cost_code_id, null, x.spent_on, x.amount, x.vendor_id, x.description
  from public.fin_expenses x where x.status = 'approved' and x.job_id is not null;

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

drop function if exists public.fin_job_timesheet_labor(uuid);
drop view if exists public.fin_timesheet_labor_v;
drop function if exists public.fin_set_timesheet_labor(uuid, boolean);
alter table public.fin_books drop column if exists count_timesheet_labor;
