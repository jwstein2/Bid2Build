-- Rollback for supabase/migrations/20261220001000_universal_search.sql (V6.4 Universal search).
-- Removes the search functions, the per-user search history / preferences tables and the search indexes.
-- Nothing else reads these objects; no business records are touched. pg_trgm and the extensions schema are left in
-- place (other features may use them).
begin;
drop function if exists public.search_admin_accounts(text, integer);
drop function if exists public.search_save_preferences(jsonb);
drop function if exists public.search_forget(uuid);
drop function if exists public.search_recent();
drop function if exists public.search_resolve(text, uuid);
drop function if exists public.search_remember(text, text, text, uuid);
drop function if exists public.search_capabilities();
drop function if exists public.search_universal(text, text[], text[], jsonb, jsonb, integer, integer, integer, text);
drop function if exists public.search_text_ids(text, text, text[], boolean, text, text[]);
drop function if exists public.search_fin_book();
drop table if exists public.search_preferences;
drop table if exists public.search_history;
drop index if exists public.comm_messages_customer_idx;
drop index if exists public.customers_search_trgm;
drop index if exists public.estimates_search_trgm;
drop index if exists public.estimate_groups_search_trgm;
drop index if exists public.estimate_items_search_trgm;
drop index if exists public.project_schedules_search_trgm;
drop index if exists public.schedule_tasks_search_trgm;
drop index if exists public.project_scope_sections_search_trgm;
drop index if exists public.change_orders_search_trgm;
drop index if exists public.signatures_search_trgm;
drop index if exists public.pm_resources_search_trgm;
drop index if exists public.pm_suppliers_search_trgm;
drop index if exists public.saved_items_search_trgm;
drop index if exists public.assemblies_search_trgm;
drop index if exists public.project_photos_search_trgm;
drop index if exists public.comm_messages_search_trgm;
drop index if exists public.company_members_search_trgm;
drop function if exists public.search_doc(text[]);
drop function if exists public.search_arr(text[]);
drop function if exists public.search_digits(text);
commit;
