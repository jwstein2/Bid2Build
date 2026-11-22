import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { stripeCreditsEnabled } from "@/lib/academy/rewards-server";
import { REVIEW_REASONS, monthLabel, shortDate } from "@/lib/academy/rewards";
import { declineReward, markManual, retryReward } from "./actions";

export const dynamic = "force-dynamic";

interface RewardRow {
  id: string; status: string; action: string | null; review_reason: string | null; flags: string[]; month: string; qualified_at: string; applied_at: string | null;
  activates_at: string | null; expires_at: string | null; credit_cents: number | null; stripe_ref: string | null; grant_id: string | null; error: string | null;
  tries: number; quiz_correct: number; email: string | null; tier: string | null;
}
interface Report {
  month: string;
  totals: { qualified: number; applied: number; review: number; failed: number; learners_month: number; trainings_month: number; quizzes_month: number; passed_month: number };
  rewards: RewardRow[];
  close: { email: string; trainings: number; quiz_passed: boolean }[];
  suspicious: { kind: string; email: string; what: string; at: string; lessons: number | null; seconds: number }[];
  events: { id: number; reward_id: string | null; action: string; details: Record<string, unknown> | null; created_at: string; email: string | null; actor: string | null }[];
}

const TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "brand" | "accent"> = {
  pending: "brand", applying: "accent", applied: "ok", review: "warn", failed: "danger", declined: "neutral",
};
const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const small = "rounded-md border border-line-strong px-2 py-1 text-xs font-semibold hover:bg-brand-tint";

export default async function AcademyRewardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { user, db } = await requireAdmin();
  const { data, error } = await db.rpc("admin_academy_rewards", { p_caller: user.id, p_limit: 300 });
  if (error || !data) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-extrabold">Academy rewards</h1>
        <p className="text-ink-soft">The Academy challenge tables are not installed yet. Run <code className="break-all">supabase/migrations/20270223001000_academy_rewards.sql</code> in the Supabase SQL Editor, then reload.</p>
      </div>
    );
  }
  const r = data as Report;
  const credits = stripeCreditsEnabled();
  const t = r.totals;
  const stats: [string, number, string?][] = [
    ["Learners this month", t.learners_month, `${t.trainings_month} trainings finished`], ["Challenge quizzes", t.quizzes_month, `${t.passed_month} passed`],
    ["Free months earned", t.qualified], ["Applied", t.applied], ["Needs review", t.review], ["Not applied yet", t.failed, "Pending or failed: retry below"],
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Academy rewards</h1>
        <p className="mt-1 text-sm text-ink-soft">Monthly challenge: 4 courses + a passed 20-question quiz in one month earns one free month of Individual Unlimited, once per account for life. Demo and practice logins are left out. {monthLabel(r.month)} so far.</p>
      </div>
      {typeof sp.msg === "string" && <Notice tone="neutral">{sp.msg}</Notice>}
      <Notice tone={credits ? "ok" : "neutral"} title={credits ? "Stripe credits are ON" : "Stripe credits are OFF"}>
        {credits ? "Renewing monthly subscribers get a one-month customer balance credit (at most $19.99) on their next invoice." : "Monthly subscribers who earn the reward wait here for review. To credit them automatically, set ACADEMY_REWARD_STRIPE_CREDITS=on in Netlify (Production) and redeploy. Free accounts always get 30 days of Unlimited with no Stripe call."}
      </Notice>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {stats.map(([k, v, sub]) => <Card key={k} className="p-4"><p className="text-sm text-muted">{k}</p><p className="text-2xl font-extrabold">{v}</p>{sub && <p className="text-xs text-muted">{sub}</p>}</Card>)}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr><th className="px-4 py-2">Earned</th><th className="px-4 py-2">Account</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Delivery</th><th className="px-4 py-2">Actions</th></tr>
          </thead>
          <tbody>
            {r.rewards.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No one has earned the free month yet.</td></tr>}
            {r.rewards.map((w) => (
              <tr key={w.id} className="border-b border-line align-top last:border-0">
                <td className="px-4 py-2 whitespace-nowrap">{shortDate(w.qualified_at)}<div className="text-xs text-muted">{monthLabel(w.month)} · quiz {w.quiz_correct}/20</div></td>
                <td className="px-4 py-2">{w.email ?? "(deleted)"}<div className="text-xs text-muted">Plan when earned: {w.tier ?? "unknown"}</div></td>
                <td className="px-4 py-2">
                  <Badge tone={TONE[w.status] ?? "neutral"}>{w.status}</Badge>
                  {w.review_reason && <div className="mt-1 text-xs text-muted">{REVIEW_REASONS[w.review_reason] ?? w.review_reason}</div>}
                  {w.flags.length > 0 && <div className="mt-1 text-xs text-danger">Flags: {w.flags.join(", ").replace(/_/g, " ")}</div>}
                  {w.error && <div className="mt-1 text-xs text-danger">{w.error}</div>}
                </td>
                <td className="px-4 py-2 text-xs">
                  {w.action === "comp_days" && w.activates_at ? <>30 days Unlimited<br />{shortDate(w.activates_at)} to {shortDate(w.expires_at)}</>
                    : w.action === "stripe_credit" && w.credit_cents ? <>{usd(w.credit_cents)} Stripe credit<br /><span className="font-mono">{w.stripe_ref}</span></>
                    : w.stripe_ref?.startsWith("manual:") ? w.stripe_ref : "—"}
                  {w.tries > 1 && <div className="text-muted">{w.tries} tries</div>}
                </td>
                <td className="px-4 py-2">
                  {["review", "failed", "pending", "applying"].includes(w.status) ? (
                    <div className="flex max-w-xs flex-col gap-2">
                      <form action={retryReward} className="flex flex-wrap gap-1">
                        <input type="hidden" name="id" value={w.id} />
                        {w.status !== "review" && <button className={small} name="action" value="auto">Retry</button>}
                        <button className={small} name="action" value="comp_days">Give 30 days</button>
                        {credits && <button className={small} name="action" value="stripe_credit">Give Stripe credit</button>}
                      </form>
                      <form action={markManual} className="flex gap-1"><input type="hidden" name="id" value={w.id} />
                        <input name="note" placeholder="Applied by hand: what?" className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-xs" /><button className={small}>Record</button></form>
                      <form action={declineReward} className="flex gap-1"><input type="hidden" name="id" value={w.id} />
                        <input name="note" placeholder="Reason" className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-xs" /><button className={small}>Decline</button></form>
                    </div>
                  ) : <span className="text-xs text-muted">Final</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted">&ldquo;Give 30 days&rdquo; starts after any paid period, so a subscriber is never charged for the free month. Annual extensions in Stripe are a manual step: do it in Stripe, then use &ldquo;Record&rdquo;.</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <p className="font-bold">Close this month</p>
          <p className="text-xs text-muted">Learners with trainings this month who haven&apos;t earned the reward.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {r.close.length === 0 && <li className="text-muted">No one yet.</li>}
            {r.close.map((c) => <li key={c.email}>{c.email}: {c.trainings}/4 trainings{c.quiz_passed ? " · quiz passed" : ""}</li>)}
          </ul>
        </Card>
        <Card className="p-4">
          <p className="font-bold">Suspicious records</p>
          <p className="text-xs text-muted">Courses clicked through in seconds and quizzes submitted in under a minute. Rewards with these flags wait for review.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {r.suspicious.length === 0 && <li className="text-muted">Nothing flagged.</li>}
            {r.suspicious.map((s, i) => <li key={i}>{shortDate(s.at)} · {s.email}: {s.kind} {s.what} in {s.seconds}s</li>)}
          </ul>
        </Card>
      </div>

      <Card className="p-4">
        <p className="font-bold">Audit trail</p>
        <ul className="mt-2 space-y-1 text-sm">
          {r.events.length === 0 && <li className="text-muted">No events yet.</li>}
          {r.events.map((e) => <li key={e.id}><span className="text-muted">{new Date(e.created_at).toLocaleString("en-US")}</span> · {e.email ?? "(deleted)"} · <span className="font-semibold">{e.action}</span>{e.actor ? ` by ${e.actor}` : ""}</li>)}
        </ul>
      </Card>
    </div>
  );
}
