import { AreaChart, BarList, Chip, Delta, Donut, Empty, Gauge, Kpi, Mini, PageHead, Panel, PanelLink, StackBar, ago, fmt, usd, type Tone } from "@/components/admin/cc";
import { UsTileMap } from "@/components/admin/us-tile-map";
import { loadCommandCenter } from "@/lib/admin/load";
import { leaderboard, overview, stateReport } from "@/lib/admin/metrics";
import { recentActivity, type ActivityKind } from "@/lib/admin/platform";
import { US_STATES } from "@/lib/market/geo";
import { tradeName } from "@/lib/trades/catalog";

export const dynamic = "force-dynamic";

const KIND: Record<ActivityKind, { tone: Tone; tag: string }> = {
  signup: { tone: "blue", tag: "SIGNUP" }, business: { tone: "violet", tag: "BUSINESS" }, finalized: { tone: "green", tag: "FINAL" },
  signed: { tone: "amber", tag: "SIGNED" }, paid: { tone: "green", tag: "PAID" },
};
const FUNNEL = ["landing_view", "trade_selected", "builder_started", "account_created", "export_succeeded", "checkout_started", "subscribed"];

export default async function CommandCenter() {
  const { p, error } = await loadCommandCenter();
  if (!p) return <Panel title="Command center unavailable"><p className="text-sm text-ink-soft">The platform data could not be loaded{error ? `: ${error}` : ""}. Reload in a moment.</p></Panel>;
  const now = new Date();
  const o = overview(p, now);
  const states = stateReport(p, {}, now);
  const leaders = leaderboard(p, now, 30, p.names, 6);
  const feed = recentActivity(p, 12);
  const r = o.revenue;
  const funnelMax = Math.max(1, ...FUNNEL.map((k) => p.funnel30d[k] ?? 0));

  return (
    <div className="space-y-6">
      <PageHead kicker={`Live · ${now.toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })} CT`} title="Command center"
        intro="Every number is counted from live platform data. No bid prices, line items or customer details appear here." />

      {/* A. Platform summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Bids created" value={o.bidsTotal} spark={o.bidsDaily.map((d) => d.value)} delta={<Delta pct={o.bidsDelta.pct} previous={o.bidsDelta.previous} />} sub={`${o.bidsDelta.current} in the last 7 days`} href="/admin/activity" />
        <Kpi label="Finalized bids" value={o.finalizedBids} tone="blue" spark={o.finalizedDaily.map((d) => d.value)} delta={<Delta pct={o.finalizedDelta.pct} previous={o.finalizedDelta.previous} />} sub={`${fmt(o.versions)} PDF versions · ${o.conversion.finalizedPct}% of bids`} href="/admin/activity" />
        <Kpi label="Signed bids" value={o.signedBids} tone="amber" spark={o.signedDaily.map((d) => d.value)} sub={`${o.signed30d} in the last 30 days`} />
        <Kpi label="Accounts" value={o.accounts} tone="blue" spark={o.signupsDaily.map((d) => d.value)} delta={<Delta pct={o.signupsDelta.pct} previous={o.signupsDelta.previous} />} sub={`${fmt(o.verifiedAccounts)} verified · ${fmt(o.businesses)} businesses`} />
        <Kpi label="Paid subscriptions" value={r.paidAccounts} sub={`${r.monthly} monthly · ${r.annual} annual${r.enterprise ? ` · ${r.enterprise} enterprise` : ""}`} href="/admin/revenue" />
        <Kpi label="MRR estimate" value={usd(r.mrrCents)} tone="green" sub={`${usd(r.arrCents)} annual run rate`} href="/admin/revenue" />
        <Kpi label="States represented" value={o.statesRepresented} tone="blue" sub={states.top ? `Top: ${US_STATES[states.top.state] ?? states.top.state} (${states.top.bids})` : "No located bids yet"} href="/admin/states" />
        <Kpi label="Sharing pricing data" value={o.sharingAnalytics} tone="violet" sub="Market Intelligence needs 20" href="/admin/data-quality" />
      </div>

      {/* B. Momentum */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker="Momentum · last 30 days" title="Bids, finalized and signed" className="lg:col-span-2" action={<PanelLink href="/admin/activity">Activity</PanelLink>}>
          <AreaChart height={240} series={[
            { name: "Bids created", tone: "green", points: o.bidsDaily },
            { name: "Finalized", tone: "blue", points: o.finalizedDaily },
            { name: "Signed", tone: "amber", points: o.signedDaily },
          ]} />
        </Panel>
        <Panel kicker="Right now" title="Activity counters">
          <div className="grid grid-cols-2 gap-2.5">
            <Mini label="Bids today" value={o.bidsToday} tone="green" />
            <Mini label="Bids this week" value={o.bidsWeek} />
            <Mini label="Bids this month" value={o.bidsMonth} />
            <Mini label="Finalized · week" value={o.finalizedWeek} tone="blue" />
            <Mini label="Finalized · month" value={o.finalizedMonth} tone="blue" />
            <Mini label="Signed · 30d" value={o.signed30d} tone="amber" />
            <Mini label="New accounts · 7d" value={o.newAccounts7d} tone="green" />
            <Mini label="New businesses · 7d" value={o.newBusinesses7d} tone="violet" />
          </div>
        </Panel>
      </div>

      {/* C + conversion + D */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker="Revenue" title="Subscription mix" action={<PanelLink href="/admin/revenue">Revenue</PanelLink>}>
          <Donut center={fmt(o.accounts)} sub="accounts" segments={[
            { label: "Free", value: o.freeAccounts, tone: "muted" },
            { label: "Monthly", value: r.monthly, tone: "green" },
            { label: "Annual", value: r.annual, tone: "blue" },
            { label: "Enterprise", value: r.enterprise, tone: "violet" },
            { label: "Complimentary", value: r.compActive, tone: "amber" },
          ]} />
          <div className="mt-4 flex flex-wrap gap-2">
            {r.cancelingAtPeriodEnd > 0 && <Chip tone="amber">{r.cancelingAtPeriodEnd} canceling at period end</Chip>}
            {r.pastDue > 0 && <Chip tone="red">{r.pastDue} past due</Chip>}
            <Chip tone="muted">{r.canceled30d} canceled · 30d</Chip>
          </div>
        </Panel>
        <Panel kicker="Conversion" title="How bids and accounts convert">
          <div className="grid grid-cols-3 gap-2">
            <Gauge value={o.conversion.finalizedPct} label="Finalized" sub="of bids" tone="blue" />
            <Gauge value={o.conversion.signedPct} label="Signed" sub="of finalized" tone="amber" />
            <Gauge value={o.conversion.paidPct} label="Paid" sub="of accounts" tone="green" />
          </div>
          <p className="mt-4 text-xs text-muted">Paid includes complimentary access. Signing counts customer e-signatures only.</p>
        </Panel>
        <Panel kicker="Data quality" title="Where bids are located" action={<PanelLink href="/admin/data-quality">Details</PanelLink>}>
          <StackBar segments={[
            { label: "From ZIP", value: o.location.bySource.zip, tone: "green" },
            { label: "From state field", value: o.location.bySource.state_field, tone: "blue" },
            { label: "Read from address", value: o.location.bySource.address, tone: "violet" },
            { label: "No location", value: o.location.missing, tone: "muted" },
          ]} />
          <p className="mt-3 text-xs text-muted">{o.location.total ? Math.round((o.location.withState / o.location.total) * 100) : 0}% of bids have a usable state. New saves now fill ZIP and state from the typed address.</p>
        </Panel>
      </div>

      {/* States + trades */}
      <div className="grid gap-6 lg:grid-cols-5">
        <Panel kicker="Geography" title="Bids by state" className="lg:col-span-3" action={<PanelLink href="/admin/states">Full report</PanelLink>}>
          <UsTileMap values={Object.fromEntries(states.rows.map((s) => [s.state, s.bids]))} />
          <p className="cc-mono mt-2 text-[11px] text-muted">{fmt(states.withState)} located bids · {fmt(states.missingState)} without a location · {states.states} states</p>
        </Panel>
        <Panel kicker="Mix" title="Bids by trade" className="lg:col-span-2">
          <BarList tone="blue" items={o.trades.slice(0, 8).map((t) => ({ label: tradeName(t.trade), value: t.n }))} empty="No bids yet" />
        </Panel>
      </div>

      {/* E. Recent events + leaderboard */}
      <div className="grid gap-6 lg:grid-cols-5">
        <Panel kicker="Feed" title="Recent activity" className="lg:col-span-3">
          {feed.length === 0 ? <Empty>Nothing has happened yet</Empty> : (
            <ol className="divide-y divide-[var(--cc-line)]">
              {feed.map((f, i) => (
                <li key={i} className="flex items-center gap-3 py-2.5">
                  <span className="w-[4.6rem] shrink-0"><Chip tone={KIND[f.kind].tone}>{KIND[f.kind].tag}</Chip></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{f.title}</span><span className="block truncate text-xs text-muted">{f.detail}</span></span>
                  <time className="cc-mono shrink-0 text-[11px] text-muted" dateTime={f.at}>{ago(f.at, now.getTime())}</time>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel kicker="Leaderboard · 30 days" title="Most active businesses" className="lg:col-span-2">
          {leaders.length === 0 ? <Empty>No bids in the last 30 days</Empty> : (
            <table className="w-full text-sm">
              <thead className="cc-kicker text-left"><tr><th className="pb-2 font-normal">#</th><th className="pb-2 font-normal">Business</th><th className="pb-2 text-right font-normal">Bids</th><th className="pb-2 text-right font-normal">Final</th><th className="pb-2 text-right font-normal">Signed</th></tr></thead>
              <tbody className="cc-mono">
                {leaders.map((l, i) => (
                  <tr key={l.key} className="border-t border-[var(--cc-line)]">
                    <td className="py-2 pr-2 text-[var(--cc-green)]">{String(i + 1).padStart(2, "0")}</td>
                    <td className="max-w-[10rem] truncate py-2 font-sans text-white">{l.label}</td>
                    <td className="py-2 text-right text-white">{l.bids}</td><td className="py-2 text-right text-ink-soft">{l.finalized}</td><td className="py-2 text-right text-ink-soft">{l.signed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {/* System health + funnel */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker="System health · 7 days" title="Errors">
          <div className="grid grid-cols-2 gap-2.5">
            <Mini label="PDF errors" value={p.pdfErrors7d} tone={p.pdfErrors7d ? "red" : "green"} />
            <Mini label="Import failures" value={p.importFailures7d} tone={p.importFailures7d ? "amber" : "green"} />
          </div>
          <p className="mt-3 text-xs text-muted">Details in Operations → Import &amp; PDF errors. Uptime and Sentry alerts arrive by email.</p>
        </Panel>
        <Panel kicker="Funnel · 30 days" title="Visitor to subscriber" className="lg:col-span-2">
          <BarList tone="green" max={funnelMax} items={FUNNEL.map((k) => ({ label: k.replace(/_/g, " "), value: p.funnel30d[k] ?? 0 }))} />
        </Panel>
      </div>
    </div>
  );
}
