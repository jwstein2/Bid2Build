"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { isIsoDate } from "@/lib/schedule/calendar";
import { tradeLabel } from "@/lib/projects/team";
import type { WfResource, Workforce } from "@/lib/workforce/model";
import { Drawer } from "./drawer";

const COMMON_TRADES = ["general", "demolition", "framing", "roofing", "siding", "windows", "drywall", "painting", "flooring", "tile", "cabinets", "countertops", "plumbing", "electrical", "hvac", "concrete", "decking", "gutters", "landscaping", "cleaning"];
type Type = "company" | "individual" | "worker" | "staff" | "crew";
const TYPES: { key: Type; label: string; hint: string }[] = [
  { key: "company", label: "Subcontracting company", hint: "A business you hire, like Red's Electric. Add its workers after." },
  { key: "individual", label: "Individual subcontractor", hint: "A one-person sub you hire directly." },
  { key: "worker", label: "Worker at a sub company", hint: "Someone who works for one of your subcontracting companies." },
  { key: "staff", label: "Employee", hint: "Your own staff. Linking to a team member doesn't add a seat." },
  { key: "crew", label: "Crew", hint: "A group you schedule together." },
];
const typeOf = (r: WfResource): Type => (r.kind === "staff" ? "staff" : r.kind === "crew" ? "crew" : r.parentId ? "worker" : r.entity === "individual" ? "individual" : "company");

/**
 * Add / edit a directory entry (the same pm_resources row PM Hub uses). Saving never creates a login,
 * an invitation or a paid seat.
 */
export function WorkforceForm({ wf, initial, people, open, onOpenChange, onSaved, presetParent }: {
  wf: Workforce; initial: WfResource | null; people: { id: string; name: string }[]; open: boolean; onOpenChange: (o: boolean) => void;
  onSaved: (name: string, id: string) => void; presetParent?: string | null;
}) {
  const [type, setType] = useState<Type>(initial ? typeOf(initial) : presetParent ? "worker" : "company");
  const [name, setName] = useState(initial?.name ?? "");
  const [contactName, setContactName] = useState(initial?.contactName ?? "");
  const [parentId, setParentId] = useState(initial?.parentId ?? presetParent ?? "");
  const [linked, setLinked] = useState(initial?.linkedUserId ?? "");
  const [trades, setTrades] = useState<string[]>(initial?.trades ?? []);
  const [tradeInput, setTradeInput] = useState("");
  const [specialties, setSpecialties] = useState((initial?.specialties ?? []).join(", "));
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [crewSize, setCrewSize] = useState(initial?.crewSize ? String(initial.crewSize) : "");
  const [capKnown, setCapKnown] = useState(initial?.capacityDeclared ?? false);
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? 1));
  const [members, setMembers] = useState<string[]>(initial?.members ?? []);
  const [unavailable, setUnavailable] = useState<string[]>(initial?.unavailable ?? []);
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const companies = wf.resources.filter((r) => r.kind === "subcontractor" && !r.parentId && r.entity !== "individual" && r.status === "active" && r.id !== initial?.id);
  const memberChoices = wf.resources.filter((r) => r.kind !== "crew" && r.status === "active" && r.id !== initial?.id);
  const hasWorkers = !!initial && wf.resources.some((r) => r.parentId === initial.id);
  const kind = type === "staff" ? "staff" : type === "crew" ? "crew" : "subcontractor";

  function addTrade(t: string) {
    const v = t.trim().toLowerCase().slice(0, 40);
    if (v && !trades.includes(v) && trades.length < 20) setTrades([...trades, v]);
    setTradeInput("");
  }
  async function save() {
    setBusy(true); setErr(null);
    const cap = Math.max(1, Math.min(50, Number(capacity) || 1));
    const body = {
      ...(initial ? { id: initial.id } : {}), kind, name: name.trim(), contactName: contactName.trim() || null,
      linkedUserId: type === "staff" && linked ? linked : null, trades, specialties: specialties.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20),
      email: email.trim() || null, phone: phone.trim() || null, notes: notes.trim() || null, unavailable,
      entity: type === "company" ? "company" : type === "individual" || type === "worker" ? "individual" : null,
      parentId: type === "worker" ? parentId || null : null,
      crewSize: crewSize.trim() ? Math.max(1, Math.min(500, Number(crewSize) || 1)) : null,
      ...(type === "company" || type === "crew" ? { capacity: capKnown || type === "crew" ? cap : 1, capacityDeclared: type === "crew" ? true : capKnown } : { capacity: 1 }),
      ...(type === "crew" ? { members } : {}),
    };
    if (type === "worker" && !body.parentId) { setBusy(false); setErr("Pick the company they work for."); return; }
    const r = await api<{ id: string }>("/api/team", { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    onSaved(body.name, r.data.id);
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={initial ? `Edit ${initial.name}` : "Add to Contractors & Workforce"} testId="wf-form">
      {!initial && (
        <fieldset><legend className="label">Type</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {TYPES.map((t) => (
              <label key={t.key} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${type === t.key ? "border-accent-ink bg-accent-tint" : "border-line"}`}>
                <input type="radio" name="wf-type" className="mt-1" checked={type === t.key} onChange={() => setType(t.key)} data-testid={`wf-type-${t.key}`} />
                <span><span className="font-semibold">{t.label}</span><span className="block text-xs text-ink-soft">{t.hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {initial && initial.kind === "subcontractor" && (
        <div><label className="label" htmlFor="wf-f-type">Type</label>
          <select id="wf-f-type" className="field" value={type} onChange={(e) => setType(e.target.value as Type)}>
            {TYPES.filter((t) => ["company", "individual", "worker"].includes(t.key)).map((t) => <option key={t.key} value={t.key} disabled={hasWorkers && t.key !== "company"}>{t.label}</option>)}
          </select>
          {hasWorkers && <p className="mt-1 text-xs text-muted">This company has workers listed, so it stays a company.</p>}</div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label" htmlFor="wf-f-name">{type === "company" ? "Company name" : type === "crew" ? "Crew name" : "Name"}</label>
          <input id="wf-f-name" className="field" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} data-testid="wf-f-name" /></div>
        {type === "worker" && (
          <div className="sm:col-span-2"><label className="label" htmlFor="wf-f-parent">Works for</label>
            <select id="wf-f-parent" className="field" value={parentId} onChange={(e) => setParentId(e.target.value)} data-testid="wf-f-parent">
              <option value="">Choose a company…</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {companies.length === 0 && <p className="mt-1 text-xs text-muted">Add the subcontracting company first.</p>}</div>
        )}
        {(type === "company" || type === "crew") && <div><label className="label" htmlFor="wf-f-contact">Main contact <span className="font-normal text-muted">(optional)</span></label>
          <input id="wf-f-contact" className="field" maxLength={200} value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>}
        {type === "staff" && (
          <div><label className="label" htmlFor="wf-f-link">Built2Bid team member <span className="font-normal text-muted">(optional)</span></label>
            <select id="wf-f-link" className="field" value={linked} onChange={(e) => setLinked(e.target.value)}>
              <option value="">Not linked</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">Only existing members are listed. Linking never invites anyone or adds a seat.</p></div>
        )}
        <div><label className="label" htmlFor="wf-f-phone">Phone</label><input id="wf-f-phone" className="field" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div><label className="label" htmlFor="wf-f-email">Email</label><input id="wf-f-email" className="field" type="email" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      </div>

      <div>
        <p className="label">Trades <span className="font-normal text-muted">(first one is the primary trade)</span></p>
        <div className="flex flex-wrap gap-1.5">
          {trades.map((t, i) => (
            <span key={t} className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-xs font-semibold ${i === 0 ? "bg-navy text-white" : "bg-paper text-ink-soft"}`}>
              {tradeLabel(t)}{i > 0 && <button type="button" className="rounded px-1 underline" onClick={() => setTrades([t, ...trades.filter((x) => x !== t)])} aria-label={`Make ${tradeLabel(t)} the primary trade`}>primary</button>}
              <button type="button" className="grid h-6 w-6 place-items-center rounded-full" onClick={() => setTrades(trades.filter((x) => x !== t))} aria-label={`Remove ${tradeLabel(t)}`}><X className="h-3.5 w-3.5" aria-hidden /></button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input className="field" list="wf-trade-list" placeholder="Add a trade" value={tradeInput} onChange={(e) => setTradeInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTrade(tradeInput); } }} data-testid="wf-f-trade" aria-label="Add a trade" />
          <datalist id="wf-trade-list">{COMMON_TRADES.map((t) => <option key={t} value={t} />)}</datalist>
          <Button size="sm" variant="secondary" onClick={() => addTrade(tradeInput)}>Add</Button>
        </div>
      </div>
      <div><label className="label" htmlFor="wf-f-spec">Specialties <span className="font-normal text-muted">(comma separated, optional)</span></label>
        <input id="wf-f-spec" className="field" placeholder="Panel upgrades, EV chargers" value={specialties} onChange={(e) => setSpecialties(e.target.value)} /></div>

      {(type === "company" || type === "crew") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="wf-f-size">Crew size (people) <span className="font-normal text-muted">(optional)</span></label>
            <input id="wf-f-size" className="field" inputMode="numeric" value={crewSize} onChange={(e) => setCrewSize(e.target.value.replace(/\D/g, ""))} /></div>
          <div>
            {type === "company" && <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={capKnown} onChange={(e) => setCapKnown(e.target.checked)} data-testid="wf-f-capknown" />I know how many jobs they can run at once</label>}
            {(type === "crew" || capKnown) && <><label className="label mt-1" htmlFor="wf-f-cap">Jobs at the same time</label>
              <input id="wf-f-cap" className="field" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ""))} data-testid="wf-f-cap" /></>}
            {type === "company" && !capKnown && <p className="mt-1 text-xs text-muted">Left unset, availability shows as unknown instead of guessing.</p>}
          </div>
        </div>
      )}
      {type === "crew" && (
        <fieldset><legend className="label">Members</legend>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {memberChoices.length === 0 && <p className="text-sm text-muted">Add employees or workers first.</p>}
            {memberChoices.map((m) => <label key={m.id} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={members.includes(m.id)} onChange={(e) => setMembers(e.target.checked ? [...members, m.id] : members.filter((x) => x !== m.id))} />{m.name}</label>)}
          </div></fieldset>
      )}
      <div>
        <p className="label">Days unavailable <span className="font-normal text-muted">(optional)</span></p>
        <div className="flex gap-2"><input type="date" className="field" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Unavailable day" />
          <Button size="sm" variant="secondary" onClick={() => { if (isIsoDate(day) && !unavailable.includes(day)) setUnavailable([...unavailable, day].sort()); setDay(""); }}>Add</Button></div>
        {unavailable.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{unavailable.map((d) => <button key={d} type="button" className="rounded-full bg-paper px-2 py-0.5 text-xs" onClick={() => setUnavailable(unavailable.filter((x) => x !== d))} aria-label={`Remove ${d}`}>{d} ×</button>)}</p>}
      </div>
      <div><label className="label" htmlFor="wf-f-notes">Notes <span className="font-normal text-muted">(internal; only managers see them)</span></label>
        <textarea id="wf-f-notes" className="field min-h-20" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      {err && <Notice tone="danger">{err}</Notice>}
      <p className="text-xs text-muted">Subcontractors and their workers don&apos;t need a Built2Bid account and never get one from this page. No seat is added.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="accent" disabled={busy || !name.trim()} onClick={save} data-testid="wf-f-save">{busy ? "Saving…" : "Save"}</Button>
      </div>
    </Drawer>
  );
}
