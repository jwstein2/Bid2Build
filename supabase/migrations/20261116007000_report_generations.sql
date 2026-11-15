-- V4 Phase 10: owner analytics for the Internal Estimate Report.
-- One row each time an Internal Estimate Report is generated (preview, download or attach-to-email).
-- Records only who, which action and when: never the estimate, its amounts, costs or margins.
-- Written by the server with the service role; no one else can read or write it (RLS on, no policies).
-- Safe to run more than once. Rollback: docs/pipeline/rollback_20261116007000.sql

create table if not exists public.report_generations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  kind text not null default 'internal_estimate' check (kind in ('internal_estimate')),
  action text not null check (action in ('preview', 'download', 'send')),
  created_at timestamptz not null default now()
);
create index if not exists report_generations_time_idx on public.report_generations (created_at);
create index if not exists report_generations_user_idx on public.report_generations (user_id, created_at);

alter table public.report_generations enable row level security;
revoke all on public.report_generations from public, anon, authenticated;
grant select, insert on public.report_generations to service_role;
