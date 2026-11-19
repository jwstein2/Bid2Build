-- Rollback for 20270117001000_sales_v84_recognition.sql. Cash reward ledger lines already created are
-- kept (they may be on approved or paid statements), so the 'reward' kind stays allowed if any exist.
drop function if exists public.admin_sales_recognition(uuid);
drop function if exists public.sales_my_rewards();
drop function if exists public.admin_sales_award_set(uuid, uuid, text, text);
drop function if exists public.admin_sales_award_propose(uuid, uuid, uuid, text, uuid, uuid, integer);
drop function if exists public.admin_sales_reward_save(uuid, uuid, text, text, text, text, integer, integer, text, text, boolean, text);
drop function if exists public.admin_sales_recognition_note(uuid, text, uuid, text);
drop function if exists public.admin_sales_success_congratulate(uuid, uuid);
drop function if exists public.admin_sales_congrats_skip(uuid, uuid);
drop function if exists public.admin_sales_congrats_result(uuid, uuid, boolean, text, text);
drop function if exists public.admin_sales_congrats_claim(uuid, uuid, text, text);
drop function if exists public.admin_sales_congrats_settings_save(uuid, boolean, text, text);
drop function if exists public.sales_my_successes_seen(uuid[]);
drop function if exists public.sales_my_successes();
drop function if exists public.sales_customer_successes_evaluate(timestamptz);
drop function if exists public.sales_my_preferences_clear();
drop function if exists public.sales_my_preferences_save(jsonb, text, boolean, boolean, boolean, text, boolean);
drop function if exists public.sales_my_preferences();
drop function if exists public.sales_preferences_valid(jsonb);
drop table if exists public.sales_reward_awards;
drop table if exists public.sales_rewards;
drop table if exists public.sales_congrats_emails;
drop table if exists public.sales_customer_successes;
drop table if exists public.sales_rep_preferences;
alter table public.sales_achievements drop column if exists admin_note;
alter table public.sales_settings drop column if exists congrats_body;
alter table public.sales_settings drop column if exists congrats_subject;
alter table public.sales_settings drop column if exists congrats_enabled;
do $$ begin
  if not exists (select 1 from public.sales_commissions where kind = 'reward') then
    alter table public.sales_commissions drop constraint if exists sales_commissions_kind_check;
    alter table public.sales_commissions add constraint sales_commissions_kind_check check (kind in ('commission', 'clawback', 'bonus', 'accelerator'));
    alter table public.sales_commissions drop constraint if exists sales_commissions_check;
    alter table public.sales_commissions add constraint sales_commissions_check
      check ((kind in ('commission', 'bonus', 'accelerator') and amount_cents >= 0) or (kind = 'clawback' and amount_cents <= 0));
  end if;
end $$;
