-- Saved Stacks built on Saved Items & Pricing (2026-11-25).
--
-- Office staff can now create and edit a stack's rows straight from the library page. Their own stacks
-- already work with the existing policies. This lets anyone who holds "Manage saved company pricing" add and
-- remove rows on a company template someone else created (today they can only change existing rows).
--   1. assembly_items_company_insert: add rows to a company template (pricing permission + library access).
--   2. assembly_items_company_delete: remove rows from a company template (pricing permission).
-- The existing assembly_items_parent_guard trigger still checks every new row. Nothing else changes.
-- Safe to run more than once.
-- Undo: drop policy if exists assembly_items_company_insert on public.assembly_items;
--       drop policy if exists assembly_items_company_delete on public.assembly_items;

drop policy if exists assembly_items_company_insert on public.assembly_items;
create policy assembly_items_company_insert on public.assembly_items for insert to authenticated
  with check (
    user_id = (select auth.uid()) and (select public.library_access())
    and exists (select 1 from public.assemblies a where a.id = assembly_id and a.company_id is not null
                and public.has_company_permission(a.company_id, 'manage_company_pricing'))
  );

drop policy if exists assembly_items_company_delete on public.assembly_items;
create policy assembly_items_company_delete on public.assembly_items for delete to authenticated
  using (exists (select 1 from public.assemblies a where a.id = assembly_id and a.company_id is not null
                 and public.has_company_permission(a.company_id, 'manage_company_pricing')));
