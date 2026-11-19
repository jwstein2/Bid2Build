import Link from "next/link";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import type { RepOverview } from "@/lib/sales/types";
import { projectedCommissions } from "@/lib/sales/basis";
import { currentMonthChicago, dateLabel, monthLabel, usd } from "@/lib/sales/format";
import { ATTENTION_TEXT, attentionFor, GOAL_KINDS, retention, scenario } from "@/lib/sales/business";
import { SUCCESS_TEXT } from "@/lib/sales/preferences";
import type { MonthCounts } from "@/lib/sales/incentives";
import { deleteGoal, saveGoal } from "./actions";

export const metadata = { title: "My Business" };

type Goal = { id: string; kind: string; target: number; month: string; progress: number };
type Success = { id: string; kind: string; occurred_at: string; customer: string };
const input = "mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const fmtGoal = (kind: string, n: number) => (GOAL_KINDS[kind]?.unit === "cents" ? usd(n) : String(n));

export default async function BusinessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db } = await requireSalesRep();
  const [ov, goalsRes, recRes, sucRes] = await Promise.all([db.rpc("sales_my_overview"), db.rpc("sales_my_goals", {}), db.rpc("sales_my_records", {}), db.rpc("sales_my_successes")]);
  if (ov.error || !ov.data) return <Notice title="Your business view is getting set up">Check back in a little while.</Notice>;
  const o = ov.data as RepOverview;
  const goals = goalsRes.error ? null : (goalsRes.data as { month: string; goals: Goal[]; last_month: Record<string, number> });
  const months = recRes.error || !recRes.data ? [] : ((recRes.data as { months: MonthCounts[] }).months ?? []);
  const successes = sucRes.error || !sucRes.data ? [] : (sucRes.data as Success[]);
  const onboarded = new Set(successes.filter((s) => s.kind === "onboarding_complete").map((s) => s.customer));
  const month = currentMonthChicago();
  const r = retention(o.customers);
  const sum = (s: string[]) => o.commissions.filter((c) => s.includes(c.status)).reduce((t, c) => t + c.amount_cents, 0);
  const upcoming = o.customers.filter((c) => !c.ended && c.first_paid_at && ["active", "trialing", "past_due"].includes(c.sub_status ?? ""))
    .flatMap((c) => projectedCommissions(`${c.first_paid_at!.slice(0, 7)}-01`, c.basis_cents, o.policy.commission_years, month).map((p) => ({ ...p, business: c.business ?? c.email ?? "Customer" })))
    .sort((a, b) => a.month.localeCompare(b.month));
  const attention = o.customers.map((c) => ({ c, a: attentionFor(c, onboarded.has(c.business ?? "")) })).filter((x) => x.a);
  const perMonth = Math.max(0, Math.min(100, Number(sp.n ?? 3) || 0)), price = Math.max(0, Math.min(1000, Number(sp.p ?? 19.99) || 0));
  const ill = scenario(perMonth, Math.round(price * 100));
  const current = goals?.goals.filter((g) => g.month === goals.month) ?? [];
  const history = months.filter((m) => m.paid_accounts > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">My Business</h1>
        <p className="mt-1 text-ink-soft">The customer relationships you&apos;ve built and what they&apos;ve earned you. Your book grows with every customer you help succeed.</p>
        <p className="mt-1 text-xs text-muted">Customer accounts belong to the customers and Built2Bid; your commission rights come from your sales agreement. Future commissions depend on customers staying active and paid.</p>
      </div>
      {sp.ok && <Notice tone="ok">{sp.ok === "goal" ? "Goal saved." : "Goal removed."}</Notice>}
      {sp.err && <Notice tone="danger">Enter a number greater than zero.</Notice>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4"><p className="text-sm text-muted">Customers acquired</p><p className="text-2xl font-extrabold">{r.acquired}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Active now</p><p className="text-2xl font-extrabold">{r.active}</p>{r.pct != null && <p className="text-xs text-muted">{r.pct}% still with us</p>}</Card>
        <Card className="p-4"><p className="text-sm text-muted">Onboarded</p><p className="text-2xl font-extrabold">{onboarded.size}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Paid to you</p><p className="text-2xl font-extrabold">{usd(sum(["paid"]))}</p><p className="text-xs text-muted">{usd(sum(["earned", "approved"]))} earned · {usd(sum(["pending"]))} pending</p></Card>
      </div>

      {r.acquired === 0 ? (
        <Card className="p-5 text-sm text-ink-soft"><h2 className="text-base font-bold text-ink">Your first customer starts your book</h2><p className="mt-1">Share your link from the <Link href="/sales" className="font-semibold text-brand underline">Overview</Link>, or book an onboarding session with a prospect from your <Link href="/sales/calendar" className="font-semibold text-brand underline">calendar</Link>. Everything you build shows up here.</p></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-lg font-bold">Upcoming anniversary opportunities</h2>
            <p className="text-xs text-muted">Contingent, not guaranteed: each is paid only if the customer is active and paid that month, at their plan price then.</p>
            {upcoming.length === 0 ? <p className="mt-2 text-sm text-ink-soft">None scheduled yet.</p> : (
              <ul className="mt-2 divide-y divide-line text-sm">{upcoming.slice(0, 10).map((u, i) => <li key={i} className="flex justify-between py-1.5"><span>{u.business}</span><span className="text-muted">{monthLabel(u.month)} · up to {usd(u.cents)}</span></li>)}</ul>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="text-lg font-bold">Relationships to check in on</h2>
            {attention.length === 0 ? <p className="mt-2 text-sm text-ink-soft">Everyone looks good.</p> : (
              <ul className="mt-2 divide-y divide-line text-sm">{attention.map(({ c, a }, i) => <li key={i} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{c.business ?? c.email}</span><Badge tone="warn">{ATTENTION_TEXT[a!]}</Badge></li>)}</ul>
            )}
            <Link href="/sales/customers" className="mt-2 inline-block text-sm font-semibold text-brand underline">All customers</Link>
          </Card>
        </div>
      )}

      <Card className="overflow-x-auto">
        <h2 className="p-4 pb-0 text-lg font-bold">Your customers</h2>
        <table className="mt-2 w-full min-w-[720px] text-sm">
          <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">Customer</th><th className="p-3">Status</th><th className="p-3">Customer since</th><th className="p-3">Onboarding</th><th className="p-3">Next anniversary</th></tr></thead>
          <tbody>
            {o.customers.filter((c) => c.first_paid_at).map((c, i) => {
              const steps = successes.filter((s) => s.customer === c.business);
              return (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="p-3">{c.business ?? c.email}</td><td className="p-3">{c.ended ? "Ended" : c.sub_status ?? "—"}</td><td className="p-3">{dateLabel(c.first_paid_at)}</td>
                  <td className="p-3">{onboarded.has(c.business ?? "") ? <Badge tone="ok">Complete</Badge> : steps.length ? steps.map((s) => SUCCESS_TEXT[s.kind]?.title).join(", ") : <span className="text-muted">Not started</span>}</td>
                  <td className="p-3">{c.next_anniversary ? monthLabel(c.next_anniversary) : "—"}</td>
                </tr>
              );
            })}
            {r.acquired === 0 && <tr><td colSpan={5} className="p-4 text-ink-soft">No paying customers yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      {history.length > 0 && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">Sales by month</h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">{months.map((m) => <li key={m.month} className="rounded-lg border border-line px-3 py-2"><span className="text-muted">{monthLabel(m.month)}</span> <span className="font-bold">{m.paid_accounts}</span></li>)}</ul>
        </Card>
      )}

      {goals && (
        <Card className="p-5" id="goals">
          <h2 className="text-lg font-bold">My goals for {monthLabel(goals.month)}</h2>
          <p className="text-xs text-muted">Optional and yours to choose. Goals are never required, compared with anyone, or used to judge you.</p>
          <ul className="mt-3 space-y-3">
            {current.map((g) => { const pct = Math.min(100, Math.round((g.progress / g.target) * 100)); return (
              <li key={g.id}>
                <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-semibold">{GOAL_KINDS[g.kind]?.label}</span><span>{fmtGoal(g.kind, g.progress)} of {fmtGoal(g.kind, g.target)}{pct >= 100 ? " · done!" : ""}</span></div>
                <div className="mt-1 h-2 rounded-full bg-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={GOAL_KINDS[g.kind]?.label}><div className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
                <form action={deleteGoal}><input type="hidden" name="id" value={g.id} /><button className="text-xs text-muted underline">Remove</button></form>
              </li>); })}
            {current.length === 0 && <li className="text-sm text-ink-soft">No goals this month. Add one if it helps you, or skip it.</li>}
          </ul>
          <form action={saveGoal} className="mt-4 grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <label className="text-xs">Goal<select name="kind" className={input}>{Object.entries(GOAL_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}{goals.last_month[k] ? ` (last month: ${fmtGoal(k, goals.last_month[k])})` : ""}</option>)}</select></label>
            <label className="text-xs">Target<input name="target" type="number" min={1} step="any" required className={input} /></label>
            <button className="min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white">Set goal</button>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-lg font-bold">What if? (illustration)</h2>
        <p className="text-xs text-muted">A scenario from numbers you choose, not a forecast or a promise. It shows sale-month commissions only; anniversaries come after month 12 and depend on customers staying.</p>
        <form className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs">New customers a month<input name="n" type="number" min={0} max={100} defaultValue={perMonth} className={input} /></label>
          <label className="text-xs">Monthly plan price ($)<input name="p" type="number" min={0} max={1000} step="0.01" defaultValue={price} className={input} /></label>
          <button className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold">Show</button>
        </form>
        <p className="mt-3 text-sm">At {perMonth} new customer{perMonth === 1 ? "" : "s"} a month on a {usd(Math.round(price * 100))} plan: about <span className="font-bold">{usd(ill[0].cents)}</span> a month in sale-month commission, <span className="font-bold">{usd(ill.reduce((t, m) => t + m.cents, 0))}</span> over 12 months, with {ill[11].customers} customers who could each pay anniversaries after that.</p>
      </Card>

      <Card className="p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">How we work</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Sell honestly and describe Built2Bid accurately: no promises it can&apos;t keep.</li>
          <li>Treat every customer and prospect with respect, and follow do-not-contact and marketing rules.</li>
          <li>Keep customer and lead information confidential and use it only for Built2Bid work.</li>
          <li>Help customers succeed after the sale. That&apos;s what keeps anniversaries coming.</li>
        </ul>
        <p className="mt-2 text-xs text-muted">Concerns are handled by a person, through your agreement, never automatically from activity numbers.</p>
      </Card>
    </div>
  );
}
