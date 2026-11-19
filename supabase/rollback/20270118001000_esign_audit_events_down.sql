-- Rollback for 20270118001000_esign_audit_events.sql (drops the audit events; signatures are untouched).
drop index if exists public.signatures_pdf_hash_idx;
drop table if exists public.signing_events;
drop function if exists public.guard_signing_event();
