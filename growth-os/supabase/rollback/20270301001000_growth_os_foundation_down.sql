-- Rollback for growth-os/supabase/migrations/20270301001000_growth_os_foundation.sql.
-- Removes every Growth OS object. Touches nothing in public: CRM writes Growth OS made stay (revert them
-- first with growth_api.revert_change if needed). Unschedule the tick before running this.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobname) from cron.job where jobname = 'growth-tick';
  end if;
end $$;
drop schema if exists growth_api cascade;
drop schema if exists growth_read cascade;
drop schema if exists growth cascade;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'growth_worker') then
    execute 'drop owned by growth_worker';
    execute 'drop role growth_worker';
  end if;
end $$;
