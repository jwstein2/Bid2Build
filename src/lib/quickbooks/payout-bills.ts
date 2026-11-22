/**
 * Pure helpers for QuickBooks payouts (admin side): turn a sales-rep or affiliate payee into a 1099 vendor and an
 * approved statement / commission into a bill. No server-only imports, so they can be unit tested.
 */

export interface Payee {
  payeeName: string; givenName?: string | null; familyName?: string | null; email?: string | null; phone?: string | null;
  line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null;
}

/** QuickBooks display names can't hold a colon, tab or line break and are at most 100 characters. */
export function displayName(name: string, suffix = ""): string {
  const clean = name.replace(/[:\t\r\n]+/g, " ").replace(/\s+/g, " ").trim() || "Built2Bid payee";
  return `${clean.slice(0, 100 - suffix.length)}${suffix}`;
}

/** Quotes a value for a QuickBooks query string (backslash-escapes \ and '). */
export const qbQuote = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const cut = (v: string | null | undefined, n: number) => (v && v.trim() ? v.trim().slice(0, n) : undefined);

/** A new 1099 vendor. Only contact details: Built2Bid never sends tax ids or bank numbers to QuickBooks. */
export function vendorPayload(p: Payee, suffix = ""): Record<string, unknown> {
  const addr = p.line1 ? { Line1: cut(p.line1, 500), Line2: cut(p.line2, 500), City: cut(p.city, 255), CountrySubDivisionCode: cut(p.state, 255), PostalCode: cut(p.postalCode, 30), Country: "US" } : undefined;
  const email = p.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email) ? p.email.slice(0, 100) : undefined;
  return Object.fromEntries(Object.entries({
    DisplayName: displayName(p.payeeName, suffix),
    GivenName: cut(p.givenName, 100), FamilyName: cut(p.familyName, 100),
    PrimaryEmailAddr: email ? { Address: email } : undefined,
    PrimaryPhone: cut(p.phone, 30) ? { FreeFormNumber: cut(p.phone, 30) } : undefined,
    BillAddr: addr,
    Vendor1099: true,
  }).filter(([, v]) => v !== undefined));
}

export interface BillInput { vendorId: string; accountId: string; amountCents: number; docNumber: string; description: string; txnDate: string }

/** One-line bill: the statement or commission amount booked to the owner's chosen expense account. */
export function billPayload(b: BillInput): Record<string, unknown> {
  if (!/^\d{1,32}$/.test(b.vendorId) || !/^\d{1,32}$/.test(b.accountId)) throw new Error("bad_ref");
  if (!Number.isInteger(b.amountCents) || b.amountCents <= 0) throw new Error("bad_amount");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.txnDate)) throw new Error("bad_date");
  const description = b.description.slice(0, 4000);
  return {
    VendorRef: { value: b.vendorId },
    TxnDate: b.txnDate,
    DueDate: b.txnDate,
    DocNumber: b.docNumber.slice(0, 21),
    PrivateNote: `Built2Bid ${b.docNumber}: ${description}`.slice(0, 4000),
    Line: [{
      DetailType: "AccountBasedExpenseLineDetail",
      Amount: Math.round(b.amountCents) / 100,
      Description: description,
      AccountBasedExpenseLineDetail: { AccountRef: { value: b.accountId } },
    }],
  };
}

/** A bill's state from QuickBooks: paid once nothing is left to pay. */
export function billState(bill: { Balance?: unknown; TotalAmt?: unknown } | null | undefined): "open" | "paid" | "unknown" {
  if (!bill) return "unknown";
  const bal = Number(bill.Balance);
  if (!Number.isFinite(bal)) return "unknown";
  return bal <= 0.004 ? "paid" : "open";
}

/** QuickBooks error 6240 means the display name is already used by a customer, vendor or employee. */
export const isDuplicateName = (message: string) => /6240|Duplicate Name/i.test(message);

/** Messages shown to the owner for a compliance blocker that stops a payee from being billed. */
export const QB_BLOCKER: Record<string, string> = {
  no_staff_record: "Add this rep in Staff and set them up as a 1099 contractor",
  not_active: "Not active",
  payroll_required: "W-2 employee: pay through payroll",
  classification_review: "Classification not reviewed",
  agreements_missing: "Contractor agreements not accepted",
  w9_missing: "W-9 missing",
  suspended: "Suspended",
  terminated_review: "Terminated: needs review",
  unsupported_country: "Outside the US",
  agreement_missing: "Affiliate agreement not accepted",
  no_affiliate: "Affiliate not found",
};
