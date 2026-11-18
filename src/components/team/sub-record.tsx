"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileUp, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { docTypeLabel, expiryState, maskTin, SUB_DOC_TYPES, TAX_CLASSIFICATIONS, type SubDocType, type SubDocument, type SubRecord, type TaxClassification } from "@/lib/team/records";

const fmtDay = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
const money = (n: number | null) => (n === null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));

/**
 * One subcontractor's records: W-9 details (only the last 4 digits of the tax ID), and documents on file
 * (W-9, insurance certificates with expiry, licenses, agreements, lien waivers). Wording is always
 * "on file", never "verified": Built2Bid doesn't check certificates with insurers.
 */
export function SubRecordView({ record, today }: { record: SubRecord; today: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState<SubDocType | null>(null);
  const [showReplaced, setShowReplaced] = useState(false);
  const live = record.documents.filter((d) => d.status === "on_file");
  const replaced = record.documents.filter((d) => d.status === "replaced");
  const done = (t: string) => { setMsg({ ok: true, text: t }); router.refresh(); };

  async function remove(d: SubDocument) {
    const r = await api(`/api/team/subs/documents/${d.id}`, { method: "DELETE" });
    if (!r.ok) setMsg({ ok: false, text: r.message }); else done(`${docTypeLabel(d.docType)} removed.`);
  }

  return (
    <div className="space-y-6" data-testid="sub-record">
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <TaxForm record={record} onSaved={() => done("W-9 details saved.")} onError={(t) => setMsg({ ok: false, text: t })} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-xl font-extrabold text-navy">Documents on file</h2>
          <label><span className="sr-only">Document type</span>
            <select className="field h-10 py-0 text-sm" value="" onChange={(e) => setAdding((e.target.value || null) as SubDocType | null)} data-testid="doc-add-type">
              <option value="">Add a document…</option>{SUB_DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select></label>
        </div>
        {adding && <DocForm key={adding} resourceId={record.resourceId} docType={adding} onCancel={() => setAdding(null)} onSaved={(t) => { setAdding(null); done(t); }} />}
        {live.length === 0 && !adding && <p className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-muted" data-testid="doc-empty">Nothing on file yet. Add their W-9, insurance certificates and your agreement.</p>}
        <ul className="grid gap-3 md:grid-cols-2">{live.map((d) => <DocCard key={d.id} d={d} today={today} onRemove={() => remove(d)} />)}</ul>
        {replaced.length > 0 && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setShowReplaced(!showReplaced)} aria-expanded={showReplaced}>{showReplaced ? "Hide" : "Show"} {replaced.length} older version{replaced.length === 1 ? "" : "s"}</Button>
            {showReplaced && <ul className="mt-2 grid gap-3 md:grid-cols-2">{replaced.map((d) => <DocCard key={d.id} d={d} today={today} />)}</ul>}
          </div>
        )}
      </section>
      <p className="text-xs text-muted">Files are stored privately and open through a link that works for 60 seconds. Only the company owner and people allowed to “Manage subcontractor compliance” can see this page. Built2Bid records what&apos;s on file; it doesn&apos;t verify coverage with the insurer and never holds back a payment on its own.</p>
    </div>
  );
}

function DocCard({ d, today, onRemove }: { d: SubDocument; today: string; onRemove?: () => void }) {
  const st = expiryState(d.expiresOn, today);
  return (
    <li className="rounded-xl border border-line bg-surface p-4" data-testid="doc-card">
      <p className="flex flex-wrap items-center gap-1.5 font-semibold text-navy"><ShieldCheck className="h-4 w-4 text-accent-ink" aria-hidden />{docTypeLabel(d.docType)}
        {d.status === "replaced" ? <Badge>Replaced</Badge> : <Badge tone="ok">On file</Badge>}
        {d.status === "on_file" && st === "expired" && <Badge tone="danger">Expired {fmtDay(d.expiresOn)}</Badge>}
        {d.status === "on_file" && st === "soon" && <Badge tone="warn">Expires {fmtDay(d.expiresOn)}</Badge>}</p>
      {d.title && <p className="text-sm text-ink-soft">{d.title}</p>}
      <p className="text-sm text-ink-soft">{[d.issuer, d.policyNumber && `Policy ${d.policyNumber}`, d.coverageAmount !== null && `${money(d.coverageAmount)} coverage`].filter(Boolean).join(" · ")}</p>
      <p className="text-xs text-muted">{[d.effectiveOn && `From ${fmtDay(d.effectiveOn)}`, d.expiresOn && st !== "expired" && st !== "soon" && `Expires ${fmtDay(d.expiresOn)}`, d.signedOn && `Signed ${fmtDay(d.signedOn)}`, `Recorded ${new Date(d.recordedAt).toLocaleDateString("en-US")}`].filter(Boolean).join(" · ")}</p>
      {d.note && <p className="mt-1 text-xs text-muted">{d.note}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {d.hasFile && <a href={`/api/team/subs/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2.5 text-sm font-semibold" data-testid="doc-open"><ExternalLink className="h-4 w-4" aria-hidden />Open {d.fileName ?? "file"}</a>}
        {onRemove && <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${docTypeLabel(d.docType)}`}><Trash2 className="h-4 w-4" aria-hidden /> Remove</Button>}
      </div>
    </li>
  );
}

function DocForm({ resourceId, docType, onCancel, onSaved }: { resourceId: string; docType: SubDocType; onCancel: () => void; onSaved: (t: string) => void }) {
  const meta = SUB_DOC_TYPES.find((t) => t.value === docType)!;
  const [f, setF] = useState({ title: "", issuer: "", policyNumber: "", coverageAmount: "", effectiveOn: "", expiresOn: "", signedOn: "", note: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set("docType", docType);
    for (const [k, v] of Object.entries(f)) if (v.trim()) fd.set(k, k === "coverageAmount" ? v.replace(/[^\d.]/g, "") : v.trim());
    if (file) fd.set("file", file);
    try {
      const res = await fetch(`/api/team/subs/${resourceId}/documents`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setErr((body as { error?: { message?: string } }).error?.message ?? "Couldn't save the document."); return; }
      onSaved(`${meta.label} recorded.`);
    } catch { setBusy(false); setErr("You appear to be offline. Nothing was saved."); }
  }
  const insurance = meta.group === "insurance";
  return (
    <div className="space-y-3 rounded-xl border border-line bg-paper p-4" data-testid="doc-form">
      <p className="font-semibold text-navy">Add: {meta.label}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(docType === "other" || meta.group === "agreement") && <label className="block"><span className="label">Title</span><input className="field" value={f.title} maxLength={200} onChange={set("title")} placeholder={docType === "lien_waiver" ? "e.g. Conditional waiver, progress payment 2" : ""} /></label>}
        {(insurance || docType === "license") && <label className="block"><span className="label">{insurance ? "Insurance company" : "Issued by"}</span><input className="field" value={f.issuer} maxLength={200} onChange={set("issuer")} /></label>}
        {(insurance || docType === "license") && <label className="block"><span className="label">{insurance ? "Policy number" : "License number"}</span><input className="field" value={f.policyNumber} maxLength={80} onChange={set("policyNumber")} /></label>}
        {insurance && <label className="block"><span className="label">Coverage amount ($, optional)</span><input className="field" inputMode="decimal" value={f.coverageAmount} onChange={set("coverageAmount")} placeholder="e.g. 1000000" /></label>}
        {meta.expires && <label className="block"><span className="label">Effective date</span><input type="date" className="field" value={f.effectiveOn} onChange={set("effectiveOn")} /></label>}
        {meta.expires && <label className="block"><span className="label">Expiration date</span><input type="date" className="field" value={f.expiresOn} onChange={set("expiresOn")} data-testid="doc-expires" /></label>}
        {(docType === "w9" || meta.group === "agreement") && <label className="block"><span className="label">Signed on</span><input type="date" className="field" value={f.signedOn} onChange={set("signedOn")} /></label>}
        <label className="block sm:col-span-2"><span className="label">File (PDF or photo, up to 15 MB, optional)</span>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="field py-2" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="doc-file" /></label>
        <label className="block sm:col-span-2"><span className="label">Note (optional)</span><input className="field" value={f.note} maxLength={1000} onChange={set("note")} /></label>
      </div>
      {(docType === "w9" || insurance) && <p className="text-xs text-muted">Recording a new {meta.label.toLowerCase()} keeps the old one as an older version.</p>}
      {err && <Notice tone="danger">{err}</Notice>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy} data-testid="doc-save"><FileUp className="h-4 w-4" aria-hidden /> {busy ? "Saving…" : "Save"}</Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function TaxForm({ record, onSaved, onError }: { record: SubRecord; onSaved: () => void; onError: (t: string) => void }) {
  const t = record.tax;
  const [f, setF] = useState({ legalName: t?.legalName ?? "", businessName: t?.businessName ?? "", taxClassification: (t?.taxClassification ?? "") as TaxClassification | "",
    tinType: (t?.tinType ?? "") as "ssn" | "ein" | "", tinLast4: t?.tinLast4 ?? "", address: t?.address ?? "", w9SignedOn: t?.w9SignedOn ?? "" });
  const [track, setTrack] = useState<"auto" | "yes" | "no">(t?.track1099 === true ? "yes" : t?.track1099 === false ? "no" : "auto");
  const [busy, setBusy] = useState(false);
  const corp = TAX_CLASSIFICATIONS.find((c) => c.value === f.taxClassification)?.corp ?? false;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    const r = await api(`/api/team/subs/${record.resourceId}`, { method: "POST", body: JSON.stringify({ ...f, track1099: track === "auto" ? null : track === "yes" }) });
    setBusy(false);
    if (!r.ok) onError(r.message); else onSaved();
  }
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="tax-form">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-extrabold text-navy">W-9 details</h2>
        <span className="text-sm text-ink-soft" data-testid="tin-masked">{maskTin(t?.tinType ?? null, t?.tinLast4 ?? null)}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Legal name (line 1)</span><input className="field" value={f.legalName} maxLength={200} onChange={set("legalName")} data-testid="tax-legal" /></label>
        <label className="block"><span className="label">Business name (line 2, optional)</span><input className="field" value={f.businessName} maxLength={200} onChange={set("businessName")} /></label>
        <label className="block"><span className="label">Federal tax classification</span>
          <select className="field" value={f.taxClassification} onChange={set("taxClassification")} data-testid="tax-class">
            <option value="">Not recorded</option>{TAX_CLASSIFICATIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <label className="block"><span className="label">Tax ID type</span>
            <select className="field" value={f.tinType} onChange={set("tinType")}><option value="">—</option><option value="ein">EIN</option><option value="ssn">SSN</option></select></label>
          <label className="block"><span className="label">Last 4 digits only</span>
            <input className="field" inputMode="numeric" autoComplete="off" maxLength={4} value={f.tinLast4} onChange={(e) => setF({ ...f, tinLast4: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="1234" data-testid="tax-last4" /></label>
        </div>
        <label className="block"><span className="label">Address on the W-9</span><input className="field" value={f.address} maxLength={500} onChange={set("address")} /></label>
        <label className="block"><span className="label">W-9 signed on</span><input type="date" className="field" value={f.w9SignedOn} onChange={set("w9SignedOn")} /></label>
        <label className="block sm:col-span-2"><span className="label">Include in 1099 totals</span>
          <select className="field" value={track} onChange={(e) => setTrack(e.target.value as "auto" | "yes" | "no")}>
            <option value="auto">Automatic ({corp ? "no: corporations usually don't get a 1099-NEC" : "yes"})</option><option value="yes">Yes, always</option><option value="no">No</option></select></label>
      </div>
      <p className="text-xs text-muted">For security we keep only the last 4 digits of the SSN or EIN. The full number stays on the W-9 file you upload below, which only people allowed to manage subcontractor compliance can open.</p>
      <Button size="sm" onClick={save} disabled={busy} data-testid="tax-save">{busy ? "Saving…" : "Save W-9 details"}</Button>
    </section>
  );
}
