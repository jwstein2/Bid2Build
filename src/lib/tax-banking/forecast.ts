/**
 * Projected cash flow (V6.9). Pure: the page loads records, this turns them into a forecast.
 *
 * Three lines, never mixed up:
 *   Confirmed  = the bank-REPORTED balance (what the connected bank says now). Flat: nothing future is confirmed.
 *   Scheduled  = Confirmed + known obligations (bills by due date, payroll, recurring costs, outstanding checks) +
 *                contractual receivables on their due dates (issued invoices not yet overdue, deposits in transit).
 *                A scheduled receivable is still not guaranteed.
 *   Expected   = Scheduled outflows + estimated collections: invoices on the date this customer usually pays
 *                (due date + their average days late), overdue invoices, upcoming milestones, expected deposits.
 * Rules: an unpaid invoice is never cash; a won bid adds nothing until it is invoiced; payments dated on or before the
 * balance date are assumed to be in that balance (no double count); transfers between two selected accounts net to
 * zero; a stale or missing bank balance is reported, never invented.
 */
import { dec, money2 } from "./num";

export type Certainty = "confirmed" | "scheduled" | "expected";
export type FlowCategory = "customer_payment" | "deposit" | "milestone" | "payroll" | "supplier" | "subcontractor" | "recurring" | "check" | "transfer" | "other";

export interface ForecastAccount {
  id: string; name: string; current: string | null; available: string | null; asOf: string | null; status: string; included: boolean;
  /** Where the starting balance came from: a connected bank (default) or an imported bank statement. */
  basis?: "connected" | "statement";
}
/** Money recorded as paid out (bill payments, expenses) that may not be on the latest imported statement yet. */
export interface RecordedOutflow { id: string; label: string; amount: string; date: string; kind: "bill_payment" | "expense"; accountId?: string | null }
export interface OpenInvoice { id: string; number: string; balance: string; dueDate: string | null; customerId: string | null; customerName?: string | null; jobId?: string | null }
export interface UpcomingMilestone { id: string; label: string; amount: string; expectedOn: string | null; jobId?: string | null }
export interface OpenBill { id: string; label: string; balance: string; dueDate: string | null; vendorKind?: "subcontractor" | "supplier" | "other" }
export interface PendingCheck { id: string; label: string; amount: string; date: string; kind: "bill_payment" | "expense" }
export interface DepositInTransit { id: string; label: string; amount: string; receivedOn: string }
export interface PlannedEvent {
  id: string; kind: string; label: string; amount: string; direction: "in" | "out"; expectedOn: string; recurrence: "none" | "weekly" | "biweekly" | "monthly";
  recurUntil: string | null; certainty: "scheduled" | "expected"; accountId: string | null; toAccountId: string | null; invoiceId: string | null; settlement?: string | null;
}

export interface ForecastInput {
  today: string;                       // YYYY-MM-DD
  horizonDays: number;                 // 7..365 (or custom end)
  endDate?: string;
  accounts: ForecastAccount[];
  includeBankBalance: boolean;         // false when the viewer can't see bank balances: start from $0 (net change)
  invoices: OpenInvoice[];
  milestones: UpcomingMilestone[];
  bills: OpenBill[];
  checks: PendingCheck[];
  depositsInTransit: DepositInTransit[];
  /** Used only for statement-based balances: unmatched payments out dated after the statement. */
  recordedOutflows?: RecordedOutflow[];
  planned: PlannedEvent[];
  /** Average days customers pay after the due date, from their payment history. */
  customerLateness?: Record<string, number>;
  defaultLatenessDays?: number;
  staleHours?: number;
  /**
   * V9 (optional, additive): flows computed by the V9 layer (src/lib/cash-v9) such as schedule-projected milestones,
   * open commitments, uncommitted budget and payroll from schedules. Each brings its own scheduled / expected dates.
   * Callers that don't pass it get exactly the V6.9 forecast.
   */
  extra?: ExtraFlow[];
  /** V9: planned-event kinds left out because a V9 flow replaces them (e.g. manual payroll when payroll comes from schedules). */
  excludePlannedKinds?: string[];
}

/** A V9 flow. amount is signed (+ in, - out). scheduledOn null = expected only. */
export interface ExtraFlow {
  key: string; label: string; amount: string; category: FlowCategory; scheduledOn: string | null; expectedOn: string;
  href: string | null; note?: string; jobId?: string | null; accountId?: string | null;
}

export interface CashEvent { key: string; date: string; label: string; amount: string; category: FlowCategory; certainty: Certainty; href: string | null; note?: string; accountId?: string | null; jobId?: string | null }
export interface SeriesPoint { date: string; confirmed: string; scheduled: string; expected: string }

export interface Forecast {
  opening: string | null;
  openingAsOf: string | null;
  openingAvailable: string | null;
  startsFromBank: boolean;
  /** "statement" when every included balance comes from an imported statement, "mixed" when some do. */
  basis: "connected" | "statement" | "mixed" | null;
  stale: boolean;
  /** An imported statement balance is more than STATEMENT_STALE_DAYS old. */
  statementOld: boolean;
  missingBalances: string[];
  events: CashEvent[];             // expected-view dates (each event lists its own certainty)
  scheduledEvents: CashEvent[];    // scheduled-view dates
  series: SeriesPoint[];
  totals: { scheduledIn: string; scheduledOut: string; expectedIn: string; expectedOut: string };
  end: { confirmed: string; scheduled: string; expected: string };
  lowPoint: { date: string; value: string; view: "scheduled" | "expected" } | null;
}

/** Days after which an imported statement balance is flagged as old (import a newer one). */
export const STATEMENT_STALE_DAYS = 35;

/**
 * Balance from imported statements for one account: the newest statement's ending balance when it gave one
 * and covers the newest imported line; otherwise the account's opening balance plus every imported line.
 */
export function statementBalance(
  account: { opening_balance: string | number | null; opening_date: string | null },
  imports: { statement_end: string | null; ending_balance: string | number | null }[],
  lines: { posted_on: string; amount: string | number }[],
): { amount: string; asOf: string } | null {
  const lastLine = lines.reduce<string | null>((m, l) => (!m || l.posted_on > m ? l.posted_on : m), null);
  const st = imports.filter((i) => i.ending_balance !== null && i.ending_balance !== undefined && i.statement_end).sort((a, b) => String(b.statement_end).localeCompare(String(a.statement_end)))[0];
  if (st && (!lastLine || String(st.statement_end) >= lastLine)) return { amount: money2(dec(st.ending_balance)), asOf: String(st.statement_end).slice(0, 10) };
  if (!lastLine) return null;
  return { amount: money2(lines.reduce((s, l) => s.plus(dec(l.amount)), dec(account.opening_balance ?? 0))), asOf: lastLine };
}

const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 864e5);
const maxD = (a: string, b: string) => (a > b ? a : b);

function occurrences(e: PlannedEvent, from: string, to: string): string[] {
  const out: string[] = [];
  const until = e.recurUntil && e.recurUntil < to ? e.recurUntil : to;
  let d = e.expectedOn;
  for (let i = 0; i < 400 && d <= until; i++) {
    if (d >= from) out.push(d);
    if (e.recurrence === "none") break;
    if (e.recurrence === "weekly") d = addDays(d, 7);
    else if (e.recurrence === "biweekly") d = addDays(d, 14);
    else { const x = new Date(`${d}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); d = x.toISOString().slice(0, 10); }
  }
  return out;
}

const PLANNED_CATEGORY: Record<string, FlowCategory> = {
  payroll: "payroll", recurring_expense: "recurring", expected_deposit: "deposit", supplier_payment: "supplier", sub_payment: "subcontractor",
  transfer: "transfer", other_inflow: "other", other_outflow: "other",
};

export function buildForecast(input: ForecastInput): Forecast {
  const today = input.today;
  const end = input.endDate ?? addDays(today, Math.max(1, Math.min(365, input.horizonDays)));
  const included = input.accounts.filter((a) => a.included && a.status !== "disconnected");
  const includedIds = new Set(included.map((a) => a.id));
  const missing = included.filter((a) => a.current === null && a.available === null).map((a) => a.name);
  const staleMs = (input.staleHours ?? 36) * 3600_000;
  const asOfs = included.map((a) => a.asOf).filter((x): x is string => Boolean(x)).sort();
  const openingAsOf = asOfs[0] ?? null;
  const connected = included.filter((a) => a.basis !== "statement"), fromStatement = included.filter((a) => a.basis === "statement");
  const nowMs = new Date(`${today}T12:00:00Z`).getTime();
  const stale = connected.some((a) => a.status !== "active" || (a.asOf !== null && Date.now() - new Date(a.asOf).getTime() > staleMs));
  const statementOld = fromStatement.some((a) => a.asOf !== null && nowMs - new Date(`${a.asOf.slice(0, 10)}T12:00:00Z`).getTime() > STATEMENT_STALE_DAYS * 864e5);
  const startsFromBank = input.includeBankBalance && included.length > 0 && missing.length < included.length;
  const opening = startsFromBank ? money2(included.reduce((s, a) => s.plus(dec(a.current ?? a.available)), dec(0))) : null;
  const openingAvailable = startsFromBank && included.every((a) => a.available !== null) ? money2(included.reduce((s, a) => s.plus(dec(a.available)), dec(0))) : null;
  const balanceDay = openingAsOf ? openingAsOf.slice(0, 10) : today;
  const lateness = (c: string | null) => (c && input.customerLateness?.[c] !== undefined ? Math.max(0, Math.round(input.customerLateness[c])) : input.defaultLatenessDays ?? 7);

  type Ev = CashEvent & { scheduledOn: string | null; expectedOn: string };
  const evs: Ev[] = [];
  const push = (e: Omit<Ev, "date" | "certainty"> & { certainty?: Certainty }) => {
    const date = e.expectedOn;
    if (date > end) return;
    evs.push({ ...e, date, certainty: e.certainty ?? (e.scheduledOn ? "scheduled" : "expected") });
  };

  // Planned deposits linked to an invoice replace that invoice's own estimate (no double count).
  const plannedInvoices = new Set(input.planned.filter((p) => p.invoiceId && p.direction === "in").map((p) => p.invoiceId!));

  for (const inv of input.invoices) {
    if (plannedInvoices.has(inv.id) || dec(inv.balance).lte(0)) continue;
    const overdue = inv.dueDate !== null && inv.dueDate < today;
    const late = lateness(inv.customerId);
    const exp = inv.dueDate ? maxD(addDays(inv.dueDate, late), addDays(today, overdue ? Math.max(1, late) : 0)) : addDays(today, 30);
    push({ key: `inv:${inv.id}`, label: `Invoice ${inv.number}${inv.customerName ? ` · ${inv.customerName}` : ""}`, amount: money2(dec(inv.balance)), category: "customer_payment", jobId: inv.jobId ?? null,
      href: `/financials/records?view=invoices&invoice=${inv.id}`, scheduledOn: overdue || !inv.dueDate ? null : maxD(inv.dueDate, today), expectedOn: exp,
      note: overdue ? `Overdue ${diffDays(today, inv.dueDate!)} days: not counted as scheduled` : late ? `This customer usually pays ${late} days after the due date` : undefined });
  }
  for (const m of input.milestones) {
    if (dec(m.amount).lte(0)) continue;
    push({ key: `ms:${m.id}`, label: `Milestone · ${m.label}`, amount: money2(dec(m.amount)), category: "milestone", jobId: m.jobId ?? null, href: m.jobId ? `/financials/jobs/${m.jobId}` : null,
      scheduledOn: null, expectedOn: maxD(m.expectedOn ?? addDays(today, 30), today), note: m.expectedOn ? "Not invoiced yet" : "Ready to invoice, no date set: assumed in about 30 days" });
  }
  for (const d of input.depositsInTransit) {
    if (d.receivedOn <= balanceDay && startsFromBank) continue;   // already in the bank-reported balance
    push({ key: `dit:${d.id}`, label: `Deposit in transit · ${d.label}`, amount: money2(dec(d.amount)), category: "deposit", href: `/financials/records?view=payments&payment=${d.id}`,
      scheduledOn: today, expectedOn: today, note: "Recorded payment not yet on a bank line" });
  }
  // Statement-based balances don't include money paid out after the statement date; subtract it until it shows up on a statement.
  for (const o of input.recordedOutflows ?? []) {
    if (!startsFromBank) break;
    const acct = o.accountId ? included.find((a) => a.id === o.accountId) : fromStatement[0];
    if (!acct || acct.basis !== "statement" || !acct.asOf || o.date <= acct.asOf.slice(0, 10)) continue;
    push({ key: `out:${o.kind}:${o.id}`, label: o.label, amount: money2(dec(o.amount).abs().neg()), category: o.kind === "bill_payment" ? "supplier" : "other",
      href: "/financials/records?view=costs", scheduledOn: today, expectedOn: today, note: "Paid after your last imported statement" });
  }
  for (const b of input.bills) {
    if (dec(b.balance).lte(0)) continue;
    const on = maxD(b.dueDate ?? addDays(today, 30), today);
    push({ key: `bill:${b.id}`, label: b.label, amount: money2(dec(b.balance).neg()), category: b.vendorKind === "subcontractor" ? "subcontractor" : "supplier",
      href: `/financials/records?view=costs&bill=${b.id}`, scheduledOn: on, expectedOn: on, note: b.dueDate && b.dueDate < today ? "Past due" : undefined });
  }
  for (const c of input.checks) {
    push({ key: `chk:${c.kind}:${c.id}`, label: `Outstanding check · ${c.label}`, amount: money2(dec(c.amount).abs().neg()), category: "check", href: "/financials/accounting/bank?view=checks",
      scheduledOn: today, expectedOn: today, note: "Written but not cleared yet" });
  }
  for (const x of input.extra ?? []) {
    if (dec(x.amount).eq(0)) continue;
    push({ key: x.key, label: x.label, amount: money2(dec(x.amount)), category: x.category, href: x.href, note: x.note, jobId: x.jobId ?? null, accountId: x.accountId ?? null,
      scheduledOn: x.scheduledOn ? maxD(x.scheduledOn, today) : null, expectedOn: maxD(x.expectedOn, today) });
  }
  const skipKinds = new Set(input.excludePlannedKinds ?? []);
  for (const p of input.planned) {
    if (skipKinds.has(p.kind)) continue;
    if (p.kind === "transfer") {
      const fromIn = p.accountId ? includedIds.has(p.accountId) : false;
      const toIn = p.toAccountId ? includedIds.has(p.toAccountId) : false;
      if (fromIn === toIn) continue;   // both selected (nets to zero) or neither
      for (const d of occurrences(p, today, end)) push({ key: `pl:${p.id}:${d}`, label: p.label, amount: money2(fromIn ? dec(p.amount).neg() : dec(p.amount)), category: "transfer",
        href: "/financials/cash#plan", scheduledOn: d, expectedOn: d, accountId: fromIn ? p.accountId : p.toAccountId });
      continue;
    }
    if (p.accountId && included.length && !includedIds.has(p.accountId)) continue;
    const sign = p.direction === "in" ? dec(p.amount) : dec(p.amount).neg();
    for (const d of occurrences(p, today, end)) {
      const scheduled = p.certainty === "scheduled" || p.settlement === "processing" || p.settlement === "initiated" || p.settlement === "estimated_available";
      push({ key: `pl:${p.id}:${d}`, label: p.label, amount: money2(sign), category: PLANNED_CATEGORY[p.kind] ?? "other", href: p.invoiceId ? `/financials/records?view=invoices&invoice=${p.invoiceId}` : "/financials/cash#plan",
        scheduledOn: scheduled ? d : null, expectedOn: d, accountId: p.accountId,
        note: p.settlement ? `Settlement: ${p.settlement.replace(/_/g, " ")} (estimate)` : p.kind === "expected_deposit" ? "Expected date entered by your team (estimate)" : undefined });
    }
  }

  const base = dec(opening ?? 0);
  const days: string[] = [];
  for (let d = today; d <= end; d = addDays(d, 1)) days.push(d);
  let sch = base, exp = base;
  let low: Forecast["lowPoint"] = null;
  const series: SeriesPoint[] = days.map((d) => {
    for (const e of evs) {
      if (e.scheduledOn === d) sch = sch.plus(dec(e.amount));
      if (e.expectedOn === d) exp = exp.plus(dec(e.amount));
    }
    if (!low || exp.lt(dec(low.value))) low = { date: d, value: money2(exp), view: "expected" };
    return { date: d, confirmed: money2(base), scheduled: money2(sch), expected: money2(exp) };
  });
  const sumIf = (f: (e: Ev) => boolean) => money2(evs.filter(f).reduce((s, e) => s.plus(dec(e.amount)), dec(0)));
  const clean = ({ scheduledOn: _s, expectedOn: _e, ...rest }: Ev): CashEvent => rest;   // eslint-disable-line @typescript-eslint/no-unused-vars
  return {
    opening, openingAsOf, openingAvailable, startsFromBank, stale, statementOld, missingBalances: missing,
    basis: !startsFromBank ? null : fromStatement.length === 0 ? "connected" : connected.length === 0 ? "statement" : "mixed",
    events: [...evs].sort((a, b) => a.expectedOn.localeCompare(b.expectedOn)).map(clean),
    scheduledEvents: evs.filter((e) => e.scheduledOn).sort((a, b) => a.scheduledOn!.localeCompare(b.scheduledOn!)).map((e) => ({ ...clean(e), date: e.scheduledOn! })),
    series,
    totals: {
      scheduledIn: sumIf((e) => e.scheduledOn !== null && dec(e.amount).gt(0)), scheduledOut: sumIf((e) => e.scheduledOn !== null && dec(e.amount).lt(0)),
      expectedIn: sumIf((e) => dec(e.amount).gt(0)), expectedOut: sumIf((e) => dec(e.amount).lt(0)),
    },
    end: { confirmed: money2(base), scheduled: money2(sch), expected: money2(exp) },
    lowPoint: low,
  };
}

/** Average days paid after the due date, per customer, from fully paid invoices (payment history). */
export function customerLateness(paid: { customerId: string | null; dueDate: string | null; paidOn: string | null }[]): Record<string, number> {
  const acc: Record<string, { n: number; days: number }> = {};
  for (const p of paid) {
    if (!p.customerId || !p.dueDate || !p.paidOn) continue;
    const d = Math.max(0, diffDays(p.paidOn, p.dueDate));
    (acc[p.customerId] ??= { n: 0, days: 0 }).n++;
    acc[p.customerId].days += d;
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.days / v.n]));
}

/** Pair bank lines that look like a transfer between two connected accounts (same amount, opposite sign, ±2 days). */
export function detectTransfers(lines: { id: string; accountId: string; date: string; amount: string }[]): [string, string][] {
  const pairs: [string, string][] = [];
  const used = new Set<string>();
  const outs = lines.filter((l) => dec(l.amount).lt(0));
  for (const o of outs) {
    if (used.has(o.id)) continue;
    const m = lines.find((i) => !used.has(i.id) && i.accountId !== o.accountId && dec(i.amount).eq(dec(o.amount).neg()) && Math.abs(diffDays(i.date, o.date)) <= 2);
    if (m) { pairs.push([o.id, m.id]); used.add(o.id); used.add(m.id); }
  }
  return pairs;
}
