-- V7.1 Demo Mode, Practice Mode and the Guided Experience engine.
--
-- Demo Mode (platform owner only) and Practice Mode (any signed-in person) each run in a SEPARATE demo
-- login that belongs to the person who opened it. Every table in Built2Bid already scopes rows to the
-- signed-in login (and its company) with RLS, so demo records can never appear in, mix with or be
-- written into a real account: they belong to a different tenant. Nothing is copied, merged or moved
-- between a real account and its demo login, in either direction.
--
--   * demo_workspaces: which demo login belongs to which real person, the seed version and status.
--     Service role only (no client policies). The demo login's app_metadata.b2b_demo (written only by the
--     server with the service key) mirrors it so the app and proxy can recognise a demo session cheaply.
--   * demo_provision(): links a freshly created demo login to its owner. Owner demo needs is_admin().
--     The owner demo company runs on a complimentary Enterprise grant (no Stripe, no billing).
--   * demo_apply(): writes the versioned sample dataset by running the app's own RPCs AS the demo login
--     (save_estimate, set_estimate_stage, schedule_create, fin_*), so every rule and trigger applies.
--     It refuses any workspace that isn't registered as a demo, and any login that isn't its demo login.
--   * Reset never deletes rows with a broad query: it retires the old demo login (demo_retire) and seeds
--     a new one. Retired demo data stays attached to the retired, banned demo login only.
--   * Backstop guards: a demo account can never queue a customer message (comm_messages), queue an
--     email (email_outbox), open a signing request, or get a subscription row.
--
-- Guided experience: guide_progress (one row per person per tour version) and guide_events (first-party
-- onboarding analytics with no customer or estimate content). Writes only through guide_record().
--
-- Safe to run more than once. Rollback: docs/demo-mode/rollback_20270102001000.sql

-- 1. Demo workspaces -------------------------------------------------------------------------------------
create table if not exists public.demo_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('owner_demo', 'practice')),
  demo_user_id uuid unique references auth.users (id) on delete set null,
  company_id uuid,
  seed_version text,
  status text not null default 'new' check (status in ('new', 'seeding', 'ready', 'failed')),
  seed_step integer not null default 0,
  last_error text,
  seeded_at timestamptz,
  last_reset_at timestamptz,
  reset_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, kind)
);
alter table public.demo_workspaces enable row level security;
revoke all on public.demo_workspaces from anon, authenticated;

-- Retired demo logins (after a reset). Kept so their rows stay attributable; never reused.
create table if not exists public.demo_retired_logins (
  demo_user_id uuid primary key,
  workspace_id uuid not null references public.demo_workspaces (id) on delete cascade,
  company_id uuid,
  retired_at timestamptz not null default now()
);
alter table public.demo_retired_logins enable row level security;
revoke all on public.demo_retired_logins from anon, authenticated;

-- Is this login (or company) a demo tenant, current or retired? Used by the guards below.
create or replace function public.is_demo_account(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_id is not null and (
    exists (select 1 from public.demo_workspaces w where w.demo_user_id = p_id or w.company_id = p_id)
    or exists (select 1 from public.demo_retired_logins r where r.demo_user_id = p_id or r.company_id = p_id))
$$;
revoke execute on function public.is_demo_account(uuid) from public, anon;
grant execute on function public.is_demo_account(uuid) to authenticated, service_role;

-- 2. Backstop guards: a demo tenant never reaches a real person or a billing system ------------------------
create or replace function public.demo_guard_comm_messages() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status in ('scheduled', 'approved', 'sending') and public.is_demo_account(new.account_id) then
    raise exception 'demo_mode_no_send' using errcode = '42501', hint = 'Demo and practice workspaces never send messages.';
  end if;
  return new;
end $$;
drop trigger if exists demo_guard_comm_messages on public.comm_messages;
create trigger demo_guard_comm_messages before insert or update of status on public.comm_messages
  for each row execute function public.demo_guard_comm_messages();


create or replace function public.demo_guard_outbox() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_demo_account(new.user_id) then
    raise exception 'demo_mode_no_send' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists demo_guard_outbox on public.email_outbox;
create trigger demo_guard_outbox before insert on public.email_outbox for each row execute function public.demo_guard_outbox();

create or replace function public.demo_guard_signing() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_demo_account(new.user_id) or public.is_demo_account(new.company_id) then
    raise exception 'demo_mode_no_signing' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists demo_guard_signing on public.signing_requests;
create trigger demo_guard_signing before insert on public.signing_requests for each row execute function public.demo_guard_signing();

create or replace function public.demo_guard_subscriptions() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_demo_account(new.user_id) or public.is_demo_account(new.company_id) then
    raise exception 'demo_mode_no_billing' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists demo_guard_subscriptions on public.subscriptions;
create trigger demo_guard_subscriptions before insert or update on public.subscriptions for each row execute function public.demo_guard_subscriptions();

-- 3. Seeding helpers --------------------------------------------------------------------------------------
-- The seed keeps the dataset's historical timestamps: updated_at triggers honour a transaction-local
-- flag that only demo_apply() sets.
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.demo_seed', true), '') = 'on' then return new; end if;
  new.updated_at = now();
  return new;
end $$;

-- Run as the demo login for the rest of this transaction (Supabase reads both settings in auth.uid()).
create or replace function public.demo_act_as(p_uid uuid) returns void
language plpgsql set search_path = public as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', case when p_uid is null then '' else 'authenticated' end, true);
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $$;
revoke execute on function public.demo_act_as(uuid) from public, anon, authenticated;

-- 4. Provision ---------------------------------------------------------------------------------------------
-- p_demo_user: a login the server JUST created (no rows of its own yet) with a reserved example.com email.
-- Returns the workspace. Re-provisioning (Reset) retires the previous demo login first.
create or replace function public.demo_provision(p_owner uuid, p_demo_user uuid, p_kind text, p_company_name text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare w public.demo_workspaces; v_email text; v_company uuid; v_old uuid; v_old_company uuid;
begin
  if p_kind not in ('owner_demo', 'practice') then raise exception 'bad_kind' using errcode = '22023'; end if;
  if p_owner is null or p_demo_user is null or p_owner = p_demo_user then raise exception 'bad_user' using errcode = '22023'; end if;
  if p_kind = 'owner_demo' and not public.is_admin(p_owner) then raise exception 'forbidden' using errcode = '42501'; end if;
  if public.is_demo_account(p_owner) then raise exception 'forbidden' using errcode = '42501'; end if;   -- no demo inside a demo
  select email into v_email from auth.users where id = p_demo_user;
  if not found then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  if v_email is null or v_email !~* '@(example\.(com|net|org)|demo\.built2bid\.org)$' then raise exception 'demo_email_required' using errcode = '22023'; end if;
  -- The new demo login must be empty: never adopt an account that already has data.
  if exists (select 1 from public.estimates where user_id = p_demo_user)
     or exists (select 1 from public.company_members where user_id = p_demo_user)
     or exists (select 1 from public.demo_workspaces where demo_user_id = p_demo_user)
     or exists (select 1 from public.demo_retired_logins where demo_user_id = p_demo_user) then
    raise exception 'demo_user_not_fresh' using errcode = '22023';
  end if;

  select * into w from public.demo_workspaces where owner_user_id = p_owner and kind = p_kind for update;
  if found then
    v_old := w.demo_user_id; v_old_company := w.company_id;
    if v_old is not null then
      insert into public.demo_retired_logins (demo_user_id, workspace_id, company_id) values (v_old, w.id, v_old_company) on conflict do nothing;
      -- The retired company's complimentary grant ends now, so it never shows as an active account.
      update public.complimentary_grants set status = 'revoked', revoked_at = now(), revoke_reason = 'demo_reset'
       where status in ('pending', 'active') and (user_id = v_old or (v_old_company is not null and company_id = v_old_company));
    end if;
    update public.demo_workspaces set demo_user_id = p_demo_user, company_id = null, status = 'new', seed_version = null, seed_step = 0, last_error = null,
      last_reset_at = case when v_old is not null then now() else last_reset_at end, reset_count = reset_count + case when v_old is not null then 1 else 0 end,
      updated_at = now()
     where id = w.id returning * into w;
  else
    insert into public.demo_workspaces (owner_user_id, kind, demo_user_id) values (p_owner, p_kind, p_demo_user) returning * into w;
  end if;

  -- Owner reports classify the login as Demo (it is also on a reserved test domain).
  insert into public.admin_account_labels (user_id, label, note, set_by) values (p_demo_user, 'demo', 'Demo workspace login (' || p_kind || ')', p_owner)
    on conflict (user_id) do update set label = 'demo', note = excluded.note, updated_at = now();
  insert into public.profiles (id, display_name, onboarding_status) values (p_demo_user, case when p_kind = 'practice' then 'Practice' else 'Demo Owner' end, 'existing')
    on conflict (id) do update set display_name = excluded.display_name, onboarding_status = 'existing';

  if p_kind = 'owner_demo' then
    -- Complimentary Enterprise on the demo company only: Projects (2 editors), Financials (3 seats). No Stripe.
    insert into public.complimentary_grants (email, user_id, plan, duration_days, included_seats, extra_seats, status, starts_at, expires_at, activated_at,
      note, granted_by, pm_editors, fin_seats)
    values (v_email, p_demo_user, 'enterprise', 730, 3, 5, 'active', now() - interval '1 minute', now() - interval '1 minute' + interval '730 days', now(),
      'Demo workspace (no billing). Created by Demo Mode.', p_owner, 2, 3);
    v_company := public.create_company(p_demo_user, coalesce(nullif(btrim(p_company_name), ''), 'Northfield Ridge Builders (Demo)'));
    insert into public.pm_editors (company_id, user_id, assigned_by) values (v_company, p_demo_user, p_demo_user) on conflict do nothing;
    update public.demo_workspaces set company_id = v_company, updated_at = now() where id = w.id returning * into w;
  end if;
  return jsonb_build_object('workspaceId', w.id, 'companyId', w.company_id, 'demoUserId', w.demo_user_id, 'retired', v_old);
end $$;
revoke execute on function public.demo_provision(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.demo_provision(uuid, uuid, text, text) to service_role;

-- 5. Apply one chunk of the sample dataset ---------------------------------------------------------------
-- p_kind: base | resources | customers | estimates | schedules | invoices | comms | finish. Each call is one
-- transaction; a failed chunk marks the workspace 'failed' (the server reports it; Reset starts over).
create or replace function public.demo_apply(p_workspace uuid, p_kind text, p_rows jsonb, p_seed_version text, p_step integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  w public.demo_workspaces; v_uid uuid; r jsonb; s jsonb; t jsonb; v_n integer := 0; v_id uuid; v_sid uuid; v_rev integer;
  v_items jsonb; v_task uuid; v_book uuid; v_job jsonb; v_inv uuid; v_pay jsonb; v_ver uuid; v_prev_sub text; v_prev_claims text;
begin
  select * into w from public.demo_workspaces where id = p_workspace for update;
  if not found or w.demo_user_id is null then raise exception 'not_a_demo_workspace' using errcode = '42501'; end if;
  v_uid := w.demo_user_id;
  -- Steps run in order exactly once: a repeated step (a retried request) is skipped, a skipped one refused.
  if p_step < w.seed_step then return 0; end if;
  if p_step > w.seed_step then raise exception 'out_of_order' using errcode = '40001', detail = w.seed_step::text; end if;
  if p_kind <> 'base' and w.seed_version is distinct from p_seed_version then raise exception 'seed_version_changed' using errcode = '40001'; end if;
  if public.is_demo_account(w.owner_user_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  v_prev_claims := current_setting('request.jwt.claims', true);
  perform public.demo_act_as(v_uid);
  perform set_config('app.demo_seed', 'on', true);

  if p_kind = 'base' then
    update public.demo_workspaces set status = 'seeding', seed_version = p_seed_version, last_error = null, updated_at = now() where id = w.id;
    insert into public.business_profiles (user_id, company_name, contact_name, email, phone, address, website, license_number, tagline, description, primary_color, secondary_color, primary_trade)
    values (v_uid, p_rows ->> 'company_name', p_rows ->> 'contact_name', p_rows ->> 'email', p_rows ->> 'phone', p_rows ->> 'address', p_rows ->> 'website',
            p_rows ->> 'license_number', p_rows ->> 'tagline', p_rows ->> 'description', coalesce(p_rows ->> 'primary_color', '#0B2D4D'), coalesce(p_rows ->> 'secondary_color', '#14B8A6'), p_rows ->> 'primary_trade')
    on conflict (user_id) do update set company_name = excluded.company_name, contact_name = excluded.contact_name, email = excluded.email, phone = excluded.phone,
      address = excluded.address, website = excluded.website, license_number = excluded.license_number, tagline = excluded.tagline, description = excluded.description,
      primary_trade = excluded.primary_trade;
    v_n := 1;

  elsif p_kind = 'resources' then
    for r in select * from jsonb_array_elements(p_rows) loop
      insert into public.pm_resources (id, company_id, owner_id, kind, name, contact_name, trades, email, phone, notes, created_by)
      values ((r ->> 'id')::uuid, w.company_id, case when w.company_id is null then v_uid end, r ->> 'kind', r ->> 'name', r ->> 'contactName',
              array(select jsonb_array_elements_text(r -> 'trades')), r ->> 'email', r ->> 'phone', r ->> 'notes', v_uid);
      if r ? 'employee' then
        perform public.pm_employee_profile_save((r ->> 'id')::uuid, jsonb_build_object('title', r -> 'employee' ->> 'title', 'payType', r -> 'employee' ->> 'payType',
          'hourlyCost', r -> 'employee' ->> 'hourlyCost', 'hireDate', r -> 'employee' ->> 'hireDate', 'clockEnabled', true));
      end if;
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'customers' then
    for r in select * from jsonb_array_elements(p_rows) loop
      insert into public.customers (id, user_id, company_id, created_by, name, email, phone, project_address, notes, source, customer_type, company_name, created_at, updated_at)
      values ((r ->> 'id')::uuid, v_uid, w.company_id, v_uid, r ->> 'name', r ->> 'email', r ->> 'phone', r ->> 'address', r ->> 'notes', 'manual',
              coalesce(r ->> 'customerType', 'person'), r ->> 'companyName', (r ->> 'createdAt')::timestamptz, (r ->> 'createdAt')::timestamptz);
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'estimates' then
    for r in select * from jsonb_array_elements(p_rows) loop
      v_id := public.save_estimate(r -> 'payload');
      update public.estimates set created_at = (r ->> 'createdAt')::timestamptz, updated_at = (r ->> 'createdAt')::timestamptz where id = v_id;
      if jsonb_typeof(r -> 'version') = 'object' then
        insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total, created_at)
        values (v_id, v_uid, 1, r -> 'version' ->> 'contentHash', r -> 'version' -> 'snapshot', r -> 'version' -> 'proposal',
                (r -> 'version' ->> 'totalCost')::numeric, (r -> 'version' ->> 'subtotal')::numeric, (r -> 'version' ->> 'tax')::numeric,
                (r -> 'version' ->> 'total')::numeric, (r -> 'version' ->> 'createdAt')::timestamptz);
      end if;
      for s in select * from jsonb_array_elements(coalesce(r -> 'stages', '[]')) loop
        perform public.set_estimate_stage(v_id, s ->> 'stage', s ->> 'note', least((s ->> 'at')::timestamptz, now()));
      end loop;
      update public.estimates set updated_at = coalesce((select max(effective_at) from public.estimate_stage_history where estimate_id = v_id), created_at),
        stage_changed_at = (select max(effective_at) from public.estimate_stage_history where estimate_id = v_id) where id = v_id;
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'schedules' then
    for r in select * from jsonb_array_elements(p_rows) loop
      v_sid := public.schedule_create((r ->> 'estimateId')::uuid, false, jsonb_build_object(
        'name', r ->> 'name', 'startDate', r ->> 'startDate', 'targetEndDate', r ->> 'targetEndDate',
        'calendar', jsonb_build_object('workdays', jsonb_build_array(1, 2, 3, 4, 5), 'holidays', '[]'::jsonb, 'timezone', 'America/Chicago'),
        'tasks', r -> 'tasks'));
      perform public.schedule_set_people(v_sid, v_uid, v_uid);
      -- key -> task id (each source group/item appears once per schedule)
      v_items := '[]'::jsonb;
      for t in select * from jsonb_array_elements(r -> 'progress') loop
        select st.id into v_task from public.schedule_tasks st, jsonb_array_elements(r -> 'tasks') x
         where x ->> 'key' = t ->> 'key' and st.schedule_id = v_sid and st.source_group_id = (x ->> 'sourceGroupId')::uuid
           and st.source_item_id is not distinct from nullif(x ->> 'sourceItemId', '')::uuid and st.kind = x ->> 'kind' limit 1;
        select v_items || jsonb_build_array(jsonb_build_object('id', v_task, 'status', t ->> 'status', 'percentComplete', (t ->> 'percent')::int,
          'actualStart', t ->> 'actualStart', 'actualFinish', t ->> 'actualFinish', 'notes', t ->> 'notes',
          'plannedStart', st.planned_start, 'plannedEnd', st.planned_end, 'durationDays', st.duration_days, 'sortOrder', st.sort_order, 'name', st.name))
          into v_items from public.schedule_tasks st where st.id = v_task;
      end loop;
      select revision into v_rev from public.project_schedules where id = v_sid;
      v_rev := public.schedule_save(v_sid, v_rev, jsonb_build_object('schedule', jsonb_build_object('status', 'active'), 'tasks', v_items, 'summary', 'Sample progress'));
      v_items := '[]'::jsonb;
      for t in select * from jsonb_array_elements(r -> 'assign') loop
        select st.id into v_task from public.schedule_tasks st, jsonb_array_elements(r -> 'tasks') x
         where x ->> 'key' = t ->> 'key' and st.schedule_id = v_sid and st.source_group_id = (x ->> 'sourceGroupId')::uuid and st.kind = 'section' limit 1;
        v_items := v_items || jsonb_build_array(jsonb_build_object('taskId', v_task, 'resourceId', t ->> 'resourceId', 'status', t ->> 'status'));
      end loop;
      select revision into v_rev from public.project_schedules where id = v_sid;
      if jsonb_array_length(v_items) > 0 then perform public.schedule_assign(v_sid, v_rev, v_items, 'Sample crew assignments'); end if;
      if jsonb_typeof(r -> 'closeout') = 'object' then
        select revision into v_rev from public.project_schedules where id = v_sid;
        perform public.schedule_closeout(v_sid, v_rev, (r -> 'closeout' ->> 'actualFinish')::date, 'Sample project closed out');
      end if;
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'invoices' then
    v_book := public.fin_my_book();
    for r in select * from jsonb_array_elements(p_rows) loop
      select id into v_ver from public.estimate_versions where estimate_id = (r ->> 'estimateId')::uuid order by version_number desc limit 1;
      v_job := public.fin_job_open((r ->> 'estimateId')::uuid, v_ver);
      v_inv := (public.fin_invoice_save((v_job ->> 'jobId')::uuid, jsonb_build_object('kind', 'custom', 'dueDate', r ->> 'dueDate', 'memo', r ->> 'memo',
        'lines', (select jsonb_agg(jsonb_build_object('kind', 'custom', 'description', l ->> 'description', 'quantity', l ->> 'quantity', 'unitPrice', l ->> 'unitPrice', 'taxable', (l ->> 'taxable')::boolean))
                    from jsonb_array_elements(r -> 'lines') l)), 'demo-inv:' || p_workspace || ':' || (r ->> 'estimateId') || ':' || (r ->> 'kind')) ->> 'invoiceId')::uuid;
      perform public.fin_invoice_issue(v_inv, (r ->> 'issueDate')::date, 'Sample invoice (demo data)');
      if jsonb_typeof(r -> 'payment') = 'object' then
        v_pay := public.fin_payment_record(v_book, jsonb_build_object('customerId', (select customer_id from public.fin_invoices where id = v_inv),
          'amount', r -> 'payment' ->> 'amount', 'method', r -> 'payment' ->> 'method', 'receivedOn', r -> 'payment' ->> 'receivedOn',
          'reference', r -> 'payment' ->> 'reference', 'memo', 'Simulated payment (demo data, no money moved)',
          'allocations', jsonb_build_array(jsonb_build_object('invoiceId', v_inv, 'amount', r -> 'payment' ->> 'amount'))),
          'demo-pay:' || p_workspace || ':' || (r ->> 'estimateId') || ':' || (r ->> 'kind'));
      end if;
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'comms' then
    if w.company_id is not null then v_book := public.fin_my_book(); end if;
    for r in select * from jsonb_array_elements(p_rows) loop
      insert into public.comm_messages (id, account_id, kind, trigger, customer_id, estimate_id, to_email, to_name, subject, body_text, status,
        automation, initiated_by, idempotency_key, fin_book_id, fin_invoice_id, fin_template_kind, fin_tone, fin_fields_hash, sent_at, delivered_at, replied_at, created_at, updated_at)
      values ((r ->> 'id')::uuid, coalesce(w.company_id, v_uid), r ->> 'kind', r ->> 'trigger', (r ->> 'customerId')::uuid, nullif(r ->> 'estimateId', '')::uuid,
        r ->> 'toEmail', r ->> 'toName', r ->> 'subject', r ->> 'body', r ->> 'status', false, v_uid, 'demo:' || (r ->> 'id'),
        case when r ->> 'kind' = 'financial' then v_book end,
        case when r ->> 'kind' = 'financial' then (select i.id from public.fin_invoices i join public.fin_jobs j on j.id = i.job_id
          where j.estimate_id = nullif(r ->> 'estimateId', '')::uuid and j.book_id = v_book and i.memo like (case r ->> 'finTemplate' when 'deposit' then 'Deposit%' else 'Balance%' end) limit 1) end,
        case when r ->> 'kind' = 'financial' then r ->> 'finTemplate' end, case when r ->> 'kind' = 'financial' then 'friendly' end,
        case when r ->> 'kind' = 'financial' then encode(sha256(convert_to(r ->> 'id', 'UTF8')), 'hex') end,
        (r ->> 'sentAt')::timestamptz, case when r ->> 'status' in ('delivered', 'replied') then (r ->> 'sentAt')::timestamptz + interval '2 minutes' end,
        case when r ->> 'status' = 'replied' then (r ->> 'sentAt')::timestamptz + interval '1 day' end, (r ->> 'sentAt')::timestamptz, (r ->> 'sentAt')::timestamptz);
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'finish' then
    update public.demo_workspaces set status = 'ready', seeded_at = now(), updated_at = now() where id = w.id;
    v_n := 1;
  else
    raise exception 'bad_kind' using errcode = '22023';
  end if;

  update public.demo_workspaces set seed_step = p_step + 1, updated_at = now() where id = w.id;
  perform set_config('app.demo_seed', '', true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  return v_n;
end $$;
revoke execute on function public.demo_apply(uuid, text, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.demo_apply(uuid, text, jsonb, text, integer) to service_role;

create or replace function public.demo_mark_failed(p_workspace uuid, p_error text) returns void
language sql security definer set search_path = public as $$
  update public.demo_workspaces set status = 'failed', last_error = left(p_error, 500), updated_at = now() where id = p_workspace
$$;
revoke execute on function public.demo_mark_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.demo_mark_failed(uuid, text) to service_role;

-- 6. Guided experience: progress and first-party onboarding analytics ------------------------------------
create table if not exists public.guide_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  tour_id text not null check (tour_id ~ '^[a-z][a-z0-9.-]{1,63}$'),
  version integer not null check (version between 1 and 1000),
  status text not null check (status in ('offered', 'in_progress', 'completed', 'dismissed', 'snoozed')),
  last_step integer,
  started_at timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  snoozed_until timestamptz,
  offered_count integer not null default 0,
  workspace text not null default 'real' check (workspace in ('real', 'demo', 'practice')),
  role text,
  updated_at timestamptz not null default now(),
  primary key (user_id, tour_id, version)
);
alter table public.guide_progress enable row level security;
drop policy if exists guide_progress_own on public.guide_progress;
create policy guide_progress_own on public.guide_progress for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.guide_progress from anon, authenticated;
grant select on public.guide_progress to authenticated;

create table if not exists public.guide_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  event text not null check (event in ('offered', 'started', 'step', 'completed', 'dismissed', 'snoozed', 'launcher_opened', 'help_viewed', 'help_search',
    'checklist_opened', 'practice_started', 'demo_entered', 'demo_exited', 'demo_reset', 'ai_asked')),
  tour_id text check (tour_id is null or tour_id ~ '^[a-z][a-z0-9.-]{1,63}$'),
  version integer,
  step integer,
  page text check (page is null or page ~ '^[a-z][a-z0-9.-]{0,63}$'),
  workspace text not null default 'real' check (workspace in ('real', 'demo', 'practice')),
  dedupe_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists guide_events_dedupe on public.guide_events (user_id, dedupe_key) where dedupe_key is not null;
create index if not exists guide_events_created on public.guide_events (created_at);
alter table public.guide_events enable row level security;
revoke all on public.guide_events from anon, authenticated;

-- One entry point for the browser. Progress only moves forward sensibly: completed stays completed for
-- that version; dismissed/snoozed can be restarted on purpose (replay). Unknown values are refused.
create or replace function public.guide_record(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_event text := p ->> 'event'; v_tour text := nullif(p ->> 'tourId', ''); v_ver integer := coalesce((p ->> 'version')::int, 1);
  v_step integer := (p ->> 'step')::int; v_ws text := case when public.is_demo_account(auth.uid()) then
      (select case w.kind when 'practice' then 'practice' else 'demo' end from public.demo_workspaces w where w.demo_user_id = auth.uid() union all select 'demo' limit 1)
    else 'real' end;
  g public.guide_progress; v_ins integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  insert into public.guide_events (user_id, event, tour_id, version, step, page, workspace, dedupe_key)
  values (v_uid, v_event, v_tour, case when v_tour is not null then v_ver end, v_step, nullif(p ->> 'page', ''), v_ws, left(nullif(p ->> 'dedupe', ''), 120))
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_ins = row_count;
  if v_tour is null or v_event not in ('offered', 'started', 'step', 'completed', 'dismissed', 'snoozed') then
    return jsonb_build_object('ok', true, 'recorded', v_ins > 0);
  end if;
  select * into g from public.guide_progress where user_id = v_uid and tour_id = v_tour and version = v_ver for update;
  if not found then
    insert into public.guide_progress (user_id, tour_id, version, status, workspace, role) values (v_uid, v_tour, v_ver, 'offered', v_ws, left(p ->> 'role', 40)) returning * into g;
  end if;
  update public.guide_progress set
    status = case
      when g.status = 'completed' and v_event <> 'started' then 'completed'
      when v_event = 'offered' then case when g.status in ('dismissed', 'snoozed', 'in_progress') then g.status else 'offered' end
      when v_event in ('started', 'step') then 'in_progress'
      else v_event end,
    offered_count = g.offered_count + case when v_event = 'offered' and v_ins > 0 then 1 else 0 end,
    started_at = case when v_event = 'started' then now() else g.started_at end,
    last_step = case when v_event in ('step', 'started') then coalesce(v_step, 0) when v_event = 'completed' then coalesce(v_step, g.last_step) else g.last_step end,
    completed_at = case when v_event = 'completed' then coalesce(g.completed_at, now()) else g.completed_at end,
    dismissed_at = case when v_event = 'dismissed' then now() else g.dismissed_at end,
    snoozed_until = case when v_event = 'snoozed' then now() + interval '7 days' when v_event in ('started', 'completed') then null else g.snoozed_until end,
    role = coalesce(left(p ->> 'role', 40), g.role), workspace = v_ws, updated_at = now()
  where user_id = v_uid and tour_id = v_tour and version = v_ver;
  return jsonb_build_object('ok', true, 'recorded', v_ins > 0);
end $$;
revoke execute on function public.guide_record(jsonb) from public, anon;
grant execute on function public.guide_record(jsonb) to authenticated;

-- Owner overview (aggregates only). Demo and practice activity is reported separately, never mixed in.
create or replace function public.admin_guide_overview(p_caller uuid, p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  if not public.is_admin(p_caller) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'tours', coalesce((select jsonb_agg(x order by x ->> 'tourId') from (
      select jsonb_build_object('tourId', tour_id, 'workspace', workspace,
        'offered', count(*) filter (where event = 'offered'), 'started', count(*) filter (where event = 'started'),
        'completed', count(*) filter (where event = 'completed'), 'dismissed', count(*) filter (where event = 'dismissed'),
        'snoozed', count(*) filter (where event = 'snoozed'), 'people', count(distinct user_id)) x
      from public.guide_events where created_at >= v_from and tour_id is not null
        and user_id not in (select user_id from public.admin_account_labels where label in ('test', 'internal'))
      group by tour_id, workspace) q), '[]'::jsonb),
    'exits', coalesce((select jsonb_agg(jsonb_build_object('tourId', tour_id, 'version', version, 'lastStep', last_step, 'people', n)) from (
      select tour_id, version, last_step, count(*) n from public.guide_progress
      where workspace = 'real' and status = 'dismissed' and dismissed_at >= v_from group by 1, 2, 3 order by n desc limit 20) e), '[]'::jsonb),
    'help', jsonb_build_object(
      'launcherOpened', (select count(*) from public.guide_events where event = 'launcher_opened' and workspace = 'real' and created_at >= v_from),
      'articlesViewed', (select count(*) from public.guide_events where event = 'help_viewed' and workspace = 'real' and created_at >= v_from),
      'searches', (select count(*) from public.guide_events where event = 'help_search' and workspace = 'real' and created_at >= v_from),
      'aiQuestions', (select count(*) from public.guide_events where event = 'ai_asked' and workspace = 'real' and created_at >= v_from),
      'practiceStarted', (select count(*) from public.guide_events where event = 'practice_started' and created_at >= v_from)),
    'demo', jsonb_build_object(
      'entered', (select count(*) from public.guide_events where event = 'demo_entered' and created_at >= v_from),
      'resets', (select count(*) from public.guide_events where event = 'demo_reset' and created_at >= v_from)),
    'firstEstimate', (select jsonb_build_object('people', count(*), 'medianHours', percentile_cont(0.5) within group (order by hrs))
      from (select extract(epoch from (min(e.created_at) - u.created_at)) / 3600 hrs
              from auth.users u join public.estimates e on e.user_id = u.id
             where u.created_at >= v_from and not public.is_demo_account(u.id)
               and u.id not in (select user_id from public.admin_account_labels)
               and coalesce(u.email, '') !~* '@example\.(com|net|org)$'
             group by u.id, u.created_at) t)
  );
end $$;
revoke execute on function public.admin_guide_overview(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_guide_overview(uuid, integer) to service_role;

-- 8. Optional AI help answers are logged with the existing AI usage log (kind 'guide_help') ------------------
do $$
declare d text; vals text[];
begin
  if to_regclass('public.ai_generations') is null then return; end if;
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'ai_generations_kind_check' and conrelid = 'public.ai_generations'::regclass;
  if d is null or d like '%guide_help%' then return; end if;
  -- The constraint is either "kind = any ('{a,b}'::text[])" or "kind in ('a', 'b')": read both forms.
  if d ~ '''\{[a-z_,]*\}''' then
    vals := string_to_array((regexp_match(d, '''\{([a-z_,]*)\}'''))[1], ',');
  else
    select array_agg(m[1]) into vals from regexp_matches(d, '''([a-z_]+)''', 'g') as m;
  end if;
  if vals is null or cardinality(vals) = 0 then return; end if;   -- unknown shape: leave it alone
  vals := vals || array['guide_help'];
  alter table public.ai_generations drop constraint ai_generations_kind_check;
  execute format('alter table public.ai_generations add constraint ai_generations_kind_check check (kind = any (%L::text[]))', vals);
end $$;
