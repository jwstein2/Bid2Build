-- Rollback for 20270227001000_worker_profile_review_notices.sql (worker profile + clock-in review notices).
-- Leaves time corrections, HR files and every other notice untouched. Contact details workers saved stay saved.
drop trigger if exists pm_time_corrections_notify on public.pm_time_corrections;
drop function if exists public.pm_time_correction_notify();
drop function if exists public.notification_dismiss(uuid);
drop function if exists public.pm_worker_profile_save(uuid, jsonb);
drop function if exists public.pm_worker_my_profile();
delete from public.user_notifications where kind in ('time_correction', 'time_correction_decided');
alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check
  check (kind in ('task_review', 'customer_update', 'customer_reply'));
