"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Layers, Loader2, Maximize2, Minimize2, Users, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { addDays, formatDay, formatRange, isWorkday, type WorkCalendar } from "@/lib/schedule/calendar";
import { statusLabel } from "@/lib/schedule/types";
import { leafTasks, monthGrid, monthStart, projectDot, projectStyle, type Workspace, type WsProject, type WsTask } from "@/lib/projects/workspace";
import { toResourceRefs, type Team } from "@/lib/projects/team";
import { DRAFT_ID, draftConflicts, draftTasks, draftWindow, overlappingProjects, type DraftAssignment, type DraftSection } from "@/lib/schedule/draft-overlay";

type Loaded = { from: string; to: string; projects: WsProject[]; tasks: WsTask[] };
type Load = { state: "loading" } | { state: "ready"; data: Loaded } | { state: "error"; message: string };

/** Existing company schedules for a date window, from the same endpoint the Projects views use (RLS applies). */
function useCompanySchedule(anchor: string) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [nonce, setNonce] = useState(0);
  // Load the visible month plus a margin so the draft and nearby months don't refetch on every click.
  const from = addDays(monthStart(anchor), -14), to = addDays(monthStart(anchor), 75);
  const covered = load.state === "ready" && load.data.from <= addDays(monthStart(anchor), -7) && load.data.to >= addDays(monthStart(anchor), 45);
  useEffect(() => {
    if (covered) return;
    let live = true;
    fetch(`/api/projects/workspace?from=${from}&to=${to}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!live) return;
        if (!r.ok) { setLoad({ state: "error", message: (d?.error?.message as string | undefined) ?? "Couldn't load the company calendar." }); return; }
        const ws = d as Workspace; // the route already maps pm_workspace (and adds team assignments)
        setLoad({ state: "ready", data: { from, to, projects: ws.projects, tasks: ws.tasks } });
      })
      .catch(() => { if (live) setLoad({ state: "error", message: "Couldn't load the company calendar. Check your connection." }); });
    return () => { live = false; };
  }, [from, to, nonce, covered]);
  return { load, retry: () => { setLoad({ state: "loading" }); setNonce((n) => n + 1); } };
}

type Pick_ = { kind: "task"; task: WsTask } | { kind: "day"; day: string } | null;

export interface CompanyCalendarProps {
  /** The unsaved plan. Empty until the contractor reaches the Start date step. */
  plan: DraftSection[];
  assign: Record<string, DraftAssignment | undefined>;
  calendar: WorkCalendar;
  team: Team | null;
  today: string;
  projectName: string;
  /** Clicking a day can set the proposed start (not on the final Save step). */
  onPickStart?: (day: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Phones: shown as a full-screen panel with a way back to the exact wizard step. */
  onClose?: () => void;
  stepLabel?: string;
}

/**
 * Schedule Now's Company Calendar: the company's scheduled work (same records as Projects > Calendar)
 * with this job's unsaved plan drawn on top as a dashed draft. Inspecting days and projects never
 * touches the wizard's form; nothing is saved from here.
 */
export function CompanyCalendar({ plan, assign, calendar, team, today, projectName, onPickStart, expanded, onToggleExpanded, onClose, stepLabel }: CompanyCalendarProps) {
  const win = draftWindow(plan);
  const [anchor, setAnchor] = useState(() => monthStart(win?.start ?? today));
  const [lastStart, setLastStart] = useState(win?.start ?? null);
  // Follow the draft: when its start moves to another month, show that month.
  if ((win?.start ?? null) !== lastStart) {
    setLastStart(win?.start ?? null);
    if (win && monthStart(win.start) !== anchor) setAnchor(monthStart(win.start));
  }
  const { load, retry } = useCompanySchedule(anchor);
  const [picked, setPicked] = useState<Pick_>(null);
  const [showOverlaps, setShowOverlaps] = useState(false);

  const data = load.state === "ready" ? load.data : null;
  const projects = useMemo(() => data?.projects ?? [], [data]);
  const existing = useMemo(() => (data ? leafTasks(data.tasks).filter((t) => projects.some((p) => p.id === t.scheduleId && p.status !== "archived")) : []), [data, projects]);
  const draft = useMemo(() => draftTasks(plan, assign), [plan, assign]);
  const overlaps = useMemo(() => overlappingProjects(win, projects, existing), [win, projects, existing]);
  const conflicts = useMemo(() => (team ? draftConflicts(draft, calendar, projects, existing, toResourceRefs(team)) : []), [draft, calendar, projects, existing, team]);
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const resName = (t: WsTask) => (t.resourceId ? team?.resources.find((r) => r.id === t.resourceId)?.name ?? null : t.assignee);
  const days = monthGrid(anchor);
  const perDay = expanded ? 4 : 2;

  const chipsOn = (day: string) => [
    ...draft.filter((t) => t.plannedStart <= day && t.plannedEnd >= day && isWorkday(day, calendar)),
    ...existing.filter((t) => t.plannedStart <= day && t.plannedEnd >= day && (!byId.get(t.scheduleId) || isWorkday(day, byId.get(t.scheduleId)!.calendar))),
  ];

  return (
    <section aria-labelledby="company-cal-h" data-testid="company-calendar" data-expanded={expanded ? "true" : "false"}
      className="flex h-full min-h-0 flex-col rounded-2xl border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <h2 id="company-cal-h" className="flex min-w-0 flex-1 items-center gap-1.5 font-display text-base font-extrabold text-navy"><CalendarDays className="h-4 w-4 shrink-0 text-accent-ink" aria-hidden /> Company Calendar</h2>
        {onClose && <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-navy px-3 text-sm font-semibold text-white" data-testid="company-cal-close"><ChevronLeft className="h-4 w-4" aria-hidden /> Back to {stepLabel ?? "the wizard"}</button>}
        {!onClose && (
          <button type="button" onClick={onToggleExpanded} aria-pressed={expanded} data-testid="company-cal-expand"
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2.5 text-sm font-semibold text-ink-soft hover:bg-black/5">
            {expanded ? <><Minimize2 className="h-4 w-4" aria-hidden /> Back to split view</> : <><Maximize2 className="h-4 w-4" aria-hidden /> Expand calendar</>}
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="company-cal-scroll">
        {/* Proposed dates + overlap summary */}
        <div className="mt-3 rounded-lg border border-line bg-paper px-3 py-2 text-sm" data-testid="draft-summary" aria-live="polite">
          {win ? (
            <>
              <p className="flex flex-wrap items-center gap-x-2"><span className="inline-block h-3 w-3 rounded-sm border-2 border-dashed border-accent-ink bg-accent-tint" aria-hidden />
                <span><b className="text-navy">{projectName || "This job"} (draft)</b> · {formatRange(win.start, win.end)}</span></p>
              <p className="mt-1 text-ink-soft" data-testid="overlap-count">
                {load.state !== "ready" ? "Checking other scheduled work…" : overlaps.length === 0 ? "No other projects are scheduled during these dates." : <>{overlaps.length} other project{overlaps.length === 1 ? " is" : "s are"} scheduled during these dates.{" "}
                  <button type="button" className="font-semibold text-accent-ink underline" onClick={() => setShowOverlaps((v) => !v)} aria-expanded={showOverlaps} data-testid="show-overlaps">{showOverlaps ? "Hide" : "Show"} overlapping work</button></>}
              </p>
              <p className="mt-1 text-xs text-muted">Not saved. It goes on the live schedule only when you save in the last step.</p>
            </>
          ) : <p className="text-ink-soft">Showing scheduled work only. Pick a start date to preview this job on the calendar.</p>}
        </div>

        {showOverlaps && overlaps.length > 0 && (
          <ul className="mt-2 space-y-1" data-testid="overlap-list">
            {overlaps.map((o) => (
              <li key={o.project.id}>
                <button type="button" onClick={() => setPicked({ kind: "task", task: o.tasks[0] })} className="flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-left text-sm hover:bg-black/5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={projectDot(o.project.id)} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-semibold text-navy">{o.project.name}</span>
                  <span className="shrink-0 text-xs text-muted">{formatRange(o.from, o.to)} · {o.tasks.length} task{o.tasks.length === 1 ? "" : "s"}</span>
                </button>
              </li>
            ))}
            <li className="px-1 text-xs text-muted">Overlap is fine when different people do the work. Real double-bookings are flagged below.</li>
          </ul>
        )}

        {conflicts.length > 0 && (
          <div className="mt-2 space-y-1.5" data-testid="conflicts" role="status">
            {conflicts.map((c, i) => (
              <div key={i} className={cn("rounded-lg border px-3 py-2 text-sm", c.certainty === "confirmed" ? "border-danger/40 bg-danger-tint" : "border-warn/40 bg-warn-tint")} data-testid={`conflict-${c.certainty}`}>
                <p className="flex items-start gap-1.5 font-semibold text-ink"><AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", c.certainty === "confirmed" ? "text-danger" : "text-warn")} aria-hidden />
                  {c.kind === "unavailable" ? `${c.resource} is marked unavailable ${c.day === c.until ? formatDay(c.day) : formatRange(c.day, c.until)}`
                    : c.certainty === "confirmed" ? `Scheduling conflict: ${c.resource} is over capacity ${c.day === c.until ? formatDay(c.day) : formatRange(c.day, c.until)}`
                    : `Possible overlap: ${c.resource} is also booked ${c.day === c.until ? formatDay(c.day) : formatRange(c.day, c.until)}`}</p>
                <p className="mt-0.5 text-xs text-ink-soft">This job: {c.draftTasks.join(", ")}{c.others.length ? ` · Also: ${c.others.map((o) => `${o.name} (${o.projectName})`).join(", ")}` : ""}</p>
                <p className="mt-0.5 text-xs text-muted">{c.certainty === "possible" ? "Their capacity isn't set, so they may be able to run both. " : ""}You can still save. Nothing else is moved.</p>
              </div>
            ))}
          </div>
        )}

        {/* Month grid */}
        <div className="mt-3 flex items-center gap-1">
          <button type="button" className="grid h-9 w-9 place-items-center rounded-lg border border-line hover:bg-black/5" aria-label="Previous month" onClick={() => setAnchor(monthStart(addDays(anchor, -1)))}><ChevronLeft className="h-4 w-4" aria-hidden /></button>
          <p className="min-w-0 flex-1 text-center text-sm font-bold text-navy" aria-live="polite" data-testid="company-cal-month">{formatDay(anchor, { month: "long", year: "numeric" })}</p>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-lg border border-line hover:bg-black/5" aria-label="Next month" onClick={() => setAnchor(monthStart(addDays(anchor, 32)))}><ChevronRight className="h-4 w-4" aria-hidden /></button>
          <button type="button" className="ml-1 min-h-9 rounded-lg border border-line px-2 text-xs font-semibold text-ink-soft hover:bg-black/5" onClick={() => setAnchor(monthStart(win?.start ?? today))}>{win ? "Draft" : "Today"}</button>
        </div>

        {load.state === "loading" && <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading scheduled work…</p>}
        {load.state === "error" && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-tint px-3 py-2 text-sm" role="alert">{load.message} <button type="button" className="font-semibold underline" onClick={retry}>Try again</button><p className="mt-1 text-xs text-ink-soft">Your scheduling form isn&apos;t affected.</p></div>
        )}
        {load.state === "ready" && (
          <div role="grid" aria-label={`Company calendar, ${formatDay(anchor, { month: "long", year: "numeric" })}`} className="mt-2 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line text-[11px]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} role="columnheader" className="bg-paper py-1 text-center font-bold text-muted">{expanded ? d : d.slice(0, 1)}</div>)}
            {days.map((day) => {
              const chips = chipsOn(day);
              const inMonth = day.slice(0, 7) === anchor.slice(0, 7);
              const inDraft = !!win && day >= win.start && day <= win.end;
              // Count from the chips so a project's non-working days (weekends) don't add to the badge.
              const n = new Set(chips.filter((t) => t.scheduleId !== DRAFT_ID && t.status !== "complete").map((t) => t.scheduleId)).size;
              const sel = picked?.kind === "day" && picked.day === day;
              return (
                <div key={day} role="gridcell" aria-selected={sel} className={cn("relative bg-surface p-0.5", expanded ? "min-h-24" : "min-h-16", !inMonth && "bg-paper/70 text-muted", inDraft && "bg-accent-tint/40")}>
                  <button type="button" onClick={() => setPicked({ kind: "day", day })} data-testid="cal-day" data-day={day}
                    aria-label={`${formatDay(day, { weekday: "long", month: "long", day: "numeric" })}: ${n} other project${n === 1 ? "" : "s"}${inDraft ? ", inside this job's draft dates" : ""}`}
                    className={cn("flex w-full items-center justify-between rounded px-1 font-semibold hover:bg-black/5", day === today && "text-accent-ink", sel && "ring-2 ring-accent-ink")}>
                    <span>{Number(day.slice(8))}</span>
                    {n > 0 && <span className="rounded-full bg-black/10 px-1 text-[10px] font-bold text-ink-soft" aria-hidden title={`${n} other project${n === 1 ? "" : "s"}`}>{n}</span>}
                  </button>
                  <div className="mt-0.5 space-y-px">
                    {chips.slice(0, perDay).map((t) => <Chip key={t.id} t={t} p={byId.get(t.scheduleId)} onOpen={() => setPicked({ kind: "task", task: t })} expanded={expanded} />)}
                    {chips.length > perDay && <button type="button" className="block w-full rounded px-1 text-left text-[10px] font-semibold text-ink-soft hover:bg-black/5" onClick={() => setPicked({ kind: "day", day })}>+{chips.length - perDay} more</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-accent-ink bg-accent-tint" aria-hidden /> This job (draft)</span>
          <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" aria-hidden /> Number = other projects that day</span>
          {onPickStart && <span>Click a day to inspect it or start the job there.</span>}
        </p>

        {/* Quick view: a day or a project task. Never changes the wizard form unless "Start the job" is clicked. */}
        {picked && (
          <div className="mt-3 rounded-xl border border-accent-ink/40 bg-surface p-3 shadow-sm" data-testid="cal-quickview" role="region" aria-label="Calendar details">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {picked.kind === "day" ? <DayView day={picked.day} chips={chipsOn(picked.day)} byId={byId} onOpen={(t) => setPicked({ kind: "task", task: t })} />
                  : <TaskView t={picked.task} p={byId.get(picked.task.scheduleId)} who={resName(picked.task)} projectName={projectName} />}
              </div>
              <button type="button" onClick={() => setPicked(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-black/5" aria-label="Close details"><X className="h-4 w-4" aria-hidden /></button>
            </div>
            {picked.kind === "day" && onPickStart && (
              <button type="button" className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-navy px-3 text-sm font-semibold text-white disabled:opacity-50" data-testid="use-as-start"
                onClick={() => { onPickStart(picked.day); setPicked(null); }} disabled={!isWorkday(picked.day, calendar)} title={isWorkday(picked.day, calendar) ? undefined : "Not one of your working days"}>
                <CalendarDays className="h-4 w-4" aria-hidden /> Start this job {formatDay(picked.day, { weekday: "short", month: "short", day: "numeric" })}
              </button>
            )}
            {picked.kind === "day" && onPickStart && !isWorkday(picked.day, calendar) && <p className="mt-1 text-xs text-muted">That day isn&apos;t one of your working days.</p>}
          </div>
        )}
        {team === null && <p className="mt-3 flex items-center gap-1 text-[11px] text-muted"><Users className="h-3 w-3" aria-hidden /> Resource conflicts appear once Team &amp; Subcontractors is set up.</p>}
      </div>
    </section>
  );
}

function Chip({ t, p, onOpen, expanded }: { t: WsTask; p?: WsProject; onOpen: () => void; expanded: boolean }) {
  const draft = t.scheduleId === DRAFT_ID;
  const label = draft ? t.name : `${p?.name ?? "Project"} · ${t.name}`;
  return (
    <button type="button" onClick={onOpen} data-testid={draft ? "cal-draft" : "cal-existing"} title={`${draft ? "This job (draft)" : p?.name}: ${t.name} (${formatRange(t.plannedStart, t.plannedEnd)})`}
      style={draft ? undefined : p ? projectStyle(p.id) : undefined}
      className={cn("block w-full truncate rounded px-1 text-left leading-4 text-ink hover:brightness-95", expanded ? "text-[11px]" : "text-[10px]",
        draft ? "border border-dashed border-accent-ink bg-accent-tint font-semibold text-navy" : "border-l-[3px]", t.status === "complete" && "opacity-60 line-through")}>
      {label}
    </button>
  );
}

function DayView({ day, chips, byId, onOpen }: { day: string; chips: WsTask[]; byId: Map<string, WsProject>; onOpen: (t: WsTask) => void }) {
  return (
    <>
      <p className="font-bold text-navy">{formatDay(day, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
      {chips.length === 0 ? <p className="mt-1 text-sm text-ink-soft">Nothing scheduled.</p> : (
        <ul className="mt-1 space-y-1">
          {chips.map((t) => (
            <li key={t.id}><button type="button" onClick={() => onOpen(t)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-black/5">
              {t.scheduleId === DRAFT_ID ? <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-dashed border-accent-ink bg-accent-tint" aria-hidden /> : <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={projectDot(t.scheduleId)} aria-hidden />}
              <span className="min-w-0 flex-1 truncate"><b>{t.scheduleId === DRAFT_ID ? "This job (draft)" : byId.get(t.scheduleId)?.name}</b> · {t.name}</span>
            </button></li>
          ))}
        </ul>
      )}
    </>
  );
}

function TaskView({ t, p, who, projectName }: { t: WsTask; p?: WsProject; who: string | null; projectName: string }) {
  if (t.scheduleId === DRAFT_ID) return (
    <>
      <p className="font-bold text-navy">{projectName || "This job"} <span className="font-semibold text-accent-ink">(draft)</span></p>
      <p className="text-sm">{t.name} · {formatRange(t.plannedStart, t.plannedEnd)} · {t.durationDays} working day{t.durationDays === 1 ? "" : "s"}</p>
      <p className="mt-1 text-xs text-muted">Change dates in the wizard steps. Not saved yet.</p>
    </>
  );
  return (
    <>
      <p className="flex items-center gap-1.5 font-bold text-navy">{p && <span className="h-2.5 w-2.5 rounded-full" style={projectDot(p.id)} aria-hidden />}{p?.name ?? "Project"}</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        {p?.customerName && <><dt className="text-muted">Customer</dt><dd>{p.customerName}</dd></>}
        <dt className="text-muted">Task</dt><dd>{t.name}{t.trade ? ` · ${t.trade}` : ""}</dd>
        <dt className="text-muted">Dates</dt><dd>{formatRange(t.plannedStart, t.plannedEnd)}</dd>
        <dt className="text-muted">Status</dt><dd>{statusLabel(t.status)} · {t.percentComplete}%{p ? ` · project ${p.status}${p.provisional ? " (provisional)" : ""}` : ""}</dd>
        <dt className="text-muted">Assigned</dt><dd>{who ?? "Not assigned"}</dd>
      </dl>
      {p && <a href={`/projects/${p.id}`} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent-ink underline">Open project in a new tab <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>}
      <p className="mt-1 text-xs text-muted">Opening it in a new tab keeps everything you&apos;ve entered here.</p>
    </>
  );
}
