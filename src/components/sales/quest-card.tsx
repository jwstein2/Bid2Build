import { Card } from "@/components/ui/misc";
import type { Quest } from "@/lib/sales/quests";

const RANK_STYLE: Record<string, string> = {
  Bronze: "bg-[#b0703a] text-white", Silver: "bg-[#9aa3ad] text-ink", Gold: "bg-[#d9a520] text-ink", Platinum: "bg-[#5fb3b3] text-ink", Diamond: "bg-[#3a7bd5] text-white",
};

/** Monthly rank (resets each month) plus today's and this week's quests. XP only, no cash. */
export function QuestCard({ rank, quests }: { rank: { name: string; xp: number; next: { name: string; xp: number } | null; pct: number }; quests: Quest[] }) {
  const group = (p: "day" | "week") => quests.filter((q) => q.period === p);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Your rank this month</h2>
        <span className={`rounded-full px-3 py-1 text-sm font-extrabold ${RANK_STYLE[rank.name] ?? ""}`}>{rank.name}</span>
      </div>
      <p className="mt-1 text-sm text-ink-soft">{rank.xp} XP{rank.next ? ` · ${rank.next.xp - rank.xp} XP to ${rank.next.name}` : " · Top rank!"}. Ranks reset on the 1st so everyone gets a fresh shot.</p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rank.pct} aria-label="Progress to next rank">
        <div className="h-full rounded-full bg-brand" style={{ width: `${rank.pct}%` }} />
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
