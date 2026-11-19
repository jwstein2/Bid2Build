/**
 * Business overhead: costs that belong to the company, not a customer project (rent, insurance, software...).
 *
 * Overhead uses the records Financials already has, so it shows up everywhere costs do:
 * - an overhead bill is a vendor bill whose lines have no project (job_id null). Profit & Loss already counts
 *   costs with no project as overhead, the cash-flow forecast already counts approved unpaid bills by due date,
 *   and bank matching already matches bill payments (so a matched payment never creates a second expense).
 * - a recurring overhead cost is a planned cash event (kind recurring_expense) tagged in its note, so future
 *   months appear in the cash-flow forecast. Entering the actual bill for a month moves that plan to the next
 *   date, so the same month is never counted twice.
 */

export const OVERHEAD_CATEGORIES = [
  { key: "rent_utilities", label: "Office rent & utilities" },
  { key: "insurance", label: "Insurance" },
  { key: "software", label: "Software & subscriptions" },
  { key: "vehicle", label: "Vehicles & fuel" },
  { key: "admin_payroll", label: "Office & admin payroll" },
  { key: "office_supplies", label: "Office supplies" },
  { key: "telecom", label: "Internet & phone" },
  { key: "professional", label: "Accounting, legal & professional fees" },
  { key: "marketing", label: "Marketing & advertising" },
  { key: "other", label: "Other business cost" },
] as const;
export type OverheadCategory = (typeof OVERHEAD_CATEGORIES)[number]["key"];
export const isOverheadCategory = (k: unknown): k is OverheadCategory => OVERHEAD_CATEGORIES.some((c) => c.key === k);
export const overheadCategoryLabel = (k: string | null | undefined) => OVERHEAD_CATEGORIES.find((c) => c.key === k)?.label ?? "Other business cost";

export type Recurrence = "none" | "weekly" | "biweekly" | "monthly";
export const RECURRENCE_LABEL: Record<Recurrence, string> = { none: "One time", weekly: "Every week", biweekly: "Every 2 weeks", monthly: "Every month" };

/** Bill line description: "Category: what it was for". The category stays readable in every list and export. */
export function overheadLine(category: OverheadCategory, description: string) {
  const what = description.trim();
  const label = overheadCategoryLabel(category);
  return (what ? `${label}: ${what}` : label).slice(0, 500);
}

/** Reads the category back from a bill line description written by overheadLine (null if it wasn't). */
export function categoryFromLine(description: string | null | undefined): OverheadCategory | null {
  if (!description) return null;
  const c = OVERHEAD_CATEGORIES.find((x) => description === x.label || description.startsWith(`${x.label}: `));
  return c ? c.key : null;
}

/** Note on a recurring overhead plan: "overhead:<category>:<vendorId>". Lets the page prefill the next bill. */
export const recurringNote = (category: OverheadCategory, vendorId: string) => `overhead:${category}:${vendorId}`;
export function parseRecurringNote(note: string | null | undefined): { category: OverheadCategory; vendorId: string } | null {
  const m = /^overhead:([a-z_]+):([0-9a-f-]{36})$/.exec(note ?? "");
  return m && isOverheadCategory(m[1]) ? { category: m[1], vendorId: m[2] } : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** The next date after `day` for a repeating cost (monthly keeps the day of the month, clamped to month end). */
export function nextOccurrence(day: string, recurrence: Exclude<Recurrence, "none">): string {
  const [y, m, d] = day.split("-").map(Number);
  if (recurrence !== "monthly") {
    const t = new Date(Date.UTC(y, m - 1, d + (recurrence === "weekly" ? 7 : 14)));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}

export type PayStatus = "unpaid" | "partial" | "paid";
/** Paid / partly paid / unpaid from a bill's total and what has been paid on it. */
export function payStatus(total: number, paid: number): PayStatus {
  if (paid <= 0) return "unpaid";
  return paid + 0.005 >= total ? "paid" : "partial";
}
export const PAY_STATUS_LABEL: Record<PayStatus, string> = { unpaid: "Unpaid", partial: "Partly paid", paid: "Paid" };

/** A reference number for a bill that didn't come with one (vendor bills need one to catch duplicates). */
export const autoReference = (billDate: string, rand = Math.random()) => `OH-${billDate.replace(/-/g, "")}-${Math.floor(rand * 46656).toString(36).padStart(3, "0").toUpperCase()}`;
