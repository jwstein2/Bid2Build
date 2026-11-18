-- Rollback for 20270102001000_demo_mode_guide.sql (Demo Mode, Practice Mode, guided tours).
-- Turns the feature off at the database. It does NOT delete demo logins or their sample rows (those
-- belong to separate demo tenants and are invisible to real accounts); remove those from the Auth
-- dashboard first if wanted (users on example.com / demo.built2bid.org labelled 'demo').
-- The 'guide_help' value added to ai_generations.kind is left in place (harmless).
begin;
drop trigger if exists demo_guard_comm_messages on public.comm_messages;
drop trigger if exists demo_guard_outbox on public.email_outbox;
drop trigger if exists demo_guard_signing on public.signing_requests;
drop trigger if exists demo_guard_subscriptions on public.subscriptions;
drop function if exists public.demo_guard_comm_messages();
drop function if exists public.demo_guard_outbox();
drop function if exists public.demo_guard_signing();
drop function if exists public.demo_guard_subscriptions();
drop function if exists public.admin_guide_overview(uuid, integer);
drop function if exists public.guide_record(jsonb);
drop function if exists public.demo_mark_failed(uuid, text);
drop function if exists public.demo_apply(uuid, text, jsonb, text, integer);
drop function if exists public.demo_provision(uuid, uuid, text, text);
drop function if exists public.demo_act_as(uuid);
drop function if exists public.is_demo_account(uuid);
drop table if exists public.guide_events;
drop table if exists public.guide_progress;
drop table if exists public.demo_retired_logins;
drop table if exists public.demo_workspaces;
-- Original updated_at trigger function (20261112000100_core_schema.sql).
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
commit;
