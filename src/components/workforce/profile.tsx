"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Mail, Pencil, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { formatDay, formatRange } from "@/lib/schedule/calendar";
import { tradeLabel } from "@/lib/projects/team";
import {
  bookingsFor, conflictsFor, isLive, LIFECYCLE_LABEL, LIFECYCLE_TONE, relationshipLabel, summarize, type Booking, type WfResource, type Workforce,
} from "@/lib/workforce/model";
import { AVAIL_STYLE } from "./card";
import { Drawer } from "./drawer";

interface HistoryEvent { id: number; action: string; status: string | null; task: string | null; project: string; scheduleId: string; resourceId: string | null; source: string; overrideReason: string | null; actor: string | null; at: string }
const ACTION: Record<string, string> = { assigned: "Assigned", reassigned: "Reassigned", cleared: "Removed", status: "Status changed", details: "Details updated" };

function BookingRow({ b, today }: { b: Booking; today: string }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2.5" data-testid="wf-booking">
      <div className="min-w-0">
        <Link href={`/projects/${b.scheduleId}`} className="font-semibold text-navy hover:underline">{b.project}</Link>
        <p className="text-xs text-ink-soft">{[b.customer, b.task, b.trade ? tradeLabel(b.trade) : null].filter(Boolean).join(" · ")}{b.via ? ` · via ${b.via.name}` : ""}</p>
        <p className="text-xs text-muted">{formatRange(b.start, b.end)}{b.startTime && b.endTime ? ` · ${b.startTime}–${b.endTime}` : ""}{b.hours ? ` · ${b.hours} h est.` : ""}</p>
        {b.notes && <p className="mt-0.5 text-xs text-ink-soft">{b.notes}</p>}
      </div>
      <Badge tone={LIFECYCLE_TONE[b.lifecycle]}>{b.lifecycle === "in_progress" && b.start > today ? "Confirmed" : LIFECYCLE_LABEL[b.lifecycle]}</Badge>
    </li>
  );
}

/** Contractor / worker profile: info, trades, contact, team, schedule, completed work, notes, history. */
export function WorkforceProfile({ wf, r, today, open, onOpenChange, onAssign, onEdit, onOpenOther }: {
  wf: Workforce; r: WfResource; today: string; open: boolean; onOpenChange: (o: boolean) => void;
  onAssign: () => void; onEdit: () => void; onOpenOther: (id: string) => void;
}) {
  const parent = r.parentId ? wf.resources.find((x) => x.id === r.parentId) ?? null : null;
  const workers = wf.resources.filter((x) => x.parentId === r.id && x.status === "active");
  const members = r.members.map((m) => wf.resources.find((x) => x.id === m)).filter((x): x is WfResource => !!x);
  const crews = wf.resources.filter((c) => c.kind === "crew" && c.members.includes(r.id));
  const bookings = bookingsFor(wf, r, today);
  const live = bookings.filter((b) => isLive(b.lifecycle));
  const current = live.filter((b) => b.start <= today);
  const upcoming = live.filter((b) => b.start > today);
  const done = bookings.filter((b) => b.lifecycle === "completed");
  const s = summarize(wf, r, today);
  const conflicts = conflictsFor(wf, r, today);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api<{ events: HistoryEvent[] }>(`/api/workforce/history?id=${r.id}`).then((x) => { if (live) setHistory(x.ok ? x.data.events : []); });
    return () => { live = false; };
  }, [open, r.id]);
  const nameOf = (id: string | null) => wf.resources.find((x) => x.id === id)?.name ?? null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} testId="wf-profile" guide="workforce.profile" wide
      title={r.name} subtitle={<span className="flex flex-wrap items-center gap-2">{relationshipLabel(r, parent)}
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${AVAIL_STYLE[s.availability.state]}`}>{s.availability.label}{s.availability.detail ? ` · ${s.availability.detail}` : ""}</span></span>}>
      <div className="flex flex-wrap gap-2">
        {wf.canManage && r.status === "active" && <Button size="sm" variant="accent" onClick={onAssign} data-testid="wf-profile-assign"><Plus className="h-4 w-4" aria-hidden /> Assign to project</Button>}
        {wf.canManage && r.status === "active" && <Button size="sm" variant="secondary" onClick={onEdit} data-testid="wf-profile-edit"><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>}
        {r.kind === "subcontractor" && !r.parentId && wf.canManage && <Link href={`/projects/team/subs/${r.id}`} className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent-ink underline">W-9, insurance &amp; agreements</Link>}
      </div>

      {conflicts.length > 0 && (
        <Notice tone="warn" title={`${conflicts.length} scheduling conflict${conflicts.length === 1 ? "" : "s"}`}>
          <ul className="mt-1 list-disc space-y-1 pl-5" data-testid="wf-profile-conflicts">
            {conflicts.map((c, i) => <li key={i}>{formatRange(c.from, c.to)}: {[...new Set(c.bookings.map((b) => b.project))].join(" and ")}{c.kind === "double_booked" ? " overlap" : ` (more than ${r.capacity} job${r.capacity === 1 ? "" : "s"} at once)`}.</li>)}
          </ul>
          <p className="mt-1 text-xs">Nothing was moved. Change dates in the project schedule, or reassign one of them.</p>
        </Notice>
      )}

      <section aria-labelledby="wf-p-info">
        <h3 id="wf-p-info" className="text-sm font-bold uppercase tracking-wide text-muted">Details</h3>
        <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Trades</dt><dd>{r.trades.length ? r.trades.map((t, i) => <span key={t} className={`mr-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${i === 0 ? "bg-navy text-white" : "bg-paper text-ink-soft"}`}>{tradeLabel(t)}</span>) : "Not set"}</dd></div>
          {r.specialties.length > 0 && <div><dt className="text-muted">Specialties</dt><dd>{r.specialties.join(", ")}</dd></div>}
          {r.contactName && <div><dt className="text-muted">Contact</dt><dd>{r.contactName}</dd></div>}
          <div><dt className="text-muted">Capacity</dt><dd>{r.kind === "staff" || r.entity === "individual" ? "One job at a time" : r.capacityDeclared ? `Up to ${r.capacity} job${r.capacity === 1 ? "" : "s"} at once` : "Not set (availability shows as unknown)"}</dd></div>
          {(r.crewSize || r.kind === "crew") && <div><dt className="text-muted">{r.kind === "crew" ? "Crew size" : "Crew size (people)"}</dt><dd>{r.crewSize ?? (members.length || "Not set")}</dd></div>}
          {r.unavailable.filter((d) => d >= today).length > 0 && <div><dt className="text-muted">Days off ahead</dt><dd>{r.unavailable.filter((d) => d >= today).slice(0, 6).map((d) => formatDay(d)).join(", ")}</dd></div>}
          <div className="sm:col-span-2"><dt className="text-muted">Contact methods</dt><dd className="mt-1 flex flex-wrap gap-2">
            {r.phone && <a href={`tel:${r.phone}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2.5 font-semibold"><Phone className="h-4 w-4" aria-hidden />{r.phone}</a>}
            {r.email && <a href={`mailto:${r.email}`} className="inline-flex min-h-9 min-w-0 items-center gap-1 rounded-lg border border-line px-2.5 font-semibold"><Mail className="h-4 w-4 shrink-0" aria-hidden /><span className="truncate">{r.email}</span></a>}
            {r.contactHidden && <span className="text-ink-soft">Employee contact details are private. Managers can see them.</span>}
            {!r.phone && !r.email && !r.contactHidden && <span className="text-muted">None saved</span>}
          </dd></div>
        </dl>
      </section>

      {(parent || workers.length > 0 || members.length > 0 || crews.length > 0) && (
        <section aria-labelledby="wf-p-team">
          <h3 id="wf-p-team" className="text-sm font-bold uppercase tracking-wide text-muted">Team</h3>
          <ul className="mt-2 flex flex-wrap gap-2" data-testid="wf-profile-team">
            {parent && <li><button type="button" className="rounded-full border border-line px-3 py-1 text-sm font-semibold hover:bg-paper" onClick={() => onOpenOther(parent.id)}>Company: {parent.name}</button></li>}
            {[...workers, ...members].map((w) => <li key={w.id}><button type="button" className="rounded-full border border-line px-3 py-1 text-sm hover:bg-paper" onClick={() => onOpenOther(w.id)}>{w.name}{w.trades[0] ? ` · ${tradeLabel(w.trades[0])}` : ""}</button></li>)}
            {crews.map((c) => <li key={c.id}><button type="button" className="rounded-full border border-line px-3 py-1 text-sm hover:bg-paper" onClick={() => onOpenOther(c.id)}>Crew: {c.name}</button></li>)}
          </ul>
        </section>
      )}

      <section aria-labelledby="wf-p-now">
        <h3 id="wf-p-now" className="text-sm font-bold uppercase tracking-wide text-muted">Assigned projects ({current.length})</h3>
        {current.length ? <ul className="divide-y divide-line">{current.map((b) => <BookingRow key={b.taskId} b={b} today={today} />)}</ul>
          : <p className="mt-1 text-sm text-muted">Not on a job right now.</p>}
      </section>
      <section aria-labelledby="wf-p-next" data-guide="workforce.schedule">
        <h3 id="wf-p-next" className="text-sm font-bold uppercase tracking-wide text-muted">Upcoming schedule ({upcoming.length})</h3>
        {upcoming.length ? <ul className="divide-y divide-line">{upcoming.map((b) => <BookingRow key={b.taskId} b={b} today={today} />)}</ul>
          : <p className="mt-1 text-sm text-muted">Nothing scheduled yet.{wf.canManage && r.status === "active" ? " Use Assign to project to book them." : ""}</p>}
      </section>
      <section aria-labelledby="wf-p-done">
        <h3 id="wf-p-done" className="text-sm font-bold uppercase tracking-wide text-muted">Completed projects ({new Set(done.map((b) => b.scheduleId)).size})</h3>
        {done.length ? <ul className="divide-y divide-line">{done.slice(-10).reverse().map((b) => <BookingRow key={b.taskId} b={b} today={today} />)}</ul>
          : <p className="mt-1 text-sm text-muted">No completed work recorded yet.</p>}
      </section>

      {r.notes && <section aria-labelledby="wf-p-notes"><h3 id="wf-p-notes" className="text-sm font-bold uppercase tracking-wide text-muted">Notes</h3><p className="mt-1 whitespace-pre-wrap text-sm">{r.notes}</p></section>}

      <section aria-labelledby="wf-p-hist">
        <h3 id="wf-p-hist" className="text-sm font-bold uppercase tracking-wide text-muted">Activity</h3>
        {history === null ? <p className="mt-1 text-sm text-muted">Loading…</p> : history.length === 0 ? <p className="mt-1 text-sm text-muted">No assignment changes yet.</p> : (
          <ol className="mt-1 space-y-2 text-sm" data-testid="wf-history">
            {history.slice(0, 30).map((e) => (
              <li key={e.id} className="border-l-2 border-line pl-3">
                <p><span className="font-semibold">{ACTION[e.action] ?? e.action}</span>{e.resourceId && e.resourceId !== r.id ? ` (${nameOf(e.resourceId) ?? "worker"})` : ""}: {e.task} · <Link href={`/projects/${e.scheduleId}`} className="text-accent-ink hover:underline">{e.project}</Link>{e.status ? ` · ${e.status}` : ""}</p>
                <p className="text-xs text-muted">{new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{e.actor ? ` · ${e.actor}` : ""} · {e.source === "directory" ? "Contractors & Workforce" : "PM Hub"}</p>
                {e.overrideReason && <p className="mt-0.5 flex items-center gap-1 text-xs text-warn"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Conflict overridden: {e.overrideReason}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="flex items-center gap-1 text-xs text-muted"><ExternalLink className="h-3.5 w-3.5" aria-hidden />Project links open the schedule in PM Hub. Changes there show here right away.</p>
    </Drawer>
  );
}
