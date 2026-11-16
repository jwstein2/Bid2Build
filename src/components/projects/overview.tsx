"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarRange, LayoutGrid, Table2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDay } from "@/lib/schedule/calendar";
import { Badge } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import {
  forecastFinish, nextAction, overviewMetrics, projectDot, projectWarning, sortProjects, type NextAction, type SortKey, type WsProject,
} from "@/lib/projects/workspace";

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "ok" }> = {
  draft: { label: "Draft", tone: "neutral" }, active: { label: "Active", tone: "accent" }, completed: { label: "Completed", tone: "ok" }, archived: { label: "Archived", tone: "neutral" },
};
const ACTION: Record<NextAction, { label: string; href: (p: WsProject) => string }> = {
  schedule_now: { label: "Schedule Now", href: (p) => `/projects/new?estimate=${p.estimateId}` },
  update_progress: { label: "Update progress", href: (p) => `/projects/${p.id}` },
  update_customer: { label: "Update customer", href: (p) => `/projects/${p.id}/update` },
  close_out: { label: "Close out", href: (p) => `/projects/${p.id}#closeout` },
  view: { label: "View project", href: (p) => `/projects/${p.id}` },
};

export function Overview({ projects, allProjects, nameOf, today, periodStart, onCalendar }: {
  projects: WsProject[]; allProjects: WsProject[]; nameOf: (id: string | null) => string; today: string; periodStart: string; onCalendar: (projectId: string) => void;
}) {
  const [layout, setLayout] = useState<"cards" | "table">("cards");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "start", dir: 1 });
  const m = overviewMetrics(allProjects, today, periodStart);
  const metrics = [
    { label: "Active projects", value: m.active, hint: "Not yet completed" },
    { label: "Starting in 2 weeks", value: m.startingSoon, hint: "Planned starts in the next 14 days" },
    { label: "Delayed", value: m.delayed, hint: "Projects with a delayed task or a task past its planned finish", warn: m.delayed > 0 },
    { label: "Customer update due", value: m.needsUpdate, hint: "The schedule changed since the customer last saw it", warn: m.needsUpdate > 0 },
    { label: "Completed (30 days)", value: m.completed, hint: "Projects closed out in the last 30 days" },
  ];
  const list = sortProjects(projects, sort.key, sort.dir, nameOf);
  const th = (key: SortKey, label: string) => (
    <th scope="col" className="px-3 py-2 text-left" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 font-semibold" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}{sort.key === key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-4" data-testid="view-overview">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Key numbers">
        {metrics.map((x) => (
          <li key={x.label} className="rounded-xl border border-line bg-surface p-3" title={x.hint} data-testid="metric">
            <p className="text-xs font-semibold text-ink-soft">{x.label}</p>
            <p className={cn("mt-1 font-display text-2xl font-extrabold", x.warn ? "text-warn" : "text-navy")}>{x.value}</p>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold text-navy">{projects.length} project{projects.length === 1 ? "" : "s"}</h2>
        <div className="inline-flex rounded-lg border border-line p-0.5" role="group" aria-label="Layout">
          <button type="button" aria-pressed={layout === "cards"} onClick={() => setLayout("cards")} className={cn("inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-sm font-semibold", layout === "cards" ? "bg-navy text-white" : "text-ink-soft")}><LayoutGrid className="h-4 w-4" aria-hidden /> Cards</button>
          <button type="button" aria-pressed={layout === "table"} onClick={() => setLayout("table")} className={cn("inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-sm font-semibold", layout === "table" ? "bg-navy text-white" : "text-ink-soft")} data-testid="layout-table"><Table2 className="h-4 w-4" aria-hidden /> Table</button>
        </div>
      </div>

      {projects.length === 0 && <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">No projects match these filters.</p>}

      {layout === "cards" ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {list.map((p) => {
            const warn = projectWarning(p, today);
            const act = ACTION[nextAction(p, today)];
            const st = STATUS[p.status] ?? STATUS.draft;
            return (
              <li key={p.id} className="flex flex-col rounded-xl border border-line bg-surface p-4" data-testid="project-card">
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={projectDot(p.id)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Link href={`/projects/${p.id}`} className="font-semibold text-navy hover:underline">{p.name}</Link>
                    <p className="text-sm text-ink-soft">{p.customerName || "—"}</p>
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {p.provisional && <Badge tone="warn">Provisional</Badge>}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <div><dt className="text-xs text-muted">Sold by</dt><dd>{nameOf(p.salesRepId)}</dd></div>
                  <div><dt className="text-xs text-muted">Project manager</dt><dd>{nameOf(p.projectManagerId)}</dd></div>
                  <div><dt className="text-xs text-muted">Start</dt><dd>{formatDay(p.startDate, { month: "short", day: "numeric", year: "numeric" })}</dd></div>
                  <div><dt className="text-xs text-muted">{p.status === "completed" ? "Finished" : "Forecast finish"}</dt><dd>{forecastFinish(p) ? formatDay(forecastFinish(p)!, { month: "short", day: "numeric", year: "numeric" }) : "—"}</dd></div>
                </dl>
                <div className="mt-3">
                  <div className="flex justify-between text-xs"><span className="text-muted">Progress</span><span className="font-bold text-navy">{p.progress}%</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-paper"><div className="h-1.5 rounded-full bg-teal" style={{ width: `${p.progress}%` }} /></div>
                </div>
                {warn && <p className="mt-2 flex items-center gap-1 text-sm font-semibold text-warn"><AlertTriangle className="h-4 w-4" aria-hidden />{warn}</p>}
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                  <ButtonLink href={act.href(p)} size="sm" variant={act.label === "View project" ? "secondary" : "accent"}>{act.label}</ButtonLink>
                  {act.label !== "View project" && <ButtonLink href={`/projects/${p.id}`} size="sm" variant="secondary">View project</ButtonLink>}
                  <button type="button" className="inline-flex min-h-9 items-center gap-1 px-2 text-sm font-semibold text-accent-ink hover:underline" onClick={() => onCalendar(p.id)}><CalendarRange className="h-4 w-4" aria-hidden /> Calendar</button>
                  {p.permissions.publish && p.status !== "completed" && act.label !== "Update customer" && <Link href={`/projects/${p.id}/update`} className="inline-flex min-h-9 items-center px-2 text-sm font-semibold text-accent-ink hover:underline">Preview customer update</Link>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface" data-testid="project-table">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>{th("name", "Project")}{th("customer", "Customer")}{th("rep", "Sold by")}{th("pm", "PM")}{th("status", "Status")}{th("start", "Start")}{th("finish", "Finish")}{th("progress", "Progress")}<th scope="col" className="px-3 py-2 text-left">Attention</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((p) => (
                <tr key={p.id} data-testid="project-row">
                  <td className="px-3 py-2"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={projectDot(p.id)} aria-hidden /><Link href={`/projects/${p.id}`} className="font-semibold text-navy hover:underline">{p.name}</Link></td>
                  <td className="px-3 py-2">{p.customerName || "—"}</td>
                  <td className="px-3 py-2">{nameOf(p.salesRepId)}</td>
                  <td className="px-3 py-2">{nameOf(p.projectManagerId)}</td>
                  <td className="px-3 py-2">{STATUS[p.status]?.label ?? p.status}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDay(p.startDate)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{forecastFinish(p) ? formatDay(forecastFinish(p)!) : "—"}</td>
                  <td className="px-3 py-2">{p.progress}%</td>
                  <td className="px-3 py-2 text-warn">{projectWarning(p, today) ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
