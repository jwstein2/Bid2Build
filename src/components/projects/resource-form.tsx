"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { isIsoDate } from "@/lib/schedule/calendar";
import { KIND_LABEL, tradeLabel, type ResourceKind, type TeamResource } from "@/lib/projects/team";

const COMMON_TRADES = ["general", "demolition", "framing", "roofing", "siding", "windows", "drywall", "painting", "flooring", "tile", "cabinets", "countertops", "plumbing", "electrical", "hvac", "concrete", "decking", "gutters", "landscaping", "cleaning"];

/**
 * Add / edit one directory entry. Also used for quick-add from the Schedule Now assign step and the task
 * drawer (compact). Returns the saved id so callers can select it right away.
 */
export function ResourceForm({ initial, resources, people, me, companyMode, onCancel, onSaved, compact = false, defaultKind = "subcontractor", defaultTrade }: {
  initial: TeamResource | null; resources: TeamResource[]; people: { id: string; name: string }[]; me: string | null; companyMode: boolean;
  onCancel: () => void; onSaved: (name: string, id: string) => void; compact?: boolean; defaultKind?: ResourceKind; defaultTrade?: string | null;
}) {
  const [kind, setKind] = useState<ResourceKind>(initial?.kind ?? defaultKind);
  const [name, setName] = useState(initial?.name ?? "");
  const [contactName, setContactName] = useState(initial?.contactName ?? "");
  const [linked, setLinked] = useState(initial?.linkedUserId ?? "");
  const [trades, setTrades] = useState<string[]>(initial?.trades ?? (defaultTrade ? [defaultTrade.toLowerCase()] : []));
  const [tradeInput, setTradeInput] = useState("");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [capacity, setCapacity] = useState(initial?.capacity ?? 1);
  const [members, setMembers] = useState<string[]>(initial?.members ?? []);
  const [unavailable, setUnavailable] = useState<string[]>(initial?.unavailable ?? []);
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const linkable = companyMode ? people : people.filter((p) => p.id === me);
  const memberChoices = resources.filter((r) => r.kind !== "crew" && r.status === "active" && r.id !== initial?.id);

  function addTrade(t: string) {
    const v = t.trim().toLowerCase().slice(0, 40);
    if (v && !trades.includes(v) && trades.length < 20) setTrades([...trades, v]);
    setTradeInput("");
  }
  async function save() {
    setBusy(true); setErr(null);
    const body = {
      ...(initial ? { id: initial.id } : {}), kind, name: name.trim(), contactName: contactName.trim() || null,
      linkedUserId: kind === "staff" && linked ? linked : null, trades, email: email.trim() || null, phone: phone.trim() || null,
      notes: notes.trim() || null, capacity, unavailable, ...(kind === "crew" ? { members } : {}),
    };
    const r = await api<{ id: string }>("/api/team", { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    onSaved(body.name, r.data.id);
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-paper p-4" data-testid="resource-form">
      <p className="font-semibold text-navy">{initial ? `Edit ${initial.name}` : compact ? "Quick add" : "Add to Team & Subcontractors"}</p>
      {!initial && (
        <fieldset className="flex flex-wrap gap-2"><legend className="label">Type</legend>
          {(["subcontractor", "crew", "staff"] as ResourceKind[]).map((k) => (
            <label key={k} className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold ${kind === k ? "border-accent-ink bg-surface text-navy" : "border-line text-ink-soft"}`}>
              <input type="radio" name="res-kind" className="sr-only" checked={kind === k} onChange={() => setKind(k)} data-testid={`kind-${k}`} />{KIND_LABEL[k]}
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">{kind === "subcontractor" ? "Company name" : kind === "crew" ? "Crew name" : "Name"}</span>
          <input className="field" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder={kind === "crew" ? "e.g. Crew A" : kind === "subcontractor" ? "e.g. Stone Works LLC" : "e.g. Alex Rivera"} data-testid="res-name" /></label>
        {kind !== "staff" && <label className="block"><span className="label">Contact person <span className="font-normal text-muted">(optional)</span></span>
          <input className="field" value={contactName} maxLength={200} onChange={(e) => setContactName(e.target.value)} /></label>}
        {kind === "staff" && linkable.length > 0 && <label className="block"><span className="label">Linked Built2Bid user <span className="font-normal text-muted">(optional)</span></span>
          <select className="field" value={linked} onChange={(e) => { setLinked(e.target.value); if (!name) setName(linkable.find((p) => p.id === e.target.value)?.name ?? ""); }} data-testid="res-link">
            <option value="">Not linked</option>{linkable.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === me ? " (you)" : ""}</option>)}
          </select>
          <span className="mt-1 block text-xs text-muted">Linked staff see their tasks in My Work. Linking never changes what they can access.</span></label>}
        <label className="block"><span className="label">Phone <span className="font-normal text-muted">(optional)</span></span>
          <input className="field" type="tel" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} data-testid="res-phone" /></label>
        <label className="block"><span className="label">Email <span className="font-normal text-muted">(optional)</span></span>
          <input className="field" type="email" value={email} maxLength={320} onChange={(e) => setEmail(e.target.value)} data-testid="res-email" /></label>
      </div>

      <div>
        <span className="label">Trades</span>
        <div className="flex flex-wrap gap-1.5">
          {trades.map((t) => <button key={t} type="button" onClick={() => setTrades(trades.filter((x) => x !== t))} className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-navy ring-1 ring-line" aria-label={`Remove ${tradeLabel(t)}`}>{tradeLabel(t)} ×</button>)}
          <input className="field h-8 w-40 py-0 text-sm" list="trade-list" value={tradeInput} placeholder="Add a trade" onChange={(e) => setTradeInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTrade(tradeInput); } }} onBlur={() => tradeInput && addTrade(tradeInput)} data-testid="res-trade" />
          <datalist id="trade-list">{COMMON_TRADES.map((t) => <option key={t} value={tradeLabel(t)} />)}</datalist>
        </div>
        <p className="mt-1 text-xs text-muted">Used to suggest the right people when you schedule a section of that trade.</p>
      </div>

      {kind === "crew" && (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <fieldset><legend className="label">Members <span className="font-normal text-muted">(used to catch double-bookings)</span></legend>
            {memberChoices.length === 0 ? <p className="text-sm text-muted">Add staff or subcontractors first to list crew members.</p> : (
              <div className="flex flex-wrap gap-1.5">{memberChoices.map((m) => (
                <label key={m.id} className={`flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-sm ${members.includes(m.id) ? "border-accent-ink bg-surface font-semibold text-navy" : "border-line text-ink-soft"}`}>
                  <input type="checkbox" checked={members.includes(m.id)} onChange={(e) => setMembers(e.target.checked ? [...members, m.id] : members.filter((x) => x !== m.id))} />{m.name}
                </label>))}</div>)}
          </fieldset>
          <label className="block w-36"><span className="label">Jobs at once</span>
            <input type="number" min={1} max={50} className="field" value={capacity} onChange={(e) => setCapacity(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} /></label>
        </div>
      )}

      {!compact && (
        <>
          <div>
            <span className="label">Days unavailable <span className="font-normal text-muted">(optional)</span></span>
            <div className="flex flex-wrap items-center gap-1.5">
              {unavailable.map((d) => <button key={d} type="button" onClick={() => setUnavailable(unavailable.filter((x) => x !== d))} className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold ring-1 ring-line">{d} ×</button>)}
              <input type="date" className="field h-8 w-40 py-0 text-sm" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Add an unavailable day" />
              <Button size="sm" variant="secondary" disabled={!isIsoDate(day)} onClick={() => { if (!unavailable.includes(day)) setUnavailable([...unavailable, day].sort()); setDay(""); }}>Add day</Button>
            </div>
          </div>
          <label className="block"><span className="label">Notes <span className="font-normal text-muted">(internal only)</span></span>
            <textarea className="field min-h-16" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></label>
        </>
      )}

      {err && <Notice tone="danger">{err}</Notice>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy || !name.trim()} data-testid="res-save">{busy ? "Saving…" : initial ? "Save changes" : "Add"}</Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
