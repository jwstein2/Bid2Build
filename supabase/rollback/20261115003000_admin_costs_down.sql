-- Rollback for 20261115003000_admin_costs.sql. Deletes the owner's cost records (services and
-- expenses). Nothing else is affected.
drop function if exists public.admin_platform_usage();
drop table if exists public.admin_expenses;
drop table if exists public.admin_services;
