-- STAGING ONLY. Run after 00_app_tables_standin.sql, the foundation migration and 01_synthetic_seed.sql.
-- Replace the three :placeholders in a SQL editor session; never commit the real values.
--   :worker_password  password for the growth_worker role (also set as Edge Function secret GROWTH_DB_PASSWORD)
--   :cron_secret      random string, 32+ chars (only lives in Vault)
--   :worker_url       https://<project-ref>.supabase.co/functions/v1/growth-worker
update growth.control set env = 'staging';
alter role growth_worker login password ':worker_password';

select vault.create_secret(':cron_secret', 'growth_cron_secret', 'Growth OS: pg_cron -> growth-worker shared secret');
select vault.create_secret(':worker_url', 'growth_worker_url', 'Growth OS: growth-worker Edge Function base URL');

create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('growth-tick', '* * * * *', 'select growth.cron_tick()');

-- The system starts stopped (growth.control.global_stop = true). Resume as an operator once the function is deployed:
--   select growth_api.resume('staging wiring verified');
