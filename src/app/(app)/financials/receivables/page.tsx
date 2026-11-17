import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { SandboxBar } from "@/components/financials/sandbox-bar";
import { loadFinState } from "@/lib/financials/loaders";
import { formatCurrency } from "@/lib/estimate/money";
import { add } from "@/lib/financials/money";
import { arDates, arTotals, BUCKET_LABELS, BUCKETS, collectedIn, filterAr, nextAction, unappliedTotal, type ArFilters, type ArRow, type Bucket, type PayRow } from "@/lib/financials/receivables";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { MetricCard } from "@/components/ui/metric-card";
import { Badge, Notice } from "@/components/ui/misc";
import { FinStateNotice } from "@/components/financials/fin-state-notice";

export const metadata: Metadata = { title: "Accounts receivable", robots: { index: false } };

type SP = { bucket?: string; customer?: string; job?: string; rep?: string; pm?: string; from?: string; to?: string; q?: string; period?: string };
const UUID = /^[0-9a-f-]{36}$/i, DAY = /^\d{4}-\d{2}-\d{2}$/;
const $ = (v: string) => formatCurrency(v || "0");
const fmt = (d: string) => { if (!d) return "—"; const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };
const BUCKET_KEYS = ["open", "overdue", "paid", "due_soon", "all", ...BUCKETS] as const;

/**
 * Accounting → Accounts Receivable (V5 §8.1, V5.1 §5). Real issued invoices and recorded payments only
 * (fin_ar_invoices_v / fin_payment_balances_v through RLS). Every card opens the matching filtered list and
 * keeps the other filters. Nothing here sends a reminder.
 */
export default async function Receivables({ searchParams }: { searchParams: Promise<SP> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const state = await loadFinState(db);
  const crumbs = <Breadcrumbs className="mb-3" items={[{ label: "Financials", href: "/financials" }, { label: "Accounts receivable" }]} />;
  if (state.kind !== "ready") return <div className="mx-auto max-w-4xl space-y-4">{crumbs}<FinStateNotice state={state} /></div>;
  const { bookId, access } = state.ctx;

  const f: ArFilters = {
    bucket: (BUCKET_KEYS as readonly string[]).includes(sp.bucket ?? "") ? (sp.bucket as ArFilters["bucket"]) : "open",
    customer: sp.customer && UUID.test(sp.customer) ? sp.customer : undefined, job: sp.job && UUID.test(sp.job) ? sp.job : undefined,
    rep: sp.rep && UUID.test(sp.rep) ? sp.rep : undefined, pm: sp.pm && UUID.test(sp.pm) ? sp.pm : undefined,
    from: sp.from && DAY.test(sp.from) ? sp.from : undefined, to: sp.to && DAY.test(sp.to) ? sp.to : undefined, q: sp.q?.slice(0, 80),
  };
  const period = sp.period === "last_month" || sp.period === "year" ? sp.period : "month";
  const { today, soon, from: pFrom, to: pTo } = arDates(period);

  const [{ data: arData, error: arErr }, { data: payData }, { data: book }] = await Promise.all([
    db.from("fin_ar_invoices_v").select("*").eq("book_id", bookId).order("due_date"),
    db.from("fin_payment_balances_v").select("payment_id, received_on, amount, refunded, unapplied, status, customer_id, job_id").eq("book_id", bookId),
    db.from("fin_books").select("company_id").eq("id", bookId).maybeSingle(),
  ]);
  if (arErr) return <div className="mx-auto max-w-4xl space-y-4">{crumbs}<Notice tone="warn" title="One more database update">Accounts receivable turns on after the V5 financial SQL is installed. Nothing is lost in the meantime.</Notice></div>;
  // Dates compare as YYYY-MM-DD strings; normalize in case a driver returns full timestamps.
  const d10 = (v: unknown) => String(v ?? "").slice(0, 10);
  const all = ((arData ?? []) as ArRow[]).map((r) => ({ ...r, issue_date: d10(r.issue_date), due_date: d10(r.due_date), days_overdue: Number(r.days_overdue) }));
  const pays = ((payData ?? []) as PayRow[]).map((p) => ({ ...p, received_on: d10(p.received_on) }));
  // Cards follow every filter except the bucket; the table follows all of them.
  const scope = filterAr(all, { ...f, bucket: "all" }, today, soon);
  const scopedPays = pays.filter((p) => (!f.customer || p.customer_id === f.customer) && (!f.job || p.job_id === f.job));
  const t = arTotals(scope, today, soon);
  const rows = filterAr(all, f, today, soon);

  const { data: members } = book?.company_id ? await db.from("company_members").select("user_id, display_name").eq("company_id", book.company_id) : { data: [] };
  const people = new Map(((members ?? []) as { user_id: string; display_name: string | null }[]).map((m) => [m.user_id, m.display_name || "Team member"]));
  const customers = [...new Map(all.filter((r) => r.customer_id).map((r) => [r.customer_id!, r.customer_name ?? "Customer"])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const jobs = [...new Map(all.map((r) => [r.job_id, `${r.job_number} · ${r.job_name}`])).entries()];
  const reps = [...new Set(all.map((r) => r.sales_rep_id).filter(Boolean))] as string[];
  const pms = [...new Set(all.map((r) => r.project_manager_id).filter(Boolean))] as string[];

  const link = (patch: Partial<SP>) => {
    const u = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, String(v));
    return `/financials/receivables?${u.toString()}`;
  };
  const card = (title: string, value: string, bucket: string, sub?: string, tone?: "default" | "danger" | "warn" | "ok") => (
    <MetricCard size="sm" title={title} value={$(value)} sub={sub} tone={tone} empty={Number(value) === 0} href={link({ bucket })} pressed={f.bucket === bucket} action="View invoices" testId={`ar-card-${bucket}`} />
  );
  const canPay = access.permissions.includes("record_payments") && access.active && !access.readOnly;

  return (
    <div className="mx-auto max-w-7xl space-y-5" data-testid="fin-receivables" data-guide-page="financials.receivables">
      {crumbs}
      {access.sandbox && <SandboxBar sandbox canManage={access.permissions.includes("manage_financial_config")} />}
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Accounting</p>
          <h1 className="text-3xl font-extrabold">Accounts receivable</h1>
          <p className="text-sm text-ink-soft">What customers owe you on issued invoices. Milestones you haven&apos;t invoiced yet are not counted.</p>
        </div>
      </header>

      <section aria-label="Receivables summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {card("Total outstanding", t.outstanding, "open", `${t.openCount} open invoice${t.openCount === 1 ? "" : "s"}`)}
        {card("Past due", t.overdue, "overdue", "Any open invoice past its due date", Number(t.overdue) > 0 ? "danger" : "ok")}
        {card("Due in the next 14 days", t.dueSoon, "due_soon", `${t.dueSoonCount} upcoming`)}
        <MetricCard size="sm" title={period === "year" ? "Collected this year" : period === "last_month" ? "Collected last month" : "Collected this month"}
          value={$(collectedIn(scopedPays, pFrom, pTo))} sub={`${fmt(pFrom)} – ${fmt(pTo)} · net of refunds`} href={`/financials/records?view=payments`} action="View payments" testId="ar-card-collected" />
      </section>
      <section aria-label="Aging" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {BUCKETS.map((b: Bucket) => card(BUCKET_LABELS[b], t.buckets[b], b, `${t.counts[b]} invoice${t.counts[b] === 1 ? "" : "s"}`, b === "current" ? "default" : Number(t.buckets[b]) > 0 ? (b === "1_30" ? "warn" : "danger") : "ok"))}
        <MetricCard size="sm" title="Unapplied payments" value={$(unappliedTotal(scopedPays))} empty={Number(unappliedTotal(scopedPays)) === 0} sub="Received, not applied to an invoice" href="/financials/records?view=payments&filter=unapplied" action="Apply payments" testId="ar-card-unapplied" />
      </section>

      <form method="get" action="/financials/receivables" className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-3 lg:grid-cols-7" aria-label="Filter invoices" data-testid="ar-filters">
        <input type="hidden" name="bucket" value={f.bucket} />
        <input type="hidden" name="period" value={period} />
        <label className="col-span-2 text-xs font-semibold text-muted sm:col-span-1">Search<input name="q" defaultValue={f.q} className="field mt-1" placeholder="Invoice, customer, job" /></label>
        <label className="text-xs font-semibold text-muted">Customer<select name="customer" defaultValue={f.customer ?? ""} className="field mt-1"><option value="">All</option>{customers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
        <label className="text-xs font-semibold text-muted">Project<select name="job" defaultValue={f.job ?? ""} className="field mt-1"><option value="">All</option>{jobs.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
        <label className="text-xs font-semibold text-muted">Sales rep<select name="rep" defaultValue={f.rep ?? ""} className="field mt-1"><option value="">All</option>{reps.map((id) => <option key={id} value={id}>{people.get(id) ?? "Team member"}</option>)}</select></label>
        <label className="text-xs font-semibold text-muted">Project manager<select name="pm" defaultValue={f.pm ?? ""} className="field mt-1"><option value="">All</option>{pms.map((id) => <option key={id} value={id}>{people.get(id) ?? "Team member"}</option>)}</select></label>
        <label className="text-xs font-semibold text-muted">Due from<input type="date" name="from" defaultValue={f.from} className="field mt-1" /></label>
        <label className="text-xs font-semibold text-muted">Due to<input type="date" name="to" defaultValue={f.to} className="field mt-1" /></label>
        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-3 lg:col-span-7">
          <button type="submit" className="inline-flex min-h-10 items-center rounded-lg bg-brand px-4 text-sm font-bold text-white">Apply filters</button>
          <Link href="/financials/receivables" className="text-sm font-semibold text-accent-ink underline">Clear</Link>
          <span className="ml-auto flex gap-1 text-sm">
            {(["month", "last_month", "year"] as const).map((p) => <Link key={p} href={link({ period: p })} aria-current={period === p ? "true" : undefined} className={`rounded-lg px-2 py-1 ${period === p ? "bg-black/10 font-semibold" : "text-muted"}`}>{p === "month" ? "This month" : p === "last_month" ? "Last month" : "This year"}</Link>)}
          </span>
        </div>
      </form>

      <section aria-labelledby="ar-table-h" className="rounded-xl border border-line bg-surface">
        <h2 id="ar-table-h" className="flex flex-wrap items-center gap-2 px-4 pt-3 font-display text-lg font-extrabold">
          {f.bucket === "open" ? "Open invoices" : f.bucket === "overdue" ? "Past due invoices" : f.bucket === "paid" ? "Paid invoices" : f.bucket === "due_soon" ? "Due in the next 14 days" : f.bucket === "all" ? "All issued invoices" : BUCKET_LABELS[f.bucket as Bucket]}
          <span className="text-sm font-semibold text-muted">· {rows.length} · {$(add(0, ...rows.map((r) => r.balance)))} outstanding</span>
          <Link href={link({ bucket: "all" })} className="ml-auto text-sm font-semibold text-accent-ink underline">Show paid too</Link>
        </h2>
        {rows.length === 0 ? <p className="p-6 text-center text-sm text-ink-soft">{all.length === 0 ? "No issued invoices yet. Create one from a project's Financials tab." : "No invoices match these filters."}</p> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[60rem] text-sm" data-testid="ar-table">
              <thead><tr className="border-b border-line text-left text-xs text-muted">
                {["Customer", "Project", "Invoice", "Invoice date", "Due date", "Original", "Paid", "Outstanding", "Aging", "Status", "Next action"].map((h, i) => <th key={h} className={`px-3 py-2 font-semibold ${i >= 5 && i <= 7 ? "text-right" : ""}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const open = Number(r.balance) > 0;
                  return (
                    <tr key={r.invoice_id} className="border-b border-line last:border-0 hover:bg-black/5">
                      <td className="px-3 py-2">{r.customer_id ? <Link className="font-semibold text-accent-ink underline" href={`/financials/customers/${r.customer_id}`}>{r.customer_name ?? "Customer"}</Link> : r.customer_name ?? "—"}</td>
                      <td className="px-3 py-2"><Link className="underline" href={`/financials/jobs/${r.estimate_id}`}>{r.job_name}</Link><span className="block text-xs text-muted">{r.job_number}</span></td>
                      <td className="whitespace-nowrap px-3 py-2"><a className="font-semibold underline" href={`/api/financials/invoices/${r.invoice_id}/pdf`} target="_blank" rel="noopener">{r.number}</a></td>
                      <td className="whitespace-nowrap px-3 py-2 tabular">{fmt(r.issue_date)}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular">{fmt(r.due_date)}</td>
                      <td className="px-3 py-2 text-right tabular">{$(r.total)}</td>
                      <td className="px-3 py-2 text-right tabular">{$(add(r.paid, r.credited))}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular">{$(r.balance)}</td>
                      <td className="px-3 py-2">{!open ? "—" : r.days_overdue > 0 ? `${r.days_overdue} days late` : "Not due"}</td>
                      <td className="px-3 py-2"><Badge tone={!open ? "ok" : r.days_overdue > 30 ? "danger" : r.days_overdue > 0 ? "warn" : "neutral"}>{!open ? "Paid" : Number(r.paid) > 0 ? "Partly paid" : r.days_overdue > 0 ? "Overdue" : "Open"}</Badge></td>
                      <td className="px-3 py-2">{open && canPay ? <Link className="text-accent-ink underline" href={`/financials/jobs/${r.estimate_id}?do=payment`}>{nextAction(r)}</Link> : nextAction(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-muted">Payment reminders are drafts only until you turn on sending. Collections are recorded payments; &quot;verified&quot; means checked against your bank.</p>
    </div>
  );
}
