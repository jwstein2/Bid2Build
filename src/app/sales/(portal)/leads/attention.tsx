import Link from "next/link";
import { Badge, Card } from "@/components/ui/misc";
import { untilLabel } from "@/lib/sales/leads-admin";

export interface Attention {
  settings: { enabled: boolean; days: number; grace: number; warning_hours: number };
  away: boolean;
  new: { id: string; company_name: string; city: string | null; state: string | null; deadline: string; warned: boolean; protected: string | null }[];
  approaching: { id: string; company_name: string; rule: string; deadline: string }[];
  due_today: { id: string; lead_id: string; company_name: string; title: string; due_at: string }[];
  overdue: { id: string; lead_id: string; company_name: string; title: string; due_at: string }[];
  replies: { id: string; company_name: string; at: string }[];
}

type Item = { key: string; href: string; name: string; detail: string; tone: "danger" | "warn" | "brand" | "neutral" };

/** V8.7 "My leads requiring attention": supportive, action-first, private to the rep. */
export function AttentionCard({ data, compact = false }: { data: Attention; compact?: boolean }) {
  const groups: { title: string; hint: string; items: Item[] }[] = [
    { title: "They replied", hint: "Answer these first.", items: data.replies.map((r) => ({ key: `r${r.id}`, href: `/sales/leads/${r.id}`, name: r.company_name, detail: "New reply", tone: "brand" as const })) },
    { title: "Going back to the team soon", hint: "A call, sent email or booked meeting keeps them with you.", items: data.approaching.map((a) => ({ key: `a${a.id}`, href: `/sales/leads/${a.id}#log`, name: a.company_name, detail: `Moves ${untilLabel(a.deadline)}`, tone: "danger" as const })) },
    { title: "Overdue follow-ups", hint: `Catch up within ${data.settings.grace} days of the due date.`, items: data.overdue.map((t) => ({ key: `o${t.id}`, href: `/sales/leads/${t.lead_id}`, name: t.company_name, detail: t.title, tone: "warn" as const })) },
    { title: "Due today", hint: "", items: data.due_today.map((t) => ({ key: `d${t.id}`, href: `/sales/leads/${t.lead_id}`, name: t.company_name, detail: t.title, tone: "neutral" as const })) },
    { title: "New leads waiting for a first contact", hint: `You have ${data.settings.days} days from assignment.`, items: data.new.filter((n) => !n.warned).map((n) => ({ key: `n${n.id}`, href: `/sales/leads/${n.id}#log`, name: n.company_name, detail: `First contact due ${untilLabel(n.deadline)}`, tone: "neutral" as const })) },
  ].filter((g) => g.items.length > 0);
  const total = groups.reduce((t, g) => t + g.items.length, 0);

  return (
    <Card className="p-5" id="attention">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">My leads requiring attention</h2>
        {total > 0 && <Badge tone="neutral">{total}</Badge>}
      </div>
      {data.away && <p className="mt-1 text-sm text-muted">You&apos;re on time off. Your leads won&apos;t be recycled and you won&apos;t get new ones until you&apos;re back.</p>}
      {total === 0 ? <p className="mt-2 text-sm text-muted">You&apos;re all caught up. Nice work.</p> : (
        <div className="mt-2 space-y-3">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="text-sm font-semibold">{g.title} ({g.items.length}){g.hint && <span className="font-normal text-muted"> · {g.hint}</span>}</p>
              <ul className="mt-1 divide-y divide-line text-sm">
                {g.items.slice(0, compact ? 3 : 10).map((i) => (
                  <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <Link href={i.href} className="font-semibold underline">{i.name}</Link>
                    <Badge tone={i.tone}>{i.detail}</Badge>
                  </li>
                ))}
              </ul>
              {g.items.length > (compact ? 3 : 10) && <p className="text-xs text-muted">and {g.items.length - (compact ? 3 : 10)} more</p>}
            </div>
          ))}
        </div>
      )}
      {data.settings.enabled && !compact && (
        <p className="mt-3 text-xs text-muted">
          Company leads with no call, sent email, reply or meeting within {data.settings.days} days go to another rep, after a {data.settings.warning_hours}-hour heads-up.
          Notes and failed emails don&apos;t count. If a lead was worked in a way that isn&apos;t logged, ask for a review on the lead&apos;s page.
        </p>
      )}
      {compact && total > 0 && <Link href="/sales/leads#attention" className="mt-2 inline-block text-sm font-semibold text-brand underline">See all</Link>}
    </Card>
  );
}
