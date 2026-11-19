-- Rollback for 20270119001000_sales_v84_business.sql. Removes voluntary goals, team wins and the owner's digest.
drop function if exists public.admin_sales_digest_preview(uuid);
drop function if exists public.admin_sales_digest_settings_save(uuid, boolean);
drop function if exists public.sales_digest_claim(timestamptz);
drop function if exists public.sales_recognition_digest(timestamptz);
drop function if exists public.sales_team_wins(timestamptz);
drop function if exists public.sales_my_goal_delete(uuid);
drop function if exists public.sales_my_goal_save(text, integer, timestamptz);
drop function if exists public.sales_my_goals(timestamptz);
drop function if exists public.sales_goal_progress(uuid, date, text);
alter table public.sales_settings drop column if exists digest_last_sent;
alter table public.sales_settings drop column if exists digest_enabled;
drop table if exists public.sales_rep_goals;
