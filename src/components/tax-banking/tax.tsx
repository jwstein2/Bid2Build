"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/financials/accounting/controls";
import { useTb } from "./client";

export interface StateOpt { code: string; name: string }
type Profile = { primaryState: string | null; serviceStates: string[]; address: { line1?: string; city?: string; state?: string; zip?: string } | null;
  registrations: { state: string; registered: boolean; note?: string }[]; businessType: string | null; workMix: string | null; defaultContract: string | null;
  autoApplyRates: boolean; notifyImmediate: boolean; notifyQuarterly: boolean; notifyEmail: boolean };

const BUSINESS = { general_contractor: "General contractor", subcontractor: "Subcontractor", specialty_trade: "Specialty trade", remodeler: "Remodeler", service: "Service / repair", other: "Other" };
const MIX = { residential: "Residential", commercial: "Commercial", both: "Both" };
const CONTRACT = { lump_sum: "Lump sum (fixed price)", time_and_materials: "Time & materials", cost_plus: "Cost plus", mixed: "It varies" };

/** Tax setup (also the onboarding step). No permit numbers, no filing, no paid provider is switched on here. */
export function TaxProfileForm({ initial, states, canEdit }: { initial: Profile; states: StateOpt[]; canEdit: boolean }) {
  const { busy, msg, run } = useTb();
  const [f, setF] = useState<Profile>(initial);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggleState = (s: string) => set("serviceStates", f.serviceStates.includes(s) ? f.serviceStates.filter((x) => x !== s) : [...f.serviceStates, s].sort());
  const reg = (s: string) => f.registrations.find((r) => r.state === s)?.registered ?? false;
  const setReg = (s: string, v: boolean) => set("registrations", [...f.registrations.filter((r) => r.state !== s), { state: s, registered: v }]);
  const all = [...new Set([...(f.primaryState ? [f.primaryState] : []), ...f.serviceStates])];
  return (
    <form className="space-y-4 rounded-xl border border-line bg-surface p-4" data-testid="tax-profile"
      onSubmit={(e) => { e.preventDefault(); void run({ action: "tax_profile_save", p: { ...f, address: f.address ?? undefined, registrations: f.registrations.filter((r) => all.includes(r.state)) } }, "Tax setup saved."); }}>
      <div>
        <h2 className="font-display text-lg font-extrabold">Tax setup</h2>
        <p className="text-sm text-ink-soft">Tells Built2Bid which states to watch and how your work is usually contracted. It never files anything and never changes a signed bid or issued invoice.</p>
      </div>
      <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="label" htmlFor="tp-primary">Home state
          <select id="tp-primary" className="field mt-1" value={f.primaryState ?? ""} onChange={(e) => set("primaryState", e.target.value || null)}>
            <option value="">Choose…</option>{states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select></label>
        <label className="label" htmlFor="tp-biz">Business type
          <select id="tp-biz" className="field mt-1" value={f.businessType ?? ""} onChange={(e) => set("businessType", e.target.value || null)}>
            <option value="">Choose…</option>{Object.entries(BUSINESS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="label" htmlFor="tp-mix">Work mix
          <select id="tp-mix" className="field mt-1" value={f.workMix ?? ""} onChange={(e) => set("workMix", e.target.value || null)}>
            <option value="">Choose…</option>{Object.entries(MIX).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="label" htmlFor="tp-contract">Usual contract
          <select id="tp-contract" className="field mt-1" value={f.defaultContract ?? ""} onChange={(e) => set("defaultContract", e.target.value || null)}>
            <option value="">Choose…</option>{Object.entries(CONTRACT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
      </fieldset>
      <fieldset disabled={!canEdit}>
        <legend className="label">States you work in</legend>
        <div className="mt-1 flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded-lg border border-line p-2">
          {states.map((s) => (
            <label key={s.code} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md border border-line px-2 text-xs has-[:checked]:border-brand has-[:checked]:bg-brand-tint">
              <input type="checkbox" checked={f.serviceStates.includes(s.code)} onChange={() => toggleState(s.code)} aria-label={s.name} />{s.code}
            </label>
          ))}
        </div>
      </fieldset>
      {all.length > 0 && (
        <fieldset disabled={!canEdit}>
          <legend className="label">Sales tax registration (yes / no only; permit numbers aren&apos;t stored)</legend>
          <ul className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {all.map((s) => <li key={s}><label className="inline-flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={reg(s)} onChange={(e) => setReg(s, e.target.checked)} />Registered in {states.find((x) => x.code === s)?.name ?? s}</label></li>)}
          </ul>
        </fieldset>
      )}
      <fieldset disabled={!canEdit} className="space-y-1">
        <legend className="label">Updates</legend>
        <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={f.autoApplyRates} onChange={(e) => set("autoApplyRates", e.target.checked)} />Apply verified rate changes automatically on their effective date (rule changes always wait for review)</label>
        <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={f.notifyImmediate} onChange={(e) => set("notifyImmediate", e.target.checked)} />Show an alert when a change affects my states</label>
        <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={f.notifyQuarterly} onChange={(e) => set("notifyQuarterly", e.target.checked)} />Quarterly summary</label>
        <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={f.notifyEmail} onChange={(e) => set("notifyEmail", e.target.checked)} />Also email me (off unless you turn it on; emails start after launch approval)</label>
      </fieldset>
      {canEdit && <div className="flex flex-wrap items-center gap-2"><Button type="submit" size="sm" disabled={busy}>Save tax setup</Button><Status msg={msg} busy={busy} /></div>}
    </form>
  );
}

export function AlertActions({ id, canAct }: { id: string; canAct: boolean }) {
  const { busy, msg, run } = useTb();
  if (!canAct) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run({ action: "tax_alert_act", alertId: id, status: "reviewed" }, "Marked reviewed.")}>Mark reviewed</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ action: "tax_alert_act", alertId: id, status: "dismissed" }, "Dismissed.")}>Dismiss</Button>
      <Status msg={msg} busy={busy} />
    </div>
  );
}

const REASONS = { resale: "Resale", government: "Government", nonprofit: "Nonprofit", religious: "Religious", agricultural: "Agricultural", manufacturing: "Manufacturing", direct_pay: "Direct pay permit", other: "Other" };

/** Record that a customer's exemption certificate is on file (reference + expiry; never the full certificate number required). */
export function ExemptionForm({ customers, states }: { customers: { id: string; label: string }[]; states: StateOpt[] }) {
  const { busy, msg, run } = useTb();
  const blank = { customerId: "", state: "", reason: "resale", certificateRef: "", expiresOn: "" };
  const [f, setF] = useState(blank);
  return (
    <form className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-6" data-testid="tax-exemption-form"
      onSubmit={async (e) => { e.preventDefault(); if (await run({ action: "tax_exemption_save", p: { customerId: f.customerId, state: f.state, reason: f.reason, certificateRef: f.certificateRef || undefined, expiresOn: f.expiresOn || undefined } }, "Exemption saved.")) setF(blank); }}>
      <label className="label lg:col-span-2" htmlFor="ex-c">Customer<select id="ex-c" required className="field mt-1" value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">Choose…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label className="label" htmlFor="ex-s">State<select id="ex-s" required className="field mt-1" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="">Choose…</option>{states.map((s) => <option key={s.code} value={s.code}>{s.code}</option>)}</select></label>
      <label className="label" htmlFor="ex-r">Reason<select id="ex-r" className="field mt-1" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="label" htmlFor="ex-ref">Certificate reference<input id="ex-ref" className="field mt-1" maxLength={40} value={f.certificateRef} onChange={(e) => setF({ ...f, certificateRef: e.target.value })} placeholder="Last digits or a note" /></label>
      <label className="label" htmlFor="ex-exp">Expires<input id="ex-exp" type="date" className="field mt-1" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-6">
        <Button type="submit" size="sm" disabled={busy || !f.customerId || !f.state}>Save exemption</Button><Status msg={msg} busy={busy} />
        <span className="text-xs text-muted">Tax is removed only while a current certificate for the same state is on file.</span>
      </div>
    </form>
  );
}

export function RevokeExemption({ id }: { id: string }) {
  const { busy, msg, run } = useTb();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ action: "tax_exemption_save", p: { id, status: "revoked" } }, "Revoked.")}>Revoke</Button><Status msg={msg} busy={busy} /></span>;
}

/**
 * Ask a customer to fill in and sign their exemption certificate online (no uploads). Makes a secret link the
 * contractor sends however they like (copy, or open their own email app). Built2Bid itself sends nothing.
 */
export function RequestExemption({ customers, states, defaultStates }: { customers: { id: string; label: string }[]; states: StateOpt[]; defaultStates: string[] }) {
  const { busy, msg, run } = useTb();
  const [customerId, setCustomerId] = useState("");
  const [picked, setPicked] = useState<string[]>(defaultStates);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const name = customers.find((c) => c.id === customerId)?.label ?? "";
  const mail = url ? `mailto:?subject=${encodeURIComponent("Sales tax exemption certificate")}&body=${encodeURIComponent(`Hi${name ? ` ${name}` : ""},\n\nPlease fill in and sign your sales tax exemption certificate online here (about two minutes, nothing to print or upload):\n${url}\n\nThank you!`)}` : "";
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="tax-exemption-request">
      <div>
        <h3 className="font-semibold">Ask a customer to sign their certificate online</h3>
        <p className="text-sm text-ink-soft">They get a secure link, fill in the uniform exemption certificate and sign by typing their name. It&apos;s saved here automatically. No uploads.</p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={async (e) => {
        e.preventDefault(); setCopied(false);
        const d = await run<{ url: string }>({ action: "tax_exemption_request", customerId, states: picked }, "Link ready. Send it to your customer.");
        if (d?.url) setUrl(d.url);
      }}>
        <label className="label lg:col-span-2" htmlFor="exr-c">Customer<select id="exr-c" required className="field mt-1" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setUrl(null); }}><option value="">Choose…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <fieldset className="lg:col-span-4">
          <legend className="label">States (the customer can change these)</legend>
          <div className="mt-1 flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-lg border border-line p-2">
            {states.map((s) => (
              <label key={s.code} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md border border-line px-2 text-xs has-[:checked]:border-brand has-[:checked]:bg-brand-tint">
                <input type="checkbox" checked={picked.includes(s.code)} onChange={() => setPicked(picked.includes(s.code) ? picked.filter((x) => x !== s.code) : [...picked, s.code].sort())} aria-label={s.name} />{s.code}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit" size="sm" disabled={busy || !customerId || !picked.length}>Create signing link</Button><Status msg={msg} busy={busy} />
        </div>
      </form>
      {url && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper p-2 text-sm" data-testid="tax-exemption-link">
          <input readOnly value={url} aria-label="Signing link" className="field min-w-0 flex-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Button size="sm" variant="secondary" type="button" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy link"}</Button>
          <a href={mail} className="inline-flex min-h-9 items-center text-sm font-semibold text-accent-ink underline">Open in my email</a>
          <span className="w-full text-xs text-muted">The link works for 30 days. Creating a new link for this customer replaces the old one.</span>
        </div>
      )}
    </div>
  );
}
