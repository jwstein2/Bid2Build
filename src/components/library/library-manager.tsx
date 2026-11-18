"use client";
import { Building2, ChevronRight, Layers, Pencil, Plus, Ruler, Search, Sparkles, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatCurrency } from "@/lib/estimate/money";
import { COST_TYPES, UNIT_ABBR, tradeName } from "@/lib/trades/catalog";
import { frequentItems, matchesQuery, organizeLibrary, type SavedItem, type SavedStack, type StackScale } from "@/lib/library/saved-items";
import { STARTER_ASSEMBLIES, perLabel, starterStack } from "@/lib/library/assemblies";
import { ScaleFields } from "./scale-stack";
import { useLibrary, type Library } from "../builder/library";
import { Button } from "../ui/button";
import { Card } from "../ui/misc";
import { LibraryLocked } from "./premium-lock";
import { SavedItemForm, blankSavedItem } from "./saved-item-form";

const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const typeLabel = (t: string) => COST_TYPES.find((c) => c.value === t)?.label ?? t;
export const rateLabel = (s: Pick<SavedItem, "unitCost" | "unit">) =>
  s.unitCost ? `${formatCurrency(s.unitCost)} / ${UNIT_ABBR[s.unit] ?? s.unit}` : `${UNIT_ABBR[s.unit] ?? s.unit} · no rate`;

/** Star toggle: favorites lead the builder's picker for quick add. */
export function FavoriteStar({ on, name, onToggle }: { on: boolean; name: string; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={on} aria-label={on ? `Remove ${name} from favorites` : `Add ${name} to favorites`} data-testid="fav-toggle"
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded md:min-h-9 md:min-w-9 ${on ? "text-warn" : "text-muted hover:text-warn"}`}>
      <Star className="h-4 w-4" fill={on ? "currentColor" : "none"} aria-hidden />
    </button>
  );
}

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
  if (!lib.access) return <div data-guide="items.locked"><LibraryLocked signedIn lockedCount={lib.lockedCount} /></div>;

  const filtered = lib.items.filter((i) => matchesQuery(i, q));
  const organized = organizeLibrary(filtered);
  const stacks = lib.stacks.filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const say = (m: string) => { setNotice(m); window.setTimeout(() => setNotice((x) => (x === m ? null : x)), 4000); };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1" data-guide="items.search">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="field pl-9" placeholder="Search saved items and stacks…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search saved items and stacks" />
        </div>
        <Button onClick={() => setEditing("new")} data-guide="items.add"><Plus className="h-4 w-4" aria-hidden /> New Saved Item</Button>
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

      {!q.trim() && frequentItems(lib.items).length > 0 && (
        <section aria-labelledby="frequent-h">
          <h2 id="frequent-h" className="mb-2 font-display text-xl font-bold text-navy">Frequently used</h2>
          <Card className="flex flex-wrap gap-2 p-3" data-testid="frequent-items">
            {frequentItems(lib.items).map((i) => (
              <button key={i.id} type="button" onClick={() => setEditing(i)} className="rounded-full border border-line px-3 py-1 text-left text-sm hover:border-brand/50">
                <span className="font-semibold">{i.name}</span> <span className="text-xs text-muted">{rateLabel(i)} · used {i.uses}×</span>
              </button>
            ))}
          </Card>
        </section>
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
        <p className="mb-2 text-sm text-ink-soft">A stack is a group of rows you add together. In an estimate, select rows with their checkboxes and choose <b>Save Stack</b>. Turn on scaling and its quantities follow a measurement, like roof squares or wall area.</p>
        {!lib.stacks.length ? (
          <Card className="p-6 text-center text-sm text-muted">No saved stacks yet.</Card>
        ) : !stacks.length ? (
          <Card className="p-6 text-center text-sm text-muted">No stacks match “{q}”.</Card>
        ) : (
          <Card><ul className="divide-y divide-line">{stacks.map((s) => <StackRow key={s.id} stack={s} lib={lib} say={say} onRemoved={() => say(`Deleted stack “${s.name}”.`)} />)}</ul></Card>
        )}
      </section>

      <section aria-labelledby="starters-h" data-testid="starter-assemblies">
        <h2 id="starters-h" className="mb-1 font-display text-xl font-bold text-navy">Starter assemblies</h2>
        <p className="mb-2 text-sm text-ink-soft">Ready-made scaling stacks with common starting ratios and no prices. Save one to your stacks, then set your rates and adjust the ratios to how you build.</p>
        <Card>
          <ul className="divide-y divide-line">
            {STARTER_ASSEMBLIES.map((x) => {
              const saved = lib.stacks.some((s) => s.starterKey === x.key && s.canEdit);
              return (
                <li key={x.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-medium"><Sparkles className="h-4 w-4 text-brand" aria-hidden />{x.name}<span className="text-xs font-normal text-muted">· {tradeName(x.trade ?? "")} · per {UNIT_ABBR[x.scale!.unit] ?? x.scale!.unit}</span></p>
                    <p className="text-xs text-muted">{x.summary}</p>
                  </div>
                  <Button size="sm" variant={saved ? "ghost" : "secondary"} disabled={saved} data-testid="starter-save"
                    onClick={async () => { const r = await lib.addStack(starterStack(x)); say(r.ok ? `Added “${x.name}” to your stacks. Set your rates on each row.` : r.message); }}>
                    {saved ? "In your stacks" : "Save to my stacks"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      </section>
      <TargetMargin initial={lib.targetMarginPct ?? ""} onSaved={(v) => say(v ? `Target margin set to ${v}%.` : "Target margin cleared.")} />
    </div>
  );
}

function ItemRow({ item: i, lib, onEdit, onRemoved }: { item: SavedItem; lib: Library; onEdit: () => void; onRemoved: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm" data-search-id={i.id}>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{i.name}{i.favorite && <Star className="ml-1 inline h-3.5 w-3.5 text-warn" fill="currentColor" aria-label="Favorite" />}</p>
        <p className="text-xs text-muted">{typeLabel(i.costType)}{i.quantity ? ` · default qty ${i.quantity}` : ""}{i.treatment === "pass_through" ? " · billed at cost" : ""}</p>
        {i.priceSource && i.priceSource !== "manual" && (
          <p className="text-xs text-muted" data-testid="item-price-source">
            Price from {i.supplierName ?? "supplier"}{i.supplierSku ? ` #${i.supplierSku}` : ""}{i.priceEffectiveOn ? ` · ${fmtDay(i.priceEffectiveOn)}` : ""}
          </p>
        )}
      </div>
      <span className="tabular font-semibold">{rateLabel(i)}</span>
      <span className="flex items-center">
        <FavoriteStar on={Boolean(i.favorite)} name={i.name} onToggle={() => void lib.toggleFavorite("item", i.id, !i.favorite)} />
        <button type="button" onClick={onEdit} className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm text-brand hover:bg-brand-tint md:min-h-9" aria-label={`Edit ${i.name}`}><Pencil className="h-4 w-4" aria-hidden />Edit</button>
        <ConfirmRemove name={i.name} onConfirm={async () => { const r = await lib.removeItem(i.id); if (r.ok) onRemoved(); }} />
      </span>
    </li>
  );
}

function StackRow({ stack: s, lib, say, onRemoved }: { stack: SavedStack; lib: Library; say: (m: string) => void; onRemoved: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [scaling, setScaling] = useState(false);
  const canEdit = s.canEdit !== false;
  const [name, setName] = useState(s.name);
  const [err, setErr] = useState<string | null>(null);
  return (
    <li className="px-4 py-2 text-sm" data-search-id={s.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {renaming ? (
          <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; const r = await lib.renameStack(s.id, name.trim()); if (r.ok) setRenaming(false); else setErr(r.message); }}>
            <input className="field field-sm min-w-0 flex-1" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} aria-label="Stack name" autoFocus />
            <Button size="sm" type="submit">Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setRenaming(false); setName(s.name); }}>Cancel</Button>
          </form>
        ) : (
          <details className="group min-w-0 basis-full">
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 font-medium [&::-webkit-details-marker]:hidden md:min-h-9">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
              <Layers className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 break-words">{s.name}</span>
              {s.company && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-semibold text-brand" data-testid="stack-company"><Building2 className="h-3 w-3" aria-hidden />Company</span>}
              {s.scale && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold text-ink-soft" data-testid="stack-scales"><Ruler className="h-3 w-3" aria-hidden />Scales by {s.scale.label.toLowerCase()}</span>}
              <span className="shrink-0 text-xs font-normal text-muted">{s.items.length} items{s.trade ? ` · ${tradeName(s.trade)}` : ""}</span>
            </summary>
            <ul className="mb-2 ml-6 mt-1 space-y-0.5 text-xs text-ink-soft">
              {s.items.map((i) => <li key={i.id} className="flex flex-wrap justify-between gap-x-3"><span className="min-w-0">{i.name} · {s.scale ? perLabel(i, s.scale) : `${i.quantity} ${UNIT_ABBR[i.unit] ?? i.unit}`} · {typeLabel(i.costType)}</span><span className="tabular whitespace-nowrap">{rateLabel(i)}</span></li>)}
            </ul>
          </details>
        )}
        {!renaming && (
          <span className="flex flex-wrap items-center">
            <FavoriteStar on={Boolean(s.favorite)} name={s.name} onToggle={() => void lib.toggleFavorite("stack", s.id, !s.favorite)} />
            {canEdit && <button type="button" onClick={() => setScaling(!scaling)} className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm text-brand hover:bg-brand-tint md:min-h-9" aria-expanded={scaling} data-testid="stack-scale-edit"><Ruler className="h-4 w-4" aria-hidden />Scaling</button>}
            {lib.canShare && canEdit && (
              <button type="button" data-testid="stack-share-toggle" onClick={async () => { const r = await lib.shareStack(s.id, !s.company); say(r.ok ? (s.company ? `“${s.name}” is private again.` : `Shared “${s.name}” with your company.`) : r.message); }}
                className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm text-brand hover:bg-brand-tint md:min-h-9"><Building2 className="h-4 w-4" aria-hidden />{s.company ? "Make private" : "Share with company"}</button>
            )}
          </span>
        )}
        {!renaming && canEdit && (
          <span className="flex items-center">
            <button type="button" onClick={() => setRenaming(true)} className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm text-brand hover:bg-brand-tint md:min-h-9" aria-label={`Rename ${s.name}`}><Pencil className="h-4 w-4" aria-hidden />Rename</button>
            <ConfirmRemove name={s.name} onConfirm={async () => { const r = await lib.removeStack(s.id); if (r.ok) onRemoved(); }} />
          </span>
        )}
      </div>
      {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
      {scaling && <ScaleEditor stack={s} onCancel={() => setScaling(false)} onSave={async (scale, items) => { const r = await lib.setStackScale(s.id, scale, items); if (r.ok) { setScaling(false); say(scale ? `“${s.name}” now scales by ${scale.label.toLowerCase()}.` : `“${s.name}” uses fixed quantities again.`); } else setErr(r.message); }} />}
    </li>
  );
}

type RowScale = { id: string; per?: string; wastePct?: string; roundUp?: boolean };

/** Turns scaling on or off for a stack, and sets each row's amount per unit, waste and round-up. */
function ScaleEditor({ stack, onSave, onCancel }: { stack: SavedStack; onSave: (scale: StackScale | null, items: RowScale[]) => Promise<void>; onCancel: () => void }) {
  const [scale, setScale] = useState<StackScale | null>(stack.scale ?? null);
  const [rows, setRows] = useState<RowScale[]>(stack.items.map((i) => ({ id: i.id, per: i.per ?? "", wastePct: i.wastePct ?? "", roundUp: Boolean(i.roundUp) })));
  const set = (id: string, patch: Partial<RowScale>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const bad = rows.some((r) => (r.per && !/^\d*(\.\d{0,6})?$/.test(r.per)) || (r.wastePct && !/^(\d{1,2}(\.\d{1,2})?|100)$/.test(r.wastePct)));
  const u = scale ? UNIT_ABBR[scale.unit] ?? scale.unit : "";
  return (
    <form className="mt-2 rounded-lg border border-line bg-paper p-3" data-testid="scale-editor" onSubmit={(e) => { e.preventDefault(); if (!bad && (!scale || scale.label.trim())) void onSave(scale, rows.map((r) => ({ ...r, per: r.per || undefined, wastePct: r.wastePct || undefined }))); }}>
      <ScaleFields value={scale} onChange={setScale} />
      {scale && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted">Amount per 1 {u}. Leave it blank to keep a row&apos;s fixed quantity (a dumpster, a permit).</p>
          {stack.items.map((i) => { const r = rows.find((x) => x.id === i.id)!; return (
            <div key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 basis-full sm:basis-0 sm:flex-1">{i.name} <span className="text-xs text-muted">({UNIT_ABBR[i.unit] ?? i.unit}{r.per ? "" : `, fixed ${i.quantity}`})</span></span>
              <input className="field field-sm w-24 tabular" inputMode="decimal" value={r.per} onChange={(e) => set(i.id, { per: e.target.value.trim() })} aria-label={`${i.name} per ${u}`} placeholder="fixed" data-testid="scale-per" />
              <span className="text-xs text-muted">per {u}</span>
              <input className="field field-sm w-16 tabular" inputMode="decimal" value={r.wastePct} onChange={(e) => set(i.id, { wastePct: e.target.value.trim() })} aria-label={`${i.name} waste percent`} placeholder="0" />
              <span className="text-xs text-muted">% waste</span>
              <label className="flex min-h-9 items-center gap-1 text-xs"><input type="checkbox" checked={Boolean(r.roundUp)} onChange={(e) => set(i.id, { roundUp: e.target.checked })} />Round up</label>
            </div>
          ); })}
        </div>
      )}
      {bad && <p role="alert" className="mt-2 text-xs text-danger">Use numbers only (waste 0 to 100).</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" type="submit" disabled={bad} data-testid="scale-save">Save scaling</Button>
      </div>
    </form>
  );
}

/** Company minimum gross margin. The builder warns below it (never blocks). Margin, not markup. */
function TargetMargin({ initial, onSaved }: { initial: string; onSaved: (v: string) => void }) {
  const [v, setV] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const save = async () => {
    setState("saving");
    try {
      const r = await fetch("/api/library/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "target_margin", percent: v.trim() }) });
      if (!r.ok) { setState("error"); return; }
      setState("idle"); onSaved(v.trim());
    } catch { setState("error"); }
  };
  const valid = /^(\d{1,2}(\.\d{1,2})?)?$/.test(v.trim());
  return (
    <section aria-labelledby="tm-h" data-testid="target-margin-setting">
      <h2 id="tm-h" className="mb-2 text-xl font-bold">Target margin</h2>
      <Card className="space-y-2 p-4">
        <p className="text-sm text-ink-soft">Your minimum gross margin. The bid builder shows a warning when a bid falls below it. It never stops you sending a bid.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="tm" className="label">Gross margin %</label>
            <div className="relative w-32">
              <input id="tm" inputMode="decimal" className="field tabular pr-8" value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. 25" aria-invalid={!valid} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={save} disabled={!valid || state === "saving"}>{state === "saving" ? "Saving…" : "Save"}</Button>
        </div>
        <p className="text-xs text-muted">Margin is profit as a percent of the price. A 25% margin takes a 33.3% markup on cost.{state === "error" ? " Couldn't save. Try again." : ""}</p>
      </Card>
    </section>
  );
}
