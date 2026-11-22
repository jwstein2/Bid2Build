"use client";
import { useEffect, useState, type DragEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { addDays, daysBetween, formatDay, formatRange } from "@/lib/schedule/calendar";
import { statusLabel } from "@/lib/schedule/types";
import { leafTasks, monthGrid, monthStart, overlaps, projectStyle, startOfWeek, tasksOn, type WsProject, type WsTask } from "@/lib/projects/workspace";

export type CalMode = "month" | "week" | "day" | "agenda";
const MODES: { v: CalMode; label: string }[] = [{ v: "month", label: "Month" }, { v: "week", label: "Week" }, { v: "day", label: "Day" }, { v: "agenda", label: "Agenda" }];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Company calendar: every authorized project's tasks together, each project in its own color AND
 * named in text. Clicking opens the quick-detail drawer. Editors can drag a task to another day; the
 * drawer then shows the new dates and what else would move before anything is saved.
 */
export function CalendarView({ projects, tasks, today, anchor, setAnchor, mode, setMode, labelOf, onOpen, onDropMove, highlight = null }: {
  projects: WsProject[]; tasks: WsTask[]; today: string; anchor: string; setAnchor: (d: string) => void; mode: CalMode; setMode: (m: CalMode) => void;
  labelOf: (t: WsTask) => string | null; onOpen: (t: WsTask) => void; onDropMove: (t: WsTask, start: string) => void;
  /** Task a link pointed at ("Open schedule" with a task): outlined and scrolled into view. */
  highlight?: string | null;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const items = leafTasks(tasks).filter((t) => byId.has(t.scheduleId));
  const canEdit = (t: WsTask) => byId.get(t.scheduleId)?.permissions.edit === true;
  useEffect(() => {
    if (!highlight) return;
    document.querySelector(`[data-task-id="${CSS.escape(highlight)}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [highlight, mode, anchor]);

  const step = (dir: 1 | -1) => {
    if (mode === "month") setAnchor(monthStart(addDays(monthStart(anchor), dir === 1 ? 32 : -1)));
    else setAnchor(addDays(anchor, dir * (mode === "week" ? 7 : mode === "agenda" ? 14 : 1)));
  };
  const title = mode === "month" ? formatDay(anchor, { month: "long", year: "numeric" })
    : mode === "week" ? formatRange(startOfWeek(anchor), addDays(startOfWeek(anchor), 6))
    : mode === "day" ? formatDay(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : `${formatRange(anchor, addDays(anchor, 13))}`;

  const drop = (day: string) => (e: DragEvent) => {
    e.preventDefault();
    const t = items.find((x) => x.id === (dragId ?? e.dataTransfer.getData("text/plain")));
    setDragId(null);
    if (t && canEdit(t) && day !== t.plannedStart) onDropMove(t, day);
  };
  const Chip = ({ t, compact }: { t: WsTask; compact?: boolean }) => {
    const p = byId.get(t.scheduleId)!;
    const who = labelOf(t);
    return (
      <button type="button" draggable={canEdit(t)} onDragStart={(e) => { setDragId(t.id); e.dataTransfer.setData("text/plain", t.id); }}
        onClick={() => onOpen(t)} style={projectStyle(p.id)} data-testid="cal-event" data-guide="projects.cal-event" data-task-id={t.id} data-highlight={t.id === highlight || undefined} aria-current={t.id === highlight ? "true" : undefined}
        className={cn("block w-full truncate rounded border-l-4 px-1.5 text-left text-[11px] leading-5 text-ink hover:brightness-95", canEdit(t) && "cursor-grab", t.status === "complete" && "opacity-60 line-through", t.id === highlight && "ring-2 ring-accent-ink ring-offset-1")}
        title={`${p.name}: ${t.name} (${formatRange(t.plannedStart, t.plannedEnd)}) · ${statusLabel(t.status)} ${t.percentComplete}%${who ? ` · ${who}` : ""}`}>
        {compact ? <><span className="font-semibold">{p.name}</span> · {t.name}</> : <><span className="font-semibold">{t.name}</span> <span className="text-ink-soft">· {p.name}</span></>}
      </button>
    );
  };

  return (
    <div className="space-y-3" data-testid="view-calendar">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5" role="group" aria-label="Calendar view" data-guide="projects.cal-modes">
          {MODES.map((m) => <button key={m.v} type="button" aria-pressed={mode === m.v} onClick={() => setMode(m.v)} className={cn("min-h-9 rounded-md px-2.5 text-sm font-semibold", mode === m.v ? "bg-navy text-white" : "text-ink-soft")} data-testid={`cal-${m.v}`}>{m.label}</button>)}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} className="grid h-9 w-9 place-items-center rounded-lg border border-line" aria-label="Previous"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setAnchor(today)} className="min-h-9 rounded-lg border border-line px-3 text-sm font-semibold">Today</button>
          <button type="button" onClick={() => step(1)} className="grid h-9 w-9 place-items-center rounded-lg border border-line" aria-label="Next"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <h2 className="w-full font-display text-lg font-extrabold text-navy sm:order-first sm:w-auto" aria-live="polite">{title}</h2>
      </div>

      {/* Legend: project color + name (color is never the only identifier). */}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Projects">
        {projects.filter((p) => items.some((t) => t.scheduleId === p.id)).slice(0, 24).map((p) => (
          <li key={p.id} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border" style={projectStyle(p.id)} aria-hidden />{p.name}</li>
        ))}
      </ul>

      {mode === "month" && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <div className="grid min-w-[42rem] grid-cols-7 border-b border-line text-center text-xs font-semibold text-muted">{DOW.map((d) => <div key={d} className="py-1.5">{d}</div>)}</div>
          <div className="grid min-w-[42rem] grid-cols-7">
            {monthGrid(anchor).map((d) => {
              const list = tasksOn(items, d);
              const out = d.slice(0, 7) !== anchor.slice(0, 7);
              return (
                <div key={d} onDragOver={(e) => e.preventDefault()} onDrop={drop(d)} data-day={d}
                  className={cn("min-h-24 border-b border-r border-line p-1", out && "bg-paper/60", d === today && "ring-2 ring-inset ring-accent-ink")}>
                  <button type="button" onClick={() => { setAnchor(d); setMode("day"); }} className={cn("mb-0.5 text-xs font-semibold", out ? "text-muted" : "text-ink-soft")} aria-label={formatDay(d, { weekday: "long", month: "long", day: "numeric" })}>{Number(d.slice(8))}</button>
                  <div className="space-y-0.5">{list.slice(0, 3).map((t) => <Chip key={t.id} t={t} compact />)}</div>
                  {list.length > 3 && <button type="button" className="mt-0.5 text-[11px] font-semibold text-accent-ink" onClick={() => { setAnchor(d); setMode("day"); }}>+{list.length - 3} more</button>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === "week" && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <div className="grid min-w-[48rem] grid-cols-7">
            {Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)).map((d) => (
              <div key={d} onDragOver={(e) => e.preventDefault()} onDrop={drop(d)} data-day={d} className={cn("min-h-64 border-r border-line p-1.5", d === today && "bg-accent-tint/30")}>
                <p className="mb-1 text-xs font-semibold text-ink-soft">{formatDay(d, { weekday: "short", month: "short", day: "numeric" })}</p>
                <div className="space-y-1">{tasksOn(items, d).map((t) => <Chip key={t.id} t={t} />)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === "day" && <DayList day={anchor} items={tasksOn(items, anchor)} byId={byId} labelOf={labelOf} onOpen={onOpen} highlight={highlight} />}

      {mode === "agenda" && (
        <div className="space-y-3" data-testid="agenda">
          {Array.from({ length: 14 }, (_, i) => addDays(anchor, i)).map((d) => {
            const starting = items.filter((t) => t.plannedStart === d || (d === anchor && overlaps(t, d, d)));
            if (!starting.length) return null;
            return (
              <section key={d}>
                <h3 className={cn("text-sm font-bold", d === today ? "text-accent-ink" : "text-navy")}>{formatDay(d, { weekday: "long", month: "short", day: "numeric" })}{d === today && " · Today"}</h3>
                <DayList day={d} items={starting} byId={byId} labelOf={labelOf} onOpen={onOpen} highlight={highlight} bare />
              </section>
            );
          })}
          {!items.some((t) => overlaps(t, anchor, addDays(anchor, 13))) && <p className="text-sm text-muted">Nothing scheduled in these two weeks.</p>}
        </div>
      )}
    </div>
  );
}

function DayList({ day, items, byId, labelOf, onOpen, bare, highlight }: { day: string; items: WsTask[]; byId: Map<string, WsProject>; labelOf: (t: WsTask) => string | null; onOpen: (t: WsTask) => void; bare?: boolean; highlight?: string | null }) {
  if (!items.length) return bare ? null : <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">Nothing scheduled on {formatDay(day, { weekday: "long", month: "short", day: "numeric" })}.</p>;
  return (
    <ul className={cn("divide-y divide-line rounded-xl border border-line bg-surface", bare && "mt-1")}>
      {items.map((t) => {
        const p = byId.get(t.scheduleId)!;
        const who = labelOf(t);
        return (
          <li key={t.id}>
            <button type="button" onClick={() => onOpen(t)} className={cn("flex w-full items-start gap-3 p-3 text-left hover:bg-paper", t.id === highlight && "bg-accent-tint/40 ring-2 ring-inset ring-accent-ink")} data-testid="agenda-item" data-guide="projects.cal-event" data-task-id={t.id} data-highlight={t.id === highlight || undefined} aria-current={t.id === highlight ? "true" : undefined}>
              <span className="mt-1 h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: projectStyle(p.id).borderColor }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-navy">{t.name}</span>
                <span className="block text-sm text-ink-soft">{p.name}{who ? ` · ${who}` : ""}</span>
                <span className="block text-xs text-muted">{formatRange(t.plannedStart, t.plannedEnd)} · day {daysBetween(t.plannedStart, day) + 1} · {statusLabel(t.status)} {t.percentComplete}%</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
