-- Rollback for 20261122001000_customer_hub.sql. Run in the Supabase SQL Editor only if you need to undo it.
-- Bids keep their own customer text, so nothing on a bid or proposal is lost. Customer records created by
-- the update (source 'bid' / 'backfill') stay unless you also run the optional cleanup at the end.
begin;
drop trigger if exists estimates_sync_customer on public.estimates;
drop trigger if exists estimates_customer_cleanup on public.estimates;
drop policy if exists customers_linked_select on public.customers;
drop function if exists public.customer_merge(uuid, uuid);
drop function if exists public.customer_update(uuid, jsonb);
drop function if exists public.can_edit_customer(uuid);
drop function if exists public.estimate_customer_cleanup();
drop function if exists public.drop_orphan_bid_customer(uuid);
drop function if exists public.link_estimate_customer();
drop function if exists public.match_bid_customer(uuid, uuid, text, text, text, text, uuid);
drop function if exists public.customer_in_scope(uuid, uuid, uuid);
drop function if exists public.customer_names_compatible(text, text);
drop function if exists public.customer_phone_key(text);
drop function if exists public.customer_email_key(text);
drop function if exists public.customer_norm(text);
drop index if exists public.customers_email_idx;
drop index if exists public.estimates_customer_idx;
commit;
-- Optional, to return to the empty customers list (unlinks bids first; keeps hand-made customers):
--   update public.estimates e set customer_id = null from public.customers c where c.id = e.customer_id and c.source in ('bid', 'backfill');
--   delete from public.customers where source in ('bid', 'backfill');
-- The added columns (source, customer_type, company_name) are harmless to keep; to drop them:
--   alter table public.customers drop column if exists source, drop column if exists customer_type, drop column if exists company_name;
