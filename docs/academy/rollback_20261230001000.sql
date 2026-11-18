-- Rollback for the Contractor Academy migrations 20261230001000 (schema) and 20261230002000 (content seed).
-- Removes ONLY Academy objects. Nothing outside the academy_* tables/functions is touched, except:
--   * the 'academy-media' storage bucket (post images and course covers) and its objects, and
--   * nothing else: the widened ai_generations.kind check is left in place (allowing one extra value is harmless).
-- WARNING: this permanently deletes all Academy members, posts, comments, points, progress and uploaded media.
-- Take a backup first. Run in the Supabase SQL Editor.
begin;

-- Functions (all overloads named academy_* in public).
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'academy\_%' loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

drop table if exists
  public.academy_lesson_progress, public.academy_course_resources, public.academy_lesson_resources,
  public.academy_creator_licenses, public.academy_resources, public.academy_lessons, public.academy_modules,
  public.academy_courses, public.academy_audit_log, public.academy_badges, public.academy_point_events,
  public.academy_reports, public.academy_bookmarks, public.academy_reactions, public.academy_comments,
  public.academy_posts, public.academy_categories, public.academy_members, public.academy_trades, public.academy_settings
  cascade;

delete from storage.objects where bucket_id = 'academy-media';
delete from storage.buckets where id = 'academy-media';

-- Forget the migration records if the Supabase CLI tracked them.
do $$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version in ('20261230001000', '20261230002000');
  end if;
end $$;

commit;
