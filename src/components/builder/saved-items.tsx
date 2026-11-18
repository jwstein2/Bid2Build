"use client";
import { Building2, Check, Layers, Lock, Pencil, Plus, Ruler, Search, Sparkles, Star } from "lucide-react";
import { useEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import type { Estimate, EstimateGroup, LineItem } from "@/lib/estimate/types";
import { UNIT_ABBR, getTrade, parseTemplateItem, type TemplateItem } from "@/lib/trades/catalog";
import { sectionTrade } from "@/lib/estimate/trades";
import { FREE_ITEMS_KEPT_NOTE, frequentItems, lineContext, lineFromSaved, matchesQuery, type SavedItem, type SavedStack, type StackItem, type StackScale } from "@/lib/library/saved-items";
import { startersFor, starterStack } from "@/lib/library/assemblies";
import { cn } from "@/lib/cn";
import { useDismiss } from "@/components/ui/use-dismiss";
import { Button } from "../ui/button";
import { Modal } from "./dialogs";
import type { Action } from "./state";
import type { Library } from "./library";
import { LibraryUpgradeDialog } from "../library/premium-lock";
import { SavedItemForm } from "../library/saved-item-form";
import { ConfirmRemove, rateLabel } from "../library/library-manager";
import { ScaleFields, ScaleStackForm, isValidMeasure } from "../library/scale-stack";

/**
 * Builder-side Saved Items actions: Save Item (one row), Save Stack (selected rows), edit/delete from
 * the picker, and the premium upsell for free accounts. Returns the dialogs to render once.
 */
export function useSavedItemsUi(lib: Library, estimate: Estimate) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [stackRows, setStackRows] = useState<LineItem[] | null>(null);
  const [stackName, setStackName] = useState("");
  const [stackErr, setStackErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedItem | null>(null);
  const [stackScale, setStackScale] = useState<StackScale | null>(null);
  const [stackMeasure, setStackMeasure] = useState("");
  const [stackShare, setStackShare] = useState(false);
  const [scaling, setScaling] = useState<{ stack: SavedStack; starter: boolean; apply: (rows: (StackItem & { quantity: string })[]) => void } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const say = (m: string) => {
    setNotice(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 3500);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const groupOf = (it: LineItem) => estimate.groups.find((g) => g.id === it.groupId);

  const saveItem = async (it: LineItem) => {
    if (!lib.access && !lib.itemsAccess) { setUpgradeOpen(true); return; }
    if (!it.name.trim()) { say("Give the item a name before saving it."); return; }
    const r = await lib.saveLine(it, lineContext(estimate, groupOf(it)));
    // Free plan: say once per save that the item comes along on an upgrade (James, V8 batch 5).
    const kept = lib.access ? "" : ` ${FREE_ITEMS_KEPT_NOTE}`;
    if (r.ok) say(r.updated ? `Updated “${it.name.trim()}” in Saved Items.${kept}` : `Saved “${it.name.trim()}” to Saved Items.${kept}`);
    else if (r.code === "premium_required") setUpgradeOpen(true);
    else say(r.message);
  };

  /** Opens the name dialog; returns false (and shows the upsell) for accounts without access. */
  const saveStack = (rows: LineItem[]): boolean => {
    if (!lib.access) { setUpgradeOpen(true); return false; }
    setStackRows(rows.filter((r) => !r.isExample));
    setStackName(""); setStackErr(null); setStackScale(null); setStackMeasure(""); setStackShare(false);
    return true;
  };

  const confirmStack = async () => {
    if (!stackRows || !stackName.trim()) return;
    const tradesUsed = [...new Set(stackRows.map((r) => { const g = groupOf(r); return g ? sectionTrade(estimate, g) : estimate.trades[0]; }))];
    if (stackScale && (!stackScale.label.trim() || !isValidMeasure(stackMeasure))) { setStackErr("Enter what these quantities were measured for, or turn scaling off."); return; }
    const r = await lib.saveStack(stackName, stackRows, tradesUsed.length === 1 ? tradesUsed[0] || null : null, { scale: stackScale, measure: stackMeasure, company: stackShare });
    if (r.ok) { say(`Saved stack “${stackName.trim()}” (${stackRows.length} items).`); setStackRows(null); }
    else if (r.code === "premium_required") { setStackRows(null); setUpgradeOpen(true); }
    else setStackErr(r.message);
  };

  /** Adds a stack's rows to a section. A scaling stack first asks for the measure. */
  const addStack = (stack: SavedStack, groupId: string, dispatch: Dispatch<Action>, starter = false) => {
    const apply = (rows: (StackItem & { quantity: string })[]) => {
      dispatch({ type: "addItems", groupId, items: rows.map((i) => ({ ...lineFromSaved(i), quantity: i.quantity || "1" })) });
      say(`Added ${starter ? "starter assembly" : "stack"} “${stack.name}”.`);
    };
    if (stack.scale) setScaling({ stack, starter, apply });
    else apply(stack.items);
  };

  const dialogs: ReactNode = (
    <>
      <p aria-live="polite" className="sr-only">{notice}</p>
      {notice && (
        <div className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] max-lg:bottom-[calc(6rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-lg bg-navy px-4 py-3 text-sm font-medium text-white shadow-xl" role="status">
          {notice}
        </div>
      )}
      <LibraryUpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} signedIn={lib.signedIn} lockedCount={lib.lockedCount} itemsFree={Boolean(lib.itemsAccess) && !lib.access} />
      <Modal open={stackRows !== null} onOpenChange={(o) => !o && setStackRows(null)} title="Save Stack" description={`Save these ${stackRows?.length ?? 0} rows, with their quantities and rates, to reuse together on future bids.`}>
        <form onSubmit={(e) => { e.preventDefault(); void confirmStack(); }}>
          <label className="label" htmlFor="stack-name">Stack name</label>
          <input id="stack-name" className="field" value={stackName} maxLength={200} onChange={(e) => setStackName(e.target.value)} placeholder="e.g. Standard tear-off package" autoFocus autoComplete="off" />
          <ScaleFields value={stackScale} onChange={setStackScale} measure={stackMeasure} onMeasure={setStackMeasure} />
          {lib.canShare && (
            <label className="mt-3 flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={stackShare} onChange={(e) => setStackShare(e.target.checked)} data-testid="stack-share" />
              <Building2 className="h-4 w-4 text-brand" aria-hidden /> Share with my company as a template
            </label>
          )}
          {stackErr && <p role="alert" className="mt-2 text-sm text-danger">{stackErr}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStackRows(null)}>Cancel</Button>
            <Button type="submit" disabled={!stackName.trim()}>Save Stack</Button>
          </div>
        </form>
      </Modal>
      <Modal open={scaling !== null} onOpenChange={(o) => !o && setScaling(null)} title={`Add ${scaling?.stack.name ?? "assembly"}`} description={scaling ? `Quantities scale with the ${scaling.stack.scale?.label.toLowerCase()}. Rows are copied in; you can still edit them.` : undefined} wide>
        {scaling && <ScaleStackForm stack={scaling.stack} estimate={estimate} starter={scaling.starter} onCancel={() => setScaling(null)} onAdd={(rows) => { scaling.apply(rows); setScaling(null); }} />}
      </Modal>
      <Modal open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title="Edit Saved Item" description="Changes apply to items you add from now on. Rows already in estimates keep their values." wide>
        {editing && (
          <SavedItemForm
            initial={editing}
            items={lib.items}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSave={async (s) => { const r = await lib.updateItem(s); if (r.ok) { setEditing(null); say(`Updated “${s.name}”.`); } return r; }}
          />
        )}
      </Modal>
    </>
  );

  return { ...lib, saveItem, saveStack, addStackTo: addStack, editItem: setEditing, upgrade: () => setUpgradeOpen(true), say, dialogs };
}

export type SavedItemsUi = ReturnType<typeof useSavedItemsUi>;

/** Saved items for a section: same trade first, then the same category as the section, then by name. */
function rankFor(items: SavedItem[], trade: string, section: string): SavedItem[] {
  const sec = section.trim().toLowerCase();
  const score = (i: SavedItem) => (i.trade === trade ? 0 : i.trade ? 2 : 1) * 2 + ((i.category ?? "").trim().toLowerCase() === sec ? 0 : 1);
  return [...items].sort((a, b) => score(a) - score(b) || (b.uses ?? 0) - (a.uses ?? 0) || a.name.localeCompare(b.name));
}

/** "Suggested & Saved Items" picker under each section: Saved Stacks, Saved Items (premium) and Suggested Items. */
export function SavedItemsPicker({ group, estimate, suggestions, lib, dispatch }: { group: EstimateGroup; estimate: Estimate; suggestions: TemplateItem[]; lib: SavedItemsUi; dispatch: Dispatch<Action> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Multi-select: stays open while picking; Done, an outside click or Escape closes it.
  useDismiss(open, () => setOpen(false), { inside: [ref], returnFocus: trigger });
  const s = q.trim().toLowerCase();
  // Items already in this section stay listed with an "Added" mark (instead of vanishing) and can't be added twice by accident.
  const inSection = new Set(estimate.items.filter((i) => i.groupId === group.id).map((i) => i.name.trim().toLowerCase()));
  const has = (name: string) => inSection.has(name.trim().toLowerCase());
  const trade = sectionTrade(estimate, group);
  const sug = suggestions.filter((x) => !s || x.name.toLowerCase().includes(s)).slice(0, 20);
  const frequent = s ? [] : frequentItems(lib.items.filter((x) => !x.trade || x.trade === trade), 5);
  const favItems = s ? [] : lib.items.filter((x) => x.favorite);
  const favStacks = s ? [] : lib.stacks.filter((x) => x.favorite);
  const saved = rankFor(lib.items.filter((x) => matchesQuery(x, q) && !frequent.includes(x) && !favItems.includes(x)), trade, group.name).slice(0, s ? 30 : 12);
  const stacks = lib.stacks.filter((x) => (s ? x.name.toLowerCase().includes(s) : !x.favorite)).slice(0, 8);
  const starters = startersFor(trade).filter((x) => (s ? x.name.toLowerCase().includes(s) : x.trade === trade)).slice(0, 3);
  const pickStack = (a: SavedStack, starter = false) => { setOpen(false); lib.addStackTo(a, group.id, dispatch, starter); };
  // Favorites and stacks are Unlimited; free accounts see their Saved Items without stars.
  const star = (kind: "item" | "stack", id: string, name: string, on: boolean) => !lib.access ? null : (
    <button type="button" onClick={() => void lib.toggleFavorite(kind, id, !on)} aria-pressed={on} aria-label={on ? `Remove ${name} from favorites` : `Add ${name} to favorites`} data-testid="fav-toggle"
      className={cn("grid h-10 w-9 shrink-0 place-items-center rounded hover:bg-paper md:h-8 md:w-8", on ? "text-warn" : "text-muted hover:text-warn")}>
      <Star className="h-3.5 w-3.5" fill={on ? "currentColor" : "none"} aria-hidden />
    </button>
  );
  const stackRow = (a: SavedStack) => (
    <div key={a.id} className="flex items-center gap-1">
      <button type="button" className="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-paper md:min-h-8" onClick={() => pickStack(a)} data-testid="pick-stack">
        <span className="flex min-w-0 items-center gap-1.5">{a.scale ? <Ruler className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden /> : <Layers className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />}<span className="truncate">{a.name}</span>{a.company && <Building2 className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Company template" />}</span>
        <span className="shrink-0 text-xs text-muted">{a.scale ? `per ${UNIT_ABBR[a.scale.unit] ?? a.scale.unit}` : `${a.items.length} items`}</span>
      </button>
      {star("stack", a.id, a.name, Boolean(a.favorite))}
    </div>
  );
  const custom = s && ![...sug, ...saved].some((x) => x.name.toLowerCase() === s) ? parseTemplateItem(q.trim()) : null;
  const heading = "px-2 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted";

  return (
    <div className="relative" ref={ref}>
      <Button ref={trigger} size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open} className="max-md:min-h-11" data-guide="builder.saved-items"><Search className="h-4 w-4" /> Suggested &amp; Saved Items</Button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-[360px] max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-2 shadow-xl">
          <div className="flex items-center gap-2">
            <input autoFocus className="field field-sm min-w-0 flex-1" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search suggested and saved items" />
            <Button size="sm" variant="secondary" onClick={() => { setOpen(false); trigger.current?.focus(); }}>Done</Button>
          </div>
          <p className="mt-1 px-1 text-[11px] text-muted">Pick as many as you need. Added items show a check.</p>
          <div className="mt-1 max-h-[min(22rem,60dvh)] overflow-y-auto overscroll-contain text-sm">
            {lib.access || lib.itemsAccess ? (
              <>
                {(favStacks.length > 0 || favItems.length > 0) && <p className={heading} data-testid="picker-favorites">Favorites</p>}
                {favStacks.map(stackRow)}
                {favItems.map((f) => (
                  <div key={`fav-${f.id}`} className="flex items-center gap-1">
                    <div className="min-w-0 flex-1"><PickRow name={f.name} added={has(f.name)} meta={rateLabel(f)} onPick={() => dispatch({ type: "addItem", groupId: group.id, from: lineFromSaved(f) })} /></div>
                    {star("item", f.id, f.name, true)}
                  </div>
                ))}
                {stacks.length > 0 && <p className={heading}>Saved Stacks</p>}
                {stacks.map(stackRow)}
                {lib.access && starters.length > 0 && <p className={heading}>Starter assemblies</p>}
                {lib.access && starters.map((x) => (
                  <button key={x.key} type="button" className="flex min-h-10 w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-paper md:min-h-8" onClick={() => pickStack(starterStack(x), true)} data-testid="pick-starter">
                    <span className="flex min-w-0 items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden /><span className="truncate">{x.name}</span></span>
                    <span className="shrink-0 text-xs text-muted">per {UNIT_ABBR[x.scale!.unit] ?? x.scale!.unit} · no prices</span>
                  </button>
                ))}
                {frequent.length > 0 && <p className={heading}>Frequently used</p>}
                {frequent.map((f) => <PickRow key={`fq-${f.id}`} name={f.name} added={has(f.name)} meta={`${rateLabel(f)} · used ${f.uses}×`} onPick={() => dispatch({ type: "addItem", groupId: group.id, from: lineFromSaved(f) })} />)}
                <p className={heading}>Saved Items</p>
                {!saved.length && !frequent.length && <p className="px-2 py-1.5 text-xs text-muted">{lib.items.length ? "No saved items match." : "None yet. Use ⋯ → Save Item on any row."}</p>}
                {saved.map((f) => (
                  <div key={f.id} className="group/saved flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <PickRow name={f.name} added={has(f.name)} meta={rateLabel(f)} onPick={() => dispatch({ type: "addItem", groupId: group.id, from: lineFromSaved(f) })} />
                    </div>
                    {star("item", f.id, f.name, Boolean(f.favorite))}
                    <button type="button" onClick={() => { setOpen(false); lib.editItem(f); }} className="grid h-10 w-9 shrink-0 place-items-center rounded text-muted hover:bg-paper hover:text-brand md:h-8 md:w-8" aria-label={`Edit saved item ${f.name}`}><Pencil className="h-3.5 w-3.5" aria-hidden /></button>
                    <ConfirmRemove compact name={`saved item ${f.name}`} onConfirm={async () => { const r = await lib.removeItem(f.id); lib.say(r.ok ? `Deleted “${f.name}” from Saved Items.` : r.message); }} />
                  </div>
                ))}
                {!lib.access && (
                  <button type="button" onClick={() => { setOpen(false); lib.upgrade(); }} className="mt-2 flex w-full items-start gap-2 rounded-md border border-dashed border-line-strong px-2 py-2 text-left hover:bg-paper" data-testid="picker-stacks-locked">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-navy" aria-hidden />
                    <span><span className="block text-xs font-bold uppercase tracking-wider text-muted">Saved Stacks and favorites · Unlimited</span><span className="block text-xs text-ink-soft">{FREE_ITEMS_KEPT_NOTE} <span className="font-semibold text-navy underline">See Unlimited</span></span></span>
                  </button>
                )}
              </>
            ) : (
              <button type="button" onClick={() => { setOpen(false); lib.upgrade(); }} className="mt-1 flex w-full items-start gap-2 rounded-md border border-dashed border-line-strong px-2 py-2 text-left hover:bg-paper">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-ink" aria-hidden />
                <span><span className="block text-xs font-bold uppercase tracking-wider text-muted">Saved Items · Premium</span><span className="block text-xs text-ink-soft">Save your own rates and items to reuse on every bid. <span className="font-semibold text-accent-ink">Upgrade to Unlimited</span></span></span>
              </button>
            )}
            {sug.length > 0 && <p className={heading}>Suggested Items · {estimate.trades.map((t) => getTrade(t)?.name ?? t).join(", ")}</p>}
            {sug.map((x) => (
              <PickRow key={x.name} name={x.name} added={has(x.name)} meta={`${UNIT_ABBR[x.unit] ?? x.unit} · no price`} onPick={() => dispatch({ type: "addItem", groupId: group.id, from: x })} />
            ))}
            {custom && (
              <button className="w-full rounded px-2 py-2 text-left font-medium text-brand hover:bg-paper" onClick={() => { dispatch({ type: "addItem", groupId: group.id, from: { name: q.trim() } }); setQ(""); }}>
                <Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />Add custom item “{q.trim()}”
              </button>
            )}
            {!stacks.length && !saved.length && !sug.length && !custom && s && <p className="px-2 py-3 text-muted">Nothing found.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function PickRow({ name, meta, added, onPick }: { name: string; meta: string; added: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      disabled={added}
      onClick={onPick}
      aria-label={added ? `${name}, already added to this section` : `Add ${name}`}
      className={cn("flex min-h-10 w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left md:min-h-8", added ? "cursor-default text-ink-soft" : "hover:bg-paper")}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {added ? <Check className="h-3.5 w-3.5 shrink-0 text-teal" strokeWidth={3} aria-hidden /> : <Plus className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />}
        <span className="truncate">{name}</span>
      </span>
      <span className="shrink-0 text-xs text-muted">{added ? "Added" : meta}</span>
    </button>
  );
}
