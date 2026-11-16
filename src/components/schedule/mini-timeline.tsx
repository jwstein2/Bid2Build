"use client";
import { useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { addDays, daysBetween, formatDay, formatRange, isIsoDate } from "@/lib/schedule/calendar";

export interface MiniRow { id: string; name: string; start: string; end: string; durationDays?: number }
/** A requested change from the review step: a new start (move), a new finish (resize right) or both (resize left). */
export interface MiniEdit { id: string; start?: string; end?: string; durationDays?: number }

type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; days: number; pointer: number; dayPx: number };

/**
 * Timeline used in the wizard's review step: one bar per section, positioned by date. When `onEdit`
 * is given the bars can be dragged to move a section, either edge dragged to change its dates, the
 * arrow keys used (Shift+arrows change the finish), or "Edit dates" used on a phone.
 */
export function MiniTimeline({ rows, onEdit }: { rows: MiniRow[]; onEdit?: (e: MiniEdit) => void }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  if (!rows.length) return null;
  const first = rows.reduce((m, r) => (r.start < m ? r.start : m), rows[0].start);
  const lastBar = rows.reduce((m, r) => (r.end > m ? r.end : m), rows[0].end);
  const barSpan = daysBetween(first, lastBar) + 1;
  // Leave room on the right so a bar can be dragged later than the current finish.
  const pad = onEdit ? Math.max(5, Math.round(barSpan * 0.25)) : 0;
  const last = addDays(lastBar, pad);
  const span = barSpan + pad;
  const editable = Boolean(onEdit);

  const begin = (e: RPointerEvent, id: string, mode: Drag["mode"]) => {
    if (!onEdit || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const w = track.current?.getBoundingClientRect().width ?? 600;
    setDrag({ id, mode, x0: e.clientX, days: 0, pointer: e.pointerId, dayPx: w / span });
  };
  const move = (e: RPointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = Math.round((e.clientX - drag.x0) / drag.dayPx);
    if (d !== drag.days) setDrag({ ...drag, days: d });
  };
  const end = (e: RPointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const r = rows.find((x) => x.id === drag.id);
    const d = drag.days;
    setDrag(null);
    if (!r || !d || !onEdit) return;
    if (drag.mode === "move") onEdit({ id: r.id, start: addDays(r.start, d) });
    else if (drag.mode === "end") onEdit({ id: r.id, end: maxDay(addDays(r.end, d), r.start) });
    else onEdit({ id: r.id, start: minDay(addDays(r.start, d), r.end), end: r.end });
  };
  const key = (e: RKeyboardEvent, r: MiniRow) => {
    if (!onEdit || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    if (e.shiftKey) { const ne = addDays(r.end, dir); if (ne >= r.start) onEdit({ id: r.id, end: ne }); }
    else onEdit({ id: r.id, start: addDays(r.start, dir) });
  };

  return (
    <div className="space-y-2" data-testid="mini-timeline">
      <div className="flex justify-between text-xs text-muted sm:pl-[12.75rem]"><span>{formatDay(first)}</span><span>{formatDay(last)}</span></div>
      <ul className="space-y-2" onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}>
        {rows.map((r, i) => {
          const dr = drag?.id === r.id ? drag : null;
          const s = dr && dr.mode !== "end" ? (dr.mode === "start" ? minDay(addDays(r.start, dr.days), r.end) : addDays(r.start, dr.days)) : r.start;
          const en = dr && dr.mode !== "start" ? (dr.mode === "end" ? maxDay(addDays(r.end, dr.days), r.start) : addDays(r.end, dr.days)) : r.end;
          const left = Math.max(0, (daysBetween(first, s) / span) * 100);
          const width = Math.max(((daysBetween(s, en) + 1) / span) * 100, 2);
          return (
            <li key={r.id} className="grid grid-cols-1 gap-1 sm:grid-cols-[12rem_1fr] sm:items-center sm:gap-3" data-testid={`mini-row-${r.id}`}>
              <span className="truncate text-sm font-semibold text-navy" title={r.name}>{r.name}</span>
              <div ref={i === 0 ? track : undefined} className="relative h-8 rounded-md bg-paper">
                <div
                  role={editable ? "button" : undefined}
                  tabIndex={editable ? 0 : undefined}
                  aria-label={editable ? `${r.name}, ${formatRange(r.start, r.end)}. Drag or use arrow keys to move; Shift plus arrow keys changes the finish.` : undefined}
                  onPointerDown={editable ? (ev) => begin(ev, r.id, "move") : undefined}
                  onKeyDown={editable ? (ev) => key(ev, r) : undefined}
                  data-testid={`mini-bar-${r.id}`}
                  className={cn(
                    "group absolute inset-y-1 touch-none select-none rounded border border-accent-ink/60 bg-accent-tint",
                    editable && "cursor-grab focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink active:cursor-grabbing",
                    dr && "ring-2 ring-accent-ink",
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  {editable && <>
                    <span onPointerDown={(ev) => begin(ev, r.id, "start")} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l bg-accent-ink/0 group-hover:bg-accent-ink/30" aria-hidden data-testid={`mini-start-${r.id}`} />
                    <span onPointerDown={(ev) => begin(ev, r.id, "end")} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r bg-accent-ink/0 group-hover:bg-accent-ink/30" aria-hidden data-testid={`mini-end-${r.id}`} />
                  </>}
                </div>
                {dr && <span className="absolute -top-5 z-10 whitespace-nowrap rounded bg-navy px-1.5 text-[11px] font-semibold text-white" style={{ left: `${Math.min(left, 70)}%` }}>{formatRange(s, en)}</span>}
                <span className="sr-only">{formatRange(r.start, r.end)}</span>
              </div>
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted sm:col-start-2">
                {formatRange(r.start, r.end)}
                {editable && (
                  <button type="button" className="inline-flex min-h-8 items-center gap-1 font-semibold text-accent-ink hover:underline" onClick={() => setEditing(editing === r.id ? null : r.id)} aria-expanded={editing === r.id}>
                    <Pencil className="h-3 w-3" aria-hidden /> Edit dates
                  </button>
                )}
              </span>
              {editable && editing === r.id && <DateEditor row={r} onSave={(e) => { onEdit!(e); setEditing(null); }} onCancel={() => setEditing(null)} />}
            </li>
          );
        })}
      </ul>
      {editable && <p className="text-xs text-muted">Drag a bar to move it, or drag its edges to change the dates. Sections that wait on it move with it.</p>}
    </div>
  );
}

function DateEditor({ row, onSave, onCancel }: { row: MiniRow; onSave: (e: MiniEdit) => void; onCancel: () => void }) {
  const [start, setStart] = useState(row.start);
  const [days, setDays] = useState(row.durationDays ?? 1);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-2 sm:col-start-2" data-testid={`mini-editor-${row.id}`}>
      <label className="block"><span className="label">Start</span><input type="date" className="field" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label className="block"><span className="label">Working days</span>
        <input type="number" min={1} max={3650} inputMode="numeric" className="field w-24" value={days} onChange={(e) => setDays(Math.max(1, Math.min(3650, Math.round(Number(e.target.value) || 1))))} /></label>
      <button type="button" className="min-h-10 rounded-lg bg-navy px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={!isIsoDate(start)} onClick={() => onSave({ id: row.id, start, durationDays: days })}>Apply</button>
      <button type="button" className="min-h-10 rounded-lg border border-line px-3 text-sm font-semibold" onClick={onCancel}>Cancel</button>
    </div>
  );
}

const minDay = (a: string, b: string) => (a < b ? a : b);
const maxDay = (a: string, b: string) => (a > b ? a : b);
