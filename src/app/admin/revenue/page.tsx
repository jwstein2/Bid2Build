import Link from "next/link";
import { AreaChart, Change, Fresh, Kpi, NotConnected, PageHead, PairColumns, Panel, PanelLink, Pct, Row, Table, day, fmt, usd } from "@/components/admin/cc";
import { RangeControl, ReportUnavailable, ScopeNote, SectionTitle } from "@/components/admin/report";
import { tip } from "@/lib/admin/definitions";
import { stripeCheckouts, stripeReconcile } from "@/lib/admin/integrations";
import { inWindow, monthlyCents, mrrParts, ratio, revenueModel, windowOf } from "@/lib/admin/model";
import { revenueSplit } from "@/lib/admin/product";
import { loadReport } from "@/lib/admin/load";
import { href } from "@/lib/admin/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revenue" };

export default async function Revenue({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { r, error, view } = await loadReport(await searchParams);
  if (!r) return <ReportUnavailable error={error} />;
  const { facts, sc, snap, now } = r;
  const range = view.range;
  const w = windowOf(range, now);
  const rev = revenueModel(facts, range, now);
  const excluded = new Set(view.includeTest ? [] : snap.subscriptions.filter((s) => sc.classes.get(s.user_id)?.cls !== "genuine" && s.stripe_customer_id).map((s) => s.stripe_customer_id!));
  const [stripe, sessions] = await Promise.all([stripeReconcile(range.days, excluded), stripeCheckouts(range.days)]);
  const started = sc.d.events.filter((e) => e.event === "checkout_started" && inWindow(e.created_at, w.start, w.end)).length;
  const done = sc.d.events.filter((e) => e.event === "subscribed" && inWindow(e.created_at, w.start, w.end)).length;
  const mix = [
    { label: "Monthly ($19.99)", n: rev.monthly, mrr: rev.monthly * 1999 },
    { label: "Annual ($149 ÷ 12)", n: rev.annual, mrr: rev.annual * Math.round(14900 / 12) },
    { label: "Enterprise (by seats)", n: rev.enterprise, mrr: facts.filter((f) => f.paying && f.sub?.plan === "enterprise").reduce((n, f) => n + mrrParts(f.sub!).core, 0) },
  ];
  const split = revenueSplit(facts, range, now);
  const reconOk = stripe ? stripe.active + stripe.pastDue === rev.paying : null;

  return (
    <div className="space-y-6">
      <PageHead kicker={`Revenue · ${range.label}`} title="Recurring revenue and risk"
        intro="Paid subscriptions only. Complimentary access is never counted as revenue. MRR is list price; money actually collected comes from Stripe."
        right={<div className="flex flex-wrap items-center gap-2"><RangeControl view={view} path="/admin/revenue" /><PanelLink href={href("/admin/revenue/scorecard", view)}>Business Scorecard</PanelLink></div>} />
      <ScopeNote sc={sc} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Paying subscribers" value={rev.paying} def={tip("paying")} sub={`${rev.monthly} monthly · ${rev.annual} annual · ${rev.enterprise} enterprise`} />
        <Kpi label="MRR (list price)" value={usd(rev.mrrCents)} tone="blue" def={tip("mrr")} sub={`${usd(rev.arrCents)} annual run rate${split.pmAddonCents + split.pmEditorCents ? ` · incl. ${usd(split.pmAddonCents + split.pmEditorCents)} scheduling add-ons` : ""}`} />
        <Kpi label="Net MRR change" value={`${rev.netMrrCents >= 0 ? "+" : "−"}${usd(Math.abs(rev.netMrrCents))}`} tone={rev.netMrrCents < 0 ? "amber" : "green"} def={tip("net_mrr")} sub={`+${usd(rev.newMrrCents)} new · −${usd(rev.lostMrrCents)} lost`} />
        <Kpi label="New paid subscriptions" value={rev.newPaid.current} delta={<Change {...rev.newPaid} />} def={tip("paying")} sub={`${rev.newPaid.previous} the ${range.label} before`} />
        <Kpi label="Cancellations (ended)" value={rev.ended.current} tone={rev.ended.current ? "amber" : "green"} delta={<Change {...rev.ended} good="down" />} def={tip("churn")} sub={`${rev.scheduledCancel} more scheduled at period end`} />
        <Kpi label="Past due" value={rev.pastDue} tone={rev.pastDue ? "red" : "green"} def="Subscriptions Stripe could not charge and is retrying. Still counted as paying until Stripe cancels them." sub={rev.pastDue ? "Needs attention below" : "No failed payments"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker={`MRR over time · ${range.label}`} title="List-price MRR at the end of each period" className="lg:col-span-2">
          <AreaChart height={190} totals={false} series={[{ name: "MRR ($)", tone: "blue", points: rev.mrrSeries }]} />
          <p className="mt-2 text-xs text-muted">Reconstructed from subscription start (Stripe-confirmed &ldquo;subscribed&rdquo; event) and end dates.{rev.unknownStart ? ` ${rev.unknownStart} subscription${rev.unknownStart === 1 ? " has" : "s have"} no recorded start and ${rev.unknownStart === 1 ? "is" : "are"} treated as older than the window.` : ""}</p>
        </Panel>
        <Panel kicker="Source of truth" title="Stripe reconciliation" action={<Fresh at={stripe?.fetchedAt} state={stripe ? "live" : "error"} now={now.getTime()} />}>
          {stripe ? (
            <>
              <dl>
                <Row k="Active in Stripe">{fmt(stripe.active)}</Row>
                <Row k="Past due in Stripe">{fmt(stripe.pastDue)}</Row>
                <Row k="Paying in our snapshot">{fmt(rev.paying)}</Row>
                <Row k={`Payments received · ${range.label}`}><span className="text-[var(--cc-green)]">{usd(stripe.paidCents)}</span></Row>
                <Row k="Paid invoices">{fmt(stripe.invoices)}</Row>
              </dl>
              <p className={`mt-2 text-xs ${reconOk ? "text-muted" : "text-[var(--cc-amber)]"}`}>{reconOk ? "Reconciled: snapshot matches Stripe." : "Snapshot and Stripe differ: a webhook may have been missed. Check Operations."} Snapshot last updated by a Stripe webhook {snap.stripeEvents[0] ? day(snap.stripeEvents[0].received_at) : "more than 7 days ago"}. Payments are {stripe.refundsNote.toLowerCase()}.</p>
            </>
          ) : (
            <div className="space-y-2 text-sm text-ink-soft"><NotConnected>Stripe not reachable from this deploy</NotConnected><p>Numbers on this page come from the webhook snapshot in Supabase. Open Stripe for collected payments.</p></div>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker="Movement" title="New vs lost MRR ($)" className="lg:col-span-2">
          <PairColumns points={rev.movement.map((m) => ({ label: m.label, a: m.added, b: m.lost }))} a={{ name: "New MRR", tone: "green" }} b={{ name: "Lost MRR", tone: "amber" }} />
        </Panel>
        <Panel kicker="Mix" title="Paid subscriptions by plan">
          <Table head={["Plan", "Subs", "MRR"]} align={["l", "r", "r"]} minWidth={260}>
            {mix.map((m) => <tr key={m.label}><td className="font-sans">{m.label}</td><td className="text-right text-white">{fmt(m.n)}</td><td className="text-right">{usd(m.mrr)}</td></tr>)}
          </Table>
          <p className="mt-3 text-xs text-muted">Annual plans count once, at $149 ÷ 12 per month. Complimentary (not revenue): {rev.comp.active} active ({rev.comp.unlimited} Unlimited, {rev.comp.enterprise} Enterprise).</p>
        </Panel>
      </div>

      <Panel kicker="By product" title="Recurring revenue: plans and scheduling add-ons" className="scroll-mt-24">
        <div id="by-product" className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Table head={["Revenue stream", "Subscriptions", "MRR"]} align={["l", "r", "r"]} minWidth={320}>
              <tr><td className="font-sans">Core subscriptions (Unlimited + Enterprise licenses)</td><td className="text-right text-white">{fmt(rev.paying)}</td><td className="text-right">{usd(split.coreCents)}</td></tr>
              <tr><td className="font-sans">Project Command Center add-on ($4.99/mo or $49.99/yr)</td><td className="text-right text-white">{fmt(split.pmAddonSubs)}</td><td className="text-right">{usd(split.pmAddonCents)}</td></tr>
              <tr><td className="font-sans">Enterprise scheduling editors ($1.99/mo each beyond the included one)</td><td className="text-right text-white">{fmt(split.pmEditorSeats)} seats · {fmt(split.pmEditorCompanies)} co.</td><td className="text-right">{usd(split.pmEditorCents)}</td></tr>
              <tr><td className="font-sans font-bold text-white">Total recurring revenue</td><td /><td className="text-right font-bold text-white" data-testid="total-mrr">{usd(split.totalCents)}</td></tr>
            </Table>
          </div>
          <dl>
            <Row k="Add-ons ending at period end">{fmt(split.pmAddonEnding)}</Row>
            <Row k={`Add-ons ended · ${range.label}`}>{fmt(split.pmAddonEnded)}</Row>
            <Row k="Add-ons on annual plans">{fmt(split.pmAddonAnnual)}</Row>
          </dl>
        </div>
        <p className="mt-3 text-xs text-muted">Each Stripe subscription is counted once with its items, so add-ons are never double counted. List price: proration, credits, discounts and tax are not in MRR (payments received above come from Stripe). A removed add-on stops counting immediately even though editing continues until the paid period ends; it becomes a cancellation when that period ends. Add-ons on annual plans count as $49.99 ÷ 12. Total equals the headline MRR.</p>
      </Panel>

      <SectionTitle id="at-risk" kicker="Retention" title="Failed payments and cancellations" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title={`Past due (${rev.pastDueRows.length})`}>
          {rev.pastDueRows.length === 0 ? <p className="text-sm text-ink-soft">No failed payments.</p> : <ul className="space-y-2">{rev.pastDueRows.map((f) => <li key={f.id}><Link href={`/admin/customers/${f.id}`} className="text-sm text-white underline">{f.business ?? f.email}</Link> <span className="cc-mono text-xs text-muted">{f.sub?.plan} · {usd(monthlyCents(f.sub!))}/mo</span></li>)}</ul>}
        </Panel>
        <Panel title={`Scheduled to cancel (${rev.cancelingRows.length})`}>
          {rev.cancelingRows.length === 0 ? <p className="text-sm text-ink-soft">None. These are still paying until their period ends.</p> : <ul className="space-y-2">{rev.cancelingRows.map((f) => <li key={f.id}><Link href={`/admin/customers/${f.id}`} className="text-sm text-white underline">{f.business ?? f.email}</Link> <span className="cc-mono text-xs text-muted">ends {day(f.sub?.current_period_end)}</span></li>)}</ul>}
        </Panel>
        <Panel title={`Ended in ${range.label} (${rev.endedRows.length})`}>
          {rev.endedRows.length === 0 ? <p className="text-sm text-ink-soft">No paid subscription ended in this window.</p> : <ul className="space-y-2">{rev.endedRows.map((f) => <li key={f.id}><Link href={`/admin/customers/${f.id}`} className="text-sm text-white underline">{f.business ?? f.email}</Link> <span className="cc-mono text-xs text-muted">{day(f.paidEndedAt)}</span></li>)}</ul>}
        </Panel>
      </div>

      <Panel kicker="Conversion" title="Checkout to paid subscriber" className="scroll-mt-24">
        <div id="checkout" className="grid gap-4 sm:grid-cols-3">
          <div><p className="cc-kicker">Checkouts started</p><p className="cc-mono mt-1 text-2xl font-bold text-white">{fmt(started)}</p></div>
          <div><p className="cc-kicker">Subscriptions confirmed</p><p className="cc-mono mt-1 text-2xl font-bold text-white">{fmt(done)}</p></div>
          <div><p className="cc-kicker">Completion</p><p className="mt-2"><Pct r={ratio(done, started)} /></p></div>
        </div>
        <div className="mt-4 grid gap-4 border-t border-[var(--cc-line)] pt-4 sm:grid-cols-3">
          <div><p className="cc-kicker">Stripe sessions completed</p><p className="cc-mono mt-1 text-xl font-bold text-white">{sessions ? fmt(sessions.complete) : "–"}</p></div>
          <div><p className="cc-kicker">Abandoned or canceled (expired)</p><p className="cc-mono mt-1 text-xl font-bold text-white">{sessions ? fmt(sessions.expired) : "–"}</p></div>
          <div><p className="cc-kicker">Still open</p><p className="cc-mono mt-1 text-xl font-bold text-white">{sessions ? fmt(sessions.open) : "–"}</p><p className="mt-1"><Fresh at={sessions?.fetchedAt} state={sessions ? "live" : "error"} now={now.getTime()} /></p></div>
        </div>
        <p className="mt-3 text-xs text-muted">Event-based (not a cohort): checkout_started and subscribed events in the window. Session outcomes come from Stripe Checkout (read-only, whole Stripe account, including any internal test purchases). Built2Bid has no free trial, so trial conversion does not apply.</p>
      </Panel>
    </div>
  );
}
