/**
 * Plain-language view of financial audit entries (pure, unit-tested). Details arrive already redacted by
 * public.fin_redact; this only labels them. Unknown actions still show, with their raw action name.
 */
type Row = Record<string, unknown>;

export const AUDIT_GROUPS = [
  { key: "invoices", label: "Invoices", prefix: "invoice." },
  { key: "payments", label: "Payments", prefix: "payment." },
  { key: "bills", label: "Bills", prefix: "bill." },
  { key: "expenses", label: "Expenses", prefix: "expense." },
  { key: "costs", label: "Classification", prefix: "cost." },
  { key: "bank", label: "Bank & reconciliation", prefix: "bank." },
  { key: "exports", label: "Exports", prefix: "export." },
  { key: "seats", label: "Seats & access", prefix: "seat." },
] as const;

const TITLES: Record<string, string> = {
  "bank.account_added": "Bank account added", "bank.account_updated": "Bank account updated", "bank.imported": "Bank statement imported",
  "bank.matched": "Bank line matched", "bank.unmatched": "Bank match undone", "bank.reconciled": "Bank period confirmed", "bank.reconciliation_reopened": "Bank period reopened",
  "cost.filled": "Classification filled in", "expense.recorded": "Expense recorded", "expense.duplicate": "Expense voided as a duplicate",
  "invoice.issued": "Invoice issued", "invoice.voided": "Invoice voided", "payment.recorded": "Payment recorded", "payment.voided": "Payment voided",
  "bill.recorded": "Bill recorded", "bill.approved": "Bill approved", "bill.voided": "Bill voided",
};
const FIELD_LABELS: Record<string, string> = { jobId: "Project", vendorId: "Vendor", costCodeId: "Cost code", scopeSectionId: "Scope section", receiptDocumentId: "Receipt" };
const FACTS: Record<string, string> = { amount: "Amount", number: "Number", reason: "Reason", account: "Account", file: "File", rows: "Lines", inserted: "New", skipped: "Skipped", periodEnd: "Period end",
  statement: "Statement balance", bank: "Bank balance", difference: "Difference", unmatched: "Unmatched", status: "Status", target: "Matched to", date: "Date", from: "From", to: "To", basis: "Basis", name: "Name", kind: "Type" };

const show = (v: unknown) => v === null || v === undefined || v === "" ? "empty" : typeof v === "object" ? JSON.stringify(v) : String(v);
const titleCase = (a: string) => a.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function auditSummary(action: string, details: Row | null): { title: string; changes: { field: string; before: string; after: string }[]; facts: string[] } {
  const d = details ?? {};
  const title = TITLES[action] ?? (action.startsWith("export.") ? `Exported ${action.slice(7).replace(/_/g, " ")}` : titleCase(action));
  const changes: { field: string; before: string; after: string }[] = [];
  const prev = d.previous as Row | undefined, next = d.new as Row | undefined;
  if (prev && next && typeof prev === "object" && typeof next === "object") {
    for (const k of Object.keys(next)) {
      if (next[k] === undefined || next[k] === null || next[k] === "") continue;
      changes.push({ field: FIELD_LABELS[k] ?? k, before: show(prev[k]), after: show(next[k]) });
    }
  }
  const facts = Object.entries(d)
    .filter(([k, v]) => k in FACTS && v !== null && v !== undefined && v !== "" && typeof v !== "object")
    .map(([k, v]) => `${FACTS[k]}: ${String(v)}`);
  return { title, changes, facts };
}
