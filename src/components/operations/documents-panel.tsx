"use client";
import { CheckCircle2, FilePlus2, FileSignature, History, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/estimate/money";
import { CHANGE_ORDER_STATUS_LABELS, type ChangeOrderLine, type ChangeOrderStatus, type ContractSummary } from "@/lib/operations/contract";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";

interface Version {
  id: string; number: number; createdAt: string; total: number; contentHash: string; authorId: string; hasPdf: boolean; sentAt: string | null;
  signatures: { id: string; signedAt: string; signerName: string; pdfStatus: string }[]; openLink: boolean; approved: boolean;
}
interface ChangeOrder {
  id: string; number: number; title: string; amount: number; status: ChangeOrderStatus; version: number; approvedVersion: number | null;
  approvalMethod: "manual" | "signature" | null; approvalNote: string | null; sentAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string;
  description: string | null; lines: ChangeOrderLine[]; scheduleDays: number | null; customerNotes: string | null; internalNotes: string | null;
  signatures: { id: string; signedAt: string; signerName: string; version: number }[]; openLink: boolean;
}
export interface DocumentsData {
  available: boolean;
  estimate: { id: string; title: string; number: string; stage: string; ownerId: string; wonAt: string | null };
  approval: { versionId: string; source: "signature" | "manual"; total: number } | null;
  versions: Version[]; changeOrders: ChangeOrder[];
  permissions: { create: boolean; send: boolean; accepted: boolean };
  summary: ContractSummary | null;
}
export interface ChangeOrderDraft { title?: string; description?: string; lines?: ChangeOrderLine[]; internalNotes?: string; sourceQuoteRevisionId?: string }

const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "");
const money = (n: number | string) => { const v = Number(n); return `${v < 0 ? "−" : ""}${formatCurrency(Math.abs(v).toFixed(2))}`; };

export function useDocuments(estimateId: string) {
  const [data, setData] = useState<DocumentsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/estimates/${estimateId}/documents`, { cache: "no-store" });
    const d = await r.json().catch(() => null);
    if (!r.ok) { setError(d?.error?.message ?? "We couldn't load the document history."); return; }
    setData(d); setError(null);
  }, [estimateId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- load on mount; state is set after the fetch resolves
  useEffect(() => { void load(); }, [load]);
  return { data, error, reload: load };
}

/** Contract value: Original + Approved additions − Approved deductions = Current; pending shown apart. */
export function ContractSummaryCard({ s, compact }: { s: ContractSummary; compact?: boolean }) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-1 text-sm", compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4")} data-testid="contract-summary">
      <div><dt className="text-xs text-muted">Original contract</dt><dd className="tabular font-semibold">{money(s.original)}</dd></div>
      <div><dt className="text-xs text-muted">Approved additions</dt><dd className="tabular font-semibold text-ok">+{money(s.approvedAdditions)}</dd></div>
      <div><dt className="text-xs text-muted">Approved deductions</dt><dd className="tabular font-semibold text-danger">−{money(s.approvedDeductions)}</dd></div>
      <div><dt className="text-xs text-muted">Current approved contract</dt><dd className="tabular text-base font-extrabold text-navy">{money(s.current)}</dd></div>
      {s.pendingCount > 0 && <div className="col-span-2 sm:col-span-4"><dd className="text-xs text-muted">Pending (not counted): {s.pendingCount} change order{s.pendingCount === 1 ? "" : "s"}, net {money(s.pendingNet)}</dd></div>}
    </dl>
  );
}

/**
 * Document history for a bid or project: every proposal version (and which one was signed), signatures
 * and re-signatures, and change orders in the same list. Used on the bid builder and Project Detail.
 */
export function DocumentsPanel({ estimateId, startNew, onChanged }: { estimateId: string; startNew?: ChangeOrderDraft | true; onChanged?: () => void }) {
  const { data, error, reload } = useDocuments(estimateId);
  const [editing, setEditing] = useState<ChangeOrder | ChangeOrderDraft | null>(startNew ? (startNew === true ? {} : startNew) : null);
  const changed = () => { void reload(); onChanged?.(); };
  if (error) return <p className="text-sm text-danger" role="alert">{error}</p>;
  if (!data) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading documents…</p>;
  if (!data.available) return <p className="text-sm text-muted">Document history turns on after the project operations update is installed.</p>;
  // The first signature on the bid is "Signed"; every later one (same or newer version) is a re-signature.
  const firstSignedAt = data.versions.flatMap((v) => v.signatures.map((x) => x.signedAt)).sort()[0] ?? null;
  const timeline: ({ k: "v"; at: string; v: Version } | { k: "c"; at: string; c: ChangeOrder })[] = [
    ...data.versions.map((v) => ({ k: "v" as const, at: v.createdAt, v })),
    ...data.changeOrders.map((c) => ({ k: "c" as const, at: c.createdAt, c })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="space-y-4" data-testid="documents-panel">
      {data.summary && <ContractSummaryCard s={data.summary} />}
      {data.approval && (
        <p className="flex items-center gap-1.5 rounded-lg bg-ok-tint px-3 py-2 text-sm text-ok"><CheckCircle2 className="h-4 w-4" aria-hidden />
          Approved version: <strong>v{data.versions.find((v) => v.id === data.approval!.versionId)?.number ?? "?"}</strong> ({data.approval.source === "signature" ? "signed by the customer" : "marked won"}, {money(data.approval.total)})</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-bold"><History className="h-4 w-4" aria-hidden /> Document history</h3>
        {data.permissions.create && data.permissions.accepted && !editing && <Button size="sm" onClick={() => setEditing({})}><FilePlus2 className="h-4 w-4" aria-hidden /> Create Change Order</Button>}
      </div>
      {!data.permissions.accepted && <p className="text-xs text-muted">Change orders start after the proposal is approved or signed.</p>}
      {editing && <ChangeOrderEditor estimateId={estimateId} co={editing} onDone={() => { setEditing(null); changed(); }} onCancel={() => setEditing(null)} />}
      {timeline.length === 0 && <p className="text-sm text-muted">No proposal has been sent yet. Each version you download, email or send for signature is kept here.</p>}
      <ol className="space-y-2">
        {timeline.map((t) => t.k === "v" ? <VersionRow key={t.v.id} v={t.v} firstSignedAt={firstSignedAt} /> : <ChangeOrderRow key={t.c.id} c={t.c} perms={data.permissions} onEdit={() => setEditing(t.c)} onChanged={changed} />)}
      </ol>
    </div>
  );
}

function VersionRow({ v, firstSignedAt }: { v: Version; firstSignedAt: string | null }) {
  const status = v.signatures.length ? "Signed" : v.openLink ? "Sent for signature" : v.sentAt ? "Sent" : "Generated";
  return (
    <li className={cn("rounded-lg border p-3 text-sm", v.approved ? "border-ok bg-ok-tint/40" : "border-line")} data-testid={`version-${v.number}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Proposal v{v.number} <span className="ml-1 rounded bg-black/5 px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft">{status}</span>
          {v.approved && <span className="ml-1 rounded bg-ok px-1.5 py-0.5 text-[11px] font-bold text-white">APPROVED VERSION</span>}</p>
        <span className="tabular font-semibold">{money(v.total)}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted">Created {fmt(v.createdAt)}{v.sentAt ? ` · first sent ${fmt(v.sentAt)}` : ""} · fingerprint {v.contentHash.slice(0, 10)}</p>
      {v.signatures.map((s) => (
        <p key={s.id} className="mt-1 flex flex-wrap items-center gap-x-2 text-xs"><FileSignature className="h-3.5 w-3.5 text-ok" aria-hidden />
          {firstSignedAt && s.signedAt > firstSignedAt ? "Re-signed" : "Signed"} by <strong>{s.signerName}</strong> {fmt(s.signedAt)}
          <Link className="text-brand underline" href={`/signed/${s.id}`}>View signed record</Link></p>
      ))}
    </li>
  );
}

function ChangeOrderRow({ c, perms, onEdit, onChanged }: { c: ChangeOrder; perms: DocumentsData["permissions"]; onEdit: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<null | "approve" | "decline" | "void">(null);
  const [note, setNote] = useState("");
  const act = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/change-orders/${c.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? "Something went wrong.");
      if (d.url) setLink(d.url);
      setNoteFor(null); setNote("");
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const tone = c.status === "approved" || c.status === "signed" ? "bg-ok-tint text-ok" : c.status === "sent" ? "bg-brand-tint text-navy" : c.status === "draft" ? "bg-black/5 text-ink-soft" : "bg-black/5 text-muted";
  return (
    <li className="rounded-lg border border-line p-3 text-sm" data-testid={`change-order-${c.number}`} data-search-id={c.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Change order #{c.number}: {c.title} <span className={cn("ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold", tone)}>{CHANGE_ORDER_STATUS_LABELS[c.status]}{c.version ? ` · v${c.version}` : ""}</span></p>
        <span className="tabular font-semibold">{money(c.amount)}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted">Created {fmt(c.createdAt)}{c.sentAt ? ` · sent ${fmt(c.sentAt)}` : ""}{c.decidedAt ? ` · ${CHANGE_ORDER_STATUS_LABELS[c.status].toLowerCase()} ${fmt(c.decidedAt)}` : ""}</p>
      <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">{c.lines.map((l, i) => <li key={i}><span className="font-semibold capitalize">{l.kind}</span> · {l.description} · <span className="tabular">{money(l.amount)}</span></li>)}</ul>
      {c.approvalMethod === "manual" && c.approvalNote && <p className="mt-1 text-xs text-muted">Approval recorded: {c.approvalNote}</p>}
      {c.signatures.map((s) => <p key={s.id} className="mt-1 text-xs"><FileSignature className="mr-1 inline h-3.5 w-3.5 text-ok" aria-hidden />Signed v{s.version} by <strong>{s.signerName}</strong> {fmt(s.signedAt)}</p>)}
      {c.internalNotes && <p className="mt-1 text-xs text-muted">Internal: {c.internalNotes}</p>}
      {link && <p className="mt-2 break-all rounded bg-paper p-2 text-xs">Signing link (send it yourself): <a className="text-brand underline" href={link} target="_blank" rel="noopener">{link}</a> <button className="ml-1 underline" onClick={() => void navigator.clipboard?.writeText(link)}>Copy</button></p>}
      {err && <p className="mt-1 text-xs text-danger" role="alert">{err}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {c.status === "draft" && perms.create && <Button size="sm" variant="secondary" onClick={onEdit} disabled={busy}>Edit</Button>}
        {c.status === "draft" && perms.send && <Button size="sm" onClick={() => void act("link")} disabled={busy}><Link2 className="h-3.5 w-3.5" aria-hidden /> Send for signature</Button>}
        {c.status === "draft" && perms.send && <Button size="sm" variant="secondary" onClick={() => void act("send")} disabled={busy}>Mark sent</Button>}
        {c.status === "sent" && perms.send && <Button size="sm" variant="secondary" onClick={() => void act("link")} disabled={busy}>New signing link</Button>}
        {c.status === "sent" && perms.send && <Button size="sm" variant="secondary" onClick={() => setNoteFor("approve")} disabled={busy}>Record approval</Button>}
        {(c.status === "sent" || c.status === "declined") && perms.create && <Button size="sm" variant="ghost" onClick={() => void act("revise")} disabled={busy}>Revise</Button>}
        {c.status === "sent" && perms.send && <Button size="sm" variant="ghost" onClick={() => setNoteFor("decline")} disabled={busy}>Declined</Button>}
        {(c.status === "draft" || c.status === "sent" || c.status === "declined") && perms.send && <Button size="sm" variant="ghost" onClick={() => setNoteFor("void")} disabled={busy}>Void</Button>}
      </div>
      {noteFor && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded bg-paper p-2">
          <label className="min-w-[14rem] flex-1 text-xs font-semibold">{noteFor === "approve" ? "How did the customer approve? (required)" : "Note (optional)"}
            <input className="field mt-0.5 text-sm" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={noteFor === "approve" ? "e.g. Approved in writing by email on Nov 18" : ""} />
          </label>
          <Button size="sm" onClick={() => void act(noteFor, { note })} disabled={busy || (noteFor === "approve" && !note.trim())}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setNoteFor(null)}>Cancel</Button>
        </div>
      )}
    </li>
  );
}

function ChangeOrderEditor({ estimateId, co, onDone, onCancel }: { estimateId: string; co: ChangeOrder | ChangeOrderDraft; onDone: () => void; onCancel: () => void }) {
  const existing = "id" in co ? co : null;
  const [title, setTitle] = useState(co.title ?? "");
  const [description, setDescription] = useState(co.description ?? "");
  const [lines, setLines] = useState<{ kind: ChangeOrderLine["kind"]; description: string; amount: string }[]>(
    (co.lines?.length ? co.lines : [{ kind: "add" as const, description: "", amount: "" }]).map((l) => ({ kind: l.kind, description: l.description, amount: String(l.amount ?? "") })));
  const [days, setDays] = useState(existing?.scheduleDays != null ? String(existing.scheduleDays) : "");
  const [customerNotes, setCustomerNotes] = useState(existing?.customerNotes ?? "");
  const [internalNotes, setInternalNotes] = useState(co.internalNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = lines.reduce((s, l) => s + (Number(l.amount.replace(/[$,\s]/g, "")) || 0), 0);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = {
        id: existing?.id, title: title.trim() || "Change order", description: description || undefined,
        lines: lines.filter((l) => l.description.trim()).map((l) => ({ kind: l.kind, description: l.description.trim(), amount: l.amount.replace(/[$,\s]/g, "") || "0" })),
        scheduleDays: days.trim() ? Math.round(Number(days)) : null, customerNotes: customerNotes || undefined, internalNotes: internalNotes || undefined,
        sourceQuoteRevisionId: "sourceQuoteRevisionId" in co ? co.sourceQuoteRevisionId : undefined,
      };
      const r = await fetch(`/api/estimates/${estimateId}/change-orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? "We couldn't save the change order.");
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-xl border border-brand/40 bg-surface p-3" data-testid="change-order-editor">
      <p className="text-sm font-bold">{existing ? `Edit change order #${existing.number}` : "New change order"} <span className="font-normal text-muted">(a separate document: the signed proposal is never changed)</span></p>
      <label className="label block">Title<input className="field mt-1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Upgrade to composite railing" /></label>
      <label className="label block">Description <span className="font-normal text-muted">(customer sees this)</span><textarea rows={2} className="field mt-1 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} /></label>
      <div>
        <p className="label">Scope and price changes</p>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[7rem_minmax(0,1fr)_7rem_auto] gap-2 max-sm:grid-cols-[6rem_minmax(0,1fr)]">
              <select aria-label={`Line ${i + 1} type`} className="field text-sm" value={l.kind} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, kind: e.target.value as ChangeOrderLine["kind"] } : x)))}>
                <option value="add">Add</option><option value="remove">Remove</option><option value="modify">Modify</option>
              </select>
              <input aria-label={`Line ${i + 1} description`} className="field text-sm" value={l.description} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))} placeholder="What changes" />
              <input aria-label={`Line ${i + 1} price change`} className="field tabular text-right text-sm" inputMode="decimal" value={l.amount} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} placeholder={l.kind === "remove" ? "-0.00" : "0.00"} />
              <button type="button" aria-label={`Remove line ${i + 1}`} className="rounded p-1.5 text-muted hover:bg-black/5" onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { kind: "add", description: "", amount: "" }])}><Plus className="h-4 w-4" aria-hidden /> Add line</Button>
          <span className="text-sm">Price adjustment: <strong className="tabular">{money(total)}</strong></span>
        </div>
        <p className="text-[11px] text-muted">Use a negative amount for deductions (removed scope or credits).</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="label">Schedule impact (working days)<input className="field mt-1" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="0" /></label>
        <label className="label sm:col-span-2">Note to customer<input className="field mt-1" value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} maxLength={4000} /></label>
      </div>
      <label className="label block">Internal notes <span className="font-normal text-muted">(company only)</span><textarea rows={2} className="field mt-1 text-sm" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} maxLength={4000} /></label>
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button loading={busy} onClick={() => void save()} disabled={busy || !lines.some((l) => l.description.trim())}> Save draft</Button>
      </div>
      <p className="text-[11px] text-muted">Nothing is sent to the customer until you choose Send for signature or Mark sent.</p>
    </div>
  );
}
