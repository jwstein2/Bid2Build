-- Rollback for 20261117003000_lifecycle_emails.sql. Deletes lifecycle email history.
delete from public.email_outbox where kind like 'lifecycle_%';
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check check (kind in ('founder_welcome'));
drop index if exists public.email_outbox_kind_created_idx;
alter table public.email_outbox drop column if exists meta;
alter table public.profiles drop column if exists lifecycle_unsubscribed_at;
