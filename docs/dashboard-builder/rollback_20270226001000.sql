-- Rollback for 20270226001000_financials_page_layouts.sql.
-- Removes saved Financials page layouts (Home layouts are kept) and puts the V6.6 functions back.
-- After running this, deploy code from before the Financials page builder (it calls the functions without p_page,
-- which keeps working either way).
delete from public.dashboard_layouts where page <> 'home';
delete from public.company_dashboard_defaults where page <> 'home';
alter table public.dashboard_layouts drop constraint if exists dashboard_layouts_pkey;
alter table public.dashboard_layouts add constraint dashboard_layouts_pkey primary key (user_id, mode);
drop index if exists public.company_dashboard_defaults_one_page;
create unique index if not exists company_dashboard_defaults_one on public.company_dashboard_defaults (company_id, coalesce(role, ''), mode);
drop function if exists public.dashboard_layout_get(text, text);
drop function if exists public.dashboard_layout_save(text, text, jsonb, integer, integer, text, text);
drop function if exists public.dashboard_layout_reset(text, text);
drop function if exists public.company_dashboard_default_save(text, text, text, jsonb, integer, text);
alter table public.dashboard_layouts drop column if exists page;
alter table public.company_dashboard_defaults drop column if exists page;
-- Then re-run sections 3-7 of supabase/migrations/20261221001000_dashboard_layouts.sql to restore the V6.6 functions.
notify pgrst, 'reload schema';
