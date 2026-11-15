-- Owner command center V2: account classification + richer first-party attribution.
--
-- Purely additive. No existing row, entitlement, subscription or grant is changed.
-- Safe to run more than once. Rollback: supabase/rollback/20261115002000_admin_reporting_down.sql
--
-- 1. admin_account_labels: the owner's manual classification of an account as genuine, internal
--    (owner/staff), test or demo, so business metrics can exclude non-customers without guessing
--    from company names. Accounts with no label are classified automatically in the app
--    (admin role -> internal, reserved test domains -> test, otherwise genuine).
-- 2. leads: three optional first-touch columns, captured from the landing request only:
--    referrer_host (host name only, never the full URL), click_id_type (which ad click id was
--    present, never its value) and device_type (mobile/tablet/desktop from the user agent).
--
-- Access: service role only (RLS on, no policies, grants revoked), like the other internal tables.

create table if not exists public.admin_account_labels (
  user_id uuid primary key references auth.users (id) on delete cascade,
  label text not null check (label in ('genuine', 'internal', 'test', 'demo')),
  note text check (char_length(note) <= 300),
  set_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists admin_account_labels_updated on public.admin_account_labels;
create trigger admin_account_labels_updated before update on public.admin_account_labels
  for each row execute function public.set_updated_at();
alter table public.admin_account_labels enable row level security;
revoke all on public.admin_account_labels from anon, authenticated;
grant all on public.admin_account_labels to service_role;

alter table public.leads add column if not exists referrer_host text check (char_length(referrer_host) <= 253);
alter table public.leads add column if not exists click_id_type text check (click_id_type in ('gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id'));
alter table public.leads add column if not exists device_type text check (device_type in ('mobile', 'tablet', 'desktop'));
