"use client";
import { formatRange } from "@/lib/schedule/calendar";
import { statusLabel } from "@/lib/schedule/types";
import { BUCKETS, projectDot, type Bucket, type WsProject, type WsTask } from "@/lib/projects/workspace";
import { STATUS_STYLE } from "@/components/schedule/client";

/** My Work: a light, phone-friendly list of my tasks (assigned to me or on projects I manage). */
export function MyWorkView({ buckets, projects, onOpen, labelOf }: {
  buckets: Record<Bucket, WsTask[]>; projects: WsProject[]; onOpen: (t: WsTask) => void; labelOf: (t: WsTask) => string | null;
}) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const total = BUCKETS.reduce((n, b) => n + (b.key === "completed" ? 0 : buckets[b.key].length), 0);
  return (
    <div className="space-y-4" data-testid="view-mywork">
      {total === 0 && (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          Nothing open for you. Tasks show here when they&apos;re assigned to you, or when you&apos;re the project manager.
        </p>
      )}
      {BUCKETS.map((b) => {
        const list = buckets[b.key];
        if (!list.length) return null;
        return (
          <section key={b.key} aria-labelledby={`mw-${b.key}`} data-testid={`bucket-${b.key}`}>
            <h2 id={`mw-${b.key}`} className={`text-sm font-bold uppercase tracking-wide ${b.key === "overdue" ? "text-warn" : "text-navy"}`}>{b.label} <span className="text-muted">({list.length})</span></h2>
            <ul className="mt-1 divide-y divide-line rounded-xl border border-line bg-surface">
              {list.map((t) => {
                const p = byId.get(t.scheduleId);
                const who = labelOf(t);
                const can = p?.permissions.progress || p?.permissions.edit;
                return (
                  <li key={t.id}>
                    <button type="button" onClick={() => onOpen(t)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-paper" data-testid="mywork-item">
                      <span className="h-8 w-1.5 shrink-0 rounded-full" style={projectDot(t.scheduleId)} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-navy">{t.name}</span>
                        <span className="block truncate text-sm text-ink-soft">{p?.name}{who ? ` · ${who}` : ""}</span>
                        <span className="block text-xs text-muted">{formatRange(t.plannedStart, t.plannedEnd)}</span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[t.status].chip}`}>{statusLabel(t.status)} · {t.percentComplete}%</span>
                        <span className="text-xs font-semibold text-accent-ink">{t.status === "complete" ? "View" : can ? "Update" : "View"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
