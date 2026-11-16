import { Change, Columns, Kpi, PageHead, PairColumns, Panel, Pct, Table, fmt } from "@/components/admin/cc";
import { RangeControl, ReportUnavailable, ScopeNote, SectionTitle } from "@/components/admin/report";
import { tip } from "@/lib/admin/definitions";
import { activationTiming, ratio, signupCohorts, usageModel, windowOf } from "@/lib/admin/model";
import { loadReport } from "@/lib/admin/load";
import { adoption, EMPTY_PRODUCT, revenueSplit } from "@/lib/admin/product";
import { carry, href } from "@/lib/admin/view";
import { byAccount, firstPer } from "@/lib/admin/drill";
import { MetricFormula, MetricRecords, type MetricDrawerSpec } from "@/components/ui/metric-card";
import { tradeName } from "@/lib/trades/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Product usage" };

const hours = (h: number | null) => (h === null ? "–" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${Math.round(h / 24)} days`);

export default async function Usage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { r, error, view } = await loadReport(await searchParams);
  if (!r) return <ReportUnavailable error={error} />;
  const { facts, sc, now } = r;
  const range = view.range;
  const u = usageModel(sc, facts, range, now);
  const w = windowOf(range, now);
  const at = activationTiming(sc, facts, w.start, w.end, now);
  const cohorts = signupCohorts(sc, facts, now);
  const product = sc.d.product ?? EMPTY_PRODUCT;
  const ad = adoption(product, facts, range, now);
  const split = revenueSplit(facts, range, now);
  // Drilldowns behind each KPI: the accounts (in scope) that produced the number, for this window.
  const d = sc.d; const t = view.includeTest;
  const cust = (patch: Record<string, string>) => carry("/admin/customers", view, patch, "accounts");
  const sheet = (id: string, title: string, def: string, list: ReturnType<typeof byAccount>, empty: string, more?: { href: string; label: string }): MetricDrawerSpec => ({
    id, title, description: `Last ${range.label}`,
    body: <><MetricFormula><p>{def}</p><p className="mt-1 text-xs text-muted">{fmt(list.total)} across {fmt(list.accounts)} account{list.accounts === 1 ? "" : "s"}.</p></MetricFormula><MetricRecords title="By account" rows={list.rows} empty={empty} more={more} /></>,
  });
  const finalizedEv = firstPer(d.versions, (v) => v.estimate_id, (v) => v.created_at, (v) => v.user_id);
  const signedEv = firstPer(d.signatures, (x) => x.estimate_id, (x) => x.signed_at, (x) => x.user_id);
  const reqEv = d.signingRequests.map((x) => ({ user_id: x.user_id, at: x.created_at }));
  const nowMs = now.getTime();
  const resolvedEv = d.signingRequests.filter((x) => x.status === "signed" || x.status === "revoked" || Date.parse(x.expires_at) <= nowMs).map((x) => ({ user_id: x.user_id, at: x.created_at }));
  
  return (
    <div className="space-y-6">
      <PageHead kicker={`Product usage · ${range.label}`} title="Is Built2Bid delivering value?"
        intro="Activity means bid actions: starting, finalizing or sending a bid for signature. Page views and sign-ins never count. Small numbers are shown with their counts."
        right={<RangeControl view={view} path="/admin/usage" />} />
      <ScopeNote sc={sc} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="First bids started" value={u.firstEstimates.current} href={cust({ cohort: "first_bid" })} action="View these accounts" delta={<Change {...u.firstEstimates} />} def={tip("first_bid")} sub="Accounts starting their first bid" />
        <Kpi label="Repeat businesses" value={u.repeatBusinesses} href={cust({ cohort: "repeat", sort: "bids" })} action="View repeat accounts" tone="blue" def="Businesses (company or account) that have started more than one bid, all time." sub="More than one bid, all time" />
        <Kpi label="Bids finalized" value={u.finalized.current} action="Who finalized" drawer={sheet("finalized", "Bids finalized", "Estimates finalized for the first time in this period (one per bid; re-finalizing doesn't count again).", byAccount(finalizedEv, facts, w, { unit: "bids", includeTest: t }), "No bids were finalized in this period.", { href: cust({ cohort: "activated" }), label: "Accounts with their first finalized bid" })} delta={<Change {...u.finalized} />} def={tip("finalized")} />
        <Kpi label="Sent for signature" value={u.requests.current} action="Who sent" drawer={sheet("requests", "Sent for signature", "E-signature requests created in this period.", byAccount(reqEv, facts, w, { unit: "sent", includeTest: t }), "No proposals were sent for signature in this period.")} tone="blue" delta={<Change {...u.requests} />} def="Signing requests created in the window." />
        <Kpi label="Signed proposals" value={u.signed.current} action="Who got signatures" drawer={sheet("signed", "Signed proposals", "Proposals e-signed by the customer in this period (first signature per bid). A signature is not a payment.", byAccount(signedEv, facts, w, { unit: "signed", includeTest: t }), "No proposals were signed in this period.")} tone="violet" delta={<Change {...u.signed} />} def={tip("signed")} sub="Not a payment" />
        <Kpi label="Acceptance rate" value={u.acceptance.pct === null ? "–" : `${u.acceptance.pct}%`} action="Show the calculation" drawer={sheet("acceptance", "Acceptance rate", `Signed ÷ resolved signing requests created in this period (resolved = signed, revoked or expired). ${u.acceptance.n} signed of ${u.acceptance.d} resolved; ${u.pendingRequests} still pending are excluded.`, byAccount(resolvedEv, facts, w, { unit: "resolved", includeTest: t }), "No signing request was resolved in this period.")} tone="amber" def={tip("acceptance")} sub={`${u.acceptance.n} of ${u.acceptance.d} resolved · ${u.pendingRequests} pending`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker={`Activation · ${range.label}`} title="New accounts and how many started a bid" className="lg:col-span-2">
          <PairColumns points={u.activationSeries.map((p) => ({ label: p.label, a: p.signups, b: p.firstBid }))} a={{ name: "New accounts", tone: "blue" }} b={{ name: "…of which started a bid", tone: "green" }} />
          <p className="mt-2 text-xs text-muted">Cohort view: each period&apos;s new accounts, and how many of those have started a bid as of today.</p>
        </Panel>
        <Panel kicker="Time to value" title="From signup to first successful bid">
          <div className="grid grid-cols-2 gap-3">
            <div><p className="cc-kicker">Median to first bid</p><p className="cc-mono mt-1 text-3xl font-bold text-white">{hours(at.medianHoursToFirstBid)}</p><p className="text-[11px] text-muted">{fmt(at.firstBidSample)} account{at.firstBidSample === 1 ? "" : "s"}</p></div>
            <div><p className="cc-kicker">Median to finalized</p><p className="cc-mono mt-1 text-3xl font-bold text-white">{hours(at.medianHoursToFinalized)}</p><p className="text-[11px] text-muted">{fmt(at.finalizedSample)} account{at.finalizedSample === 1 ? "" : "s"}</p></div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <p className="flex justify-between gap-2"><span className="text-ink-soft">First bid within 24 h</span><Pct r={at.firstBidWithin24h} /></p>
            <p className="flex justify-between gap-2"><span className="text-ink-soft">Finalized within 24 h</span><Pct r={at.finalizedWithin24h} /></p>
            <p className="flex justify-between gap-2"><span className="text-ink-soft">Second bid within 30 days</span><Pct r={at.secondBid30d} empty="Too early" /></p>
            <p className="flex justify-between gap-2"><span className="text-ink-soft">First bid → finalized</span><Pct r={u.firstToFinal} /></p>
          </div>
          <p className="mt-3 text-[11px] text-muted">Accounts that signed up in the last {range.label}. Real timestamps only. An account joins a “within N” denominator only after N has passed, so new signups never lower a rate.</p>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker="Retention" title="Weekly active businesses (8 weeks)" className="lg:col-span-2">
          <Columns tone="green" points={u.wabSeries} />
          <p className="mt-2 text-xs text-muted">A business is the Enterprise company, otherwise the account.</p>
        </Panel>
        <Panel kicker="Right now" title="Active businesses">
          <div className="grid grid-cols-2 gap-3">
            <div><p className="cc-kicker">Weekly (7d)</p><p className="cc-mono mt-1 text-3xl font-bold text-white">{fmt(u.wab)}</p></div>
            <div><p className="cc-kicker">Monthly (30d)</p><p className="cc-mono mt-1 text-3xl font-bold text-white">{fmt(u.mab)}</p></div>
          </div>
          <p className="mt-4 text-sm text-ink-soft">Bids per active business ({range.label}): <span className="cc-mono text-white">{u.perActiveBusiness ?? "–"}</span></p>
          <p className="mt-1 text-[11px] text-muted">{tip("active")}</p>
        </Panel>
      </div>

      <SectionTitle id="retention" kicker="Retention" title="Repeat usage and signup cohorts" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Coming back">
          <div className="space-y-2 text-sm">
            <p className="flex justify-between gap-2"><span className="text-ink-soft">Bid activity around day 30</span><Pct r={at.repeat30} empty="Too early" /></p>
            <p className="flex justify-between gap-2"><span className="text-ink-soft">Bid activity around day 60</span><Pct r={at.repeat60} empty="Too early" /></p>
            <p className="flex justify-between gap-2"><span className="text-ink-soft">Businesses with a second bid</span><span className="cc-mono text-white">{fmt(u.repeatBusinesses)}</span></p>
            <p className="flex justify-between gap-2"><span className="text-ink-soft">E-signature adoption</span><Pct r={u.esignAdoption} /></p>
            <p className="flex justify-between gap-2"><span className="text-ink-soft">Paid customers retained</span><Pct r={u.retainedPaid} /></p>
            <p className="flex justify-between gap-2"><span className="text-ink-soft">Request → signature (median)</span><span className="cc-mono text-white">{at.signSample ? `${hours(at.medianHoursToSign)} (${fmt(at.signSample)})` : "–"}</span></p>
          </div>
          <p className="mt-3 text-[11px] text-muted">Day 30/60: started a bid between days 23–37 / 53–67 after signup, among accounts with a first bid that are old enough. Not logging in is never churn. E-signature: activated businesses active since Nov 15, 2026 that sent a signing request.</p>
        </Panel>
        <Panel kicker="By signup month" title="Cohorts" className="lg:col-span-2">
          {cohorts.length === 0 ? <p className="text-sm text-ink-soft">No accounts yet.</p> : (
            <Table head={["Signed up", "Accounts", "Finalized a bid", "Second bid", "Ever paid", "Paying now"]} align={["l", "r", "r", "r", "r", "r"]} minWidth={560}>
              {cohorts.map((c) => (
                <tr key={c.month}>
                  <td className="font-sans text-white">{c.label}{c.immature && <span className="ml-1.5 rounded border border-[var(--cc-line)] px-1 text-[10px] text-[var(--cc-amber)]" title="Less than 60 days old: these numbers will still grow">immature</span>}</td>
                  <td className="text-right text-white">{fmt(c.registered)}</td>
                  <td className="text-right"><Pct r={ratio(c.firstFinalized, c.registered)} /></td>
                  <td className="text-right"><Pct r={ratio(c.secondBid, c.registered)} /></td>
                  <td className="text-right"><Pct r={ratio(c.paid, c.registered)} /></td>
                  <td className="text-right">{fmt(c.retainedPaid)}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-2 text-xs text-muted">Each row is the accounts created that month and what they have done by today. Complimentary access is not counted as paid.</p>
        </Panel>
      </div>

      <Panel kicker={`Trades · ${range.label}`} title="Bids by construction trade" action={<a href={href("/admin/export/trades", view)} className="cc-mono text-[11px] text-[var(--cc-blue)] underline">Export CSV</a>}>
        {u.trades.length === 0 ? <p className="text-sm text-ink-soft">No bids in this window.</p> : (
          <Table head={["Trade", "Bids", `Previous ${range.label}`, "Change", "Finalized", "Signed"]} align={["l", "r", "r", "r", "r", "r"]} minWidth={560}>
            {u.trades.slice(0, 25).map((t) => (
              <tr key={t.trade}>
                <td className="font-sans text-white">{tradeName(t.trade)}</td><td className="text-right text-white">{fmt(t.bids)}</td><td className="text-right text-muted">{fmt(t.prev)}</td>
                <td className="text-right"><Change current={t.bids} previous={t.prev} pctChange={t.prev >= 5 ? Math.round(((t.bids - t.prev) / t.prev) * 100) : null} /></td>
                <td className="text-right">{fmt(t.finalized)}</td><td className="text-right">{fmt(t.signed)}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-muted">Counts only. No pricing or profitability is inferred. Geography: <a href={href("/admin/states", view)} className="underline">Bids by state</a>.</p>
      </Panel>

      <SectionTitle id="v4" kicker="Premium features" title="Pipeline, internal reports and project scheduling" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="product-adoption">
        <Kpi label="Accounts using the pipeline" value={ad.pipelineAccounts} action="Who uses it" drawer={sheet("pipeline", "Accounts using the pipeline", "Accounts with at least one bid moved past Draft, all time. Count = bids past Draft.", byAccount(product.stages.filter((x) => x.pipeline_stage && x.pipeline_stage !== "draft").map((x) => ({ user_id: x.user_id, at: "2000-01-01" })), facts, null, { unit: "bids", includeTest: t }), "No account has moved a bid past Draft yet.")} def="Accounts with at least one bid moved past Draft on the Bids pipeline, all time." sub={`${ad.pipelineMovers.current} moved a bid this ${range.label}`} delta={<Change {...ad.pipelineMovers} />} />
        <Kpi label="Internal reports generated" value={ad.reports.current} action="Who generated" drawer={sheet("reports", "Internal reports generated", "Internal Estimate Report previews, downloads and email attachments. Only who and when is logged, never the figures.", byAccount(product.reports.map((x) => ({ user_id: x.user_id, at: x.created_at })), facts, w, { unit: "reports", includeTest: t }), "No internal reports in this period.")} tone="blue" delta={<Change {...ad.reports} />} def="Internal Estimate Report previews, downloads and email attachments in the window. Only who and when is logged, never the figures in it." sub={`${ad.reportAccounts} account${ad.reportAccounts === 1 ? "" : "s"} this ${range.label}`} />
        <Kpi label="Premium report adoption" value={ad.reportAdoption.pct === null ? "–" : `${ad.reportAdoption.pct}%`} action="Show the calculation" drawer={sheet("report-adoption", "Premium report adoption", `Accounts that ever generated an Internal Estimate Report ÷ accounts with paid or complimentary premium access now (${ad.reportAdoption.n} of ${ad.reportAdoption.d}).`, byAccount(product.reports.map((x) => ({ user_id: x.user_id, at: x.created_at })), facts, null, { unit: "reports", includeTest: t }), "No account has generated an internal report yet.")} def="Accounts that have ever generated an Internal Estimate Report ÷ accounts with paid or complimentary premium access now." sub={`${ad.reportAdoption.n} of ${ad.reportAdoption.d} premium accounts`} />
        <Kpi label="Scheduled projects" value={ad.schedules} action="Who schedules" drawer={sheet("schedules", "Scheduled projects", "Project schedules that aren't archived, all time, by owner.", byAccount(product.schedules.filter((x) => x.status !== "archived").map((x) => ({ user_id: x.user_id, at: x.created_at })), facts, null, { unit: "projects", includeTest: t }), "No scheduled projects yet.")} tone="violet" delta={<Change {...ad.schedulesNew} />} def="Project schedules that aren't archived (all time); change = schedules created in the window." sub={`${ad.schedulesNew.current} new · ${ad.scheduleAccounts} account${ad.scheduleAccounts === 1 ? "" : "s"}`} />
        <Kpi label="Customer updates published" value={ad.publications.current} action="Who published" drawer={sheet("publications", "Customer updates published", "Customer schedule updates published in this period (a publish, not a delivery).", byAccount(product.publications.map((x) => ({ user_id: x.published_by, at: x.published_at })), facts, w, { unit: "updates", includeTest: t }), "No customer updates were published in this period.")} delta={<Change {...ad.publications} />} def="Customer schedule updates published in the window (a publish, not a delivery)." sub={`${ad.publicationsAll} all time`} />
        <Kpi label="Scheduling subscriptions" value={split.pmAddonSubs} href={carry("/admin/revenue", view, {}, "by-product")} action="Add-on revenue breakdown" tone="amber" def="Standard subscriptions with the project scheduling add-on, and Enterprise editor seats assigned." sub={`${ad.editorSeats} Enterprise editor${ad.editorSeats === 1 ? "" : "s"} assigned · ${split.pmAddonEnded} add-on${split.pmAddonEnded === 1 ? "" : "s"} ended`} />
      </div>
      <Panel kicker="Bids pipeline" title="Bids by stage, now">
        {ad.bidsByStage.length === 0 ? <p className="text-sm text-ink-soft">No bids yet.</p> : (
          <Table head={["Stage", "Bids"]} align={["l", "r"]} minWidth={240}>
            {ad.bidsByStage.map((b) => <tr key={b.stage}><td className="font-sans">{(STAGE as Record<string, string>)[b.stage] ?? b.stage}</td><td className="text-right text-white">{fmt(b.n)}</td></tr>)}
          </Table>
        )}
        <p className="mt-3 text-xs text-muted">Counts only: no bid values, estimate amounts or customer details are read for this section, and nothing here is sent to third-party analytics. {!product.installed.reports && "Report counts start once the Phase 10 SQL is applied. "}Scheduling revenue is on <a href={href("/admin/revenue", view) + "#by-product"} className="underline">Revenue</a>.</p>
      </Panel>
    </div>
  );
}

const STAGE = { draft: "Draft", sent: "Sent", pending: "Awaiting signature", ready_for_review: "Ready for review", approved: "Approved", won: "Won", scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", lost: "Lost" };
