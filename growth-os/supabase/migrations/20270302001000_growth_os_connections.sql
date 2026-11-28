-- Growth OS Phase 5: Connections Center (registry, 5-state status, OAuth states, checks, audited admin functions).
--
-- STAGING / TEST ONLY until James approves a production rollout. Requires the Phase 4 foundation
-- (20270301001000_growth_os_foundation.sql). Rollback: growth-os/supabase/rollback/20270302001000_growth_os_connections_down.sql.
-- Registry rows come from growth-os/connectors/registry.ts via the generated *_growth_connectors_seed.sql.
--
-- Rules enforced here (acceptance A1–A7):
--   * Every connection and operation has exactly one of five statuses.
--   * verified_operational can only be written by growth_api.record_check (a real API call), never by hand,
--     never for a simulated row, and it decays to limited when the last successful check is older than 26 h.
--   * New connections, OAuth starts, privileged scopes, manual secrets and revokes are operator-only and audited.
--   * Tokens live only in Vault (growth_conn_* / growth_<provider>_*); no function returns a token to an operator.

-- ---------------------------------------------------------------------------------------------------
-- 1. Registry
-- ---------------------------------------------------------------------------------------------------
create table growth.connectors (
  provider text primary key check (provider ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  grp text not null,
  auth_kinds text[] not null check (auth_kinds <@ array['oauth2', 'manual_secret', 'internal', 'none']),
  baseline_status text not null check (baseline_status in ('awaiting_authorization', 'awaiting_platform_approval', 'unsupported')),
  baseline_reason text not null,
  existing text not null default '',
  review text not null default '',
  limits text not null default '',
  cost text not null default '',
  refresh text not null check (refresh in ('refresh_token', 'long_lived_exchange', 'never_expires', 'reauth', 'none')),
  docs text[] not null default '{}',
  manual_steps text[] not null default '{}',
  manual_secrets text[] not null default '{}',
  platform_submission jsonb,                 -- {status: drafted|submitted|approved|rejected, at, note, by}
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

create table growth.connector_operations (
  provider text not null references growth.connectors (provider) on delete cascade,
  op_key text not null check (op_key ~ '^[a-z0-9_.]{2,60}$'),
  label text not null,
  scopes text[] not null default '{}',
  privileged boolean not null,
  phase int not null,
  baseline_status text not null check (baseline_status in ('awaiting_authorization', 'awaiting_platform_approval', 'unsupported')),
  note text,
  sort int not null default 0,
  primary key (provider, op_key)
);

-- ---------------------------------------------------------------------------------------------------
-- 2. Connections: move the Phase 4 table to the five-state model (it is empty in every environment)
-- ---------------------------------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from growth.connections) then
    raise exception 'growth.connections is not empty; migrate its rows by hand before applying Phase 5';
  end if;
end $$;
alter table growth.connections drop constraint if exists connections_status_check;
alter table growth.connections alter column status set default 'awaiting_authorization';
alter table growth.connections
  add constraint connections_status_check check (status in ('verified_operational', 'limited', 'awaiting_authorization', 'awaiting_platform_approval', 'unsupported')),
  add constraint connections_provider_fk foreign key (provider) references growth.connectors (provider),
  add column auth_kind text not null default 'oauth2' check (auth_kind in ('oauth2', 'manual_secret', 'internal', 'none')),
  add column is_simulated boolean not null default false,
  add column account_label text,
  add column granted_scopes text[] not null default '{}',
  add column approved_privileged_scopes text[] not null default '{}',
  add column approved_scopes_sha256 text,
  add column approved_by text,
  add column approved_at timestamptz,
  add column connected_by text,
  add column connected_at timestamptz,
  add column last_verified_at timestamptz,
  add column last_check_at timestamptz,
  add column last_refresh_at timestamptz,
  add column refresh_fail_count int not null default 0,
  add column last_error_code text,
  add column last_error text,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  -- A simulated connection can never be live (acceptance: never display a simulated connection as live).
  add constraint connections_simulated_never_live check (not (is_simulated and status = 'verified_operational')),
  add constraint connections_verified_needs_check check (status <> 'verified_operational' or last_verified_at is not null),
  add constraint connections_account_ref_format check (account_ref ~ '^[A-Za-z0-9_.:@-]{1,120}$');
alter table growth.connections drop column scopes;   -- replaced by granted_scopes (requested scopes live in oauth_states)
comment on column growth.connections.status is 'Raw status from the last check or admin action. Display growth.connection_status_v, which also applies the 26 h freshness rule.';

-- Only the health check may write verified_operational. growth_api.record_check sets this transaction-local flag.
create function growth.guard_connection_status() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'verified_operational'
     and (tg_op = 'INSERT' or old.status is distinct from 'verified_operational' or old.last_verified_at is distinct from new.last_verified_at)
     and coalesce(current_setting('growth.status_writer', true), '') <> 'health_check' then
    raise exception 'verified_operational can only be set by a health check (growth_api.record_check)';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger connections_status_guard before insert or update on growth.connections
  for each row execute function growth.guard_connection_status();

create table growth.connection_checks (
  id bigint generated always as identity primary key,
  provider text not null,
  account_ref text not null,
  kind text not null check (kind in ('health', 'refresh', 'oauth')),
  outcome text not null check (outcome in ('ok', 'limited', 'auth_error', 'platform_pending', 'error')),
  http_status int,
  latency_ms int,
  granted_scopes text[],
  missing_scopes text[],
  rate_limit jsonb,
  error_code text,
  message text,
  status_after text,
  worker text,
  at timestamptz not null default now(),
  foreign key (provider, account_ref) references growth.connections (provider, account_ref) on delete cascade
);
create index connection_checks_recent on growth.connection_checks (provider, account_ref, at desc);

-- One row per OAuth start. Only the SHA-256 of the state is stored; the PKCE verifier is single use and expires in 10 min.
create table growth.oauth_states (
  state_sha256 text primary key check (state_sha256 ~ '^[0-9a-f]{64}$'),
  provider text not null references growth.connectors (provider),
  account_ref text not null,
  requested_scopes text[] not null,
  code_verifier text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  started_at timestamptz,
  used_at timestamptz,
  result text
);

do $$ declare t text; begin
  foreach t in array array['connectors', 'connector_operations', 'connection_checks', 'oauth_states'] loop
    execute format('alter table growth.%I enable row level security', t);
    execute format('revoke all on growth.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on growth.%I from anon, authenticated', t); end if;
  end loop;
end $$;
create policy worker_read on growth.connectors for select to growth_worker using (true);
create policy worker_read on growth.connector_operations for select to growth_worker using (true);
grant select on growth.connectors, growth.connector_operations to growth_worker;

-- ---------------------------------------------------------------------------------------------------
-- 3. Effective status (what every screen shows)
-- ---------------------------------------------------------------------------------------------------
-- Per operation. Freshness: verified only if the last successful check is < 26 h old, else limited (stale).
create view growth.operation_status_v as
with conn as (
  select c.*, (c.status = 'verified_operational' and c.last_verified_at < now() - interval '26 hours') as stale
    from growth.connections c
)
select o.provider, o.op_key, o.label, o.scopes, o.privileged, o.phase, o.note, o.sort,
       cn.account_ref, coalesce(cn.is_simulated, false) as is_simulated,
       array(select s from unnest(o.scopes) s where not s = any (coalesce(cn.granted_scopes, '{}'))) as missing_scopes,
       case
         when k.baseline_status = 'unsupported' or o.baseline_status = 'unsupported' then 'unsupported'
         when cn.provider is null then o.baseline_status
         -- Privileged operations need the owner's recorded approval for every scope, even when the platform granted it.
         when o.privileged and exists (select 1 from unnest(o.scopes) s where not s = any (cn.approved_privileged_scopes)) then
              case when o.baseline_status = 'awaiting_platform_approval' then 'awaiting_platform_approval' else 'awaiting_authorization' end
         when cn.status in ('awaiting_authorization', 'awaiting_platform_approval', 'unsupported') then cn.status
         when exists (select 1 from unnest(o.scopes) s where not s = any (cn.granted_scopes)) then
              case when o.scopes && cn.granted_scopes then 'limited'          -- partly granted: works, with gaps
                   when o.baseline_status = 'awaiting_platform_approval' then 'awaiting_platform_approval' else 'awaiting_authorization' end
         when cn.stale then 'limited'
         else cn.status
       end as status,
       case
         when k.baseline_status = 'unsupported' or o.baseline_status = 'unsupported' then coalesce(o.note, k.baseline_reason)
         when cn.provider is null then k.baseline_reason
         when cn.stale then 'Last successful check is older than 26 hours.'
         when cn.is_simulated then 'Simulated connection (test data). Not a real account.'
         else cn.last_error
       end as reason
  from growth.connector_operations o
  join growth.connectors k on k.provider = o.provider
  left join lateral (select * from conn where conn.provider = o.provider
                      order by conn.is_simulated, conn.last_verified_at desc nulls last, conn.account_ref limit 1) cn on true;

-- Per connector: badge = rollup of operations with phase <= 5 (later-phase operations are listed, not rolled up).
-- All verified → verified; any verified/limited → limited; else awaiting authorization, then platform approval, then unsupported.
create view growth.connection_status_v as
select k.provider, k.name, k.grp, k.auth_kinds, k.sort, k.baseline_reason, k.refresh, k.platform_submission,
       cn.account_ref, cn.account_label, coalesce(cn.is_simulated, false) as is_simulated, cn.granted_scopes,
       cn.approved_privileged_scopes, cn.connected_by, cn.connected_at, cn.last_verified_at, cn.last_check_at,
       cn.last_refresh_at, cn.expires_at, cn.refresh_fail_count, cn.last_error_code, cn.last_error,
       case
         when r.n = 0 then 'unsupported'
         when r.n_verified = r.n then 'verified_operational'
         when r.n_verified + r.n_limited > 0 then 'limited'
         when r.n_auth > 0 then 'awaiting_authorization'
         when r.n_platform > 0 then 'awaiting_platform_approval'
         else 'unsupported'
       end as status
  from growth.connectors k
  left join lateral (select * from growth.connections c where c.provider = k.provider
                      order by c.is_simulated, c.last_verified_at desc nulls last, c.account_ref limit 1) cn on true
  cross join lateral (
    select count(*) filter (where s.status <> 'unsupported') as n,
           count(*) filter (where s.status = 'verified_operational') as n_verified,
           count(*) filter (where s.status = 'limited') as n_limited,
           count(*) filter (where s.status = 'awaiting_authorization') as n_auth,
           count(*) filter (where s.status = 'awaiting_platform_approval') as n_platform
      from growth.operation_status_v s where s.provider = k.provider and s.phase <= 5) r;

revoke all on growth.operation_status_v, growth.connection_status_v from public;

-- ---------------------------------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------------------------------
create function growth.conn_secret_name(p_provider text, p_account text) returns text language sql immutable set search_path = '' as $$
  -- Readable prefix + hash of the exact account ref, so 'Acme.Co' and 'acme_co' never share a secret.
  select 'growth_conn_' || p_provider || '_' || left(lower(regexp_replace(p_account, '[^A-Za-z0-9]+', '_', 'g')), 40) || '_' || left(md5(p_account), 8)
$$;

-- Create or replace a Vault secret (Supabase Vault API). SECURITY DEFINER callers only.
create function growth.vault_put(p_name text, p_value text, p_description text) returns void language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  if p_name not like 'growth\_%' then raise exception 'secret % is outside Growth OS', p_name; end if;
  execute 'select id from vault.secrets where name = $1' into v_id using p_name;
  if v_id is null then
    execute 'select vault.create_secret($1, $2, $3)' using p_value, p_name, p_description;
  else
    execute 'select vault.update_secret($1, $2, $3, $4)' using v_id, p_value, p_name, p_description;
  end if;
end $$;

create function growth.vault_exists(p_name text) returns boolean language plpgsql stable set search_path = '' as $$
declare v boolean;
begin
  execute 'select exists (select 1 from vault.secrets where name = $1)' into v using p_name;
  return v;
end $$;

create function growth.vault_delete(p_name text) returns void language plpgsql set search_path = '' as $$
begin
  if p_name not like 'growth\_%' then raise exception 'secret % is outside Growth OS', p_name; end if;
  execute 'delete from vault.secrets where name = $1' using p_name;
end $$;

-- A fresh credential lifts an automatic pause for that connector (audited).
create function growth.unpause_connector(p_provider text, p_actor text) returns void language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from growth.control where id and p_provider = any (paused_connectors)) then
    update growth.control set paused_connectors = array_remove(paused_connectors, p_provider), updated_at = now() where id;
    insert into growth.audit (actor, action, detail) values (p_actor, 'connector_unpause', jsonb_build_object('provider', p_provider, 'why', 'new credential'));
  end if;
end $$;

create function growth.connector_scopes(p_provider text, p_privileged boolean) returns text[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(distinct s order by s), '{}')
    from growth.connector_operations o, unnest(o.scopes) s
   where o.provider = p_provider and o.privileged = p_privileged and o.baseline_status <> 'unsupported'
     and (p_privileged or o.phase <= 5)
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. growth_api: operator functions (service role, postgres / SQL editor, or a signed-in platform admin)
-- ---------------------------------------------------------------------------------------------------
-- Register an account for a connector (no credential yet). p_simulated marks test rows forever.
create function growth_api.register_connection(p_provider text, p_account_ref text, p_account_label text default null,
                                               p_simulated boolean default false, p_on_behalf text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare k growth.connectors; v_kind text;
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  select * into k from growth.connectors where provider = p_provider;
  if not found then raise exception 'unknown connector %', p_provider; end if;
  if k.baseline_status = 'unsupported' then raise exception 'connector % is unsupported', p_provider; end if;
  v_kind := k.auth_kinds[1];
  insert into growth.connections (provider, account_ref, account_label, auth_kind, is_simulated, status, detail)
  values (p_provider, p_account_ref, left(p_account_label, 200), v_kind, coalesce(p_simulated, false), k.baseline_status, 'registered')
  on conflict (provider, account_ref) do nothing;
  if not found then raise exception 'connection %/% already exists', p_provider, p_account_ref; end if;
  insert into growth.audit (actor, action, detail) values (growth.actor(), 'connection_register',
    jsonb_build_object('provider', p_provider, 'account', p_account_ref, 'simulated', coalesce(p_simulated, false), 'on_behalf', p_on_behalf));
  return k.baseline_status;
end $$;

-- Separate, recorded owner approval for privileged scopes (posting, messaging, ad management, CRM writes).
create function growth_api.approve_privileged_scopes(p_provider text, p_account_ref text, p_scopes text[], p_on_behalf text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_allowed text[] := growth.connector_scopes(p_provider, true); v_bad text[]; v_sha text;
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  v_bad := array(select s from unnest(p_scopes) s where not s = any (v_allowed));
  if cardinality(v_bad) > 0 then raise exception 'not privileged scopes of %: %', p_provider, v_bad; end if;
  v_sha := encode(sha256(convert_to(array_to_string(array(select distinct s from unnest(p_scopes) s order by s), ' '), 'UTF8')), 'hex');
  update growth.connections set approved_privileged_scopes = array(select distinct s from unnest(p_scopes) s order by s),
         approved_scopes_sha256 = v_sha, approved_by = coalesce(p_on_behalf, growth.actor()), approved_at = now()
   where provider = p_provider and account_ref = p_account_ref;
  if not found then raise exception 'unknown connection %/%', p_provider, p_account_ref; end if;
  insert into growth.audit (actor, action, detail) values (growth.actor(), 'scopes_approve',
    jsonb_build_object('provider', p_provider, 'account', p_account_ref, 'scopes', p_scopes, 'sha256', v_sha, 'on_behalf', p_on_behalf));
  return v_sha;
end $$;

-- Start an OAuth connection. Returns the one-time state (for the growth-oauth /start link) — never a token.
-- p_scopes defaults to the connector's read scopes; privileged scopes must have been approved first.
create function growth_api.oauth_begin(p_provider text, p_account_ref text, p_scopes text[] default null, p_on_behalf text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k growth.connectors; v_scopes text[]; v_bad text[]; v_state text; v_verifier text; c growth.connections;
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  select * into k from growth.connectors where provider = p_provider;
  if not found or not 'oauth2' = any (k.auth_kinds) then raise exception 'connector % does not use OAuth', p_provider; end if;
  select * into c from growth.connections where provider = p_provider and account_ref = p_account_ref;
  if not found then raise exception 'register %/% first', p_provider, p_account_ref; end if;
  if c.is_simulated then raise exception 'simulated connections cannot start OAuth'; end if;
  v_scopes := coalesce(p_scopes, growth.connector_scopes(p_provider, false));
  v_bad := array(select s from unnest(v_scopes) s
                  where not s = any (growth.connector_scopes(p_provider, false))
                    and not (s = any (growth.connector_scopes(p_provider, true)) and s = any (c.approved_privileged_scopes)));
  if cardinality(v_bad) > 0 then raise exception 'scopes need registry entry and privileged approval first: %', v_bad; end if;
  v_state := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_verifier := replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', '');  -- 96 hex chars (PKCE allows 43–128)
  insert into growth.oauth_states (state_sha256, provider, account_ref, requested_scopes, code_verifier, created_by)
  values (encode(sha256(convert_to(v_state, 'UTF8')), 'hex'), p_provider, p_account_ref, v_scopes, v_verifier, coalesce(p_on_behalf, growth.actor()));
  insert into growth.audit (actor, action, detail) values (growth.actor(), 'oauth_begin',
    jsonb_build_object('provider', p_provider, 'account', p_account_ref, 'scopes', v_scopes, 'on_behalf', p_on_behalf));
  return jsonb_build_object('state', v_state, 'provider', p_provider, 'scopes', v_scopes, 'expires_in', 600);
end $$;

-- Attach a credential James pasted into Vault himself. The value is never read here, only its existence.
create function growth_api.attach_manual_secret(p_provider text, p_account_ref text, p_secret_name text, p_on_behalf text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare k growth.connectors;
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  select * into k from growth.connectors where provider = p_provider;
  if not found or not 'manual_secret' = any (k.auth_kinds) then raise exception 'connector % does not take a manual secret', p_provider; end if;
  if p_secret_name not like 'growth\_' || replace(p_provider, '_', '\_') || '\_%' then
    raise exception 'secret name must start with growth_%_', p_provider;
  end if;
  if not growth.vault_exists(p_secret_name) then raise exception 'no Vault secret named % yet: add it in the dashboard first', p_secret_name; end if;
  update growth.connections set secret_name = p_secret_name, auth_kind = 'manual_secret', status = 'awaiting_authorization',
         detail = 'secret attached; first health check pending', connected_by = coalesce(p_on_behalf, growth.actor()), connected_at = now(),
         last_error = 'Secret attached. Waiting for the first health check.', last_error_code = 'pending_check'
   where provider = p_provider and account_ref = p_account_ref and not is_simulated;
  if not found then raise exception 'unknown (or simulated) connection %/%', p_provider, p_account_ref; end if;
  perform growth.unpause_connector(p_provider, growth.actor());
  insert into growth.audit (actor, action, detail) values (growth.actor(), 'secret_attach',
    jsonb_build_object('provider', p_provider, 'account', p_account_ref, 'secret_name', p_secret_name, 'on_behalf', p_on_behalf));
  return 'attached';
end $$;

-- Revoke locally: delete the stored token, clear scopes, pause nothing else. (Also remove the app on the platform.)
create function growth_api.revoke_connection(p_provider text, p_account_ref text, p_reason text default null, p_on_behalf text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare c growth.connections;
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  select * into c from growth.connections where provider = p_provider and account_ref = p_account_ref for update;
  if not found then raise exception 'unknown connection %/%', p_provider, p_account_ref; end if;
  if c.secret_name like 'growth\_conn\_%' then perform growth.vault_delete(c.secret_name); end if;  -- manual secrets stay; James deletes them
  update growth.connections set status = 'awaiting_authorization', secret_name = null, granted_scopes = '{}', expires_at = null,
         last_verified_at = null, last_error = 'Revoked: ' || coalesce(p_reason, 'by admin'), last_error_code = 'revoked', detail = 'revoked'
   where provider = p_provider and account_ref = p_account_ref;
  insert into growth.audit (actor, action, detail) values (growth.actor(), 'connection_revoke',
    jsonb_build_object('provider', p_provider, 'account', p_account_ref, 'reason', p_reason, 'on_behalf', p_on_behalf,
                       'deleted_secret', c.secret_name like 'growth\_conn\_%'));
  return 'revoked';
end $$;

create function growth_api.record_platform_submission(p_provider text, p_status text, p_note text default null, p_on_behalf text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  if p_status not in ('drafted', 'submitted', 'approved', 'rejected') then raise exception 'bad status %', p_status; end if;
  update growth.connectors set platform_submission = jsonb_build_object('status', p_status, 'at', now(), 'note', left(p_note, 1000),
         'by', coalesce(p_on_behalf, growth.actor())), updated_at = now() where provider = p_provider;
  if not found then raise exception 'unknown connector %', p_provider; end if;
  insert into growth.audit (actor, action, detail) values (growth.actor(), 'platform_submission',
    jsonb_build_object('provider', p_provider, 'status', p_status, 'note', p_note, 'on_behalf', p_on_behalf));
end $$;

-- Ask for a health check now (queued for the worker; nothing external happens in this call).
create function growth_api.request_health_check(p_provider text default null, p_on_behalf text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  v := growth_api.enqueue('connector.health', jsonb_build_object('provider', p_provider), 'health:' || coalesce(p_provider, 'all') || ':' || extract(epoch from now())::bigint, 'admin');
  insert into growth.audit (actor, action, detail) values (growth.actor(), 'health_check_request',
    jsonb_build_object('provider', p_provider, 'job', v, 'on_behalf', p_on_behalf));
  return v;
end $$;

-- Everything the Connections page shows, in one call. Contains no secret values.
create function growth_api.connections_overview() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not growth.is_operator() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'generated_at', now(),
    'env', (select env from growth.control where id),
    'paused_connectors', (select paused_connectors from growth.control where id),
    'connectors', coalesce((select jsonb_agg(to_jsonb(s) - 'sort' || jsonb_build_object(
        'connector', (select to_jsonb(k) - 'sort' - 'updated_at' from growth.connectors k where k.provider = s.provider),
        'operations', (select coalesce(jsonb_agg(to_jsonb(o) - 'provider' - 'sort' order by o.sort), '[]') from growth.operation_status_v o where o.provider = s.provider),
        'checks', (select coalesce(jsonb_agg(jsonb_build_object('at', x.at, 'kind', x.kind, 'outcome', x.outcome, 'http_status', x.http_status,
                     'missing_scopes', x.missing_scopes, 'error_code', x.error_code, 'message', x.message, 'status_after', x.status_after) order by x.at desc), '[]')
                     from (select * from growth.connection_checks cc where cc.provider = s.provider order by cc.at desc limit 10) x)
      ) order by s.sort) from growth.connection_status_v s), '[]'),
    'audit', coalesce((select jsonb_agg(a order by a.at desc) from (select id, actor, action, detail, at from growth.audit
              where action like any (array['connection\_%', 'scopes\_%', 'oauth\_%', 'secret\_%', 'token\_%', 'health\_%', 'platform\_%', 'connector\_%'])
              order by at desc limit 50) a), '[]'));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. growth_api: worker functions (growth-worker and growth-oauth both log in as growth_worker)
-- ---------------------------------------------------------------------------------------------------
-- growth-oauth /start: look up a fresh, unused state. Marks it started; does not consume it.
create function growth_api.oauth_start(p_state text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s growth.oauth_states;
begin
  update growth.oauth_states set started_at = coalesce(started_at, now())
   where state_sha256 = encode(sha256(convert_to(coalesce(p_state, ''), 'UTF8')), 'hex') and used_at is null and expires_at > now()
  returning * into s;
  if not found then raise exception 'unknown or expired connection link'; end if;
  return jsonb_build_object('provider', s.provider, 'account_ref', s.account_ref, 'scopes', s.requested_scopes,
    'code_challenge', translate(encode(sha256(convert_to(s.code_verifier, 'UTF8')), 'base64'), '+/=', '-_'));
end $$;

-- growth-oauth /callback step 1: consume the state (single use) and hand back the PKCE verifier.
create function growth_api.oauth_consume(p_state text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s growth.oauth_states;
begin
  update growth.oauth_states set used_at = now()
   where state_sha256 = encode(sha256(convert_to(coalesce(p_state, ''), 'UTF8')), 'hex') and used_at is null and expires_at > now()
  returning * into s;
  if not found then raise exception 'unknown, used or expired connection link'; end if;
  return jsonb_build_object('state_sha256', s.state_sha256, 'provider', s.provider, 'account_ref', s.account_ref,
                            'scopes', s.requested_scopes, 'code_verifier', s.code_verifier);
end $$;

-- growth-oauth /callback step 2: store the token in Vault and the granted scopes. Status stays non-live until a check.
create function growth_api.oauth_complete(p_state_sha256 text, p_token jsonb, p_granted_scopes text[], p_expires_at timestamptz,
                                         p_account_label text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare s growth.oauth_states; v_name text;
begin
  select * into s from growth.oauth_states where state_sha256 = p_state_sha256 for update;
  if not found or s.used_at is null or s.result is not null or s.used_at < now() - interval '10 minutes' then
    raise exception 'connection link is not in the callback step';
  end if;
  if p_token is null or coalesce(p_token->>'access_token', '') = '' then raise exception 'no access token'; end if;
  v_name := growth.conn_secret_name(s.provider, s.account_ref);
  perform growth.vault_put(v_name, p_token::text, 'Growth OS OAuth token ' || s.provider || '/' || s.account_ref);
  update growth.connections set secret_name = v_name, auth_kind = 'oauth2', granted_scopes = coalesce(p_granted_scopes, '{}'),
         expires_at = p_expires_at, connected_by = s.created_by, connected_at = now(), refresh_fail_count = 0,
         account_label = coalesce(left(p_account_label, 200), account_label), status = 'awaiting_authorization',
         last_error = 'Authorized. Waiting for the first health check.', last_error_code = 'pending_check', detail = 'authorized'
   where provider = s.provider and account_ref = s.account_ref;
  update growth.oauth_states set result = 'stored' where state_sha256 = p_state_sha256;
  perform growth.unpause_connector(s.provider, 'oauth_callback');
  insert into growth.connection_checks (provider, account_ref, kind, outcome, granted_scopes, missing_scopes, message, status_after)
  values (s.provider, s.account_ref, 'oauth', 'ok', p_granted_scopes,
          array(select x from unnest(s.requested_scopes) x where not x = any (coalesce(p_granted_scopes, '{}'))), 'token stored', 'awaiting_authorization');
  insert into growth.audit (actor, action, detail) values ('oauth_callback', 'oauth_complete',
    jsonb_build_object('provider', s.provider, 'account', s.account_ref, 'granted', p_granted_scopes, 'started_by', s.created_by));
  return 'stored';
end $$;

create function growth_api.oauth_fail(p_state_sha256 text, p_error_code text, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
declare s growth.oauth_states;
begin
  update growth.oauth_states set result = 'failed: ' || left(p_error_code, 60) where state_sha256 = p_state_sha256 and result is null returning * into s;
  if not found then return; end if;
  insert into growth.connection_checks (provider, account_ref, kind, outcome, error_code, message, status_after)
  select s.provider, s.account_ref, 'oauth', 'auth_error', left(p_error_code, 60), left(p_message, 500), c.status
    from growth.connections c where c.provider = s.provider and c.account_ref = s.account_ref;
  insert into growth.audit (actor, action, detail) values ('oauth_callback', 'oauth_failed',
    jsonb_build_object('provider', s.provider, 'account', s.account_ref, 'error', left(p_error_code, 60)));
end $$;

-- Connections the worker should check or refresh. Never includes simulated rows; never returns secret values.
create function growth_api.connections_due(p_kind text, p_provider text default null)
returns table (provider text, account_ref text, auth_kind text, secret_name text, expires_at timestamptz, granted_scopes text[], refresh text)
language sql stable security definer set search_path = '' as $$
  select c.provider, c.account_ref, c.auth_kind, c.secret_name, c.expires_at, c.granted_scopes, k.refresh
    from growth.connections c join growth.connectors k using (provider)
   where not c.is_simulated and k.baseline_status <> 'unsupported'
     and (p_provider is null or c.provider = p_provider)
     and case p_kind
           when 'health' then c.secret_name is not null or c.auth_kind = 'internal'
           when 'refresh' then c.secret_name like 'growth\_conn\_%' and k.refresh in ('refresh_token', 'long_lived_exchange')
                               and c.expires_at is not null and c.expires_at < now() + interval '24 hours'
                               and c.refresh_fail_count < 3
           else false end
   order by c.provider, c.account_ref
$$;

-- The only way a connection becomes verified_operational. Outcome comes from a real API call by the worker.
create function growth_api.record_check(p_provider text, p_account_ref text, p_outcome text, p_http_status int, p_latency_ms int,
                                        p_granted_scopes text[], p_error_code text, p_message text, p_rate_limit jsonb, p_worker text)
returns text language plpgsql security definer set search_path = '' as $$
declare c growth.connections; v_required text[] := growth.connector_scopes(p_provider, false); v_granted text[]; v_missing text[]; v_status text;
begin
  -- Worker login only: operators (service role, SQL editor) cannot declare a connection healthy without a real call.
  if session_user <> 'growth_worker' then raise exception 'not allowed: only the worker records checks'; end if;
  if p_outcome not in ('ok', 'limited', 'auth_error', 'platform_pending', 'error') then raise exception 'bad outcome %', p_outcome; end if;
  select * into c from growth.connections where provider = p_provider and account_ref = p_account_ref for update;
  if not found then raise exception 'unknown connection %/%', p_provider, p_account_ref; end if;
  v_granted := coalesce(p_granted_scopes, c.granted_scopes);
  v_missing := array(select s from unnest(v_required) s where not s = any (v_granted));
  v_status := case
    when p_outcome = 'ok' and cardinality(v_missing) = 0 and not c.is_simulated then 'verified_operational'
    when p_outcome in ('ok', 'limited') then 'limited'
    when p_outcome = 'auth_error' then 'awaiting_authorization'
    when p_outcome = 'platform_pending' then 'awaiting_platform_approval'
    else case when c.status = 'verified_operational' then 'limited' else c.status end   -- transient error: never stays green
  end;
  perform set_config('growth.status_writer', 'health_check', true);
  update growth.connections set status = v_status, granted_scopes = v_granted, last_check_at = now(), last_health_at = now(),
         last_verified_at = case when v_status = 'verified_operational' then now() else last_verified_at end,
         last_error_code = case when v_status = 'verified_operational' then null
                                when cardinality(v_missing) > 0 and p_outcome = 'ok' then 'missing_scopes' else left(p_error_code, 60) end,
         last_error = case when v_status = 'verified_operational' then null
                           when c.is_simulated then 'Simulated connection (test data). Not a real account.'
                           when cardinality(v_missing) > 0 and p_outcome = 'ok' then 'Missing permissions: ' || array_to_string(v_missing, ', ') || '. Reconnect and approve them.'
                           else left(p_message, 500) end
   where provider = p_provider and account_ref = p_account_ref;
  perform set_config('growth.status_writer', '', true);
  insert into growth.connection_checks (provider, account_ref, kind, outcome, http_status, latency_ms, granted_scopes, missing_scopes,
                                        rate_limit, error_code, message, status_after, worker)
  values (p_provider, p_account_ref, 'health', p_outcome, p_http_status, p_latency_ms, v_granted, v_missing, p_rate_limit,
          left(p_error_code, 60), left(p_message, 500), v_status, left(p_worker, 100));
  if v_status is distinct from c.status then
    insert into growth.audit (actor, action, detail) values (coalesce(p_worker, 'worker'), 'connector_status',
      jsonb_build_object('provider', p_provider, 'account', p_account_ref, 'from', c.status, 'to', v_status, 'error', left(p_error_code, 60)));
  end if;
  return v_status;
end $$;

-- After a token refresh attempt. Success stores the new token; three failures in a row pause the connector and alert.
create function growth_api.record_refresh(p_provider text, p_account_ref text, p_ok boolean, p_token jsonb, p_expires_at timestamptz,
                                          p_error_code text, p_message text, p_worker text) returns text
language plpgsql security definer set search_path = '' as $$
declare c growth.connections; v_fails int;
begin
  if session_user <> 'growth_worker' then raise exception 'not allowed: only the worker records refreshes'; end if;
  select * into c from growth.connections where provider = p_provider and account_ref = p_account_ref for update;
  if not found or c.secret_name is null or c.secret_name not like 'growth\_conn\_%' then raise exception 'no OAuth token for %/%', p_provider, p_account_ref; end if;
  if p_ok then
    if p_token is null or coalesce(p_token->>'access_token', '') = '' then raise exception 'no access token'; end if;
    perform growth.vault_put(c.secret_name, p_token::text, 'Growth OS OAuth token ' || p_provider || '/' || p_account_ref);
    update growth.connections set expires_at = p_expires_at, last_refresh_at = now(), refresh_fail_count = 0,
           last_error = case when last_error_code in ('refresh_failed', 'pending_refresh') then null else last_error end,
           last_error_code = case when last_error_code in ('refresh_failed', 'pending_refresh') then null else last_error_code end
     where provider = p_provider and account_ref = p_account_ref;
    insert into growth.connection_checks (provider, account_ref, kind, outcome, message, status_after, worker)
    values (p_provider, p_account_ref, 'refresh', 'ok', 'token refreshed', c.status, left(p_worker, 100));
    insert into growth.audit (actor, action, detail) values (coalesce(p_worker, 'worker'), 'token_refresh',
      jsonb_build_object('provider', p_provider, 'account', p_account_ref, 'expires_at', p_expires_at));
    return 'refreshed';
  end if;
  v_fails := c.refresh_fail_count + 1;
  update growth.connections set refresh_fail_count = v_fails, last_error_code = 'refresh_failed', last_error = left(p_message, 500),
         status = case when v_fails >= 3 then 'awaiting_authorization' else status end
   where provider = p_provider and account_ref = p_account_ref;
  insert into growth.connection_checks (provider, account_ref, kind, outcome, error_code, message, status_after, worker)
  values (p_provider, p_account_ref, 'refresh', 'auth_error', left(p_error_code, 60), left(p_message, 500),
          case when v_fails >= 3 then 'awaiting_authorization' else c.status end, left(p_worker, 100));
  insert into growth.audit (actor, action, detail) values (coalesce(p_worker, 'worker'), 'token_refresh_failed',
    jsonb_build_object('provider', p_provider, 'account', p_account_ref, 'fails', v_fails, 'error', left(p_error_code, 60)));
  if v_fails >= 3 then
    update growth.control set paused_connectors = array(select distinct x from unnest(paused_connectors || p_provider) x), updated_at = now() where id;
    -- Owner alert: shown at the top of the Connections page (nothing is emailed or messaged).
    insert into growth.audit (actor, action, detail) values (coalesce(p_worker, 'worker'), 'connector_alert',
      jsonb_build_object('provider', p_provider, 'account', p_account_ref, 'paused', true,
                         'message', 'Token refresh failed 3 times. Connector paused. Reconnect it on the Connections page.'));
    return 'paused';
  end if;
  return 'failed';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------------------------------
revoke execute on all functions in schema growth, growth_api from public;
grant execute on function growth_api.oauth_start(text), growth_api.oauth_consume(text),
  growth_api.oauth_complete(text, jsonb, text[], timestamptz, text), growth_api.oauth_fail(text, text, text),
  growth_api.connections_due(text, text),
  growth_api.record_check(text, text, text, int, int, text[], text, text, jsonb, text),
  growth_api.record_refresh(text, text, boolean, jsonb, timestamptz, text, text, text)
  to growth_worker;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema growth_api to service_role';
    execute 'revoke execute on function growth_api.record_check(text, text, text, int, int, text[], text, text, jsonb, text),
      growth_api.record_refresh(text, text, boolean, jsonb, timestamptz, text, text, text) from service_role';
    execute 'grant select on all tables in schema growth to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 8. Worker tasks and schedules (read-only, tier 0; nothing runs while growth.control.global_stop is on)
-- ---------------------------------------------------------------------------------------------------
insert into growth.agent_tasks (key, version, handler, description, risk_tier, requires_approval, max_attempts, enabled, allowed_connectors) values
  ('connector.health', 1, 'connector.health', 'One cheap read per connection; records granted scopes and the 5-state status.', 0, false, 2, true,
   array['meta_business', 'facebook_pages', 'instagram', 'tiktok_business', 'tiktok_content', 'youtube', 'google_ads', 'linkedin',
         'google_workspace', 'supabase', 'ga4_gtm', 'stripe', 'buffer']),
  ('connector.refresh', 1, 'connector.refresh', 'Refreshes OAuth tokens that expire within 24 h; 3 failures pause the connector.', 0, false, 2, true,
   array['meta_business', 'facebook_pages', 'instagram', 'tiktok_business', 'tiktok_content', 'youtube', 'google_ads', 'linkedin', 'google_workspace']);
insert into growth.schedules (task_key, every, anchor, payload, enabled) values
  ('connector.health', interval '1 day', date_trunc('day', now()) + interval '11 hours 7 minutes', '{}', true),
  ('connector.refresh', interval '1 hour', date_trunc('hour', now()) + interval '23 minutes', '{}', true);
