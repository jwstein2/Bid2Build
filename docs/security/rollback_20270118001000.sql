-- Rollback for 20270118001001_security_definer_view_fix.sql. Restores the owner-rights view (the advisor finding
-- comes back) and un-pins the helper functions' search_path. Safe to run more than once.
create or replace view public.fin_timesheet_labor_v with (security_invoker = false) as
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
alter view public.fin_timesheet_labor_v reset (security_invoker);
revoke all on public.fin_timesheet_labor_v from anon, authenticated;
grant select on public.fin_timesheet_labor_v to authenticated;
drop function if exists private.fin_timesheet_labor_rows();

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
      execute format('alter function %s reset search_path', f);
    end if;
  end loop;
end $$;
