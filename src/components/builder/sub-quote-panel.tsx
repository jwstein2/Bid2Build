"use client";
import { FileText, HardHat, Loader2, Paperclip } from "lucide-react";
import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/estimate/money";
import { latestRevision, originalRevision, SUB_QUOTE_STATUS_LABELS, type SubQuote } from "@/lib/operations/sub-quotes";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { useBuilderOps, type TeamResource } from "./ops-context";
import { SubcontractorPicker, type SubChoice } from "./sub-picker";

/** Small indicator on a line item that has a subcontractor quote (internal only). */
export function SubQuoteBadge({ itemId }: { itemId: string }) {
  const { ops } = useBuilderOps();
  const qs = ops?.subQuotes?.quotes.filter((q) => q.itemId === itemId && q.status !== "rejected") ?? [];
  if (!qs.length) return null;
  const q = qs.find((x) => x.appliedRevisionId) ?? qs[qs.length - 1];
  const last = latestRevision(q);
  const changed = q.revisions.length > 1;
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-teal/15 px-1 text-[10px] font-semibold text-navy" title={`Subcontractor quote: ${q.vendorName}${last ? ` ${formatCurrency(String(last.amount))}` : ""} (internal only)`} data-testid="sub-quote-badge">
      <HardHat className="h-3 w-3" aria-hidden /> {q.vendorName}{last ? ` ${formatCurrency(String(last.amount))}` : ""}{changed ? " · revised" : ""}{qs.length > 1 ? ` · ${qs.length} quotes` : ""}
      <span className="sr-only">Subcontractor quote attached (internal only)</span>
    </span>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Inside a line item's expandable details: assign a subcontractor or worker from the Team directory,
 * enter the original bid, attach the quote, record revisions and add internal notes. Never shown to
 * customers, and nothing here changes the estimate's costs or prices.
 */
export function SubQuotePanel({ itemId, itemName, lineCost, trade }: { itemId: string; itemName: string; lineCost: string; trade?: string | null }) {
  const { estimateId, ops, refresh, saved } = useBuilderOps();
  const bundle = ops?.subQuotes;
  const quotes = useMemo(() => bundle?.quotes.filter((q) => q.itemId === itemId) ?? [], [bundle, itemId]);
  const [adding, setAdding] = useState(false);
  // Subcontractors added inline show up at once, before the ops data reloads.
  const [added, setAdded] = useState<TeamResource[]>([]);
  const resources = useMemo(() => {
    const base = ops?.resources ?? [];
    return [...base, ...added.filter((a) => !base.some((r) => r.id === a.id))];
  }, [ops?.resources, added]);
  if (!estimateId || !ops || !bundle?.canView) return null;
  return (
    <section className="mt-3 rounded-lg border border-dashed border-line bg-surface p-3" aria-label={`Subcontractor quotes for ${itemName || "this item"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><HardHat className="h-4 w-4 text-muted" aria-hidden /> Subcontractor / worker quote <span className="font-normal text-muted">(internal, never on the proposal)</span></p>
        {bundle.canRecord && !adding && <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={!saved}>{quotes.length ? "Add another quote" : "Add quote"}</Button>}
      </div>
      {!saved && bundle.canRecord && <p className="mt-1 text-xs text-muted">Wait for “Saved”, then add the quote to this line.</p>}
      {quotes.map((q) => <QuoteCard key={q.id} q={q} lineCost={lineCost} canRecord={bundle.canRecord} canApply={bundle.canApply} estimateId={estimateId} onChange={refresh} />)}
      {adding && <QuoteForm estimateId={estimateId} itemId={itemId} resources={resources} trade={trade} onResourceCreated={(r) => setAdded((a) => [...a, r])}
        onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}
      {!quotes.length && !adding && <p className="mt-1 text-xs text-muted">No quote yet. Quotes you record here carry forward to the project scope and the internal estimate report.</p>}
    </section>
  );
}

async function send(url: string, body: FormData | object) {
  const r = await fetch(url, body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message ?? "Something went wrong. Please try again.");
  return d;
}

function QuoteForm({ estimateId, itemId, quoteId, resources, trade, onResourceCreated, onDone, onCancel, revise }: {
  estimateId: string; itemId: string; quoteId?: string; resources: TeamResource[]; trade?: string | null; onResourceCreated?: (r: TeamResource) => void;
  onDone: () => void; onCancel: () => void; revise?: boolean;
}) {
  const [sub, setSub] = useState<SubChoice | null>(null);
  const resourceId = sub?.resourceId ?? "";
  const vendorName = sub && !sub.resourceId ? sub.name : "";
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [amount, setAmount] = useState("");
  const [quoteDate, setQuoteDate] = useState(today());
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = !!sub || !!amount.trim() || !!note.trim() || !!file;
  const cancel = () => { if (dirty && !confirmCancel) setConfirmCancel(true); else onCancel(); };
  const submit = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const f = new FormData();
      if (quoteId) f.set("quoteId", quoteId); else f.set("itemId", itemId);
      if (!quoteId && resourceId) f.set("resourceId", resourceId);
      if (!quoteId && vendorName.trim()) f.set("vendorName", vendorName.trim());
      if (amount.trim()) f.set("amount", amount.replace(/[$,\s]/g, ""));
      if (quoteDate) f.set("quoteDate", quoteDate);
      if (note.trim()) f.set(quoteId ? "note" : "internalNotes", note.trim());
      if (file) f.set("file", file);
      await send(`/api/estimates/${estimateId}/sub-quotes`, f);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sub-quote-form mt-2 grid gap-2 rounded-md bg-paper p-2 sm:grid-cols-2" data-testid="quote-form">
      {!quoteId && (
        <div className="sm:col-span-2">
          <SubcontractorPicker resources={resources} value={sub} onChange={setSub} trade={trade} onCreated={(r) => onResourceCreated?.(r)} disabled={busy} />
        </div>
      )}
      <label className="text-xs font-semibold text-ink-soft">{revise ? "Revised amount" : "Quoted amount"}
        <input className="field tabular mt-0.5 text-sm" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="quote-amount" />
      </label>
      <label className="text-xs font-semibold text-ink-soft">Quote date<input type="date" className="field mt-0.5 text-sm" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} /></label>
      <label className="text-xs font-semibold text-ink-soft sm:col-span-2">{quoteId ? "What changed" : "Internal notes"}
        <textarea rows={2} className="field mt-0.5 text-sm" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </label>
      <label className="flex items-center gap-2 text-xs font-semibold text-ink-soft sm:col-span-2">
        <Paperclip className="h-3.5 w-3.5" aria-hidden /> Attach quote (PDF or photo, 15 MB max)
        <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-xs font-normal" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {err && <p className="text-xs text-danger sm:col-span-2" role="alert">{err}</p>}
      {confirmCancel ? (
        <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2" role="alert" data-testid="quote-discard">
          <span className="text-xs text-ink-soft">Discard this quote? Nothing has been saved yet.</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>Keep editing</Button>
          <Button size="sm" variant="secondary" onClick={onCancel}>Discard</Button>
        </div>
      ) : (
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={() => void submit()} disabled={busy || (!quoteId && !resourceId && !vendorName.trim()) || (revise && !amount.trim())} data-testid="quote-save">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} {revise ? "Record revision" : "Save quote"}
        </Button>
      </div>
      )}
      <p className="text-[11px] text-muted sm:col-span-2">Saved as an unapproved value. Your estimate, prices and internal cost forecast don&apos;t change until someone chooses “Update internal project cost” or prepares a change order.</p>
    </div>
  );
}

function QuoteCard({ q, lineCost, canRecord, canApply, estimateId, onChange }: { q: SubQuote; lineCost: string; canRecord: boolean; canApply: boolean; estimateId: string; onChange: () => void }) {
  const [revising, setRevising] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const first = originalRevision(q), last = latestRevision(q);
  const diff = last ? Number(last.amount) - Number(lineCost) : null;
  const applied = q.revisions.find((r) => r.id === q.appliedRevisionId);
  const act = async (url: string, body: object) => {
    setBusy(true); setErr(null);
    try { await send(url, body); onChange(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className={cn("mt-2 rounded-md border border-line p-2 text-sm", q.status === "rejected" && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{q.vendorName} <span className="ml-1 rounded bg-black/5 px-1 text-[10px] font-semibold text-ink-soft">{SUB_QUOTE_STATUS_LABELS[q.status]}</span></p>
        {canRecord && (
          <select aria-label="Quote status" className="field w-auto py-0.5 text-xs" value={q.status} disabled={busy} onChange={(e) => void act(`/api/estimates/${estimateId}/sub-quotes`, { quoteId: q.id, status: e.target.value })}>
            {Object.entries(SUB_QUOTE_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </div>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-4">
        <div><dt className="text-muted">Estimated cost</dt><dd className="tabular font-semibold">{formatCurrency(lineCost)}</dd></div>
        <div><dt className="text-muted">Original quote</dt><dd className="tabular font-semibold">{first ? formatCurrency(String(first.amount)) : "—"}</dd></div>
        <div><dt className="text-muted">Latest quote</dt><dd className="tabular font-semibold">{last && last.id !== first?.id ? formatCurrency(String(last.amount)) : "—"}</dd></div>
        <div><dt className="text-muted">Difference</dt><dd className={cn("tabular font-semibold", diff !== null && diff > 0 ? "text-danger" : diff !== null && diff < 0 ? "text-ok" : "")}>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${formatCurrency(diff.toFixed(2))}`}</dd></div>
      </dl>
      {q.revisions.length > 0 && (
        <ol className="mt-1.5 space-y-0.5 text-xs text-ink-soft">
          {q.revisions.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2">
              <span className="font-semibold">Rev {r.revision}</span><span className="tabular">{formatCurrency(String(r.amount))}</span>
              {r.quoteDate && <span className="text-muted">{r.quoteDate}</span>}
              {r.note && <span className="text-muted">· {r.note}</span>}
              {r.documentPath && <a className="inline-flex items-center gap-0.5 text-brand underline" href={`/api/estimates/${estimateId}/sub-quotes/document?revision=${r.id}`} target="_blank" rel="noopener"><FileText className="h-3 w-3" aria-hidden />{r.documentName ?? "Quote"}</a>}
              {r.id === q.appliedRevisionId && <span className="rounded bg-ok-tint px-1 text-[10px] font-semibold text-ok">Internal cost updated</span>}
            </li>
          ))}
        </ol>
      )}
      {q.internalNotes && <p className="mt-1 text-xs text-muted">Notes: {q.internalNotes}</p>}
      {last && (!applied || applied.id !== last.id) && (
        <p className="mt-1.5 rounded bg-warn-tint px-2 py-1 text-xs text-warn">Unapproved: rev {last.revision} ({formatCurrency(String(last.amount))}) isn&apos;t in the internal cost forecast{applied ? ` (currently rev ${applied.revision})` : ""}.</p>
      )}
      {err && <p className="mt-1 text-xs text-danger" role="alert">{err}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {canRecord && !revising && <Button size="sm" variant="secondary" onClick={() => setRevising(true)}>Record revised bid</Button>}
        {canApply && last && (!applied || applied.id !== last.id) && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(`/api/estimates/${estimateId}/sub-quotes/apply`, { quoteId: q.id, revisionId: last.id })}>Update internal project cost</Button>
        )}
      </div>
      {revising && <QuoteForm estimateId={estimateId} itemId={q.itemId} quoteId={q.id} resources={[]} revise onDone={() => { setRevising(false); onChange(); }} onCancel={() => setRevising(false)} />}
    </div>
  );
}
