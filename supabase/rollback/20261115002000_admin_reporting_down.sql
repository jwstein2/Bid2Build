-- Rollback for 20261115002000_admin_reporting.sql. Drops ONLY the objects that migration created.
-- Deletes the owner's manual account labels and the three extra attribution columns.
drop table if exists public.admin_account_labels;
alter table public.leads drop column if exists referrer_host;
alter table public.leads drop column if exists click_id_type;
alter table public.leads drop column if exists device_type;
