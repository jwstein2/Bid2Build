"use client";
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { BUSINESS_TYPES, EXEMPT_REASONS, ID_TYPES, type ExemptReason } from "@/lib/tax-banking/tax/exemption-form";

type StateOpt = { code: string; name: string };

/** The customer's exemption certificate. Everything is typed on the page; the server re-validates it all. */
export function ExemptForm({ token, customerName, company, suggestedStates, states, statementFor }: {
  token: string; customerName: string; company: string; suggestedStates: string[]; states: StateOpt[]; statementFor: string;
}) {
  const [f, setF] = useState({
    states: suggestedStates, reasonCode: "" as ExemptReason | "", reasonOther: "", name: customerName, business: "", line1: "", city: "", pState: suggestedStates[0] ?? "", zip: "",
    businessType: "", idType: "", idNumber: "", idState: "", signerName: "", signerTitle: "", agree: false,
  });
  const [err, setErr] = useState<{ field: string | null; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (s: string) => set("states", f.states.includes(s) ? f.states.filter((x) => x !== s) : [...f.states, s].sort());
  const statement = statementFor.replace("__PURCHASER__", f.business || f.name || customerName);
  const bad = (field: string) => (err?.field === field ? { "aria-invalid": true as const, "aria-describedby": "ex-err" } : {});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/exempt/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        states: f.states, reasonCode: f.reasonCode, reasonOther: f.reasonOther || undefined,
        purchaser: { name: f.name, business: f.business || undefined, line1: f.line1, city: f.city, state: f.pState, zip: f.zip, businessType: f.businessType },
        idType: f.idType, idNumber: f.idNumber, idState: f.idState || undefined, signerName: f.signerName, signerTitle: f.signerTitle || undefined, agree: f.agree }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { const x = body?.error ?? body; setErr({ field: x?.detail?.field ?? x?.field ?? null, message: x?.message ?? "Something went wrong. Nothing was signed." }); return; }
      setDone(true);
    } catch { setErr({ field: null, message: "You're offline or the connection dropped. Nothing was signed." }); }
    finally { setBusy(false); }
  }

  if (done) return (
    <div className="rounded-2xl border border-line bg-surface p-6 text-center sm:p-10" role="status">
      <CheckCircle2 className="mx-auto h-10 w-10 text-ok" aria-hidden />
      <h2 className="mt-2 font-display text-2xl font-extrabold text-navy">Certificate signed</h2>
      <p className="mt-1 text-ink-soft">Thank you. {company} now has your exemption certificate on file.</p>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl border border-line bg-surface p-4 sm:p-6" noValidate>
      <fieldset>
        <legend className="label">States where you&apos;re claiming exemption</legend>
        <p className="text-xs text-muted" aria-live="polite">Selected: {f.states.length ? f.states.join(", ") : "none yet"}</p>
        <div className="mt-1 flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded-lg border border-line p-2" {...bad("states")}>
          {states.map((s) => (
            <label key={s.code} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md border border-line px-2 text-xs has-[:checked]:border-brand has-[:checked]:bg-brand-tint">
              <input type="checkbox" checked={f.states.includes(s.code)} onChange={() => toggle(s.code)} aria-label={s.name} />{s.code}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="label" htmlFor="ex-reason">Reason for exemption
          <select id="ex-reason" className="field mt-1" value={f.reasonCode} onChange={(e) => set("reasonCode", e.target.value as ExemptReason)} required {...bad("reasonCode")}>
            <option value="">Choose…</option>{Object.entries(EXEMPT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        {f.reasonCode === "L" && <label className="label" htmlFor="ex-other">Describe the reason<input id="ex-other" className="field mt-1" maxLength={200} value={f.reasonOther} onChange={(e) => set("reasonOther", e.target.value)} {...bad("reasonOther")} /></label>}
        <label className="label" htmlFor="ex-name">Purchaser name<input id="ex-name" className="field mt-1" autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} required {...bad("purchaser.name")} /></label>
        <label className="label" htmlFor="ex-biz">Business or organization (optional)<input id="ex-biz" className="field mt-1" autoComplete="organization" value={f.business} onChange={(e) => set("business", e.target.value)} /></label>
        <label className="label sm:col-span-2" htmlFor="ex-l1">Street address<input id="ex-l1" className="field mt-1" autoComplete="street-address" value={f.line1} onChange={(e) => set("line1", e.target.value)} required {...bad("purchaser.line1")} /></label>
        <label className="label" htmlFor="ex-city">City<input id="ex-city" className="field mt-1" autoComplete="address-level2" value={f.city} onChange={(e) => set("city", e.target.value)} required {...bad("purchaser.city")} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="label" htmlFor="ex-st">State<select id="ex-st" className="field mt-1" value={f.pState} onChange={(e) => set("pState", e.target.value)} {...bad("purchaser.state")}><option value="">—</option>{states.map((s) => <option key={s.code} value={s.code}>{s.code}</option>)}</select></label>
          <label className="label" htmlFor="ex-zip">ZIP<input id="ex-zip" className="field mt-1" inputMode="numeric" autoComplete="postal-code" maxLength={10} value={f.zip} onChange={(e) => set("zip", e.target.value)} required {...bad("purchaser.zip")} /></label>
        </div>
        <label className="label" htmlFor="ex-type">Type of business
          <select id="ex-type" className="field mt-1" value={f.businessType} onChange={(e) => set("businessType", e.target.value)} {...bad("purchaser.businessType")}><option value="">Choose…</option>{BUSINESS_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
        <label className="label" htmlFor="ex-idt">ID number type
          <select id="ex-idt" className="field mt-1" value={f.idType} onChange={(e) => set("idType", e.target.value)} {...bad("idType")}><option value="">Choose…</option>{Object.entries(ID_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="label" htmlFor="ex-id">ID number<input id="ex-id" className="field mt-1" maxLength={40} autoComplete="off" value={f.idNumber} onChange={(e) => set("idNumber", e.target.value)} required {...bad("idNumber")} /></label>
        <label className="label" htmlFor="ex-ids">State that issued it (if any)<select id="ex-ids" className="field mt-1" value={f.idState} onChange={(e) => set("idState", e.target.value)}><option value="">—</option>{states.map((s) => <option key={s.code} value={s.code}>{s.code}</option>)}</select></label>
      </div>
      <div className="space-y-3 rounded-xl border border-line bg-paper p-3">
        <p className="text-sm text-ink-soft">{statement}</p>
        <label className="flex min-h-9 items-start gap-2 text-sm font-semibold"><input type="checkbox" className="mt-1" checked={f.agree} onChange={(e) => set("agree", e.target.checked)} {...bad("agree")} />I confirm this statement</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="label" htmlFor="ex-sig">Type your full name to sign<input id="ex-sig" className="field mt-1 font-display text-lg" autoComplete="name" value={f.signerName} onChange={(e) => set("signerName", e.target.value)} required {...bad("signerName")} /></label>
          <label className="label" htmlFor="ex-title">Title (optional)<input id="ex-title" className="field mt-1" autoComplete="organization-title" value={f.signerTitle} onChange={(e) => set("signerTitle", e.target.value)} /></label>
        </div>
      </div>
      {err && <p id="ex-err" role="alert" className="text-sm font-semibold text-danger">{err.message}</p>}
      <button type="submit" disabled={busy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 font-bold text-white disabled:opacity-60 sm:w-auto">
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Sign certificate
      </button>
      <p className="text-xs text-muted">Your contractor keeps this certificate to show why tax wasn&apos;t charged. {company} can&apos;t see anything else about you here.</p>
    </form>
  );
}
