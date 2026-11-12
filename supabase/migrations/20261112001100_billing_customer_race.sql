-- Fix: two Stripe webhooks for the same new customer (e.g. customer.subscription.created and invoice.paid
-- arriving together) could both try to insert billing_customers. The loser hit the UNIQUE(stripe_customer_id)
-- index, which `on conflict (user_id)` does not cover, and the event failed with 500 until Stripe retried.
-- Found in Stripe test-mode billing tests on 2026-11-12. Same function, any-conflict DO NOTHING.
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
  p_event_created timestamptz
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  insert into public.billing_customers (user_id, stripe_customer_id) values (p_user_id, p_stripe_customer_id)
    on conflict do nothing;

  insert into public.subscriptions as s (stripe_subscription_id, user_id, stripe_customer_id, status, plan, price_id,
    current_period_end, cancel_at_period_end, canceled_at, ended_at, source_event_created, updated_at)
  values (p_stripe_subscription_id, p_user_id, p_stripe_customer_id, p_status, p_plan, p_price_id,
    p_current_period_end, coalesce(p_cancel_at_period_end, false), p_canceled_at, p_ended_at, p_event_created, now())
  on conflict (stripe_subscription_id) do update set
    status = excluded.status, plan = excluded.plan, price_id = excluded.price_id,
    current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
    canceled_at = excluded.canceled_at, ended_at = excluded.ended_at,
    source_event_created = excluded.source_event_created, updated_at = now()
  where s.source_event_created <= excluded.source_event_created;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

revoke all on function public.apply_subscription_update(uuid, text, text, text, text, text, timestamptz, boolean, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_subscription_update(uuid, text, text, text, text, text, timestamptz, boolean, timestamptz, timestamptz, timestamptz) to service_role;
