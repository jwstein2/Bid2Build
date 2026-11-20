import Link from "next/link";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import {
  LEGAL_CATEGORY_LABELS, LEGAL_DOCUMENTS, LEGAL_STATUSES, LEGAL_STATUS_LABELS, effectiveStatus, legalDate, statusCounts,
  type LegalStatus,
} from "@/lib/legal/registry";
import { setLegalStatus } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Legal documents" };

type Row = { doc_key: string; status: LegalStatus; review_completed_on: string | null; internal_notes: string | null; updated_at: string };
type Event = { doc_key: string; old_status: string | null; new_status: string; review_completed_on: string | null; created_at: string };

const TONE: Record<LegalStatus, "neutral" | "ok" | "warn" | "danger" | "brand"> = {
  published_pending: "neutral", in_review: "brand", reviewed: "ok", revision_required: "warn", archived: "neutral",
};
const RISK_TONE = { high: "danger", medium: "warn", low: "neutral" } as const;
const input = "rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm";

/** Owner-only Legal Documentation Status: counts, versions, dates, links, and the review-status form. */
export default async function LegalAdmin({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { db } = await requireAdmin();
  const sp = await searchParams;
  const [rowsRes, eventsRes] = await Promise.all([
    db.from("legal_document_reviews").select("doc_key, status, review_completed_on, internal_notes, updated_at"),
    db.from("legal_document_review_events").select("doc_key, old_status, new_status, review_completed_on, created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const sqlMissing = Boolean(rowsRes.error);
  const rows = new Map(((rowsRes.data ?? []) as Row[]).map((r) => [r.doc_key, r]));
  const events = (eventsRes.data ?? []) as Event[];
  const docs = LEGAL_DOCUMENTS.map((d) => {
    const r = rows.get(d.key);
    return { d, r, rec: effectiveStatus(d, r ? { status: r.status, reviewCompletedOn: r.review_completed_on } : null) };
  });
  const counts = statusCounts(docs.map((x) => x.rec.status));
  const lastRevised = docs.map((x) => x.d.lastRevised).filter(Boolean).sort().at(-1) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Legal documents</h1>
        <p className="mt-1 text-sm text-ink-soft">Review status of Built2Bid&apos;s own published terms, policies and disclosures. Only platform admins can change a status; customers and Team admins can&apos;t. Mark a document reviewed only after counsel has actually reviewed it. Notes here are never shown to customers.</p>
        <p className="mt-1 text-sm"><Link href="/legal" className="font-semibold underline">Public Legal Document Status page</Link> · document list and versions live in <code>src/lib/legal/registry.ts</code></p>
      </div>
      {sp.msg && <Notice tone="ok">{sp.msg}</Notice>}
      {sp.err && <Notice tone="danger">{sp.err}</Notice>}
      {sqlMissing && <Notice tone="warn" title="Status changes aren't saved yet">Run the legal status SQL (20270206001000_legal_document_status.sql) in Supabase. Until then every document shows its default, Published — Legal Review Pending.</Notice>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="legal-counts">
        <Kpi label="Documents identified" value={docs.length} />
        <Kpi label="Pending review" value={counts.published_pending} />
        <Kpi label="In review" value={counts.in_review} />
        <Kpi label="Reviewed" value={counts.reviewed} />
        <Kpi label="Revision required" value={counts.revision_required} />
        <Kpi label="Last revision" value={legalDate(lastRevised)} small />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-3 py-2">Document</th><th className="px-3 py-2">Version</th><th className="px-3 py-2">Last revised</th><th className="px-3 py-2">Risk</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Update</th>
          </tr></thead>
          <tbody>
            {docs.map(({ d, r, rec }) => (
              <tr key={d.key} id={`doc-${d.key}`} className="scroll-mt-24 border-b border-line align-top last:border-b-0" data-testid={`legal-admin-${d.key}`}>
                <td className="px-3 py-3">
                  <p className="font-semibold">{d.public ? <Link href={d.href} className="underline" target="_blank">{d.name}</Link> : <span>{d.name} <span className="text-xs font-normal text-muted">({d.href})</span></span>}</p>
                  <p className="text-xs text-muted">{LEGAL_CATEGORY_LABELS[d.category]}{d.location ? ` · ${d.location}` : ""}</p>
                  <p className="mt-1 text-xs text-ink-soft">{d.acceptance}</p>
                </td>
                <td className="px-3 py-3 text-xs">{d.version}<br /><span className="text-muted">{d.history.length} version{d.history.length === 1 ? "" : "s"} on file</span></td>
                <td className="px-3 py-3 text-xs">{legalDate(d.lastRevised)}</td>
                <td className="px-3 py-3"><Badge tone={RISK_TONE[d.risk]}>{d.risk}</Badge></td>
                <td className="px-3 py-3">
                  <Badge tone={TONE[rec.status]}>{LEGAL_STATUS_LABELS[rec.status]}</Badge>
                  {rec.reviewCompletedOn && <p className="mt-1 text-xs text-muted">Completed {legalDate(rec.reviewCompletedOn)}</p>}
                  {r?.internal_notes && <p className="mt-1 max-w-xs whitespace-pre-wrap text-xs text-ink-soft">{r.internal_notes}</p>}
                  {r && <p className="mt-1 text-xs text-muted">Updated {legalDate(r.updated_at)}</p>}
                </td>
                <td className="px-3 py-3">
                  <form action={setLegalStatus} className="grid gap-1.5">
                    <input type="hidden" name="doc_key" value={d.key} />
                    <label className="sr-only" htmlFor={`st-${d.key}`}>Status for {d.name}</label>
                    <select id={`st-${d.key}`} name="status" defaultValue={rec.status} className={input} disabled={sqlMissing}>
                      {LEGAL_STATUSES.map((s) => <option key={s} value={s}>{LEGAL_STATUS_LABELS[s]}</option>)}
                    </select>
                    <label className="text-xs text-muted">Review completed (only with Reviewed)
                      <input type="date" name="completed_on" defaultValue={rec.reviewCompletedOn ?? ""} className={`${input} mt-0.5 block w-full`} disabled={sqlMissing} />
                    </label>
                    <label className="sr-only" htmlFor={`nt-${d.key}`}>Internal notes for {d.name}</label>
                    <textarea id={`nt-${d.key}`} name="notes" rows={2} maxLength={2000} defaultValue={r?.internal_notes ?? ""} placeholder="Internal note or reference (owner only)" className={input} disabled={sqlMissing} />
                    <button className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-semibold hover:bg-paper disabled:opacity-50" disabled={sqlMissing}>Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <h2 className="font-bold">Status history</h2>
        {!events.length ? <p className="mt-1 text-sm text-muted">No status changes recorded yet.</p> : (
          <ul className="mt-2 space-y-1 text-sm">
            {events.map((e, i) => <li key={i}>{legalDate(e.created_at)} · <b>{LEGAL_DOCUMENTS.find((d) => d.key === e.doc_key)?.name ?? e.doc_key}</b>: {LEGAL_STATUS_LABELS[(e.old_status ?? "published_pending") as LegalStatus] ?? e.old_status} → {LEGAL_STATUS_LABELS[e.new_status as LegalStatus] ?? e.new_status}{e.review_completed_on ? ` (completed ${legalDate(e.review_completed_on)})` : ""}</li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <Card className="p-3">
      <p className="text-xs font-semibold text-ink-soft">{label}</p>
      <p className={small ? "mt-1 text-sm font-bold" : "mt-1 text-2xl font-extrabold"}>{value}</p>
    </Card>
  );
}
