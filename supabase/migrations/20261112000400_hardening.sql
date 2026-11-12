-- Tighten function privileges (Supabase grants EXECUTE on new functions to anon/authenticated by default).
alter function public.set_updated_at() set search_path = public;
alter function public.quota_period_start(timestamptz) set search_path = public;
alter function public.free_monthly_exports() set search_path = public;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin(uuid) from public, anon;
revoke execute on function public.has_unlimited(uuid) from public, anon, authenticated;
revoke execute on function public.quota_status() from public, anon;
revoke execute on function public.save_estimate(jsonb) from public, anon;
grant execute on function public.quota_status() to authenticated;
grant execute on function public.save_estimate(jsonb) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
