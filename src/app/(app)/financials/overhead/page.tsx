import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { formatCurrency } from "@/lib/estimate/money";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FinStateNotice } from "@/components/financials/fin-state-notice";
import { SandboxBar } from "@/components/financials/sandbox-bar";
import { MetricCard } from "@/components/ui/metric-card";
import { Badge, Notice } from "@/components/ui/misc";
import { fmtDateServer } from "@/lib/financials/accounting-format";
import { ApproveBill, OverheadForm, PayBill, RecurringEnter } from "@/components/financials/overhead";
import { categoryFromLine, overheadCategoryLabel, parseRecurringNote, payStatus, PAY_STATUS_LABEL, RECURRENCE_LABEL, type Recurrence } from "@/lib/financials/overhead";
import { can } from "@/lib/tax-banking/capabilities";

export const metadata: Metadata = { title: "Overhead & bills", robots: { index: false } };
type Row = Record<string, unknown>;
const $ = (v: unknown) => formatCurrency(String(v ?? "0"));
const n = (v: unknown) => Number(v ?? 0) || 0;
const dayOffset = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

/**
 * Business overhead (V9 Phase 2): company costs with no customer project, entered by hand with or without a
 * bank connection. Reads through RLS; every write goes through the Financials RPCs (see /api/financials/overhead).
 */
export default async function OverheadPage() {
  if (!isFinancialsEnabled()) notFound();
  const db = await createClient();
  const state = await loadFinState(db);
  const crumbs = <Breadcrumbs className="mb-3" items={[{ label: "Financials", href: "/financials" }, { label: "Overhead & bills" }]} />;
  if (state.kind !== "ready") return <div className="mx-auto max-w-4xl space-y-4">{crumbs}<FinStateNotice state={state} /></div>;
  const { ctx } = state;
  const perms = ctx.access.permissions;
  const b = ctx.bookId;
  if (!perms.includes("view_company_financials") && !perms.includes("record_bills")) {
    return <div className="mx-auto max-w-4xl space-y-4">{crumbs}<h1 className="text-3xl font-extrabold">Overhead &amp; bills</h1>
      <Notice title="Your financial role doesn't include company costs">Ask your company owner for a role that can see company financials or record bills.</Notice></div>;
  }
  const writable = ctx.access.active && !ctx.access.readOnly;
  const canRecord = writable && perms.includes("record_bills");
  const canApprove = writable && perms.includes("approve_vendor_bills");
  const canPlan = writable && can(perms, "cash.manage_plan");

  const since = dayOffset(-365);
  const [lines, expenses, vendors, plans] = await Promise.all([
    db.from("fin_vendor_bill_lines").select("bill_id, description, amount").eq("book_id", b).is("job_id", null).limit(2000),
    db.from("fin_expenses").select("id, number, payee, vendor_id, spent_on, amount, description, status, method").eq("book_id", b).is("job_id", null).in("status", ["pending", "approved"]).gte("spent_on", since).order("spent_on", { ascending: false }).limit(200),
    db.from("fin_vendors").select("id, name").eq("book_id", b).eq("status", "active").order("name").limit(1000),
    db.from("fin_cash_events").select("id, label, amount, expected_on, recurrence, note, kind").eq("book_id", b).eq("status", "active").eq("kind", "recurring_expense").order("expected_on"),
  ]);
  const lineRows = (lines.data ?? []) as Row[];
  const billIds = [...new Set(lineRows.map((l) => String(l.bill_id)))];
  const { data: billsRaw } = billIds.length
    ? await db.from("fin_bill_balances_v").select("bill_id, vendor_id, number, vendor_invoice_number, bill_date, due_date, status, total, paid, balance, days_overdue").in("bill_id", billIds.slice(0, 1000)).neq("status", "void").gte("bill_date", since).order("due_date", { ascending: true })
    : { data: [] };
  const vendorList = ((vendors.data ?? []) as Row[]).map((v) => ({ id: String(v.id), name: String(v.name) }));
  const vendorName = new Map(vendorList.map((v) => [v.id, v.name]));
  const firstLine = new Map<string, string>();
  for (const l of lineRows) if (!firstLine.has(String(l.bill_id))) firstLine.set(String(l.bill_id), String(l.description ?? ""));
  const bills = ((billsRaw ?? []) as Row[]).map((r) => {
    const total = n(r.total), paid = n(r.paid);
    const desc = firstLine.get(String(r.bill_id)) ?? "";
    return { id: String(r.bill_id), number: String(r.number ?? ""), vendor: vendorName.get(String(r.vendor_id)) ?? "Vendor", ref: String(r.vendor_invoice_number ?? ""),
      billDate: String(r.bill_date).slice(0, 10), dueDate: String(r.due_date).slice(0, 10), approved: r.status === "approved", total, paid, balance: n(r.balance),
      overdue: n(r.days_overdue) > 0, status: payStatus(total, paid), category: overheadCategoryLabel(categoryFromLine(desc)), desc };
  });
  const open = bills.filter((x) => x.status !== "paid");
  const paidBills = bills.filter((x) => x.status === "paid").slice(-25).reverse();

  const monthStart = dayOffset(0).slice(0, 8) + "01";
  const in30 = dayOffset(30);
  const expRows = (expenses.data ?? []) as Row[];
  const thisMonth = bills.filter((x) => x.billDate >= monthStart).reduce((s, x) => s + x.total, 0) + expRows.filter((x) => String(x.spent_on) >= monthStart).reduce((s, x) => s + n(x.amount), 0);
  const unpaid = open.reduce((s, x) => s + (x.approved ? x.balance : x.total - x.paid), 0);
  const dueSoon = open.filter((x) => x.dueDate <= in30).reduce((s, x) => s + (x.approved ? x.balance : x.total - x.paid), 0);
  const pending = open.filter((x) => !x.approved).length;

  const planRows = ((plans.data ?? []) as Row[]).map((p) => ({ id: String(p.id), label: String(p.label), amount: String(p.amount), next: String(p.expected_on).slice(0, 10), recurrence: String(p.recurrence) as Recurrence, tag: parseRecurringNote(p.note as string | null) }));

  return (
    <div className="mx-auto max-w-7xl space-y-5" data-testid="fin-overhead" data-guide-page="financials.overhead">
      {ctx.access.sandbox && <SandboxBar sandbox canManage={perms.includes("manage_financial_config")} />}
      {crumbs}
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Financials</p>
          <h1 className="text-3xl font-extrabold">Overhead &amp; bills</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">Rent, insurance, software, vehicles, office payroll and other costs of running the business. Enter them by hand, no bank needed. They count as overhead in Profit &amp; Loss, and unpaid ones show in your cash-flow forecast.</p>
        </div>
        <Link href="/financials/cash" className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-sm font-semibold hover:bg-black/5">Cash flow</Link>
        <Link href="/financials/reports?dir=cost&oh=1&show=records#records" className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-sm font-semibold hover:bg-black/5">Overhead in P&amp;L</Link>
      </header>
      {ctx.access.readOnly && <Notice tone="warn" title="Read-only">The Financials add-on lapsed. Everything stays readable; changes are paused.</Notice>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="overhead-kpis">
        <MetricCard size="sm" title="Overhead this month" value={$(thisMonth.toFixed(2))} sub="Bills and expenses with no project" href="#paid" />
        <MetricCard size="sm" title="Unpaid overhead" value={$(unpaid.toFixed(2))} sub={`${open.length} open bill${open.length === 1 ? "" : "s"}`} href="#open" empty={open.length === 0} />
        <MetricCard size="sm" title="Due in the next 30 days" value={$(dueSoon.toFixed(2))} sub="Includes anything past due" href="#open" empty={dueSoon === 0} />
        <MetricCard size="sm" title="Recurring costs" value={String(planRows.length)} sub="Planned in the cash-flow forecast" href="#recurring" empty={planRows.length === 0} />
      </div>

      <div data-guide="fin.overhead-form">{canRecord ? <OverheadForm vendors={vendorList} canPlan={canPlan} /> : <Notice title="View only">Your financial role can see overhead but not record bills.</Notice>}</div>

      <section id="open" aria-labelledby="open-h" className="scroll-mt-4 space-y-2" data-guide="fin.overhead-open">
        <h2 id="open-h" className="font-display text-lg font-extrabold">Open bills ({open.length})</h2>
        {pending > 0 && <p className="text-sm text-ink-soft">{pending} waiting for approval. They join the cash-flow forecast once approved.</p>}
        {open.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="overhead-open">
            {open.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{x.vendor} <span className="font-normal text-muted">· {x.number}{x.ref && !x.ref.startsWith("OH-") ? ` · #${x.ref}` : ""}</span></p>
                  <p className="text-xs text-muted">{x.desc || x.category} · Due {fmtDateServer(x.dueDate)}</p>
                </div>
                <span className="flex flex-wrap items-center gap-2">
                  {!x.approved ? <Badge tone="warn">Waiting for approval</Badge> : x.overdue ? <Badge tone="danger">Past due</Badge> : <Badge tone={x.status === "partial" ? "warn" : "neutral"}>{PAY_STATUS_LABEL[x.status]}</Badge>}
                  <span className="text-right tabular-nums"><b>{$(x.approved ? x.balance.toFixed(2) : x.total.toFixed(2))}</b>{x.paid > 0 && <span className="block text-xs text-muted">of {$(x.total.toFixed(2))}</span>}</span>
                </span>
                <span className="flex basis-full flex-wrap gap-2 sm:basis-auto">
                  {!x.approved && canApprove && <ApproveBill billId={x.id} />}
                  {x.approved && canRecord && <PayBill billId={x.id} balance={x.balance.toFixed(2)} />}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-muted">No unpaid overhead bills.</p>}
      </section>

      <section id="recurring" aria-labelledby="rec-h" className="scroll-mt-4 space-y-2" data-guide="fin.overhead-recurring">
        <h2 id="rec-h" className="font-display text-lg font-extrabold">Recurring costs ({planRows.length})</h2>
        <p className="text-sm text-ink-soft">Planned in the cash-flow forecast until you enter the actual bill. Entering it moves the plan to the next date.</p>
        {planRows.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="overhead-recurring">
            {planRows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.label}</p>
                  <p className="text-xs text-muted">{RECURRENCE_LABEL[p.recurrence] ?? p.recurrence} · next {fmtDateServer(p.next)}{p.tag ? ` · ${vendorName.get(p.tag.vendorId) ?? "Vendor"}` : " · from the cash plan"}</p>
                </div>
                <b className="tabular-nums">{$(p.amount)}</b>
                {canRecord && <RecurringEnter vendors={vendorList} canPlan={canPlan}
                  prefill={{ recurringEventId: p.id, vendorId: p.tag?.vendorId, category: p.tag?.category ?? "other", amount: p.amount, dueDate: p.next, label: p.label,
                    description: p.label.includes(": ") ? p.label.split(": ").slice(1).join(": ") : p.tag ? "" : p.label }} />}
              </li>
            ))}
          </ul>
        ) : <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-muted">No recurring costs yet. Choose &quot;Repeats&quot; when you add rent, insurance or a subscription.</p>}
      </section>

      <section id="paid" aria-labelledby="paid-h" className="scroll-mt-4 space-y-2">
        <h2 id="paid-h" className="font-display text-lg font-extrabold">Recently paid</h2>
        {paidBills.length + expRows.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm" data-testid="overhead-paid">
            {paidBills.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1"><p className="font-semibold">{x.vendor} <span className="font-normal text-muted">· {x.number}</span></p><p className="text-xs text-muted">{x.desc || x.category} · {fmtDateServer(x.billDate)}</p></div>
                <Badge tone="ok">Paid</Badge><b className="tabular-nums">{$(x.total.toFixed(2))}</b>
              </li>
            ))}
            {expRows.slice(0, 25).map((x) => (
              <li key={String(x.id)} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1"><p className="font-semibold">{String(x.payee ?? (x.vendor_id ? vendorName.get(String(x.vendor_id)) : null) ?? "Expense")} <span className="font-normal text-muted">· {String(x.number)}</span></p><p className="text-xs text-muted">{String(x.description ?? "")} · {fmtDateServer(String(x.spent_on))}</p></div>
                <Badge tone={x.status === "approved" ? "ok" : "neutral"}>{x.status === "approved" ? "Expense" : "Expense · pending"}</Badge><b className="tabular-nums">{$(x.amount)}</b>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-muted">Nothing paid yet.</p>}
        <p className="text-xs text-muted">Bank lines you match to these bills or expenses are linked to them, so a payment is never counted twice.</p>
      </section>
    </div>
  );
}
