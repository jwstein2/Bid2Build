import { PageHead, Panel, PanelLink, Row, fmt } from "@/components/admin/cc";
import { ReportUnavailable } from "@/components/admin/report";
import { PRICES, type Observed } from "@/lib/admin/forecast";
import { serviceViews } from "@/lib/admin/costs";
import { envPresent } from "@/lib/admin/integrations";
import { loadReport } from "@/lib/admin/load";
import { revenueModel } from "@/lib/admin/model";
import { ForecastTool } from "./forecast-tool";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scaling forecast" };

export default async function Forecast({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { r, error, view } = await loadReport(await searchParams, { costs: true });
  if (!r || !r.costs) return <ReportUnavailable error={error} />;
  const { facts, sc, now, costs } = r;
  const rev = revenueModel(facts, view.range, now);
  const ok = (costs.ai ?? []).filter((a) => a.status === "ok");
  const aiCost = ok.length ? ok.reduce((n, a) => n + (Number(a.cost_usd) || 0), 0) / ok.length : null;
  const netlify = serviceViews(costs.services, costs.expenses, envPresent, now).find((v) => v.key === "netlify");
  const observed: Observed = {
    dbBytes: costs.usage?.db_bytes ?? null, storageBytes: costs.usage ? costs.usage.buckets.reduce((n, b) => n + b.bytes, 0) : null,
    estimates: sc.d.estimates.length, businesses: facts.length, aiCostPerGenerationUsd: aiCost,
    arpaUsd: rev.paying ? Math.round(rev.mrrCents / rev.paying) / 100 : null,
    hostingMonthlyUsd: netlify?.monthlyAllocatedCents != null ? netlify.monthlyAllocatedCents / 100 : null,
  };
  const s = PRICES.supabase;
  return (
    <div className="space-y-6">
      <PageHead kicker="Tools · Tech Stack & Costs · Forecast" title="What Built2Bid costs at scale"
        intro="Estimated monthly platform cost for 100 to 2,500 paying businesses, from today's measured usage plus assumptions you can change. Observed inputs and assumptions are labeled separately."
        right={<PanelLink href="/admin/costs">Tech Stack &amp; Costs</PanelLink>} />
      <ForecastTool observed={observed} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel kicker="Measured today" title="Observed inputs">
          <dl>
            <Row k="Database size">{observed.dbBytes != null ? `${(observed.dbBytes / 1024 ** 2).toFixed(1)} MB` : "Needs migration 20261115003000"}</Row>
            <Row k="Stored files">{observed.storageBytes != null ? `${(observed.storageBytes / 1024 ** 2).toFixed(1)} MB` : "Needs migration 20261115003000"}</Row>
            <Row k="Estimates (genuine accounts)">{fmt(observed.estimates)}</Row>
            <Row k="AI cost per request">{observed.aiCostPerGenerationUsd != null ? `$${observed.aiCostPerGenerationUsd.toFixed(4)} (${fmt(ok.length)} requests)` : "No AI requests logged"}</Row>
            <Row k="Revenue per paying business">{observed.arpaUsd != null ? `$${observed.arpaUsd.toFixed(2)}` : "No paying customers yet ($19.99 assumed)"}</Row>
          </dl>
          <p className="mt-2 text-xs text-muted">With very little usage so far, these are a starting point, not a trend. The model will get better as real usage grows.</p>
        </Panel>
        <Panel kicker="List prices used" title="Provider pricing assumptions">
          <ul className="space-y-1.5 text-xs text-ink-soft">
            <li>Supabase Pro: ${s.baseUsd}/month incl. {s.dbGbIncluded} GB database, {s.storageGbIncluded} GB files, {s.egressGbIncluded} GB transfer, {fmt(s.mauIncluded)} MAU; overage ${s.dbGbUsd}/GB database, ${s.storageGbUsd}/GB files, ${s.egressGbUsd}/GB transfer. Compute tier steps are an assumption.</li>
            <li>Email: Resend Free up to 3,000/month, Pro $20 up to 50,000, Scale $90 up to 100,000. Sign-in codes through a single mailbox SMTP are limited to about {fmt(PRICES.workspaceSmtpDailyLimit)}/day.</li>
            <li>Stripe: 2.9% + 30¢ per card payment plus 0.7% Billing.</li>
            <li>Sentry: free up to {fmt(PRICES.sentry.freeErrors)} errors/month, then Team ${PRICES.sentry.teamUsd}.</li>
            <li>Netlify: plan price from Tech Stack &amp; Costs; request pricing is a hypothetical input.</li>
          </ul>
          <p className="mt-2 text-xs text-muted">Public list prices as understood on 2026-11-15. Check each provider&apos;s pricing page before relying on a number.</p>
        </Panel>
      </div>
    </div>
  );
}
