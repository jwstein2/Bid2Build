-- Customer Hub: one company-scoped customer record per real customer, linked automatically from bids.
--
-- Root cause this fixes (confirmed in production 2026-11-17): bids keep the customer as text on the
-- estimate (customer_name / customer_email / customer_phone). estimates.customer_id was never set by any
-- code path (the builder's "Save to my customers" button inserted a customers row but did not link it,
-- and nothing else wrote customers at all), and the Customers page listed only that separate table. So
-- the table was empty and every bid customer was invisible there.
--
-- What this adds:
--   1. customers.source / customer_type / company_name, and an index for estimates.customer_id.
--   2. A trigger on estimates that links every named bid to one customer record in the bid's scope
--      (the company for company bids, the owner for personal bids). It matches an existing customer
--      only on reliable identity (same email or phone with a compatible name, or same name AND same
--      job address). A name alone never merges two customers: it creates a separate record that the
--      Customers page offers for review/merge.
--   3. RPCs to edit a customer (shared record; bids and signed proposals keep their own copy) and to
--      merge two records after the contractor confirms it.
--   4. Read access to a customer for anyone who can read one of their bids (company members are not
--      split per employee; cross-company access stays impossible because the bid itself is RLS-filtered).
--   5. A backfill that links existing bids the same way (oldest first). Signed proposal snapshots
--      (estimate_versions, signatures, generated documents) are never touched; bids keep their text.
--
-- Safe to run more than once. Rollback: docs/customer-hub/ROLLBACK.sql.

-- ---------------------------------------------------------------------------
-- 1. Columns and indexes
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists source text not null default 'manual';
alter table public.customers drop constraint if exists customers_source_check;
alter table public.customers add constraint customers_source_check check (source in ('manual', 'bid', 'backfill'));
alter table public.customers add column if not exists customer_type text not null default 'person';
alter table public.customers drop constraint if exists customers_customer_type_check;
alter table public.customers add constraint customers_customer_type_check check (customer_type in ('person', 'business'));
-- Business customers: the business name (customers.name stays the display name / main contact).
alter table public.customers add column if not exists company_name text;
alter table public.customers drop constraint if exists customers_company_name_check;
alter table public.customers add constraint customers_company_name_check check (char_length(company_name) <= 200);

create index if not exists estimates_customer_idx on public.estimates (customer_id) where customer_id is not null;
create index if not exists customers_email_idx on public.customers (lower(btrim(email))) where email is not null;

-- ---------------------------------------------------------------------------
-- 2. Identity helpers (pure)
-- ---------------------------------------------------------------------------
-- Lowercase, punctuation to single spaces: "Smith,  John." -> "smith john".
create or replace function public.customer_norm(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g')), '')
$$;

create or replace function public.customer_email_key(p text) returns text
language sql immutable set search_path = public as $$
  select case when position('@' in coalesce(p, '')) > 1 then lower(btrim(p)) end
$$;

-- Last 10 digits; null when fewer than 7 digits (not a usable phone number).
create or replace function public.customer_phone_key(p text) returns text
language sql immutable set search_path = public as $$
  select case when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 7
              then right(regexp_replace(p, '\D', '', 'g'), 10) end
$$;

-- Names are compatible when equal or when they share a word of 3+ letters ("John Smith" / "Smith residence").
create or replace function public.customer_names_compatible(a text, b text) returns boolean
language sql immutable set search_path = public as $$
  select public.customer_norm(a) = public.customer_norm(b)
      or exists (select 1 from unnest(string_to_array(public.customer_norm(a), ' ')) x
                 where length(x) >= 3 and x = any (string_to_array(public.customer_norm(b), ' ')))
$$;

-- The customer belongs to this bid scope: the company's records for company bids, the owner's personal
-- records for personal bids.
create or replace function public.customer_in_scope(p_customer uuid, p_user uuid, p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.customers c where c.id = p_customer
    and ((p_company is not null and c.company_id = p_company)
      or (p_company is null and c.company_id is null and c.user_id = p_user)))
$$;
revoke execute on function public.customer_in_scope(uuid, uuid, uuid) from public, anon, authenticated;

/**
 * Existing customer in the scope that reliably is this person, or null. Reliable means:
 *   - same email, and names compatible; or
 *   - same phone, and names compatible; or
 *   - same name AND same job address.
 * When several records qualify (older duplicates), the oldest exact-name one wins.
 */
create or replace function public.match_bid_customer(
  p_user uuid, p_company uuid, p_name text, p_email text, p_phone text, p_address text, p_exclude uuid default null
) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_email text := public.customer_email_key(p_email);
  v_phone text := public.customer_phone_key(p_phone);
  v_name text := public.customer_norm(p_name);
  v_addr text := public.customer_norm(p_address);
  v uuid;
begin
  if v_name is null then return null; end if;
  select c.id into v from public.customers c
  where ((p_company is not null and c.company_id = p_company) or (p_company is null and c.company_id is null and c.user_id = p_user))
    and c.id is distinct from p_exclude
    and (
      (v_email is not null and public.customer_email_key(c.email) = v_email and public.customer_names_compatible(c.name, p_name))
      or (v_phone is not null and public.customer_phone_key(c.phone) = v_phone and public.customer_names_compatible(c.name, p_name))
      or (v_addr is not null and public.customer_norm(c.name) = v_name and public.customer_norm(c.project_address) = v_addr)
    )
  order by (public.customer_norm(c.name) = v_name) desc, c.created_at, c.id
  limit 1;
  return v;
end $$;
revoke execute on function public.match_bid_customer(uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Link bids to customers automatically
-- ---------------------------------------------------------------------------
create or replace function public.link_estimate_customer() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := new.company_id;
  v_name text := left(btrim(coalesce(new.customer_name, '')), 200);
  v_email text := nullif(left(btrim(coalesce(new.customer_email, '')), 320), '');
  v_phone text := nullif(left(btrim(coalesce(new.customer_phone, '')), 50), '');
  v_addr text := nullif(left(btrim(coalesce(new.project_address, '')), 500), '');
  v_old uuid;
  v_reuse boolean := false;
  v_match uuid;
  v_new_company uuid;
  v_source text := case when coalesce(current_setting('app.customer_source', true), '') = 'backfill' then 'backfill' else 'bid' end;
begin
  if coalesce(current_setting('app.customer_link', true), '') = 'off' then return new; end if;
  if tg_op = 'INSERT' then
    -- save_estimate upserts: when the row already exists the UPDATE path decides (avoids side effects
    -- from an insert attempt that becomes an update).
    if exists (select 1 from public.estimates where id = new.id) then return new; end if;
  else
    v_old := old.customer_id;
  end if;

  begin
    -- A customer from another scope (or a stale id) is never linked.
    if new.customer_id is not null and not public.customer_in_scope(new.customer_id, new.user_id, v_company) then
      new.customer_id := null;
    end if;
    -- The builder may not know the link yet (it was made on the server): keep it while the name is unchanged.
    if new.customer_id is null and v_old is not null and public.customer_norm(new.customer_name) is not distinct from public.customer_norm(old.customer_name)
       and public.customer_in_scope(v_old, new.user_id, v_company) then
      new.customer_id := v_old;
    end if;
    if v_name = '' then
      -- No customer named on the bid: an automatic link is dropped (a picked customer stays).
      if new.customer_id is not null and new.customer_id = v_old
         and exists (select 1 from public.customers c where c.id = v_old and c.source <> 'manual') then
        new.customer_id := null;
      end if;
      return new;
    end if;

    if new.customer_id is null then
      -- The previous automatic record of this bid alone (e.g. the name is still being typed) is
      -- updated in place instead of leaving a record per keystroke.
      v_reuse := v_old is not null
        and public.customer_in_scope(v_old, new.user_id, v_company)
        and exists (select 1 from public.customers c where c.id = v_old and c.source <> 'manual')
        and not exists (select 1 from public.estimates e where e.customer_id = v_old and e.id <> new.id);
      v_match := public.match_bid_customer(new.user_id, v_company, v_name, v_email, v_phone, v_addr, v_old);
      if v_match is not null then
        new.customer_id := v_match;
      elsif v_reuse then
        update public.customers set name = v_name, email = v_email, phone = v_phone, project_address = v_addr where id = v_old;
        new.customer_id := v_old;
      else
        -- Backfilled records date from the bid that introduced the customer, not from the day of the update.
        insert into public.customers (user_id, company_id, created_by, name, email, phone, project_address, source, created_at, updated_at)
        values (new.user_id, v_company, new.user_id, v_name, v_email, v_phone, v_addr, v_source,
                case when v_source = 'backfill' then coalesce(new.created_at, now()) else now() end,
                case when v_source = 'backfill' then coalesce(new.created_at, now()) else now() end)
        returning id, company_id into new.customer_id, v_new_company;
        -- A personal bid of someone who has since joined a company keeps a personal customer.
        if v_company is null and v_new_company is not null then
          update public.customers set company_id = null where id = new.customer_id;
        end if;
      end if;
    elsif exists (select 1 from public.customers c where c.id = new.customer_id and c.source <> 'manual')
          and not exists (select 1 from public.estimates e where e.customer_id = new.customer_id and e.id <> new.id) then
      -- An automatic record used only by this bid mirrors the bid (nobody has edited it by hand).
      update public.customers set name = v_name, email = coalesce(v_email, email), phone = coalesce(v_phone, phone),
        project_address = coalesce(v_addr, project_address)
      where id = new.customer_id
        and (name, email, phone, project_address) is distinct from (v_name, coalesce(v_email, email), coalesce(v_phone, phone), coalesce(v_addr, project_address));
    else
      -- Shared or hand-edited record: only fill details it is missing; never overwrite.
      update public.customers set email = coalesce(nullif(email, ''), v_email), phone = coalesce(nullif(phone, ''), v_phone),
        project_address = coalesce(nullif(project_address, ''), v_addr)
      where id = new.customer_id
        and ((coalesce(email, '') = '' and v_email is not null) or (coalesce(phone, '') = '' and v_phone is not null)
          or (coalesce(project_address, '') = '' and v_addr is not null));
    end if;
  exception when others then
    -- Linking must never block saving a bid.
    raise warning 'link_estimate_customer(%): %', new.id, sqlerrm;
  end;
  return new;
end $$;

-- Automatic records nobody uses any more (bid deleted, or re-linked) are removed. Hand-made records,
-- and records with photos or communication history, are kept.
create or replace function public.drop_orphan_bid_customer(p_customer uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_customer is null then return; end if;
  delete from public.customers c where c.id = p_customer and c.source <> 'manual'
    and not exists (select 1 from public.estimates e where e.customer_id = c.id)
    and (to_regclass('public.project_photos') is null or not exists (select 1 from public.project_photos p where p.customer_id = c.id))
    and (to_regclass('public.comm_contacts') is null or not exists (select 1 from public.comm_contacts x where x.customer_id = c.id))
    and (to_regclass('public.comm_messages') is null or not exists (select 1 from public.comm_messages m where m.customer_id = c.id));
exception when others then
  raise warning 'drop_orphan_bid_customer(%): %', p_customer, sqlerrm;
end $$;
revoke execute on function public.drop_orphan_bid_customer(uuid) from public, anon, authenticated;

create or replace function public.estimate_customer_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform public.drop_orphan_bid_customer(old.customer_id);
  elsif old.customer_id is distinct from new.customer_id then perform public.drop_orphan_bid_customer(old.customer_id);
  end if;
  return null;
end $$;

-- "sync" sorts after "stamp_company", so the company is already set on new bids.
drop trigger if exists estimates_sync_customer on public.estimates;
create trigger estimates_sync_customer before insert or update on public.estimates
  for each row execute function public.link_estimate_customer();
drop trigger if exists estimates_customer_cleanup on public.estimates;
create trigger estimates_customer_cleanup after update of customer_id or delete on public.estimates
  for each row execute function public.estimate_customer_cleanup();

-- ---------------------------------------------------------------------------
-- 4. Read access: anyone who can read one of the customer's bids can read the customer
-- ---------------------------------------------------------------------------
drop policy if exists customers_linked_select on public.customers;
create policy customers_linked_select on public.customers for select to authenticated
  using (exists (select 1 from public.estimates e where e.customer_id = customers.id));

-- May the caller edit this customer? Owner of a personal record, or (company records) an active member
-- who can edit team bids and can see the record.
create or replace function public.can_edit_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when c.company_id is null then c.user_id = auth.uid()
      when not public.is_active_company_member(c.company_id) then false
      when c.user_id = auth.uid() then true
      else public.has_company_permission(c.company_id, 'edit_team_estimates')
    end
    from public.customers c where c.id = p_customer
  ), false)
$$;
revoke execute on function public.can_edit_customer(uuid) from public, anon;
grant execute on function public.can_edit_customer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Edit and merge (shared record; bids and signed proposals keep their own copy)
-- ---------------------------------------------------------------------------
create or replace function public.customer_update(p_customer uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text := left(btrim(coalesce(p ->> 'name', '')), 200);
begin
  if auth.uid() is null or not public.can_edit_customer(p_customer) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'name_required' using errcode = '22023'; end if;
  update public.customers set
    name = v_name,
    email = nullif(left(btrim(coalesce(p ->> 'email', '')), 320), ''),
    phone = nullif(left(btrim(coalesce(p ->> 'phone', '')), 50), ''),
    project_address = nullif(left(btrim(coalesce(p ->> 'projectAddress', '')), 500), ''),
    notes = nullif(left(coalesce(p ->> 'notes', ''), 4000), ''),
    customer_type = case when p ->> 'customerType' = 'business' then 'business' else 'person' end,
    company_name = nullif(left(btrim(coalesce(p ->> 'companyName', '')), 200), ''),
    -- Edited by a person: no longer mirrors a single bid, and never auto-deleted.
    source = 'manual'
  where id = p_customer;
end $$;
revoke execute on function public.customer_update(uuid, jsonb) from public, anon;
grant execute on function public.customer_update(uuid, jsonb) to authenticated;

/** Move everything from p_remove onto p_keep, fill p_keep's missing details, then delete p_remove. */
create or replace function public.customer_merge(p_keep uuid, p_remove uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.customers%rowtype; r public.customers%rowtype;
begin
  if auth.uid() is null or p_keep = p_remove or not public.can_edit_customer(p_keep) or not public.can_edit_customer(p_remove) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into k from public.customers where id = p_keep for update;
  select * into r from public.customers where id = p_remove for update;
  if k.company_id is distinct from r.company_id or (k.company_id is null and k.user_id <> r.user_id) then
    raise exception 'different_scope' using errcode = '42501';
  end if;
  perform set_config('app.customer_link', 'off', true);
  update public.estimates set customer_id = p_keep where customer_id = p_remove;
  perform set_config('app.customer_link', '', true);
  if to_regclass('public.project_photos') is not null then
    execute 'update public.project_photos set customer_id = $1 where customer_id = $2' using p_keep, p_remove;
  end if;
  if to_regclass('public.comm_contacts') is not null then
    execute 'update public.comm_contacts set customer_id = $1 where customer_id = $2' using p_keep, p_remove;
    execute 'update public.comm_messages set customer_id = $1 where customer_id = $2' using p_keep, p_remove;
  end if;
  update public.customers set
    email = coalesce(nullif(k.email, ''), r.email), phone = coalesce(nullif(k.phone, ''), r.phone),
    project_address = coalesce(nullif(k.project_address, ''), r.project_address),
    company_name = coalesce(nullif(k.company_name, ''), r.company_name),
    notes = nullif(left(concat_ws(E'\n', nullif(k.notes, ''), nullif(r.notes, '')), 4000), ''),
    source = 'manual'
  where id = p_keep;
  delete from public.customers where id = p_remove;
  if k.company_id is not null then
    insert into public.company_audit_log (company_id, actor_id, action, target_type, target_id, details)
    values (k.company_id, auth.uid(), 'customer.merged', 'customer', p_keep::text, jsonb_build_object('removed', p_remove, 'removed_name', r.name));
  end if;
end $$;
revoke execute on function public.customer_merge(uuid, uuid) from public, anon;
grant execute on function public.customer_merge(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Backfill existing bids (oldest first). Bid "last edited" times are preserved.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  alter table public.estimates disable trigger estimates_updated;
  perform set_config('app.customer_source', 'backfill', true);
  for r in select id from public.estimates where customer_id is null and btrim(customer_name) <> '' order by created_at, id loop
    update public.estimates set customer_id = null where id = r.id;
  end loop;
  perform set_config('app.customer_source', '', true);
  alter table public.estimates enable trigger estimates_updated;
end $$;

-- Communications contacts point at the matching customer record (same account, same email).
do $$
begin
  if to_regclass('public.comm_contacts') is not null then
    update public.comm_contacts x set customer_id = (
      select c.id from public.customers c
      where coalesce(c.company_id, c.user_id) = x.account_id and public.customer_email_key(c.email) = x.email
      order by c.created_at limit 1)
    where x.customer_id is null;
  end if;
end $$;
