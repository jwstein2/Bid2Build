-- Durable rate limits (platform audit, Nov 2026).
-- The app's rateLimit() kept counts in memory, so each serverless instance had its own counter and
-- limits on sign-in, AI and email routes were weak under load. This table is shared by every instance.
-- Keys are SHA-256 hashes of "<route key>:<client ip>", so no raw IP addresses are stored.
-- Only the service role can call the function; nothing is exposed to signed-in users or anon.

create table if not exists public.rate_limits (
  key_hash text primary key,
  hits integer not null default 0,
  reset_at timestamptz not null
);

alter table public.rate_limits enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) touches this table.
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.rate_limit_hit(p_key_hash text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  if p_key_hash is null or length(p_key_hash) <> 64 or p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit arguments';
  end if;

  insert into public.rate_limits as r (key_hash, hits, reset_at)
  values (p_key_hash, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key_hash) do update
    set hits = case when r.reset_at < now() then 1 else r.hits + 1 end,
        reset_at = case when r.reset_at < now() then now() + make_interval(secs => p_window_seconds) else r.reset_at end
  returning hits into v_hits;

  -- Occasional cleanup of expired windows keeps the table small without a cron job.
  if random() < 0.01 then
    delete from public.rate_limits where reset_at < now() - interval '1 hour';
  end if;

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
