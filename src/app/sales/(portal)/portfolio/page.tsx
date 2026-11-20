import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import { dateLabel, monthLabel, usd } from "@/lib/sales/format";
import { customerName, isDone, STATE_LABEL, summarize, termRemaining, timeline, type Portfolio, type YearState } from "@/lib/sales/portfolio";
import { cn } from "@/lib/cn";

export const metadata = { title: "10-year portfolio" };

const CELL: Record<YearState, string> = {
  paid: "bg-ok text-white", approved: "bg-brand text-white", earned: "bg-brand text-white", pending: "bg-accent/80 text-ink",
  ineligible: "bg-line text-muted line-through", canceled: "bg-line text-muted line-through", reversed: "bg-danger/80 text-white",
  due: "border-2 border-brand bg-paper text-ink", projected: "border border-dashed border-ink-soft/50 bg-paper text-ink-soft", not_expected: "bg-paper text-muted/60",
};

/**
 * The rep's book of referred customers over the 10-year term: one commission per eligible year, never monthly.
 * Expected amounts assume the customer stays active at today's value and are labeled as conditional.
 */
export default async function SalesPortfolio() {
  const { db } = await requireSalesRep();
  const { data, error } = await db.rpc("sales_my_portfolio");
  if (error || !data) return <Notice title="Your portfolio is getting set up">Check back in a little while.</Notice>;
  const p = data as Portfolio;
  const s = summarize(p);
  const cur = p.current_month;
  const paying = p.customers.filter((c) => c.first_paid_month);
  const tiles: [string, string, string?][] = [
    ["Referred customers", String(s.referred)],
    ["Active paying", String(s.active)],
    ["Canceled or ended", String(s.canceled)],
    ["Earned (not yet paid)", usd(s.earnedCents)],
    ["In 30-day hold", usd(s.pendingCents)],
    ["Paid to you", usd(s.paidCents)],
    ["Annual portfolio value", usd(s.annualRunCents), "One anniversary commission per active customer at today's value"],
    ["Expected future commissions", usd(s.expectedFutureCents), "If every active customer stays active at today's value. Not guaranteed."],
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Your 10-year portfolio</h1>
        <p className="mt-1 max-w-3xl text-ink-soft">
          Each customer you bring in can pay you once a year for up to {p.policy_years} years: in the month they first pay, then in each anniversary month while
          they&apos;re still active and paid. Each payment is one month of their plan at that time. It&apos;s an annual commission, not a monthly one.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, value, hint]) => (
          <Card key={label} className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p><p className="mt-1 text-2xl font-extrabold">{value}</p>{hint && <p className="mt-1 text-xs text-muted">{hint}</p>}</Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="font-bold">Yearly earnings history</h2>
          {s.history.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No earned commissions yet.</p> : (
            <table className="mt-2 w-full text-sm"><thead className="text-left text-muted"><tr><th className="py-1">Year</th><th className="py-1">Commissions</th><th className="py-1 text-right">Amount</th></tr></thead>
              <tbody>{s.history.map((h) => <tr key={h.year} className="border-t border-line"><td className="py-1">{h.year}</td><td className="py-1">{h.lines}</td><td className="py-1 text-right font-semibold">{usd(h.cents)}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-bold">Anniversaries coming up</h2>
          {s.renewingSoon.length === 0 ? <p className="mt-2 text-sm text-ink-soft">None in the next two months.</p> : (
            <ul className="mt-2 space-y-1 text-sm">{s.renewingSoon.map((r) => <li key={r.key} className="flex justify-between gap-2"><span>{r.name} · {monthLabel(r.month)}</span><span className="font-semibold">{usd(r.cents)}*</span></li>)}</ul>
          )}
          <p className="mt-2 text-xs text-muted">* Paid only if the customer is still active and pays in that month.</p>
        </Card>
        <Card className="p-5">
          <h2 className="font-bold">Plan changes since the last commission</h2>
          {s.changed.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No upgrades or downgrades.</p> : (
            <ul className="mt-2 space-y-1 text-sm">{s.changed.map((c) => <li key={c.key} className="flex justify-between gap-2"><span>{c.name}</span><Badge tone={c.direction === "up" ? "ok" : "warn"}>{c.direction === "up" ? "Upgraded" : "Downgraded"} {usd(c.fromCents)} → {usd(c.toCents)}</Badge></li>)}</ul>
          )}
          <p className="mt-2 text-xs text-muted">The next anniversary commission uses the new amount.</p>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-lg font-bold">Customer timelines</h2>
        <p className="mt-1 text-sm text-ink-soft">Year 1 is the month the customer first paid. Solid boxes are real commissions; dashed boxes are expected if the customer stays active.</p>
        <ul className="mt-3 flex flex-wrap gap-3 text-xs" aria-label="Legend">
          {(["paid", "earned", "pending", "due", "projected", "ineligible", "reversed", "not_expected"] as YearState[]).map((k) => (
            <li key={k} className="flex items-center gap-1"><span className={cn("inline-block h-4 w-6 rounded", CELL[k])} aria-hidden />{STATE_LABEL[k]}</li>
          ))}
        </ul>
        {paying.length === 0 ? <p className="mt-4 text-sm text-ink-soft">Timelines appear once a customer you referred makes their first payment.</p> : (
          <div className="mt-4 space-y-4">
            {paying.map((c) => {
              const tl = timeline(c, cur);
              const left = termRemaining(c, cur);
              const earnedSoFar = tl.filter((t) => isDone(t.state)).reduce((n, t) => n + t.cents, 0);
              return (
                <div key={c.key} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold">{customerName(c)} <span className="text-xs font-normal text-muted">{c.plan ?? ""} · first paid {dateLabel(c.first_paid_at)}</span></p>
                    <p className="text-xs text-muted">{left ? `${left.years} yr ${left.months} mo left in term (ends ${monthLabel(left.endMonth)})` : ""} · earned {usd(earnedSoFar)}</p>
                  </div>
                  <ol className="mt-2 grid grid-cols-5 gap-1 sm:grid-cols-10" aria-label={`10-year timeline for ${customerName(c)}`}>
                    {tl.map((t) => (
                      <li key={t.year} className={cn("rounded px-1 py-1.5 text-center text-[11px] leading-tight", CELL[t.state])} title={`${STATE_LABEL[t.state]}${t.cents ? ` · ${usd(t.cents)}` : ""}`}>
                        <span className="block font-bold">Y{t.year}</span>
                        <span className="block">{monthLabel(t.month)}</span>
                        <span className="block">{t.cents ? `${usd(t.cents)}${t.forecast ? "*" : ""}` : "—"}</span>
                        <span className="sr-only">{STATE_LABEL[t.state]}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-muted">* Expected, not guaranteed: paid only if the customer is still active and pays in that anniversary month, at their value then.</p>
      </Card>
    </div>
  );
}
