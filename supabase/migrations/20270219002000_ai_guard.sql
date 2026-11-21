-- Will meeting 2026-11-21 (items B, C2, J): one server-side guard for every paid AI generation.
--
-- public.ai_generation_results keeps each person's generated AI results (Scope, Exclusions, Draft with AI,
-- Price Library drafts) so that:
--   * re-opening a closed "Draft with AI" box, switching back to an already-generated style, or asking
--     again with the same input returns the saved result with no paid call (item B + caching);
--   * a pending row is a lock, so double clicks and parallel tabs can't start two paid calls;
--   * failed or timed-out calls are marked failed and never use up a free allowance;
--   * the optional free-account allowance (one successful generation per action and style per bid,
--     off until AI_FREE_QUOTA=on) is counted from durable server records, not the browser.
--
-- Only the person's own rows are readable (RLS). Writes go only through the two service-role functions
-- below, which the API calls after its own auth checks. Only a SHA-256 hash of the input is stored, never
-- the prompt; the result is the person's own bid content and is deleted with the account (FK cascade).
-- Additive: one new table, two functions, no change to existing tables or data.
-- Rollback: drop function if exists public.ai_guard_begin(uuid, text, uuid, text, text, boolean, integer, boolean);
--           drop function if exists public.ai_guard_finish(uuid, text, text, jsonb, numeric);
--           drop table if exists public.ai_generation_results;

create table if not exists public.ai_generation_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Plain uuid (no FK): a bid that isn't saved yet can still be generated for; deleting a bid leaves
  -- nothing readable to anyone but its owner.
  estimate_id uuid,
  action text not null check (action in ('scope', 'exclusions', 'bid_draft', 'library', 'other')),
  style text not null default '' check (char_length(style) <= 40),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'ok', 'failed')),
  engine text check (engine is null or engine in ('ai', 'rules')),
  result jsonb,
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (result is null or pg_column_size(result) <= 262144)
);

create index if not exists ai_generation_results_key_idx
  on public.ai_generation_results (user_id, action, estimate_id, style, status, created_at desc);
create index if not exists ai_generation_results_month_idx
  on public.ai_generation_results (user_id, created_at desc) where status = 'ok' and engine = 'ai';

alter table public.ai_generation_results enable row level security;
drop policy if exists ai_generation_results_own_select on public.ai_generation_results;
create policy ai_generation_results_own_select on public.ai_generation_results for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.ai_generation_results from anon;
revoke insert, update, delete on public.ai_generation_results from authenticated;
grant select on public.ai_generation_results to authenticated;

/**
 * Starts one guarded generation. Returns jsonb {decision, ...}:
 *   cached      -> {id, result, engine}: the same input already succeeded; no paid call, no allowance used.
 *   busy        -> another generation for the same action/bid/style started under 90 s ago.
 *   quota       -> free account, this action+style already has a successful AI result on this bid;
 *                  {latest} carries that result so the page can show it.
 *   quota_bids  -> free account, AI already used on p_free_bids_per_month other bids this month.
 *   go          -> {id, paid}: a pending row was written; call ai_guard_finish when done.
 * p_enforce_free = false (AI_FREE_QUOTA off, the default) skips both quota checks.
 * p_fresh = true skips the saved result for paying accounts only (Regenerate).
 */
create or replace function public.ai_guard_begin(
  p_user uuid, p_action text, p_estimate uuid, p_style text, p_input_hash text,
  p_enforce_free boolean default false, p_free_bids_per_month integer default 4, p_fresh boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_style text := coalesce(p_style, '');
  v_hit record;
  v_paid boolean;
  v_used record;
  v_bids integer;
  v_id uuid;
begin
  if p_user is null or p_action is null or p_input_hash is null then raise exception 'ai_guard_invalid'; end if;
  -- One generation decision at a time per person + action + bid + style.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || '|' || p_action || '|' || coalesce(p_estimate::text, '-') || '|' || v_style, 7));

  -- Pending rows that never finished (crashed function) stop blocking after 5 minutes.
  update public.ai_generation_results set status = 'failed', finished_at = now()
   where user_id = p_user and status = 'pending' and created_at < now() - interval '5 minutes';

  v_paid := coalesce(public.has_unlimited(p_user), false) or coalesce(public.is_admin(p_user), false);

  -- Paying accounts may ask for a fresh result (Regenerate); everyone else gets the saved one back.
  if not (p_fresh and v_paid) then
    select id, result, engine into v_hit from public.ai_generation_results
     where user_id = p_user and action = p_action and estimate_id is not distinct from p_estimate and style = v_style
       and input_hash = p_input_hash and status = 'ok' and result is not null
     order by created_at desc limit 1;
    if found then return jsonb_build_object('decision', 'cached', 'id', v_hit.id, 'result', v_hit.result, 'engine', v_hit.engine); end if;
  end if;

  if exists (select 1 from public.ai_generation_results
              where user_id = p_user and action = p_action and estimate_id is not distinct from p_estimate and style = v_style
                and status = 'pending' and created_at > now() - interval '90 seconds') then
    return jsonb_build_object('decision', 'busy');
  end if;

  if p_enforce_free and not v_paid then
    select id, result, engine into v_used from public.ai_generation_results
     where user_id = p_user and action = p_action and estimate_id is not distinct from p_estimate and style = v_style
       and status = 'ok' and engine = 'ai'
     order by created_at desc limit 1;
    if found then return jsonb_build_object('decision', 'quota', 'latest', jsonb_build_object('id', v_used.id, 'result', v_used.result)); end if;

    if p_estimate is not null and not exists (
      select 1 from public.ai_generation_results
       where user_id = p_user and estimate_id = p_estimate and status = 'ok' and engine = 'ai') then
      select count(distinct estimate_id) into v_bids from public.ai_generation_results
       where user_id = p_user and status = 'ok' and engine = 'ai' and estimate_id is not null
         and created_at >= date_trunc('month', now());
      if v_bids >= greatest(coalesce(p_free_bids_per_month, 4), 0) then return jsonb_build_object('decision', 'quota_bids'); end if;
    end if;
  end if;

  insert into public.ai_generation_results (user_id, estimate_id, action, style, input_hash)
  values (p_user, p_estimate, p_action, v_style, p_input_hash) returning id into v_id;
  return jsonb_build_object('decision', 'go', 'id', v_id, 'paid', v_paid);
end $$;

/** Finishes a pending generation. Failed rows keep no result and never count toward a free allowance. */
create or replace function public.ai_guard_finish(p_id uuid, p_status text, p_engine text, p_result jsonb, p_cost numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('ok', 'failed') then raise exception 'ai_guard_invalid_status'; end if;
  update public.ai_generation_results
     set status = p_status,
         engine = case when p_status = 'ok' then p_engine else null end,
         result = case when p_status = 'ok' then p_result else null end,
         cost_usd = greatest(coalesce(p_cost, 0), 0),
         finished_at = now()
   where id = p_id and status = 'pending';
end $$;

revoke execute on function public.ai_guard_begin(uuid, text, uuid, text, text, boolean, integer, boolean) from public, anon, authenticated;
revoke execute on function public.ai_guard_finish(uuid, text, text, jsonb, numeric) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ai_guard_begin(uuid, text, uuid, text, text, boolean, integer, boolean) to service_role;
    grant execute on function public.ai_guard_finish(uuid, text, text, jsonb, numeric) to service_role;
    grant select, insert, update on public.ai_generation_results to service_role;
  end if;
end $$;
