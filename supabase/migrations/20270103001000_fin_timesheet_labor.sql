-- Built2Bid: approved timesheet hours become job labor cost (QuickBooks gap work, part 3).
--
-- Approved clock-in/out entries (pm_time_entries, status 'approved') on a project's schedule are costed at the
-- worker's hourly cost (pm_employee_profiles.hourly_cost) and show up as actual labor:
--   * job costing (fin_job_costs_v -> fin_job_budget_v -> fin_job_profitability_v), on the job's labor cost
--     code with the largest labor budget (none = "not coded");
--   * the P&L on the BILLED basis, cost type labor, on the day worked (book time zone). The cash basis stays
--     money actually paid out: record payroll as expenses there.
-- Each book can turn this off (fin_books.count_timesheet_labor) if it already records payroll per job as
-- expenses, so labor is never counted twice. Hours without an hourly cost are listed but not costed.
-- The rate is the worker's current hourly cost (a rate change re-costs earlier hours).
--
-- Read-only views plus one setting. Safe to run more than once. Requires 20261210001000_team_records.sql and
-- 20261201007000_fin_reports_pl.sql. Rollback: docs/financials/rollback_20270103001000.sql

-- 1. Setting ------------------------------------------------------------------------------------------------
alter table public.fin_books add column if not exists count_timesheet_labor boolean not null default true;

create or replace function public.fin_set_timesheet_labor(p_book_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.fin_require(p_book_id, 'manage_financial_config', false);
  update public.fin_books set count_timesheet_labor = coalesce(p_on, true) where id = p_book_id;
  perform public.fin_audit(p_book_id, 'book.timesheet_labor', 'book', p_book_id, jsonb_build_object('on', coalesce(p_on, true)));
end $$;
revoke execute on function public.fin_set_timesheet_labor(uuid, boolean) from public, anon;
grant execute on function public.fin_set_timesheet_labor(uuid, boolean) to authenticated;

-- 2. Costed timesheet labor ---------------------------------------------------------------------------------
-- Owner-rights view (time entries and pay rates are team records with their own RLS), filtered to what the
-- caller may see in Financials: company financials, or a job they can see.
create or replace view public.fin_timesheet_labor_v as
select e.id as entry_id, b.id as book_id, j.id as job_id, lc.cost_code_id, cc.trade_slug,
       (e.clock_in at time zone b.timezone)::date as cost_date,
       round(greatest(extract(epoch from (e.clock_out - e.clock_in)) / 3600.0 - e.break_minutes / 60.0, 0)::numeric, 2) as hours,
       ep.hourly_cost,
       case when ep.hourly_cost is null then null
            else round(greatest(extract(epoch from (e.clock_out - e.clock_in)) / 3600.0 - e.break_minutes / 60.0, 0)::numeric * ep.hourly_cost, 2) end::numeric(14, 2) as amount,
       r.id as resource_id, r.name as worker_name,
       r.name || ' · ' || to_char(round(greatest(extract(epoch from (e.clock_out - e.clock_in)) / 3600.0 - e.break_minutes / 60.0, 0)::numeric, 2), 'FM9990.00') || ' h' as description,
       b.count_timesheet_labor as counted
  from public.pm_time_entries e
  join public.project_schedules s on s.id = e.schedule_id
  join public.fin_jobs j on j.estimate_id = s.estimate_id
  join public.fin_books b on b.id = j.book_id
                         and coalesce(b.company_id, b.owner_user_id) = coalesce(e.company_id, e.owner_id)
                         and b.sandbox_of is null
  join public.pm_resources r on r.id = e.resource_id
  left join public.pm_employee_profiles ep on ep.resource_id = e.resource_id
  left join lateral (
    select bl.cost_code_id from public.fin_budget_lines bl join public.fin_cost_codes c2 on c2.id = bl.cost_code_id
     where bl.job_id = j.id and c2.cost_type = 'labor'
     group by bl.cost_code_id order by sum(bl.amount) desc, bl.cost_code_id limit 1) lc on true
  left join public.fin_cost_codes cc on cc.id = lc.cost_code_id
 where e.status = 'approved' and e.clock_out is not null
   and (public.fin_has_permission(b.id, 'view_company_financials') or public.fin_job_visible(j.id));

revoke all on public.fin_timesheet_labor_v from anon, authenticated;
grant select on public.fin_timesheet_labor_v to authenticated;

-- 3. Job costing: timesheet labor is actual cost ---------------------------------------------------------------
create or replace view public.fin_job_costs_v with (security_invoker = true) as
select 'bill_line'::text as source, l.id as source_id, l.book_id, l.job_id, l.cost_code_id, l.commitment_id, b.bill_date as cost_date, l.amount, b.vendor_id, l.description
  from public.fin_vendor_bill_lines l join public.fin_vendor_bills b on b.id = l.bill_id
 where b.status = 'approved' and l.job_id is not null
union all
select 'expense', x.id, x.book_id, x.job_id, x.cost_code_id, null, x.spent_on, x.amount, x.vendor_id, x.description
  from public.fin_expenses x where x.status = 'approved' and x.job_id is not null
union all
select 'time_entry', t.entry_id, t.book_id, t.job_id, t.cost_code_id, null, t.cost_date, t.amount, null, t.description
  from public.fin_timesheet_labor_v t where t.counted and t.amount is not null;

-- 4. Reports: billed-basis labor ------------------------------------------------------------------------------
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
 where x.status = 'approved'
union all
-- BILLED out: approved timesheet labor at each worker's hourly cost (when the book counts timesheet labor)
select 'billed', 'cost', t.book_id, t.cost_date, t.job_id, t.cost_code_id, t.trade_slug, 'labor', t.amount,
       'time_entry', t.entry_id, null, t.worker_name, t.description
  from public.fin_timesheet_labor_v t
 where t.counted and t.amount is not null;

-- 5. Labor summary per job (hours, costed amount, hours with no rate) -----------------------------------------
create or replace function public.fin_job_timesheet_labor(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'counted', coalesce(bool_or(counted), (select b.count_timesheet_labor from public.fin_jobs j join public.fin_books b on b.id = j.book_id where j.id = p_job_id)),
    'hours', coalesce(sum(hours), 0)::text,
    'amount', coalesce(sum(amount), 0)::text,
    'uncostedHours', coalesce(sum(hours) filter (where hourly_cost is null), 0)::text,
    'workers', coalesce(jsonb_agg(distinct worker_name) filter (where hourly_cost is null), '[]'::jsonb))
  from public.fin_timesheet_labor_v where job_id = p_job_id
$$;
revoke execute on function public.fin_job_timesheet_labor(uuid) from public, anon;
grant execute on function public.fin_job_timesheet_labor(uuid) to authenticated;
