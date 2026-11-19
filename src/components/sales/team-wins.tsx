import Link from "next/link";
import { Card } from "@/components/ui/misc";

const TEXT: Record<string, string> = { onboarding_complete: "got a customer through onboarding", first_sale: "made their first sale", record_sales: "set a personal sales record" };

/** Wins from teammates who chose public recognition. No amounts, no ranking. */
export function TeamWins({ wins, optedIn }: { wins: { rep: string; kind: string; at: string; mine: boolean }[]; optedIn: boolean }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold">Team wins</h2>
      <p className="text-xs text-muted">From teammates who chose to share. Last 14 days.</p>
      {wins.length === 0 ? <p className="mt-2 text-sm text-ink-soft">Nothing shared yet.</p> : (
        <ul className="mt-2 space-y-1 text-sm">{wins.slice(0, 8).map((w, i) => <li key={i}><span className="font-semibold">{w.mine ? "You" : w.rep}</span> {TEXT[w.kind] ?? "had a win"}</li>)}</ul>
      )}
      {!optedIn && <p className="mt-2 text-xs text-muted">Your wins stay private. <Link href="/sales/preferences" className="underline">Change in My preferences</Link>.</p>}
    </Card>
  );
}
