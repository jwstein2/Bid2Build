"use client";
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { addDays, daysBetween, formatDay, formatRange } from "@/lib/schedule/calendar";
import { statusLabel } from "@/lib/schedule/types";
import { projectStyle, type WsDep, type WsProject, type WsTask } from "@/lib/projects/workspace";
import { STATUS_STYLE } from "@/components/schedule/client";

type Zoom = "day" | "week" | "month";
const PX: Record<Zoom, number> = { day: 30, week: 12, month: 4 };
const ROW = 36;
const LABEL = 220;
type Row = { kind: "project"; p: WsProject; start: string; end: string } | { kind: "task"; p: WsProject; t: WsTask; depth: number; hasKids: boolean };
type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; days: number; pointer: number };

/**
 * Company-wide Gantt: projects as expandable groups, sections and line items inside. Editors drag a bar
 * (or its edges); the drawer then previews the change, including dependent tasks, before saving
 * through the same schedule API as the project's own Gantt. View-only users can expand and inspect.
 */
export function TimelineView({ projects, tasks, deps, today, labelOf, onOpen, onDragEdit }: {
  projects: WsProject[]; tasks: WsTask[]; deps: WsDep[]; today: string; labelOf: (t: WsTask) => string | null;
  onOpen: (t: WsTask) => void; onDragEdit: (t: WsTask, start: string, end: string) => void;
}) {
  const [zoom, setZoom] = useState<Zoom>("week");
  const [open, setOpen] = useState<Set<string>>(() => new Set(projects.slice(0, 6).map((p) => p.id)));
  const [openSec, setOpenSec] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const px = PX[zoom];

  const rows: Row[] = [];
  for (const p of projects) {
    const mine = tasks.filter((t) => t.scheduleId === p.id);
    if (!mine.length) continue;
    rows.push({ kind: "project", p, start: mine.reduce((m, t) => (t.plannedStart < m ? t.plannedStart : m), mine[0].plannedStart), end: mine.reduce((m, t) => (t.plannedEnd > m ? t.plannedEnd : m), mine[0].plannedEnd) });
    if (!open.has(p.id)) continue;
    const kids = new Map<string, WsTask[]>();
    for (const t of mine) if (t.parentId) kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t]);
    for (const s of mine.filter((t) => !t.parentId).sort((a, b) => a.sortOrder - b.sortOrder || a.plannedStart.localeCompare(b.plannedStart))) {
      const k = kids.get(s.id) ?? [];
      rows.push({ kind: "task", p, t: s, depth: 0, hasKids: k.length > 0 });
      if (openSec.has(s.id)) for (const c of k.sort((a, b) => a.plannedStart.localeCompare(b.plannedStart))) rows.push({ kind: "task", p, t: c, depth: 1, hasKids: false });
    }
  }
  const all = tasks.length ? tasks : [];
  const first = all.reduce((m, t) => (t.plannedStart < m ? t.plannedStart : m), all[0]?.plannedStart ?? today);
  const last = all.reduce((m, t) => (t.plannedEnd > m ? t.plannedEnd : m), all[0]?.plannedEnd ?? today);
  const start = addDays([first, today].sort()[0], -7);
  const end = addDays([last, today].sort().at(-1)!, 21);
  const days = daysBetween(start, end) + 1;
  const width = days * px;
  const x = (d: string) => daysBetween(start, d) * px;
  const index = new Map(rows.map((r, i) => [r.kind === "task" ? r.t.id : `p:${r.p.id}`, i]));

  const months: { label: string; left: number }[] = [];
  for (let i = 0; i < days; i++) { const d = addDays(start, i); if (i === 0 || d.endsWith("-01")) months.push({ label: formatDay(d, { month: "short", year: "numeric" }), left: i * px }); }
  // A partial first month too narrow for its label would overlap the next one: leave it unlabeled.
  if (months.length > 1 && months[1].left - months[0].left < 72) months[0].label = "";

  const begin = (e: RPointerEvent, t: WsTask, p: WsProject, mode: Drag["mode"]) => {
    if (!p.permissions.edit || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: t.id, mode, x0: e.clientX, days: 0, pointer: e.pointerId });
  };
  const move = (e: RPointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = Math.round((e.clientX - drag.x0) / px);
    if (d !== drag.days) setDrag({ ...drag, days: d });
  };
  const up = (e: RPointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const t = tasks.find((z) => z.id === drag.id); const d = drag.days; const m = drag.mode;
    setDrag(null);
    if (!t) return;
    if (!d) { onOpen(t); return; }
    const s = m === "end" ? t.plannedStart : addDays(t.plannedStart, d);
    const en = m === "start" ? t.plannedEnd : addDays(t.plannedEnd, d);
    onDragEdit(t, s > en ? en : s, en < s ? s : en);
  };

  return (
    <div className="space-y-3" data-testid="view-timeline">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5" role="group" aria-label="Zoom">
          {(["day", "week", "month"] as Zoom[]).map((z) => <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} className={cn("min-h-9 rounded-md px-2.5 text-sm font-semibold capitalize", zoom === z ? "bg-navy text-white" : "text-ink-soft")}>{z}</button>)}
        </div>
        <button type="button" className="min-h-9 rounded-lg border border-line px-3 text-sm font-semibold" onClick={() => setOpen(new Set(projects.map((p) => p.id)))}>Expand all</button>
        <button type="button" className="min-h-9 rounded-lg border border-line px-3 text-sm font-semibold" onClick={() => { setOpen(new Set()); setOpenSec(new Set()); }}>Collapse all</button>
        <button type="button" className="min-h-9 rounded-lg border border-line px-3 text-sm font-semibold" onClick={() => scroller.current?.scrollTo({ left: Math.max(0, x(today) - 200), behavior: "smooth" })}>Today</button>
        <p className="w-full text-xs text-muted sm:ml-auto sm:w-auto">Drag a bar to move it, or its edges to change dates. You&apos;ll see what else moves before saving. Tap a bar for details.</p>
      </div>
      {rows.length === 0 && <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">No scheduled tasks match these filters in this date range.</p>}
      {rows.length > 0 && (
        <div ref={scroller} className="relative max-h-[70vh] overflow-auto rounded-xl border border-line bg-surface" role="region" aria-label="Company timeline">
          <div style={{ width: LABEL + width }} className="relative">
            <div className="sticky top-0 z-20 flex border-b border-line bg-surface" style={{ height: 28 }}>
              <div className="sticky left-0 z-30 shrink-0 border-r border-line bg-surface px-3 py-1 text-xs font-bold uppercase tracking-wider text-muted" style={{ width: LABEL }}>Project / task</div>
              <div className="relative" style={{ width }}>{months.map((m) => <div key={m.left} className="absolute top-0 border-l border-line px-1 text-xs font-semibold leading-7 text-ink-soft" style={{ left: m.left }}>{m.label}</div>)}</div>
            </div>
            <div className="relative" style={{ height: rows.length * ROW }} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
              {today >= start && today <= end && <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-danger/70" style={{ left: LABEL + x(today) + px / 2 }} data-testid="timeline-today" aria-hidden />}
              <svg className="pointer-events-none absolute top-0 z-10" style={{ left: LABEL, width, height: rows.length * ROW }} aria-hidden>
                {deps.map((d) => {
                  const a = index.get(d.from), b = index.get(d.to);
                  if (a === undefined || b === undefined) return null;
                  const ra = rows[a], rb = rows[b];
                  if (ra.kind !== "task" || rb.kind !== "task") return null;
                  const x1 = x(ra.t.plannedEnd) + px, y1 = a * ROW + ROW / 2, x2 = x(rb.t.plannedStart), y2 = b * ROW + ROW / 2;
                  return <path key={`${d.from}-${d.to}`} d={`M${x1},${y1} H${x1 + 6} V${y2} H${x2}`} fill="none" stroke="var(--color-muted)" strokeWidth="1" />;
                })}
              </svg>
              {rows.map((r, i) => {
                if (r.kind === "project") {
                  const isOpen = open.has(r.p.id);
                  return (
                    <div key={`p:${r.p.id}`} className="absolute inset-x-0 flex border-b border-line bg-paper/60" style={{ top: i * ROW, height: ROW }} data-testid="timeline-project">
                      <button type="button" className="sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-line bg-paper px-2 text-left text-sm font-bold text-navy" style={{ width: LABEL }}
                        onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(r.p.id)) n.delete(r.p.id); else n.add(r.p.id); return n; })} aria-expanded={isOpen}>
                        {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}<span className="truncate">{r.p.name}</span>
                      </button>
                      <div className="relative" style={{ width }}>
                        <div className="absolute top-2.5 h-3 rounded-full border" style={{ ...projectStyle(r.p.id), left: x(r.start), width: Math.max((daysBetween(r.start, r.end) + 1) * px, px) }} title={`${r.p.name}: ${formatRange(r.start, r.end)} · ${r.p.progress}%`}>
                          <div className="h-full rounded-full" style={{ width: `${r.p.progress}%`, backgroundColor: projectStyle(r.p.id).borderColor, opacity: 0.6 }} />
                        </div>
                      </div>
                    </div>
                  );
                }
                const t = r.t;
                const dr = drag?.id === t.id ? drag : null;
                const s = dr && dr.mode !== "end" ? addDays(t.plannedStart, dr.days) : t.plannedStart;
                const e = dr && dr.mode !== "start" ? addDays(t.plannedEnd, dr.days) : t.plannedEnd;
                const w = Math.max((daysBetween(s, e < s ? s : e) + 1) * px, px);
                const st = STATUS_STYLE[t.status];
                const who = labelOf(t);
                const edit = r.p.permissions.edit;
                return (
                  <div key={t.id} className="absolute inset-x-0 flex border-b border-line/60" style={{ top: i * ROW, height: ROW }}>
                    <div className="sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-line bg-surface pr-2 text-sm" style={{ width: LABEL, paddingLeft: 12 + r.depth * 14 }}>
                      {r.hasKids ? <button type="button" aria-label={openSec.has(t.id) ? "Collapse section" : "Expand section"} aria-expanded={openSec.has(t.id)} onClick={() => setOpenSec((x0) => { const n = new Set(x0); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}>
                        {openSec.has(t.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button> : <span className="w-3.5" />}
                      <span className="min-w-0 flex-1 truncate" title={t.name}>{t.name}</span>
                      {who && <span className="max-w-[5rem] truncate text-[11px] text-muted" title={who}>{who}</span>}
                    </div>
                    <div className="relative" style={{ width }}>
                      <button type="button" data-testid={`tl-bar-${t.id}`}
                        onPointerDown={(ev) => begin(ev, t, r.p, "move")}
                        onClick={(ev) => { if (!edit) onOpen(t); ev.preventDefault(); }}
                        onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onOpen(t); } }}
                        className={cn("group absolute top-1.5 h-6 touch-none overflow-hidden rounded border-l-4 text-left", edit && "cursor-grab", dr && "ring-2 ring-accent-ink")}
                        style={{ ...projectStyle(r.p.id), left: x(s), width: w }}
                        aria-label={`${r.p.name}: ${t.name}, ${formatRange(t.plannedStart, t.plannedEnd)}, ${statusLabel(t.status)} ${t.percentComplete}%`}>
                        <span className={cn("absolute inset-y-0 left-0 opacity-50", st.fill)} style={{ width: `${t.percentComplete}%` }} aria-hidden />
                        {w > 70 && <span className="relative block truncate px-1.5 text-[11px] font-semibold leading-6 text-ink">{t.percentComplete}% · {statusLabel(t.status)}</span>}
                        {edit && <>
                          <span onPointerDown={(ev) => begin(ev, t, r.p, "start")} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize group-hover:bg-navy/20" aria-hidden />
                          <span onPointerDown={(ev) => begin(ev, t, r.p, "end")} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize group-hover:bg-navy/20" aria-hidden data-testid={`tl-end-${t.id}`} />
                        </>}
                      </button>
                      {t.actualStart && <span className="absolute bottom-0.5 h-1 rounded-full bg-navy" style={{ left: x(t.actualStart), width: Math.max((daysBetween(t.actualStart, t.actualFinish ?? (today > t.actualStart ? today : t.actualStart)) + 1) * px, 3) }} title="Actual dates" aria-hidden />}
                      {dr && <span className="absolute -top-0.5 z-30 rounded bg-navy px-1.5 text-[11px] font-semibold text-white" style={{ left: x(s) }}>{formatRange(s, e < s ? s : e)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <p className="text-xs text-muted">Bars use each project&apos;s color with the task name and status in text. The thin dark line under a bar shows actual dates.</p>
    </div>
  );
}
