-- V8 batch 5 (LIB-2): Saved Items for free accounts.
--
--   * Every signed-in account can now save, edit and remove its own Saved Items. Before this, only
--     Unlimited (or admin, complimentary, trial, Team) could create or change them.
--   * Free accounts can keep up to 250 saved items. Unlimited has no limit. Nothing is deleted when a
--     plan changes: items stay with the account through upgrades and downgrades.
--   * Saved Stacks (assemblies), favorites, supplier price imports, company templates and proposal
--     templates stay part of Unlimited / Team. library_access() is unchanged.
--   * saved_items_free_ok() lets the app tell whether this file has been run; until then free
--     accounts keep today's behaviour.
--
-- Nothing here sends email, changes billing or touches existing rows. Safe to run more than once.
-- Rollback: docs/v8-marketing/rollback_20270106001000.sql

create or replace function public.saved_items_free_ok() returns boolean
language sql stable as $$ select true $$;
revoke execute on function public.saved_items_free_ok() from public, anon;
grant execute on function public.saved_items_free_ok() to authenticated;

-- Free accounts: at most 250 saved items each. Unlimited (library_access) has no cap.
create or replace function public.saved_items_free_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.library_access() then return new; end if;
  if (select count(*) from public.saved_items where user_id = new.user_id) >= 250 then
    raise exception 'free_item_limit' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.saved_items_free_limit() from public, anon, authenticated;

drop trigger if exists saved_items_free_limit on public.saved_items;
create trigger saved_items_free_limit before insert on public.saved_items
  for each row execute function public.saved_items_free_limit();

-- Own rows only, any plan. (Select and delete were already own-rows-only for every plan.)
drop policy if exists saved_items_premium_insert on public.saved_items;
drop policy if exists saved_items_premium_update on public.saved_items;
drop policy if exists saved_items_own_insert on public.saved_items;
drop policy if exists saved_items_own_update on public.saved_items;
create policy saved_items_own_insert on public.saved_items for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy saved_items_own_update on public.saved_items for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
