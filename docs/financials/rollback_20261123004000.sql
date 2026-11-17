-- Rollback for 20261123004000_fin_communications.sql (financial emails on the Customer Hub module).
-- Deploy the previous app version first. WARNING: financial email drafts / history (comm_messages with
-- kind = 'financial') are deleted; templates, tone, reminder rules and dispute flags are dropped.
-- Rollbacks run newest first: 004, 003, 002, 001.
begin;
delete from public.comm_events where message_id in (select id from public.comm_messages where kind = 'financial');
delete from public.comm_messages where kind = 'financial';
update public.comm_messages set status = 'sent' where status in ('queued', 'provider_accepted');
update public.comm_messages set status = 'failed' where status = 'bounced';

drop policy if exists comm_messages_read on public.comm_messages;
create policy comm_messages_read on public.comm_messages for select to authenticated using (public.comm_can(account_id, 'view_communications'));
alter table public.comm_messages drop constraint if exists comm_messages_fin_shape;
alter table public.comm_messages drop constraint if exists comm_messages_fin_template_kind_check;
alter table public.comm_messages drop constraint if exists comm_messages_fin_tone_check;
drop index if exists public.comm_messages_fin_invoice_idx;
drop index if exists public.comm_messages_fin_payment_idx;
alter table public.comm_messages drop column if exists fin_book_id, drop column if exists fin_invoice_id, drop column if exists fin_payment_id,
  drop column if exists fin_credit_memo_id, drop column if exists fin_refund_id, drop column if exists fin_template_kind,
  drop column if exists fin_tone, drop column if exists fin_fields_hash;
alter table public.comm_messages drop constraint if exists comm_messages_kind_check;
alter table public.comm_messages add constraint comm_messages_kind_check check (kind in ('nurture', 'project_update'));
alter table public.comm_messages drop constraint if exists comm_messages_trigger_check;
alter table public.comm_messages add constraint comm_messages_trigger_check check (trigger in ('six_month', 'weekly', 'milestone', 'manual'));
alter table public.comm_messages drop constraint if exists comm_messages_status_check;
alter table public.comm_messages add constraint comm_messages_status_check check (status in ('draft', 'scheduled', 'awaiting_review', 'approved', 'sending', 'sent',
  'delivered', 'failed', 'paused', 'replied', 'canceled', 'skipped'));

drop table if exists public.fin_invoice_disputes;
drop table if exists public.fin_reminder_rules;
drop table if exists public.fin_email_templates;
drop table if exists public.fin_email_settings;

do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array['fin_email_config_save', 'fin_email_draft_save', 'fin_email_queue', 'fin_email_set_status', 'fin_invoice_dispute_set', 'fin_invoice_disputes_guard', 'fin_reminder_suppressed']) loop
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;
commit;
