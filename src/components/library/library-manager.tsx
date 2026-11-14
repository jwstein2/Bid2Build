"use client";
import { ChevronRight, Layers, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatCurrency } from "@/lib/estimate/money";
import { COST_TYPES, UNIT_ABBR, tradeName } from "@/lib/trades/catalog";
import { matchesQuery, organizeLibrary, type SavedItem, type SavedStack } from "@/lib/library/saved-items";
import { useLibrary, type Library } from "../builder/library";
import { Button } from "../ui/button";
import { Card } from "../ui/misc";
import { LibraryLocked } from "./premium-lock";
import { SavedItemForm, blankSavedItem } from "./saved-item-form";

const typeLabel = (t: string) => COST_TYPES.find((c) => c.value === t)?.label ?? t;
export const rateLabel = (s: Pick<SavedItem, "unitCost" | "unit">) =>
  s.unitCost ? `${formatCurrency(s.unitCost)} / ${UNIT_ABBR[s.unit] ?? s.unit}` : `${UNIT_ABBR[s.unit] ?? s.unit} · no rate`;

/** Two-tap delete in place (same pattern as saved customers and the bid list). */
export function ConfirmRemove({ name, onConfirm, compact }: { name: string; onConfirm: () => Promise<unknown> | void; compact?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm text-danger hover:bg-danger-tint md:min-h-9" aria-label={`Delete ${name}`}>
        <Trash2 className="h-4 w-4" aria-hidden />{!compact && "Delete"}
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1 text-sm" role="group" aria-label={`Confirm deleting ${name}`}>
      <span className="mr-1 text-ink-soft">Delete?</span>
      <Button size="sm" variant="danger" autoFocus onClick={() => { setAsking(false); void onConfirm(); }}>Delete</Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
    </span>
  );
}

/** Dashboard "Saved Items & Pricing Library": organize, create, edit and delete saved items and stacks. */
export function LibraryManager() {
  const lib = useLibrary(true);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<SavedItem | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!lib.loaded) return <Card className="p-6 text-center text-muted">Loading your Saved Items…</Card>;
  if (!lib.access) return <LibraryLocked signedIn lockedCount={lib.lockedCount} />;

  const filtered = lib.items.filter((i) => matchesQuery(i, q));
  const organized = organizeLibrary(filtered);
  const stacks = lib.stacks.filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const say = (m: string) => { setNotice(m); window.setTimeout(() => setNotice((x) => (x === m ? null : x)), 4000); };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="field pl-9" placeholder="Search saved items and stacks…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search saved items and stacks" />
        </div>
        <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden /> New Saved Item</Button>
      </div>
      <p aria-live="polite" className="sr-only">{notice}</p>
      {notice && <p className="rounded-lg border border-ok/30 bg-ok-tint px-3 py-2 text-sm text-ok">{notice}</p>}

      {editing === "new" && (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 font-display text-lg font-bold">New Saved Item</h2>
          <SavedItemForm
            initial={blankSavedItem()}
            items={lib.items}
            onCancel={() => setEditing(null)}
            onSave={async (s) => { const r = await lib.addItem(s); if (r.ok) { setEditing(null); say(`Saved “${s.name}”.`); } return r; }}
          />
        </Card>
      )}

      <section aria-labelledby="saved-items-h">
        <h2 id="saved-items-h" className="mb-2 font-display text-xl font-bold text-navy">Saved Items</h2>
        {!lib.items.length ? (
          <Card className="p-6 text-center text-sm text-muted">
            No saved items yet. Add one here, or tap <b>⋯ → Save Item</b> on any row of an estimate.
          </Card>
        ) : !organized.length ? (
          <Card className="p-6 text-center text-sm text-muted">Nothing matches “{q}”.</Card>
        ) : (
          <div className="space-y-3">
            {organized.map((t) => (
              <Card key={t.trade ?? "general"} className="overflow-hidden">
                <details open className="group/trade">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 border-b border-line px-4 py-2 font-bold [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open/trade:rotate-90" aria-hidden />
                    {t.name}<span className="text-sm font-normal text-muted">({t.count})</span>
                  </summary>
                  {t.categories.map((c) => (
                    <details key={c.name} open className="group/cat border-b border-line last:border-b-0">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 bg-paper px-4 py-1.5 text-sm font-semibold text-ink-soft [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open/cat:rotate-90" aria-hidden />
                        {c.name}<span className="font-normal text-muted">({c.items.length})</span>
                      </summary>
                      <ul className="divide-y divide-line">
                        {c.items.map((i) => editing !== "new" && editing?.id === i.id ? (
                          <li key={i.id} className="p-4">
                            <SavedItemForm
                              initial={i}
                              items={lib.items}
                              submitLabel="Save changes"
                              onCancel={() => setEditing(null)}
                              onSave={async (s) => { const r = await lib.updateItem(s); if (r.ok) { setEditing(null); say(`Updated “${s.name}”.`); } return r; }}
                            />
                          </li>
                        ) : (
                          <ItemRow key={i.id} item={i} lib={lib} onEdit={() => setEditing(i)} onRemoved={() => say(`Deleted “${i.name}”. Estimates that already use it are unchanged.`)} />
                        ))}
                      </ul>
                    </details>
                  ))}
                </details>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="saved-stacks-h">
        <h2 id="saved-stacks-h" className="mb-1 font-display text-xl font-bold text-navy">Saved Stacks</h2>
        <p className="mb-2 text-sm text-ink-soft">A stack is a group of rows you add together. In an estimate, select rows with their checkboxes and choose <b>Save Stack</b>.</p>
        {!lib.stacks.length ? (
          <Card className="p-6 text-center text-sm text-muted">No saved stacks yet.</Card>
        ) : !stacks.length ? (
          <Card className="p-6 text-center text-sm text-muted">No stacks match “{q}”.</Card>
        ) : (
          <Card><ul className="divide-y divide-line">{stacks.map((s) => <StackRow key={s.id} stack={s} lib={lib} onRemoved={() => say(`Deleted stack “${s.name}”.`)} />)}</ul></Card>
        )}
      </section>
    </div>
  );
}

function ItemRow({ item: i, lib, onEdit, onRemoved }: { item: SavedItem; lib: Library; onEdit: () => void; onRemoved: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{i.name}</p>
        <p className="text-xs text-muted">{typeLabel(i.costType)}{i.quantity ? ` · default qty ${i.quantity}` : ""}{i.treatment === "pass_through" ? " · billed at cost" : ""}</p>
      </div>
      <span className="tabular font-semibold">{rateLabel(i)}</span>
      <span className="flex items-center">
        <button type="button" onClick={onEdit} className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm text-brand hover:bg-brand-tint md:min-h-9" aria-label={`Edit ${i.name}`}><Pencil className="h-4 w-4" aria-hidden />Edit</button>
        <ConfirmRemove name={i.name} onConfirm={async () => { const r = await lib.removeItem(i.id); if (r.ok) onRemoved(); }} />
      </span>
    </li>
  );
}

function StackRow({ stack: s, lib, onRemoved }: { stack: SavedStack; lib: Library; onRemoved: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(s.name);
  const [err, setErr] = useState<string | null>(null);
  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {renaming ? (
          <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; const r = await lib.renameStack(s.id, name.trim()); if (r.ok) setRenaming(false); else setErr(r.message); }}>
            <input className="field field-sm min-w-0 flex-1" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} aria-label="Stack name" autoFocus />
            <Button size="sm" type="submit">Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setRenaming(false); setName(s.name); }}>Cancel</Button>
          </form>
        ) : (
          <details className="group min-w-0 flex-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden md:min-h-9">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
              <Layers className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="truncate">{s.name}</span>
              <span className="shrink-0 text-xs font-normal text-muted">{s.items.length} items{s.trade ? ` · ${tradeName(s.trade)}` : ""}</span>
            </summary>
            <ul className="mb-2 ml-6 mt-1 space-y-0.5 text-xs text-ink-soft">
              {s.items.map((i) => <li key={i.id} className="flex justify-between gap-3"><span>{i.name} · {i.quantity} {UNIT_ABBR[i.unit] ?? i.unit} · {typeLabel(i.costType)}</span><span className="tabular">{rateLabel(i)}</span></li>)}
            </ul>
          </details>
        )}
        {!renaming && (
          <span className="flex items-center">
            <button type="button" onClick={() => setRenaming(true)} className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm text-brand hover:bg-brand-tint md:min-h-9" aria-label={`Rename ${s.name}`}><Pencil className="h-4 w-4" aria-hidden />Rename</button>
            <ConfirmRemove name={s.name} onConfirm={async () => { const r = await lib.removeStack(s.id); if (r.ok) onRemoved(); }} />
          </span>
        )}
      </div>
      {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
    </li>
  );
}
