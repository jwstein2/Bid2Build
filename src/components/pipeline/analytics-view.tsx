"use client";
import { Info } from "lucide-react";
import { COLUMN_LABELS, HISTORY_STARTED, MIN_DECIDED, columnOf, valueOf, type Analytics, type BoardBid } from "@/lib/pipeline/board";
import { MetricCard, MetricFormula, MetricRecords, type MetricDrawerSpec } from "@/components/ui/metric-card";
import { money } from "./format";
import { SalesPayCalculator } from "./sales-pay";
import type { PaySettings } from "@/lib/pipeline/sales-pay";

/** Sales analytics for the selected period, counted from dated events (not from each bid's current stage). */
export function AnalyticsView({ a, rangeLabel, pay, paySaved, bids = [] }: { a: Analytics; rangeLabel: string; pay: PaySettings; paySaved: boolean; bids?: BoardBid[] }) {
  const byId = new Map(bids.map((b) => [b.id, b]));
  const list = (ids: string[], empty: string, title: string, formula?: string): MetricDrawerSpec["body"] => (
    <>
      {formula && <MetricFormula><p>{formula}</p></MetricFormula>}
      <MetricRecords title={title} empty={empty}
        rows={ids.slice(0, 50).map((id) => byId.get(id)).filter((b): b is BoardBid => Boolean(b)).map((b) => ({ key: b.id, label: b.title, detail: `${b.customer || "No customer yet"} · ${COLUMN_LABELS[columnOf(b)]}`, value: valueOf(b) === null ? "Not priced" : money(valueOf(b)!), href: `/estimates/${b.id}` }))} />
    </>
  );
  const drill: Record<string, { ids: string[]; empty: string; formula?: string }> = {
    "an-created": { ids: a.ids.created, empty: "No bids were created in this period." },
    "an-sent": { ids: a.ids.sent, empty: "No proposals were sent in this period." },
    "an-awaiting": { ids: a.ids.awaiting, empty: "No bids awaiting signature." },
    "an-won": { ids: a.ids.won, empty: "No bids were won or approved in this period." },
    "an-lost": { ids: a.ids.lost, empty: "No bids were marked lost in this period." },
    "an-winrate": { ids: [...a.ids.won, ...a.ids.lost], empty: "No bids have been won or lost in this period.", formula: `Won ÷ (won + lost) = ${a.won} ÷ ${a.decided}${a.winRate === null ? `. Shown once ${MIN_DECIDED} bids are decided.` : ` = ${a.winRate}%`}` },
    "an-wonvalue": { ids: a.ids.won, empty: "No bids were won in this period.", formula: `Sum of each won bid's signed or latest proposal total = ${money(a.wonValue)}.${a.wonUnpriced ? ` ${a.wonUnpriced} won bid${a.wonUnpriced === 1 ? " has" : "s have"} no price.` : ""}` },
    "an-avgwon": { ids: a.ids.won, empty: "No bids were won in this period.", formula: `Total won value ÷ priced won bids = ${money(a.avgWonValue)}.` },
    "an-days": { ids: a.ids.won, empty: "No bids were won in this period.", formula: `Average days from a bid's creation to its win, across ${a.daysSample} bid${a.daysSample === 1 ? "" : "s"}.` },
  };
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
        {tiles.map((t) => {
          const d = drill[t.testid];
          return (
            <MetricCard key={t.label} title={t.label} value={t.value} sub={t.sub} testId={t.testid} action={`View ${d.ids.length} bid${d.ids.length === 1 ? "" : "s"}`}
              drawer={{ id: t.testid, title: t.label, description: t.testid === "an-awaiting" ? "Right now, any period" : rangeLabel, body: list(d.ids, d.empty, "Bids", d.formula) }} />
          );
        })}
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
