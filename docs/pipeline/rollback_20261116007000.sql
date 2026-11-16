-- Rollback for 20261116007000_report_generations.sql (V4 Phase 10). Removes the report generation log only;
-- no estimate, report or billing data is touched.
drop table if exists public.report_generations;
