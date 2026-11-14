-- Premium Saved Items & Pricing Library + "Labor / Material" line-item type.
--
-- 1. saved_items gains category, default quantity and updated_at so a saved item carries every
--    editable line-item field. Existing rows keep their values (new columns are nullable / defaulted).
-- 2. Writes to saved_items / assemblies (saved stacks) / assembly_items now require an active
--    Unlimited subscription, enforced by RLS (not just the UI). Owners can always READ and DELETE
--    their own rows, so nothing is lost or hidden from data export when a subscription lapses; the
--    app only offers reuse while the subscription is active.
-- 3. estimate_items.cost_type accepts 'labor_material'. Existing rows are untouched.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.saved_items add column if not exists category text check (char_length(category) <= 120);
alter table public.saved_items add column if not exists quantity numeric(14, 4) check (quantity >= 0);
alter table public.saved_items add column if not exists updated_at timestamptz not null default now();
alter table public.assemblies add column if not exists updated_at timestamptz not null default now();

drop trigger if exists saved_items_updated_at on public.saved_items;
create trigger saved_items_updated_at before update on public.saved_items
  for each row execute function public.set_updated_at();
drop trigger if exists assemblies_updated_at on public.assemblies;
create trigger assemblies_updated_at before update on public.assemblies
  for each row execute function public.set_updated_at();

create index if not exists saved_items_user_trade_idx on public.saved_items (user_id, trade, category);
create index if not exists assembly_items_assembly_idx on public.assembly_items (assembly_id, sort_order);

-- ---------------------------------------------------------------------------
-- 2. Entitlement
-- ---------------------------------------------------------------------------
-- True while the signed-in user may create or change library entries: an Unlimited subscription in
-- good standing (same rule as unlimited bids) or an admin. Takes no argument, so a caller can only
-- ask about themselves.
create or replace function public.library_access() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.has_unlimited(auth.uid()) or public.is_admin(auth.uid()), false)
$$;
revoke execute on function public.library_access() from public, anon;
grant execute on function public.library_access() to authenticated;

drop policy if exists saved_items_own_all on public.saved_items;
drop policy if exists saved_items_own_select on public.saved_items;
drop policy if exists saved_items_own_delete on public.saved_items;
drop policy if exists saved_items_premium_insert on public.saved_items;
drop policy if exists saved_items_premium_update on public.saved_items;
create policy saved_items_own_select on public.saved_items for select to authenticated
  using (user_id = (select auth.uid()));
create policy saved_items_own_delete on public.saved_items for delete to authenticated
  using (user_id = (select auth.uid()));
create policy saved_items_premium_insert on public.saved_items for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.library_access()));
create policy saved_items_premium_update on public.saved_items for update to authenticated
  using (user_id = (select auth.uid()) and (select public.library_access()))
  with check (user_id = (select auth.uid()) and (select public.library_access()));

drop policy if exists assemblies_own_all on public.assemblies;
drop policy if exists assemblies_own_select on public.assemblies;
drop policy if exists assemblies_own_delete on public.assemblies;
drop policy if exists assemblies_premium_insert on public.assemblies;
drop policy if exists assemblies_premium_update on public.assemblies;
create policy assemblies_own_select on public.assemblies for select to authenticated
  using (user_id = (select auth.uid()));
create policy assemblies_own_delete on public.assemblies for delete to authenticated
  using (user_id = (select auth.uid()));
create policy assemblies_premium_insert on public.assemblies for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.library_access()));
create policy assemblies_premium_update on public.assemblies for update to authenticated
  using (user_id = (select auth.uid()) and (select public.library_access()))
  with check (user_id = (select auth.uid()) and (select public.library_access()));

drop policy if exists assembly_items_own_all on public.assembly_items;
drop policy if exists assembly_items_own_select on public.assembly_items;
drop policy if exists assembly_items_own_delete on public.assembly_items;
drop policy if exists assembly_items_premium_insert on public.assembly_items;
drop policy if exists assembly_items_premium_update on public.assembly_items;
create policy assembly_items_own_select on public.assembly_items for select to authenticated
  using (user_id = (select auth.uid()));
create policy assembly_items_own_delete on public.assembly_items for delete to authenticated
  using (user_id = (select auth.uid()));
create policy assembly_items_premium_insert on public.assembly_items for insert to authenticated
  with check (
    user_id = (select auth.uid()) and (select public.library_access())
    and exists (select 1 from public.assemblies a where a.id = assembly_id and a.user_id = (select auth.uid()))
  );
create policy assembly_items_premium_update on public.assembly_items for update to authenticated
  using (user_id = (select auth.uid()) and (select public.library_access()))
  with check (
    user_id = (select auth.uid()) and (select public.library_access())
    and exists (select 1 from public.assemblies a where a.id = assembly_id and a.user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 3. Labor / Material line-item type
-- ---------------------------------------------------------------------------
alter table public.estimate_items drop constraint if exists estimate_items_cost_type_check;
alter table public.estimate_items add constraint estimate_items_cost_type_check check (cost_type in (
  'material', 'labor', 'labor_material', 'equipment', 'subcontractor', 'overhead', 'contingency', 'permit', 'delivery', 'labor_burden', 'other'
));
