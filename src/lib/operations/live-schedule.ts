/**
 * Live schedule confirmation (V4.3): which tasks a proposed edit moves, so the PM confirms the whole
 * change once (after a drag ends, not on every intermediate move). Tasks that move only because they
 * depend on a directly changed task are marked downstream.
 */
export interface DatedTask { id: string; name: string; plannedStart: string; plannedEnd: string; durationDays?: number }
export interface LiveChange { taskId: string; name: string; from: { start: string; end: string }; to: { start: string; end: string }; downstream: boolean }

export function liveDateChanges(before: DatedTask[], after: DatedTask[], deps: { from: string; to: string }[] = []): LiveChange[] {
  const prev = new Map(before.map((t) => [t.id, t]));
  const moved: LiveChange[] = [];
  for (const t of after) {
    const o = prev.get(t.id);
    if (!o) continue; // new tasks aren't changes to the live plan's existing dates
    if (o.plannedStart !== t.plannedStart || o.plannedEnd !== t.plannedEnd)
      moved.push({ taskId: t.id, name: t.name, from: { start: o.plannedStart, end: o.plannedEnd }, to: { start: t.plannedStart, end: t.plannedEnd }, downstream: false });
  }
  if (moved.length < 2) return moved;
  // A moved task is downstream when one of its predecessors (directly or transitively) also moved.
  const ids = new Set(moved.map((m) => m.taskId));
  const preds = new Map<string, string[]>();
  for (const d of deps) preds.set(d.to, [...(preds.get(d.to) ?? []), d.from]);
  const hasMovedAncestor = (id: string, seen = new Set<string>()): boolean => {
    for (const p of preds.get(id) ?? []) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (ids.has(p) || hasMovedAncestor(p, seen)) return true;
    }
    return false;
  };
  for (const m of moved) m.downstream = hasMovedAncestor(m.taskId);
  return moved.sort((a, b) => Number(a.downstream) - Number(b.downstream) || a.from.start.localeCompare(b.from.start));
}
