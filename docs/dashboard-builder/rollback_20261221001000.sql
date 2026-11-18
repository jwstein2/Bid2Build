-- Rollback for 20261221001000_dashboard_layouts.sql (V6.6 Personalized Dashboard Builder).
-- Removes saved dashboard layouts and company dashboard defaults. No business data is touched.
-- After running this, /home falls back to the starting templates and saving is turned off until the migration is re-run.
drop function if exists public.dashboard_layout_get(text);
drop function if exists public.dashboard_layout_save(text, text, jsonb, integer, integer, text);
drop function if exists public.dashboard_layout_reset(text);
drop function if exists public.company_dashboard_default_save(text, text, text, jsonb, integer);
drop function if exists public.company_dashboard_defaults_list();
drop table if exists public.company_dashboard_defaults;
drop table if exists public.dashboard_layouts;
drop function if exists public.dashboard_widgets_valid(jsonb);
notify pgrst, 'reload schema';
