-- Built2Bid: clear the Supabase Security Advisor findings (2026-11-19).
--
-- 1. CRITICAL "Security Definer View" on public.fin_timesheet_labor_v (from 20270103001000_fin_timesheet_labor.sql).
--    The view ran with its owner's rights on purpose: time entries, crew and pay rates are team records whose RLS
--    only lets team managers read pay rates (pm_employee_profiles) and only schedule viewers read schedules. An
--    accountant or bookkeeper with Financials access but no team-manager rights must still see the labor COST in
--    job costing and the P&L. A plain `security_invoker = true` switch would silently drop those labor amounts for
--    them, so instead:
--      * the owner-rights query moves into private.fin_timesheet_labor_rows(), a SECURITY DEFINER function in a
--        schema the Data API does not expose (not callable over /rest/v1), with the exact same caller filter
--        (company financials permission, or a job the caller can see);
--      * public.fin_timesheet_labor_v becomes a security_invoker view over that function. Same columns, same
--        rows for every user, so fin_job_costs_v, fin_report_entries_v and fin_job_timesheet_labor() are unchanged.
-- 2. WARN "Function Search Path Mutable" on 13 small helper functions: pin search_path = public. None of them is
--    SECURITY DEFINER and all only reference public objects or built-ins, so behavior is unchanged.
--
-- Safe to run more than once. Rollback: docs/security/rollback_20270118001000.sql

-- 1. Timesheet labor view -------------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.fin_timesheet_labor_rows()
returns table (entry_id uuid, book_id uuid, job_id uuid, cost_code_id uuid, trade_slug text, cost_date date,
               hours numeric, hourly_cost numeric, amount numeric, resource_id uuid, worker_name text,
               description text, counted boolean)
language sql stable security definer set search_path = public as $$
select e.id, b.id, j.id, lc.cost_code_id, cc.trade_slug,
       (e.clock_in at time zone b.timezone)::date,
       round(greatest(extract(epoch from (e.clock_out - e.clock_in)) / 3600.0 - e.break_minutes / 60.0, 0)::numeric, 2),
       ep.hourly_cost,
       case when ep.hourly_cost is null then null
            else round(greatest(extract(epoch from (e.clock_out - e.clock_in)) / 3600.0 - e.break_minutes / 60.0, 0)::numeric * ep.hourly_cost, 2) end::numeric(14, 2),
       r.id, r.name,
       r.name || ' · ' || to_char(round(greatest(extract(epoch from (e.clock_out - e.clock_in)) / 3600.0 - e.break_minutes / 60.0, 0)::numeric, 2), 'FM9990.00') || ' h',
       b.count_timesheet_labor
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
   and (public.fin_has_permission(b.id, 'view_company_financials') or public.fin_job_visible(j.id))
$$;
revoke execute on function private.fin_timesheet_labor_rows() from public, anon;
grant execute on function private.fin_timesheet_labor_rows() to authenticated;

create or replace view public.fin_timesheet_labor_v with (security_invoker = true) as
select t.entry_id, t.book_id, t.job_id, t.cost_code_id, t.trade_slug, t.cost_date, t.hours,
       t.hourly_cost::numeric(10, 2) as hourly_cost, t.amount::numeric(14, 2) as amount,
       t.resource_id, t.worker_name, t.description, t.counted
  from private.fin_timesheet_labor_rows() t;
alter view public.fin_timesheet_labor_v set (security_invoker = true);

revoke all on public.fin_timesheet_labor_v from anon, authenticated;
grant select on public.fin_timesheet_labor_v to authenticated;

-- 2. Pin search_path on helper functions -------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.set_updated_at()', 'public.news_join(text[])', 'public.academy_level(bigint)', 'public.radar_drafts_no_delete()',
    'public.schedule_source_ok(jsonb, uuid, uuid)', 'public.fin_redact(jsonb)', 'public.pm_resource_mode(public.pm_resources)',
    'public.scope_section_content(public.project_scope_sections)', 'public.proposal_style_keys()', 'public.saved_items_free_ok()',
    'public.fin_retention_years()', 'public.fin_purging(text)', 'public.contractor_only_fk_nulling(jsonb, jsonb)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s set search_path = public', f);
    end if;
  end loop;
end $$;
