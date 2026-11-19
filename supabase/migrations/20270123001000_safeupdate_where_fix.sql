-- QA audit F11: three functions ran a DELETE or UPDATE with no WHERE clause. Supabase loads the safeupdate
-- extension for every API session (authenticator: session_preload_libraries = supautils, safeupdate), which
-- refuses those statements with "DELETE requires a WHERE clause" / "UPDATE requires a WHERE clause". Effects:
--   * fin_alerts_refresh: Financials "Check again" showed "Something went wrong", and billing alerts never
--     refreshed after invoices, payments or other events (that refresh's error is swallowed by design).
--   * market_update_settings / market.refresh_segment_stats: Admin > Market Intelligence "Save thresholds"
--     and "Recompute now" silently did nothing.
-- Fix: the same statements with an explicit WHERE true. Bodies are otherwise unchanged. Safe to run more than once.

create or replace function public.fin_alerts_refresh(p_book_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_new integer; v_resolved integer;
begin
  if not public.fin_can_view_book(p_book_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('fin_alerts:' || p_book_id::text));
  create temporary table if not exists pg_temp.fin_alert_now (job_id uuid, kind text, severity text, dedupe_key text, details jsonb) on commit drop;
  delete from pg_temp.fin_alert_now where true;
  insert into pg_temp.fin_alert_now select * from public.fin_alert_candidates(p_book_id);
  update public.fin_alerts a set status = 'resolved', status_at = now(), status_reason = 'Condition cleared'
   where a.book_id = p_book_id and a.status in ('open', 'acknowledged') and not exists (select 1 from pg_temp.fin_alert_now n where n.dedupe_key = a.dedupe_key);
  get diagnostics v_resolved = row_count;
  update public.fin_alerts a set details = n.details from pg_temp.fin_alert_now n
   where a.book_id = p_book_id and a.status in ('open', 'acknowledged') and a.dedupe_key = n.dedupe_key and a.details is distinct from n.details;
  insert into public.fin_alerts (book_id, job_id, kind, severity, dedupe_key, details)
  select p_book_id, n.job_id, n.kind, n.severity, n.dedupe_key, n.details from pg_temp.fin_alert_now n
   where not exists (select 1 from public.fin_alerts a where a.book_id = p_book_id and a.dedupe_key = n.dedupe_key
                       and (a.status in ('open', 'acknowledged') or (a.status = 'overridden'
                            and not exists (select 1 from public.fin_alerts r where r.book_id = p_book_id and r.dedupe_key = n.dedupe_key
                                            and r.status = 'resolved' and r.status_at > a.status_at))));
  get diagnostics v_new = row_count;
  return jsonb_build_object('opened', v_new, 'resolved', v_resolved);
end $$;

create or replace function public.market_update_settings(p_caller uuid, p jsonb) returns void
language plpgsql security definer set search_path = market, public as $$
begin
  perform market.require_admin(p_caller);
  update market.settings set
    min_contributors = coalesce((p ->> 'min_contributors')::int, min_contributors),
    zip_min_contributors = coalesce((p ->> 'zip_min_contributors')::int, zip_min_contributors),
    precise_confidence = coalesce((p ->> 'precise_confidence')::numeric, precise_confidence),
    anomaly_z = coalesce((p ->> 'anomaly_z')::numeric, anomaly_z),
    iqr_k = coalesce((p ->> 'iqr_k')::numeric, iqr_k),
    min_peer_observations = coalesce((p ->> 'min_peer_observations')::int, min_peer_observations),
    min_peer_contributors = coalesce((p ->> 'min_peer_contributors')::int, min_peer_contributors),
    peer_window_months = coalesce((p ->> 'peer_window_months')::int, peer_window_months),
    margin_high_pct = coalesce((p ->> 'margin_high_pct')::numeric, margin_high_pct),
    retention_months = coalesce((p ->> 'retention_months')::int, retention_months),
    updated_at = now(), updated_by = p_caller
  where true;
  perform market.audit(p_caller, 'market.settings.update', 'settings', p);
end $$;

create or replace function market.refresh_segment_stats() returns integer
language plpgsql security definer set search_path = market, public as $$
declare v_rows integer;
begin
  delete from market.segment_stats where true;
  insert into market.segment_stats (dataset, period, geo_level, geo_key, trade, metric, n, contributors, p25, median, p75, mean, mad)
  with base as (
    select case when o.is_synthetic then 'synthetic' else 'real' end as ds, date_trunc('month', o.quote_date)::date as period,
      o.state, o.trade, o.contributor, m.metric, m.v
    from market.observations o
    cross join lateral (values ('project_price', o.price_subtotal), ('price_per_unit', o.price_per_unit)) as m (metric, v)
    where o.is_latest and o.excluded_reason is null and m.v is not null
  ),
  e as (
    select ds, period, 'national' as lvl, 'US' as gk, '*' as tr, metric, contributor, v from base where metric = 'project_price'
    union all select ds, period, 'national', 'US', trade, metric, contributor, v from base where trade is not null
    union all select ds, period, 'state', state, '*', metric, contributor, v from base where state is not null and metric = 'project_price'
    union all select ds, period, 'state', state, trade, metric, contributor, v from base where state is not null and trade is not null
  ),
  a as (
    select ds, period, lvl, gk, tr, metric, count(*)::int as n, count(distinct contributor)::int as c,
      percentile_cont(0.25) within group (order by v) as p25, percentile_cont(0.5) within group (order by v) as med,
      percentile_cont(0.75) within group (order by v) as p75, avg(v) as mean
    from e group by 1, 2, 3, 4, 5, 6
  ),
  md as (
    select e.ds, e.period, e.lvl, e.gk, e.tr, e.metric, percentile_cont(0.5) within group (order by abs(e.v - a.med)) as mad
    from e join a using (ds, period, lvl, gk, tr, metric) group by 1, 2, 3, 4, 5, 6
  )
  select a.ds, a.period, a.lvl, a.gk, a.tr, a.metric, a.n, a.c, a.p25, a.med, a.p75, a.mean, md.mad
  from a join md using (ds, period, lvl, gk, tr, metric);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
