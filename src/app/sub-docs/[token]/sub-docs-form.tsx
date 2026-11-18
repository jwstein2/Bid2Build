"use client";
import { useState } from "react";
import { CheckCircle2, Loader2, Lock } from "lucide-react";
import { REQUEST_LABEL, type SubRequestKind } from "@/lib/team/sub-requests";

const CLASSES: [string, string][] = [
  ["individual", "Individual / sole proprietor / single-member LLC"], ["c_corp", "C corporation"], ["s_corp", "S corporation"],
  ["partnership", "Partnership"], ["trust_estate", "Trust / estate"], ["llc_c", "LLC taxed as a C corporation"],
  ["llc_s", "LLC taxed as an S corporation"], ["llc_p", "LLC taxed as a partnership"], ["other", "Other"],
];
const CERTIFY = "Under penalties of perjury, I certify that the number shown on this form is my correct taxpayer identification number, that I am not subject to backup withholding (or I have been notified by the IRS that I am no longer subject to it), and that I am a U.S. citizen or other U.S. person.";

type DocState = { issuer: string; policyNumber: string; coverageAmount: string; effectiveOn: string; expiresOn: string; file: File | null };
const emptyDoc = (): DocState => ({ issuer: "", policyNumber: "", coverageAmount: "", effectiveOn: "", expiresOn: "", file: null });

/** The sub's W-9 and certificate uploads. The server re-validates everything and encrypts the tax ID. */
export function SubDocsForm({ token, contractor, subName, kinds, w9Available }: { token: string; contractor: string; subName: string; kinds: SubRequestKind[]; w9Available: boolean }) {
  const wantsW9 = kinds.includes("w9");
  const docKinds = kinds.filter((k) => k !== "w9");
  const [w, setW] = useState({ legalName: subName, businessName: "", taxClassification: "", tinType: "ein" as "ssn" | "ein", tin: "", address: "", signedName: "", certify: false });
  const [docs, setDocs] = useState<Record<string, DocState>>(() => Object.fromEntries(docKinds.map((k) => [k, emptyDoc()])));
  const [err, setErr] = useState<{ field: string | null; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const setD = (k: string, patch: Partial<DocState>) => setDocs((x) => ({ ...x, [k]: { ...x[k], ...patch } }));
  const bad = (field: string) => (err?.field === field ? { "aria-invalid": true as const, "aria-describedby": "sd-err" } : {});
  const w9Started = wantsW9 && w9Available && (w.tin || w.signedName || w.certify);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData();
    if (w9Started) fd.set("w9", JSON.stringify({ ...w, businessName: w.businessName || undefined }));
    for (const k of docKinds) {
      const d = docs[k];
      if (!d.file) continue;
      fd.set(`file:${k}`, d.file);
      fd.set(`doc:${k}`, JSON.stringify({ issuer: d.issuer || undefined, policyNumber: d.policyNumber || undefined, coverageAmount: d.coverageAmount.replace(/[$,\s]/g, "") || undefined, effectiveOn: d.effectiveOn || undefined, expiresOn: d.expiresOn || undefined }));
    }
    if (!fd.has("w9") && ![...fd.keys()].some((k) => k.startsWith("file:"))) { setErr({ field: null, message: "Fill in the W-9 or add at least one file." }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/sub-docs/${token}`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { const x = body?.error ?? body; setErr({ field: x?.detail?.field ?? x?.field ?? null, message: x?.message ?? "Something went wrong. Nothing was sent." }); return; }
      setDone(true);
    } catch { setErr({ field: null, message: "You're offline or the connection dropped. Nothing was sent." }); }
    finally { setBusy(false); }
  }

  if (done) return (
    <div className="rounded-2xl border border-line bg-surface p-6 text-center sm:p-10" role="status">
      <CheckCircle2 className="mx-auto h-10 w-10 text-ok" aria-hidden />
      <h2 className="mt-2 font-display text-2xl font-extrabold text-navy">Sent</h2>
      <p className="mt-1 text-ink-soft">Thank you. {contractor} now has your paperwork on file.</p>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {wantsW9 && (
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 sm:p-6" aria-labelledby="sd-w9">
          <h2 id="sd-w9" className="font-display text-lg font-extrabold text-navy">W-9: request for taxpayer ID</h2>
          {!w9Available ? (
            <p className="text-sm text-ink-soft">The online W-9 isn&apos;t available yet. Please send your W-9 to {contractor} another way, and upload your certificates below.</p>
          ) : (
            <>
              <p className="flex items-start gap-2 text-sm text-ink-soft"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Your tax ID is encrypted when you send it and is only available to {contractor}.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="label" htmlFor="sd-legal">Name (as shown on your tax return)<input id="sd-legal" className="field mt-1" autoComplete="name" value={w.legalName} onChange={(e) => setW({ ...w, legalName: e.target.value })} {...bad("legalName")} /></label>
                <label className="label" htmlFor="sd-biz">Business name, if different (optional)<input id="sd-biz" className="field mt-1" autoComplete="organization" value={w.businessName} onChange={(e) => setW({ ...w, businessName: e.target.value })} /></label>
                <label className="label sm:col-span-2" htmlFor="sd-class">Federal tax classification
                  <select id="sd-class" className="field mt-1" value={w.taxClassification} onChange={(e) => setW({ ...w, taxClassification: e.target.value })} {...bad("taxClassification")}>
                    <option value="">Choose…</option>{CLASSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></label>
                <fieldset className="label">
                  <legend>Tax ID type</legend>
                  <div className="mt-1 flex gap-4">
                    {(["ein", "ssn"] as const).map((t) => <label key={t} className="inline-flex min-h-9 items-center gap-2 font-normal"><input type="radio" name="tinType" checked={w.tinType === t} onChange={() => setW({ ...w, tinType: t })} />{t === "ein" ? "EIN" : "SSN"}</label>)}
                  </div>
                </fieldset>
                <label className="label" htmlFor="sd-tin">{w.tinType === "ein" ? "EIN (9 digits)" : "Social Security number"}<input id="sd-tin" className="field mt-1" inputMode="numeric" autoComplete="off" maxLength={11} value={w.tin} onChange={(e) => setW({ ...w, tin: e.target.value.replace(/[^\d-]/g, "") })} {...bad("tin")} /></label>
                <label className="label sm:col-span-2" htmlFor="sd-addr">Mailing address (street, city, state, ZIP)<textarea id="sd-addr" rows={2} className="field mt-1" autoComplete="street-address" value={w.address} onChange={(e) => setW({ ...w, address: e.target.value })} {...bad("address")} /></label>
              </div>
              <div className="space-y-3 rounded-xl border border-line bg-paper p-3">
                <p className="text-sm text-ink-soft">{CERTIFY}</p>
                <label className="flex min-h-9 items-start gap-2 text-sm font-semibold"><input type="checkbox" className="mt-1" checked={w.certify} onChange={(e) => setW({ ...w, certify: e.target.checked })} {...bad("certify")} />I certify the statement above</label>
                <label className="label" htmlFor="sd-sig">Type your full name to sign<input id="sd-sig" className="field mt-1 font-display text-lg" autoComplete="name" value={w.signedName} onChange={(e) => setW({ ...w, signedName: e.target.value })} {...bad("signedName")} /></label>
              </div>
            </>
          )}
        </section>
      )}
      {docKinds.map((k) => (
        <section key={k} className="space-y-3 rounded-2xl border border-line bg-surface p-4 sm:p-6" aria-labelledby={`sd-${k}`}>
          <h2 id={`sd-${k}`} className="font-display text-lg font-extrabold text-navy">{REQUEST_LABEL[k]}</h2>
          <label className="label" htmlFor={`sd-${k}-file`}>File (PDF, JPG, PNG or WebP, up to 15 MB)
            <input id={`sd-${k}-file`} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="field mt-1" onChange={(e) => setD(k, { file: e.target.files?.[0] ?? null })} {...bad(k)} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="label" htmlFor={`sd-${k}-iss`}>{k === "license" ? "Issued by" : "Insurance company"} (optional)<input id={`sd-${k}-iss`} className="field mt-1" value={docs[k].issuer} onChange={(e) => setD(k, { issuer: e.target.value })} /></label>
            <label className="label" htmlFor={`sd-${k}-num`}>{k === "license" ? "License number" : "Policy number"} (optional)<input id={`sd-${k}-num`} className="field mt-1" value={docs[k].policyNumber} onChange={(e) => setD(k, { policyNumber: e.target.value })} /></label>
            {k !== "license" && <label className="label" htmlFor={`sd-${k}-amt`}>Coverage amount (optional)<input id={`sd-${k}-amt`} className="field mt-1" inputMode="decimal" value={docs[k].coverageAmount} onChange={(e) => setD(k, { coverageAmount: e.target.value })} /></label>}
            <label className="label" htmlFor={`sd-${k}-eff`}>Effective date (optional)<input id={`sd-${k}-eff`} type="date" className="field mt-1" value={docs[k].effectiveOn} onChange={(e) => setD(k, { effectiveOn: e.target.value })} /></label>
            <label className="label" htmlFor={`sd-${k}-exp`}>Expiration date<input id={`sd-${k}-exp`} type="date" className="field mt-1" value={docs[k].expiresOn} onChange={(e) => setD(k, { expiresOn: e.target.value })} /></label>
          </div>
        </section>
      ))}
      {err && <p id="sd-err" role="alert" className="text-sm font-semibold text-danger">{err.message}</p>}
      <button type="submit" disabled={busy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 font-bold text-white disabled:opacity-60 sm:w-auto">
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Send to {contractor}
      </button>
      <p className="text-xs text-muted">This link works once. If you need to send something else later, ask {contractor} for a new link.</p>
    </form>
  );
}
