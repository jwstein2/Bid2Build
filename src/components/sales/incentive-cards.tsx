import { Card } from "@/components/ui/misc";
import { monthLabel, usd } from "@/lib/sales/format";
import { accelBonus, achievementText, nextTier, tierRate, type Tier } from "@/lib/sales/incentives";

export interface MyAccelerator {
  enabled: boolean; tiers: Tier[]; month: string; current: { sales: number; base_cents: number };
  months: { month: string; status: string; sales: number; base_cents: number; rate: number; bonus_cents: number; pending: number; enabled: boolean }[];
}

/**
 * Monthly accelerator: this month's qualifying sales, the rate they reach and the next tier. The amount
 * is a projection until the month ends and every sale clears its 30-day refund hold.
 */
export function AcceleratorCard({ a }: { a: MyAccelerator }) {
  const n = Number(a.current.sales), rate = tierRate(a.tiers, n), next = nextTier(a.tiers, n);
  const top = Math.max(...a.tiers.map((t) => t.from));
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Monthly accelerator</h2>
        <span className="text-sm text-muted">{monthLabel(a.month)}</span>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {n} new paid sale{n === 1 ? "" : "s"} this month{rate > 0 ? `: +${rate}% on this month's sale commissions (about ${usd(accelBonus(Number(a.current.base_cents), rate))} so far, a projection)` : ""}.
        {next ? ` ${next.needed} more to reach +${next.pct}%.` : " You've reached the top rate."}
      </p>
      <ol className="mt-3 grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4" aria-label="Accelerator tiers">
        {a.tiers.map((t) => (
          <li key={t.from} className={`rounded-lg border p-2 ${n >= t.from ? "border-ok bg-ok-tint font-semibold" : "border-line"}`}>
            <span className="block text-base font-extrabold">+{t.pct}%</span>{t.from}{t.from === top ? "+" : ""} sales
          </li>
        ))}
      </ol>
      {a.months.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {a.months.slice(0, 3).map((m) => (
            <li key={m.month} className="flex justify-between gap-2 border-b border-line py-1 last:border-0">
              <span>{monthLabel(m.month)} · {m.sales} sales · {Number(m.rate)}%</span>
              <span className="text-muted">{m.status === "final" ? (m.enabled && m.bonus_cents > 0 ? `${usd(m.bonus_cents)} on your statement` : "No bonus") : m.pending > 0 ? `waiting on ${m.pending} sale${m.pending === 1 ? "" : "s"} in the 30-day hold` : "being finalized"}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">Applies to sale-month commissions only (not anniversaries). The rate is fixed once the month ends and its sales clear the 30-day refund hold; a refunded sale doesn&apos;t count. Paid on the next statement after approval.</p>
    </Card>
  );
}

export interface Best { label: string; now: number; best: number; bestMonth: string | null; hasHistory: boolean; pct: number; beaten: boolean }

/** Personal records: each measure against the rep's own best earlier month, plus recent achievements. */
export function PersonalBestsCard({ bests, achievements }: { bests: Best[]; achievements: { kind: string; month: string; value: number | null; detail: Record<string, unknown> | null }[] }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold">Personal records</h2>
      <p className="mt-1 text-sm text-ink-soft">This month against your own best month. No one else&apos;s numbers, territory or tenure are involved.</p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {bests.slice(1).map((b) => (
          <li key={b.label} className="rounded-lg border border-line p-3">
            <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-semibold">{b.label}</span>{b.beaten && <span className="text-xs font-bold text-ok">Record!</span>}</div>
            <p className="text-2xl font-extrabold">{b.now}</p>
            <p className="text-xs text-muted">{b.hasHistory ? `Best: ${b.best}${b.bestMonth ? ` in ${monthLabel(b.bestMonth)}` : ""}` : "First month with this: it sets your baseline"}</p>
          </li>
        ))}
      </ul>
      {achievements.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-bold">Recent achievements</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {achievements.slice(0, 5).map((x, i) => <li key={i} className="flex justify-between gap-2"><span>🏅 {achievementText(x.kind, x.value, x.detail)}</span><span className="shrink-0 text-xs text-muted">{monthLabel(x.month)}</span></li>)}
          </ul>
        </>
      )}
    </Card>
  );
}
