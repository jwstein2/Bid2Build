-- Rollback for 20270303001000_academy_advanced.sql (Academy Advanced). Run in the Supabase SQL Editor only if
-- Advanced Learning must be backed out. It restores the exact previous definitions of the four shared objects the
-- migration changed (user_entitlement, the lesson read policy, academy_course_outline, academy_complete_lesson),
-- hides the advanced lessons, and restores the original lesson access check.
--
-- It does NOT drop the academy_adv_* tables: memberships, payments and founding-member records are kept for
-- accounting. Cancel any Academy subscriptions in Stripe first (Stripe is the source of truth for billing).
-- Before running, turn ACADEMY_ADVANCED_ENABLED and ACADEMY_ADVANCED_BILLING_ENABLED off in Netlify.
begin;

-- 1. Advanced lessons go back to hidden drafts so the old access check can be restored.
update public.academy_lessons set status = 'draft', access = 'premium' where access = 'advanced';
alter table public.academy_lessons drop constraint if exists academy_lessons_access_check;
alter table public.academy_lessons add constraint academy_lessons_access_check check (access in ('public', 'members', 'premium'));
update public.academy_courses set status = 'draft' where adv_subject is not null and status = 'published';

-- 2. user_entitlement() as defined in 20261114005000_enterprise_workspace.sql (no All Access branch).
create or replace function public.user_entitlement(p_user_id uuid)
returns table (tier text, source text, company_id uuid, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid; v_ent record; v_sub_end timestamptz; v_has_sub boolean;
  v_comp_plan text; v_comp_end timestamptz;
begin
  if p_user_id is null then return query select 'free'::text, null::text, null::uuid, null::timestamptz; return; end if;

  -- Enterprise: an active licensed member of a company whose Enterprise entitlement is active.
  select m.company_id into v_company from public.company_members m where m.user_id = p_user_id and m.status = 'active';
  if v_company is not null then
    select * into v_ent from public.company_entitlement(v_company);
    if v_ent.active then
      return query select 'enterprise'::text, 'company_seat'::text, v_company, v_ent.expires_at; return;
    end if;
  end if;

  -- Individual Unlimited subscription (same rule as before: past_due keeps access during Stripe retries).
  select count(*) > 0, max(s.current_period_end) into v_has_sub, v_sub_end from public.subscriptions s
  where s.user_id = p_user_id and coalesce(s.plan, '') <> 'enterprise'
    and s.status in ('active', 'trialing', 'past_due')
    and (s.current_period_end is null or s.current_period_end > now());
  if v_has_sub then
    return query select 'unlimited'::text, 'subscription'::text, null::uuid, v_sub_end; return;
  end if;

  -- Complimentary grant held by the person (an Enterprise grant without a company yet acts as Unlimited).
  if to_regclass('public.complimentary_grants') is not null then
    execute $q$
      select g.plan, g.expires_at from public.complimentary_grants g
      where g.user_id = $1 and g.status = 'active' and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now())
      order by g.expires_at desc nulls first limit 1
    $q$ into v_comp_plan, v_comp_end using p_user_id;
    if v_comp_plan is not null then
      return query select 'unlimited'::text, 'complimentary'::text, null::uuid, v_comp_end; return;
    end if;
  end if;

  return query select 'free'::text, null::text, null::uuid, null::timestamptz;
end $$;
revoke execute on function public.user_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.user_entitlement(uuid) to service_role;

-- 3. Lesson read policy and the two lesson functions as defined in 20261230001000_contractor_academy.sql.
drop policy if exists academy_lessons_read on public.academy_lessons;
create policy academy_lessons_read on public.academy_lessons for select to anon, authenticated
  using (
    public.academy_has_role(array['admin', 'instructor'])
    or (status = 'published'
        and exists (select 1 from public.academy_courses c where c.id = course_id and c.status = 'published' and public.academy_lesson_readable(c.access))
        and public.academy_lesson_readable(access))
  );

create or replace function public.academy_course_outline(p_course_id uuid) returns table (
  id uuid, slug text, title text, summary text, module_id uuid, module_title text, access text, locked boolean,
  estimated_minutes integer, sort_order integer, completed boolean
)
language sql stable security definer set search_path = public as $$
  select l.id, l.slug, l.title, l.summary, l.module_id, mo.title, l.access, not public.academy_lesson_readable(l.access),
         l.estimated_minutes, l.sort_order,
         exists (select 1 from public.academy_lesson_progress pr where pr.user_id = auth.uid() and pr.lesson_id = l.id)
  from public.academy_lessons l
  join public.academy_courses c on c.id = l.course_id
  left join public.academy_modules mo on mo.id = l.module_id
  where l.course_id = p_course_id and (
    (l.status = 'published' and c.status = 'published') or public.academy_has_role(array['admin', 'instructor']))
  order by coalesce(mo.sort_order, 0), l.sort_order, l.title
$$;
grant execute on function public.academy_course_outline(uuid) to anon, authenticated;

create or replace function public.academy_complete_lesson(p_lesson_id uuid, p_done boolean default true, p_quiz_score integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); l public.academy_lessons; c public.academy_courses; v_total integer; v_done integer; v_complete boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.academy_is_member(v_uid) then raise exception 'not_member' using errcode = '42501'; end if;
  select * into l from public.academy_lessons where id = p_lesson_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.academy_courses where id = l.course_id;
  if l.status <> 'published' or c.status <> 'published' or not public.academy_lesson_readable(l.access, v_uid) or not public.academy_lesson_readable(c.access, v_uid) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_done then
    insert into public.academy_lesson_progress (user_id, lesson_id, course_id, quiz_score)
    values (v_uid, l.id, l.course_id, case when p_quiz_score between 0 and 100 then p_quiz_score end)
    on conflict (user_id, lesson_id) do update set quiz_score = coalesce(excluded.quiz_score, academy_lesson_progress.quiz_score);
  else
    delete from public.academy_lesson_progress where user_id = v_uid and lesson_id = l.id;
  end if;
  select count(*) into v_total from public.academy_lessons where course_id = c.id and status = 'published';
  select count(*) into v_done from public.academy_lesson_progress pr join public.academy_lessons x on x.id = pr.lesson_id and x.status = 'published' where pr.user_id = v_uid and pr.course_id = c.id;
  if v_total > 0 and v_done >= v_total then
    v_complete := true;
    insert into public.academy_badges (user_id, badge, label) values (v_uid, 'course:' || c.slug, 'Completed ' || left(c.title, 100)) on conflict do nothing;
    perform public.academy_award(v_uid, null, 'course_completed', (select points_course from public.academy_settings where id), 'course', c.id);
  end if;
  return jsonb_build_object('completed_lessons', v_done, 'total_lessons', v_total, 'course_complete', v_complete);
end $$;

commit;
