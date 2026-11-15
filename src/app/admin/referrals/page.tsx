import { Card, Badge } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

interface Row {
  id: string; created_at: string; code: string; status: string; ineligible_reason: string | null; converted_at: string | null;
  reward_kind: string | null; reward_cents: number | null; rewarded_at: string | null; error: string | null;
  referrer_email: string | null; referee_email: string | null;
}
interface Report {
  totals: { referrers: number; signed_up: number; paying: number; rewarded: number; failed: number; ineligible: number; credit_cents: number; codes: number };
  rows: Row[];
}

const STATUS: Record<string, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "brand" | "accent" }> = {
  signed_up: { label: "Signed up", tone: "brand" },
  rewarding: { label: "Rewarding…", tone: "accent" },
  rewarded: { label: "Rewarded", tone: "ok" },
  reward_failed: { label: "Reward failed", tone: "danger" },
  ineligible: { label: "Ineligible", tone: "neutral" },
};
const REASONS: Record<string, string> = {
  self_referral: "Self-referral", yearly_cap_reached: "Referrer hit 12 rewards this year", referrer_deleted: "Referrer deleted",
};
const reason = (r: string | null) => (r ? REASONS[r] ?? r.replace(/^(referrer|referee)_excluded_/, (_m, who) => `${who === "referrer" ? "Referrer" : "Referred account"} is `).replace(/_/g, " ") : "");
const date = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function ReferralsPage() {
  const { user, db } = await requireAdmin();
  const { data, error } = await db.rpc("admin_referrals", { p_caller: user.id, p_limit: 300 });
  if (error || !data) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-extrabold">Referrals</h1>
        <p className="text-ink-soft">The referral tables are not installed yet. Run <code>supabase/migrations/20261115003000_referrals.sql</code> in the Supabase SQL Editor, then reload.</p>
      </div>
    );
  }
  const { totals: t, rows } = data as Report;
  const stats: [string, string | number, string?][] = [
    ["Members with a link", t.codes], ["Active referrers", t.referrers], ["Referred signups", t.signed_up],
    ["Became paying", t.paying], ["Free months given", t.rewarded, t.credit_cents ? `${usd(t.credit_cents)} in Stripe credits` : undefined],
    ["Needs attention", t.failed, "Reward failed: apply by hand"],
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Referrals</h1>
        <p className="mt-1 text-sm text-ink-soft">Refer a contractor, get a month free. A reward is given once per referred account, on its first paid invoice. Internal, test and demo accounts and self-referrals are recorded as ineligible.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {stats.map(([k, v, sub]) => (
          <Card key={k} className="p-4"><p className="text-sm text-muted">{k}</p><p className="text-2xl font-extrabold">{v}</p>{sub && <p className="text-xs text-muted">{sub}</p>}</Card>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr><th className="px-4 py-2">Referred</th><th className="px-4 py-2">Referrer</th><th className="px-4 py-2">Referred account</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Paid</th><th className="px-4 py-2">Reward</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No referrals yet. Members find their link on the dashboard.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 align-top">
                <td className="px-4 py-2 whitespace-nowrap">{date(r.created_at)}</td>
                <td className="px-4 py-2">{r.referrer_email ?? "(deleted)"}<div className="font-mono text-xs text-muted">{r.code}</div></td>
                <td className="px-4 py-2">{r.referee_email ?? "(deleted)"}</td>
                <td className="px-4 py-2"><Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge>{r.ineligible_reason && <div className="mt-1 text-xs text-muted">{reason(r.ineligible_reason)}</div>}{r.error && <div className="mt-1 text-xs text-danger">{r.error}</div>}</td>
                <td className="px-4 py-2 whitespace-nowrap">{date(r.converted_at)}</td>
                <td className="px-4 py-2 whitespace-nowrap">{r.reward_kind === "stripe_credit" ? `${usd(r.reward_cents ?? 0)} Stripe credit` : r.reward_kind === "comp_days" ? "30 days Unlimited" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
