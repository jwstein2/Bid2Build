import { Columns, Donut, Gauge, Kpi, Mini, PageHead, Panel, fmt, usd } from "@/components/admin/cc";
import { loadCommandCenter } from "@/lib/admin/load";
import { overview, series } from "@/lib/admin/metrics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revenue" };

export default async function Revenue() {
  const { p, error } = await loadCommandCenter();
  if (!p) return <Panel title="Report unavailable"><p className="text-sm text-ink-soft">The platform data could not be loaded{error ? `: ${error}` : ""}.</p></Panel>;
  const now = new Date();
  const o = overview(p, now);
  const r = o.revenue;
  const subscribed = p.events.filter((e) => e.event === "subscribed").map((e) => e.created_at);
  const checkouts = p.events.filter((e) => e.event === "checkout_started").map((e) => e.created_at);
  const since30 = now.getTime() - 30 * 86_400_000;
  const sub30 = subscribed.filter((d) => Date.parse(d) >= since30).length;
  const chk30 = checkouts.filter((d) => Date.parse(d) >= since30).length;
  const mrrMix = [
    { label: "Monthly", value: r.monthly * 1999, tone: "green" as const },
    { label: "Annual (monthly share)", value: r.annual * Math.round(14900 / 12), tone: "blue" as const },
    { label: "Enterprise", value: Math.max(0, r.mrrCents - r.monthly * 1999 - r.annual * Math.round(14900 / 12)), tone: "violet" as const },
  ];

  return (
    <div className="space-y-6">
      <PageHead kicker="Revenue · estimates from live subscriptions" title="Subscriptions and revenue"
        intro="MRR is estimated from active subscriptions at list price ($19.99 monthly, $149 a year divided by 12, Enterprise from its seat count). Stripe is the source of truth for money actually collected." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="MRR estimate" value={usd(r.mrrCents)} sub={`${usd(r.arrCents)} annual run rate`} />
        <Kpi label="Paid accounts" value={r.paidAccounts} tone="blue" sub={`${r.monthly} monthly · ${r.annual} annual · ${r.enterprise} enterprise`} />
        <Kpi label="Complimentary access" value={r.compActive} tone="amber" sub={Object.entries(r.compByPlan).map(([k, v]) => `${v} ${k}`).join(" · ") || "None active"} />
        <Kpi label="Free accounts" value={o.freeAccounts} tone="muted" sub={`${o.conversion.paidPct}% paid or complimentary`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker="Mix" title="Accounts by plan">
          <Donut center={fmt(o.accounts)} sub="accounts" segments={[
            { label: "Free", value: o.freeAccounts, tone: "muted" },
            { label: "Monthly", value: r.monthly, tone: "green" },
            { label: "Annual", value: r.annual, tone: "blue" },
            { label: "Enterprise", value: r.enterprise, tone: "violet" },
            { label: "Complimentary", value: r.compActive, tone: "amber" },
          ]} />
        </Panel>
        <Panel kicker="Mix" title="Where MRR comes from">
          <Donut center={usd(r.mrrCents)} sub="per month" segments={mrrMix.map((m) => ({ ...m, value: Math.round(m.value / 100) }))} />
          <p className="mt-2 text-xs text-muted">Legend values in whole dollars per month.</p>
        </Panel>
        <Panel kicker="Conversion · 30 days" title="Checkout to subscriber">
          <div className="grid grid-cols-2 gap-3">
            <Gauge value={chk30 ? (sub30 / chk30) * 100 : 0} label="Checkout success" sub={`${sub30} of ${chk30} checkouts`} tone="green" />
            <Gauge value={o.conversion.paidPct} label="Paid share" sub="of all accounts" tone="blue" />
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker="Signups · 12 weeks" title="New paid subscriptions" className="lg:col-span-2">
          <Columns tone="green" points={series(subscribed, now, 12, "week")} />
          <p className="mt-3 text-xs text-muted">From the &ldquo;subscribed&rdquo; event recorded when Stripe confirms a checkout.</p>
        </Panel>
        <Panel kicker="Retention" title="Risk signals">
          <div className="grid grid-cols-2 gap-2.5">
            <Mini label="Canceling at period end" value={r.cancelingAtPeriodEnd} tone={r.cancelingAtPeriodEnd ? "amber" : "green"} />
            <Mini label="Past due" value={r.pastDue} tone={r.pastDue ? "red" : "green"} />
            <Mini label="Canceled · 30d" value={r.canceled30d} tone={r.canceled30d ? "amber" : "green"} />
            <Mini label="Checkouts · 30d" value={chk30} tone="blue" />
          </div>
        </Panel>
      </div>
    </div>
  );
}
