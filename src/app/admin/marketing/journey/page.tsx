import Link from "next/link";
import { Chip, FunnelSteps, Kpi, PageHead, Panel, Segmented, Table, fmt, usd } from "@/components/admin/cc";
import { RangeControl, ReportUnavailable, ScopeNote, SectionTitle } from "@/components/admin/report";
import { CHANNEL_LABEL, isChannel } from "@/lib/admin/channels";
import { loadReport } from "@/lib/admin/load";
import { prorateCosts, windowOf } from "@/lib/admin/model";
import { requireAdmin } from "@/lib/admin/server";
import { href, parseView, str } from "@/lib/admin/view";
import { createAdminClient } from "@/lib/supabase/server";
import { breakdown, buildJourneys, cohortRetention, dataQuality, reached, revenueByOwner, STAGES, STAGE_LABEL, unitEconomics, type Dimension, type JAccount, type JourneyInput, type Model } from "@/lib/growth/journey";
import { loadJourneyInput } from "@/lib/growth/journey-server";
import { syntheticJourneyInput } from "@/lib/growth/journey-synthetic";
import { touchesEnabled } from "@/lib/growth/touches";
import { utmIssues } from "@/lib/growth/utm-convention";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer journey" };

const PATH = "/admin/marketing/journey";
const MODELS: { value: Model; label: string }[] = [{ value: "owner", label: "Revenue owner" }, { value: "first", label: "First touch" }, { value: "last", label: "Last touch" }];
const DIMS: { value: Dimension; label: string }[] = [
  { value: "channel", label: "Source" }, { value: "campaign", label: "Campaign" }, { value: "trade", label: "Trade" },
  { value: "landing", label: "Landing page" }, { value: "creative", label: "Creative" }, { value: "segment", label: "Segment" },
];
const OWNER_LABEL: Record<string, string> = { sales_rep: "Sales rep (commission)", affiliate: "Affiliate (commission)", unmatched: "Not matched to an account" };
const label = (k: string) => OWNER_LABEL[k] ?? (isChannel(k) ? CHANNEL_LABEL[k] : k);
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "–");

export default async function Journey({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const synthetic = str(sp.synthetic) === "1";
  const model = (MODELS.find((m) => m.value === str(sp.model))?.value ?? "owner") as Model;
  const dim = (DIMS.find((x) => x.value === str(sp.dim))?.value ?? "channel") as Dimension;

  let input: JourneyInput, now: Date, view = parseView(sp, synthetic ? "12m" : "90d"), scope: React.ReactNode = null;
  let installed = { touches: true, revenue: true, owners: true };
  if (synthetic) {
    await requireAdmin();
    now = new Date();
    input = syntheticJourneyInput(now);
  } else {
    const { r, error } = await loadReport(sp);
    if (!r) return <ReportUnavailable error={error} />;
    view = parseView(sp, "90d");
    now = r.now;
    const leads = new Map(r.snap.leads.filter((l) => l.user_id).map((l) => [l.user_id!, l]));
    const accounts: JAccount[] = r.facts.map((f) => ({ id: f.id, createdAt: f.createdAt, trade: f.trade, segment: f.segment, lead: leads.get(f.id) ?? null }));
    const loaded = await loadJourneyInput(createAdminClient(), accounts);
    input = loaded.input;
    installed = loaded.installed;
    scope = <ScopeNote sc={r.sc} />;
  }
  const w = windowOf(view.range, now);
  const js = buildJourneys(input, now);
  const cohort = js.filter((j) => { const t = Date.parse(j.signupAt); return t >= w.start && t <= w.end; });
  const rows = breakdown(js, dim, model, w.start, w.end);
  const rev = revenueByOwner(input, js, w.start, w.end);
  const units = unitEconomics(js, prorateCosts(input.costs as never, w.start, w.end) as never, w.start, w.end);
  const retention = cohortRetention(js, now, 6);
  const since30 = now.getTime() - 30 * 86_400_000;
  const utmBad = input.touches.filter((t) => Date.parse(t.touch_at) >= since30 && utmIssues({ source: t.utm_source, medium: t.utm_medium, campaign: t.utm_campaign, content: t.utm_content, term: t.utm_term }).length > 0).length;
  const quality = dataQuality(input, js, now, { touchesOn: synthetic || touchesEnabled(), utmIssueCount: utmBad });
  const count = (s: (typeof STAGES)[number]) => cohort.filter((j) => reached(j, s)).length;
  const refunds = input.revenue.filter((r) => { const t = Date.parse(r.paid_at); return t >= w.start && t <= w.end; }).reduce((n, r) => n + r.gross_cents - r.net_cents, 0);
  const link = (patch: Record<string, string | undefined>) => href(PATH, view, { ...patch, synthetic: synthetic ? "1" : undefined });

  return (
    <div className="space-y-6" data-testid="journey-page">
      <PageHead kicker="Marketing · Growth OS" title="Customer journey"
        intro="Touch → free signup → first bid → proposal sent → activated → paid → retained, with first-touch, last-touch and revenue-owner views. Revenue is net Stripe revenue per paid invoice, counted once, by one owner."
        right={<div className="flex flex-wrap items-center gap-2">
          <Link href={synthetic ? href(PATH, view, { synthetic: undefined }) : href(PATH, view, { synthetic: "1" })} className="cc-mono rounded-md border border-[var(--cc-line)] px-2.5 py-1.5 text-xs text-[var(--cc-blue)] hover:border-[var(--cc-blue)]" data-testid="synthetic-toggle">{synthetic ? "Show live data" : "Preview with synthetic data"}</Link>
          <RangeControl view={{ ...view, sp: { ...view.sp, synthetic: synthetic ? "1" : undefined } }} path={PATH} />
        </div>} />
      {synthetic
        ? <p className="cc-mono rounded-md border border-[var(--cc-amber)]/50 bg-[rgb(255_181_71/0.06)] px-3 py-2 text-xs text-[var(--cc-amber)]" data-testid="synthetic-banner">Synthetic data: eight made-up accounts (ids start with syn-) used to test this report before production use. Nothing here is a real customer.</p>
        : scope}
      {!installed.touches && !synthetic && <p className="cc-mono text-xs text-[var(--cc-amber)]">Touch history and net revenue need migration 20270228001000_marketing_measurement.sql. Until then first touch comes from the lead record and revenue shows as $0.</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Free signups" value={fmt(cohort.length)} sub={view.range.label} tone="blue" testId="kpi-signups" />
        <Kpi label="Paid" value={fmt(count("paid"))} sub={`${pct(count("paid"), cohort.length)} of signups`} tone="green" testId="kpi-paid" />
        <Kpi label="Net revenue" value={usd(rev.totalCents)} sub={`${fmt(rev.invoiceIds)} paid invoices · refunds ${usd(refunds)}`} tone="green" testId="kpi-revenue" />
        <Kpi label="Retained" value={fmt(count("retained"))} sub="renewed at least once" tone="violet" />
        <Kpi label="Canceled" value={fmt(count("canceled"))} sub="paid, then ended" tone="amber" />
      </div>

      <Panel title="Funnel" kicker="Signup cohort in range">
        <FunnelSteps steps={STAGES.filter((s) => s !== "canceled").map((s, i) => ({ label: STAGE_LABEL[s], n: count(s), note: i ? `${pct(count(s), cohort.length)} of signups` : undefined }))} />
        <p className="mt-2 text-xs text-muted">Each step is a share of the signup cohort. Steps aren&apos;t strictly nested: an account can activate (3+ priced items or an export) without sending a proposal.</p>
      </Panel>

      <SectionTitle kicker="Conversions" title="By source, campaign, trade, landing page, creative and segment"
        right={<div className="flex max-w-full flex-wrap gap-2"><div className="max-w-full overflow-x-auto"><Segmented active={model} options={MODELS.map((m) => ({ ...m, href: link({ model: m.value }) }))} /></div><div className="max-w-full overflow-x-auto" data-testid="dim-switch"><Segmented active={dim} options={DIMS.map((d) => ({ ...d, href: link({ dim: d.value }) }))} /></div></div>} />
      <Panel>
        <Table head={[DIMS.find((d) => d.value === dim)!.label, ...STAGES.map((s) => STAGE_LABEL[s]), ...(model === "owner" ? ["Net revenue"] : [])]} align={["l", ...STAGES.map(() => "r" as const), "r"]} minWidth={900}>
          {rows.map((r) => (
            <tr key={r.key} data-testid="breakdown-row">
              <td>{dim === "channel" ? label(r.key) : r.key}</td>
              {STAGES.map((s) => <td key={s} className="text-right">{fmt(r.counts[s])}</td>)}
              {model === "owner" && <td className="text-right">{usd(r.netCents)}</td>}
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-muted">{model === "owner"
          ? "Each account appears once, under the sales rep or affiliate who earns its commission, else its last marketing touch before payment. Revenue adds up to the total."
          : "Influence view: shows which touches led to each step. Revenue is not shown here because first and last touch must never be added together."}</p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Net revenue by owner" kicker="Invoices paid in range">
          <Table head={["Owner", "Invoices", "Net revenue"]} align={["l", "r", "r"]} minWidth={360}>
            {rev.rows.map((r) => <tr key={r.key} data-testid="owner-row"><td>{label(r.key)}</td><td className="text-right">{fmt(r.invoices)}</td><td className="text-right">{usd(r.netCents)}</td></tr>)}
            <tr className="font-semibold"><td>Total</td><td className="text-right">{fmt(rev.invoiceIds)}</td><td className="text-right" data-testid="owner-total">{usd(rev.totalCents)}</td></tr>
          </Table>
          <p className="mt-2 text-xs text-muted">Pre-tax amount paid, minus refunds; zero after a lost chargeback. Commissions and referral rewards are costs, never revenue.</p>
        </Panel>
        <Panel title="Retention by first paid month" kicker="% still paying at the end of each month">
          <Table head={["Cohort", "Size", ...Array.from({ length: 6 }, (_, k) => `M${k}`)]} align={["l", "r", "r", "r", "r", "r", "r", "r"]} minWidth={420}>
            {retention.map((c) => <tr key={c.month}><td>{c.month}</td><td className="text-right">{c.size}</td>{c.retained.map((v, k) => <td key={k} className="text-right">{v == null ? "·" : `${v}%`}</td>)}</tr>)}
          </Table>
        </Panel>
      </div>

      <Panel title="CAC, contribution and payback" kicker="New paying customers in range, by revenue owner">
        <Table head={["Owner", "New paying", "Ad / tool spend", "Year-1 commissions", "Referral rewards", "CAC", "Contribution / month", "Payback"]} align={["l", "r", "r", "r", "r", "r", "r", "r"]} minWidth={860}>
          {[...units.rows, units.blended].map((u) => (
            <tr key={u.key} className={u.key === "all" ? "font-semibold" : undefined} data-testid="unit-row">
              <td>{u.key === "all" ? "Blended" : label(u.key)}</td><td className="text-right">{fmt(u.newPaying)}</td><td className="text-right">{usd(u.spendCents)}</td>
              <td className="text-right">{usd(u.year1CommissionCents)}</td><td className="text-right">{usd(u.referralCents)}</td>
              <td className="text-right">{u.cacCents == null ? "–" : usd(u.cacCents)}</td><td className="text-right">{u.monthlyContributionCents == null ? "–" : usd(u.monthlyContributionCents)}</td>
              <td className="text-right">{u.cacCents === 0 ? "no cost" : u.paybackMonths == null ? "–" : `${u.paybackMonths} mo`}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-muted">
          Contribution = net revenue − Stripe fees (estimate: 2.9% + 30¢ per invoice) − commissions after year 1. CAC = spend + year-1 commissions + referral rewards, ÷ new paying.
          Contribution LTV: {units.contributionLtvCents == null ? units.ltvReason : `${usd(units.contributionLtvCents)} (${units.ltvReason}; monthly churn ${units.monthlyChurnPct}%, LTV:CAC ${units.ltvToCac ?? "–"})`}
        </p>
      </Panel>

      <Panel title="Data quality" kicker="Tracking health">
        <ul className="space-y-2 text-sm" data-testid="quality-list">
          {quality.map((q) => (
            <li key={q.key} className="flex items-start gap-2" data-testid={`quality-${q.key}`}>
              <Chip tone={q.severity === "ok" ? "green" : q.severity}>{q.severity === "ok" ? "OK" : fmt(q.count)}</Chip>
              <span><span className="font-semibold text-white">{q.title}</span> <span className="text-ink-soft">{q.detail}</span></span>
            </li>
          ))}
        </ul>
        {!synthetic && !touchesEnabled() && <p className="mt-3 text-xs text-muted">Touch tracking is off (set MARKETING_TOUCHES=on after the migration is applied). First touch comes from the lead record until then.</p>}
      </Panel>
    </div>
  );
}
