-- Financial Command Center, Phase 1 (part 1 of 3): foundation.
--
--   * fin_books: the financial tenant. Exactly one per Enterprise company OR one per solo owner
--     (XOR, like pm_resources). Every financial row carries book_id. Companies stay Enterprise-only;
--     no "personal company" is ever created (that would move bids/customers between scopes).
--   * Permissions: 17 new keys appended to company_permission_keys() (no existing role gains any of
--     them, so nobody gains access on deploy). manage_payment_connections and manage_financial_seats
--     are owner-only to delegate.
--   * Financial seats (fin_seats) carry a role preset (owner, financial_admin, bookkeeper, accountant,
--     project_manager, sales_rep, view_only). They are separate from Enterprise licensed users and PM
--     editor seats and can only be given to active company members. Each book also has ONE free,
--     read-only accountant seat that does not count toward the limit (any verified login).
--   * fin_entitlement(): company = 3 included + fin_extra_seats on the Enterprise subscription (or a
--     complimentary grant's fin_seats); solo = 1 (owner). Mirrored from Stripe by apply_fin_update()
--     (same ordering guard as apply_pm_update). A lapsed add-on leaves the book readable (read-only).
--   * fin_has_permission(book, key, write): the ONE check every finance RPC and RLS policy uses.
--     Project managers assigned to a job get view-only job financials without a paid seat
--     (fin_job_visible, defined with fin_jobs in part 2).
--   * fin_audit_log (append-only), gapless numbering, the private financial-documents bucket and
--     fin_documents, Business & Trade Configuration (presentation only: never read by entitlement or
--     permission checks, never rewrites history), per-project presentation overrides, AI preferences
--     (every new financial toggle defaults OFF; photo labeling defaults ON because it is today's live
--     behavior and must not change on deploy), dashboard defaults / role layouts / per-user preferences with
--     company locks and non-hideable alerts, and the per-user Contractor/Accountant mode.
--
-- Money is numeric(14,2); amounts cross the API as strings. Writes only through SECURITY DEFINER
-- functions; RLS is read-only; no ON DELETE CASCADE from users, estimates, customers or companies into
-- financial records. Nothing here charges anyone or creates Stripe objects.
--
-- Safe to run more than once. Requires every earlier migration (through 20261122001000).
-- Rollback: docs/financials/rollback_20261124001000.sql

-- 1. Permission catalog -------------------------------------------------------------------------------
create or replace function public.company_permission_keys() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array[
    'view_own_bids', 'view_team_bids', 'view_company_bids', 'create_estimates', 'edit_team_estimates',
    'view_costs', 'view_margin', 'approve_bids', 'manage_company_pricing', 'view_analytics',
    'manage_teams', 'manage_users', 'manage_billing',
    'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'edit_all_schedules', 'manage_dependencies',
    'update_progress', 'publish_customer_updates', 'download_schedule_pdf',
    'view_internal_reports', 'download_internal_reports', 'send_internal_reports',
    'manage_pm_seats', 'manage_pm_addons',
    'review_approved_jobs', 'edit_live_schedules', 'confirm_task_completion',
    'create_change_orders', 'send_change_orders', 'share_subcontractor_scopes', 'upload_photos',
    'view_subcontractor_costs', 'edit_project_costs',
    'view_proposal_style', 'customize_proposal_style', 'manage_proposal_templates', 'change_proposal_policy',
    'view_communications', 'edit_nurture_templates', 'enable_customer_nurture', 'approve_marketing_outreach',
    'configure_project_updates', 'approve_customer_updates', 'enable_auto_project_updates',
    'view_customer_replies', 'manage_opt_outs',
    -- Financial Command Center (20261124001000_fin_foundation.sql)
    'view_company_financials', 'view_project_financials', 'create_invoices', 'record_payments',
    'record_expenses', 'approve_expenses', 'record_bills', 'approve_vendor_bills', 'manage_accounts',
    'post_journal_entries', 'reconcile', 'close_periods', 'export_financials', 'manage_financial_config',
    'manage_sub_compliance', 'manage_payment_connections', 'manage_financial_seats'
  ]
$$;

create or replace function public.company_owner_only_permissions() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array['manage_billing', 'manage_users', 'manage_pm_seats', 'manage_pm_addons', 'change_proposal_policy',
               'enable_customer_nurture', 'enable_auto_project_updates',
               'manage_payment_connections', 'manage_financial_seats']
$$;

create or replace function public.fin_permission_keys() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array['view_company_financials', 'view_project_financials', 'create_invoices', 'record_payments',
    'record_expenses', 'approve_expenses', 'record_bills', 'approve_vendor_bills', 'manage_accounts',
    'post_journal_entries', 'reconcile', 'close_periods', 'export_financials', 'manage_financial_config',
    'manage_sub_compliance', 'manage_payment_connections', 'manage_financial_seats']
$$;

-- Role presets on the financial seat (company_members.role is unchanged). Mirrored in
-- src/lib/financials/permissions.ts.
create or replace function public.fin_role_permissions(p_role text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case p_role
    when 'owner' then public.fin_permission_keys()
    when 'financial_admin' then array['view_company_financials', 'view_project_financials', 'create_invoices', 'record_payments',
      'record_expenses', 'approve_expenses', 'record_bills', 'approve_vendor_bills', 'manage_accounts', 'post_journal_entries',
      'reconcile', 'close_periods', 'export_financials', 'manage_financial_config', 'manage_sub_compliance']
    when 'bookkeeper' then array['view_company_financials', 'view_project_financials', 'create_invoices', 'record_payments',
      'record_expenses', 'record_bills', 'reconcile', 'export_financials', 'manage_sub_compliance']
    when 'accountant' then array['view_company_financials', 'view_project_financials', 'manage_accounts', 'post_journal_entries',
      'reconcile', 'close_periods', 'export_financials']
    when 'accountant_readonly' then array['view_company_financials', 'view_project_financials', 'export_financials']
    when 'project_manager' then array['view_project_financials', 'record_expenses', 'manage_sub_compliance']
    when 'sales_rep' then array['view_project_financials']
    when 'view_only' then array['view_company_financials', 'view_project_financials']
    else array[]::text[]
  end
$$;

-- 2. Books --------------------------------------------------------------------------------------------
create table if not exists public.fin_books (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid unique references public.companies (id) on delete restrict,
  owner_user_id           uuid unique references auth.users (id) on delete restrict,
  name                    text not null check (char_length(name) between 1 and 200),
  currency                char(3) not null default 'USD' check (currency = 'USD'),
  timezone                text not null default 'America/Chicago' check (char_length(timezone) <= 64),
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  locked_through          date,
  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint fin_books_scope check ((company_id is null) <> (owner_user_id is null))
);
drop trigger if exists fin_books_updated on public.fin_books;
create trigger fin_books_updated before update on public.fin_books for each row execute function public.set_updated_at();

-- 3. Billing mirror + entitlement -------------------------------------------------------------------
alter table public.subscriptions add column if not exists fin_addon boolean not null default false;
alter table public.subscriptions add column if not exists fin_addon_until timestamptz;
alter table public.subscriptions add column if not exists fin_extra_seats integer not null default 0;
do $$ begin
  alter table public.subscriptions add constraint subscriptions_fin_extra_seats_check check (fin_extra_seats between 0 and 1000);
exception when duplicate_object then null; end $$;
alter table public.complimentary_grants add column if not exists fin_seats integer;
do $$ begin
  alter table public.complimentary_grants add constraint complimentary_grants_fin_seats_check check (fin_seats is null or fin_seats between 0 and 50);
exception when duplicate_object then null; end $$;

-- Written only by the Stripe webhook / server (no Stripe prices exist yet; nothing calls this in prod).
create or replace function public.apply_fin_update(p_stripe_subscription_id text, p_fin_addon boolean, p_fin_extra_seats integer, p_event_created timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  update public.subscriptions s set
    fin_addon_until = case when coalesce(p_fin_addon, false) then null
                           when s.fin_addon then coalesce(s.current_period_end, now()) else s.fin_addon_until end,
    fin_addon = coalesce(p_fin_addon, false),
    fin_extra_seats = greatest(coalesce(p_fin_extra_seats, 0), 0)
  where s.stripe_subscription_id = p_stripe_subscription_id and s.source_event_created <= p_event_created;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;
revoke all on function public.apply_fin_update(text, boolean, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_fin_update(text, boolean, integer, timestamptz) to service_role;

-- active: writes allowed. read_only: the book keeps its data readable after a lapse.
create or replace function public.fin_entitlement(p_book_id uuid)
returns table (active boolean, read_only boolean, source text, seat_limit integer, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare b public.fin_books; v_paid integer; v_paid_end timestamptz; v_comp integer; v_comp_end timestamptz; v_ent record;
begin
  select * into b from public.fin_books where id = p_book_id;
  if not found then return query select false, false, null::text, 0, null::timestamptz; return; end if;
  if b.company_id is not null then
    select * into v_ent from public.company_entitlement(b.company_id);
    if coalesce(v_ent.active, false) then
      select 3 + coalesce(max(s.fin_extra_seats), 0), max(s.current_period_end) into v_paid, v_paid_end from public.subscriptions s
       where s.company_id = b.company_id and s.plan = 'enterprise' and s.status in ('active', 'trialing', 'past_due')
         and (s.current_period_end is null or s.current_period_end > now())
         and (s.fin_addon or (s.fin_addon_until is not null and s.fin_addon_until > now()))
      having count(*) > 0;
      select greatest(max(g.fin_seats), 3), max(g.expires_at) into v_comp, v_comp_end from public.complimentary_grants g
       where g.company_id = b.company_id and g.plan = 'enterprise' and g.status = 'active' and coalesce(g.fin_seats, 0) > 0
         and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now())
      having count(*) > 0;
    end if;
  else
    select 1, max(s.current_period_end) into v_paid, v_paid_end from public.subscriptions s
     where s.user_id = b.owner_user_id and coalesce(s.plan, '') <> 'enterprise' and s.status in ('active', 'trialing', 'past_due')
       and (s.current_period_end is null or s.current_period_end > now())
       and (s.fin_addon or (s.fin_addon_until is not null and s.fin_addon_until > now()))
    having count(*) > 0;
    select 1, max(g.expires_at) into v_comp, v_comp_end from public.complimentary_grants g
     where g.user_id = b.owner_user_id and g.status = 'active' and coalesce(g.fin_seats, 0) > 0
       and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now())
    having count(*) > 0;
  end if;
  if v_paid is null and v_comp is null then
    return query select false, true, null::text, 0, null::timestamptz;
  elsif coalesce(v_paid, 0) >= coalesce(v_comp, 0) then
    return query select true, false, 'stripe'::text, v_paid, v_paid_end;
  else
    return query select true, false, 'complimentary'::text, v_comp, v_comp_end;
  end if;
end $$;
revoke execute on function public.fin_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.fin_entitlement(uuid) to service_role;

-- 4. Seats --------------------------------------------------------------------------------------------
create table if not exists public.fin_seats (
  book_id            uuid not null references public.fin_books (id) on delete restrict,
  user_id            uuid not null references auth.users (id) on delete cascade,   -- a seat is access, not a record (history: fin_audit_log)
  fin_role           text not null check (fin_role in ('owner', 'financial_admin', 'bookkeeper', 'accountant', 'project_manager', 'sales_rep', 'view_only')),
  is_accountant_seat boolean not null default false,   -- the free read-only accountant seat (does not count toward the limit)
  assigned_by        uuid references auth.users (id) on delete set null,
  assigned_at        timestamptz not null default now(),
  primary key (book_id, user_id),
  constraint fin_seats_accountant check (not is_accountant_seat or fin_role = 'accountant')
);
create unique index if not exists fin_seats_one_free_accountant on public.fin_seats (book_id) where is_accountant_seat;
create unique index if not exists fin_seats_one_owner on public.fin_seats (book_id) where fin_role = 'owner';

-- Paid seats that are covered by the current limit (earliest assignments win; the owner first).
create or replace function public.fin_seat_covered(p_book_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with e as (select * from public.fin_entitlement(p_book_id)),
  ranked as (
    select s.user_id, row_number() over (order by (s.fin_role = 'owner') desc, s.assigned_at, s.user_id) rn
    from public.fin_seats s
    join public.fin_books b on b.id = s.book_id
    left join public.company_members m on m.company_id = b.company_id and m.user_id = s.user_id
    where s.book_id = p_book_id and not s.is_accountant_seat and (b.company_id is null or m.status = 'active')
  )
  select coalesce((select case when (select active from e) then r.rn <= (select seat_limit from e) else true end
                   from ranked r where r.user_id = p_user_id), false)
$$;
revoke execute on function public.fin_seat_covered(uuid, uuid) from public, anon, authenticated;

-- 5. The permission check -------------------------------------------------------------------------------
-- p_write: the action changes data, so the add-on must be active (a lapsed book is read-only).
create or replace function public.fin_has_permission(p_book_id uuid, p_key text, p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); b public.fin_books; s public.fin_seats; m public.company_members; v_perms text[];
begin
  if v_uid is null or p_book_id is null or not (p_key = any (public.fin_permission_keys())) then return false; end if;
  select * into b from public.fin_books where id = p_book_id;
  if not found then return false; end if;
  if p_write and not coalesce((select e.active from public.fin_entitlement(p_book_id) e), false) then return false; end if;
  if b.owner_user_id is not null and b.owner_user_id = v_uid then return true; end if;
  if b.company_id is not null then
    select * into m from public.company_members where company_id = b.company_id and user_id = v_uid and status = 'active';
    if found and m.role = 'owner' then return true; end if;   -- owner override
  end if;
  select * into s from public.fin_seats where book_id = p_book_id and user_id = v_uid;
  if not found then return false; end if;
  if s.is_accountant_seat then
    return not p_write and p_key = any (public.fin_role_permissions('accountant_readonly'));
  end if;
  if b.company_id is not null and m.user_id is null then return false; end if;   -- deactivated / not a member
  if not public.fin_seat_covered(p_book_id, v_uid) then return false; end if;
  v_perms := public.fin_role_permissions(s.fin_role);
  if m.user_id is not null then
    v_perms := array(select k from unnest(public.fin_permission_keys()) k
                     where (k = any (v_perms) or k = any (m.permissions_granted)) and not (k = any (m.permissions_revoked)));
  end if;
  return p_key = any (v_perms);
end $$;
revoke execute on function public.fin_has_permission(uuid, text, boolean) from public, anon;
grant execute on function public.fin_has_permission(uuid, text, boolean) to authenticated;

-- Raise unless the caller holds the permission (shared by every RPC).
create or replace function public.fin_require(p_book_id uuid, p_key text, p_write boolean default true) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.fin_has_permission(p_book_id, p_key, p_write) then
    if p_write and public.fin_has_permission(p_book_id, p_key, false) then raise exception 'read_only' using errcode = '42501'; end if;
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.fin_require(uuid, text, boolean) from public, anon, authenticated;

-- 6. Audit log (append-only) ---------------------------------------------------------------------------
create table if not exists public.fin_audit_log (
  id          bigint generated always as identity primary key,
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null check (char_length(action) <= 80),
  entity_type text not null check (char_length(entity_type) <= 40),
  entity_id   uuid,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists fin_audit_log_book_idx on public.fin_audit_log (book_id, created_at desc);
create index if not exists fin_audit_log_entity_idx on public.fin_audit_log (entity_type, entity_id);

-- Never updated or deleted, not even through a cascade (unlike guard_write_once()).
create or replace function public.fin_guard_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'record_immutable' using errcode = 'P0001';
end $$;
drop trigger if exists fin_audit_log_append_only on public.fin_audit_log;
create trigger fin_audit_log_append_only before update or delete on public.fin_audit_log
  for each row execute function public.fin_guard_immutable();

create or replace function public.fin_audit(p_book_id uuid, p_action text, p_entity_type text, p_entity_id uuid, p_details jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.fin_audit_log (book_id, actor_id, action, entity_type, entity_id, details)
  values (p_book_id, auth.uid(), p_action, p_entity_type, p_entity_id, p_details)
$$;
revoke execute on function public.fin_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- 7. Book resolution and activation -----------------------------------------------------------------------
create or replace function public.fin_ensure_book(p_company_id uuid, p_owner_user_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_owner uuid;
begin
  if (p_company_id is null) = (p_owner_user_id is null) then raise exception 'bad_scope' using errcode = '22023'; end if;
  if p_company_id is not null then
    select id into v_id from public.fin_books where company_id = p_company_id;
    if v_id is not null then return v_id; end if;
    select c.name, c.owner_user_id into v_name, v_owner from public.companies c where c.id = p_company_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    insert into public.fin_books (company_id, name, created_by) values (p_company_id, left(v_name, 200), auth.uid())
      on conflict (company_id) do nothing returning id into v_id;
    if v_id is null then select id into v_id from public.fin_books where company_id = p_company_id; return v_id; end if;
    insert into public.fin_seats (book_id, user_id, fin_role, assigned_by) values (v_id, v_owner, 'owner', auth.uid()) on conflict do nothing;
  else
    select id into v_id from public.fin_books where owner_user_id = p_owner_user_id;
    if v_id is not null then return v_id; end if;
    select coalesce(nullif(btrim(bp.company_name), ''), 'My Books') into v_name from public.business_profiles bp where bp.user_id = p_owner_user_id;
    insert into public.fin_books (owner_user_id, name, created_by) values (p_owner_user_id, left(coalesce(v_name, 'My Books'), 200), auth.uid())
      on conflict (owner_user_id) do nothing returning id into v_id;
    if v_id is null then select id into v_id from public.fin_books where owner_user_id = p_owner_user_id; return v_id; end if;
  end if;
  insert into public.fin_audit_log (book_id, actor_id, action, entity_type, entity_id) values (v_id, auth.uid(), 'book.created', 'book', v_id);
  return v_id;
end $$;
revoke execute on function public.fin_ensure_book(uuid, uuid) from public, anon, authenticated;

-- Company bid -> the company's book; personal bid -> the bid owner's personal book.
create or replace function public.fin_book_for_estimate(p_estimate_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  select id, user_id, company_id into e from public.estimates where id = p_estimate_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return public.fin_ensure_book(e.company_id, case when e.company_id is null then e.user_id end);
end $$;
revoke execute on function public.fin_book_for_estimate(uuid) from public, anon, authenticated;

-- The caller's book: their company's (active member) or their personal one. Creates it when the caller
-- may (company owner / manage_financial_seats / manage_financial_config; solo: themselves).
create or replace function public.fin_my_book(p_personal boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  v_company := case when p_personal then null else public.my_company_id() end;
  if v_company is null then return public.fin_ensure_book(null, v_uid); end if;
  select id into v_id from public.fin_books where company_id = v_company;
  if v_id is not null then return v_id; end if;
  if not (public.has_company_permission(v_company, 'manage_financial_seats') or public.has_company_permission(v_company, 'manage_financial_config')) then
    return null;
  end if;
  return public.fin_ensure_book(v_company, null);
end $$;
revoke execute on function public.fin_my_book(boolean) from public, anon;
grant execute on function public.fin_my_book(boolean) to authenticated;

-- What the caller may do in a book (drives the UI; every write re-checks).
create or replace function public.fin_access(p_book_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e record; b public.fin_books; s public.fin_seats;
begin
  select * into b from public.fin_books where id = p_book_id;
  if not found or auth.uid() is null then return null; end if;
  select * into e from public.fin_entitlement(p_book_id);
  select * into s from public.fin_seats where book_id = p_book_id and user_id = auth.uid();
  return jsonb_build_object('bookId', b.id, 'name', b.name, 'kind', case when b.company_id is null then 'solo' else 'company' end,
    'active', e.active, 'readOnly', e.read_only, 'seatLimit', e.seat_limit, 'source', e.source,
    'role', case when b.owner_user_id = auth.uid() then 'owner' else s.fin_role end,
    'accountantSeat', coalesce(s.is_accountant_seat, false),
    'permissions', to_jsonb(array(select k from unnest(public.fin_permission_keys()) k where public.fin_has_permission(p_book_id, k, false))));
end $$;
revoke execute on function public.fin_access(uuid) from public, anon;
grant execute on function public.fin_access(uuid) to authenticated;

-- 8. Seat administration ---------------------------------------------------------------------------------
create or replace function public.fin_seat_assign(p_book_id uuid, p_user_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.fin_books; e record; v_used integer; v_exists boolean;
begin
  perform public.fin_require(p_book_id, 'manage_financial_seats', true);
  select * into b from public.fin_books where id = p_book_id for update;   -- serialize seat changes
  if b.company_id is null then raise exception 'solo_book' using errcode = '22023'; end if;
  if p_role not in ('financial_admin', 'bookkeeper', 'accountant', 'project_manager', 'sales_rep', 'view_only') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if not exists (select 1 from public.company_members where company_id = b.company_id and user_id = p_user_id and status = 'active' and role <> 'owner') then
    raise exception 'not_member' using errcode = 'P0002';
  end if;
  select exists (select 1 from public.fin_seats where book_id = p_book_id and user_id = p_user_id and not is_accountant_seat) into v_exists;
  if not v_exists then
    select * into e from public.fin_entitlement(p_book_id);
    select count(*) into v_used from public.fin_seats s join public.company_members m on m.company_id = b.company_id and m.user_id = s.user_id and m.status = 'active'
     where s.book_id = p_book_id and not s.is_accountant_seat;
    if v_used + 1 > e.seat_limit then raise exception 'seat_limit' using errcode = 'P0001'; end if;
  end if;
  insert into public.fin_seats (book_id, user_id, fin_role, assigned_by) values (p_book_id, p_user_id, p_role, auth.uid())
    on conflict (book_id, user_id) do update set fin_role = excluded.fin_role
    where not fin_seats.is_accountant_seat;
  if not found then raise exception 'accountant_seat' using errcode = '22023'; end if;
  perform public.fin_audit(p_book_id, 'seat.assigned', 'user', p_user_id, jsonb_build_object('role', p_role));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fin_seat_remove(p_book_id uuid, p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.fin_require(p_book_id, 'manage_financial_seats', false);   -- removing access is allowed after a lapse
  delete from public.fin_seats where book_id = p_book_id and user_id = p_user_id and fin_role <> 'owner';
  if not found then return jsonb_build_object('ok', true, 'changed', false); end if;
  perform public.fin_audit(p_book_id, 'seat.removed', 'user', p_user_id, null);
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

-- The free read-only accountant seat: any login with this verified email (company member or not).
create or replace function public.fin_accountant_seat_assign(p_book_id uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  perform public.fin_require(p_book_id, 'manage_financial_seats', true);
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null;
  if v_user is null then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.fin_seats where book_id = p_book_id and user_id = v_user) then
    raise exception 'already_seated' using errcode = 'P0001';
  end if;
  delete from public.fin_seats where book_id = p_book_id and is_accountant_seat;   -- replaces the previous accountant
  insert into public.fin_seats (book_id, user_id, fin_role, is_accountant_seat, assigned_by) values (p_book_id, v_user, 'accountant', true, auth.uid());
  perform public.fin_audit(p_book_id, 'seat.accountant_assigned', 'user', v_user, null);
  return jsonb_build_object('ok', true, 'userId', v_user);
end $$;
revoke execute on function public.fin_seat_assign(uuid, uuid, text), public.fin_seat_remove(uuid, uuid), public.fin_accountant_seat_assign(uuid, text) from public, anon;
grant execute on function public.fin_seat_assign(uuid, uuid, text), public.fin_seat_remove(uuid, uuid), public.fin_accountant_seat_assign(uuid, text) to authenticated;

-- 9. Gapless numbering ---------------------------------------------------------------------------------------
create table if not exists public.fin_number_sequences (
  book_id    uuid not null references public.fin_books (id) on delete restrict,
  doc_type   text not null check (doc_type in ('job', 'invoice', 'credit_memo', 'payment', 'refund', 'bill', 'expense', 'commitment')),
  prefix     text not null default '' check (char_length(prefix) <= 12),
  next_value bigint not null default 1 check (next_value >= 1),
  pad        smallint not null default 4 check (pad between 1 and 10),
  primary key (book_id, doc_type)
);
-- The row lock is held until the calling transaction ends: no gaps, no duplicates under concurrency.
create or replace function public.fin_next_number(p_book_id uuid, p_doc_type text, out seq bigint, out label text)
language plpgsql security definer set search_path = public as $$
begin
  insert into public.fin_number_sequences (book_id, doc_type, prefix)
  values (p_book_id, p_doc_type, case p_doc_type when 'invoice' then 'INV-' when 'credit_memo' then 'CM-' when 'payment' then 'PMT-'
    when 'refund' then 'RF-' when 'bill' then 'BILL-' when 'expense' then 'EXP-' when 'commitment' then 'SC-' else 'JOB-' end)
  on conflict do nothing;
  update public.fin_number_sequences set next_value = next_value + 1
   where book_id = p_book_id and doc_type = p_doc_type
   returning next_value - 1, prefix || lpad((next_value - 1)::text, pad, '0') into seq, label;
end $$;
revoke execute on function public.fin_next_number(uuid, text) from public, anon, authenticated;

-- 10. Documents (private bucket financial-documents, path '<book_id>/<kind>/<uuid>.<ext>') ----------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('financial-documents', 'financial-documents', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv'])
on conflict (id) do nothing;

create table if not exists public.fin_documents (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.fin_books (id) on delete restrict,
  kind          text not null check (kind in ('receipt', 'vendor_bill', 'invoice_pdf', 'credit_memo_pdf', 'payment_proof', 'w9',
                                              'lien_waiver', 'contract', 'bank_statement', 'other')),
  storage_path  text not null unique check (char_length(storage_path) <= 500),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_type  text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv')),
  bytes         integer not null check (bytes between 1 and 20971520),
  original_name text check (char_length(original_name) <= 200),
  entity_type   text check (entity_type in ('job', 'invoice', 'credit_memo', 'payment', 'refund', 'vendor', 'bill', 'expense', 'commitment')),
  entity_id     uuid,
  uploaded_by   uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  archived_at   timestamptz,
  constraint fin_documents_path check (storage_path like book_id::text || '/%')
);
create index if not exists fin_documents_entity_idx on public.fin_documents (entity_type, entity_id);
create unique index if not exists fin_documents_same_file on public.fin_documents (book_id, sha256, coalesce(entity_type, ''), coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Content is write-once; only archived_at may change; never deleted.
create or replace function public.fin_documents_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'archived_at') is distinct from (to_jsonb(old) - 'archived_at') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists fin_documents_guard on public.fin_documents;
create trigger fin_documents_guard before update or delete on public.fin_documents for each row execute function public.fin_documents_guard();

-- The server uploads the file (service role, content sniffed), then registers it as the caller.
create or replace function public.fin_document_register(p_book_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_kind text := p ->> 'kind';
begin
  perform public.fin_require(p_book_id, case when v_kind in ('receipt', 'vendor_bill', 'w9', 'lien_waiver') then 'record_expenses' else 'create_invoices' end, true);
  insert into public.fin_documents (book_id, kind, storage_path, sha256, content_type, bytes, original_name, entity_type, entity_id, uploaded_by)
  values (p_book_id, v_kind, p ->> 'storagePath', p ->> 'sha256', p ->> 'contentType', (p ->> 'bytes')::integer,
          left(nullif(btrim(p ->> 'originalName'), ''), 200), nullif(p ->> 'entityType', ''), nullif(p ->> 'entityId', '')::uuid, auth.uid())
  on conflict do nothing returning id into v_id;
  if v_id is null then   -- same file already attached here: return it (idempotent upload retry)
    select id into v_id from public.fin_documents where storage_path = p ->> 'storagePath'
       or (book_id = p_book_id and sha256 = p ->> 'sha256' and coalesce(entity_type, '') = coalesce(nullif(p ->> 'entityType', ''), '')
           and coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(nullif(p ->> 'entityId', '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
     limit 1;
    return v_id;
  end if;
  perform public.fin_audit(p_book_id, 'document.registered', 'document', v_id, jsonb_build_object('kind', v_kind));
  return v_id;
end $$;
revoke execute on function public.fin_document_register(uuid, jsonb) from public, anon;
grant execute on function public.fin_document_register(uuid, jsonb) to authenticated;

-- Storage: read a stored object only through a registered document the caller may view. No
-- insert/update/delete policies (the server writes with the service role).
drop policy if exists financial_documents_read on storage.objects;
create policy financial_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'financial-documents' and exists (
    select 1 from public.fin_documents d where d.storage_path = storage.objects.name
      and public.fin_has_permission(d.book_id, 'view_company_financials')));

-- 11. Business & Trade Configuration (presentation only) ----------------------------------------------------
create table if not exists public.fin_business_config (
  book_id                uuid primary key references public.fin_books (id) on delete restrict,
  primary_trade_slug     text references public.trade_categories (slug) on update cascade,
  additional_trade_slugs text[] not null default '{}' check (cardinality(additional_trade_slugs) <= 30),
  market                 text not null default 'residential' check (market in ('residential', 'commercial', 'mixed')),
  project_model          text not null default 'fixed_price' check (project_model in ('fixed_price', 'time_materials', 'cost_plus', 'service_call', 'mixed')),
  payment_structure      text not null default 'deposit_progress_final' check (payment_structure in ('deposit_progress_final', 'milestones', 'progress_sov', 'on_completion', 'time_materials', 'cost_plus', 'mixed')),
  labor_model            text not null default 'both' check (labor_model in ('employees', 'subcontractors', 'both')),
  uses_inventory         boolean not null default false,
  uses_equipment         boolean not null default false,
  preset_key             text check (preset_key in ('general_contractor', 'residential_remodeler', 'deck', 'roofing_siding', 'electrical', 'plumbing',
                                                    'hvac', 'concrete', 'painting', 'exterior_cleaning', 'drywall', 'commercial', 'custom')),
  preset_version         integer,
  updated_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
drop trigger if exists fin_business_config_updated on public.fin_business_config;
create trigger fin_business_config_updated before update on public.fin_business_config for each row execute function public.set_updated_at();

-- Project-level presentation overrides, keyed by the estimate so they can exist before a job is opened.
-- Presentation only (never a financial record), so it follows the estimate if the bid is deleted.
create table if not exists public.fin_project_profiles (
  estimate_id        uuid primary key references public.estimates (id) on delete cascade,
  book_id            uuid not null references public.fin_books (id) on delete restrict,
  primary_trade_slug text references public.trade_categories (slug) on update cascade,
  market             text check (market in ('residential', 'commercial', 'mixed')),
  project_model      text check (project_model in ('fixed_price', 'time_materials', 'cost_plus', 'service_call')),
  payment_structure  text check (payment_structure in ('deposit_progress_final', 'milestones', 'progress_sov', 'on_completion', 'time_materials', 'cost_plus')),
  workflow           text check (workflow in ('residential', 'commercial', 'service')),
  updated_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now()
);

create or replace function public.fin_trade_slugs_valid(p text[]) returns boolean
language sql stable set search_path = public as $$
  select not exists (select 1 from unnest(coalesce(p, '{}')) s where not exists (select 1 from public.trade_categories t where t.slug = s))
$$;

create or replace function public.fin_business_config_save(p_book_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_add text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'additionalTradeSlugs', '[]'::jsonb))), '{}');
begin
  perform public.fin_require(p_book_id, 'manage_financial_config', false);   -- presentation settings work even when read-only
  if not public.fin_trade_slugs_valid(v_add || array_remove(array[nullif(p ->> 'primaryTradeSlug', '')], null)) then
    raise exception 'unknown_trade' using errcode = '22023';
  end if;
  insert into public.fin_business_config as c (book_id, primary_trade_slug, additional_trade_slugs, market, project_model, payment_structure,
    labor_model, uses_inventory, uses_equipment, preset_key, preset_version, updated_by)
  values (p_book_id, nullif(p ->> 'primaryTradeSlug', ''), array(select distinct unnest(v_add) order by 1),
    coalesce(nullif(p ->> 'market', ''), 'residential'), coalesce(nullif(p ->> 'projectModel', ''), 'fixed_price'),
    coalesce(nullif(p ->> 'paymentStructure', ''), 'deposit_progress_final'), coalesce(nullif(p ->> 'laborModel', ''), 'both'),
    coalesce((p ->> 'usesInventory')::boolean, false), coalesce((p ->> 'usesEquipment')::boolean, false),
    nullif(p ->> 'presetKey', ''), nullif(p ->> 'presetVersion', '')::integer, auth.uid())
  on conflict (book_id) do update set primary_trade_slug = excluded.primary_trade_slug, additional_trade_slugs = excluded.additional_trade_slugs,
    market = excluded.market, project_model = excluded.project_model, payment_structure = excluded.payment_structure,
    labor_model = excluded.labor_model, uses_inventory = excluded.uses_inventory, uses_equipment = excluded.uses_equipment,
    preset_key = excluded.preset_key, preset_version = excluded.preset_version, updated_by = excluded.updated_by;
  perform public.fin_audit(p_book_id, 'config.saved', 'book', p_book_id, p);
end $$;

create or replace function public.fin_project_profile_save(p_estimate_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_book uuid;
begin
  if not public.estimate_readable(p_estimate_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_book := public.fin_book_for_estimate(p_estimate_id);
  perform public.fin_require(v_book, 'manage_financial_config', false);
  if nullif(p ->> 'primaryTradeSlug', '') is not null and not public.fin_trade_slugs_valid(array[p ->> 'primaryTradeSlug']) then
    raise exception 'unknown_trade' using errcode = '22023';
  end if;
  insert into public.fin_project_profiles as x (estimate_id, book_id, primary_trade_slug, market, project_model, payment_structure, workflow, updated_by)
  values (p_estimate_id, v_book, nullif(p ->> 'primaryTradeSlug', ''), nullif(p ->> 'market', ''), nullif(p ->> 'projectModel', ''),
          nullif(p ->> 'paymentStructure', ''), nullif(p ->> 'workflow', ''), auth.uid())
  on conflict (estimate_id) do update set primary_trade_slug = excluded.primary_trade_slug, market = excluded.market,
    project_model = excluded.project_model, payment_structure = excluded.payment_structure, workflow = excluded.workflow,
    updated_by = excluded.updated_by, updated_at = now();
  perform public.fin_audit(v_book, 'project_profile.saved', 'estimate', p_estimate_id, p);
end $$;
revoke execute on function public.fin_business_config_save(uuid, jsonb), public.fin_project_profile_save(uuid, jsonb) from public, anon;
grant execute on function public.fin_business_config_save(uuid, jsonb), public.fin_project_profile_save(uuid, jsonb) to authenticated;

-- 12. AI & Automation preferences (every financial AI toggle defaults OFF) -----------------------------------
-- Exception: photo_labeling defaults ON. Photo label suggestions are live today (PHOTO_AI_LABELS), so a
-- company that never opens AI & Automation keeps exactly today's behavior; only an explicit OFF stops them.
create table if not exists public.fin_ai_preferences (
  book_id                uuid primary key references public.fin_books (id) on delete restrict,
  expense_suggestions    boolean not null default false,
  document_extraction    boolean not null default false,
  communication_drafting boolean not null default false,
  photo_labeling         boolean not null default true,
  updated_by             uuid references auth.users (id) on delete set null,
  updated_at             timestamptz not null default now()
);

-- A book without a row has every financial AI feature off, and photo labeling on (today's live behavior).
create or replace function public.fin_ai_enabled(p_book_id uuid, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case p_feature when 'expense_suggestions' then a.expense_suggestions when 'document_extraction' then a.document_extraction
                     when 'communication_drafting' then a.communication_drafting when 'photo_labeling' then a.photo_labeling else false end
                   from public.fin_ai_preferences a where a.book_id = p_book_id), p_feature = 'photo_labeling')
$$;

create or replace function public.fin_ai_preferences_save(p_book_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.fin_require(p_book_id, 'manage_financial_config', false);
  insert into public.fin_ai_preferences as a (book_id, expense_suggestions, document_extraction, communication_drafting, photo_labeling, updated_by)
  values (p_book_id, coalesce((p ->> 'expenseSuggestions')::boolean, false), coalesce((p ->> 'documentExtraction')::boolean, false),
          coalesce((p ->> 'communicationDrafting')::boolean, false), coalesce((p ->> 'photoLabeling')::boolean, true), auth.uid())
  on conflict (book_id) do update set
    expense_suggestions = coalesce((p ->> 'expenseSuggestions')::boolean, a.expense_suggestions),
    document_extraction = coalesce((p ->> 'documentExtraction')::boolean, a.document_extraction),
    communication_drafting = coalesce((p ->> 'communicationDrafting')::boolean, a.communication_drafting),
    photo_labeling = coalesce((p ->> 'photoLabeling')::boolean, a.photo_labeling),
    updated_by = excluded.updated_by, updated_at = now();
  perform public.fin_audit(p_book_id, 'ai_preferences.saved', 'book', p_book_id, p);
end $$;
revoke execute on function public.fin_ai_enabled(uuid, text), public.fin_ai_preferences_save(uuid, jsonb) from public, anon;
grant execute on function public.fin_ai_enabled(uuid, text), public.fin_ai_preferences_save(uuid, jsonb) to authenticated;

-- 13. Dashboard: company defaults + locks, role layouts, per-user preferences; Contractor/Accountant mode ----
-- Alerts that no layout, lock or preference can hide (enforced here, mirrored in src/lib/financials/profiles).
create or replace function public.fin_essential_alert_keys() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array['overdue_invoices', 'unapplied_payments', 'unverified_payments', 'bills_due', 'needs_review',
               'commitment_overruns', 'uncoded_costs', 'read_only_books']
$$;

create table if not exists public.fin_dashboard_prefs (
  id                 uuid primary key default gen_random_uuid(),
  book_id            uuid not null references public.fin_books (id) on delete restrict,
  scope              text not null check (scope in ('company', 'role', 'user')),
  role               text check (role in ('owner', 'financial_admin', 'bookkeeper', 'accountant', 'project_manager', 'sales_rep', 'view_only')),
  user_id            uuid references auth.users (id) on delete cascade,
  cards              jsonb not null default '[]' check (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) <= 60),   -- [{key, visible}] in order
  kpis               text[] not null default '{}' check (cardinality(kpis) <= 20),
  saved_views        jsonb not null default '[]' check (jsonb_typeof(saved_views) = 'array' and jsonb_array_length(saved_views) <= 30), -- [{name, filters:{estimateIds, trades, from, to}}]
  collapsed_sections text[] not null default '{}' check (cardinality(collapsed_sections) <= 30),
  locked_cards       text[] not null default '{}' check (cardinality(locked_cards) <= 60),   -- company scope only: users can't hide or move these
  updated_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now(),
  constraint fin_dashboard_prefs_shape check (
    (scope = 'company' and role is null and user_id is null)
    or (scope = 'role' and role is not null and user_id is null and locked_cards = '{}')
    or (scope = 'user' and user_id is not null and role is null and locked_cards = '{}'))
);
create unique index if not exists fin_dashboard_prefs_one on public.fin_dashboard_prefs (book_id, scope, coalesce(role, ''), coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Server-side rule: an essential alert is never stored as hidden.
create or replace function public.fin_dashboard_prefs_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from jsonb_array_elements(new.cards) c
             where (c ->> 'key') = any (public.fin_essential_alert_keys()) and coalesce((c ->> 'visible')::boolean, true) = false) then
    raise exception 'essential_alert' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists fin_dashboard_prefs_guard on public.fin_dashboard_prefs;
create trigger fin_dashboard_prefs_guard before insert or update on public.fin_dashboard_prefs for each row execute function public.fin_dashboard_prefs_guard();

-- p_scope 'company' | 'role' (owner / manage_financial_config) or 'user' (the caller). Locked company cards
-- are forced visible in user preferences; essential alerts are forced visible everywhere.
create or replace function public.fin_dashboard_save(p_book_id uuid, p_scope text, p_role text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_locks text[]; v_cards jsonb; v_user uuid;
begin
  if p_scope in ('company', 'role') then
    perform public.fin_require(p_book_id, 'manage_financial_config', false);
  elsif p_scope = 'user' then
    if not (public.fin_has_permission(p_book_id, 'view_company_financials') or public.fin_has_permission(p_book_id, 'view_project_financials')) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_user := auth.uid();
  else
    raise exception 'bad_scope' using errcode = '22023';
  end if;
  v_locks := case when p_scope = 'company' then coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'lockedCards', '[]'::jsonb))), '{}')
                  else coalesce((select locked_cards from public.fin_dashboard_prefs where book_id = p_book_id and scope = 'company'), '{}') end;
  select coalesce(jsonb_agg(case when (c ->> 'key') = any (public.fin_essential_alert_keys())
                                   or (p_scope = 'user' and (c ->> 'key') = any (v_locks))
                                 then jsonb_set(c, '{visible}', 'true'::jsonb) else c end), '[]'::jsonb)
    into v_cards from jsonb_array_elements(coalesce(p -> 'cards', '[]'::jsonb)) c;
  delete from public.fin_dashboard_prefs where book_id = p_book_id and scope = p_scope
    and role is not distinct from (case when p_scope = 'role' then p_role end) and user_id is not distinct from v_user;
  insert into public.fin_dashboard_prefs (book_id, scope, role, user_id, cards, kpis, saved_views, collapsed_sections, locked_cards, updated_by)
  values (p_book_id, p_scope, case when p_scope = 'role' then p_role end, v_user, v_cards,
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'kpis', '[]'::jsonb))), '{}'),
    coalesce(p -> 'savedViews', '[]'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'collapsedSections', '[]'::jsonb))), '{}'),
    case when p_scope = 'company' then v_locks else '{}' end, auth.uid());
  if p_scope <> 'user' then perform public.fin_audit(p_book_id, 'dashboard.saved', 'book', p_book_id, jsonb_build_object('scope', p_scope, 'role', p_role)); end if;
end $$;

-- Restore defaults: the caller's own preferences go; company/role layouts (and code defaults) apply again.
create or replace function public.fin_dashboard_reset(p_book_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.fin_dashboard_prefs where book_id = p_book_id and scope = 'user' and user_id = auth.uid()
$$;

-- Everything the dashboard needs to resolve a layout: company (+ locks), the caller's role layout, the
-- caller's preferences, and the non-hideable alert keys. The rules engine (TypeScript) fills the rest.
create or replace function public.fin_dashboard_layout(p_book_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  if not (public.fin_has_permission(p_book_id, 'view_company_financials') or public.fin_has_permission(p_book_id, 'view_project_financials')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_role := (public.fin_access(p_book_id) ->> 'role');
  return jsonb_build_object('role', v_role,
    'company', (select to_jsonb(d) - 'book_id' from public.fin_dashboard_prefs d where d.book_id = p_book_id and d.scope = 'company'),
    'roleLayout', (select to_jsonb(d) - 'book_id' from public.fin_dashboard_prefs d where d.book_id = p_book_id and d.scope = 'role' and d.role = v_role),
    'user', (select to_jsonb(d) - 'book_id' from public.fin_dashboard_prefs d where d.book_id = p_book_id and d.scope = 'user' and d.user_id = auth.uid()),
    'essentialAlerts', to_jsonb(public.fin_essential_alert_keys()),
    'mode', coalesce((select u.mode from public.fin_user_preferences u where u.book_id = p_book_id and u.user_id = auth.uid()), 'contractor'));
end $$;

-- Contractor Mode is the default; Accountant Mode only for people authorized for accounting work.
create table if not exists public.fin_user_preferences (
  book_id    uuid not null references public.fin_books (id) on delete restrict,
  user_id    uuid not null references auth.users (id) on delete cascade,
  mode       text not null default 'contractor' check (mode in ('contractor', 'accountant')),
  updated_at timestamptz not null default now(),
  primary key (book_id, user_id)
);

create or replace function public.fin_set_mode(p_book_id uuid, p_mode text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_mode not in ('contractor', 'accountant') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if not (public.fin_has_permission(p_book_id, 'view_company_financials') or public.fin_has_permission(p_book_id, 'view_project_financials')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_mode = 'accountant' and not (public.fin_has_permission(p_book_id, 'reconcile') or public.fin_has_permission(p_book_id, 'manage_accounts')
      or public.fin_has_permission(p_book_id, 'post_journal_entries') or public.fin_has_permission(p_book_id, 'close_periods')
      or public.fin_has_permission(p_book_id, 'export_financials')) then
    raise exception 'forbidden_mode' using errcode = '42501';
  end if;
  insert into public.fin_user_preferences (book_id, user_id, mode) values (p_book_id, auth.uid(), p_mode)
  on conflict (book_id, user_id) do update set mode = excluded.mode, updated_at = now();
  return p_mode;
end $$;
revoke execute on function public.fin_dashboard_save(uuid, text, text, jsonb), public.fin_dashboard_reset(uuid), public.fin_dashboard_layout(uuid),
  public.fin_set_mode(uuid, text) from public, anon;
grant execute on function public.fin_dashboard_save(uuid, text, text, jsonb), public.fin_dashboard_reset(uuid), public.fin_dashboard_layout(uuid),
  public.fin_set_mode(uuid, text) to authenticated;

-- 14. Row-level security: reads only -------------------------------------------------------------------------
alter table public.fin_books enable row level security;
alter table public.fin_seats enable row level security;
alter table public.fin_audit_log enable row level security;
alter table public.fin_number_sequences enable row level security;
alter table public.fin_documents enable row level security;
alter table public.fin_business_config enable row level security;
alter table public.fin_project_profiles enable row level security;
alter table public.fin_ai_preferences enable row level security;
alter table public.fin_dashboard_prefs enable row level security;
alter table public.fin_user_preferences enable row level security;

create or replace function public.fin_can_view_book(p_book_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.fin_has_permission(p_book_id, 'view_company_financials') or public.fin_has_permission(p_book_id, 'view_project_financials')
$$;
revoke execute on function public.fin_can_view_book(uuid) from public, anon;
grant execute on function public.fin_can_view_book(uuid) to authenticated;

drop policy if exists fin_books_select on public.fin_books;
create policy fin_books_select on public.fin_books for select to authenticated using (public.fin_can_view_book(id));
drop policy if exists fin_seats_select on public.fin_seats;
create policy fin_seats_select on public.fin_seats for select to authenticated
  using (user_id = auth.uid() or public.fin_has_permission(book_id, 'manage_financial_seats'));
drop policy if exists fin_audit_log_select on public.fin_audit_log;
create policy fin_audit_log_select on public.fin_audit_log for select to authenticated using (public.fin_has_permission(book_id, 'view_company_financials'));
drop policy if exists fin_documents_select on public.fin_documents;
create policy fin_documents_select on public.fin_documents for select to authenticated using (public.fin_has_permission(book_id, 'view_company_financials'));
drop policy if exists fin_business_config_select on public.fin_business_config;
create policy fin_business_config_select on public.fin_business_config for select to authenticated using (public.fin_can_view_book(book_id));
drop policy if exists fin_project_profiles_select on public.fin_project_profiles;
create policy fin_project_profiles_select on public.fin_project_profiles for select to authenticated using (public.fin_can_view_book(book_id));
drop policy if exists fin_ai_preferences_select on public.fin_ai_preferences;
create policy fin_ai_preferences_select on public.fin_ai_preferences for select to authenticated using (public.fin_can_view_book(book_id));
drop policy if exists fin_dashboard_prefs_select on public.fin_dashboard_prefs;
create policy fin_dashboard_prefs_select on public.fin_dashboard_prefs for select to authenticated
  using (public.fin_can_view_book(book_id) and (scope <> 'user' or user_id = auth.uid()));
drop policy if exists fin_user_preferences_select on public.fin_user_preferences;
create policy fin_user_preferences_select on public.fin_user_preferences for select to authenticated using (user_id = auth.uid());
-- fin_number_sequences: no policies (server functions only).

revoke all on public.fin_books, public.fin_seats, public.fin_audit_log, public.fin_number_sequences, public.fin_documents, public.fin_business_config,
  public.fin_project_profiles, public.fin_ai_preferences, public.fin_dashboard_prefs, public.fin_user_preferences from anon, authenticated;
grant select on public.fin_books, public.fin_seats, public.fin_audit_log, public.fin_documents, public.fin_business_config,
  public.fin_project_profiles, public.fin_ai_preferences, public.fin_dashboard_prefs, public.fin_user_preferences to authenticated;
