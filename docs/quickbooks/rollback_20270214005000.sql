-- Rollback for 20270214005000_quickbooks_sync.sql. Removes the QuickBooks connection, links and export log.
-- Time entries themselves are untouched. Anything already sent stays in QuickBooks.
drop function if exists public.qb_my_scope();
drop function if exists public.qb_claim_export(uuid, uuid, uuid, numeric, date);
drop table if exists public.qb_time_exports;
drop table if exists public.qb_job_links;
drop table if exists public.qb_worker_links;
drop table if exists public.qb_connection_secrets;
drop table if exists public.qb_connections;
drop function if exists public.qb_scope_guard();
