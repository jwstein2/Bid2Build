-- V6 P1-D: favorites, company templates and scaling assemblies for the Saved Items library.
--
-- 1. library_favorites: each user's starred saved items and stacks (per user, so a shared company
--    template can be a favorite for one person and not another). Removed with the item or stack.
-- 2. Scaling assemblies: a stack may name a measure (roof squares, wall SF…) and each row an amount per
--    1 unit of it, a waste % and round-up. Rows without an amount keep their fixed quantity.
-- 3. Company templates: a stack with company_id is readable by every active member of that company.
--    Only members with the company pricing permission (manage_company_pricing; owners have it) may
--    share, change or delete one. Writes still need the library entitlement (Unlimited / Enterprise).
-- 4. A guard trigger also stops rows being added to someone else's stack (the old insert policy only
--    checked the row's own user_id).
--
-- No existing row changes meaning: every new column is nullable or defaulted. Safe to run more than once.
-- Rollback: docs/financials/rollback_20261130301000.sql

-- ---------------------------------------------------------------------------
-- 1. Favorites
-- ---------------------------------------------------------------------------
create table if not exists public.library_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  saved_item_id uuid references public.saved_items (id) on delete cascade,
  assembly_id uuid references public.assemblies (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint library_favorites_one_target check ((saved_item_id is null) <> (assembly_id is null))
);
create unique index if not exists library_favorites_item_uq on public.library_favorites (user_id, saved_item_id) where saved_item_id is not null;
create unique index if not exists library_favorites_stack_uq on public.library_favorites (user_id, assembly_id) where assembly_id is not null;
create index if not exists library_favorites_assembly_idx on public.library_favorites (assembly_id);
alter table public.library_favorites enable row level security;
drop policy if exists library_favorites_own_select on public.library_favorites;
drop policy if exists library_favorites_own_insert on public.library_favorites;
drop policy if exists library_favorites_own_delete on public.library_favorites;
create policy library_favorites_own_select on public.library_favorites for select to authenticated
  using (user_id = (select auth.uid()));
-- Starring is reuse: it needs the library entitlement, and a target the user can see.
create policy library_favorites_own_insert on public.library_favorites for insert to authenticated
  with check (
    user_id = (select auth.uid()) and (select public.library_access())
    and (saved_item_id is null or exists (select 1 from public.saved_items s where s.id = saved_item_id and s.user_id = (select auth.uid())))
    and (assembly_id is null or exists (select 1 from public.assemblies a where a.id = assembly_id))
  );
create policy library_favorites_own_delete on public.library_favorites for delete to authenticated
  using (user_id = (select auth.uid()));
grant select, insert, delete on public.library_favorites to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Scaling assemblies + company templates (columns)
-- ---------------------------------------------------------------------------
alter table public.assemblies add column if not exists scale_unit text;
alter table public.assemblies add column if not exists scale_label text;
alter table public.assemblies add column if not exists scale_calc text;
alter table public.assemblies add column if not exists starter_key text;
alter table public.assemblies add column if not exists company_id uuid references public.companies (id) on delete cascade;
do $$ begin
  alter table public.assemblies add constraint assemblies_scale_unit_check
    check (scale_unit is null or scale_unit in ('square', 'square foot', 'square yard', 'linear foot', 'cubic yard', 'each'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.assemblies add constraint assemblies_scale_label_check
    check ((scale_unit is null and scale_label is null) or (scale_unit is not null and scale_label is not null and char_length(scale_label) between 1 and 120));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.assemblies add constraint assemblies_scale_calc_check check (scale_calc is null or char_length(scale_calc) <= 40);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.assemblies add constraint assemblies_starter_key_check check (starter_key is null or char_length(starter_key) <= 60);
exception when duplicate_object then null; end $$;
create index if not exists assemblies_company_idx on public.assemblies (company_id) where company_id is not null;

alter table public.assembly_items add column if not exists qty_per numeric(16, 6);
alter table public.assembly_items add column if not exists waste_pct numeric(5, 2) not null default 0;
alter table public.assembly_items add column if not exists round_up boolean not null default false;
do $$ begin
  alter table public.assembly_items add constraint assembly_items_qty_per_check check (qty_per is null or qty_per >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.assembly_items add constraint assembly_items_waste_check check (waste_pct between 0 and 100);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Company template access
-- ---------------------------------------------------------------------------
-- True when the caller may manage this stack: their own private stack, or a company template of a
-- company where they hold the pricing permission.
create or replace function public.library_stack_manageable(p_assembly_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when a.company_id is null then a.user_id = auth.uid()
                else public.has_company_permission(a.company_id, 'manage_company_pricing') end
    from public.assemblies a where a.id = p_assembly_id
  ), false)
$$;
revoke execute on function public.library_stack_manageable(uuid) from public, anon;
grant execute on function public.library_stack_manageable(uuid) to authenticated;

drop policy if exists assemblies_company_select on public.assemblies;
drop policy if exists assemblies_company_update on public.assemblies;
drop policy if exists assemblies_company_delete on public.assemblies;
create policy assemblies_company_select on public.assemblies for select to authenticated
  using (company_id is not null and public.is_active_company_member(company_id));
create policy assemblies_company_update on public.assemblies for update to authenticated
  using (company_id is not null and public.has_company_permission(company_id, 'manage_company_pricing') and (select public.library_access()))
  with check (company_id is not null and public.has_company_permission(company_id, 'manage_company_pricing') and (select public.library_access()));
create policy assemblies_company_delete on public.assemblies for delete to authenticated
  using (company_id is not null and public.has_company_permission(company_id, 'manage_company_pricing'));

drop policy if exists assembly_items_company_select on public.assembly_items;
drop policy if exists assembly_items_company_update on public.assembly_items;
create policy assembly_items_company_select on public.assembly_items for select to authenticated
  using (exists (select 1 from public.assemblies a where a.id = assembly_id and a.company_id is not null and public.is_active_company_member(a.company_id)));
create policy assembly_items_company_update on public.assembly_items for update to authenticated
  using (exists (select 1 from public.assemblies a where a.id = assembly_id and a.company_id is not null
                 and public.has_company_permission(a.company_id, 'manage_company_pricing')) and (select public.library_access()))
  with check (exists (select 1 from public.assemblies a where a.id = assembly_id and a.company_id is not null
                 and public.has_company_permission(a.company_id, 'manage_company_pricing')) and (select public.library_access()));

-- Guard: company templates are shared, changed and removed only with the pricing permission, by a member
-- of that company; the creator of a template can't take it back private or delete it without it. Signed-in
-- callers only (service-role maintenance and account deletion cascades pass through).
create or replace function public.assemblies_company_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op in ('UPDATE', 'DELETE') and old.company_id is not null
     and not public.has_company_permission(old.company_id, 'manage_company_pricing') then
    raise exception 'company_template_locked' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.company_id is not null
     and new.company_id is distinct from (case when tg_op = 'UPDATE' then old.company_id end)
     and not public.has_company_permission(new.company_id, 'manage_company_pricing') then
    raise exception 'company_template_locked' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists assemblies_company_guard on public.assemblies;
create trigger assemblies_company_guard before insert or update or delete on public.assemblies
  for each row execute function public.assemblies_company_guard();

-- Guard: rows join only stacks the caller manages (own or permitted company template).
create or replace function public.assembly_items_parent_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.library_stack_manageable(new.assembly_id) then
    raise exception 'company_template_locked' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists assembly_items_parent_guard on public.assembly_items;
create trigger assembly_items_parent_guard before insert or update on public.assembly_items
  for each row execute function public.assembly_items_parent_guard();
