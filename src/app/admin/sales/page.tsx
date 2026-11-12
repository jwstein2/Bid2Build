import Link from "next/link";
import { Card } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { instantlyEnabled } from "@/lib/growth/instantly";

export const dynamic = "force-dynamic";

interface Funnel {
  since: string;
  leads_total: number; leads_new: number; leads_suppressed: number; leads_by_stage: Record<string, number>;
  signups_total: number; signups_new: number; activated_total: number; activated_new: number;
  paying_monthly: number; paying_annual: number; churned_new: number;
  campaigns: { campaign: string; leads: number; replied: number; signed_up: number; activated: number; paid: number; unsubscribed: number }[];
  costs_usd: number; costs_total_usd: number;
}

const RANGES = { "30": "Last 30 days", "90": "Last 90 days", "365": "Last 12 months" } as const;
// List prices, used only for a run-rate estimate. Stripe is the source of truth for collected revenue.
const MONTHLY = 19.99, ANNUAL = 149;

const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function SalesDashboard({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { user, db } = await requireAdmin();
  const daysKey = (await searchParams).days;
  const days = daysKey && daysKey in RANGES ? Number(daysKey) : 30;
  const since = daysAgoIso(days);
  const { data, error } = await db.rpc("growth_funnel", { p_caller: user.id, p_since: since });
  if (error || !data) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-extrabold">Sales</h1>
        <p className="text-ink-soft">The sales funnel tables are not installed yet. Apply <code>supabase/migrations/20261112001000_growth_funnel.sql</code> in the Supabase SQL Editor, then reload.</p>
      </div>
    );
  }
  const f = data as Funnel;
  const paying = f.paying_monthly + f.paying_annual;
  const mrr = f.paying_monthly * MONTHLY + (f.paying_annual * ANNUAL) / 12;
  const cac = f.costs_usd > 0 && f.signups_new > 0 ? f.costs_usd / f.signups_new : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Sales</h1>
          <p className="mt-1 text-sm text-ink-soft">Prospect → reply → signup → first bid → paid. Aggregate counts only.</p>
        </div>
        <nav aria-label="Date range" className="flex gap-1 text-sm">
          {Object.entries(RANGES).map(([k, label]) => (
            <Link key={k} href={`/admin/sales?days=${k}`} aria-current={Number(k) === days ? "page" : undefined} className={`rounded-md px-2.5 py-1.5 font-medium ${Number(k) === days ? "bg-ink text-white" : "text-ink-soft hover:bg-paper"}`}>{label}</Link>
          ))}
        </nav>
      </div>

      {!instantlyEnabled() && (
        <p className="rounded-md border border-line bg-paper px-4 py-3 text-sm text-ink-soft">Instantly sync is off (no <code>INSTANTLY_API_KEY</code> / <code>INSTANTLY_SYNC_ENABLED</code>). Lead and campaign numbers only include website attribution until it is connected.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Leads" v={f.leads_total.toLocaleString("en-US")} sub={`${f.leads_new} new · ${f.leads_suppressed} suppressed`} />
        <Stat k="Signups" v={f.signups_total.toLocaleString("en-US")} sub={`${f.signups_new} new in range`} />
        <Stat k="First-bid activations" v={f.activated_total.toLocaleString("en-US")} sub={`${f.activated_new} new · ${pct(f.activated_total, f.signups_total)} of signups`} />
        <Stat k="Paying customers" v={paying.toLocaleString("en-US")} sub={`${f.paying_monthly} monthly · ${f.paying_annual} annual · ${pct(paying, f.signups_total)} of signups`} />
        <Stat k="Run-rate MRR (list price)" v={usd(mrr)} sub="Estimate from active plans; see Stripe for collected revenue" />
        <Stat k="Cancellations in range" v={f.churned_new.toLocaleString("en-US")} />
        <Stat k="Recorded marketing spend" v={usd(f.costs_usd)} sub={`${usd(f.costs_total_usd)} all time`} />
        <Stat k="Cost per signup" v={cac === null ? "—" : usd(cac)} sub={cac === null ? "Needs recorded spend in marketing_costs" : "Recorded spend ÷ signups in range"} />
      </div>

      <Card className="overflow-x-auto p-5">
        <h2 className="font-display text-lg font-bold">Campaign performance (first touch)</h2>
        {f.campaigns.length === 0 ? <p className="mt-3 text-sm text-muted">No leads yet.</p> : (
          <table className="mt-3 w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-ink-soft"><th className="py-1.5">Campaign</th><th className="text-right">Leads</th><th className="text-right">Replied</th><th className="text-right">Signed up</th><th className="text-right">First bid</th><th className="text-right">Paid</th><th className="text-right">Unsub.</th></tr></thead>
            <tbody>
              {f.campaigns.map((c) => (
                <tr key={c.campaign} className="border-t border-line">
                  <td className="py-1.5">{c.campaign}</td>
                  <td className="tabular text-right">{c.leads}</td>
                  <td className="tabular text-right">{c.replied} <span className="text-muted">{pct(c.replied, c.leads)}</span></td>
                  <td className="tabular text-right">{c.signed_up} <span className="text-muted">{pct(c.signed_up, c.leads)}</span></td>
                  <td className="tabular text-right">{c.activated}</td>
                  <td className="tabular text-right font-semibold">{c.paid}</td>
                  <td className="tabular text-right">{c.unsubscribed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-lg font-bold">Leads by stage</h2>
        <table className="mt-3 w-full text-sm"><tbody>
          {Object.entries(f.leads_by_stage).length === 0 ? <tr><td className="text-muted">No leads yet.</td></tr> :
            Object.entries(f.leads_by_stage).map(([k, v]) => <tr key={k} className="border-t border-line"><td className="py-1.5 text-ink-soft">{k.replace(/_/g, " ")}</td><td className="tabular py-1.5 text-right font-semibold">{v}</td></tr>)}
        </tbody></table>
      </Card>
      <p className="text-xs text-muted">No ROI is shown: return on spend needs recorded costs and collected revenue from Stripe. Add spend rows to <code>marketing_costs</code> to enable cost per signup.</p>
    </div>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return <Card className="p-4"><p className="text-sm text-ink-soft">{k}</p><p className="tabular mt-1 text-2xl font-extrabold">{v}</p>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</Card>;
}
