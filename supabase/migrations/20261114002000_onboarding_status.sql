-- First-time onboarding (welcome video + getting started tour).
--
-- profiles.onboarding_status records whether the one-time welcome popup may open automatically:
--   null        = new account, eligible for the automatic welcome popup
--   'existing'  = account created before this feature shipped (never shown automatically)
--   'dismissed' = closed with X / Not Right Now / Skip Tour
--   'completed' = finished the tour
-- Replaying the tour from the dashboard never changes it.
--
-- Every account that exists when the column is added is marked 'existing', so established
-- customers are not shown the new-user popup. Users write only their own row through the
-- existing profiles RLS policies (profiles_own_select / profiles_own_update).
--
-- Safe to run more than once: the backfill only runs in the same transaction that adds the
-- column, so a re-run never marks newer accounts as existing.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_status'
  ) then
    alter table public.profiles add column onboarding_status text
      check (onboarding_status in ('existing', 'dismissed', 'completed'));
    alter table public.profiles add column onboarding_updated_at timestamptz;
    update public.profiles set onboarding_status = 'existing', onboarding_updated_at = now();
  end if;
end $$;
