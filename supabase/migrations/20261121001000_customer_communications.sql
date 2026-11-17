-- V4.6 Customer Nurture & Automated Communications (Project Command Center add-on).
--
--   * comm_settings: one row per account (an Enterprise company, or a solo user). Everything is OFF by
--     default: nurture_enabled = false, project updates frequency = 'off', sending mode = 'review'.
--   * comm_contacts: people a contractor has deliberately enrolled in nurture follow-ups, one row per
--     email address per account (so three old estimates never mean three emails). Nobody is enrolled
--     when the feature is switched on: the contractor reviews the eligible audience and confirms.
--   * comm_suppressions: durable opt-outs, bounces and complaints. Never removed by restarting a
--     campaign or re-importing a contact (there is no app path that deletes them).
--   * comm_offers: optional, contractor-approved offers. Nothing is ever discounted automatically.
--   * comm_messages: every outgoing customer message (draft -> awaiting review / scheduled -> sending
--     -> sent -> delivered, or failed / paused / replied / canceled / skipped) with the exact content
--     sent, who or what started it, the provider id and an idempotency key so a retry never sends twice.
--   * comm_events: replies, bounces, complaints, unsubscribes and status changes (audit trail).
--   * project_comm_settings: per-project update frequency and mode (review first / automatic).
--   * comm_global: owner emergency stop for every automated customer message.
--   * New company permissions for communications. Enabling company-wide automatic sending is owner-only
--     to delegate.
--
-- Reads: account members with "View communication history" (RLS). Writes: only the server (service
-- role) after it checks the caller's PM entitlement and permission. Nothing here sends email: sending
-- also needs COMM_EMAIL_MODE=test|live, which is unset (off) in every environment.
--
-- Safe to run more than once. Requires every earlier migration (through 20261120001000).
-- Rollback: docs/customer-communications/rollback_20261121001000.sql

-- 1. Permissions --------------------------------------------------------------------------------------
create or replace function public.company_permission_keys() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array[
    'view_own_bids', 'view_team_bids', 'view_company_bids', 'create_estimates', 'edit_team_estimates',
    'view_costs', 'view_margin', 'approve_bids', 'manage_company_pricing', 'view_analytics',
    'manage_teams', 'manage_users', 'manage_billing',
    'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'edit_all_schedules', 'manage_dependencies',
    'update_progress', 'publish_customer_updates', 'download_schedule_pdf',
    'view_internal_reports', 'download_internal_reports', 'send_internal_reports',
    'manage_pm_seats', 'manage_pm_addons',
    'review_approved_jobs', 'edit_live_schedules', 'confirm_task_completion',
    'create_change_orders', 'send_change_orders', 'share_subcontractor_scopes', 'upload_photos',
    'view_subcontractor_costs', 'edit_project_costs',
    'view_proposal_style', 'customize_proposal_style', 'manage_proposal_templates', 'change_proposal_policy',
    -- V4.6 customer communications
    'view_communications', 'edit_nurture_templates', 'enable_customer_nurture', 'approve_marketing_outreach',
    'configure_project_updates', 'approve_customer_updates', 'enable_auto_project_updates',
    'view_customer_replies', 'manage_opt_outs'
  ]
$$;

create or replace function public.company_role_permissions(p_role text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case p_role
    when 'owner' then public.company_permission_keys()
    when 'manager' then array['view_own_bids', 'view_team_bids', 'create_estimates', 'edit_team_estimates',
                              'view_costs', 'view_margin', 'approve_bids', 'view_analytics',
                              'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'edit_all_schedules', 'manage_dependencies',
                              'update_progress', 'publish_customer_updates', 'download_schedule_pdf',
                              'view_internal_reports', 'download_internal_reports', 'send_internal_reports',
                              'review_approved_jobs', 'edit_live_schedules', 'confirm_task_completion',
                              'create_change_orders', 'send_change_orders', 'share_subcontractor_scopes', 'upload_photos',
                              'view_subcontractor_costs', 'edit_project_costs',
                              'view_proposal_style', 'customize_proposal_style',
                              'view_communications', 'edit_nurture_templates', 'approve_marketing_outreach',
                              'configure_project_updates', 'approve_customer_updates', 'view_customer_replies', 'manage_opt_outs']
    when 'estimator' then array['view_own_bids', 'create_estimates', 'view_costs',
                                'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'manage_dependencies', 'update_progress', 'download_schedule_pdf',
                                'review_approved_jobs', 'edit_live_schedules', 'confirm_task_completion', 'create_change_orders', 'upload_photos',
                                'view_proposal_style', 'customize_proposal_style',
                                'view_communications', 'view_customer_replies']
    when 'viewer' then array['view_own_bids', 'view_team_bids', 'view_analytics', 'view_schedules', 'download_schedule_pdf', 'view_proposal_style',
                             'view_communications']
    else array[]::text[]
  end
$$;

create or replace function public.company_owner_only_permissions() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array['manage_billing', 'manage_users', 'manage_pm_seats', 'manage_pm_addons', 'change_proposal_policy',
               'enable_customer_nurture', 'enable_auto_project_updates']
$$;

create or replace function public.comm_permission_keys() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array['view_communications', 'edit_nurture_templates', 'enable_customer_nurture', 'approve_marketing_outreach',
               'configure_project_updates', 'approve_customer_updates', 'enable_auto_project_updates',
               'view_customer_replies', 'manage_opt_outs']
$$;

-- 2. Account and access --------------------------------------------------------------------------------
-- The caller's communications account: their active company, else themselves.
create or replace function public.comm_my_account() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_company_id(), auth.uid())
$$;
revoke execute on function public.comm_my_account() from public, anon;
grant execute on function public.comm_my_account() to authenticated;

-- May the caller do p_perm on this account? Solo accounts hold every permission on their own account.
create or replace function public.comm_can(p_account uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or p_account is null then false
    when p_account = auth.uid() then public.my_company_id() is null
    else public.has_company_permission(p_account, p_perm)
  end
$$;
revoke execute on function public.comm_can(uuid, text) from public, anon;
grant execute on function public.comm_can(uuid, text) to authenticated;

-- What the caller may do (the server re-checks this on every write).
--   pm: the account has Project Command Center (solo: an editor entitlement; company: at least one
--   editor seat on an active Enterprise plan).
create or replace function public.comm_access() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_company uuid; e record; v_perms text[];
begin
  if v_uid is null then return jsonb_build_object('accountId', null, 'kind', 'none', 'pm', false, 'perms', '[]'::jsonb); end if;
  v_company := public.my_company_id();
  select * into e from public.pm_entitlement(v_uid);
  if v_company is not null then
    select array(select k from unnest(public.comm_permission_keys()) k where public.has_company_permission(v_company, k)) into v_perms;
    return jsonb_build_object('accountId', v_company, 'kind', 'company',
      'pm', coalesce(e.scope = 'company' and e.editor_limit > 0, false), 'perms', to_jsonb(v_perms));
  end if;
  return jsonb_build_object('accountId', v_uid, 'kind', 'user', 'pm', coalesce(e.can_edit, false), 'perms', to_jsonb(public.comm_permission_keys()));
end $$;
revoke execute on function public.comm_access() from public, anon;
grant execute on function public.comm_access() to authenticated;

-- 3. Tables ------------------------------------------------------------------------------------------
create table if not exists public.comm_global (
  id integer primary key default 1 check (id = 1),
  paused boolean not null default false,
  paused_at timestamptz,
  paused_by uuid references auth.users (id) on delete set null,
  pause_reason text check (char_length(pause_reason) <= 300),
  -- Set only when a real inbound test message reaches the reply webhook.
  inbound_verified_at timestamptz,
  inbound_test_token text check (char_length(inbound_test_token) <= 100),
  updated_at timestamptz not null default now()
);
insert into public.comm_global (id) values (1) on conflict do nothing;

create table if not exists public.comm_settings (
  account_id uuid primary key,
  account_kind text not null check (account_kind in ('company', 'user')),
  nurture_enabled boolean not null default false,
  nurture_months integer not null default 6 check (nurture_months between 3 and 24),
  nurture_include_offers boolean not null default false,
  nurture_mode text not null default 'review' check (nurture_mode in ('review', 'automatic')),
  nurture_subject text check (char_length(nurture_subject) <= 200),
  nurture_body text check (char_length(nurture_body) <= 4000),
  template_version integer not null default 1 check (template_version >= 1),
  nurture_activated_at timestamptz,
  nurture_activated_by uuid references auth.users (id) on delete set null,
  updates_frequency text not null default 'off' check (updates_frequency in ('off', 'weekly', 'milestone', 'both')),
  updates_mode text not null default 'review' check (updates_mode in ('review', 'automatic')),
  updates_weekday integer not null default 5 check (updates_weekday between 1 and 7),  -- ISO: 1 = Monday
  updates_hour integer not null default 16 check (updates_hour between 6 and 20),
  timezone text not null default 'America/Chicago' check (char_length(timezone) <= 64),
  postal_address text check (char_length(postal_address) <= 300),
  sender_name text check (char_length(sender_name) <= 120),
  reply_to text check (char_length(reply_to) <= 320),
  paused_at timestamptz,               -- Pause All
  paused_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comm_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  email text not null check (email = lower(email) and char_length(email) between 3 and 320 and position('@' in email) > 1),
  name text check (char_length(name) <= 200),
  customer_id uuid references public.customers (id) on delete set null,
  status text not null default 'eligible' check (status in ('eligible', 'paused', 'replied', 'unsubscribed', 'bounced', 'suppressed')),
  status_reason text check (char_length(status_reason) <= 300),
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid references auth.users (id) on delete set null,
  -- Why outreach is allowed: they asked for a quote (inquiry), bought from the contractor (customer),
  -- or the contractor confirmed a relationship / consent for an older draft.
  basis text not null check (basis in ('inquiry', 'customer', 'confirmed')),
  enrolled_at timestamptz not null default now(),
  enrolled_by uuid references auth.users (id) on delete set null,
  last_nurture_at timestamptz,
  last_reply_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, email)
);
create index if not exists comm_contacts_account_idx on public.comm_contacts (account_id, status);

create table if not exists public.comm_suppressions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid,                 -- null = every account (an address that hard-bounced)
  email text not null check (email = lower(email) and char_length(email) <= 320),
  scope text not null check (scope in ('marketing', 'project_updates', 'all')),
  reason text not null check (reason in ('unsubscribe', 'stop_request', 'ambiguous_opt_out', 'bounce', 'complaint', 'manual')),
  source text check (char_length(source) <= 100),
  message_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists comm_suppressions_key on public.comm_suppressions (coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), email, scope);
create index if not exists comm_suppressions_email_idx on public.comm_suppressions (email);

create table if not exists public.comm_offers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  offer_type text not null check (offer_type in ('percent', 'fixed', 'seasonal', 'material', 'financing', 'custom')),
  trades text[] not null default '{}',
  audience text[] not null default '{}' check (audience <@ array['lost', 'unconverted', 'old_draft', 'completed', 'past_customer']),
  starts_on date not null,
  ends_on date not null,
  conditions text not null default '' check (char_length(conditions) <= 600),
  discount_value numeric(12, 2) check (discount_value is null or discount_value > 0),
  message text not null default '' check (char_length(message) <= 600),
  material_current text check (char_length(material_current) <= 200),
  material_alternative text check (char_length(material_alternative) <= 200),
  price_basis text check (price_basis in ('verified', 'contractor_estimate')),
  estimated_savings text check (char_length(estimated_savings) <= 200),
  comparison_approved_at timestamptz,
  comparison_approved_by uuid references auth.users (id) on delete set null,
  active boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comm_offers_dates check (ends_on >= starts_on),
  constraint comm_offers_discount check (offer_type not in ('percent', 'fixed') or discount_value is not null),
  constraint comm_offers_percent check (offer_type <> 'percent' or discount_value <= 50),
  constraint comm_offers_material check (offer_type <> 'material' or (material_current is not null and material_alternative is not null and price_basis is not null))
);
create index if not exists comm_offers_account_idx on public.comm_offers (account_id, active);

create table if not exists public.comm_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  kind text not null check (kind in ('nurture', 'project_update')),
  trigger text not null check (trigger in ('six_month', 'weekly', 'milestone', 'manual')),
  contact_id uuid references public.comm_contacts (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  estimate_id uuid references public.estimates (id) on delete set null,
  schedule_id uuid references public.project_schedules (id) on delete set null,
  task_id uuid references public.schedule_tasks (id) on delete set null,
  to_email text check (char_length(to_email) <= 320),
  to_name text check (char_length(to_name) <= 200),
  subject text not null default '' check (char_length(subject) <= 300),
  body_text text not null default '' check (char_length(body_text) <= 20000),
  -- Snapshot of the facts / customer report the message was built from (never prices or costs).
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object' and pg_column_size(content) < 400000),
  template_version integer,
  offer_id uuid references public.comm_offers (id) on delete set null,
  status text not null check (status in ('draft', 'scheduled', 'awaiting_review', 'approved', 'sending', 'sent', 'delivered', 'failed', 'paused', 'replied', 'canceled', 'skipped')),
  status_reason text check (char_length(status_reason) <= 300),
  scheduled_for timestamptz,
  reminder_at timestamptz,
  reminder_notified_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  approved_revision integer,
  initiated_by uuid references auth.users (id) on delete set null,
  automation boolean not null default true,
  idempotency_key text not null unique check (char_length(idempotency_key) <= 200),
  rfc_message_id text unique check (char_length(rfc_message_id) <= 300),
  reply_token text unique check (char_length(reply_token) <= 64),
  provider_id text check (char_length(provider_id) <= 200),
  publication_id uuid references public.schedule_publications (id) on delete set null,
  attempts integer not null default 0,
  locked_until timestamptz,
  last_error text check (char_length(last_error) <= 500),
  sent_at timestamptz,
  delivered_at timestamptz,
  replied_at timestamptz,
  opt_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists comm_messages_account_idx on public.comm_messages (account_id, status, scheduled_for);
create index if not exists comm_messages_contact_idx on public.comm_messages (contact_id, status);
create index if not exists comm_messages_schedule_idx on public.comm_messages (schedule_id, created_at desc);
create index if not exists comm_messages_due_idx on public.comm_messages (status, scheduled_for) where status in ('scheduled', 'approved', 'awaiting_review');

create table if not exists public.comm_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid,
  message_id uuid references public.comm_messages (id) on delete set null,
  contact_id uuid references public.comm_contacts (id) on delete set null,
  kind text not null check (kind in ('reply', 'auto_reply', 'bounce', 'complaint', 'delivered', 'unsubscribe', 'opt_out_request', 'ambiguous_reply',
                                     'sent', 'failed', 'approved', 'skipped', 'canceled', 'paused', 'resumed', 'settings', 'enrolled', 'suppressed')),
  actor_id uuid references auth.users (id) on delete set null,
  provider_event_id text unique check (char_length(provider_event_id) <= 200),
  from_email text check (char_length(from_email) <= 320),
  subject text check (char_length(subject) <= 300),
  excerpt text check (char_length(excerpt) <= 2000),
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) <= 8000),
  needs_attention boolean not null default false,
  handled_at timestamptz,
  handled_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists comm_events_account_idx on public.comm_events (account_id, created_at desc);
create index if not exists comm_events_attention_idx on public.comm_events (account_id) where needs_attention and handled_at is null;

create table if not exists public.project_comm_settings (
  schedule_id uuid primary key references public.project_schedules (id) on delete cascade,
  account_id uuid not null,
  frequency text not null default 'off' check (frequency in ('off', 'weekly', 'milestone', 'both')),
  mode text not null default 'review' check (mode in ('review', 'automatic')),
  -- Automatic sending needs an explicit, recorded opt-in by an authorized person.
  auto_confirmed_by uuid references auth.users (id) on delete set null,
  auto_confirmed_at timestamptz,
  recipient_email text check (char_length(recipient_email) <= 320),
  recipient_name text check (char_length(recipient_name) <= 200),
  enabled_at timestamptz,
  paused_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_comm_auto_confirmed check (mode = 'review' or (auto_confirmed_by is not null and auto_confirmed_at is not null))
);
create index if not exists project_comm_settings_account_idx on public.project_comm_settings (account_id);

do $$ declare t text; begin
  foreach t in array array['comm_settings', 'comm_contacts', 'comm_offers', 'comm_messages', 'project_comm_settings'] loop
    execute format('drop trigger if exists %1$s_updated on public.%1$s', t);
    execute format('create trigger %1$s_updated before update on public.%1$s for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Mode can never flip to automatic without the opt-in record changing in the same write.
create or replace function public.project_comm_settings_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.mode = 'automatic' and (tg_op = 'INSERT' or old.mode <> 'automatic')
     and (tg_op = 'INSERT' and new.auto_confirmed_at is null or tg_op = 'UPDATE' and new.auto_confirmed_at is not distinct from old.auto_confirmed_at) then
    raise exception 'auto_not_confirmed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists project_comm_settings_guard on public.project_comm_settings;
create trigger project_comm_settings_guard before insert or update on public.project_comm_settings for each row execute function public.project_comm_settings_guard();

-- Sent content is write-once: once a message is sent its subject, body and snapshot never change.
create or replace function public.comm_messages_freeze() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.sent_at is not null and (new.subject is distinct from old.subject or new.body_text is distinct from old.body_text
     or new.content is distinct from old.content or new.to_email is distinct from old.to_email or new.sent_at is distinct from old.sent_at) then
    raise exception 'message_frozen' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists comm_messages_freeze on public.comm_messages;
create trigger comm_messages_freeze before update on public.comm_messages for each row execute function public.comm_messages_freeze();

-- Suppressions are durable: nobody (not even the service role through the API) deletes them by accident.
create or replace function public.comm_suppressions_keep() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_setting('built2bid.allow_unsuppress', true) is distinct from 'on' then
    raise exception 'suppression_durable' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists comm_suppressions_keep on public.comm_suppressions;
create trigger comm_suppressions_keep before delete or update on public.comm_suppressions for each row execute function public.comm_suppressions_keep();

-- 4. RLS: read-only for account members with the right permission -----------------------------------
alter table public.comm_global enable row level security;
alter table public.comm_settings enable row level security;
alter table public.comm_contacts enable row level security;
alter table public.comm_suppressions enable row level security;
alter table public.comm_offers enable row level security;
alter table public.comm_messages enable row level security;
alter table public.comm_events enable row level security;
alter table public.project_comm_settings enable row level security;

drop policy if exists comm_settings_read on public.comm_settings;
create policy comm_settings_read on public.comm_settings for select to authenticated using (public.comm_can(account_id, 'view_communications'));
drop policy if exists comm_contacts_read on public.comm_contacts;
create policy comm_contacts_read on public.comm_contacts for select to authenticated using (public.comm_can(account_id, 'view_communications'));
drop policy if exists comm_suppressions_read on public.comm_suppressions;
create policy comm_suppressions_read on public.comm_suppressions for select to authenticated using (account_id is not null and public.comm_can(account_id, 'view_communications'));
drop policy if exists comm_offers_read on public.comm_offers;
create policy comm_offers_read on public.comm_offers for select to authenticated using (public.comm_can(account_id, 'view_communications'));
drop policy if exists comm_messages_read on public.comm_messages;
create policy comm_messages_read on public.comm_messages for select to authenticated using (public.comm_can(account_id, 'view_communications'));
drop policy if exists comm_events_read on public.comm_events;
create policy comm_events_read on public.comm_events for select to authenticated
  using (account_id is not null and public.comm_can(account_id, 'view_communications')
         and (kind not in ('reply', 'auto_reply', 'ambiguous_reply', 'opt_out_request') or public.comm_can(account_id, 'view_customer_replies')));
drop policy if exists project_comm_settings_read on public.project_comm_settings;
create policy project_comm_settings_read on public.project_comm_settings for select to authenticated
  using (exists (select 1 from public.project_schedules s where s.id = project_comm_settings.schedule_id));

revoke all on public.comm_global, public.comm_settings, public.comm_contacts, public.comm_suppressions, public.comm_offers,
  public.comm_messages, public.comm_events, public.project_comm_settings from anon, authenticated;
grant select on public.comm_settings, public.comm_contacts, public.comm_suppressions, public.comm_offers,
  public.comm_messages, public.comm_events, public.project_comm_settings to authenticated;

-- 5. In-app notices: customer update reminders and customer replies ---------------------------------
alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check
  check (kind in ('task_review', 'customer_update', 'customer_reply'));
alter table public.user_notifications drop constraint if exists user_notifications_resolution_check;
alter table public.user_notifications add constraint user_notifications_resolution_check
  check (resolution in ('confirmed', 'completed', 'moved', 'reassigned', 'closed', 'sent', 'skipped', 'handled'));
