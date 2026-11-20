-- Lead email deliverability (2026-11-20). A lead's email was marked verified because its domain had an
-- MX record, but that MX pointed at a mail server that no longer exists (decksbyryan.com), so mail bounced.
-- The app now checks that the MX host itself resolves, stores the result on each lead and shows it in the
-- CRM. People can also mark a real bounce, which goes on a known-bad list so imports skip that address.
-- Safe to run twice.

alter table public.sales_leads add column if not exists email_status text not null default 'unchecked';
alter table public.sales_leads add column if not exists email_checked_at timestamptz;
alter table public.sales_leads add column if not exists email_check_note text;
do $$ begin
  alter table public.sales_leads add constraint sales_leads_email_status check (email_status in ('unchecked', 'ok', 'undeliverable', 'bounced'));
exception when duplicate_object then null; end $$;
create index if not exists sales_leads_email_status_idx on public.sales_leads (email_status, email_checked_at) where email is not null;

-- Editing a lead's email starts it over as "not checked" (unless the same update sets the status).
create or replace function public.sales_leads_email_reset() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.email is distinct from old.email and new.email_status is not distinct from old.email_status then
    new.email_status := 'unchecked'; new.email_checked_at := null; new.email_check_note := null;
  end if;
  return new;
end $$;
drop trigger if exists sales_leads_email_reset on public.sales_leads;
create trigger sales_leads_email_reset before update of email on public.sales_leads for each row execute function public.sales_leads_email_reset();

-- Addresses that really bounced. Imports skip them; leads with them show "Bounced".
create table if not exists public.sales_bad_emails (
  email text primary key check (email = lower(btrim(email)) and email like '%@%'),
  reason text not null default 'bounced' check (reason in ('bounced', 'undeliverable')),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.sales_bad_emails enable row level security;
revoke all on public.sales_bad_emails from public, anon, authenticated;
grant all on public.sales_bad_emails to service_role;

-- The bounce James got on 2026-11-19: decksbyryan.com's MX (mx.decksbyryan.com.cust.b.hostedemail.com) is NXDOMAIN.
insert into public.sales_bad_emails (email, reason, note)
values ('decksbyryan@decksbyryan.com', 'bounced', 'Gmail bounce 2026-11-19: the domain''s mail server (mx.decksbyryan.com.cust.b.hostedemail.com) does not exist. Reach by phone.')
on conflict (email) do nothing;
update public.sales_leads set email_status = 'bounced', email_checked_at = now(),
  email_check_note = 'Gmail bounce 2026-11-19: the domain''s mail server does not exist. Reach by phone.'
where lower(email) = 'decksbyryan@decksbyryan.com';

-- Admin lead list: include the email status (same function as 20270121001000 with one field added).
do $$
declare src text;
begin
  select pg_get_functiondef('public.admin_sales_leads(uuid, jsonb, integer, integer)'::regprocedure) into src;
  if src not like '%''email_status'', l.email_status%' then
    src := replace(src, '''dnc_status'', l.dnc_status,', '''dnc_status'', l.dnc_status, ''email_status'', l.email_status, ''email_check_note'', l.email_check_note,');
    if src not like '%''email_status'', l.email_status%' then raise exception 'admin_sales_leads changed; add email_status by hand'; end if;
    execute src;
  end if;
end $$;
