-- V8.6: "Generate My Price Library" — AI-drafted Saved Items and Saved Stacks with a review step.
--
-- What this adds (nothing existing is renamed, removed or rewritten):
--   1. library_drafts: one generation session (what the contractor typed, trades, status). Owned by
--      the contractor who ran it, tagged with their company for reporting. Survives refreshes and
--      sign-outs; nothing in it is a Saved Item yet.
--   2. library_draft_items: candidate items. NO price ever comes from the AI: unit_cost starts empty
--      unless it was copied from the contractor's own Saved Items / supplier price list, and every
--      cost keeps its source. Historical estimate costs are only a suggestion until the contractor
--      accepts them.
--   3. library_draft_stacks: candidate Saved Stacks (scaling assemblies). Reviewed and saved on their
--      own; approving the items never approves a stack.
--   4. library_draft_approvals: one row per approval request key, so a double-click or a retry can't
--      insert twice. library_draft_approve() is the only write path into saved_items / assemblies from
--      a draft; it runs in one transaction (all or nothing).
--   5. saved_items.source_draft_id: which draft an approved item came from (null for everything else).
--   6. price_records.draft_id + action 'merged': audit history when an approved draft updates an
--      existing Saved Item's price (the previous price is kept, like supplier imports).
--   7. ai_generations.kind gains 'library_generate' so generations count toward the daily limit, the
--      monthly AI budget and the admin cost report.
--
-- Plan rules are unchanged: Saved Items for every plan (free cap 250 still enforced by its trigger),
-- Saved Stacks need Unlimited (library_access()), company templates need manage_company_pricing.
-- Estimates copy values from saved items, so nothing here can change an existing estimate or proposal.
-- Safe to run more than once. Rollback: docs/library-generator/rollback_20270115001000.sql

-- ---------------------------------------------------------------------------
-- 1. Drafts
-- ---------------------------------------------------------------------------
create table if not exists public.library_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  prompt text not null default '' check (char_length(prompt) <= 4000),
  trades text[] not null default '{}' check (cardinality(trades) <= 6),
  mode text not null default 'catalog' check (mode in ('catalog', 'scope')),
  source_estimate_id uuid references public.estimates (id) on delete set null,
  status text not null default 'generating'
    check (status in ('generating', 'draft', 'under_review', 'partially_approved', 'approved', 'archived', 'failed')),
  generator_version text not null default 'library-gen-v1' check (char_length(generator_version) <= 40),
  input_hash text check (char_length(input_hash) <= 80),
  notes text[] not null default '{}',
  last_error text check (char_length(last_error) <= 300),
  generation_count int not null default 0,
  approved_items int not null default 0,
  approved_stacks int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists library_drafts_user_idx on public.library_drafts (user_id, updated_at desc);
create index if not exists library_drafts_hash_idx on public.library_drafts (user_id, input_hash) where input_hash is not null;

-- ---------------------------------------------------------------------------
-- 2. Candidate items
-- ---------------------------------------------------------------------------
create table if not exists public.library_draft_items (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.library_drafts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 300),
  description text check (char_length(description) <= 4000),
  trade text check (char_length(trade) <= 60),
  category text not null default 'General' check (char_length(category) between 1 and 120),
  cost_type text not null default 'material'
    check (cost_type in ('material', 'labor', 'labor_material', 'equipment', 'subcontractor', 'permit', 'delivery', 'other')),
  unit text not null check (char_length(unit) between 1 and 40),
  -- Blank means "Cost not set". Only the contractor (or a copy of their own saved price) fills it.
  unit_cost numeric(14, 4) check (unit_cost is null or (unit_cost >= 0 and unit_cost <= 10000000)),
  cost_source text not null default 'none'
    check (cost_source in ('none', 'contractor', 'saved_item', 'supplier_import', 'history')),
  cost_source_note text check (char_length(cost_source_note) <= 300),
  -- A comparable past cost from the contractor's own estimates, shown as a suggestion only.
  suggested_cost numeric(14, 4) check (suggested_cost is null or suggested_cost >= 0),
  suggested_note text check (char_length(suggested_note) <= 300),
  supplier_sku text check (char_length(supplier_sku) <= 80),
  notes text check (char_length(notes) <= 1000),
  conditions text[] not null default '{}' check (cardinality(conditions) <= 8),
  optional boolean not null default false,
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  verify_note text check (char_length(verify_note) <= 300),
  taxable boolean not null default true,
  status text not null default 'candidate'
    check (status in ('candidate', 'approved', 'template', 'matched', 'merged', 'updated', 'removed')),
  -- Duplicate detection against the contractor's Saved Items (deterministic, not AI).
  duplicate_of uuid references public.saved_items (id) on delete set null,
  duplicate_level text check (duplicate_level in ('exact', 'possible')),
  duplicate_reason text check (char_length(duplicate_reason) <= 200),
  duplicate_action text check (duplicate_action in ('keep_existing', 'add_separate', 'update_existing', 'merge')),
  saved_item_id uuid references public.saved_items (id) on delete set null,
  batch int not null default 1,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists library_draft_items_draft_idx on public.library_draft_items (draft_id, sort_order);
create index if not exists library_draft_items_user_idx on public.library_draft_items (user_id);

-- ---------------------------------------------------------------------------
-- 3. Candidate stacks
-- ---------------------------------------------------------------------------
-- components: [{ itemId (library_draft_items.id), per?, quantity?, wastePct?, roundUp?, optional?, note? }]
create table if not exists public.library_draft_stacks (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.library_drafts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  trade text check (char_length(trade) <= 60),
  scale_unit text check (scale_unit in ('square', 'square foot', 'square yard', 'linear foot', 'cubic yard', 'each')),
  scale_label text check (char_length(scale_label) <= 120),
  scale_calc text check (char_length(scale_calc) <= 40),
  assumptions text[] not null default '{}' check (cardinality(assumptions) <= 8),
  components jsonb not null default '[]'::jsonb check (jsonb_typeof(components) = 'array'),
  status text not null default 'candidate' check (status in ('candidate', 'approved', 'removed')),
  assembly_id uuid references public.assemblies (id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists library_draft_stacks_draft_idx on public.library_draft_stacks (draft_id, sort_order);

-- ---------------------------------------------------------------------------
-- 4. Approvals (idempotency + audit)
-- ---------------------------------------------------------------------------
create table if not exists public.library_draft_approvals (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.library_drafts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  request_key uuid not null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, request_key)
);
create index if not exists library_draft_approvals_draft_idx on public.library_draft_approvals (draft_id, created_at desc);

-- updated_at
drop trigger if exists library_drafts_updated on public.library_drafts;
create trigger library_drafts_updated before update on public.library_drafts for each row execute function public.set_updated_at();
drop trigger if exists library_draft_items_updated on public.library_draft_items;
create trigger library_draft_items_updated before update on public.library_draft_items for each row execute function public.set_updated_at();
drop trigger if exists library_draft_stacks_updated on public.library_draft_stacks;
create trigger library_draft_stacks_updated before update on public.library_draft_stacks for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: own rows only. Approval goes through library_draft_approve(), never a direct status change.
-- ---------------------------------------------------------------------------
alter table public.library_drafts enable row level security;
alter table public.library_draft_items enable row level security;
alter table public.library_draft_stacks enable row level security;
alter table public.library_draft_approvals enable row level security;

drop policy if exists library_drafts_own on public.library_drafts;
create policy library_drafts_own on public.library_drafts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists library_draft_items_own on public.library_draft_items;
create policy library_draft_items_own on public.library_draft_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.library_drafts d where d.id = draft_id and d.user_id = (select auth.uid())));
drop policy if exists library_draft_stacks_own on public.library_draft_stacks;
create policy library_draft_stacks_own on public.library_draft_stacks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.library_drafts d where d.id = draft_id and d.user_id = (select auth.uid())));
drop policy if exists library_draft_approvals_own_select on public.library_draft_approvals;
create policy library_draft_approvals_own_select on public.library_draft_approvals for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.library_drafts, public.library_draft_items, public.library_draft_stacks, public.library_draft_approvals from anon;
grant select, insert, update, delete on public.library_drafts, public.library_draft_items, public.library_draft_stacks to authenticated;
grant select on public.library_draft_approvals to authenticated;

-- Statuses that mean "already in the library" can only be set by the approval function (it sets
-- b2b.library_approve for its own transaction). A browser can't mark a candidate approved directly.
create or replace function public.library_draft_items_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('b2b.library_approve', true), '') = 'on' then return new; end if;
  if new.status in ('approved', 'template', 'matched', 'merged', 'updated')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    raise exception 'approval_required' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status in ('approved', 'template', 'matched', 'merged', 'updated') then
    raise exception 'already_approved' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then new.saved_item_id := null; elsif new.saved_item_id is distinct from old.saved_item_id then new.saved_item_id := old.saved_item_id; end if;
  return new;
end $$;
drop trigger if exists library_draft_items_guard on public.library_draft_items;
create trigger library_draft_items_guard before insert or update on public.library_draft_items
  for each row execute function public.library_draft_items_guard();

create or replace function public.library_draft_stacks_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('b2b.library_approve', true), '') = 'on' then return new; end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    raise exception 'approval_required' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then raise exception 'already_approved' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then new.assembly_id := null; elsif new.assembly_id is distinct from old.assembly_id then new.assembly_id := old.assembly_id; end if;
  return new;
end $$;
drop trigger if exists library_draft_stacks_guard on public.library_draft_stacks;
create trigger library_draft_stacks_guard before insert or update on public.library_draft_stacks
  for each row execute function public.library_draft_stacks_guard();

-- ---------------------------------------------------------------------------
-- 5/6. Provenance on saved items, audit on price changes
-- ---------------------------------------------------------------------------
alter table public.saved_items add column if not exists source_draft_id uuid references public.library_drafts (id) on delete set null;
do $$ begin
  if to_regclass('public.price_records') is not null then
    alter table public.price_records add column if not exists draft_id uuid references public.library_drafts (id) on delete set null;
    alter table public.price_records drop constraint if exists price_records_action_check;
    alter table public.price_records add constraint price_records_action_check check (action in ('created', 'updated', 'unchanged', 'merged'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. AI generation log kind
-- ---------------------------------------------------------------------------
do $$
declare d text; vals text[];
begin
  if to_regclass('public.ai_generations') is null then return; end if;
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'ai_generations_kind_check' and conrelid = 'public.ai_generations'::regclass;
  if d is null or d like '%library_generate%' then return; end if;
  if d ~ '''\{[a-z_,]*\}''' then
    vals := string_to_array((regexp_match(d, '''\{([a-z_,]*)\}'''))[1], ',');
  else
    select array_agg(m[1]) into vals from regexp_matches(d, '''([a-z_]+)''', 'g') as m;
  end if;
  if vals is null or cardinality(vals) = 0 then return; end if;
  vals := vals || array['library_generate'];
  alter table public.ai_generations drop constraint ai_generations_kind_check;
  execute format('alter table public.ai_generations add constraint ai_generations_kind_check check (kind = any (%L::text[]))', vals);
end $$;

-- ---------------------------------------------------------------------------
-- Approve: the only path from a draft into saved_items / assemblies. One transaction.
-- ---------------------------------------------------------------------------
-- p = { draftId, requestKey, itemIds: uuid[], stackIds: uuid[], templates: bool, shareStacks: bool }
--   * Priced candidates are saved. Unpriced ones are saved only when templates = true, and then as
--     "Unpriced Template" (status 'template', unit_cost null). Otherwise they stay in the draft.
--   * A candidate flagged as a duplicate needs a duplicate_action, or the whole call is refused.
--     keep_existing  -> nothing written; the candidate is linked to the existing item ('matched').
--     add_separate   -> a new Saved Item.
--     update_existing-> the existing item's price/unit/details are replaced; the old price is kept in
--                       price_records. Needs a price.
--     merge          -> only empty fields of the existing item are filled; an existing price is never
--                       replaced.
--   * Stacks need Unlimited and are saved only when listed in stackIds (never implied by items).
create or replace function public.library_draft_approve(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d public.library_drafts%rowtype;
  rk uuid;
  prior jsonb;
  c public.library_draft_items%rowtype;
  s public.library_draft_stacks%rowtype;
  ex public.saved_items%rowtype;
  new_id uuid;
  templates boolean := coalesce((p->>'templates')::boolean, false);
  share boolean := coalesce((p->>'shareStacks')::boolean, false);
  company uuid;
  comp jsonb;
  k int;
  n_new int := 0; n_tpl int := 0; n_matched int := 0; n_updated int := 0; n_merged int := 0;
  n_awaiting int := 0; n_skipped int := 0; n_stacks int := 0; remaining int;
  result jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  rk := nullif(p->>'requestKey', '')::uuid;
  if rk is null then raise exception 'request_key_required'; end if;

  select * into d from public.library_drafts where id = (p->>'draftId')::uuid and user_id = uid for update;
  if not found then raise exception 'draft_not_found'; end if;

  -- Same request again (double-click, network retry): return what the first one did.
  select a.summary into prior from public.library_draft_approvals a where a.user_id = uid and a.request_key = rk;
  if prior is not null then return prior || jsonb_build_object('replayed', true); end if;

  if d.status in ('generating', 'archived', 'failed') then raise exception 'draft_not_ready'; end if;
  if jsonb_typeof(coalesce(p->'itemIds', '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p->'stackIds', '[]'::jsonb)) <> 'array' then raise exception 'bad_request'; end if;
  if jsonb_array_length(coalesce(p->'itemIds', '[]'::jsonb)) > 1000 or jsonb_array_length(coalesce(p->'stackIds', '[]'::jsonb)) > 100 then raise exception 'too_many'; end if;

  -- Unresolved duplicates block the whole approval (the review screen resolves them first).
  if exists (
    select 1 from public.library_draft_items i
    where i.draft_id = d.id and i.status = 'candidate' and i.duplicate_of is not null and i.duplicate_action is null
      and i.id in (select (jsonb_array_elements_text(coalesce(p->'itemIds', '[]'::jsonb)))::uuid)
  ) then raise exception 'unresolved_duplicates'; end if;

  perform set_config('b2b.library_approve', 'on', true);

  for c in
    select i.* from public.library_draft_items i
    where i.draft_id = d.id and i.status = 'candidate'
      and i.id in (select (jsonb_array_elements_text(coalesce(p->'itemIds', '[]'::jsonb)))::uuid)
    order by i.sort_order
    for update
  loop
    if btrim(c.name) = '' or btrim(c.unit) = '' or btrim(c.category) = '' then n_skipped := n_skipped + 1; continue; end if;

    if c.duplicate_of is not null and c.duplicate_action = 'keep_existing' then
      update public.library_draft_items set status = 'matched', saved_item_id = c.duplicate_of where id = c.id;
      n_matched := n_matched + 1; continue;
    end if;

    if c.duplicate_of is not null and c.duplicate_action in ('update_existing', 'merge') then
      select * into ex from public.saved_items where id = c.duplicate_of and user_id = uid for update;
      if not found then n_skipped := n_skipped + 1; continue; end if;
      if c.duplicate_action = 'update_existing' then
        if c.unit_cost is null then n_awaiting := n_awaiting + 1; continue; end if;
        update public.saved_items set
          unit_cost = c.unit_cost, unit = c.unit,
          description = coalesce(nullif(btrim(c.description), ''), description),
          category = coalesce(nullif(btrim(c.category), ''), category),
          supplier_sku = coalesce(nullif(btrim(c.supplier_sku), ''), supplier_sku),
          updated_at = now()
        where id = ex.id;
        if to_regclass('public.price_records') is not null then
          insert into public.price_records (user_id, saved_item_id, action, source_kind, product_name, unit, unit_cost, previous_unit_cost, previous_source, draft_id)
          values (uid, ex.id, 'updated', 'manual', left(ex.name, 300), left(c.unit, 40), c.unit_cost, ex.unit_cost, ex.price_source, d.id);
        end if;
        update public.library_draft_items set status = 'updated', saved_item_id = ex.id where id = c.id;
        n_updated := n_updated + 1;
      else
        update public.saved_items set
          description = coalesce(nullif(btrim(description), ''), nullif(btrim(c.description), '')),
          category = coalesce(nullif(btrim(category), ''), nullif(btrim(c.category), '')),
          supplier_sku = coalesce(nullif(btrim(supplier_sku), ''), nullif(btrim(c.supplier_sku), '')),
          unit_cost = coalesce(unit_cost, c.unit_cost),
          updated_at = now()
        where id = ex.id;
        if ex.unit_cost is null and c.unit_cost is not null and to_regclass('public.price_records') is not null then
          insert into public.price_records (user_id, saved_item_id, action, source_kind, product_name, unit, unit_cost, previous_unit_cost, previous_source, draft_id)
          values (uid, ex.id, 'merged', 'manual', left(ex.name, 300), left(ex.unit, 40), c.unit_cost, null, ex.price_source, d.id);
        end if;
        update public.library_draft_items set status = 'merged', saved_item_id = ex.id where id = c.id;
        n_merged := n_merged + 1;
      end if;
      continue;
    end if;

    -- New Saved Item (no duplicate, or "add as separate item").
    if c.unit_cost is null and not templates then n_awaiting := n_awaiting + 1; continue; end if;
    insert into public.saved_items (user_id, name, description, trade, category, cost_type, treatment, unit, unit_cost, taxable, supplier_sku, source_draft_id)
    values (uid, c.name, nullif(btrim(c.description), ''), c.trade, c.category, c.cost_type, 'marked_up', c.unit, c.unit_cost, c.taxable, nullif(btrim(c.supplier_sku), ''), d.id)
    returning id into new_id;
    if c.unit_cost is null then
      update public.library_draft_items set status = 'template', saved_item_id = new_id where id = c.id;
      n_tpl := n_tpl + 1;
    else
      update public.library_draft_items set status = 'approved', saved_item_id = new_id where id = c.id;
      n_new := n_new + 1;
    end if;
  end loop;

  -- Stacks: explicit, Unlimited only.
  if jsonb_array_length(coalesce(p->'stackIds', '[]'::jsonb)) > 0 then
    if not public.library_access() then raise exception 'premium_required'; end if;
    if share then
      company := public.my_company_id();
      if company is null or not public.has_company_permission(company, 'manage_company_pricing') then raise exception 'company_template_locked'; end if;
    end if;
    for s in
      select * from public.library_draft_stacks
      where draft_id = d.id and status = 'candidate'
        and id in (select (jsonb_array_elements_text(p->'stackIds'))::uuid)
      order by sort_order
      for update
    loop
      if jsonb_array_length(s.components) = 0 then n_skipped := n_skipped + 1; continue; end if;
      new_id := gen_random_uuid();
      insert into public.assemblies (id, user_id, name, trade, scale_unit, scale_label, scale_calc, company_id)
      values (new_id, uid, s.name, s.trade, s.scale_unit, case when s.scale_unit is null then null else coalesce(s.scale_label, 'Measure') end, s.scale_calc, case when share then company end);
      k := 0;
      for comp in select * from jsonb_array_elements(s.components) loop
        select * into c from public.library_draft_items where id = (comp->>'itemId')::uuid and draft_id = d.id and status <> 'removed';
        if not found then continue; end if;
        insert into public.assembly_items (assembly_id, user_id, name, description, cost_type, treatment, quantity, unit, unit_cost, taxable, sort_order, qty_per, waste_pct, round_up)
        values (new_id, uid, c.name, nullif(btrim(c.description), ''), c.cost_type, 'marked_up',
                coalesce(nullif(comp->>'quantity', '')::numeric, 1), c.unit,
                coalesce(c.unit_cost, (select si.unit_cost from public.saved_items si where si.id = c.saved_item_id)),
                c.taxable, k,
                case when s.scale_unit is not null then nullif(comp->>'per', '')::numeric end,
                case when s.scale_unit is not null then coalesce(nullif(comp->>'wastePct', '')::numeric, 0) else 0 end,
                s.scale_unit is not null and coalesce((comp->>'roundUp')::boolean, false));
        k := k + 1;
      end loop;
      if k = 0 then raise exception 'stack_empty'; end if;
      update public.library_draft_stacks set status = 'approved', assembly_id = new_id where id = s.id;
      n_stacks := n_stacks + 1;
    end loop;
  end if;

  select count(*) into remaining from public.library_draft_items where draft_id = d.id and status = 'candidate';
  update public.library_drafts set
    status = case when remaining = 0 and not exists (select 1 from public.library_draft_stacks where draft_id = d.id and status = 'candidate') then 'approved' else 'partially_approved' end,
    approved_items = approved_items + n_new + n_tpl + n_updated + n_merged,
    approved_stacks = approved_stacks + n_stacks
  where id = d.id;

  result := jsonb_build_object(
    'created', n_new, 'templates', n_tpl, 'matched', n_matched, 'updated', n_updated, 'merged', n_merged,
    'awaitingPrice', n_awaiting, 'skipped', n_skipped, 'stacks', n_stacks, 'remaining', remaining);
  insert into public.library_draft_approvals (draft_id, user_id, request_key, summary) values (d.id, uid, rk, result);
  return result;
end $$;
revoke execute on function public.library_draft_approve(jsonb) from public, anon;
grant execute on function public.library_draft_approve(jsonb) to authenticated;
