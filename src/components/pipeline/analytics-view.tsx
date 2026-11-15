"use client";
import { Info } from "lucide-react";
import { HISTORY_STARTED, MIN_DECIDED, type Analytics } from "@/lib/pipeline/board";
import { Card } from "@/components/ui/misc";
import { money } from "./format";
import { SalesPayCalculator } from "./sales-pay";
import type { PaySettings } from "@/lib/pipeline/sales-pay";

/** Sales analytics for the selected period, counted from dated events (not from each bid's current stage). */
export function AnalyticsView({ a, rangeLabel, pay, paySaved }: { a: Analytics; rangeLabel: string; pay: PaySettings; paySaved: boolean }) {
  const tiles: { label: string; value: string; sub: string; testid: string }[] = [
    { label: "Bids created", value: String(a.created), sub: "Created in this period", testid: "an-created" },
    { label: "Proposals sent", value: String(a.sent), sub: "First sent in this period (marked Sent or signing link)", testid: "an-sent" },
    { label: "Awaiting signature", value: String(a.awaitingNow), sub: "Right now, any period", testid: "an-awaiting" },
    { label: "Approved / won", value: String(a.won), sub: a.won ? `${a.wonViaEsign} e-signed · ${a.wonManual} approved manually` : "Won in this period", testid: "an-won" },
    { label: "Lost / declined", value: String(a.lost), sub: "Marked lost in this period", testid: "an-lost" },
    {
      label: "Win rate", testid: "an-winrate",
      value: a.winRate === null ? "—" : `${a.winRate}%`,
      sub: a.winRate === null ? `${a.won} won of ${a.decided} decided. Shown once ${MIN_DECIDED} bids are decided.` : `${a.won} won of ${a.decided} decided (won + lost)`,
    },
    { label: "Total won value", value: money(a.wonValue), sub: a.wonUnpriced ? `${a.wonUnpriced} won bid${a.wonUnpriced === 1 ? "" : "s"} had no price` : "Signed or latest proposal totals", testid: "an-wonvalue" },
    { label: "Average won project", value: money(a.avgWonValue), sub: a.won ? `Across ${a.won - a.wonUnpriced} priced won bid${a.won - a.wonUnpriced === 1 ? "" : "s"}` : "No won bids yet", testid: "an-avgwon" },
    { label: "Avg. time to approval", value: a.avgDaysToWin === null ? "—" : `${a.avgDaysToWin} days`, sub: a.daysSample ? `Created → won, ${a.daysSample} bid${a.daysSample === 1 ? "" : "s"}` : "No won bids yet", testid: "an-days" },
  ];
  return (
    <div className="space-y-4" data-testid="pipeline-analytics">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.label} className="p-4" data-testid={t.testid}>
            <p className="text-sm text-muted">{t.label}</p>
            <p className="tabular text-2xl font-extrabold text-navy">{t.value}</p>
            <p className="mt-1 text-xs text-muted">{t.sub}</p>
          </Card>
        ))}
      </div>
      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {rangeLabel}. Each bid counts once per measure: a bid&apos;s outcome is its latest decision (won or lost) and is counted in the period it happened.
          Stage moves are recorded from {new Date(`${HISTORY_STARTED}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}; earlier sends without a signing link aren&apos;t counted.
          Drafts that were never exported have no price and are never counted as revenue.
        </span>
      </p>
      <SalesPayCalculator wonBids={a.wonBids} initial={pay} saved={paySaved} />
    </div>
  );
}
