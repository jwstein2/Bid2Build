"use client";
import { useEffect, useState, type Dispatch } from "react";
import type { Estimate } from "@/lib/estimate/types";
import { trades } from "@/lib/trades/catalog";
import { Button } from "../ui/button";
import { Field } from "../ui/misc";
import { ProjectProfileFields } from "./project-profile";
import type { Action } from "./state";

interface SavedCustomer { id: string; name: string; email?: string; phone?: string; projectAddress?: string }

export function ProjectStep({ estimate: e, dispatch, signedIn, onDone }: { estimate: Estimate; dispatch: Dispatch<Action>; signedIn: boolean; onDone?: () => void }) {
  const [customers, setCustomers] = useState<SavedCustomer[]>([]);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/customers").then((r) => (r.ok ? r.json() : { customers: [] })).then((d) => setCustomers(d.customers ?? [])).catch(() => {});
  }, [signedIn]);
  const c = e.customer;
  const pc = (patch: Partial<Estimate["customer"]>) => dispatch({ type: "patchCustomer", patch });

  async function saveCustomer() {
    const r = await fetch("/api/customers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: c.name, email: c.email, phone: c.phone, projectAddress: c.projectAddress, notes: c.notes }) });
    if (r.ok) { const d = await r.json(); setCustomers([d.customer, ...customers]); setSavedMsg("Saved to your customers."); }
    else setSavedMsg("Could not save this customer.");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold">Customer & project</h2>
        <p className="mt-1 text-ink-soft">Customer details appear on the proposal. We never contact your customers.</p>
      </div>

      <section className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">Customer</h3>
          {signedIn && customers.length > 0 && (
            <select aria-label="Use a saved customer" className="field field-sm w-auto" value="" onChange={(ev) => {
              const s = customers.find((x) => x.id === ev.target.value);
              if (s) { pc({ name: s.name, email: s.email, phone: s.phone, projectAddress: s.projectAddress }); dispatch({ type: "patch", patch: { customerId: s.id } }); }
            }}>
              <option value="">Use a saved customer…</option>
              {customers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Customer name" required htmlFor="c-name"><input id="c-name" className="field" value={c.name} onChange={(ev) => pc({ name: ev.target.value })} /></Field>
          <Field label="Customer email" optional htmlFor="c-email"><input id="c-email" type="email" className="field" value={c.email ?? ""} onChange={(ev) => pc({ email: ev.target.value })} /></Field>
          <Field label="Customer phone" optional htmlFor="c-phone"><input id="c-phone" type="tel" className="field" value={c.phone ?? ""} onChange={(ev) => pc({ phone: ev.target.value })} /></Field>
          <Field label="Project address" required htmlFor="c-addr"><textarea id="c-addr" rows={2} className="field" value={c.projectAddress ?? ""} onChange={(ev) => pc({ projectAddress: ev.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Project notes" optional htmlFor="c-notes" hint="Private to you. Not shown on the proposal."><textarea id="c-notes" rows={2} className="field" value={c.notes ?? ""} onChange={(ev) => pc({ notes: ev.target.value })} /></Field></div>
        </div>
        {signedIn && c.name.trim() && (
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" variant="secondary" onClick={saveCustomer}>Save to my customers</Button>
            {savedMsg && <span className="text-sm text-muted" role="status">{savedMsg}</span>}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h3 className="font-bold">Project</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Project title" required htmlFor="p-title"><input id="p-title" className="field" value={e.title} onChange={(ev) => dispatch({ type: "patch", patch: { title: ev.target.value } })} /></Field></div>
          <Field label="Estimate number" htmlFor="p-num"><input id="p-num" className="field" value={e.estimateNumber} onChange={(ev) => dispatch({ type: "patch", patch: { estimateNumber: ev.target.value } })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Estimate date" htmlFor="p-date"><input id="p-date" type="date" className="field" value={e.estimateDate} onChange={(ev) => dispatch({ type: "patch", patch: { estimateDate: ev.target.value } })} /></Field>
            <Field label="Expires" htmlFor="p-exp"><input id="p-exp" type="date" className="field" value={e.expirationDate} onChange={(ev) => dispatch({ type: "patch", patch: { expirationDate: ev.target.value } })} /></Field>
          </div>
          <Field label="Project ZIP code" optional htmlFor="p-zip" hint="Used for regional pricing when a licensed source is connected."><input id="p-zip" className="field" inputMode="numeric" value={e.location.zip ?? ""} onChange={(ev) => dispatch({ type: "patchLocation", patch: { zip: ev.target.value } })} maxLength={10} /></Field>
          <div className="grid grid-cols-[1fr_90px] gap-3">
            <Field label="City" optional htmlFor="p-city"><input id="p-city" className="field" value={e.location.city ?? ""} onChange={(ev) => dispatch({ type: "patchLocation", patch: { city: ev.target.value } })} /></Field>
            <Field label="State" optional htmlFor="p-state"><input id="p-state" className="field" value={e.location.state ?? ""} onChange={(ev) => dispatch({ type: "patchLocation", patch: { state: ev.target.value } })} maxLength={50} /></Field>
          </div>
          <div className="sm:col-span-2">
            <span className="label">Trades in this project</span>
            <p className="mb-2 text-xs text-muted">Add trades for mixed projects to get their suggested items.</p>
            <div className="flex flex-wrap gap-2">
              {e.trades.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2.5 py-1 text-sm font-medium text-brand">
                  {trades.find((x) => x.slug === t)?.name ?? t}
                  {e.trades.length > 1 && <button aria-label={`Remove ${t}`} onClick={() => dispatch({ type: "patch", patch: { trades: e.trades.filter((x) => x !== t) } })} className="ml-0.5 rounded-full px-1 hover:bg-black/10">×</button>}
                </span>
              ))}
              <select aria-label="Add a trade" className="field field-sm w-auto" value="" onChange={(ev) => ev.target.value && dispatch({ type: "patch", patch: { trades: [...e.trades, ev.target.value] } })}>
                <option value="">+ Add trade</option>
                {trades.filter((t) => !e.trades.includes(t.slug)).map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      </section>
      <ProjectProfileFields estimate={e} dispatch={dispatch} />
      {onDone && <div className="flex justify-end"><Button size="lg" onClick={onDone}>Continue to estimate</Button></div>}
    </div>
  );
}
