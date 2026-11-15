"use client";
import { useRef, useState, type PointerEvent as RPointerEvent, type KeyboardEvent as RKeyboardEvent } from "react";
import { ChevronDown, ChevronRight, ListPlus, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { addDays, daysBetween, formatDay, formatRange, isWorkday, type WorkCalendar } from "@/lib/schedule/calendar";
import type { DateEdit } from "@/lib/schedule/engine";
import { statusLabel, type Dep, type Task } from "@/lib/schedule/types";
import { STATUS_STYLE } from "./client";

export type Zoom = "day" | "week" | "month";
export const ZOOM_PX: Record<Zoom, number> = { day: 32, week: 14, month: 5 };
const ROW = 44;
const LABEL_W = 232;

export interface GanttRow { task: Task; depth: number; isSectionHead: boolean; childCount: number; progress: number; trade?: string | null; tradeHeader?: string }

interface Props {
  rows: GanttRow[];
  deps: Dep[];
  cal: WorkCalendar;
  zoom: Zoom;
  today: string;
  target: string | null;
  canEdit: boolean;
  collapsed: Set<string>;
  highlight: string | null;
  onToggle: (sectionId: string) => void;
  onEdit: (edit: DateEdit) => void;
  onOpen: (taskId: string) => void;
  onItems: (sectionId: string) => void;
}

type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; days: number; pointer: number };

/**
 * Gantt timeline: sticky task labels, section grouping with expand/collapse, drag to move, drag either
 * edge to change dates, dependency arrows, planned bar with % complete fill, an actual-dates line,
 * a today line and the target date. Every bar is a button: arrow keys move it a day, Shift+arrows
 * change its finish, Enter opens the full editor, so nothing needs a mouse.
 */
export function Gantt({ rows, deps, cal, zoom, today, target, canEdit, collapsed, highlight, onToggle, onEdit, onOpen, onItems }: Props) {
  const px = ZOOM_PX[zoom];
  const [drag, setDrag] = useState<Drag | null>(null);
  const moved = useRef(false);
  const all = rows.map((r) => r.task);
  const first = all.reduce((m, t) => (t.plannedStart < m ? t.plannedStart : m), all[0]?.plannedStart ?? today);
  const last = all.reduce((m, t) => (t.plannedEnd > m ? t.plannedEnd : m), all[0]?.plannedEnd ?? today);
  const start = addDays([first, today].sort()[0], zoom === "day" ? -3 : -7);
  const end = addDays([last, target ?? last, today].sort().at(-1)!, zoom === "day" ? 7 : 21);
  const days = daysBetween(start, end) + 1;
  const width = days * px;
  const x = (d: string) => daysBetween(start, d) * px;
  const rowIndex = new Map(rows.map((r, i) => [r.task.id, i]));

  const begin = (e: RPointerEvent, id: string, mode: Drag["mode"]) => {
    if (!canEdit || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    moved.current = false;
    setDrag({ id, mode, x0: e.clientX, days: 0, pointer: e.pointerId });
  };
  const move = (e: RPointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = Math.round((e.clientX - drag.x0) / px);
    if (d !== drag.days) { moved.current = true; setDrag({ ...drag, days: d }); }
  };
  const end_ = (e: RPointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const t = all.find((x) => x.id === drag.id);
    const d = drag.days;
    setDrag(null);
    if (!t || !d) return;
    if (drag.mode === "move") onEdit({ taskId: t.id, plannedStart: addDays(t.plannedStart, d) });
    else if (drag.mode === "end") onEdit({ taskId: t.id, plannedEnd: addDays(t.plannedEnd, d) < t.plannedStart ? t.plannedStart : addDays(t.plannedEnd, d) });
    else onEdit({ taskId: t.id, plannedStart: addDays(t.plannedStart, d) > t.plannedEnd ? t.plannedEnd : addDays(t.plannedStart, d), plannedEnd: t.plannedEnd });
  };
  const key = (e: RKeyboardEvent, t: Task) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(t.id); return; }
    if (!canEdit || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    if (e.shiftKey) {
      const ne = addDays(t.plannedEnd, dir);
      if (ne >= t.plannedStart) onEdit({ taskId: t.id, plannedEnd: ne });
    } else onEdit({ taskId: t.id, plannedStart: addDays(t.plannedStart, dir) });
  };

  const months: { label: string; left: number; w: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    if (i === 0 || d.endsWith("-01")) months.push({ label: formatDay(d, { month: "short", year: "numeric" }), left: i * px, w: 0 });
  }
  months.forEach((m, i) => { m.w = (months[i + 1]?.left ?? width) - m.left; });

  return (
    <div className="relative overflow-x-auto rounded-xl border border-line bg-surface" data-testid="gantt" role="region" aria-label="Schedule timeline">
      <div style={{ width: LABEL_W + width }} className="relative">
        {/* Header */}
        <div className="sticky top-0 z-20 flex border-b border-line bg-surface">
          <div className="sticky left-0 z-30 flex shrink-0 items-end border-r border-line bg-surface px-3 pb-1 text-xs font-bold uppercase tracking-wider text-muted" style={{ width: LABEL_W, height: zoom === "month" ? 28 : 48 }}>Task</div>
          <div className="relative" style={{ width, height: zoom === "month" ? 28 : 48 }}>
            {months.map((m) => <div key={m.left} className="absolute top-0 h-6 truncate border-l border-line px-1 text-xs font-semibold text-ink-soft" style={{ left: m.left, width: m.w }}>{m.label}</div>)}
            {zoom !== "month" && Array.from({ length: days }, (_, i) => {
              const d = addDays(start, i);
              const show = zoom === "day" || new Date(`${d}T00:00:00Z`).getUTCDay() === 1;
              return show ? <div key={d} className={cn("absolute top-6 h-6 text-center text-[11px] leading-6", isWorkday(d, cal) ? "text-ink-soft" : "text-muted/70")} style={{ left: i * px, width: zoom === "day" ? px : px * 7 }}>{zoom === "day" ? Number(d.slice(8)) : formatDay(d)}</div> : null;
            })}
          </div>
        </div>

        {/* Body */}
        <div className="relative" style={{ height: rows.length * ROW }} onPointerMove={move} onPointerUp={end_} onPointerCancel={() => setDrag(null)}>
          {/* Non-working day shading, today and target lines */}
          <div className="pointer-events-none absolute inset-y-0" style={{ left: LABEL_W, width }} aria-hidden>
            {zoom !== "month" && Array.from({ length: days }, (_, i) => addDays(start, i)).filter((d) => !isWorkday(d, cal)).map((d) => <div key={d} className="absolute inset-y-0 bg-black/[0.035]" style={{ left: x(d), width: px }} />)}
            {today >= start && today <= end && <div className="absolute inset-y-0 z-10 w-0.5 bg-danger/70" style={{ left: x(today) + px / 2 }} data-testid="today-line"><span className="absolute -top-0 left-1 rounded bg-danger px-1 text-[10px] font-bold text-white">Today</span></div>}
            {target && <div className="absolute inset-y-0 z-10 border-l-2 border-dashed border-navy/50" style={{ left: x(target) + px }} title={`Target ${target}`} />}
          </div>

          {/* Dependency arrows */}
          <svg className="pointer-events-none absolute top-0 z-10" style={{ left: LABEL_W, width, height: rows.length * ROW }} aria-hidden>
            <defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#56677A" /></marker></defs>
            {deps.map((d) => {
              const a = rowIndex.get(d.from), b = rowIndex.get(d.to);
              if (a === undefined || b === undefined) return null;
              const pa = all[a], pb = all[b];
              const x1 = x(pa.plannedEnd) + px, y1 = a * ROW + ROW / 2, x2 = x(pb.plannedStart), y2 = b * ROW + ROW / 2;
              const mid = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 10));
              return <path key={`${d.from}-${d.to}`} d={`M${x1},${y1} H${mid} V${y2} H${x2 - 1}`} fill="none" stroke="#56677A" strokeWidth="1.25" markerEnd="url(#arrow)" />;
            })}
          </svg>

          {rows.map((r, i) => {
            const t = r.task;
            const dr = drag?.id === t.id ? drag : null;
            const s = dr && (dr.mode === "move" || dr.mode === "start") ? addDays(t.plannedStart, dr.days) : t.plannedStart;
            const e = dr && (dr.mode === "move" || dr.mode === "end") ? addDays(t.plannedEnd, dr.days) : t.plannedEnd;
            const left = x(s), w = Math.max((daysBetween(s, e) + 1) * px, px);
            const st = STATUS_STYLE[t.status];
            const behind = t.status !== "complete" && t.plannedEnd < today;
            const actualEnd = t.actualFinish ?? (t.actualStart ? today : null);
            return (
              <div key={t.id} className={cn("absolute inset-x-0 flex border-b border-line/70", highlight === t.id && "bg-accent-tint/50")} style={{ top: i * ROW, height: ROW }} data-testid={`row-${t.id}`}>
                <div className="sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-line bg-surface pr-1" style={{ width: LABEL_W, paddingLeft: 6 + r.depth * 16 }}>
                  {r.isSectionHead && r.childCount > 0 ? (
                    <button type="button" className="grid h-8 w-7 shrink-0 place-items-center rounded hover:bg-black/5" onClick={() => onToggle(t.id)} aria-expanded={!collapsed.has(t.id)} aria-label={`${collapsed.has(t.id) ? "Expand" : "Collapse"} ${t.name}`}>
                      {collapsed.has(t.id) ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                    </button>
                  ) : <span className="w-7 shrink-0" />}
                  <button type="button" onClick={() => onOpen(t.id)} className={cn("relative min-w-0 flex-1 truncate text-left text-sm", r.isSectionHead ? "font-bold text-navy" : "text-ink")} title={t.name}>
                    {r.tradeHeader && <span className="block truncate text-[10px] font-bold uppercase leading-3 tracking-wider text-muted">{r.tradeHeader}</span>}
                    {t.name}
                    <span className="ml-1 text-xs font-normal text-muted">{r.progress}%</span>
                  </button>
                  {r.isSectionHead && canEdit && (
                    <button type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded text-ink-soft hover:bg-black/5" onClick={() => onItems(t.id)} aria-label={`Schedule individual items in ${t.name}`} title="Schedule individual items">
                      <ListPlus className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                  <button type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded text-ink-soft hover:bg-black/5 md:hidden" onClick={() => onOpen(t.id)} aria-label={`Edit ${t.name}`}><MoreHorizontal className="h-4 w-4" aria-hidden /></button>
                </div>
                <div className="relative" style={{ width }}>
                  <button
                    type="button"
                    data-testid={`bar-${t.id}`}
                    aria-label={`${t.name}: ${formatRange(t.plannedStart, t.plannedEnd)}, ${t.durationDays} working days, ${statusLabel(t.status)}, ${t.percentComplete}% complete${behind ? ", past planned finish" : ""}. ${canEdit ? "Arrow keys move it, Shift plus arrow keys change the finish, Enter edits." : "Enter shows details."}`}
                    onKeyDown={(ev) => key(ev, t)}
                    onClick={() => { if (!moved.current) onOpen(t.id); moved.current = false; }}
                    onPointerDown={(ev) => begin(ev, t.id, "move")}
                    className={cn("group absolute top-2 h-6 touch-none select-none overflow-hidden rounded-md border text-left", st.bar, r.isSectionHead && r.childCount > 0 && "top-3 h-4", canEdit && "cursor-grab active:cursor-grabbing", behind && "ring-2 ring-warn/60", dr && "opacity-80 shadow-lg")}
                    style={{ left, width: w }}
                  >
                    <span className={cn("absolute inset-y-0 left-0", st.fill, "opacity-80")} style={{ width: `${r.isSectionHead ? r.progress : t.percentComplete}%` }} aria-hidden />
                    {w > 60 && !(r.isSectionHead && r.childCount > 0) && <span className="relative z-10 block truncate px-2 text-[11px] font-semibold leading-6 text-ink">{t.percentComplete}%</span>}
                    {canEdit && <>
                      <span onPointerDown={(ev) => begin(ev, t.id, "start")} className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize bg-navy/0 group-hover:bg-navy/20" aria-hidden data-testid={`start-${t.id}`} />
                      <span onPointerDown={(ev) => begin(ev, t.id, "end")} className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize bg-navy/0 group-hover:bg-navy/20" aria-hidden data-testid={`end-${t.id}`} />
                    </>}
                  </button>
                  {t.actualStart && actualEnd && <span className="absolute bottom-1 h-1 rounded-full bg-navy" style={{ left: x(t.actualStart), width: Math.max((daysBetween(t.actualStart, actualEnd) + 1) * px, 3) }} title={`Actual ${formatRange(t.actualStart, actualEnd)}`} aria-hidden />}
                  {dr && <span className="absolute -top-0.5 z-30 rounded bg-navy px-1.5 text-[11px] font-semibold text-white" style={{ left }}>{formatRange(s, e < s ? s : e)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
