-- Growth OS Phase 4: foundation (schemas growth, growth_read, growth_api; role growth_worker).
--
-- STAGING / TEST ONLY until James signs off Phase 4. Do NOT paste this into the production SQL editor.
-- It lives outside supabase/migrations on purpose so the customer app's migration flow never picks it up.
-- Design: docs/growth-os/phase4-architecture/02_architecture_proposal.md. Rollback:
-- growth-os/supabase/rollback/20270301001000_growth_os_foundation_down.sql.
--
-- Boundary: this file creates nothing in public and changes no existing object. Customer data is read
-- only through growth_read views. The only writes outside growth are in growth_api.crm_apply /
-- revert_change, which require an approved, unused approval whose payload hash matches.
-- Every growth_api function is SECURITY DEFINER with search_path = '' and execute revoked from PUBLIC.

create schema if not exists growth;
create schema if not exists growth_read;
create schema if not exists growth_api;
revoke all on schema growth, growth_read, growth_api from public;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'growth_worker') then
    create role growth_worker nologin noinherit;  -- LOGIN + password set per environment, never in the repo
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 1. Control, audit, budgets
-- ---------------------------------------------------------------------------------------------------
create table growth.control (
  id boolean primary key default true check (id),
  env text not null default 'test' check (env in ('test', 'staging', 'production')),
  global_stop boolean not null default true,            -- starts STOPPED; resume is an audited operator act
  stop_reason text default 'initial install: awaiting go-live',
  stopped_by text,
  stopped_at timestamptz default now(),
  paused_tasks text[] not null default '{}',
  paused_connectors text[] not null default '{}',
  last_tick_at timestamptz,
  last_tick_worker text,
  updated_at timestamptz not null default now()
);
insert into growth.control (id) values (true);

create table growth.audit (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  detail jsonb,
  at timestamptz not null default now()
);

create table growth.budgets (
  id bigint generated always as identity primary key,
  scope text not null check (scope = 'global' or scope ~ '^(task|connector):[a-z0-9_.-]+$'),
  period text not null check (period in ('day', 'month')),
  limit_usd numeric(12, 4) not null check (limit_usd >= 0),
  updated_at timestamptz not null default now(),
  unique (scope, period)
);
-- Approved starting ceilings (James, 2026-11-23): $5/day and $50/month for all paid calls.
insert into growth.budgets (scope, period, limit_usd) values ('global', 'day', 5), ('global', 'month', 50);

create table growth.model_prices (
  model text primary key,
  usd_per_mtok_in numeric(10, 4) not null,
  usd_per_mtok_out numeric(10, 4) not null,
  updated_at timestamptz not null default now()
);
-- First-party list prices, 2026-11 (update here when prices change; costs are computed from this table).
insert into growth.model_prices (model, usd_per_mtok_in, usd_per_mtok_out) values
  ('claude-opus-5-5', 4, 20), ('claude-sonnet-5-5', 2, 10), ('claude-haiku-5-5', 0.10, 0.50);

-- ---------------------------------------------------------------------------------------------------
-- 2. Prompts and the agent task registry (both immutable once active/approved)
-- ---------------------------------------------------------------------------------------------------
create table growth.prompts (
  key text not null check (key ~ '^[a-z0-9_.-]{1,64}$'),
  version int not null check (version > 0),
  body text not null check (char_length(body) between 1 and 50000),
  sha256 text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (key, version)
);

create function growth.tg_prompt_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  new.sha256 := encode(sha256(convert_to(new.body, 'UTF8')), 'hex');
  if tg_op = 'UPDATE' and old.status in ('approved', 'retired') then
    if new.body is distinct from old.body or new.key <> old.key or new.version <> old.version then
      raise exception 'prompt %/v% is % and immutable; add a new version', old.key, old.version, old.status;
    end if;
    if old.status = 'retired' and new.status <> 'retired' then raise exception 'retired prompts stay retired'; end if;
  end if;
  return new;
end $$;
create trigger prompts_guard before insert or update on growth.prompts for each row execute function growth.tg_prompt_guard();

create table growth.agent_tasks (
  key text not null check (key ~ '^[a-z0-9_.-]{1,64}$'),
  version int not null check (version > 0),
  handler text not null check (handler ~ '^[a-z0-9_.]{1,64}$'),
  description text not null,
  risk_tier int not null check (risk_tier between 0 and 3),
  requires_approval boolean not null,
  triggers text[] not null default '{}',          -- event names from growth.events_inbox
  prompt_key text,
  prompt_version int,
  model text references growth.model_prices (model),
  max_tokens int check (max_tokens is null or max_tokens between 1 and 64000),
  est_cost_usd numeric(10, 4) not null default 0 check (est_cost_usd >= 0),
  max_cost_usd_per_run numeric(10, 4) check (max_cost_usd_per_run is null or max_cost_usd_per_run >= 0),
  max_runs_per_day int check (max_runs_per_day is null or max_runs_per_day > 0),
  max_attempts int not null default 5 check (max_attempts between 1 and 20),
  allowed_connectors text[] not null default '{}',
  enabled boolean not null default false,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  primary key (key, version),
  foreign key (prompt_key, prompt_version) references growth.prompts (key, version),
  -- Tier 2 (external / customer-visible) always needs approval; tier 3 (money) is never automated.
  check (risk_tier < 2 or requires_approval),
  check (prompt_key is null or model is not null)
);
-- One active version per key.
create unique index agent_tasks_one_active on growth.agent_tasks (key) where status = 'active';

create function growth.tg_task_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['enabled', 'status']) is distinct from (to_jsonb(old) - array['enabled', 'status']) then
    raise exception 'task %/v% is immutable; register a new version', old.key, old.version;
  end if;
  if old.status = 'retired' and new.status <> 'retired' then raise exception 'retired tasks stay retired'; end if;
  return new;
end $$;
create trigger agent_tasks_guard before update on growth.agent_tasks for each row execute function growth.tg_task_guard();

-- ---------------------------------------------------------------------------------------------------
-- 3. Event inbox, ingest cursors, schedules
-- ---------------------------------------------------------------------------------------------------
create table growth.events_inbox (
  id bigint generated always as identity primary key,
  source text not null,
  source_id text not null,
  event text not null,
  occurred_at timestamptz not null,
  subject_ref uuid,                -- account id (analytics) or lead id (lead_events); never an email
  props jsonb,
  ingested_at timestamptz not null default now(),
  dispatched_at timestamptz,
  unique (source, source_id)
);
create index events_inbox_undispatched on growth.events_inbox (id) where dispatched_at is null;

create table growth.ingest_cursors (
  source text primary key,
  last_id bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into growth.ingest_cursors (source) values ('analytics_events'), ('lead_events');

create table growth.schedules (
  id bigint generated always as identity primary key,
  task_key text not null,
  every interval not null check (every >= interval '1 minute'),
  anchor timestamptz not null default date_trunc('minute', now()),
  grace interval not null default interval '1 hour',
  payload jsonb not null default '{}',
  enabled boolean not null default false,
  last_slot bigint,
  last_enqueued_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------
-- 4. Jobs, runs, steps, usage
-- ---------------------------------------------------------------------------------------------------
create table growth.jobs (
  id bigint generated always as identity primary key,
  task_key text not null,
  task_version int not null,
  payload jsonb not null default '{}',
  payload_sha256 text not null,
  idempotency_key text not null unique check (char_length(idempotency_key) <= 300),
  state text not null default 'queued' check (state in ('queued', 'awaiting_approval', 'leased', 'retry', 'succeeded', 'dead', 'canceled')),
  priority int not null default 100,
  run_after timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  approval_id bigint,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (task_key, task_version) references growth.agent_tasks (key, version)
);
create index jobs_due on growth.jobs (priority, run_after) where state in ('queued', 'retry');
create index jobs_leased on growth.jobs (lease_expires_at) where state = 'leased';

create table growth.runs (
  id bigint generated always as identity primary key,
  job_id bigint not null references growth.jobs (id) on delete cascade,
  attempt int not null,
  task_key text not null,
  task_version int not null,
  prompt_key text,
  prompt_version int,
  prompt_sha256 text,
  model text,
  worker_id text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'lost')),
  tokens_in int,
  tokens_out int,
  cost_usd numeric(12, 6),
  output jsonb,
  error text,
  env text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index runs_job on growth.runs (job_id);
create index runs_task_day on growth.runs (task_key, started_at);

create table growth.run_steps (
  id bigint generated always as identity primary key,
  run_id bigint not null references growth.runs (id) on delete cascade,
  connector text not null,
  action text not null,
  request_sha256 text,
  response_code text,
  latency_ms int,
  idempotency_key text,
  change_id bigint,
  at timestamptz not null default now()
);

create table growth.usage (
  id bigint generated always as identity primary key,
  run_id bigint not null references growth.runs (id) on delete cascade,
  scopes text[] not null,
  reserved_usd numeric(12, 6) not null default 0,
  actual_usd numeric(12, 6),
  state text not null default 'reserved' check (state in ('reserved', 'settled', 'released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index usage_time on growth.usage (created_at);

-- ---------------------------------------------------------------------------------------------------
-- 5. Approvals, change log, connections
-- ---------------------------------------------------------------------------------------------------
create table growth.approvals (
  id bigint generated always as identity primary key,
  subject_type text not null check (subject_type in ('job')),
  subject_id bigint not null,
  action text not null,
  payload jsonb not null,
  payload_sha256 text not null,
  risk_tier int not null,
  requested_by text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'used')),
  decided_by text,
  decided_at timestamptz,
  note text,
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table growth.jobs add foreign key (approval_id) references growth.approvals (id);

create table growth.change_log (
  id bigint generated always as identity primary key,
  approval_id bigint references growth.approvals (id),
  job_id bigint references growth.jobs (id),
  target_table text not null,
  target_id text not null,
  op text not null,
  before jsonb,
  after jsonb,
  reversible boolean not null default true,
  reverted_at timestamptz,
  reverted_by text,
  at timestamptz not null default now()
);

create table growth.connections (
  provider text not null,
  account_ref text not null,
  scopes text[] not null default '{}',
  status text not null default 'disconnected' check (status in ('connected', 'needs_reauth', 'disconnected')),
  secret_name text check (secret_name is null or secret_name like 'growth\_%'),
  expires_at timestamptz,
  last_health_at timestamptz,
  detail text,
  primary key (provider, account_ref)
);

-- Everything in growth is private: RLS on, no grants to anon/authenticated. The worker may only read the
-- registry, prompts, control row and prices (policies below); every write goes through growth_api.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'growth' loop
    execute format('alter table growth.%I enable row level security', t);
    execute format('revoke all on growth.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on growth.%I from anon, authenticated', t); end if;
  end loop;
end $$;
create policy worker_read on growth.agent_tasks for select to growth_worker using (true);
create policy worker_read on growth.prompts for select to growth_worker using (true);
create policy worker_read on growth.control for select to growth_worker using (true);
create policy worker_read on growth.model_prices for select to growth_worker using (true);

-- ---------------------------------------------------------------------------------------------------
-- 6. growth_read: the only customer data Growth OS sees (internal/test/demo accounts excluded)
-- ---------------------------------------------------------------------------------------------------
create view growth_read.acquisition_events as
  select e.id, e.event, e.event_id, e.user_id, e.trade, e.created_at
    from public.analytics_events e
   where not exists (select 1 from public.admin_account_labels l
                      where l.user_id = e.user_id and l.label in ('internal', 'test', 'demo'));

create view growth_read.funnel_leads as
  select l.id, l.user_id, l.stage, l.stage_changed_at, l.source, l.utm_source, l.utm_medium, l.utm_campaign,
         l.utm_content, l.landing_path, l.first_touch_at, (l.suppressed_at is not null or l.unsubscribed_at is not null) as suppressed,
         encode(sha256(convert_to(l.email_norm, 'UTF8')), 'hex') as email_sha256, l.created_at, l.updated_at
    from public.leads l
   where not exists (select 1 from public.admin_account_labels a
                      where a.user_id = l.user_id and a.label in ('internal', 'test', 'demo'));

create view growth_read.lead_events as
  select le.id, le.lead_id, le.event, le.source, le.occurred_at, le.created_at
    from public.lead_events le
    join growth_read.funnel_leads fl on fl.id = le.lead_id;

-- ---------------------------------------------------------------------------------------------------
-- 7. Internal helpers
-- ---------------------------------------------------------------------------------------------------
-- Who is calling? Inside SECURITY DEFINER functions current_user is the owner, so decide from session_user
-- (the login: growth_worker, postgres, or PostgREST's authenticator) plus the request JWT claims.
create function growth.jwt_claim(p text) returns text language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claim.' || p, true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> p)
$$;

create function growth.is_operator() returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_role text := growth.jwt_claim('role'); v_sub text := growth.jwt_claim('sub');
begin
  if session_user = 'growth_worker' then return false; end if;
  if v_role = 'service_role' then return true; end if;
  if v_sub is not null then return public.is_admin(v_sub::uuid); end if;
  if v_role in ('authenticated', 'anon') then return false; end if;
  return session_user in ('postgres', 'supabase_admin');
end $$;

create function growth.actor() returns text language sql stable set search_path = '' as $$
  select coalesce('user:' || growth.jwt_claim('sub'), case when growth.jwt_claim('role') = 'service_role' then 'service_role' end, session_user::text)
$$;

create function growth.json_sha(p jsonb) returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p, 'null'::jsonb)::text, 'UTF8')), 'hex')
$$;

-- Spent + reserved for a scope in the current period (UTC day / UTC month).
create function growth.spent(p_scope text, p_period text) returns numeric language sql stable set search_path = '' as $$
  select coalesce(sum(case when u.state = 'settled' then u.actual_usd when u.state = 'reserved' then u.reserved_usd else 0 end), 0)
    from growth.usage u
   where p_scope = any (u.scopes)
     and u.created_at >= case p_period when 'day' then date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
                                       else date_trunc('month', now() at time zone 'UTC') at time zone 'UTC' end
$$;

-- Null when the estimate fits every budget for these scopes, else the first scope/period that would be exceeded.
create function growth.budget_block(p_scopes text[], p_estimate numeric) returns text language sql stable set search_path = '' as $$
  select b.scope || '/' || b.period
    from growth.budgets b
   where b.scope = any (p_scopes)
     and growth.spent(b.scope, b.period) + p_estimate > b.limit_usd
   order by b.scope, b.period limit 1
$$;

-- ---------------------------------------------------------------------------------------------------
-- 8. growth_api: worker functions
-- ---------------------------------------------------------------------------------------------------
create function growth_api.tick_begin(p_worker text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c growth.control;
begin
  update growth.control set last_tick_at = now(), last_tick_worker = left(p_worker, 100) where id returning * into c;
  return jsonb_build_object('env', c.env, 'global_stop', c.global_stop, 'stop_reason', c.stop_reason,
                            'paused_tasks', c.paused_tasks, 'paused_connectors', c.paused_connectors);
end $$;

-- Is work (optionally for one task / connector) allowed right now? Checked before every external call.
create function growth_api.is_stopped(p_task text default null, p_connector text default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select c.global_stop or (p_task is not null and p_task = any (c.paused_tasks))
      or (p_connector is not null and p_connector = any (c.paused_connectors))
    from growth.control c where c.id
$$;

-- Copy new rows from the read views into the inbox. Re-reads a window behind the cursor so rows whose
-- identity committed late are not skipped; the unique (source, source_id) key makes the overlap harmless.
create function growth_api.ingest(p_limit int default 500, p_lookback int default 500) returns int
language plpgsql security definer set search_path = '' as $$
declare v_last bigint; v_max bigint; n int := 0; m int;
begin
  select last_id into v_last from growth.ingest_cursors where source = 'analytics_events' for update;
  with src as (
    select * from growth_read.acquisition_events where id > greatest(v_last - p_lookback, 0) order by id limit p_limit + p_lookback),
  ins as (
    insert into growth.events_inbox (source, source_id, event, occurred_at, subject_ref, props)
    select 'analytics_events', s.id::text, s.event, s.created_at, s.user_id,
           jsonb_strip_nulls(jsonb_build_object('event_id', s.event_id, 'trade', s.trade))
      from src s
    on conflict (source, source_id) do nothing returning 1)
  select (select count(*) from ins), (select max(id) from src) into m, v_max;
  n := n + m;
  update growth.ingest_cursors set last_id = greatest(v_last, coalesce(v_max, 0)), updated_at = now() where source = 'analytics_events';

  select last_id into v_last from growth.ingest_cursors where source = 'lead_events' for update;
  with src as (
    select * from growth_read.lead_events where id > greatest(v_last - p_lookback, 0) order by id limit p_limit + p_lookback),
  ins as (
    insert into growth.events_inbox (source, source_id, event, occurred_at, subject_ref, props)
    select 'lead_events', s.id::text, 'lead.' || s.event, s.occurred_at, s.lead_id, jsonb_build_object('source', s.source)
      from src s
    on conflict (source, source_id) do nothing returning 1)
  select (select count(*) from ins), (select max(id) from src) into m, v_max;
  n := n + m;
  update growth.ingest_cursors set last_id = greatest(v_last, coalesce(v_max, 0)), updated_at = now() where source = 'lead_events';
  return n;
end $$;

-- Enqueue one job. Idempotent on p_idem (returns the existing job id). Tier 3 is refused outright;
-- tasks that need approval start in awaiting_approval with a pending approval bound to the payload hash.
create function growth_api.enqueue(p_task text, p_payload jsonb, p_idem text, p_created_by text,
                                   p_run_after timestamptz default now(), p_priority int default 100) returns bigint
language plpgsql security definer set search_path = '' as $$
declare t growth.agent_tasks; v_id bigint; v_appr bigint; v_sha text := growth.json_sha(coalesce(p_payload, '{}'));
begin
  select id into v_id from growth.jobs where idempotency_key = p_idem;
  if found then return v_id; end if;
  select * into t from growth.agent_tasks where key = p_task and status = 'active';
  if not found then raise exception 'unknown task %', p_task using errcode = 'P0002'; end if;
  if not t.enabled then raise exception 'task % is disabled', p_task; end if;
  if t.risk_tier >= 3 then raise exception 'tier 3 task % is never automated', p_task; end if;

  insert into growth.jobs (task_key, task_version, payload, payload_sha256, idempotency_key, state, priority, run_after, max_attempts, created_by)
  values (t.key, t.version, coalesce(p_payload, '{}'), v_sha, p_idem,
          case when t.requires_approval then 'awaiting_approval' else 'queued' end, p_priority, p_run_after, t.max_attempts, left(p_created_by, 200))
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from growth.jobs where idempotency_key = p_idem; return v_id; end if;

  if t.requires_approval then
    insert into growth.approvals (subject_type, subject_id, action, payload, payload_sha256, risk_tier, requested_by)
    values ('job', v_id, t.key, coalesce(p_payload, '{}'), v_sha, t.risk_tier, left(p_created_by, 200)) returning id into v_appr;
    update growth.jobs set approval_id = v_appr where id = v_id;
  end if;
  return v_id;
end $$;

-- One job per schedule slot, even when ticks overlap or arrive late (inside the grace window).
create function growth_api.enqueue_due_schedules() returns int language plpgsql security definer set search_path = '' as $$
declare s growth.schedules; v_slot bigint; n int := 0;
begin
  for s in select * from growth.schedules where enabled and anchor <= now() for update skip locked loop
    v_slot := floor(extract(epoch from now() - s.anchor) / extract(epoch from s.every))::bigint;
    if s.last_slot is not null and v_slot <= s.last_slot then continue; end if;
    if s.anchor + s.every * v_slot + s.grace < now() then   -- slot too old: skip it, wait for the next
      update growth.schedules set last_slot = v_slot where id = s.id; continue;
    end if;
    begin
      perform growth_api.enqueue(s.task_key, s.payload, format('schedule:%s:%s', s.id, v_slot), 'schedule:' || s.id);
      n := n + 1;
    exception when others then
      insert into growth.audit (actor, action, detail) values ('scheduler', 'schedule_enqueue_failed',
        jsonb_build_object('schedule', s.id, 'error', sqlerrm));
    end;
    update growth.schedules set last_slot = v_slot, last_enqueued_at = now() where id = s.id;
  end loop;
  return n;
end $$;

-- Fan inbox events out to the active, enabled tasks whose triggers name them.
create function growth_api.dispatch_events(p_limit int default 200) returns int language plpgsql security definer set search_path = '' as $$
declare e growth.events_inbox; t record; n int := 0;
begin
  for e in select * from growth.events_inbox where dispatched_at is null order by id limit p_limit for update skip locked loop
    for t in select key from growth.agent_tasks where status = 'active' and enabled and e.event = any (triggers) loop
      begin
        perform growth_api.enqueue(t.key, jsonb_build_object('event', e.event, 'inbox_id', e.id, 'subject_ref', e.subject_ref,
                                   'occurred_at', e.occurred_at, 'props', e.props), format('%s:inbox:%s', t.key, e.id), 'event:' || e.id);
        n := n + 1;
      exception when others then
        insert into growth.audit (actor, action, detail) values ('dispatcher', 'dispatch_failed',
          jsonb_build_object('inbox', e.id, 'task', t.key, 'error', sqlerrm));
      end;
    end loop;
    update growth.events_inbox set dispatched_at = now() where id = e.id;
  end loop;
  return n;
end $$;

-- Return expired leases to the queue (worker died or timed out). The open run is marked lost and its
-- reservation released. Handlers that touch the outside world must look before resending on attempt > 1.
create function growth_api.recover_stale() returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with j as (
    update growth.jobs set state = case when attempts >= max_attempts then 'dead' else 'retry' end,
           lease_owner = null, lease_expires_at = null, run_after = now(),
           last_error = 'lease expired (worker stopped mid-run)', updated_at = now(),
           finished_at = case when attempts >= max_attempts then now() end
     where state = 'leased' and lease_expires_at < now()
    returning id),
  r as (update growth.runs set status = 'lost', finished_at = now(), error = 'lease expired'
         where status = 'running' and job_id in (select id from j) returning id),
  u as (update growth.usage set state = 'released', settled_at = now() where state = 'reserved' and run_id in (select id from r) returning 1)
  select count(*) into n from j;
  if n > 0 then insert into growth.audit (actor, action, detail) values ('worker', 'recovered_stale', jsonb_build_object('jobs', n)); end if;
  return n;
end $$;

-- Lease up to p_limit due jobs. Refuses everything while stopped; skips paused tasks, tasks over their daily
-- run cap, jobs whose approval is missing/expired/tampered, and jobs whose estimated cost would break a budget.
create function growth_api.claim(p_worker text, p_limit int default 5, p_lease_seconds int default 300)
returns table (job_id bigint, run_id bigint, task_key text, task_version int, handler text, attempt int, payload jsonb,
               approval_id bigint, prompt_key text, prompt_version int, prompt_body text, prompt_sha256 text,
               model text, max_tokens int, max_cost_usd numeric, allowed_connectors text[])
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare c growth.control; j growth.jobs; t growth.agent_tasks; a growth.approvals; p growth.prompts; v_run bigint;
        v_block text; v_scopes text[]; v_runs_today int; got int := 0; v_env text;
begin
  perform growth_api.recover_stale();
  select * into c from growth.control where id;
  if c.global_stop then return; end if;
  v_env := c.env;
  perform pg_advisory_xact_lock(hashtext('growth.claim'));  -- budget reservations are serialized

  for j in select * from growth.jobs where state in ('queued', 'retry') and run_after <= now()
            order by priority, run_after, id for update skip locked loop
    exit when got >= p_limit;
    select * into t from growth.agent_tasks where key = j.task_key and version = j.task_version;
    if not t.enabled or t.status <> 'active' or t.key = any (c.paused_tasks) then continue; end if;

    if t.requires_approval then
      select * into a from growth.approvals where id = j.approval_id;
      if not found or a.status <> 'approved' or a.expires_at < now() or a.payload_sha256 <> j.payload_sha256
         or a.payload_sha256 <> growth.json_sha(j.payload) then
        update growth.jobs set state = 'dead', last_error = 'approval missing, expired or payload changed after approval',
               finished_at = now(), updated_at = now() where id = j.id;
        insert into growth.audit (actor, action, detail) values ('worker', 'approval_check_failed', jsonb_build_object('job', j.id));
        continue;
      end if;
    end if;

    if t.max_runs_per_day is not null then
      select count(*) into v_runs_today from growth.runs r
       where r.task_key = t.key and r.started_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
      if v_runs_today >= t.max_runs_per_day then continue; end if;
    end if;

    v_scopes := array['global', 'task:' || t.key] || array(select 'connector:' || x from unnest(t.allowed_connectors) x);
    if t.est_cost_usd > 0 then
      v_block := growth.budget_block(v_scopes, t.est_cost_usd);
      if v_block is not null then
        update growth.jobs set last_error = 'waiting for budget: ' || v_block, updated_at = now() where id = j.id;
        continue;
      end if;
    end if;

    p := null;
    if t.prompt_key is not null then
      select * into p from growth.prompts where key = t.prompt_key and version = t.prompt_version;
      if not found or p.status is distinct from 'approved' then
        update growth.jobs set last_error = 'prompt not approved', updated_at = now() where id = j.id;
        continue;
      end if;
    end if;

    update growth.jobs set state = 'leased', attempts = attempts + 1, lease_owner = left(p_worker, 100),
           lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
     where id = j.id;
    insert into growth.runs (job_id, attempt, task_key, task_version, prompt_key, prompt_version, prompt_sha256, model, worker_id, env)
    values (j.id, j.attempts + 1, t.key, t.version, p.key, p.version, p.sha256, t.model, left(p_worker, 100), v_env) returning id into v_run;
    insert into growth.usage (run_id, scopes, reserved_usd) values (v_run, v_scopes, t.est_cost_usd);

    job_id := j.id; run_id := v_run; task_key := t.key; task_version := t.version; handler := t.handler;
    attempt := j.attempts + 1; payload := j.payload; approval_id := j.approval_id;
    prompt_key := p.key; prompt_version := p.version; prompt_body := p.body; prompt_sha256 := p.sha256;
    model := t.model; max_tokens := t.max_tokens; max_cost_usd := t.max_cost_usd_per_run; allowed_connectors := t.allowed_connectors;
    return next;
    got := got + 1;
  end loop;
end $$;

-- Finish a run. Fenced: only the worker holding an unexpired lease for this run may complete it.
create function growth_api.complete(p_run bigint, p_worker text, p_ok boolean, p_retryable boolean default true,
                                    p_output jsonb default null, p_error text default null,
                                    p_tokens_in int default null, p_tokens_out int default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r growth.runs; j growth.jobs; v_cost numeric := 0; mp growth.model_prices; v_state text;
begin
  select * into r from growth.runs where id = p_run for update;
  if not found then raise exception 'unknown run %', p_run; end if;
  select * into j from growth.jobs where id = r.job_id for update;
  if r.status <> 'running' or j.state <> 'leased' or j.lease_owner is distinct from left(p_worker, 100) or r.worker_id <> left(p_worker, 100) then
    return 'fenced';   -- lease lost (expired and recovered, or another worker): never double-apply
  end if;

  if r.model is not null and (p_tokens_in is not null or p_tokens_out is not null) then
    select * into mp from growth.model_prices where model = r.model;
    v_cost := (coalesce(p_tokens_in, 0) * mp.usd_per_mtok_in + coalesce(p_tokens_out, 0) * mp.usd_per_mtok_out) / 1e6;
  end if;
  update growth.usage set actual_usd = v_cost, state = 'settled', settled_at = now() where run_id = r.id and state = 'reserved';

  v_state := case when p_ok then 'succeeded'
                  when p_retryable and j.attempts < j.max_attempts then 'retry'
                  else 'dead' end;
  update growth.runs set status = case when p_ok then 'succeeded' else 'failed' end, finished_at = now(),
         output = p_output, error = left(p_error, 2000), tokens_in = p_tokens_in, tokens_out = p_tokens_out, cost_usd = v_cost
   where id = r.id;
  update growth.jobs set state = v_state, lease_owner = null, lease_expires_at = null, updated_at = now(),
         last_error = case when p_ok then null else left(p_error, 2000) end,
         run_after = case when v_state = 'retry'
                          then now() + make_interval(secs => least(3600, 30 * power(2, j.attempts - 1))::int + floor(random() * 10)::int)
                          else j.run_after end,
         finished_at = case when v_state in ('succeeded', 'dead') then now() end
   where id = j.id;
  if v_state = 'dead' then
    insert into growth.audit (actor, action, detail) values ('worker', 'job_dead', jsonb_build_object('job', j.id, 'task', j.task_key, 'error', left(p_error, 500)));
  end if;
  return v_state;
end $$;

create function growth_api.log_step(p_run bigint, p_worker text, p_connector text, p_action text, p_request_sha256 text,
                                    p_response_code text, p_latency_ms int, p_idempotency_key text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  if not exists (select 1 from growth.runs where id = p_run and worker_id = left(p_worker, 100) and status = 'running') then
    raise exception 'run % is not running for this worker', p_run;
  end if;
  insert into growth.run_steps (run_id, connector, action, request_sha256, response_code, latency_ms, idempotency_key)
  values (p_run, left(p_connector, 64), left(p_action, 64), p_request_sha256, left(p_response_code, 32), p_latency_ms, p_idempotency_key)
  returning id into v;
  return v;
end $$;

-- Read a Growth OS secret from Vault. Only names starting with growth_ are reachable.
create function growth_api.secret(p_name text) returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if p_name is null or p_name not like 'growth\_%' then raise exception 'secret % is outside Growth OS', p_name; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v using p_name;
  return v;
end $$;

-- May Growth OS contact this address for this purpose? Combines every suppression source in the app.
create function growth_api.contact_eligibility(p_email text, p_purpose text)
returns table (allowed boolean, reason text) language plpgsql stable security definer set search_path = '' as $$
declare e text := lower(btrim(p_email)); d text; v_user uuid; v_paying boolean := false; v_opt boolean;
begin
  if p_purpose not in ('marketing', 'sales_outreach', 'creator_outreach') then raise exception 'unknown purpose %', p_purpose; end if;
  if e is null or position('@' in e) < 2 then allowed := false; reason := 'invalid_email'; return next; return; end if;
  d := split_part(e, '@', 2);
  if exists (select 1 from public.leads where email_norm = e and (suppressed_at is not null or unsubscribed_at is not null)) then
    allowed := false; reason := 'lead_suppressed'; return next; return; end if;
  if exists (select 1 from public.comm_suppressions where email = e and account_id is null and scope in ('marketing', 'all')) then
    allowed := false; reason := 'comm_suppressed'; return next; return; end if;
  if exists (select 1 from public.sales_suppressions where key in ('e:' || e, 'd:' || d)) then
    allowed := false; reason := 'sales_suppressed'; return next; return; end if;
  if exists (select 1 from public.sales_bad_emails where email = e) then
    allowed := false; reason := 'bad_email'; return next; return; end if;
  if exists (select 1 from public.creator_outreach_suppressions where email = e) then
    allowed := false; reason := 'creator_suppressed'; return next; return; end if;

  select id into v_user from auth.users where lower(email) = e limit 1;
  if v_user is not null then
    select exists (select 1 from public.subscriptions where user_id = v_user and status in ('active', 'trialing', 'past_due')) into v_paying;
    select marketing_opt_in into v_opt from public.profiles where id = v_user;
  end if;
  if p_purpose in ('sales_outreach', 'creator_outreach') and v_paying then
    allowed := false; reason := 'existing_customer'; return next; return; end if;
  if p_purpose = 'marketing' and coalesce(v_opt, false) = false then
    allowed := false; reason := 'no_marketing_consent'; return next; return; end if;
  allowed := true; reason := 'ok'; return next;
end $$;

-- Apply one approved CRM update. Bound to the job's approval and payload hash; used at most once; writes
-- change_log in the same transaction. Supported actions (Phase 4): lead.set_stage, lead.add_event.
create function growth_api.crm_apply(p_job bigint, p_worker text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j growth.jobs; a growth.approvals; l public.leads; v_order text[] := array['prospect', 'contacted', 'engaged', 'replied',
        'interested', 'signed_up', 'activated', 'paid', 'churned']; v_new text; v_change bigint; v_event text; v_ev_id bigint;
begin
  select * into j from growth.jobs where id = p_job for update;
  if not found or j.state <> 'leased' or j.lease_owner is distinct from left(p_worker, 100) then raise exception 'job % is not leased by this worker', p_job; end if;
  select * into a from growth.approvals where id = j.approval_id for update;
  if not found then raise exception 'job % has no approval', p_job; end if;
  if a.status = 'used' then   -- idempotent replay after a lost response
    return (select jsonb_build_object('status', 'already_applied', 'change_id', max(id)) from growth.change_log where approval_id = a.id);
  end if;
  if a.status <> 'approved' or a.expires_at < now() then raise exception 'approval % is %', a.id, a.status; end if;
  if a.payload_sha256 <> growth.json_sha(j.payload) or a.payload_sha256 <> j.payload_sha256 then raise exception 'payload changed after approval'; end if;

  select * into l from public.leads where id = (j.payload->>'lead_id')::uuid for update;
  if not found then raise exception 'lead not found'; end if;

  if j.payload->>'action' = 'lead.set_stage' then
    v_new := j.payload->>'stage';
    if not v_new = any (v_order) then raise exception 'invalid stage %', v_new; end if;
    if not (array_position(v_order, v_new) > array_position(v_order, l.stage) or (l.stage, v_new) in (('paid', 'churned'), ('churned', 'paid'))) then
      raise exception 'stage change % -> % is not forward', l.stage, v_new;
    end if;
    update public.leads set stage = v_new, stage_changed_at = now() where id = l.id;
    insert into growth.change_log (approval_id, job_id, target_table, target_id, op, before, after)
    values (a.id, j.id, 'public.leads', l.id::text, 'set_stage', jsonb_build_object('stage', l.stage, 'stage_changed_at', l.stage_changed_at),
            jsonb_build_object('stage', v_new)) returning id into v_change;
  elsif j.payload->>'action' = 'lead.add_event' then
    v_event := j.payload->>'event';
    if v_event is null or v_event !~ '^[a-z_]{1,40}$' then raise exception 'invalid event name'; end if;
    insert into public.lead_events (lead_id, event, source, dedupe_key, meta)
    values (l.id, 'growth_' || v_event, 'admin', 'growth:approval:' || a.id,
            jsonb_build_object('via', 'growth_os', 'approval_id', a.id, 'note', left(j.payload->>'note', 500)))
    returning id into v_ev_id;
    insert into growth.change_log (approval_id, job_id, target_table, target_id, op, before, after)
    values (a.id, j.id, 'public.lead_events', v_ev_id::text, 'insert', null, jsonb_build_object('event', 'growth_' || v_event)) returning id into v_change;
  else
    raise exception 'unsupported CRM action %', j.payload->>'action';
  end if;
  update growth.approvals set status = 'used', used_at = now() where id = a.id;
  return jsonb_build_object('status', 'applied', 'change_id', v_change);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 9. growth_api: operator functions (service role, postgres, or a signed-in platform admin)
-- ---------------------------------------------------------------------------------------------------
create function growth_api.stop(p_reason text) returns void language plpgsql security definer set search_path = '' as $$
begin
  -- The worker may also stop the system (circuit breaker); only operators can resume.
  if not (growth.is_operator() or session_user = 'growth_worker') then raise exception 'not allowed'; end if;
  update growth.control set global_stop = true, stop_reason = left(coalesce(p_reason, 'stopped'), 500), stopped_by = growth.actor(),
         stopped_at = now(), updated_at = now() where id;
  insert into growth.audit (actor, action, detail) values (growth.actor(), 'stop', jsonb_build_object('reason', p_reason));
end $$;

create function growth_api.resume(p_reason text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  update growth.control set global_stop = false, stop_reason = null, updated_at = now() where id;
  insert into growth.audit (actor, action, detail) values (growth.actor(), 'resume', jsonb_build_object('reason', p_reason));
end $$;

create function growth_api.set_paused(p_kind text, p_name text, p_paused boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  if p_kind = 'task' then
    update growth.control set paused_tasks = case when p_paused then array(select distinct x from unnest(paused_tasks || p_name) x)
                                                  else array_remove(paused_tasks, p_name) end, updated_at = now() where id;
  elsif p_kind = 'connector' then
    update growth.control set paused_connectors = case when p_paused then array(select distinct x from unnest(paused_connectors || p_name) x)
                                                       else array_remove(paused_connectors, p_name) end, updated_at = now() where id;
  else raise exception 'kind must be task or connector'; end if;
  insert into growth.audit (actor, action, detail) values (growth.actor(), case when p_paused then 'pause' else 'unpause' end,
    jsonb_build_object('kind', p_kind, 'name', p_name));
end $$;

create function growth_api.decide_approval(p_id bigint, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare a growth.approvals;
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  select * into a from growth.approvals where id = p_id for update;
  if not found then raise exception 'unknown approval %', p_id; end if;
  if a.status <> 'pending' then raise exception 'approval % is already %', p_id, a.status; end if;
  if a.expires_at < now() then
    update growth.approvals set status = 'expired' where id = p_id;
    update growth.jobs set state = 'canceled', last_error = 'approval expired', finished_at = now() where id = a.subject_id and state = 'awaiting_approval';
    return 'expired';
  end if;
  update growth.approvals set status = case when p_approve then 'approved' else 'rejected' end, decided_by = growth.actor(),
         decided_at = now(), note = left(p_note, 1000) where id = p_id;
  update growth.jobs set state = case when p_approve then 'queued' else 'canceled' end, run_after = now(), updated_at = now(),
         finished_at = case when p_approve then null else now() end
   where id = a.subject_id and state = 'awaiting_approval';
  insert into growth.audit (actor, action, detail) values (growth.actor(), case when p_approve then 'approve' else 'reject' end,
    jsonb_build_object('approval', p_id, 'job', a.subject_id, 'note', p_note));
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

create function growth_api.set_budget(p_scope text, p_period text, p_limit_usd numeric) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  insert into growth.budgets (scope, period, limit_usd) values (p_scope, p_period, p_limit_usd)
  on conflict (scope, period) do update set limit_usd = excluded.limit_usd, updated_at = now();
  insert into growth.audit (actor, action, detail) values (growth.actor(), 'set_budget',
    jsonb_build_object('scope', p_scope, 'period', p_period, 'limit_usd', p_limit_usd));
end $$;

-- Undo one change. Refused when the target changed again afterwards (no silent overwrite).
create function growth_api.revert_change(p_change bigint) returns text language plpgsql security definer set search_path = '' as $$
declare c growth.change_log; v_now text;
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  select * into c from growth.change_log where id = p_change for update;
  if not found then raise exception 'unknown change %', p_change; end if;
  if c.reverted_at is not null then return 'already_reverted'; end if;
  if not c.reversible then raise exception 'change % cannot be reverted', p_change; end if;
  if c.target_table = 'public.leads' and c.op = 'set_stage' then
    select stage into v_now from public.leads where id = c.target_id::uuid for update;
    if v_now is distinct from c.after->>'stage' then raise exception 'lead changed since (now %); not reverting', v_now; end if;
    update public.leads set stage = c.before->>'stage', stage_changed_at = (c.before->>'stage_changed_at')::timestamptz where id = c.target_id::uuid;
  elsif c.target_table = 'public.lead_events' and c.op = 'insert' then
    delete from public.lead_events where id = c.target_id::bigint and dedupe_key like 'growth:approval:%';
  else
    raise exception 'no revert for % %', c.target_table, c.op;
  end if;
  update growth.change_log set reverted_at = now(), reverted_by = growth.actor() where id = p_change;
  insert into growth.audit (actor, action, detail) values (growth.actor(), 'revert_change', jsonb_build_object('change', p_change));
  return 'reverted';
end $$;

-- Retention (approved defaults): runs 180 days, steps 60 days, dispatched inbox rows 180 days, audit kept.
create function growth_api.cleanup() returns jsonb language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int;
begin
  if not (growth.is_operator() or session_user = 'growth_worker') then raise exception 'not allowed'; end if;
  delete from growth.run_steps where at < now() - interval '60 days'; get diagnostics a = row_count;
  delete from growth.runs where finished_at < now() - interval '180 days'
     and job_id in (select id from growth.jobs where state in ('succeeded', 'dead', 'canceled')); get diagnostics b = row_count;
  delete from growth.events_inbox where dispatched_at < now() - interval '180 days'; get diagnostics c = row_count;
  return jsonb_build_object('steps', a, 'runs', b, 'inbox', c);
end $$;

-- pg_cron entry point: POST to the worker's tick route with the cron secret (both from Vault).
create function growth.cron_tick() returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text := growth_api.secret('growth_worker_url'); v_secret text := growth_api.secret('growth_cron_secret'); v bigint;
begin
  if v_url is null or v_secret is null then raise exception 'growth_worker_url / growth_cron_secret not set in Vault'; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := ''{}''::jsonb, timeout_milliseconds := 140000)'
     into v using v_url || '/tick', jsonb_build_object('Content-Type', 'application/json', 'x-growth-cron-secret', v_secret);
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 10. Grants (least privilege). PUBLIC loses execute on everything; the worker gets only what it needs.
-- ---------------------------------------------------------------------------------------------------
revoke execute on all functions in schema growth, growth_api from public;
grant usage on schema growth_read, growth_api to growth_worker;
grant usage on schema growth to growth_worker;
grant select on all tables in schema growth_read to growth_worker;
grant select on growth.agent_tasks, growth.prompts, growth.control, growth.model_prices to growth_worker;
grant execute on function growth_api.tick_begin(text), growth_api.is_stopped(text, text), growth_api.ingest(int, int),
  growth_api.enqueue(text, jsonb, text, text, timestamptz, int), growth_api.enqueue_due_schedules(), growth_api.dispatch_events(int),
  growth_api.recover_stale(), growth_api.claim(text, int, int), growth_api.complete(bigint, text, boolean, boolean, jsonb, text, int, int),
  growth_api.log_step(bigint, text, text, text, text, text, int, text), growth_api.secret(text),
  growth_api.contact_eligibility(text, text), growth_api.crm_apply(bigint, text), growth_api.stop(text), growth_api.cleanup()
  to growth_worker;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema growth, growth_read, growth_api to service_role';
    execute 'grant execute on all functions in schema growth_api to service_role';
    execute 'grant select on all tables in schema growth, growth_read to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 11. Built-in tasks (deterministic test/maintenance tasks are enabled; nothing external is)
-- ---------------------------------------------------------------------------------------------------
insert into growth.agent_tasks (key, version, handler, description, risk_tier, requires_approval, max_attempts, enabled) values
  ('system.noop', 1, 'system.noop', 'Does nothing; proves the queue end to end.', 0, false, 3, true),
  ('system.echo', 1, 'system.echo', 'Test task: returns its payload; payload.fail_times / payload.permanent inject failures.', 0, false, 5, true),
  ('system.maintenance', 1, 'system.maintenance', 'Retention cleanup (runs 180 d, steps 60 d, inbox 180 d).', 0, false, 3, true),
  ('crm.apply_update', 1, 'crm.apply_update', 'Applies one approved CRM update (lead.set_stage / lead.add_event).', 2, true, 3, true);
insert into growth.schedules (task_key, every, anchor, payload, enabled)
values ('system.maintenance', interval '1 day', date_trunc('day', now()) + interval '9 hours 17 minutes', '{}', true);
