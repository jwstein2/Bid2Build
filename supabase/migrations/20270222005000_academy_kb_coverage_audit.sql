-- Academy code coverage audit (2026-11-22): a stored, repeatable 50-state + DC coverage check.
-- Additive only: one new table, two functions. Rollback: docs/academy/rollback_20270222005000.sql.
-- Requires 20270220001000 .. 20270222004000.

create table if not exists public.academy_kb_coverage_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  trigger text not null default 'manual' check (trigger in ('manual', 'scheduled')),
  summary jsonb not null default '{}',
  states jsonb not null default '[]'
);
create index if not exists academy_kb_coverage_runs_at on public.academy_kb_coverage_runs (ran_at desc);
alter table public.academy_kb_coverage_runs enable row level security;
drop policy if exists academy_kb_coverage_runs_read on public.academy_kb_coverage_runs;
create policy academy_kb_coverage_runs_read on public.academy_kb_coverage_runs for select to authenticated using (public.academy_kb_editor());
revoke all on public.academy_kb_coverage_runs from anon;
grant select on public.academy_kb_coverage_runs to authenticated;

-- Code category of a publication (matches categoryFor() in src/lib/academy/kb/answer.ts).
create or replace function public.academy_kb_category(p_family text, p_title text) returns text language sql immutable set search_path = public as $$
  select case
    when p_family = 'irc' then 'residential' when p_family = 'ibc' then 'building' when p_family = 'nec' then 'electrical'
    when p_family in ('ipc', 'upc') then 'plumbing' when p_family in ('imc', 'umc', 'ifgc', 'nfpa54') then 'mechanical'
    when p_family in ('iecc', 'ashrae_90_1') then 'energy' when p_family in ('ifc', 'nfpa1') then 'fire' when p_family = 'iebc' then 'existing'
    when p_family like 'osha%' then 'safety'
    when lower(coalesce(p_title, '')) ~ 'green|calgreen' then 'green'
    when lower(coalesce(p_title, '')) ~ 'energy' then 'energy'
    when lower(coalesce(p_title, '')) ~ 'plumbing' then 'plumbing'
    when lower(coalesce(p_title, '')) ~ 'electric' then 'electrical'
    when lower(coalesce(p_title, '')) ~ 'mechanical|fuel gas' then 'mechanical'
    when lower(coalesce(p_title, '')) ~ 'fire' then 'fire'
    when lower(coalesce(p_title, '')) ~ 'existing' then 'existing'
    when lower(coalesce(p_title, '')) ~ 'residential|dwelling' then 'residential'
    when lower(coalesce(p_title, '')) ~ 'building' then 'building'
    else 'other' end
$$;

-- Runs the audit: for every state + DC, the code categories on file (searchable text / official reference only /
-- under review), local jurisdiction records, and real searches through academy_kb_search with the same answer rule
-- the page uses. Stores one row per run. Academy editors (or the scheduled job) only. No AI, no external calls.
create or replace function public.academy_kb_run_coverage_audit(p_trigger text default 'manual') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; st record; q text; v_states jsonb := '[]'; v_cats jsonb; v_tests jsonb; r record; lead record; ans record;
  v_queries text[] := array['deck stair riser height', 'guard height', 'roof underlayment', 'fall protection 6 feet', 'trench protective system', 'lead-safe renovation'];
  v_outcome text; v_local int; v_ver int; v_pend int;
begin
  if not public.academy_kb_editor() and not public.academy_kb_is_service() and not (auth.uid() is null and session_user in ('postgres', 'supabase_admin')) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if (select count(*) from public.academy_kb_coverage_runs where ran_at > now() - interval '10 minutes') >= 3 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  for st in select j.id, j.name, j.coverage, j.notes from public.academy_kb_jurisdictions j where j.level = 'state' and j.id ~ '^[A-Z]{2}$' order by j.id loop
    select count(*) filter (where a.status = 'verified'), count(*) filter (where a.status = 'pending_review') into v_ver, v_pend
      from public.academy_kb_adoptions a where a.jurisdiction_id = st.id;
    select count(*) into v_local from public.academy_kb_jurisdictions l where l.state_code = st.id and l.level in ('municipal', 'county') and l.active;
    select coalesce(jsonb_object_agg(c.cat, c.info), '{}') into v_cats from (
      select public.academy_kb_category(s.family_slug, s.title) cat,
        jsonb_build_object(
          'status', case when bool_or(a.status = 'verified' and exists (select 1 from public.academy_kb_sections x where x.source_id = s.id and x.status = 'verified' and x.body_kind <> 'title_only')) then 'searchable'
                         when bool_or(a.status = 'verified') then 'reference' else 'pending' end,
          'codes', jsonb_agg(jsonb_build_object('name', case when s.family_slug = 'state_code' then s.title else coalesce(f.name, s.short_title) end, 'edition', s.edition,
                   'effective', a.effective_date, 'status', a.status, 'url', coalesce(a.official_url, s.official_url)) order by s.family_slug)) info
      from public.academy_kb_adoptions a join public.academy_kb_sources s on s.id = a.source_id left join public.academy_kb_families f on f.slug = s.family_slug
      where a.jurisdiction_id = st.id and a.status in ('verified', 'pending_review')
      group by 1) c;
    v_tests := '[]';
    foreach q in array v_queries loop
      create temporary table if not exists _kb_audit_r on commit drop as select * from public.academy_kb_search(null, null, null, null, null, null, null, false, 1) limit 0;
      truncate _kb_audit_r;
      insert into _kb_audit_r select * from public.academy_kb_search(q, st.id, null, null, null, null, null, false, 25);
      select * into lead from _kb_audit_r order by rank desc limit 1;
      select * into ans from _kb_audit_r x
        where x.section_status = 'verified' and x.body_kind <> 'title_only' and x.match in ('exact_section', 'section_prefix', 'terminology') and x.rank >= 3
          and x.applicability ->> 'status' in ('verified_applicable', 'jurisdiction_confirmation_needed')
          and (case when x.family_slug like 'osha%' then 'safety' when x.family_slug = 'fmcsa' then 'transport' when x.family_slug like 'epa%' then 'environment' when x.kind in ('administrative', 'scope') then 'adoption' else 'building' end)
            = (case when lead.family_slug like 'osha%' then 'safety' when lead.family_slug = 'fmcsa' then 'transport' when lead.family_slug like 'epa%' then 'environment' when lead.kind in ('administrative', 'scope') then 'adoption' else 'building' end)
        order by x.rank desc limit 1;
      v_outcome := case when lead.section_id is null then 'no_match' when ans.section_id is not null then 'answer' else 'reference' end;
      v_tests := v_tests || jsonb_build_object('q', q, 'outcome', v_outcome, 'citation', ans.citation, 'status', ans.applicability ->> 'status',
        'lead_family', lead.family_slug, 'lead_category', public.academy_kb_category(lead.family_slug, lead.source_title), 'results', (select count(*) from _kb_audit_r));
    end loop;
    v_states := v_states || jsonb_build_object('state', st.id, 'name', st.name, 'coverage', st.coverage, 'adoptions_verified', v_ver, 'adoptions_pending', v_pend,
      'local_records', v_local, 'categories', v_cats, 'searches', v_tests);
  end loop;
  insert into public.academy_kb_coverage_runs (trigger, summary, states)
  values (case when p_trigger = 'scheduled' then 'scheduled' else 'manual' end, jsonb_build_object(
    'jurisdictions', jsonb_array_length(v_states),
    'with_verified_statewide', (select count(*) from jsonb_array_elements(v_states) e where (e ->> 'adoptions_verified')::int > 0),
    'with_searchable_state_text', (select count(*) from jsonb_array_elements(v_states) e where exists (select 1 from jsonb_each(e -> 'categories') c where c.value ->> 'status' = 'searchable' and c.key not in ('safety', 'other'))),
    'reference_only', (select count(*) from jsonb_array_elements(v_states) e where (e ->> 'adoptions_verified')::int > 0 and not exists (select 1 from jsonb_each(e -> 'categories') c where c.value ->> 'status' = 'searchable' and c.key not in ('safety', 'other'))),
    'with_pending', (select count(*) from jsonb_array_elements(v_states) e where (e ->> 'adoptions_pending')::int > 0),
    'without_statewide', (select count(*) from jsonb_array_elements(v_states) e where (e ->> 'adoptions_verified')::int = 0),
    'searches', (select count(*) from jsonb_array_elements(v_states) e, jsonb_array_elements(e -> 'searches') t),
    'answered', (select count(*) from jsonb_array_elements(v_states) e, jsonb_array_elements(e -> 'searches') t where t ->> 'outcome' = 'answer'),
    'reference', (select count(*) from jsonb_array_elements(v_states) e, jsonb_array_elements(e -> 'searches') t where t ->> 'outcome' = 'reference'),
    'no_match', (select count(*) from jsonb_array_elements(v_states) e, jsonb_array_elements(e -> 'searches') t where t ->> 'outcome' = 'no_match')
  ), v_states) returning id into v_id;
  delete from public.academy_kb_coverage_runs where id in (select id from public.academy_kb_coverage_runs order by ran_at desc offset 24);
  return v_id;
end $$;
revoke all on function public.academy_kb_run_coverage_audit(text) from public, anon;
grant execute on function public.academy_kb_run_coverage_audit(text) to authenticated, service_role;

-- California CALGreen (Title 24, Part 11), verified from the BSC Codes page (also in the regenerated states seed).
select set_config('academy.kb_verifying', 'on', false);

insert into public.academy_kb_sources (id, family_slug, title, short_title, edition, edition_year, publisher, jurisdiction_id, official_url, read_url, rights, fulltext_allowed, excerpt_allowed, rights_note, pagination_note, status, check_url, last_verified_at, last_checked_at) values
  (md5('academykb:source:st:CA:state_green:2025-california-green-building-standards-code-calg')::uuid, 'state_code', '2025 California Green Building Standards Code (CALGreen, Title 24, Part 11)', '2025 California Green Building Standards Code (CALGreen, Ti…', '2026', 2026, 'State of CA', 'CA', 'https://www.dgs.ca.gov/BSC/Codes', 'https://www.dgs.ca.gov/BSC/Codes', 'government_edict', false, false, 'Official state law. Built2Bid links to the official text and cites it; it is not reproduced here.', null, 'verified', 'https://www.dgs.ca.gov/BSC/Codes', '2026-11-22T02:26:12Z'::timestamptz, '2026-11-22T02:26:12Z'::timestamptz)
on conflict do nothing;

insert into public.academy_kb_adoptions (id, jurisdiction_id, source_id, kind, replaces_family, scope_note, authority_citation, official_url, effective_date, expiration_date, local_confirmation_required, trades, status, last_verified_at, notes) values
  (md5('academykb:adoption:st:CA:state_green:-:all:2025-california-green-building-standards-code-calg')::uuid, 'CA', md5('academykb:source:st:CA:state_green:2025-california-green-building-standards-code-calg')::uuid, 'adopts', null, '2025 California Green Building Standards Code (CALGreen, Title 24, Part 11). Applies statewide. Local amendments are allowed. A state-written green building code (CALGreen). Local jurisdictions may adopt stricter tiers.', 'Cal. Code Regs., tit. 24, pt. 11; Cal. Health & Safety Code § 18901 et seq.', 'https://www.dgs.ca.gov/BSC/Codes', '2026-01-01'::date, null, true, '{}'::text[], 'verified', '2026-11-22T02:26:12Z'::timestamptz, null)
on conflict do nothing;

insert into public.academy_kb_verifications (target_type, target_id, checked_at, method, result, source_url, content_hash, evidence, notes)
select 'adoption', (md5('academykb:adoption:st:CA:state_green:-:all:2025-california-green-building-standards-code-calg')::uuid)::text, '2026-11-22T02:26:12Z'::timestamptz, 'official_text', 'verified', 'https://www.dgs.ca.gov/BSC/Codes', '0bda0f4b6a511c433f4dae3f1f7eeb4c3768d9b0284a88771f1e082bb1fe6b15', 'BSC Codes page: "Part 11 - California Green Building Standards Code also referred to as CALGreen" | BSC Codes page: "The 2025 California Building Standards Code (Cal. Code Regs., Title 24) will be published July 1, 2025, with an effective date of January 1, 2026."', 'Quote re-checked word for word on the official page by the Academy source check.'
where not exists (select 1 from public.academy_kb_verifications v where v.target_id = (md5('academykb:adoption:st:CA:state_green:-:all:2025-california-green-building-standards-code-calg')::uuid)::text);

insert into public.academy_kb_verifications (target_type, target_id, checked_at, method, result, source_url, content_hash, evidence, notes)
select 'source', (md5('academykb:source:st:CA:state_green:2025-california-green-building-standards-code-calg')::uuid)::text, '2026-11-22T02:26:12Z'::timestamptz, 'official_text', 'verified', 'https://www.dgs.ca.gov/BSC/Codes', '0bda0f4b6a511c433f4dae3f1f7eeb4c3768d9b0284a88771f1e082bb1fe6b15', 'BSC Codes page: "Part 11 - California Green Building Standards Code also referred to as CALGreen" | BSC Codes page: "The 2025 California Building Standards Code (Cal. Code Regs., Title 24) will be published July 1, 2025, with an effective date of January 1, 2026."', 'Confirmed on the official state page.'
where not exists (select 1 from public.academy_kb_verifications v where v.target_id = (md5('academykb:source:st:CA:state_green:2025-california-green-building-standards-code-calg')::uuid)::text);

select set_config('academy.kb_verifying', 'off', false);
commit;
