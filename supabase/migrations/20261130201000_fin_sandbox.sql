-- V6 P1-C: company sandbox mode (Scenario G). Requires 20261124001000 .. 20261130101000.
--
-- A sandbox is a separate practice book for a company (or solo) book: its own fin_books row (sandbox_of = the real
-- book), its own numbering (SBX-INV-0001 ...), its own invoices, payments, bills and expenses. It starts with a copy
-- of the real book's open jobs (same signed contract, same payment schedule) so people practice on familiar
-- projects. Nothing in a sandbox touches the real book:
--   * permissions and plan follow the real book; seats can't be assigned to a sandbox
--   * no email can be drafted, queued or sent from a sandbox (comm_messages refuses it)
--   * per-project settings (fin_project_profiles) stay with the real book
--   * jobs can only be copied in from the real book (opening a job always opens it in the real book)
-- Sandbox mode is per person (fin_sandbox_mode): fin_my_book() returns the sandbox while it's on. "Start over"
-- archives the sandbox (kept read-only, never deleted) and starts a fresh one.
-- Idempotent. Rollback: docs/financials/rollback_20261130201000.sql

-- 1. Sandbox books ------------------------------------------------------------------------------------------
alter table public.fin_books add column if not exists sandbox_of uuid;            -- no FK: purging a real book never trips on it
alter table public.fin_books add column if not exists sandbox_archived_at timestamptz;
alter table public.fin_books drop constraint if exists fin_books_scope;
alter table public.fin_books add constraint fin_books_scope check (
  (sandbox_of is null and (company_id is null) <> (owner_user_id is null))
  or (sandbox_of is not null and company_id is null and owner_user_id is null));
alter table public.fin_books drop constraint if exists fin_books_sandbox_archive;
alter table public.fin_books add constraint fin_books_sandbox_archive check (sandbox_archived_at is null or sandbox_of is not null);
create unique index if not exists fin_books_one_sandbox on public.fin_books (sandbox_of) where sandbox_of is not null and sandbox_archived_at is null;

create or replace function public.fin_books_sandbox_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.sandbox_of is distinct from old.sandbox_of or (old.sandbox_archived_at is not null and new.sandbox_archived_at is distinct from old.sandbox_archived_at) then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists fin_books_sandbox_guard on public.fin_books;
create trigger fin_books_sandbox_guard before update on public.fin_books for each row execute function public.fin_books_sandbox_guard();

create or replace function public.fin_book_live(p_book_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(sandbox_of, id) from public.fin_books where id = p_book_id
$$;
create or replace function public.fin_is_sandbox(p_book_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select sandbox_of is not null from public.fin_books where id = p_book_id), false)
$$;
revoke execute on function public.fin_book_live(uuid), public.fin_is_sandbox(uuid) from public, anon;
grant execute on function public.fin_book_live(uuid), public.fin_is_sandbox(uuid) to authenticated;

create or replace function public.fin_has_permission(p_book_id uuid, p_key text, p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); b public.fin_books; s public.fin_seats; m public.company_members; v_perms text[];
begin
  if v_uid is null or p_book_id is null or not (p_key = any (public.fin_permission_keys())) then return false; end if;
  select * into b from public.fin_books where id = p_book_id;
  if not found then return false; end if;
  -- A sandbox book follows the permissions of its real book; an archived (reset) sandbox is read-only.
  if b.sandbox_of is not null then
    if b.sandbox_archived_at is not null and p_write then return false; end if;
    return public.fin_has_permission(b.sandbox_of, p_key, p_write);
  end if;
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

create or replace function public.fin_entitlement(p_book_id uuid)
returns table (active boolean, read_only boolean, source text, seat_limit integer, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare b public.fin_books; v_paid integer; v_paid_end timestamptz; v_comp integer; v_comp_end timestamptz; v_ent record;
begin
  select * into b from public.fin_books where id = p_book_id;
  if not found then return query select false, false, null::text, 0, null::timestamptz; return; end if;
  if b.sandbox_of is not null then   -- the sandbox rides on the real book's plan
    return query select e.active and b.sandbox_archived_at is null, e.read_only or b.sandbox_archived_at is not null, e.source, e.seat_limit, e.expires_at
      from public.fin_entitlement(b.sandbox_of) e;
    return;
  end if;
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

create or replace function public.fin_access(p_book_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e record; b public.fin_books; lb public.fin_books; s public.fin_seats;
begin
  select * into b from public.fin_books where id = p_book_id;
  if not found or auth.uid() is null then return null; end if;
  select * into lb from public.fin_books where id = coalesce(b.sandbox_of, b.id);
  select * into e from public.fin_entitlement(p_book_id);
  select * into s from public.fin_seats where book_id = lb.id and user_id = auth.uid();
  return jsonb_build_object('bookId', b.id, 'name', b.name, 'kind', case when lb.company_id is null then 'solo' else 'company' end,
    'sandbox', b.sandbox_of is not null, 'liveBookId', lb.id, 'sandboxStartedAt', case when b.sandbox_of is not null then b.created_at end,
    'active', e.active, 'readOnly', e.read_only, 'seatLimit', e.seat_limit, 'source', e.source,
    'role', case when lb.owner_user_id = auth.uid() then 'owner' else s.fin_role end,
    'accountantSeat', coalesce(s.is_accountant_seat, false),
    'permissions', to_jsonb(array(select k from unnest(public.fin_permission_keys()) k where public.fin_has_permission(p_book_id, k, false))));
end $$;

create or replace function public.fin_job_visible(p_job_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare j public.fin_jobs; v_company uuid;
begin
  select * into j from public.fin_jobs where id = p_job_id;
  if not found or auth.uid() is null then return false; end if;
  if public.fin_has_permission(j.book_id, 'view_company_financials') then return true; end if;
  if public.fin_has_permission(j.book_id, 'view_project_financials') and public.estimate_readable(j.estimate_id) then return true; end if;
  select company_id into v_company from public.fin_books where id = public.fin_book_live(j.book_id);
  return v_company is not null
    and exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = auth.uid() and m.status = 'active')
    and exists (select 1 from public.project_schedules s where s.estimate_id = j.estimate_id and s.project_manager_id = auth.uid() and s.status <> 'archived');
end $$;

-- 2. Jobs: one real job per bid, plus at most one copy per sandbox ------------------------------------------
alter table public.fin_jobs add column if not exists sandbox boolean not null default false;
create or replace function public.fin_jobs_set_sandbox() returns trigger
language plpgsql set search_path = public as $$
begin
  new.sandbox := public.fin_is_sandbox(new.book_id);
  return new;
end $$;
drop trigger if exists fin_jobs_set_sandbox on public.fin_jobs;
create trigger fin_jobs_set_sandbox before insert on public.fin_jobs for each row execute function public.fin_jobs_set_sandbox();
alter table public.fin_jobs drop constraint if exists fin_jobs_estimate_id_key;
create unique index if not exists fin_jobs_one_real_per_bid on public.fin_jobs (estimate_id) where not sandbox;
create unique index if not exists fin_jobs_one_per_book_bid on public.fin_jobs (book_id, estimate_id);

-- A change order's contract change is recorded once per job (the real job and any sandbox copy).
drop index if exists public.fin_contract_changes_one_co;
create unique index if not exists fin_contract_changes_one_co on public.fin_contract_changes (job_id, change_order_id) where kind = 'change_order';
drop index if exists public.fin_contract_changes_one_correction;
create unique index if not exists fin_contract_changes_one_correction on public.fin_contract_changes (job_id, change_order_id) where kind = 'correction' and change_order_id is not null;

create or replace function public.fin_change_order_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare j public.fin_jobs;
begin
  for j in select * from public.fin_jobs where estimate_id = new.estimate_id loop
    if new.status in ('approved', 'signed') then
      insert into public.fin_contract_changes (book_id, job_id, kind, change_order_id, amount, description, effective_at, created_by)
      values (j.book_id, j.id, 'change_order', new.id, new.amount, left('Change order #' || new.number || ': ' || new.title, 500), coalesce(new.decided_at, now()), new.decided_by)
      on conflict do nothing;
    elsif tg_op = 'UPDATE' and new.status in ('void', 'declined') and old.status in ('approved', 'signed') then
      insert into public.fin_contract_changes (book_id, job_id, kind, change_order_id, amount, description, created_by)
      select j.book_id, j.id, 'correction', new.id, -c.amount, left('Reversal of change order #' || new.number, 500), auth.uid()
        from public.fin_contract_changes c where c.change_order_id = new.id and c.job_id = j.id and c.kind = 'change_order'
      on conflict do nothing;
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.fin_change_order_sync() from public, anon, authenticated;

create or replace function public.fin_job_open(p_estimate_id uuid, p_version_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.estimates; v_book uuid; j public.fin_jobs; s public.signatures; v public.estimate_versions; n record; v_source text;
begin
  select * into e from public.estimates where id = p_estimate_id for update;   -- one opener at a time per bid
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if public.estimate_readable(p_estimate_id) then
    v_book := public.fin_book_for_estimate(p_estimate_id);
  else   -- company-wide finance staff (e.g. a bookkeeper) may open jobs for bids they can't see in the pipeline
    select id into v_book from public.fin_books where (e.company_id is not null and company_id = e.company_id) or (e.company_id is null and owner_user_id = e.user_id);
    if v_book is null or not public.fin_has_permission(v_book, 'view_company_financials') then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  perform public.fin_require(v_book, 'create_invoices', true);
  select * into j from public.fin_jobs where estimate_id = p_estimate_id and not sandbox;
  if found then return jsonb_build_object('jobId', j.id, 'jobNumber', j.job_number, 'created', false); end if;
  if not public.estimate_is_accepted(p_estimate_id) then raise exception 'not_accepted' using errcode = '22023'; end if;
  select * into s from public.signatures where estimate_id = p_estimate_id order by signed_at desc limit 1;
  if s.id is not null then
    select * into v from public.estimate_versions where id = s.version_id;
    v_source := 'signature';
  else
    if p_version_id is null then raise exception 'version_required' using errcode = '22023'; end if;
    select * into v from public.estimate_versions where id = p_version_id and estimate_id = p_estimate_id;
    if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;
    v_source := 'manual_confirmed';
  end if;
  select * into n from public.fin_next_number(v_book, 'job');
  insert into public.fin_jobs (book_id, estimate_id, customer_id, job_number, name, tax_rate, opened_by)
  values (v_book, p_estimate_id, e.customer_id, n.label, left(coalesce(nullif(btrim(e.title), ''), 'Job ' || n.label), 300), e.tax_rate, auth.uid())
  returning * into j;
  insert into public.fin_contract_snapshots (book_id, job_id, version_id, version_number, content_hash, source, signature_id,
    subtotal, tax, rounding, total, payment_schedule, confirmed_by)
  values (v_book, j.id, v.id, v.version_number, v.content_hash, v_source, s.id, v.subtotal, v.tax, v.total - v.subtotal - v.tax, v.total,
          public.fin_schedule_amounts(v.proposal -> 'paymentSchedule', v.total), auth.uid());
  -- Backfill change orders approved before the job existed.
  insert into public.fin_contract_changes (book_id, job_id, kind, change_order_id, amount, description, effective_at, created_by)
  select v_book, j.id, 'change_order', c.id, c.amount, left('Change order #' || c.number || ': ' || c.title, 500), coalesce(c.decided_at, now()), c.decided_by
    from public.change_orders c where c.estimate_id = p_estimate_id and c.status in ('approved', 'signed')
  on conflict do nothing;
  perform public.fin_audit(v_book, 'job.opened', 'job', j.id, jsonb_build_object('estimateId', p_estimate_id, 'versionId', v.id, 'source', v_source));
  return jsonb_build_object('jobId', j.id, 'jobNumber', j.job_number, 'created', true);
end $$;

create or replace function public.fin_job_header(p_estimate_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare j public.fin_jobs; e record;
begin
  if auth.uid() is null then return null; end if;
  select * into j from public.fin_jobs where estimate_id = p_estimate_id order by sandbox limit 1;   -- the real job first
  if not found or not public.fin_job_visible(j.id) then return null; end if;
  select id, title, customer_name, customer_email, customer_id, pipeline_stage, trades, company_id, user_id
    into e from public.estimates where id = p_estimate_id;
  if not found then return null; end if;
  return jsonb_build_object('id', e.id, 'title', e.title, 'customer_name', e.customer_name, 'customer_email', e.customer_email,
    'customer_id', e.customer_id, 'pipeline_stage', e.pipeline_stage, 'trades', to_jsonb(e.trades), 'company_id', e.company_id,
    'user_id', e.user_id, 'bid_readable', public.estimate_readable(p_estimate_id));
end $$;

create or replace function public.fin_change_order_milestones_add(p_job_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.fin_jobs; co public.change_orders; s public.fin_contract_snapshots; m jsonb; v_seq integer; v_sum numeric := 0; v_ids uuid[] := '{}'; v_id uuid;
begin
  select * into j from public.fin_jobs where id = p_job_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(j.book_id, 'create_invoices', true);
  select * into co from public.change_orders where id = (p ->> 'changeOrderId')::uuid and estimate_id = j.estimate_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if co.status not in ('approved', 'signed') then raise exception 'not_approved' using errcode = '22023'; end if;
  if exists (select 1 from public.fin_payment_milestones where change_order_id = co.id and job_id = j.id)
     or exists (select 1 from public.fin_milestone_amendments where change_order_id = co.id and job_id = j.id and status <> 'rejected') then
    raise exception 'already_billed_plan' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'milestones') <> 'array' or jsonb_array_length(p -> 'milestones') not between 1 and 20 then raise exception 'bad_milestones' using errcode = '22023'; end if;
  select sum((x ->> 'amount')::numeric) into v_sum from jsonb_array_elements(p -> 'milestones') x;
  if v_sum <> co.amount then raise exception 'milestones_must_sum' using errcode = '22023'; end if;
  select * into s from public.fin_contract_snapshots where job_id = j.id;
  select coalesce(max(seq), 0) into v_seq from public.fin_payment_milestones where job_id = j.id;
  for m in select * from jsonb_array_elements(p -> 'milestones') loop
    v_seq := v_seq + 1;
    insert into public.fin_payment_milestones (book_id, job_id, snapshot_id, signature_id, version_id, contract_amount, seq, description, basis, fixed_amount, amount,
      trigger_kind, due_rule, due_days, due_date, source, change_order_id, created_by)
    values (j.book_id, j.id, s.id, s.signature_id, s.version_id, co.amount, v_seq, left(coalesce(nullif(btrim(m ->> 'description'), ''), 'Change order #' || co.number), 300),
      'fixed', (m ->> 'amount')::numeric, (m ->> 'amount')::numeric, coalesce(nullif(m ->> 'triggerKind', ''), 'agreement_signed'),
      coalesce(nullif(m ->> 'dueRule', ''), 'on_trigger'), nullif(m ->> 'dueDays', '')::integer, nullif(m ->> 'dueDate', '')::date, 'change_order', co.id, auth.uid())
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  perform public.fin_audit(j.book_id, 'milestone.change_order_added', 'job', j.id, jsonb_build_object('changeOrderId', co.id, 'milestones', to_jsonb(v_ids)));
  return jsonb_build_object('milestoneIds', to_jsonb(v_ids));
end $$;

-- 3. Sandbox mode -------------------------------------------------------------------------------------------
create table if not exists public.fin_sandbox_mode (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  live_book_id uuid not null references public.fin_books (id) on delete cascade,
  entered_at   timestamptz not null default now()
);
alter table public.fin_sandbox_mode enable row level security;
drop policy if exists fin_sandbox_mode_own on public.fin_sandbox_mode;
create policy fin_sandbox_mode_own on public.fin_sandbox_mode for select to authenticated using (user_id = auth.uid());
revoke all on public.fin_sandbox_mode from anon, authenticated;
grant select on public.fin_sandbox_mode to authenticated;

create or replace function public.fin_my_live_book(p_personal boolean default false) returns uuid
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
revoke execute on function public.fin_my_live_book(boolean) from public, anon, authenticated;

-- The caller's book, or its sandbox while the caller has sandbox mode on for it.
create or replace function public.fin_my_book(p_personal boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_live uuid; v_sb uuid;
begin
  v_live := public.fin_my_live_book(p_personal);
  if v_live is null then return null; end if;
  select b.id into v_sb from public.fin_sandbox_mode m join public.fin_books b on b.sandbox_of = m.live_book_id and b.sandbox_archived_at is null
   where m.user_id = auth.uid() and m.live_book_id = v_live;
  return coalesce(v_sb, v_live);
end $$;

-- Copy one real job (contract snapshot, payment schedule, approved change orders) into a sandbox.
create or replace function public.fin_sandbox_copy_job_internal(p_sandbox uuid, p_live_job uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare lj public.fin_jobs; ls public.fin_contract_snapshots; j public.fin_jobs; n record;
begin
  select * into lj from public.fin_jobs where id = p_live_job and not sandbox;
  if not found or lj.book_id <> public.fin_book_live(p_sandbox) or not public.fin_is_sandbox(p_sandbox) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into j from public.fin_jobs where book_id = p_sandbox and estimate_id = lj.estimate_id;
  if found then return j.id; end if;
  select * into ls from public.fin_contract_snapshots where job_id = lj.id;
  select * into n from public.fin_next_number(p_sandbox, 'job');
  insert into public.fin_jobs (book_id, estimate_id, customer_id, job_number, name, tax_rate, opened_by)
  values (p_sandbox, lj.estimate_id, lj.customer_id, n.label, lj.name, lj.tax_rate, auth.uid()) returning * into j;
  insert into public.fin_contract_snapshots (book_id, job_id, version_id, version_number, content_hash, source, signature_id,
    subtotal, tax, rounding, total, payment_schedule, confirmed_by)
  values (p_sandbox, j.id, ls.version_id, ls.version_number, ls.content_hash, ls.source, ls.signature_id, ls.subtotal, ls.tax, ls.rounding, ls.total,
          ls.payment_schedule, auth.uid());
  insert into public.fin_contract_changes (book_id, job_id, kind, change_order_id, amount, description, effective_at, created_by)
  select p_sandbox, j.id, 'change_order', c.id, c.amount, left('Change order #' || c.number || ': ' || c.title, 500), coalesce(c.decided_at, now()), c.decided_by
    from public.change_orders c where c.estimate_id = lj.estimate_id and c.status in ('approved', 'signed')
  on conflict do nothing;
  return j.id;
end $$;
revoke execute on function public.fin_sandbox_copy_job_internal(uuid, uuid) from public, anon, authenticated;

-- Turn sandbox mode on for the caller (creating the company's sandbox if there isn't one yet).
create or replace function public.fin_sandbox_enter(p_live_book uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lb public.fin_books; v_sb uuid; v_created boolean := false; r record; v_jobs integer := 0;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into lb from public.fin_books where id = p_live_book;
  if not found or lb.sandbox_of is not null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.fin_has_permission(lb.id, 'view_project_financials') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform 1 from public.fin_books where id = lb.id for update;   -- one creator at a time
  select id into v_sb from public.fin_books where sandbox_of = lb.id and sandbox_archived_at is null;
  if v_sb is null then
    perform public.fin_require(lb.id, 'manage_financial_config', true);
    insert into public.fin_books (name, timezone, fiscal_year_start_month, sandbox_of, created_by)
    values (left('Sandbox: ' || lb.name, 200), lb.timezone, lb.fiscal_year_start_month, lb.id, auth.uid()) returning id into v_sb;
    insert into public.fin_number_sequences (book_id, doc_type, prefix)
    select v_sb, d, 'SBX-' || case d when 'invoice' then 'INV-' when 'credit_memo' then 'CM-' when 'payment' then 'PMT-' when 'refund' then 'RF-'
                                    when 'bill' then 'BILL-' when 'expense' then 'EXP-' when 'commitment' then 'SC-' else 'JOB-' end
      from unnest(array['job', 'invoice', 'credit_memo', 'payment', 'refund', 'bill', 'expense', 'commitment']) d
    on conflict do nothing;
    insert into public.fin_business_config select (jsonb_populate_record(null::public.fin_business_config, to_jsonb(c) || jsonb_build_object('book_id', v_sb))).*
      from public.fin_business_config c where c.book_id = lb.id
    on conflict do nothing;
    for r in select id from public.fin_jobs where book_id = lb.id and status = 'open' and not sandbox order by opened_at limit 50 loop
      perform public.fin_sandbox_copy_job_internal(v_sb, r.id); v_jobs := v_jobs + 1;
    end loop;
    v_created := true;
    perform public.fin_audit(lb.id, 'sandbox.created', 'book', v_sb, jsonb_build_object('jobsCopied', v_jobs));
  end if;
  insert into public.fin_sandbox_mode (user_id, live_book_id) values (auth.uid(), lb.id)
  on conflict (user_id) do update set live_book_id = excluded.live_book_id, entered_at = now();
  return jsonb_build_object('sandboxBookId', v_sb, 'created', v_created, 'jobsCopied', v_jobs);
end $$;

create or replace function public.fin_sandbox_leave() returns void
language sql security definer set search_path = public as $$
  delete from public.fin_sandbox_mode where user_id = auth.uid()
$$;

-- Copy a real job opened after the sandbox was made.
create or replace function public.fin_sandbox_copy_job(p_sandbox uuid, p_estimate_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_live uuid; lj public.fin_jobs; v_id uuid;
begin
  if not public.fin_is_sandbox(p_sandbox) then raise exception 'not_sandbox' using errcode = '22023'; end if;
  perform public.fin_require(p_sandbox, 'create_invoices', true);
  v_live := public.fin_book_live(p_sandbox);
  select * into lj from public.fin_jobs where book_id = v_live and estimate_id = p_estimate_id and not sandbox;
  if not found then raise exception 'sandbox_needs_real_job' using errcode = '22023'; end if;
  v_id := public.fin_sandbox_copy_job_internal(p_sandbox, lj.id);
  return jsonb_build_object('jobId', v_id);
end $$;

-- Start over: archive the current sandbox (kept read-only, never deleted) and make a fresh one.
create or replace function public.fin_sandbox_reset(p_live_book uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_old uuid;
begin
  if public.fin_is_sandbox(p_live_book) then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(p_live_book, 'manage_financial_config', true);
  update public.fin_books set sandbox_archived_at = now() where sandbox_of = p_live_book and sandbox_archived_at is null returning id into v_old;
  delete from public.fin_sandbox_mode where live_book_id = p_live_book and user_id <> auth.uid();
  if v_old is not null then perform public.fin_audit(p_live_book, 'sandbox.reset', 'book', v_old, null); end if;
  return public.fin_sandbox_enter(p_live_book);
end $$;
revoke execute on function public.fin_sandbox_enter(uuid), public.fin_sandbox_leave(), public.fin_sandbox_copy_job(uuid, uuid), public.fin_sandbox_reset(uuid) from public, anon;
grant execute on function public.fin_sandbox_enter(uuid), public.fin_sandbox_leave(), public.fin_sandbox_copy_job(uuid, uuid), public.fin_sandbox_reset(uuid) to authenticated;

-- 4. What a sandbox can never do ----------------------------------------------------------------------------
create or replace function public.fin_sandbox_refuse() returns trigger
language plpgsql set search_path = public as $$
declare v_book uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if v_book is not null and public.fin_is_sandbox(v_book) then raise exception '%', tg_argv[1] using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists comm_messages_no_sandbox on public.comm_messages;
create trigger comm_messages_no_sandbox before insert or update on public.comm_messages
  for each row execute function public.fin_sandbox_refuse('fin_book_id', 'sandbox_no_email');
drop trigger if exists fin_seats_no_sandbox on public.fin_seats;
create trigger fin_seats_no_sandbox before insert or update on public.fin_seats
  for each row execute function public.fin_sandbox_refuse('book_id', 'sandbox_setting');
drop trigger if exists fin_project_profiles_no_sandbox on public.fin_project_profiles;
create trigger fin_project_profiles_no_sandbox before insert or update on public.fin_project_profiles
  for each row execute function public.fin_sandbox_refuse('book_id', 'sandbox_setting');
