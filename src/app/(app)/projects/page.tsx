import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarRange, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { formatDay, formatRange } from "@/lib/schedule/calendar";
import { listSchedules, readyToSchedule } from "@/lib/schedule/server";
import { loadPmAccess } from "@/lib/pm/server";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Projects", robots: { index: false } };

const STATUS: Record<string, string> = { draft: "Draft", active: "Active", completed: "Completed" };

/** Projects: every schedule the account can see, plus accepted bids that are ready to schedule. */
export default async function ProjectsPage() {
  if (!isPmEnabled()) notFound();
  const supabase = await createClient();
  const [list, pm] = await Promise.all([listSchedules(supabase), loadPmAccess(supabase)]);
  const ready = list ? await readyToSchedule(supabase, new Set(list.map((s) => s.estimate_id))) : [];
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-extrabold text-navy"><CalendarRange className="h-7 w-7 text-accent-ink" aria-hidden /> Projects</h1>
        <p className="mt-1 text-ink-soft">Turn won bids into job schedules built from the estimate, then track progress.</p>
      </div>
      {list === null && <Notice tone="warn" title="Project Command Center is being set up">The database update for schedules hasn&apos;t been applied yet.</Notice>}
      {pm && !pm.canEdit && (
        <Notice title="View only">
          {pm.scope === "company" ? "Ask your company admin for a scheduling editor seat to create or edit schedules." : <>Creating and editing schedules needs Project Command Center. <Link href="/settings/billing" className="font-semibold underline">Unlock Project Command Center</Link></>}
        </Notice>
      )}

      <section aria-labelledby="sched-h">
        <h2 id="sched-h" className="font-display text-lg font-extrabold text-navy">Schedules</h2>
        {list && list.length === 0 && <p className="mt-2 text-sm text-muted">No schedules yet. Choose Schedule Now on a won bid below.</p>}
        <ul className="mt-2 space-y-2">
          {(list ?? []).map((s) => (
            <li key={s.id}>
              <Link href={`/projects/${s.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:border-accent-ink" data-testid="schedule-card">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-navy">{s.name}
                    <Badge tone={s.status === "active" ? "accent" : s.status === "completed" ? "ok" : "neutral"}>{STATUS[s.status] ?? s.status}</Badge>
                    {s.provisional && <Badge tone="warn">Provisional</Badge>}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-soft">{s.customer_name ? `${s.customer_name} · ` : ""}{s.finish_date ? formatRange(s.start_date, s.finish_date) : formatDay(s.start_date)}</p>
                </div>
                <div className="w-32">
                  <p className="text-right text-sm font-bold text-navy">{s.progress ?? 0}%</p>
                  <div className="mt-1 h-1.5 rounded-full bg-paper"><div className="h-1.5 rounded-full bg-teal" style={{ width: `${s.progress ?? 0}%` }} /></div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {ready.length > 0 && (
        <section aria-labelledby="ready-h">
          <h2 id="ready-h" className="font-display text-lg font-extrabold text-navy">Ready to schedule</h2>
          <p className="text-sm text-ink-soft">Won or signed bids without a schedule.</p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
            {ready.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 p-3" data-testid="ready-bid">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-navy">{b.title || "Untitled bid"}</p>
                  <p className="text-sm text-ink-soft">{b.customer_name || "—"}{b.estimate_number ? ` · ${b.estimate_number}` : ""}{b.signed ? " · Signed" : ""}</p>
                </div>
                {pm?.canEdit && <ButtonLink href={`/projects/new?estimate=${b.id}`} size="sm" variant="accent">Schedule Now</ButtonLink>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
