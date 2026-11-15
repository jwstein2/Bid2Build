-- Security advisor tidy-up (2026-11-15). Changes permissions and settings only: no tables, rows or
-- function bodies change, so nothing a user does in the app behaves differently.
--
-- 1. Pin search_path on the four permission helper functions (advisor: "Function Search Path
--    Mutable"). They are immutable SQL that already name public.* explicitly; pinning it stops a
--    caller's search_path from ever changing what they resolve.
-- 2. Stop the two enterprise trigger functions from being callable over the API (advisor: "Public
--    Can Execute SECURITY DEFINER Function"). Triggers fire no matter who holds EXECUTE, so the
--    triggers keep working exactly as before; only direct /rest/v1/rpc calls (which Postgres already
--    rejects for trigger functions) lose access. Same pattern as guard_proposal_defaults.
--
-- Safe to run more than once.

alter function public.company_permission_keys() set search_path = public, pg_temp;
alter function public.company_owner_only_permissions() set search_path = public, pg_temp;
alter function public.company_role_permissions(text) set search_path = public, pg_temp;
alter function public.member_permissions(text, text[], text[]) set search_path = public, pg_temp;

revoke execute on function public.preserve_company_records() from public, anon, authenticated;
revoke execute on function public.stamp_company_owner() from public, anon, authenticated;

-- Left as is on purpose: peek_company_invitation stays callable signed out (the invite landing page
-- needs it), and the other SECURITY DEFINER RPCs are the app's signed-in API and check the caller
-- themselves.
