import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { loadEntries, loadPl, ENTRY_LIMIT } from "@/lib/financials/reports-load";
import {
  BASIS_HINTS, BASIS_LABELS, CATEGORIES, CATEGORY_LABELS, NO_JOB, NO_TRADE, PERIODS, PERIOD_LABELS,
  bucketRange, bucketsBetween, byJob, byTrade, filterRows, grainFor, periodRange, series, statement, totalsOf,
  type Category, type GroupRow, type Period, type ReportBasis, type StatementLine,
} from "@/lib/financials/reports";
import { add } from "@/lib/financials/money";
import { formatCurrency } from "@/lib/estimate/money";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { MetricCard } from "@/components/ui/metric-card";
import { Notice } from "@/components/ui/misc";
import { FinStateNotice } from "@/components/financials/fin-state-notice";
import { MoneyChart } from "@/components/financials/money-chart";
import { DonutCard } from "@/components/financials/donut";
import { costSlices, revenueSlices } from "@/lib/financials/donuts";

export const metadata: Metadata = { title: "Reports · Profit & Loss", robots: { index: false } };

type SP = { basis?: string; period?: string; from?: string; to?: string; view?: string; dir?: string; job?: string; trade?: string; cat?: string; oh?: string; df?: string; dt?: string; show?: string };
const UUID = /^[0-9a-f-]{36}$/i, DAY = /^\d{4}-\d{2}-\d{2}$/, SLUG = /^[a-z0-9-]{1,60}$/;
const $ = (v: string) => formatCurrency(v || "0");
const fmt = (d: string) => { if (!d) return "—"; const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };
const VIEWS = ["statement", "jobs", "trades"] as const;
type View = (typeof VIEWS)[number];
const SOURCE_LABELS: Record<string, string> = {
  payment: "Payment received", refund: "Refund", invoice: "Invoice", credit_memo: "Credit memo", bill: "Vendor bill", bill_payment: "Bill paid", expense: "Expense", time_entry: "Timesheet labor",
};
const sourceHref = (source: string, id: string) =>
  source === "invoice" ? `/api/financials/invoices/${id}/pdf` : source === "payment" ? `/api/financials/payments/${id}/receipt` : source === "bill_payment" ? `/api/financials/bill-payments/${id}/receipt` : null;
const neg = (v: string) => v.startsWith("-");

/**
 * Accounting → Reports: the company Profit & Loss rolled up across every project, by period, by project
 * and by trade (V6 P2-A). Cash or billed basis, from recorded records only (fin_report_pl). Every card,
 * bar and table cell opens the records behind it. Not a CPA accrual statement.
 */
export default async function Reports({ searchParams }: { searchParams: Promise<SP> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const state = await loadFinState(db);
  const crumbs = <Breadcrumbs className="mb-3" items={[{ label: "Financials", href: "/financials" }, { label: "Reports" }]} />;
  const wrap = (n: React.ReactNode) => <div className="mx-auto max-w-4xl space-y-4">{crumbs}{n}</div>;
  if (state.kind !== "ready") return wrap(<FinStateNotice state={state} />);
  const { bookId, access } = state.ctx;
  if (!access.permissions.includes("view_company_financials")) {
    return wrap(<Notice title="Company reports need a company financial role">Your role shows the projects you work on. Ask the owner for a bookkeeper, accountant or view-only financial seat to see the whole company&apos;s profit and loss. <Link href="/financials" className="font-semibold underline">Back to Financials</Link></Notice>);
  }

  const basis: ReportBasis = sp.basis === "billed" ? "billed" : "cash";
  const range = periodRange((PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as Period) : "ytd", new Date(), { from: sp.from, to: sp.to });
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "statement";
  const res = await loadPl(db, bookId, basis, range.from, range.to);
  if (!res.ok) {
    return wrap(res.reason === "not_installed"
      ? <Notice tone="warn" title="One more database update">Reports turn on after the Reports SQL is installed. Nothing is lost in the meantime.</Notice>
      : <Notice tone="warn" title="Couldn't load the report">Please refresh in a moment.</Notice>);
  }
  const { rows, jobs, trades } = res.data;
  const g = grainFor(range.from, range.to);
  const buckets = bucketsBetween(range.from, range.to, g);
  const t = totalsOf(rows);

  const base: SP = { basis, period: range.period, ...(range.period === "custom" ? { from: range.from, to: range.to } : {}), view };
  const link = (patch: Partial<SP>, keepDrill = false) => {
    const u = new URLSearchParams();
    const drill = keepDrill ? { dir: sp.dir, job: sp.job, trade: sp.trade, cat: sp.cat, oh: sp.oh, df: sp.df, dt: sp.dt, show: sp.show } : {};
    for (const [k, v] of Object.entries({ ...base, ...drill, ...patch })) if (v) u.set(k, String(v));
    return `/financials/reports?${u.toString()}`;
  };
  const records = (d: Partial<SP>) => `${link({ ...d, show: "records" })}#records`;

  // Drill-down (the records behind a number).
  const drill = sp.show === "records" ? {
    dir: sp.dir === "income" || sp.dir === "cost" ? (sp.dir as "income" | "cost") : undefined,
    job: sp.job && (UUID.test(sp.job) || sp.job === NO_JOB) ? sp.job : undefined,
    trade: sp.trade && SLUG.test(sp.trade) ? sp.trade : undefined,
    category: (CATEGORIES as readonly string[]).includes(sp.cat ?? "") ? (sp.cat as Category) : undefined,
    overhead: sp.oh === "1" ? true : sp.oh === "0" ? false : undefined,
    from: sp.df && DAY.test(sp.df) && sp.df >= range.from ? sp.df : range.from,
    to: sp.dt && DAY.test(sp.dt) && sp.dt <= range.to ? sp.dt : range.to,
  } : null;
  const jobsInTrade = drill?.trade ? jobs.filter((j) => (drill.trade === NO_TRADE ? j.trades.length === 0 : j.trades.includes(drill.trade!))).map((j) => j.id) : undefined;
  const entries = drill ? await loadEntries(db, bookId, basis, { ...drill, jobsInTrade }) : null;
  const drillTotal = drill ? add(0, ...filterRows(rows.filter((r) => r.m >= drill.from.slice(0, 7) && r.m <= drill.to.slice(0, 7)), drill).map((r) => r.amount)) : "0.00";
  const jobName = new Map(jobs.map((j) => [j.id, j]));
  const tradeName = new Map(trades.map((x) => [x.slug, x.name]));
  const drillTitle = drill ? [
    drill.dir === "income" ? "Money in" : drill.overhead === true ? "Overhead" : drill.overhead === false ? "Job costs" : drill.dir === "cost" ? "Money out" : "All records",
    drill.category ? CATEGORY_LABELS[drill.category] : null,
    drill.job ? (drill.job === NO_JOB ? "No project" : jobName.get(drill.job)?.name ?? "Project") : null,
    drill.trade ? (drill.trade === NO_TRADE ? "General" : tradeName.get(drill.trade) ?? drill.trade) : null,
    `${fmt(drill.from)} – ${fmt(drill.to)}`,
  ].filter(Boolean).join(" · ") : "";

  const canExport = access.permissions.includes("export_financials");
  const exportHref = `/api/financials/reports/pl?basis=${basis}&from=${range.from}&to=${range.to}&view=${view}`;
  const points = series(rows, buckets, g).map((p) => {
    const r = bucketRange(p.bucket, g, range.from, range.to);
    return { ...p, href: records({ df: r.from, dt: r.to }) };
  });
  const tone = (v: string) => (neg(v) ? "danger" : "default") as "danger" | "default";
  const noData = rows.length === 0;

  return (
    <div className="mx-auto max-w-7xl space-y-5" data-testid="fin-reports" data-guide-page="financials.reports">
      {crumbs}
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-[min(100%,20rem)] flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Accounting</p>
          <h1 className="text-3xl font-extrabold">Profit &amp; Loss</h1>
          <p className="text-sm text-ink-soft">Every project rolled up: {fmt(range.from)} – {fmt(range.to)} · {BASIS_LABELS[basis]}</p>
        </div>
        {canExport && <a href={exportHref} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-semibold" data-testid="pl-export"><Download className="h-4 w-4" aria-hidden />Download CSV</a>}
      </header>

      <form method="get" action="/financials/reports" className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3" aria-label="Report settings" data-testid="pl-filters">
        <input type="hidden" name="view" value={view} />
        <label className="text-xs font-semibold text-muted">Period
          <select name="period" defaultValue={range.period} className="field mt-1">{PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}</select>
        </label>
        <label className="text-xs font-semibold text-muted">From<input type="date" name="from" defaultValue={range.from} className="field mt-1" /></label>
        <label className="text-xs font-semibold text-muted">To<input type="date" name="to" defaultValue={range.to} className="field mt-1" /></label>
        <fieldset className="text-xs font-semibold text-muted">
          <legend>Basis</legend>
          <div className="mt-1 flex rounded-lg border border-line">
            {(["cash", "billed"] as const).map((b) => (
              <label key={b} className={`flex min-h-10 cursor-pointer items-center px-3 text-sm ${basis === b ? "bg-black/10 font-bold text-ink" : "text-muted"}`} title={BASIS_HINTS[b]}>
                <input type="radio" name="basis" value={b} defaultChecked={basis === b} className="sr-only" />{BASIS_LABELS[b]}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="inline-flex min-h-10 items-center rounded-lg bg-brand px-4 text-sm font-bold text-white">Update</button>
        <p className="basis-full text-xs text-muted">Pick a period, or set From and To and choose &quot;Custom dates&quot;. {BASIS_HINTS[basis]}</p>
      </form>

      <section aria-label="Profit and loss summary" className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Revenue" value={$(t.revenue)} sub={basis === "cash" ? "Payments received, net of refunds" : "Invoices issued, net of credits"} empty={Number(t.revenue) === 0} href={records({ dir: "income" })} action="View money in" testId="pl-card-revenue" />
        <MetricCard title="Job costs" value={$(t.jobCosts)} sub="Bills and expenses on projects" empty={Number(t.jobCosts) === 0} href={records({ dir: "cost", oh: "0" })} action="View job costs" testId="pl-card-job-costs" />
        <MetricCard title="Gross profit" value={$(t.grossProfit)} sub={t.grossMarginPct ? `${t.grossMarginPct}% gross margin` : "Revenue minus job costs"} tone={tone(t.grossProfit)} href={link({ view: "jobs" })} pressed={view === "jobs"} action="Profit by project" testId="pl-card-gross" />
        <MetricCard title="Net profit" value={$(t.netProfit)} sub={t.netMarginPct ? `${t.netMarginPct}% net margin, after overhead` : "Gross profit minus overhead"} tone={tone(t.netProfit)} href={link({ view: "statement" })} pressed={view === "statement"} action="See the statement" testId="pl-card-net" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard size="sm" title="Overhead" value={$(t.overhead)} sub="Costs not tied to a project" empty={Number(t.overhead) === 0} href={records({ dir: "cost", oh: "1" })} action="View overhead" testId="pl-card-overhead" />
        <MetricCard size="sm" title="Labor" value={$(t.labor)} sub="Costs coded to labor" empty={Number(t.labor) === 0} href={records({ dir: "cost", cat: "labor" })} action="View labor costs" testId="pl-card-labor" />
        <MetricCard size="sm" title="Gross margin" value={t.grossMarginPct ? `${t.grossMarginPct}%` : "—"} sub="By trade" empty={!t.grossMarginPct} href={link({ view: "trades" })} pressed={view === "trades"} action="Margin by trade" testId="pl-card-margin" />
        <MetricCard size="sm" title="Projects with activity" value={String(new Set(rows.filter((r) => r.job).map((r) => r.job)).size)} sub={`${jobs.length} project${jobs.length === 1 ? "" : "s"} in Financials`} href={link({ view: "jobs" })} action="Profit by project" testId="pl-card-projects" />
        </div>
      </section>

      {!noData && (() => {
        const costs = costSlices(rows, (c) => records({ dir: "cost", cat: c }), records({ dir: "cost" }));
        const rev = revenueSlices(t, { jobCosts: records({ dir: "cost", oh: "0" }), overhead: records({ dir: "cost", oh: "1" }), profit: link({ view: "jobs" }) });
        return (
          <section aria-label="Overview" className="grid gap-3 md:grid-cols-2" data-testid="pl-donuts">
            <DonutCard testId="pl-donut-costs" title="Where the money goes" slices={costs.slices} total={costs.total} centerSub="total costs"
              empty="No costs recorded in this period." footer="Job costs and overhead by type. Select a slice to see its records." />
            <DonutCard testId="pl-donut-revenue" title="Where each revenue dollar went" slices={rev?.slices ?? []} total={rev?.total ?? "0"} center={t.netMarginPct ? `${t.netMarginPct}%` : undefined} centerSub="net margin"
              empty="No revenue in this period yet."
              footer={rev?.loss ? <span className="font-semibold text-danger">Costs were {$(rev.loss)} more than revenue: a net loss for this period.</span> : "Revenue split into job costs, overhead and the profit you kept."} />
          </section>
        );
      })()}

      {noData ? (
        <Notice title="Nothing recorded in this period">
          {basis === "cash" ? "Record payments, paid bills and expenses on a project's Financials tab and they show up here." : "Issue invoices and approve bills and expenses on a project's Financials tab and they show up here."}{" "}
          <Link href={link({ period: "last_12" })} className="font-semibold underline">Try the last 12 months</Link>
        </Notice>
      ) : (
        <section aria-labelledby="pl-chart-h" className="rounded-xl border border-line bg-surface p-4">
          <h2 id="pl-chart-h" className="mb-2 font-display text-lg font-extrabold">Money in vs money out</h2>
          <MoneyChart points={points} />
        </section>
      )}

      <nav aria-label="Report views" className="flex flex-wrap gap-1 border-b border-line">
        {([["statement", "P&L by period"], ["jobs", "By project"], ["trades", "By trade"]] as const).map(([v, label]) => (
          <Link key={v} href={link({ view: v }, true)} aria-current={view === v ? "page" : undefined} data-testid={`pl-view-${v}`}
            className={`-mb-px min-h-11 border-b-2 px-3 pt-2.5 text-sm font-semibold ${view === v ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"}`}>{label}</Link>
        ))}
      </nav>

      {view === "statement" && <Statement lines={statement(rows, buckets, g)} buckets={buckets} labels={points.map((p) => p.label)} cellHref={(line, b) => {
        const r = b ? bucketRange(b, g, range.from, range.to) : { from: range.from, to: range.to };
        const d: Partial<SP> = { df: r.from, dt: r.to };
        if (line.key === "revenue") return records({ ...d, dir: "income" });
        if (line.key === "job_total") return records({ ...d, dir: "cost", oh: "0" });
        if (line.key === "oh_total") return records({ ...d, dir: "cost", oh: "1" });
        if (line.key.startsWith("job:")) return records({ ...d, dir: "cost", oh: "0", cat: line.key.slice(4) });
        if (line.key.startsWith("oh:")) return records({ ...d, dir: "cost", oh: "1", cat: line.key.slice(3) });
        return records(d);
      }} />}
      {view === "jobs" && <GroupTable testId="pl-by-job" first="Project" groups={byJob(rows, jobs)} totals={t}
        note="Overhead and payments with no project are on the last row, so the total matches net profit."
        href={(gr, dir) => records({ job: gr.key, dir })} />}
      {view === "trades" && <GroupTable testId="pl-by-trade" first="Trade" groups={byTrade(rows, trades)} totals={t} tradeView
        note="Revenue is split across each project's trades by its estimated cost per trade (exact for single-trade projects). Overhead isn't assigned to a trade."
        href={(gr, dir) => records({ trade: gr.key, dir, ...(dir === "cost" ? { oh: "0" } : {}) })} />}

      {drill && (
        <section id="records" aria-labelledby="pl-records-h" className="scroll-mt-20 rounded-xl border border-line bg-surface" data-testid="pl-records">
          <h2 id="pl-records-h" className="flex flex-wrap items-center gap-2 px-4 pt-3 font-display text-lg font-extrabold">
            Records: {drillTitle}
            <span className="text-sm font-semibold text-muted">· {$(drillTotal)}</span>
            <Link href={link({})} className="ml-auto text-sm font-semibold text-accent-ink underline">Close</Link>
          </h2>
          {!entries ? <p className="p-6 text-sm text-ink-soft">Couldn&apos;t load the records. Please refresh.</p>
            : entries.rows.length === 0 ? <p className="p-6 text-center text-sm text-ink-soft">No records match.</p> : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[48rem] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-muted">
                    {["Date", "Record", "Number", "Project", "Customer / vendor", "Description", "Amount"].map((h) => <th key={h} className={`px-3 py-2 font-semibold ${h === "Amount" ? "text-right" : ""}`}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {entries.rows.map((e, i) => {
                      const j = e.job_id ? jobName.get(e.job_id) : null;
                      const href = sourceHref(e.source, e.source_id);
                      const amt = e.amount;
                      return (
                        <tr key={`${e.source}-${e.source_id}-${i}`} className="border-b border-line last:border-0">
                          <td className="whitespace-nowrap px-3 py-2 tabular">{fmt(e.entry_date)}</td>
                          <td className="px-3 py-2">{SOURCE_LABELS[e.source] ?? e.source}</td>
                          <td className="whitespace-nowrap px-3 py-2">{href ? <a className="font-semibold underline" href={href} target="_blank" rel="noopener">{e.ref}</a> : e.ref}</td>
                          <td className="px-3 py-2">{j ? <Link className="underline" href={`/financials/jobs/${j.estimateId}`}>{j.name}</Link> : <span className="text-muted">{e.direction === "cost" ? "Overhead" : "No project"}</span>}</td>
                          <td className="px-3 py-2">{e.party ?? "—"}</td>
                          <td className="px-3 py-2 text-ink-soft">{e.description}</td>
                          <td className={`px-3 py-2 text-right font-semibold tabular ${neg(amt) ? "text-danger" : ""}`}>{$(amt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {entries.capped && <p className="px-4 py-2 text-xs text-muted">Showing the newest {ENTRY_LIMIT}. Narrow the dates or download the CSV for everything.</p>}
                {drill.trade && drill.dir === "income" && <p className="px-4 py-2 text-xs text-muted">Money in isn&apos;t recorded by trade: these are the payments or invoices for projects that include this trade. The total above is this trade&apos;s share.</p>}
              </div>
            )}
        </section>
      )}

      <p className="text-xs text-muted">
        Built from your recorded invoices, payments, bills and expenses. Voided records never count. This is a management report, not a CPA-reviewed accrual statement or a tax return.
        {" "}<Link href="/financials/receivables" className="underline">Accounts receivable</Link>
      </p>
    </div>
  );
}

function Statement({ lines, buckets, labels, cellHref }: { lines: StatementLine[]; buckets: string[]; labels: string[]; cellHref: (l: StatementLine, b: string | null) => string }) {
  return (
    <section aria-label="Profit and loss by period" className="rounded-xl border border-line bg-surface" data-testid="pl-statement">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: `${10 + (buckets.length + 1) * 7}rem` }}>
          <thead><tr className="border-b border-line text-xs text-muted">
            <th scope="col" className="sticky left-0 z-10 w-36 bg-surface px-3 py-2 text-left font-semibold sm:w-56">&nbsp;</th>
            {labels.map((l) => <th key={l} scope="col" className="px-3 py-2 text-right font-semibold">{l}</th>)}
            <th scope="col" className="px-3 py-2 text-right font-semibold">Total</th>
          </tr></thead>
          <tbody>
            {lines.map((l) => {
              const strong = l.kind === "total" || l.kind === "subtotal" || l.kind === "income";
              const cell = (v: string, b: string | null) => {
                const zero = Number(v) === 0;
                const cls = `${neg(v) ? "text-danger" : ""} ${zero ? "text-muted" : ""}`;
                return l.kind === "total" || zero ? <span className={cls}>{zero ? "—" : $(v)}</span>
                  : <Link className={`underline decoration-line-strong underline-offset-2 hover:decoration-current ${cls}`} href={cellHref(l, b)} prefetch={false}>{$(v)}</Link>;
              };
              return (
                <tr key={l.key} className={`border-b border-line last:border-0 ${l.kind === "total" ? "border-t-2 border-t-line-strong" : ""}`} data-testid={`pl-line-${l.key}`}>
                  <th scope="row" className={`sticky left-0 z-10 bg-surface px-3 py-2 text-left ${l.indent ? "pl-7 font-normal text-ink-soft" : strong ? "font-bold" : "font-semibold"}`}>{l.label}</th>
                  {buckets.map((b) => <td key={b} className={`whitespace-nowrap px-3 py-2 text-right tabular ${strong ? "font-semibold" : ""}`}>{cell(l.cells[b] ?? "0.00", b)}</td>)}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular">{cell(l.total, null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GroupTable({ groups, first, totals, note, href, testId, tradeView }: {
  groups: GroupRow[]; first: string; totals: ReturnType<typeof totalsOf>; note: string; testId: string; tradeView?: boolean;
  href: (g: GroupRow, dir: "income" | "cost") => string;
}) {
  const cats = CATEGORIES.filter((c) => groups.some((g) => g.byCategory[c]));
  const revenue = add(0, ...groups.map((g) => g.revenue)), costs = add(0, ...groups.map((g) => g.costs));
  return (
    <section aria-label={`Profit by ${first.toLowerCase()}`} className="rounded-xl border border-line bg-surface" data-testid={testId}>
      {groups.length === 0 ? <p className="p-6 text-center text-sm text-ink-soft">Nothing recorded in this period.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: `${30 + cats.length * 7}rem` }}>
            <thead><tr className="border-b border-line text-xs text-muted">
              <th scope="col" className="px-3 py-2 text-left font-semibold">{first}</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Revenue</th>
              {cats.map((c) => <th key={c} scope="col" className="px-3 py-2 text-right font-semibold">{CATEGORY_LABELS[c]}</th>)}
              <th scope="col" className="px-3 py-2 text-right font-semibold">Total costs</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Profit</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Margin</th>
            </tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="border-b border-line last:border-0 hover:bg-black/5">
                  <th scope="row" className="px-3 py-2 text-left font-semibold">
                    {g.href ? <Link href={g.href} className="text-accent-ink underline">{g.label}</Link> : g.label}
                    {g.sub && <span className="block text-xs font-normal text-muted">{g.sub}</span>}
                  </th>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular">{Number(g.revenue) ? <Link className="underline decoration-line-strong underline-offset-2" href={href(g, "income")} prefetch={false}>{$(g.revenue)}</Link> : <span className="text-muted">—</span>}</td>
                  {cats.map((c) => <td key={c} className="whitespace-nowrap px-3 py-2 text-right tabular text-ink-soft">{g.byCategory[c] ? $(g.byCategory[c]!) : "—"}</td>)}
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular">{Number(g.costs) ? <Link className="underline decoration-line-strong underline-offset-2" href={href(g, "cost")} prefetch={false}>{$(g.costs)}</Link> : <span className="text-muted">—</span>}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular ${neg(g.profit) ? "text-danger" : ""}`}>{$(g.profit)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular ${g.marginPct && neg(g.marginPct) ? "text-danger" : ""}`}>{g.marginPct ? `${g.marginPct}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-line-strong font-bold">
              <th scope="row" className="px-3 py-2 text-left">{tradeView ? "Total (before overhead)" : "Total"}</th>
              <td className="px-3 py-2 text-right tabular">{$(revenue)}</td>
              {cats.map((c) => <td key={c} className="px-3 py-2 text-right tabular">{$(add(0, ...groups.map((g) => g.byCategory[c] ?? "0")))}</td>)}
              <td className="px-3 py-2 text-right tabular">{$(costs)}</td>
              <td className="px-3 py-2 text-right tabular">{$(tradeView ? totals.grossProfit : totals.netProfit)}</td>
              <td className="px-3 py-2 text-right tabular">{(tradeView ? totals.grossMarginPct : totals.netMarginPct) ? `${tradeView ? totals.grossMarginPct : totals.netMarginPct}%` : "—"}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
      <p className="px-4 pb-3 pt-2 text-xs text-muted">{note}</p>
    </section>
  );
}
