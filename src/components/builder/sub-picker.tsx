"use client";
import { Check, Loader2, Plus, Search, UserPlus, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { tradeLabel } from "@/lib/projects/team";
import { Button } from "../ui/button";
import { useDismiss } from "../ui/use-dismiss";
import type { TeamResource } from "./ops-context";

/** What the line item's quote is assigned to: a directory entry, a one-off typed name, or nothing yet. */
export type SubChoice = { resourceId: string; name: string } | { resourceId: null; name: string };

const MAX_SHOWN = 40;
/** "Ace Framing, LLC" and "ace framing" are the same company for duplicate checks. */
export function normalizeName(s: string) {
  return s.toLowerCase().replace(/&/g, " and ").replace(/\b(llc|l\.l\.c|inc|co|corp|company|ltd)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
/** Existing entries that look like the name being typed (exact, prefix or contained), best first. */
export function similarResources(resources: TeamResource[], name: string): TeamResource[] {
  const n = normalizeName(name);
  if (n.length < 2) return [];
  const scored = resources.map((r) => {
    const m = normalizeName(r.name);
    const score = m === n ? 0 : m.startsWith(n) || n.startsWith(m) ? 1 : m.includes(n) || (n.length >= 4 && n.includes(m) && m.length >= 4) ? 2 : 9;
    return { r, score };
  });
  return scored.filter((x) => x.score < 9).sort((a, b) => a.score - b.score || a.r.name.localeCompare(b.r.name)).map((x) => x.r);
}

type Option =
  | { key: string; type: "resource"; r: TeamResource; group: "Subcontractors" | "Staff & crews" }
  | { key: string; type: "create"; name: string };

/**
 * Searchable subcontractor picker for a line item's quote. Type to filter the real Team &
 * Subcontractors directory (name or trade), pick with mouse, touch or keyboard, or add a new
 * subcontractor inline without leaving the bid. Outside click / Escape close the list and keep the
 * committed choice; nothing on the line item is cleared by closing it.
 */
export function SubcontractorPicker({ resources, value, onChange, onCreated, trade, disabled }: {
  resources: TeamResource[]; value: SubChoice | null; onChange: (v: SubChoice | null) => void;
  onCreated: (r: TeamResource) => void; trade?: string | null; disabled?: boolean;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const close = () => {
    setOpen(false);
    // Closing without choosing: keep a committed directory pick as it was; free text stays as typed.
    if (value?.resourceId) setQuery(value.name);
  };
  useDismiss(open, close, { inside: [box], returnFocus: input });

  const options = useMemo<Option[]>(() => {
    const q = query.trim().toLowerCase();
    const showAll = !q || (value?.resourceId && value.name.toLowerCase() === q);
    const hit = (r: TeamResource) => showAll || r.name.toLowerCase().includes(q) || r.trades.some((t) => t.toLowerCase().includes(q));
    // Same-trade subcontractors first, then alphabetical.
    const rank = (r: TeamResource) => (trade && r.trades.includes(trade.toLowerCase()) ? 0 : 1);
    const sorted = [...resources].filter(hit).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const subs = sorted.filter((r) => r.kind === "subcontractor").slice(0, MAX_SHOWN);
    const others = sorted.filter((r) => r.kind !== "subcontractor").slice(0, MAX_SHOWN);
    const out: Option[] = [
      ...subs.map((r) => ({ key: r.id, type: "resource" as const, r, group: "Subcontractors" as const })),
      ...others.map((r) => ({ key: r.id, type: "resource" as const, r, group: "Staff & crews" as const })),
    ];
    const exact = resources.some((r) => normalizeName(r.name) === normalizeName(query));
    if (!showAll && !exact) out.push({ key: "__create", type: "create", name: query.trim() });
    if (showAll) out.push({ key: "__create", type: "create", name: "" });
    return out;
  }, [query, resources, trade, value]);

  const choose = (o: Option) => {
    if (o.type === "create") { setOpen(false); setCreating(o.name); return; }
    onChange({ resourceId: o.r.id, name: o.r.name });
    setQuery(o.r.name);
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open && options[active]) { e.preventDefault(); choose(options[active]); }
    else if (e.key === "Tab" && open) close();
  };
  const typed = (v: string) => {
    setQuery(v); setOpen(true); setActive(0);
    // Typing replaces a directory pick with free text until something is chosen.
    onChange(v.trim() ? { resourceId: null, name: v.trim() } : null);
  };
  const clear = () => { setQuery(""); onChange(null); setOpen(true); setActive(0); input.current?.focus(); };
  const freeText = !value?.resourceId && query.trim() !== "" && !open && creating === null;

  if (creating !== null) {
    return (
      <NewSubForm initialName={creating} trade={trade} resources={resources}
        onUseExisting={(r) => { onChange({ resourceId: r.id, name: r.name }); setQuery(r.name); setCreating(null); }}
        onCreated={(r) => { onCreated(r); onChange({ resourceId: r.id, name: r.name }); setQuery(r.name); setCreating(null); }}
        onCancel={() => { setCreating(null); requestAnimationFrame(() => input.current?.focus()); }} />
    );
  }

  let lastGroup = "";
  return (
    <div ref={box} className="relative" data-testid="sub-picker">
      <label htmlFor={`${listId}-in`} className="text-xs font-semibold text-ink-soft">Assigned subcontractor</label>
      <div className="relative mt-0.5">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          ref={input} id={`${listId}-in`} type="text" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${listId}-list`}
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          autoComplete="off" autoCapitalize="words" enterKeyHint="done" disabled={disabled}
          className={cn("field pl-8 pr-9 text-sm", value?.resourceId && "font-semibold")} placeholder="Search or enter a name…"
          value={query} onChange={(e) => typed(e.target.value)} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={onKey}
          data-testid="sub-picker-input"
        />
        {value?.resourceId && !open && <Check className="pointer-events-none absolute right-9 top-1/2 h-4 w-4 -translate-y-1/2 text-ok" aria-hidden />}
        {query && (
          <button type="button" onClick={clear} aria-label="Clear subcontractor" data-testid="sub-picker-clear"
            className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-muted hover:bg-black/5 hover:text-ink">
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <ul id={`${listId}-list`} role="listbox" aria-label="Subcontractors and team"
          className="absolute inset-x-0 z-30 mt-1 max-h-[min(18rem,50dvh)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-1 text-sm shadow-xl" data-testid="sub-picker-list">
          {options.length === 1 && options[0].type === "create" && query.trim() && (
            <li role="presentation" className="px-2 py-1.5 text-xs text-muted">No match in Team &amp; Subcontractors.</li>
          )}
          {options.map((o, i) => {
            const head = o.type === "resource" && o.group !== lastGroup ? (lastGroup = o.group) : null;
            return (
              <li key={o.key} role="presentation">
                {head && <p role="presentation" className="px-2 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">{head}</p>}
                <div
                  id={`${listId}-${i}`} role="option" aria-selected={o.type === "resource" && value?.resourceId === o.r.id}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)} onMouseMove={() => setActive(i)}
                  data-testid={o.type === "create" ? "sub-picker-create" : "sub-picker-option"}
                  className={cn("flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 md:min-h-9", i === active && "bg-paper",
                    o.type === "create" && "mt-1 border-t border-line font-semibold text-accent-ink")}
                >
                  {o.type === "resource" ? (
                    <>
                      <span className="flex min-w-0 items-center gap-1.5">
                        {value?.resourceId === o.r.id ? <Check className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden /> : <span className="w-3.5 shrink-0" />}
                        <span className="truncate">{o.r.name}</span>
                      </span>
                      <span className="shrink-0 truncate text-xs text-muted">{o.r.kind !== "subcontractor" ? (o.r.kind === "crew" ? "Crew" : "Staff") : o.r.trades.slice(0, 2).map(tradeLabel).join(", ")}</span>
                    </>
                  ) : (
                    <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" aria-hidden />{o.name ? <>Add “{o.name}” as a new subcontractor</> : "Add new subcontractor"}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {freeText && (
        <p className="mt-1 text-xs text-muted" data-testid="sub-picker-freetext">
          “{query.trim()}” will be saved on this quote only.{" "}
          <button type="button" className="font-semibold text-accent-ink underline" onClick={() => setCreating(query.trim())} data-testid="sub-picker-add-free">Add to Team &amp; Subcontractors</button> to reuse it.
        </p>
      )}
    </div>
  );
}

/**
 * Compact inline "new subcontractor" form. Only the name is required. Look-alike names already in
 * the directory are offered first so the same company isn't added twice. Saves to Team &
 * Subcontractors for the signed-in account's company (the server decides the company).
 */
function NewSubForm({ initialName, trade, resources, onUseExisting, onCreated, onCancel }: {
  initialName: string; trade?: string | null; resources: TeamResource[];
  onUseExisting: (r: TeamResource) => void; onCreated: (r: TeamResource) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tradeText, setTradeText] = useState(() => (trade ? tradeLabel(trade) : ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const id = useId();
  const dupes = similarResources(resources, name).slice(0, 3);
  const exact = dupes.find((r) => normalizeName(r.name) === normalizeName(name));
  const initialTrade = trade ? tradeLabel(trade) : "";
  const dirty = name.trim() !== initialName.trim() || tradeText.trim() !== initialTrade || !!contact.trim() || !!email.trim() || !!phone.trim();
  const cancel = () => { if (dirty && !confirmDiscard) setConfirmDiscard(true); else onCancel(); };

  const save = async () => {
    if (busy || !name.trim() || exact) return;
    setBusy(true); setErr(null);
    const trades = tradeText.trim() ? [tradeText.trim().toLowerCase().slice(0, 40)] : [];
    try {
      const r = await fetch("/api/team", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "subcontractor", name: name.trim(), contactName: contact.trim() || null, email: email.trim() || null, phone: phone.trim() || null, trades }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(r.status === 403 ? "Your role can't add to Team & Subcontractors. Ask your company owner, or cancel and type the name to use it on this quote only."
          : d?.error?.message ?? "We couldn't add that subcontractor. Please try again.");
        setBusy(false);
        return;
      }
      onCreated({ id: d.id as string, name: name.trim(), kind: "subcontractor", trades });
    } catch {
      setErr("We couldn't reach Built2Bid. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div
      role="group" aria-labelledby={`${id}-h`} className="rounded-lg border border-accent/40 bg-surface p-3 sm:col-span-2" data-testid="new-sub-form"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); } }}
    >
      <p id={`${id}-h`} className="flex items-center gap-1.5 text-sm font-semibold text-navy"><UserPlus className="h-4 w-4" aria-hidden /> New subcontractor</p>
      <p className="text-xs text-muted">Saved to Team &amp; Subcontractors so you can pick it on any bid. Only the name is required.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-ink-soft">Company or name
          <input className="field mt-0.5 text-sm" value={name} maxLength={200} onChange={(e) => { setName(e.target.value); setConfirmDiscard(false); }} autoFocus required
            autoComplete="organization" autoCapitalize="words" aria-invalid={!!exact} data-testid="new-sub-name" />
        </label>
        <label className="text-xs font-semibold text-ink-soft">Trade <span className="font-normal text-muted">(optional)</span>
          <input className="field mt-0.5 text-sm" value={tradeText} maxLength={40} onChange={(e) => setTradeText(e.target.value)} placeholder="e.g. Framing" data-testid="new-sub-trade" />
        </label>
        <label className="text-xs font-semibold text-ink-soft">Contact person <span className="font-normal text-muted">(optional)</span>
          <input className="field mt-0.5 text-sm" value={contact} maxLength={200} onChange={(e) => setContact(e.target.value)} autoComplete="name" />
        </label>
        <label className="text-xs font-semibold text-ink-soft">Phone <span className="font-normal text-muted">(optional)</span>
          <input className="field mt-0.5 text-sm" type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="text-xs font-semibold text-ink-soft sm:col-span-2">Email <span className="font-normal text-muted">(optional)</span>
          <input className="field mt-0.5 text-sm" type="email" inputMode="email" autoComplete="email" value={email} maxLength={320} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      {dupes.length > 0 && (
        <div className="mt-2 rounded-md bg-warn-tint px-2 py-1.5 text-xs text-warn" data-testid="new-sub-dupes" role="status">
          {exact ? <>“{exact.name}” is already in your list.</> : "Already in your list?"}
          <span className="mt-1 flex flex-wrap gap-1.5">
            {dupes.map((r) => (
              <button key={r.id} type="button" onClick={() => onUseExisting(r)} data-testid="new-sub-use-existing"
                className="inline-flex min-h-8 items-center gap-1 rounded-md border border-warn/40 bg-surface px-2 font-semibold text-ink hover:bg-paper">
                Use {r.name}
              </button>
            ))}
          </span>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-danger" role="alert">{err}</p>}
      {confirmDiscard ? (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2" role="alert" data-testid="new-sub-discard">
          <span className="text-xs text-ink-soft">Discard this new subcontractor?</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(false)}>Keep editing</Button>
          <Button size="sm" variant="secondary" onClick={onCancel} data-testid="new-sub-discard-yes">Discard</Button>
        </div>
      ) : (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => void save()} disabled={busy || !name.trim() || !!exact} data-testid="new-sub-save">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Add &amp; assign
          </Button>
        </div>
      )}
    </div>
  );
}
