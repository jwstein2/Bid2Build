-- V5 Pricing Intelligence, part 1: supplier price-list import, price-source metadata, target margin.
--
-- 1. saved_items gains supplier / SKU / pack size / favorite and where its price came from
--    (manual, supplier_import, supplier_quote, api) with an effective date. Existing rows keep their
--    values; new columns are nullable or defaulted (price_source = 'manual').
-- 2. price_imports: one row per applied supplier file (who, which supplier, counts, undone or not).
-- 3. price_records: an append-only history of every price an import set, with the value it replaced,
--    so an import can be undone and a contractor can see where a price came from.
-- 4. price_import_apply / price_import_undo: the only write path for imports. One transaction per
--    file; Unlimited (library_access) required, same rule as the Saved Items library.
-- 5. business_profiles.target_margin_pct: the contractor's minimum gross margin. The builder warns
--    below it; it never blocks a bid.
--
-- Estimates never reference saved items (values are copied in), so nothing here can change a sent,
-- approved or signed bid. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Saved item price metadata
-- ---------------------------------------------------------------------------
alter table public.saved_items add column if not exists supplier_name text check (char_length(supplier_name) <= 120);
alter table public.saved_items add column if not exists supplier_sku text check (char_length(supplier_sku) <= 80);
alter table public.saved_items add column if not exists pack_size numeric(14, 4) check (pack_size > 0);
alter table public.saved_items add column if not exists favorite boolean not null default false;
alter table public.saved_items add column if not exists price_source text not null default 'manual';
alter table public.saved_items add column if not exists price_effective_on date;
alter table public.saved_items add column if not exists price_updated_at timestamptz;
alter table public.saved_items drop constraint if exists saved_items_price_source_check;
alter table public.saved_items add constraint saved_items_price_source_check
  check (price_source in ('manual', 'supplier_import', 'supplier_quote', 'api'));
-- A price typed by hand (library page, "Save Item" in the builder) is a manual price again, so the
-- source never claims a supplier for a number the contractor changed. The import functions set
-- b2b.price_import for their own transaction to keep their source.
create or replace function public.saved_items_price_source_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.unit_cost is distinct from old.unit_cost and coalesce(current_setting('b2b.price_import', true), '') <> 'on' then
    new.price_source := 'manual';
    new.price_effective_on := current_date;
    new.price_updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists saved_items_price_source on public.saved_items;
create trigger saved_items_price_source before update on public.saved_items
  for each row execute function public.saved_items_price_source_guard();

create index if not exists saved_items_user_sku_idx on public.saved_items (user_id, lower(supplier_sku)) where supplier_sku is not null;

-- ---------------------------------------------------------------------------
-- 2. Imports
-- ---------------------------------------------------------------------------
create table if not exists public.price_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  supplier_name text not null check (char_length(supplier_name) between 1 and 120),
  file_name text check (char_length(file_name) <= 255),
  effective_on date not null default current_date,
  rows_total int not null default 0,
  created_count int not null default 0,
  updated_count int not null default 0,
  unchanged_count int not null default 0,
  status text not null default 'applied' check (status in ('applied', 'undone')),
  restored_count int,
  kept_count int,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
create index if not exists price_imports_user_idx on public.price_imports (user_id, created_at desc);
alter table public.price_imports enable row level security;
drop policy if exists price_imports_own_select on public.price_imports;
create policy price_imports_own_select on public.price_imports for select to authenticated
  using (user_id = (select auth.uid()));
-- No insert/update/delete policies or grants: writes go through the functions below.
revoke all on public.price_imports from anon;
grant select on public.price_imports to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Price history
-- ---------------------------------------------------------------------------
create table if not exists public.price_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  import_id uuid references public.price_imports (id) on delete cascade,
  saved_item_id uuid references public.saved_items (id) on delete set null,
  action text not null check (action in ('created', 'updated', 'unchanged')),
  source_kind text not null default 'supplier_import' check (source_kind in ('manual', 'supplier_import', 'supplier_quote', 'api')),
  supplier_name text check (char_length(supplier_name) <= 120),
  supplier_sku text check (char_length(supplier_sku) <= 80),
  product_name text not null check (char_length(product_name) between 1 and 300),
  unit text not null check (char_length(unit) between 1 and 40),
  pack_size numeric(14, 4) check (pack_size > 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  previous_unit_cost numeric(14, 4),
  previous_source text,
  previous_supplier_name text,
  previous_supplier_sku text,
  effective_on date not null default current_date,
  expires_on date,
  -- clock time, not transaction time, so two records for one item in one file still have an order.
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists price_records_item_idx on public.price_records (saved_item_id, created_at desc);
create index if not exists price_records_import_idx on public.price_records (import_id);
alter table public.price_records enable row level security;
drop policy if exists price_records_own_select on public.price_records;
create policy price_records_own_select on public.price_records for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.price_records from anon;
grant select on public.price_records to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Apply / undo
-- ---------------------------------------------------------------------------
-- p = { supplierName, fileName?, effectiveOn?, rows: [{ savedItemId?, name, sku?, unit, packSize?,
--       unitCost, expiresOn?, trade?, category?, costType? }] }
create or replace function public.price_import_apply(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  imp uuid;
  r jsonb;
  item public.saved_items%rowtype;
  new_id uuid;
  cost numeric(14, 4);
  pack numeric(14, 4);
  eff date := coalesce(nullif(p->>'effectiveOn', '')::date, current_date);
  supplier text := nullif(btrim(p->>'supplierName'), '');
  sku text;
  nm text;
  un text;
  n_created int := 0; n_updated int := 0; n_same int := 0;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public.library_access() then raise exception 'premium_required'; end if;
  if supplier is null then raise exception 'supplier_required'; end if;
  if jsonb_typeof(p->'rows') <> 'array' or jsonb_array_length(p->'rows') = 0 then raise exception 'no_rows'; end if;
  if jsonb_array_length(p->'rows') > 2000 then raise exception 'too_many_rows'; end if;
  perform set_config('b2b.price_import', 'on', true);

  insert into public.price_imports (user_id, supplier_name, file_name, effective_on, rows_total)
  values (uid, supplier, left(nullif(p->>'fileName', ''), 255), eff, jsonb_array_length(p->'rows'))
  returning id into imp;

  for r in select * from jsonb_array_elements(p->'rows') loop
    nm := nullif(btrim(r->>'name'), '');
    un := coalesce(nullif(btrim(r->>'unit'), ''), 'each');
    sku := nullif(btrim(r->>'sku'), '');
    if nm is null then raise exception 'row_name_required'; end if;
    begin
      cost := (r->>'unitCost')::numeric;
      pack := nullif(r->>'packSize', '')::numeric;
    exception when others then raise exception 'row_bad_number';
    end;
    if cost is null or cost < 0 then raise exception 'row_bad_number'; end if;

    if nullif(r->>'savedItemId', '') is not null then
      select * into item from public.saved_items where id = (r->>'savedItemId')::uuid and user_id = uid for update;
      if not found then raise exception 'item_not_found'; end if;
      if item.unit_cost is not distinct from cost and item.supplier_sku is not distinct from coalesce(sku, item.supplier_sku) then
        n_same := n_same + 1;
        insert into public.price_records (user_id, import_id, saved_item_id, action, supplier_name, supplier_sku, product_name, unit, pack_size, unit_cost, previous_unit_cost, previous_source, effective_on, expires_on)
        values (uid, imp, item.id, 'unchanged', supplier, sku, nm, un, pack, cost, item.unit_cost, item.price_source, eff, nullif(r->>'expiresOn', '')::date);
      else
        n_updated := n_updated + 1;
        insert into public.price_records (user_id, import_id, saved_item_id, action, supplier_name, supplier_sku, product_name, unit, pack_size, unit_cost, previous_unit_cost, previous_source, previous_supplier_name, previous_supplier_sku, effective_on, expires_on)
        values (uid, imp, item.id, 'updated', supplier, sku, nm, un, pack, cost, item.unit_cost, item.price_source, item.supplier_name, item.supplier_sku, eff, nullif(r->>'expiresOn', '')::date);
        update public.saved_items set unit_cost = cost, supplier_name = supplier, supplier_sku = coalesce(sku, supplier_sku),
          pack_size = coalesce(pack, pack_size), price_source = 'supplier_import', price_effective_on = eff, price_updated_at = now()
        where id = item.id;
      end if;
    else
      n_created := n_created + 1;
      insert into public.saved_items (user_id, name, unit, unit_cost, cost_type, trade, category, supplier_name, supplier_sku, pack_size, price_source, price_effective_on, price_updated_at)
      values (uid, left(nm, 300), left(un, 40), cost,
        case when r->>'costType' in ('material', 'labor', 'labor_material', 'equipment', 'subcontractor', 'other') then r->>'costType' else 'material' end,
        left(nullif(r->>'trade', ''), 60), left(nullif(r->>'category', ''), 120), supplier, sku, pack, 'supplier_import', eff, now())
      returning id into new_id;
      insert into public.price_records (user_id, import_id, saved_item_id, action, supplier_name, supplier_sku, product_name, unit, pack_size, unit_cost, effective_on, expires_on)
      values (uid, imp, new_id, 'created', supplier, sku, nm, un, pack, cost, eff, nullif(r->>'expiresOn', '')::date);
    end if;
  end loop;

  update public.price_imports set created_count = n_created, updated_count = n_updated, unchanged_count = n_same where id = imp;
  return jsonb_build_object('importId', imp, 'created', n_created, 'updated', n_updated, 'unchanged', n_same);
end $$;
revoke execute on function public.price_import_apply(jsonb) from public, anon;
grant execute on function public.price_import_apply(jsonb) to authenticated;

-- Undo restores each price this import set, but only where nothing changed it since (the item still
-- has the imported cost and no later price record). Anything edited afterwards is kept and counted.
create or replace function public.price_import_undo(p_import_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  imp public.price_imports%rowtype;
  rec public.price_records%rowtype;
  item public.saved_items%rowtype;
  latest uuid;
  n_restored int := 0; n_removed int := 0; n_kept int := 0;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public.library_access() then raise exception 'premium_required'; end if;
  select * into imp from public.price_imports where id = p_import_id and user_id = uid for update;
  if not found then raise exception 'import_not_found'; end if;
  if imp.status <> 'applied' then raise exception 'already_undone'; end if;
  perform set_config('b2b.price_import', 'on', true);

  for rec in select * from public.price_records where import_id = imp.id and action <> 'unchanged' order by created_at desc, id loop
    select * into item from public.saved_items where id = rec.saved_item_id and user_id = uid for update;
    if not found then continue; end if; -- deleted since: nothing to restore
    select pr.id into latest from public.price_records pr where pr.saved_item_id = item.id and pr.action <> 'unchanged' order by pr.created_at desc, pr.id desc limit 1;
    if latest is distinct from rec.id or item.unit_cost is distinct from rec.unit_cost then
      n_kept := n_kept + 1;
      continue;
    end if;
    if rec.action = 'created' then
      delete from public.saved_items where id = item.id;
      n_removed := n_removed + 1;
    else
      update public.saved_items set unit_cost = rec.previous_unit_cost, price_source = coalesce(rec.previous_source, 'manual'),
        supplier_name = rec.previous_supplier_name, supplier_sku = rec.previous_supplier_sku, price_updated_at = now()
      where id = item.id;
      n_restored := n_restored + 1;
    end if;
  end loop;

  update public.price_imports set status = 'undone', undone_at = now(), restored_count = n_restored + n_removed, kept_count = n_kept where id = imp.id;
  return jsonb_build_object('restored', n_restored, 'removed', n_removed, 'kept', n_kept);
end $$;
revoke execute on function public.price_import_undo(uuid) from public, anon;
grant execute on function public.price_import_undo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Target margin
-- ---------------------------------------------------------------------------
alter table public.business_profiles add column if not exists target_margin_pct numeric(5, 2)
  check (target_margin_pct is null or (target_margin_pct >= 0 and target_margin_pct < 100));
