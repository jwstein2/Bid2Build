-- Rollback for 20270112001000_sales_academy.sql (drops quiz progress and AI usage history).
drop function if exists public.sales_ai_reserve(uuid, text, uuid);
drop function if exists public.sales_month_start(timestamptz);
drop table if exists public.sales_ai_usage;
alter table public.sales_settings drop column if exists ai_monthly_cap;
drop function if exists public.admin_sales_academy(uuid);
drop function if exists public.sales_my_academy();
drop function if exists public.sales_academy_record(uuid, text, integer, integer, boolean);
drop table if exists public.sales_academy_progress;
