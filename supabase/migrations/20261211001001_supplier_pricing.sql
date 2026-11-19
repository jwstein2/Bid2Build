-- Supplier pricing: opt-in supplier connections and a price cross-check across the caller's own
-- imported supplier price lists.
--
--   1. supplier_connections: per company (or solo account), one row per pricing source the contractor
--      opted into (QXO, ABC Supply, SRS, Ferguson, 1build, ...). Holds only the contractor's account /
--      branch reference (never passwords or API keys) and their consent. Users can request or pause a
--      connection; only the server (service role) marks one 'connected', once a partner integration is live.
--   2. supplier_price_cross_check(query): the latest price per supplier and product from imported price
--      lists the caller can see (their own imports, plus imports linked to their company's suppliers).
--      Only real imported prices: nothing here estimates or invents a number.
--
-- Depends on 20261127001000 (price_imports / price_records) and 20261210001000 (pm_suppliers + helpers).
-- Rollback: docs/supplier-pricing/rollback_20261211001000.sql

-- 1. Connections ---------------------------------------------------------------------------------------
create table if not exists public.supplier_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  provider text not null check (provider in ('qxo', 'abc_supply', 'srs', 'ferguson', 'home_depot_pro', 'lowes_pro', 'lumber_84', 'onebuild', 'rsmeans')),
  supplier_id uuid references public.pm_suppliers (id) on delete set null,
  account_ref text check (char_length(account_ref) <= 80),
  branch_ref text check (char_length(branch_ref) <= 80),
  use_for_cross_check boolean not null default true,
  status text not null default 'requested' check (status in ('requested', 'connected', 'paused')),
  consent_at timestamptz not null default now(),
  consent_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_connections_scope check ((company_id is null) <> (owner_id is null))
);
create unique index if not exists supplier_connections_provider_uq on public.supplier_connections (coalesce(company_id, owner_id), provider);
alter table public.supplier_connections enable row level security;
drop policy if exists supplier_connections_select on public.supplier_connections;
create policy supplier_connections_select on public.supplier_connections for select to authenticated
  using ((company_id is not null and public.is_active_company_member(company_id)) or (company_id is null and owner_id = (select auth.uid())));
revoke all on public.supplier_connections from anon, authenticated;
grant select on public.supplier_connections to authenticated;

create or replace function public.supplier_connections_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'canManage', public.supplier_manageable(public.my_company_id(), case when public.my_company_id() is null then auth.uid() end),
    'connections', coalesce((select jsonb_agg(jsonb_build_object(
        'provider', c.provider, 'supplierId', c.supplier_id, 'supplierName', s.name, 'accountRef', c.account_ref,
        'branchRef', c.branch_ref, 'useForCrossCheck', c.use_for_cross_check, 'status', c.status,
        'consentAt', c.consent_at, 'connectedAt', c.connected_at, 'lastSyncAt', c.last_sync_at) order by c.provider)
      from public.supplier_connections c left join public.pm_suppliers s on s.id = c.supplier_id
      where public.team_in_my_scope(c.company_id, c.owner_id)), '[]'::jsonb))
  where auth.uid() is not null
$$;
revoke execute on function public.supplier_connections_list() from public, anon;
grant execute on function public.supplier_connections_list() to authenticated;

-- Opt in to (or update) a pricing source. p = { provider, supplierId?, accountRef?, branchRef?, useForCrossCheck?, paused? }
-- A 'connected' row stays connected unless the caller pauses it; a paused row resumes as requested or connected.
create or replace function public.supplier_connection_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_owner uuid := case when public.my_company_id() is null then auth.uid() end;
  v_provider text := p ->> 'provider';
  v_supplier uuid := nullif(p ->> 'supplierId', '')::uuid;
  v_paused boolean := coalesce((p ->> 'paused')::boolean, false);
  r public.supplier_connections;
begin
  if not public.supplier_manageable(v_company, v_owner) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_provider is null or v_provider not in ('qxo', 'abc_supply', 'srs', 'ferguson', 'home_depot_pro', 'lowes_pro', 'lumber_84', 'onebuild', 'rsmeans') then
    raise exception 'bad_provider' using errcode = '22023';
  end if;
  if v_supplier is not null and not exists (select 1 from public.pm_suppliers s where s.id = v_supplier
      and s.company_id is not distinct from v_company and s.owner_id is not distinct from v_owner) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into r from public.supplier_connections c where coalesce(c.company_id, c.owner_id) = coalesce(v_company, v_owner) and c.provider = v_provider for update;
  if not found then
    insert into public.supplier_connections (company_id, owner_id, provider, supplier_id, account_ref, branch_ref, use_for_cross_check, status, consent_by)
    values (v_company, v_owner, v_provider, v_supplier, left(nullif(btrim(p ->> 'accountRef'), ''), 80), left(nullif(btrim(p ->> 'branchRef'), ''), 80),
            coalesce((p ->> 'useForCrossCheck')::boolean, true), case when v_paused then 'paused' else 'requested' end, auth.uid());
  else
    update public.supplier_connections set supplier_id = v_supplier,
      account_ref = left(nullif(btrim(p ->> 'accountRef'), ''), 80), branch_ref = left(nullif(btrim(p ->> 'branchRef'), ''), 80),
      use_for_cross_check = coalesce((p ->> 'useForCrossCheck')::boolean, r.use_for_cross_check),
      status = case when v_paused then 'paused' when r.connected_at is not null then 'connected' else 'requested' end,
      consent_at = case when r.status = 'paused' and not v_paused then now() else r.consent_at end,
      consent_by = case when r.status = 'paused' and not v_paused then auth.uid() else r.consent_by end,
      updated_at = now()
    where id = r.id;
  end if;
end $$;
revoke execute on function public.supplier_connection_save(jsonb) from public, anon;
grant execute on function public.supplier_connection_save(jsonb) to authenticated;

-- Withdraw consent: deletes the row (and with it the account reference).
create or replace function public.supplier_connection_remove(p_provider text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_owner uuid := case when public.my_company_id() is null then auth.uid() end;
begin
  if not public.supplier_manageable(v_company, v_owner) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.supplier_connections c where coalesce(c.company_id, c.owner_id) = coalesce(v_company, v_owner) and c.provider = p_provider;
end $$;
revoke execute on function public.supplier_connection_remove(text) from public, anon;
grant execute on function public.supplier_connection_remove(text) to authenticated;

-- 2. Price cross-check ---------------------------------------------------------------------------------
-- With a query: the latest price per supplier for products whose name or SKU matches (up to 200 rows).
-- Without one: products (same name, unit and pack) that two or more suppliers price, so the caller can
-- see where they pay more (up to 300 rows). Undone imports and archived suppliers are left out; expired
-- prices are returned flagged so the page can show but not rank them.
create or replace function public.supplier_price_cross_check(p_query text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid := public.my_company_id();
  q text := nullif(btrim(coalesce(p_query, '')), '');
  pat text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if q is not null and char_length(q) > 100 then raise exception 'invalid' using errcode = '22023'; end if;
  pat := case when q is null then null else '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  return (
    with visible as (
      select r.id, r.product_name, r.supplier_sku, r.unit, r.pack_size, r.unit_cost, r.effective_on, r.expires_on, r.created_at,
             coalesce(s.name, r.supplier_name) as sup_name, s.id as sup_id
      from public.price_records r
      join public.price_imports i on i.id = r.import_id and i.status = 'applied'
      left join public.pm_suppliers s on s.id = i.supplier_id
      where (r.user_id = uid or (cid is not null and s.company_id = cid))
        and (s.id is null or s.status = 'active')
        and coalesce(s.name, r.supplier_name) is not null
    ), latest as (
      select distinct on (lower(btrim(sup_name)), lower(btrim(product_name)), lower(btrim(unit)), coalesce(pack_size, 1)) *
      from visible
      order by lower(btrim(sup_name)), lower(btrim(product_name)), lower(btrim(unit)), coalesce(pack_size, 1), effective_on desc, created_at desc
    ), picked as (
      select l.* from latest l
      where case when pat is not null then l.product_name ilike pat or coalesce(l.supplier_sku, '') ilike pat
            else exists (select 1 from latest o where lower(btrim(o.product_name)) = lower(btrim(l.product_name))
                           and lower(btrim(o.unit)) = lower(btrim(l.unit)) and coalesce(o.pack_size, 1) = coalesce(l.pack_size, 1)
                           and lower(btrim(o.sup_name)) <> lower(btrim(l.sup_name))) end
      order by lower(btrim(l.product_name)), lower(btrim(l.unit)), l.unit_cost
      limit case when pat is not null then 200 else 300 end
    )
    select jsonb_build_object('query', q, 'rows', coalesce(jsonb_agg(jsonb_build_object(
        'supplier', p.sup_name, 'supplierId', p.sup_id, 'product', p.product_name, 'sku', p.supplier_sku, 'unit', p.unit,
        'packSize', p.pack_size, 'unitCost', p.unit_cost, 'effectiveOn', p.effective_on, 'expiresOn', p.expires_on,
        'expired', p.expires_on is not null and p.expires_on < current_date)
        order by lower(btrim(p.product_name)), lower(btrim(p.unit)), p.unit_cost), '[]'::jsonb))
    from picked p);
end $$;
revoke execute on function public.supplier_price_cross_check(text) from public, anon;
grant execute on function public.supplier_price_cross_check(text) to authenticated;
