"use client";
import { CheckCircle2, ClipboardCheck, FileSignature, Image as ImageIcon, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/estimate/money";
import type { JobStatus } from "@/lib/operations/project-status";
import type { QueueItem } from "@/lib/operations/queue-server";
import { cn } from "@/lib/cn";
import { Button, ButtonLink } from "../ui/button";

interface ReviewDetail {
  estimate: { id: string; title: string; number: string; stage: string; trades: string[]; notes: string | null };
  customer: { name: string; email: string | null; phone: string | null; projectAddress: string | null };
  approval: { source: string; total: number; versionNumber: number | null; signedBy: string | null; signedAt: string | null } | null;
  review: { status: string; reviewed_at: string | null; review_note: string | null } | null;
  scope: string | null; exclusions: string | null;
  sections: { name: string; trade: string | null; price: string; cost?: string }[];
  financials: null | { cost: string; price: string; profit: string; margin: string | null };
  attachments: { photos: number; subQuotes: number };
}

const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso)) : "");

/**
 * "Newly Approved — Needs Review" (V4.3): Approved/Signed → Needs PM Review → Ready to Schedule →
 * Scheduled. The same list on Bids, Projects and the PM dashboard; opening an item shows the review
 * screen in a drawer (no new page), with "Mark Reviewed & Schedule".
 */
const ROW_LABEL: Partial<Record<JobStatus, string>> = { needs_review: "Needs review", ready_to_schedule: "Reviewed · ready to schedule", draft_schedule: "Reviewed · draft schedule" };

export function ReviewQueue({ items, canSchedule, compact, max }: { items: QueueItem[]; canSchedule: boolean; compact?: boolean; max?: number }) {
  const [open, setOpen] = useState<QueueItem | null>(null);
  const pending = items.filter((i) => i.status === "needs_review").slice(0, max ?? 50);
  // Reviewed jobs leave "needs review" and wait under "Ready to schedule" until an active schedule is saved.
  const ready = compact ? [] : items.filter((i) => i.status !== "needs_review").slice(0, max ?? 50);
  if (!pending.length && !ready.length) return compact ? null : <p className="text-sm text-muted">Nothing waiting. Newly approved and signed jobs appear here for review before scheduling.</p>;
  const row = (i: QueueItem) => (
    <li key={i.estimateId} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="review-item">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-navy">{i.title || "Untitled bid"}</p>
        <p className="text-sm text-ink-soft">{i.customerName || "—"}{i.number ? ` · #${i.number}` : ""} · {i.approvalSource === "signature" ? "Signed" : "Approved"} {day(i.approvedAt)}{i.reviewedAt ? ` · Reviewed ${day(i.reviewedAt)}` : ""}</p>
      </div>
      <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", i.status === "needs_review" ? "bg-warn-tint text-warn" : "bg-ok-tint text-ok")} data-testid="review-status">{(i.jobStatus && ROW_LABEL[i.jobStatus]) ?? (i.status === "needs_review" ? "Needs review" : "Reviewed")}</span>
      {i.status === "needs_review" ? <Button size="sm" onClick={() => setOpen(i)}>Review</Button>
        : i.scheduleId ? <ButtonLink size="sm" variant="secondary" href={`/projects/${i.scheduleId}`}>Open draft</ButtonLink>
        : canSchedule ? <ButtonLink size="sm" variant="accent" href={`/projects/new?estimate=${i.estimateId}`}>Schedule Now</ButtonLink>
        : <Button size="sm" variant="ghost" onClick={() => setOpen(i)}>Details</Button>}
    </li>
  );
  return (
    <section aria-labelledby="review-q-h" className={cn("rounded-xl border bg-surface", pending.length ? "border-accent" : "border-line")} data-testid="review-queue">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="review-q-h" className="flex items-center gap-2 font-display text-lg font-extrabold text-navy"><ClipboardCheck className="h-5 w-5 text-accent-ink" aria-hidden /> {pending.length || compact ? "Newly approved — needs review" : "Approved jobs — ready to schedule"}
          {pending.length > 0 && <span className="rounded-full bg-accent px-2 text-sm text-navy">{pending.length}</span>}</h2>
        {compact && <Link href="/projects#review" className="text-sm font-semibold text-brand underline">Open review queue</Link>}
      </div>
      {pending.length > 0 && <ul className="divide-y divide-line" aria-label="Needs review">{pending.map(row)}</ul>}
      {ready.length > 0 && (
        <>
          {pending.length > 0 && <h3 className="border-y border-line bg-paper px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Reviewed — ready to schedule ({ready.length})</h3>}
          <ul className="divide-y divide-line" aria-label="Ready to schedule" data-testid="ready-list">{ready.map(row)}</ul>
        </>
      )}
      {open && <ReviewDrawer item={open} canSchedule={canSchedule} onClose={() => setOpen(null)} />}
    </section>
  );
}

function ReviewDrawer({ item, canSchedule, onClose }: { item: QueueItem; canSchedule: boolean; onClose: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<ReviewDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/projects/review/${item.estimateId}`, { cache: "no-store" }).then(async (r) => { const j = await r.json().catch(() => null); if (r.ok) setD(j); else setErr(j?.error?.message ?? "Couldn't load this job."); }).catch(() => setErr("Couldn't load this job."));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item.estimateId, onClose]);
  const markReviewed = async (schedule: boolean) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/projects/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ estimateId: item.estimateId, note: note || undefined }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message ?? "Couldn't mark this job reviewed.");
      if (schedule && canSchedule) router.push(item.scheduleId ? `/projects/${item.scheduleId}` : `/projects/new?estimate=${item.estimateId}`);
      else { onClose(); router.refresh(); }
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-labelledby="review-drawer-h" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="review-drawer">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Needs PM review</p><h2 id="review-drawer-h" className="font-display text-xl font-extrabold text-navy">{item.title || "Untitled bid"}</h2></div>
          <button onClick={onClose} className="rounded p-1.5 text-muted hover:bg-black/5" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {!d && !err && <p className="mt-4 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…</p>}
        {err && <p className="mt-3 text-sm text-danger" role="alert">{err}</p>}
        {d && (
          <div className="mt-4 space-y-4 text-sm">
            <section>
              <h3 className="font-bold">Approved proposal</h3>
              {d.approval ? <p className="mt-1 flex flex-wrap items-center gap-1.5"><FileSignature className="h-4 w-4 text-ok" aria-hidden /> Version {d.approval.versionNumber ?? "?"} · <strong>{formatCurrency(Number(d.approval.total).toFixed(2))}</strong> · {d.approval.signedBy ? `signed by ${d.approval.signedBy} ${day(d.approval.signedAt)}` : "marked won"}
                <Link className="text-brand underline" href={`/estimates/${d.estimate.id}`}>Open bid</Link></p> : <p className="mt-1 text-muted">No finalized version was found.</p>}
            </section>
            <section className="grid gap-2 sm:grid-cols-2">
              <div><h3 className="font-bold">Customer</h3><p>{d.customer.name || "—"}</p>{d.customer.projectAddress && <p className="text-ink-soft">{d.customer.projectAddress}</p>}<p className="text-ink-soft">{[d.customer.phone, d.customer.email].filter(Boolean).join(" · ")}</p></div>
              <div><h3 className="font-bold">Trades</h3><p>{d.estimate.trades.join(", ") || "—"}</p></div>
            </section>
            {d.sections.length > 0 && (
              <section><h3 className="font-bold">Sections</h3>
                <table className="mt-1 w-full"><tbody>{d.sections.map((s, k) => <tr key={k} className="border-b border-line/60"><td className="py-1">{s.name}{s.trade ? <span className="text-muted"> · {s.trade}</span> : null}</td>{s.cost !== undefined && <td className="tabular py-1 text-right text-muted">cost {formatCurrency(s.cost)}</td>}<td className="tabular py-1 text-right">{formatCurrency(s.price)}</td></tr>)}</tbody></table>
              </section>
            )}
            {d.financials && <section className="rounded-lg bg-paper p-3"><h3 className="font-bold">Estimate financials <span className="font-normal text-muted">(you can see costs)</span></h3><p className="mt-1">Cost {formatCurrency(d.financials.cost)} · Price {formatCurrency(d.financials.price)} · Profit {formatCurrency(d.financials.profit)}{d.financials.margin ? ` · Margin ${d.financials.margin}%` : ""}</p></section>}
            {d.scope && <section><h3 className="font-bold">Scope of work</h3><p className="mt-1 whitespace-pre-line text-ink-soft">{d.scope}</p></section>}
            {d.exclusions && <section><h3 className="font-bold">Exclusions</h3><p className="mt-1 whitespace-pre-line text-ink-soft">{d.exclusions}</p></section>}
            {d.estimate.notes && <section><h3 className="font-bold">Notes</h3><p className="mt-1 whitespace-pre-line text-ink-soft">{d.estimate.notes}</p></section>}
            <section><h3 className="font-bold">Attachments</h3><p className="mt-1 flex items-center gap-1.5 text-ink-soft"><ImageIcon className="h-4 w-4" aria-hidden /> {d.attachments.photos} photo{d.attachments.photos === 1 ? "" : "s"} · {d.attachments.subQuotes} subcontractor quote{d.attachments.subQuotes === 1 ? "" : "s"}</p></section>
            {item.canReview ? (
              <section className="border-t border-line pt-3">
                <label className="label block">Review note <span className="font-normal text-muted">(optional, internal)</span><textarea rows={2} className="field mt-1 text-sm" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></label>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={() => void markReviewed(false)} disabled={busy}>Mark reviewed</Button>
                  {canSchedule && <Button variant="accent" onClick={() => void markReviewed(true)} disabled={busy} data-testid="mark-reviewed-schedule">{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Mark Reviewed &amp; Schedule</Button>}
                </div>
                <p className="mt-2 text-xs text-muted">Mark reviewed records you as the reviewer and moves the job to Ready to schedule. It shows as Scheduled only after you publish an active schedule. The customer isn&apos;t notified.</p>
              </section>
            ) : <p className="border-t border-line pt-3 text-xs text-muted">Your company role can view this job but can&apos;t mark it reviewed.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
