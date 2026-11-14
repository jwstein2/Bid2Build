-- Enterprise Phase 2: Stripe sync for company subscriptions.
-- Same function name and the same 11 named arguments as before, plus two optional ones, so the code
-- deployed before this migration keeps working unchanged. Requires 20261114005000_enterprise_workspace.sql.
drop function if exists public.apply_subscription_update(uuid, text, text, text, text, text, timestamptz, boolean, timestamptz, timestamptz, timestamptz);

create or replace function public.apply_subscription_update(
  p_user_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_status text,
  p_plan text,
  p_price_id text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_canceled_at timestamptz,
  p_ended_at timestamptz,
  p_event_created timestamptz,
  p_company_id uuid default null,
  p_seat_quantity integer default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  if p_plan = 'enterprise' and p_company_id is null then
    raise exception 'enterprise_subscription_without_company' using errcode = '22023';
  end if;
  insert into public.billing_customers (user_id, stripe_customer_id) values (p_user_id, p_stripe_customer_id)
    on conflict do nothing;

  insert into public.subscriptions as s (stripe_subscription_id, user_id, stripe_customer_id, status, plan, price_id,
    current_period_end, cancel_at_period_end, canceled_at, ended_at, source_event_created, updated_at, company_id, seat_quantity)
  values (p_stripe_subscription_id, p_user_id, p_stripe_customer_id, p_status, p_plan, p_price_id,
    p_current_period_end, coalesce(p_cancel_at_period_end, false), p_canceled_at, p_ended_at, p_event_created, now(),
    p_company_id, case when p_plan = 'enterprise' then greatest(coalesce(p_seat_quantity, 3), 3) end)
  on conflict (stripe_subscription_id) do update set
    status = excluded.status, plan = excluded.plan, price_id = excluded.price_id,
    current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
    canceled_at = excluded.canceled_at, ended_at = excluded.ended_at,
    source_event_created = excluded.source_event_created, updated_at = now(),
    company_id = coalesce(excluded.company_id, s.company_id), seat_quantity = excluded.seat_quantity
  where s.source_event_created <= excluded.source_event_created;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

revoke all on function public.apply_subscription_update(uuid, text, text, text, text, text, timestamptz, boolean, timestamptz, timestamptz, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.apply_subscription_update(uuid, text, text, text, text, text, timestamptz, boolean, timestamptz, timestamptz, timestamptz, uuid, integer) to service_role;

-- Billing summary for the Billing & Licenses page (people with manage_billing only).
create or replace function public.company_billing_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.my_company_id(); v_sub public.subscriptions; e record;
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_billing') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_sub from public.subscriptions where company_id = v_company and plan = 'enterprise'
    order by (status in ('active', 'trialing', 'past_due')) desc, updated_at desc limit 1;
  select * into e from public.company_entitlement(v_company);
  return jsonb_build_object(
    'status', v_sub.status, 'seatQuantity', v_sub.seat_quantity, 'currentPeriodEnd', v_sub.current_period_end,
    'cancelAtPeriodEnd', v_sub.cancel_at_period_end, 'pastDue', v_sub.status = 'past_due',
    'entitlement', jsonb_build_object('active', e.active, 'source', e.source, 'seatLimit', e.seat_limit, 'expiresAt', e.expires_at),
    'seatsUsed', public.company_seats_used(v_company),
    'activeMembers', (select count(*) from public.company_members where company_id = v_company and status = 'active')
  );
end $$;
revoke execute on function public.company_billing_summary() from public, anon;
grant execute on function public.company_billing_summary() to authenticated;
