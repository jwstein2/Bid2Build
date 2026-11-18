-- Rollback for 20270105002000_upgrade_offers.sql. Removes the offer log and every row in it.
-- The app keeps working without it: offers simply stop showing and cancellation reasons stop being saved.
drop table if exists public.upgrade_offers;
