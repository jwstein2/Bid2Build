import { Card } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { tradeName } from "@/lib/trades/catalog";

export const dynamic = "force-dynamic";

interface Metrics {
  accounts: number; verified_accounts: number; plans: { monthly: number; annual: number };
  exports_this_month: number; exports_by_month: { month: string; count: number }[];
  trade_popularity: { trade: string; count: number }[]; funnel_30d: Record<string, number>;
  import_failures_7d: number; pdf_errors_7d: number; api_usage_30d: Record<string, number>;
}

const FUNNEL = ["landing_view", "trade_selected", "builder_started", "signup_started", "account_created", "preview_opened", "export_succeeded", "quota_reached", "checkout_started", "subscribed"];

export default async function AdminHome() {
  const { user, db } = await requireAdmin();
  const { data, error } = await db.rpc("admin_metrics", { p_caller: user.id });
  if (error || !data) return <p className="text-danger">Metrics are unavailable right now.</p>;
  const m = data as Metrics;
  const paid = m.plans.monthly + m.plans.annual;
  const free = Math.max(0, m.accounts - paid);
  const maxTrade = Math.max(1, ...m.trade_popularity.map((t) => t.count));
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold">Overview</h1>
        <p className="mt-1 text-sm text-ink-soft">Aggregate counts only. Bid contents are never shown here or stored in analytics.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Accounts" v={m.accounts} sub={`${m.verified_accounts} verified`} />
        <Stat k="Free accounts" v={free} />
        <Stat k="Unlimited subscribers" v={paid} sub={`${m.plans.monthly} monthly · ${m.plans.annual} annual`} />
        <Stat k="Exports this month" v={m.exports_this_month} />
        <Stat k="Import failures (7d)" v={m.import_failures_7d} />
        <Stat k="PDF errors (7d)" v={m.pdf_errors_7d} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-display text-lg font-bold">Conversion funnel (30 days)</h2>
          <table className="mt-3 w-full text-sm"><tbody>
            {FUNNEL.map((e) => <tr key={e} className="border-t border-line"><td className="py-1.5 text-ink-soft">{e.replace(/_/g, " ")}</td><td className="tabular py-1.5 text-right font-semibold">{m.funnel_30d[e] ?? 0}</td></tr>)}
          </tbody></table>
        </Card>
        <Card className="p-5">
          <h2 className="font-display text-lg font-bold">Trade popularity</h2>
          {m.trade_popularity.length === 0 ? <p className="mt-3 text-sm text-muted">No bids yet.</p> : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {m.trade_popularity.slice(0, 15).map((t) => (
                <li key={t.trade} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-2">
                  <span className="truncate text-ink-soft">{tradeName(t.trade)}</span>
                  <span className="h-2 rounded-full bg-brand" style={{ width: `${(t.count / maxTrade) * 100}%` }} aria-hidden />
                  <span className="tabular text-right font-semibold">{t.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-display text-lg font-bold">Exports by month</h2>
          <table className="mt-3 w-full text-sm"><tbody>
            {m.exports_by_month.length === 0 ? <tr><td className="text-muted">No exports yet.</td></tr> :
              m.exports_by_month.map((r) => <tr key={r.month} className="border-t border-line"><td className="py-1.5 text-ink-soft">{r.month.slice(0, 7)}</td><td className="tabular py-1.5 text-right font-semibold">{r.count}</td></tr>)}
          </tbody></table>
        </Card>
        <Card className="p-5">
          <h2 className="font-display text-lg font-bold">Third-party API usage (30 days)</h2>
          {Object.keys(m.api_usage_30d).length === 0 ? <p className="mt-3 text-sm text-muted">No paid APIs are connected.</p> : (
            <table className="mt-3 w-full text-sm"><tbody>
              {Object.entries(m.api_usage_30d).map(([k, v]) => <tr key={k} className="border-t border-line"><td className="py-1.5">{k}</td><td className="tabular py-1.5 text-right font-semibold">{v}</td></tr>)}
            </tbody></table>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ k, v, sub }: { k: string; v: number; sub?: string }) {
  return <Card className="p-4"><p className="text-sm text-ink-soft">{k}</p><p className="tabular mt-1 text-3xl font-extrabold">{v.toLocaleString("en-US")}</p>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</Card>;
}
