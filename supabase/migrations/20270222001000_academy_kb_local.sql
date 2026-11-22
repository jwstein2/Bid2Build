-- Academy knowledge engine: verified local permitting authorities (cities, townships, counties).
-- Additive only. Adds local fields to academy_kb_jurisdictions and teaches academy_kb_applicability() to use a verified
-- local record when the visitor picks one ("Which city or county is the project in?"):
--   enforces      -> Verified Applicable (the local authority enforces the adopted state code)
--   not_enforced  -> Jurisdiction Confirmation Needed, reason local_not_enforced (state says the code is not locally adopted)
--   no record     -> Jurisdiction Confirmation Needed, reason local_not_verified (unchanged)
-- Seed: 20270222002000_academy_kb_local_seed.sql (Minnesota DLI jurisdiction directory). Rollback: docs/academy/rollback_20270222001000.sql

alter table public.academy_kb_jurisdictions add column if not exists kind text check (kind in ('city', 'township', 'county', 'unorganized', 'other'));
alter table public.academy_kb_jurisdictions add column if not exists county_name text check (char_length(county_name) <= 80);
alter table public.academy_kb_jurisdictions add column if not exists local_status text check (local_status in ('enforces', 'not_enforced', 'unknown'));
alter table public.academy_kb_jurisdictions add column if not exists phone text check (phone ~ '^\(\d{3}\) \d{3}-\d{4}$');
alter table public.academy_kb_jurisdictions add column if not exists detail jsonb not null default '{}';
alter table public.academy_kb_jurisdictions add column if not exists source_url text check (source_url ~ '^https?://');
alter table public.academy_kb_jurisdictions add column if not exists verified_at timestamptz;
create index if not exists academy_kb_jurisdictions_parent on public.academy_kb_jurisdictions (parent_id);

-- Public facts about a local authority (no personal names are stored).
create or replace function public.academy_kb_local_info(j public.academy_kb_jurisdictions) returns jsonb language sql stable set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object('id', j.id, 'name', j.name, 'kind', j.kind, 'county', j.county_name, 'status', j.local_status,
    'phone', j.phone, 'detail', j.detail, 'source_url', j.source_url, 'verified_at', j.verified_at))
$$;
grant execute on function public.academy_kb_local_info(public.academy_kb_jurisdictions) to anon, authenticated, service_role;

create or replace function public.academy_kb_applicability(p_section_id uuid, p_state text default null, p_local text default null, p_on date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  sec public.academy_kb_sections; src public.academy_kb_sources; base public.academy_kb_sources; a public.academy_kb_adoptions;
  fam text; other_edition text; replaced public.academy_kb_adoptions; state text := upper(nullif(btrim(p_state), ''));
  loc text := nullif(btrim(p_local), ''); j public.academy_kb_jurisdictions;
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

  -- A state rule that needs local confirmation: use the verified local record when the visitor picked one.
  if loc is not null and a.jurisdiction_id = state then
    select * into j from public.academy_kb_jurisdictions where id = loc and active and verified_at is not null;
    if found and j.local_status = 'enforces' then
      return jsonb_build_object('status', 'verified_applicable', 'reason', 'local_verified', 'adoption_id', a.id, 'authority', a.authority_citation,
                                'effective_date', a.effective_date, 'jurisdiction_id', a.jurisdiction_id, 'official_url', a.official_url,
                                'local', public.academy_kb_local_info(j));
    elsif found and j.local_status = 'not_enforced' then
      return jsonb_build_object('status', 'jurisdiction_confirmation_needed', 'reason', 'local_not_enforced', 'scope_note', a.scope_note,
                                'adoption_id', a.id, 'authority', a.authority_citation, 'effective_date', a.effective_date, 'jurisdiction_id', a.jurisdiction_id,
                                'official_url', a.official_url, 'local', public.academy_kb_local_info(j));
    end if;
  end if;
  return jsonb_build_object('status', 'jurisdiction_confirmation_needed',
                            'reason', case when a.jurisdiction_id = 'US' then 'state_rules_may_differ' when loc is null then 'local_not_selected' else 'local_not_verified' end,
                            'scope_note', a.scope_note,
                            'adoption_id', a.id, 'authority', a.authority_citation, 'effective_date', a.effective_date, 'jurisdiction_id', a.jurisdiction_id,
                            'official_url', a.official_url);
end $$;
grant execute on function public.academy_kb_applicability(uuid, text, text, date) to anon, authenticated, service_role;

-- Compact loader for local authority directories (used by the generated seed; callable only by the database owner).
-- One line per authority: id-suffix|name|kind(c=city,t=township,u=unorganized)|county-slug|status(Y/N/U)|phone|electrical(s/l)|accessibility(l/c)|1306-2(1/0)|1306-3(1/0)|plumbing-inspects(1/0)
create or replace function public.academy_kb_load_local(p_state text, p_source text, p_at timestamptz, p_rows text) returns integer
language plpgsql security definer set search_path = public as $$
declare ln text; f text[]; n integer := 0; v_parent text; v_county text; v_kind text; v_name text; d jsonb;
begin
  foreach ln in array string_to_array(p_rows, E'\n') loop
    continue when btrim(ln) = '';
    f := string_to_array(ln, '|');
    v_parent := p_state || ':' || f[4] || '-county';
    select name into v_county from public.academy_kb_jurisdictions where id = v_parent;
    if v_county is null then raise exception 'unknown county %', v_parent; end if;
    v_kind := case f[3] when 'c' then 'city' when 't' then 'township' else 'unorganized' end;
    v_name := case when v_kind = 'city' then f[2] else f[2] || ', ' || v_county end;
    d := jsonb_strip_nulls(jsonb_build_object(
      'electrical', case f[7] when 's' then 'state' when 'l' then 'local' end,
      'accessibility', case f[8] when 'l' then 'local' when 'c' then 'county' end,
      'opt_1306_2', case f[9] when '1' then true when '0' then false end,
      'opt_1306_3', case f[10] when '1' then true when '0' then false end,
      'plumbing_inspects', case f[11] when '1' then true when '0' then false end));
    insert into public.academy_kb_jurisdictions (id, level, state_code, parent_id, name, coverage, kind, county_name, local_status, phone, detail, source_url, verified_at)
    values (p_state || ':' || f[1], 'municipal', p_state, v_parent, left(v_name, 120), 'verified', v_kind, v_county,
            case f[5] when 'Y' then 'enforces' when 'N' then 'not_enforced' else 'unknown' end, nullif(f[6], ''), d, p_source, p_at)
    on conflict (id) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.academy_kb_load_local(text, text, timestamptz, text) from public, anon, authenticated;
