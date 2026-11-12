-- Business-rule functions: entitlement, atomic quota, estimate save, subscriptions, admin metrics.

-- Free plan allowance. Changing it here changes enforcement everywhere.
create or replace function public.free_monthly_exports() returns integer
language sql immutable as $$ select 3 $$;

-- ---------------------------------------------------------------------------
-- Entitlement: unlimited exports while a paid subscription is in good standing.
-- past_due keeps access during Stripe's automatic retry window; unpaid/canceled/incomplete do not.
-- ---------------------------------------------------------------------------
create or replace function public.has_unlimited(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.status in ('active', 'trialing', 'past_due')
      and (s.current_period_end is null or s.current_period_end > now())
  )
$$;

create or replace function public.is_admin(p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_roles where user_id = p_user_id and role = 'admin')
$$;

-- ---------------------------------------------------------------------------
-- Quota status for the signed-in user (safe to call from the browser).
-- ---------------------------------------------------------------------------
create or replace function public.quota_status()
returns table (period_start date, exports_used integer, export_limit integer, unlimited boolean, resets_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    public.quota_period_start(),
    coalesce((select c.exports_used from public.usage_counters c
              where c.user_id = auth.uid() and c.period_start = public.quota_period_start()), 0),
    public.free_monthly_exports(),
    public.has_unlimited(auth.uid()),
    ((public.quota_period_start() + interval '1 month')::timestamp at time zone 'utc')
$$;

-- ---------------------------------------------------------------------------
-- record_export: the ONLY way a finalized version is created.
-- Called by the server (service role) after it authenticated the user and rendered the PDF.
--  * Same content hash for the same estimate  -> returns the existing version, no credit used.
--  * Otherwise locks the user's counter row for the current UTC month, so concurrent requests
--    serialize; free users are refused once exports_used >= limit.
--  * Requires a verified email on the auth account (not a typed-in email field).
-- ---------------------------------------------------------------------------
create or replace function public.record_export(
  p_user_id uuid,
  p_estimate_id uuid,
  p_content_hash text,
  p_snapshot jsonb,
  p_proposal jsonb,
  p_total_cost numeric,
  p_subtotal numeric,
  p_tax numeric,
  p_total numeric
)
returns table (version_id uuid, version_number integer, charged boolean, exports_used integer, export_limit integer, unlimited boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_period date := public.quota_period_start();
  v_used integer;
  v_unlimited boolean;
  v_existing record;
  v_version_id uuid;
  v_version_number integer;
begin
  if p_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null) then
    raise exception 'email_not_verified' using errcode = 'P0001', hint = 'verify_email';
  end if;

  if not exists (select 1 from public.estimates e where e.id = p_estimate_id and e.user_id = p_user_id) then
    raise exception 'estimate_not_found' using errcode = 'P0002';
  end if;

  -- Serialize all exports for this user+month on the counter row.
  insert into public.usage_counters (user_id, period_start, exports_used)
    values (p_user_id, v_period, 0)
    on conflict (user_id, period_start) do nothing;
  select c.exports_used into v_used from public.usage_counters c
    where c.user_id = p_user_id and c.period_start = v_period
    for update;

  v_unlimited := public.has_unlimited(p_user_id);

  -- Idempotency: re-downloading an identical finalized version is free.
  select v.id, v.version_number into v_existing from public.estimate_versions v
    where v.estimate_id = p_estimate_id and v.content_hash = p_content_hash;
  if found then
    return query select v_existing.id, v_existing.version_number, false, v_used, public.free_monthly_exports(), v_unlimited;
    return;
  end if;

  if not v_unlimited and v_used >= public.free_monthly_exports() then
    raise exception 'quota_exceeded' using errcode = 'P0001', hint = 'upgrade';
  end if;

  select coalesce(max(v.version_number), 0) + 1 into v_version_number
    from public.estimate_versions v where v.estimate_id = p_estimate_id;

  insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total)
    values (p_estimate_id, p_user_id, v_version_number, p_content_hash, p_snapshot, p_proposal, p_total_cost, p_subtotal, p_tax, p_total)
    returning id into v_version_id;

  insert into public.usage_events (user_id, version_id, period_start, counted_against_quota)
    values (p_user_id, v_version_id, v_period, not v_unlimited);

  update public.usage_counters c set exports_used = c.exports_used + 1
    where c.user_id = p_user_id and c.period_start = v_period
    returning c.exports_used into v_used;

  update public.estimates set status = 'finalized' where id = p_estimate_id and status = 'draft';

  return query select v_version_id, v_version_number, true, v_used, public.free_monthly_exports(), v_unlimited;
end $$;

revoke all on function public.record_export(uuid, uuid, text, jsonb, jsonb, numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- save_estimate: replace the working copy of an estimate atomically.
-- SECURITY INVOKER: every statement is subject to the caller's RLS policies.
-- ---------------------------------------------------------------------------
create or replace function public.save_estimate(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := (p ->> 'id')::uuid;
  v_group_ids uuid[];
  v_item_ids uuid[];
  g jsonb;
  i jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.estimates where id = v_id and user_id <> v_uid) then
    raise exception 'estimate_not_found' using errcode = 'P0002';
  end if;

  insert into public.estimates as e (
    id, user_id, customer_id, title, trades, estimate_number, estimate_date, expiration_date, status,
    customer_name, customer_email, customer_phone, project_address, customer_notes,
    location_zip, location_city, location_state, pricing_mode, pricing_percent, fixed_adjustment, adjustment_label,
    tax_rate, display_mode, default_group_visibility, template_trade, template_version, proposal_config
  ) values (
    v_id, v_uid, nullif(p ->> 'customerId', '')::uuid, coalesce(p ->> 'title', ''),
    coalesce(array(select jsonb_array_elements_text(p -> 'trades')), '{}'),
    coalesce(p ->> 'estimateNumber', ''), coalesce((p ->> 'estimateDate')::date, current_date), nullif(p ->> 'expirationDate', '')::date,
    case when p ->> 'status' in ('draft', 'finalized', 'archived') then p ->> 'status' else 'draft' end,
    coalesce(p -> 'customer' ->> 'name', ''), p -> 'customer' ->> 'email', p -> 'customer' ->> 'phone',
    p -> 'customer' ->> 'projectAddress', p -> 'customer' ->> 'notes',
    p -> 'location' ->> 'zip', p -> 'location' ->> 'city', p -> 'location' ->> 'state',
    p -> 'pricing' ->> 'mode', coalesce(nullif(p -> 'pricing' ->> 'percent', '')::numeric, 0),
    coalesce(nullif(p ->> 'fixedAdjustment', '')::numeric, 0), p ->> 'adjustmentLabel',
    coalesce(nullif(p ->> 'taxRate', '')::numeric, 0), p ->> 'displayMode', p ->> 'defaultGroupVisibility',
    p -> 'templateRef' ->> 'trade', (p -> 'templateRef' ->> 'version')::integer, p -> 'proposalConfig'
  )
  on conflict (id) do update set
    customer_id = excluded.customer_id, title = excluded.title, trades = excluded.trades,
    estimate_number = excluded.estimate_number, estimate_date = excluded.estimate_date,
    expiration_date = excluded.expiration_date, status = excluded.status,
    customer_name = excluded.customer_name, customer_email = excluded.customer_email,
    customer_phone = excluded.customer_phone, project_address = excluded.project_address,
    customer_notes = excluded.customer_notes, location_zip = excluded.location_zip,
    location_city = excluded.location_city, location_state = excluded.location_state,
    pricing_mode = excluded.pricing_mode, pricing_percent = excluded.pricing_percent,
    fixed_adjustment = excluded.fixed_adjustment, adjustment_label = excluded.adjustment_label,
    tax_rate = excluded.tax_rate, display_mode = excluded.display_mode,
    default_group_visibility = excluded.default_group_visibility,
    proposal_config = excluded.proposal_config
  where e.user_id = v_uid;

  v_group_ids := array(select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p -> 'groups', '[]')) x);
  v_item_ids := array(select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p -> 'items', '[]')) x where not coalesce((x ->> 'isExample')::boolean, false));

  delete from public.estimate_items where estimate_id = v_id and not (id = any (v_item_ids));
  delete from public.estimate_groups where estimate_id = v_id and not (id = any (v_group_ids));

  for g in select * from jsonb_array_elements(coalesce(p -> 'groups', '[]')) loop
    insert into public.estimate_groups as eg (id, estimate_id, user_id, name, description, visibility, pricing_mode, pricing_percent, sort_order)
    values (
      (g ->> 'id')::uuid, v_id, v_uid, coalesce(g ->> 'name', ''), g ->> 'description', g ->> 'visibility',
      g -> 'pricingOverride' ->> 'mode', nullif(g -> 'pricingOverride' ->> 'percent', '')::numeric, coalesce((g ->> 'sortOrder')::integer, 0)
    )
    on conflict (id) do update set name = excluded.name, description = excluded.description, visibility = excluded.visibility,
      pricing_mode = excluded.pricing_mode, pricing_percent = excluded.pricing_percent, sort_order = excluded.sort_order
    where eg.user_id = v_uid and eg.estimate_id = v_id;
  end loop;

  for i in select * from jsonb_array_elements(coalesce(p -> 'items', '[]')) loop
    continue when coalesce((i ->> 'isExample')::boolean, false);
    insert into public.estimate_items as ei (
      id, estimate_id, group_id, user_id, name, description, category, cost_type, treatment, quantity, unit, unit_cost,
      taxable, pricing_mode, pricing_percent, show_on_proposal, notes, sort_order
    ) values (
      (i ->> 'id')::uuid, v_id, (i ->> 'groupId')::uuid, v_uid, coalesce(i ->> 'name', ''), i ->> 'description', i ->> 'category',
      coalesce(i ->> 'costType', 'material'), coalesce(i ->> 'treatment', 'marked_up'),
      coalesce(nullif(i ->> 'quantity', '')::numeric, 0), coalesce(i ->> 'unit', 'each'), coalesce(nullif(i ->> 'unitCost', '')::numeric, 0),
      coalesce((i ->> 'taxable')::boolean, true), i -> 'pricingOverride' ->> 'mode', nullif(i -> 'pricingOverride' ->> 'percent', '')::numeric,
      coalesce((i ->> 'showOnProposal')::boolean, true), i ->> 'notes', coalesce((i ->> 'sortOrder')::integer, 0)
    )
    on conflict (id) do update set group_id = excluded.group_id, name = excluded.name, description = excluded.description,
      category = excluded.category, cost_type = excluded.cost_type, treatment = excluded.treatment, quantity = excluded.quantity,
      unit = excluded.unit, unit_cost = excluded.unit_cost, taxable = excluded.taxable, pricing_mode = excluded.pricing_mode,
      pricing_percent = excluded.pricing_percent, show_on_proposal = excluded.show_on_proposal, notes = excluded.notes,
      sort_order = excluded.sort_order
    where ei.user_id = v_uid and ei.estimate_id = v_id;
  end loop;

  update public.estimates set updated_at = now() where id = v_id;
  return v_id;
end $$;

grant execute on function public.save_estimate(jsonb) to authenticated;
grant execute on function public.quota_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Subscriptions: upsert from a verified Stripe event, ignoring out-of-order (older) events.
-- ---------------------------------------------------------------------------
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
    on conflict (user_id) do nothing;

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

-- ---------------------------------------------------------------------------
-- Admin metrics: aggregate counts only, never bid contents.
-- ---------------------------------------------------------------------------
create or replace function public.admin_metrics(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_admin(p_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'verified_accounts', (select count(*) from auth.users where email_confirmed_at is not null),
    'plans', jsonb_build_object(
      'monthly', (select count(distinct user_id) from public.subscriptions where plan = 'monthly' and status in ('active', 'trialing', 'past_due')),
      'annual', (select count(distinct user_id) from public.subscriptions where plan = 'annual' and status in ('active', 'trialing', 'past_due'))
    ),
    'exports_this_month', (select count(*) from public.usage_events where period_start = public.quota_period_start()),
    'exports_by_month', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'count', c) order by m)
       from (select period_start as m, count(*) as c from public.usage_events group by 1 order by 1 desc limit 12) x), '[]'),
    'trade_popularity', coalesce((select jsonb_agg(jsonb_build_object('trade', t, 'count', c) order by c desc)
       from (select unnest(trades) as t, count(*) as c from public.estimates group by 1 order by 2 desc limit 40) x), '[]'),
    'funnel_30d', coalesce((select jsonb_object_agg(event, c)
       from (select event, count(*) as c from public.analytics_events where created_at > now() - interval '30 days' group by 1) x), '{}'),
    'import_failures_7d', (select count(*) from public.import_logs where status in ('failed', 'blocked') and created_at > now() - interval '7 days'),
    'pdf_errors_7d', (select count(*) from public.pdf_errors where created_at > now() - interval '7 days'),
    'api_usage_30d', coalesce((select jsonb_object_agg(provider, u)
       from (select provider, sum(units) as u from public.api_usage where created_at > now() - interval '30 days' group by 1) x), '{}')
  ) into result;
  return result;
end $$;
revoke all on function public.admin_metrics(uuid) from public, anon, authenticated;
