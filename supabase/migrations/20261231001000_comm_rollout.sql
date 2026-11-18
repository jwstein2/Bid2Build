-- V6.10 Customer communications rollout: company off switch + customer email terms.
--
--   * disabled_at / disabled_by / disabled_reason: the account owner (company owner, or the solo user)
--     turned customer follow-ups and project update emails off for the whole account. While set, nothing
--     is planned, approved or sent, and only the owner can turn it back on. It never expires.
--   * terms_accepted_at / terms_accepted_by / terms_version: someone allowed to turn emails on accepted
--     the customer email terms (src/lib/comms/rollout.ts). No customer email is approved or sent before.
--
-- Writes go through the API with the service role (comm_settings is read-only to browsers, as before).
-- Nothing here sends email or changes billing. Safe to run more than once.
-- Requires 20261121001000_customer_communications.sql.
-- Rollback: docs/customer-communications/rollback_20261231001000.sql
alter table public.comm_settings add column if not exists disabled_at timestamptz;
alter table public.comm_settings add column if not exists disabled_by uuid references auth.users (id) on delete set null;
alter table public.comm_settings add column if not exists disabled_reason text;
alter table public.comm_settings drop constraint if exists comm_settings_disabled_reason_len;
alter table public.comm_settings add constraint comm_settings_disabled_reason_len check (char_length(disabled_reason) <= 300);
alter table public.comm_settings add column if not exists terms_accepted_at timestamptz;
alter table public.comm_settings add column if not exists terms_accepted_by uuid references auth.users (id) on delete set null;
alter table public.comm_settings add column if not exists terms_version integer;
alter table public.comm_settings drop constraint if exists comm_settings_terms_version_check;
alter table public.comm_settings add constraint comm_settings_terms_version_check check (terms_version is null or terms_version >= 1);

-- Audit entries for the switch and the terms.
alter table public.comm_events drop constraint if exists comm_events_kind_check;
alter table public.comm_events add constraint comm_events_kind_check check (kind in ('reply', 'auto_reply', 'bounce', 'complaint', 'delivered', 'unsubscribe', 'opt_out_request', 'ambiguous_reply',
  'sent', 'failed', 'approved', 'skipped', 'canceled', 'paused', 'resumed', 'settings', 'enrolled', 'suppressed', 'disabled', 'enabled', 'terms_accepted'));
