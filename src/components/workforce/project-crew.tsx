import Link from "next/link";
import { HardHat, Plus } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { formatRange } from "@/lib/schedule/calendar";
import { LIFECYCLE_LABEL, LIFECYCLE_TONE, lifecycleOf } from "@/lib/workforce/model";

export interface CrewRow {
  taskId: string; task: string; start: string; end: string; taskStatus: string; status: string | null;
  resourceId: string; resource: string; kindLabel: string; company: string | null;
}

/**
 * Project page: who's assigned to this job (from the same task assignments as the Gantt), each linking
 * to their Contractors & Workforce profile, plus "Assign people" for schedule editors.
 */
export function ProjectCrew({ scheduleId, rows, canEdit, today, projectStatus }: { scheduleId: string; rows: CrewRow[]; canEdit: boolean; today: string; projectStatus: string }) {
  const byRes = new Map<string, CrewRow[]>();
  for (const r of rows) byRes.set(r.resourceId, [...(byRes.get(r.resourceId) ?? []), r]);
  return (
    <section className="mb-4 rounded-xl border border-line bg-surface p-4" aria-labelledby="project-crew-h" data-testid="project-crew">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="project-crew-h" className="flex items-center gap-2 font-display text-lg font-extrabold text-navy"><HardHat className="h-5 w-5 text-accent-ink" aria-hidden /> Assigned contractors &amp; workforce</h2>
        <span className="flex gap-2">
          {canEdit && <Link href={`/projects/workforce?assignProject=${scheduleId}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-accent px-3 text-sm font-semibold text-navy hover:bg-accent-hover" data-testid="project-crew-assign"><Plus className="h-4 w-4" aria-hidden /> Assign people</Link>}
          <Link href="/projects/workforce" className="inline-flex min-h-9 items-center text-sm font-semibold text-accent-ink hover:underline">Directory</Link>
        </span>
      </div>
      {byRes.size === 0 ? <p className="mt-2 text-sm text-muted">No one assigned yet.{canEdit ? " Assign a sub, worker or crew to a section." : ""}</p> : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[...byRes.values()].map((list) => {
            const r = list[0];
            return (
              <li key={r.resourceId} className="rounded-lg border border-line p-3" data-testid="project-crew-row">
                <Link href={`/projects/workforce?open=${r.resourceId}`} className="font-semibold text-navy hover:underline">{r.resource}</Link>
                <p className="text-xs text-ink-soft">{r.kindLabel}{r.company ? ` · ${r.company}` : ""}</p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {list.map((t) => {
                    const l = lifecycleOf({ status: t.status as never, taskStatus: t.taskStatus, projectStatus, start: t.start, end: t.end }, today);
                    return <li key={t.taskId} className="flex items-center justify-between gap-2"><span className="min-w-0 truncate">{t.task} · {formatRange(t.start, t.end)}</span><Badge tone={LIFECYCLE_TONE[l]}>{LIFECYCLE_LABEL[l]}</Badge></li>;
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
