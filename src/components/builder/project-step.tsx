"use client";
import { useEffect, useState, type Dispatch } from "react";
import { AddressInput } from "../ui/address-input";
import type { Estimate } from "@/lib/estimate/types";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { tradeName } from "@/lib/trades/catalog";
import { AddTradeSelect, useTradeRemoval } from "./trade-controls";
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
  const { requestRemove, dialog: removalDialog } = useTradeRemoval(e, dispatch);
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
          <Field label="Project address" required htmlFor="c-addr"><AddressInput
            id="c-addr"
            multiline
            value={c.projectAddress ?? ""}
            onChange={(v) => pc({ projectAddress: v })}
            placeholder="Start typing the job site address"
            // Fill empty location fields only; never overwrite what the contractor typed.
            onPick={(p) => {
              const loc = e.location;
              const patch = { ...(!loc.zip && p.zip ? { zip: p.zip } : {}), ...(!loc.city && p.city ? { city: p.city } : {}), ...(!loc.state && p.state ? { state: p.state } : {}) };
              if (Object.keys(patch).length) dispatch({ type: "patchLocation", patch });
            }}
          /></Field>
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
            <span className="label" id="trades-label">Trades in this project</span>
            <p className="mb-2 text-xs text-muted">Each trade gets its own section in the estimate, in this order.</p>
            <ol aria-labelledby="trades-label" className="flex flex-wrap gap-2">
              {e.trades.map((t, i) => (
                <li key={t} className="inline-flex items-center gap-0.5 rounded-full bg-brand-tint py-0.5 pl-2.5 pr-1 text-sm font-medium text-brand">
                  <span className="mr-0.5 tabular text-xs text-brand/70">{i + 1}.</span>
                  {tradeName(t)}
                  {e.trades.length > 1 && (
                    <>
                      <button aria-label={`Move ${tradeName(t)} earlier`} disabled={i === 0} onClick={() => dispatch({ type: "moveTrade", trade: t, dir: -1 })} className="grid h-8 w-7 place-items-center rounded-full hover:bg-black/10 disabled:opacity-30"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /></button>
                      <button aria-label={`Move ${tradeName(t)} later`} disabled={i === e.trades.length - 1} onClick={() => dispatch({ type: "moveTrade", trade: t, dir: 1 })} className="grid h-8 w-7 place-items-center rounded-full hover:bg-black/10 disabled:opacity-30"><ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>
                      <button aria-label={`Remove ${tradeName(t)}`} onClick={() => requestRemove(t)} className="grid h-8 w-7 place-items-center rounded-full hover:bg-black/10"><X className="h-3.5 w-3.5" aria-hidden /></button>
                    </>
                  )}
                </li>
              ))}
              <li><AddTradeSelect estimate={e} dispatch={dispatch} /></li>
            </ol>
          </div>
        </div>
      </section>
      {removalDialog}
      <ProjectProfileFields estimate={e} dispatch={dispatch} />
      {onDone && <div className="flex justify-end"><Button size="lg" onClick={onDone}>Continue to estimate</Button></div>}
    </div>
  );
}
