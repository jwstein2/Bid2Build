-- Rollback for 20261129002000_fin_quick_actions.sql. Deploy the previous app version first.
-- Restores the 20261124001000 dashboard functions and drops the quick-action choices (cards and numbers stay).
begin;
create or replace function public.fin_dashboard_save(p_book_id uuid, p_scope text, p_role text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_locks text[]; v_cards jsonb; v_user uuid;
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
  delete from public.fin_dashboard_prefs where book_id = p_book_id and scope = p_scope
    and role is not distinct from (case when p_scope = 'role' then p_role end) and user_id is not distinct from v_user;
  insert into public.fin_dashboard_prefs (book_id, scope, role, user_id, cards, kpis, saved_views, collapsed_sections, locked_cards, updated_by)
  values (p_book_id, p_scope, case when p_scope = 'role' then p_role end, v_user, v_cards,
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'kpis', '[]'::jsonb))), '{}'),
    coalesce(p -> 'savedViews', '[]'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'collapsedSections', '[]'::jsonb))), '{}'),
    case when p_scope = 'company' then v_locks else '{}' end, auth.uid());
  if p_scope <> 'user' then perform public.fin_audit(p_book_id, 'dashboard.saved', 'book', p_book_id, jsonb_build_object('scope', p_scope, 'role', p_role)); end if;
end $$;

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
    'mode', coalesce((select u.mode from public.fin_user_preferences u where u.book_id = p_book_id and u.user_id = auth.uid()), 'contractor'));
end $$;
alter table public.fin_dashboard_prefs drop constraint if exists fin_dashboard_prefs_quick_actions_len;
alter table public.fin_dashboard_prefs drop column if exists quick_actions;
commit;
