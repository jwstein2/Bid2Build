-- Randomized activity bonus: the monthly drawing (owner spec 2026-11-21).
--
-- * One drawing per calendar month (America/Chicago), run on the first daily close of the next month.
-- * Prize grows with the number of paying Built2Bid accounts at draw time:
--   $20 from 3 accounts, $50 from 10, $100 from 100 (sales_settings.drawing_tiers, owner-editable).
--   Under 3 paying accounts there is no drawing that month.
-- * Who can win: active reps for whom the randomized_activity_bonus program is available on the last day
--   of the month (program on, no emergency stop, documented approval for the rep's work state).
-- * Entries: every eligible rep gets 1 free entry, plus 1 per lead they called or emailed per day
--   (logged call/email activities), capped at sales_settings.drawing_entry_cap (default 100).
-- * The winner is picked from a random seed; the entry list, seed and winning ticket are stored with a
--   sha256 fingerprint so the result can be re-checked. Rows are never edited or deleted.
-- * The prize is one earned 'reward' ledger line on the winner's next statement; the owner approves it
--   with the statement like any other pay. Nothing is paid automatically.
-- Purely additive: no existing row changes except two new sales_settings columns with defaults.

alter table public.sales_settings
  add column if not exists drawing_tiers jsonb not null
    default '[{"at":3,"cents":2000},{"at":10,"cents":5000},{"at":100,"cents":10000}]'::jsonb,
  add column if not exists drawing_entry_cap integer not null default 100 check (drawing_entry_cap between 0 and 1000);

create table if not exists public.sales_activity_drawings (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),
  status text not null check (status in ('drawn', 'no_draw')),
  reason text check (reason is null or reason in ('below_threshold', 'program_off', 'no_eligible_reps')),
  paying_accounts integer not null check (paying_accounts >= 0),
  prize_cents integer not null default 0 check (prize_cents >= 0),
  tiers jsonb not null,
  entry_cap integer not null,
  total_entries integer not null default 0 check (total_entries >= 0),
  entries jsonb not null default '[]'::jsonb,           -- [{rep_id, name, base, activity, entries}] in ticket order
  seed text,
  ticket integer,
  winner_rep_id uuid references public.sales_reps (id),
  commission_id uuid references public.sales_commissions (id),
  snapshot_hash text,
  drawn_at timestamptz not null default now(),
  drawn_by uuid references auth.users (id) on delete set null,
  check (status <> 'drawn' or (winner_rep_id is not null and seed is not null and ticket between 1 and total_entries and prize_cents > 0))
);
alter table public.sales_activity_drawings enable row level security;
drop trigger if exists sales_activity_drawings_append_only on public.sales_activity_drawings;
create trigger sales_activity_drawings_append_only before update or delete on public.sales_activity_drawings
  for each row execute function public.sales_append_only();

-- Paying accounts right now: one per company (or per user without a company) with an active subscription.
create or replace function public.sales_paying_accounts() returns integer
language sql stable security definer set search_path = public as $$
  select count(distinct coalesce(s.company_id::text, s.user_id::text))::int
  from public.subscriptions s where s.status = 'active' and coalesce(s.company_id::text, s.user_id::text) is not null;
$$;

-- Prize for an account count: the highest tier reached, 0 below the first tier.
create or replace function public.sales_drawing_prize(p_tiers jsonb, p_accounts integer) returns integer
language sql immutable set search_path = public as $$
  select coalesce((select (t ->> 'cents')::int from jsonb_array_elements(coalesce(p_tiers, '[]'::jsonb)) t
                   where (t ->> 'at')::int <= p_accounts order by (t ->> 'at')::int desc limit 1), 0);
$$;

-- Entries for one month: 1 free + 1 per (lead, day) called or emailed, capped. Eligible reps only.
create or replace function public.sales_drawing_entries(p_month date, p_cap integer) returns jsonb
language sql stable security definer set search_path = public as $$
  with bounds as (
    select (p_month::timestamp at time zone 'America/Chicago') as t0,
           ((p_month + interval '1 month')::timestamp at time zone 'America/Chicago') as t1,
           (p_month + interval '1 month' - interval '1 day')::date as last_day
  ), elig as (
    select r.id, r.full_name from public.sales_reps r, bounds b
    where r.status = 'active' and (public.sales_program_status('randomized_activity_bonus', r.id, b.last_day) ->> 'available')::boolean
  ), act as (
    select a.rep_id, count(distinct (a.lead_id, (a.occurred_at at time zone 'America/Chicago')::date))::int as n
    from public.sales_activities a, bounds b
    where a.kind in ('call', 'email') and a.occurred_at >= b.t0 and a.occurred_at < b.t1 and a.rep_id in (select id from elig)
    group by a.rep_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('rep_id', e.id, 'name', e.full_name, 'base', 1,
           'activity', least(coalesce(act.n, 0), greatest(p_cap, 0)), 'entries', 1 + least(coalesce(act.n, 0), greatest(p_cap, 0)))
         order by e.id), '[]'::jsonb)
  from elig e left join act on act.rep_id = e.id;
$$;

-- Run last month's drawing (idempotent: a month is drawn at most once). Called by the daily sales close.
create or replace function public.sales_activity_drawing_run(p_now timestamptz default now(), p_actor uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.sales_settings; p public.sales_incentive_programs; d public.sales_activity_drawings;
  v_month date := (date_trunc('month', p_now at time zone 'America/Chicago') - interval '1 month')::date;
  v_accounts int; v_prize int; v_entries jsonb; v_total int; v_seed text; v_ticket int; v_winner uuid; v_line uuid;
  v_reason text; v_run int := 0; e jsonb; v_hash text;
begin
  perform pg_advisory_xact_lock(hashtext('sales_activity_drawing'));
  select * into d from public.sales_activity_drawings where month = v_month;
  if found then return jsonb_build_object('month', v_month, 'status', d.status, 'already', true); end if;
  select * into s from public.sales_settings where id;
  select * into p from public.sales_incentive_programs where key = 'randomized_activity_bonus';
  v_accounts := public.sales_paying_accounts();
  v_prize := public.sales_drawing_prize(s.drawing_tiers, v_accounts);

  if not coalesce(p.enabled, false) or p.emergency_disabled_at is not null then v_reason := 'program_off';
  elsif v_prize <= 0 then v_reason := 'below_threshold';
  else
    v_entries := public.sales_drawing_entries(v_month, s.drawing_entry_cap);
    v_total := coalesce((select sum((x ->> 'entries')::int) from jsonb_array_elements(v_entries) x), 0);
    if v_total = 0 then v_reason := 'no_eligible_reps'; end if;
  end if;

  if v_reason is not null then
    insert into public.sales_activity_drawings (month, status, reason, paying_accounts, prize_cents, tiers, entry_cap, entries, drawn_at, drawn_by)
    values (v_month, 'no_draw', v_reason, v_accounts, 0, s.drawing_tiers, s.drawing_entry_cap, coalesce(v_entries, '[]'::jsonb), p_now, p_actor)
    returning * into d;
    perform public.sales_program_log('randomized_activity_bonus', 'drawing_skipped', p_actor, jsonb_build_object('month', v_month, 'reason', v_reason, 'paying_accounts', v_accounts));
    return jsonb_build_object('month', v_month, 'status', 'no_draw', 'reason', v_reason);
  end if;

  -- Random seed (gen_random_uuid is cryptographically random) -> winning ticket 1..total.
  v_seed := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_ticket := (('x' || substr(encode(sha256(convert_to(v_seed, 'UTF8')), 'hex'), 1, 12))::bit(48)::bigint % v_total)::int + 1;
  for e in select x from jsonb_array_elements(v_entries) x loop
    v_run := v_run + (e ->> 'entries')::int;
    if v_run >= v_ticket then v_winner := (e ->> 'rep_id')::uuid; exit; end if;
  end loop;

  insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, basis_detail, status, reason, earned_at)
  values (v_winner, null, 1, 'reward', public.sales_month_of(p_now), v_prize,
    jsonb_build_object('program', 'randomized_activity_bonus', 'drawing_month', v_month, 'paying_accounts', v_accounts), 'earned', 'activity drawing', p_now)
  returning id into v_line;

  v_hash := encode(sha256(convert_to(jsonb_build_object('month', v_month, 'entries', v_entries, 'seed', v_seed, 'ticket', v_ticket,
    'prize_cents', v_prize, 'winner', v_winner)::text, 'UTF8')), 'hex');
  insert into public.sales_activity_drawings (month, status, paying_accounts, prize_cents, tiers, entry_cap, total_entries, entries, seed, ticket,
    winner_rep_id, commission_id, snapshot_hash, drawn_at, drawn_by)
  values (v_month, 'drawn', v_accounts, v_prize, s.drawing_tiers, s.drawing_entry_cap, v_total, v_entries, v_seed, v_ticket,
    v_winner, v_line, v_hash, p_now, p_actor);
  perform public.sales_program_log('randomized_activity_bonus', 'drawing_drawn', p_actor,
    jsonb_build_object('month', v_month, 'prize_cents', v_prize, 'total_entries', v_total, 'winner_rep_id', v_winner, 'commission_id', v_line));
  return jsonb_build_object('month', v_month, 'status', 'drawn', 'prize_cents', v_prize, 'total_entries', v_total, 'winner_rep_id', v_winner);
end $$;

-- Re-check a stored drawing: same fingerprint from the stored inputs.
create or replace function public.sales_drawing_hash_ok(d public.sales_activity_drawings) returns boolean
language sql immutable set search_path = public as $$
  select d.status <> 'drawn' or d.snapshot_hash = encode(sha256(convert_to(jsonb_build_object('month', d.month, 'entries', d.entries, 'seed', d.seed,
    'ticket', d.ticket, 'prize_cents', d.prize_cents, 'winner', d.winner_rep_id)::text, 'UTF8')), 'hex');
$$;

-- Rep view: this month's prize, own entries so far, own past results. Never shows other reps' entries.
create or replace function public.sales_my_drawing() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps; s public.sales_settings; v_month date := date_trunc('month', now() at time zone 'America/Chicago')::date;
  v_accounts int; mine jsonb;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into s from public.sales_settings where id;
  v_accounts := public.sales_paying_accounts();
  select x into mine from jsonb_array_elements(public.sales_drawing_entries(v_month, s.drawing_entry_cap)) x where x ->> 'rep_id' = rep.id::text;
  return jsonb_build_object(
    'status', public.sales_program_status('randomized_activity_bonus', rep.id),
    'tiers', s.drawing_tiers, 'entry_cap', s.drawing_entry_cap,
    'prize_cents', public.sales_drawing_prize(s.drawing_tiers, v_accounts),
    'my_entries', coalesce((mine ->> 'entries')::int, 0), 'my_activity', coalesce((mine ->> 'activity')::int, 0),
    'history', coalesce((select jsonb_agg(jsonb_build_object('month', d.month, 'status', d.status, 'reason', d.reason, 'prize_cents', d.prize_cents,
        'total_entries', d.total_entries, 'won', d.winner_rep_id = rep.id,
        'my_entries', coalesce((select (x ->> 'entries')::int from jsonb_array_elements(d.entries) x where x ->> 'rep_id' = rep.id::text), 0)) order by d.month desc)
      from (select * from public.sales_activity_drawings order by month desc limit 12) d), '[]'::jsonb));
end $$;

-- Owner/admin view: every drawing with full entries, winners and fingerprint check.
create or replace function public.admin_sales_drawings(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.sales_settings;
begin
  perform public.sales_require_admin(p_caller);
  select * into s from public.sales_settings where id;
  return jsonb_build_object(
    'tiers', s.drawing_tiers, 'entry_cap', s.drawing_entry_cap, 'paying_accounts', public.sales_paying_accounts(),
    'prize_cents', public.sales_drawing_prize(s.drawing_tiers, public.sales_paying_accounts()),
    'current', public.sales_drawing_entries(date_trunc('month', now() at time zone 'America/Chicago')::date, s.drawing_entry_cap),
    'drawings', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('winner_name', r.full_name, 'hash_ok', public.sales_drawing_hash_ok(d),
        'commission_status', c.status) order by d.month desc)
      from public.sales_activity_drawings d left join public.sales_reps r on r.id = d.winner_rep_id left join public.sales_commissions c on c.id = d.commission_id), '[]'::jsonb));
end $$;

-- Owner: change prize tiers / entry cap (applies to drawings not yet run).
create or replace function public.admin_sales_drawing_settings_save(p_caller uuid, p_tiers jsonb, p_cap integer, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare t jsonb;
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  if coalesce(btrim(p_note), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  if jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) not between 1 and 10 or p_cap not between 0 and 1000 then raise exception 'invalid' using errcode = '22023'; end if;
  for t in select x from jsonb_array_elements(p_tiers) x loop
    if jsonb_typeof(t -> 'at') <> 'number' or jsonb_typeof(t -> 'cents') <> 'number' or (t ->> 'at')::int < 1 or (t ->> 'cents')::int not between 1 and 100000 then
      raise exception 'invalid' using errcode = '22023';
    end if;
  end loop;
  update public.sales_settings set drawing_tiers = p_tiers, drawing_entry_cap = p_cap, updated_at = now(), updated_by = p_caller where id;
  perform public.sales_program_log('randomized_activity_bonus', 'drawing_settings', p_caller, jsonb_build_object('tiers', p_tiers, 'entry_cap', p_cap, 'note', left(btrim(p_note), 500)));
  perform public.sales_audit(p_caller, 'sales.drawing_settings', 'sales_settings', 'drawing', jsonb_build_object('tiers', p_tiers, 'entry_cap', p_cap));
end $$;

update public.sales_incentive_programs
set description = 'Monthly drawing. Every eligible rep gets 1 free entry plus 1 per lead called or emailed per day (capped). Prize: $20 from 3 paying accounts, $50 from 10, $100 from 100.'
where key = 'randomized_activity_bonus';

do $$
declare f text;
begin
  foreach f in array array['public.sales_paying_accounts()', 'public.sales_drawing_prize(jsonb, integer)', 'public.sales_drawing_entries(date, integer)',
    'public.sales_activity_drawing_run(timestamptz, uuid)', 'public.sales_drawing_hash_ok(public.sales_activity_drawings)',
    'public.admin_sales_drawings(uuid)', 'public.admin_sales_drawing_settings_save(uuid, jsonb, integer, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  execute 'revoke all on function public.sales_my_drawing() from public, anon';
  execute 'grant execute on function public.sales_my_drawing() to authenticated, service_role';
end $$;
revoke all on public.sales_activity_drawings from anon, authenticated;
grant all on public.sales_activity_drawings to service_role;
