-- Financial Command Center, Phase 1 (part 3 of 3): job costs.
--
--   * fin_vendors: the book's payees. A vendor can point at a Projects directory entry (pm_resources,
--     same company / owner only) so subcontractors aren't typed twice.
--   * fin_cost_codes: trade x cost type (the 11 estimate cost types), seeded per book from the trade
--     catalog for the trades in the Business & Trade Configuration and for every job's bid. Seeding only
--     ever ADDS codes: switching trades never renames, removes or re-codes anything already recorded.
--   * fin_budget_lines: the estimated cost per section x cost type, frozen from the contract version's
--     snapshot when the job's contract baseline is created (sum of round(quantity x unitCost, 2); example
--     rows excluded). Immutable.
--   * fin_commitments (+ revisions): subcontracts / POs. Vendor bill lines that reference a commitment
--     relieve it: committed (open) = max(current amount - approved billed, 0), so a billed dollar is
--     counted once, as actual.
--   * fin_vendor_bills + lines (approval with approve_vendor_bills; duplicate vendor-number guard) and
--     fin_expenses (approval with approve_expenses). Both are write-once except their lifecycle
--     columns and a cost code / receipt that may be filled in once when missing.
--   * fin_review_items: the needs-review queue (uncoded costs, missing receipts, commitment overruns).
--   * Views: fin_job_costs_v (actual only), fin_job_budget_v and fin_job_profitability_v, every amount
--     labeled estimated / committed / actual.
--
-- Safe to run more than once. Requires 20261123002000_fin_receivables.sql.
-- Rollback: docs/financials/rollback_20261123003000.sql

-- 1. Cost codes -------------------------------------------------------------------------------------------
create or replace function public.fin_cost_types() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array['material', 'labor', 'labor_material', 'equipment', 'subcontractor', 'overhead', 'contingency', 'permit', 'delivery', 'labor_burden', 'other']
$$;

create table if not exists public.fin_cost_codes (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references public.fin_books (id) on delete restrict,
  code       text not null check (code ~ '^[a-z0-9-]+:[a-z_]+$' and char_length(code) <= 80),
  name       text not null check (char_length(name) between 1 and 200),
  trade_slug text references public.trade_categories (slug) on update cascade on delete restrict,   -- null = general
  cost_type  text not null check (cost_type = any (public.fin_cost_types())),
  source     text not null default 'catalog' check (source in ('catalog', 'custom')),
  active     boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (book_id, code),
  unique (book_id, id)
);

-- Code, trade and cost type never change once created (history points at them); name/active may.
create or replace function public.fin_cost_codes_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'name' - 'active') is distinct from (to_jsonb(old) - 'name' - 'active') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists fin_cost_codes_guard on public.fin_cost_codes;
create trigger fin_cost_codes_guard before update or delete on public.fin_cost_codes for each row execute function public.fin_cost_codes_guard();

create or replace function public.fin_cost_type_label(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case p when 'labor_material' then 'Labor & Material' when 'labor_burden' then 'Labor Burden' else initcap(p) end
$$;

-- Adds (never changes) the catalog codes for these trades plus the general ones.
create or replace function public.fin_cost_codes_ensure(p_book_id uuid, p_trades text[]) returns void
language sql security definer set search_path = public as $$
  insert into public.fin_cost_codes (book_id, code, name, trade_slug, cost_type, source)
  select p_book_id, coalesce(t.slug, 'general') || ':' || ct, coalesce(t.name, 'General') || ' - ' || public.fin_cost_type_label(ct), t.slug, ct, 'catalog'
    from (select null::text as slug, null::text as name
          union all select tc.slug, tc.name from public.trade_categories tc where tc.slug = any (coalesce(p_trades, '{}'))) t
   cross join unnest(public.fin_cost_types()) ct
  on conflict (book_id, code) do nothing
$$;
revoke execute on function public.fin_cost_codes_ensure(uuid, text[]) from public, anon, authenticated;

-- The configured trades get their codes when the configuration is saved (adds only).
create or replace function public.fin_business_config_codes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.fin_cost_codes_ensure(new.book_id, new.additional_trade_slugs || array_remove(array[new.primary_trade_slug], null));
  return null;
end $$;
revoke execute on function public.fin_business_config_codes() from public, anon, authenticated;
drop trigger if exists fin_business_config_codes on public.fin_business_config;
create trigger fin_business_config_codes after insert or update on public.fin_business_config for each row execute function public.fin_business_config_codes();

-- Custom codes: p {id?, tradeSlug?, costType, name, active?}.
create or replace function public.fin_cost_code_save(p_book_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_trade text := nullif(p ->> 'tradeSlug', ''); v_type text := p ->> 'costType'; v_code text;
begin
  perform public.fin_require(p_book_id, 'manage_financial_config', true);
  if v_id is not null then
    update public.fin_cost_codes set name = coalesce(left(nullif(btrim(p ->> 'name'), ''), 200), name), active = coalesce((p ->> 'active')::boolean, active)
     where id = v_id and book_id = p_book_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  else
    if v_trade is not null and not public.fin_trade_slugs_valid(array[v_trade]) then raise exception 'unknown_trade' using errcode = '22023'; end if;
    if not (v_type = any (public.fin_cost_types())) then raise exception 'bad_cost_type' using errcode = '22023'; end if;
    v_code := coalesce(v_trade, 'general') || '-' || left(regexp_replace(lower(coalesce(p ->> 'suffix', substr(md5(random()::text), 1, 6))), '[^a-z0-9]', '', 'g'), 20) || ':' || v_type;
    insert into public.fin_cost_codes (book_id, code, name, trade_slug, cost_type, source, created_by)
    values (p_book_id, v_code, left(coalesce(nullif(btrim(p ->> 'name'), ''), v_code), 200), v_trade, v_type, 'custom', auth.uid()) returning id into v_id;
  end if;
  perform public.fin_audit(p_book_id, 'cost_code.saved', 'cost_code', v_id, p);
  return v_id;
end $$;

-- 2. Budget (estimated cost, frozen from the contract version) -------------------------------------------------
create table if not exists public.fin_budget_lines (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.fin_books (id) on delete restrict,
  job_id       uuid not null references public.fin_jobs (id) on delete restrict,
  snapshot_id  uuid not null references public.fin_contract_snapshots (id) on delete restrict,
  cost_code_id uuid not null references public.fin_cost_codes (id) on delete restrict,
  group_key    text not null check (char_length(group_key) <= 80),
  group_name   text not null check (char_length(group_name) <= 300),
  trade_slug   text,
  cost_type    text not null check (cost_type = any (public.fin_cost_types())),
  amount       numeric(14, 2) not null,
  created_at   timestamptz not null default now(),
  unique (snapshot_id, group_key, cost_type)
);
create index if not exists fin_budget_lines_job_idx on public.fin_budget_lines (job_id);
drop trigger if exists fin_budget_lines_immutable on public.fin_budget_lines;
create trigger fin_budget_lines_immutable before update or delete on public.fin_budget_lines for each row execute function public.fin_guard_immutable();

-- Section trade: the snapshot group's trade, else the bid's primary trade; unknown slugs -> general.
create or replace function public.fin_budget_from_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_snap jsonb; v_trades text[]; v_primary text;
begin
  select snapshot into v_snap from public.estimate_versions where id = new.version_id;
  v_trades := coalesce(array(select jsonb_array_elements_text(coalesce(v_snap -> 'estimate' -> 'trades', '[]'::jsonb))), '{}');
  v_primary := v_trades[1];
  with groups as (
    select g ->> 'id' as gid, coalesce(nullif(btrim(g ->> 'name'), ''), 'Section') as gname,
           coalesce(nullif(g ->> 'trade', ''), v_primary) as trade
      from jsonb_array_elements(coalesce(v_snap -> 'estimate' -> 'groups', '[]'::jsonb)) g),
  items as (
    select coalesce(i ->> 'groupId', '') as gid, coalesce(nullif(i ->> 'costType', ''), 'other') as cost_type,
           round(coalesce(nullif(i ->> 'quantity', '')::numeric, 0) * coalesce(nullif(i ->> 'unitCost', '')::numeric, 0), 2) as amount
      from jsonb_array_elements(coalesce(v_snap -> 'estimate' -> 'items', '[]'::jsonb)) i
     where not coalesce((i ->> 'isExample')::boolean, false)),
  rows as (
    select it.gid, coalesce(g.gname, 'Unassigned') as gname,
           (select tc.slug from public.trade_categories tc where tc.slug = coalesce(g.trade, v_primary)) as trade,
           case when it.cost_type = any (public.fin_cost_types()) then it.cost_type else 'other' end as cost_type, sum(it.amount) as amount
      from items it left join groups g on g.gid = it.gid
     group by 1, 2, 3, 4)
  select array_agg(distinct trade) filter (where trade is not null) into v_trades from rows;
  perform public.fin_cost_codes_ensure(new.book_id, coalesce(v_trades, '{}') || coalesce(array(select jsonb_array_elements_text(coalesce(v_snap -> 'estimate' -> 'trades', '[]'::jsonb))), '{}'));
  insert into public.fin_budget_lines (book_id, job_id, snapshot_id, cost_code_id, group_key, group_name, trade_slug, cost_type, amount)
  with groups as (
    select g ->> 'id' as gid, coalesce(nullif(btrim(g ->> 'name'), ''), 'Section') as gname, coalesce(nullif(g ->> 'trade', ''), v_primary) as trade
      from jsonb_array_elements(coalesce(v_snap -> 'estimate' -> 'groups', '[]'::jsonb)) g),
  items as (
    select coalesce(i ->> 'groupId', '') as gid, coalesce(nullif(i ->> 'costType', ''), 'other') as cost_type,
           round(coalesce(nullif(i ->> 'quantity', '')::numeric, 0) * coalesce(nullif(i ->> 'unitCost', '')::numeric, 0), 2) as amount
      from jsonb_array_elements(coalesce(v_snap -> 'estimate' -> 'items', '[]'::jsonb)) i
     where not coalesce((i ->> 'isExample')::boolean, false)),
  rows as (
    select left(it.gid, 80) as gid, left(coalesce(g.gname, 'Unassigned'), 300) as gname,
           (select tc.slug from public.trade_categories tc where tc.slug = coalesce(g.trade, v_primary)) as trade,
           case when it.cost_type = any (public.fin_cost_types()) then it.cost_type else 'other' end as cost_type, sum(it.amount) as amount
      from items it left join groups g on g.gid = it.gid
     group by 1, 2, 3, 4)
  select new.book_id, new.job_id, new.id, c.id, r.gid, r.gname, r.trade, r.cost_type, r.amount
    from rows r join public.fin_cost_codes c on c.book_id = new.book_id and c.code = coalesce(r.trade, 'general') || ':' || r.cost_type
  on conflict do nothing;
  return null;
end $$;
revoke execute on function public.fin_budget_from_snapshot() from public, anon, authenticated;
drop trigger if exists fin_contract_snapshots_budget on public.fin_contract_snapshots;
create trigger fin_contract_snapshots_budget after insert on public.fin_contract_snapshots for each row execute function public.fin_budget_from_snapshot();

-- 3. Vendors --------------------------------------------------------------------------------------------------
create table if not exists public.fin_vendors (
  id                   uuid primary key default gen_random_uuid(),
  book_id              uuid not null references public.fin_books (id) on delete restrict,
  resource_id          uuid references public.pm_resources (id) on delete restrict,
  name                 text not null check (char_length(btrim(name)) between 1 and 200),
  kind                 text not null default 'subcontractor' check (kind in ('subcontractor', 'supplier', 'other')),
  email                text check (char_length(email) <= 320),
  phone                text check (char_length(phone) <= 40),
  default_cost_code_id uuid references public.fin_cost_codes (id) on delete restrict,
  status               text not null default 'active' check (status in ('active', 'archived')),
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (book_id, resource_id)
);
create index if not exists fin_vendors_book_idx on public.fin_vendors (book_id, status, name);
drop trigger if exists fin_vendors_updated on public.fin_vendors;
create trigger fin_vendors_updated before update on public.fin_vendors for each row execute function public.set_updated_at();
create or replace function public.fin_vendors_no_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'record_immutable' using errcode = 'P0001';
end $$;
drop trigger if exists fin_vendors_no_delete on public.fin_vendors;
create trigger fin_vendors_no_delete before delete on public.fin_vendors for each row execute function public.fin_vendors_no_delete();

-- p {id?, resourceId?, name, kind?, email?, phone?, defaultCostCodeId?, status?}
create or replace function public.fin_vendor_save(p_book_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_res uuid := nullif(p ->> 'resourceId', '')::uuid; b public.fin_books; r public.pm_resources;
        v_code uuid := nullif(p ->> 'defaultCostCodeId', '')::uuid;
begin
  if not (public.fin_has_permission(p_book_id, 'record_bills', true) or public.fin_has_permission(p_book_id, 'record_expenses', true)) then
    perform public.fin_require(p_book_id, 'record_bills', true);
  end if;
  select * into b from public.fin_books where id = p_book_id;
  if v_res is not null then
    select * into r from public.pm_resources where id = v_res;
    if not found or r.company_id is distinct from b.company_id or r.owner_id is distinct from b.owner_user_id then
      raise exception 'resource_scope' using errcode = '22023';
    end if;
  end if;
  if v_code is not null and not exists (select 1 from public.fin_cost_codes where id = v_code and book_id = p_book_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_id is null then
    insert into public.fin_vendors (book_id, resource_id, name, kind, email, phone, default_cost_code_id, created_by)
    values (p_book_id, v_res, left(btrim(coalesce(nullif(p ->> 'name', ''), r.name)), 200), coalesce(nullif(p ->> 'kind', ''), case when r.kind = 'subcontractor' then 'subcontractor' else 'other' end),
            coalesce(nullif(p ->> 'email', ''), r.email), coalesce(nullif(p ->> 'phone', ''), r.phone), v_code, auth.uid())
    on conflict (book_id, resource_id) do update set name = excluded.name
    returning id into v_id;
  else
    update public.fin_vendors set name = left(btrim(coalesce(nullif(p ->> 'name', ''), name)), 200), kind = coalesce(nullif(p ->> 'kind', ''), kind),
      email = nullif(p ->> 'email', ''), phone = nullif(p ->> 'phone', ''), default_cost_code_id = v_code,
      status = coalesce(nullif(p ->> 'status', ''), status), resource_id = coalesce(v_res, resource_id)
     where id = v_id and book_id = p_book_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  perform public.fin_audit(p_book_id, 'vendor.saved', 'vendor', v_id, p);
  return v_id;
end $$;

-- 4. Commitments ------------------------------------------------------------------------------------------------
create table if not exists public.fin_commitments (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid not null references public.fin_books (id) on delete restrict,
  job_id          uuid not null references public.fin_jobs (id) on delete restrict,
  vendor_id       uuid not null references public.fin_vendors (id) on delete restrict,
  cost_code_id    uuid not null references public.fin_cost_codes (id) on delete restrict,
  seq             bigint not null,
  number          text not null check (char_length(number) <= 30),
  title           text not null check (char_length(title) between 1 and 300),
  kind            text not null default 'subcontract' check (kind in ('subcontract', 'purchase_order')),
  original_amount numeric(14, 2) not null check (original_amount > 0),
  quote_id        uuid references public.subcontractor_quotes (id) on delete restrict,
  status          text not null default 'open' check (status in ('open', 'closed', 'void')),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,
  voided_by       uuid references auth.users (id) on delete set null,
  voided_at       timestamptz,
  unique (book_id, number)
);
create index if not exists fin_commitments_job_idx on public.fin_commitments (job_id, status);

create table if not exists public.fin_commitment_revisions (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.fin_books (id) on delete restrict,
  commitment_id uuid not null references public.fin_commitments (id) on delete restrict,
  revision_no   integer not null check (revision_no >= 1),
  delta         numeric(14, 2) not null check (delta <> 0),
  reason        text not null check (char_length(reason) between 1 and 500),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (commitment_id, revision_no)
);
drop trigger if exists fin_commitment_revisions_immutable on public.fin_commitment_revisions;
create trigger fin_commitment_revisions_immutable before update or delete on public.fin_commitment_revisions for each row execute function public.fin_guard_immutable();

-- 5. Vendor bills ------------------------------------------------------------------------------------------------
create table if not exists public.fin_vendor_bills (
  id                    uuid primary key default gen_random_uuid(),
  book_id               uuid not null references public.fin_books (id) on delete restrict,
  vendor_id             uuid not null references public.fin_vendors (id) on delete restrict,
  vendor_invoice_number text not null check (char_length(btrim(vendor_invoice_number)) between 1 and 80),
  seq                   bigint not null,
  number                text not null check (char_length(number) <= 30),
  bill_date             date not null,
  due_date              date not null,
  total                 numeric(14, 2) not null check (total > 0),
  memo                  text check (char_length(memo) <= 1000),
  document_id           uuid references public.fin_documents (id) on delete restrict,
  status                text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'void')),
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  approved_by           uuid references auth.users (id) on delete set null,
  approved_at           timestamptz,
  voided_by             uuid references auth.users (id) on delete set null,
  voided_at             timestamptz,
  void_reason           text check (char_length(void_reason) <= 500),
  unique (book_id, number),
  constraint fin_vendor_bills_approved check ((status = 'approved') = (approved_at is not null) or status = 'void'),
  constraint fin_vendor_bills_void check ((status = 'void') = (voided_at is not null)),
  constraint fin_vendor_bills_due check (due_date >= bill_date)
);
-- The same vendor invoice can't be entered twice (void it first to re-enter).
create unique index if not exists fin_vendor_bills_no_duplicate on public.fin_vendor_bills (book_id, vendor_id, lower(btrim(vendor_invoice_number))) where status <> 'void';
create index if not exists fin_vendor_bills_book_idx on public.fin_vendor_bills (book_id, status, due_date);

create table if not exists public.fin_vendor_bill_lines (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.fin_books (id) on delete restrict,
  bill_id       uuid not null references public.fin_vendor_bills (id) on delete restrict,
  line_no       integer not null check (line_no between 1 and 200),
  job_id        uuid references public.fin_jobs (id) on delete restrict,          -- null = overhead
  cost_code_id  uuid references public.fin_cost_codes (id) on delete restrict,    -- null on a job line = needs review
  commitment_id uuid references public.fin_commitments (id) on delete restrict,   -- relieves this commitment
  description   text not null check (char_length(description) between 1 and 500),
  amount        numeric(14, 2) not null check (amount <> 0),
  unique (bill_id, line_no)
);
create index if not exists fin_vendor_bill_lines_job_idx on public.fin_vendor_bill_lines (job_id) where job_id is not null;
create index if not exists fin_vendor_bill_lines_commitment_idx on public.fin_vendor_bill_lines (commitment_id) where commitment_id is not null;

-- 6. Expenses ------------------------------------------------------------------------------------------------------
create table if not exists public.fin_expenses (
  id                  uuid primary key default gen_random_uuid(),
  book_id             uuid not null references public.fin_books (id) on delete restrict,
  seq                 bigint not null,
  number              text not null check (char_length(number) <= 30),
  job_id              uuid references public.fin_jobs (id) on delete restrict,
  vendor_id           uuid references public.fin_vendors (id) on delete restrict,
  payee               text check (char_length(payee) <= 200),
  cost_code_id        uuid references public.fin_cost_codes (id) on delete restrict,
  spent_on            date not null,
  amount              numeric(14, 2) not null check (amount > 0),
  method              text not null default 'card' check (method in ('card', 'cash', 'check', 'ach', 'reimbursement', 'other')),
  description         text not null check (char_length(description) between 1 and 500),
  receipt_document_id uuid references public.fin_documents (id) on delete restrict,
  status              text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'void')),
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  approved_by         uuid references auth.users (id) on delete set null,
  approved_at         timestamptz,
  decision_note       text check (char_length(decision_note) <= 500),
  voided_at           timestamptz,
  unique (book_id, number),
  constraint fin_exp_approved check (status <> 'approved' or approved_at is not null),
  constraint fin_exp_void check ((status = 'void') = (voided_at is not null))
);
create index if not exists fin_expenses_job_idx on public.fin_expenses (job_id, status) where job_id is not null;
create index if not exists fin_expenses_book_idx on public.fin_expenses (book_id, status, spent_on desc);

-- Write-once with a lifecycle: listed columns may change; cost_code_id / receipt_document_id may be
-- filled in once when missing; a voided row never changes.
create or replace function public.fin_cost_rows_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_new jsonb; v_old jsonb; k text;
begin
  if tg_op = 'DELETE' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if (to_jsonb(old) ->> 'status') = 'void' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  v_new := to_jsonb(new); v_old := to_jsonb(old);
  foreach k in array tg_argv::text[] loop v_new := v_new - k; v_old := v_old - k; end loop;
  foreach k in array array['cost_code_id', 'receipt_document_id'] loop
    if v_old ? k and (v_old ->> k) is null then v_new := v_new - k; v_old := v_old - k; end if;
  end loop;
  if v_new is distinct from v_old then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists fin_commitments_guard on public.fin_commitments;
create trigger fin_commitments_guard before update or delete on public.fin_commitments
  for each row execute function public.fin_cost_rows_guard('status', 'closed_at', 'voided_by', 'voided_at');
drop trigger if exists fin_vendor_bills_guard on public.fin_vendor_bills;
create trigger fin_vendor_bills_guard before update or delete on public.fin_vendor_bills
  for each row execute function public.fin_cost_rows_guard('status', 'approved_by', 'approved_at', 'voided_by', 'voided_at', 'void_reason');
drop trigger if exists fin_vendor_bill_lines_guard on public.fin_vendor_bill_lines;
create trigger fin_vendor_bill_lines_guard before update or delete on public.fin_vendor_bill_lines
  for each row execute function public.fin_cost_rows_guard();
drop trigger if exists fin_expenses_guard on public.fin_expenses;
create trigger fin_expenses_guard before update or delete on public.fin_expenses
  for each row execute function public.fin_cost_rows_guard('status', 'approved_by', 'approved_at', 'decision_note', 'voided_at');

-- 7. Needs-review queue ------------------------------------------------------------------------------------------
create table if not exists public.fin_review_items (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  kind        text not null check (kind in ('uncoded_cost', 'missing_receipt', 'commitment_overrun', 'duplicate_suspected', 'other')),
  entity_type text not null check (entity_type in ('bill_line', 'expense', 'commitment', 'bill')),
  entity_id   uuid not null,
  job_id      uuid references public.fin_jobs (id) on delete restrict,
  details     jsonb,
  status      text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at  timestamptz not null default now(),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution  text check (char_length(resolution) <= 500)
);
create unique index if not exists fin_review_items_one_open on public.fin_review_items (kind, entity_type, entity_id) where status = 'open';
create index if not exists fin_review_items_book_idx on public.fin_review_items (book_id, status, created_at desc);
create or replace function public.fin_review_items_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' or old.status <> 'open'
     or (to_jsonb(new) - 'status' - 'resolved_by' - 'resolved_at' - 'resolution') is distinct from (to_jsonb(old) - 'status' - 'resolved_by' - 'resolved_at' - 'resolution') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists fin_review_items_guard on public.fin_review_items;
create trigger fin_review_items_guard before update or delete on public.fin_review_items for each row execute function public.fin_review_items_guard();

create or replace function public.fin_review_add(p_book_id uuid, p_kind text, p_entity_type text, p_entity_id uuid, p_job_id uuid, p_details jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into public.fin_review_items (book_id, kind, entity_type, entity_id, job_id, details)
  values (p_book_id, p_kind, p_entity_type, p_entity_id, p_job_id, p_details) on conflict do nothing
$$;
-- Closes open items that no longer apply (e.g. a cost code was filled in).
create or replace function public.fin_review_autoresolve(p_kind text, p_entity_type text, p_entity_id uuid, p_resolution text) returns void
language sql security definer set search_path = public as $$
  update public.fin_review_items set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution = p_resolution
   where kind = p_kind and entity_type = p_entity_type and entity_id = p_entity_id and status = 'open'
$$;
revoke execute on function public.fin_review_add(uuid, text, text, uuid, uuid, jsonb), public.fin_review_autoresolve(text, text, uuid, text) from public, anon, authenticated;

-- Commitment helpers (derived).
create or replace function public.fin_commitment_current(p_commitment_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select c.original_amount + coalesce((select sum(delta) from public.fin_commitment_revisions r where r.commitment_id = c.id), 0)
    from public.fin_commitments c where c.id = p_commitment_id
$$;
create or replace function public.fin_commitment_billed(p_commitment_id uuid, p_include_pending boolean default false) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.amount), 0) from public.fin_vendor_bill_lines l join public.fin_vendor_bills b on b.id = l.bill_id
   where l.commitment_id = p_commitment_id and (b.status = 'approved' or (p_include_pending and b.status = 'pending_approval'))
$$;
revoke execute on function public.fin_commitment_current(uuid), public.fin_commitment_billed(uuid, boolean) from public, anon, authenticated;

create or replace function public.fin_commitment_overrun_check(p_commitment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.fin_commitments; v_cur numeric; v_billed numeric;
begin
  select * into c from public.fin_commitments where id = p_commitment_id;
  v_cur := public.fin_commitment_current(c.id); v_billed := public.fin_commitment_billed(c.id, true);
  if v_billed > v_cur then
    perform public.fin_review_add(c.book_id, 'commitment_overrun', 'commitment', c.id, c.job_id,
      jsonb_build_object('commitment', v_cur::text, 'billed', v_billed::text));
  else
    perform public.fin_review_autoresolve('commitment_overrun', 'commitment', c.id, 'Within commitment');
  end if;
end $$;
revoke execute on function public.fin_commitment_overrun_check(uuid) from public, anon, authenticated;

-- 8. Cost RPCs -----------------------------------------------------------------------------------------------------
-- p {jobId, vendorId, costCodeId, title, kind?, amount, quoteId?}
create or replace function public.fin_commitment_create(p_book_id uuid, p jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prior jsonb; n record; c public.fin_commitments; v_amount numeric := (p ->> 'amount')::numeric;
begin
  perform public.fin_require(p_book_id, 'record_bills', true);
  v_prior := public.fin_idem_begin(p_book_id, p_idempotency_key, 'commitment.create');
  if v_prior is not null then return v_prior; end if;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  if not exists (select 1 from public.fin_jobs where id = (p ->> 'jobId')::uuid and book_id = p_book_id)
     or not exists (select 1 from public.fin_vendors where id = (p ->> 'vendorId')::uuid and book_id = p_book_id)
     or not exists (select 1 from public.fin_cost_codes where id = (p ->> 'costCodeId')::uuid and book_id = p_book_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into n from public.fin_next_number(p_book_id, 'commitment');
  insert into public.fin_commitments (book_id, job_id, vendor_id, cost_code_id, seq, number, title, kind, original_amount, quote_id, created_by)
  values (p_book_id, (p ->> 'jobId')::uuid, (p ->> 'vendorId')::uuid, (p ->> 'costCodeId')::uuid, n.seq, n.label,
          left(coalesce(nullif(btrim(p ->> 'title'), ''), 'Commitment ' || n.label), 300), coalesce(nullif(p ->> 'kind', ''), 'subcontract'),
          v_amount, nullif(p ->> 'quoteId', '')::uuid, auth.uid())
  returning * into c;
  perform public.fin_audit(p_book_id, 'commitment.created', 'commitment', c.id, jsonb_build_object('number', c.number, 'amount', v_amount::text));
  return public.fin_idem_finish(p_book_id, p_idempotency_key, jsonb_build_object('commitmentId', c.id, 'number', c.number));
end $$;

create or replace function public.fin_commitment_revise(p_commitment_id uuid, p_delta numeric, p_reason text, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.fin_commitments; v_prior jsonb; v_no integer;
begin
  select * into c from public.fin_commitments where id = p_commitment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(c.book_id, 'record_bills', true);
  v_prior := public.fin_idem_begin(c.book_id, p_idempotency_key, 'commitment.revise');
  if v_prior is not null then return v_prior; end if;
  if c.status <> 'open' then raise exception 'bad_state' using errcode = '22023'; end if;
  if p_delta is null or p_delta = 0 or p_delta <> round(p_delta, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  if public.fin_commitment_current(c.id) + p_delta < 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  select coalesce(max(revision_no), 0) + 1 into v_no from public.fin_commitment_revisions where commitment_id = c.id;
  insert into public.fin_commitment_revisions (book_id, commitment_id, revision_no, delta, reason, created_by)
  values (c.book_id, c.id, v_no, p_delta, left(coalesce(nullif(btrim(p_reason), ''), 'Revision'), 500), auth.uid());
  perform public.fin_commitment_overrun_check(c.id);
  perform public.fin_audit(c.book_id, 'commitment.revised', 'commitment', c.id, jsonb_build_object('delta', p_delta::text, 'revision', v_no));
  return public.fin_idem_finish(c.book_id, p_idempotency_key, jsonb_build_object('commitmentId', c.id, 'revision', v_no, 'current', public.fin_commitment_current(c.id)::text));
end $$;

create or replace function public.fin_commitment_set_status(p_commitment_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.fin_commitments;
begin
  select * into c from public.fin_commitments where id = p_commitment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(c.book_id, 'record_bills', true);
  if p_status not in ('open', 'closed', 'void') or c.status = 'void' then raise exception 'bad_state' using errcode = '22023'; end if;
  if p_status = 'void' and public.fin_commitment_billed(c.id, true) <> 0 then raise exception 'has_bills' using errcode = '22023'; end if;
  update public.fin_commitments set status = p_status, closed_at = case when p_status = 'closed' then now() end,
    voided_at = case when p_status = 'void' then now() end, voided_by = case when p_status = 'void' then auth.uid() end where id = c.id;
  perform public.fin_audit(c.book_id, 'commitment.' || p_status, 'commitment', c.id, null);
end $$;

-- p {vendorId, vendorInvoiceNumber, billDate, dueDate?, memo?, documentId?, lines: [{jobId?, costCodeId?, commitmentId?, description, amount}]}
create or replace function public.fin_bill_record(p_book_id uuid, p jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prior jsonb; n record; b public.fin_vendor_bills; l jsonb; v_no integer := 0; v_total numeric; v_job uuid; v_code uuid; v_commit uuid;
        cm public.fin_commitments; v_line uuid;
begin
  perform public.fin_require(p_book_id, 'record_bills', true);
  v_prior := public.fin_idem_begin(p_book_id, p_idempotency_key, 'bill.record');
  if v_prior is not null then return v_prior; end if;
  if not exists (select 1 from public.fin_vendors where id = (p ->> 'vendorId')::uuid and book_id = p_book_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') not between 1 and 200 then raise exception 'bad_lines' using errcode = '22023'; end if;
  select sum((x ->> 'amount')::numeric) into v_total from jsonb_array_elements(p -> 'lines') x;
  if v_total is null or v_total <= 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  if exists (select 1 from public.fin_vendor_bills where book_id = p_book_id and vendor_id = (p ->> 'vendorId')::uuid
             and lower(btrim(vendor_invoice_number)) = lower(btrim(p ->> 'vendorInvoiceNumber')) and status <> 'void') then
    raise exception 'duplicate_bill' using errcode = '23505';
  end if;
  if nullif(p ->> 'documentId', '') is not null and not exists (select 1 from public.fin_documents where id = (p ->> 'documentId')::uuid and book_id = p_book_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Lock referenced commitments in id order (bills relieving the same commitment serialize).
  perform 1 from public.fin_commitments where id in (select nullif(x ->> 'commitmentId', '')::uuid from jsonb_array_elements(p -> 'lines') x) order by id for update;
  select * into n from public.fin_next_number(p_book_id, 'bill');
  insert into public.fin_vendor_bills (book_id, vendor_id, vendor_invoice_number, seq, number, bill_date, due_date, total, memo, document_id, created_by)
  values (p_book_id, (p ->> 'vendorId')::uuid, left(btrim(p ->> 'vendorInvoiceNumber'), 80), n.seq, n.label,
          coalesce(nullif(p ->> 'billDate', '')::date, current_date),
          coalesce(nullif(p ->> 'dueDate', '')::date, coalesce(nullif(p ->> 'billDate', '')::date, current_date)),
          v_total, nullif(left(p ->> 'memo', 1000), ''), nullif(p ->> 'documentId', '')::uuid, auth.uid())
  returning * into b;
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    v_no := v_no + 1;
    v_job := nullif(l ->> 'jobId', '')::uuid; v_code := nullif(l ->> 'costCodeId', '')::uuid; v_commit := nullif(l ->> 'commitmentId', '')::uuid;
    if (l ->> 'amount')::numeric <> round((l ->> 'amount')::numeric, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
    if v_commit is not null then
      select * into cm from public.fin_commitments where id = v_commit and book_id = p_book_id;
      if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
      if cm.status = 'void' or cm.vendor_id <> b.vendor_id then raise exception 'bad_commitment' using errcode = '22023'; end if;
      v_job := coalesce(v_job, cm.job_id); v_code := coalesce(v_code, cm.cost_code_id);
      if v_job <> cm.job_id then raise exception 'bad_commitment' using errcode = '22023'; end if;
    end if;
    if v_job is not null and not exists (select 1 from public.fin_jobs where id = v_job and book_id = p_book_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
    if v_code is not null and not exists (select 1 from public.fin_cost_codes where id = v_code and book_id = p_book_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
    insert into public.fin_vendor_bill_lines (book_id, bill_id, line_no, job_id, cost_code_id, commitment_id, description, amount)
    values (p_book_id, b.id, v_no, v_job, v_code, v_commit, left(coalesce(nullif(btrim(l ->> 'description'), ''), 'Line ' || v_no), 500), (l ->> 'amount')::numeric)
    returning id into v_line;
    if v_job is not null and v_code is null then
      perform public.fin_review_add(p_book_id, 'uncoded_cost', 'bill_line', v_line, v_job, jsonb_build_object('billId', b.id, 'amount', (l ->> 'amount')));
    end if;
  end loop;
  perform public.fin_commitment_overrun_check(x.id) from (select distinct commitment_id as id from public.fin_vendor_bill_lines where bill_id = b.id and commitment_id is not null) x;
  perform public.fin_audit(p_book_id, 'bill.recorded', 'bill', b.id, jsonb_build_object('number', b.number, 'total', v_total::text));
  return public.fin_idem_finish(p_book_id, p_idempotency_key, jsonb_build_object('billId', b.id, 'number', b.number, 'total', v_total::text));
end $$;

create or replace function public.fin_bill_approve(p_bill_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.fin_vendor_bills;
begin
  select * into b from public.fin_vendor_bills where id = p_bill_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(b.book_id, 'approve_vendor_bills', true);
  if b.status = 'approved' then return; end if;
  if b.status <> 'pending_approval' then raise exception 'bad_state' using errcode = '22023'; end if;
  update public.fin_vendor_bills set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = b.id;
  perform public.fin_audit(b.book_id, 'bill.approved', 'bill', b.id, null);
end $$;

create or replace function public.fin_bill_void(p_bill_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.fin_vendor_bills;
begin
  select * into b from public.fin_vendor_bills where id = p_bill_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(b.book_id, 'approve_vendor_bills', true);
  if b.status = 'void' then return; end if;
  perform 1 from public.fin_commitments where id in (select commitment_id from public.fin_vendor_bill_lines where bill_id = b.id) order by id for update;
  update public.fin_vendor_bills set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Voided'), 500) where id = b.id;
  perform public.fin_review_autoresolve('uncoded_cost', 'bill_line', l.id, 'Bill voided') from public.fin_vendor_bill_lines l where l.bill_id = b.id;
  perform public.fin_commitment_overrun_check(x.id) from (select distinct commitment_id as id from public.fin_vendor_bill_lines where bill_id = b.id and commitment_id is not null) x;
  perform public.fin_audit(b.book_id, 'bill.voided', 'bill', b.id, jsonb_build_object('reason', p_reason));
end $$;

-- p {jobId?, vendorId?, payee?, costCodeId?, spentOn, amount, method?, description, receiptDocumentId?}
create or replace function public.fin_expense_record(p_book_id uuid, p jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prior jsonb; n record; x public.fin_expenses; v_amount numeric := (p ->> 'amount')::numeric;
begin
  perform public.fin_require(p_book_id, 'record_expenses', true);
  v_prior := public.fin_idem_begin(p_book_id, p_idempotency_key, 'expense.record');
  if v_prior is not null then return v_prior; end if;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  if (nullif(p ->> 'jobId', '') is not null and not exists (select 1 from public.fin_jobs where id = (p ->> 'jobId')::uuid and book_id = p_book_id))
     or (nullif(p ->> 'vendorId', '') is not null and not exists (select 1 from public.fin_vendors where id = (p ->> 'vendorId')::uuid and book_id = p_book_id))
     or (nullif(p ->> 'costCodeId', '') is not null and not exists (select 1 from public.fin_cost_codes where id = (p ->> 'costCodeId')::uuid and book_id = p_book_id))
     or (nullif(p ->> 'receiptDocumentId', '') is not null and not exists (select 1 from public.fin_documents where id = (p ->> 'receiptDocumentId')::uuid and book_id = p_book_id)) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into n from public.fin_next_number(p_book_id, 'expense');
  insert into public.fin_expenses (book_id, seq, number, job_id, vendor_id, payee, cost_code_id, spent_on, amount, method, description, receipt_document_id, created_by)
  values (p_book_id, n.seq, n.label, nullif(p ->> 'jobId', '')::uuid, nullif(p ->> 'vendorId', '')::uuid, nullif(left(p ->> 'payee', 200), ''),
          nullif(p ->> 'costCodeId', '')::uuid, coalesce(nullif(p ->> 'spentOn', '')::date, current_date), v_amount, coalesce(nullif(p ->> 'method', ''), 'card'),
          left(coalesce(nullif(btrim(p ->> 'description'), ''), 'Expense'), 500), nullif(p ->> 'receiptDocumentId', '')::uuid, auth.uid())
  returning * into x;
  if x.job_id is not null and x.cost_code_id is null then perform public.fin_review_add(p_book_id, 'uncoded_cost', 'expense', x.id, x.job_id, jsonb_build_object('amount', x.amount::text)); end if;
  if x.receipt_document_id is null then perform public.fin_review_add(p_book_id, 'missing_receipt', 'expense', x.id, x.job_id, jsonb_build_object('amount', x.amount::text)); end if;
  perform public.fin_audit(p_book_id, 'expense.recorded', 'expense', x.id, jsonb_build_object('number', x.number, 'amount', x.amount::text));
  return public.fin_idem_finish(p_book_id, p_idempotency_key, jsonb_build_object('expenseId', x.id, 'number', x.number));
end $$;

-- approve / reject (approve_expenses) or void (record_expenses, pending only; approve_expenses otherwise).
create or replace function public.fin_expense_decide(p_expense_id uuid, p_action text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare x public.fin_expenses;
begin
  select * into x from public.fin_expenses where id = p_expense_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_action = 'void' and x.status = 'pending' and x.created_by = auth.uid() then
    perform public.fin_require(x.book_id, 'record_expenses', true);
  else
    perform public.fin_require(x.book_id, 'approve_expenses', true);
  end if;
  if p_action = 'approve' and x.status = 'pending' then
    update public.fin_expenses set status = 'approved', approved_at = now(), approved_by = auth.uid(), decision_note = nullif(left(p_note, 500), '') where id = x.id;
  elsif p_action = 'reject' and x.status = 'pending' then
    update public.fin_expenses set status = 'rejected', approved_by = auth.uid(), decision_note = nullif(left(p_note, 500), '') where id = x.id;
  elsif p_action = 'void' and x.status <> 'void' then
    update public.fin_expenses set status = 'void', voided_at = now(), decision_note = coalesce(nullif(left(p_note, 500), ''), decision_note) where id = x.id;
  else
    raise exception 'bad_state' using errcode = '22023';
  end if;
  if p_action in ('reject', 'void') then
    perform public.fin_review_autoresolve(k, 'expense', x.id, 'Expense ' || p_action || 'ed') from unnest(array['uncoded_cost', 'missing_receipt']) k;
  end if;
  perform public.fin_audit(x.book_id, 'expense.' || p_action, 'expense', x.id, jsonb_build_object('note', p_note));
  return (select status from public.fin_expenses where id = x.id);
end $$;

-- Fill in a missing cost code (bill line or expense) or receipt (expense) once; resolves the review item.
create or replace function public.fin_cost_fill(p_entity_type text, p_entity_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_book uuid; v_code uuid := nullif(p ->> 'costCodeId', '')::uuid; v_doc uuid := nullif(p ->> 'receiptDocumentId', '')::uuid;
begin
  if p_entity_type = 'bill_line' then
    select book_id into v_book from public.fin_vendor_bill_lines where id = p_entity_id;
    if v_book is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    perform public.fin_require(v_book, 'record_bills', true);
  elsif p_entity_type = 'expense' then
    select book_id into v_book from public.fin_expenses where id = p_entity_id;
    if v_book is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    perform public.fin_require(v_book, 'record_expenses', true);
  else
    raise exception 'bad_entity' using errcode = '22023';
  end if;
  if v_code is not null then
    if not exists (select 1 from public.fin_cost_codes where id = v_code and book_id = v_book) then raise exception 'not_found' using errcode = 'P0002'; end if;
    if p_entity_type = 'bill_line' then
      update public.fin_vendor_bill_lines set cost_code_id = v_code where id = p_entity_id and cost_code_id is null;
    else
      update public.fin_expenses set cost_code_id = v_code where id = p_entity_id and cost_code_id is null;
    end if;
    if not found then raise exception 'already_set' using errcode = '22023'; end if;
    perform public.fin_review_autoresolve('uncoded_cost', p_entity_type, p_entity_id, 'Cost code assigned');
  end if;
  if v_doc is not null and p_entity_type = 'expense' then
    if not exists (select 1 from public.fin_documents where id = v_doc and book_id = v_book) then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public.fin_expenses set receipt_document_id = v_doc where id = p_entity_id and receipt_document_id is null;
    if not found then raise exception 'already_set' using errcode = '22023'; end if;
    perform public.fin_review_autoresolve('missing_receipt', 'expense', p_entity_id, 'Receipt attached');
  end if;
  perform public.fin_audit(v_book, 'cost.filled', p_entity_type, p_entity_id, p);
end $$;

create or replace function public.fin_review_resolve(p_item_id uuid, p_status text, p_resolution text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.fin_review_items;
begin
  select * into r from public.fin_review_items where id = p_item_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not (public.fin_has_permission(r.book_id, 'approve_expenses', true) or public.fin_has_permission(r.book_id, 'approve_vendor_bills', true)) then
    perform public.fin_require(r.book_id, 'approve_vendor_bills', true);
  end if;
  if p_status not in ('resolved', 'dismissed') then raise exception 'bad_status' using errcode = '22023'; end if;
  if r.status <> 'open' then return; end if;
  update public.fin_review_items set status = p_status, resolved_at = now(), resolved_by = auth.uid(), resolution = nullif(left(p_resolution, 500), '') where id = r.id;
  perform public.fin_audit(r.book_id, 'review.' || p_status, r.entity_type, r.entity_id, jsonb_build_object('kind', r.kind));
end $$;

-- 9. Views: actual / committed / estimated ---------------------------------------------------------------------------
-- Actual costs only (approved bills + approved expenses).
create or replace view public.fin_job_costs_v with (security_invoker = true) as
select 'bill_line'::text as source, l.id as source_id, l.book_id, l.job_id, l.cost_code_id, l.commitment_id, b.bill_date as cost_date, l.amount, b.vendor_id, l.description
  from public.fin_vendor_bill_lines l join public.fin_vendor_bills b on b.id = l.bill_id
 where b.status = 'approved' and l.job_id is not null
union all
select 'expense', x.id, x.book_id, x.job_id, x.cost_code_id, null, x.spent_on, x.amount, x.vendor_id, x.description
  from public.fin_expenses x where x.status = 'approved' and x.job_id is not null;

create or replace view public.fin_commitment_balances_v with (security_invoker = true) as
select c.id as commitment_id, c.book_id, c.job_id, c.vendor_id, c.cost_code_id, c.number, c.title, c.status, c.original_amount,
       c.original_amount + coalesce(r.revisions, 0) as current_amount,
       coalesce(bl.billed, 0) as billed,
       coalesce(bl.pending, 0) as pending_billed,
       case when c.status = 'open' then greatest(c.original_amount + coalesce(r.revisions, 0) - coalesce(bl.billed, 0), 0) else 0 end as open_committed
  from public.fin_commitments c
  left join lateral (select sum(delta) as revisions from public.fin_commitment_revisions x where x.commitment_id = c.id) r on true
  left join lateral (select sum(l.amount) filter (where b.status = 'approved') as billed, sum(l.amount) filter (where b.status = 'pending_approval') as pending
                       from public.fin_vendor_bill_lines l join public.fin_vendor_bills b on b.id = l.bill_id where l.commitment_id = c.id) bl on true
 where c.status <> 'void';

-- Per job x cost code: estimated (budget), committed (open, not yet billed), actual.
create or replace view public.fin_job_budget_v with (security_invoker = true) as
with keys as (
  select job_id, cost_code_id from public.fin_budget_lines
  union select job_id, cost_code_id from public.fin_commitments where status <> 'void'
  union select job_id, cost_code_id from public.fin_job_costs_v)
select k.job_id, j.book_id, k.cost_code_id, cc.code, cc.name as cost_code_name, cc.trade_slug, cc.cost_type,
       coalesce((select sum(amount) from public.fin_budget_lines b where b.job_id = k.job_id and b.cost_code_id is not distinct from k.cost_code_id), 0) as estimated,
       coalesce((select sum(open_committed) from public.fin_commitment_balances_v c where c.job_id = k.job_id and c.cost_code_id is not distinct from k.cost_code_id), 0) as committed,
       coalesce((select sum(amount) from public.fin_job_costs_v a where a.job_id = k.job_id and a.cost_code_id is not distinct from k.cost_code_id), 0) as actual
  from keys k join public.fin_jobs j on j.id = k.job_id
  left join public.fin_cost_codes cc on cc.id = k.cost_code_id;

create or replace view public.fin_job_profitability_v with (security_invoker = true) as
select c.job_id, c.book_id, c.job_number, c.name, c.status,
       c.current_contract as contract_value,              -- estimated revenue (signed contract + approved changes)
       c.invoiced as invoiced_revenue,                    -- actual billed
       coalesce(b.estimated, 0) as estimated_cost,        -- frozen budget from the contract version
       coalesce(b.committed, 0) as committed_cost,        -- open commitments not yet billed
       coalesce(b.actual, 0) as actual_cost,              -- approved bills + approved expenses
       coalesce(b.actual, 0) + coalesce(b.committed, 0) as committed_plus_actual,
       c.current_contract - coalesce(b.estimated, 0) as estimated_profit,
       c.current_contract - greatest(coalesce(b.estimated, 0), coalesce(b.actual, 0) + coalesce(b.committed, 0)) as projected_profit,
       c.invoiced - coalesce(b.actual, 0) as actual_profit_to_date,
       c.pending_changes
  from public.fin_job_contract_v c
  left join lateral (select sum(estimated) as estimated, sum(committed) as committed, sum(actual) as actual from public.fin_job_budget_v x where x.job_id = c.job_id) b on true;

-- 10. Grants + read-only RLS ------------------------------------------------------------------------------------------
revoke execute on function public.fin_cost_code_save(uuid, jsonb), public.fin_vendor_save(uuid, jsonb), public.fin_commitment_create(uuid, jsonb, text),
  public.fin_commitment_revise(uuid, numeric, text, text), public.fin_commitment_set_status(uuid, text), public.fin_bill_record(uuid, jsonb, text),
  public.fin_bill_approve(uuid), public.fin_bill_void(uuid, text), public.fin_expense_record(uuid, jsonb, text), public.fin_expense_decide(uuid, text, text),
  public.fin_cost_fill(text, uuid, jsonb), public.fin_review_resolve(uuid, text, text) from public, anon;
grant execute on function public.fin_cost_code_save(uuid, jsonb), public.fin_vendor_save(uuid, jsonb), public.fin_commitment_create(uuid, jsonb, text),
  public.fin_commitment_revise(uuid, numeric, text, text), public.fin_commitment_set_status(uuid, text), public.fin_bill_record(uuid, jsonb, text),
  public.fin_bill_approve(uuid), public.fin_bill_void(uuid, text), public.fin_expense_record(uuid, jsonb, text), public.fin_expense_decide(uuid, text, text),
  public.fin_cost_fill(text, uuid, jsonb), public.fin_review_resolve(uuid, text, text) to authenticated;

alter table public.fin_cost_codes enable row level security;
alter table public.fin_budget_lines enable row level security;
alter table public.fin_vendors enable row level security;
alter table public.fin_commitments enable row level security;
alter table public.fin_commitment_revisions enable row level security;
alter table public.fin_vendor_bills enable row level security;
alter table public.fin_vendor_bill_lines enable row level security;
alter table public.fin_expenses enable row level security;
alter table public.fin_review_items enable row level security;

drop policy if exists fin_cost_codes_select on public.fin_cost_codes;
create policy fin_cost_codes_select on public.fin_cost_codes for select to authenticated using (public.fin_can_view_book(book_id));
drop policy if exists fin_vendors_select on public.fin_vendors;
create policy fin_vendors_select on public.fin_vendors for select to authenticated using (public.fin_can_view_book(book_id));
drop policy if exists fin_budget_lines_select on public.fin_budget_lines;
create policy fin_budget_lines_select on public.fin_budget_lines for select to authenticated using (public.fin_job_visible(job_id));
drop policy if exists fin_commitments_select on public.fin_commitments;
create policy fin_commitments_select on public.fin_commitments for select to authenticated using (public.fin_job_visible(job_id));
drop policy if exists fin_commitment_revisions_select on public.fin_commitment_revisions;
create policy fin_commitment_revisions_select on public.fin_commitment_revisions for select to authenticated
  using (exists (select 1 from public.fin_commitments c where c.id = commitment_id and public.fin_job_visible(c.job_id)));
drop policy if exists fin_vendor_bills_select on public.fin_vendor_bills;
create policy fin_vendor_bills_select on public.fin_vendor_bills for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials')
         or exists (select 1 from public.fin_vendor_bill_lines l where l.bill_id = id and l.job_id is not null and public.fin_job_visible(l.job_id)));
drop policy if exists fin_vendor_bill_lines_select on public.fin_vendor_bill_lines;
create policy fin_vendor_bill_lines_select on public.fin_vendor_bill_lines for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials') or (job_id is not null and public.fin_job_visible(job_id)));
drop policy if exists fin_expenses_select on public.fin_expenses;
create policy fin_expenses_select on public.fin_expenses for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials') or (job_id is not null and public.fin_job_visible(job_id))
         or (created_by = auth.uid() and public.fin_can_view_book(book_id)));
drop policy if exists fin_review_items_select on public.fin_review_items;
create policy fin_review_items_select on public.fin_review_items for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials') or (job_id is not null and public.fin_job_visible(job_id)));

revoke all on public.fin_cost_codes, public.fin_budget_lines, public.fin_vendors, public.fin_commitments, public.fin_commitment_revisions,
  public.fin_vendor_bills, public.fin_vendor_bill_lines, public.fin_expenses, public.fin_review_items, public.fin_job_costs_v,
  public.fin_commitment_balances_v, public.fin_job_budget_v, public.fin_job_profitability_v from anon, authenticated;
grant select on public.fin_cost_codes, public.fin_budget_lines, public.fin_vendors, public.fin_commitments, public.fin_commitment_revisions,
  public.fin_vendor_bills, public.fin_vendor_bill_lines, public.fin_expenses, public.fin_review_items, public.fin_job_costs_v,
  public.fin_commitment_balances_v, public.fin_job_budget_v, public.fin_job_profitability_v to authenticated;
revoke execute on function public.fin_cost_types(), public.fin_cost_type_label(text) from public, anon;
grant execute on function public.fin_cost_types(), public.fin_cost_type_label(text) to authenticated;
