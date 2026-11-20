/** Plain-language labels and fee math shared by owner, finance and staff pages (no server imports). */

export const money = (cents: number | null | undefined) =>
  cents == null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const CLASSIFICATION: Record<string, string> = {
  contractor_1099: "Independent contractor (1099)",
  employee_w2: "Employee (W-2)",
  vendor: "Outside vendor / professional",
  pending_review: "Pending classification review",
};

export const STAFF_STATUS: Record<string, string> = { invited: "Invited", onboarding: "Onboarding", active: "Active", suspended: "Suspended", terminated: "Terminated" };

export const ROLE: Record<string, string> = {
  sales_admin: "Sales Administrator", sales_rep: "Sales Representative", finance: "Accounting / Finance",
  operations: "Operations / Admin staff", external_accountant: "External accountant",
};
export const ROLES = Object.keys(ROLE);

export const COMP: Record<string, string> = { commission: "Commission", hourly: "Hourly", salary: "Salary", fixed_fee: "Fixed contractor fee", bonus: "Bonus" };

export const PAYOUT_STATUS: Record<string, string> = {
  scheduled: "Scheduled", held: "On hold", needs_approval: "Needs owner approval", submitting: "Sending", submitted: "In transit",
  paid: "Paid", failed: "Failed", returned: "Returned by bank", canceled: "Canceled",
};

export const HOLD_REASON: Record<string, string> = {
  not_active: "Person isn't active", payroll_required: "W-2: pay through payroll", classification_review: "Classification not reviewed",
  agreements_missing: "Agreements not accepted", w9_missing: "W-9 not on file", no_bank: "No bank account connected",
  bank_unverified: "Bank account not verified", bank_change_hold: "New bank account in safety hold", pays_by_check: "Paid by check (manual)",
  below_minimum: "Below minimum payout", zero_amount: "Nothing to pay", over_per_payout_limit: "Over the per-payout limit",
  daily_limit: "Daily limit reached, retrying tomorrow", no_staff_record: "Not in the staff directory", insufficient_funds: "Funding balance too low",
};

export const FEE_REASON: Record<string, string> = {
  fee_policy_not_approved: "Fee schedule not approved yet", policy_company_pays: "Policy: Built2Bid pays", not_contractor: "Not a contractor",
  jurisdiction_blocked: "Fee recovery blocked in this state", no_fee_acknowledgement: "Fee disclosure not accepted", fee_exceeds_gross: "Fee would exceed the payment",
};

export interface FeePolicy { standard_fixed_cents: number; standard_bps: number; instant_fixed_cents: number; instant_bps: number; instant_min_cents: number }

/** Mirror of public.payout_fee_cents, used only to preview fees on screen. The database is authoritative. */
export function feeCents(gross: number, speed: "standard" | "instant", f: FeePolicy | null): number {
  if (!f || gross <= 0) return 0;
  if (speed === "instant") return Math.max(f.instant_fixed_cents + Math.ceil((gross * f.instant_bps) / 10000), f.instant_min_cents);
  return f.standard_fixed_cents + Math.ceil((gross * f.standard_bps) / 10000);
}

export function feeLine(f: FeePolicy | null): string {
  if (!f) return "No fee schedule set";
  const pct = f.standard_bps ? ` + ${(f.standard_bps / 100).toFixed(2)}%` : "";
  return `${money(f.standard_fixed_cents)}${pct} per standard ACH payout`;
}
