/**
 * V9 additions to the Cash flow page (server-rendered). Every number says what it is based on; clicking a period, a job
 * or an alert opens the records behind it. Scenarios, modes, filters and what-ifs live in the URL: nothing is saved.
 */
import Link from "next/link";
import { formatCurrency } from "@/lib/estimate/money";
import { Badge, Notice } from "@/components/ui/misc";
import { fmtDateServer } from "@/lib/financials/accounting-format";
import { ALERT_LABELS, type AlertKind } from "@/lib/cash-v9/alerts";
import type { Bucket, Granularity, V9Result } from "@/lib/cash-v9/engine";
import { EXPENSE_MODES, HORIZONS, SCENARIOS, type ExpenseMode, type Scenario } from "@/lib/cash-v9/settings";
import { WHATIF_LABELS, type WhatIf } from "@/lib/cash-v9/whatif";
import { AlertActions, WhatIfForm } from "./actions";

type Row = Record<string, unknown>;
const money = (n: number | string) => { const v = Number(n); return `${v < 0 ? "−" : ""}${formatCurrency(Math.abs(v).toFixed(2))}`; };
const CATS: Record<string, string> = { customer_payment: "Customer payments", milestone: "Milestones", payroll: "Payroll", subcontractor: "Subcontractors", supplier: "Materials & suppliers", recurring: "Recurring overhead", other: "Other" };

export interface V9View {
  scenario: Scenario; mode: ExpenseMode; granularity: Granularity; horizon: number; custom?: string; job?: string | null; cats: string[]; whatIf: WhatIf[]; wiRaw?: string;
}

export function v9Href(v: V9View, change: Partial<V9View>, hash = "") {
  const x = { ...v, ...change };
  const q = new URLSearchParams();
  q.set("h", x.custom ? "custom" : String(x.horizon));
  if (x.custom) q.set("end", x.custom);
  if (x.scenario !== "expected") q.set("sc", x.scenario);
  q.set("mode", x.mode);
  if (x.granularity !== "week") q.set("g", x.granularity);
  if (x.job) q.set("job", x.job);
  for (const c of x.cats) q.append("cat", c);
  if ("whatIf" in change ? false : x.wiRaw) q.set("wi", x.wiRaw!);
  return `/financials/cash?${q.toString()}${hash}`;
}

const Pill = ({ href, on, children, testId }: { href: string; on: boolean; children: React.ReactNode; testId?: string }) => (
  <Link href={href} aria-current={on ? "page" : undefined} data-testid={testId} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${on ? "border-brand bg-brand-tint" : "border-line"}`}>{children}</Link>
);

export function V9Controls({ v, jobs }: { v: V9View; jobs: { id: string; name: string }[] }) {
  return (
    <section aria-label="Forecast options" className="space-y-2 rounded-xl border border-line bg-surface p-3" data-testid="v9-controls">
      <div className="flex flex-wrap items-center gap-1"><span className="mr-1 text-xs font-semibold text-muted">Horizon</span>
        {HORIZONS.map((h) => <Pill key={h} href={v9Href(v, { horizon: h, custom: undefined })} on={!v.custom && v.horizon === h}>{h} days</Pill>)}</div>
      <div className="flex flex-wrap items-center gap-1"><span className="mr-1 text-xs font-semibold text-muted">Scenario</span>
        {SCENARIOS.map((s) => <Pill key={s.value} href={v9Href(v, { scenario: s.value })} on={v.scenario === s.value} testId={`v9-sc-${s.value}`}>{s.label}</Pill>)}</div>
      <div className="flex flex-wrap items-center gap-1"><span className="mr-1 text-xs font-semibold text-muted">Future costs</span>
        {EXPENSE_MODES.map((m) => <Pill key={m.value} href={v9Href(v, { mode: m.value })} on={v.mode === m.value} testId={`v9-mode-${m.value}`}>{m.label}</Pill>)}</div>
      <div className="flex flex-wrap items-center gap-1"><span className="mr-1 text-xs font-semibold text-muted">View by</span>
        {(["day", "week", "month"] as const).map((g) => <Pill key={g} href={v9Href(v, { granularity: g })} on={v.granularity === g}>{g === "day" ? "Day" : g === "week" ? "Week" : "Month"}</Pill>)}</div>
      <div className="flex flex-wrap items-center gap-1"><span className="mr-1 text-xs font-semibold text-muted">Show</span>
        <Pill href={v9Href(v, { job: null })} on={!v.job}>Whole company</Pill>
        {jobs.slice(0, 12).map((j) => <Pill key={j.id} href={v9Href(v, { job: j.id })} on={v.job === j.id}>{j.name}</Pill>)}</div>
      <div className="flex flex-wrap items-center gap-1"><span className="mr-1 text-xs font-semibold text-muted">Categories</span>
        <Pill href={v9Href(v, { cats: [] })} on={!v.cats.length}>All</Pill>
        {Object.entries(CATS).map(([k, l]) => { const on = v.cats.includes(k); return <Pill key={k} href={v9Href(v, { cats: on ? v.cats.filter((c) => c !== k) : [...v.cats, k] })} on={on}>{on ? "✓ " : ""}{l}</Pill>; })}</div>
      <p className="text-xs text-muted">{SCENARIOS.find((s) => s.value === v.scenario)?.detail} {EXPENSE_MODES.find((m) => m.value === v.mode)?.detail} <Link href="/financials/cash/settings" className="font-semibold text-accent-ink underline">Forecast settings</Link></p>
    </section>
  );
}

export function V9Summary({ r, minCash }: { r: V9Result; minCash: number | null }) {
  const f = r.forecast;
  const sum = (cat: string) => f.events.filter((e) => e.category === cat).reduce((a, e) => a + Number(e.amount), 0);
  const tiles = [
    { k: "Expected collections", v: money(sum("customer_payment") + sum("milestone")), sub: "Invoices + milestones, on the dates customers usually pay", basis: "Estimated" },
    { k: "Payroll", v: money(-sum("payroll")), sub: r.payroll.length ? `${r.payroll.length} pay dates from schedules` : "From your cash plan", basis: r.payroll.length ? "Estimated" : "Scheduled" },
    { k: "Subcontractors", v: money(-sum("subcontractor")), sub: "Bills + open commitments", basis: "Committed" },
    { k: "Materials & suppliers", v: money(-sum("supplier")), sub: "Bills + POs + uncommitted budget", basis: "Mixed" },
    { k: "Recurring overhead", v: money(-sum("recurring")), sub: "Your overhead plans", basis: "Scheduled" },
    { k: "Projected gross profit (open jobs)", v: money(r.profit.grossProfit), sub: r.profit.grossMargin !== null ? `${r.profit.grossMargin}% of ${money(r.profit.contract)} contract` : "No open jobs", basis: "Forecast" },
    { k: "Projected operating profit", v: money(r.profit.operatingProfit), sub: `${r.profit.finishingInWindow.jobs} jobs finishing in this window, less ${money(r.profit.overheadInWindow)} overhead. Before interest and income tax.`, basis: "Forecast" },
    { k: "Cash runway", v: r.runway.belowZeroOn ? `${r.runway.days} days` : f.startsFromBank ? "Beyond window" : "—", sub: r.runway.text, basis: "Forecast", danger: Boolean(r.runway.belowZeroOn) },
    { k: "Low-cash date", v: r.runway.belowMinOn ? fmtDateServer(r.runway.belowMinOn) : minCash === null ? "Set a minimum" : "None", sub: minCash !== null ? `Below your ${money(minCash)} minimum` : "Forecast settings → minimum cash", basis: "Forecast", danger: Boolean(r.runway.belowMinOn) },
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="v9-kpis">
      {tiles.map((t) => (
        <div key={t.k} className="rounded-xl border border-line bg-surface p-3">
          <dt className="flex items-center justify-between gap-2 text-xs font-semibold text-muted">{t.k}<Badge tone="neutral">{t.basis}</Badge></dt>
          <dd className={`font-display text-2xl font-extrabold tabular-nums ${t.danger ? "text-danger" : ""}`}>{t.v}</dd>
          <dd className="text-xs text-muted">{t.sub}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Period table: every period expands to the exact records behind it. */
export function V9Buckets({ buckets }: { buckets: Bucket[] }) {
  return (
    <section aria-labelledby="v9-periods-h" className="space-y-2" id="periods">
      <h2 id="v9-periods-h" className="font-display text-lg font-extrabold">By period</h2>
      <p className="text-xs text-muted">Open a period to see every invoice, milestone, bill, commitment and payroll date in it, and why it&apos;s dated that way.</p>
      <div className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="v9-buckets">
        {buckets.map((b) => (
          <details key={b.from} className="group">
            <summary className="grid cursor-pointer grid-cols-2 gap-2 p-3 text-sm sm:grid-cols-5">
              <span className="font-semibold">{b.label}</span>
              <span className="text-ok tabular-nums">+{money(b.inflow)}</span>
              <span className="text-danger tabular-nums">−{money(b.outflow)}</span>
              <span className={`font-semibold tabular-nums ${b.close < 0 ? "text-danger" : ""}`}>{money(b.close)} <span className="text-xs font-normal text-muted">expected</span></span>
              <span className="text-xs text-muted">Scheduled only {money(b.scheduledClose)}</span>
            </summary>
            {b.events.length ? (
              <ul className="space-y-1 px-3 pb-3 text-sm">{b.events.map((e) => (
                <li key={e.key} className="flex flex-wrap items-start gap-2 border-t border-line pt-1">
                  <span className="w-20 shrink-0 text-muted">{fmtDateServer(e.date)}</span>
                  <span className="min-w-0 flex-1">{e.href ? <Link href={e.href} className="text-accent-ink underline">{e.label}</Link> : e.label}{e.note && <span className="block text-xs text-muted">{e.note}</span>}</span>
                  <Badge tone={e.certainty === "scheduled" ? "brand" : "neutral"}>{e.certainty === "scheduled" ? "Scheduled" : "Estimated"}</Badge>
                  <span className={`tabular-nums font-semibold ${Number(e.amount) < 0 ? "text-danger" : "text-ok"}`}>{Number(e.amount) < 0 ? "" : "+"}{money(e.amount)}</span>
                </li>))}</ul>
            ) : <p className="px-3 pb-3 text-sm text-muted">Nothing in this period.</p>}
          </details>
        ))}
      </div>
    </section>
  );
}

export function V9Alerts({ alerts, canAct }: { alerts: Row[]; canAct: boolean }) {
  if (!alerts.length) return <p className="text-sm text-muted" data-testid="v9-alerts-empty">No early warnings right now.</p>;
  return (
    <ul className="space-y-2" data-testid="v9-alerts">
      {alerts.map((a) => {
        const sev = String(a.severity);
        const actions = (Array.isArray(a.actions) ? a.actions : []) as { label: string; href: string }[];
        return (
          <li key={String(a.id)} className={`rounded-xl border p-3 ${sev === "critical" ? "border-danger/50" : "border-line"} bg-surface`}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={sev === "critical" ? "danger" : sev === "warning" ? "warn" : "neutral"}>{ALERT_LABELS[a.kind as AlertKind] ?? String(a.kind)}</Badge>
              {a.status !== "open" && <Badge tone="neutral">{String(a.status) === "snoozed" ? `Snoozed until ${fmtDateServer(String(a.snoozed_until))}` : "Seen"}</Badge>}
              <span className="font-semibold">{String(a.title)}</span>
            </div>
            {a.body ? <p className="mt-1 text-sm text-ink-soft">{String(a.body)}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              {actions.map((x) => <Link key={x.href + x.label} href={x.href} className="font-semibold text-accent-ink underline">{x.label}</Link>)}
              <AlertActions id={String(a.id)} status={String(a.status)} canAct={canAct} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function V9Projects({ r }: { r: V9Result }) {
  if (!r.contribution.length) return null;
  return (
    <section aria-labelledby="v9-proj-h" className="space-y-2">
      <h2 id="v9-proj-h" className="font-display text-lg font-extrabold">Project cash in this window</h2>
      <p className="text-xs text-muted">Which jobs bring cash in and which need working capital first. &quot;Lowest&quot; is the job&apos;s running total at its low point.</p>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[36rem] text-sm" data-testid="v9-projects">
          <thead><tr className="text-left text-xs text-muted"><th className="p-2">Job</th><th className="p-2 text-right">In</th><th className="p-2 text-right">Out</th><th className="p-2 text-right">Net</th><th className="p-2 text-right">Lowest</th><th className="p-2 text-right">Forecast cost</th></tr></thead>
          <tbody>{r.contribution.map((c) => (
            <tr key={c.jobId} className="border-t border-line">
              <td className="p-2"><Link href={`/financials/cash?job=${c.jobId}`} className="text-accent-ink underline">{c.name}</Link></td>
              <td className="p-2 text-right tabular-nums text-ok">{money(c.cashIn)}</td>
              <td className="p-2 text-right tabular-nums text-danger">{money(c.cashOut)}</td>
              <td className={`p-2 text-right font-semibold tabular-nums ${c.net < 0 ? "text-danger" : ""}`}>{money(c.net)}</td>
              <td className="p-2 text-right tabular-nums">{c.lowest < 0 ? `${money(c.lowest)}${c.lowestOn ? ` · ${fmtDateServer(c.lowestOn)}` : ""}` : "—"}</td>
              <td className="p-2 text-right tabular-nums">{r.jobCosts[c.jobId] ? money(r.jobCosts[c.jobId].forecast) : "—"}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </section>
  );
}

export function V9Milestones({ r }: { r: V9Result }) {
  const rows = r.milestones.filter((m) => m.amount > 0);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="v9-ms-h" className="space-y-2">
      <h2 id="v9-ms-h" className="font-display text-lg font-extrabold">Payment milestones not invoiced yet</h2>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm" data-testid="v9-milestones">
        {rows.map((m) => (
          <li key={m.milestoneId} className="flex flex-wrap items-start gap-2 p-3">
            <span className="min-w-0 flex-1"><Link href={`/financials/jobs/${m.jobId}#fin-milestones`} className="font-semibold text-accent-ink underline">{m.jobName} · {m.description}</Link>
              <span className="block text-xs text-muted">{m.payOn ? m.text : m.basis}</span></span>
            {m.eligible && !m.triggered && <Badge tone="warn">Ready to confirm</Badge>}
            <Badge tone={m.confidence === "high" ? "ok" : m.confidence === "medium" ? "neutral" : "warn"}>{m.confidence === "high" ? "High" : m.confidence === "medium" ? "Medium" : "Low"} confidence</Badge>
            <span className="tabular-nums font-semibold">{money(m.amount)}{m.payOn ? ` · ${fmtDateServer(m.payOn)}` : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function V9WhatIf({ v, jobs }: { v: V9View; jobs: { id: string; name: string }[] }) {
  return (
    <section id="whatif" aria-labelledby="v9-wi-h" className="space-y-2">
      <h2 id="v9-wi-h" className="font-display text-lg font-extrabold">What if…</h2>
      {v.whatIf.length > 0 && <Notice tone="warn" title="Showing a what-if">{v.whatIf.map((w) => WHATIF_LABELS[w.kind]).join(", ")}. These numbers aren&apos;t your forecast until you clear it.</Notice>}
      <WhatIfForm current={v.whatIf} jobs={jobs} baseHref={v9Href(v, {})} />
    </section>
  );
}

export function V9Confidence({ r }: { r: V9Result }) {
  if (!r.confidence.length && !r.excludedPlanned.length) return null;
  return (
    <Notice title="How sure is this forecast?">
      <ul className="list-disc pl-5">{r.confidence.map((c) => <li key={c}>{c}</li>)}
        {r.excludedPlanned.length > 0 && <li>Payroll comes from schedules, so these cash-plan payroll entries are left out: {r.excludedPlanned.join(", ")}.</li>}</ul>
    </Notice>
  );
}

/** How close past forecasts were: first predicted vs actual payment date for invoices since paid in full. */
export function V9Accuracy({ a }: { a: { n: number; meanAbsDays: number | null; late: number; early: number; since: string } | null }) {
  return (
    <section aria-labelledby="v9-acc-h" className="space-y-1 rounded-xl border border-line bg-surface p-4" data-testid="v9-accuracy">
      <h2 id="v9-acc-h" className="font-display text-lg font-extrabold">Forecast accuracy</h2>
      {!a ? <p className="text-sm text-muted">Built2Bid saves one forecast a day. Once invoices it forecast get paid, you&apos;ll see how close the predicted dates were.</p>
        : a.n === 0 ? <p className="text-sm text-muted">No invoice forecast since {fmtDateServer(a.since)} has been paid in full yet.</p>
        : <p className="text-sm">On {a.n} paid invoice{a.n === 1 ? "" : "s"} since {fmtDateServer(a.since)}, payments arrived <strong>{a.meanAbsDays} days</strong> from the first predicted date on average ({a.late} later than predicted, {a.early} earlier, {a.n - a.late - a.early} on the day). If customers keep paying later than predicted, set their payment habit in <Link href="/financials/cash/settings" className="font-semibold text-accent-ink underline">Forecast settings</Link>.</p>}
    </section>
  );
}

/** Five-week payment calendar of the expected view: money in and out per day, each day linking to its payments. */
export function V9Calendar({ r, today }: { r: V9Result; today: string }) {
  const byDay = new Map<string, { inflow: number; outflow: number; n: number }>();
  for (const e of r.forecast.events) {
    const d = byDay.get(e.date) ?? { inflow: 0, outflow: 0, n: 0 };
    const v = Number(e.amount); if (v >= 0) d.inflow += v; else d.outflow -= v; d.n++;
    byDay.set(e.date, d);
  }
  const t = new Date(`${today}T12:00:00Z`);
  const start = new Date(t.getTime() - t.getUTCDay() * 864e5);
  const days = Array.from({ length: 35 }, (_, i) => new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10));
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : n.toFixed(0));
  return (
    <section aria-labelledby="v9-cal-h" className="space-y-2" id="calendar">
      <h2 id="v9-cal-h" className="font-display text-lg font-extrabold">Payment calendar</h2>
      <div className="grid grid-cols-7 gap-1 text-xs" data-testid="v9-calendar">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="px-1 font-semibold text-muted">{d}</div>)}
        {days.map((d) => {
          const x = byDay.get(d); const past = d < today;
          const body = (<>
            <span className={`block font-semibold ${d === today ? "text-brand" : ""}`}>{Number(d.slice(8))}</span>
            {x && x.inflow > 0 && <span className="block tabular-nums text-ok">+${k(x.inflow)}</span>}
            {x && x.outflow > 0 && <span className="block tabular-nums text-danger">−${k(x.outflow)}</span>}
          </>);
          const cls = `min-h-14 rounded-md border p-1 ${d === today ? "border-brand" : "border-line"} ${past ? "opacity-50" : "bg-surface"}`;
          return x ? <a key={d} href={`?focus=${d}#events`} className={`${cls} hover:border-brand`} aria-label={`${d}: ${x.n} payment${x.n === 1 ? "" : "s"}`}>{body}</a> : <div key={d} className={cls}>{body}</div>;
        })}
      </div>
      <p className="text-xs text-muted">Expected dates: invoices and milestones are estimates; bills, payroll and planned payments use their set dates.</p>
    </section>
  );
}
