-- Rollback for 20270114001000_sales_lead_regions.sql. Removes region targeting and resume progress and
-- puts the ZIP-only target functions back. A region target is lost; the saved ZIP target (if any) stays.
drop trigger if exists sales_lead_batches_target on public.sales_lead_batches;
drop function if exists public.sales_lead_batches_target();
drop function if exists public.sales_import_progress_save(text, text, integer, boolean);
drop function if exists public.admin_sales_lead_regions(uuid);
drop function if exists public.admin_sales_import_target_save_region(uuid, text, text, text, integer, boolean, boolean);
drop function if exists public.sales_lead_target_key(text, text, integer, text, text, text);
drop table if exists public.sales_lead_progress;
drop table if exists public.sales_lead_regions;
drop table if exists public.sales_lead_sources;
alter table public.sales_lead_batches drop column if exists target_mode, drop column if exists target_state, drop column if exists target_region,
  drop column if exists target_key, drop column if exists progress_cursor, drop column if exists progress_checked;
alter table public.sales_settings drop column if exists lead_target_mode, drop column if exists lead_target_state, drop column if exists lead_target_region;

-- The weekly run's target, for the agent (service role only, via the import route).
create or replace function public.sales_import_target() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('zip', lead_target_zip, 'trade', lead_target_trade, 'radius_miles', lead_target_radius_miles,
                            'count', lead_target_count, 'paused', lead_target_paused or lead_target_zip is null)
  from public.sales_settings where id
$$;

-- Owner sets the target in the Sales Hub.
create or replace function public.admin_sales_import_target_save(p_caller uuid, p_zip text, p_trade text, p_radius integer, p_count integer, p_paused boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_zip text := substring(coalesce(p_zip, '') from '^\s*([0-9]{5})\s*$');
begin
  perform public.sales_require_admin(p_caller);
  if v_zip is null then raise exception 'invalid_zip'; end if;
  insert into public.sales_settings (id) values (true) on conflict (id) do nothing;
  update public.sales_settings set lead_target_zip = v_zip, lead_target_trade = left(nullif(lower(btrim(p_trade)), ''), 40),
    lead_target_radius_miles = least(greatest(coalesce(p_radius, 50), 5), 250), lead_target_count = least(greatest(coalesce(p_count, 50), 1), 200),
    lead_target_paused = coalesce(p_paused, false), updated_at = now(), updated_by = p_caller
  where id;
  perform public.sales_audit(p_caller, 'sales.lead_target_set', 'sales_settings', null, jsonb_build_object('zip', v_zip, 'trade', p_trade, 'radius', p_radius, 'count', p_count, 'paused', p_paused));
  return public.sales_import_target();
end $$;

revoke execute on function public.sales_import_target() from public, anon, authenticated;
revoke execute on function public.admin_sales_import_target_save(uuid, text, text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.sales_import_target() to service_role;
grant execute on function public.admin_sales_import_target_save(uuid, text, text, integer, integer, boolean) to service_role;
