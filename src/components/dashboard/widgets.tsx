/**
 * Dashboard widget bodies (server components). Each widget reads its data through the shared, memoized
 * loaders in src/lib/dashboard/server.ts (row-level security applies to every read) and links to the records
 * behind every number. A widget renders only after the page checked the viewer may see it.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { formatCurrency } from "@/lib/estimate/money";
import { MetricCard } from "@/components/ui/metric-card";
import { BasisBadge } from "@/components/financials/basis";
import { ButtonLink } from "@/components/ui/button";
import { FOCUS, COLUMN_LABELS, SALES_COLUMNS, resolveRange, type Column, type RangeKey } from "@/lib/pipeline/board";
import { arDates, arTotals, filterAr, type ArFilters } from "@/lib/financials/receivables";
import { add, cmp } from "@/lib/financials/money";
import { PERIOD_LABELS, totalsOf, type Category } from "@/lib/financials/reports";
import type { Figure } from "@/lib/financials/loaders";
import { KPI_LABELS } from "@/lib/financials/ui-labels";
import { allowed } from "@/lib/dashboard/access";
import { DATASET_INFO, chartRange, invoiceChart, plChart, type ChartPeriod, type ChartSettings, type Dataset } from "@/lib/dashboard/charts";
import { QUICK_ACTIONS, instanceTitle, type QuickActionKey } from "@/lib/dashboard/registry";
import type { WidgetInstance } from "@/lib/dashboard/schema";
import type { DashboardData, DashboardViewer } from "@/lib/dashboard/server";
import { ChartView } from "./charts";
import { IndustryBriefingWidget } from "@/components/news/industry-briefing-widget";

const fmtDay = (d: string) => { const [y, m, dd] = d.slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };
const show = (f: Figure) => (f.money ? formatCurrency(f.value) : f.value);
const today = () => new Date().toISOString().slice(0, 10);
const clock = () => Date.now();
const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/** Card frame for list / chart widgets. The header link is the "open the records" action. */
export function Frame({ title, href, action, children, badge, testId, foot }: { title: string; href?: string; action?: string; children: ReactNode; badge?: ReactNode; testId?: string; foot?: ReactNode }) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl border border-line bg-surface p-4 shadow-card" aria-label={title} data-testid={testId}>
      <div className="mb-2 flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate font-display text-base font-extrabold">{title}</h3>
        {badge}
        {href && <Link href={href} prefetch={false} className="shrink-0 text-xs font-semibold text-accent-ink underline">{action ?? "View all"}</Link>}
      </div>
      {children}
      {foot && <div className="mt-2 text-xs text-muted">{foot}</div>}
    </section>
  );
}

const Sandbox = ({ on }: { on: boolean }) => on ? <span className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn" title="Practice (sandbox) books: not your real numbers"><FlaskConical className="h-3 w-3" aria-hidden />Practice data</span> : null;

function Rows({ rows, empty }: { rows: { key: string; href: string; label: ReactNode; detail?: ReactNode; value?: ReactNode; tone?: "danger" | "warn" }[]; empty: string }) {
  if (!rows.length) return <p className="flex flex-1 items-center justify-center py-4 text-center text-sm text-ink-soft">{empty}</p>;
  return (
    <ul className="-mx-1.5 min-h-0 flex-1 divide-y divide-line overflow-auto">
      {rows.map((r) => (
        <li key={r.key}>
          <Link href={r.href} prefetch={false} className="flex min-h-11 items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-black/5 focus-visible:outline-2">
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{r.label}</span>{r.detail && <span className="block truncate text-xs text-muted">{r.detail}</span>}</span>
            {r.value != null && <span className={`shrink-0 text-sm tabular font-semibold ${r.tone === "danger" ? "text-danger" : r.tone === "warn" ? "text-warn" : ""}`}>{r.value}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const Unavailable = ({ title, why }: { title: string; why: string }) => (
  <Frame title={title}><p className="flex flex-1 items-center justify-center py-4 text-center text-sm text-ink-soft">{why}</p></Frame>
);

const inRange = (iso: string, key: string) => {
  if (key === "all") return true;
  const r = resolveRange(key as RangeKey);
  const t = new Date(iso).getTime();
  return (!r.from || t >= r.from.getTime()) && (!r.to || t < r.to.getTime());
};
const bidsLink = (focus: string, range?: string) => `/dashboard?focus=${focus}${range && range !== "all" ? `&range=${range}&date=created` : ""}`;

/** One widget's body. `inst` is already known to be allowed for the viewer. */
export async function WidgetBody({ inst, data, viewer }: { inst: WidgetInstance; data: DashboardData; viewer: DashboardViewer }): Promise<ReactNode> {
  const s = inst.settings;
  const sandbox = Boolean(viewer.access.fin?.sandbox);
  const tid = `widget-${inst.type}`;
  const tall = inst.h === 2;
  const limit = Number(s.limit ?? 5);

  // ---- Financial cards built on the Financials home figures --------------------------------------------------
  const homeFigure = async (pick: (h: NonNullable<Awaited<ReturnType<DashboardData["finHome"]>>>) => Figure | undefined, title: string) => {
    const home = await data.finHome();
    const f = home ? pick(home) : undefined;
    if (!f) return <Unavailable title={title} why="Financials isn't set up for this account yet." />;
    return <MetricCard className="h-full" title={title} value={show(f)} sub={f.sub ?? f.note} href={f.href} tone={f.tone} empty={f.empty} status={sandbox ? <Sandbox on /> : <BasisBadge basis={f.basis} />} hint={f.note} testId={tid} />;
  };

  switch (inst.type) {
    case "fin_revenue": return homeFigure((h) => h.kpis.invoiced, "Revenue (invoiced)");
    case "fin_cash_received": return homeFigure((h) => h.kpis.collected, KPI_LABELS.collected);
    case "fin_upcoming_payments": return homeFigure((h) => h.cards.bills_due, "Upcoming payments");
    case "fin_profitability": return homeFigure((h) => h.kpis.projected_margin, "Company profitability");
    case "fin_uncategorized": return homeFigure((h) => h.cards.uncoded_costs, "Uncategorized expenses");
    case "fin_unpaid_bills": return homeFigure((h) => h.cards.bills_to_approve, "Bills to approve");
    case "fin_labor_costs": return homeFigure((h) => h.cards.labor_costs, "Labor costs");
    case "fin_sub_commitments": return homeFigure((h) => h.cards.open_commitments, "Subcontractor commitments");
    case "fin_sub_costs": return homeFigure((h) => h.cards.subcontractor_costs, "Subcontractor costs");
    case "tax_updates": return homeFigure((h) => h.cards.tax_updates, "Tax & regulatory updates");
    case "cash_position": return homeFigure((h) => h.cards.cash_position, "Cash position");

    case "fin_bank_balance":
    case "fin_projected_balance": {
      const a = await data.finAcct();
      const title = inst.type === "fin_bank_balance" ? "Bank balance" : "Projected bank balance";
      if (!a) return <Unavailable title={title} why="Financials isn't set up for this account yet." />;
      const b = a.m.bankBalance;
      if (!b) return <MetricCard className="h-full" title={title} value="Not connected" empty sub="Connect your bank (read-only) or import a statement to see a balance. It's never estimated." href="/financials/banks" action="Connect your bank" status={<Sandbox on={sandbox} />} testId={tid} />;
      if (inst.type === "fin_bank_balance") return <MetricCard className="h-full" title={title} value={formatCurrency(b.amount)} sub={`As of ${fmtDay(b.asOf)} · ${b.source}`} href={b.connected ? "/financials/banks" : "/financials/accounting/bank"} action="Open bank" status={<Sandbox on={sandbox} />} hint={b.connected ? "Balance reported by your connected bank" : "Ending balance from imported statements, not a live bank feed"} testId={tid} />;
      const p = a.m.projected!;
      return <MetricCard className="h-full" title={title} value={formatCurrency(p.amount)} sub={`Bank ${formatCurrency(b.amount)} + due in ${formatCurrency(p.arIn)} − bills ${formatCurrency(p.apOut)} (next 30 days)`} href="/financials/accounting/bank" action="How it's worked out" status={<Sandbox on={sandbox} />} hint="A projection from recorded invoices and approved bills, not a guarantee" testId={tid} />;
    }
    case "fin_ap": {
      const a = await data.finAcct();
      if (!a) return <Unavailable title="Accounts payable" why="Financials isn't set up for this account yet." />;
      return <MetricCard className="h-full" title="Accounts payable" value={formatCurrency(a.m.ap.amount)} empty={a.m.ap.count === 0} sub={`${a.m.ap.count} unpaid bill${a.m.ap.count === 1 ? "" : "s"} · ${formatCurrency(a.m.ap.overdue)} past due`} tone={cmp(a.m.ap.overdue, 0) > 0 ? "danger" : "default"} href="/financials/accounting/reports?r=ap_aging" action="AP aging" status={<Sandbox on={sandbox} />} testId={tid} />;
    }
    case "fin_reconciliation": {
      const a = await data.finAcct();
      if (!a) return <Unavailable title="Bank reconciliation" why="Financials isn't set up for this account yet." />;
      const last = a.lastRecon;
      return <MetricCard className="h-full" title="Bank reconciliation" value={a.m.bankReady ? `${a.m.unreconciled} to match` : "Not started"} empty={a.m.unreconciled === 0} tone={a.m.unreconciled ? "warn" : "ok"}
        sub={last ? `Last reconciled through ${fmtDay(last.period_end)}${last.status === "confirmed_with_differences" ? " (with differences)" : ""}` : "No reconciliation confirmed yet"} href="/financials/accounting/bank" action="Reconcile" status={<Sandbox on={sandbox} />} testId={tid} />;
    }
    case "fin_unmatched": {
      const a = await data.finAcct();
      if (!a) return <Unavailable title="Unmatched transactions" why="Financials isn't set up for this account yet." />;
      return <MetricCard className="h-full" title="Unmatched transactions" value={a.unmatched} empty={a.unmatched === 0} tone={a.unmatched ? "warn" : "ok"} sub="Bank statement lines not yet matched or excluded" href="/financials/accounting?kind=unmatched_bank" action="Match or exclude" status={<Sandbox on={sandbox} />} testId={tid} />;
    }
    case "fin_alerts": {
      const home = await data.finHome();
      if (!home) return <Unavailable title="Financial alerts" why="Financials isn't set up for this account yet." />;
      const alerts = (home.alerts as { id: string; kind: string; severity?: string; details?: { message?: string } | null; created_at: string }[])
        .sort((x, y) => (x.severity === "action_required" ? 0 : 1) - (y.severity === "action_required" ? 0 : 1) || y.created_at.localeCompare(x.created_at));
      return (
        <Frame title="Financial alerts" href={`/financials/records?view=alerts`} badge={<Sandbox on={sandbox} />} testId={tid}>
          <Rows empty="No open alerts." rows={alerts.slice(0, limit).map((x) => ({ key: x.id, href: `/financials/records?view=alerts&filter=${x.kind}`, label: x.details?.message ?? x.kind.replace(/_/g, " "),
            detail: fmtDay(x.created_at), value: x.severity === "action_required" ? "Action" : undefined, tone: x.severity === "action_required" ? "danger" as const : undefined }))} />
        </Frame>
      );
    }
    case "fin_ar": {
      const rows = await data.ar();
      if (!rows) return <Unavailable title="Outstanding receivables" why="Receivables turn on after the Financials setup." />;
      const { today: t, soon } = arDates("month");
      const bucket = String(s.bucket) as NonNullable<ArFilters["bucket"]>;
      const list = filterAr(rows, { bucket }, t, soon);
      const tot = arTotals(rows, t, soon);
      const sum = add(0, ...list.map((r) => r.balance));
      const href = `/financials/receivables?bucket=${bucket}`;
      const label = bucket === "open" ? "Outstanding receivables" : bucket === "overdue" ? "Overdue receivables" : bucket === "due_soon" ? "Due in 14 days" : "Receivables";
      if (s.view !== "table") {
        return <MetricCard className="h-full" title={label} value={formatCurrency(sum)} empty={!list.length} tone={bucket === "overdue" && list.length ? "danger" : "default"}
          sub={`${list.length} invoice${list.length === 1 ? "" : "s"} · ${formatCurrency(tot.overdue)} overdue overall`} href={href} action="View invoices" status={<Sandbox on={sandbox} />} testId={tid} />;
      }
      return (
        <Frame title={label} href={href} action="View invoices" badge={<Sandbox on={sandbox} />} testId={tid} foot={`${list.length} invoice${list.length === 1 ? "" : "s"} · ${formatCurrency(sum)}`}>
          <Rows empty="No invoices in this view." rows={list.sort((a, b) => b.days_overdue - a.days_overdue).slice(0, limit).map((r) => ({ key: r.invoice_id, href: `/financials/jobs/${r.estimate_id}#billing`,
            label: `${r.number} · ${r.customer_name ?? "Customer"}`, detail: r.days_overdue > 0 ? `${r.days_overdue} days overdue` : `Due ${fmtDay(r.due_date)}`, value: formatCurrency(r.balance), tone: r.days_overdue > 0 ? "danger" as const : undefined }))} />
        </Frame>
      );
    }
    case "fin_project_profitability":
    case "fin_over_budget": {
      const jobs = await data.finJobs();
      const title = inst.type === "fin_over_budget" ? "Jobs over budget" : "Project profitability";
      if (!jobs) return <Unavailable title={title} why="Financials isn't set up for this account yet." />;
      const open = jobs.filter((j) => j.status !== "closed" && j.status !== "void");
      const list = inst.type === "fin_over_budget"
        ? open.filter((j) => cmp(String(j.estimated_cost ?? 0), 0) > 0 && cmp(String(j.committed_plus_actual ?? 0), String(j.estimated_cost ?? 0)) > 0)
          .sort((a, b) => cmp(String(Number(b.committed_plus_actual) - Number(b.estimated_cost)), String(Number(a.committed_plus_actual) - Number(a.estimated_cost))))
        : [...open].sort((a, b) => (s.sort === "high" ? -1 : 1) * cmp(String(a.projected_profit ?? 0), String(b.projected_profit ?? 0)));
      return (
        <Frame title={title} href="/financials/records?view=jobs" action="All jobs" badge={<Sandbox on={sandbox} />} testId={tid}>
          <Rows empty={inst.type === "fin_over_budget" ? "No job is over its budgeted cost." : "No open jobs yet."} rows={list.slice(0, limit).map((j) => {
            const over = Number(j.committed_plus_actual) - Number(j.estimated_cost);
            return inst.type === "fin_over_budget"
              ? { key: String(j.job_id), href: j.href, label: `${j.job_number} · ${j.name}`, detail: `Budget ${formatCurrency(String(j.estimated_cost))} · actual + committed ${formatCurrency(String(j.committed_plus_actual))}`, value: `+${formatCurrency(over.toFixed(2))}`, tone: "danger" as const }
              : { key: String(j.job_id), href: j.href, label: `${j.job_number} · ${j.name}`, detail: `Contract ${formatCurrency(String(j.contract_value))}`, value: formatCurrency(String(j.projected_profit)), tone: cmp(String(j.projected_profit), 0) < 0 ? "danger" as const : undefined };
          })} />
        </Frame>
      );
    }
    case "chart": {
      const cs = s as unknown as ChartSettings & { dataset: Dataset; period: ChartPeriod };
      const title = instanceTitle("chart", s);
      const info = DATASET_INFO[cs.dataset];
      const settings: ChartSettings = { ...cs, job: (cs.job as unknown as string) || null, trade: (cs.trade as unknown as string) || null, categories: (cs.categories as Category[] | null) ?? null };
      let chart;
      if (info.source === "ar") {
        const rows = await data.ar();
        if (!rows) return <Unavailable title={title} why="Receivables turn on after the Financials setup." />;
        const { from, to } = chartRange(cs.period);
        chart = invoiceChart(rows.filter((r) => r.issue_date >= from && r.issue_date <= to && r.status !== "void"));
      } else {
        const pl = await data.pl(cs.period, cs.basis);
        if (!pl || !pl.ok) return <Unavailable title={title} why={pl && !pl.ok && pl.reason === "not_installed" ? "Charts turn on after the Reports update is installed." : "Nothing to chart yet."} />;
        chart = plChart(pl.data.rows, settings, pl.range);
      }
      const reportLink = info.source === "ar" ? "/financials/receivables" : `/financials/reports?period=${cs.period}&basis=${cs.basis}`;
      const filters = [settings.job && "one project", settings.trade && "one trade"].filter(Boolean).join(", ");
      const foot = [
        chart.shape === "category" && chart.selectedOnly ? `Totals and percentages include only the selected categories (${chart.selectedOnly.shown} of ${chart.selectedOnly.of}).` : null,
        chart.shape === "category" && chart.note ? chart.note : null,
        filters ? `Filtered to ${filters}.` : null,
        info.source === "pl" ? (cs.basis === "cash" ? "Cash basis." : "Billed basis.") : null,
      ].filter(Boolean).join(" ");
      return (
        <Frame title={`${title} · ${PERIOD_LABELS[cs.period]}`} href={reportLink} action={info.source === "ar" ? "Receivables" : "Report"} badge={<Sandbox on={sandbox} />} testId={tid} foot={foot || undefined}>
          <ChartView data={chart} type={cs.chart} title={title} tall={tall} empty="Nothing recorded for this period yet." />
        </Frame>
      );
    }
    case "fin_pl_summary": {
      const pl = await data.pl(s.period as ChartPeriod, s.basis === "billed" ? "billed" : "cash");
      if (!pl || !pl.ok) return <Unavailable title="Profit and loss summary" why="The P&L turns on after the Reports update is installed." />;
      const t = totalsOf(pl.data.rows);
      const base = `/financials/reports?period=${s.period}&basis=${s.basis}`;
      const line = (label: string, v: string, href: string, strong = false) => (
        <tr className={`border-t border-line ${strong ? "font-semibold" : ""}`}><td className="py-1.5"><Link href={href} prefetch={false} className="hover:underline">{label}</Link></td><td className={`py-1.5 text-right tabular ${cmp(v, 0) < 0 ? "text-danger" : ""}`}>{formatCurrency(v)}</td></tr>
      );
      return (
        <Frame title={`Profit and loss · ${PERIOD_LABELS[s.period as ChartPeriod]}`} href={base} action="Full report" badge={<Sandbox on={sandbox} />} testId={tid} foot={s.basis === "billed" ? "Billed basis." : "Cash basis."}>
          <table className="w-full text-sm"><tbody>
            {line("Revenue", t.revenue, `${base}&dir=income&show=records#records`)}
            {line("Job costs", t.jobCosts, `${base}&dir=cost&oh=0&show=records#records`)}
            {line(`Gross profit${t.grossMarginPct ? ` (${t.grossMarginPct}%)` : ""}`, t.grossProfit, base, true)}
            {line("Overhead", t.overhead, `${base}&dir=cost&oh=1&show=records#records`)}
            {line(`Net profit${t.netMarginPct ? ` (${t.netMarginPct}%)` : ""}`, t.netProfit, base, true)}
          </tbody></table>
        </Frame>
      );
    }

    // ---- Projects -------------------------------------------------------------------------------------------
    case "pm_active":
    case "pm_scheduled": {
      const scheds = await data.schedules();
      const title = inst.type === "pm_active" ? "Active projects" : "Scheduled projects";
      if (!scheds) return <Unavailable title={title} why="Projects turn on after the scheduling setup." />;
      const t = today();
      const list = inst.type === "pm_active" ? scheds.filter((x) => x.status === "active" && x.start_date <= t) : scheds.filter((x) => x.status === "active" && x.start_date > t);
      const next = [...list].sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
      return <MetricCard className="h-full" title={title} value={list.length} empty={!list.length} href="/projects" action="Open projects"
        sub={inst.type === "pm_active" ? `${scheds.filter((x) => x.status === "draft").length} draft schedule${scheds.filter((x) => x.status === "draft").length === 1 ? "" : "s"}` : next ? `Next: ${next.name} on ${fmtDay(next.start_date)}` : "Nothing starting later"} testId={tid} />;
    }
    case "pm_review": {
      const q = await data.review();
      if (!q) return <Unavailable title="Projects requiring review" why="The review queue turns on after the project operations setup." />;
      const open = q.filter((x) => x.status === "needs_review");
      return (
        <Frame title="Projects requiring review" href="/projects" action="Review queue" testId={tid} foot={`${open.length} waiting`}>
          <Rows empty="Nothing is waiting for review." rows={open.slice(0, limit).map((x) => ({ key: x.estimateId, href: `/estimates/${x.estimateId}`, label: x.title, detail: `${x.customerName ?? "Customer"} · approved ${fmtDay(x.approvedAt)}` }))} />
        </Frame>
      );
    }
    case "pm_overdue_tasks":
    case "pm_upcoming": {
      const tasks = await data.tasks();
      const title = inst.type === "pm_overdue_tasks" ? "Overdue tasks" : "Upcoming work";
      if (!tasks) return <Unavailable title={title} why="Projects turn on after the scheduling setup." />;
      const t = today(), until = plusDays(Number(s.days ?? 14));
      const list = inst.type === "pm_overdue_tasks"
        ? tasks.filter((x) => x.end < t).sort((a, b) => a.end.localeCompare(b.end))
        : tasks.filter((x) => x.start >= t && x.start <= until).sort((a, b) => a.start.localeCompare(b.start));
      return (
        <Frame title={title} href="/projects" action="Open projects" testId={tid} foot={`${list.length} task${list.length === 1 ? "" : "s"}`}>
          <Rows empty={inst.type === "pm_overdue_tasks" ? "No overdue tasks." : "Nothing starting in this window."} rows={list.slice(0, limit).map((x) => ({
            key: x.id, href: `/projects/${x.scheduleId}`, label: x.name, detail: `${x.project}${x.assignee ? ` · ${x.assignee}` : ""}`,
            value: inst.type === "pm_overdue_tasks" ? `Due ${fmtDay(x.end)}` : fmtDay(x.start), tone: inst.type === "pm_overdue_tasks" ? "danger" as const : undefined }))} />
        </Frame>
      );
    }
    case "pm_calendar": {
      const tasks = await data.tasks();
      if (!tasks) return <Unavailable title="Schedule preview" why="Projects turn on after the scheduling setup." />;
      const days = Array.from({ length: 14 }, (_, i) => plusDays(i));
      return (
        <Frame title="Schedule preview · next 14 days" href="/projects" action="Open schedule" testId={tid}>
          <ol className="grid min-h-0 flex-1 grid-cols-2 gap-1 overflow-auto sm:grid-cols-7">
            {days.map((d) => {
              const on = tasks.filter((x) => x.start <= d && x.end >= d);
              const wd = new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
              return (
                <li key={d} className="min-w-0 rounded-lg border border-line p-1.5">
                  <p className="text-[11px] font-semibold text-muted">{wd} {fmtDay(d)}</p>
                  {on.length === 0 ? <p className="text-xs text-muted">—</p> : (
                    <ul className="space-y-0.5">
                      {on.slice(0, 3).map((x) => <li key={x.id}><Link href={`/projects/${x.scheduleId}`} prefetch={false} title={`${x.project}: ${x.name}`} className="block truncate rounded bg-accent/10 px-1 text-[11px] font-semibold hover:underline">{x.name}</Link></li>)}
                      {on.length > 3 && <li className="text-[11px] text-muted">+{on.length - 3} more</li>}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </Frame>
      );
    }

    // ---- Sales ---------------------------------------------------------------------------------------------
    case "sales_pipeline": {
      const bids = ((await data.bids()) ?? []).filter((b) => inRange(b.createdAt, String(s.range)));
      const counts = SALES_COLUMNS.map((c) => ({ c, n: bids.filter((b) => b.column === c).length, v: bids.filter((b) => b.column === c).reduce((t, b) => t + (b.total ?? 0), 0) }));
      const max = Math.max(1, ...counts.map((x) => x.n));
      const href = (c: Column) => `/dashboard?view=pipeline${s.range !== "all" ? `&range=${s.range}&date=created` : ""}#col-${c}`;
      return (
        <Frame title="Sales pipeline" href={`/dashboard?view=pipeline`} action="Open pipeline" testId={tid}>
          {s.view === "table" ? (
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Stage</th><th className="py-1 text-right">Bids</th><th className="py-1 text-right">Value</th></tr></thead>
              <tbody>{counts.map((x) => <tr key={x.c} className="border-t border-line"><td className="py-1.5"><Link href={href(x.c)} prefetch={false} className="font-semibold text-accent-ink underline">{COLUMN_LABELS[x.c]}</Link></td><td className="py-1.5 text-right tabular">{x.n}</td><td className="py-1.5 text-right tabular">{formatCurrency(x.v.toFixed(2))}</td></tr>)}</tbody></table>
          ) : (
            <ul className="dash-chart flex-1 space-y-1.5 text-sm">
              {counts.map((x) => (
                <li key={x.c}><Link href={href(x.c)} prefetch={false} title={`${COLUMN_LABELS[x.c]}: ${x.n} bids, ${formatCurrency(x.v.toFixed(2))}`} className="block rounded-md px-1.5 py-1 hover:bg-black/5 focus-visible:outline-2">
                  <span className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate">{COLUMN_LABELS[x.c]}</span><span className="tabular font-semibold">{x.n}</span><span className="w-20 text-right text-xs tabular text-muted">{formatCurrency(x.v.toFixed(2))}</span></span>
                  <span className="mt-0.5 block h-2.5 w-full rounded bg-black/5"><span className="block h-full rounded bg-[#2a78d6]" style={{ width: `${x.n ? Math.max(2, (x.n / max) * 100) : 0}%` }} /></span>
                </Link></li>
              ))}
            </ul>
          )}
        </Frame>
      );
    }
    case "sales_drafts":
    case "sales_awaiting":
    case "sales_won": {
      const focus = inst.type === "sales_drafts" ? "draft" : inst.type === "sales_awaiting" ? "awaiting" : "won";
      const range = inst.type === "sales_won" ? String(s.range) : "all";
      const bids = ((await data.bids()) ?? []).filter((b) => (FOCUS[focus].columns as readonly Column[]).includes(b.column) && inRange(b.createdAt, range));
      const value = bids.reduce((t, b) => t + (b.total ?? 0), 0);
      return <MetricCard className="h-full" title={inst.type === "sales_drafts" ? "Draft bids" : inst.type === "sales_awaiting" ? "Awaiting signature" : "Approved proposals"} value={bids.length} empty={!bids.length}
        sub={!bids.length ? FOCUS[focus].empty : value ? `${formatCurrency(value.toFixed(2))} in latest proposals` : "No proposal totals yet"} href={bidsLink(focus, range)} action="View bids" testId={tid} />;
    }
    case "sales_win_rate": {
      const bids = ((await data.bids()) ?? []).filter((b) => inRange(b.createdAt, String(s.range)));
      const won = bids.filter((b) => (FOCUS.won.columns as readonly Column[]).includes(b.column)).length, lost = bids.filter((b) => b.column === "lost").length;
      const rate = won + lost ? Math.round((won / (won + lost)) * 100) : null;
      return <MetricCard className="h-full" title="Win rate" value={rate === null ? "None yet" : `${rate}%`} empty={rate === null} sub={`${won} won · ${lost} lost`} href={bidsLink("decided", String(s.range))} action="View decided bids" hint="Won out of bids that were won or lost" testId={tid} />;
    }
    case "sales_avg_value": {
      const bids = ((await data.bids()) ?? []).filter((b) => b.total !== null && inRange(b.createdAt, String(s.range)) && (s.which !== "won" || (FOCUS.won.columns as readonly Column[]).includes(b.column)));
      const avg = bids.length ? bids.reduce((t, b) => t + (b.total ?? 0), 0) / bids.length : 0;
      return <MetricCard className="h-full" title="Average bid value" value={bids.length ? formatCurrency(avg.toFixed(2)) : "None yet"} empty={!bids.length} sub={`Across ${bids.length} ${s.which === "won" ? "won " : ""}bid${bids.length === 1 ? "" : "s"} with a proposal`}
        href={bidsLink(s.which === "won" ? "won" : "open", String(s.range))} action="View bids" testId={tid} />;
    }
    case "sales_recent": {
      const bids = (await data.bids()) ?? [];
      return (
        <Frame title="Recently created estimates" href="/dashboard?view=table" action="All bids" testId={tid}>
          <Rows empty="No bids yet. Create your first one." rows={bids.slice(0, limit).map((b) => ({ key: b.id, href: `/estimates/${b.id}`, label: b.title, detail: `${b.customer || "No customer"} · ${COLUMN_LABELS[b.column]} · ${fmtDay(b.createdAt)}`, value: b.total !== null ? formatCurrency(b.total.toFixed(2)) : undefined }))} />
        </Frame>
      );
    }
    case "company_pipeline": {
      const sum = await data.companySummary();
      if (!sum) return <Unavailable title="Company pipeline" why="Company totals show up as your team adds bids." />;
      return (
        <div className="grid h-full grid-cols-2 gap-3" data-testid={tid}>
          <MetricCard className="h-full" title="Company win rate" value={sum.winRate === null ? "None yet" : `${Math.round(sum.winRate)}%`} empty={sum.winRate === null} href="/company" action="Company overview" />
          <MetricCard className="h-full" title="Company open value" value={formatCurrency(Number(sum.openValue).toFixed(2))} href="/company/pipeline" action="Team pipeline" />
        </div>
      );
    }
    case "industry_briefing":
      return <IndustryBriefingWidget settings={{ limit: String(s.limit ?? "5"), geo: typeof s.geo === "string" ? s.geo : undefined }} />;

    case "customers": {
      const n = await data.customers();
      return <MetricCard className="h-full" title="Customers" value={n ?? 0} empty={!n} href="/dashboard/customers" action="Open customers" testId={tid} />;
    }

    // ---- Team ------------------------------------------------------------------------------------------------
    case "team_hours":
    case "team_overtime":
    case "team_on_clock": {
      const entries = await data.time();
      const title = inst.type === "team_hours" ? "Labor hours" : inst.type === "team_overtime" ? "Overtime alerts" : "On the clock now";
      if (!entries) return <Unavailable title={title} why="The time clock turns on after the team records setup." />;
      const now = clock();
      const hours = (e: { clockIn: string; clockOut: string | null; breakMinutes: number }) => Math.max(0, ((e.clockOut ? new Date(e.clockOut).getTime() : now) - new Date(e.clockIn).getTime()) / 36e5 - e.breakMinutes / 60);
      const d = new Date(now); const dow = (d.getUTCDay() + 6) % 7;
      const weekStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).getTime();
      const window = s.range === "last_week" ? [weekStart - 7 * 864e5, weekStart] : s.range === "month" ? [Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), Infinity] : [weekStart, Infinity];
      const href = "/projects/team/time";
      if (inst.type === "team_on_clock") {
        const open = entries.filter((e) => e.status === "open");
        const names = await data.scheduleNames();
        return (
          <Frame title={title} href={href} action="Time clock" testId={tid} foot={`${open.length} clocked in`}>
            <Rows empty="Nobody is clocked in." rows={open.slice(0, 8).map((e) => ({ key: e.resourceId, href, label: e.name, detail: `${e.scheduleId ? names?.get(e.scheduleId) ?? "Project" : "No project"} · since ${new Date(e.clockIn).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` }))} />
          </Frame>
        );
      }
      const scoped = entries.filter((e) => { const t = new Date(e.clockIn).getTime(); return inst.type === "team_overtime" ? t >= weekStart : t >= window[0] && t < window[1]; });
      const per = new Map<string, { name: string; h: number }>();
      for (const e of scoped) { const p = per.get(e.resourceId) ?? { name: e.name, h: 0 }; p.h += hours(e); per.set(e.resourceId, p); }
      if (inst.type === "team_hours") {
        const total = [...per.values()].reduce((t, p) => t + p.h, 0);
        const label = s.range === "last_week" ? "last week" : s.range === "month" ? "this month" : "this week";
        return <MetricCard className="h-full" title="Labor hours" value={`${total.toFixed(1)} h`} empty={total === 0} sub={`${per.size} ${per.size === 1 ? "person" : "people"} ${label} (pending and approved)`} href={href} action="Timesheets" testId={tid} />;
      }
      const over = [...per.entries()].filter(([, p]) => p.h > 40).sort((a, b) => b[1].h - a[1].h);
      return (
        <Frame title={title} href={href} action="Timesheets" testId={tid} foot="Over 40 hours since Monday, from the time clock.">
          <Rows empty="Nobody is over 40 hours this week." rows={over.slice(0, 6).map(([id, p]) => ({ key: id, href, label: p.name, value: `${p.h.toFixed(1)} h`, tone: "warn" as const }))} />
        </Frame>
      );
    }

    // ---- Quick actions -------------------------------------------------------------------------------------
    case "quick_actions": {
      const keys = ((s.actions as string[]) ?? []).filter((k): k is QuickActionKey => Object.hasOwn(QUICK_ACTIONS, k));
      const usable = keys.filter((k) => {
        const a = QUICK_ACTIONS[k];
        return allowed(viewer.access, a.requires) && (!("write" in a && a.write) || viewer.access.fin?.canWrite);
      });
      return (
        <Frame title="Quick actions" testId={tid}>
          {usable.length ? <div className="flex flex-wrap gap-2">{usable.map((k) => <ButtonLink key={k} href={QUICK_ACTIONS[k].href} variant={k === "create_bid" ? "accent" : "secondary"} size="sm">{QUICK_ACTIONS[k].label}</ButtonLink>)}</div>
            : <p className="text-sm text-ink-soft">Pick your actions in Customize Dashboard.</p>}
        </Frame>
      );
    }
  }
  return <Unavailable title="Retired card" why="This card was retired. You can remove it with Edit dashboard." />;
}

