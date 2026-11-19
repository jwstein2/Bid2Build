-- E-signature audit trail and tamper-check lookups (legal review, 2026-11-19).
--
-- * public.signing_events: one row per thing that happened on a signing link: the customer opened the
--   page, downloaded the PDF, signed, or was emailed their signed copy. Each row keeps the time, IP
--   address and browser, like the signature itself. Rows are append-only (no update, no delete except
--   when the signing request goes, which only happens when the whole account is deleted).
-- * Index on signatures.pdf_hash so the public "Verify a signed document" page can confirm that a file
--   is an unaltered Built2Bid signed copy by its SHA-256 alone.
--
-- Service role only (RLS on, no policies, no grants to anon/authenticated). Additive and safe to run
-- more than once. Requires 20261115001000_e_signatures.sql.

create table if not exists public.signing_events (
  id bigserial primary key,
  request_id uuid not null references public.signing_requests (id) on delete cascade,
  event text not null check (event in ('viewed', 'pdf_downloaded', 'signed', 'copy_emailed')),
  ip_address text check (char_length(ip_address) <= 64),
  user_agent text check (char_length(user_agent) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists signing_events_request_idx on public.signing_events (request_id, id);

create or replace function public.guard_signing_event() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then raise exception 'signing_event_immutable' using errcode = 'P0001'; end if;
  -- Deletes only as part of a cascade (account or request removal), never directly.
  if tg_op = 'DELETE' and pg_trigger_depth() < 2 then raise exception 'signing_event_immutable' using errcode = 'P0001'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists signing_events_guard on public.signing_events;
create trigger signing_events_guard before update or delete on public.signing_events
  for each row execute function public.guard_signing_event();

alter table public.signing_events enable row level security;
revoke all on public.signing_events from anon, authenticated;
revoke all on sequence public.signing_events_id_seq from anon, authenticated;

create index if not exists signatures_pdf_hash_idx on public.signatures (pdf_hash) where pdf_hash is not null;
