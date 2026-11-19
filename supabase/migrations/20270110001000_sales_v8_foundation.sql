-- Sales Hub V8, P0 foundation. Requires 20270107001000 + 002000 (+ 20270109101000). Safe to re-run.
--
-- 1. James's V8 commission rules (2026-11-19): 30-day refund hold then the next month-end payout, no
--    clawback after payout; 90-day referral window.
-- 2. Versioned commission policy: every change to the rules is a new version, and each commission line
--    records the version it was created under, so a later change never silently rewrites past lines.
-- 3. First-month cancellation (James, 2026-11-19): a customer who cancels within the first month of
--    their first payment earns the rep nothing for the sale month, even without a refund.
-- 4. Rep invitations: a single-use, expiring invite link per rep (only a hash of the token is stored).
--    Accepting still requires signing in with the invited, verified email.

-- ---------------------------------------------------------------------------------------------------
-- 1 + 2. Policy versions
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_policy_versions (
  version integer primary key,
  policy jsonb not null,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.sales_policy_versions enable row level security;
revoke all on public.sales_policy_versions from public, anon, authenticated;
grant all on public.sales_policy_versions to service_role;

alter table public.sales_commissions add column if not exists policy_version integer;
alter table public.sales_settings add column if not exists first_month_cancel_voids boolean not null default false; -- true from V8 on (below)
alter table public.sales_attributions add column if not exists cancel_requested_at timestamptz;

-- The rules that make up a policy version (confirmation and timestamps are not part of it).
create or replace function public.sales_policy_snapshot(s public.sales_settings) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('annual_basis', s.annual_basis, 'refund_policy', s.refund_policy, 'value_scope', s.value_scope,
    'commission_years', s.commission_years, 'attribution_window_days', s.attribution_window_days, 'time_zone', s.time_zone,
    'first_month_cancel_voids', s.first_month_cancel_voids)
$$;

create or replace function public.sales_policy_current_version() returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(max(version), 0) from public.sales_policy_versions
$$;

-- Version 1 = the rules in force before V8, and every existing commission line belongs to it.
insert into public.sales_settings (id) values (true) on conflict (id) do nothing;
insert into public.sales_policy_versions (version, policy, note)
select 1, public.sales_policy_snapshot(s), 'Rules in force before V8 (from the original Sales Portal setup)' from public.sales_settings s where s.id
on conflict (version) do nothing;
update public.sales_commissions set policy_version = 1 where policy_version is null;

-- A change to any rule writes the next version.
create or replace function public.sales_settings_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.sales_policy_snapshot(new) is distinct from public.sales_policy_snapshot(old) then
    insert into public.sales_policy_versions (version, policy, created_by, note)
    values (public.sales_policy_current_version() + 1, public.sales_policy_snapshot(new), new.updated_by, nullif(current_setting('sales.policy_note', true), ''));
  end if;
  return new;
end $$;
drop trigger if exists sales_settings_version on public.sales_settings;
create trigger sales_settings_version after update on public.sales_settings for each row execute function public.sales_settings_version();

-- New commission lines are stamped with the version in force.
create or replace function public.sales_commission_stamp_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.policy_version is null then new.policy_version := nullif(public.sales_policy_current_version(), 0); end if;
  return new;
end $$;
drop trigger if exists sales_commission_stamp_version on public.sales_commissions;
create trigger sales_commission_stamp_version before insert on public.sales_commissions for each row execute function public.sales_commission_stamp_version();

-- James's V8 rules. Only applied while the settings still hold the pre-V8 values, so re-running this
-- file never undoes a later change made in the Policy tab.
alter table public.sales_settings alter column refund_policy set default 'hold_30_no_clawback';
alter table public.sales_settings alter column attribution_window_days set default 90;
alter table public.sales_settings alter column first_month_cancel_voids set default true;
do $$
begin
  if exists (select 1 from public.sales_settings where id and refund_policy = 'month_end_clawback' and attribution_window_days = 30)
     and (select count(*) from public.sales_policy_versions) = 1 then
    perform set_config('sales.policy_note', 'V8 rules (James, 2026-11-19): 30-day refund hold, next month-end payout, no clawback; 90-day referral window; no sale-month commission if the customer cancels within the first month', true);
    update public.sales_settings set refund_policy = 'hold_30_no_clawback', attribution_window_days = 90, first_month_cancel_voids = true, updated_at = now() where id;
  end if;
end $$;

-- Owner: version history for the Policy tab.
create or replace function public.admin_sales_policy_versions(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return coalesce((select jsonb_agg(jsonb_build_object('version', v.version, 'policy', v.policy, 'note', v.note, 'created_at', v.created_at,
      'lines', (select count(*) from public.sales_commissions c where c.policy_version = v.version)) order by v.version desc)
    from public.sales_policy_versions v), '[]'::jsonb);
end $$;

-- Saving the policy can carry a short note for the version history.
create or replace function public.admin_sales_settings_save(
  p_caller uuid, p_annual_basis text, p_refund_policy text, p_value_scope text, p_commission_years integer,
  p_attribution_window_days integer, p_confirm boolean, p_note text, p_first_month_cancel boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg public.sales_settings;
begin
  perform public.sales_require_admin(p_caller);
  perform set_config('sales.policy_note', left(coalesce(btrim(p_note), ''), 500), true);
  update public.sales_settings set annual_basis = p_annual_basis, refund_policy = p_refund_policy, value_scope = p_value_scope,
    commission_years = p_commission_years, attribution_window_days = p_attribution_window_days,
    first_month_cancel_voids = coalesce(p_first_month_cancel, first_month_cancel_voids),
    policy_confirmed_at = case when p_confirm then now() else policy_confirmed_at end,
    policy_confirmed_by = case when p_confirm then p_caller else policy_confirmed_by end,
    updated_at = now(), updated_by = p_caller
  where id returning * into cfg;
  perform public.sales_audit(p_caller, 'sales.policy_saved', 'sales_settings', 'policy',
    (to_jsonb(cfg) - 'updated_by' - 'policy_confirmed_by') || jsonb_build_object('version', public.sales_policy_current_version()));
  return to_jsonb(cfg) || jsonb_build_object('version', public.sales_policy_current_version());
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3. First-month cancellation
-- ---------------------------------------------------------------------------------------------------
-- Called by the Stripe webhook when a subscription is canceled or set to cancel (service role), and by
-- the trigger below when the stored status becomes canceled. Cancels the unpaid sale-month line when
-- the cancellation came within one month of the first payment. Approved or paid lines are never taken
-- back (no clawback); they are flagged for the owner instead.
create or replace function public.sales_customer_canceled(p_user uuid, p_canceled_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.sales_attributions; cfg public.sales_settings; c public.sales_commissions;
begin
  select * into a from public.sales_attributions where user_id = p_user;
  if not found then return jsonb_build_object('action', 'none'); end if;
  if a.cancel_requested_at is null then
    update public.sales_attributions set cancel_requested_at = coalesce(p_canceled_at, now()) where user_id = p_user;
  end if;
  if a.first_paid_at is null then return jsonb_build_object('action', 'none', 'reason', 'never_paid'); end if;
  select * into cfg from public.sales_settings where id;
  if not cfg.first_month_cancel_voids then return jsonb_build_object('action', 'kept_by_policy'); end if;
  if coalesce(a.cancel_requested_at, p_canceled_at, now()) > a.first_paid_at + interval '1 month' then return jsonb_build_object('action', 'none', 'reason', 'after_first_month'); end if;
  select * into c from public.sales_commissions where user_id = p_user and year_no = 1 and kind = 'commission' for update;
  if not found then return jsonb_build_object('action', 'none'); end if;
  if c.status in ('pending', 'earned') then
    update public.sales_commissions set status = 'canceled', reason = 'customer_canceled_first_month', updated_at = now() where id = c.id;
    if c.statement_id is not null then
      update public.sales_commissions set statement_id = null where id = c.id;
      perform public.sales_statement_refresh(c.statement_id);
    end if;
    return jsonb_build_object('action', 'canceled');
  elsif c.status in ('approved', 'paid') then
    update public.sales_commissions set reason = left(coalesce(reason || '; ', '') || 'customer canceled in first month after approval, review', 300), updated_at = now() where id = c.id;
    return jsonb_build_object('action', 'flagged');
  end if;
  return jsonb_build_object('action', 'none');
end $$;

create or replace function public.sales_attribution_canceled() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sub_status = 'canceled' and old.sub_status is distinct from 'canceled' then
    perform public.sales_customer_canceled(new.user_id, coalesce(new.cancel_requested_at, now()));
  end if;
  return new;
end $$;
drop trigger if exists sales_attribution_canceled on public.sales_attributions;
create trigger sales_attribution_canceled after update of sub_status on public.sales_attributions for each row execute function public.sales_attribution_canceled();

-- ---------------------------------------------------------------------------------------------------
-- 4. Rep invitations
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_rep_invites (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  opened_at timestamptz,
  accepted_at timestamptz
);
create index if not exists sales_rep_invites_rep on public.sales_rep_invites (rep_id, created_at desc);
alter table public.sales_rep_invites enable row level security;
revoke all on public.sales_rep_invites from public, anon, authenticated;
grant all on public.sales_rep_invites to service_role;

-- Owner creates a fresh invite link (the app makes the random token and sends only its SHA-256 hash).
-- Any earlier open invite for the rep stops working.
create or replace function public.admin_sales_invite_create(p_caller uuid, p_rep uuid, p_token_hash text, p_days integer default 14) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; inv public.sales_rep_invites;
begin
  perform public.sales_require_admin(p_caller);
  select * into rep from public.sales_reps where id = p_rep;
  if not found or rep.status = 'removed' then raise exception 'rep_not_found'; end if;
  if rep.user_id is not null then raise exception 'already_joined'; end if;
  update public.sales_rep_invites set revoked_at = now() where rep_id = p_rep and revoked_at is null and accepted_at is null;
  insert into public.sales_rep_invites (rep_id, token_hash, expires_at, created_by)
  values (p_rep, lower(p_token_hash), now() + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 30)), p_caller)
  returning * into inv;
  perform public.sales_audit(p_caller, 'sales.invite_created', 'sales_rep', p_rep::text, jsonb_build_object('expires_at', inv.expires_at));
  return jsonb_build_object('id', inv.id, 'expires_at', inv.expires_at, 'email', rep.email, 'full_name', rep.full_name);
end $$;

-- The invite landing page (service role): what the invite is for, without revealing the full email.
create or replace function public.sales_invite_lookup(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv public.sales_rep_invites; rep public.sales_reps;
begin
  select * into inv from public.sales_rep_invites where token_hash = lower(p_token_hash);
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into rep from public.sales_reps where id = inv.rep_id;
  if inv.opened_at is null then update public.sales_rep_invites set opened_at = now() where id = inv.id; end if;
  return jsonb_build_object(
    'status', case when rep.user_id is not null or inv.accepted_at is not null then 'accepted'
                   when inv.revoked_at is not null or rep.status in ('removed', 'suspended') then 'revoked'
                   when inv.expires_at < now() then 'expired' else 'valid' end,
    'full_name', rep.full_name,
    'email', rep.email,
    'email_hint', regexp_replace(rep.email, '^(.)[^@]*(@.*)$', '\1•••\2'),
    'expires_at', inv.expires_at);
end $$;

-- When a rep's account is linked (first sign-in with the invited email), their invite is accepted.
create or replace function public.sales_reps_invite_accepted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and old.user_id is null then
    update public.sales_rep_invites set accepted_at = now() where rep_id = new.id and accepted_at is null and revoked_at is null;
  end if;
  return new;
end $$;
drop trigger if exists sales_reps_invite_accepted on public.sales_reps;
create trigger sales_reps_invite_accepted after update of user_id on public.sales_reps for each row execute function public.sales_reps_invite_accepted();

-- Owner: invite status per rep for the Team tab.
create or replace function public.admin_sales_invites(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return coalesce((select jsonb_object_agg(i.rep_id, jsonb_build_object('created_at', i.created_at, 'expires_at', i.expires_at, 'opened_at', i.opened_at,
      'accepted_at', i.accepted_at, 'revoked_at', i.revoked_at))
    from (select distinct on (rep_id) * from public.sales_rep_invites order by rep_id, created_at desc) i), '{}'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_policy_snapshot(public.sales_settings)', 'public.sales_policy_current_version()', 'public.sales_settings_version()',
    'public.sales_commission_stamp_version()', 'public.admin_sales_policy_versions(uuid)',
    'public.admin_sales_settings_save(uuid, text, text, text, integer, integer, boolean, text, boolean)',
    'public.admin_sales_invite_create(uuid, uuid, text, integer)', 'public.sales_invite_lookup(text)',
    'public.sales_reps_invite_accepted()', 'public.admin_sales_invites(uuid)',
    'public.sales_customer_canceled(uuid, timestamptz)', 'public.sales_attribution_canceled()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
