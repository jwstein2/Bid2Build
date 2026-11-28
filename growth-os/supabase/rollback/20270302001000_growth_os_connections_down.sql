-- Rollback of Growth OS Phase 5 (Connections Center). Deletes Growth OS OAuth tokens (growth_conn_*) from Vault,
-- keeps manual secrets James added (growth_<provider>_*), and restores the Phase 4 growth.connections shape.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'vault') then
    execute $q$delete from vault.secrets where name like 'growth\_conn\_%'$q$;
  end if;
end $$;
delete from growth.schedules where task_key in ('connector.health', 'connector.refresh');
delete from growth.jobs where task_key in ('connector.health', 'connector.refresh');
delete from growth.agent_tasks where key in ('connector.health', 'connector.refresh');

drop function if exists growth_api.register_connection(text, text, text, boolean, text);
drop function if exists growth_api.approve_privileged_scopes(text, text, text[], text);
drop function if exists growth_api.oauth_begin(text, text, text[], text);
drop function if exists growth_api.attach_manual_secret(text, text, text, text);
drop function if exists growth_api.revoke_connection(text, text, text, text);
drop function if exists growth_api.record_platform_submission(text, text, text, text);
drop function if exists growth_api.request_health_check(text, text);
drop function if exists growth_api.connections_overview();
drop function if exists growth_api.oauth_start(text);
drop function if exists growth_api.oauth_consume(text);
drop function if exists growth_api.oauth_complete(text, jsonb, text[], timestamptz, text);
drop function if exists growth_api.oauth_fail(text, text, text);
drop function if exists growth_api.connections_due(text, text);
drop function if exists growth_api.record_check(text, text, text, int, int, text[], text, text, jsonb, text);
drop function if exists growth_api.record_refresh(text, text, boolean, jsonb, timestamptz, text, text, text);
drop view if exists growth.connection_status_v;
drop view if exists growth.operation_status_v;
drop table if exists growth.connection_checks;
drop table if exists growth.oauth_states;
drop function if exists growth.conn_secret_name(text, text);
drop function if exists growth.vault_put(text, text, text);
drop function if exists growth.vault_exists(text);
drop function if exists growth.vault_delete(text);
drop function if exists growth.connector_scopes(text, boolean);
drop function if exists growth.unpause_connector(text, text);

delete from growth.connections;
drop trigger if exists connections_status_guard on growth.connections;
drop function if exists growth.guard_connection_status();
alter table growth.connections
  drop constraint if exists connections_simulated_never_live, drop constraint if exists connections_verified_needs_check,
  drop constraint if exists connections_account_ref_format, drop constraint if exists connections_provider_fk,
  drop constraint if exists connections_status_check,
  drop column if exists auth_kind, drop column if exists is_simulated, drop column if exists account_label,
  drop column if exists granted_scopes, drop column if exists approved_privileged_scopes, drop column if exists approved_scopes_sha256,
  drop column if exists approved_by, drop column if exists approved_at, drop column if exists connected_by, drop column if exists connected_at,
  drop column if exists last_verified_at, drop column if exists last_check_at, drop column if exists last_refresh_at,
  drop column if exists refresh_fail_count, drop column if exists last_error_code, drop column if exists last_error,
  drop column if exists created_at, drop column if exists updated_at,
  add column if not exists scopes text[] not null default '{}';
alter table growth.connections alter column status set default 'disconnected';
alter table growth.connections add constraint connections_status_check check (status in ('connected', 'needs_reauth', 'disconnected'));
drop table if exists growth.connector_operations;
drop table if exists growth.connectors;
