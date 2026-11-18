-- Rollback for 20270106001000_free_saved_items.sql: Saved Items writes go back to Unlimited only.
-- Items free accounts saved are kept (read and delete stay allowed), exactly like a lapsed subscription.
drop policy if exists saved_items_own_insert on public.saved_items;
drop policy if exists saved_items_own_update on public.saved_items;
drop policy if exists saved_items_premium_insert on public.saved_items;
drop policy if exists saved_items_premium_update on public.saved_items;
create policy saved_items_premium_insert on public.saved_items for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.library_access()));
create policy saved_items_premium_update on public.saved_items for update to authenticated
  using (user_id = (select auth.uid()) and (select public.library_access()))
  with check (user_id = (select auth.uid()) and (select public.library_access()));
drop trigger if exists saved_items_free_limit on public.saved_items;
drop function if exists public.saved_items_free_limit();
drop function if exists public.saved_items_free_ok();
