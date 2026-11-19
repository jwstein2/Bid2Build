import type { TeamGoal } from "@/lib/sales/goals";
import { monthLabel } from "@/lib/sales/format";
import { Card } from "@/components/ui/misc";

/** The team's monthly sales goal. Shown on every Sales Hub dashboard (rep portal and owner hub). */
export function TeamGoalBoard({ g }: { g: TeamGoal }) {
  const done = g.remaining === 0;
  return (
    <Card className="p-5" aria-labelledby="team-goal-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="team-goal-h" className="text-lg font-bold">Team goal for {monthLabel(g.month)}</h2>
        <span className="text-sm text-muted">{g.daysLeft} day{g.daysLeft === 1 ? "" : "s"} left</span>
      </div>
      <p className="mt-1 text-3xl font-extrabold">{g.current} <span className="text-lg font-semibold text-ink-soft">of {g.target} paid accounts</span></p>
      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={g.target} aria-valuenow={g.current} aria-label="Team goal progress">
        <div className={`h-full rounded-full ${done ? "bg-ok" : g.onPace ? "bg-brand" : "bg-warn"}`} style={{ width: `${g.pct}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-muted">Still needed</dt><dd className="font-bold">{done ? "Goal hit!" : g.remaining}</dd></div>
        <div><dt className="text-muted">Per rep</dt><dd className="font-bold">{done ? "—" : `${g.perRep} each`}</dd></div>
        <div><dt className="text-muted">Pace</dt><dd className="font-bold">{done ? "Done" : g.onPace ? "On pace" : "Behind pace"}</dd></div>
        <div><dt className="text-muted">{g.mine != null ? "Your sales" : "Last month"}</dt><dd className="font-bold">{g.mine != null ? g.mine : g.lastMonth}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-muted">
        {g.overridden ? `Target set by the owner${g.note ? `: ${g.note}` : "."}` : `Automatic target: the 3-month average (${g.base}) plus 10%, at least one more sale.`}
      </p>
    </Card>
  );
}
