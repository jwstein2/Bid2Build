/**
 * Customer account ledger (pure, unit-tested): one dated list of invoices (debits), payments and credits
 * (credits) with a running balance. Voided documents are listed but don't move the balance. Refunds of
 * unapplied money add back. All amounts are decimal strings.
 */
import { add, sub } from "./money";

export interface LedgerInput {
  invoices: { id: string; number: string; issue_date: string; total: string; status: string; job_name?: string }[];
  payments: { id: string; number: string; received_on: string; amount: string; refunded: string; status: string; method: string }[];
  credits: { id: string; number: string; issue_date: string; amount: string; refunded: string; status: string }[];
}
export interface LedgerLine { key: string; date: string; kind: "invoice" | "payment" | "credit" | "refund"; ref: string; detail: string; charge: string; credit: string; balance: string; voided: boolean }

export function buildLedger(i: LedgerInput): { lines: LedgerLine[]; balance: string } {
  type Ev = Omit<LedgerLine, "balance"> & { order: number };
  const ev: Ev[] = [];
  for (const x of i.invoices) ev.push({ key: `i${x.id}`, date: x.issue_date, kind: "invoice", ref: x.number, detail: x.job_name ?? "", charge: x.total, credit: "0.00", voided: x.status === "void", order: 0 });
  for (const p of i.payments) {
    ev.push({ key: `p${p.id}`, date: p.received_on, kind: "payment", ref: p.number, detail: p.method, charge: "0.00", credit: p.amount, voided: p.status === "void", order: 1 });
    if (p.status === "active" && Number(p.refunded) > 0) ev.push({ key: `r${p.id}`, date: p.received_on, kind: "refund", ref: p.number, detail: "Refund", charge: p.refunded, credit: "0.00", voided: false, order: 2 });
  }
  for (const c of i.credits) {
    ev.push({ key: `c${c.id}`, date: c.issue_date, kind: "credit", ref: c.number, detail: "Credit memo", charge: "0.00", credit: c.amount, voided: c.status === "void", order: 1 });
    if (c.status === "issued" && Number(c.refunded) > 0) ev.push({ key: `cr${c.id}`, date: c.issue_date, kind: "refund", ref: c.number, detail: "Credit refunded", charge: c.refunded, credit: "0.00", voided: false, order: 2 });
  }
  ev.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));
  let bal = "0.00";
  const lines = ev.map((e) => {
    if (!e.voided) bal = add(sub(bal, e.credit), e.charge);
    return { key: e.key, date: e.date, kind: e.kind, ref: e.ref, detail: e.detail, charge: e.charge, credit: e.credit, voided: e.voided, balance: bal };
  });
  return { lines, balance: bal };
}
