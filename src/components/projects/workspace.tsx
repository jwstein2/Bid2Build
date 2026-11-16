"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown, GanttChart, LayoutDashboard, ListTodo, RotateCcw, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { addDays, formatDay, isIsoDate } from "@/lib/schedule/calendar";
import {
  DEFAULT_FILTERS, assigneeKey, cleanFilters, filterWorkspace, isDefaultFilters, isOverviewFocus, myTasks, type Filters, type OverviewFocus, type ResourceRef, type Workspace, type WsTask,
} from "@/lib/projects/workspace";
import { api } from "@/components/schedule/client";
import { Overview } from "./overview";
import { CalendarView, type CalMode } from "./calendar";
import { TimelineView } from "./timeline";
import { WorkloadView } from "./workload";
import { MyWorkView } from "./my-work";
import { TaskDrawer, type ResourceInfo } from "./task-drawer";
import { AssignPanel } from "./assign-panel";
import type { Team } from "@/lib/projects/team";

export type View = "overview" | "calendar" | "timeline" | "workload" | "mywork";
const VIEWS: { v: View; label: string; icon: typeof LayoutDashboard; tip: string }[] = [
  { v: "overview", label: "Overview", icon: LayoutDashboard, tip: "Active projects, what needs attention and what's next" },
  { v: "calendar", label: "Calendar", icon: CalendarDays, tip: "Every project's tasks on one calendar" },
  { v: "timeline", label: "Timeline", icon: GanttChart, tip: "All projects on one timeline (Gantt)" },
  { v: "workload", label: "Workload", icon: Users, tip: "Who is booked, and any double-bookings" },
  { v: "mywork", label: "My Work", icon: ListTodo, tip: "Your tasks: today, this week and overdue" },
];
const STORE = "b2b.projects.filters.v1";

export interface WorkspaceExtras {
  /** V4.2 directory resources (empty in V4.1: assignees come from the free-text field). */
  resources?: ResourceRef[];
  resourceInfo?: Record<string, ResourceInfo>;
  myResourceKeys?: string[];
  teamHref?: string | null;
  /** Full directory, for the drawer's "Who's doing this?" panel. */
  team?: Team;
}

/**
 * Projects workspace: one filter bar over five views that all read the same pm_workspace rows. Filters
 * only narrow what the database already allowed; saved filters are cleaned against the people and
 * projects the viewer can actually see.
 */
export function ProjectsWorkspace({ initial, today, myName, extras = {} }: { initial: Workspace; today: string; myName: string; extras?: WorkspaceExtras }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [ws, setWs] = useState(initial);
  const [filters, setFilters] = useState<Filters>(() => cleanFilters(null, initial));
  const view = (VIEWS.some((x) => x.v === params.get("view")) ? params.get("view") : "overview") as View;
  const [calMode, setCalMode] = useState<CalMode>("month");
  const [anchor, setAnchor] = useState(today);
  const [open, setOpen] = useState<{ task: WsTask; start?: string; end?: string } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  // Restore saved filters (per browser) and pick a phone-friendly calendar mode.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- local storage is only readable after hydration
      if (raw) setFilters(cleanFilters(JSON.parse(raw), initial));
    } catch { /* storage unavailable */ }
    if (window.matchMedia?.("(max-width: 640px)").matches) setCalMode("agenda");
  }, [initial]);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(filters)); } catch { /* ignore */ } }, [filters]);

  const refresh = useCallback(async (from = ws.from, to = ws.to) => {
    const r = await api<Workspace>(`/api/projects/workspace?from=${from}&to=${to}`);
    if (r.ok) setWs(r.data);
  }, [ws.from, ws.to]);

  // Load more dates when the calendar moves outside what we have.
  useEffect(() => {
    if (!isIsoDate(anchor)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches the newly visible date range
    if (anchor < addDays(ws.from, 7) || anchor > addDays(ws.to, -45)) void refresh(addDays(anchor, -60), addDays(anchor, 120));
  }, [anchor, ws.from, ws.to, refresh]);

  // Overview KPI card filter lives in the URL (?focus=): Back undoes it, refresh and shared links keep it.
  const focus = isOverviewFocus(params.get("focus")) ? (params.get("focus") as OverviewFocus) : null;
  const setFocus = (f: OverviewFocus | null) => {
    const q = new URLSearchParams(params.toString());
    q.delete("view");
    if (f) q.set("focus", f); else q.delete("focus");
    router.push(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
  };
  const setView = (v: View) => {
    const q = new URLSearchParams(params.toString());
    if (v === "overview") q.delete("view"); else { q.set("view", v); q.delete("focus"); }
    router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
    setMoreOpen(false);
  };
  const people = useMemo(() => new Map(ws.people.map((p) => [p.id, p.name])), [ws.people]);
  const nameOf = useCallback((id: string | null) => (id ? people.get(id) ?? "Former member" : "Not assigned"), [people]);
  const { projects, tasks } = useMemo(() => filterWorkspace(ws, filters, today), [ws, filters, today]);
  const resources = useMemo(() => extras.resources ?? [], [extras.resources]);
  const labelOf = useCallback((t: WsTask) => {
    const k = assigneeKey(t);
    if (!k) return null;
    return resources.find((r) => r.key === k)?.label ?? t.assignee ?? null;
  }, [resources]);
  const trades = [...new Set(ws.projects.flatMap((p) => p.trades))].sort();
  const assignees = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of ws.tasks) { const k = assigneeKey(t); if (k) m.set(k, labelOf(t) ?? k); }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [ws.tasks, labelOf]);
  const project = open ? ws.projects.find((p) => p.id === open.task.scheduleId) : null;
  const set = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));
  const showRep = ws.people.length > 1;

  const primary = VIEWS.slice(0, 2), overflow = VIEWS.slice(2);
  return (
    <div className="space-y-4">
      {/* Views: segmented control; on small screens the last views move into a "More" menu. */}
      <nav aria-label="Project views" className="flex items-center gap-1 border-b border-line pb-px">
        {VIEWS.map((x, i) => (
          <button key={x.v} type="button" onClick={() => setView(x.v)} aria-current={view === x.v ? "page" : undefined} title={x.tip} data-testid={`tab-${x.v}`}
            className={cn("-mb-px flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold sm:px-3", i >= 2 && "hidden sm:flex",
              view === x.v ? "border-accent-ink text-navy" : "border-transparent text-ink-soft hover:text-navy")}>
            <x.icon className="hidden h-4 w-4 min-[380px]:block" aria-hidden />{x.label}
          </button>
        ))}
        <div className="relative sm:hidden">
          <button type="button" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} data-testid="tab-more"
            className={cn("-mb-px flex min-h-11 items-center gap-1 whitespace-nowrap border-b-2 px-2.5 text-sm font-semibold", overflow.some((x) => x.v === view) ? "border-accent-ink text-navy" : "border-transparent text-ink-soft")}>
            {overflow.find((x) => x.v === view)?.label ?? "More"} <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
          {moreOpen && (
            <ul className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-line bg-surface p-1 shadow-lg">
              {overflow.map((x) => <li key={x.v}><button type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-paper" onClick={() => setView(x.v)}><x.icon className="h-4 w-4" aria-hidden />{x.label}</button></li>)}
            </ul>
          )}
        </div>
        <span className="sr-only">{primary.length} main views</span>
      </nav>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Filters" data-testid="filters">
        {showRep && <FilterSelect label="Sold by" value={filters.rep} onChange={(v) => set({ rep: v })} testid="f-rep"
          options={[["all", "All salespeople"], ["mine", "My sales"], ...ws.people.map((p) => [p.id, p.name] as [string, string])]} />}
        {showRep && <FilterSelect label="Project manager" value={filters.pm} onChange={(v) => set({ pm: v })} testid="f-pm"
          options={[["all", "All project managers"], ["mine", "Managed by me"], ["none", "No PM yet"], ...ws.people.map((p) => [p.id, p.name] as [string, string])]} />}
        <FilterSelect label="Project" value={filters.project} onChange={(v) => set({ project: v })} testid="f-project"
          options={[["all", "All projects"], ...ws.projects.map((p) => [p.id, p.name] as [string, string])]} />
        <FilterSelect label="Status" value={filters.status} onChange={(v) => set({ status: v as Filters["status"] })} testid="f-status"
          options={[["active", "Active jobs"], ["scheduled", "Not started yet"], ["completed", "Completed"], ["all", "All"]]} />
        {trades.length > 1 && <FilterSelect label="Trade" value={filters.trade} onChange={(v) => set({ trade: v })} testid="f-trade" options={[["all", "All trades"], ...trades.map((t) => [t, t.replace(/-/g, " ")] as [string, string])]} />}
        {view !== "overview" && assignees.length > 0 && <FilterSelect label="Assigned to" value={filters.member} onChange={(v) => set({ member: v })} testid="f-member"
          options={[["all", "Everyone"], ...assignees]} />}
        {!isDefaultFilters(filters) && (
          <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-accent-ink hover:underline" data-testid="reset-filters">
            <RotateCcw className="h-4 w-4" aria-hidden /> Reset filters
          </button>
        )}
      </div>

      {view === "overview" && <Overview projects={projects} allProjects={filterWorkspace(ws, { ...filters, status: "all" }, today).projects} nameOf={nameOf} today={today} periodStart={addDays(today, -30)}
        onCalendar={(id) => { set({ project: id }); setView("calendar"); }} focus={focus} onFocus={setFocus} />}
      {view === "calendar" && <CalendarView projects={projects} tasks={tasks} today={today} anchor={anchor} setAnchor={setAnchor} mode={calMode} setMode={setCalMode}
        labelOf={labelOf} onOpen={(t) => setOpen({ task: t })}
        onDropMove={(t, day) => { const len = Math.round((Date.parse(t.plannedEnd) - Date.parse(t.plannedStart)) / 864e5); setOpen({ task: t, start: day, end: addDays(day, len) }); }} />}
      {view === "timeline" && <TimelineView projects={projects} tasks={tasks} deps={ws.deps} today={today} labelOf={labelOf} onOpen={(t) => setOpen({ task: t })} onDragEdit={(t, s, e) => setOpen({ task: t, start: s, end: e })} />}
      {view === "workload" && <WorkloadView projects={projects} tasks={tasks} resources={resources} today={today} onOpen={(t) => setOpen({ task: t })} nameOf={nameOf} teamHref={extras.teamHref} />}
      {view === "mywork" && <MyWorkView buckets={myTasks({ ...ws, projects, tasks: ws.tasks.filter((t) => projects.some((p) => p.id === t.scheduleId)) }, myName, extras.myResourceKeys ?? [], today)} projects={projects} onOpen={(t) => setOpen({ task: t })} labelOf={labelOf} />}

      <p className="text-xs text-muted">Showing scheduled tasks from {formatDay(ws.from, { month: "short", day: "numeric", year: "numeric" })} to {formatDay(ws.to, { month: "short", day: "numeric", year: "numeric" })}.</p>

      {open && project && (
        <TaskDrawer key={`${open.task.id}-${open.start ?? ""}`} task={open.task} project={project} people={people} today={today}
          resource={(() => { const k = assigneeKey(open.task); return k ? extras.resourceInfo?.[k] ?? null : null; })()}
          initialStart={open.start} initialEnd={open.end}
          extra={extras.team ? <AssignPanel task={open.task} project={project} team={extras.team} tasks={ws.tasks} people={ws.people} me={ws.me} myName={myName}
            onSaved={() => { void refresh(); router.refresh(); }} /> : undefined}
          onClose={() => setOpen(null)} onSaved={() => { void refresh(); router.refresh(); }} />
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, testid }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; testid?: string }) {
  return (
    <label className="block min-w-[9rem] flex-1 sm:flex-none">
      <span className="label">{label}</span>
      <select className="field h-10 py-0 text-sm" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
