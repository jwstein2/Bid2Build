"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "../ui/button";
import { Field } from "../ui/misc";

/** Customers → New customer. Saves the shared record and opens its profile. */
export function NewCustomerForm() {
  const router = useRouter();
  const [v, setV] = useState({ customerType: "person" as "person" | "business", name: "", companyName: "", email: "", phone: "", projectAddress: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  async function submit() {
    if (!v.name.trim()) { setErr("Customer name is required."); return; }
    setBusy(true); setErr(null);
    const r = await fetch("/api/customers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.customer?.id) { setBusy(false); setErr(d?.error?.message ?? "Could not save this customer."); return; }
    router.push(`/dashboard/customers/${d.customer.id}`);
  }
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} data-testid="new-customer-form">
      <fieldset className="flex gap-4 text-sm">
        <legend className="label">Customer type</legend>
        {(["person", "business"] as const).map((t) => (
          <label key={t} className="flex min-h-11 items-center gap-2"><input type="radio" name="ctype" checked={v.customerType === t} onChange={() => set({ customerType: t })} /> {t === "person" ? "Person" : "Business"}</label>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={v.customerType === "business" ? "Contact name" : "Customer name"} required htmlFor="nc-name" error={err && !v.name.trim() ? err : undefined}><input id="nc-name" className="field" value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} autoFocus /></Field>
        {v.customerType === "business" && <Field label="Business name" optional htmlFor="nc-company"><input id="nc-company" className="field" value={v.companyName} onChange={(e) => set({ companyName: e.target.value })} maxLength={200} /></Field>}
        <Field label="Email" optional htmlFor="nc-email"><input id="nc-email" type="email" className="field" value={v.email} onChange={(e) => set({ email: e.target.value })} maxLength={320} /></Field>
        <Field label="Phone" optional htmlFor="nc-phone"><input id="nc-phone" type="tel" className="field" value={v.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={50} /></Field>
        <div className="sm:col-span-2"><Field label="Address" optional htmlFor="nc-addr"><textarea id="nc-addr" rows={2} className="field" value={v.projectAddress} onChange={(e) => set({ projectAddress: e.target.value })} maxLength={500} /></Field></div>
        <div className="sm:col-span-2"><Field label="Notes" optional hint="Private to your team. Never shown on proposals." htmlFor="nc-notes"><textarea id="nc-notes" rows={2} className="field" value={v.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={4000} /></Field></div>
      </div>
      {err && v.name.trim() && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <Button loading={busy} type="submit" disabled={busy} data-testid="new-customer-save">{busy ? "Saving…" : "Save customer"}</Button>
        <ButtonLink href="/dashboard/customers" variant="ghost">Cancel</ButtonLink>
      </div>
    </form>
  );
}
