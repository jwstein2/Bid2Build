-- Rollback for 20261125001001_fin_access_retention.sql. Deploy the previous app version first.
-- Restores the append-only guards as defined in 20261124001000 / 20261124003000 and drops the job header,
-- retention functions and the holds table. Refuses to drop the table while it holds an open hold.
begin;
do $$ begin
  if to_regclass('public.fin_retention_holds') is not null and exists (select 1 from public.fin_retention_holds where released_at is null) then
    raise exception 'open retention holds exist; keep this migration';
  end if;
end $$;
create or replace function public.fin_guard_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'record_immutable' using errcode = 'P0001';
end $$;
create or replace function public.fin_cost_codes_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'name' - 'active') is distinct from (to_jsonb(old) - 'name' - 'active') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop function if exists public.fin_prepare_account_deletion(uuid);
drop function if exists public.fin_purge_empty_book(uuid);
drop table if exists public.fin_retention_holds;
drop function if exists public.fin_book_retain_until(uuid);
drop function if exists public.fin_book_has_records(uuid);
drop function if exists public.fin_purging(text);
drop function if exists public.fin_retention_years();
drop function if exists public.fin_job_header(uuid);
commit;
