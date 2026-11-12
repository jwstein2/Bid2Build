import { Card } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { aiSettings, isAiConfigured } from "@/lib/ai/provider";
import { EXCLUSION_CATEGORIES } from "@/lib/proposal/generate-rules";
import { tradeName } from "@/lib/trades/catalog";

export const dynamic = "force-dynamic";

interface Metrics {
  days: number;
  estimates: number;
  scopes: { with_scope: number; manual: number; generated: number; edited: number };
  exclusions: {
    estimates_using: number; approved_items: number; approved_generated: number; approved_manual: number; suggestions_rejected: number; suggestions_pending: number;
    top_categories_by_trade: { trade: string; category: string; count: number }[];
  };
  proposals: { exported: number; with_scope: number; with_exclusions: number };
  generation: {
    total: number; scope: number; exclusions: number; ai: number; rules: number; failed: number; limited: number; cost_usd: number; estimates: number; per_estimate: number;
    by_trade: { trade: string; scope: number; exclusions: number; cost_usd: number }[];
  };
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "–");
const usd = (n: number) => `$${Number(n).toFixed(2)}`;

export default async function ProposalTextAdmin() {
  const { user, db } = await requireAdmin();
  const { data, error } = await db.rpc("admin_proposal_text_metrics", { p_caller: user.id, p_days: 30 });
  const ai = aiSettings();
  const configured = isAiConfigured();
  const header = (
    <div>
      <h1 className="text-3xl font-extrabold">Scope &amp; exclusions</h1>
      <p className="mt-1 text-sm text-ink-soft">Last 30 days. Aggregate counts only: scope and exclusion text is never shown here or stored in the usage log.</p>
      <p className="mt-2 text-sm">
        AI writing: {configured ? <span className="font-semibold text-ok">on ({ai.model})</span> : <span className="font-semibold text-warn">off, contractors get drafts from the built-in rules</span>}
        {" · "}limit {ai.dailyLimitPerUser} per user per day · budget {usd(ai.monthlyBudgetUsd)} per month
      </p>
    </div>
  );
  if (error || !data) {
    return (
      <div className="space-y-3">
        {header}
        <p className="text-danger">These metrics are unavailable. On a new deployment, apply migration 20261112000600_proposal_text_ai.sql.</p>
      </div>
    );
  }
  const m = data as Metrics;
  const g = m.generation;
  const byTrade = new Map<string, { category: string; count: number }[]>();
  for (const r of m.exclusions.top_categories_by_trade) byTrade.set(r.trade, [...(byTrade.get(r.trade) ?? []), r]);

  return (
    <div className="space-y-8">
      {header}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Estimates with a scope" v={m.scopes.with_scope} sub={`of ${m.estimates} edited`} />
        <Stat k="Scopes written by hand" v={m.scopes.manual} />
        <Stat k="Drafted scopes" v={m.scopes.generated + m.scopes.edited} sub={`${m.scopes.edited} edited after drafting`} />
        <Stat k="Estimates using exclusions" v={m.exclusions.estimates_using} sub={`${m.exclusions.approved_items} approved items`} />
        <Stat k="Proposals with a scope" v={pct(m.proposals.with_scope, m.proposals.exported)} sub={`${m.proposals.with_scope} of ${m.proposals.exported} exported`} />
        <Stat k="Proposals with exclusions" v={pct(m.proposals.with_exclusions, m.proposals.exported)} sub={`${m.proposals.with_exclusions} of ${m.proposals.exported} exported`} />
        <Stat k="Approved exclusions that were drafted" v={pct(m.exclusions.approved_generated, m.exclusions.approved_items)} sub={`${m.exclusions.approved_manual} written by hand · ${m.exclusions.suggestions_rejected} rejected`} />
        <Stat k="AI cost" v={usd(g.cost_usd)} sub={`${g.ai} AI · ${g.rules} rule-based drafts`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-display text-lg font-bold">Generation</h2>
          <table className="mt-3 w-full text-sm"><tbody>
            <Tr k="Requests" v={g.total} />
            <Tr k="Scope / exclusions" v={`${g.scope} / ${g.exclusions}`} />
            <Tr k="Failure rate (failed, or rejected by a guard)" v={pct(g.failed, g.total)} />
            <Tr k="Hit the daily limit" v={g.limited} />
            <Tr k="Average generations per estimate" v={g.per_estimate} />
          </tbody></table>
        </Card>
        <Card className="p-5">
          <h2 className="font-display text-lg font-bold">Usage by trade</h2>
          {g.by_trade.length === 0 ? <p className="mt-3 text-sm text-muted">No generations yet.</p> : (
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-muted"><th className="py-1 font-semibold">Trade</th><th className="py-1 text-right font-semibold">Scope</th><th className="py-1 text-right font-semibold">Exclusions</th><th className="py-1 text-right font-semibold">Cost</th></tr></thead>
              <tbody>{g.by_trade.map((t) => <tr key={t.trade} className="border-t border-line"><td className="py-1.5">{tradeName(t.trade)}</td><td className="tabular text-right">{t.scope}</td><td className="tabular text-right">{t.exclusions}</td><td className="tabular text-right">{usd(t.cost_usd)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display text-lg font-bold">Most common approved exclusion categories</h2>
          {byTrade.size === 0 ? <p className="mt-3 text-sm text-muted">No approved exclusions yet.</p> : (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {[...byTrade.entries()].map(([trade, rows]) => (
                <li key={trade}><p className="font-semibold">{tradeName(trade)}</p><p className="text-sm text-ink-soft">{rows.map((r) => `${EXCLUSION_CATEGORIES[r.category] ?? r.category} (${r.count})`).join(" · ")}</p></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ k, v, sub }: { k: string; v: number | string; sub?: string }) {
  return <Card className="p-4"><p className="text-sm text-ink-soft">{k}</p><p className="tabular mt-1 text-3xl font-extrabold">{typeof v === "number" ? v.toLocaleString("en-US") : v}</p>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</Card>;
}
function Tr({ k, v }: { k: string; v: number | string }) {
  return <tr className="border-t border-line"><td className="py-1.5 text-ink-soft">{k}</td><td className="tabular py-1.5 text-right font-semibold">{v}</td></tr>;
}
