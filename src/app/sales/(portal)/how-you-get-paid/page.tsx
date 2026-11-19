import { Card } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import { DEFAULT_MILESTONES, payExample, type MilestoneModel, type MilestoneRules } from "@/lib/sales/goals";
import type { Compensation } from "@/components/sales/compensation-card";
import { usd } from "@/lib/sales/format";

export const metadata = { title: "How you get paid" };

/** Rep onboarding walkthrough: what happens at each stage, and how a rep at account 300 looks. */
export default async function HowYouGetPaid() {
  const { db } = await requireSalesRep();
  const [{ data }, compRes] = await Promise.all([db.rpc("sales_my_milestones"), db.rpc("sales_my_compensation")]);
  const m = data as { every: number; rates: MilestoneRules["rates"]; min_cents: number; flat: MilestoneRules["flat"] } | null;
  const rules: MilestoneRules = m?.rates ? { every: m.every, rates: m.rates, min_cents: m.min_cents, flat: m.flat } : DEFAULT_MILESTONES;
  const comp = compRes.error ? null : (compRes.data as Compensation | null);
  const model: MilestoneModel = comp?.model ?? (m?.every === 50 ? "v2_window" : "v3_active_mrr");
  const v3 = model === "v3_active_mrr";
  const secondCycle = (comp?.qualification ?? "second_cycle") === "second_cycle";
  const ex = payExample(rules, 300, 25, 1999, 0.8, model);
  const minText = rules.min_cents > 0 ? `, at least ${usd(rules.min_cents)}` : "";
  const steps: [string, string][] = [
    ["1. Share your link", "Anyone who signs up through your link within 90 days of their visit is connected to you, even if they buy later."],
    ["2. They pay", "When the customer's first payment goes through, a commission line appears: one month of their plan at the monthly list price ($19.99), before tax. Taxes, refunds, chargebacks and anything not actually collected are never commissionable."],
    ["3. 30-day hold", "The commission waits 30 days. If the customer is refunded or cancels in their first month, that sale doesn't pay. After the hold, it's yours: later refunds never take money back."],
    ["4. Month-end statement", "Earned commission goes on your next month-end statement. The owner approves it and you're paid."],
    ["5. Anniversaries", "On the customer's 1-year and 2-year anniversaries you're paid again if they're still active and paid (3 payments in total). Upgrades count at the anniversary."],
    ["6. Milestone bonuses", v3
      ? `At ${rules.flat.map((f) => f.at).join(" and ")} qualifying customers, then at ${rules.rates[0]?.from ?? 50} and every ${rules.every} after that, you earn a one-time bonus. Each milestone pays once and never raises your commission rate. A gift box pops up on your dashboard; it goes on your next statement once the owner approves it.`
      : `At ${rules.flat.map((f) => f.at).join(", ")}, ${rules.every} and every ${rules.every} accounts after that, a Built2Bid gift box pops up on your dashboard. Click the box to open it and see your bonus. It goes on your next statement once the owner approves it.`],
    ["7. If you leave", "You're paid for every sale whose customer paid before your last day, including sales still in the 30-day hold and gift boxes you already unlocked. Payments that come in after you leave (including 1-year and 2-year anniversaries) don't earn commission. Your written sales agreement has the details."],
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">How you get paid</h1>
        <p className="mt-1 text-ink-soft">Everything that happens from the first click to your paycheck. Fixed rules, no luck involved.</p>
      </div>

      <ol className="grid gap-3 md:grid-cols-2">
        {steps.map(([t, d]) => (
          <li key={t}><Card className="h-full p-4"><h2 className="font-bold">{t}</h2><p className="mt-1 text-sm text-ink-soft">{d}</p></Card></li>
        ))}
      </ol>

      <Card className="p-5">
        <h2 className="text-lg font-bold">Milestone boxes</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {rules.flat.map((f) => <li key={f.at}><strong>{f.at} accounts:</strong> {usd(f.cents)}{f.badge ? ` and the "${f.badge}" badge` : ""}</li>)}
          {rules.rates.map((r, i) => {
            const nextFrom = rules.rates[i + 1]?.from;
            const range = nextFrom ? (nextFrom - rules.every === r.from ? `${r.from}` : `${r.from}, ${Array.from({ length: Math.max(0, Math.floor((nextFrom - r.from) / rules.every) - 1) }, (_, k) => r.from + (k + 1) * rules.every).join(", ")}`) : `${r.from} and every ${rules.every} after that`;
            return <li key={r.from}><strong>{range} customers:</strong> {v3 ? `${r.pct}% of your qualifying active MRR, once per milestone${minText}` : `${r.pct}% of what your active customers paid since your last percentage box${minText}`}</li>;
          })}
        </ul>
        {v3 ? (
          <div className="mt-3 space-y-2 text-sm text-ink-soft">
            <p><strong className="text-ink">Who counts:</strong> {secondCycle ? "a customer you brought in counts once they've paid their second monthly bill. Annual customers count one month after paying, without waiting for a second payment." : "a customer counts from their first payment."} Customers who cancel in their first month, are refunded, charge back, or are on free or complimentary access don&apos;t count. A customer who leaves and comes back still counts once.</p>
            <p><strong className="text-ink">Qualifying active MRR:</strong> the monthly subscription revenue, before tax, from your qualifying customers who are active and paid right now. Annual plans count at their monthly equivalent ($199 a year = $16.58). Team (Enterprise) plans and paid seats count. Discounts, refunds and unpaid amounts don&apos;t.</p>
            <p><strong className="text-ink">Worked example:</strong> you reach 100 qualifying customers and your qualifying active MRR is $2,400. The 100-customer rate is 4%, so the bonus is $2,400 × 4% = <strong className="text-ink">$96.00</strong>, paid once. At 125 you can earn the next one.</p>
            <p>The amount is calculated and recorded the day you reach the milestone, and it never changes afterward, even if your MRR goes up or down or a customer later cancels. Amounts round to the nearest cent.</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-soft">Every account you&apos;ve sold counts toward the next box, even if it later cancels (except a first-month cancel or full refund). The bonus itself is based only on revenue from customers who are still active. Each box covers new revenue only, so nothing is counted twice. Box amounts are fixed after the same 30-day refund hold.</p>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-bold">Example: what account 300 looks like</h2>
        <p className="mt-1 text-sm text-ink-soft">Illustration only. A rep who brings in {ex.perMonth} customers a month on the $19.99 plan reaches 300 in about {ex.months} months, with {Math.round(ex.activeShare * 100)}% of customers still active and paying.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead><tr className="border-b border-line text-left text-muted"><th className="py-2 pr-3">Box</th><th className="py-2 pr-3">Rule</th><th className="py-2 pr-3">{v3 ? "Active MRR at the milestone" : "Active revenue in window"}</th><th className="py-2">Bonus</th></tr></thead>
            <tbody>
              {ex.boxes.map((b) => (
                <tr key={b.milestone} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 font-semibold">{b.milestone}</td>
                  <td className="py-2 pr-3">{b.flat ? "Flat" : `${b.pct}%`}</td>
                  <td className="py-2 pr-3">{b.flat ? "—" : usd(b.revenueCents)}</td>
                  <td className="py-2 font-semibold">{usd(b.bonusCents)}{b.minApplied ? " (minimum)" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-paper p-3"><dt className="text-xs text-muted">Milestone bonuses</dt><dd className="text-xl font-extrabold">{usd(ex.totalBonusCents)}</dd></div>
          <div className="rounded-lg bg-paper p-3"><dt className="text-xs text-muted">Sale commissions (300 × $19.99)</dt><dd className="text-xl font-extrabold">{usd(ex.commissionCents)}</dd></div>
          <div className="rounded-lg bg-paper p-3"><dt className="text-xs text-muted">Total by account 300</dt><dd className="text-xl font-extrabold">{usd(ex.totalBonusCents + ex.commissionCents)}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-muted">Anniversary payments in years 2 and 3 come on top. Real amounts depend on your customers&apos; plans and payments.</p>
      </Card>

      {comp && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">Other incentive programs</h2>
          <p className="mt-1 text-sm text-ink-soft">Some programs depend on the laws where you actually work, so availability can differ by state or city. A program being unavailable never affects commissions or bonuses you&apos;ve already earned.</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><strong>Standard commissions:</strong> always on.</li>
            <li><strong>Milestone bonuses:</strong> {comp.programs.milestone_bonus.available ? "available to you." : comp.programs.milestone_bonus.message}</li>
            <li><strong>Activity bonus drawing:</strong> {comp.programs.randomized_activity_bonus.available ? "available to you." : comp.programs.randomized_activity_bonus.message}</li>
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-lg font-bold">Quests and personal records</h2>
        <p className="mt-1 text-sm text-ink-soft">Daily and weekly quests (follow-ups, calls, demos, closed accounts) earn XP. Your dashboard compares this month only with your own best month, never with other reps. There are no ranks or tiers: we&apos;re all equals. XP and records are for you, not cash.</p>
        <h2 className="mt-5 text-lg font-bold">Monthly accelerator</h2>
        <p className="mt-1 text-sm text-ink-soft">When the owner turns it on: 5 or more new paid sales in a calendar month adds 5% to that month&apos;s sale commissions, 10 or more adds 10%, 15 or more 15%, and 20 or more 20%. Example: 10 sales whose sale-month commissions total $199.90 earn a $19.99 bonus, $219.89 in all. It never applies to anniversaries, is fixed once the month&apos;s sales clear the 30-day refund hold, and is paid on the next statement after approval. The current rates are on the Policy page your admin shares.</p>
      </Card>
    </div>
  );
}
