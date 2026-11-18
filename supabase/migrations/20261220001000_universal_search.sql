-- V6.4 Universal search & command center. Requires every earlier migration (through 20261211001000).
--
-- One search across the whole app (customers, bids, projects, tasks, trade scope, change orders, signed proposals,
-- invoices, payments, bills, expenses, vendors, people / subs, suppliers, saved items, assemblies, photos, customer
-- messages). Design rules:
--   * No copies. Search reads the real tables; nothing here becomes a second source of truth.
--   * search_universal() is SECURITY INVOKER: every row comes through the table's own row-level security, so a
--     result, its count, its snippet and its related records all exist only if the caller could already open the
--     record. Nothing is fetched and then hidden in the browser.
--   * Financial records come only from the caller's current book: the real book, or the practice (sandbox) book
--     while sandbox mode is on. A sandbox search never returns real financial records and the other way round.
--   * Never returned: pay rates, TINs / EINs, bank details, payment tokens, supplier account numbers, internal
--     notes, costs or margins, subcontractor tax documents, message bodies, GPS.
--   * Relevance is deterministic and explainable (tiers: exact number > exact name > name starts with > name words >
--     other fields > related record > similar spelling); boosts (context project, intent word, recency) never lift a
--     result past the next tier.
--   * Indexed: pg_trgm GIN indexes on each table's searchable text. Because RLS keeps Postgres from using them for
--     LIKE, search_text_ids() (security definer, ids only, the caller's own records and company only) finds the
--     matching ids through the indexes first; the invoker query then reads just those rows under full RLS.
--   * Per-user history (recent searches / opened records) and preferences, own rows only. Recent records are
--     re-checked through RLS each time they're shown and dropped when access is gone.
-- Idempotent. Rollback: docs/universal-search/rollback_20261220001000.sql

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to authenticated;

-- 1. Text helpers (immutable, so they can back expression indexes) ------------------------------------------
create or replace function public.search_doc(variadic p_parts text[]) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select lower(array_to_string(p_parts, ' '))
$$;
create or replace function public.search_arr(p text[]) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select replace(array_to_string(p, ' '), '-', ' ')
$$;
create or replace function public.search_digits(p text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '')
$$;
grant execute on function public.search_doc(text[]), public.search_arr(text[]), public.search_digits(text) to authenticated;

-- 2. Trigram indexes (created against whichever schema holds pg_trgm) ----------------------------------------
do $$
declare s text := (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm');
  ix text[] := array[
    'customers_search_trgm#customers#public.search_doc(name, company_name, email, public.search_digits(phone), project_address)',
    'estimates_search_trgm#estimates#public.search_doc(title, estimate_number, customer_name, customer_email, public.search_digits(customer_phone), project_address, location_city, public.search_arr(trades))',
    'estimate_groups_search_trgm#estimate_groups#public.search_doc(name, description)',
    'estimate_items_search_trgm#estimate_items#public.search_doc(name, description)',
    'project_schedules_search_trgm#project_schedules#public.search_doc(name)',
    'schedule_tasks_search_trgm#schedule_tasks#public.search_doc(name, assignee)',
    'project_scope_sections_search_trgm#project_scope_sections#public.search_doc(title, trade, approved_scope, work_description)',
    'change_orders_search_trgm#change_orders#public.search_doc(title, description, customer_notes)',
    'signatures_search_trgm#signatures#public.search_doc(proposal_number, project_title, customer_name, signer_name, ''v'' || version_number::text)',
    'pm_resources_search_trgm#pm_resources#public.search_doc(name, contact_name, email, public.search_digits(phone), public.search_arr(trades))',
    'pm_suppliers_search_trgm#pm_suppliers#public.search_doc(name, rep_name, email, public.search_digits(phone), website, public.search_arr(trades))',
    'saved_items_search_trgm#saved_items#public.search_doc(name, description, supplier_sku, supplier_name, category, trade, unit)',
    'assemblies_search_trgm#assemblies#public.search_doc(name, description, trade, scale_label)',
    'project_photos_search_trgm#project_photos#public.search_doc(caption, public.search_arr(labels), public.search_arr(ai_labels))',
    'comm_messages_search_trgm#comm_messages#public.search_doc(subject, to_name)',
    'company_members_search_trgm#company_members#public.search_doc(display_name)'
  ];
  x text; p text[];
begin
  foreach x in array ix loop
    p := string_to_array(x, '#');
    execute format('create index if not exists %I on public.%I using gin ((%s) %I.gin_trgm_ops)', p[1], p[2], p[3], s);
  end loop;
end $$;

create index if not exists comm_messages_customer_idx on public.comm_messages (customer_id, created_at desc) where customer_id is not null;

-- 3. Per-user history and preferences --------------------------------------------------------------------------
create table if not exists public.search_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('query', 'record')),
  query       text check (char_length(query) between 1 and 100),
  record_kind text check (char_length(record_kind) <= 30),
  record_id   uuid,
  used_at     timestamptz not null default now(),
  constraint search_history_shape check (
    (kind = 'query' and query is not null and record_id is null and record_kind is null)
    or (kind = 'record' and query is null and record_id is not null and record_kind is not null))
);
create unique index if not exists search_history_one_query on public.search_history (user_id, lower(query)) where kind = 'query';
create unique index if not exists search_history_one_record on public.search_history (user_id, record_kind, record_id) where kind = 'record';
create index if not exists search_history_user_idx on public.search_history (user_id, kind, used_at desc);
alter table public.search_history enable row level security;
drop policy if exists search_history_own_select on public.search_history;
create policy search_history_own_select on public.search_history for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists search_history_own_delete on public.search_history;
create policy search_history_own_delete on public.search_history for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.search_history from anon;
grant select, delete on public.search_history to authenticated;

create table if not exists public.search_preferences (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  history_enabled  boolean not null default true,
  favorite_actions text[] not null default '{}' check (cardinality(favorite_actions) <= 20),
  default_filters  jsonb not null default '{}' check (jsonb_typeof(default_filters) = 'object' and pg_column_size(default_filters) < 2000),
  updated_at       timestamptz not null default now()
);
alter table public.search_preferences enable row level security;
drop policy if exists search_preferences_own_select on public.search_preferences;
create policy search_preferences_own_select on public.search_preferences for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.search_preferences from anon;
grant select on public.search_preferences to authenticated;

-- 4. The caller's current Financials book (never creates one; sandbox book while sandbox mode is on) ----------
create or replace function public.search_fin_book() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_live uuid; v_sb uuid;
begin
  if v_uid is null then return null; end if;
  v_company := public.my_company_id();
  if v_company is not null then
    select id into v_live from public.fin_books where company_id = v_company and sandbox_of is null;
  else
    select id into v_live from public.fin_books where owner_user_id = v_uid and sandbox_of is null;
  end if;
  if v_live is null or not public.fin_can_view_book(v_live) then return null; end if;
  select b.id into v_sb from public.fin_sandbox_mode m
    join public.fin_books b on b.sandbox_of = m.live_book_id and b.sandbox_archived_at is null
   where m.user_id = v_uid and m.live_book_id = v_live;
  return coalesce(v_sb, v_live);
end $$;
revoke execute on function public.search_fin_book() from public, anon;
grant execute on function public.search_fin_book() to authenticated;

-- 4b. Text matching through the trigram indexes ----------------------------------------------------------------
-- Row-level security stops Postgres from using an index for LIKE (LIKE isn't "leakproof"), so a search run straight
-- against the tables reads and permission-checks every row. This helper finds the matching ids through the indexes,
-- limited to the caller's own records and company, and returns ids only (never data). search_universal then reads
-- just those rows, and every table's own RLS still decides what the caller may see. Each word is its own LIKE so the
-- index narrows on all of them together ("bulk customer 4321").
create or replace function public.search_text_ids(p_kind text, p_long_pat text, p_pats text[], p_fuzzy boolean, p_long text, p_rest text[])
returns uuid[]
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
set jit = off
set pg_trgm.word_similarity_threshold = 0.35
as $$
declare
  v_uid uuid := auth.uid(); v_company uuid; v_ids uuid[];
  v_id text; v_from text; v_scope text; v_doc text; v_fuzzy_ok boolean := true; v_words text; v_rest text; v_sql text;
begin
  if v_uid is null or coalesce(cardinality(p_pats), 0) = 0 then return '{}'; end if;
  v_company := public.my_company_id();
  p_rest := coalesce(p_rest, '{}');
  case p_kind
  when 'customer' then v_id := 'c.id'; v_from := 'public.customers c'; v_scope := '(c.user_id = $1 or c.company_id = $2)';
    v_doc := 'public.search_doc(c.name, c.company_name, c.email, public.search_digits(c.phone), c.project_address)';
  when 'estimate' then v_id := 'e.id'; v_from := 'public.estimates e'; v_scope := '(e.user_id = $1 or e.company_id = $2)';
    v_doc := 'public.search_doc(e.title, e.estimate_number, e.customer_name, e.customer_email, public.search_digits(e.customer_phone), e.project_address, e.location_city, public.search_arr(e.trades))';
  when 'estimate_group' then v_id := 'g.id'; v_from := 'public.estimate_groups g join public.estimates e on e.id = g.estimate_id';
    v_scope := '(e.user_id = $1 or e.company_id = $2)'; v_doc := 'public.search_doc(g.name, g.description)'; v_fuzzy_ok := false;
  when 'estimate_item' then v_id := 'i.id'; v_from := 'public.estimate_items i join public.estimates e on e.id = i.estimate_id';
    v_scope := '(e.user_id = $1 or e.company_id = $2)'; v_doc := 'public.search_doc(i.name, i.description)'; v_fuzzy_ok := false;
  when 'project' then v_id := 's.id'; v_from := 'public.project_schedules s'; v_scope := '(s.user_id = $1 or s.company_id = $2)';
    v_doc := 'public.search_doc(s.name)';
  when 'task' then v_id := 't.id'; v_from := 'public.schedule_tasks t join public.project_schedules s on s.id = t.schedule_id';
    v_scope := '(s.user_id = $1 or s.company_id = $2)'; v_doc := 'public.search_doc(t.name, t.assignee)';
  when 'scope' then v_id := 'ps.id'; v_from := 'public.project_scope_sections ps'; v_scope := '(ps.user_id = $1 or ps.company_id = $2)';
    v_doc := 'public.search_doc(ps.title, ps.trade, ps.approved_scope, ps.work_description)'; v_fuzzy_ok := false;
  when 'change_order' then v_id := 'co.id'; v_from := 'public.change_orders co'; v_scope := '(co.user_id = $1 or co.company_id = $2)';
    v_doc := 'public.search_doc(co.title, co.description, co.customer_notes)'; v_fuzzy_ok := false;
  when 'signature' then v_id := 'sg.id'; v_from := 'public.signatures sg'; v_scope := '(sg.user_id = $1 or sg.company_id = $2)';
    v_doc := 'public.search_doc(sg.proposal_number, sg.project_title, sg.customer_name, sg.signer_name, ''v'' || sg.version_number::text)'; v_fuzzy_ok := false;
  when 'resource' then v_id := 'r.id'; v_from := 'public.pm_resources r'; v_scope := '(r.owner_id = $1 or r.company_id = $2)';
    v_doc := 'public.search_doc(r.name, r.contact_name, r.email, public.search_digits(r.phone), public.search_arr(r.trades))';
  when 'supplier' then v_id := 'sp.id'; v_from := 'public.pm_suppliers sp'; v_scope := '(sp.owner_id = $1 or sp.company_id = $2)';
    v_doc := 'public.search_doc(sp.name, sp.rep_name, sp.email, public.search_digits(sp.phone), sp.website, public.search_arr(sp.trades))';
  when 'saved_item' then v_id := 'si.id'; v_from := 'public.saved_items si'; v_scope := '(si.user_id = $1 or si.company_id = $2)';
    v_doc := 'public.search_doc(si.name, si.description, si.supplier_sku, si.supplier_name, si.category, si.trade, si.unit)';
  when 'assembly' then v_id := 'a.id'; v_from := 'public.assemblies a'; v_scope := '(a.user_id = $1 or a.company_id = $2)';
    v_doc := 'public.search_doc(a.name, a.description, a.trade, a.scale_label)';
  when 'photo' then v_id := 'ph.id'; v_from := 'public.project_photos ph'; v_scope := '(ph.user_id = $1 or ph.company_id = $2)';
    v_doc := 'public.search_doc(ph.caption, public.search_arr(ph.labels), public.search_arr(ph.ai_labels))'; v_fuzzy_ok := false;
  when 'message' then v_id := 'm.id'; v_from := 'public.comm_messages m'; v_scope := '(m.account_id = $1 or m.account_id = $2)';
    v_doc := 'public.search_doc(m.subject, m.to_name)'; v_fuzzy_ok := false;
  when 'member' then v_id := 'm.user_id'; v_from := 'public.company_members m'; v_scope := 'm.company_id = $2';
    v_doc := 'public.search_doc(m.display_name)'; v_fuzzy_ok := false;
  else return '{}';
  end case;
  v_words := (select string_agg(format('%s like $3[%s]', v_doc, i), ' and ') from generate_subscripts(p_pats, 1) i);
  v_rest := coalesce((select string_agg(format(' and %s like $5[%s]', v_doc, i), '') from generate_subscripts(p_rest, 1) i), '');
  v_sql := format('select array(select %s from %s where %s and ((%s)%s) limit 2000)', v_id, v_from, v_scope, v_words,
    case when coalesce(p_fuzzy, false) and v_fuzzy_ok and p_long is not null then format(' or ($4 <%% %s%s)', v_doc, v_rest) else '' end);
  execute v_sql into v_ids using v_uid, v_company, p_pats, p_long, p_rest;
  return coalesce(v_ids, '{}');
end $$;
revoke execute on function public.search_text_ids(text, text, text[], boolean, text, text[]) from public, anon;
grant execute on function public.search_text_ids(text, text, text[], boolean, text, text[]) to authenticated;

-- 5. The search ---------------------------------------------------------------------------------------------------
-- p_q        the cleaned search text (intent words such as "invoice" / "overdue" already turned into p_boost / p_filters
--            by the app); empty = filter-only listing of p_types
-- p_types    kinds to search (null = all)
-- p_boost    kinds the query hinted at ("bid", "sub", "bill" ...): +200 within the same tier
-- p_filters  {status (comma list), trade, customer, project (estimate id), person (user id), from, to, scope: 'project'}
-- p_context  {estimate_id} or {schedule_id}: the project the user is looking at, +250 within the same tier
-- p_per_type > 0: top N per kind (the quick dialog); 0: one sorted page (p_limit / p_offset) for the results page
-- p_sort     relevance | newest | oldest | name
drop function if exists public.search_universal(text, text[], text[], jsonb, jsonb, integer, integer, integer, text);
create or replace function public.search_universal(
  p_q text, p_types text[] default null, p_boost text[] default '{}', p_filters jsonb default '{}', p_context jsonb default '{}',
  p_per_type integer default 6, p_limit integer default 50, p_offset integer default 0, p_sort text default 'relevance')
returns table (
  kind text, id uuid, title text, subtitle text, status text, reason text, score numeric,
  estimate_id uuid, schedule_id uuid, customer_id uuid, customer_name text, parent_id uuid, owned boolean,
  in_context boolean, workspace text, amount numeric, record_date date, updated_at timestamptz,
  total_kind integer, total_all integer)
language plpgsql stable security invoker
set search_path = public, extensions, pg_temp
set plan_cache_mode = force_custom_plan
set jit = off
set pg_trgm.word_similarity_threshold = 0.35
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_q text := left(lower(btrim(regexp_replace(coalesce(p_q, ''), '\s+', ' ', 'g'))), 100);
  v_tokens text[]; v_pats text[]; v_long text; v_long_pat text; v_rest text[]; v_has_text boolean; v_fuzzy boolean;
  v_num text; v_types text[]; v_book uuid; v_sandbox boolean := false; v_ctx uuid; v_f jsonb := coalesce(p_filters, '{}');
  v_status text; v_trade text; v_customer uuid; v_project uuid; v_person uuid; v_from date; v_to date;
  v_per integer := greatest(0, least(coalesce(p_per_type, 6), 25));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 5000));
  v_cap constant integer := 300;
  -- Ids whose text matches, found through the trigram indexes (see search_text_ids); RLS still applies below.
  h_cust uuid[] := '{}'; h_est uuid[] := '{}'; h_grp uuid[] := '{}'; h_item uuid[] := '{}'; h_proj uuid[] := '{}';
  h_task uuid[] := '{}'; h_scope uuid[] := '{}'; h_co uuid[] := '{}'; h_sig uuid[] := '{}'; h_res uuid[] := '{}';
  h_sup uuid[] := '{}'; h_si uuid[] := '{}'; h_asm uuid[] := '{}'; h_photo uuid[] := '{}'; h_msg uuid[] := '{}'; h_people uuid[] := '{}';
  -- Related records, as id lists worked out before the main query (so each table is read by id, through its index).
  h_relc uuid[] := '{}'; h_rele uuid[] := '{}'; h_resh uuid[] := '{}'; h_est_all uuid[] := '{}'; h_proj_all uuid[] := '{}'; h_task_all uuid[] := '{}';
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  v_tokens := array(select distinct t from unnest(string_to_array(v_q, ' ')) t where t <> '' limit 6);
  v_has_text := cardinality(v_tokens) > 0;
  v_pats := array(select '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%' from unnest(v_tokens) t);
  v_long := (select t from unnest(v_tokens) t order by length(t) desc, t limit 1);
  v_long_pat := coalesce('%' || replace(replace(replace(v_long, '\', '\\'), '%', '\%'), '_', '\_') || '%', '%');
  v_rest := array(select '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%' from unnest(v_tokens) t where t <> v_long);
  v_fuzzy := coalesce(length(v_long) >= 4 and v_long !~ '[0-9]', false);   -- never for numbers / identifiers
  v_num := (select nullif(ltrim(t, '0'), '') from unnest(v_tokens) t where t ~ '^[a-z#-]{0,4}[0-9]+$' order by length(t) desc limit 1);
  v_num := nullif(regexp_replace(coalesce(v_num, ''), '[^0-9]', '', 'g'), '');
  v_types := coalesce(p_types, array['customer', 'estimate', 'project', 'task', 'scope', 'change_order', 'signature', 'invoice', 'payment',
                                      'bill', 'expense', 'vendor', 'resource', 'supplier', 'saved_item', 'assembly', 'photo', 'message']);
  if not v_has_text and p_types is null then return; end if;   -- an empty search lists nothing (the app shows recents)
  if v_types && array['invoice', 'payment', 'bill', 'expense', 'vendor'] then
    v_book := public.search_fin_book();
    v_sandbox := coalesce(public.fin_is_sandbox(v_book), false);
  end if;
  v_ctx := nullif(p_context ->> 'estimate_id', '')::uuid;
  if v_ctx is null and nullif(p_context ->> 'schedule_id', '') is not null then
    select s.estimate_id into v_ctx from public.project_schedules s where s.id = (p_context ->> 'schedule_id')::uuid;
  end if;
  v_status := nullif(v_f ->> 'status', '');
  v_trade := nullif(v_f ->> 'trade', '');
  v_customer := nullif(v_f ->> 'customer', '')::uuid;
  v_project := nullif(v_f ->> 'project', '')::uuid;
  v_person := nullif(v_f ->> 'person', '')::uuid;
  v_from := nullif(v_f ->> 'from', '')::date;
  v_to := nullif(v_f ->> 'to', '')::date;
  if v_f ->> 'scope' = 'project' then v_project := coalesce(v_ctx, v_project); end if;
  if v_has_text then
    h_cust := public.search_text_ids('customer', v_long_pat, v_pats, v_fuzzy, v_long, v_rest);
    h_est := public.search_text_ids('estimate', v_long_pat, v_pats, v_fuzzy, v_long, v_rest);
    h_people := public.search_text_ids('member', v_long_pat, v_pats, false, null, null);
    h_res := public.search_text_ids('resource', v_long_pat, v_pats, v_fuzzy, v_long, v_rest);
    if 'estimate' = any (v_types) then
      h_grp := public.search_text_ids('estimate_group', v_long_pat, v_pats, false, null, null);
      h_item := public.search_text_ids('estimate_item', v_long_pat, v_pats, false, null, null);
    end if;
    if 'project' = any (v_types) then h_proj := public.search_text_ids('project', v_long_pat, v_pats, v_fuzzy, v_long, v_rest); end if;
    if 'task' = any (v_types) then h_task := public.search_text_ids('task', v_long_pat, v_pats, v_fuzzy, v_long, v_rest); end if;
    if 'scope' = any (v_types) then h_scope := public.search_text_ids('scope', v_long_pat, v_pats, false, null, null); end if;
    if 'change_order' = any (v_types) then h_co := public.search_text_ids('change_order', v_long_pat, v_pats, false, null, null); end if;
    if 'signature' = any (v_types) then h_sig := public.search_text_ids('signature', v_long_pat, v_pats, false, null, null); end if;
    if 'supplier' = any (v_types) then h_sup := public.search_text_ids('supplier', v_long_pat, v_pats, v_fuzzy, v_long, v_rest); end if;
    if 'saved_item' = any (v_types) then h_si := public.search_text_ids('saved_item', v_long_pat, v_pats, v_fuzzy, v_long, v_rest); end if;
    if 'assembly' = any (v_types) then h_asm := public.search_text_ids('assembly', v_long_pat, v_pats, v_fuzzy, v_long, v_rest); end if;
    if 'photo' = any (v_types) then h_photo := public.search_text_ids('photo', v_long_pat, v_pats, false, null, null); end if;
    if 'message' = any (v_types) then h_msg := public.search_text_ids('message', v_long_pat, v_pats, false, null, null); end if;
    -- Customers whose name matches: their bids / projects / invoices show as related records. A spelling match
    -- counts only when no customer name matched properly.
    h_relc := array(select c.id from public.customers c
      where c.id = any (h_cust)
        and public.search_doc(c.name, c.company_name, c.email, public.search_digits(c.phone), c.project_address) like v_long_pat
        and public.search_doc(c.name, c.company_name) like all (v_pats)
      order by c.updated_at desc limit 10);
    if cardinality(h_relc) = 0 and v_fuzzy then
      h_relc := array(select c.id from public.customers c
        where c.id = any (h_cust)
          and v_long <% public.search_doc(c.name, c.company_name, c.email, public.search_digits(c.phone), c.project_address)
          and word_similarity(v_long, public.search_doc(c.name, c.company_name)) >= 0.5
          and public.search_doc(c.name, c.company_name) like all (v_rest)
        order by c.updated_at desc limit 10);
    end if;
    if cardinality(h_relc) > 0 then h_rele := array(select e.id from public.estimates e where e.customer_id = any (h_relc) limit 100); end if;
    h_resh := array(select r.id from public.pm_resources r where r.id = any (h_res) and public.search_doc(r.name, r.contact_name) like all (v_pats) limit 20);
    h_est_all := h_est || h_rele
      || array(select g.estimate_id from public.estimate_groups g where g.id = any (h_grp))
      || array(select i.estimate_id from public.estimate_items i where i.id = any (h_item));
    if 'project' = any (v_types) then
      h_proj_all := h_proj || array(select s2.id from public.project_schedules s2
        where s2.estimate_id = any (h_est || h_rele) or s2.project_manager_id = any (h_people) or s2.sales_rep_id = any (h_people));
    end if;
    if 'task' = any (v_types) then
      h_task_all := h_task
        || array(select t2.id from public.schedule_tasks t2 where t2.resource_id = any (h_resh))
        || array(select t2.id from public.schedule_tasks t2 join public.project_schedules s2 on s2.id = t2.schedule_id
                  where t2.kind = 'section' and s2.estimate_id = any (h_rele));
    end if;
    if cardinality(h_rele) > 0 then
      h_co := h_co || array(select co2.id from public.change_orders co2 where co2.estimate_id = any (h_rele));
      h_sig := h_sig || array(select sg2.id from public.signatures sg2 where sg2.estimate_id = any (h_rele));
    end if;
    if cardinality(h_relc) > 0 and 'message' = any (v_types) then
      h_msg := h_msg || array(select m2.id from public.comm_messages m2 where m2.customer_id = any (h_relc));
    end if;
    if v_num is not null and 'change_order' = any (v_types) and 'change_order' = any (p_boost) then
      h_co := h_co || array(select co2.id from public.change_orders co2 where co2.number::text = v_num
        and (cardinality(v_tokens) = 1 or co2.estimate_id = any (h_est) or co2.estimate_id is not distinct from v_ctx));
    end if;
  end if;

  return query
  with
  rel_c as (select c.id, c.name from public.customers c where c.id = any (h_relc)),
  rel_e as (select e.id, e.customer_id, e.customer_name from public.estimates e where e.id = any (h_rele)),
  -- Bid sections and line items whose text matches ("electrical", "200A panel").
  scope_hits as materialized (
    select g.estimate_id, g.name as label from public.estimate_groups g
     where v_has_text and 'estimate' = any (v_types) and g.id = any (h_grp)
       and public.search_doc(g.name, g.description) like v_long_pat and public.search_doc(g.name, g.description) like all (v_pats)
    union all
    (select i.estimate_id, i.name from public.estimate_items i
      where v_has_text and 'estimate' = any (v_types) and i.id = any (h_item)
        and public.search_doc(i.name, i.description) like v_long_pat and public.search_doc(i.name, i.description) like all (v_pats)
      limit v_cap)),
  people_hits as (
    select m.user_id, m.display_name from public.company_members m
     where v_has_text and m.user_id = any (h_people) and public.search_doc(m.display_name) like v_long_pat and public.search_doc(m.display_name) like all (v_pats) limit 20),
  res_hits as (
    select r.id, r.name from public.pm_resources r
     where v_has_text and r.id = any (h_resh)
       and public.search_doc(r.name, r.contact_name, r.email, public.search_digits(r.phone), public.search_arr(r.trades)) like v_long_pat
       and public.search_doc(r.name, r.contact_name) like all (v_pats) limit 20),
  opened as (select h.record_kind, h.record_id from public.search_history h where h.user_id = v_uid and h.kind = 'record'),
  cand as (
    -- Customers
    (select 'customer'::text as kind, c.id, c.name as title,
            nullif(concat_ws(' · ', nullif(c.company_name, ''), nullif(c.project_address, '')), '') as subtitle,
            null::text as status, '{}'::text[] as idents, null::text as ident_label,
            public.search_doc(c.name, c.company_name, c.email, public.search_digits(c.phone), c.project_address) as doc,
            array['Customer name', 'Company name', 'Email', 'Phone', 'Address'] as f_labels,
            array[c.name, c.company_name, c.email, public.search_digits(c.phone), c.project_address] as f_values,
            null::uuid as estimate_id, null::uuid as schedule_id, c.id as customer_id, c.name as customer_name, null::uuid as parent_id,
            (c.user_id = v_uid) as owned, '{}'::text[] as trades, array[c.user_id, c.created_by] as people,
            c.created_at::date as record_date, c.updated_at, null::numeric as amount, null::integer as hit_tier, null::text as hit_reason,
            false as archived, 'live'::text as workspace
       from public.customers c
      where 'customer' = any (v_types)
        and (not v_has_text or c.id = any (h_cust))
      order by (lower(c.name) = v_q) desc, c.updated_at desc limit v_cap)
    union all
    -- Bids & estimates (text, a matching scope section / line item, or a related customer)
    (select 'estimate', e.id, coalesce(nullif(e.title, ''), 'Untitled bid'),
            nullif(concat_ws(' · ', nullif(e.customer_name, ''), case when e.estimate_number <> '' then '#' || e.estimate_number end), ''),
            case when e.status = 'archived' then 'archived' else e.pipeline_stage end,
            array[nullif(e.estimate_number, '')], 'estimate number',
            public.search_doc(e.title, e.estimate_number, e.customer_name, e.customer_email, public.search_digits(e.customer_phone), e.project_address, e.location_city, public.search_arr(e.trades)),
            array['Bid name', 'Estimate number', 'Customer', 'Customer email', 'Customer phone', 'Address', 'City', 'Trade'],
            array[e.title, e.estimate_number, e.customer_name, e.customer_email, public.search_digits(e.customer_phone), e.project_address, e.location_city, public.search_arr(e.trades)],
            e.id, null::uuid, e.customer_id, nullif(e.customer_name, ''), null::uuid,
            (e.user_id = v_uid), e.trades, array[e.user_id, e.created_by], e.estimate_date, e.updated_at, null::numeric,
            case when sh.label is not null then 1000 when re.id is not null then 600 end,
            case when sh.label is not null then 'Scope contains "' || v_q || '" (' || sh.label || ')'
                 when re.id is not null then 'Related customer: ' || coalesce((select r.name from rel_c r where r.id = e.customer_id), e.customer_name) end,
            e.status = 'archived', 'live'
       from public.estimates e
       left join (select h.estimate_id, min(h.label) as label from scope_hits h group by h.estimate_id) sh on sh.estimate_id = e.id
       left join rel_e re on re.id = e.id
      where 'estimate' = any (v_types)
        -- One semi-join over the matching ids, so a text search reads only the bids it found (not every bid).
        and (not v_has_text or e.id = any (h_est_all))
      order by (lower(e.estimate_number) = any (v_tokens)) desc, e.updated_at desc limit v_cap)
    union all
    -- Projects (schedules), matched by name, by their bid, by PM / sales rep, or by a related customer
    (select 'project', s.id, s.name,
            nullif(concat_ws(' · ', nullif(e.customer_name, ''), nullif(e.project_address, '')), ''),
            case when s.closed_at is not null or s.status = 'completed' then 'completed' when s.status = 'archived' then 'archived'
                 when e.pipeline_stage in ('won', 'scheduled', 'in_progress', 'completed') then e.pipeline_stage else 'schedule_' || s.status end,
            array[nullif(e.estimate_number, '')], 'project number',
            public.search_doc(s.name, e.title, e.estimate_number, e.customer_name, e.project_address, public.search_arr(e.trades), pm.display_name, rep.display_name),
            array['Project name', 'Bid name', 'Project number', 'Customer', 'Address', 'Trade', 'Project manager', 'Sales rep'],
            array[s.name, e.title, e.estimate_number, e.customer_name, e.project_address, public.search_arr(e.trades), pm.display_name, rep.display_name],
            s.estimate_id, s.id, e.customer_id, nullif(e.customer_name, ''), null::uuid,
            (s.user_id = v_uid), coalesce(e.trades, '{}'), array[s.project_manager_id, s.sales_rep_id, s.user_id], s.start_date, s.updated_at, null::numeric,
            case when s.project_manager_id in (select p.user_id from people_hits p) or s.sales_rep_id in (select p.user_id from people_hits p) then 1000
                 when e.customer_id in (select r.id from rel_c r) then 600 end,
            case when s.project_manager_id in (select p.user_id from people_hits p) then 'Project manager: ' || pm.display_name
                 when s.sales_rep_id in (select p.user_id from people_hits p) then 'Sales rep: ' || rep.display_name
                 when e.customer_id in (select r.id from rel_c r) then 'Related customer: ' || e.customer_name end,
            s.status = 'archived', 'live'
       from public.project_schedules s
       left join public.estimates e on e.id = s.estimate_id
       left join public.company_members pm on pm.user_id = s.project_manager_id and pm.company_id = s.company_id
       left join public.company_members rep on rep.user_id = s.sales_rep_id and rep.company_id = s.company_id
      where 'project' = any (v_types)
        and (not v_has_text or s.id = any (h_proj_all))
      order by s.updated_at desc limit v_cap)
    union all
    -- Schedule tasks (name / assignee text, assigned person or sub, or a trade section of a related customer's project)
    (select 'task', t.id, t.name,
            nullif(concat_ws(' · ', s.name, coalesce(r.name, nullif(t.assignee, ''))), ''),
            t.status, '{}'::text[], null::text,
            public.search_doc(t.name, t.assignee, r.name),
            array['Task', 'Assigned to', 'Assigned to'], array[t.name, t.assignee, r.name],
            s.estimate_id, s.id, null::uuid, null::text, t.parent_id,
            (s.user_id = v_uid), '{}'::text[], array[r.linked_user_id], t.planned_start, t.updated_at, null::numeric,
            case when t.resource_id in (select h.id from res_hits h) then 1000 when t.kind = 'section' and s.estimate_id in (select r2.id from rel_e r2) then 600 end,
            case when t.resource_id in (select h.id from res_hits h) then 'Assigned to ' || r.name
                 when t.kind = 'section' and s.estimate_id in (select r2.id from rel_e r2) then 'Related project: ' || s.name end,
            s.status = 'archived', 'live'
       from public.schedule_tasks t
       join public.project_schedules s on s.id = t.schedule_id
       left join public.pm_resources r on r.id = t.resource_id
      where 'task' = any (v_types)
        and (not v_has_text or t.id = any (h_task_all))
      order by (s.estimate_id is not distinct from v_ctx) desc, t.planned_start desc limit v_cap)
    union all
    -- Trade scope (Project Scope Management): never internal notes
    (select 'scope', ps.id, coalesce(nullif(ps.title, ''), initcap(ps.trade), 'Trade scope'),
            nullif(concat_ws(' · ', coalesce(sc.name, e.title), nullif(e.customer_name, '')), ''),
            null::text, '{}'::text[], null::text,
            public.search_doc(ps.title, ps.trade, ps.approved_scope, ps.work_description),
            array['Scope title', 'Trade', 'Approved scope', 'Work description'], array[ps.title, ps.trade, ps.approved_scope, ps.work_description],
            ps.estimate_id, sc.id, e.customer_id, nullif(e.customer_name, ''), null::uuid,
            (ps.user_id = v_uid), array[ps.trade], '{}'::uuid[], ps.updated_at::date, ps.updated_at, null::numeric,
            null::integer, null::text, false, 'live'
       from public.project_scope_sections ps
       left join public.estimates e on e.id = ps.estimate_id
       left join lateral (select s2.id, s2.name from public.project_schedules s2 where s2.estimate_id = ps.estimate_id and s2.status <> 'archived' limit 1) sc on true
      where 'scope' = any (v_types)
        and (not v_has_text or ps.id = any (h_scope))
      order by (ps.estimate_id is not distinct from v_ctx) desc, ps.updated_at desc limit v_cap)
    union all
    -- Change orders (never internal notes)
    (select 'change_order', co.id, 'Change order #' || co.number || coalesce(': ' || nullif(co.title, ''), ''),
            nullif(concat_ws(' · ', coalesce(sc.name, e.title), nullif(e.customer_name, '')), ''),
            co.status, array['co-' || co.number, co.number::text], 'change order number',
            public.search_doc(co.title, co.description, co.customer_notes, 'co-' || co.number, 'change order ' || co.number, e.title, e.customer_name),
            array['Change order', 'Description', 'Customer notes', 'Project', 'Customer'], array[co.title, co.description, co.customer_notes, e.title, e.customer_name],
            co.estimate_id, sc.id, e.customer_id, nullif(e.customer_name, ''), null::uuid,
            (co.user_id = v_uid), coalesce(e.trades, '{}'), array[co.user_id, co.created_by], co.created_at::date, co.updated_at, null::numeric,
            case when co.estimate_id in (select r.id from rel_e r) then 600 end,
            case when co.estimate_id in (select r.id from rel_e r) then 'Related customer: ' || e.customer_name end,
            co.status = 'void', 'live'
       from public.change_orders co
       left join public.estimates e on e.id = co.estimate_id
       left join lateral (select s2.id, s2.name from public.project_schedules s2 where s2.estimate_id = co.estimate_id and s2.status <> 'archived' limit 1) sc on true
      where 'change_order' = any (v_types)
        and (not v_has_text or co.id = any (h_co))
      order by co.updated_at desc limit v_cap)
    union all
    -- Signed proposals (immutable signed versions)
    (select 'signature', sg.id, coalesce(nullif(sg.project_title, ''), 'Signed proposal') || ' · v' || sg.version_number,
            nullif(concat_ws(' · ', nullif(sg.customer_name, ''), case when sg.proposal_number <> '' then '#' || sg.proposal_number end, 'signed ' || to_char(sg.signed_at, 'Mon DD, YYYY')), ''),
            'signed', array[nullif(sg.proposal_number, ''), 'v' || sg.version_number], 'proposal number or version',
            public.search_doc(sg.proposal_number, sg.project_title, sg.customer_name, sg.signer_name, 'v' || sg.version_number::text, 'version ' || sg.version_number::text),
            array['Proposal', 'Proposal number', 'Customer', 'Signed by', 'Version'], array[sg.project_title, sg.proposal_number, sg.customer_name, sg.signer_name, 'v' || sg.version_number],
            sg.estimate_id, null::uuid, e.customer_id, nullif(sg.customer_name, ''), null::uuid,
            (sg.user_id = v_uid), coalesce(e.trades, '{}'), array[sg.user_id], sg.signed_at::date, sg.signed_at, null::numeric,
            case when sg.estimate_id in (select r.id from rel_e r) then 600 end,
            case when sg.estimate_id in (select r.id from rel_e r) then 'Related customer: ' || sg.customer_name end,
            false, 'live'
       from public.signatures sg
       left join public.estimates e on e.id = sg.estimate_id
      where 'signature' = any (v_types)
        and (not v_has_text or sg.id = any (h_sig))
      order by sg.signed_at desc limit v_cap)
    union all
    -- Invoices (current book only; status computed from balance and due date)
    (select 'invoice', i.id, coalesce(i.number, 'Draft invoice'),
            nullif(concat_ws(' · ', coalesce(i.bill_to ->> 'name', cu.name), j.name, case when i.due_date is not null then 'due ' || to_char(i.due_date, 'Mon DD, YYYY') end), ''),
            case when i.status = 'draft' then 'draft' when i.status = 'void' then 'void' when bal.balance <= 0 then 'paid'
                 when i.due_date < current_date then 'overdue' else 'open' end,
            array[i.number], 'invoice number',
            public.search_doc(i.number, coalesce(i.bill_to ->> 'name', cu.name), j.name, j.job_number, i.memo, i.total::text),
            array['Invoice number', 'Customer', 'Job', 'Job number', 'Memo', 'Amount'],
            array[i.number, coalesce(i.bill_to ->> 'name', cu.name), j.name, j.job_number, i.memo, i.total::text],
            j.estimate_id, null::uuid, i.customer_id, coalesce(i.bill_to ->> 'name', cu.name), null::uuid,
            true, '{}'::text[], array[i.created_by], coalesce(i.issue_date, i.created_at::date), i.updated_at, i.total,
            case when i.customer_id in (select r.id from rel_c r) then 600 end,
            case when i.customer_id in (select r.id from rel_c r) then 'Related customer: ' || coalesce(i.bill_to ->> 'name', cu.name) end,
            i.status = 'void', case when v_sandbox then 'sandbox' else 'live' end
       from public.fin_invoices i
       join public.fin_jobs j on j.id = i.job_id
       left join public.customers cu on cu.id = i.customer_id
       left join lateral (select b.balance from public.fin_invoice_balances_v b where b.invoice_id = i.id) bal on true
      where 'invoice' = any (v_types) and v_book is not null and i.book_id = v_book
        and (not v_has_text
          or public.search_doc(i.number, coalesce(i.bill_to ->> 'name', cu.name), j.name, j.job_number, i.memo, i.total::text) like all (v_pats)
          or (v_fuzzy and v_long <% public.search_doc(i.number, coalesce(i.bill_to ->> 'name', cu.name), j.name, j.job_number, i.memo)
              and public.search_doc(i.number, coalesce(i.bill_to ->> 'name', cu.name), j.name, j.job_number, i.memo) like all (v_rest))
          or i.customer_id in (select r.id from rel_c r))
      order by i.created_at desc limit v_cap)
    union all
    -- Customer payments (receipts)
    (select 'payment', p.id, coalesce(p.number, 'Payment'),
            nullif(concat_ws(' · ', cu.name, j.name, initcap(replace(p.method, '_', ' ')), to_char(p.received_on, 'Mon DD, YYYY')), ''),
            case when p.status = 'void' or p.voided_at is not null then 'void' when p.verified then 'verified' else 'recorded' end,
            array[p.number, nullif(p.reference, '')], 'payment number',
            public.search_doc(p.number, p.reference, p.memo, cu.name, j.name, p.amount::text),
            array['Payment number', 'Reference', 'Memo', 'Customer', 'Job', 'Amount'], array[p.number, p.reference, p.memo, cu.name, j.name, p.amount::text],
            j.estimate_id, null::uuid, p.customer_id, cu.name, null::uuid,
            true, '{}'::text[], array[p.created_by], p.received_on, p.created_at, p.amount,
            case when p.customer_id in (select r.id from rel_c r) then 600 end,
            case when p.customer_id in (select r.id from rel_c r) then 'Related customer: ' || cu.name end,
            p.voided_at is not null, case when v_sandbox then 'sandbox' else 'live' end
       from public.fin_payments p
       left join public.fin_jobs j on j.id = p.job_id
       left join public.customers cu on cu.id = p.customer_id
      where 'payment' = any (v_types) and v_book is not null and p.book_id = v_book
        and (not v_has_text
          or public.search_doc(p.number, p.reference, p.memo, cu.name, j.name, p.amount::text) like all (v_pats)
          or p.customer_id in (select r.id from rel_c r))
      order by p.received_on desc limit v_cap)
    union all
    -- Vendor bills
    (select 'bill', b.id, coalesce(v.name, 'Vendor bill') || ' · ' || coalesce(nullif(b.vendor_invoice_number, ''), b.number, 'bill'),
            nullif(concat_ws(' · ', b.number, case when b.due_date is not null then 'due ' || to_char(b.due_date, 'Mon DD, YYYY') end), ''),
            b.status, array[b.number, nullif(b.vendor_invoice_number, '')], 'bill number',
            public.search_doc(v.name, b.number, b.vendor_invoice_number, b.memo, b.total::text),
            array['Vendor', 'Bill number', 'Vendor invoice number', 'Memo', 'Amount'], array[v.name, b.number, b.vendor_invoice_number, b.memo, b.total::text],
            null::uuid, null::uuid, null::uuid, null::text, null::uuid,
            true, '{}'::text[], array[b.created_by], b.bill_date, b.created_at, b.total,
            null::integer, null::text, b.status = 'void', case when v_sandbox then 'sandbox' else 'live' end
       from public.fin_vendor_bills b
       left join public.fin_vendors v on v.id = b.vendor_id
      where 'bill' = any (v_types) and v_book is not null and b.book_id = v_book
        and (not v_has_text
          or public.search_doc(v.name, b.number, b.vendor_invoice_number, b.memo, b.total::text) like all (v_pats)
          or (v_fuzzy and v_long <% public.search_doc(v.name, b.number, b.vendor_invoice_number, b.memo)))
      order by b.bill_date desc nulls last limit v_cap)
    union all
    -- Expenses
    (select 'expense', x.id, coalesce(nullif(x.payee, ''), v.name, 'Expense') || coalesce(' · ' || x.number, ''),
            nullif(concat_ws(' · ', nullif(x.description, ''), j.name, to_char(x.spent_on, 'Mon DD, YYYY')), ''),
            x.status, array[x.number], 'expense number',
            public.search_doc(x.payee, v.name, x.number, x.description, j.name, x.amount::text),
            array['Payee', 'Vendor', 'Expense number', 'Description', 'Job', 'Amount'], array[x.payee, v.name, x.number, x.description, j.name, x.amount::text],
            j.estimate_id, null::uuid, j.customer_id, null::text, null::uuid,
            true, '{}'::text[], array[x.created_by], x.spent_on, x.created_at, x.amount,
            null::integer, null::text, x.status = 'void', case when v_sandbox then 'sandbox' else 'live' end
       from public.fin_expenses x
       left join public.fin_vendors v on v.id = x.vendor_id
       left join public.fin_jobs j on j.id = x.job_id
      where 'expense' = any (v_types) and v_book is not null and x.book_id = v_book
        and (not v_has_text
          or public.search_doc(x.payee, v.name, x.number, x.description, j.name, x.amount::text) like all (v_pats)
          or (v_fuzzy and v_long <% public.search_doc(x.payee, v.name, x.description)))
      order by x.spent_on desc limit v_cap)
    union all
    -- Vendors (Financials)
    (select 'vendor', fv.id, fv.name, initcap(replace(nullif(fv.kind, ''), '_', ' ')),
            fv.status, '{}'::text[], null::text,
            public.search_doc(fv.name, fv.email, public.search_digits(fv.phone)),
            array['Vendor name', 'Email', 'Phone'], array[fv.name, fv.email, public.search_digits(fv.phone)],
            null::uuid, null::uuid, null::uuid, null::text, fv.resource_id,
            true, '{}'::text[], array[fv.created_by], fv.created_at::date, fv.updated_at, null::numeric,
            null::integer, null::text, fv.status = 'archived', case when v_sandbox then 'sandbox' else 'live' end
       from public.fin_vendors fv
      where 'vendor' = any (v_types) and v_book is not null and fv.book_id = v_book
        and (not v_has_text
          or public.search_doc(fv.name, fv.email, public.search_digits(fv.phone)) like all (v_pats)
          or (v_fuzzy and v_long <% public.search_doc(fv.name)))
      order by fv.name limit v_cap)
    union all
    -- Employees, crews and subcontractors (never pay rates, TINs or documents)
    (select 'resource', r.id, r.name,
            nullif(concat_ws(' · ', nullif(r.contact_name, ''), nullif(initcap(public.search_arr(r.trades)), '')), ''),
            r.kind || case when r.status = 'archived' then '_archived' else '' end, '{}'::text[], null::text,
            public.search_doc(r.name, r.contact_name, r.email, public.search_digits(r.phone), public.search_arr(r.trades)),
            array['Name', 'Contact', 'Email', 'Phone', 'Trade'], array[r.name, r.contact_name, r.email, public.search_digits(r.phone), public.search_arr(r.trades)],
            null::uuid, null::uuid, null::uuid, null::text, null::uuid,
            (r.owner_id = v_uid), r.trades, array[r.linked_user_id], r.created_at::date, r.updated_at, null::numeric,
            null::integer, null::text, r.status = 'archived', 'live'
       from public.pm_resources r
      where 'resource' = any (v_types)
        and (not v_has_text or r.id = any (h_res))
      order by (lower(r.name) = v_q) desc, r.updated_at desc limit v_cap)
    union all
    -- Supplier directory (never the account number)
    (select 'supplier', sp.id, sp.name,
            nullif(concat_ws(' · ', 'Supplier', nullif(sp.rep_name, ''), nullif(initcap(public.search_arr(sp.trades)), '')), ''),
            sp.status, '{}'::text[], null::text,
            public.search_doc(sp.name, sp.rep_name, sp.email, public.search_digits(sp.phone), sp.website, public.search_arr(sp.trades)),
            array['Supplier', 'Rep', 'Email', 'Phone', 'Website', 'Trade'], array[sp.name, sp.rep_name, sp.email, public.search_digits(sp.phone), sp.website, public.search_arr(sp.trades)],
            null::uuid, null::uuid, null::uuid, null::text, null::uuid,
            (sp.owner_id = v_uid), sp.trades, '{}'::uuid[], sp.created_at::date, sp.updated_at, null::numeric,
            null::integer, null::text, sp.status = 'archived', 'live'
       from public.pm_suppliers sp
      where 'supplier' = any (v_types)
        and (not v_has_text or sp.id = any (h_sup))
      order by sp.name limit v_cap)
    union all
    -- Saved items (never the cost)
    (select 'saved_item', si.id, si.name,
            nullif(concat_ws(' · ', nullif(si.supplier_name, ''), case when si.supplier_sku <> '' then 'SKU ' || si.supplier_sku end, nullif(si.unit, ''), nullif(initcap(replace(si.trade, '-', ' ')), '')), ''),
            case when si.favorite then 'favorite' end, array[nullif(si.supplier_sku, '')], 'SKU',
            public.search_doc(si.name, si.description, si.supplier_sku, si.supplier_name, si.category, si.trade, si.unit),
            array['Item name', 'Description', 'SKU', 'Supplier', 'Category', 'Trade', 'Unit'],
            array[si.name, si.description, si.supplier_sku, si.supplier_name, si.category, si.trade, si.unit],
            null::uuid, null::uuid, null::uuid, null::text, null::uuid,
            (si.user_id = v_uid), array[si.trade], array[si.user_id], si.created_at::date, coalesce(si.updated_at, si.created_at), null::numeric,
            null::integer, null::text, false, 'live'
       from public.saved_items si
      where 'saved_item' = any (v_types)
        and (not v_has_text or si.id = any (h_si))
      order by (lower(si.supplier_sku) = any (v_tokens)) desc, si.name limit v_cap)
    union all
    -- Saved assemblies
    (select 'assembly', a.id, a.name,
            nullif(concat_ws(' · ', 'Assembly', nullif(initcap(replace(a.trade, '-', ' ')), ''), nullif(a.scale_label, '')), ''),
            null::text, '{}'::text[], null::text,
            public.search_doc(a.name, a.description, a.trade, a.scale_label),
            array['Assembly name', 'Description', 'Trade', 'Scale'], array[a.name, a.description, a.trade, a.scale_label],
            null::uuid, null::uuid, null::uuid, null::text, null::uuid,
            (a.user_id = v_uid), array[a.trade], array[a.user_id], a.created_at::date, coalesce(a.updated_at, a.created_at), null::numeric,
            null::integer, null::text, false, 'live'
       from public.assemblies a
      where 'assembly' = any (v_types)
        and (not v_has_text or a.id = any (h_asm))
      order by a.name limit v_cap)
    union all
    -- Photos: caption and labels. AI-suggested labels are reported as such.
    (select 'photo', ph.id, coalesce(nullif(ph.caption, ''), 'Project photo'),
            nullif(concat_ws(' · ', coalesce(sc.name, e.title), nullif(public.search_arr(ph.labels), '')), ''),
            null::text, '{}'::text[], null::text,
            public.search_doc(ph.caption, public.search_arr(ph.labels), public.search_arr(ph.ai_labels)),
            array['Caption', 'Label', 'AI-suggested label'], array[ph.caption, public.search_arr(ph.labels), public.search_arr(ph.ai_labels)],
            ph.estimate_id, sc.id, ph.customer_id, nullif(e.customer_name, ''), null::uuid,
            (ph.user_id = v_uid), '{}'::text[], array[ph.uploaded_by], coalesce(ph.taken_on, ph.created_at::date), ph.updated_at, null::numeric,
            null::integer, null::text, false, 'live'
       from public.project_photos ph
       left join public.estimates e on e.id = ph.estimate_id
       left join lateral (select s2.id, s2.name from public.project_schedules s2 where s2.estimate_id = ph.estimate_id and s2.status <> 'archived' limit 1) sc on true
      where 'photo' = any (v_types) and ph.archived_at is null
        and (not v_has_text or ph.id = any (h_photo))
      order by ph.created_at desc limit v_cap)
    union all
    -- Customer messages: subject and recipient only (never the body)
    (select 'message', m.id, coalesce(nullif(m.subject, ''), 'Customer message'),
            nullif(concat_ws(' · ', nullif(m.to_name, ''), case m.kind when 'nurture' then 'Customer follow-up' else 'Project update' end), ''),
            m.status, '{}'::text[], null::text,
            public.search_doc(m.subject, m.to_name),
            array['Subject', 'Recipient'], array[m.subject, m.to_name],
            m.estimate_id, m.schedule_id, m.customer_id, nullif(m.to_name, ''), null::uuid,
            true, '{}'::text[], '{}'::uuid[], m.created_at::date, m.created_at, null::numeric,
            case when m.customer_id in (select r.id from rel_c r) then 600 end,
            case when m.customer_id in (select r.id from rel_c r) then 'Related customer' end,
            m.status in ('canceled', 'skipped'), 'live'
       from public.comm_messages m
      where 'message' = any (v_types)
        and (not v_has_text or m.id = any (h_msg))
      order by m.created_at desc limit v_cap)
  ),
  tiered as (
    select c.*,
      case
        when not v_has_text then 100
        when exists (select 1 from unnest(c.idents) x where x is not null
                       and (lower(x) = v_q or lower(x) = any (v_tokens)
                         or (v_num is not null and (length(v_num) >= 3 or c.kind = any (p_boost)) and ltrim(public.search_digits(x), '0') = v_num))) then 3000
        when lower(c.title) = v_q then 2500
        when lower(c.title) like replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' then 2000
        when lower(c.title) like all (v_pats) then 1500
        when c.doc like all (v_pats) then 1000
        else 0 end as base_tier,
      case when v_fuzzy then word_similarity(v_long, coalesce(c.doc, '')) else 0 end as sim
    from cand c),
  scored as (
    select t.*,
      greatest(t.base_tier, coalesce(t.hit_tier, 0), case when t.sim >= 0.35 then 400 else 0 end) as tier
    from tiered t),
  filtered as (
    select s.*,
      s.tier
      + case when s.kind = any (coalesce(p_boost, '{}')) then 200 else 0 end
      + case when v_ctx is not null and s.estimate_id = v_ctx then 250 else 0 end
      + case when s.tier = 400 then round((s.sim * 40)::numeric, 2) else 0 end
      + round((25 * exp(-greatest(0, extract(epoch from (now() - coalesce(s.updated_at, now()))) / 86400.0) / 60.0))::numeric, 2)
      + case when exists (select 1 from opened o where o.record_kind = s.kind and o.record_id = s.id) then 20 else 0 end
      - case when s.archived then 150 else 0 end as final_score
    from scored s
    where s.tier > 0
      and (v_status is null or s.status = any (string_to_array(v_status, ',')))
      and (v_trade is null or v_trade = any (s.trades))
      and (v_customer is null or s.customer_id = v_customer)
      and (v_project is null or s.estimate_id = v_project)
      and (v_person is null or v_person = any (s.people))
      and (v_from is null or s.record_date >= v_from)
      and (v_to is null or s.record_date <= v_to)),
  ranked as (
    select f.*,
      row_number() over (partition by f.kind order by f.final_score desc, f.updated_at desc nulls last, f.id) as rn,
      count(*) over (partition by f.kind)::integer as n_kind,
      count(*) over ()::integer as n_all
    from filtered f
    -- A loose spelling match (0.35-0.5) shows only when nothing matched properly ("did you mean").
    where f.tier <> 400 or f.sim >= 0.5 or not exists (select 1 from filtered g where g.tier > 400))
  select r.kind, r.id, r.title, r.subtitle, r.status,
         case
           when r.tier = 100 then null
           when r.tier = 3000 then 'Exact ' || coalesce(r.ident_label, 'number')
           when r.tier = 2500 then 'Exact name'
           when r.tier = 2000 then 'Name starts with "' || v_q || '"'
           when r.tier = 1500 then 'Name match'
           when r.tier = r.hit_tier and r.base_tier < r.hit_tier then r.hit_reason
           when r.tier = 1000 then coalesce(
             (select case when f.label in ('Email', 'Phone', 'Customer email', 'Customer phone', 'Amount') then f.label || ' match'
                          else f.label || ': ' || case when length(f.val) > 60 then left(f.val, 57) || '...' else f.val end end
                from unnest(r.f_labels, r.f_values) with ordinality as f(label, val, ord)
               where lower(coalesce(f.val, '')) like all (v_pats) order by f.ord limit 1),
             'Matched ' || (select string_agg(distinct f.label, ', ') from unnest(r.f_labels, r.f_values) as f(label, val)
                             where exists (select 1 from unnest(v_pats) p where lower(coalesce(f.val, '')) like p)),
             'Matched details')
           when r.tier = 600 then r.hit_reason
           else 'Similar spelling to "' || v_long || '"'
         end,
         r.final_score, r.estimate_id, r.schedule_id, r.customer_id, r.customer_name, r.parent_id, r.owned,
         (v_ctx is not null and r.estimate_id = v_ctx), r.workspace, r.amount, r.record_date, r.updated_at, r.n_kind, r.n_all
    from ranked r
   where (v_per > 0 and r.rn <= v_per) or v_per = 0
   order by
     case when p_sort = 'name' then lower(r.title) end asc,
     case when p_sort = 'newest' then r.updated_at end desc nulls last,
     case when p_sort = 'oldest' then r.updated_at end asc nulls last,
     r.final_score desc, r.updated_at desc nulls last, r.id
   limit case when v_per > 0 then null else v_limit end
  offset case when v_per > 0 then 0 else v_offset end;
end $$;
revoke execute on function public.search_universal(text, text[], text[], jsonb, jsonb, integer, integer, integer, text) from public, anon;
grant execute on function public.search_universal(text, text[], text[], jsonb, jsonb, integer, integer, integer, text) to authenticated;

-- 6. What the caller may do (for command actions). Only booleans and ids of the caller's own workspace. --------
create or replace function public.search_capabilities() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_company uuid; m public.company_members; v_book uuid; v_fin text[] := '{}'; v_live uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  v_company := public.my_company_id();
  if v_company is not null then select * into m from public.company_members where company_id = v_company and user_id = v_uid; end if;
  v_book := public.search_fin_book();
  if v_book is not null then
    v_fin := array(select k from unnest(public.fin_permission_keys()) k where public.fin_has_permission(v_book, k, k not like 'view_%'));
    v_live := public.fin_book_live(v_book);
  end if;
  return jsonb_build_object(
    'company', case when v_company is null then null else jsonb_build_object('id', v_company, 'role', m.role,
                 'perms', to_jsonb(public.member_permissions(m.role, m.permissions_granted, m.permissions_revoked))) end,
    'premium', coalesce(public.library_access(), false),
    'admin', coalesce(public.is_admin(v_uid), false),
    'fin', case when v_book is null then null else jsonb_build_object('book', v_book, 'sandbox', v_book <> v_live, 'perms', to_jsonb(v_fin)) end);
end $$;
revoke execute on function public.search_capabilities() from public, anon;
grant execute on function public.search_capabilities() to authenticated;

-- 7. History: remember / list (re-checked through RLS) / forget, and preferences --------------------------------
create or replace function public.search_remember(p_kind text, p_query text default null, p_record_kind text default null, p_record_id uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_q text := left(btrim(coalesce(p_query, '')), 100);
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not coalesce((select history_enabled from public.search_preferences where user_id = v_uid), true) then return; end if;
  if p_kind = 'query' then
    if length(v_q) < 2 then return; end if;
    insert into public.search_history (user_id, kind, query) values (v_uid, 'query', v_q)
      on conflict (user_id, lower(query)) where kind = 'query' do update set used_at = now(), query = excluded.query;
  elsif p_kind = 'record' then
    if p_record_id is null or p_record_kind !~ '^[a-z_]{2,30}$' then raise exception 'bad_input' using errcode = '22023'; end if;
    insert into public.search_history (user_id, kind, record_kind, record_id) values (v_uid, 'record', p_record_kind, p_record_id)
      on conflict (user_id, record_kind, record_id) where kind = 'record' do update set used_at = now();
  else
    raise exception 'bad_input' using errcode = '22023';
  end if;
  delete from public.search_history h where h.user_id = v_uid and h.kind = p_kind
     and h.id not in (select h2.id from public.search_history h2 where h2.user_id = v_uid and h2.kind = p_kind order by h2.used_at desc limit 20);
end $$;
revoke execute on function public.search_remember(text, text, text, uuid) from public, anon;
grant execute on function public.search_remember(text, text, text, uuid) to authenticated;

-- One record, looked up through RLS as the caller (null when it's gone or no longer visible).
create or replace function public.search_resolve(p_kind text, p_id uuid)
returns table (title text, subtitle text, estimate_id uuid, schedule_id uuid, customer_id uuid, parent_id uuid, owned boolean)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_book uuid;
begin
  if p_kind in ('invoice', 'payment', 'bill', 'expense', 'vendor') then v_book := public.search_fin_book(); end if;
  return query
  select x.title, x.subtitle, x.estimate_id, x.schedule_id, x.customer_id, x.parent_id, x.owned from (
    select c.name as title, c.project_address as subtitle, null::uuid as estimate_id, null::uuid as schedule_id, c.id as customer_id, null::uuid as parent_id, c.user_id = v_uid as owned
      from public.customers c where p_kind = 'customer' and c.id = p_id
    union all select coalesce(nullif(e.title, ''), 'Untitled bid'), e.customer_name, e.id, null, e.customer_id, null, e.user_id = v_uid from public.estimates e where p_kind = 'estimate' and e.id = p_id
    union all select s.name, null, s.estimate_id, s.id, null, null, s.user_id = v_uid from public.project_schedules s where p_kind = 'project' and s.id = p_id
    union all select t.name, s.name, s.estimate_id, s.id, null, t.parent_id, s.user_id = v_uid from public.schedule_tasks t join public.project_schedules s on s.id = t.schedule_id where p_kind = 'task' and t.id = p_id
    union all select coalesce(nullif(ps.title, ''), 'Trade scope'), null, ps.estimate_id,
                     (select s2.id from public.project_schedules s2 where s2.estimate_id = ps.estimate_id and s2.status <> 'archived' limit 1), null, null, ps.user_id = v_uid
      from public.project_scope_sections ps where p_kind = 'scope' and ps.id = p_id
    union all select 'Change order #' || co.number || coalesce(': ' || nullif(co.title, ''), ''), null, co.estimate_id,
                     (select s2.id from public.project_schedules s2 where s2.estimate_id = co.estimate_id and s2.status <> 'archived' limit 1), null, null, co.user_id = v_uid
      from public.change_orders co where p_kind = 'change_order' and co.id = p_id
    union all select coalesce(nullif(sg.project_title, ''), 'Signed proposal') || ' · v' || sg.version_number, sg.customer_name, sg.estimate_id, null, null, null, sg.user_id = v_uid
      from public.signatures sg where p_kind = 'signature' and sg.id = p_id
    union all select coalesce(i.number, 'Draft invoice'), i.bill_to ->> 'name', j.estimate_id, null, i.customer_id, null, true
      from public.fin_invoices i join public.fin_jobs j on j.id = i.job_id where p_kind = 'invoice' and i.id = p_id and i.book_id = v_book
    union all select coalesce(p.number, 'Payment'), null, j.estimate_id, null, p.customer_id, null, true
      from public.fin_payments p left join public.fin_jobs j on j.id = p.job_id where p_kind = 'payment' and p.id = p_id and p.book_id = v_book
    union all select coalesce(b.vendor_invoice_number, b.number, 'Vendor bill'), null, null, null, null, null, true from public.fin_vendor_bills b where p_kind = 'bill' and b.id = p_id and b.book_id = v_book
    union all select coalesce(x.payee, x.number, 'Expense'), x.description, j.estimate_id, null, null, null, true
      from public.fin_expenses x left join public.fin_jobs j on j.id = x.job_id where p_kind = 'expense' and x.id = p_id and x.book_id = v_book
    union all select fv.name, null, null, null, null, fv.resource_id, true from public.fin_vendors fv where p_kind = 'vendor' and fv.id = p_id and fv.book_id = v_book
    union all select r.name, r.kind, null, null, null, null, r.owner_id = v_uid from public.pm_resources r where p_kind = 'resource' and r.id = p_id
    union all select sp.name, null, null, null, null, null, sp.owner_id = v_uid from public.pm_suppliers sp where p_kind = 'supplier' and sp.id = p_id
    union all select si.name, si.supplier_name, null, null, null, null, si.user_id = v_uid from public.saved_items si where p_kind = 'saved_item' and si.id = p_id
    union all select a.name, null, null, null, null, null, a.user_id = v_uid from public.assemblies a where p_kind = 'assembly' and a.id = p_id
    union all select coalesce(nullif(ph.caption, ''), 'Project photo'), null, ph.estimate_id,
                     (select s2.id from public.project_schedules s2 where s2.estimate_id = ph.estimate_id and s2.status <> 'archived' limit 1), ph.customer_id, null, ph.user_id = v_uid
      from public.project_photos ph where p_kind = 'photo' and ph.id = p_id and ph.archived_at is null
    union all select coalesce(nullif(m.subject, ''), 'Customer message'), m.to_name, m.estimate_id, m.schedule_id, m.customer_id, null, true
      from public.comm_messages m where p_kind = 'message' and m.id = p_id
  ) x limit 1;
end $$;
revoke execute on function public.search_resolve(text, uuid) from public, anon;
grant execute on function public.search_resolve(text, uuid) to authenticated;

-- Recent searches and recently opened records. A record the caller can no longer open is removed here.
create or replace function public.search_recent() returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); h record; r record; v_records jsonb := '[]'; v_gone uuid[] := '{}'; v_enabled boolean;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  v_enabled := coalesce((select history_enabled from public.search_preferences where user_id = v_uid), true);
  for h in select * from public.search_history where user_id = v_uid and kind = 'record' order by used_at desc limit 20 loop
    select * into r from public.search_resolve(h.record_kind, h.record_id);
    if r.title is null then v_gone := v_gone || h.id;
    else v_records := v_records || jsonb_build_object('kind', h.record_kind, 'id', h.record_id, 'title', r.title, 'subtitle', r.subtitle,
      'estimate_id', r.estimate_id, 'schedule_id', r.schedule_id, 'customer_id', r.customer_id, 'parent_id', r.parent_id, 'owned', r.owned, 'used_at', h.used_at);
    end if;
  end loop;
  if cardinality(v_gone) > 0 then delete from public.search_history where user_id = v_uid and id = any (v_gone); end if;
  return jsonb_build_object(
    'history_enabled', v_enabled,
    'queries', coalesce((select jsonb_agg(q.query order by q.used_at desc) from (select query, used_at from public.search_history
                 where user_id = v_uid and kind = 'query' order by used_at desc limit 8) q), '[]'),
    'records', v_records,
    'favorite_actions', coalesce((select to_jsonb(favorite_actions) from public.search_preferences where user_id = v_uid), '[]'),
    'default_filters', coalesce((select default_filters from public.search_preferences where user_id = v_uid), '{}'));
end $$;
revoke execute on function public.search_recent() from public, anon;
grant execute on function public.search_recent() to authenticated;

create or replace function public.search_forget(p_id uuid default null) returns void
language sql security invoker set search_path = public, pg_temp as $$
  delete from public.search_history where user_id = auth.uid() and (p_id is null or id = p_id)
$$;
revoke execute on function public.search_forget(uuid) from public, anon;
grant execute on function public.search_forget(uuid) to authenticated;

create or replace function public.search_save_preferences(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_actions text[]; v_filters jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(coalesce(p, '{}')) <> 'object' then raise exception 'bad_input' using errcode = '22023'; end if;
  if p ? 'favorite_actions' then
    v_actions := array(select a from jsonb_array_elements_text(p -> 'favorite_actions') a where a ~ '^[a-z0-9_.-]{1,60}$' limit 20);
  end if;
  if p ? 'default_filters' then
    v_filters := p -> 'default_filters';
    if jsonb_typeof(v_filters) <> 'object' or pg_column_size(v_filters) >= 2000 then raise exception 'bad_input' using errcode = '22023'; end if;
  end if;
  insert into public.search_preferences (user_id, history_enabled, favorite_actions, default_filters)
  values (v_uid, coalesce((p ->> 'history_enabled')::boolean, true), coalesce(v_actions, '{}'), coalesce(v_filters, '{}'))
  on conflict (user_id) do update set
    history_enabled = coalesce((p ->> 'history_enabled')::boolean, search_preferences.history_enabled),
    favorite_actions = coalesce(v_actions, search_preferences.favorite_actions),
    default_filters = coalesce(v_filters, search_preferences.default_filters),
    updated_at = now();
  -- Turning history off clears what was saved.
  if (p ->> 'history_enabled')::boolean is false then delete from public.search_history where user_id = v_uid; end if;
  return (select to_jsonb(sp) - 'user_id' from public.search_preferences sp where sp.user_id = v_uid);
end $$;
revoke execute on function public.search_save_preferences(jsonb) from public, anon;
grant execute on function public.search_save_preferences(jsonb) to authenticated;

-- 8. Owner administration: account lookup for platform admins only ----------------------------------------------
create or replace function public.search_admin_accounts(p_q text, p_limit integer default 8)
returns table (user_id uuid, email text, created_at timestamptz, company_name text)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare v_q text := lower(btrim(coalesce(p_q, '')));
begin
  if not coalesce(public.is_admin(auth.uid()), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(v_q) < 2 then return; end if;
  return query
  select u.id, u.email::text, u.created_at, co.name
    from auth.users u
    left join public.company_members m on m.user_id = u.id and m.status = 'active'
    left join public.companies co on co.id = m.company_id
   where lower(u.email) like '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or lower(co.name) like '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
   order by (lower(u.email) = v_q) desc, u.created_at desc
   limit greatest(1, least(coalesce(p_limit, 8), 25));
end $$;
revoke execute on function public.search_admin_accounts(text, integer) from public, anon;
grant execute on function public.search_admin_accounts(text, integer) to authenticated;
