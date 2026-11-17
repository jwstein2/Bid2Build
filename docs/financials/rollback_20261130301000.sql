-- Rollback for 20261130301000_library_favorites_assemblies.sql
--
-- Company templates become private stacks of whoever created them (nothing is deleted), scaling rows
-- keep their fixed quantity, and favorites are dropped. Run in the Supabase SQL editor.
drop trigger if exists assembly_items_parent_guard on public.assembly_items;
drop function if exists public.assembly_items_parent_guard();
drop trigger if exists assemblies_company_guard on public.assemblies;
drop function if exists public.assemblies_company_guard();

drop policy if exists assembly_items_company_select on public.assembly_items;
drop policy if exists assembly_items_company_update on public.assembly_items;
drop policy if exists assemblies_company_select on public.assemblies;
drop policy if exists assemblies_company_update on public.assemblies;
drop policy if exists assemblies_company_delete on public.assemblies;
drop function if exists public.library_stack_manageable(uuid);

drop table if exists public.library_favorites;

alter table public.assembly_items drop constraint if exists assembly_items_qty_per_check;
alter table public.assembly_items drop constraint if exists assembly_items_waste_check;
alter table public.assembly_items drop column if exists qty_per;
alter table public.assembly_items drop column if exists waste_pct;
alter table public.assembly_items drop column if exists round_up;

drop index if exists public.assemblies_company_idx;
alter table public.assemblies drop constraint if exists assemblies_scale_unit_check;
alter table public.assemblies drop constraint if exists assemblies_scale_label_check;
alter table public.assemblies drop constraint if exists assemblies_scale_calc_check;
alter table public.assemblies drop constraint if exists assemblies_starter_key_check;
alter table public.assemblies drop column if exists company_id;
alter table public.assemblies drop column if exists starter_key;
alter table public.assemblies drop column if exists scale_calc;
alter table public.assemblies drop column if exists scale_label;
alter table public.assemblies drop column if exists scale_unit;
