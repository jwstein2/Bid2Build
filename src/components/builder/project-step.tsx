"use client";
import { useEffect, useState, type Dispatch } from "react";
import { AddressInput } from "../ui/address-input";
import type { Estimate } from "@/lib/estimate/types";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { tradeName } from "@/lib/trades/catalog";
import { isDefaultTitle } from "@/lib/estimate/factory";
import { AddTradeSelect, useTradeRemoval } from "./trade-controls";
import { Button } from "../ui/button";
import { Field } from "../ui/misc";
import { ProjectProfileFields } from "./project-profile";
import type { Action } from "./state";

interface SavedCustomer { id: string; name: string; email?: string; phone?: string; projectAddress?: string }

export function ProjectStep({ estimate: e, dispatch, signedIn, onDone, missing }: { estimate: Estimate; dispatch: Dispatch<Action>; signedIn: boolean; onDone?: () => void; /** Readiness codes still blocking download (shown inline). */ missing?: ReadonlySet<string> }) {
  const [customers, setCustomers] = useState<SavedCustomer[]>([]);
  const [titleTouched, setTitleTouched] = useState(false);
  const titleIsStarter = !titleTouched && isDefaultTitle(e);
  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/customers").then((r) => (r.ok ? r.json() : { customers: [] })).then((d) => setCustomers(d.customers ?? [])).catch(() => {});
  }, [signedIn]);
  const { requestRemove, dialog: removalDialog } = useTradeRemoval(e, dispatch);
  const c = e.customer;
  const pc = (patch: Partial<Estimate["customer"]>) => dispatch({ type: "patchCustomer", patch });

  // Customers are added to the directory automatically when the bid saves; a picked customer stays linked
  // until the name is changed to someone else.
  const linked = e.customerId ? customers.find((x) => x.id === e.customerId) ?? null : null;
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const setName = (name: string) => {
    pc({ name });
    if (linked && norm(name) !== norm(linked.name)) dispatch({ type: "patch", patch: { customerId: null } });
  };

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
            <select aria-label="Choose an existing customer" className="field field-sm w-auto" value="" onChange={(ev) => {
              const s = customers.find((x) => x.id === ev.target.value);
              if (s) { pc({ name: s.name, email: s.email, phone: s.phone, projectAddress: s.projectAddress }); dispatch({ type: "patch", patch: { customerId: s.id } }); }
            }}>
              <option value="">Choose an existing customer…</option>
              {customers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Customer name" required htmlFor="c-name" error={missing?.has("customer_name") ? "Add the customer's name before downloading this proposal." : undefined}><input id="c-name" className="field" value={c.name} onChange={(ev) => setName(ev.target.value)} /></Field>
          <Field label="Customer email" optional htmlFor="c-email"><input id="c-email" type="email" className="field" value={c.email ?? ""} onChange={(ev) => pc({ email: ev.target.value })} /></Field>
          <Field label="Customer phone" optional htmlFor="c-phone"><input id="c-phone" type="tel" className="field" value={c.phone ?? ""} onChange={(ev) => pc({ phone: ev.target.value })} /></Field>
          <Field label="Project address" required htmlFor="c-addr" error={missing?.has("project_address") ? "Add a project address before downloading this proposal." : undefined}><AddressInput
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
          <p className="mt-3 text-sm text-muted" role="status" data-testid="customer-link-status">
            {linked ? <>Using <a href={`/dashboard/customers/${linked.id}`} className="font-semibold text-accent-ink underline">{linked.name}</a> from your Customers.</> : "This customer is added to your Customers automatically. No need to save them separately."}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h3 className="font-bold">Project</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Project title" required htmlFor="p-title" error={missing?.has("project_title") ? "Add a project title before downloading this proposal." : undefined} hint={titleIsStarter ? `Your proposal uses “${e.title}” until you type a name.` : undefined}>
            {/* The starter title is shown as a suggestion, so typing a name replaces it instead of appending to it. */}
            <input id="p-title" className="field" value={titleIsStarter ? "" : e.title} placeholder={titleIsStarter ? e.title : "e.g. Smith backyard deck"} onChange={(ev) => { setTitleTouched(true); dispatch({ type: "patch", patch: { title: ev.target.value } }); }} />
          </Field></div>
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
