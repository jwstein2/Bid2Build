import Link from "next/link";
import { Card, Notice } from "@/components/ui/misc";
import { dateLabel, METHOD_LABEL, monthLabel, usd } from "@/lib/sales/format";

type Rule = { at: number; flat_cents?: number; pct?: number; badge?: string | null } | null;
type ProgramStatus = { available: boolean; reason: string; message: string | null };

/** public.sales_compensation_for (migration 20270202001000). Every number is computed in the database. */
export interface Compensation {
  model: "v2_window" | "v3_active_mrr"; qualification: "first_payment" | "second_cycle";
  attributed: number; qualifying: number; active_paying: number; qualifying_mrr_cents: number;
  current: Rule; next: Rule; remaining: number; next_estimate_cents: number; next_is_estimate: boolean;
  bonus_earned_cents: number; bonus_paid_cents: number; bonus_pending_cents: number;
  commission_earned_cents: number; commission_pending_cents: number;
  payouts: { paid_on: string; amount_cents: number; method: string; period_month: string; commission_cents: number; bonus_cents: number }[];
  programs: { milestone_bonus: ProgramStatus; randomized_activity_bonus: ProgramStatus };
}

const ruleText = (r: Rule) => (!r ? "—" : r.flat_cents != null ? usd(r.flat_cents) : `${r.pct}% of active MRR`);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-paper p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-xl font-extrabold tabular-nums">{value}</dd>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

/**
 * Rep dashboard: customers, milestone progress, and money, with standard commissions (recurring, up to
 * three years) kept visibly separate from one-time milestone bonuses.
 */
export function CompensationCard({ c }: { c: Compensation }) {
  const prev = c.current?.at ?? 0;
  const next = c.next?.at ?? c.qualifying;
  const progress = next > prev ? Math.min(100, Math.max(0, Math.round(((c.qualifying - prev) / (next - prev)) * 100))) : 100;
  const qualifyText = c.qualification === "second_cycle"
    ? "A customer counts once they've paid a second monthly bill (annual plans: one month after paying), and didn't cancel in their first month."
    : "A customer counts from their first payment unless they cancel in their first month or are fully refunded.";
  return (
    <section aria-labelledby="comp-h" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="comp-h" className="text-lg font-bold">Your compensation</h2>
        <Link href="/sales/how-you-get-paid" className="text-sm font-semibold text-brand underline">How it&apos;s calculated</Link>
      </div>

      <Card className="p-5">
        <h3 className="font-bold">Customers</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Total attributed customers" value={String(c.attributed)} sub="Signed up through you" />
          <Stat label="Qualifying milestone customers" value={String(c.qualifying)} sub="Count toward milestones" />
          <Stat label="Active paying customers" value={String(c.active_paying)} sub="Paid and active now" />
          <Stat label="Qualifying active MRR" value={usd(c.qualifying_mrr_cents)} sub="Monthly, before tax" />
        </dl>
        <p className="mt-3 text-xs text-muted">{qualifyText}</p>
      </Card>

      <Card className="p-5">
        <h3 className="font-bold">Milestone progress</h3>
        {!c.programs.milestone_bonus.available && (
          <Notice tone="warn" className="mt-3" title="New milestone bonuses are paused for you">{c.programs.milestone_bonus.message}</Notice>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Current milestone" value={c.current ? `${c.current.at} customers` : "None yet"} />
          <Stat label="Next milestone" value={c.next ? `${c.next.at} customers` : "—"} />
          <Stat label="Qualifying customers" value={String(c.qualifying)} />
          <Stat label="Remaining" value={String(c.remaining)} />
          <Stat label="Next milestone reward" value={ruleText(c.next)} />
        </dl>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-muted"><span>{prev}</span><span>{next}</span></div>
          <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={prev} aria-valuemax={next} aria-valuenow={c.qualifying} aria-label={`Progress to the ${next}-customer milestone`}>
            <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <p className="mt-3 text-sm">
          <strong>One-time bonus at {next} customers: {usd(c.next_estimate_cents)}</strong>
          {c.next_is_estimate && <span className="ml-1 text-ink-soft">(estimate at today&apos;s active MRR of {usd(c.qualifying_mrr_cents)}; the real amount uses your active MRR on the day you reach it, so it isn&apos;t guaranteed)</span>}
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-l-4 border-l-brand p-5">
          <h3 className="font-bold">Standard subscription commissions</h3>
          <p className="mt-1 text-xs text-muted">Recurring: one month of each customer&apos;s plan at the sale and on up to two anniversaries.</p>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Stat label="Earned" value={usd(c.commission_earned_cents)} sub="Earned, approved and paid" />
            <Stat label="Pending" value={usd(c.commission_pending_cents)} sub="In the 30-day hold" />
          </dl>
        </Card>
        <Card className="border-l-4 border-l-accent p-5">
          <h3 className="font-bold">One-time milestone bonuses</h3>
          <p className="mt-1 text-xs text-muted">Paid once per milestone. Never a permanent raise to your commission rate.</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Total earned" value={usd(c.bonus_earned_cents)} />
            <Stat label="Paid" value={usd(c.bonus_paid_cents)} />
            <Stat label="Pending" value={usd(c.bonus_pending_cents)} sub="Awaiting approval or payout" />
          </dl>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="font-bold">Payout history</h3>
        {c.payouts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">No payouts yet. Approved statements are paid through payroll after each month closes.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead><tr className="border-b border-line text-left text-muted"><th className="py-2 pr-3">Paid</th><th className="py-2 pr-3">Statement</th><th className="py-2 pr-3">Commissions</th><th className="py-2 pr-3">Bonuses</th><th className="py-2 pr-3">Total</th><th className="py-2">Method</th></tr></thead>
              <tbody>
                {c.payouts.map((p) => (
                  <tr key={`${p.period_month}-${p.paid_on}`} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3">{dateLabel(p.paid_on)}</td>
                    <td className="py-2 pr-3">{monthLabel(p.period_month)}</td>
                    <td className="py-2 pr-3 tabular-nums">{usd(p.commission_cents)}</td>
                    <td className="py-2 pr-3 tabular-nums">{usd(p.bonus_cents)}</td>
                    <td className="py-2 pr-3 font-semibold tabular-nums">{usd(p.amount_cents)}</td>
                    <td className="py-2">{METHOD_LABEL[p.method] ?? p.method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
