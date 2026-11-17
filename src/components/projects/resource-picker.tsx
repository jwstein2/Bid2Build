"use client";
import { Check, ChevronDown, Loader2, Plus, Search, UserPlus, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { normalizeName, similarResources } from "../builder/sub-picker";
import { tradeLabel } from "@/lib/projects/team";
import { Button } from "../ui/button";
import { useDismiss } from "../ui/use-dismiss";

/** One Team & Subcontractors directory entry, as the project APIs return it. */
export interface DirectoryResource { id: string; name: string; kind: string; trades?: string[]; phone?: string | null; email?: string | null }
type Kind = "staff" | "crew" | "subcontractor";
const GROUPS: { kind: Kind; label: string; one: string }[] = [
  { kind: "staff", label: "Employees", one: "Employee" },
  { kind: "crew", label: "Crews", one: "Crew" },
  { kind: "subcontractor", label: "Subcontractors", one: "Subcontractor" },
];
const kindOf = (k: string): Kind => (k === "crew" || k === "subcontractor" ? k : "staff");

type Option =
  | { key: string; type: "resource"; r: DirectoryResource; group: string }
  | { key: string; type: "unassign" }
  | { key: string; type: "create"; name: string };

/**
 * Searchable "assign to" picker over the Team & Subcontractors directory (employees, crews and
 * subcontractors), used wherever project work is assigned. Picking assigns immediately; the result
 * (saving, saved, or the server's error) is always shown next to the control, never only inside a
 * collapsed panel. "Add new" creates a directory contact inline and assigns it. A directory contact is
 * not a software user and never uses a paid seat.
 */
export function ResourcePicker({ resources, value, onAssign, onCreated, canCreate = true, trade, label, disabled, testId = "resource-picker" }: {
  resources: DirectoryResource[]; value: string | null;
  /** Persist the choice (null = unassign). Resolve with an error message to show, or null on success. */
  onAssign: (id: string | null) => Promise<string | null>;
  onCreated?: (r: DirectoryResource) => void; canCreate?: boolean; trade?: string | null; label: string; disabled?: boolean; testId?: string;
}) {
  const current = resources.find((r) => r.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const [state, setState] = useState<{ k: "idle" } | { k: "saving" } | { k: "saved"; name: string | null } | { k: "error"; message: string }>({ k: "idle" });
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const close = () => { setOpen(false); setQuery(""); };
  useDismiss(open, close, { inside: [box], returnFocus: trigger });

  const options = useMemo<Option[]>(() => {
    const q = query.trim().toLowerCase();
    const hit = (r: DirectoryResource) => !q || r.name.toLowerCase().includes(q) || (r.trades ?? []).some((t) => t.toLowerCase().includes(q));
    const rank = (r: DirectoryResource) => (trade && (r.trades ?? []).includes(trade.toLowerCase()) ? 0 : 1);
    const out: Option[] = [];
    if (value && !q) out.push({ key: "__unassign", type: "unassign" });
    for (const g of GROUPS) {
      const list = resources.filter((r) => kindOf(r.kind) === g.kind && hit(r)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 50);
      out.push(...list.map((r) => ({ key: r.id, type: "resource" as const, r, group: g.label })));
    }
    if (canCreate && !resources.some((r) => normalizeName(r.name) === normalizeName(query))) out.push({ key: "__create", type: "create", name: query.trim() });
    return out;
  }, [query, resources, trade, value, canCreate]);

  const assign = async (rid: string | null, name: string | null) => {
    setState({ k: "saving" });
    const err = await onAssign(rid).catch(() => "We couldn't reach Built2Bid. Check your connection and try again.");
    setState(err ? { k: "error", message: err } : { k: "saved", name });
  };
  const choose = (o: Option) => {
    close();
    trigger.current?.focus();
    if (o.type === "create") { setCreating(o.name); return; }
    if (o.type === "unassign") { void assign(null, null); return; }
    if (o.r.id !== value) void assign(o.r.id, o.r.name);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && options[active]) { e.preventDefault(); choose(options[active]); }
    else if (e.key === "Tab") close();
  };
  const openList = () => {
    if (disabled || state.k === "saving") return;
    setOpen(true); setActive(0);
    requestAnimationFrame(() => search.current?.focus());
  };

  if (creating !== null) {
    return (
      <NewContactForm initialName={creating} trade={trade} resources={resources}
        onUseExisting={(r) => { setCreating(null); void assign(r.id, r.name); }}
        onCreated={(r) => { setCreating(null); onCreated?.(r); void assign(r.id, r.name); }}
        onCancel={() => { setCreating(null); requestAnimationFrame(() => trigger.current?.focus()); }} />
    );
  }

  let lastGroup = "";
  return (
    <div ref={box} className="relative w-full sm:w-56" data-testid={testId}>
      <button
        ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-label={`${label}: ${current?.name ?? "Unassigned"}`}
        disabled={disabled} onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); openList(); } }}
        className={cn("field field-sm flex min-h-11 w-full items-center justify-between gap-2 text-left md:min-h-9", !current && "text-ink-soft")}
        data-testid={`${testId}-trigger`}
      >
        <span className="truncate">{current ? current.name : "Unassigned"}</span>
        {state.k === "saving" ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
      </button>
      <p aria-live="polite" className="min-h-0 text-[11px]" data-testid={`${testId}-status`}>
        {state.k === "saving" && <span className="text-muted">Saving…</span>}
        {state.k === "saved" && <span className="text-ok">{state.name ? `Assigned to ${state.name}` : "Unassigned"}</span>}
        {state.k === "error" && <span role="alert" className="text-danger">{state.message}</span>}
      </p>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-1 shadow-xl">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              ref={search} type="text" role="combobox" aria-autocomplete="list" aria-expanded aria-controls={`${id}-list`} aria-label={`Search people for ${label}`}
              aria-activedescendant={options[active] ? `${id}-${active}` : undefined} autoComplete="off" enterKeyHint="search"
              className="field field-sm pl-8 text-base sm:text-sm" placeholder="Search employees, crews, subs…" value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey} data-testid={`${testId}-search`}
            />
          </div>
          <ul id={`${id}-list`} role="listbox" aria-label={label} className="mt-1 max-h-[min(18rem,50dvh)] overflow-y-auto overscroll-contain text-sm">
            {!resources.length && !query && <li role="presentation" className="px-2 py-1.5 text-xs text-muted">Your Team &amp; Subcontractors directory is empty. Add the first person below.</li>}
            {resources.length > 0 && query && !options.some((o) => o.type === "resource") && <li role="presentation" className="px-2 py-1.5 text-xs text-muted">No match in Team &amp; Subcontractors.</li>}
            {options.map((o, i) => {
              const head = o.type === "resource" && o.group !== lastGroup ? (lastGroup = o.group) : null;
              return (
                <li key={o.key} role="presentation">
                  {head && <p role="presentation" className="px-2 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">{head}</p>}
                  <div
                    id={`${id}-${i}`} role="option" aria-selected={o.type === "resource" ? o.r.id === value : o.type === "unassign" ? false : false}
                    onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)} onMouseMove={() => setActive(i)}
                    data-testid={o.type === "create" ? `${testId}-create` : o.type === "unassign" ? `${testId}-unassign` : `${testId}-option`}
                    className={cn("flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 md:min-h-9", i === active && "bg-paper",
                      o.type === "create" && "mt-1 border-t border-line font-semibold text-accent-ink", o.type === "unassign" && "text-ink-soft")}
                  >
                    {o.type === "resource" ? (
                      <>
                        <span className="flex min-w-0 items-center gap-1.5">
                          {o.r.id === value ? <Check className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden /> : <span className="w-3.5 shrink-0" />}
                          <span className="truncate">{o.r.name}</span>
                        </span>
                        {kindOf(o.r.kind) === "subcontractor" && (o.r.trades ?? []).length > 0 && <span className="shrink-0 truncate text-xs text-muted">{(o.r.trades ?? []).slice(0, 2).map(tradeLabel).join(", ")}</span>}
                      </>
                    ) : o.type === "unassign" ? (
                      <span className="flex items-center gap-1.5"><X className="h-3.5 w-3.5" aria-hidden /> Unassign</span>
                    ) : (
                      <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" aria-hidden />{o.name ? <>Add “{o.name}”</> : "Add new person, crew or sub"}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Inline "new directory contact" form: name and type required, phone/email optional. Look-alikes are offered first. */
function NewContactForm({ initialName, trade, resources, onUseExisting, onCreated, onCancel }: {
  initialName: string; trade?: string | null; resources: DirectoryResource[];
  onUseExisting: (r: DirectoryResource) => void; onCreated: (r: DirectoryResource) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<Kind>("subcontractor");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const dupes = similarResources(resources.map((r) => ({ id: r.id, name: r.name, kind: kindOf(r.kind), trades: r.trades ?? [] })), name).slice(0, 3);
  const exact = dupes.find((r) => normalizeName(r.name) === normalizeName(name));

  const save = async () => {
    if (busy || !name.trim() || exact) return;
    setBusy(true); setErr(null);
    const trades = kind === "subcontractor" && trade ? [trade.toLowerCase().slice(0, 40)] : [];
    try {
      const r = await fetch("/api/team", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name: name.trim(), email: email.trim() || null, phone: phone.trim() || null, trades }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(r.status === 403 ? "Your role can't add to Team & Subcontractors. Ask your company owner to add them." : d?.error?.message ?? "We couldn't add them. Please try again.");
        setBusy(false);
        return;
      }
      onCreated({ id: d.id as string, name: name.trim(), kind, trades, phone: phone.trim() || null, email: email.trim() || null });
    } catch {
      setErr("We couldn't reach Built2Bid. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div role="group" aria-labelledby={`${id}-h`} className="w-full rounded-lg border border-accent/40 bg-surface p-3" data-testid="new-contact-form"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      <p id={`${id}-h`} className="flex items-center gap-1.5 text-sm font-semibold text-navy"><UserPlus className="h-4 w-4" aria-hidden /> Add to Team &amp; Subcontractors</p>
      <p className="text-xs text-muted">A contact for assigning work. It isn&apos;t a software login and doesn&apos;t use a paid seat.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-ink-soft">Name
          <input className="field mt-0.5 text-base sm:text-sm" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoFocus required autoCapitalize="words" aria-invalid={!!exact} data-testid="new-contact-name" />
        </label>
        <fieldset className="text-xs font-semibold text-ink-soft">
          <legend>Type</legend>
          <div className="mt-0.5 grid grid-cols-3 gap-1 rounded-lg bg-paper p-1" role="radiogroup">
            {GROUPS.map((g) => (
              <button key={g.kind} type="button" role="radio" aria-checked={kind === g.kind} onClick={() => setKind(g.kind)}
                className={cn("min-h-9 rounded-md px-1 text-xs font-semibold", kind === g.kind ? "bg-navy text-white" : "text-ink-soft hover:bg-black/5")}>{g.one}</button>
            ))}
          </div>
        </fieldset>
        <label className="text-xs font-semibold text-ink-soft">Phone <span className="font-normal text-muted">(optional)</span>
          <input className="field mt-0.5 text-base sm:text-sm" type="tel" inputMode="tel" autoComplete="off" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="text-xs font-semibold text-ink-soft">Email <span className="font-normal text-muted">(optional)</span>
          <input className="field mt-0.5 text-base sm:text-sm" type="email" inputMode="email" autoComplete="off" value={email} maxLength={320} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      {dupes.length > 0 && (
        <div className="mt-2 rounded-md bg-warn-tint px-2 py-1.5 text-xs text-warn" role="status">
          {exact ? <>“{exact.name}” is already in your directory.</> : "Already in your directory?"}
          <span className="mt-1 flex flex-wrap gap-1.5">
            {dupes.map((r) => <button key={r.id} type="button" onClick={() => onUseExisting(r)} className="inline-flex min-h-8 items-center rounded-md border border-warn/40 bg-surface px-2 font-semibold text-ink hover:bg-paper">Assign {r.name}</button>)}
          </span>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-danger" role="alert">{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={() => void save()} disabled={busy || !name.trim() || !!exact} data-testid="new-contact-save">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Add &amp; assign
        </Button>
      </div>
    </div>
  );
}
