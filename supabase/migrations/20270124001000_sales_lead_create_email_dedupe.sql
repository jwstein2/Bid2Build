-- QA audit F12: a rep's "Add lead" did not check the owner email for duplicates.
-- V8.6 added e:<email> identity keys (sales_lead_keys_v2, kept current by a trigger), but
-- sales_crm_lead_create still built its duplicate-check keys with the older sales_lead_keys, which has no
-- email. A second rep could add the same business under the same owner email and both would work it.
-- Same function as 20270107002000_sales_crm.sql with only the key line changed. Safe to run twice.
create or replace function public.sales_crm_lead_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); v_keys text[]; d jsonb; l public.sales_leads;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  v_keys := public.sales_lead_keys_v2(p->>'company_name', p->>'website', p->>'phone', p->>'zip', p->>'email');
  d := public.sales_lead_duplicates(v_keys);
  if jsonb_array_length(d) > 0 and coalesce((p->>'allow_duplicate')::boolean, false) is false then
    return jsonb_build_object('ok', false, 'error', 'duplicate', 'duplicates', d);
  end if;
  if jsonb_array_length(d) > 0 then
    -- Allowed only when every match is a lead nobody is working (e.g. a different branch office).
    if exists (select 1 from jsonb_array_elements(d) x where x->>'rep_name' is not null) then
      return jsonb_build_object('ok', false, 'error', 'owned_by_other', 'duplicates', d);
    end if;
  end if;
  insert into public.sales_leads (company_name, contact_name, email, phone, website, city, state, zip, trades, source, source_ref, assigned_rep, notes, dedupe_keys, created_by, next_action_at)
  values (btrim(p->>'company_name'), nullif(btrim(p->>'contact_name'), ''), nullif(lower(btrim(p->>'email')), ''), nullif(btrim(p->>'phone'), ''),
          nullif(btrim(p->>'website'), ''), nullif(btrim(p->>'city'), ''), nullif(btrim(p->>'state'), ''), nullif(btrim(p->>'zip'), ''),
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'trades', '[]'::jsonb)) x), '{}'),
          case when p->>'source' in ('manual', 'import', 'places') then p->>'source' else 'manual' end, nullif(p->>'source_ref', ''),
          rep.id, nullif(btrim(p->>'notes'), ''), v_keys, auth.uid(), now())
  returning * into l;
  insert into public.sales_activities (lead_id, rep_id, actor_id, kind, body) values (l.id, rep.id, auth.uid(), 'system', 'Lead added');
  return jsonb_build_object('ok', true, 'lead', public.sales_lead_json(l));
end $$;
