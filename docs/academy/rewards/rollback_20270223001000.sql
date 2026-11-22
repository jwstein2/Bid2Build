-- Rollback for 20270223001000_academy_rewards.sql (Academy monthly challenge).
-- Removes only the objects that migration added. Courses, lessons, lesson progress, badges, study items and ordinary
-- study attempts are untouched. Complimentary grants already given as rewards are KEPT (customers keep what they earned);
-- challenge quiz attempts stay in academy_kb_attempts as ordinary finished quiz sessions.
-- WARNING: deletes reward records and their audit trail. Export Admin → Academy rewards first if you need them.

drop trigger if exists academy_lesson_progress_challenge on public.academy_lesson_progress;
drop trigger if exists academy_kb_attempts_challenge_guard on public.academy_kb_attempts;

drop function if exists public.admin_academy_rewards(uuid, integer);
drop function if exists public.academy_reward_mark_manual(uuid, uuid, text);
drop function if exists public.academy_reward_decline(uuid, uuid, text);
drop function if exists public.academy_reward_set_review(uuid, text, uuid);
drop function if exists public.academy_reward_finish(uuid, boolean, text, integer, text, uuid);
drop function if exists public.academy_reward_grant_comp(uuid, timestamptz, uuid);
drop function if exists public.academy_reward_begin(uuid, uuid, text);
drop function if exists public.academy_challenge_status();
drop function if exists public.academy_challenge_status_for(uuid);
drop function if exists public.academy_challenge_quiz_submit(uuid, jsonb);
drop function if exists public.academy_challenge_quiz_start(text);
drop function if exists public.academy_challenge_questions(uuid);
drop function if exists public.academy_challenge_pool(text);
drop function if exists public.academy_challenge_claim();
drop function if exists public.academy_challenge_claim_for(uuid);
drop function if exists public.academy_reward_decide(uuid, text[]);
drop function if exists public.academy_challenge_progress(uuid, date);
drop function if exists public.academy_lesson_progress_challenge();
drop function if exists public.academy_record_course_completion(uuid, uuid);
drop function if exists public.academy_reward_email_key(uuid);
drop function if exists public.academy_reward_excluded(uuid);
drop function if exists public.academy_reward_log(uuid, uuid, uuid, text, jsonb);
drop function if exists public.academy_month_start(timestamptz);
drop function if exists public.academy_challenge_rules();

drop table if exists public.academy_reward_events;
drop table if exists public.academy_rewards;
drop table if exists public.academy_course_completions;

alter table public.academy_kb_attempts drop column if exists challenge_flags;
alter table public.academy_kb_attempts drop column if exists challenge_passed;
alter table public.academy_kb_attempts drop column if exists challenge_topic;
drop table if exists public.academy_challenge_topics;

drop function if exists public.academy_kb_attempts_challenge_guard();
drop function if exists public.academy_reward_events_guard();
drop function if exists public.academy_rewards_guard();
drop function if exists public.academy_completion_milestones();
drop function if exists public.academy_completions_guard();
-- Milestone badges the challenge added (challenge:*, trainings:*) are left in academy_badges as earned history.
