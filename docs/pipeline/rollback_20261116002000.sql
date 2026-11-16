-- Rollback for 20261116002000_sales_pipeline.sql. Run in the Supabase SQL Editor, then re-run
-- supabase/migrations/20261114008000_enterprise_pipeline.sql (idempotent) to restore the original
-- 3-argument set_estimate_stage, guard trigger and Command Center summary.
-- Job stages collapse back to Won; stage history, won dates and sales pay settings are kept (harmless).
begin;
select set_config('app.stage_change', 'on', true);
update public.estimates set pipeline_stage = 'won' where pipeline_stage in ('scheduled', 'in_progress', 'completed');
select set_config('app.stage_change', '', true);
alter table public.estimates drop constraint if exists estimates_pipeline_stage_check;
alter table public.estimates add constraint estimates_pipeline_stage_check
  check (pipeline_stage in ('draft', 'ready_for_review', 'approved', 'sent', 'pending', 'won', 'lost'));
drop function if exists public.set_estimate_stage(uuid, text, text, timestamptz);
commit;
