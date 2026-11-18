import "server-only";
/**
 * Read side of Accountant Mode. Reads with the signed-in user's client, so RLS decides what is visible
 * (bank data and company-wide records need "view company financials"). Writes go through the SECURITY
 * DEFINER RPCs in 20261213001000_fin_accounting.sql via /api/financials/actions. Nothing here changes a record.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { add, cmp, isZero, sub } from "./money";
import { isMissing } from "./loaders";
import { categoryOf, CATEGORY_LABELS } from "./reports";
import { loadPl } from "./reports-load";
import {
  agingTotals, possibleDuplicateLines, suggestMatches, type AgingRow, type BankLine, type MatchCandidate, type Posting, type QueueKind, type Recon, type Suggestion, type Txn,
} from "./accounting";

type Db = SupabaseClient;
type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
/** Calendar dates as YYYY-MM-DD whatever the driver returns (PostgREST gives dates; some clients give timestamps). */
const dt = (v: unknown) => s(v).slice(0, 10);
const m = (v: unknown) => (v === null || v === undefined || v === "" ? "0.00" : typeof v === "number" ? v.toFixed(2) : String(v));
const rowsOf = (r: { data: unknown; error: unknown }) => ((r.error ? [] : r.data ?? []) as Row[]);
export const todayIso = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export interface JobRef { id: string; estimateId: string; number: string; name: string; customerId: string | null }
export interface Lookups {
  jobs: Map<string, JobRef>;
  vendors: Map<string, { id: string; name: string; kind: string }>;
  codes: Map<string, { id: string; code: string; name: string; trade: string | null; type: string | null }>;
  customers: Map<string, string>;
}

export async function loadLookups(db: Db, bookId: string): Promise<Lookups> {
  const [jobs, vendors, codes, ar] = await Promise.all([
    db.from("fin_jobs").select("id, estimate_id, job_number, name, customer_id").eq("book_id", bookId),
    db.from("fin_vendors").select("id, name, kind").eq("book_id", bookId),
    db.from("fin_cost_codes").select("id, code, name, trade_slug, cost_type").eq("book_id", bookId),
    db.from("fin_ar_invoices_v").select("customer_id, customer_name").eq("book_id", bookId),
  ]);
  return {
    jobs: new Map(rowsOf(jobs).map((j) => [s(j.id), { id: s(j.id), estimateId: s(j.estimate_id), number: s(j.job_number), name: s(j.name), customerId: (j.customer_id as string | null) ?? null }])),
    vendors: new Map(rowsOf(vendors).map((v) => [s(v.id), { id: s(v.id), name: s(v.name), kind: s(v.kind) }])),
    codes: new Map(rowsOf(codes).map((c) => [s(c.id), { id: s(c.id), code: s(c.code), name: s(c.name), trade: (c.trade_slug as string | null) ?? null, type: (c.cost_type as string | null) ?? null }])),
    customers: new Map(rowsOf(ar).filter((r) => r.customer_id && r.customer_name).map((r) => [s(r.customer_id), s(r.customer_name)])),
  };
}
export const jobLabel = (L: Lookups, id: unknown) => { const j = L.jobs.get(s(id)); return j ? `${j.number} · ${j.name}` : null; };
export const jobHref = (L: Lookups, id: unknown, hash = "") => { const j = L.jobs.get(s(id)); return j ? `/financials/jobs/${j.estimateId}${hash}` : null; };

// ---- Bank -------------------------------------------------------------------------------------------------------
export interface BankAccount { id: string; name: string; kind: string; last4: string | null; opening_balance: string; opening_date: string; status: string }
export interface BankLineRow extends BankLine { import_id: string; match: { id: string; target_type: string; target_id: string | null; exclude_reason: string | null; note: string | null } | null; locked: boolean; suggestions: Suggestion[]; duplicate: boolean }
export interface BankImport { id: string; account_id: string; file_name: string; statement_start: string | null; statement_end: string | null; opening_balance: string | null; ending_balance: string | null; row_count: number; inserted_count: number; skipped_count: number; balanced: boolean | null; imported_at: string }
export interface Reconciliation { id: string; account_id: string; period_end: string; statement_balance: string; bank_balance: string; difference: string; unmatched_count: number; status: string; note: string | null; confirmed_at: string; reopened_at: string | null; reopen_reason: string | null }
export type BankData = { ready: false } | {
  ready: true; accounts: BankAccount[]; lines: BankLineRow[]; imports: BankImport[]; reconciliations: Reconciliation[];
  candidates: MatchCandidate[]; balances: Record<string, string>;
};

export async function loadBank(db: Db, bookId: string, L: Lookups): Promise<BankData> {
  const acc = await db.from("fin_bank_accounts").select("id, name, kind, last4, opening_balance, opening_date, status").eq("book_id", bookId).order("created_at");
  if (acc.error) return isMissing(acc.error) ? { ready: false } : { ready: true, accounts: [], lines: [], imports: [], reconciliations: [], candidates: [], balances: {} };
  const [lines, matches, imports, recs, pays, refunds, billPays, exps, bills] = await Promise.all([
    db.from("fin_bank_transactions").select("id, account_id, import_id, posted_on, description, amount, check_number").eq("book_id", bookId).order("posted_on", { ascending: false }).limit(5000),
    db.from("fin_bank_matches").select("id, bank_txn_id, target_type, target_id, exclude_reason, note").eq("book_id", bookId).eq("status", "active"),
    db.from("fin_bank_imports").select("id, account_id, file_name, statement_start, statement_end, opening_balance, ending_balance, row_count, inserted_count, skipped_count, balanced, imported_at").eq("book_id", bookId).order("imported_at", { ascending: false }),
    db.from("fin_reconciliations").select("id, account_id, period_end, statement_balance, bank_balance, difference, unmatched_count, status, note, confirmed_at, reopened_at, reopen_reason").eq("book_id", bookId).order("period_end", { ascending: false }),
    db.from("fin_payments").select("id, number, received_on, amount, reference, job_id, customer_id").eq("book_id", bookId).eq("status", "active"),
    db.from("fin_refunds").select("id, number, refunded_on, amount, reference").eq("book_id", bookId).eq("status", "active"),
    db.from("fin_bill_payments").select("id, bill_id, paid_on, amount, reference").eq("book_id", bookId).eq("status", "active"),
    db.from("fin_expenses").select("id, number, spent_on, amount, description, payee").eq("book_id", bookId).in("status", ["pending", "approved"]),
    db.from("fin_vendor_bills").select("id, number, vendor_id").eq("book_id", bookId),
  ]);
  const accounts = rowsOf(acc).map((a) => ({ id: s(a.id), name: s(a.name), kind: s(a.kind), last4: (a.last4 as string | null) ?? null, opening_balance: m(a.opening_balance), opening_date: dt(a.opening_date), status: s(a.status) }));
  const recList = rowsOf(recs).map((r) => ({ id: s(r.id), account_id: s(r.account_id), period_end: dt(r.period_end), statement_balance: m(r.statement_balance), bank_balance: m(r.bank_balance), difference: m(r.difference),
    unmatched_count: Number(r.unmatched_count), status: s(r.status), note: (r.note as string | null) ?? null, confirmed_at: s(r.confirmed_at), reopened_at: (r.reopened_at as string | null) ?? null, reopen_reason: (r.reopen_reason as string | null) ?? null }));
  const lockedThrough = new Map<string, string>();
  for (const r of recList) if (!r.reopened_at && (!lockedThrough.has(r.account_id) || r.period_end > lockedThrough.get(r.account_id)!)) lockedThrough.set(r.account_id, r.period_end);
  const billMap = new Map(rowsOf(bills).map((b) => [s(b.id), b]));
  const candidates: MatchCandidate[] = [
    ...rowsOf(pays).map((p): MatchCandidate => ({ type: "payment", id: s(p.id), date: dt(p.received_on), amount: m(p.amount), reference: (p.reference as string | null) ?? null,
      label: `Payment ${s(p.number)}${L.customers.get(s(p.customer_id)) ? ` · ${L.customers.get(s(p.customer_id))}` : jobLabel(L, p.job_id) ? ` · ${jobLabel(L, p.job_id)}` : ""}` })),
    ...rowsOf(refunds).map((r): MatchCandidate => ({ type: "refund", id: s(r.id), date: dt(r.refunded_on), amount: sub(0, m(r.amount)), reference: (r.reference as string | null) ?? null, label: `Refund ${s(r.number)}` })),
    ...rowsOf(billPays).map((p): MatchCandidate => {
      const b = billMap.get(s(p.bill_id));
      return { type: "bill_payment", id: s(p.id), date: dt(p.paid_on), amount: sub(0, m(p.amount)), reference: (p.reference as string | null) ?? null,
        label: `Bill payment · ${b ? `${s(b.number)} ${L.vendors.get(s(b.vendor_id))?.name ?? ""}` : "bill"}`.trim() };
    }),
    ...rowsOf(exps).map((x): MatchCandidate => ({ type: "expense", id: s(x.id), date: dt(x.spent_on), amount: sub(0, m(x.amount)), label: `Expense ${s(x.number)} · ${s(x.payee) || s(x.description)}` })),
  ];
  const matchByLine = new Map(rowsOf(matches).map((x) => [s(x.bank_txn_id), x]));
  const taken = new Set(rowsOf(matches).filter((x) => x.target_id).map((x) => `${s(x.target_type)}:${s(x.target_id)}`));
  const base: BankLine[] = rowsOf(lines).map((l) => ({ id: s(l.id), account_id: s(l.account_id), posted_on: dt(l.posted_on), description: s(l.description), amount: m(l.amount), check_number: (l.check_number as string | null) ?? null }));
  const unmatched = base.filter((l) => !matchByLine.has(l.id));
  const dupes = new Set(possibleDuplicateLines(unmatched).flat());
  const lineRows: BankLineRow[] = rowsOf(lines).map((l, i) => {
    const b = base[i];
    const mt = matchByLine.get(b.id);
    return {
      ...b, import_id: s(l.import_id),
      match: mt ? { id: s(mt.id), target_type: s(mt.target_type), target_id: (mt.target_id as string | null) ?? null, exclude_reason: (mt.exclude_reason as string | null) ?? null, note: (mt.note as string | null) ?? null } : null,
      locked: Boolean(lockedThrough.get(b.account_id) && b.posted_on <= lockedThrough.get(b.account_id)!),
      suggestions: mt ? [] : suggestMatches(b, candidates, taken),
      duplicate: dupes.has(b.id),
    };
  });
  const balances: Record<string, string> = {};
  for (const a of accounts) balances[a.id] = add(a.opening_balance, ...lineRows.filter((l) => l.account_id === a.id && l.posted_on >= a.opening_date).map((l) => l.amount));
  const importRows = rowsOf(imports).map((r) => ({ id: s(r.id), account_id: s(r.account_id), file_name: s(r.file_name), statement_start: r.statement_start ? dt(r.statement_start) : null, statement_end: r.statement_end ? dt(r.statement_end) : null,
    opening_balance: r.opening_balance === null ? null : m(r.opening_balance), ending_balance: r.ending_balance === null ? null : m(r.ending_balance), row_count: Number(r.row_count),
    inserted_count: Number(r.inserted_count), skipped_count: Number(r.skipped_count), balanced: (r.balanced as boolean | null) ?? null, imported_at: s(r.imported_at) }));
  return { ready: true, accounts, lines: lineRows, imports: importRows, reconciliations: recList, candidates, balances };
}

// ---- Accountant dashboard metrics ---------------------------------------------------------------------------------
export interface BankBalanceFigure { amount: string; asOf: string; source: string; refreshedAt: string; accounts: number; connected?: boolean }
export interface AccountantMetrics {
  bankReady: boolean;
  /** Ending balance from the latest imported statement per checking/savings account. null = none on file (never invented). */
  bankBalance: BankBalanceFigure | null;
  projected: { amount: string; arIn: string; apOut: string } | null;
  ar: { amount: string; count: number; overdue: string };
  ap: { amount: string; count: number; overdue: string };
  unreconciled: number;
  needsReview: number;
}

export async function loadAccountantMetrics(db: Db, bookId: string, bank: BankData, queueTotal: number): Promise<AccountantMetrics> {
  const today = todayIso(), in30 = plusDays(30);
  const [ar, billBal, bills] = await Promise.all([
    db.from("fin_ar_invoices_v").select("balance, due_date, days_overdue").eq("book_id", bookId),
    db.from("fin_bill_balances_v").select("bill_id, balance, days_overdue").eq("book_id", bookId),
    db.from("fin_vendor_bills").select("id, status, due_date").eq("book_id", bookId).eq("status", "approved"),
  ]);
  const openAr = rowsOf(ar).filter((r) => cmp(m(r.balance), 0) > 0);
  const approved = new Map(rowsOf(bills).map((b) => [s(b.id), b]));
  const openAp = rowsOf(billBal).filter((r) => approved.has(s(r.bill_id)) && cmp(m(r.balance), 0) > 0);
  let bankBalance: BankBalanceFigure | null = null;
  if (bank.ready) {
    const cashAccounts = bank.accounts.filter((a) => a.status === "active" && (a.kind === "checking" || a.kind === "savings"));
    // Balances reported by a connected bank (V6.9, read-only). RLS only returns them to people allowed to see
    // balances; a missing table or no permission simply means statements are used.
    const connected = new Map<string, { amount: string; asOf: string }>();
    if (cashAccounts.length) {
      const { data, error } = await db.from("fin_bank_balances").select("account_id, current_balance, as_of").eq("book_id", bookId)
        .in("account_id", cashAccounts.map((a) => a.id)).order("as_of", { ascending: false }).limit(500);
      if (!error) for (const r of (data ?? []) as Record<string, unknown>[]) {
        const id = s(r.account_id);
        if (!connected.has(id) && r.current_balance !== null && r.current_balance !== undefined) connected.set(id, { amount: m(r.current_balance), asOf: s(r.as_of) });
      }
    }
    type Pick = { amount: string; asOf: string; refreshedAt: string; label: string; kind: "statement" | "connected" };
    const picks: Pick[] = [];
    for (const a of cashAccounts) {
      const st = bank.imports.filter((i) => i.account_id === a.id && i.ending_balance !== null).sort((x, y) => s(y.statement_end).localeCompare(dt(x.statement_end)) || y.imported_at.localeCompare(x.imported_at))[0];
      const live = connected.get(a.id);
      if (live && (!st || live.asOf.slice(0, 10) >= dt(st.statement_end))) picks.push({ amount: live.amount, asOf: live.asOf.slice(0, 10), refreshedAt: live.asOf, label: "Connected bank", kind: "connected" });
      else if (st) picks.push({ amount: st.ending_balance!, asOf: dt(st.statement_end), refreshedAt: st.imported_at, label: `Statement ending balance · ${st.file_name}`, kind: "statement" });
    }
    if (picks.length) {
      const kinds = new Set(picks.map((p) => p.kind));
      bankBalance = {
        amount: add(0, ...picks.map((p) => p.amount)),
        asOf: picks.map((p) => p.asOf).sort()[0] || "",
        source: picks.length === 1 ? picks[0].label : `${kinds.size > 1 ? "Connected bank and statement balances" : kinds.has("connected") ? "Connected bank balances" : "Statement ending balances"} · ${picks.length} accounts`,
        refreshedAt: picks.map((p) => p.refreshedAt).sort().at(-1)!,
        accounts: picks.length,
        connected: kinds.has("connected"),
      };
    }
  }
  const arIn = add(0, ...openAr.filter((r) => !r.due_date || dt(r.due_date) <= in30).map((r) => m(r.balance)));
  const apOut = add(0, ...openAp.filter((r) => { const b = approved.get(s(r.bill_id)); return !b?.due_date || dt(b.due_date) <= in30; }).map((r) => m(r.balance)));
  return {
    bankReady: bank.ready,
    bankBalance,
    projected: bankBalance ? { amount: sub(add(bankBalance.amount, arIn), apOut), arIn, apOut } : null,
    ar: { amount: add(0, ...openAr.map((r) => m(r.balance))), count: openAr.length, overdue: add(0, ...openAr.filter((r) => Number(r.days_overdue) > 0).map((r) => m(r.balance))) },
    ap: { amount: add(0, ...openAp.map((r) => m(r.balance))), count: openAp.length, overdue: add(0, ...openAp.filter((r) => { const b = approved.get(s(r.bill_id)); return b?.due_date && dt(b.due_date) < today; }).map((r) => m(r.balance))) },
    unreconciled: bank.ready ? bank.lines.filter((l) => !l.match).length : 0,
    needsReview: queueTotal,
  };
}

// ---- Review queue -------------------------------------------------------------------------------------------------
export interface QueueItem { key: string; kind: QueueKind; title: string; detail: string; amount: string | null; date: string | null; href: string | null;
  /** Inline classification for cost rows (flat selects; nothing nested). */
  classify?: { entityType: "expense" | "bill_line"; entityId: string; jobId: string | null; costCodeId: string | null; vendorId: string | null; scopeSectionId: string | null; canVendor: boolean };
  reviewItemId?: string; expenseId?: string; duplicateOf?: { id: string; number: string } | null }
export type Queue = Record<QueueKind, QueueItem[]>;

export async function loadQueue(db: Db, bookId: string, L: Lookups, bank: BankData): Promise<Queue> {
  const today = todayIso();
  const [exps, billLines, bills, billBal, pays, review] = await Promise.all([
    db.from("fin_expenses").select("id, number, spent_on, amount, description, payee, status, job_id, cost_code_id, vendor_id, scope_section_id").eq("book_id", bookId).in("status", ["pending", "approved"]),
    db.from("fin_vendor_bill_lines").select("id, bill_id, line_no, job_id, cost_code_id, description, amount, scope_section_id").eq("book_id", bookId),
    db.from("fin_vendor_bills").select("id, number, vendor_id, vendor_invoice_number, bill_date, due_date, total, status").eq("book_id", bookId).neq("status", "void"),
    db.from("fin_bill_balances_v").select("bill_id, balance").eq("book_id", bookId),
    db.from("fin_payment_balances_v").select("payment_id, received_on, amount, unapplied, status, job_id, customer_id").eq("book_id", bookId).eq("status", "active"),
    db.from("fin_review_items").select("id, kind, entity_type, entity_id, job_id, details, created_at").eq("book_id", bookId).eq("status", "open"),
  ]);
  // Older databases (before 20261213001000) have no scope_section_id column: fall back without it.
  const expRows = exps.error ? rowsOf(await db.from("fin_expenses").select("id, number, spent_on, amount, description, payee, status, job_id, cost_code_id, vendor_id").eq("book_id", bookId).in("status", ["pending", "approved"])) : rowsOf(exps);
  const lineRows = billLines.error ? rowsOf(await db.from("fin_vendor_bill_lines").select("id, bill_id, line_no, job_id, cost_code_id, description, amount").eq("book_id", bookId)) : rowsOf(billLines);
  const billMap = new Map(rowsOf(bills).map((b) => [s(b.id), b]));
  const balMap = new Map(rowsOf(billBal).map((b) => [s(b.bill_id), m(b.balance)]));
  const expMap = new Map(expRows.map((x) => [s(x.id), x]));
  const q: Queue = { uncategorized: [], unmatched_bank: [], duplicates: [], unapplied: [], bills: [], unbalanced_imports: [], missing_job: [], recon_differences: [] };
  const expClassify = (x: Row) => ({ entityType: "expense" as const, entityId: s(x.id), jobId: (x.job_id as string | null) ?? null, costCodeId: (x.cost_code_id as string | null) ?? null,
    vendorId: (x.vendor_id as string | null) ?? null, scopeSectionId: (x.scope_section_id as string | null) ?? null, canVendor: true });

  for (const x of expRows) {
    const title = `Expense ${s(x.number)} · ${s(x.payee) || s(x.description)}`;
    if (x.job_id && !x.cost_code_id) q.uncategorized.push({ key: `e:${s(x.id)}`, kind: "uncategorized", title, detail: `${jobLabel(L, x.job_id) ?? "Project"} · ${s(x.description)}`, amount: m(x.amount), date: dt(x.spent_on), href: jobHref(L, x.job_id, "#costs"), classify: expClassify(x) });
    if (!x.job_id) q.missing_job.push({ key: `e:${s(x.id)}`, kind: "missing_job", title, detail: `${s(x.description)} · ${x.status === "pending" ? "pending approval" : "approved"}`, amount: m(x.amount), date: dt(x.spent_on), href: "/financials/records?view=costs", classify: expClassify(x) });
  }
  for (const l of lineRows) {
    if (!l.job_id || l.cost_code_id) continue;
    const b = billMap.get(s(l.bill_id));
    if (!b) continue;
    q.uncategorized.push({ key: `l:${s(l.id)}`, kind: "uncategorized", title: `Bill ${s(b.number)} line ${s(l.line_no)} · ${L.vendors.get(s(b.vendor_id))?.name ?? "Vendor"}`, detail: `${jobLabel(L, l.job_id) ?? "Project"} · ${s(l.description)}`,
      amount: m(l.amount), date: dt(b.bill_date), href: jobHref(L, l.job_id, "#costs"),
      classify: { entityType: "bill_line", entityId: s(l.id), jobId: s(l.job_id), costCodeId: null, vendorId: null, scopeSectionId: (l.scope_section_id as string | null) ?? null, canVendor: false } });
  }
  for (const r of rowsOf(review)) {
    if (r.kind !== "duplicate_suspected") continue;
    const x = expMap.get(s(r.entity_id));
    const other = expMap.get(s((r.details as Row | null)?.duplicateOfId ?? ""));
    q.duplicates.push({ key: `r:${s(r.id)}`, kind: "duplicates", title: x ? `Expense ${s(x.number)} · ${s(x.payee) || s(x.description)}` : "Possible duplicate expense",
      detail: other ? `Looks like expense ${s(other.number)} (same amount and date)` : "Same amount and date as another expense", amount: x ? m(x.amount) : null, date: x ? dt(x.spent_on) : s(r.created_at).slice(0, 10),
      href: jobHref(L, r.job_id, "#review") ?? "/financials/records?view=review", reviewItemId: s(r.id), expenseId: x ? s(x.id) : undefined, duplicateOf: other ? { id: s(other.id), number: s(other.number) } : null });
  }
  for (const p of rowsOf(pays)) {
    if (cmp(m(p.unapplied), 0) <= 0) continue;
    q.unapplied.push({ key: `p:${s(p.payment_id)}`, kind: "unapplied", title: `Payment of ${m(p.amount)}${L.customers.get(s(p.customer_id)) ? ` from ${L.customers.get(s(p.customer_id))}` : ""}`,
      detail: `${m(p.unapplied)} not applied to an invoice${jobLabel(L, p.job_id) ? ` · ${jobLabel(L, p.job_id)}` : ""}`, amount: m(p.unapplied), date: dt(p.received_on), href: jobHref(L, p.job_id, "#billing") ?? "/financials/records?view=payments&filter=unapplied" });
  }
  for (const b of rowsOf(bills)) {
    const bal = balMap.get(s(b.id)) ?? m(b.total);
    const late = b.status === "approved" && b.due_date && dt(b.due_date) < today && cmp(bal, 0) > 0;
    if (b.status !== "pending_approval" && !late) continue;
    q.bills.push({ key: `b:${s(b.id)}`, kind: "bills", title: `Bill ${s(b.number)} · ${L.vendors.get(s(b.vendor_id))?.name ?? "Vendor"} #${s(b.vendor_invoice_number)}`,
      detail: b.status === "pending_approval" ? "Waiting for approval" : `Past due since ${dt(b.due_date)} · ${bal} unpaid`, amount: b.status === "pending_approval" ? m(b.total) : bal, date: dt(b.bill_date),
      href: "/financials/records?view=costs&filter=" + (b.status === "pending_approval" ? "bills_pending" : "bills_due") });
  }
  if (bank.ready) {
    const acctName = new Map(bank.accounts.map((a) => [a.id, a.name]));
    for (const l of bank.lines) {
      if (l.match) continue;
      const item: QueueItem = { key: `t:${l.id}`, kind: "unmatched_bank", title: l.description, detail: `${acctName.get(l.account_id) ?? "Bank"}${l.suggestions.length ? ` · ${l.suggestions.length} suggested match${l.suggestions.length === 1 ? "" : "es"}` : " · no suggestion"}`,
        amount: l.amount, date: l.posted_on, href: `/financials/accounting/bank?account=${l.account_id}&line=${l.id}` };
      q.unmatched_bank.push(item);
      if (l.duplicate) q.duplicates.push({ ...item, key: `d:${l.id}`, kind: "duplicates", detail: `${acctName.get(l.account_id) ?? "Bank"} · appears more than once on the statement` });
    }
    for (const i of bank.imports) if (i.balanced === false) q.unbalanced_imports.push({ key: `i:${i.id}`, kind: "unbalanced_imports", title: i.file_name, detail: `${acctName.get(i.account_id) ?? "Bank"} · ${dt(i.statement_start)} to ${dt(i.statement_end)} · opening ${s(i.opening_balance)} → ending ${s(i.ending_balance)}`, amount: null, date: i.imported_at.slice(0, 10), href: `/financials/accounting/bank?account=${i.account_id}` });
    for (const r of bank.reconciliations) if (!r.reopened_at && r.status === "confirmed_with_differences") q.recon_differences.push({ key: `c:${r.id}`, kind: "recon_differences", title: `${acctName.get(r.account_id) ?? "Bank"} through ${r.period_end}`, detail: `Difference ${r.difference} · ${r.unmatched_count} unmatched · Note: ${r.note ?? ""}`, amount: r.difference, date: r.period_end, href: `/financials/accounting/bank?account=${r.account_id}` });
  }
  for (const k of Object.keys(q) as QueueKind[]) q[k].sort((a, b) => s(b.date).localeCompare(s(a.date)));
  return q;
}
export const queueTotal = (q: Queue) => Object.entries(q).reduce((t, [k, v]) => t + (k === "missing_job" ? 0 : v.length), 0);

// ---- Transaction ledger --------------------------------------------------------------------------------------------
export async function loadTxns(db: Db, bookId: string, L: Lookups, bank: BankData): Promise<Txn[]> {
  const [inv, pay, ref, cm, bills, lines, bp, exps] = await Promise.all([
    db.from("fin_invoices").select("id, job_id, customer_id, number, kind, status, issue_date, created_at, total, memo, bill_to").eq("book_id", bookId),
    db.from("fin_payments").select("id, job_id, customer_id, number, received_on, method, reference, amount, memo, status").eq("book_id", bookId),
    db.from("fin_refunds").select("id, payment_id, number, refunded_on, method, amount, memo, status").eq("book_id", bookId),
    db.from("fin_credit_memos").select("id, job_id, customer_id, number, issue_date, amount, reason, status").eq("book_id", bookId),
    db.from("fin_vendor_bills").select("id, number, vendor_id, vendor_invoice_number, bill_date, total, memo, document_id, status").eq("book_id", bookId),
    db.from("fin_vendor_bill_lines").select("bill_id, job_id, cost_code_id").eq("book_id", bookId),
    db.from("fin_bill_payments").select("id, bill_id, paid_on, method, reference, amount, status").eq("book_id", bookId),
    db.from("fin_expenses").select("id, number, job_id, vendor_id, payee, cost_code_id, spent_on, amount, method, description, receipt_document_id, status").eq("book_id", bookId),
  ]);
  const matched = new Map<string, string>();
  const reconciled = new Set<string>();
  if (bank.ready) {
    const acctName = new Map(bank.accounts.map((a) => [a.id, a.name]));
    for (const l of bank.lines) if (l.match?.target_id) {
      matched.set(`${l.match.target_type}:${l.match.target_id}`, acctName.get(l.account_id) ?? "Bank");
      if (l.locked) reconciled.add(`${l.match.target_type}:${l.match.target_id}`);
    }
  }
  const recon = (t: string, id: string): Recon => reconciled.has(`${t}:${id}`) ? "reconciled" : matched.has(`${t}:${id}`) ? "matched" : "unmatched";
  const money = (t: string, id: string, method: unknown) => matched.get(`${t}:${id}`) ?? `${s(method) ? s(method).toUpperCase().replace("ACH", "ACH").replace(/_/g, " ") : "Paid"} · not matched to a bank line`;
  const post = (status: unknown, live = "issued"): Posting => status === "void" ? "void" : status === "draft" ? "draft" : status === "pending" || status === "pending_approval" ? "pending" : status === "rejected" ? "rejected" : status === live || status === "active" || status === "approved" || status === "issued" ? "posted" : "posted";
  const cust = (id: unknown, jobId: unknown) => L.customers.get(s(id)) ?? (L.jobs.get(s(jobId))?.customerId ? L.customers.get(L.jobs.get(s(jobId))!.customerId!) : null) ?? null;
  const out: Txn[] = [];
  for (const r of rowsOf(inv)) out.push({ key: `invoice:${s(r.id)}`, source: "invoice", id: s(r.id), date: dt(r.issue_date || r.created_at), number: s(r.number) || "Draft", description: `${s(r.kind)} invoice${r.memo ? ` · ${s(r.memo)}` : ""}`,
    account: "Receivables", category: "Income", direction: "none", amount: m(r.total), party: s((r.bill_to as Row | null)?.name) || cust(r.customer_id, r.job_id), jobId: (r.job_id as string | null) ?? null, project: jobLabel(L, r.job_id),
    posting: post(r.status), recon: "n_a", documents: 0, href: jobHref(L, r.job_id, "#billing") });
  const payJob = new Map(rowsOf(pay).map((p) => [s(p.id), p]));
  for (const r of rowsOf(pay)) out.push({ key: `payment:${s(r.id)}`, source: "payment", id: s(r.id), date: dt(r.received_on), number: s(r.number), description: `Payment received${r.reference ? ` · ref ${s(r.reference)}` : ""}${r.memo ? ` · ${s(r.memo)}` : ""}`,
    account: money("payment", s(r.id), r.method), category: "Income", direction: "in", amount: m(r.amount), party: cust(r.customer_id, r.job_id), jobId: (r.job_id as string | null) ?? null, project: jobLabel(L, r.job_id),
    posting: post(r.status), recon: r.status === "void" ? "n_a" : recon("payment", s(r.id)), documents: 0, href: jobHref(L, r.job_id, "#billing") ?? "/financials/records?view=payments" });
  for (const r of rowsOf(ref)) { const p = payJob.get(s(r.payment_id)); out.push({ key: `refund:${s(r.id)}`, source: "refund", id: s(r.id), date: dt(r.refunded_on), number: s(r.number), description: `Refund to customer${r.memo ? ` · ${s(r.memo)}` : ""}`,
    account: money("refund", s(r.id), r.method), category: "Income (refund)", direction: "out", amount: m(r.amount), party: p ? cust(p.customer_id, p.job_id) : null, jobId: (p?.job_id as string | null) ?? null, project: p ? jobLabel(L, p.job_id) : null,
    posting: post(r.status), recon: r.status === "void" ? "n_a" : recon("refund", s(r.id)), documents: 0, href: p ? jobHref(L, p.job_id, "#billing") : null }); }
  for (const r of rowsOf(cm)) out.push({ key: `credit_memo:${s(r.id)}`, source: "credit_memo", id: s(r.id), date: dt(r.issue_date), number: s(r.number), description: `Credit · ${s(r.reason)}`,
    account: "Receivables", category: "Income (credit)", direction: "none", amount: m(r.amount), party: cust(r.customer_id, r.job_id), jobId: (r.job_id as string | null) ?? null, project: jobLabel(L, r.job_id),
    posting: post(r.status), recon: "n_a", documents: 0, href: jobHref(L, r.job_id, "#billing") });
  const billLines = rowsOf(lines);
  const billMap = new Map(rowsOf(bills).map((b) => [s(b.id), b]));
  const catOf = (codeId: unknown) => { const c = L.codes.get(s(codeId)); return c ? CATEGORY_LABELS[categoryOf(c.type)] : CATEGORY_LABELS.uncategorized; };
  for (const r of rowsOf(bills)) {
    const ls = billLines.filter((l) => l.bill_id === r.id);
    const jobs = [...new Set(ls.map((l) => s(l.job_id)))];
    const cats = [...new Set(ls.map((l) => catOf(l.cost_code_id)))];
    out.push({ key: `bill:${s(r.id)}`, source: "bill", id: s(r.id), date: dt(r.bill_date), number: s(r.number), description: `Vendor invoice #${s(r.vendor_invoice_number)}${r.memo ? ` · ${s(r.memo)}` : ""}`,
      account: "Payables", category: cats.length === 1 ? cats[0] : "Several categories", direction: "none", amount: m(r.total), party: L.vendors.get(s(r.vendor_id))?.name ?? null,
      jobId: jobs.length === 1 && jobs[0] ? jobs[0] : null, project: jobs.length === 1 ? (jobs[0] ? jobLabel(L, jobs[0]) : "Overhead") : `${jobs.length} projects`,
      posting: post(r.status), recon: "n_a", documents: r.document_id ? 1 : 0, href: jobs.length === 1 && jobs[0] ? jobHref(L, jobs[0], "#costs") : "/financials/records?view=costs" });
  }
  for (const r of rowsOf(bp)) { const b = billMap.get(s(r.bill_id)); out.push({ key: `bill_payment:${s(r.id)}`, source: "bill_payment", id: s(r.id), date: dt(r.paid_on), number: b ? `${s(b.number)}-P` : "Payment", description: `Paid bill${b ? ` ${s(b.number)}` : ""}${r.reference ? ` · ref ${s(r.reference)}` : ""}`,
    account: money("bill_payment", s(r.id), r.method), category: "Bill payment", direction: "out", amount: m(r.amount), party: b ? L.vendors.get(s(b.vendor_id))?.name ?? null : null, jobId: null, project: null,
    posting: post(r.status), recon: r.status === "void" ? "n_a" : recon("bill_payment", s(r.id)), documents: 0, href: "/financials/records?view=costs" }); }
  for (const r of rowsOf(exps)) out.push({ key: `expense:${s(r.id)}`, source: "expense", id: s(r.id), date: dt(r.spent_on), number: s(r.number), description: s(r.description),
    account: money("expense", s(r.id), r.method), category: catOf(r.cost_code_id), direction: "out", amount: m(r.amount), party: L.vendors.get(s(r.vendor_id))?.name ?? (s(r.payee) || null),
    jobId: (r.job_id as string | null) ?? null, project: jobLabel(L, r.job_id) ?? "Overhead", posting: post(r.status), recon: r.status === "void" || r.status === "rejected" ? "n_a" : recon("expense", s(r.id)),
    documents: r.receipt_document_id ? 1 : 0, href: jobHref(L, r.job_id, "#costs") ?? "/financials/records?view=costs" });
  return out;
}

// ---- Reports --------------------------------------------------------------------------------------------------------
export interface ApRow extends AgingRow { vendor_id: string; total: string; bill_date: string; kind: string }
export async function loadApAging(db: Db, bookId: string, L: Lookups) {
  const [bills, bal] = await Promise.all([
    db.from("fin_vendor_bills").select("id, number, vendor_id, vendor_invoice_number, bill_date, due_date, total").eq("book_id", bookId).eq("status", "approved"),
    db.from("fin_bill_balances_v").select("bill_id, balance").eq("book_id", bookId),
  ]);
  const b = new Map(rowsOf(bal).map((r) => [s(r.bill_id), m(r.balance)]));
  const rows: ApRow[] = rowsOf(bills).map((r) => ({ id: s(r.id), number: `${s(r.number)} (#${s(r.vendor_invoice_number)})`, party: L.vendors.get(s(r.vendor_id))?.name ?? "Vendor", vendor_id: s(r.vendor_id),
    kind: L.vendors.get(s(r.vendor_id))?.kind ?? "", due_date: r.due_date ? dt(r.due_date) : null, bill_date: dt(r.bill_date), total: m(r.total), balance: b.get(s(r.id)) ?? m(r.total) }))
    .filter((r) => cmp(r.balance, 0) > 0);
  return { rows, ...agingTotals(rows, todayIso()) };
}

export async function loadArAgingRows(db: Db, bookId: string) {
  const { data } = await db.from("fin_ar_invoices_v").select("invoice_id, number, customer_name, job_name, due_date, total, balance").eq("book_id", bookId);
  const rows = ((data ?? []) as Row[]).filter((r) => cmp(m(r.balance), 0) > 0).map((r) => ({ id: s(r.invoice_id), number: s(r.number), party: s(r.customer_name) || "Customer", due_date: r.due_date ? dt(r.due_date) : null, balance: m(r.balance), total: m(r.total), job: s(r.job_name) }));
  return { rows, ...agingTotals(rows, todayIso()) };
}

export async function loadCustomerBalances(db: Db, bookId: string, L: Lookups) {
  const [ar, pays] = await Promise.all([
    db.from("fin_ar_invoices_v").select("customer_id, customer_name, total, paid, credited, balance").eq("book_id", bookId),
    db.from("fin_payment_balances_v").select("customer_id, job_id, unapplied, status").eq("book_id", bookId).eq("status", "active"),
  ]);
  const by = new Map<string, { customer: string; invoiced: string; paid: string; credited: string; balance: string; unapplied: string; invoices: number }>();
  const get = (id: string, name: string) => by.get(id) ?? by.set(id, { customer: name, invoiced: "0.00", paid: "0.00", credited: "0.00", balance: "0.00", unapplied: "0.00", invoices: 0 }).get(id)!;
  for (const r of rowsOf(ar)) { const c = get(s(r.customer_id) || "none", s(r.customer_name) || "No customer"); c.invoiced = add(c.invoiced, m(r.total)); c.paid = add(c.paid, m(r.paid)); c.credited = add(c.credited, m(r.credited)); c.balance = add(c.balance, m(r.balance)); c.invoices++; }
  for (const p of rowsOf(pays)) {
    if (isZero(m(p.unapplied))) continue;
    const cid = s(p.customer_id) || s(L.jobs.get(s(p.job_id))?.customerId) || "none";
    const c = get(cid, L.customers.get(cid) ?? "No customer"); c.unapplied = add(c.unapplied, m(p.unapplied));
  }
  return [...by.values()].sort((a, b) => cmp(b.balance, a.balance));
}

export interface JobCostRow { jobId: string; project: string; href: string | null; trade: string; budget: string; committed: string; actual: string; forecast: string; variance: string }
/** Budget (frozen from the contract version), committed (open, unbilled), actual (approved bills + expenses), variance = budget − forecast. */
export async function loadJobCosting(db: Db, bookId: string, L: Lookups) {
  const { data } = await db.from("fin_job_budget_v").select("job_id, trade_slug, cost_type, estimated, committed, actual, forecast").eq("book_id", bookId);
  const by = new Map<string, JobCostRow>();
  for (const r of (data ?? []) as Row[]) {
    const k = `${s(r.job_id)}|${s(r.trade_slug) || "—"}`;
    const row = by.get(k) ?? { jobId: s(r.job_id), project: jobLabel(L, r.job_id) ?? "Project", href: jobHref(L, r.job_id, "#costs"), trade: s(r.trade_slug) || "Not coded", budget: "0.00", committed: "0.00", actual: "0.00", forecast: "0.00", variance: "0.00" };
    row.budget = add(row.budget, m(r.estimated)); row.committed = add(row.committed, m(r.committed)); row.actual = add(row.actual, m(r.actual)); row.forecast = add(row.forecast, m(r.forecast));
    row.variance = sub(row.budget, row.forecast);
    by.set(k, row);
  }
  return [...by.values()].sort((a, b) => a.project.localeCompare(b.project) || a.trade.localeCompare(b.trade));
}

const LABOR_TYPES = ["labor", "labor_burden", "labor_material"];
export async function loadLaborVariance(db: Db, bookId: string, L: Lookups) {
  const { data } = await db.from("fin_job_budget_v").select("job_id, cost_type, estimated, committed, actual").eq("book_id", bookId).in("cost_type", LABOR_TYPES);
  const by = new Map<string, { jobId: string; project: string; href: string | null; estimated: string; committed: string; actual: string; variance: string }>();
  for (const r of (data ?? []) as Row[]) {
    const row = by.get(s(r.job_id)) ?? { jobId: s(r.job_id), project: jobLabel(L, r.job_id) ?? "Project", href: jobHref(L, r.job_id, "#costs"), estimated: "0.00", committed: "0.00", actual: "0.00", variance: "0.00" };
    row.estimated = add(row.estimated, m(r.estimated)); row.committed = add(row.committed, m(r.committed)); row.actual = add(row.actual, m(r.actual)); row.variance = sub(row.estimated, add(row.actual, row.committed));
    by.set(s(r.job_id), row);
  }
  return [...by.values()].sort((a, b) => cmp(a.variance, b.variance));
}

export async function loadExpensesByCategory(db: Db, bookId: string, from: string, to: string) {
  const pl = await loadPl(db, bookId, "billed", from, to);
  if (!pl.ok) return null;
  const by = new Map<string, string>();
  for (const r of pl.data.rows) if (r.dir === "cost") { const c = CATEGORY_LABELS[categoryOf(r.type)]; by.set(c, add(by.get(c) ?? "0.00", r.amount)); }
  const rows = [...by.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => cmp(b.amount, a.amount));
  return { rows, total: add(0, ...rows.map((r) => r.amount)) };
}

export async function loadSubPayments(db: Db, bookId: string, L: Lookups, from: string, to: string) {
  const [bp, bills, exps] = await Promise.all([
    db.from("fin_bill_payments").select("bill_id, paid_on, amount").eq("book_id", bookId).eq("status", "active").gte("paid_on", from).lte("paid_on", to),
    db.from("fin_vendor_bills").select("id, vendor_id").eq("book_id", bookId),
    db.from("fin_expenses").select("vendor_id, spent_on, amount").eq("book_id", bookId).eq("status", "approved").not("vendor_id", "is", null).gte("spent_on", from).lte("spent_on", to),
  ]);
  const billVendor = new Map(rowsOf(bills).map((b) => [s(b.id), s(b.vendor_id)]));
  const by = new Map<string, { vendor: string; bills: string; expenses: string; total: string; count: number }>();
  const hit = (vid: string, k: "bills" | "expenses", amt: string) => {
    const v = L.vendors.get(vid);
    if (!v || v.kind !== "subcontractor") return;
    const row = by.get(vid) ?? { vendor: v.name, bills: "0.00", expenses: "0.00", total: "0.00", count: 0 };
    row[k] = add(row[k], amt); row.total = add(row.total, amt); row.count++;
    by.set(vid, row);
  };
  for (const p of rowsOf(bp)) hit(billVendor.get(s(p.bill_id)) ?? "", "bills", m(p.amount));
  for (const x of rowsOf(exps)) hit(s(x.vendor_id), "expenses", m(x.amount));
  return [...by.values()].sort((a, b) => cmp(b.total, a.total));
}

// ---- Audit trail ------------------------------------------------------------------------------------------------------
export interface AuditEntry { id: number; created_at: string; action: string; entity_type: string; entity_id: string | null; details: Row | null; actor_id: string | null; actor_name: string }
export async function loadAudit(db: Db, bookId: string, p: Record<string, string | number | undefined>): Promise<{ ok: true; rows: AuditEntry[] } | { ok: false; reason: "not_installed" | "forbidden" | "error" }> {
  const { data, error } = await db.rpc("fin_audit_list", { p_book_id: bookId, p });
  if (error) return { ok: false, reason: isMissing(error) ? "not_installed" : /forbidden/.test(error.message ?? "") ? "forbidden" : "error" };
  return { ok: true, rows: (data ?? []) as AuditEntry[] };
}
