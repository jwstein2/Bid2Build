-- STAGING ONLY. Run after 00_app_tables_standin.sql, the foundation migration and 01_synthetic_seed.sql.
-- Secrets are generated inside the database and stored only in Vault; nothing secret is typed or committed.
-- Afterwards copy growth_worker_db_password from Vault into the Edge Function secret GROWTH_DB_PASSWORD
-- (a person does this in the dashboard), and set GROWTH_ENV=staging. Then run 03_schedule_tick.sql.
update growth.control set env = 'staging';
create extension if not exists pg_net;
create extension if not exists pg_cron;
do $w$ declare pw text := encode(extensions.gen_random_bytes(24), 'hex'); begin
  execute format('alter role growth_worker login password %L', pw);
  perform vault.create_secret(pw, 'growth_worker_db_password', 'Growth OS: growth_worker DB password (copy into Edge Function secret GROWTH_DB_PASSWORD)');
  perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'growth_cron_secret', 'Growth OS: pg_cron -> growth-worker shared secret');
  -- Replace <project-ref> with the staging project's ref.
  perform vault.create_secret('https://<project-ref>.supabase.co/functions/v1/growth-worker', 'growth_worker_url', 'Growth OS: worker base URL');
end $w$;
