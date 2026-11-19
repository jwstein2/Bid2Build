-- Rollback for 20261211001001_supplier_pricing.sql (removes supplier connections and the cross-check).
drop function if exists public.supplier_price_cross_check(text);
drop function if exists public.supplier_connection_remove(text);
drop function if exists public.supplier_connection_save(jsonb);
drop function if exists public.supplier_connections_list();
drop table if exists public.supplier_connections;
