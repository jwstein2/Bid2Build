import { Card } from "@/components/ui/misc";
import type { Quest } from "@/lib/sales/quests";
import { monthLabel } from "@/lib/sales/format";

export interface XpBest { now: number; best: number; bestMonth: string | null; hasHistory: boolean; pct: number; beaten: boolean }

/**
 * This month's XP against the rep's own best month (V8.4: no ranks or tiers, everyone measured only
 * against themselves), plus today's and this week's quests. XP only, no cash.
 */
export function QuestCard({ xp, quests }: { xp: XpBest; quests: Quest[] }) {
  const group = (p: "day" | "week") => quests.filter((q) => q.period === p);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">You vs. your best month</h2>
        {xp.beaten && <span className="rounded-full bg-ok-tint px-3 py-1 text-sm font-extrabold text-ok">New personal best</span>}
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {xp.now} XP this month{xp.hasHistory ? ` · your best month so far: ${xp.best} XP${xp.bestMonth ? ` (${monthLabel(xp.bestMonth)})` : ""}` : ". This is your first month, so it sets your baseline"}.
        {" "}Only your own past counts, never anyone else&apos;s.
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={xp.pct} aria-label="Progress toward your best month">
        <div className="h-full rounded-full bg-brand" style={{ width: `${xp.pct}%` }} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {(["day", "week"] as const).map((p) => (
          <div key={p}>
            <h3 className="text-sm font-bold">{p === "day" ? "Today's quests" : "This week's quests"}</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {group(p).map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-2">
                  <span className={q.complete ? "text-ink-soft line-through" : ""}>{q.complete ? "✓ " : ""}{q.label}</span>
                  <span className="shrink-0 text-xs text-muted">{q.done}/{q.goal} · {q.xp} XP</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">XP comes from follow-ups, calls, demos, tasks and paid accounts. Emails don&apos;t count.</p>
    </Card>
  );
}
