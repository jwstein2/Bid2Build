-- Financials home: people choose their own quick actions (add, remove, reorder), and admins can set the
-- company default. Stored beside the card layout in fin_dashboard_prefs.quick_actions:
--   null  = no choice at this level (fall through to role / company / the trade profile's defaults);
--   array = the chosen actions in order (an empty array hides the row).
-- Keys are checked against the app's catalog in TypeScript; unknown keys are ignored when the page renders,
-- and permissions are still enforced by every form's own RPC, so a stored key never grants anything.
--
-- Safe to run more than once. Requires 20261124001000.

alter table public.fin_dashboard_prefs add column if not exists quick_actions text[];
do $$ begin
  alter table public.fin_dashboard_prefs add constraint fin_dashboard_prefs_quick_actions_len check (quick_actions is null or cardinality(quick_actions) <= 20);
exception when duplicate_object then null; end $$;

-- Same as 20261124001000, plus quickActions. A save that leaves quickActions out keeps the row's earlier
-- choice, so saving cards from an older page never wipes quick actions.
create or replace function public.fin_dashboard_save(p_book_id uuid, p_scope text, p_role text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_locks text[]; v_cards jsonb; v_user uuid; v_quick text[]; v_has_quick boolean := p ? 'quickActions';
begin
  if p_scope in ('company', 'role') then
    perform public.fin_require(p_book_id, 'manage_financial_config', false);
  elsif p_scope = 'user' then
    if not (public.fin_has_permission(p_book_id, 'view_company_financials') or public.fin_has_permission(p_book_id, 'view_project_financials')) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_user := auth.uid();
  else
    raise exception 'bad_scope' using errcode = '22023';
  end if;
  v_locks := case when p_scope = 'company' then coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'lockedCards', '[]'::jsonb))), '{}')
                  else coalesce((select locked_cards from public.fin_dashboard_prefs where book_id = p_book_id and scope = 'company'), '{}') end;
  select coalesce(jsonb_agg(case when (c ->> 'key') = any (public.fin_essential_alert_keys())
                                   or (p_scope = 'user' and (c ->> 'key') = any (v_locks))
                                 then jsonb_set(c, '{visible}', 'true'::jsonb) else c end), '[]'::jsonb)
    into v_cards from jsonb_array_elements(coalesce(p -> 'cards', '[]'::jsonb)) c;
  if v_has_quick then
    -- null clears this level's choice; an array is de-duplicated, keeping the caller's order.
    if jsonb_typeof(p -> 'quickActions') = 'array' then
      v_quick := array(select x from (select x, min(n) n from jsonb_array_elements_text(p -> 'quickActions') with ordinality t(x, n) group by x) s order by n);
    end if;
  else
    v_quick := (select quick_actions from public.fin_dashboard_prefs where book_id = p_book_id and scope = p_scope
                  and role is not distinct from (case when p_scope = 'role' then p_role end) and user_id is not distinct from v_user);
  end if;
  delete from public.fin_dashboard_prefs where book_id = p_book_id and scope = p_scope
    and role is not distinct from (case when p_scope = 'role' then p_role end) and user_id is not distinct from v_user;
  insert into public.fin_dashboard_prefs (book_id, scope, role, user_id, cards, kpis, saved_views, collapsed_sections, locked_cards, quick_actions, updated_by)
  values (p_book_id, p_scope, case when p_scope = 'role' then p_role end, v_user, v_cards,
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'kpis', '[]'::jsonb))), '{}'),
    coalesce(p -> 'savedViews', '[]'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'collapsedSections', '[]'::jsonb))), '{}'),
    case when p_scope = 'company' then v_locks else '{}' end, v_quick, auth.uid());
  if p_scope <> 'user' then perform public.fin_audit(p_book_id, 'dashboard.saved', 'book', p_book_id, jsonb_build_object('scope', p_scope, 'role', p_role)); end if;
end $$;

-- Same as 20261124001000, plus a flag the app reads to know quick-action choices can be saved.
create or replace function public.fin_dashboard_layout(p_book_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  if not (public.fin_has_permission(p_book_id, 'view_company_financials') or public.fin_has_permission(p_book_id, 'view_project_financials')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_role := (public.fin_access(p_book_id) ->> 'role');
  return jsonb_build_object('role', v_role,
    'company', (select to_jsonb(d) - 'book_id' from public.fin_dashboard_prefs d where d.book_id = p_book_id and d.scope = 'company'),
    'roleLayout', (select to_jsonb(d) - 'book_id' from public.fin_dashboard_prefs d where d.book_id = p_book_id and d.scope = 'role' and d.role = v_role),
    'user', (select to_jsonb(d) - 'book_id' from public.fin_dashboard_prefs d where d.book_id = p_book_id and d.scope = 'user' and d.user_id = auth.uid()),
    'essentialAlerts', to_jsonb(public.fin_essential_alert_keys()),
    'mode', coalesce((select u.mode from public.fin_user_preferences u where u.book_id = p_book_id and u.user_id = auth.uid()), 'contractor'),
    'quickActionsReady', true);
end $$;

revoke execute on function public.fin_dashboard_save(uuid, text, text, jsonb), public.fin_dashboard_layout(uuid) from public, anon;
grant execute on function public.fin_dashboard_save(uuid, text, text, jsonb), public.fin_dashboard_layout(uuid) to authenticated;
