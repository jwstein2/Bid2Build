-- Rollback for 20261127001000_pricing_v5_supplier_import.sql.
-- Removes the import functions, import history and the new columns. Saved items created by an
-- import are KEPT (they are the contractor's items now); only the supplier/source metadata columns go.
-- Run only if you need to remove the feature; it deletes import history.
drop function if exists public.price_import_undo(uuid);
drop function if exists public.price_import_apply(jsonb);
drop trigger if exists saved_items_price_source on public.saved_items;
drop function if exists public.saved_items_price_source_guard();
drop table if exists public.price_records;
drop table if exists public.price_imports;
drop index if exists public.saved_items_user_sku_idx;
alter table public.saved_items drop constraint if exists saved_items_price_source_check;
alter table public.saved_items
  drop column if exists supplier_name,
  drop column if exists supplier_sku,
  drop column if exists pack_size,
  drop column if exists favorite,
  drop column if exists price_source,
  drop column if exists price_effective_on,
  drop column if exists price_updated_at;
alter table public.business_profiles drop column if exists target_margin_pct;
