-- Financial Command Center, Phase 1 (part 2 of 3): receivables.
--
--   * fin_jobs: one per accepted bid (estimate_id unique, ON DELETE RESTRICT: a bid with financial records
--     can't be deleted). Opening a job freezes the contract baseline (fin_contract_snapshots) from the
--     signed proposal version, or from a version the user explicitly confirms when the bid was approved
--     manually. Totals are copied from estimate_versions (total = subtotal + tax + rounding) and the
--     payment schedule is recomputed from its percents (remainder on the last milestone, like the proposal).
--   * fin_contract_changes: approved/signed change orders arrive by trigger (and are backfilled when a
--     job opens); deductions and corrections are added by RPC. Contract value =
--     original + approved/signed change orders + corrections - deductions. Draft/sent change orders are
--     shown as "pending" and never counted.
--   * Invoices (draft -> issued -> void) with lines of kind deposit / milestone / progress (placeholder,
--     plain amount until SOV billing) / final / custom / deposit_application. The number is assigned
--     (gapless) when the invoice is issued; issued invoices and their lines are immutable.
--   * Payments are recorded manually and start unverified (verified = false). Allocations can split one
--     payment across invoices; the rest stays unapplied (customer credit). Credit memos, applications,
--     refunds and voids never delete anything: they reverse.
--   * Balances are DERIVED (views, security_invoker): nothing stores a running balance.
--   * Every RPC locks in a fixed order (payment / credit memo first, then invoices by id); deferred
--     constraint triggers re-check the totals at commit as a backstop. Optional idempotency keys.
--   * No ledger tables (Phase 2).
--
-- Safe to run more than once. Requires 20261124001000_fin_foundation.sql.
-- Rollback: docs/financials/rollback_20261124002000.sql

-- 1. Idempotency ----------------------------------------------------------------------------------------
create table if not exists public.fin_idempotency (
  book_id    uuid not null references public.fin_books (id) on delete restrict,
  key        text not null check (char_length(key) between 8 and 120),
  op         text not null check (char_length(op) <= 60),
  result     jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (book_id, key)
);

-- Returns null when the key is new (the caller does the work, then fin_idem_finish), or the stored result
-- of the earlier call. A concurrent call with the same key waits on the first one's row lock.
create or replace function public.fin_idem_begin(p_book_id uuid, p_key text, p_op text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.fin_idempotency;
begin
  if p_key is null then return null; end if;
  insert into public.fin_idempotency (book_id, key, op, created_by) values (p_book_id, p_key, p_op, auth.uid()) on conflict do nothing;
  if found then return null; end if;
  select * into r from public.fin_idempotency where book_id = p_book_id and key = p_key;
  if r.op <> p_op then raise exception 'idempotency_conflict' using errcode = '22023'; end if;
  return coalesce(r.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
end $$;

create or replace function public.fin_idem_finish(p_book_id uuid, p_key text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_key is not null then update public.fin_idempotency set result = p_result where book_id = p_book_id and key = p_key; end if;
  return p_result;
end $$;
revoke execute on function public.fin_idem_begin(uuid, text, text), public.fin_idem_finish(uuid, text, jsonb) from public, anon, authenticated;

-- 2. Jobs ---------------------------------------------------------------------------------------------------
create table if not exists public.fin_jobs (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  estimate_id uuid not null unique references public.estimates (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete restrict,
  job_number  text not null check (char_length(job_number) <= 30),
  name        text not null check (char_length(name) between 1 and 300),
  status      text not null default 'open' check (status in ('open', 'closed')),
  tax_rate    numeric(7, 4) not null default 0 check (tax_rate between 0 and 100),   -- percent, copied from the bid
  opened_by   uuid references auth.users (id) on delete set null,
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  unique (book_id, job_number)
);
create index if not exists fin_jobs_book_idx on public.fin_jobs (book_id, status);
create index if not exists fin_jobs_customer_idx on public.fin_jobs (customer_id) where customer_id is not null;

-- Only status / closed_at change after a job is opened; never deleted.
create or replace function public.fin_jobs_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'status' - 'closed_at') is distinct from (to_jsonb(old) - 'status' - 'closed_at') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists fin_jobs_guard on public.fin_jobs;
create trigger fin_jobs_guard before update or delete on public.fin_jobs for each row execute function public.fin_jobs_guard();

-- Who may see a job's financials: view_company_financials; or view_project_financials and the bid is
-- visible to them; or (no paid seat needed, view only) they are the project manager assigned to it.
create or replace function public.fin_job_visible(p_job_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare j public.fin_jobs; v_company uuid;
begin
  select * into j from public.fin_jobs where id = p_job_id;
  if not found or auth.uid() is null then return false; end if;
  if public.fin_has_permission(j.book_id, 'view_company_financials') then return true; end if;
  if public.fin_has_permission(j.book_id, 'view_project_financials') and public.estimate_readable(j.estimate_id) then return true; end if;
  select company_id into v_company from public.fin_books where id = j.book_id;
  return v_company is not null
    and exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = auth.uid() and m.status = 'active')
    and exists (select 1 from public.project_schedules s where s.estimate_id = j.estimate_id and s.project_manager_id = auth.uid() and s.status <> 'archived');
end $$;
revoke execute on function public.fin_job_visible(uuid) from public, anon;
grant execute on function public.fin_job_visible(uuid) to authenticated;

-- 3. Contract baseline + changes ----------------------------------------------------------------------------
create table if not exists public.fin_contract_snapshots (
  id               uuid primary key default gen_random_uuid(),
  book_id          uuid not null references public.fin_books (id) on delete restrict,
  job_id           uuid not null unique references public.fin_jobs (id) on delete restrict,
  version_id       uuid not null references public.estimate_versions (id) on delete restrict,
  version_number   integer not null,
  content_hash     text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source           text not null check (source in ('signature', 'manual_confirmed')),
  signature_id     uuid references public.signatures (id) on delete restrict,
  subtotal         numeric(14, 2) not null,
  tax              numeric(14, 2) not null,
  rounding         numeric(14, 2) not null default 0,
  total            numeric(14, 2) not null,
  payment_schedule jsonb not null default '[]' check (jsonb_typeof(payment_schedule) = 'array'),   -- [{index, label, percent, amount}]
  confirmed_by     uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint fin_contract_snapshots_sum check (total = subtotal + tax + rounding),
  constraint fin_contract_snapshots_source check ((source = 'signature') = (signature_id is not null))
);
drop trigger if exists fin_contract_snapshots_immutable on public.fin_contract_snapshots;
create trigger fin_contract_snapshots_immutable before update or delete on public.fin_contract_snapshots
  for each row execute function public.fin_guard_immutable();

create table if not exists public.fin_contract_changes (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid not null references public.fin_books (id) on delete restrict,
  job_id          uuid not null references public.fin_jobs (id) on delete restrict,
  kind            text not null check (kind in ('change_order', 'deduction', 'correction')),
  change_order_id uuid references public.change_orders (id) on delete restrict,
  amount          numeric(14, 2) not null,
  description     text not null check (char_length(description) between 1 and 500),
  effective_at    timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint fin_contract_changes_co check (kind <> 'change_order' or change_order_id is not null),
  constraint fin_contract_changes_deduction check (kind <> 'deduction' or (amount < 0 and change_order_id is null))
);
create unique index if not exists fin_contract_changes_one_co on public.fin_contract_changes (change_order_id) where kind = 'change_order';
create unique index if not exists fin_contract_changes_one_correction on public.fin_contract_changes (change_order_id) where kind = 'correction' and change_order_id is not null;
create index if not exists fin_contract_changes_job_idx on public.fin_contract_changes (job_id);
drop trigger if exists fin_contract_changes_immutable on public.fin_contract_changes;
create trigger fin_contract_changes_immutable before update or delete on public.fin_contract_changes
  for each row execute function public.fin_guard_immutable();

-- Approved/signed change orders flow into the job's contract (once). An approved change order that is
-- later voided or declined is reversed by a correction (today the app never allows that; defensive).
create or replace function public.fin_change_order_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare j public.fin_jobs;
begin
  select * into j from public.fin_jobs where estimate_id = new.estimate_id;
  if not found then return null; end if;
  if new.status in ('approved', 'signed') then
    insert into public.fin_contract_changes (book_id, job_id, kind, change_order_id, amount, description, effective_at, created_by)
    values (j.book_id, j.id, 'change_order', new.id, new.amount, left('Change order #' || new.number || ': ' || new.title, 500), coalesce(new.decided_at, now()), new.decided_by)
    on conflict do nothing;
  elsif tg_op = 'UPDATE' and new.status in ('void', 'declined') and old.status in ('approved', 'signed') then
    insert into public.fin_contract_changes (book_id, job_id, kind, change_order_id, amount, description, created_by)
    select j.book_id, j.id, 'correction', new.id, -c.amount, left('Reversal of change order #' || new.number, 500), auth.uid()
      from public.fin_contract_changes c where c.change_order_id = new.id and c.kind = 'change_order'
    on conflict do nothing;
  end if;
  return null;
end $$;
revoke execute on function public.fin_change_order_sync() from public, anon, authenticated;
drop trigger if exists change_orders_fin_sync on public.change_orders;
create trigger change_orders_fin_sync after insert or update of status on public.change_orders
  for each row execute function public.fin_change_order_sync();

-- Recompute the schedule amounts from the percents against the contract total (remainder on the last
-- milestone when the percents sum to 100, exactly like src/lib/proposal/build.ts).
create or replace function public.fin_schedule_amounts(p_schedule jsonb, p_total numeric) returns jsonb
language plpgsql immutable set search_path = public as $$
declare v_out jsonb := '[]'; v_sum numeric := 0; v_alloc numeric := 0; v_n integer; v_i integer := 0; m jsonb; v_pct numeric; v_amt numeric;
begin
  if p_schedule is null or jsonb_typeof(p_schedule) <> 'array' then return '[]'; end if;
  v_n := jsonb_array_length(p_schedule);
  select coalesce(sum(nullif(regexp_replace(coalesce(x ->> 'percent', ''), '[^0-9.\-]', '', 'g'), '')::numeric), 0) into v_sum
    from jsonb_array_elements(p_schedule) x;
  for m in select * from jsonb_array_elements(p_schedule) loop
    v_pct := coalesce(nullif(regexp_replace(coalesce(m ->> 'percent', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0);
    v_amt := case when v_i = v_n - 1 and v_sum = 100 then p_total - v_alloc else round(p_total * v_pct / 100, 2) end;
    v_alloc := v_alloc + v_amt;
    v_out := v_out || jsonb_build_object('index', v_i, 'label', left(coalesce(nullif(btrim(m ->> 'label'), ''), 'Payment ' || (v_i + 1)), 200),
                                         'percent', v_pct::text, 'amount', v_amt::text);
    v_i := v_i + 1;
  end loop;
  return v_out;
end $$;

-- Open the job for an accepted bid (idempotent: returns the existing job). Without a signature, the
-- caller must confirm which proposal version is the contract (p_version_id).
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
  select * into j from public.fin_jobs where estimate_id = p_estimate_id;
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

create or replace function public.fin_job_set_status(p_job_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare j public.fin_jobs;
begin
  select * into j from public.fin_jobs where id = p_job_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(j.book_id, 'create_invoices', true);
  if p_status not in ('open', 'closed') then raise exception 'bad_status' using errcode = '22023'; end if;
  update public.fin_jobs set status = p_status, closed_at = case when p_status = 'closed' then now() end where id = p_job_id;
  perform public.fin_audit(j.book_id, 'job.' || p_status, 'job', p_job_id, null);
end $$;

-- A deduction lowers the contract (p_amount is the positive size of the reduction).
create or replace function public.fin_contract_deduction_add(p_job_id uuid, p_amount numeric, p_description text, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.fin_jobs; v_prior jsonb; v_id uuid;
begin
  select * into j from public.fin_jobs where id = p_job_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(j.book_id, 'create_invoices', true);
  v_prior := public.fin_idem_begin(j.book_id, p_idempotency_key, 'contract.deduction');
  if v_prior is not null then return v_prior; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  insert into public.fin_contract_changes (book_id, job_id, kind, amount, description, created_by)
  values (j.book_id, j.id, 'deduction', -p_amount, left(coalesce(nullif(btrim(p_description), ''), 'Deduction'), 500), auth.uid()) returning id into v_id;
  perform public.fin_audit(j.book_id, 'contract.deduction', 'job', j.id, jsonb_build_object('amount', p_amount::text, 'changeId', v_id));
  return public.fin_idem_finish(j.book_id, p_idempotency_key, jsonb_build_object('changeId', v_id));
end $$;

-- 3b. Payment milestones (V4.5: the signed payment schedule is authoritative) -------------------------------
-- Frozen from the contract snapshot when the job opens: the signed agreement, the estimate version, the
-- contract amount, and each milestone (percent or fixed amount) with its computed amount. The last part
-- absorbs the rounding remainder so the milestones sum to the contract EXACTLY; when the schedule's
-- percents don't add up to 100 a "Balance due" milestone carries the difference. Approved change orders add
-- their own milestones (source change_order) or an approved amendment to remaining milestones; neither ever
-- touches the original rows or issued invoices.
create table if not exists public.fin_payment_milestones (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid not null references public.fin_books (id) on delete restrict,
  job_id          uuid not null references public.fin_jobs (id) on delete restrict,
  snapshot_id     uuid not null references public.fin_contract_snapshots (id) on delete restrict,
  signature_id    uuid references public.signatures (id) on delete restrict,
  version_id      uuid not null references public.estimate_versions (id) on delete restrict,
  contract_amount numeric(14, 2) not null,
  seq             integer not null check (seq between 1 and 200),
  description     text not null check (char_length(description) between 1 and 300),
  basis           text not null check (basis in ('percent', 'fixed')),
  percent         numeric(7, 4) check (percent between 0 and 100),
  fixed_amount    numeric(14, 2),
  amount          numeric(14, 2) not null,
  trigger_kind    text not null check (trigger_kind in ('agreement_signed', 'project_start_confirmed', 'phase_completed_verified',
                                                        'final_completion_confirmed', 'calendar_date', 'custom_approved')),
  due_rule        text not null default 'on_trigger' check (due_rule in ('on_trigger', 'net_days', 'date')),
  due_days        integer check (due_days between 0 and 365),
  due_date        date,
  is_deposit      boolean not null default false,
  source          text not null default 'contract' check (source in ('contract', 'change_order')),
  change_order_id uuid references public.change_orders (id) on delete restrict,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (job_id, seq),
  constraint fin_payment_milestones_basis check ((basis = 'percent') = (percent is not null) and (basis = 'fixed') = (fixed_amount is not null)),
  constraint fin_payment_milestones_due check ((due_rule = 'net_days') = (due_days is not null) and (due_rule <> 'date' or due_date is not null)),
  constraint fin_payment_milestones_calendar check (trigger_kind <> 'calendar_date' or due_date is not null),
  constraint fin_payment_milestones_source check ((source = 'change_order') = (change_order_id is not null))
);
create index if not exists fin_payment_milestones_job_idx on public.fin_payment_milestones (job_id, seq);
drop trigger if exists fin_payment_milestones_immutable on public.fin_payment_milestones;
create trigger fin_payment_milestones_immutable before update or delete on public.fin_payment_milestones
  for each row execute function public.fin_guard_immutable();

create or replace function public.fin_milestones_from_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb; v_n integer; v_i integer := 0; v_sum numeric := 0; v_label text; v_kind text;
begin
  v_n := jsonb_array_length(new.payment_schedule);
  for m in select * from jsonb_array_elements(new.payment_schedule) order by (value ->> 'index')::integer loop
    v_i := v_i + 1;
    v_label := m ->> 'label';
    v_kind := case when v_i = 1 and (v_n > 1 or v_label ~* '(deposit|down|upfront|signing)') then 'agreement_signed'
                   when v_i = v_n and v_n > 1 then 'final_completion_confirmed'
                   when v_label ~* '(start|mobiliz)' then 'project_start_confirmed'
                   else 'phase_completed_verified' end;
    insert into public.fin_payment_milestones (book_id, job_id, snapshot_id, signature_id, version_id, contract_amount, seq, description, basis, percent, amount,
      trigger_kind, is_deposit)
    values (new.book_id, new.job_id, new.id, new.signature_id, new.version_id, new.total, v_i, left(v_label, 300), 'percent', (m ->> 'percent')::numeric,
      (m ->> 'amount')::numeric, v_kind, v_kind = 'agreement_signed');
    v_sum := v_sum + (m ->> 'amount')::numeric;
  end loop;
  if v_sum <> new.total then   -- no schedule, or percents that don't add to 100: the remainder is its own milestone
    insert into public.fin_payment_milestones (book_id, job_id, snapshot_id, signature_id, version_id, contract_amount, seq, description, basis, fixed_amount, amount, trigger_kind)
    values (new.book_id, new.job_id, new.id, new.signature_id, new.version_id, new.total, v_i + 1, case when v_i = 0 then 'Contract total' else 'Balance due' end,
            'fixed', new.total - v_sum, new.total - v_sum, 'final_completion_confirmed');
  end if;
  return null;
end $$;
revoke execute on function public.fin_milestones_from_snapshot() from public, anon, authenticated;
drop trigger if exists fin_contract_snapshots_milestones on public.fin_contract_snapshots;
create trigger fin_contract_snapshots_milestones after insert on public.fin_contract_snapshots for each row execute function public.fin_milestones_from_snapshot();

-- Trigger events recorded explicitly by authorized users (append-only, audited).
create table if not exists public.fin_milestone_triggers (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.fin_books (id) on delete restrict,
  job_id       uuid not null references public.fin_jobs (id) on delete restrict,
  milestone_id uuid references public.fin_payment_milestones (id) on delete restrict,   -- required for phase / custom triggers
  trigger_kind text not null check (trigger_kind in ('project_start_confirmed', 'phase_completed_verified', 'final_completion_confirmed', 'custom_approved')),
  occurred_at  timestamptz not null,
  note         text check (char_length(note) <= 500),
  recorded_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint fin_milestone_triggers_target check (trigger_kind not in ('phase_completed_verified', 'custom_approved') or milestone_id is not null)
);
create index if not exists fin_milestone_triggers_job_idx on public.fin_milestone_triggers (job_id, trigger_kind);
drop trigger if exists fin_milestone_triggers_immutable on public.fin_milestone_triggers;
create trigger fin_milestone_triggers_immutable before update or delete on public.fin_milestone_triggers
  for each row execute function public.fin_guard_immutable();

-- Amendments of remaining milestones (for an approved change order or a correction); approval required.
create table if not exists public.fin_milestone_amendments (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid not null references public.fin_books (id) on delete restrict,
  job_id          uuid not null references public.fin_jobs (id) on delete restrict,
  milestone_id    uuid not null references public.fin_payment_milestones (id) on delete restrict,
  change_order_id uuid references public.change_orders (id) on delete restrict,
  delta           numeric(14, 2) not null check (delta <> 0),
  reason          text not null check (char_length(reason) between 1 and 500),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by    uuid references auth.users (id) on delete set null,
  requested_at    timestamptz not null default now(),
  decided_by      uuid references auth.users (id) on delete set null,
  decided_at      timestamptz,
  constraint fin_milestone_amendments_decided check ((status = 'pending') = (decided_at is null))
);
create index if not exists fin_milestone_amendments_job_idx on public.fin_milestone_amendments (job_id, status);
create or replace function public.fin_milestone_amendments_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' or old.status <> 'pending'
     or (to_jsonb(new) - 'status' - 'decided_by' - 'decided_at') is distinct from (to_jsonb(old) - 'status' - 'decided_by' - 'decided_at') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists fin_milestone_amendments_guard on public.fin_milestone_amendments;
create trigger fin_milestone_amendments_guard before update or delete on public.fin_milestone_amendments
  for each row execute function public.fin_milestone_amendments_guard();

-- Current amount of a milestone = frozen amount + approved amendments.
-- (Readable by signed-in users for the status view: answers only for milestones of a job they can see.)
create or replace function public.fin_milestone_amount(p_milestone_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select m.amount + coalesce((select sum(delta) from public.fin_milestone_amendments a where a.milestone_id = m.id and a.status = 'approved'), 0)
    from public.fin_payment_milestones m where m.id = p_milestone_id and (auth.uid() is null or public.fin_job_visible(m.job_id))
$$;

-- When did the milestone's trigger happen? Recorded triggers first; project start / completion also reuse
-- the bid's confirmed stage changes (estimate_stage_history, never planned dates); agreement_signed is the
-- signature (or the manual confirmation of the contract version); calendar_date is the date itself.
create or replace function public.fin_milestone_triggered_at(p_milestone_id uuid) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare m public.fin_payment_milestones; j public.fin_jobs; v timestamptz;
begin
  select * into m from public.fin_payment_milestones where id = p_milestone_id;
  if not found or (auth.uid() is not null and not public.fin_job_visible(m.job_id)) then return null; end if;
  select * into j from public.fin_jobs where id = m.job_id;
  if m.trigger_kind = 'agreement_signed' then
    if m.source = 'change_order' then
      return (select decided_at from public.change_orders where id = m.change_order_id);
    end if;
    return coalesce((select signed_at from public.signatures where id = m.signature_id), (select created_at from public.fin_contract_snapshots where id = m.snapshot_id));
  elsif m.trigger_kind = 'calendar_date' then
    return case when m.due_date <= current_date then m.due_date::timestamptz end;
  elsif m.trigger_kind in ('phase_completed_verified', 'custom_approved') then
    return (select min(occurred_at) from public.fin_milestone_triggers t where t.milestone_id = m.id and t.trigger_kind = m.trigger_kind);
  end if;
  select min(occurred_at) into v from public.fin_milestone_triggers t
   where t.job_id = m.job_id and t.trigger_kind = m.trigger_kind and (t.milestone_id is null or t.milestone_id = m.id);
  return least(v, (select min(coalesce(h.effective_at, h.created_at)) from public.estimate_stage_history h
                    where h.estimate_id = j.estimate_id
                      and h.to_stage = case m.trigger_kind when 'project_start_confirmed' then 'in_progress' else 'completed' end));
end $$;
revoke execute on function public.fin_milestone_amount(uuid), public.fin_milestone_triggered_at(uuid) from public, anon;
grant execute on function public.fin_milestone_amount(uuid), public.fin_milestone_triggered_at(uuid) to authenticated;

-- 4. Invoices -------------------------------------------------------------------------------------------------
create table if not exists public.fin_invoices (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  job_id      uuid not null references public.fin_jobs (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete restrict,
  kind        text not null default 'custom' check (kind in ('deposit', 'milestone', 'progress', 'final', 'custom')),
  status      text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  milestone_id     uuid references public.fin_payment_milestones (id) on delete restrict,
  discrepancies    jsonb not null default '[]' check (jsonb_typeof(discrepancies) = 'array'),   -- vs the milestone, frozen at issue
  exception_reason text check (char_length(exception_reason) <= 500),                           -- required to issue with discrepancies
  exception_by     uuid references auth.users (id) on delete set null,
  seq         bigint,
  number      text check (char_length(number) <= 30),
  issue_date  date,
  due_date    date,
  bill_to     jsonb,                                    -- frozen at issue: {name, email, phone, address}
  memo        text check (char_length(memo) <= 2000),
  tax_rate    numeric(7, 4) not null default 0 check (tax_rate between 0 and 100),
  subtotal    numeric(14, 2) not null default 0,
  tax         numeric(14, 2) not null default 0,
  total       numeric(14, 2) not null default 0,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  issued_by   uuid references auth.users (id) on delete set null,
  issued_at   timestamptz,
  voided_by   uuid references auth.users (id) on delete set null,
  voided_at   timestamptz,
  void_reason text check (char_length(void_reason) <= 500),
  unique (book_id, number),
  constraint fin_invoices_issued check (status = 'draft' or (number is not null and seq is not null and issue_date is not null and due_date is not null and bill_to is not null and issued_at is not null)),
  constraint fin_invoices_void check ((status = 'void') = (voided_at is not null)),
  constraint fin_invoices_sum check (total = subtotal + tax),
  constraint fin_invoices_due check (due_date is null or issue_date is null or due_date >= issue_date)
);
create index if not exists fin_invoices_job_idx on public.fin_invoices (job_id, status);
-- One active invoice per milestone, unless the second one was issued as a recorded exception.
create unique index if not exists fin_invoices_one_per_milestone on public.fin_invoices (milestone_id)
  where milestone_id is not null and status = 'issued' and exception_reason is null;
create index if not exists fin_invoices_book_idx on public.fin_invoices (book_id, status, due_date);

create table if not exists public.fin_invoice_lines (
  id                 uuid primary key default gen_random_uuid(),
  book_id            uuid not null references public.fin_books (id) on delete restrict,
  invoice_id         uuid not null references public.fin_invoices (id) on delete restrict,
  line_no            integer not null check (line_no between 1 and 500),
  kind               text not null check (kind in ('deposit', 'milestone', 'progress', 'final', 'custom', 'deposit_application')),
  description        text not null check (char_length(description) between 1 and 500),
  quantity           numeric(14, 4) not null default 1,
  unit_price         numeric(14, 4) not null,
  amount             numeric(14, 2) not null,
  taxable            boolean not null default false,   -- contract amounts already include the bid's tax
  milestone_index    integer check (milestone_index between 0 and 99),
  applies_invoice_id uuid references public.fin_invoices (id) on delete restrict,   -- deposit_application: the deposit invoice
  unique (invoice_id, line_no),
  constraint fin_invoice_lines_amount check (amount = round(quantity * unit_price, 2)),
  constraint fin_invoice_lines_application check ((kind = 'deposit_application') = (applies_invoice_id is not null) and (kind <> 'deposit_application' or (amount < 0 and not taxable)))
);
create index if not exists fin_invoice_lines_invoice_idx on public.fin_invoice_lines (invoice_id);

-- Issued invoices are frozen: the only change allowed is issued -> void (with who/when/why).
create or replace function public.fin_invoices_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status = 'void' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if old.status = 'issued' and not (new.status = 'void'
      and (to_jsonb(new) - 'status' - 'voided_by' - 'voided_at' - 'void_reason' - 'updated_at')
          = (to_jsonb(old) - 'status' - 'voided_by' - 'voided_at' - 'void_reason' - 'updated_at')) then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  if old.status = 'draft' and new.status = 'void' then raise exception 'bad_state' using errcode = '22023'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists fin_invoices_guard on public.fin_invoices;
create trigger fin_invoices_guard before update or delete on public.fin_invoices for each row execute function public.fin_invoices_guard();

create or replace function public.fin_invoice_lines_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.fin_invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is distinct from 'draft' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists fin_invoice_lines_guard on public.fin_invoice_lines;
create trigger fin_invoice_lines_guard before insert or update or delete on public.fin_invoice_lines for each row execute function public.fin_invoice_lines_guard();

-- Contract value per job (derived): original + approved/signed COs + corrections - deductions.
-- Pending (draft/sent) change orders are listed separately and never counted.
create or replace view public.fin_job_contract_v with (security_invoker = true) as
select j.id as job_id, j.book_id, j.estimate_id, j.job_number, j.name, j.status,
       s.total as original_contract,
       coalesce(c.approved_changes, 0) as approved_changes,
       coalesce(c.deductions, 0) as deductions,
       coalesce(c.corrections, 0) as corrections,
       s.total + coalesce(c.approved_changes, 0) + coalesce(c.deductions, 0) + coalesce(c.corrections, 0) as current_contract,
       coalesce((select sum(co.amount) from public.change_orders co where co.estimate_id = j.estimate_id and co.status in ('draft', 'sent')), 0) as pending_changes,
       coalesce((select sum(i.total) from public.fin_invoices i where i.job_id = j.id and i.status = 'issued'), 0) as invoiced,
       s.total + coalesce(c.approved_changes, 0) + coalesce(c.deductions, 0) + coalesce(c.corrections, 0)
         - coalesce((select sum(i.total) from public.fin_invoices i where i.job_id = j.id and i.status = 'issued'), 0) as remaining_to_bill
  from public.fin_jobs j
  join public.fin_contract_snapshots s on s.job_id = j.id
  left join lateral (
    select sum(amount) filter (where kind = 'change_order') as approved_changes,
           sum(amount) filter (where kind = 'deduction') as deductions,
           sum(amount) filter (where kind = 'correction') as corrections
      from public.fin_contract_changes x where x.job_id = j.id) c on true;

-- The milestone's due date from its due rule and the recorded trigger (null until triggered).
create or replace function public.fin_milestone_due_on(p_milestone_id uuid) returns date
language plpgsql stable security definer set search_path = public as $$
declare m public.fin_payment_milestones; v_t timestamptz; v_tz text;
begin
  select * into m from public.fin_payment_milestones where id = p_milestone_id;
  if not found or (auth.uid() is not null and not public.fin_job_visible(m.job_id)) then return null; end if;
  if m.due_rule = 'date' then return m.due_date; end if;
  v_t := public.fin_milestone_triggered_at(m.id);
  if v_t is null then return null; end if;
  select timezone into v_tz from public.fin_books where id = m.book_id;
  return (v_t at time zone coalesce(v_tz, 'UTC'))::date + coalesce(m.due_days, 0);
end $$;

-- How an invoice differs from its milestone: amount (what is left of the milestone), due date (the due
-- rule; already-due milestones are due on receipt), not yet triggered, or another active invoice.
create or replace function public.fin_invoice_discrepancies(p_invoice_id uuid, p_issue_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare inv public.fin_invoices; v_out jsonb := '[]'; v_expected numeric; v_due date; v_inv_due date;
begin
  select * into inv from public.fin_invoices where id = p_invoice_id;
  if inv.milestone_id is null then return v_out; end if;
  v_expected := public.fin_milestone_amount(inv.milestone_id)
    - coalesce((select sum(total) from public.fin_invoices x where x.milestone_id = inv.milestone_id and x.status = 'issued' and x.id <> inv.id), 0);
  if exists (select 1 from public.fin_invoices x where x.milestone_id = inv.milestone_id and x.status = 'issued' and x.id <> inv.id) then
    v_out := v_out || jsonb_build_object('code', 'duplicate_milestone_invoice');
  end if;
  if inv.total <> v_expected then
    v_out := v_out || jsonb_build_object('code', 'amount_differs', 'expected', v_expected::text, 'actual', inv.total::text);
  end if;
  if public.fin_milestone_triggered_at(inv.milestone_id) is null and (select due_rule from public.fin_payment_milestones where id = inv.milestone_id) <> 'date' then
    v_out := v_out || jsonb_build_object('code', 'not_triggered');
  else
    v_due := greatest(public.fin_milestone_due_on(inv.milestone_id), coalesce(inv.issue_date, p_issue_date));
    v_inv_due := greatest(coalesce(inv.due_date, p_issue_date), coalesce(inv.issue_date, p_issue_date));
    if v_due is distinct from v_inv_due then
      v_out := v_out || jsonb_build_object('code', 'due_date_differs', 'expected', v_due::text, 'actual', v_inv_due::text);
    end if;
  end if;
  return v_out;
end $$;
revoke execute on function public.fin_milestone_due_on(uuid), public.fin_invoice_discrepancies(uuid, date) from public, anon, authenticated;
grant execute on function public.fin_milestone_due_on(uuid) to authenticated;

-- Lines: [{kind, description, quantity?, unitPrice?, taxable?, milestoneIndex?, appliesInvoiceId?}].
-- milestone/deposit lines without unitPrice take the frozen schedule amount; a final line without
-- unitPrice takes the remaining contract (current contract - issued invoices).
create or replace function public.fin_invoice_save(p_job_id uuid, p jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.fin_jobs; inv public.fin_invoices; v_prior jsonb; l jsonb; v_no integer := 0; v_kind text; v_qty numeric; v_unit numeric;
        v_sched jsonb; v_remaining numeric; v_sub numeric; v_taxable numeric; v_tax numeric; v_applies uuid; v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_ms public.fin_payment_milestones; v_lines jsonb := coalesce(p -> 'lines', '[]'::jsonb); v_due date := nullif(p ->> 'dueDate', '')::date;
begin
  select * into j from public.fin_jobs where id = p_job_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(j.book_id, 'create_invoices', true);
  v_prior := public.fin_idem_begin(j.book_id, p_idempotency_key, 'invoice.save');
  if v_prior is not null then return v_prior; end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) > 500 then
    raise exception 'bad_lines' using errcode = '22023';
  end if;
  if nullif(p ->> 'milestoneId', '') is not null then
    select * into v_ms from public.fin_payment_milestones where id = (p ->> 'milestoneId')::uuid and job_id = p_job_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if jsonb_array_length(v_lines) = 0 then   -- default: one line for what is left of the milestone
      v_lines := jsonb_build_array(jsonb_build_object('kind', case when v_ms.is_deposit then 'deposit' else 'milestone' end, 'description', v_ms.description,
        'unitPrice', (public.fin_milestone_amount(v_ms.id) - coalesce((select sum(total) from public.fin_invoices x where x.milestone_id = v_ms.id and x.status = 'issued'), 0))::text));
    end if;
    v_due := coalesce(v_due, public.fin_milestone_due_on(v_ms.id));
  end if;
  if v_id is not null then
    select * into inv from public.fin_invoices where id = v_id and job_id = p_job_id for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if inv.status <> 'draft' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
    delete from public.fin_invoice_lines where invoice_id = v_id;
    update public.fin_invoices set kind = coalesce(nullif(p ->> 'kind', ''), case when v_ms.is_deposit then 'deposit' when v_ms.id is not null then 'milestone' else 'custom' end),
      memo = nullif(left(p ->> 'memo', 2000), ''), due_date = v_due, milestone_id = v_ms.id where id = v_id returning * into inv;
  else
    insert into public.fin_invoices (book_id, job_id, customer_id, kind, memo, due_date, tax_rate, milestone_id, created_by)
    values (j.book_id, j.id, j.customer_id, coalesce(nullif(p ->> 'kind', ''), case when v_ms.is_deposit then 'deposit' when v_ms.id is not null then 'milestone' else 'custom' end),
            nullif(left(p ->> 'memo', 2000), ''), v_due, j.tax_rate, v_ms.id, auth.uid())
    returning * into inv;
  end if;
  select payment_schedule into v_sched from public.fin_contract_snapshots where job_id = j.id;
  select remaining_to_bill into v_remaining from public.fin_job_contract_v where job_id = j.id;
  for l in select * from jsonb_array_elements(v_lines) loop
    v_no := v_no + 1;
    v_kind := coalesce(nullif(l ->> 'kind', ''), 'custom');
    v_qty := coalesce(nullif(l ->> 'quantity', '')::numeric, 1);
    v_unit := nullif(l ->> 'unitPrice', '')::numeric;
    v_applies := nullif(l ->> 'appliesInvoiceId', '')::uuid;
    if v_unit is null and v_kind in ('deposit', 'milestone') and (l ->> 'milestoneIndex') is not null then
      v_unit := (select (m ->> 'amount')::numeric from jsonb_array_elements(v_sched) m where (m ->> 'index')::integer = (l ->> 'milestoneIndex')::integer);
      v_qty := 1;
    elsif v_unit is null and v_kind = 'final' then
      v_unit := v_remaining; v_qty := 1;
    elsif v_unit is null and v_kind = 'deposit_application' then
      v_unit := -(select total from public.fin_invoices d where d.id = v_applies and d.job_id = j.id and d.status = 'issued' and d.kind = 'deposit'); v_qty := 1;
    end if;
    if v_unit is null then raise exception 'bad_line' using errcode = '22023'; end if;
    if v_kind = 'deposit_application' and not exists (select 1 from public.fin_invoices d where d.id = v_applies and d.job_id = j.id and d.status = 'issued' and d.kind = 'deposit') then
      raise exception 'bad_deposit_application' using errcode = '22023';
    end if;
    insert into public.fin_invoice_lines (book_id, invoice_id, line_no, kind, description, quantity, unit_price, amount, taxable, milestone_index, applies_invoice_id)
    values (j.book_id, inv.id, v_no, v_kind, left(coalesce(nullif(btrim(l ->> 'description'), ''), initcap(replace(v_kind, '_', ' '))), 500),
            v_qty, v_unit, round(v_qty * v_unit, 2), v_kind <> 'deposit_application' and coalesce((l ->> 'taxable')::boolean, false),
            nullif(l ->> 'milestoneIndex', '')::integer, v_applies);
  end loop;
  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where taxable), 0) into v_sub, v_taxable from public.fin_invoice_lines where invoice_id = inv.id;
  v_tax := round(v_taxable * inv.tax_rate / 100, 2);
  update public.fin_invoices set subtotal = v_sub, tax = v_tax, total = v_sub + v_tax where id = inv.id;
  return public.fin_idem_finish(j.book_id, p_idempotency_key, jsonb_build_object('invoiceId', inv.id, 'total', (v_sub + v_tax)::text,
    'discrepancies', public.fin_invoice_discrepancies(inv.id, current_date)));
end $$;

create or replace function public.fin_invoice_delete_draft(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.fin_invoices;
begin
  select * into inv from public.fin_invoices where id = p_invoice_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(inv.book_id, 'create_invoices', true);
  if inv.status <> 'draft' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  delete from public.fin_invoice_lines where invoice_id = p_invoice_id;
  delete from public.fin_invoices where id = p_invoice_id;
end $$;

-- Issue: assign the next gapless number, freeze bill-to and totals.
create or replace function public.fin_invoice_issue(p_invoice_id uuid, p_issue_date date default null, p_exception_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv public.fin_invoices; j public.fin_jobs; e public.estimates; c public.customers; n record; v_issue date; v_disc jsonb;
        v_reason text := nullif(left(btrim(coalesce(p_exception_reason, '')), 500), '');
begin
  select * into inv from public.fin_invoices where id = p_invoice_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(inv.book_id, 'create_invoices', true);
  if inv.status = 'issued' then return jsonb_build_object('invoiceId', inv.id, 'number', inv.number, 'replayed', true); end if;
  if inv.status <> 'draft' then raise exception 'bad_state' using errcode = '22023'; end if;
  if not exists (select 1 from public.fin_invoice_lines where invoice_id = inv.id) then raise exception 'empty_invoice' using errcode = '22023'; end if;
  if inv.total <= 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  select * into j from public.fin_jobs where id = inv.job_id;
  select * into e from public.estimates where id = j.estimate_id;
  if inv.customer_id is not null then select * into c from public.customers where id = inv.customer_id; end if;
  v_issue := coalesce(p_issue_date, current_date);
  if inv.milestone_id is not null then
    perform 1 from public.fin_payment_milestones where id = inv.milestone_id for update;   -- serialize issuing against one milestone
  end if;
  v_disc := public.fin_invoice_discrepancies(inv.id, v_issue);
  if jsonb_array_length(v_disc) > 0 then
    if v_reason is null then
      raise exception 'milestone_discrepancy' using errcode = '22023', detail = v_disc::text;
    end if;
    if coalesce((select require_billing_exception_approval from public.fin_business_config where book_id = inv.book_id), false) then
      perform public.fin_require(inv.book_id, 'manage_financial_config', true);
    end if;
  else
    v_reason := null;
  end if;
  select * into n from public.fin_next_number(inv.book_id, 'invoice');
  update public.fin_invoices set status = 'issued', seq = n.seq, number = n.label, issue_date = v_issue,
    due_date = greatest(coalesce(due_date, v_issue), v_issue), issued_at = now(), issued_by = auth.uid(),
    discrepancies = v_disc, exception_reason = v_reason, exception_by = case when v_reason is not null then auth.uid() end,
    bill_to = jsonb_strip_nulls(jsonb_build_object('name', coalesce(nullif(c.name, ''), nullif(e.customer_name, ''), 'Customer'),
      'email', coalesce(c.email, e.customer_email), 'phone', coalesce(c.phone, e.customer_phone),
      'address', coalesce(c.project_address, e.project_address)))
  where id = inv.id returning * into inv;
  perform public.fin_audit(inv.book_id, 'invoice.issued', 'invoice', inv.id, jsonb_build_object('number', inv.number, 'total', inv.total::text,
    'milestoneId', inv.milestone_id, 'discrepancies', v_disc, 'exceptionReason', v_reason));
  return jsonb_build_object('invoiceId', inv.id, 'number', inv.number, 'total', inv.total::text, 'discrepancies', v_disc);
end $$;

-- 5. Payments, allocations, credit memos, refunds ---------------------------------------------------------------
create table if not exists public.fin_payments (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete restrict,
  job_id      uuid references public.fin_jobs (id) on delete restrict,   -- where it was recorded (allocations decide where it applies)
  seq         bigint not null,
  number      text not null check (char_length(number) <= 30),
  received_on date not null,
  method      text not null check (method in ('check', 'cash', 'ach', 'card', 'wire', 'other')),
  reference   text check (char_length(reference) <= 120),
  amount      numeric(14, 2) not null check (amount > 0),
  memo        text check (char_length(memo) <= 1000),
  source      text not null default 'manual' check (source in ('manual')),   -- processor payments arrive in Phase 3
  verified    boolean not null default false,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  status      text not null default 'active' check (status in ('active', 'void')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  voided_by   uuid references auth.users (id) on delete set null,
  voided_at   timestamptz,
  void_reason text check (char_length(void_reason) <= 500),
  unique (book_id, number),
  constraint fin_payments_verified check (verified = (verified_at is not null)),
  constraint fin_payments_void check ((status = 'void') = (voided_at is not null))
);
create index if not exists fin_payments_book_idx on public.fin_payments (book_id, received_on desc);
create index if not exists fin_payments_customer_idx on public.fin_payments (customer_id) where customer_id is not null;

create table if not exists public.fin_payment_allocations (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  payment_id  uuid not null references public.fin_payments (id) on delete restrict,
  invoice_id  uuid not null references public.fin_invoices (id) on delete restrict,
  amount      numeric(14, 2) not null check (amount > 0),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  reversed_by uuid references auth.users (id) on delete set null,
  reversed_at timestamptz
);
create index if not exists fin_payment_allocations_payment_idx on public.fin_payment_allocations (payment_id) where reversed_at is null;
create index if not exists fin_payment_allocations_invoice_idx on public.fin_payment_allocations (invoice_id) where reversed_at is null;

create table if not exists public.fin_credit_memos (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete restrict,
  job_id      uuid references public.fin_jobs (id) on delete restrict,
  invoice_id  uuid references public.fin_invoices (id) on delete restrict,   -- the invoice it relates to (informational)
  seq         bigint not null,
  number      text not null check (char_length(number) <= 30),
  issue_date  date not null,
  amount      numeric(14, 2) not null check (amount > 0),
  reason      text not null check (char_length(reason) between 1 and 500),
  status      text not null default 'issued' check (status in ('issued', 'void')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  voided_by   uuid references auth.users (id) on delete set null,
  voided_at   timestamptz,
  void_reason text check (char_length(void_reason) <= 500),
  unique (book_id, number),
  constraint fin_credit_memos_void check ((status = 'void') = (voided_at is not null))
);

create table if not exists public.fin_credit_applications (
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid not null references public.fin_books (id) on delete restrict,
  credit_memo_id uuid not null references public.fin_credit_memos (id) on delete restrict,
  invoice_id     uuid not null references public.fin_invoices (id) on delete restrict,
  amount         numeric(14, 2) not null check (amount > 0),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  reversed_by    uuid references auth.users (id) on delete set null,
  reversed_at    timestamptz
);
create index if not exists fin_credit_applications_memo_idx on public.fin_credit_applications (credit_memo_id) where reversed_at is null;
create index if not exists fin_credit_applications_invoice_idx on public.fin_credit_applications (invoice_id) where reversed_at is null;

create table if not exists public.fin_refunds (
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid not null references public.fin_books (id) on delete restrict,
  payment_id     uuid references public.fin_payments (id) on delete restrict,       -- refund of an unapplied payment
  credit_memo_id uuid references public.fin_credit_memos (id) on delete restrict,   -- or of an available credit
  seq            bigint not null,
  number         text not null check (char_length(number) <= 30),
  refunded_on    date not null,
  method         text not null check (method in ('check', 'cash', 'ach', 'card', 'wire', 'other')),
  reference      text check (char_length(reference) <= 120),
  amount         numeric(14, 2) not null check (amount > 0),
  memo           text check (char_length(memo) <= 1000),
  status         text not null default 'active' check (status in ('active', 'void')),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  voided_by      uuid references auth.users (id) on delete set null,
  voided_at      timestamptz,
  void_reason    text check (char_length(void_reason) <= 500),
  unique (book_id, number),
  constraint fin_refunds_source check ((payment_id is null) <> (credit_memo_id is null)),
  constraint fin_refunds_void check ((status = 'void') = (voided_at is not null))
);

-- Write-once rows: only the listed lifecycle columns may change (verify, void, reverse); never deleted.
create or replace function public.fin_guard_lifecycle() returns trigger
language plpgsql set search_path = public as $$
declare v_allowed text[] := tg_argv::text[]; v_new jsonb; v_old jsonb; k text;
begin
  if tg_op = 'DELETE' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  v_new := to_jsonb(new); v_old := to_jsonb(old);
  foreach k in array v_allowed loop v_new := v_new - k; v_old := v_old - k; end loop;
  if v_new is distinct from v_old then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if (to_jsonb(old) ->> 'status') = 'void' then
    raise exception 'record_immutable' using errcode = 'P0001';   -- a voided row never changes again
  end if;
  if to_jsonb(old) ? 'reversed_at' and (to_jsonb(old) ->> 'reversed_at') is not null then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists fin_payments_guard on public.fin_payments;
create trigger fin_payments_guard before update or delete on public.fin_payments
  for each row execute function public.fin_guard_lifecycle('verified', 'verified_by', 'verified_at', 'status', 'voided_by', 'voided_at', 'void_reason');
drop trigger if exists fin_payment_allocations_guard on public.fin_payment_allocations;
create trigger fin_payment_allocations_guard before update or delete on public.fin_payment_allocations
  for each row execute function public.fin_guard_lifecycle('reversed_by', 'reversed_at');
drop trigger if exists fin_credit_memos_guard on public.fin_credit_memos;
create trigger fin_credit_memos_guard before update or delete on public.fin_credit_memos
  for each row execute function public.fin_guard_lifecycle('status', 'voided_by', 'voided_at', 'void_reason');
drop trigger if exists fin_credit_applications_guard on public.fin_credit_applications;
create trigger fin_credit_applications_guard before update or delete on public.fin_credit_applications
  for each row execute function public.fin_guard_lifecycle('reversed_by', 'reversed_at');
drop trigger if exists fin_refunds_guard on public.fin_refunds;
create trigger fin_refunds_guard before update or delete on public.fin_refunds
  for each row execute function public.fin_guard_lifecycle('status', 'voided_by', 'voided_at', 'void_reason');

-- Derived amounts (used by the RPCs, the backstop and the views).
create or replace function public.fin_invoice_applied(p_invoice_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount) from public.fin_payment_allocations where invoice_id = p_invoice_id and reversed_at is null), 0)
       + coalesce((select sum(amount) from public.fin_credit_applications where invoice_id = p_invoice_id and reversed_at is null), 0)
$$;
create or replace function public.fin_payment_unapplied(p_payment_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select p.amount
       - coalesce((select sum(amount) from public.fin_payment_allocations where payment_id = p.id and reversed_at is null), 0)
       - coalesce((select sum(amount) from public.fin_refunds where payment_id = p.id and status = 'active'), 0)
    from public.fin_payments p where p.id = p_payment_id
$$;
create or replace function public.fin_credit_available(p_credit_memo_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select m.amount
       - coalesce((select sum(amount) from public.fin_credit_applications where credit_memo_id = m.id and reversed_at is null), 0)
       - coalesce((select sum(amount) from public.fin_refunds where credit_memo_id = m.id and status = 'active'), 0)
    from public.fin_credit_memos m where m.id = p_credit_memo_id
$$;
revoke execute on function public.fin_invoice_applied(uuid), public.fin_payment_unapplied(uuid), public.fin_credit_available(uuid) from public, anon, authenticated;

-- Backstop, checked at commit: nothing is over-applied, whatever path wrote the rows.
create or replace function public.fin_check_receivable_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_inv uuid; v_pay uuid; v_cm uuid;
begin
  if tg_table_name = 'fin_payment_allocations' then v_inv := new.invoice_id; v_pay := new.payment_id;
  elsif tg_table_name = 'fin_credit_applications' then v_inv := new.invoice_id; v_cm := new.credit_memo_id;
  else v_pay := new.payment_id; v_cm := new.credit_memo_id; end if;
  if v_inv is not null and public.fin_invoice_applied(v_inv) > (select case when status = 'issued' then total else 0 end from public.fin_invoices where id = v_inv) then
    raise exception 'over_applied_invoice' using errcode = '23514';
  end if;
  if v_pay is not null and (public.fin_payment_unapplied(v_pay) < 0
      or ((select status from public.fin_payments where id = v_pay) = 'void' and public.fin_payment_unapplied(v_pay) <> (select amount from public.fin_payments where id = v_pay))) then
    raise exception 'over_applied_payment' using errcode = '23514';
  end if;
  if v_cm is not null and (public.fin_credit_available(v_cm) < 0
      or ((select status from public.fin_credit_memos where id = v_cm) = 'void' and public.fin_credit_available(v_cm) <> (select amount from public.fin_credit_memos where id = v_cm))) then
    raise exception 'over_applied_credit' using errcode = '23514';
  end if;
  return null;
end $$;
revoke execute on function public.fin_check_receivable_totals() from public, anon, authenticated;
drop trigger if exists fin_payment_allocations_check on public.fin_payment_allocations;
create constraint trigger fin_payment_allocations_check after insert or update on public.fin_payment_allocations
  deferrable initially deferred for each row execute function public.fin_check_receivable_totals();
drop trigger if exists fin_credit_applications_check on public.fin_credit_applications;
create constraint trigger fin_credit_applications_check after insert or update on public.fin_credit_applications
  deferrable initially deferred for each row execute function public.fin_check_receivable_totals();
drop trigger if exists fin_refunds_check on public.fin_refunds;
create constraint trigger fin_refunds_check after insert or update on public.fin_refunds
  deferrable initially deferred for each row execute function public.fin_check_receivable_totals();

-- Allocate (internal): the payment is already locked; lock the invoices in id order, then check.
create or replace function public.fin_allocate_internal(p_payment public.fin_payments, p_allocations jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a record; inv public.fin_invoices; v_left numeric;
begin
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then return; end if;
  if p_payment.status <> 'active' then raise exception 'bad_state' using errcode = '22023'; end if;
  perform 1 from public.fin_invoices where id in (select (x ->> 'invoiceId')::uuid from jsonb_array_elements(p_allocations) x) order by id for update;
  v_left := public.fin_payment_unapplied(p_payment.id);
  for a in select (x ->> 'invoiceId')::uuid as invoice_id, (x ->> 'amount')::numeric as amount from jsonb_array_elements(p_allocations) x loop
    select * into inv from public.fin_invoices where id = a.invoice_id;
    if not found or inv.book_id <> p_payment.book_id then raise exception 'not_found' using errcode = 'P0002'; end if;
    if inv.status <> 'issued' then raise exception 'invoice_not_open' using errcode = '22023'; end if;
    if p_payment.customer_id is not null and inv.customer_id is not null and inv.customer_id <> p_payment.customer_id then
      raise exception 'customer_mismatch' using errcode = '22023';
    end if;
    if a.amount is null or a.amount <= 0 or a.amount <> round(a.amount, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
    if a.amount > inv.total - public.fin_invoice_applied(inv.id) then raise exception 'over_applied_invoice' using errcode = '22023'; end if;
    if a.amount > v_left then raise exception 'over_applied_payment' using errcode = '22023'; end if;
    insert into public.fin_payment_allocations (book_id, payment_id, invoice_id, amount, created_by) values (p_payment.book_id, p_payment.id, inv.id, a.amount, auth.uid());
    v_left := v_left - a.amount;
  end loop;
end $$;
revoke execute on function public.fin_allocate_internal(public.fin_payments, jsonb) from public, anon, authenticated;

-- Record a manual payment (unverified) and optionally allocate it: p {customerId?, jobId?, receivedOn,
-- method, reference?, amount, memo?, allocations: [{invoiceId, amount}]}. Anything not allocated stays
-- unapplied (overpayment = customer credit, refundable).
create or replace function public.fin_payment_record(p_book_id uuid, p jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prior jsonb; n record; pay public.fin_payments; v_amount numeric := (p ->> 'amount')::numeric; v_job uuid := nullif(p ->> 'jobId', '')::uuid;
        v_customer uuid := nullif(p ->> 'customerId', '')::uuid;
begin
  perform public.fin_require(p_book_id, 'record_payments', true);
  v_prior := public.fin_idem_begin(p_book_id, p_idempotency_key, 'payment.record');
  if v_prior is not null then return v_prior; end if;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  if v_job is not null then
    if not exists (select 1 from public.fin_jobs where id = v_job and book_id = p_book_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
    v_customer := coalesce(v_customer, (select customer_id from public.fin_jobs where id = v_job));
  end if;
  if v_customer is not null and not exists (select 1 from public.fin_jobs where book_id = p_book_id and customer_id = v_customer) then
    raise exception 'customer_not_in_book' using errcode = '22023';
  end if;
  select * into n from public.fin_next_number(p_book_id, 'payment');
  insert into public.fin_payments (book_id, customer_id, job_id, seq, number, received_on, method, reference, amount, memo, created_by)
  values (p_book_id, v_customer, v_job, n.seq, n.label, coalesce(nullif(p ->> 'receivedOn', '')::date, current_date), coalesce(nullif(p ->> 'method', ''), 'other'),
          nullif(left(p ->> 'reference', 120), ''), v_amount, nullif(left(p ->> 'memo', 1000), ''), auth.uid())
  returning * into pay;
  perform 1 from public.fin_payments where id = pay.id for update;
  perform public.fin_allocate_internal(pay, p -> 'allocations');
  perform public.fin_audit(p_book_id, 'payment.recorded', 'payment', pay.id, jsonb_build_object('number', pay.number, 'amount', pay.amount::text, 'allocations', p -> 'allocations'));
  return public.fin_idem_finish(p_book_id, p_idempotency_key,
    jsonb_build_object('paymentId', pay.id, 'number', pay.number, 'unapplied', public.fin_payment_unapplied(pay.id)::text));
end $$;

create or replace function public.fin_payment_allocate(p_payment_id uuid, p_allocations jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pay public.fin_payments; v_prior jsonb;
begin
  select * into pay from public.fin_payments where id = p_payment_id for update;   -- lock order: payment, then invoices by id
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(pay.book_id, 'record_payments', true);
  v_prior := public.fin_idem_begin(pay.book_id, p_idempotency_key, 'payment.allocate');
  if v_prior is not null then return v_prior; end if;
  perform public.fin_allocate_internal(pay, p_allocations);
  perform public.fin_audit(pay.book_id, 'payment.allocated', 'payment', pay.id, jsonb_build_object('allocations', p_allocations));
  return public.fin_idem_finish(pay.book_id, p_idempotency_key, jsonb_build_object('paymentId', pay.id, 'unapplied', public.fin_payment_unapplied(pay.id)::text));
end $$;

create or replace function public.fin_allocation_reverse(p_allocation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.fin_payment_allocations;
begin
  select * into a from public.fin_payment_allocations where id = p_allocation_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(a.book_id, 'record_payments', true);
  perform 1 from public.fin_payments where id = a.payment_id for update;
  perform 1 from public.fin_invoices where id = a.invoice_id for update;
  update public.fin_payment_allocations set reversed_at = now(), reversed_by = auth.uid() where id = p_allocation_id and reversed_at is null;
  if found then perform public.fin_audit(a.book_id, 'allocation.reversed', 'payment', a.payment_id, jsonb_build_object('allocationId', a.id, 'amount', a.amount::text)); end if;
end $$;

create or replace function public.fin_payment_verify(p_payment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pay public.fin_payments;
begin
  select * into pay from public.fin_payments where id = p_payment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(pay.book_id, 'record_payments', true);
  if pay.status <> 'active' then raise exception 'bad_state' using errcode = '22023'; end if;
  if pay.verified then return; end if;
  update public.fin_payments set verified = true, verified_at = now(), verified_by = auth.uid() where id = p_payment_id;
  perform public.fin_audit(pay.book_id, 'payment.verified', 'payment', pay.id, null);
end $$;

-- Void a payment (bounced / entered in error): its allocations are reversed; refunds must be voided first.
create or replace function public.fin_payment_void(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare pay public.fin_payments;
begin
  select * into pay from public.fin_payments where id = p_payment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(pay.book_id, 'record_payments', true);
  if pay.status = 'void' then return; end if;
  if exists (select 1 from public.fin_refunds where payment_id = pay.id and status = 'active') then raise exception 'has_refunds' using errcode = '22023'; end if;
  perform 1 from public.fin_invoices where id in (select invoice_id from public.fin_payment_allocations where payment_id = pay.id and reversed_at is null) order by id for update;
  update public.fin_payment_allocations set reversed_at = now(), reversed_by = auth.uid() where payment_id = pay.id and reversed_at is null;
  update public.fin_payments set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Voided'), 500) where id = pay.id;
  perform public.fin_audit(pay.book_id, 'payment.voided', 'payment', pay.id, jsonb_build_object('reason', p_reason));
end $$;

-- Void an issued invoice: only when nothing is applied to it (reverse allocations / credits first).
create or replace function public.fin_invoice_void(p_invoice_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.fin_invoices;
begin
  select * into inv from public.fin_invoices where id = p_invoice_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(inv.book_id, 'create_invoices', true);
  if inv.status = 'void' then return; end if;
  if inv.status <> 'issued' then raise exception 'bad_state' using errcode = '22023'; end if;
  if public.fin_invoice_applied(inv.id) > 0 then raise exception 'has_applications' using errcode = '22023'; end if;
  if exists (select 1 from public.fin_invoice_lines l join public.fin_invoices f on f.id = l.invoice_id
             where l.applies_invoice_id = inv.id and f.status = 'issued') then
    raise exception 'deposit_applied' using errcode = '22023';
  end if;
  update public.fin_invoices set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Voided'), 500) where id = inv.id;
  perform public.fin_audit(inv.book_id, 'invoice.voided', 'invoice', inv.id, jsonb_build_object('number', inv.number, 'reason', p_reason));
end $$;

-- Credit memo: p {jobId?, customerId?, invoiceId?, amount, reason, issueDate?, applyTo: [{invoiceId, amount}]}.
create or replace function public.fin_credit_memo_issue(p_book_id uuid, p jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prior jsonb; n record; m public.fin_credit_memos; v_amount numeric := (p ->> 'amount')::numeric; v_job uuid := nullif(p ->> 'jobId', '')::uuid;
        v_inv uuid := nullif(p ->> 'invoiceId', '')::uuid; v_customer uuid := nullif(p ->> 'customerId', '')::uuid;
begin
  perform public.fin_require(p_book_id, 'create_invoices', true);
  v_prior := public.fin_idem_begin(p_book_id, p_idempotency_key, 'credit_memo.issue');
  if v_prior is not null then return v_prior; end if;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  if v_inv is not null then
    select coalesce(v_job, job_id), coalesce(v_customer, customer_id) into v_job, v_customer from public.fin_invoices where id = v_inv and book_id = p_book_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  if v_job is not null then
    if not exists (select 1 from public.fin_jobs where id = v_job and book_id = p_book_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
    v_customer := coalesce(v_customer, (select customer_id from public.fin_jobs where id = v_job));
  end if;
  select * into n from public.fin_next_number(p_book_id, 'credit_memo');
  insert into public.fin_credit_memos (book_id, customer_id, job_id, invoice_id, seq, number, issue_date, amount, reason, created_by)
  values (p_book_id, v_customer, v_job, v_inv, n.seq, n.label, coalesce(nullif(p ->> 'issueDate', '')::date, current_date), v_amount,
          left(coalesce(nullif(btrim(p ->> 'reason'), ''), 'Credit'), 500), auth.uid())
  returning * into m;
  perform public.fin_credit_apply_internal(m.id, p -> 'applyTo');
  perform public.fin_audit(p_book_id, 'credit_memo.issued', 'credit_memo', m.id, jsonb_build_object('number', m.number, 'amount', m.amount::text));
  return public.fin_idem_finish(p_book_id, p_idempotency_key, jsonb_build_object('creditMemoId', m.id, 'number', m.number, 'available', public.fin_credit_available(m.id)::text));
end $$;

create or replace function public.fin_credit_apply_internal(p_credit_memo_id uuid, p_apply jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m public.fin_credit_memos; a record; inv public.fin_invoices; v_left numeric;
begin
  if p_apply is null or jsonb_typeof(p_apply) <> 'array' or jsonb_array_length(p_apply) = 0 then return; end if;
  select * into m from public.fin_credit_memos where id = p_credit_memo_id for update;
  if m.status <> 'issued' then raise exception 'bad_state' using errcode = '22023'; end if;
  perform 1 from public.fin_invoices where id in (select (x ->> 'invoiceId')::uuid from jsonb_array_elements(p_apply) x) order by id for update;
  v_left := public.fin_credit_available(m.id);
  for a in select (x ->> 'invoiceId')::uuid as invoice_id, (x ->> 'amount')::numeric as amount from jsonb_array_elements(p_apply) x loop
    select * into inv from public.fin_invoices where id = a.invoice_id;
    if not found or inv.book_id <> m.book_id then raise exception 'not_found' using errcode = 'P0002'; end if;
    if inv.status <> 'issued' then raise exception 'invoice_not_open' using errcode = '22023'; end if;
    if m.customer_id is not null and inv.customer_id is not null and inv.customer_id <> m.customer_id then raise exception 'customer_mismatch' using errcode = '22023'; end if;
    if a.amount is null or a.amount <= 0 or a.amount <> round(a.amount, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
    if a.amount > inv.total - public.fin_invoice_applied(inv.id) then raise exception 'over_applied_invoice' using errcode = '22023'; end if;
    if a.amount > v_left then raise exception 'over_applied_credit' using errcode = '22023'; end if;
    insert into public.fin_credit_applications (book_id, credit_memo_id, invoice_id, amount, created_by) values (m.book_id, m.id, inv.id, a.amount, auth.uid());
    v_left := v_left - a.amount;
  end loop;
end $$;
revoke execute on function public.fin_credit_apply_internal(uuid, jsonb) from public, anon, authenticated;

create or replace function public.fin_credit_memo_apply(p_credit_memo_id uuid, p_apply jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.fin_credit_memos; v_prior jsonb;
begin
  select * into m from public.fin_credit_memos where id = p_credit_memo_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(m.book_id, 'create_invoices', true);
  v_prior := public.fin_idem_begin(m.book_id, p_idempotency_key, 'credit_memo.apply');
  if v_prior is not null then return v_prior; end if;
  perform public.fin_credit_apply_internal(m.id, p_apply);
  perform public.fin_audit(m.book_id, 'credit_memo.applied', 'credit_memo', m.id, jsonb_build_object('applyTo', p_apply));
  return public.fin_idem_finish(m.book_id, p_idempotency_key, jsonb_build_object('creditMemoId', m.id, 'available', public.fin_credit_available(m.id)::text));
end $$;

create or replace function public.fin_credit_application_reverse(p_application_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.fin_credit_applications;
begin
  select * into a from public.fin_credit_applications where id = p_application_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(a.book_id, 'create_invoices', true);
  perform 1 from public.fin_credit_memos where id = a.credit_memo_id for update;
  perform 1 from public.fin_invoices where id = a.invoice_id for update;
  update public.fin_credit_applications set reversed_at = now(), reversed_by = auth.uid() where id = p_application_id and reversed_at is null;
  if found then perform public.fin_audit(a.book_id, 'credit_application.reversed', 'credit_memo', a.credit_memo_id, jsonb_build_object('applicationId', a.id)); end if;
end $$;

create or replace function public.fin_credit_memo_void(p_credit_memo_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.fin_credit_memos;
begin
  select * into m from public.fin_credit_memos where id = p_credit_memo_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(m.book_id, 'create_invoices', true);
  if m.status = 'void' then return; end if;
  if exists (select 1 from public.fin_refunds where credit_memo_id = m.id and status = 'active') then raise exception 'has_refunds' using errcode = '22023'; end if;
  perform 1 from public.fin_invoices where id in (select invoice_id from public.fin_credit_applications where credit_memo_id = m.id and reversed_at is null) order by id for update;
  update public.fin_credit_applications set reversed_at = now(), reversed_by = auth.uid() where credit_memo_id = m.id and reversed_at is null;
  update public.fin_credit_memos set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Voided'), 500) where id = m.id;
  perform public.fin_audit(m.book_id, 'credit_memo.voided', 'credit_memo', m.id, jsonb_build_object('reason', p_reason));
end $$;

-- Refund the unapplied part of a payment, or the available part of a credit memo:
-- p {paymentId | creditMemoId, amount, refundedOn?, method, reference?, memo?}.
create or replace function public.fin_refund_record(p_book_id uuid, p jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prior jsonb; n record; r public.fin_refunds; v_amount numeric := (p ->> 'amount')::numeric; v_pay uuid := nullif(p ->> 'paymentId', '')::uuid;
        v_cm uuid := nullif(p ->> 'creditMemoId', '')::uuid; v_avail numeric;
begin
  perform public.fin_require(p_book_id, 'record_payments', true);
  v_prior := public.fin_idem_begin(p_book_id, p_idempotency_key, 'refund.record');
  if v_prior is not null then return v_prior; end if;
  if (v_pay is null) = (v_cm is null) then raise exception 'bad_source' using errcode = '22023'; end if;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  if v_pay is not null then
    perform 1 from public.fin_payments where id = v_pay and book_id = p_book_id and status = 'active' for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    v_avail := public.fin_payment_unapplied(v_pay);
  else
    perform 1 from public.fin_credit_memos where id = v_cm and book_id = p_book_id and status = 'issued' for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    v_avail := public.fin_credit_available(v_cm);
  end if;
  if v_amount > v_avail then raise exception 'over_refund' using errcode = '22023'; end if;
  select * into n from public.fin_next_number(p_book_id, 'refund');
  insert into public.fin_refunds (book_id, payment_id, credit_memo_id, seq, number, refunded_on, method, reference, amount, memo, created_by)
  values (p_book_id, v_pay, v_cm, n.seq, n.label, coalesce(nullif(p ->> 'refundedOn', '')::date, current_date), coalesce(nullif(p ->> 'method', ''), 'other'),
          nullif(left(p ->> 'reference', 120), ''), v_amount, nullif(left(p ->> 'memo', 1000), ''), auth.uid())
  returning * into r;
  perform public.fin_audit(p_book_id, 'refund.recorded', 'refund', r.id, jsonb_build_object('number', r.number, 'amount', r.amount::text));
  return public.fin_idem_finish(p_book_id, p_idempotency_key, jsonb_build_object('refundId', r.id, 'number', r.number));
end $$;

create or replace function public.fin_refund_void(p_refund_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.fin_refunds;
begin
  select * into r from public.fin_refunds where id = p_refund_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(r.book_id, 'record_payments', true);
  if r.payment_id is not null then perform 1 from public.fin_payments where id = r.payment_id for update;
  else perform 1 from public.fin_credit_memos where id = r.credit_memo_id for update; end if;
  update public.fin_refunds set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Voided'), 500)
   where id = r.id and status = 'active';
  if found then perform public.fin_audit(r.book_id, 'refund.voided', 'refund', r.id, jsonb_build_object('reason', p_reason)); end if;
end $$;

-- 6. Derived balances (security_invoker: each reader sees only rows their RLS allows) --------------------------
create or replace view public.fin_invoice_balances_v with (security_invoker = true) as
select i.id as invoice_id, i.book_id, i.job_id, i.customer_id, i.number, i.kind, i.status, i.issue_date, i.due_date, i.total,
       coalesce(pa.paid, 0) as paid, coalesce(ca.credited, 0) as credited,
       case when i.status = 'issued' then i.total - coalesce(pa.paid, 0) - coalesce(ca.credited, 0) else 0 end as balance,
       case when i.status = 'issued' and i.total - coalesce(pa.paid, 0) - coalesce(ca.credited, 0) > 0 and i.due_date < current_date
            then current_date - i.due_date else 0 end as days_overdue,
       case when i.status <> 'issued' then 'none'
            when i.total - coalesce(pa.paid, 0) - coalesce(ca.credited, 0) <= 0 then 'paid'
            when i.due_date >= current_date then 'current'
            when current_date - i.due_date <= 30 then '1_30'
            when current_date - i.due_date <= 60 then '31_60'
            when current_date - i.due_date <= 90 then '61_90'
            else 'over_90' end as aging_bucket
  from public.fin_invoices i
  left join lateral (select sum(amount) as paid from public.fin_payment_allocations a where a.invoice_id = i.id and a.reversed_at is null) pa on true
  left join lateral (select sum(amount) as credited from public.fin_credit_applications c where c.invoice_id = i.id and c.reversed_at is null) ca on true;

create or replace view public.fin_payment_balances_v with (security_invoker = true) as
select p.id as payment_id, p.book_id, p.customer_id, p.job_id, p.number, p.received_on, p.method, p.amount, p.verified, p.status,
       coalesce(a.applied, 0) as applied, coalesce(r.refunded, 0) as refunded,
       case when p.status = 'active' then p.amount - coalesce(a.applied, 0) - coalesce(r.refunded, 0) else 0 end as unapplied
  from public.fin_payments p
  left join lateral (select sum(amount) as applied from public.fin_payment_allocations x where x.payment_id = p.id and x.reversed_at is null) a on true
  left join lateral (select sum(amount) as refunded from public.fin_refunds x where x.payment_id = p.id and x.status = 'active') r on true;

create or replace view public.fin_credit_memo_balances_v with (security_invoker = true) as
select m.id as credit_memo_id, m.book_id, m.customer_id, m.job_id, m.number, m.issue_date, m.amount, m.status,
       coalesce(a.applied, 0) as applied, coalesce(r.refunded, 0) as refunded,
       case when m.status = 'issued' then m.amount - coalesce(a.applied, 0) - coalesce(r.refunded, 0) else 0 end as available
  from public.fin_credit_memos m
  left join lateral (select sum(amount) as applied from public.fin_credit_applications x where x.credit_memo_id = m.id and x.reversed_at is null) a on true
  left join lateral (select sum(amount) as refunded from public.fin_refunds x where x.credit_memo_id = m.id and x.status = 'active') r on true;

-- Per customer: open receivables (with aging), unapplied payments and available credits.
create or replace view public.fin_customer_balances_v with (security_invoker = true) as
with ids as (
  select book_id, customer_id from public.fin_invoices where customer_id is not null
  union select book_id, customer_id from public.fin_payments where customer_id is not null
  union select book_id, customer_id from public.fin_credit_memos where customer_id is not null)
select ids.book_id, ids.customer_id,
       coalesce(i.open_balance, 0) as open_balance,
       coalesce(i.current, 0) as current, coalesce(i.d1_30, 0) as days_1_30, coalesce(i.d31_60, 0) as days_31_60,
       coalesce(i.d61_90, 0) as days_61_90, coalesce(i.over_90, 0) as over_90,
       coalesce(p.unapplied, 0) as unapplied_payments, coalesce(c.available, 0) as available_credits,
       coalesce(i.open_balance, 0) - coalesce(p.unapplied, 0) - coalesce(c.available, 0) as net_balance
  from ids
  left join lateral (select sum(balance) as open_balance,
                            sum(balance) filter (where aging_bucket = 'current') as current,
                            sum(balance) filter (where aging_bucket = '1_30') as d1_30,
                            sum(balance) filter (where aging_bucket = '31_60') as d31_60,
                            sum(balance) filter (where aging_bucket = '61_90') as d61_90,
                            sum(balance) filter (where aging_bucket = 'over_90') as over_90
                       from public.fin_invoice_balances_v b where b.book_id = ids.book_id and b.customer_id = ids.customer_id) i on true
  left join lateral (select sum(unapplied) as unapplied from public.fin_payment_balances_v b where b.book_id = ids.book_id and b.customer_id = ids.customer_id) p on true
  left join lateral (select sum(available) as available from public.fin_credit_memo_balances_v b where b.book_id = ids.book_id and b.customer_id = ids.customer_id) c on true;

-- 6b. Milestone triggers, change-order billing, milestone status (V4.5) ------------------------------------------
-- Billing policy: issuing an invoice that differs from its milestone always needs a reason; with this on,
-- it also needs manage_financial_config.
alter table public.fin_business_config add column if not exists require_billing_exception_approval boolean not null default false;

-- Record a trigger event (project start / completion for the job; phase / custom for one milestone).
create or replace function public.fin_milestone_trigger_record(p_job_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare j public.fin_jobs; v_id uuid; v_ms uuid := nullif(p ->> 'milestoneId', '')::uuid; v_kind text := p ->> 'triggerKind';
begin
  select * into j from public.fin_jobs where id = p_job_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(j.book_id, 'create_invoices', true);
  if v_ms is not null and not exists (select 1 from public.fin_payment_milestones where id = v_ms and job_id = p_job_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.fin_milestone_triggers (book_id, job_id, milestone_id, trigger_kind, occurred_at, note, recorded_by)
  values (j.book_id, j.id, v_ms, v_kind, coalesce(nullif(p ->> 'occurredAt', '')::timestamptz, now()), nullif(left(p ->> 'note', 500), ''), auth.uid())
  returning id into v_id;
  perform public.fin_audit(j.book_id, 'milestone.triggered', 'job', j.id, jsonb_build_object('triggerKind', v_kind, 'milestoneId', v_ms, 'triggerId', v_id));
  return v_id;
end $$;

-- An approved change order adds its own milestone(s): p {changeOrderId, milestones: [{description, amount,
-- triggerKind?, dueRule?, dueDays?, dueDate?}]} summing to the change order exactly.
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
  if exists (select 1 from public.fin_payment_milestones where change_order_id = co.id)
     or exists (select 1 from public.fin_milestone_amendments where change_order_id = co.id and status <> 'rejected') then
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

-- ...or an amendment of a remaining (not fully invoiced) milestone, approved separately.
create or replace function public.fin_milestone_amendment_request(p_milestone_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.fin_payment_milestones; v_id uuid; v_co uuid := nullif(p ->> 'changeOrderId', '')::uuid; v_delta numeric := (p ->> 'delta')::numeric;
begin
  select * into m from public.fin_payment_milestones where id = p_milestone_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(m.book_id, 'create_invoices', true);
  if v_delta is null or v_delta = 0 or v_delta <> round(v_delta, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  if v_co is not null and not exists (select 1 from public.change_orders c join public.fin_jobs j on j.estimate_id = c.estimate_id
                                      where c.id = v_co and j.id = m.job_id and c.status in ('approved', 'signed')) then
    raise exception 'not_approved' using errcode = '22023';
  end if;
  if coalesce((select sum(total) from public.fin_invoices x where x.milestone_id = m.id and x.status = 'issued'), 0) >= public.fin_milestone_amount(m.id) then
    raise exception 'milestone_invoiced' using errcode = '22023';   -- only remaining milestones are amended
  end if;
  if public.fin_milestone_amount(m.id) + v_delta < 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  insert into public.fin_milestone_amendments (book_id, job_id, milestone_id, change_order_id, delta, reason, requested_by)
  values (m.book_id, m.job_id, m.id, v_co, v_delta, left(coalesce(nullif(btrim(p ->> 'reason'), ''), 'Amendment'), 500), auth.uid()) returning id into v_id;
  perform public.fin_audit(m.book_id, 'milestone.amendment_requested', 'job', m.job_id, jsonb_build_object('amendmentId', v_id, 'delta', v_delta::text));
  return v_id;
end $$;

create or replace function public.fin_milestone_amendment_decide(p_amendment_id uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = public as $$
declare a public.fin_milestone_amendments;
begin
  select * into a from public.fin_milestone_amendments where id = p_amendment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(a.book_id, 'manage_financial_config', true);
  if a.status <> 'pending' then raise exception 'bad_state' using errcode = '22023'; end if;
  update public.fin_milestone_amendments set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = auth.uid() where id = a.id;
  perform public.fin_audit(a.book_id, 'milestone.amendment_' || case when p_approve then 'approved' else 'rejected' end, 'job', a.job_id, jsonb_build_object('amendmentId', a.id));
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

-- Milestone state (derived): not_triggered -> ready_to_invoice -> invoiced -> partially_paid -> paid.
-- Overdue is separate and comes only from the due rule + the recorded trigger time.
create or replace view public.fin_milestone_status_v with (security_invoker = true) as
select x.*,
       case when x.paid >= x.current_amount and x.current_amount > 0 then 'paid'
            when x.paid > 0 then 'partially_paid'
            when x.invoiced > 0 then 'invoiced'
            when x.triggered_at is not null or x.due_rule = 'date' and x.due_on <= current_date then 'ready_to_invoice'
            else 'not_triggered' end as state,
       (x.due_on is not null and x.due_on < current_date and x.paid < x.current_amount) as overdue,
       case when x.due_on is not null and x.due_on < current_date and x.paid < x.current_amount then current_date - x.due_on else 0 end as days_overdue
  from (
    select m.id as milestone_id, m.book_id, m.job_id, m.seq, m.description, m.basis, m.percent, m.amount as original_amount,
           public.fin_milestone_amount(m.id) as current_amount, m.trigger_kind, m.due_rule, m.is_deposit, m.source, m.change_order_id,
           public.fin_milestone_triggered_at(m.id) as triggered_at, public.fin_milestone_due_on(m.id) as due_on,
           coalesce((select sum(i.total) from public.fin_invoices i where i.milestone_id = m.id and i.status = 'issued'), 0) as invoiced,
           coalesce((select count(*) from public.fin_invoices i where i.milestone_id = m.id and i.status = 'issued'), 0) as active_invoices,
           coalesce((select sum(a.amount) from public.fin_payment_allocations a join public.fin_invoices i on i.id = a.invoice_id
                      where i.milestone_id = m.id and i.status = 'issued' and a.reversed_at is null), 0)
             + coalesce((select sum(c.amount) from public.fin_credit_applications c join public.fin_invoices i on i.id = c.invoice_id
                      where i.milestone_id = m.id and i.status = 'issued' and c.reversed_at is null), 0) as paid
      from public.fin_payment_milestones m) x;

-- 6c. Billing alerts (never block anything) ---------------------------------------------------------------------
create table if not exists public.fin_alerts (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.fin_books (id) on delete restrict,
  job_id        uuid references public.fin_jobs (id) on delete restrict,
  kind          text not null check (kind in ('deposit_not_invoiced', 'deposit_overdue', 'start_with_prestart_unpaid', 'milestone_ready_not_invoiced',
                                              'invoice_milestone_mismatch', 'duplicate_milestone_invoice', 'billed_over_contract',
                                              'completion_with_balance', 'change_order_affects_billing')),
  severity      text not null check (severity in ('info', 'warning', 'action_required')),
  dedupe_key    text not null check (char_length(dedupe_key) <= 200),
  details       jsonb not null default '{}',
  status        text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'overridden')),
  status_reason text check (char_length(status_reason) <= 500),
  status_by     uuid references auth.users (id) on delete set null,
  status_at     timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists fin_alerts_open_key on public.fin_alerts (book_id, dedupe_key) where status in ('open', 'acknowledged');
create index if not exists fin_alerts_book_idx on public.fin_alerts (book_id, status, created_at desc);
create or replace function public.fin_alerts_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' or old.status in ('resolved', 'overridden')
     or (to_jsonb(new) - 'status' - 'status_reason' - 'status_by' - 'status_at' - 'details' - 'severity')
        is distinct from (to_jsonb(old) - 'status' - 'status_reason' - 'status_by' - 'status_at' - 'details' - 'severity') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists fin_alerts_guard on public.fin_alerts;
create trigger fin_alerts_guard before update or delete on public.fin_alerts for each row execute function public.fin_alerts_guard();

-- The deterministic rule set: what SHOULD be alerting right now in a book.
create or replace function public.fin_alert_candidates(p_book_id uuid)
returns table (job_id uuid, kind text, severity text, dedupe_key text, details jsonb)
language sql stable security definer set search_path = public as $$
  with ms as (
    select m.*, public.fin_milestone_triggered_at(m.id) as t_at, public.fin_milestone_due_on(m.id) as due_on, public.fin_milestone_amount(m.id) as cur,
           coalesce((select sum(i.total) from public.fin_invoices i where i.milestone_id = m.id and i.status = 'issued'), 0) as invoiced,
           (select count(*) from public.fin_invoices i where i.milestone_id = m.id and i.status = 'issued') as n_inv,
           coalesce((select sum(public.fin_invoice_applied(i.id)) from public.fin_invoices i where i.milestone_id = m.id and i.status = 'issued'), 0) as paid
      from public.fin_payment_milestones m where m.book_id = p_book_id),
  jobs as (
    select c.*, (select min(coalesce(h.effective_at, h.created_at)) from public.estimate_stage_history h where h.estimate_id = c.estimate_id and h.to_stage = 'in_progress') as hist_start,
           (select min(coalesce(h.effective_at, h.created_at)) from public.estimate_stage_history h where h.estimate_id = c.estimate_id and h.to_stage = 'completed') as hist_done,
           (select min(t.occurred_at) from public.fin_milestone_triggers t where t.job_id = c.job_id and t.trigger_kind = 'project_start_confirmed') as rec_start,
           (select min(t.occurred_at) from public.fin_milestone_triggers t where t.job_id = c.job_id and t.trigger_kind = 'final_completion_confirmed') as rec_done,
           coalesce((select sum(public.fin_invoice_applied(i.id)) from public.fin_invoices i where i.job_id = c.job_id and i.status = 'issued'), 0) as collected
      from public.fin_job_contract_v c where c.book_id = p_book_id and c.status = 'open')
  select job_id, 'deposit_not_invoiced', 'action_required', 'deposit_not_invoiced:' || id, jsonb_build_object('milestoneId', id, 'amount', cur::text)
    from ms where is_deposit and t_at is not null and n_inv = 0
  union all
  select job_id, 'deposit_overdue', 'action_required', 'deposit_overdue:' || id, jsonb_build_object('milestoneId', id, 'dueOn', due_on, 'unpaid', (cur - paid)::text)
    from ms where is_deposit and due_on < current_date and paid < cur
  union all
  select ms.job_id, 'start_with_prestart_unpaid', 'warning', 'start_with_prestart_unpaid:' || ms.id, jsonb_build_object('milestoneId', ms.id, 'unpaid', (ms.cur - ms.paid)::text)
    from ms join jobs j on j.job_id = ms.job_id
   where ms.trigger_kind = 'agreement_signed' and ms.paid < ms.cur and coalesce(least(j.rec_start, j.hist_start), null) is not null
  union all
  select job_id, 'milestone_ready_not_invoiced', 'warning', 'milestone_ready_not_invoiced:' || id, jsonb_build_object('milestoneId', id, 'amount', cur::text)
    from ms where not is_deposit and t_at is not null and n_inv = 0
  union all
  select i.job_id, 'invoice_milestone_mismatch', 'info', 'invoice_milestone_mismatch:' || i.id, jsonb_build_object('invoiceId', i.id, 'discrepancies', i.discrepancies, 'reason', i.exception_reason)
    from public.fin_invoices i where i.book_id = p_book_id and i.status = 'issued'
     and exists (select 1 from jsonb_array_elements(i.discrepancies) d where d ->> 'code' in ('amount_differs', 'due_date_differs', 'not_triggered'))
  union all
  select job_id, 'duplicate_milestone_invoice', 'warning', 'duplicate_milestone_invoice:' || id, jsonb_build_object('milestoneId', id, 'invoices', n_inv)
    from ms where n_inv > 1
  union all
  select job_id, 'billed_over_contract', 'action_required', 'billed_over_contract:' || job_id, jsonb_build_object('invoiced', invoiced::text, 'contract', current_contract::text)
    from jobs where invoiced > current_contract
  union all
  select job_id, 'completion_with_balance', 'warning', 'completion_with_balance:' || job_id, jsonb_build_object('outstanding', (current_contract - collected)::text)
    from jobs where least(rec_done, hist_done) is not null and current_contract - collected > 0
  union all
  select j.id, 'change_order_affects_billing', 'warning', 'change_order_affects_billing:' || cc.change_order_id, jsonb_build_object('changeOrderId', cc.change_order_id, 'amount', cc.amount::text)
    from public.fin_contract_changes cc join public.fin_jobs j on j.id = cc.job_id
   where cc.book_id = p_book_id and cc.kind = 'change_order' and j.status = 'open'
     and not exists (select 1 from public.fin_payment_milestones m where m.change_order_id = cc.change_order_id)
     and coalesce((select sum(delta) from public.fin_milestone_amendments a where a.change_order_id = cc.change_order_id and a.status = 'approved'), 0) <> cc.amount
$$;
revoke execute on function public.fin_alert_candidates(uuid) from public, anon, authenticated;

-- Sync the stored alerts with the rules: new ones open, cleared ones resolve, overridden ones stay quiet
-- while the same condition persists. Anyone who can view the book may refresh (it only derives).
create or replace function public.fin_alerts_refresh(p_book_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_new integer; v_resolved integer;
begin
  if not public.fin_can_view_book(p_book_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('fin_alerts:' || p_book_id::text));
  create temporary table if not exists pg_temp.fin_alert_now (job_id uuid, kind text, severity text, dedupe_key text, details jsonb) on commit drop;
  delete from pg_temp.fin_alert_now;
  insert into pg_temp.fin_alert_now select * from public.fin_alert_candidates(p_book_id);
  update public.fin_alerts a set status = 'resolved', status_at = now(), status_reason = 'Condition cleared'
   where a.book_id = p_book_id and a.status in ('open', 'acknowledged') and not exists (select 1 from pg_temp.fin_alert_now n where n.dedupe_key = a.dedupe_key);
  get diagnostics v_resolved = row_count;
  update public.fin_alerts a set details = n.details from pg_temp.fin_alert_now n
   where a.book_id = p_book_id and a.status in ('open', 'acknowledged') and a.dedupe_key = n.dedupe_key and a.details is distinct from n.details;
  insert into public.fin_alerts (book_id, job_id, kind, severity, dedupe_key, details)
  select p_book_id, n.job_id, n.kind, n.severity, n.dedupe_key, n.details from pg_temp.fin_alert_now n
   where not exists (select 1 from public.fin_alerts a where a.book_id = p_book_id and a.dedupe_key = n.dedupe_key
                       and (a.status in ('open', 'acknowledged') or (a.status = 'overridden'
                            and not exists (select 1 from public.fin_alerts r where r.book_id = p_book_id and r.dedupe_key = n.dedupe_key
                                            and r.status = 'resolved' and r.status_at > a.status_at))));
  get diagnostics v_new = row_count;
  return jsonb_build_object('opened', v_new, 'resolved', v_resolved);
end $$;

-- People acknowledge or override (with a reason); both are audited.
create or replace function public.fin_alert_set_status(p_alert_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.fin_alerts;
begin
  select * into a from public.fin_alerts where id = p_alert_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_status not in ('acknowledged', 'overridden') then raise exception 'bad_status' using errcode = '22023'; end if;
  if p_status = 'overridden' then
    perform public.fin_require(a.book_id, 'create_invoices', false);
    if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  elsif not public.fin_can_view_book(a.book_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.fin_alerts set status = p_status, status_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''), status_by = auth.uid(), status_at = now() where id = a.id;
  perform public.fin_audit(a.book_id, 'alert.' || p_status, 'alert', a.id, jsonb_build_object('kind', a.kind, 'reason', p_reason));
end $$;

-- 7. Grants + read-only RLS -------------------------------------------------------------------------------------
revoke execute on function public.fin_job_open(uuid, uuid), public.fin_job_set_status(uuid, text), public.fin_contract_deduction_add(uuid, numeric, text, text),
  public.fin_invoice_save(uuid, jsonb, text), public.fin_invoice_delete_draft(uuid), public.fin_invoice_issue(uuid, date, text), public.fin_invoice_void(uuid, text),
  public.fin_payment_record(uuid, jsonb, text), public.fin_payment_allocate(uuid, jsonb, text), public.fin_allocation_reverse(uuid),
  public.fin_payment_verify(uuid), public.fin_payment_void(uuid, text), public.fin_credit_memo_issue(uuid, jsonb, text),
  public.fin_credit_memo_apply(uuid, jsonb, text), public.fin_credit_application_reverse(uuid), public.fin_credit_memo_void(uuid, text),
  public.fin_refund_record(uuid, jsonb, text), public.fin_refund_void(uuid, text) from public, anon;
grant execute on function public.fin_job_open(uuid, uuid), public.fin_job_set_status(uuid, text), public.fin_contract_deduction_add(uuid, numeric, text, text),
  public.fin_invoice_save(uuid, jsonb, text), public.fin_invoice_delete_draft(uuid), public.fin_invoice_issue(uuid, date, text), public.fin_invoice_void(uuid, text),
  public.fin_payment_record(uuid, jsonb, text), public.fin_payment_allocate(uuid, jsonb, text), public.fin_allocation_reverse(uuid),
  public.fin_payment_verify(uuid), public.fin_payment_void(uuid, text), public.fin_credit_memo_issue(uuid, jsonb, text),
  public.fin_credit_memo_apply(uuid, jsonb, text), public.fin_credit_application_reverse(uuid), public.fin_credit_memo_void(uuid, text),
  public.fin_refund_record(uuid, jsonb, text), public.fin_refund_void(uuid, text) to authenticated;
revoke execute on function public.fin_change_order_sync(), public.fin_schedule_amounts(jsonb, numeric) from public, anon, authenticated;
revoke execute on function public.fin_milestone_trigger_record(uuid, jsonb), public.fin_change_order_milestones_add(uuid, jsonb),
  public.fin_milestone_amendment_request(uuid, jsonb), public.fin_milestone_amendment_decide(uuid, boolean), public.fin_alerts_refresh(uuid),
  public.fin_alert_set_status(uuid, text, text) from public, anon;
grant execute on function public.fin_milestone_trigger_record(uuid, jsonb), public.fin_change_order_milestones_add(uuid, jsonb),
  public.fin_milestone_amendment_request(uuid, jsonb), public.fin_milestone_amendment_decide(uuid, boolean), public.fin_alerts_refresh(uuid),
  public.fin_alert_set_status(uuid, text, text) to authenticated;

alter table public.fin_idempotency enable row level security;
alter table public.fin_jobs enable row level security;
alter table public.fin_contract_snapshots enable row level security;
alter table public.fin_contract_changes enable row level security;
alter table public.fin_invoices enable row level security;
alter table public.fin_invoice_lines enable row level security;
alter table public.fin_payments enable row level security;
alter table public.fin_payment_allocations enable row level security;
alter table public.fin_credit_memos enable row level security;
alter table public.fin_credit_applications enable row level security;
alter table public.fin_refunds enable row level security;
alter table public.fin_payment_milestones enable row level security;
alter table public.fin_milestone_triggers enable row level security;
alter table public.fin_milestone_amendments enable row level security;
alter table public.fin_alerts enable row level security;

drop policy if exists fin_jobs_select on public.fin_jobs;
create policy fin_jobs_select on public.fin_jobs for select to authenticated using (public.fin_job_visible(id));
drop policy if exists fin_contract_snapshots_select on public.fin_contract_snapshots;
create policy fin_contract_snapshots_select on public.fin_contract_snapshots for select to authenticated using (public.fin_job_visible(job_id));
drop policy if exists fin_contract_changes_select on public.fin_contract_changes;
create policy fin_contract_changes_select on public.fin_contract_changes for select to authenticated using (public.fin_job_visible(job_id));
drop policy if exists fin_invoices_select on public.fin_invoices;
create policy fin_invoices_select on public.fin_invoices for select to authenticated using (public.fin_job_visible(job_id));
drop policy if exists fin_invoice_lines_select on public.fin_invoice_lines;
create policy fin_invoice_lines_select on public.fin_invoice_lines for select to authenticated
  using (exists (select 1 from public.fin_invoices i where i.id = invoice_id and public.fin_job_visible(i.job_id)));
drop policy if exists fin_payments_select on public.fin_payments;
create policy fin_payments_select on public.fin_payments for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials') or (job_id is not null and public.fin_job_visible(job_id)));
drop policy if exists fin_payment_allocations_select on public.fin_payment_allocations;
create policy fin_payment_allocations_select on public.fin_payment_allocations for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials')
         or exists (select 1 from public.fin_invoices i where i.id = invoice_id and public.fin_job_visible(i.job_id)));
drop policy if exists fin_credit_memos_select on public.fin_credit_memos;
create policy fin_credit_memos_select on public.fin_credit_memos for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials') or (job_id is not null and public.fin_job_visible(job_id)));
drop policy if exists fin_credit_applications_select on public.fin_credit_applications;
create policy fin_credit_applications_select on public.fin_credit_applications for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials')
         or exists (select 1 from public.fin_invoices i where i.id = invoice_id and public.fin_job_visible(i.job_id)));
drop policy if exists fin_refunds_select on public.fin_refunds;
create policy fin_refunds_select on public.fin_refunds for select to authenticated using (public.fin_has_permission(book_id, 'view_company_financials'));
drop policy if exists fin_payment_milestones_select on public.fin_payment_milestones;
create policy fin_payment_milestones_select on public.fin_payment_milestones for select to authenticated using (public.fin_job_visible(job_id));
drop policy if exists fin_milestone_triggers_select on public.fin_milestone_triggers;
create policy fin_milestone_triggers_select on public.fin_milestone_triggers for select to authenticated using (public.fin_job_visible(job_id));
drop policy if exists fin_milestone_amendments_select on public.fin_milestone_amendments;
create policy fin_milestone_amendments_select on public.fin_milestone_amendments for select to authenticated using (public.fin_job_visible(job_id));
drop policy if exists fin_alerts_select on public.fin_alerts;
create policy fin_alerts_select on public.fin_alerts for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials') or (job_id is not null and public.fin_job_visible(job_id)));
-- fin_idempotency: no policies (server functions only).

revoke all on public.fin_idempotency, public.fin_jobs, public.fin_contract_snapshots, public.fin_contract_changes, public.fin_invoices,
  public.fin_invoice_lines, public.fin_payments, public.fin_payment_allocations, public.fin_credit_memos, public.fin_credit_applications,
  public.fin_refunds, public.fin_job_contract_v, public.fin_invoice_balances_v, public.fin_payment_balances_v, public.fin_credit_memo_balances_v,
  public.fin_customer_balances_v, public.fin_payment_milestones, public.fin_milestone_triggers, public.fin_milestone_amendments, public.fin_alerts,
  public.fin_milestone_status_v from anon, authenticated;
grant select on public.fin_jobs, public.fin_contract_snapshots, public.fin_contract_changes, public.fin_invoices, public.fin_invoice_lines,
  public.fin_payments, public.fin_payment_allocations, public.fin_credit_memos, public.fin_credit_applications, public.fin_refunds,
  public.fin_job_contract_v, public.fin_invoice_balances_v, public.fin_payment_balances_v, public.fin_credit_memo_balances_v,
  public.fin_customer_balances_v, public.fin_payment_milestones, public.fin_milestone_triggers, public.fin_milestone_amendments, public.fin_alerts,
  public.fin_milestone_status_v to authenticated;
