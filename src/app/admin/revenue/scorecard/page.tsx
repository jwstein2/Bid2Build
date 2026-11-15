import Link from "next/link";
import type { ReactNode } from "react";
import { Chip, Fresh, PageHead, Panel, PanelLink, Pct, Row, fmt, usd, type Tone } from "@/components/admin/cc";
import { RangeControl, ReportUnavailable, ScopeNote, SectionTitle } from "@/components/admin/report";
import { costTotals, costsForWindow, serviceViews } from "@/lib/admin/costs";
import { CONFIDENCE_LABEL, scorecard, type Confidence } from "@/lib/admin/finance";
import { envPresent, stripeMoney } from "@/lib/admin/integrations";
import { loadReport } from "@/lib/admin/load";
import { channelReport, prorateCosts, usageModel, windowOf } from "@/lib/admin/model";
import { href, str } from "@/lib/admin/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Business Scorecard" };

const CONF_TONE: Record<Confidence, Tone> = { verified: "green", entered: "blue", estimated: "violet", insufficient: "amber" };
const signed = (c: number) => `${c < 0 ? "−" : ""}${usd(Math.abs(c))}`;

function Metric({ n, title, value, sub, conf, formula, source, children, id }: { n: number; title: string; value: ReactNode; sub?: ReactNode; conf: Confidence; formula: string; source: string; children?: ReactNode; id: string }) {
  return (
    <section id={id} className="cc-panel cc-rise min-w-0 scroll-mt-24 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="cc-kicker">{n} · {title}</p>
        <Chip tone={CONF_TONE[conf]}>{CONFIDENCE_LABEL[conf]}</Chip>
      </div>
      <p className="cc-mono mt-2 text-3xl font-bold leading-none text-white">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-muted">{sub}</p>}
      <div className="mt-4">{children}</div>
      <p className="mt-3 border-t border-[var(--cc-line)] pt-2 text-[11px] text-muted"><span className="text-ink-soft">Formula:</span> {formula} <span className="text-ink-soft">Source:</span> {source}</p>
    </section>
  );
}

export default async function Scorecard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { r, error, view } = await loadReport(sp, { costs: true });
  if (!r || !r.costs) return <ReportUnavailable error={error} />;
  const { facts, sc, snap, now, costs } = r;
  const range = view.range;
  const w = windowOf(range, now);
  const excluded = new Set(view.includeTest ? [] : snap.subscriptions.filter((s) => sc.classes.get(s.user_id)?.cls !== "genuine" && s.stripe_customer_id).map((s) => s.stripe_customer_id!));
  const stripe = await stripeMoney(range.days, excluded);
  const views = serviceViews(costs.services, costs.expenses, envPresent, now);
  const usage = usageModel(sc, facts, range, now);
  const aiRows = (costs.ai ?? []).filter((a) => Date.parse(a.created_at) >= w.start);
  const aiLedgered = costs.expenses.some((e) => e.service_key === "anthropic-api" && Date.parse(`${e.incurred_on}T00:00:00Z`) >= w.start);
  const num = (k: string) => { const v = Number(str(sp[k])); return str(sp[k]) && Number.isFinite(v) ? v : undefined; };
  const s = scorecard({
    facts, range, now, stripe, costsByCategory: costsForWindow(views, costs.expenses, w.start, w.end), marketingCosts: prorateCosts(snap.costs, w.start, w.end),
    aiMeasuredCents: costs.ai ? Math.round(aiRows.reduce((n, a) => n + (Number(a.cost_usd) || 0), 0) * 100) : null, aiLedgered,
    missingCosts: costTotals(views, costs.expenses, now).missing.map((m) => m.name),
    activeBusinesses30d: usage.mab, finalizedInWindow: usage.finalized.current, signedInWindow: usage.signed.current,
    multiples: { low: num("low"), base: num("base"), high: num("high"), profit: num("pm") },
  });
  const channels = channelReport(facts, prorateCosts(snap.costs, w.start, w.end), w.start, w.end).filter((c) => c.spendUsd != null);
  const nowMs = now.getTime();

  return (
    <div className="space-y-6">
      <PageHead kicker={`Revenue · Business Scorecard · ${range.label}`} title="Five numbers that run the business"
        intro="Revenue, profit, customer acquisition cost, churn and enterprise value: the five-metric framework you chose (popularized by Alex Hormozi; other five-number sets exist). Each shows its formula, source and how much to trust it."
        right={<div className="flex flex-wrap items-center gap-2"><RangeControl view={view} path="/admin/revenue/scorecard" /><PanelLink href={href("/admin/revenue", view)}>Revenue</PanelLink></div>} />
      <ScopeNote sc={sc} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Metric id="revenue" n={1} title="Revenue" conf={s.revenue.confidence}
          value={s.revenue.net != null ? usd(s.revenue.net) : <span className="text-xl text-muted">Stripe not reachable</span>}
          sub={<>Net cash received in {range.label} · <Fresh at={s.revenue.fetchedAt} state={stripe ? "live" : "error"} now={nowMs} /></>}
          formula="Paid invoices − refunds (cash). MRR = list price of paying subscriptions; ARR = MRR × 12." source="Stripe (read-only) for cash; subscription snapshot for MRR.">
          <dl>
            <Row k="Gross receipts (paid invoices)">{s.revenue.cashGross != null ? usd(s.revenue.cashGross) : "–"}</Row>
            <Row k="Refunds (whole Stripe account)">{s.revenue.refunds != null ? `−${usd(s.revenue.refunds)}` : "–"}</Row>
            <Row k="MRR now (list price, run rate)">{usd(s.revenue.mrrCents)}</Row>
            <Row k="ARR run rate">{usd(s.revenue.arrCents)}</Row>
            <Row k={`MRR growth vs ${range.label} ago`}>{s.revenue.mrrStartCents ? `${s.revenue.growth.change >= 0 ? "+" : "−"}${usd(Math.abs(s.revenue.growth.change))}${s.revenue.growth.pctChange != null ? ` (${s.revenue.growth.pctChange}%)` : ""}` : s.revenue.mrrCents ? "New (no MRR at start)" : "–"}</Row>
          </dl>
          <p className="mt-2 text-xs text-muted">Cash received, recurring run rate and recognized revenue are different: an annual plan pays $149 once, counts $12.42/month in MRR, and is recognized monthly in accounting. Complimentary access is never revenue.</p>
        </Metric>

        <Metric id="profit" n={2} title="Profit (provisional)" conf={s.profit.confidence}
          value={s.profit.operatingCents != null ? signed(s.profit.operatingCents) : "–"}
          sub={<>Estimated operating profit · {s.profit.marginPct != null ? `${s.profit.marginPct}% margin` : "no revenue yet"} · revenue basis: {s.profit.revenueBasis === "stripe_net" ? "Stripe net receipts" : "list-price MRR (Stripe not reachable)"}</>}
          formula="Revenue − (infrastructure + AI + software + advertising + marketing tools + Stripe fees + other)." source="Stripe, Tech Stack & Costs (allocated), Marketing spend, AI usage log.">
          <dl>
            <Row k="Revenue">{usd(s.profit.revenueCents ?? 0)}</Row>
            {s.profit.lines.map((l) => <Row key={l.label} k={<span title={l.source}>{l.label}</span>}>{l.cents == null ? <span className="text-[var(--cc-amber)]">Unknown</span> : l.cents ? `−${usd(l.cents)}` : usd(0)}</Row>)}
          </dl>
          <p className={`mt-2 text-xs ${s.profit.missing.length ? "text-[var(--cc-amber)]" : "text-muted"}`}>{s.profit.missing.length ? `Missing costs: ${s.profit.missing.join(", ")}. This is not accounting profit; add them on ` : "Owner-entered costs, not reconciled accounting. Manage costs on "}<Link href="/admin/costs" className="underline">Tech Stack &amp; Costs</Link>.</p>
        </Metric>

        <Metric id="cac" n={3} title="Customer acquisition cost" conf={s.cac.confidence}
          value={s.cac.blendedCents != null ? usd(s.cac.blendedCents) : <span className="text-xl text-muted">{s.cac.newPaying === 0 ? "No new paying customers" : "No spend entered"}</span>}
          sub={<>Blended CAC · {fmt(s.cac.newPaying)} new paying in {range.label}{s.cac.small ? " · small sample" : ""}</>}
          formula="Acquisition spend in the window ÷ new paying customers in the same window." source="Marketing spend ledger (prorated by month) + marketing/prospecting tools (allocated).">
          <dl>
            <Row k="Advertising">{usd(s.cac.adSpendCents)}</Row>
            <Row k="Marketing & prospecting tools">{usd(s.cac.toolsCents)}</Row>
            <Row k="Cost per activated business">{s.cac.costPerActivationCents != null ? `${usd(s.cac.costPerActivationCents)} (${fmt(s.cac.activated)} activated)` : "–"}</Row>
          </dl>
          {channels.length > 0 && (
            <div className="mt-3 space-y-1 text-xs">
              <p className="cc-kicker !text-[10px]">Channel CAC (first touch)</p>
              {channels.map((c) => <p key={c.key} className="flex justify-between gap-2"><span className="text-ink-soft">{c.label}</span><span className="cc-mono text-white">{c.cacUsd != null ? usd(Math.round(c.cacUsd * 100)) : `${usd(Math.round((c.spendUsd ?? 0) * 100))} spent, 0 paid`}</span></p>)}
              <Link href={href("/admin/marketing", view)} className="text-[var(--cc-blue)] underline">Campaign CAC on Marketing</Link>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">Sales labor is not included (not measured). First-touch attribution shows where customers came from, not that the spend caused them.</p>
        </Metric>

        <Metric id="churn" n={4} title="Churn" conf={s.churn.confidence}
          value={s.churn.customer.pct != null ? `${s.churn.customer.pct}%` : <span className="text-xl text-muted">No paying base at start</span>}
          sub={<>Customer churn in {range.label}: {fmt(s.churn.ended)} of {fmt(s.churn.startBase)} paying at the start{s.churn.customer.small ? " · small sample" : ""}</>}
          formula="Paid subscriptions that ended in the window ÷ paying subscriptions at the window start. Revenue churn = lost MRR ÷ MRR at start." source="Subscription snapshot (Stripe webhooks).">
          <dl>
            <Row k="Revenue churn">{s.churn.revenuePct != null ? `${s.churn.revenuePct}% (${usd(s.churn.lostMrrCents)} of ${usd(s.churn.mrrStartCents)})` : "–"}</Row>
            <Row k="Completed cancellations">{fmt(s.churn.ended)}</Row>
            <Row k="Scheduled to cancel (still paying)">{fmt(s.churn.scheduled)}</Row>
            <Row k="Paid retention (ever paid → paying now)"><Pct r={s.churn.retention} /></Row>
          </dl>
          <p className="mt-2 text-xs text-muted">Free-account inactivity and expired complimentary access are never churn.</p>
        </Metric>
      </div>

      <section id="value" className="cc-panel cc-rise min-w-0 scroll-mt-24 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="cc-kicker">5 · Enterprise value (illustrative)</p>
          <Chip tone={s.ev.sufficient ? "violet" : "amber"}>{s.ev.sufficient ? "Estimated" : "Insufficient history"}</Chip>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(["low", "base", "high"] as const).map((k) => (
            <div key={k} className="rounded-lg border border-[var(--cc-line)] bg-[rgb(5_9_12/0.5)] p-3">
              <p className="cc-kicker !text-[10px]">{k === "low" ? "Conservative" : k === "base" ? "Base" : "Optimistic"} · {s.ev.multiples[k]}× ARR</p>
              <p className="cc-mono mt-1 text-2xl font-bold text-white">≈ {usd(s.ev.values[k])}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">ARR run rate {usd(s.ev.arrCents)}. {s.ev.reason} {s.ev.profitBased ? `Profit-based: ${usd(s.ev.profitBased.annualProfitCents)} annualized × ${s.ev.profitBased.multiple} ≈ ${usd(s.ev.profitBased.value)}.` : "A profit-based method needs 12 months of revenue and complete costs."}</p>
        <form className="mt-3 flex flex-wrap items-end gap-2">
          {range.key !== "30d" && <input type="hidden" name="range" value={range.key} />}
          {view.includeTest && <input type="hidden" name="data" value="all" />}
          {(["low", "base", "high", "pm"] as const).map((k) => <label key={k} className="text-xs"><span className="cc-kicker mb-1 block">{k === "pm" ? "Profit multiple" : `${k} × ARR`}</span><input type="number" name={k} min={0} max={50} step={0.5} defaultValue={k === "pm" ? (num("pm") ?? 3) : s.ev.multiples[k]} className="field field-sm w-24" /></label>)}
          <button className="cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-xs text-white hover:border-[var(--cc-blue)]">Recalculate</button>
        </form>
        <p className="mt-3 rounded-md border border-[var(--cc-line)] px-3 py-2 text-xs text-ink-soft">Illustrative only, not a professional appraisal. Multiples are your assumptions, not market quotes or guarantees. Enterprise value is not equity value: debt, cash and deal terms change what an owner would receive. Values are rounded on purpose.</p>
      </section>

      <SectionTitle kicker="Supporting unit economics" title="Secondary metrics" />
      <Panel>
        <dl className="grid gap-x-8 md:grid-cols-2">
          <div>
            <Row k="Revenue per paying account (list MRR)">{s.unit.arpaCents != null ? usd(s.unit.arpaCents) : "–"}</Row>
            <Row k="Gross margin">{s.unit.grossMarginPct != null ? `${s.unit.grossMarginPct}%` : <span className="text-muted">Needs revenue and complete costs</span>}</Row>
            <Row k="Customer lifetime value">{s.unit.ltvCents != null ? usd(s.unit.ltvCents) : <span className="text-muted">Insufficient history</span>}</Row>
            <Row k="LTV ÷ CAC">{s.unit.ltvToCac != null ? `${s.unit.ltvToCac}×` : <span className="text-muted">–</span>}</Row>
            <Row k="CAC payback">{s.unit.paybackMonths != null ? `${s.unit.paybackMonths} months` : <span className="text-muted">–</span>}</Row>
          </div>
          <div>
            <Row k="Infrastructure per active business (30 days)">{s.unit.infraPerActiveCents != null ? usd(s.unit.infraPerActiveCents) : "–"}</Row>
            <Row k={`Infrastructure per finalized bid (${range.label})`}>{s.unit.infraPerFinalizedCents != null ? usd(s.unit.infraPerFinalizedCents) : "–"}</Row>
            <Row k="Total cost per signed proposal">{s.unit.costPerSignedCents != null ? usd(s.unit.costPerSignedCents) : "–"}</Row>
            <Row k="Net revenue retention"><span className="text-muted">Not enough history</span></Row>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted">{s.unit.ltvReason} {s.unit.nrrReason} Infrastructure here means hosting, database, domain, email, monitoring and AI.</p>
      </Panel>
    </div>
  );
}
