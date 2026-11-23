import Link from "next/link";
import { Chip, FunnelSteps, Kpi, NotConnected, PageHead, Panel, Pct, Table, fmt, usd, usdWhole } from "@/components/admin/cc";
import { RangeControl, ReportUnavailable, ScopeNote, SectionTitle } from "@/components/admin/report";
import { CHANNELS, CHANNEL_LABEL, isChannel } from "@/lib/admin/channels";
import { tip } from "@/lib/admin/definitions";
import { ga4Report, searchConsoleReport, stripeCheckouts } from "@/lib/admin/integrations";
import { activationTiming, campaignReport, channelReport, cohortFunnel, creativeReport, creatorReport, insights, planOf, tradeReport, inWindow, landingReport, monthlyCents, paybackMonths, prorateCosts, ratio, windowOf } from "@/lib/admin/model";
import { loadReport } from "@/lib/admin/load";
import { carry, href, str } from "@/lib/admin/view";
import { MetricFormula, MetricRecords } from "@/components/ui/metric-card";
import { addCost, deleteCost } from "./actions";
import { createAdminClient } from "@/lib/supabase/server";
import { OFFER_LABEL, summarizeOffers } from "@/lib/offers/policy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing" };

const money = (n: number | null) => (n == null ? null : usdWhole(n));

export default async function Marketing({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { r, error, view } = await loadReport(sp);
  if (!r) return <ReportUnavailable error={error} />;
  const { facts, sc, snap, now } = r;
  const range = view.range;
  const w = windowOf(range, now);
  const [ga, gsc, sessions] = await Promise.all([ga4Report(range.days), searchConsoleReport(range.days), stripeCheckouts(range.days)]);
  const costs = prorateCosts(snap.costs, w.start, w.end);
  // V8 in-app offers and cancellation reasons (table from 20270105002000; missing table = "not set up").
  const { data: offerRows, error: offerErr } = await createAdminClient().from("upgrade_offers").select("offer_id, action, detail").gte("created_at", new Date(w.start).toISOString()).lt("created_at", new Date(w.end).toISOString()).limit(20000);
  const offerSummary = offerErr ? null : summarizeOffers(offerRows ?? []);

  // Funnel drilldown filters (validated against known values).
  const fChannel = isChannel(str(sp.channel)) ? str(sp.channel) : "";
  const campaigns = [...new Set(facts.map((f) => f.campaign).filter(Boolean))] as string[];
  const fCampaign = campaigns.includes(str(sp.campaign)) ? str(sp.campaign) : "";
  const landings = [...new Set(facts.map((f) => f.landing).filter(Boolean))] as string[];
  const fLanding = landings.includes(str(sp.landing)) ? str(sp.landing) : "";
  const fDevice = ["mobile", "tablet", "desktop"].includes(str(sp.device)) ? str(sp.device) : "";
  const creatives = [...new Set(facts.map((f) => f.creative).filter(Boolean))] as string[];
  const fCreative = creatives.includes(str(sp.creative)) ? str(sp.creative) : "";
  const trades = [...new Set(facts.map((f) => f.trade).filter(Boolean))].sort() as string[];
  const fTrade = trades.includes(str(sp.trade)) ? str(sp.trade) : "";
  const fPlan = ["free", "paid", "complimentary"].includes(str(sp.plan)) ? str(sp.plan) : "";
  const filtered = facts.filter((f) => (!fChannel || f.channel === fChannel) && (!fCampaign || f.campaign === fCampaign) && (!fLanding || f.landing === fLanding) && (!fDevice || f.device === fDevice) && (!fCreative || f.creative === fCreative) && (!fTrade || f.trade === fTrade) && (!fPlan || planOf(f) === fPlan));
  const anyFilter = Boolean(fChannel || fCampaign || fLanding || fDevice || fCreative || fTrade || fPlan);

  const all = cohortFunnel(facts, w.start, w.end);
  const fun = cohortFunnel(filtered, w.start, w.end);
  const channels = channelReport(facts, costs, w.start, w.end);
  const camp = campaignReport(facts, costs, w.start, w.end, now);
  const ins = insights(facts, costs, sc.d.events, w.start, w.end, now, ga?.sessions ?? null);
  const spend = costs.reduce((n, c) => n + (Number(c.amount_usd) || 0), 0);
  const landingRows = landingReport(facts, w.start, w.end);
  const creativeRows = creativeReport(facts, w.start, w.end);
  const creatorRows = creatorReport(facts);
  const tradeRows = tradeReport(facts, w.start, w.end);
  const payingCohort = facts.filter((f) => inWindow(f.createdAt, w.start, w.end) && f.paying);
  const payback = paybackMonths(spend || null, all.paid, payingCohort.reduce((n, f) => n + monthlyCents(f.sub!), 0), payingCohort.length);
  const timing = activationTiming(sc, facts, w.start, w.end, now);
  const cohort = facts.filter((f) => inWindow(f.createdAt, w.start, w.end));
  const ev = (name: string) => sc.d.events.filter((e) => e.event === name && inWindow(e.created_at, w.start, w.end)).length;
  const outreach = channels.find((c) => c.key === "email_outreach");
  const known = facts.filter((f) => inWindow(f.createdAt, w.start, w.end) && f.channel !== "unknown").length;
  const thisMonth = now.toISOString().slice(0, 7);
  // KPI drilldowns: the signup cohort for this window, optionally narrowed to a funnel step.
  const cohortHref = (step?: string) => carry("/admin/customers", view, { cohort: "signups", ...(step ? { step } : {}) }, "accounts");
  const acquired = cohort.filter((f) => f.everPaid);
  const spendDrawer = {
    id: "spend", title: `Marketing spend and CAC · last ${range.label}`, description: "Manual spend entries overlapping this period (monthly entries are prorated by day), and the paying customers acquired from this signup cohort.",
    body: <>
      <MetricFormula><p>CAC = spend {usdWhole(spend)} ÷ {fmt(all.paid)} new paying customer{all.paid === 1 ? "" : "s"} = <b>{spend && all.paid ? usdWhole(spend / all.paid) : "–"}</b></p><p className="mt-1 text-xs text-muted">Paying customers = accounts created in this period that have ever paid. Complimentary access is excluded.</p></MetricFormula>
      <MetricRecords title="Spend in this period" rows={costs.map((c) => ({ key: String(c.id), label: isChannel(c.channel) ? CHANNEL_LABEL[c.channel] : c.channel, detail: `${c.period_start.slice(0, 7)}${c.campaign_id ? ` · ${c.campaign_id}` : ""}`, value: usdWhole(Number(c.amount_usd) || 0) }))} empty="No spend entered for this period." more={{ href: href("/admin/marketing", view) + "#spend", label: "Add or edit spend" }} />
      <MetricRecords title={`Acquired customers (${acquired.length})`} rows={acquired.slice(0, 12).map((f) => ({ key: f.id, label: f.business ?? f.email ?? "Account", detail: CHANNEL_LABEL[f.channel], href: `/admin/customers/${f.id}${view.includeTest ? "?data=all" : ""}` }))} empty="No paying customers from this signup cohort yet." />
    </>,
  };
  const recentCosts = [...snap.costs].sort((a, b) => b.period_start.localeCompare(a.period_start) || b.id - a.id).slice(0, 12);

  return (
    <div className="space-y-6">
      <PageHead kicker={`Marketing · signups in the last ${range.label}`} title="Which marketing creates paying contractors"
        intro="First-touch attribution from Built2Bid's own signup records. Website traffic comes from GA4 only when it is connected; nothing here is estimated."
        right={<div className="flex flex-wrap items-center gap-2"><Link href="/admin/marketing/journey" data-testid="journey-link" className="cc-mono rounded-md border border-[var(--cc-line)] px-2.5 py-1.5 text-xs text-[var(--cc-blue)] hover:border-[var(--cc-blue)]">Customer journey →</Link><Link href="/admin/marketing/facebook-trial" className="cc-mono rounded-md border border-[var(--cc-line)] px-2.5 py-1.5 text-xs text-[var(--cc-blue)] hover:border-[var(--cc-blue)]">Facebook BID trial →</Link><Link href="/admin/marketing/radar" data-testid="radar-link" className="cc-mono rounded-md border border-[var(--cc-green)] px-2.5 py-1.5 text-xs text-[var(--cc-green)] hover:bg-[rgb(61_255_168/0.08)]">Opportunity Radar →</Link><RangeControl view={view} path="/admin/marketing" /></div>} />
      <ScopeNote sc={sc} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Website sessions" value={ga ? fmt(ga.sessions) : "Not connected"} na={!ga} href={ga ? href("/admin/marketing", view) + "#traffic" : "/admin/operations#integrations"} action={ga ? "Sessions by channel" : "Connect GA4"} tone="blue" def={tip("visitor_signup")} sub={ga ? `${fmt(ga.users)} users (GA4)` : "Connect GA4 reporting (see Operations)"} />
        <Kpi label="New signups" value={all.cohort} href={cohortHref()} action="View this signup cohort" def={tip("registered")} sub={ga ? <>Visitor → signup <Pct r={ratio(all.cohort, ga.sessions)} /></> : "Genuine accounts created"} />
        <Kpi label="Started a bid" value={all.firstBid} href={cohortHref("first_bid")} action="View who started a bid" tone="blue" def={tip("first_bid")} sub={<Pct r={all.steps[1].ofPrev} />} />
        <Kpi label="Activated (finalized a bid)" value={all.finalized} href={cohortHref("finalized")} action="View activated accounts" def={tip("signup_activation")} sub={<Pct r={all.steps[2].ofCohort} />} />
        <Kpi label="7-day activation (new)" value={snap.meaningful === null ? "Needs SQL" : all.activated7d} href={cohortHref("activated7d")} action="View 7-day activations" na={snap.meaningful === null} tone="blue" def={tip("activation_7d")}
          sub={snap.meaningful === null ? "Apply migration 20261117001000" : all.matured ? <>Matured cohort <Pct r={ratio(all.activated7dMatured, all.matured)} /></> : "No account is 7+ days old yet"} />
        <Kpi label="New paying" value={all.paid} href={cohortHref("paid")} action="View paid conversions" tone="violet" def={tip("signup_paid")} sub={<Pct r={all.steps[3].ofCohort} />} />
        <Kpi label="Spend entered (manual)" value={spend ? usdWhole(spend) : "None entered"} drawer={spendDrawer} action="Spend ledger and CAC" na={!spend} tone="amber" def={tip("cac")} sub={spend && all.paid ? `CAC ${usdWhole(spend / all.paid)}${payback != null ? ` · payback ${payback.toFixed(1)} mo` : ""}` : spend ? "No paying customers yet in this cohort" : "Add spend below to see CAC"} />
      </div>

      <SectionTitle id="channels" kicker="Attribution · first touch" title="Channel performance" right={<span className="cc-mono text-[11px] text-muted">{fmt(known)} of {fmt(all.cohort)} signups have a recorded source</span>} />
      <Panel>
        {channels.length === 0 ? <p className="text-sm text-ink-soft">No signups or spend in this window.</p> : (
          <Table head={["Channel", "Signups", "Started bid", "7-day activated", "Finalized", "Paying", "MRR now", "Spend", "CAC", "Payback", "Cost / finalized"]} align={["l", "r", "r", "r", "r", "r", "r", "r", "r", "r", "r"]} minWidth={1000}>
            {channels.map((c) => (
              <tr key={c.key}>
                <td className="font-sans"><Link href={href("/admin/marketing", view, { channel: c.key })} className="font-semibold text-white underline-offset-2 hover:underline">{c.label}</Link></td>
                <td className="text-right text-white">{fmt(c.signups)}</td><td className="text-right">{fmt(c.firstBid)}</td><td className="text-right">{fmt(c.activated7d)}</td><td className="text-right">{fmt(c.activated)}</td><td className="text-right">{fmt(c.paid)}</td>
                <td className="text-right">{c.mrrCents ? usd(c.mrrCents) : "–"}</td>
                <td className="text-right">{money(c.spendUsd) ?? <span className="text-muted">–</span>}</td>
                <td className="text-right">{money(c.cacUsd) ?? <span className="text-muted">{c.spendUsd ? "no paid yet" : "–"}</span>}</td>
                <td className="text-right">{c.paybackMonths != null ? `${c.paybackMonths.toFixed(1)} mo` : <span className="text-muted">–</span>}</td>
                <td className="text-right">{money(c.costPerActivationUsd) ?? <span className="text-muted">–</span>}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-muted">Revenue model: first touch, current list-price MRR of accounts from that channel. Spend is what you entered below (no ad-platform API is connected). Payback = CAC ÷ average current MRR per paying account (list price; complimentary access is never revenue). Click a channel to filter the funnel.</p>
        <details className="mt-3 text-xs text-ink-soft"><summary className="cursor-pointer text-[var(--cc-blue)]">How each signup is assigned a channel</summary>
          <ul className="mt-2 space-y-1">{CHANNELS.map((c) => <li key={c.key}><span className="font-semibold text-white">{c.label}:</span> {c.rule}</li>)}</ul>
          {!snap.attributionV2 && <p className="mt-2 text-[var(--cc-amber)]">Referrer, ad click id and device capture start after migration 20261115002000 is applied. Until then, signups without UTM tags are Unknown.</p>}
        </details>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel kicker="Funnel drilldown" title={anyFilter ? "Filtered funnel" : "Signup funnel"} className="lg:col-span-3">
          <form method="get" action="/admin/marketing" className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {view.range.key !== "30d" && <input type="hidden" name="range" value={view.range.key} />}
            {view.includeTest && <input type="hidden" name="data" value="all" />}
            <label className="text-xs"><span className="cc-kicker mb-1 block">Channel</span><select name="channel" defaultValue={fChannel} className="field field-sm"><option value="">All</option>{CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Campaign</span><select name="campaign" defaultValue={fCampaign} className="field field-sm"><option value="">All</option>{campaigns.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Landing page</span><select name="landing" defaultValue={fLanding} className="field field-sm"><option value="">All</option>{landings.slice(0, 200).map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Device</span><select name="device" defaultValue={fDevice} className="field field-sm"><option value="">All</option><option value="mobile">Mobile</option><option value="tablet">Tablet</option><option value="desktop">Desktop</option></select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Creative</span><select name="creative" defaultValue={fCreative} className="field field-sm"><option value="">All</option>{creatives.slice(0, 200).map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Trade</span><select name="trade" defaultValue={fTrade} className="field field-sm"><option value="">All</option>{trades.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Plan now</span><select name="plan" defaultValue={fPlan} className="field field-sm"><option value="">All</option><option value="free">Free</option><option value="paid">Paid</option><option value="complimentary">Complimentary</option></select></label>
            <div className="flex items-end gap-2"><button type="submit" className="cc-mono rounded-md bg-[var(--cc-green)] px-3 py-1.5 text-sm font-bold text-[#03140c]">Apply</button>{anyFilter && <Link href={href("/admin/marketing", view, { channel: undefined, campaign: undefined, landing: undefined, device: undefined, creative: undefined, trade: undefined, plan: undefined })} className="cc-mono px-1 py-1.5 text-xs text-ink-soft underline">Reset</Link>}</div>
          </form>
          <FunnelSteps steps={fun.steps.map((s, i) => ({ label: s.label, n: s.n, ofPrev: i ? s.ofPrev : undefined }))} />
          <p className="mt-3 text-xs text-muted">Denominators: each step is a share of the step before, for the same accounts. {fun.cohort < 10 ? "Fewer than 10 accounts match, so read the percentages as directional only." : ""} Device and landing page are recorded from the first visit after migration 20261115002000.</p>
        </Panel>

        <Panel kicker="Recommended actions" title={ins.items.length ? `${ins.items.length} evidence-based signal${ins.items.length === 1 ? "" : "s"}` : "Not enough data for a recommendation yet"} className="lg:col-span-2">
          {ins.items.length > 0 && (
            <ul className="space-y-2.5">
              {ins.items.map((i) => (
                <li key={i.title} className="rounded-lg border border-[var(--cc-line)] p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-white"><Chip tone={i.tone}>{i.tone === "green" ? "Opportunity" : "Investigate"}</Chip>{i.title}</p>
                  <p className="mt-1 text-xs text-ink-soft">{i.evidence}</p>
                  <p className="mt-0.5 text-[11px] text-muted">Rule: {i.rule}</p>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-3 text-xs text-muted" open={!ins.items.length}><summary className="cursor-pointer text-[var(--cc-blue)]">Rules checked (fixed thresholds, no AI)</summary><ul className="mt-2 list-disc space-y-1 pl-4">{ins.checked.map((c) => <li key={c}>{c}</li>)}</ul></details>
        </Panel>
      </div>

      <SectionTitle id="campaigns" kicker="Campaigns" title="Campaign performance" />
      <Panel>
        {camp.length === 0 ? <p className="text-sm text-ink-soft">No campaign-tagged signups or campaign spend in this window. Tag ad and outreach links with <code className="text-white">utm_campaign</code> (or Instantly&apos;s <code className="text-white">?ic=</code>) and they will appear here.</p> : (
          <Table head={["Campaign", "Channel", "Spend", "Signups", "Activated", "Paying", "CAC", "Signal"]} align={["l", "l", "r", "r", "r", "r", "r", "l"]} minWidth={820}>
            {camp.map((c) => (
              <tr key={c.name}>
                <td className="max-w-[16rem] truncate font-sans"><Link href={href("/admin/marketing", view, { campaign: c.name })} className="text-white hover:underline">{c.name}</Link></td>
                <td className="font-sans text-ink-soft">{CHANNEL_LABEL[c.channel] ?? c.channel}</td>
                <td className="text-right">{money(c.spendUsd) ?? <span className="text-muted">Not entered</span>}</td>
                <td className="text-right text-white">{fmt(c.signups)}</td><td className="text-right">{fmt(c.activated)}</td><td className="text-right">{fmt(c.paid)}</td>
                <td className="text-right">{money(c.cacUsd) ?? <span className="text-muted">–</span>}</td>
                <td className="font-sans text-xs"><Chip tone={c.signal.startsWith("Spend, no") ? "amber" : c.signal.startsWith("Signups") ? "green" : "muted"}>{c.signal}</Chip></td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-muted">Ad clicks are never counted as customers. Live campaign status needs an ad-platform connection, which is not set up.</p>
      </Panel>

      <SectionTitle id="trades" kicker="Trades · signup cohort" title="Trade-level conversion" />
      <Panel>
        {tradeRows.length === 0 ? <p className="text-sm text-ink-soft">No signups in this window.</p> : (
          <Table head={["Trade", "Signups", "Started bid", "7-day activated", "Paying", "7-day activation"]} align={["l", "r", "r", "r", "r", "r"]} minWidth={620}>
            {tradeRows.slice(0, 20).map((r) => (
              <tr key={r.trade}>
                <td className="font-sans">{r.trade === "(no trade yet)" ? <span className="text-muted">{r.trade}</span> : <Link href={href("/admin/marketing", view, { trade: r.trade })} className="text-white hover:underline">{r.trade}</Link>}</td>
                <td className="text-right text-white">{fmt(r.signups)}</td><td className="text-right">{fmt(r.firstBid)}</td><td className="text-right">{fmt(r.activated7d)}</td><td className="text-right">{fmt(r.paid)}</td>
                <td className="text-right"><Pct r={r.activation} /></td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-muted">Trade = the first bid&apos;s trade, else the trade landing page the account arrived on. Small numbers are directional only.</p>
      </Panel>

      <SectionTitle id="creatives" kicker="Ads · utm_content" title="Creative performance" />
      <Panel>
        {creativeRows.length === 0 ? <p className="text-sm text-ink-soft">No signups with a creative tag in this window. Ad links carry the creative in <code className="text-white">utm_content</code> (naming standard in docs/growth/ADS.md), and each creative appears here with what its signups went on to do.</p> : (
          <Table head={["Creative", "Channel", "Campaign", "Signups", "Started bid", "7-day activated", "Finalized", "Paying", "MRR now", "Activation"]} align={["l", "l", "l", "r", "r", "r", "r", "r", "r", "r"]} minWidth={980}>
            {creativeRows.slice(0, 30).map((c) => (
              <tr key={c.creative}>
                <td className="max-w-[14rem] truncate font-sans"><Link href={href("/admin/marketing", view, { creative: c.creative })} className="text-white hover:underline">{c.creative}</Link></td>
                <td className="font-sans text-ink-soft">{CHANNEL_LABEL[c.channel] ?? c.channel}</td>
                <td className="max-w-[10rem] truncate font-sans text-ink-soft">{c.campaign ?? "–"}</td>
                <td className="text-right text-white">{fmt(c.signups)}</td><td className="text-right">{fmt(c.firstBid)}</td><td className="text-right">{fmt(c.activated7d)}</td><td className="text-right">{fmt(c.finalized)}</td><td className="text-right">{fmt(c.paid)}</td>
                <td className="text-right">{c.mrrCents ? usd(c.mrrCents) : "–"}</td>
                <td className="text-right"><Pct r={c.activation} /></td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-muted">Sorted by paying, then 7-day activation, so a creative that brings contractors who actually bid beats one that only brings clicks. Spend is entered per campaign, so CAC per creative isn&apos;t shown. Small numbers are directional only.</p>
      </Panel>

      <SectionTitle id="creators" kicker="Creator Partners · all time" title="Creator Partner results" />
      <Panel>
        {creatorRows.length === 0 ? <p className="text-sm text-ink-soft">No Creator Partner signups yet. Give each creator a link tagged <code className="text-white">utm_medium=creator&amp;utm_campaign=&lt;creator-name&gt;</code> (see docs/growth/ADS.md) and their signups appear here.</p> : (
          <Table head={["Creator", "Signups", "Started bid", "7-day activated", "Paid (Stripe)", "Paying now", "MRR now", "Complimentary (not paid)"]} align={["l", "r", "r", "r", "r", "r", "r", "r"]} minWidth={860}>
            {creatorRows.map((c) => (
              <tr key={c.creator}>
                <td className="font-sans text-white">{c.creator}</td>
                <td className="text-right text-white">{fmt(c.signups)}</td><td className="text-right">{fmt(c.firstBid)}</td><td className="text-right">{fmt(c.activated7d)}</td>
                <td className="text-right">{fmt(c.paid)}</td><td className="text-right">{fmt(c.payingNow)}</td>
                <td className="text-right">{c.mrrCents ? usd(c.mrrCents) : "–"}</td>
                <td className="text-right text-ink-soft">{fmt(c.complimentary)}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-muted">Paid means a real Stripe subscription. Complimentary access (creators, gifts, comps) is counted separately and never as paid or revenue. Counts only: no contractor names, bids or prices are shown to or shared with creators.</p>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel kicker="Landing pages · first touch" title="Which pages bring valuable users" className="lg:col-span-3">
          {landingRows.length === 0 ? <p className="text-sm text-ink-soft">No signups in this window.</p> : (
            <Table head={["Landing page", "Signups", "First bid", "Activated", "Paying", "Activation"]} align={["l", "r", "r", "r", "r", "r"]} minWidth={560}>
              {landingRows.slice(0, 15).map((l) => (
                <tr key={l.path}>
                  <td className="max-w-[16rem] truncate font-sans">{l.path === "(not recorded)" ? <span className="text-muted">(not recorded)</span> : <Link href={href("/admin/marketing", view, { landing: l.path })} className="text-white hover:underline">{l.path}</Link>}</td>
                  <td className="text-right text-white">{fmt(l.signups)}</td><td className="text-right">{fmt(l.firstBid)}</td><td className="text-right">{fmt(l.activated)}</td><td className="text-right">{fmt(l.paid)}</td>
                  <td className="text-right"><Pct r={l.activation} /></td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-muted">The first Built2Bid page each account visited (first-party cookie). Page traffic needs GA4 reporting: {ga ? "connected" : "not connected"}. Sorted by paying, then activated, so valuable pages rise above busy ones.</p>
        </Panel>
        <Panel kicker="Outbound" title="Email outreach" className="lg:col-span-2">
          <dl className="text-sm">
            {[["Signups from outreach", outreach?.signups ?? 0], ["First bids", outreach?.firstBid ?? 0], ["Activated", outreach?.activated ?? 0], ["Paying", outreach?.paid ?? 0]].map(([k, v]) => <div key={k as string} className="flex justify-between border-t border-[var(--cc-line)] py-1.5 first:border-t-0"><dt className="text-ink-soft">{k}</dt><dd className="cc-mono text-white">{fmt(v as number)}</dd></div>)}
          </dl>
          <p className="mt-3 text-xs text-muted">Accounts whose first visit carried email-outreach tags (e.g. utm_medium=email or an Instantly campaign id). Contacts, replies and positive replies live in the <Link href="/admin/sales" className="underline">Outreach funnel</Link> when Instantly sync is enabled. No Apollo account was found for Built2Bid. Opens are not used as a conversion signal. Nothing here sends email.</p>
        </Panel>
      </div>

      <Panel kicker="Diagnostics" title="Marketing to purchase, step by step">
        <Table head={["Step", "Count", "Source"]} align={["l", "r", "l"]} minWidth={520}>
          {([
            ["Accounts created (signup)", cohort.length, "Auth record"],
            ["Email verified", cohort.filter((f) => f.confirmed).length, "Auth record (verification timestamp)"],
            ["Verification requested but not completed", cohort.filter((f) => !f.confirmed).length, "Auth record (inferred: no verification yet)"],
            ["Verification failed", null, "Not instrumented (Supabase Auth logs only)"],
            ["First bid started", cohort.filter((f) => f.firstEstimateAt).length, "Product record"],
            ["First bid finalized", cohort.filter((f) => f.firstFinalizedAt).length, "Product record"],
            ["Checkout started", ev("checkout_started"), "Product event"],
            ["Checkout abandoned or canceled", sessions ? sessions.expired : null, sessions ? "Stripe Checkout sessions (whole account)" : "Stripe not reachable"],
            ["Subscription confirmed", ev("subscribed"), "Product event (Stripe webhook)"],
          ] as [string, number | null, string][]).map(([k, v, src]) => (
            <tr key={k}><td className="font-sans text-white">{k}</td><td className="text-right">{v == null ? <span className="text-muted">–</span> : fmt(v)}</td><td className="font-sans text-xs text-ink-soft">{src}</td></tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-muted">Signup and product steps are this window&apos;s signup cohort; checkout rows are events in the window, a different population, so they are not turned into one percentage. Median signup → first bid: {timing.medianHoursToFirstBid == null ? "–" : timing.medianHoursToFirstBid < 1 ? `${Math.round(timing.medianHoursToFirstBid * 60)} min` : `${timing.medianHoursToFirstBid.toFixed(1)} h`}. No sign-in codes, tokens or payment details are logged.</p>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel kicker="Organic search" title="Search Console">
          {gsc ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div><p className="cc-kicker">Clicks</p><p className="cc-mono text-2xl font-bold text-white">{fmt(gsc.clicks)}</p></div>
                <div><p className="cc-kicker">Impressions</p><p className="cc-mono text-2xl font-bold text-white">{fmt(gsc.impressions)}</p></div>
                <div><p className="cc-kicker">CTR</p><p className="cc-mono text-2xl font-bold text-white">{(gsc.ctr * 100).toFixed(1)}%</p></div>
              </div>
              <Table head={["Top pages", "Clicks", "Impr."]} align={["l", "r", "r"]} minWidth={360}>{gsc.pages.map((p) => <tr key={p.page}><td className="max-w-[16rem] truncate font-sans">{p.page}</td><td className="text-right">{fmt(p.clicks)}</td><td className="text-right">{fmt(p.impressions)}</td></tr>)}</Table>
              <Table head={["Top queries", "Clicks", "Impr."]} align={["l", "r", "r"]} minWidth={360}>{gsc.queries.map((p) => <tr key={p.query}><td className="max-w-[16rem] truncate font-sans">{p.query}</td><td className="text-right">{fmt(p.clicks)}</td><td className="text-right">{fmt(p.impressions)}</td></tr>)}</Table>
              <p className="text-xs text-muted">Impressions are times Built2Bid appeared in Google results, not visitors. Data lags about two days. Organic signups: {fmt(channels.find((c) => c.key === "organic_search")?.signups ?? 0)}.</p>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-ink-soft">
              <NotConnected />
              <p>Search Console is verified for built2bid.org, but this dashboard cannot read it yet. To connect (free, read-only): create a Google Cloud service account, add its email as a <span className="text-white">Restricted</span> user in Search Console, then set <code className="text-white">SEARCH_CONSOLE_SITE</code> (sc-domain:built2bid.org) and <code className="text-white">GOOGLE_SERVICE_ACCOUNT_JSON</code> in Netlify. Steps: docs/admin/INTEGRATIONS.md.</p>
              <p className="text-xs text-muted">Organic Search signups below still come from Built2Bid&apos;s own referrer records: {fmt(channels.find((c) => c.key === "organic_search")?.signups ?? 0)} in this window.</p>
            </div>
          )}
        </Panel>

        <Panel id="traffic" kicker="Traffic" title="GA4 sessions by channel">
          {ga ? (
            <>
              <Table head={["GA4 channel group", "Sessions"]} align={["l", "r"]} minWidth={300}>{ga.byChannel.map((c) => <tr key={c.channel}><td className="font-sans">{c.channel}</td><td className="text-right">{fmt(c.sessions)}</td></tr>)}</Table>
              <p className="mt-3 text-xs text-muted">GA4&apos;s own channel grouping, shown separately: GA4 counts consented sessions, Built2Bid counts accounts. The two are never added together.</p>
            </>
          ) : (
            <div className="space-y-2 text-sm text-ink-soft">
              <NotConnected />
              <p>The GA4 tag is collecting visits on public pages, but reading reports needs the GA4 Data API: add the same service account as a <span className="text-white">Viewer</span> on the GA4 property and set <code className="text-white">GA4_PROPERTY_ID</code> in Netlify. Until then, session counts and visitor-to-signup conversion stay unavailable here (see them in Google Analytics).</p>
            </div>
          )}
        </Panel>
      </div>

      <SectionTitle id="offers" kicker="Lifecycle · in-app" title="Upgrade offers and cancellation reasons" />
      <div className="grid gap-6 lg:grid-cols-5" data-testid="admin-offers">
        <Panel title="Offers in this range" className="lg:col-span-3">
          {!offerSummary ? <p className="text-sm text-ink-soft">The offer log isn&apos;t set up yet (run the V8 batch 4 SQL). Until then no offers show to customers.</p> : (
            <Table head={["Offer", "Shown", "Clicked", "Dismissed", "Click rate"]} align={["l", "r", "r", "r", "r"]} minWidth={440}>
              {offerSummary.offers.map((o) => (
                <tr key={o.offer}><td className="font-sans">{OFFER_LABEL[o.offer]}</td><td className="text-right">{fmt(o.shown)}</td><td className="text-right">{fmt(o.clicked)}</td><td className="text-right">{fmt(o.dismissed)}</td><td className="text-right">{o.shown ? `${Math.round((o.clicked / o.shown) * 100)}%` : "–"}</td></tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-muted">Caps: one free bid left at most once per 30 days, annual at most once per 90 days, the referral note once per account, nothing new within 24 hours of a dismissal, and no upgrade offers in the first 72 hours or for company members.</p>
        </Panel>
        <Panel title="Why subscribers cancel" className="lg:col-span-2">
          {!offerSummary ? <p className="text-sm text-ink-soft">Not set up yet.</p> : offerSummary.reasons.length === 0 ? <p className="text-sm text-ink-soft">No reasons recorded in this range. The question is optional and never blocks cancelling.</p> : (
            <Table head={["Reason", "Count"]} align={["l", "r"]} minWidth={260}>
              {offerSummary.reasons.map((r) => <tr key={r.code}><td className="font-sans">{r.label}</td><td className="text-right">{fmt(r.count)}</td></tr>)}
            </Table>
          )}
          {offerSummary && offerSummary.skipped > 0 && <p className="mt-2 text-xs text-muted">{fmt(offerSummary.skipped)} went on to Stripe without picking a reason.</p>}
        </Panel>
      </div>

      <SectionTitle id="spend" kicker="Costs" title="Marketing spend (manual)" />
      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Add monthly spend" className="lg:col-span-2">
          {str(sp.spend_error) && <p role="alert" className="mb-3 rounded-md border border-[var(--cc-red)]/50 px-3 py-2 text-xs text-[var(--cc-red)]">{str(sp.spend_error)}</p>}
          {str(sp.spend_saved) && <p role="status" className="mb-3 rounded-md border border-[var(--cc-green)]/50 px-3 py-2 text-xs text-[var(--cc-green)]">Spend saved.</p>}
          <form action={addCost} className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs"><span className="cc-kicker mb-1 block">Month</span><input type="month" name="month" required defaultValue={thisMonth} className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Channel</span><select name="channel" required className="field field-sm">{CHANNELS.filter((c) => c.key !== "unknown" && c.key !== "direct").map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Campaign (optional)</span><input name="campaign" maxLength={128} placeholder="utm_campaign value" className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Amount (USD)</span><input name="amount" type="number" min="0" step="0.01" required className="field field-sm" /></label>
            <label className="text-xs sm:col-span-2"><span className="cc-kicker mb-1 block">Note (optional)</span><input name="note" maxLength={500} className="field field-sm" /></label>
            <div className="sm:col-span-2"><button type="submit" className="cc-mono rounded-md bg-[var(--cc-green)] px-3 py-1.5 text-sm font-bold text-[#03140c]">Save spend</button></div>
          </form>
          <p className="mt-3 text-xs text-muted">Copy the monthly total from Google Ads, Meta or YouTube. Saving records a figure only; it never changes or spends anything in an ad account. Every entry is in the audit log.</p>
        </Panel>
        <Panel title="Recent entries" className="lg:col-span-3">
          {recentCosts.length === 0 ? <p className="text-sm text-ink-soft">No spend entered yet, so CAC and cost per activation are not shown.</p> : (
            <Table head={["Month", "Channel", "Campaign", "Amount", ""]} align={["l", "l", "l", "r", "r"]} minWidth={480}>
              {recentCosts.map((c) => (
                <tr key={c.id}>
                  <td>{c.period_start.slice(0, 7)}</td><td className="font-sans">{isChannel(c.channel) ? CHANNEL_LABEL[c.channel] : c.channel}</td><td className="max-w-[10rem] truncate">{c.campaign_id ?? "–"}</td><td className="text-right text-white">{usdWhole(Number(c.amount_usd) || 0)}</td>
                  <td className="text-right"><form action={deleteCost}><input type="hidden" name="id" value={c.id} /><button type="submit" className="text-xs text-ink-soft underline hover:text-[var(--cc-red)]">Delete</button></form></td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </div>
  );
}
