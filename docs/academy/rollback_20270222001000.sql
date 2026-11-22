-- Rollback for 20270222001000_academy_kb_local.sql and its seed: removes local authorities and restores the original
-- applicability function. The knowledge engine itself (20270220001000) is untouched.
delete from public.academy_kb_verifications where target_type = 'jurisdiction' and target_id = 'MN' and source_url = 'https://workplace.doli.state.mn.us/jurisdiction/';
delete from public.academy_kb_jurisdictions where level = 'municipal' and kind is not null;
delete from public.academy_kb_jurisdictions where level = 'county' and kind = 'county' and not exists (select 1 from public.academy_kb_jurisdictions c where c.parent_id = academy_kb_jurisdictions.id)
  and not exists (select 1 from public.academy_kb_adoptions a where a.jurisdiction_id = academy_kb_jurisdictions.id);

create or replace function public.academy_kb_applicability(p_section_id uuid, p_state text default null, p_local text default null, p_on date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  sec public.academy_kb_sections; src public.academy_kb_sources; base public.academy_kb_sources; a public.academy_kb_adoptions;
  fam text; other_edition text; replaced public.academy_kb_adoptions; state text := upper(nullif(btrim(p_state), ''));
  loc text := nullif(btrim(p_local), '');
begin
  select * into sec from public.academy_kb_sections where id = p_section_id;
  if not found then return jsonb_build_object('status', 'unavailable', 'reason', 'not_found'); end if;
  select * into src from public.academy_kb_sources where id = sec.source_id;
  if loc is not null and (state is null or split_part(loc, ':', 1) <> state) then loc := null; end if;

  if sec.status in ('archived', 'rejected', 'draft') or src.status in ('archived', 'rejected', 'draft') then
    return jsonb_build_object('status', 'unavailable', 'reason', 'not_published');
  end if;
  if src.status = 'source_unavailable' or sec.status = 'source_unavailable' then
    return jsonb_build_object('status', 'source_review_needed', 'reason', 'official_source_unreachable');
  end if;

  -- A source issued by another state never applies to this state.
  if state is not null and src.jurisdiction_id is not null and src.jurisdiction_id <> 'US' and split_part(src.jurisdiction_id, ':', 1) <> state then
    return jsonb_build_object('status', 'unavailable', 'reason', 'other_jurisdiction', 'jurisdiction_id', src.jurisdiction_id);
  end if;

  -- Amendments: applicability follows the amending source's own adoption (it is the jurisdiction's law).
  base := src;
  fam := src.family_slug;

  -- Most specific current adoption of this exact source: local, then state, then federal.
  select * into a from public.academy_kb_adoptions x
   where x.source_id = src.id and x.kind in ('adopts', 'amends', 'administers') and x.status in ('verified', 'pending_review')
     and x.jurisdiction_id in (coalesce(loc, '-'), coalesce(state, '-'), 'US')
     and (x.effective_date is null or x.effective_date <= p_on) and (x.expiration_date is null or x.expiration_date > p_on)
   order by (x.status = 'verified') desc,
            case when x.jurisdiction_id = loc then 0 when x.jurisdiction_id = state then 1 else 2 end
   limit 1;

  if not found then
    -- Future adoption on file?
    if exists (select 1 from public.academy_kb_adoptions x where x.source_id = src.id and x.status in ('verified', 'pending_review')
               and x.jurisdiction_id in (coalesce(loc, '-'), coalesce(state, '-'), 'US') and x.effective_date > p_on) then
      return jsonb_build_object('status', 'source_review_needed', 'reason', 'not_yet_effective');
    end if;
    if state is null then
      return jsonb_build_object('status', 'jurisdiction_confirmation_needed', 'reason', 'no_location');
    end if;
    -- Does this state enforce a different edition of the same family (verified)?
    select s2.edition into other_edition from public.academy_kb_adoptions x join public.academy_kb_sources s2 on s2.id = x.source_id
     where s2.family_slug = fam and s2.id <> src.id and x.jurisdiction_id = state and x.status = 'verified' and x.kind in ('adopts', 'administers')
       and (x.effective_date is null or x.effective_date <= p_on) and (x.expiration_date is null or x.expiration_date > p_on)
     order by x.effective_date desc nulls last limit 1;
    if other_edition is not null then
      return jsonb_build_object('status', case when src.status = 'superseded' then 'superseded' else 'not_adopted' end,
                                'reason', 'state_enforces_other_edition', 'other_edition', other_edition);
    end if;
    if src.status = 'superseded' then return jsonb_build_object('status', 'superseded', 'reason', 'superseded'); end if;
    return jsonb_build_object('status', 'source_review_needed', 'reason', 'adoption_not_verified');
  end if;

  -- Federal rules: a verified State Plan (or other replacement) for this family means the state's rules govern.
  if a.jurisdiction_id = 'US' and state is not null then
    select x.* into replaced from public.academy_kb_adoptions x
     where x.kind = 'replaces' and x.jurisdiction_id = state and x.replaces_family = fam and x.status in ('verified', 'pending_review')
       and (x.effective_date is null or x.effective_date <= p_on) and (x.expiration_date is null or x.expiration_date > p_on)
     limit 1;
    if found then
      return jsonb_build_object('status', 'source_review_needed', 'reason', 'state_plan', 'authority', replaced.authority_citation, 'official_url', replaced.official_url,
                                'adoption_id', a.id);
    end if;
  end if;

  if sec.status <> 'verified' or src.status not in ('verified', 'superseded') or a.status <> 'verified' then
    return jsonb_build_object('status', 'source_review_needed', 'reason', case when sec.status <> 'verified' then 'section_not_verified' when a.status <> 'verified' then 'adoption_not_verified' else 'source_not_verified' end,
                              'adoption_id', a.id, 'authority', a.authority_citation, 'effective_date', a.effective_date, 'jurisdiction_id', a.jurisdiction_id);
  end if;

  if a.jurisdiction_id = coalesce(loc, '-') or not a.local_confirmation_required then
    return jsonb_build_object('status', 'verified_applicable', 'reason', 'verified', 'adoption_id', a.id, 'authority', a.authority_citation,
                              'effective_date', a.effective_date, 'jurisdiction_id', a.jurisdiction_id, 'official_url', a.official_url);
  end if;
  return jsonb_build_object('status', 'jurisdiction_confirmation_needed',
                            'reason', case when a.jurisdiction_id = 'US' then 'state_rules_may_differ' when loc is null then 'local_not_selected' else 'local_not_verified' end,
                            'scope_note', a.scope_note,
                            'adoption_id', a.id, 'authority', a.authority_citation, 'effective_date', a.effective_date, 'jurisdiction_id', a.jurisdiction_id,
                            'official_url', a.official_url);
end $$;
grant execute on function public.academy_kb_applicability(uuid, text, text, date) to anon, authenticated, service_role;

drop function if exists public.academy_kb_load_local(text, text, timestamptz, text);
drop function if exists public.academy_kb_local_info(public.academy_kb_jurisdictions);
drop index if exists public.academy_kb_jurisdictions_parent;
alter table public.academy_kb_jurisdictions drop column if exists verified_at;
alter table public.academy_kb_jurisdictions drop column if exists source_url;
alter table public.academy_kb_jurisdictions drop column if exists detail;
alter table public.academy_kb_jurisdictions drop column if exists phone;
alter table public.academy_kb_jurisdictions drop column if exists local_status;
alter table public.academy_kb_jurisdictions drop column if exists county_name;
alter table public.academy_kb_jurisdictions drop column if exists kind;
