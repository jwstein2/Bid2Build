"use client";
import {
  AlertCircle, ArrowDown, ArrowRightLeft, ArrowUp, BookmarkPlus, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Layers, Lock, MoreHorizontal, Plus, Trash2, X,
} from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { computeEstimate, itemsForGroup, type EstimateTotals } from "@/lib/estimate/engine";
import { formatCurrency, formatPercent } from "@/lib/estimate/money";
import type { Estimate, EstimateGroup, GroupVisibility, LineItem, PricingRule } from "@/lib/estimate/types";
import { COST_TYPES, UNIT_ABBR, UNITS, getTrade, type TemplateItem } from "@/lib/trades/catalog";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import type { Action } from "./state";
import type { Library } from "./library";
import { SavedItemsPicker, useSavedItemsUi, type SavedItemsUi } from "./saved-items";
import { PricingPanel } from "./pricing-panel";
import { useOpenSections } from "./open-sections";
import { QuantityCalculator } from "./calculators/quantity-calculator";
import { orderedSections, sectionTrade, tradeBlocks, tradeTotals, type TradeBlock, type TradeTotals } from "@/lib/estimate/trades";
import { TradeIcon } from "../trade-icon";
import { AddTradeSelect, useTradeRemoval } from "./trade-controls";

type Lib = SavedItemsUi;

export const VISIBILITY_LABEL: Record<GroupVisibility, string> = {
  group_total: "Group total only",
  names_only: "Item names, no prices",
  itemized: "Fully itemized",
};

/** Suggestions for a section come from its own trade (so "Labor" under Roofing suggests roofing labor). */
function suggestionsForGroup(estimate: Estimate, group: EstimateGroup): TemplateItem[] {
  const out: TemplateItem[] = [];
  const own = sectionTrade(estimate, group);
  for (const slug of estimate.trades.length > 1 && own ? [own] : estimate.trades) {
    const t = getTrade(slug);
    const g = t?.template.groups.find((x) => x.name.toLowerCase() === group.name.trim().toLowerCase());
    if (g) out.push(...g.items);
  }
  return out;
}

function allSuggestions(estimate: Estimate): TemplateItem[] {
  const seen = new Set<string>();
  const out: TemplateItem[] = [];
  for (const slug of estimate.trades) {
    const t = getTrade(slug);
    if (!t) continue;
    for (const it of [...t.template.groups.flatMap((g) => g.items), ...t.template.examples]) {
      const k = it.name.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(it); }
    }
  }
  return out;
}

export function Workspace({ estimate, dispatch, lib: library }: { estimate: Estimate; dispatch: Dispatch<Action>; lib: Library }) {
  const totals = useMemo(() => computeEstimate(estimate), [estimate]);
  const lib = useSavedItemsUi(library, estimate);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const multiTrade = estimate.trades.length > 1;
  // Trade by trade, in the project's trade order. A single-trade estimate is one block (no trade header).
  const blocks = tradeBlocks(estimate);
  const groups = blocks.flatMap((b) => b.groups);
  // Only the first section (and, with several trades, the first trade) starts open.
  const { isOpen, toggle, setAll } = useOpenSections(estimate.id, groups.map((g) => g.id), { openAdded: "first" });
  const tradeOpen = useOpenSections(`${estimate.id}:trades`, estimate.trades, { openAdded: "first" });
  const tradeSums = multiTrade ? tradeTotals(estimate, totals) : [];
  const { requestRemove, dialog: removalDialog } = useTradeRemoval(estimate, dispatch);
  const issueGroups = new Set(totals.issues.map((i) => estimate.items.find((it) => it.id === i.itemId)?.groupId).filter(Boolean));
  const dismissedFor = (g: EstimateGroup) => suggestionsForGroup(estimate, g).filter((x) => !dismissed.has(`${g.id}:${x.name}`));

  useEffect(() => {
    if (!focusId) return;
    const el = document.querySelector<HTMLInputElement>(`[data-focus="${focusId}"]`);
    el?.focus();
    el?.select?.();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot focus request after the new row renders
    setFocusId(null);
  }, [focusId, estimate]);

  const addItem = (groupId: string, from?: Partial<TemplateItem> & Partial<LineItem>, afterId?: string, field: "name" | "cost" = "name") => {
    const id = crypto.randomUUID();
    dispatch({ type: "addItem", groupId, from, afterId, newId: id });
    setFocusId(`${id}:${field}`);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        {totals.issues.length > 0 && (
          <div role="alert" className="rounded-lg border border-danger/30 bg-danger-tint px-4 py-3 text-sm">
            <p className="font-semibold text-danger">Please fix {totals.issues.length === 1 ? "this entry" : `these ${totals.issues.length} entries`} (they are counted as $0 until fixed):</p>
            <ul className="mt-1 list-disc pl-5 text-ink-soft">{totals.issues.slice(0, 6).map((i, k) => <li key={k}>{i.message}</li>)}</ul>
          </div>
        )}

        {selected.size > 0 && (
          <BulkBar
            count={selected.size}
            onClear={() => setSelected(new Set())}
            onApply={(rule) => { dispatch({ type: "bulkOverride", ids: [...selected], rule }); }}
            onDelete={() => { dispatch({ type: "deleteItems", ids: [...selected] }); setSelected(new Set()); }}
            onSaveStack={() => { if (lib.saveStack(estimate.items.filter((i) => selected.has(i.id)))) setSelected(new Set()); }}
          />
        )}

        {(groups.length > 1 || multiTrade) && (
          <div className="flex justify-end gap-1 text-sm">
            <Button size="sm" variant="ghost" onClick={() => { setAll(true); tradeOpen.setAll(true); }}><ChevronsUpDown className="h-4 w-4" aria-hidden /> Expand all</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAll(false); tradeOpen.setAll(false); }}><ChevronsDownUp className="h-4 w-4" aria-hidden /> Collapse all</Button>
          </div>
        )}

        {blocks.map((b, bi) => {
          const cards = b.groups.map((g, gi) => (
            <GroupCard
              key={g.id}
              group={g}
              index={gi}
              count={b.groups.length}
              estimate={estimate}
              totals={totals}
              dispatch={dispatch}
              selected={selected}
              setSelected={setSelected}
              addItem={addItem}
              open={isOpen(g.id)}
              onToggle={() => toggle(g.id)}
              hasIssues={issueGroups.has(g.id)}
              examples={dismissedFor(g)}
              dismissExample={(name) => setDismissed(new Set(dismissed).add(`${g.id}:${name}`))}
              fallbackExamples={gi === 0 ? (getTrade(b.trade)?.template.examples ?? []) : []}
              suggestions={allSuggestions(estimate)}
              lib={lib}
            />
          ));
          if (!multiTrade) return cards;
          return (
            <TradeSection
              key={b.trade}
              block={b}
              index={bi}
              count={blocks.length}
              sums={tradeSums[bi]}
              open={tradeOpen.isOpen(b.trade)}
              onToggle={() => tradeOpen.toggle(b.trade)}
              hasIssues={b.groups.some((g) => issueGroups.has(g.id))}
              dispatch={dispatch}
              onRemove={() => requestRemove(b.trade)}
            >
              {cards}
            </TradeSection>
          );
        })}

        <div className="flex flex-wrap items-center gap-2">
          {!multiTrade && <Button variant="secondary" onClick={() => dispatch({ type: "addGroup" })}><Plus className="h-4 w-4" /> Add section</Button>}
          <AddTradeSelect estimate={estimate} dispatch={dispatch} className="min-h-11 md:min-h-9" label={multiTrade ? "+ Add another trade" : "+ Add a trade to this project"} />
        </div>
        {removalDialog}
        {lib.dialogs}
      </div>

      <PricingPanel estimate={estimate} totals={totals} dispatch={dispatch} />
    </div>
  );
}

function BulkBar({ count, onClear, onApply, onDelete, onSaveStack }: { count: number; onClear: () => void; onApply: (r: PricingRule | null) => void; onDelete: () => void; onSaveStack: () => void }) {
  const [mode, setMode] = useState<"markup" | "margin">("markup");
  const [pct, setPct] = useState("");
  return (
    <div className="sticky top-[7.5rem] z-20 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand-tint px-3 py-2 text-sm shadow-sm">
      <span className="font-semibold">{count} selected</span>
      <span className="mx-1 text-muted">·</span>
      <label className="sr-only" htmlFor="bulk-mode">Pricing mode</label>
      <select id="bulk-mode" className="field field-sm w-auto" value={mode} onChange={(e) => setMode(e.target.value as "markup" | "margin")}>
        <option value="markup">Markup %</option><option value="margin">Margin %</option>
      </select>
      <label className="sr-only" htmlFor="bulk-pct">Percent</label>
      <input id="bulk-pct" className="field field-sm w-20" inputMode="decimal" placeholder="%" value={pct} onChange={(e) => setPct(e.target.value)} />
      <Button size="sm" onClick={() => pct.trim() && onApply({ mode, percent: pct.trim() })}>Apply override</Button>
      <Button size="sm" variant="secondary" onClick={() => onApply(null)}>Use estimate pricing</Button>
      <Button size="sm" variant="secondary" onClick={onSaveStack}><Layers className="h-4 w-4" /> Save Stack</Button>
      <Button size="sm" variant="ghost" className="text-danger" onClick={onDelete}><Trash2 className="h-4 w-4" /> Delete</Button>
      <button onClick={onClear} className="ml-auto rounded p-1 hover:bg-black/5" aria-label="Clear selection"><X className="h-4 w-4" /></button>
    </div>
  );
}

function GroupCard(props: {
  group: EstimateGroup; index: number; count: number; estimate: Estimate; totals: EstimateTotals; dispatch: Dispatch<Action>;
  selected: Set<string>; setSelected: (s: Set<string>) => void;
  addItem: (groupId: string, from?: Partial<TemplateItem> & Partial<LineItem>, afterId?: string, field?: "name" | "cost") => void;
  open: boolean; onToggle: () => void; hasIssues: boolean;
  examples: TemplateItem[]; dismissExample: (name: string) => void; fallbackExamples: TemplateItem[]; suggestions: TemplateItem[]; lib: Lib;
}) {
  const { group: g, estimate, totals, dispatch, open } = props;
  const items = itemsForGroup(estimate, g.id);
  const gt = totals.groups[g.id];
  const examples = props.examples.length ? props.examples : props.fallbackExamples;
  const projectTotalMode = estimate.displayMode === "project_total";
  const panelId = `gp-${g.id}`;
  const sectionName = g.name || "untitled section";

  return (
    <section className="rounded-xl border border-line bg-surface shadow-card" aria-label={`Section ${g.name || "untitled"}`}>
      <header className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-2 sm:px-3", open && "border-b border-line")}>
        <button
          type="button"
          onClick={props.onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? "Collapse" : "Expand"} ${sectionName}`}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-black/5 md:h-9 md:w-9"
        >
          {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>
        <label className="sr-only" htmlFor={`g-${g.id}`}>Section name</label>
        <input
          id={`g-${g.id}`}
          value={g.name}
          onChange={(e) => dispatch({ type: "updateGroup", id: g.id, patch: { name: e.target.value } })}
          className="cell min-w-0 flex-1 basis-32 font-display text-base font-bold"
          placeholder="Section name"
        />
        <div className="flex items-center gap-3 text-sm max-sm:order-last max-sm:w-full max-sm:pb-1 max-sm:pl-12">
          {!open && props.hasIssues && <span className="inline-flex items-center gap-1 rounded bg-danger-tint px-1.5 py-0.5 text-xs font-semibold text-danger"><AlertCircle className="h-3.5 w-3.5" aria-hidden /> Needs attention</span>}
          {!open && <button type="button" onClick={props.onToggle} className="text-xs text-muted hover:text-ink" tabIndex={-1} aria-hidden="true">{items.length} {items.length === 1 ? "item" : "items"}</button>}
          <span className="hidden text-muted sm:inline">Cost <span className="tabular font-semibold text-ink-soft">{formatCurrency(gt.cost)}</span></span>
          <span className="text-muted">Price <span className="tabular font-bold text-ink">{formatCurrency(gt.price)}</span></span>
          <span className={cn("hidden rounded px-1.5 py-0.5 text-xs font-semibold sm:inline", gt.grossProfit.isNegative() ? "bg-danger-tint text-danger" : "bg-ok-tint text-ok")}>
            {gt.grossMargin ? formatPercent(gt.grossMargin) : "—"} GM
          </span>
        </div>
        <GroupMenu {...props} />
      </header>

      {open && (
        <div id={panelId}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper/60 px-3 py-2 text-xs sm:px-4">
            <label htmlFor={`gv-${g.id}`} className="font-semibold text-ink-soft">Customer sees:</label>
            <select
              id={`gv-${g.id}`}
              disabled={projectTotalMode}
              value={g.visibility ?? "inherit"}
              onChange={(e) => dispatch({ type: "updateGroup", id: g.id, patch: { visibility: e.target.value === "inherit" ? null : (e.target.value as GroupVisibility) } })}
              className="field field-sm w-auto max-w-full py-1 text-xs"
            >
              <option value="inherit">Estimate default ({VISIBILITY_LABEL[estimate.defaultGroupVisibility]})</option>
              {Object.entries(VISIBILITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {projectTotalMode && <span className="text-muted">Single project total is on; sections are hidden from the customer.</span>}
            {g.pricingOverride && <span className="rounded bg-accent-tint px-1.5 py-0.5 font-semibold text-accent-dark">Section pricing: {g.pricingOverride.percent}% {g.pricingOverride.mode}</span>}
            
          </div>

          {items.length > 0 && (
            // `relative` keeps absolutely positioned children (sr-only labels) inside the scroll box,
            // otherwise they widen the whole page on phones. Below md each row renders as a card.
            <div className="relative md:overflow-x-auto">
              <table className="w-full text-sm max-md:block md:min-w-[860px]">
                <thead className="max-md:hidden">
                  <tr className="border-b border-line text-left text-xs font-semibold text-muted">
                    <th className="w-8 px-2 py-2"><span className="sr-only">Select</span></th>
                    <th className="px-1 py-2">Item</th>
                    <th className="w-[110px] px-1 py-2">Type</th>
                    <th className="w-[108px] px-1 py-2 text-right">Qty</th>
                    <th className="w-[96px] px-1 py-2">Unit</th>
                    <th className="w-[100px] px-1 py-2 text-right">Unit cost</th>
                    <th className="w-[96px] px-1 py-2 text-right">Ext. cost</th>
                    <th className="w-[96px] px-1 py-2 text-right">Unit price</th>
                    <th className="w-[104px] px-1 py-2 text-right">Ext. price</th>
                    <th className="w-16 px-1 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="max-md:block max-md:divide-y max-md:divide-line">
                  {items.map((it, idx) => (
                    <ItemRow
                      key={it.id}
                      item={it}
                      isLast={idx === items.length - 1}
                      totals={totals}
                      estimate={estimate}
                      dispatch={dispatch}
                      selected={props.selected.has(it.id)}
                      toggleSelected={() => {
                        const s = new Set(props.selected);
                        if (s.has(it.id)) s.delete(it.id); else s.add(it.id);
                        props.setSelected(s);
                      }}
                      onEnterAtEnd={() => props.addItem(g.id, { unit: it.unit, costType: it.costType, taxable: it.taxable }, it.id)}
                      lib={props.lib}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {examples.length > 0 && (
            <SuggestionChips
              suggestions={examples}
              items={items}
              onAdd={(ex) => props.addItem(g.id, ex, undefined, "cost")}
              onDismiss={props.dismissExample}
            />
          )}

          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
            <Button size="sm" variant="secondary" onClick={() => props.addItem(g.id)}><Plus className="h-4 w-4" /> Add line item</Button>
            <SavedItemsPicker group={g} estimate={estimate} suggestions={props.suggestions} lib={props.lib} dispatch={dispatch} />
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One trade in a multi-trade estimate: a collapsible block holding that trade's own sections, with
 * the trade's subtotal (pre-adjustment, pre-tax). Collapsing only hides rows; nothing is lost.
 */
function TradeSection({ block: b, index, count, sums, open, onToggle, hasIssues, dispatch, onRemove, children }: {
  block: TradeBlock; index: number; count: number; sums: TradeTotals | undefined; open: boolean; onToggle: () => void; hasIssues: boolean;
  dispatch: Dispatch<Action>; onRemove: () => void; children: React.ReactNode;
}) {
  const panelId = `trade-${b.trade}`;
  const icon = getTrade(b.trade)?.icon ?? "Hammer";
  return (
    <section className="rounded-2xl border border-line-strong bg-paper/60" aria-label={`${b.name} trade`}>
      <header className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-2 sm:px-3", open && "border-b border-line")}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? "Collapse" : "Expand"} ${b.name} trade`}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-black/5 md:h-9 md:w-9"
        >
          {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand" aria-hidden><TradeIcon name={icon} className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1 basis-40">
          <h2 className="truncate font-display text-lg font-extrabold leading-tight">
            <span className="tabular text-muted">{index + 1}.</span> {b.name}
          </h2>
          <p className="text-xs text-muted">
            {b.groups.length} {b.groups.length === 1 ? "section" : "sections"} · {sums?.itemCount ?? 0} {sums?.itemCount === 1 ? "item" : "items"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm max-sm:order-last max-sm:w-full max-sm:pb-1 max-sm:pl-12">
          {!open && hasIssues && <span className="inline-flex items-center gap-1 rounded bg-danger-tint px-1.5 py-0.5 text-xs font-semibold text-danger"><AlertCircle className="h-3.5 w-3.5" aria-hidden /> Needs attention</span>}
          {sums && <span className="hidden text-muted sm:inline">Cost <span className="tabular font-semibold text-ink-soft">{formatCurrency(sums.cost)}</span></span>}
          {sums && <span className="text-muted">Subtotal <span className="tabular font-bold text-ink">{formatCurrency(sums.price)}</span></span>}
          {sums && (
            <span className={cn("hidden rounded px-1.5 py-0.5 text-xs font-semibold sm:inline", sums.grossProfit.isNegative() ? "bg-danger-tint text-danger" : "bg-ok-tint text-ok")}>
              {sums.grossMargin ? formatPercent(sums.grossMargin) : "—"} GM
            </span>
          )}
        </div>
        <Dropdown.Root>
          <Dropdown.Trigger className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-black/5 md:h-9 md:w-9" aria-label={`Trade actions for ${b.name}`}><MoreHorizontal className="h-4 w-4" /></Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" sideOffset={4} className="z-50 min-w-[200px] rounded-lg border border-line bg-surface p-1 text-sm shadow-lg">
              <MenuItem onSelect={() => dispatch({ type: "moveTrade", trade: b.trade, dir: -1 })} disabled={index === 0}><ArrowUp className="h-4 w-4" /> Move trade up</MenuItem>
              <MenuItem onSelect={() => dispatch({ type: "moveTrade", trade: b.trade, dir: 1 })} disabled={index === count - 1}><ArrowDown className="h-4 w-4" /> Move trade down</MenuItem>
              <Dropdown.Separator className="my-1 h-px bg-line" />
              <MenuItem onSelect={onRemove} danger><Trash2 className="h-4 w-4" /> Remove trade</MenuItem>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </header>
      {open && (
        <div id={panelId} className="space-y-3 p-2 sm:p-3">
          {children}
          {b.groups.length === 0 && <p className="px-1 text-sm text-muted">No sections yet for {b.name}.</p>}
          <Button size="sm" variant="secondary" onClick={() => dispatch({ type: "addGroup", trade: b.trade })}><Plus className="h-4 w-4" /> Add section to {b.name}</Button>
        </div>
      )}
    </section>
  );
}

const CHIP_LIMIT = 6;

/**
 * Trade suggestions for a section. They stay visible after one is picked so several can be added
 * in a row; picked ones turn into a checked "Added" chip and clicking one again jumps to the existing
 * row instead of adding a duplicate. Suggestions are never counted in totals until added.
 */
function SuggestionChips({ suggestions, items, onAdd, onDismiss }: {
  suggestions: TemplateItem[]; items: LineItem[]; onAdd: (s: TemplateItem) => void; onDismiss: (name: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const added = new Map(items.map((i) => [i.name.trim().toLowerCase(), i.id]));
  const pending = suggestions.filter((x) => !added.has(x.name.toLowerCase()));
  // Unpicked suggestions first, so the next useful one is always in view.
  const ordered = [...pending, ...suggestions.filter((x) => added.has(x.name.toLowerCase()))];
  const visible = showAll ? ordered : ordered.slice(0, CHIP_LIMIT);
  const hiddenCount = ordered.length - visible.length;
  const focusRow = (id: string) => {
    const el = document.querySelector<HTMLInputElement>(`[data-focus="${id}:name"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  };
  return (
    <div className="px-3 py-2.5 sm:px-4">
      <p className="mb-1.5 text-xs font-semibold text-muted">
        <span className="uppercase tracking-wider">Suggested items</span>
        <span className="font-normal"> · tap to add. Not in your totals until added.</span>
      </p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Suggested items for this section">
        {visible.map((ex) => {
          const id = added.get(ex.name.toLowerCase());
          return (
            <li key={ex.name} className="flex max-w-full">
              {id ? (
                <button
                  type="button"
                  onClick={() => focusRow(id)}
                  className="inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border border-teal/50 bg-teal/10 px-3 text-sm font-medium text-ink md:min-h-8"
                  aria-label={`${ex.name} is already in this section. Go to it.`}
                >
                  <Check className="h-3.5 w-3.5 shrink-0 text-teal" strokeWidth={3} aria-hidden />
                  <span className="truncate">{ex.name}</span>
                  <span className="text-xs text-muted">Added</span>
                </button>
              ) : (
                <span className="inline-flex max-w-full items-stretch rounded-full border border-dashed border-line-strong bg-surface text-sm text-ink-soft hover:border-brand/50">
                  <button
                    type="button"
                    onClick={() => onAdd(ex)}
                    className="inline-flex min-h-10 min-w-0 items-center gap-1.5 rounded-l-full py-1 pl-3 pr-1.5 hover:text-ink md:min-h-8"
                    aria-label={`Add ${ex.name} to this section`}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                    <span className="truncate">{ex.name}</span>
                    <span className="text-xs text-muted">{UNIT_ABBR[ex.unit] ?? ex.unit}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(ex.name)}
                    className="grid min-h-10 w-9 shrink-0 place-items-center rounded-r-full text-muted hover:bg-black/5 hover:text-ink md:min-h-8 md:w-7"
                    aria-label={`Hide suggestion ${ex.name}`}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>
              )}
            </li>
          );
        })}
        {(hiddenCount > 0 || showAll) && ordered.length > CHIP_LIMIT && (
          <li>
            <button type="button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll} className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-semibold text-brand hover:bg-brand-tint md:min-h-8">
              {showAll ? "Show fewer" : `+${hiddenCount} more`}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

function GroupMenu({ group: g, index, count, dispatch, estimate }: { group: EstimateGroup; index: number; count: number; dispatch: Dispatch<Action>; estimate: Estimate }) {
  const [editPricing, setEditPricing] = useState(false);
  const own = sectionTrade(estimate, g);
  const otherTrades = estimate.trades.length > 1 ? estimate.trades.filter((t) => t !== own) : [];
  return (
    <>
      <Dropdown.Root>
        <Dropdown.Trigger className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-black/5 md:h-9 md:w-9" aria-label={`Actions for ${g.name || "section"}`}><MoreHorizontal className="h-4 w-4" /></Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="end" sideOffset={4} className="z-50 min-w-[200px] rounded-lg border border-line bg-surface p-1 text-sm shadow-lg">
            <MenuItem onSelect={() => dispatch({ type: "moveGroup", id: g.id, dir: -1 })} disabled={index === 0}><ArrowUp className="h-4 w-4" /> Move section up</MenuItem>
            <MenuItem onSelect={() => dispatch({ type: "moveGroup", id: g.id, dir: 1 })} disabled={index === count - 1}><ArrowDown className="h-4 w-4" /> Move section down</MenuItem>
            <MenuItem onSelect={() => setEditPricing(true)}>% Section pricing override</MenuItem>
            {otherTrades.map((t) => (
              <MenuItem key={t} onSelect={() => dispatch({ type: "moveGroupToTrade", id: g.id, trade: t })}><ArrowRightLeft className="h-4 w-4" /> Move to {getTrade(t)?.name ?? t}</MenuItem>
            ))}
            <Dropdown.Separator className="my-1 h-px bg-line" />
            <MenuItem onSelect={() => dispatch({ type: "deleteGroup", id: g.id })} danger><Trash2 className="h-4 w-4" /> Delete section</MenuItem>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
      {editPricing && (
        <OverrideEditor
          title={`Pricing for "${g.name || "section"}"`}
          rule={g.pricingOverride ?? null}
          onClose={() => setEditPricing(false)}
          onSave={(r) => { dispatch({ type: "updateGroup", id: g.id, patch: { pricingOverride: r } }); setEditPricing(false); }}
        />
      )}
    </>
  );
}

function MenuItem({ children, onSelect, disabled, danger }: { children: React.ReactNode; onSelect: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Dropdown.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn("flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-paper", danger && "text-danger")}
    >
      {children}
    </Dropdown.Item>
  );
}

function OverrideEditor({ title, rule, onSave, onClose }: { title: string; rule: PricingRule | null; onSave: (r: PricingRule | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<"markup" | "margin">(rule?.mode ?? "markup");
  const [pct, setPct] = useState(rule?.percent ?? "");
  const invalid = mode === "margin" && Number(pct) >= 100;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" role="dialog" aria-modal aria-label={title} onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold">{title}</h3>
        <p className="mt-1 text-sm text-muted">Overrides the estimate pricing method for these items only.</p>
        <div className="mt-4 flex gap-2">
          <select className="field w-auto" value={mode} onChange={(e) => setMode(e.target.value as "markup" | "margin")} aria-label="Mode">
            <option value="markup">Markup %</option><option value="margin">Target margin %</option>
          </select>
          <input className="field" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Percent" aria-invalid={invalid} autoFocus />
        </div>
        {invalid && <p className="mt-1 text-xs text-danger">Margin must be below 100%.</p>}
        <div className="mt-5 flex justify-between gap-2">
          <Button variant="ghost" onClick={() => onSave(null)}>Remove override</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button disabled={!pct.trim() || invalid} onClick={() => onSave({ mode, percent: pct.trim() })}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemRow({ item: it, isLast, totals, estimate, dispatch, selected, toggleSelected, onEnterAtEnd, lib }: {
  item: LineItem; isLast: boolean; totals: EstimateTotals; estimate: Estimate; dispatch: Dispatch<Action>; selected: boolean;
  toggleSelected: () => void; onEnterAtEnd: () => void; lib: Lib;
}) {
  const t = totals.items[it.id];
  const [expanded, setExpanded] = useState(false);
  const [editPricing, setEditPricing] = useState(false);
  const up = (patch: Partial<LineItem>) => dispatch({ type: "updateItem", id: it.id, patch });
  const invalid = (field: string) => totals.issues.some((i) => i.itemId === it.id && i.field === field);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isLast) onEnterAtEnd();
      else {
        const row = (e.target as HTMLElement).closest("tr");
        let next = row?.nextElementSibling as HTMLElement | null;
        while (next && !next.querySelector("[data-col]")) next = next.nextElementSibling as HTMLElement | null;
        const col = (e.target as HTMLElement).getAttribute("data-col");
        next?.querySelector<HTMLInputElement>(`[data-col="${col}"]`)?.focus();
      }
    }
  };
  const groups = orderedSections(estimate);
  const multiTrade = estimate.trades.length > 1;
  const customUnit = !(UNITS as readonly string[]).includes(it.unit);

  return (
    <>
      <tr className={cn("border-b border-line/70 align-middle max-md:grid max-md:grid-cols-12 max-md:items-end max-md:gap-x-2 max-md:gap-y-2 max-md:border-0 max-md:px-3 max-md:py-3", selected && "bg-brand-tint/50")}>
        <td className="px-2 text-center max-md:col-span-1 max-md:row-start-1 max-md:self-start max-md:px-0">
          <label className="inline-grid place-items-center max-md:h-11 max-md:w-8">
            <input type="checkbox" checked={selected} onChange={toggleSelected} aria-label={`Select ${it.name || "item"}`} className="h-4 w-4 accent-[var(--color-brand)] max-md:h-5 max-md:w-5" />
          </label>
        </td>
        <td className="px-1 py-1 max-md:col-span-10 max-md:row-start-1 max-md:p-0">
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(!expanded)} className="grid shrink-0 place-items-center rounded p-0.5 text-muted hover:bg-black/5 max-md:h-11 max-md:w-8" aria-label={expanded ? "Hide item details" : "Show item details"} aria-expanded={expanded}>
              {expanded ? <ChevronDown className="h-3.5 w-3.5 max-md:h-4 max-md:w-4" /> : <ChevronRight className="h-3.5 w-3.5 max-md:h-4 max-md:w-4" />}
            </button>
            <input data-focus={`${it.id}:name`} data-col="name" value={it.name} onChange={(e) => up({ name: e.target.value })} onKeyDown={onKey} className="cell font-medium max-md:min-h-11 max-md:border-line max-md:text-base" placeholder="Item name" aria-label="Item name" />
          </div>
          <div className="flex flex-wrap gap-1 pl-6 max-md:pl-9">
            {it.pricingOverride && <span className="rounded bg-accent-tint px-1 text-[10px] font-semibold text-accent-dark">{it.pricingOverride.percent}% {it.pricingOverride.mode}</span>}
            {it.treatment === "pass_through" && <span className="rounded bg-brand-tint px-1 text-[10px] font-semibold text-brand">at cost</span>}
            {!it.showOnProposal && <span className="rounded bg-black/5 px-1 text-[10px] font-semibold text-muted">hidden from customer</span>}
            {!it.taxable && <span className="rounded bg-black/5 px-1 text-[10px] font-semibold text-muted">non-taxable</span>}
          </div>
        </td>
        <td className="px-1 max-md:col-span-4 max-md:p-0">
          <span aria-hidden="true" className="mb-0.5 block text-[11px] font-semibold text-muted md:hidden">Type</span>
          <select value={it.costType} onChange={(e) => up({ costType: e.target.value as LineItem["costType"] })} className="cell max-md:min-h-11 max-md:border-line" aria-label="Cost type">
            {COST_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </td>
        <td className="px-1 max-md:col-span-4 max-md:p-0">
          <span aria-hidden="true" className="mb-0.5 block text-[11px] font-semibold text-muted md:hidden">Qty</span>
          <div className="flex items-center gap-0.5">
            <input data-col="qty" value={it.quantity} onChange={(e) => up({ quantity: e.target.value })} onKeyDown={onKey} inputMode="decimal" className="cell tabular min-w-0 text-right max-md:min-h-11 max-md:border-line max-md:text-base" aria-label="Quantity" aria-invalid={invalid("quantity")} />
            <QuantityCalculator item={it} estimate={estimate} dispatch={dispatch} />
          </div>
        </td>
        <td className="px-1 max-md:col-span-4 max-md:p-0">
          <span aria-hidden="true" className="mb-0.5 block text-[11px] font-semibold text-muted md:hidden">Unit</span>
          {customUnit ? (
            <input value={it.unit} onChange={(e) => up({ unit: e.target.value || "each" })} className="cell max-md:min-h-11 max-md:border-line" aria-label="Custom unit" onBlur={(e) => !e.target.value && up({ unit: "each" })} />
          ) : (
            <select value={it.unit} onChange={(e) => up({ unit: e.target.value === "__custom" ? "custom" : e.target.value })} className="cell max-md:min-h-11 max-md:border-line" aria-label="Unit">
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              <option value="__custom">Custom…</option>
            </select>
          )}
        </td>
        <td className="px-1 max-md:col-span-6 max-md:p-0">
          <span aria-hidden="true" className="mb-0.5 block text-[11px] font-semibold text-muted md:hidden">Unit cost (internal)</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted">$</span>
            <input data-focus={`${it.id}:cost`} data-col="cost" value={it.unitCost} onChange={(e) => up({ unitCost: e.target.value })} onKeyDown={onKey} inputMode="decimal" placeholder="0.00" className="cell tabular pl-4 text-right max-md:min-h-11 max-md:border-line max-md:text-base" aria-label="Internal unit cost" aria-invalid={invalid("unitCost")} />
          </div>
        </td>
        <td className="tabular px-1 text-right text-ink-soft max-md:col-span-6 max-md:row-start-4 max-md:p-0 max-md:text-left max-md:text-xs"><span className="text-muted md:hidden">Ext. cost </span>{t ? formatCurrency(t.extendedCost) : "—"}</td>
        <td className="tabular px-1 text-right text-ink-soft max-md:col-span-6 max-md:row-start-4 max-md:p-0 max-md:text-xs"><span className="text-muted md:hidden">Unit price </span>{t ? formatCurrency(t.unitPrice) : "—"}</td>
        <td className="tabular px-1 text-right font-semibold max-md:col-span-6 max-md:col-start-7 max-md:row-start-3 max-md:self-center max-md:p-0 max-md:text-base"><span aria-hidden="true" className="mb-0.5 block text-[11px] font-semibold text-muted md:hidden">Customer price</span>{t ? formatCurrency(t.extendedPrice) : "—"}</td>
        <td className="px-1 max-md:col-span-1 max-md:col-start-12 max-md:row-start-1 max-md:self-start max-md:p-0">
          <div className="flex justify-end">
            <Dropdown.Root>
              <Dropdown.Trigger className="grid place-items-center rounded p-1.5 hover:bg-black/5 max-md:h-11 max-md:w-8" aria-label={`Actions for ${it.name || "item"}`}><MoreHorizontal className="h-4 w-4" /></Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content align="end" sideOffset={4} className="z-50 min-w-[210px] rounded-lg border border-line bg-surface p-1 text-sm shadow-lg">
                  <MenuItem onSelect={() => dispatch({ type: "duplicateItem", id: it.id })}><Copy className="h-4 w-4" /> Duplicate</MenuItem>
                  <MenuItem onSelect={() => dispatch({ type: "moveItem", id: it.id, dir: -1 })}><ArrowUp className="h-4 w-4" /> Move up</MenuItem>
                  <MenuItem onSelect={() => dispatch({ type: "moveItem", id: it.id, dir: 1 })}><ArrowDown className="h-4 w-4" /> Move down</MenuItem>
                  <Dropdown.Sub>
                    <Dropdown.SubTrigger className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 outline-none data-[highlighted]:bg-paper"><Layers className="h-4 w-4" /> Move to section</Dropdown.SubTrigger>
                    <Dropdown.Portal>
                      <Dropdown.SubContent className="z-50 min-w-[180px] rounded-lg border border-line bg-surface p-1 text-sm shadow-lg">
                        {groups.filter((g) => g.id !== it.groupId).map((g) => (
                          <MenuItem key={g.id} onSelect={() => dispatch({ type: "moveItemToGroup", id: it.id, groupId: g.id })}>{multiTrade ? `${getTrade(sectionTrade(estimate, g))?.name ?? ""} · ` : ""}{g.name || "Untitled"}</MenuItem>
                        ))}
                      </Dropdown.SubContent>
                    </Dropdown.Portal>
                  </Dropdown.Sub>
                  <MenuItem onSelect={() => setEditPricing(true)}>% Override pricing</MenuItem>
                  <MenuItem onSelect={() => void lib.saveItem(it)}><BookmarkPlus className="h-4 w-4" /> Save Item{!lib.access && <Lock className="ml-auto h-3.5 w-3.5 text-muted" aria-label="Premium" />}</MenuItem>
                  <Dropdown.Separator className="my-1 h-px bg-line" />
                  <MenuItem onSelect={() => dispatch({ type: "deleteItem", id: it.id })} danger><Trash2 className="h-4 w-4" /> Delete</MenuItem>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-line bg-paper/60 max-md:block">
          <td className="max-md:hidden" />
          <td colSpan={9} className="px-2 py-3 max-md:block max-md:px-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="label" htmlFor={`d-${it.id}`}>Description <span className="font-normal text-muted">(can appear on proposal)</span></label>
                <textarea id={`d-${it.id}`} rows={2} value={it.description ?? ""} onChange={(e) => up({ description: e.target.value })} className="field text-sm" />
              </div>
              <div>
                <label className="label" htmlFor={`n-${it.id}`}>Internal notes <span className="font-normal text-muted">(hidden unless you enable notes)</span></label>
                <textarea id={`n-${it.id}`} rows={2} value={it.notes ?? ""} onChange={(e) => up({ notes: e.target.value })} className="field text-sm" />
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={it.taxable} onChange={(e) => up({ taxable: e.target.checked })} className="accent-[var(--color-brand)]" /> Taxable</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={it.showOnProposal} onChange={(e) => up({ showOnProposal: e.target.checked })} className="accent-[var(--color-brand)]" /> Show item on proposal</label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={it.treatment === "pass_through"} onChange={(e) => up({ treatment: e.target.checked ? "pass_through" : "marked_up" })} className="accent-[var(--color-brand)]" />
                  Bill at cost (pass-through charge)
                </label>
              </div>
              <div className="text-sm">
                <p className="font-semibold text-ink-soft">Regional reference price</p>
                <p className="text-muted">Local pricing unavailable. Enter your cost manually.</p>
              </div>
            </div>
            {t && (
              <p className="mt-2 text-xs text-muted">
                {t.appliedRule ? `Priced at ${t.appliedRule.percent}% ${t.appliedRule.mode}${it.pricingOverride ? " (item override)" : ""}.` : "Billed at cost."} Gross profit on this line: <span className="tabular font-semibold">{formatCurrency(t.grossProfit)}</span>
              </p>
            )}
          </td>
        </tr>
      )}
      {editPricing && (
        <tr className="max-md:block"><td colSpan={10} className="max-md:block">
          <OverrideEditor title={`Pricing for "${it.name || "item"}"`} rule={it.pricingOverride ?? null} onClose={() => setEditPricing(false)} onSave={(r) => { up({ pricingOverride: r }); setEditPricing(false); }} />
        </td></tr>
      )}
    </>
  );
}
