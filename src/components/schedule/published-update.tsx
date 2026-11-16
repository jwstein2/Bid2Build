"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, Send } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { DELIVERY_LABEL } from "@/lib/schedule/report";
import type { Publication } from "@/lib/schedule/publications";
import { ReportView } from "./report-view";
import { UpdateDelivery } from "./update-delivery";

const when = (iso: string, tz: string) => new Date(iso).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function LinkBadge({ p }: { p: Publication }) {
  const s = p.link.state;
  if (s === "none") return null;
  return <Badge tone={s === "active" ? "ok" : "neutral"}>{s === "active" ? "Link active" : s === "expired" ? "Link expired" : "Link turned off"}</Badge>;
}

/** What happened to an update, in honest words (an opened draft is not a delivered email). */
export function DeliveryList({ p, tz }: { p: Publication; tz: string }) {
  const events = [...p.delivery].reverse();
  return (
    <ul className="space-y-0.5 text-xs text-ink-soft" data-testid="delivery-list">
      {p.link.viewCount > 0 && p.link.lastViewedAt && <li className="font-semibold text-navy">Link opened {p.link.viewCount} time{p.link.viewCount === 1 ? "" : "s"}, last {when(p.link.lastViewedAt, tz)}</li>}
      {events.slice(0, 8).map((d, i) => <li key={i}>{DELIVERY_LABEL[d.method] ?? d.method} · {when(d.at, tz)}</li>)}
      {!events.length && <li>Not shared yet.</li>}
    </ul>
  );
}

export function PublishedUpdate({ scheduleId, scheduleName, initial, canEdit, canPdf = true, logoUrl, customerEmail, contactName, timezone }: {
  scheduleId: string; scheduleName: string; initial: Publication; canEdit: boolean; canPdf?: boolean; logoUrl: string | null; customerEmail: string | null; contactName: string | null; timezone: string;
}) {
  const [p, setP] = useState(initial);
  return (
    <div className="space-y-4" data-testid="published-update">
      <div>
        <Link href={`/projects/${scheduleId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> {scheduleName}</Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-extrabold text-navy">Customer update {p.version} <LinkBadge p={p} /></h1>
        <p className="mt-1 text-sm text-ink-soft">Published {when(p.publishedAt, timezone)}{p.publisherName ? ` by ${p.publisherName}` : ""}. This is the saved copy; later schedule changes don&apos;t alter it.</p>
        <div className="mt-2"><DeliveryList p={p} tz={timezone} /></div>
      </div>
      {canEdit && <UpdateDelivery scheduleId={scheduleId} publication={p} customerEmail={customerEmail} contactName={contactName} onChange={setP} canPdf={canPdf} />}
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-soft"><Eye className="h-4 w-4" aria-hidden /> What your customer sees</p>
      <ReportView r={p.content} logoUrl={logoUrl} version={p.version} />
    </div>
  );
}

/** Customer updates on the schedule page: history plus the Preview Customer Update entry point. */
export function PublicationHistory({ scheduleId, publications, canEdit, timezone }: { scheduleId: string; publications: Publication[]; canEdit: boolean; timezone: string }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4" data-testid="updates-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-extrabold text-navy">Customer updates</h2>
        {canEdit && <Link href={`/projects/${scheduleId}/update`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-navy px-3 text-sm font-semibold text-white hover:bg-navy/90"><Send className="h-4 w-4" aria-hidden /> New customer update</Link>}
      </div>
      <p className="mt-1 text-sm text-ink-soft">Schedule edits stay internal. Your customer sees only updates you preview and publish.</p>
      {publications.length === 0 ? <p className="mt-3 text-sm text-muted">No updates published yet.</p> : (
        <ol className="mt-3 divide-y divide-line">
          {publications.map((p, i) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5" data-testid={`publication-${p.version}`}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold">Update {p.version}{i === 0 && <Badge tone="accent">Latest</Badge>}<LinkBadge p={p} /></p>
                <p className="text-xs text-muted">{when(p.publishedAt, timezone)}{p.publisherName ? ` · ${p.publisherName}` : ""}{p.content.progress !== null ? ` · ${p.content.progress}% complete` : ""}{p.content.forecastFinish ? ` · forecast ${new Date(`${p.content.forecastFinish}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}` : ""}</p>
                <div className="mt-1"><DeliveryList p={p} tz={timezone} /></div>
              </div>
              <Link href={`/projects/${scheduleId}/updates/${p.id}`} className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-sm font-semibold text-navy hover:bg-black/5">View</Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
