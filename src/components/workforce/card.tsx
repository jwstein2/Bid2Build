"use client";
import { AlertTriangle, Building2, CalendarClock, HardHat, Mail, Phone, User, Users } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { formatDay, formatRange } from "@/lib/schedule/calendar";
import { tradeLabel } from "@/lib/projects/team";
import { relationshipLabel, sectionOf, type DirEntry, type AvailabilityState } from "@/lib/workforce/model";

const ICON = { companies: Building2, individuals: HardHat, employees: User, crews: Users } as const;
export const AVAIL_STYLE: Record<AvailabilityState, string> = {
  available: "bg-ok-tint text-ok ring-ok/30",
  partial: "bg-warn-tint text-warn ring-warn/30",
  busy: "bg-danger-tint text-danger ring-danger/30",
  off: "bg-paper text-ink-soft ring-line",
  unknown: "bg-paper text-ink-soft ring-line",
};

/** One directory card. The whole card opens the profile; Assign is its own button. */
export function WorkforceCard({ e, workers, onOpen, onAssign, canAssign }: {
  e: DirEntry; workers: number; onOpen: () => void; onAssign: () => void; canAssign: boolean;
}) {
  const { r, parent, s } = e;
  const sec = sectionOf(r);
  const Icon = ICON[sec];
  const size = r.kind === "crew" ? (r.crewSize ?? (r.members.length || null)) : r.crewSize;
  return (
    <li className="group relative flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4 transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-accent" data-testid="wf-card" data-resource-id={r.id}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-paper text-navy"><Icon className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug text-navy">
            {/* Stretched link: the whole card is clickable, other buttons sit above it. */}
            <button type="button" onClick={onOpen} className="text-left after:absolute after:inset-0 after:rounded-xl focus:outline-none" data-testid="wf-open">{r.name}</button>
          </h3>
          <p className="text-xs text-ink-soft">{relationshipLabel(r, parent)}{r.contactName ? ` · ${r.contactName}` : ""}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${AVAIL_STYLE[s.availability.state]}`} data-testid="wf-availability" title={s.availability.detail ?? undefined}>{s.availability.label}</span>
      </div>

      {r.trades.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1" aria-label="Trades">
          <span className="rounded-full bg-navy px-2 py-0.5 text-xs font-semibold text-white">{tradeLabel(r.trades[0])}</span>
          {r.trades.slice(1, 4).map((t) => <span key={t} className="rounded-full bg-paper px-2 py-0.5 text-xs font-semibold text-ink-soft">{tradeLabel(t)}</span>)}
          {r.trades.length > 4 && <span className="px-1 text-xs text-muted">+{r.trades.length - 4}</span>}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-paper px-1 py-1.5"><dt className="text-[11px] text-muted">Active</dt><dd className="text-lg font-extrabold text-navy" data-testid="wf-active">{s.active}</dd></div>
        <div className="rounded-lg bg-paper px-1 py-1.5"><dt className="text-[11px] text-muted">Upcoming</dt><dd className="text-lg font-extrabold text-navy" data-testid="wf-upcoming">{s.upcoming}</dd></div>
        <div className="rounded-lg bg-paper px-1 py-1.5"><dt className="text-[11px] text-muted">{sec === "companies" ? "Workers" : sec === "crews" ? "Crew size" : "Done"}</dt>
          <dd className="text-lg font-extrabold text-navy">{sec === "companies" ? (workers || size || "–") : sec === "crews" ? (size ?? "–") : s.completed}</dd></div>
      </dl>

      <div className="mt-3 space-y-1 text-sm">
        {s.next
          ? <p className="flex items-start gap-1.5 text-ink-soft"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-hidden />
              <span><span className="font-semibold text-ink">{s.next.start <= (s.next.end) && s.next.lifecycle === "in_progress" ? "Now" : `Next ${formatDay(s.next.start)}`}:</span> {s.next.project}{s.next.via ? ` (${s.next.via.name})` : ""} <span className="text-muted">· {formatRange(s.next.start, s.next.end)}</span></span></p>
          : <p className="text-muted">No scheduled work</p>}
        {s.projects.length > 1 && <p className="truncate text-xs text-muted" title={s.projects.join(", ")}>On: {s.projects.join(", ")}</p>}
        {s.conflicts > 0 && <p className="flex items-center gap-1.5 text-sm font-semibold text-danger" data-testid="wf-conflict"><AlertTriangle className="h-4 w-4" aria-hidden />{s.conflicts} scheduling conflict{s.conflicts === 1 ? "" : "s"}</p>}
      </div>

      <div className="relative z-[1] mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
        {r.phone && <a href={`tel:${r.phone}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2 font-semibold" aria-label={`Call ${r.name}`}><Phone className="h-4 w-4" aria-hidden /><span className="max-sm:sr-only">Call</span></a>}
        {r.email && <a href={`mailto:${r.email}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2 font-semibold" aria-label={`Email ${r.name}`}><Mail className="h-4 w-4" aria-hidden /><span className="max-sm:sr-only">Email</span></a>}
        {r.contactHidden && <Badge>Contact private</Badge>}
        {r.status === "archived" && <Badge tone="warn">Archived</Badge>}
        {canAssign && r.status === "active" && (
          <button type="button" onClick={onAssign} className={buttonClass("accent", "sm", "ml-auto min-h-9")} data-testid="wf-assign" data-guide="workforce.assign">Assign to project</button>
        )}
      </div>
    </li>
  );
}
