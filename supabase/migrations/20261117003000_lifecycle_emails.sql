-- Growth PR 4: lifecycle (onboarding) emails A-E through the existing email_outbox.
--
-- * Additive only. Widens email_outbox.kind with lifecycle_a .. lifecycle_e. The existing
--   unique (kind, user_id) means each step goes to an account at most once, ever.
-- * profiles.lifecycle_unsubscribed_at: set by the one-click unsubscribe link. Any value stops every
--   lifecycle email for that account. It does not change marketing_opt_in or any other setting.
-- * Sending stays OFF until LIFECYCLE_EMAIL_MODE is set (see docs/growth/LIFECYCLE_EMAILS.md).
-- Rollback: docs/growth/rollback_20261117003000.sql

alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('founder_welcome', 'lifecycle_a', 'lifecycle_b', 'lifecycle_c', 'lifecycle_d', 'lifecycle_e'));

-- Which estimate / trade a lifecycle email was about (ids and slugs only, no customer data).
alter table public.email_outbox add column if not exists meta jsonb
  check (meta is null or pg_column_size(meta) <= 1024);

create index if not exists email_outbox_kind_created_idx on public.email_outbox (kind, created_at);

alter table public.profiles add column if not exists lifecycle_unsubscribed_at timestamptz;
