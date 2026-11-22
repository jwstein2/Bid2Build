"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CalendarDays, ChevronDown, GanttChart, LayoutDashboard, ListTodo, RotateCcw, Users, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { menuKeyDown, useDismiss } from "@/components/ui/use-dismiss";
import { addDays, formatDay, isIsoDate } from "@/lib/schedule/calendar";
import {
  DEFAULT_FILTERS, assigneeKey, cleanFilters, filterWorkspace, isDefaultFilters, isOverviewFocus, myTasks, type Filters, type OverviewFocus, type ResourceRef, type Workspace, type WsTask,
} from "@/lib/projects/workspace";
import { api } from "@/components/schedule/client";
import { CONTEXT_KEYS, calendarHref, readCalendarContext, type CalendarContext } from "@/lib/projects/calendar-link";
import { Overview } from "./overview";
import { CalendarView, type CalMode } from "./calendar";
import { TimelineView } from "./timeline";
import { WorkloadView } from "./workload";
import { MyWorkView } from "./my-work";
import { TaskDrawer, type ResourceInfo } from "./task-drawer";
import { AssignPanel } from "./assign-panel";
import type { Team } from "@/lib/projects/team";

export type View = "overview" | "calendar" | "timeline" | "workload" | "mywork";
/** Page walkthrough per view (src/lib/features/page-guides.ts): the active view decides what it teaches. */
const GUIDE_PAGE = { overview: "projects.overview", calendar: "projects.calendar", timeline: "projects.timeline", workload: "projects.workload", mywork: "projects.mywork" } as const satisfies Record<View, string>;
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
  // "Open schedule" links anywhere in the app land here with optional context (project, date, task,
  // member, mode; see src/lib/projects/calendar-link.ts). Context narrows the view for this visit only:
  // it never overwrites the filters the user saved.
  const ctx = useMemo(() => readCalendarContext(params), [params]);
  const ctxProject = ctx.project ? ws.projects.find((p) => p.id === ctx.project) ?? null : null;
  const [calMode, setCalMode] = useState<CalMode>(ctx.mode ?? "month");
  const [anchor, setAnchor] = useState(() => contextAnchor(ctx, initial, today) ?? today);
  // A new link while already on this page (e.g. from the notification bell) moves the calendar again.
  const ctxKey = `${ctx.project}|${ctx.task}|${ctx.date}|${ctx.mode}`;
  const [appliedKey, setAppliedKey] = useState(ctxKey);
  if (appliedKey !== ctxKey) {
    setAppliedKey(ctxKey);
    const a = contextAnchor(ctx, ws, today);
    if (a) setAnchor(a);
    if (ctx.mode) setCalMode(ctx.mode);
  }
  const initialMode = useRef(ctx.mode);
  const [open, setOpen] = useState<{ task: WsTask; start?: string; end?: string } | null>(null);

  // Restore saved filters (per browser) and pick a phone-friendly calendar mode.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- local storage is only readable after hydration
      if (raw) setFilters(cleanFilters(JSON.parse(raw), initial));
    } catch { /* storage unavailable */ }
    if (!initialMode.current && window.matchMedia?.("(max-width: 640px)").matches) setCalMode("agenda");
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
  };
  const people = useMemo(() => new Map(ws.people.map((p) => [p.id, p.name])), [ws.people]);
  const nameOf = useCallback((id: string | null) => (id ? people.get(id) ?? "Former member" : "Not assigned"), [people]);
  // Filters actually applied: the saved ones, narrowed by link context (a linked project shows whatever its status).
  const effective = useMemo<Filters>(() => ({
    ...filters,
    ...(ctxProject ? { project: ctxProject.id, status: "all" as const } : {}),
    ...(ctx.member ? { member: ctx.member } : {}),
  }), [filters, ctxProject, ctx.member]);
  const { projects, tasks } = useMemo(() => filterWorkspace(ws, effective, today), [ws, effective, today]);
  const resources = useMemo(() => extras.resources ?? [], [extras.resources]);
  const resourceLabel = useMemo(() => new Map(resources.map((r) => [r.key, r.label])), [resources]);
  const labelOf = useCallback((t: WsTask) => {
    const k = assigneeKey(t);
    if (!k) return null;
    return resourceLabel.get(k) ?? t.assignee ?? null;
  }, [resourceLabel]);
  // Overview needs every status too; computed once per change instead of on every render.
  const allProjects = useMemo(() => filterWorkspace(ws, { ...effective, status: "all" }, today).projects, [ws, effective, today]);
  const myWorkTasks = useMemo(() => { const ids = new Set(projects.map((p) => p.id)); return ws.tasks.filter((t) => ids.has(t.scheduleId)); }, [ws.tasks, projects]);
  const trades = [...new Set(ws.projects.flatMap((p) => p.trades))].sort();
  const assignees = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of ws.tasks) { const k = assigneeKey(t); if (k) m.set(k, labelOf(t) ?? k); }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [ws.tasks, labelOf]);
  const project = open ? ws.projects.find((p) => p.id === open.task.scheduleId) : null;
  const clearContext = useCallback((keys: readonly string[] = CONTEXT_KEYS) => {
    const q = new URLSearchParams(params.toString());
    for (const k of keys) q.delete(k);
    router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
  }, [params, pathname, router]);
  const set = (p: Partial<Filters>) => {
    // Changing a filter the link set hands it back to the user: drop that context from the URL.
    const drop = [...(ctxProject && ("project" in p || "status" in p) ? ["project", "task"] : []), ...(ctx.member && "member" in p ? ["member"] : [])];
    if (drop.length) {
      if (ctxProject && !("project" in p)) p = { project: ctxProject.id, ...p };
      clearContext(drop);
    }
    setFilters((f) => ({ ...f, ...p }));
  };
  const showRep = ws.people.length > 1;

  const primary = VIEWS.slice(0, 2), overflow = VIEWS.slice(2);
  return (
    <div className="space-y-4" data-guide-page={GUIDE_PAGE[view]} data-guide-trade={trades.join(" ")}>
      {/* Views: segmented control; below lg (where the sidebar leaves little room) the last views move into a "More" menu. */}
      <nav aria-label="Project views" className="flex items-center gap-1 border-b border-line pb-px" data-guide="projects.views">
        {VIEWS.map((x, i) => (
          <button key={x.v} type="button" onClick={() => setView(x.v)} aria-current={view === x.v ? "page" : undefined} title={x.tip} data-testid={`tab-${x.v}`}
            className={cn("-mb-px flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold sm:px-3", i >= 2 && "hidden lg:flex",
              view === x.v ? "border-accent-ink text-navy" : "border-transparent text-ink-soft hover:text-navy")}>
            <x.icon className="hidden h-4 w-4 min-[380px]:block" aria-hidden />{x.label}
          </button>
        ))}
        <MoreViews views={overflow} view={view} setView={setView} />
        <span className="sr-only">{primary.length} main views</span>
      </nav>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Filters" data-testid="filters" data-guide="projects.filters">
        {showRep && <FilterSelect label="Sold by" value={effective.rep} onChange={(v) => set({ rep: v })} testid="f-rep"
          options={[["all", "All salespeople"], ["mine", "My sales"], ...ws.people.map((p) => [p.id, p.name] as [string, string])]} />}
        {showRep && <FilterSelect label="Project manager" value={effective.pm} onChange={(v) => set({ pm: v })} testid="f-pm"
          options={[["all", "All project managers"], ["mine", "Managed by me"], ["none", "No PM yet"], ...ws.people.map((p) => [p.id, p.name] as [string, string])]} />}
        <FilterSelect label="Project" value={effective.project} onChange={(v) => set({ project: v })} testid="f-project"
          options={[["all", "All projects"], ...ws.projects.map((p) => [p.id, p.name] as [string, string])]} />
        <FilterSelect label="Status" value={effective.status} onChange={(v) => set({ status: v as Filters["status"] })} testid="f-status"
          options={[["active", "Active jobs"], ["scheduled", "Not started yet"], ["completed", "Completed"], ["all", "All"]]} />
        {trades.length > 1 && <FilterSelect label="Trade" value={effective.trade} onChange={(v) => set({ trade: v })} testid="f-trade" options={[["all", "All trades"], ...trades.map((t) => [t, t.replace(/-/g, " ")] as [string, string])]} />}
        {view !== "overview" && assignees.length > 0 && <FilterSelect label="Assigned to" value={effective.member} onChange={(v) => set({ member: v })} testid="f-member"
          options={[["all", "Everyone"], ...assignees]} />}
        {(!isDefaultFilters(filters) || ctxProject || ctx.member) && (
          <button type="button" onClick={() => { setFilters(DEFAULT_FILTERS); if (ctxProject || ctx.member) clearContext(); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-accent-ink hover:underline" data-testid="reset-filters">
            <RotateCcw className="h-4 w-4" aria-hidden /> Reset filters
          </button>
        )}
      </div>

      {view === "overview" && <Overview projects={projects} allProjects={allProjects} nameOf={nameOf} today={today} periodStart={addDays(today, -30)}
        onCalendar={(id) => router.push(calendarHref({ project: id }), { scroll: false })} focus={focus} onFocus={setFocus} />}
      {view === "calendar" && <ContextBanner ctx={ctx} project={ctxProject} memberLabel={ctx.member ? assignees.find(([k]) => k === ctx.member)?.[1] ?? null : null} onClear={() => clearContext()} />}
      {view === "calendar" && <CalendarView projects={projects} tasks={tasks} today={today} anchor={anchor} setAnchor={setAnchor} mode={calMode} setMode={setCalMode}
        labelOf={labelOf} onOpen={(t) => setOpen({ task: t })} highlight={ctx.task}
        onDropMove={(t, day) => { const len = Math.round((Date.parse(t.plannedEnd) - Date.parse(t.plannedStart)) / 864e5); setOpen({ task: t, start: day, end: addDays(day, len) }); }} />}
      {view === "timeline" && <TimelineView projects={projects} tasks={tasks} deps={ws.deps} today={today} labelOf={labelOf} onOpen={(t) => setOpen({ task: t })} onDragEdit={(t, s, e) => setOpen({ task: t, start: s, end: e })} />}
      {view === "workload" && <WorkloadView projects={projects} tasks={tasks} resources={resources} today={today} onOpen={(t) => setOpen({ task: t })} nameOf={nameOf} teamHref={extras.teamHref} />}
      {view === "mywork" && <MyWorkView buckets={myTasks({ ...ws, projects, tasks: myWorkTasks }, myName, extras.myResourceKeys ?? [], today)} projects={projects} onOpen={(t) => setOpen({ task: t })} labelOf={labelOf} />}

      <p className="text-xs text-muted">Showing scheduled tasks from {formatDay(ws.from, { month: "short", day: "numeric", year: "numeric" })} to {formatDay(ws.to, { month: "short", day: "numeric", year: "numeric" })}.</p>

      {open && project && (
        <TaskDrawer key={`${open.task.id}-${open.start ?? ""}`} task={open.task} project={project} people={people} today={today}
          resource={(() => { const k = assigneeKey(open.task); return k ? extras.resourceInfo?.[k] ?? null : null; })()}
          initialStart={open.start} initialEnd={open.end}
          extra={extras.team ? <AssignPanel task={open.task} project={project} team={extras.team} tasks={ws.tasks} people={ws.people} me={ws.me} myName={myName}
            onSaved={() => { void refresh(); }} /> : undefined}
          onClose={() => setOpen(null)} onSaved={() => { void refresh(); }} />
      )}
    </div>
  );
}

/** Where a link with context should open the calendar: its date, else the task's start, else the project's. */
function contextAnchor(ctx: CalendarContext, ws: Pick<Workspace, "projects" | "tasks">, today: string): string | null {
  if (ctx.date) return ctx.date;
  const t = ctx.task ? ws.tasks.find((x) => x.id === ctx.task) : null;
  if (t) return t.plannedStart;
  const p = ctx.project ? ws.projects.find((x) => x.id === ctx.project) : null;
  if (p) {
    const end = p.actualFinish ?? p.finishDate ?? p.targetEndDate ?? p.startDate;
    return p.startDate <= today && end >= today ? today : p.startDate;
  }
  return null;
}

/** Says what a link narrowed the calendar to, with a way back to everything and to the project's own schedule. */
function ContextBanner({ ctx, project, memberLabel, onClear }: { ctx: CalendarContext; project: Workspace["projects"][number] | null; memberLabel: string | null; onClear: () => void }) {
  if (!ctx.project && !ctx.member) return null;
  if (ctx.project && !project) {
    return (
      <p className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink-soft" role="status" data-testid="cal-context-missing">
        That project isn&apos;t on your calendar. It may be archived, or your role may not include it. Showing all projects you can see.
        <button type="button" onClick={onClear} className="font-semibold text-accent-ink hover:underline">Dismiss</button>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-accent-ink/40 bg-accent-tint/30 px-3 py-2 text-sm" role="status" data-testid="cal-context">
      <span className="min-w-0 flex-1">Showing <span className="font-semibold text-navy">{[project?.name, memberLabel].filter(Boolean).join(" · ") || "selected work"}</span> on the company calendar.</span>
      {project && <Link href={`/projects/${project.id}`} className="inline-flex min-h-9 items-center gap-1 font-semibold text-accent-ink hover:underline" data-testid="cal-context-project">Project schedule &amp; Gantt <ArrowRight className="h-4 w-4" aria-hidden /></Link>}
      <button type="button" onClick={onClear} className="inline-flex min-h-9 items-center gap-1 font-semibold text-accent-ink hover:underline" data-testid="cal-context-clear"><X className="h-4 w-4" aria-hidden /> Show everything</button>
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

/**
 * Below lg, the last project views live in a "More" menu. Picking a view closes it; so do an outside
 * click and Escape (focus returns to the button). Arrow keys move between views.
 */
function MoreViews({ views, view, setView }: { views: typeof VIEWS; view: string; setView: (v: (typeof VIEWS)[number]["v"]) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLUListElement>(null);
  useDismiss(open, () => setOpen(false), { inside: [trigger, panel], returnFocus: trigger });
  useEffect(() => { if (open) panel.current?.querySelector<HTMLElement>("button")?.focus(); }, [open]);
  const current = views.find((x) => x.v === view);
  return (
    <div className="relative lg:hidden">
      <button ref={trigger} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="project-more-views" data-testid="tab-more"
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
        className={cn("-mb-px flex min-h-11 items-center gap-1 whitespace-nowrap border-b-2 px-2.5 text-sm font-semibold", current ? "border-accent-ink text-navy" : "border-transparent text-ink-soft")}>
        {current?.label ?? "More"} <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul ref={panel} id="project-more-views" onKeyDown={menuKeyDown} className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-line bg-surface p-1 shadow-lg" data-testid="more-menu">
          {views.map((x) => (
            <li key={x.v}>
              <button type="button" aria-current={view === x.v ? "page" : undefined} data-testid={`more-${x.v}`}
                className={cn("flex min-h-11 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-paper focus-visible:bg-paper", view === x.v && "font-semibold text-navy")}
                onClick={() => { setView(x.v); setOpen(false); trigger.current?.focus(); }}>
                <x.icon className="h-4 w-4" aria-hidden />{x.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
