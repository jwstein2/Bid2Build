/**
 * Accountant Mode (pure, unit-tested): bank statement parsing, match suggestions, duplicate checks, AP aging,
 * the transaction ledger filter, the reports catalog and the accountant quick actions.
 *
 * Ground rules (V6.3):
 *   - Nothing here changes a record. Suggestions are only suggestions: a person confirms every match.
 *   - Bank lines are what the bank reported. They are never edited; mistakes on our side are fixed on our records.
 *   - There is no general ledger yet. Reports that need one (balance sheet, trial balance, cash flow statement,
 *     GL detail) are listed as blocked with what they need, never shown as numbers.
 * Money stays as decimal strings (./money).
 */
import { add, cmp, sub } from "./money";
import type { FinPermission } from "./permissions";

// ---- Bank statement files ---------------------------------------------------------------------------------------
export interface StatementRow { date: string; description: string; amount: string; checkNumber?: string; ref?: string }
export interface ParsedStatement { rows: StatementRow[]; errors: string[]; format: "csv" | "ofx"; start: string | null; end: string | null; endingBalance: string | null }

const MAX_ROWS = 5000;

/** Split one CSV line (quotes, doubled quotes, commas inside quotes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 2026-11-02, 11/02/2026, 11/2/26, 20261102 → 2026-11-02 (US month-first). Invalid → null. */
export function parseBankDate(s: string): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t))) { m = +r[1]; d = +r[2]; y = r[3].length === 2 ? 2000 + +r[3] : +r[3]; }
  else if ((r = /^(\d{4})(\d{2})(\d{2})/.exec(t))) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1990 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** "$1,234.56" / "(12.00)" / "-12" / "12.00 CR" → signed 2-decimal string. Invalid or more than 2 decimals → null. */
export function parseBankAmount(s: string): string | null {
  let t = s.trim().replace(/[$\s,]/g, "");
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/DR$/i.test(t)) { neg = true; t = t.slice(0, -2); } else if (/CR$/i.test(t)) t = t.slice(0, -2);
  if (t.startsWith("-")) { neg = !neg; t = t.slice(1); } else if (t.startsWith("+")) t = t.slice(1);
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return null;
  const v = add(t);
  return neg && cmp(v, 0) !== 0 ? sub(0, v) : v;
}

const HEADERS = {
  date: ["date", "posted date", "posting date", "transaction date", "post date", "posted"],
  description: ["description", "memo", "payee", "name", "details", "transaction description", "merchant"],
  amount: ["amount", "transaction amount", "amt"],
  debit: ["debit", "withdrawal", "withdrawals", "money out", "debit amount", "payments"],
  credit: ["credit", "deposit", "deposits", "money in", "credit amount"],
  check: ["check number", "check #", "check no", "check", "cheque number", "chk"],
  ref: ["reference", "ref", "transaction id", "id", "fitid", "bank reference", "reference number"],
};
const findCol = (h: string[], names: string[]) => h.findIndex((x) => names.includes(x.toLowerCase().replace(/\s+/g, " ").trim()));

/** Parse a bank's CSV export or an OFX/QFX file into statement rows. Rows that can't be read are listed, never guessed. */
export function parseStatement(text: string): ParsedStatement {
  const body = text.replace(/^﻿/, "");
  if (/<OFX>|<STMTTRN>/i.test(body)) return parseOfx(body);
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  const errors: string[] = [];
  // Some banks put account info above the header row: use the first line that has a date column.
  const hi = lines.findIndex((l) => findCol(splitCsvLine(l), HEADERS.date) >= 0);
  if (hi < 0) return { rows: [], errors: ["No header row with a Date column was found. Export the statement as CSV with headers."], format: "csv", start: null, end: null, endingBalance: null };
  const h = splitCsvLine(lines[hi]);
  const c = { date: findCol(h, HEADERS.date), desc: findCol(h, HEADERS.description), amt: findCol(h, HEADERS.amount), debit: findCol(h, HEADERS.debit), credit: findCol(h, HEADERS.credit), check: findCol(h, HEADERS.check), ref: findCol(h, HEADERS.ref) };
  if (c.desc < 0) errors.push("No Description column was found.");
  if (c.amt < 0 && c.debit < 0 && c.credit < 0) errors.push("No Amount (or Debit/Credit) column was found.");
  if (errors.length) return { rows: [], errors, format: "csv", start: null, end: null, endingBalance: null };
  const rows: StatementRow[] = [];
  for (let i = hi + 1; i < lines.length; i++) {
    const v = splitCsvLine(lines[i]);
    const date = parseBankDate(v[c.date] ?? "");
    const description = (v[c.desc] ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    let amount: string | null = null;
    if (c.amt >= 0 && (v[c.amt] ?? "").trim()) amount = parseBankAmount(v[c.amt]);
    else {
      const dr = c.debit >= 0 && (v[c.debit] ?? "").trim() ? parseBankAmount(v[c.debit]) : null;
      const cr = c.credit >= 0 && (v[c.credit] ?? "").trim() ? parseBankAmount(v[c.credit]) : null;
      // Debit columns are money out whatever sign the bank printed.
      if (dr && cmp(dr, 0) !== 0) amount = cmp(dr, 0) > 0 ? sub(0, dr) : dr;
      else if (cr && cmp(cr, 0) !== 0) amount = cmp(cr, 0) < 0 ? sub(0, cr) : cr;
    }
    if (!date || !description || !amount || cmp(amount, 0) === 0) { errors.push(`Line ${i + 1}: couldn't read the date, description or amount, so it was left out.`); continue; }
    rows.push({ date, description, amount, checkNumber: c.check >= 0 ? (v[c.check] || undefined)?.slice(0, 20) : undefined, ref: c.ref >= 0 ? (v[c.ref] || undefined)?.slice(0, 80) : undefined });
    if (rows.length > MAX_ROWS) { errors.push(`More than ${MAX_ROWS} lines: split the file by month.`); return { rows: [], errors, format: "csv", start: null, end: null, endingBalance: null }; }
  }
  const dates = rows.map((r) => r.date).sort();
  return { rows, errors, format: "csv", start: dates[0] ?? null, end: dates[dates.length - 1] ?? null, endingBalance: null };
}

function parseOfx(text: string): ParsedStatement {
  const tag = (block: string, t: string) => new RegExp(`<${t}>([^<\\r\\n]*)`, "i").exec(block)?.[1]?.trim() ?? "";
  const rows: StatementRow[] = [];
  const errors: string[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  blocks.forEach((b, i) => {
    const date = parseBankDate(tag(b, "DTPOSTED"));
    const amount = parseBankAmount(tag(b, "TRNAMT"));
    const description = [tag(b, "NAME"), tag(b, "MEMO")].filter(Boolean).join(" · ").replace(/\s+/g, " ").slice(0, 300);
    if (!date || !amount || !description || cmp(amount, 0) === 0) { errors.push(`Transaction ${i + 1}: couldn't read the date, description or amount, so it was left out.`); return; }
    rows.push({ date, description, amount, checkNumber: tag(b, "CHECKNUM") || undefined, ref: tag(b, "FITID").slice(0, 80) || undefined });
  });
  if (rows.length > MAX_ROWS) return { rows: [], errors: [`More than ${MAX_ROWS} lines: split the file by month.`], format: "ofx", start: null, end: null, endingBalance: null };
  const ledger = /<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i.exec(text)?.[1];
  return {
    rows, errors, format: "ofx",
    start: parseBankDate(tag(text, "DTSTART")) ?? rows.map((r) => r.date).sort()[0] ?? null,
    end: parseBankDate(tag(text, "DTEND")) ?? rows.map((r) => r.date).sort().at(-1) ?? null,
    endingBalance: ledger ? parseBankAmount(ledger) : null,
  };
}

// ---- Matching ---------------------------------------------------------------------------------------------------
export type MatchTarget = "payment" | "refund" | "bill_payment" | "expense";
export interface BankLine { id: string; posted_on: string; description: string; amount: string; check_number: string | null; account_id: string }
/** A record that money moved for, with the amount signed the way the bank sees it (+ in, - out). */
export interface MatchCandidate { type: MatchTarget; id: string; date: string; amount: string; label: string; reference?: string | null }
export interface Suggestion extends MatchCandidate { days: number; why: string }

const dayDiff = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
export const SUGGEST_WINDOW_DAYS = 5;

/** Same amount and direction, within 5 days (or the same check number at any date). Closest first, at most 3. */
export function suggestMatches(line: BankLine, candidates: MatchCandidate[], taken: Set<string> = new Set()): Suggestion[] {
  return candidates
    .filter((c) => !taken.has(`${c.type}:${c.id}`) && cmp(c.amount, line.amount) === 0)
    .map((c) => {
      const days = dayDiff(c.date, line.posted_on);
      const sameCheck = Boolean(line.check_number && c.reference && c.reference.replace(/\D/g, "") === line.check_number.replace(/\D/g, ""));
      return { ...c, days, sameCheck };
    })
    .filter((c) => c.sameCheck || c.days <= SUGGEST_WINDOW_DAYS)
    .sort((a, b) => Number(b.sameCheck) - Number(a.sameCheck) || a.days - b.days)
    .slice(0, 3)
    .map(({ sameCheck, ...c }) => ({ ...c, why: sameCheck ? `Check #${line.check_number}, same amount` : c.days === 0 ? "Same amount, same day" : `Same amount, ${c.days} day${c.days === 1 ? "" : "s"} apart` }));
}

/** Unmatched bank lines that look like the same transaction twice (same account, amount, description, within 3 days). */
export function possibleDuplicateLines(lines: BankLine[]): string[][] {
  const groups = new Map<string, BankLine[]>();
  for (const l of lines) {
    const k = `${l.account_id}|${l.amount}|${l.description.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const out: string[][] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => a.posted_on.localeCompare(b.posted_on));
    const cluster = sorted.filter((l, i) => sorted.some((o, j) => j !== i && dayDiff(o.posted_on, l.posted_on) <= 3));
    if (cluster.length > 1) out.push(cluster.map((l) => l.id));
  }
  return out;
}

// ---- Aging --------------------------------------------------------------------------------------------------------
export const AGING_BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const AGING_LABELS: Record<AgingBucket, string> = { current: "Not due yet", "1_30": "1–30 days", "31_60": "31–60 days", "61_90": "61–90 days", over_90: "Over 90 days" };
export const bucketFor = (dueDate: string | null, today: string): AgingBucket => {
  if (!dueDate || dueDate >= today) return "current";
  const d = dayDiff(dueDate, today);
  return d <= 30 ? "1_30" : d <= 60 ? "31_60" : d <= 90 ? "61_90" : "over_90";
};
export interface AgingRow { id: string; party: string; number: string; due_date: string | null; balance: string }
export function agingTotals<T extends AgingRow>(rows: T[], today: string): { byBucket: Record<AgingBucket, string>; byParty: { party: string; buckets: Record<AgingBucket, string>; total: string }[]; total: string } {
  const zero = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b, "0.00"])) as Record<AgingBucket, string>;
  const byBucket = zero();
  const parties = new Map<string, Record<AgingBucket, string>>();
  for (const r of rows) {
    const b = bucketFor(r.due_date, today);
    byBucket[b] = add(byBucket[b], r.balance);
    const p = parties.get(r.party) ?? zero();
    p[b] = add(p[b], r.balance);
    parties.set(r.party, p);
  }
  const byParty = [...parties.entries()].map(([party, buckets]) => ({ party, buckets, total: add(...Object.values(buckets)) })).sort((a, b) => cmp(b.total, a.total));
  return { byBucket, byParty, total: add(...Object.values(byBucket)) };
}

// ---- Transaction ledger ------------------------------------------------------------------------------------------
export type TxnSource = "invoice" | "credit_memo" | "payment" | "refund" | "bill" | "bill_payment" | "expense" | "bank";
export const TXN_SOURCE_LABELS: Record<TxnSource, string> = {
  invoice: "Invoice", credit_memo: "Credit memo", payment: "Customer payment", refund: "Refund", bill: "Vendor bill", bill_payment: "Bill payment", expense: "Expense", bank: "Bank line",
};
export type Posting = "draft" | "pending" | "posted" | "void" | "rejected";
export const POSTING_LABELS: Record<Posting, string> = { draft: "Draft", pending: "Pending approval", posted: "Posted", void: "Voided", rejected: "Rejected" };
export type Recon = "matched" | "unmatched" | "reconciled" | "n_a";
export const RECON_LABELS: Record<Recon, string> = { matched: "Matched to bank", unmatched: "Not matched", reconciled: "Reconciled", n_a: "—" };

export interface Txn {
  key: string; source: TxnSource; id: string; date: string; number: string; description: string;
  /** Where it sits: Receivables, Payables, a bank account, or how it was paid when not matched yet. */
  account: string;
  category: string; direction: "in" | "out" | "none"; amount: string;
  party: string | null; jobId: string | null; project: string | null;
  posting: Posting; recon: Recon; documents: number; href: string | null;
}
export interface TxnFilter { q?: string; source?: TxnSource | ""; posting?: Posting | ""; recon?: Recon | ""; job?: string; from?: string; to?: string; dir?: "in" | "out" | "" }

export function filterTxns(rows: Txn[], f: TxnFilter): Txn[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return rows.filter((r) =>
    (!f.source || r.source === f.source) && (!f.posting || r.posting === f.posting) && (!f.recon || r.recon === f.recon)
    && (!f.dir || r.direction === f.dir) && (!f.job || (f.job === "none" ? !r.jobId : r.jobId === f.job))
    && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to)
    && (!q || `${r.number} ${r.description} ${r.party ?? ""} ${r.project ?? ""} ${r.account} ${r.category} ${r.amount}`.toLowerCase().includes(q)),
  ).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
}

// ---- Reports catalog -------------------------------------------------------------------------------------------------
export type ReportStatus = "available" | "blocked";
export interface CatalogReport { key: string; label: string; description: string; status: ReportStatus; href?: string; needs: FinPermission; keywords: string; blockedBy?: string; csv?: string }

export const REPORT_CATALOG: CatalogReport[] = [
  { key: "profit_loss", label: "Profit & Loss", description: "Money in and out by month, quarter or year, by project and trade. Cash or billed basis.", status: "available", href: "/financials/reports", needs: "view_company_financials", keywords: "p&l income statement profit loss revenue costs" },
  { key: "ar_aging", label: "Accounts Receivable Aging", description: "What customers owe, by how late it is.", status: "available", href: "/financials/receivables", needs: "view_company_financials", keywords: "ar receivables aging customers owe overdue", csv: "ar_aging" },
  { key: "ap_aging", label: "Accounts Payable Aging", description: "Approved vendor and subcontractor bills not yet paid, by how late they are.", status: "available", href: "/financials/accounting/reports?r=ap_aging", needs: "view_company_financials", keywords: "ap payables aging bills vendors owe", csv: "ap_aging" },
  { key: "customer_balances", label: "Customer Balances", description: "Invoiced, paid, credited and still owed per customer, plus payments not yet applied.", status: "available", href: "/financials/accounting/reports?r=customer_balances", needs: "view_company_financials", keywords: "customers balances statement owed", csv: "customer_balances" },
  { key: "job_costing", label: "Job Costing", description: "Budget, committed, actual and variance per project and trade. Each is its own column.", status: "available", href: "/financials/accounting/reports?r=job_costing", needs: "view_company_financials", keywords: "job cost budget committed actual variance projects wip", csv: "job_costing" },
  { key: "labor_variance", label: "Labor Cost Variance", description: "Estimated labor vs labor costs recorded, per project. Time-clock hours are listed beside it; Built2Bid doesn't run payroll.", status: "available", href: "/financials/accounting/reports?r=labor_variance", needs: "view_company_financials", keywords: "labor variance payroll crew hours", csv: "labor_variance" },
  { key: "expenses_by_category", label: "Expenses by Category", description: "Approved bills and expenses by category (materials, labor, subs...), billed basis.", status: "available", href: "/financials/accounting/reports?r=expenses_by_category", needs: "view_company_financials", keywords: "expenses category spend costs", csv: "expenses_by_category" },
  { key: "sub_payments", label: "Subcontractor Payments", description: "What you paid each subcontractor (bill payments and expenses), with a link to the 1099 totals.", status: "available", href: "/financials/accounting/reports?r=sub_payments", needs: "view_company_financials", keywords: "subcontractor payments 1099 vendors paid", csv: "sub_payments" },
  { key: "transactions", label: "Transaction Ledger", description: "Every invoice, payment, refund, credit, bill, bill payment and expense in one searchable list.", status: "available", href: "/financials/accounting/transactions", needs: "view_company_financials", keywords: "transactions ledger register list journal", csv: "transactions" },
  { key: "reconciliations", label: "Bank Reconciliation History", description: "Confirmed periods per bank account, with the statement balance, bank balance and any difference.", status: "available", href: "/financials/accounting/bank", needs: "view_company_financials", keywords: "bank reconciliation history periods", csv: "reconciliations" },
  { key: "audit_trail", label: "Audit Trail", description: "Who did what and when, with previous and new values.", status: "available", href: "/financials/accounting/audit", needs: "view_company_financials", keywords: "audit log history changes who", csv: "audit_trail" },
  { key: "balance_sheet", label: "Balance Sheet", description: "Assets, liabilities and equity at a date, from the general ledger.", status: "available", href: "/financials/accounting/ledger?v=balance", needs: "view_company_financials", keywords: "balance sheet assets liabilities equity", csv: "gl_balance_sheet" },
  { key: "trial_balance", label: "Trial Balance", description: "Every account's debit and credit balance at a date.", status: "available", href: "/financials/accounting/ledger?v=trial", needs: "view_company_financials", keywords: "trial balance debits credits", csv: "gl_trial_balance" },
  { key: "income_statement", label: "Income Statement (accrual)", description: "Income, job costs and expenses for a period from the general ledger.", status: "available", href: "/financials/accounting/ledger?v=income", needs: "view_company_financials", keywords: "income statement profit loss accrual gl", csv: "gl_income_statement" },
  { key: "cash_flow", label: "Cash Flow Statement", description: "Operating, investing and financing cash flows.", status: "blocked", needs: "view_company_financials", keywords: "cash flow statement operating investing financing", blockedBy: "The general ledger is in; the cash flow statement needs account classifications (operating, investing, financing) reviewed by a CPA. The cash-basis P&L shows money in and out today." },
  { key: "general_ledger", label: "General Ledger detail", description: "Every journal line per account with running balances.", status: "available", href: "/financials/accounting/ledger?v=detail", needs: "view_company_financials", keywords: "general ledger gl postings journal", csv: "general_ledger" },
];

export function searchCatalog(q: string, perms: readonly string[]): CatalogReport[] {
  const t = q.trim().toLowerCase();
  return REPORT_CATALOG.filter((r) => perms.includes(r.needs) && (!t || `${r.label} ${r.description} ${r.keywords}`.toLowerCase().includes(t)));
}

// ---- Accountant quick actions -----------------------------------------------------------------------------------------
export interface AccountantAction { key: string; label: string; href: string; needs: readonly FinPermission[]; hint: string }
/** Each opens a real page. Shown only when the person has every permission listed (the page checks again). */
export const ACCOUNTANT_ACTIONS: AccountantAction[] = [
  { key: "reconcile", label: "Reconcile bank", href: "/financials/accounting/bank", needs: ["reconcile"], hint: "Match statement lines and confirm a period" },
  { key: "uncategorized", label: "Review uncategorized", href: "/financials/accounting?kind=uncategorized", needs: ["view_company_financials"], hint: "Costs missing a project or cost code" },
  { key: "bills", label: "Review bills", href: "/financials/accounting?kind=bills", needs: ["view_company_financials"], hint: "Bills waiting for approval or past due" },
  { key: "ar", label: "Review AR", href: "/financials/receivables", needs: ["view_company_financials"], hint: "What customers owe, by age" },
  { key: "pl", label: "Generate P&L", href: "/financials/reports", needs: ["view_company_financials"], hint: "Profit & Loss for any period" },
  { key: "export_ledger", label: "Export general ledger", href: "/api/financials/export?kind=general_ledger", needs: ["view_company_financials", "export_financials"], hint: "CSV of every journal line by account" },
  { key: "duplicates", label: "Review duplicate transactions", href: "/financials/accounting?kind=duplicates", needs: ["view_company_financials"], hint: "Possible duplicate expenses and bank lines" },
  { key: "audit", label: "Review audit trail", href: "/financials/accounting/audit", needs: ["view_company_financials"], hint: "Who changed what, and when" },
  { key: "payroll", label: "Review payroll costs", href: "/financials/accounting/reports?r=labor_variance", needs: ["view_company_financials"], hint: "Labor costs vs estimate, with time-clock hours" },
];
export const accountantActionsFor = (perms: readonly string[]) => ACCOUNTANT_ACTIONS.filter((a) => a.needs.every((p) => perms.includes(p)));

/** Accountant Mode navigation (each page re-checks access). */
export const ACCOUNTANT_NAV = [
  { key: "queue", label: "Review queue", href: "/financials/accounting" },
  { key: "transactions", label: "Transactions", href: "/financials/accounting/transactions" },
  { key: "bank", label: "Reconciliation", href: "/financials/accounting/bank" },
  { key: "arap", label: "AR / AP", href: "/financials/accounting/reports?r=ap_aging" },
  { key: "ledger", label: "General ledger", href: "/financials/accounting/ledger" },
  { key: "accounts", label: "Chart of accounts", href: "/financials/accounting/accounts" },
  { key: "reports", label: "Reports", href: "/financials/accounting/reports" },
  { key: "audit", label: "Audit trail", href: "/financials/accounting/audit" },
] as const;
export type AccountantNavKey = (typeof ACCOUNTANT_NAV)[number]["key"];

// ---- Review queue ---------------------------------------------------------------------------------------------------
export const QUEUE_KINDS = ["uncategorized", "unmatched_bank", "duplicates", "unapplied", "bills", "unbalanced_imports", "missing_job", "recon_differences"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];
export const QUEUE_LABELS: Record<QueueKind, { title: string; hint: string; action: string }> = {
  uncategorized: { title: "Uncategorized costs", hint: "Expenses and bill lines on a project with no cost code.", action: "Pick a cost code" },
  unmatched_bank: { title: "Unmatched bank lines", hint: "Statement lines not yet matched to a record or excluded.", action: "Match or exclude" },
  duplicates: { title: "Possible duplicates", hint: "Expenses flagged as possible duplicates, and bank lines that appear twice.", action: "Keep one, or mark it real" },
  unapplied: { title: "Payments not applied", hint: "Customer payments with money not applied to an invoice.", action: "Apply to an invoice" },
  bills: { title: "Bills needing review", hint: "Vendor bills waiting for approval, or approved and past due.", action: "Approve or record payment" },
  unbalanced_imports: { title: "Statement imports that don't balance", hint: "Opening balance + lines ≠ the statement's ending balance. Check the file covers the whole statement.", action: "Check the statement" },
  missing_job: { title: "Costs missing a project", hint: "Expenses not tied to any project (fine for overhead, but check).", action: "Assign a project or leave as overhead" },
  recon_differences: { title: "Reconciliation differences", hint: "Periods confirmed with a difference or unmatched lines.", action: "Review the note or reopen" },
};
