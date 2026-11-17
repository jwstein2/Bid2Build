-- Financial Command Center, Phase 1 (part 4): invoice & payment emails on the EXISTING Customer Hub
-- communications module (20261121001000_customer_communications.sql). Only what was missing is added:
--
--   * comm_messages gains kind 'financial' (trigger 'financial'), the send states queued /
--     provider_accepted / bounced, and nullable links to the book, invoice, payment, credit memo or refund,
--     the template kind, tone and a hash of the financial fields the draft was rendered from (stale-draft
--     detection: if an amount / due date / balance changed, the draft must be re-rendered). The existing
--     idempotency_key (unique) keeps a retry from sending twice. Financial messages are readable only with
--     view_company_financials (not merely view_communications).
--   * fin_email_settings (tone) and fin_email_templates (company overrides per template kind + tone);
--     the default wording lives in src/lib/financials/emails (deterministic renderer).
--   * fin_reminder_rules: balance / overdue reminders per book, OFF by default; a reminder is suppressed
--     when the invoice is paid, void or disputed (fin_invoice_disputes), or the address bounced/complained.
--
-- Nothing here sends anything: queuing only marks a reviewed draft; the existing sender stays gated by
-- COMM_EMAIL_MODE (unset everywhere) and no financial send path exists yet.
--
-- Safe to run more than once. Requires 20261124003000_fin_costs.sql.
-- Rollback: docs/financials/rollback_20261124004000.sql

-- 1. comm_messages: financial kind, states and links ------------------------------------------------------
alter table public.comm_messages drop constraint if exists comm_messages_kind_check;
alter table public.comm_messages add constraint comm_messages_kind_check check (kind in ('nurture', 'project_update', 'financial'));
alter table public.comm_messages drop constraint if exists comm_messages_trigger_check;
alter table public.comm_messages add constraint comm_messages_trigger_check check (trigger in ('six_month', 'weekly', 'milestone', 'manual', 'financial'));
alter table public.comm_messages drop constraint if exists comm_messages_status_check;
alter table public.comm_messages add constraint comm_messages_status_check check (status in ('draft', 'scheduled', 'awaiting_review', 'approved', 'sending', 'sent',
  'delivered', 'failed', 'paused', 'replied', 'canceled', 'skipped', 'queued', 'provider_accepted', 'bounced'));

alter table public.comm_messages add column if not exists fin_book_id uuid references public.fin_books (id) on delete restrict;
alter table public.comm_messages add column if not exists fin_invoice_id uuid references public.fin_invoices (id) on delete restrict;
alter table public.comm_messages add column if not exists fin_payment_id uuid references public.fin_payments (id) on delete restrict;
alter table public.comm_messages add column if not exists fin_credit_memo_id uuid references public.fin_credit_memos (id) on delete restrict;
alter table public.comm_messages add column if not exists fin_refund_id uuid references public.fin_refunds (id) on delete restrict;
alter table public.comm_messages add column if not exists fin_template_kind text;
alter table public.comm_messages add column if not exists fin_tone text;
alter table public.comm_messages add column if not exists fin_fields_hash text;
do $$ begin
  alter table public.comm_messages add constraint comm_messages_fin_template_kind_check check (fin_template_kind is null or fin_template_kind in (
    'deposit', 'progress', 'final', 'time_materials', 'change_order', 'balance_reminder', 'overdue_reminder', 'receipt', 'partial_payment',
    'final_thanks', 'credit_refund'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.comm_messages add constraint comm_messages_fin_tone_check check (fin_tone is null or fin_tone in ('friendly', 'professional', 'brief'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.comm_messages add constraint comm_messages_fin_shape check (
    (kind = 'financial') = (fin_book_id is not null)
    and (kind <> 'financial' or (fin_template_kind is not null and fin_tone is not null and fin_fields_hash ~ '^[0-9a-f]{64}$')));
exception when duplicate_object then null; end $$;
create index if not exists comm_messages_fin_invoice_idx on public.comm_messages (fin_invoice_id) where fin_invoice_id is not null;
create index if not exists comm_messages_fin_payment_idx on public.comm_messages (fin_payment_id) where fin_payment_id is not null;

drop policy if exists comm_messages_read on public.comm_messages;
create policy comm_messages_read on public.comm_messages for select to authenticated
  using ((kind <> 'financial' and public.comm_can(account_id, 'view_communications'))
         or (kind = 'financial' and public.fin_has_permission(fin_book_id, 'view_company_financials')));

-- 2. Templates, tone and reminder rules ------------------------------------------------------------------
create table if not exists public.fin_email_settings (
  book_id    uuid primary key references public.fin_books (id) on delete restrict,
  tone       text not null default 'professional' check (tone in ('friendly', 'professional', 'brief')),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.fin_email_templates (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.fin_books (id) on delete restrict,
  template_kind text not null check (template_kind in ('deposit', 'progress', 'final', 'time_materials', 'change_order', 'balance_reminder',
                                                       'overdue_reminder', 'receipt', 'partial_payment', 'final_thanks', 'credit_refund')),
  tone          text not null check (tone in ('friendly', 'professional', 'brief')),
  subject       text not null check (char_length(subject) between 1 and 300),
  body          text not null check (char_length(body) between 1 and 10000),
  updated_by    uuid references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  unique (book_id, template_kind, tone)
);

create table if not exists public.fin_reminder_rules (
  book_id           uuid not null references public.fin_books (id) on delete restrict,
  kind              text not null check (kind in ('balance_reminder', 'overdue_reminder')),
  enabled           boolean not null default false,
  offset_days       integer not null default 3 check (offset_days between 0 and 90),   -- before due (balance) / after due (overdue)
  repeat_every_days integer check (repeat_every_days between 1 and 60),
  max_reminders     integer not null default 1 check (max_reminders between 1 and 10),
  updated_by        uuid references auth.users (id) on delete set null,
  updated_at        timestamptz not null default now(),
  primary key (book_id, kind)
);

create table if not exists public.fin_invoice_disputes (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  invoice_id  uuid not null references public.fin_invoices (id) on delete restrict,
  note        text check (char_length(note) <= 1000),
  opened_by   uuid references auth.users (id) on delete set null,
  opened_at   timestamptz not null default now(),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz
);
create unique index if not exists fin_invoice_disputes_one_open on public.fin_invoice_disputes (invoice_id) where resolved_at is null;
create or replace function public.fin_invoice_disputes_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' or old.resolved_at is not null
     or (to_jsonb(new) - 'resolved_by' - 'resolved_at') is distinct from (to_jsonb(old) - 'resolved_by' - 'resolved_at') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists fin_invoice_disputes_guard on public.fin_invoice_disputes;
create trigger fin_invoice_disputes_guard before update or delete on public.fin_invoice_disputes for each row execute function public.fin_invoice_disputes_guard();

-- 3. RPCs --------------------------------------------------------------------------------------------------
-- p {tone?, templates: [{templateKind, tone, subject, body}], reminders: [{kind, enabled, offsetDays, repeatEveryDays?, maxReminders?}]}
create or replace function public.fin_email_config_save(p_book_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t jsonb;
begin
  perform public.fin_require(p_book_id, 'manage_financial_config', false);
  if nullif(p ->> 'tone', '') is not null then
    insert into public.fin_email_settings (book_id, tone, updated_by) values (p_book_id, p ->> 'tone', auth.uid())
    on conflict (book_id) do update set tone = excluded.tone, updated_by = excluded.updated_by, updated_at = now();
  end if;
  for t in select * from jsonb_array_elements(coalesce(p -> 'templates', '[]'::jsonb)) loop
    insert into public.fin_email_templates (book_id, template_kind, tone, subject, body, updated_by)
    values (p_book_id, t ->> 'templateKind', t ->> 'tone', t ->> 'subject', t ->> 'body', auth.uid())
    on conflict (book_id, template_kind, tone) do update set subject = excluded.subject, body = excluded.body, updated_by = excluded.updated_by, updated_at = now();
  end loop;
  for t in select * from jsonb_array_elements(coalesce(p -> 'reminders', '[]'::jsonb)) loop
    insert into public.fin_reminder_rules (book_id, kind, enabled, offset_days, repeat_every_days, max_reminders, updated_by)
    values (p_book_id, t ->> 'kind', coalesce((t ->> 'enabled')::boolean, false), coalesce((t ->> 'offsetDays')::integer, 3),
            nullif(t ->> 'repeatEveryDays', '')::integer, coalesce((t ->> 'maxReminders')::integer, 1), auth.uid())
    on conflict (book_id, kind) do update set enabled = excluded.enabled, offset_days = excluded.offset_days, repeat_every_days = excluded.repeat_every_days,
      max_reminders = excluded.max_reminders, updated_by = excluded.updated_by, updated_at = now();
  end loop;
  perform public.fin_audit(p_book_id, 'email_config.saved', 'book', p_book_id, p);
end $$;

create or replace function public.fin_invoice_dispute_set(p_invoice_id uuid, p_open boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.fin_invoices;
begin
  select * into inv from public.fin_invoices where id = p_invoice_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(inv.book_id, 'create_invoices', false);
  if p_open then
    insert into public.fin_invoice_disputes (book_id, invoice_id, note, opened_by) values (inv.book_id, inv.id, nullif(left(p_note, 1000), ''), auth.uid()) on conflict do nothing;
  else
    update public.fin_invoice_disputes set resolved_at = now(), resolved_by = auth.uid() where invoice_id = inv.id and resolved_at is null;
  end if;
  perform public.fin_audit(inv.book_id, case when p_open then 'invoice.disputed' else 'invoice.dispute_resolved' end, 'invoice', inv.id, jsonb_build_object('note', p_note));
end $$;

-- Why a reminder for this invoice must not go out (null = it may): rule off, paid, void, disputed.
create or replace function public.fin_reminder_suppressed(p_invoice_id uuid, p_kind text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when i.id is null then 'not_found'
    when not coalesce((select r.enabled from public.fin_reminder_rules r where r.book_id = i.book_id and r.kind = p_kind), false) then 'rule_off'
    when i.status = 'void' then 'void'
    when i.status <> 'issued' then 'not_issued'
    when i.total - public.fin_invoice_applied(i.id) <= 0 then 'paid'
    when exists (select 1 from public.fin_invoice_disputes d where d.invoice_id = i.id and d.resolved_at is null) then 'disputed'
    else null end
  from (select 1) one left join public.fin_invoices i on i.id = p_invoice_id
$$;

-- Save a rendered draft (the server renders it with src/lib/financials/emails and passes the hash of the
-- financial fields it used). p {templateKind, tone, invoiceId?, paymentId?, creditMemoId?, refundId?,
-- toEmail, toName?, subject, body, fieldsHash, idempotencyKey}
create or replace function public.fin_email_draft_save(p_book_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare b public.fin_books; v_id uuid; v_kind text := p ->> 'templateKind'; v_customer uuid; v_estimate uuid;
begin
  perform public.fin_require(p_book_id, case when v_kind in ('receipt', 'partial_payment', 'final_thanks', 'credit_refund') then 'record_payments' else 'create_invoices' end, true);
  select * into b from public.fin_books where id = p_book_id;
  if nullif(p ->> 'invoiceId', '') is not null then
    select i.customer_id, j.estimate_id into v_customer, v_estimate from public.fin_invoices i join public.fin_jobs j on j.id = i.job_id
     where i.id = (p ->> 'invoiceId')::uuid and i.book_id = p_book_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  if nullif(p ->> 'paymentId', '') is not null then
    select coalesce(v_customer, customer_id) into v_customer from public.fin_payments where id = (p ->> 'paymentId')::uuid and book_id = p_book_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  if (nullif(p ->> 'creditMemoId', '') is not null and not exists (select 1 from public.fin_credit_memos where id = (p ->> 'creditMemoId')::uuid and book_id = p_book_id))
     or (nullif(p ->> 'refundId', '') is not null and not exists (select 1 from public.fin_refunds where id = (p ->> 'refundId')::uuid and book_id = p_book_id)) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select id into v_id from public.comm_messages where idempotency_key = p ->> 'idempotencyKey';
  if v_id is not null then
    if not exists (select 1 from public.comm_messages where id = v_id and fin_book_id = p_book_id) then raise exception 'idempotency_conflict' using errcode = '22023'; end if;
    return v_id;
  end if;
  insert into public.comm_messages (account_id, kind, trigger, customer_id, estimate_id, to_email, to_name, subject, body_text, content, status, initiated_by,
    automation, idempotency_key, fin_book_id, fin_invoice_id, fin_payment_id, fin_credit_memo_id, fin_refund_id, fin_template_kind, fin_tone, fin_fields_hash)
  values (coalesce(b.company_id, b.owner_user_id), 'financial', 'financial', v_customer, v_estimate, lower(btrim(p ->> 'toEmail')), nullif(left(p ->> 'toName', 200), ''),
    left(p ->> 'subject', 300), left(p ->> 'body', 20000), jsonb_build_object('templateKind', v_kind), 'draft', auth.uid(), false, p ->> 'idempotencyKey', p_book_id,
    nullif(p ->> 'invoiceId', '')::uuid, nullif(p ->> 'paymentId', '')::uuid, nullif(p ->> 'creditMemoId', '')::uuid, nullif(p ->> 'refundId', '')::uuid,
    v_kind, coalesce(nullif(p ->> 'tone', ''), 'professional'), p ->> 'fieldsHash')
  returning id into v_id;
  perform public.fin_audit(p_book_id, 'email.drafted', 'email', v_id, jsonb_build_object('templateKind', v_kind));
  return v_id;
end $$;

-- Queue a reviewed draft. Refused when the financial fields changed since it was rendered (stale), when a
-- reminder is suppressed, or when the address bounced / complained. Queuing twice is a no-op.
create or replace function public.fin_email_queue(p_message_id uuid, p_current_fields_hash text) returns text
language plpgsql security definer set search_path = public as $$
declare m public.comm_messages; v_why text;
begin
  select * into m from public.comm_messages where id = p_message_id and kind = 'financial' for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(m.fin_book_id, case when m.fin_template_kind in ('receipt', 'partial_payment', 'final_thanks', 'credit_refund') then 'record_payments' else 'create_invoices' end, true);
  if m.status <> 'draft' then return m.status; end if;
  if m.fin_fields_hash is distinct from p_current_fields_hash then raise exception 'stale_draft' using errcode = '22023'; end if;
  if m.fin_template_kind in ('balance_reminder', 'overdue_reminder') then
    v_why := public.fin_reminder_suppressed(m.fin_invoice_id, m.fin_template_kind);
    if v_why is not null then
      update public.comm_messages set status = 'skipped', status_reason = 'suppressed:' || v_why where id = m.id;
      return 'skipped';
    end if;
  end if;
  if exists (select 1 from public.comm_suppressions s where s.email = lower(m.to_email) and s.reason in ('bounce', 'complaint')
             and (s.account_id is null or s.account_id = m.account_id)) then
    update public.comm_messages set status = 'skipped', status_reason = 'suppressed:address' where id = m.id;
    return 'skipped';
  end if;
  update public.comm_messages set status = 'queued', approved_by = auth.uid(), approved_at = now() where id = m.id;
  perform public.fin_audit(m.fin_book_id, 'email.queued', 'email', m.id, null);
  return 'queued';
end $$;

-- Provider callbacks (service role only): queued -> sent -> provider_accepted -> delivered, or failed / bounced.
create or replace function public.fin_email_set_status(p_message_id uuid, p_status text, p_provider_id text default null, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('sent', 'provider_accepted', 'delivered', 'failed', 'bounced') then raise exception 'bad_status' using errcode = '22023'; end if;
  update public.comm_messages set status = p_status, provider_id = coalesce(p_provider_id, provider_id), last_error = left(p_error, 500),
    sent_at = case when p_status in ('sent', 'provider_accepted', 'delivered') then coalesce(sent_at, now()) else sent_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end
   where id = p_message_id and kind = 'financial' and status not in ('draft', 'canceled', 'skipped');
end $$;

revoke execute on function public.fin_email_config_save(uuid, jsonb), public.fin_invoice_dispute_set(uuid, boolean, text), public.fin_reminder_suppressed(uuid, text),
  public.fin_email_draft_save(uuid, jsonb), public.fin_email_queue(uuid, text), public.fin_email_set_status(uuid, text, text, text) from public, anon;
grant execute on function public.fin_email_config_save(uuid, jsonb), public.fin_invoice_dispute_set(uuid, boolean, text), public.fin_reminder_suppressed(uuid, text),
  public.fin_email_draft_save(uuid, jsonb), public.fin_email_queue(uuid, text) to authenticated;
revoke execute on function public.fin_email_set_status(uuid, text, text, text) from authenticated;
grant execute on function public.fin_email_set_status(uuid, text, text, text) to service_role;

-- 4. RLS (reads only) --------------------------------------------------------------------------------------
alter table public.fin_email_settings enable row level security;
alter table public.fin_email_templates enable row level security;
alter table public.fin_reminder_rules enable row level security;
alter table public.fin_invoice_disputes enable row level security;
drop policy if exists fin_email_settings_select on public.fin_email_settings;
create policy fin_email_settings_select on public.fin_email_settings for select to authenticated using (public.fin_can_view_book(book_id));
drop policy if exists fin_email_templates_select on public.fin_email_templates;
create policy fin_email_templates_select on public.fin_email_templates for select to authenticated using (public.fin_can_view_book(book_id));
drop policy if exists fin_reminder_rules_select on public.fin_reminder_rules;
create policy fin_reminder_rules_select on public.fin_reminder_rules for select to authenticated using (public.fin_can_view_book(book_id));
drop policy if exists fin_invoice_disputes_select on public.fin_invoice_disputes;
create policy fin_invoice_disputes_select on public.fin_invoice_disputes for select to authenticated
  using (exists (select 1 from public.fin_invoices i where i.id = invoice_id and public.fin_job_visible(i.job_id)));
revoke all on public.fin_email_settings, public.fin_email_templates, public.fin_reminder_rules, public.fin_invoice_disputes from anon, authenticated;
grant select on public.fin_email_settings, public.fin_email_templates, public.fin_reminder_rules, public.fin_invoice_disputes to authenticated;
