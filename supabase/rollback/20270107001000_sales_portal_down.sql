-- Rollback for 20270107001000_sales_portal.sql. Deletes ALL sales staff, attributions, commissions,
-- statements and payout records. Export what you need from the Sales Hub first. Customer accounts,
-- subscriptions and the customer referral program are untouched.
drop function if exists public.sales_me(), public.sales_my_overview(), public.sales_policy(),
  public.admin_sales_close_month(uuid), public.admin_sales_settings_save(uuid, text, text, text, integer, integer, boolean),
  public.admin_sales_payout_record(uuid, uuid, text, text, date), public.admin_sales_statement_approve(uuid, uuid),
  public.admin_sales_commission_set(uuid, uuid, text, integer, text), public.admin_sales_attribution_end(uuid, uuid, text),
  public.admin_sales_attribution_set(uuid, text, uuid, text), public.admin_sales_rep_save(uuid, uuid, text, text, text, text, text, text),
  public.admin_sales_hub(uuid), public.sales_require_admin(uuid), public.sales_close_month(timestamptz),
  public.sales_invoice_refunded(text, boolean, timestamptz),
  public.sales_sync_billing(uuid, text, text, text, uuid, integer, jsonb, text, integer, timestamptz),
  public.sales_record_milestone(uuid, text), public.sales_record_attribution(uuid, text, timestamptz), public.sales_log_visit(text),
  public.sales_audit(uuid, text, text, text, jsonb), public.sales_statement_refresh(uuid), public.sales_tier(uuid),
  public.sales_new_code(), public.sales_month_of(timestamptz);
drop table if exists public.sales_payouts, public.sales_commissions, public.sales_statements, public.sales_attribution_history,
  public.sales_attributions, public.sales_link_events, public.sales_reps, public.sales_settings;
