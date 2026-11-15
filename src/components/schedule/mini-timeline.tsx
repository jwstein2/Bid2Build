import { daysBetween, formatDay, formatRange } from "@/lib/schedule/calendar";

/** Read-only timeline used in the wizard's review step: one bar per section, positioned by date. */
export function MiniTimeline({ rows }: { rows: { id: string; name: string; start: string; end: string }[] }) {
  if (!rows.length) return null;
  const first = rows.reduce((m, r) => (r.start < m ? r.start : m), rows[0].start);
  const last = rows.reduce((m, r) => (r.end > m ? r.end : m), rows[0].end);
  const span = daysBetween(first, last) + 1;
  return (
    <div className="space-y-2" data-testid="mini-timeline">
      <div className="flex justify-between text-xs text-muted"><span>{formatDay(first)}</span><span>{formatDay(last)}</span></div>
      <ul className="space-y-2">
        {rows.map((r) => {
          const left = (daysBetween(first, r.start) / span) * 100;
          const width = Math.max(((daysBetween(r.start, r.end) + 1) / span) * 100, 2);
          return (
            <li key={r.id} className="grid grid-cols-1 gap-1 sm:grid-cols-[12rem_1fr] sm:items-center sm:gap-3">
              <span className="truncate text-sm font-semibold text-navy" title={r.name}>{r.name}</span>
              <div className="relative h-7 rounded-md bg-paper">
                <div className="absolute inset-y-1 rounded border border-accent-ink/60 bg-accent-tint" style={{ left: `${left}%`, width: `${width}%` }} />
                <span className="sr-only">{formatRange(r.start, r.end)}</span>
              </div>
              <span className="text-xs text-muted sm:col-start-2">{formatRange(r.start, r.end)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
