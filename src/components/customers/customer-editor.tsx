"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../ui/button";
import { Field } from "../ui/misc";

export interface EditableCustomer { id: string; name: string; email: string; phone: string; projectAddress: string; notes: string; customerType: "person" | "business"; companyName: string }

/**
 * Contact details of the shared customer record. Saving updates the record every future bid uses;
 * existing bids and signed proposals keep the details they were created with.
 */
export function CustomerEditor({ customer, canEdit, canDelete }: { customer: EditableCustomer; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(customer);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (p: Partial<EditableCustomer>) => setV((x) => ({ ...x, ...p }));

  async function save() {
    if (!v.name.trim()) { setMsg("Customer name is required."); return; }
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/customers/${customer.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    setBusy(false);
    if (!r.ok) { setMsg((await r.json().catch(() => null))?.error?.message ?? "Could not save this customer."); return; }
    setEditing(false); setMsg("Saved. Future bids use these details; existing proposals are unchanged.");
    router.refresh();
  }
  async function remove() {
    setBusy(true);
    const r = await fetch(`/api/customers/${customer.id}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) router.push("/dashboard/customers");
    else setMsg((await r.json().catch(() => null))?.error?.message ?? "Could not delete this customer.");
  }

  if (!editing) {
    return (
      <div className="space-y-2 text-sm" data-testid="customer-contact">
        <dl className="grid gap-2 sm:grid-cols-2">
          <div><dt className="text-muted">Type</dt><dd>{customer.customerType === "business" ? "Business" : "Person"}</dd></div>
          {customer.companyName && <div><dt className="text-muted">Business name</dt><dd>{customer.companyName}</dd></div>}
          <div><dt className="text-muted">Email</dt><dd className="break-all">{customer.email ? <a className="underline" href={`mailto:${customer.email}`}>{customer.email}</a> : "—"}</dd></div>
          <div><dt className="text-muted">Phone</dt><dd>{customer.phone ? <a className="underline" href={`tel:${customer.phone}`}>{customer.phone}</a> : "—"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted">Address</dt><dd className="whitespace-pre-line">{customer.projectAddress || "—"}</dd></div>
          {customer.notes && <div className="sm:col-span-2"><dt className="text-muted">Notes (private)</dt><dd className="whitespace-pre-line">{customer.notes}</dd></div>}
        </dl>
        {msg && <p role="status" className="text-ok">{msg}</p>}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => { setV(customer); setEditing(true); setMsg(null); }} data-testid="customer-edit">Edit contact</Button>
            {canDelete && !confirmDelete && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)}>Delete customer</Button>}
            {canDelete && confirmDelete && (
              <span className="flex flex-wrap items-center gap-1" role="group" aria-label={`Confirm deleting ${customer.name}`}>
                <span className="text-ink-soft">Delete {customer.name}?</span>
                <Button size="sm" variant="danger" onClick={remove} disabled={busy} autoFocus>Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="customer-edit-form">
      <fieldset className="flex gap-4 text-sm">
        <legend className="label">Customer type</legend>
        {(["person", "business"] as const).map((t) => (
          <label key={t} className="flex min-h-11 items-center gap-2"><input type="radio" name="ctype" checked={v.customerType === t} onChange={() => set({ customerType: t })} /> {t === "person" ? "Person" : "Business"}</label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={v.customerType === "business" ? "Contact name" : "Customer name"} required htmlFor="ce-name"><input id="ce-name" className="field" value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} /></Field>
        {v.customerType === "business" && <Field label="Business name" optional htmlFor="ce-company"><input id="ce-company" className="field" value={v.companyName} onChange={(e) => set({ companyName: e.target.value })} maxLength={200} /></Field>}
        <Field label="Email" optional htmlFor="ce-email"><input id="ce-email" type="email" className="field" value={v.email} onChange={(e) => set({ email: e.target.value })} maxLength={320} /></Field>
        <Field label="Phone" optional htmlFor="ce-phone"><input id="ce-phone" type="tel" className="field" value={v.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={50} /></Field>
        <div className="sm:col-span-2"><Field label="Address" optional htmlFor="ce-addr"><textarea id="ce-addr" rows={2} className="field" value={v.projectAddress} onChange={(e) => set({ projectAddress: e.target.value })} maxLength={500} /></Field></div>
        <div className="sm:col-span-2"><Field label="Notes" optional hint="Private to your team. Never shown on proposals." htmlFor="ce-notes"><textarea id="ce-notes" rows={2} className="field" value={v.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={4000} /></Field></div>
      </div>
      <p className="text-xs text-muted">Changes apply to future bids. Bids and signed proposals you already created keep their original details.</p>
      {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
      <div className="flex gap-2">
        <Button loading={busy} type="submit" size="sm" disabled={busy} data-testid="customer-save">{busy ? "Saving…" : "Save"}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setMsg(null); }}>Cancel</Button>
      </div>
    </form>
  );
}
