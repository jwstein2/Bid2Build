/**
 * General ledger: pure helpers (unit-tested, no I/O). The database (20270214001000_fin_general_ledger.sql) posts
 * the entries and returns per-account balances; this file turns those balances into the Trial Balance, Balance
 * Sheet and Income Statement, and validates a manual journal entry before it is sent.
 *
 * Balances come in "normal" sign: debit-normal accounts (asset, cogs, expense) as debit - credit, the rest
 * (liability, equity, income) as credit - debit. Money is handled in cents to avoid float drift.
 */
export type GlType = "asset" | "liability" | "equity" | "income" | "cogs" | "expense";
export const GL_TYPES: readonly GlType[] = ["asset", "liability", "equity", "income", "cogs", "expense"];
export const GL_TYPE_LABELS: Record<GlType, string> = {
  asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", cogs: "Cost of jobs", expense: "Operating expenses",
};
export const GL_TYPE_SINGULAR: Record<GlType, string> = {
  asset: "Asset", liability: "Liability", equity: "Equity", income: "Income", cogs: "Cost of jobs", expense: "Expense",
};
export const isDebitNormal = (t: GlType) => t === "asset" || t === "cogs" || t === "expense";

export interface GlBalance { account_id: string; code: string; name: string; type: GlType; system_key: string | null; debit: string | number; credit: string | number; balance: string | number }

const c = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
const d = (cents: number) => (cents / 100).toFixed(2);

export interface TrialRow { accountId: string; code: string; name: string; type: GlType; debit: string; credit: string }
/** Each account's net balance on its debit or credit side. Totals must match. */
export function trialBalance(rows: GlBalance[]): { rows: TrialRow[]; debit: string; credit: string; balanced: boolean } {
  let dr = 0, cr = 0;
  const out: TrialRow[] = [];
  for (const r of rows) {
    const net = c(r.debit) - c(r.credit);
    if (net === 0) continue;
    if (net > 0) dr += net; else cr += -net;
    out.push({ accountId: r.account_id, code: r.code, name: r.name, type: r.type, debit: net > 0 ? d(net) : "", credit: net < 0 ? d(-net) : "" });
  }
  return { rows: out, debit: d(dr), credit: d(cr), balanced: dr === cr };
}

export interface StatementLine { accountId: string; code: string; name: string; amount: string }
export interface StatementSection { type: GlType; label: string; lines: StatementLine[]; total: string }
const section = (rows: GlBalance[], type: GlType): StatementSection => {
  const lines = rows.filter((r) => r.type === type && c(r.balance) !== 0).map((r) => ({ accountId: r.account_id, code: r.code, name: r.name, amount: d(c(r.balance)) }));
  return { type, label: GL_TYPE_LABELS[type], lines, total: d(lines.reduce((s, l) => s + c(l.amount), 0)) };
};

/** Income statement for a period (pass balances computed from..to). */
export function incomeStatement(rows: GlBalance[]) {
  const income = section(rows, "income"), cogs = section(rows, "cogs"), expense = section(rows, "expense");
  const gross = c(income.total) - c(cogs.total);
  return { income, cogs, expense, grossProfit: d(gross), netIncome: d(gross - c(expense.total)) };
}

/**
 * Balance sheet at a date (pass balances computed from the beginning through the date). Income and expense
 * accounts are not closed into equity by entries; their all-time net shows as "Retained earnings and current
 * profit" so the sheet balances.
 */
export function balanceSheet(rows: GlBalance[]) {
  const assets = section(rows, "asset"), liabilities = section(rows, "liability"), equity = section(rows, "equity");
  const earnings = c(incomeStatement(rows).netIncome);
  const totalEquity = c(equity.total) + earnings;
  const totalLE = c(liabilities.total) + totalEquity;
  return { assets, liabilities, equity, earnings: d(earnings), totalEquity: d(totalEquity), totalLiabilitiesAndEquity: d(totalLE), balanced: c(assets.total) === totalLE };
}

export interface DraftLine { account: string; debit?: string; credit?: string; jobId?: string; description?: string }
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
/** Client-side check of a manual entry (the database checks again). Returns null when OK, else an error code. */
export function checkJournal(memo: string, date: string, lines: DraftLine[]): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "gl_bad_date";
  if (!memo.trim()) return "memo_required";
  let dr = 0, cr = 0, n = 0;
  for (const l of lines) {
    const hasD = Boolean(l.debit && Number(l.debit)), hasC = Boolean(l.credit && Number(l.credit));
    if (!hasD && !hasC) continue;
    if (hasD && hasC) return "bad_lines";
    if (!l.account) return "unknown_account";
    if ((hasD && !MONEY.test(l.debit!)) || (hasC && !MONEY.test(l.credit!))) return "bad_amount";
    dr += hasD ? c(l.debit) : 0; cr += hasC ? c(l.credit) : 0; n++;
  }
  if (n < 2 || dr === 0) return "journal_needs_two_lines";
  if (dr !== cr) return "journal_unbalanced";
  return null;
}
export const journalTotals = (lines: DraftLine[]) => {
  const dr = lines.reduce((s, l) => s + c(l.debit), 0), cr = lines.reduce((s, l) => s + c(l.credit), 0);
  return { debit: d(dr), credit: d(cr), difference: d(dr - cr) };
};

/** Lines sent to fin_gl_journal_post: empty rows dropped, amounts as strings. */
export const journalPayload = (lines: DraftLine[]) => lines
  .filter((l) => l.account && (Number(l.debit) || Number(l.credit)))
  .map((l) => ({ account: l.account, ...(Number(l.debit) ? { debit: l.debit } : { credit: l.credit }), ...(l.jobId ? { jobId: l.jobId } : {}), ...(l.description?.trim() ? { description: l.description.trim() } : {}) }));

export const SOURCE_LABELS: Record<string, string> = {
  invoice: "Invoice", payment: "Payment", credit_memo: "Credit memo", refund: "Refund", bill: "Bill", bill_payment: "Bill payment",
  expense: "Expense", manual: "Journal entry", payroll: "Payroll", opening: "Opening balance",
};
export const EVENT_LABELS: Record<string, string> = { post: "", void: "Void", reversal: "Reversal" };

export const LEDGER_VIEWS = ["balance", "income", "trial", "detail", "journal"] as const;
export type LedgerView = (typeof LEDGER_VIEWS)[number];
export const LEDGER_VIEW_LABELS: Record<LedgerView, string> = {
  balance: "Balance sheet", income: "Income statement", trial: "Trial balance", detail: "Account detail", journal: "Journal",
};
