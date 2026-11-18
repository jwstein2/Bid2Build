-- Rollback for 20261226001000_tax_banking.sql (V6.9 tax intelligence + connected banking).
-- WARNING: drops tax snapshots, tax alerts, bank connections, provider balances and cash plan entries. Bank lines that
-- came from a provider feed stay in fin_bank_transactions (bank-source records are never deleted); their accounts are
-- switched back to statement-import accounts so the V6.3 schema still holds. Run only if V6.9 must be removed.
begin;

drop function if exists public.admin_tax_banking_health();
drop function if exists public.fin_cash_event_save(uuid, jsonb);
drop function if exists public.fin_bank_feed_ingest(uuid, jsonb);
drop function if exists public.fin_bank_refresh_allowed(uuid);
drop function if exists public.fin_bank_connection_disconnect(uuid, text);
drop function if exists public.fin_bank_set_primary(uuid);
drop function if exists public.fin_bank_connection_create(uuid, jsonb);
drop function if exists public.tax_freshness();
drop function if exists public.tax_quarterly_digest(date);
drop function if exists public.tax_fanout_alerts(uuid);
drop function if exists public.tax_activate_due(date);
drop function if exists public.tax_change_record(jsonb);
drop function if exists public.fin_tax_alert_act(uuid, text);
drop function if exists public.tax_calc_record(jsonb, boolean);
drop function if exists public.fin_tax_exemption_save(uuid, jsonb);
drop function if exists public.fin_tax_profile_save(uuid, jsonb);
drop function if exists public.tax_rate_on(text, text, date);

drop table if exists public.fin_cash_events;
drop table if exists public.fin_bank_balances;
drop table if exists public.fin_bank_connection_secrets;

drop index if exists public.fin_bank_accounts_one_primary;
drop index if exists public.fin_bank_accounts_feed_once;
alter table public.fin_bank_accounts drop constraint if exists fin_bank_accounts_feed;
update public.fin_bank_accounts set source = 'statement_import' where source = 'provider_feed';
alter table public.fin_bank_accounts drop constraint if exists fin_bank_accounts_source_check;
alter table public.fin_bank_accounts add constraint fin_bank_accounts_source_check check (source in ('statement_import'));
alter table public.fin_bank_accounts drop column if exists is_primary;
alter table public.fin_bank_accounts drop column if exists institution_name;
alter table public.fin_bank_accounts drop column if exists subtype;
alter table public.fin_bank_accounts drop column if exists currency;
alter table public.fin_bank_accounts drop column if exists provider_account_ref;
alter table public.fin_bank_accounts drop column if exists connection_id;
drop table if exists public.fin_bank_connections;

drop table if exists public.fin_tax_alerts;
drop table if exists public.tax_calculations;
drop function if exists public.tax_calculations_guard();
drop table if exists public.fin_tax_exemptions;
drop table if exists public.fin_tax_profiles;
drop table if exists public.tax_jurisdiction_rates;
drop table if exists public.tax_change_events;
drop function if exists public.tax_change_events_guard();
drop table if exists public.tax_sync_runs;
drop table if exists public.tax_authorities;
drop function if exists public.tb_can(uuid, text, boolean);
drop function if exists public.tb_capability_key(text);

-- Restore the V6.3 retention check (without the V6.9 tables).
create or replace function public.fin_book_has_records(p_book_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t text; v boolean;
begin
  foreach t in array array['fin_jobs', 'fin_invoices', 'fin_payments', 'fin_credit_memos', 'fin_refunds', 'fin_vendor_bills',
                           'fin_expenses', 'fin_commitments', 'fin_documents', 'fin_vendors', 'fin_bank_transactions'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select exists (select 1 from public.%I where book_id = $1)', t) into v using p_book_id;
      if v then return true; end if;
    end if;
  end loop;
  return false;
end $$;
revoke execute on function public.fin_book_has_records(uuid) from public, anon, authenticated;

commit;
