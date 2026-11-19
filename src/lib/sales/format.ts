/** Display helpers shared by the sales portal and the owner Sales Hub. */
export const usd = (cents: number | null | undefined) => ((cents ?? 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const dateLabel = (s: string | null | undefined) => {
  if (!s) return "—";
  // A plain date (YYYY-MM-DD, e.g. a payout date) is a calendar day: never shift it by time zone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
};
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const METHOD_LABEL: Record<string, string> = { ach: "Bank transfer", check: "Check", payroll: "Payroll", paypal: "PayPal", other: "Other" };
/** "2027-03-01" -> "Mar 2027" (a calendar month, so no time zone shift). */
export const monthLabel = (m: string | null | undefined) => {
  if (!m) return "—";
  const [y, mo] = m.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};
export const currentMonthChicago = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value, m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}-01`;
};

export type Tone = "neutral" | "ok" | "warn" | "danger" | "brand" | "accent";
export const COMMISSION_STATUS: Record<string, { label: string; tone: Tone; help: string }> = {
  pending: { label: "Pending", tone: "accent", help: "Customer paid; becomes earned when the month closes." },
  earned: { label: "Earned", tone: "brand", help: "On a statement, waiting for owner approval." },
  approved: { label: "Approved", tone: "brand", help: "Approved for payout." },
  paid: { label: "Paid", tone: "ok", help: "Paid out." },
  ineligible: { label: "Ineligible", tone: "neutral", help: "Did not qualify (for example, no payment in the anniversary month)." },
  canceled: { label: "Canceled", tone: "neutral", help: "Canceled by the owner." },
  reversed: { label: "Reversed", tone: "danger", help: "The payment was refunded." },
};
export const TIER_LABEL: Record<string, string> = { free: "Free", trial: "Trial", standard: "Unlimited", enterprise: "Team (Enterprise)", complimentary: "Complimentary" };
export const REASON_LABEL: Record<string, string> = {
  no_paid_invoice_in_anniversary_month: "No payment in the anniversary month",
  invoice_refunded: "Payment refunded",
  invoice_refunded_after_payout: "Refunded after payout (deducted)",
  attribution_ended: "Attribution ended",
  rep_removed: "Rep removed",
  basis_missing: "Plan price unknown: owner review",
  customer_canceled_first_month: "Customer canceled in their first month",
};
export const reasonLabel = (r: string | null | undefined) => (r ? REASON_LABEL[r] ?? r.replace(/_/g, " ") : "");
export const yearLabel = (n: number, kind = "commission") => (kind === "bonus" ? "Milestone bonus" : kind === "accelerator" ? "Monthly accelerator" : kind === "clawback" ? `Deduction (year ${n})` : n === 1 ? "Sale month" : `Year ${n} anniversary`);
