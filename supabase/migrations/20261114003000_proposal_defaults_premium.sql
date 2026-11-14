-- Proposal Templates (saved proposal defaults) are an Unlimited feature, enforced in the database.
--
-- business_profiles.default_proposal_config holds a contractor's saved proposal defaults. The app
-- only saves it for Unlimited accounts, but the row is otherwise owner-writable (company profile),
-- so a direct API call could set it. This trigger keeps the stored value unchanged when an account
-- without access tries to set or change it. Everything else on the row saves normally.
--
-- Nothing is deleted: when a subscription lapses the saved defaults stay stored and are used again
-- once Unlimited is reactivated. Server-side code (service role, no auth.uid()) is not affected.
-- Uses public.library_access() from 20261114001000_saved_items_library.sql (Unlimited or admin).
--
-- Safe to run more than once.

create or replace function public.guard_proposal_defaults() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or public.library_access() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.default_proposal_config := null;
  elsif new.default_proposal_config is distinct from old.default_proposal_config then
    new.default_proposal_config := old.default_proposal_config;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_proposal_defaults() from public, anon, authenticated;

drop trigger if exists business_profiles_guard_proposal_defaults on public.business_profiles;
create trigger business_profiles_guard_proposal_defaults
  before insert or update on public.business_profiles
  for each row execute function public.guard_proposal_defaults();
