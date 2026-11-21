import { fail } from "@/lib/http/api";
import { finGuard } from "@/lib/financials/api";
import { csvCell } from "@/lib/financials/csv";
import { isMissing } from "@/lib/financials/loaders";
import { AGING_BUCKETS, AGING_LABELS, filterTxns, POSTING_LABELS, RECON_LABELS, TXN_SOURCE_LABELS, type TxnFilter } from "@/lib/financials/accounting";
import {
  loadApAging, loadArAgingRows, loadAudit, loadBank, loadCustomerBalances, loadExpensesByCategory, loadJobCosting, loadLaborVariance, loadLookups, loadSubPayments, loadTxns, todayIso,
} from "@/lib/financials/accounting-load";
import { balanceSheet, incomeStatement, trialBalance, SOURCE_LABELS, EVENT_LABELS, type StatementSection } from "@/lib/financials/general-ledger";
import { loadAccounts, loadActivity, loadBalances, syncLedger } from "@/lib/financials/general-ledger-load";

const sectionRows = (s: StatementSection) => [[s.label], ...s.lines.map((l) => [`${l.code} ${l.name}`, l.amount]), [`Total ${s.label.toLowerCase()}`, s.total], []];

export const runtime = "nodejs";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ["transactions", "bank_lines", "reconciliations", "ar_aging", "ap_aging", "customer_balances", "job_costing", "labor_variance", "expenses_by_category", "sub_payments", "audit_trail", "general_ledger", "gl_trial_balance", "gl_balance_sheet", "gl_income_statement"] as const;
type Kind = (typeof KINDS)[number];

/**
 * Accountant Mode CSV exports. Every export is authorized and written to the audit trail by
 * public.fin_export_log (needs export_financials; works on a read-only book) BEFORE any data is read, and the
 * data is then read with the caller's own client, so RLS still decides what is in the file. No secrets or
 * account numbers are in any export (bank accounts carry only the last 4 digits). PDF: each report page prints.
 */
export async function GET(req: Request) {
  const g = await finGuard({ write: false, limitKey: "fin-export", limit: 60 });
  if ("error" in g) return g.error;
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind") as Kind;
  if (!KINDS.includes(kind)) return fail(400, "bad_kind", "Unknown export.");
  const year = todayIso().slice(0, 4);
  const from = DAY.test(u.searchParams.get("from") ?? "") ? u.searchParams.get("from")! : `${year}-01-01`;
  const to = DAY.test(u.searchParams.get("to") ?? "") ? u.searchParams.get("to")! : todayIso();
  if (to < from) return fail(400, "bad_range", "Pick a valid date range.");
  const { db, bookId } = g;
  const filters: Record<string, string> = { from, to };
  for (const k of ["q", "source", "posting", "recon", "job", "dir", "account"]) { const v = u.searchParams.get(k); if (v) filters[k] = v.slice(0, 100); }
  const { error: logErr } = await db.rpc("fin_export_log", { p_book_id: bookId, p_kind: kind, p_filters: filters });
  if (logErr) {
    if (isMissing(logErr)) return fail(503, "not_installed", "Exports turn on after the database update is installed.");
    return fail(403, "forbidden", "Your financial role can't export.");
  }
  const L = await loadLookups(db, bookId);
  let out: unknown[][] = [];
  let title: string = kind;
  const needBank = kind === "transactions" || kind === "bank_lines" || kind === "reconciliations";
  const bank = needBank ? await loadBank(db, bookId, L) : ({ ready: false } as const);

  switch (kind) {
    case "transactions": {
      title = "Transaction_ledger";
      const rows = filterTxns(await loadTxns(db, bookId, L, bank), { ...(filters as TxnFilter), from, to });
      out = [["Transaction ledger (records as entered; not a general ledger)", `${from} to ${to}`], [],
        ["Date", "Number", "Type", "Description", "Account", "Category", "In/Out", "Amount", "Customer / vendor", "Project", "Posting status", "Bank status", "Documents"],
        ...rows.map((r) => [r.date, r.number, TXN_SOURCE_LABELS[r.source], r.description, r.account, r.category, r.direction === "in" ? "In" : r.direction === "out" ? "Out" : "", r.amount, r.party ?? "", r.project ?? "", POSTING_LABELS[r.posting], RECON_LABELS[r.recon], r.documents])];
      break;
    }
    case "bank_lines": {
      title = "Bank_lines";
      if (!bank.ready) return fail(503, "not_installed", "Bank reconciliation turns on after the database update is installed.");
      const acct = new Map(bank.accounts.map((a) => [a.id, `${a.name}${a.last4 ? ` ••${a.last4}` : ""}`]));
      out = [["Bank statement lines (as imported; never edited)", `${from} to ${to}`], [],
        ["Account", "Date", "Description", "Amount", "Check #", "Status", "Matched to", "Note", "In a reconciled period"],
        ...bank.lines.filter((l) => l.posted_on >= from && l.posted_on <= to && (!filters.account || l.account_id === filters.account))
          .map((l) => [acct.get(l.account_id) ?? "", l.posted_on, l.description, l.amount, l.check_number ?? "", l.match ? (l.match.target_type === "excluded" ? `Excluded (${l.match.exclude_reason})` : "Matched") : "Not matched",
            l.match?.target_type && l.match.target_type !== "excluded" ? l.match.target_type.replace("_", " ") : "", l.match?.note ?? "", l.locked ? "Yes" : "No"])];
      break;
    }
    case "reconciliations": {
      title = "Reconciliations";
      if (!bank.ready) return fail(503, "not_installed", "Bank reconciliation turns on after the database update is installed.");
      const acct = new Map(bank.accounts.map((a) => [a.id, a.name]));
      out = [["Account", "Period end", "Statement balance", "Bank balance (imported lines)", "Difference", "Unmatched lines", "Status", "Note", "Confirmed", "Reopened", "Reopen reason"],
        ...bank.reconciliations.map((r) => [acct.get(r.account_id) ?? "", r.period_end, r.statement_balance, r.bank_balance, r.difference, r.unmatched_count, r.status === "reconciled" ? "Reconciled" : "Confirmed with differences", r.note ?? "", r.confirmed_at.slice(0, 10), r.reopened_at?.slice(0, 10) ?? "", r.reopen_reason ?? ""])];
      break;
    }
    case "ar_aging": case "ap_aging": {
      const a = kind === "ar_aging" ? await loadArAgingRows(db, bookId) : await loadApAging(db, bookId, L);
      title = kind === "ar_aging" ? "AR_aging" : "AP_aging";
      out = [[kind === "ar_aging" ? "Accounts receivable aging" : "Accounts payable aging", `as of ${todayIso()}`], [],
        [kind === "ar_aging" ? "Customer" : "Vendor", ...AGING_BUCKETS.map((b) => AGING_LABELS[b]), "Total"],
        ...a.byParty.map((p) => [p.party, ...AGING_BUCKETS.map((b) => p.buckets[b]), p.total]),
        ["Total", ...AGING_BUCKETS.map((b) => a.byBucket[b]), a.total], [],
        [kind === "ar_aging" ? "Invoice" : "Bill", kind === "ar_aging" ? "Customer" : "Vendor", "Due date", "Balance"],
        ...a.rows.map((r) => [r.number, r.party, r.due_date ?? "", r.balance])];
      break;
    }
    case "customer_balances": {
      title = "Customer_balances";
      out = [["Customer", "Invoices", "Invoiced", "Paid", "Credited", "Balance owed", "Payments not applied"],
        ...(await loadCustomerBalances(db, bookId, L)).map((c) => [c.customer, c.invoices, c.invoiced, c.paid, c.credited, c.balance, c.unapplied])];
      break;
    }
    case "job_costing": {
      title = "Job_costing";
      out = [["Job costing: budget (from the contract version), committed (open, not yet billed), actual (approved bills + expenses), variance = budget − forecast"], [],
        ["Project", "Trade", "Budget", "Committed", "Actual", "Forecast", "Variance"],
        ...(await loadJobCosting(db, bookId, L)).map((r) => [r.project, r.trade, r.budget, r.committed, r.actual, r.forecast, r.variance])];
      break;
    }
    case "labor_variance": {
      title = "Labor_cost_variance";
      out = [["Labor cost variance (recorded labor costs; Built2Bid does not run payroll)"], [],
        ["Project", "Estimated labor", "Committed", "Actual labor", "Variance (estimate − actual − committed)"],
        ...(await loadLaborVariance(db, bookId, L)).map((r) => [r.project, r.estimated, r.committed, r.actual, r.variance])];
      break;
    }
    case "expenses_by_category": {
      title = "Expenses_by_category";
      const r = await loadExpensesByCategory(db, bookId, from, to);
      if (!r) return fail(403, "forbidden", "Company reports need a company financial role.");
      out = [["Expenses by category (billed basis: approved bills + approved expenses)", `${from} to ${to}`], [], ["Category", "Amount"], ...r.rows.map((x) => [x.category, x.amount]), ["Total", r.total]];
      break;
    }
    case "sub_payments": {
      title = "Subcontractor_payments";
      out = [["Subcontractor payments (bill payments + approved expenses to subcontractor vendors)", `${from} to ${to}`], [], ["Subcontractor", "Bill payments", "Expenses", "Total", "Records"],
        ...(await loadSubPayments(db, bookId, L, from, to)).map((r) => [r.vendor, r.bills, r.expenses, r.total, r.count])];
      break;
    }
    case "audit_trail": {
      title = "Audit_trail";
      const r = await loadAudit(db, bookId, { from, to, q: filters.q, limit: 500 });
      if (!r.ok) return fail(r.reason === "forbidden" ? 403 : 503, r.reason, "The audit trail isn't available.");
      out = [["Audit trail (sensitive fields hidden)", `${from} to ${to}`, "Newest 500"], [], ["When (UTC)", "Who", "Action", "Record type", "Record id", "Details"],
        ...r.rows.map((x) => [x.created_at.replace("T", " ").slice(0, 19), x.actor_name, x.action, x.entity_type, x.entity_id ?? "", JSON.stringify(x.details ?? {})])];
      break;
    }
    case "general_ledger": case "gl_trial_balance": case "gl_balance_sheet": case "gl_income_statement": {
      if (!(await syncLedger(db, bookId)).ready) return fail(503, "not_installed", "The general ledger turns on after the database update is installed.");
      if (kind === "general_ledger") {
        title = "General_ledger";
        const accounts = await loadAccounts(db, bookId);
        const only = filters.account ? accounts.filter((a) => a.id === filters.account) : accounts;
        out = [["General ledger detail (accrual)", `${from} to ${to}`], [], ["Account", "Date", "Type", "Memo", "Line note", "Debit", "Credit", "Balance"]];
        for (const a of only) {
          for (const r of await loadActivity(db, bookId, a.id, from, to)) {
            out.push([`${a.code} ${a.name}`, r.entry_date, `${SOURCE_LABELS[r.source_type] ?? r.source_type}${EVENT_LABELS[r.event_kind] ? ` (${EVENT_LABELS[r.event_kind]})` : ""}`, r.memo, r.description ?? "", Number(r.debit) ? r.debit : "", Number(r.credit) ? r.credit : "", r.running]);
          }
        }
      } else if (kind === "gl_trial_balance") {
        title = "Trial_balance";
        const t = trialBalance(await loadBalances(db, bookId, null, to));
        out = [["Trial balance", `as of ${to}`], [], ["Account", "Debit", "Credit"], ...t.rows.map((r) => [`${r.code} ${r.name}`, r.debit, r.credit]), ["Totals", t.debit, t.credit]];
      } else if (kind === "gl_balance_sheet") {
        title = "Balance_sheet";
        const b = balanceSheet(await loadBalances(db, bookId, null, to));
        out = [["Balance sheet", `as of ${to}`], [], ...sectionRows(b.assets), ...sectionRows(b.liabilities), ...sectionRows(b.equity),
          ["Retained earnings and current profit", b.earnings], ["Total equity", b.totalEquity], ["Total liabilities and equity", b.totalLiabilitiesAndEquity]];
      } else {
        title = "Income_statement";
        const i = incomeStatement(await loadBalances(db, bookId, from, to));
        out = [["Income statement (accrual)", `${from} to ${to}`], [], ...sectionRows(i.income), ...sectionRows(i.cogs), ["Gross profit", i.grossProfit], [], ...sectionRows(i.expense), ["Net income", i.netIncome]];
      }
      break;
    }
  }
  const csv = out.map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${title}_${from}_${to}.csv"`, "cache-control": "private, no-store" } });
}
