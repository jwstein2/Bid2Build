import Link from "next/link";
import { Change, FunnelSteps, Kpi, PageHead, PairColumns, Panel, PanelLink, Pct, ago, fmt, usd } from "@/components/admin/cc";
import { RangeControl, ReportUnavailable, ScopeNote } from "@/components/admin/report";
import { tip } from "@/lib/admin/definitions";
import { envPresent, ga4Report } from "@/lib/admin/integrations";
import { costIssues, serviceViews } from "@/lib/admin/costs";
import { activityFeed, cohortFunnel, kpis, momentum, needsAttention, ratio, windowOf, type FeedKind } from "@/lib/admin/model";
import { loadReport } from "@/lib/admin/load";
import { carry, href } from "@/lib/admin/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Owner overview" };

const FEED_TONE: Record<FeedKind, string> = { joined: "var(--cc-blue)", first_bid: "var(--cc-blue)", paid: "var(--cc-green)", canceled: "var(--cc-amber)", signed: "var(--cc-green)", comp_granted: "var(--cc-violet)", comp_expired: "var(--cc-amber)" };

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { r, error, view } = await loadReport(await searchParams, { costs: true });
  if (!r) return <ReportUnavailable error={error} />;
  const { facts, sc, now } = r;
  const range = view.range;
  const w = windowOf(range, now);
  const k = kpis(facts, range, now);
  const funnel = cohortFunnel(facts, w.start, w.end);
  const ga = await ga4Report(range.days);
  const m = momentum(facts, range, now);
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const aiMonth = Math.round((r.costs?.ai ?? []).filter((a) => Date.parse(a.created_at) >= monthStart).reduce((n, a) => n + (Number(a.cost_usd) || 0), 0) * 100);
  const aiBudget = Number(process.env.AI_MONTHLY_BUDGET_USD);
  const issues = [...needsAttention(sc, facts, now), ...(r.costs ? costIssues(serviceViews(r.costs.services, r.costs.expenses, envPresent, now), now, { monthCents: aiMonth, budgetCents: Number.isFinite(aiBudget) && aiBudget > 0 ? Math.round(aiBudget * 100) : null }) : [])];
  const feed = activityFeed(sc, facts, now, 9);
  const nowMs = now.getTime();

  return (
    <div className="space-y-6">
      <PageHead kicker={`Overview · last ${range.label}`} title="Business health" intro="Acquire contractors → help them finalize bids → convert to paid → keep them active. Hover the i on any number for its definition."
        right={<RangeControl view={view} path="/admin" />} />
      <ScopeNote sc={sc} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Paying customers" value={k.paying.now} def={tip("paying")} href={carry("/admin/customers", view, { plan: "paying" }, "accounts")} action="View paying customers"
          sub={<>{k.paying.pastDue ? <span className="text-[var(--cc-amber)]">{k.paying.pastDue} past due · </span> : null}net {k.paying.net >= 0 ? "+" : ""}{k.paying.net} in {range.label}</>} />
        <Kpi label="MRR (list-price estimate)" value={usd(k.mrrCents)} tone="blue" def={tip("mrr")} href={carry("/admin/revenue", view, {}, "by-product")} action="Subscription revenue breakdown"
          sub={`Net ${k.netMrrCents >= 0 ? "+" : "−"}${usd(Math.abs(k.netMrrCents))} in ${range.label} · not cash collected`} />
        <Kpi label="Newly activated businesses" value={k.activated.current} def={tip("activated")} href={carry("/admin/customers", view, { cohort: "activated", sort: "activity" }, "accounts")} action="View newly activated accounts"
          delta={<Change {...k.activated} />} sub={`Finalized a first bid · ${k.activated.previous} the ${range.label} before`} />
        <Kpi label="Free-to-paid (all time)" value={k.freeToPaid.pct === null ? "–" : `${k.freeToPaid.pct}%`} tone="violet" def={tip("signup_paid")} href={carry("/admin/customers", view, { cohort: "ever_paid" }, "accounts")} action="View accounts that paid"
          sub={<>{fmt(k.freeToPaid.n)} of {fmt(k.freeToPaid.d)} accounts ever paid{k.freeToPaid.small ? " · small sample" : ""} · complimentary excluded</>} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Panel kicker={`Acquisition → revenue · signed up in the last ${range.label}`} title="Where new accounts stop" className="lg:col-span-2" action={<PanelLink href={href("/admin/marketing", view)}>Marketing</PanelLink>}>
          <FunnelSteps steps={[
            { label: "Website sessions", n: ga ? ga.sessions : null, note: ga ? "GA4 sessions, not people" : "GA4 reporting not connected" },
            { label: "Signed up", n: funnel.cohort, ofPrev: ga ? ratio(funnel.cohort, ga.sessions) : undefined },
            { label: "Started a bid", n: funnel.firstBid, ofPrev: funnel.steps[1].ofPrev },
            { label: "Finalized a bid", n: funnel.finalized, ofPrev: funnel.steps[2].ofPrev },
            { label: "Paying", n: funnel.paid, ofPrev: funnel.steps[3].ofPrev },
          ]} />
          <p className="mt-3 text-xs text-muted">Account-based cohort: the {fmt(funnel.cohort)} genuine accounts created in this window, and the furthest step each has reached as of today. Sessions are a separate GA4 count and are never mixed into account percentages. Overall: <Pct r={funnel.steps[3].ofCohort} />.</p>
        </Panel>

        <Panel kicker="Needs attention" title={issues.length ? `${issues.length} open item${issues.length === 1 ? "" : "s"}` : "Nothing needs action"}>
          {issues.length === 0 ? <p className="text-sm text-ink-soft">No failed payments, webhook errors, failed emails, expiring grants or checkout problems right now.</p> : (
            <ul className="space-y-2">
              {issues.map((i) => (
                <li key={i.title}>
                  <Link href={i.href} className="block rounded-lg border px-3 py-2 hover:bg-white/5" style={{ borderColor: i.severity === "red" ? "rgb(255 107 129 / 0.45)" : "rgb(255 181 71 / 0.35)" }}>
                    <p className="cc-mono text-[10px] tracking-wider" style={{ color: i.severity === "red" ? "var(--cc-red)" : "var(--cc-amber)" }}>{i.severity === "red" ? "■ ACTION NEEDED" : "▲ REVIEW"}</p>
                    <p className="text-sm font-semibold text-white">{i.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{i.detail}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Panel kicker={`Momentum · ${range.label}`} title="Newly activated businesses and new paid subscriptions" className="lg:col-span-2">
          <PairColumns height={170} points={m.activated.map((p, i) => ({ label: p.label, a: p.value, b: m.newPaid[i]?.value ?? 0 }))} a={{ name: "Newly activated", tone: "green" }} b={{ name: "New paid subscriptions", tone: "blue" }} />
          <p className="mt-2 text-xs text-muted">Activated = first finalized bid. Paid = first &ldquo;subscribed&rdquo; event recorded when Stripe confirms checkout.</p>
        </Panel>
        <Panel kicker="Recent activity" title="What changed" action={<PanelLink href={href("/admin/customers", view)}>Customers</PanelLink>}>
          {feed.length === 0 ? <p className="text-sm text-ink-soft">No activity yet.</p> : (
            <ol className="space-y-2.5">
              {feed.map((f, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: FEED_TONE[f.kind] }} aria-hidden />
                  <Link href={f.href} className="min-w-0 flex-1 hover:opacity-90">
                    <p className="flex justify-between gap-2 text-sm"><span className="font-semibold text-white">{f.title}</span><span className="cc-mono shrink-0 text-[11px] text-muted">{ago(f.at, nowMs)}</span></p>
                    <p className="truncate text-xs text-muted">{f.who}</p>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
