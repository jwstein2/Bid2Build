/** Shapes returned by sales_my_overview() and admin_sales_hub(). */
export interface RepCustomer {
  business: string | null; email: string | null; tier: string; plan: string | null; sub_status: string | null;
  signed_up_at: string | null; attributed_at: string; first_paid_at: string | null; last_paid_at: string | null;
  basis_cents: number | null; has_estimate: boolean; ended: boolean; next_anniversary: string | null;
}
export interface RepCommission {
  id: string; business: string | null; email: string | null; year_no: number; kind: string; period_month: string;
  amount_cents: number; status: string; reason: string | null; paid_at: string | null;
}
export interface RepStatement { id: string; period_month: string; status: string; total_cents: number; line_count: number; paid_at: string | null; paid_on: string | null; method: string | null }
export interface RepOverview {
  rep: { id: string; full_name: string; role: string; code: string };
  policy: { annual_basis: string; refund_policy: string; value_scope: string; commission_years: number; confirmed: boolean };
  funnel: { visits: number; visits_30d: number; signups: number; activated: number; installs: number; paying: number; purchased: number; canceled: number };
  customers: RepCustomer[];
  commissions: RepCommission[];
  statements: RepStatement[];
}

export interface HubRep {
  id: string; email: string; full_name: string; phone: string | null; role: "rep" | "manager"; status: string; code: string; payout_note: string | null;
  linked: boolean; created_at: string; activated_at: string | null; visits: number; signups: number; paying: number;
  earned_cents: number; pending_cents: number; paid_cents: number;
}
export interface HubAttribution {
  user_id: string; email: string | null; business: string | null; rep_id: string; rep_name: string; source: string; attributed_at: string;
  tier: string; plan: string | null; sub_status: string | null; basis_cents: number | null; first_paid_at: string | null; ended_at: string | null; ended_reason: string | null;
}
export interface HubCommission {
  id: string; rep_id: string; rep_name: string; email: string | null; business: string | null; year_no: number; kind: string; period_month: string;
  amount_cents: number; status: string; reason: string | null; statement_id: string | null; stripe_invoice_id: string | null; created_at: string;
}
export interface HubStatement {
  id: string; rep_id: string; rep_name: string; payout_note: string | null; period_month: string; status: string; total_cents: number; line_count: number;
  approved_at: string | null; paid_at: string | null; payout: { method: string; reference: string | null; paid_on: string; amount_cents: number } | null;
}
export interface HubSettings {
  annual_basis: string; refund_policy: string; value_scope: string; commission_years: number; attribution_window_days: number;
  time_zone: string; policy_confirmed_at: string | null; updated_at: string;
  /** V8 addendum: a customer who cancels within a month of first paying earns the rep nothing. Missing before 20270110001000. */
  first_month_cancel_voids?: boolean;
}
export interface Hub { settings: HubSettings; reps: HubRep[]; attributions: HubAttribution[]; commissions: HubCommission[]; statements: HubStatement[] }
