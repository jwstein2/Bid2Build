-- Rollback for 20270222005000_academy_kb_coverage_audit.sql (additive objects only).
drop function if exists public.academy_kb_run_coverage_audit(text);
drop function if exists public.academy_kb_category(text, text);
drop table if exists public.academy_kb_coverage_runs;
-- California CALGreen rows (only if you want them gone too):
-- delete from public.academy_kb_verifications where target_id in ((md5('academykb:adoption:st:CA:state_green:-:all:2025-california-green-building-standards-code-calg')::uuid)::text, (md5('academykb:source:st:CA:state_green:2025-california-green-building-standards-code-calg')::uuid)::text);
-- delete from public.academy_kb_adoptions where id = md5('academykb:adoption:st:CA:state_green:-:all:2025-california-green-building-standards-code-calg')::uuid;
-- delete from public.academy_kb_sources where id = md5('academykb:source:st:CA:state_green:2025-california-green-building-standards-code-calg')::uuid;
