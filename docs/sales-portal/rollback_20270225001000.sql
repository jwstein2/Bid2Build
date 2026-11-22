-- Rollback for 20270225001000_sales_amendments_existing_reps_only.sql: restores the 20270209001000 versions
-- (every active rep is asked to accept every active amendment, whenever they joined).

-- Rep: amendments still to accept (active ones), plus the ones already accepted.
create or replace function public.sales_my_amendments() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'version', m.version, 'title', m.title, 'body', m.body,
      'legal_status', m.legal_status, 'accepted_at', a.accepted_at) order by m.created_at)
    from public.sales_agreement_amendments m left join public.sales_amendment_acceptances a on a.amendment_id = m.id and a.rep_id = rep.id
    where m.active or a.id is not null), '[]'::jsonb);
end $$;

create or replace function public.sales_my_amendment_accept(p_id uuid, p_body_sha256 text, p_typed_name text, p_ip text default null, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; m public.sales_agreement_amendments;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into m from public.sales_agreement_amendments where id = p_id and active;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if encode(sha256(convert_to(m.body, 'UTF8')), 'hex') <> p_body_sha256 then raise exception 'agreement_changed' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_typed_name, ''))) < 2 then raise exception 'name_required' using errcode = '22023'; end if;
  insert into public.sales_amendment_acceptances (rep_id, amendment_id, body_sha256, typed_name, ip, user_agent)
  values (rep.id, m.id, p_body_sha256, btrim(p_typed_name), left(p_ip, 64), left(p_user_agent, 300)) on conflict (rep_id, amendment_id) do nothing;
  if found then perform public.sales_audit(auth.uid(), 'sales.amendment_accepted', 'sales_amendment', m.id::text, jsonb_build_object('code', m.code, 'version', m.version, 'rep', rep.id)); end if;
  return jsonb_build_object('accepted', true);
end $$;

-- Owner: who has accepted each amendment.
create or replace function public.admin_sales_amendments(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'version', m.version, 'title', m.title, 'legal_status', m.legal_status, 'active', m.active,
      'accepted', coalesce((select jsonb_agg(jsonb_build_object('rep', r.full_name, 'email', r.email, 'typed_name', a.typed_name, 'accepted_at', a.accepted_at) order by a.accepted_at)
        from public.sales_amendment_acceptances a join public.sales_reps r on r.id = a.rep_id where a.amendment_id = m.id), '[]'::jsonb),
      'pending', coalesce((select jsonb_agg(jsonb_build_object('rep', r.full_name, 'email', r.email) order by r.full_name)
        from public.sales_reps r where r.status = 'active' and coalesce(r.sells, true)
          and not exists (select 1 from public.sales_amendment_acceptances a where a.amendment_id = m.id and a.rep_id = r.id)), '[]'::jsonb))
    order by m.created_at desc) from public.sales_agreement_amendments m), '[]'::jsonb);
end $$;
