-- Rollback for 20261231001000_comm_rollout.sql. Deploy the previous app version first.
-- Accounts that were turned off become "on" again (nothing restarts by itself: follow-ups stay off
-- until reactivated, and projects keep their own settings).
begin;
delete from public.comm_events where kind in ('disabled', 'enabled', 'terms_accepted');
alter table public.comm_events drop constraint if exists comm_events_kind_check;
alter table public.comm_events add constraint comm_events_kind_check check (kind in ('reply', 'auto_reply', 'bounce', 'complaint', 'delivered', 'unsubscribe', 'opt_out_request', 'ambiguous_reply',
  'sent', 'failed', 'approved', 'skipped', 'canceled', 'paused', 'resumed', 'settings', 'enrolled', 'suppressed'));
alter table public.comm_settings drop constraint if exists comm_settings_disabled_reason_len;
alter table public.comm_settings drop constraint if exists comm_settings_terms_version_check;
alter table public.comm_settings drop column if exists disabled_at;
alter table public.comm_settings drop column if exists disabled_by;
alter table public.comm_settings drop column if exists disabled_reason;
alter table public.comm_settings drop column if exists terms_accepted_at;
alter table public.comm_settings drop column if exists terms_accepted_by;
alter table public.comm_settings drop column if exists terms_version;
commit;
