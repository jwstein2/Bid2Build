"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, HardHat, User, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { addDays, formatDay, formatRange } from "@/lib/schedule/calendar";
import { findResourceConflicts, projectDot, startOfWeek, workloadRows, type ResourceRef, type WsProject, type WsTask } from "@/lib/projects/workspace";

const KIND_ICON = { staff: User, subcontractor: HardHat, crew: Users, text: User } as const;
const KIND_LABEL = { staff: "Staff", subcontractor: "Subcontractor", crew: "Crew", text: "Assignee" } as const;

/**
 * Workload: who is booked on what, by week, from real task assignments. A resource on several projects
 * is not a problem by itself; only overlapping days beyond declared capacity (default one job at a time)
 * or work on a day marked unavailable is flagged. Without capacity we show booked days, never a made-up
 * utilization percentage. Nothing is rescheduled automatically.
 */
export function WorkloadView({ projects, tasks, resources, today, onOpen, nameOf, teamHref }: {
  projects: WsProject[]; tasks: WsTask[]; resources: ResourceRef[]; today: string; onOpen: (t: WsTask) => void; nameOf: (id: string | null) => string; teamHref?: string | null;
}) {
  const [week, setWeek] = useState(startOfWeek(today));
  const [weeks, setWeeks] = useState(2);
  const from = week, to = addDays(week, weeks * 7 - 1);
  const rows = workloadRows(tasks, projects, resources, from, to);
  const conflicts = findResourceConflicts(tasks, projects, resources).filter((c) => c.until >= from && c.day <= to);
  const projName = new Map(projects.map((p) => [p.id, p]));
  const pmLoad = new Map<string, number>();
  for (const p of projects) if (p.status !== "completed" && p.projectManagerId) pmLoad.set(p.projectManagerId, (pmLoad.get(p.projectManagerId) ?? 0) + 1);

  return (
    <div className="space-y-4" data-testid="view-workload">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setWeek(addDays(week, -7))} className="grid h-9 w-9 place-items-center rounded-lg border border-line" aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" onClick={() => setWeek(startOfWeek(today))} className="min-h-9 rounded-lg border border-line px-3 text-sm font-semibold">This week</button>
        <button type="button" onClick={() => setWeek(addDays(week, 7))} className="grid h-9 w-9 place-items-center rounded-lg border border-line" aria-label="Next week"><ChevronRight className="h-4 w-4" /></button>
        <h2 className="font-display text-lg font-extrabold text-navy">{formatRange(from, to)}</h2>
        <label className="ml-auto text-sm"><span className="sr-only">Weeks shown</span>
          <select className="field h-9 py-0" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}><option value={1}>1 week</option><option value={2}>2 weeks</option><option value={4}>4 weeks</option></select>
        </label>
      </div>

      <section aria-labelledby="conf-h" className={cn("rounded-xl border p-4", conflicts.length ? "border-warn/50 bg-warn-tint" : "border-line bg-surface")} data-testid="conflicts" data-guide="projects.conflicts">
        <h3 id="conf-h" className="flex items-center gap-2 font-semibold text-navy"><AlertTriangle className={cn("h-4 w-4", conflicts.length ? "text-warn" : "text-muted")} aria-hidden />
          {conflicts.length ? `${conflicts.length} possible double-booking${conflicts.length === 1 ? "" : "s"}` : "No double-bookings found"}</h3>
        {!conflicts.length && <p className="mt-1 text-sm text-ink-soft">Checked every assigned task in this range. Unassigned tasks and overlapping work within one project aren&apos;t conflicts.</p>}
        <ul className="mt-2 space-y-2">
          {conflicts.map((c) => (
            <li key={`${c.resourceKey}-${c.day}-${c.kind}`} className="rounded-lg border border-warn/40 bg-surface p-3 text-sm" data-testid="conflict">
              <p className="font-semibold">{c.resource} · {c.day === c.until ? formatDay(c.day, { weekday: "short", month: "short", day: "numeric" }) : formatRange(c.day, c.until)}</p>
              <p className="text-ink-soft">{c.kind === "unavailable" ? "Scheduled on a day marked unavailable:" : "Booked on more than one job at once:"}</p>
              <ul className="mt-1 space-y-0.5">{c.tasks.map((t) => (
                <li key={t.id}><button type="button" className="text-left text-accent-ink underline" onClick={() => { const x = tasks.find((z) => z.id === t.id); if (x) onOpen(x); }}>{t.projectName}: {t.name}</button></li>
              ))}</ul>
              <p className="mt-1 text-xs text-muted">Options: move one task, assign someone else, or leave it if the crew can split the day. Nothing changes until you choose.</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[40rem] text-sm" data-testid="workload-table" data-guide="projects.workload-table">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr><th scope="col" className="px-3 py-2">Who</th><th scope="col" className="px-3 py-2">Booked days</th><th scope="col" className="px-3 py-2">Projects</th><th scope="col" className="px-3 py-2">Tasks</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">Nothing scheduled in this range.</td></tr>}
            {rows.map((r) => {
              const Icon = KIND_ICON[r.kind];
              return (
                <tr key={r.key} className="align-top" data-testid="workload-row">
                  <td className="px-3 py-2"><span className="flex items-center gap-2 font-semibold"><Icon className="h-4 w-4 text-muted" aria-hidden />{r.label}</span>
                    {r.key !== "unassigned" && <span className="text-xs text-muted">{KIND_LABEL[r.kind]}</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.days} day{r.days === 1 ? "" : "s"}{r.capacityDays ? <span className="text-muted"> of {r.capacityDays} available</span> : null}</td>
                  <td className="px-3 py-2">{r.projects}</td>
                  <td className="px-3 py-2">
                    <ul className="space-y-0.5">{r.tasks.slice(0, 8).map((t) => (
                      <li key={t.id}><button type="button" onClick={() => onOpen(t)} className="flex items-center gap-1.5 text-left hover:underline">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={projectDot(t.scheduleId)} aria-hidden />{projName.get(t.scheduleId)?.name}: {t.name} <span className="text-xs text-muted">({formatRange(t.plannedStart, t.plannedEnd)})</span>
                      </button></li>
                    ))}{r.tasks.length > 8 && <li className="text-xs text-muted">+{r.tasks.length - 8} more</li>}</ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pmLoad.size > 0 && (
        <section aria-labelledby="pm-h" className="rounded-xl border border-line bg-surface p-4">
          <h3 id="pm-h" className="font-semibold text-navy">Active projects per project manager</h3>
          <p className="text-xs text-muted">Managing several projects at once is normal and isn&apos;t flagged.</p>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">{[...pmLoad.entries()].map(([id, n]) => <li key={id} className="rounded-full bg-paper px-3 py-1"><strong>{nameOf(id)}</strong> · {n}</li>)}</ul>
        </section>
      )}
      {teamHref
        ? <p className="text-xs text-muted">Add crews, staff and subcontractors with availability in <Link href={teamHref} className="font-semibold text-accent-ink underline">Team &amp; Subcontractors</Link> to check capacity.</p>
        : <p className="text-xs text-muted">Assignees come from each task&apos;s &quot;Assigned to&quot; field. Capacity isn&apos;t set up, so booked days are shown instead of percentages.</p>}
    </div>
  );
}
