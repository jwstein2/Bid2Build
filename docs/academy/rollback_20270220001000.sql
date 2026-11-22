-- Rollback for 20270220001000_academy_knowledge.sql and 20270220002000_academy_knowledge_seed.sql.
-- Removes only what those two files created. Existing Academy courses, lessons, community and settings are untouched.
-- The ai_generations kind 'academy_code_explain' is left in the allowed list (harmless; removing it would fail if rows exist).
-- Uploaded PDFs in the private 'academy-kb' bucket are not deleted here: empty the bucket in Storage first if wanted.

-- Later add-ons (20270222001000 local authorities, 20270222005000 coverage audit), if applied.
drop function if exists public.academy_kb_run_coverage_audit(text);
drop function if exists public.academy_kb_category(text, text);
drop table if exists public.academy_kb_coverage_runs;
drop function if exists public.academy_kb_load_local(text, text, timestamptz, text);
drop function if exists public.academy_kb_local_info(public.academy_kb_jurisdictions);

drop function if exists public.academy_kb_health();
drop function if exists public.academy_kb_step(text, text, boolean);
drop function if exists public.academy_kb_save(uuid, jsonb, integer, boolean);
drop function if exists public.academy_kb_start(text, uuid[], jsonb, text, integer);
drop function if exists public.academy_kb_answer(uuid, boolean);
drop function if exists public.academy_kb_report(text, text, text, text, text);
drop function if exists public.academy_kb_queue_semiannual();
drop function if exists public.academy_kb_due_checks(integer);
drop function if exists public.academy_kb_trail(text, text);
drop function if exists public.academy_kb_verify(text, text, text, text, text, text, text, integer, text, text);
drop function if exists public.academy_kb_log_search(text, text, text, boolean);
drop function if exists public.academy_kb_suggest(text);
drop function if exists public.academy_kb_search(text, text, text, text[], text, text, text, boolean, integer);
drop function if exists public.academy_kb_norm_section(text);
drop function if exists public.academy_kb_applicability(uuid, text, text, date);

drop table if exists public.academy_kb_path_progress;
drop table if exists public.academy_kb_paths;
drop table if exists public.academy_kb_item_progress;
drop table if exists public.academy_kb_attempts;
drop table if exists public.academy_kb_exams;
drop table if exists public.academy_kb_items;
drop table if exists public.academy_kb_answer_cache;
drop table if exists public.academy_kb_search_stats;
drop table if exists public.academy_kb_terms;
drop table if exists public.academy_kb_feedback;
drop table if exists public.academy_kb_review_queue;
drop table if exists public.academy_kb_documents;
drop table if exists public.academy_kb_verifications;
drop table if exists public.academy_kb_sections;
drop table if exists public.academy_kb_adoptions;
drop table if exists public.academy_kb_sources;
drop table if exists public.academy_kb_families;
drop table if exists public.academy_kb_jurisdictions;

drop function if exists public.academy_kb_after_change();
drop function if exists public.academy_kb_invalidate(uuid[], text, text, text);
drop function if exists public.academy_kb_document_guard();
drop function if exists public.academy_kb_section_rights();
drop function if exists public.academy_kb_verified_guard();
drop function if exists public.academy_kb_touch();
drop function if exists public.academy_kb_public_status(text);
drop function if exists public.academy_kb_is_service();
drop function if exists public.academy_kb_editor(uuid);
drop function if exists public.academy_kb_arr_text(text[]);
drop function if exists public.academy_kb_status_ok(text);

delete from storage.buckets where id = 'academy-kb' and not exists (select 1 from storage.objects o where o.bucket_id = 'academy-kb');

alter table public.academy_settings drop constraint if exists academy_settings_kb_ai_daily_cap_check;
alter table public.academy_settings drop column if exists kb_ai_daily_cap;
alter table public.academy_settings drop column if exists kb_ai_explain;
alter table public.academy_settings drop column if exists kb_enabled;
