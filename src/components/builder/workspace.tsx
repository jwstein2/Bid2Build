"use client";
import {
  ArrowDown, ArrowUp, BookmarkPlus, ChevronDown, ChevronRight, Copy, Layers, MoreHorizontal, Plus, Search, Trash2, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { computeEstimate, itemsForGroup, sortedGroups, type EstimateTotals } from "@/lib/estimate/engine";
import { formatCurrency, formatPercent } from "@/lib/estimate/money";
import type { Estimate, EstimateGroup, GroupVisibility, LineItem, PricingRule } from "@/lib/estimate/types";
import { COST_TYPES, UNIT_ABBR, UNITS, getTrade, parseTemplateItem, type TemplateItem } from "@/lib/trades/catalog";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import type { Action } from "./state";
import type { useLibrary } from "./library";
import { PricingPanel } from "./pricing-panel";
import { QuantityCalculator } from "./calculators/quantity-calculator";

type Lib = ReturnType<typeof useLibrary>;

export const VISIBILITY_LABEL: Record<GroupVisibility, string> = {
  group_total: "Group total only",
  names_only: "Item names, no prices",
  itemized: "Fully itemized",
};

function suggestionsForGroup(estimate: Estimate, group: EstimateGroup): TemplateItem[] {
  const out: TemplateItem[] = [];
  for (const slug of estimate.trades) {
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

export function Workspace({ estimate, dispatch, lib }: { estimate: Estimate; dispatch: Dispatch<Action>; lib: Lib }) {
  const totals = useMemo(() => computeEstimate(estimate), [estimate]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const groups = sortedGroups(estimate);

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
            onAssembly={(name) => { lib.saveAssembly(name, estimate.items.filter((i) => selected.has(i.id))); setSelected(new Set()); }}
          />
        )}

        {groups.map((g, gi) => (
          <GroupCard
            key={g.id}
            group={g}
            index={gi}
            count={groups.length}
            estimate={estimate}
            totals={totals}
            dispatch={dispatch}
            selected={selected}
            setSelected={setSelected}
            addItem={addItem}
            examples={suggestionsForGroup(estimate, g).filter((x) => !dismissed.has(`${g.id}:${x.name}`)).slice(0, 3)}
            dismissExample={(name) => setDismissed(new Set(dismissed).add(`${g.id}:${name}`))}
            fallbackExamples={gi === 0 && estimate.items.length === 0 ? (getTrade(estimate.trades[0])?.template.examples ?? []).slice(0, 3) : []}
            suggestions={allSuggestions(estimate)}
            lib={lib}
          />
        ))}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => dispatch({ type: "addGroup" })}><Plus className="h-4 w-4" /> Add section</Button>
        </div>
      </div>

      <PricingPanel estimate={estimate} totals={totals} dispatch={dispatch} />
    </div>
  );
}

function BulkBar({ count, onClear, onApply, onDelete, onAssembly }: { count: number; onClear: () => void; onApply: (r: PricingRule | null) => void; onDelete: () => void; onAssembly: (name: string) => void }) {
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
      <Button size="sm" variant="secondary" onClick={() => { const n = prompt("Name this assembly"); if (n) onAssembly(n); }}><Layers className="h-4 w-4" /> Save as assembly</Button>
      <Button size="sm" variant="ghost" className="text-danger" onClick={onDelete}><Trash2 className="h-4 w-4" /> Delete</Button>
      <button onClick={onClear} className="ml-auto rounded p-1 hover:bg-black/5" aria-label="Clear selection"><X className="h-4 w-4" /></button>
    </div>
  );
}

function GroupCard(props: {
  group: EstimateGroup; index: number; count: number; estimate: Estimate; totals: EstimateTotals; dispatch: Dispatch<Action>;
  selected: Set<string>; setSelected: (s: Set<string>) => void;
  addItem: (groupId: string, from?: Partial<TemplateItem> & Partial<LineItem>, afterId?: string, field?: "name" | "cost") => void;
  examples: TemplateItem[]; dismissExample: (name: string) => void; fallbackExamples: TemplateItem[]; suggestions: TemplateItem[]; lib: Lib;
}) {
  const { group: g, estimate, totals, dispatch } = props;
  const [open, setOpen] = useState(true);
  const items = itemsForGroup(estimate, g.id);
  const gt = totals.groups[g.id];
    const examples = items.length === 0 ? (props.examples.length ? props.examples : props.fallbackExamples) : [];
  const projectTotalMode = estimate.displayMode === "project_total";

  return (
    <section className="rounded-xl border border-line bg-surface shadow-card" aria-label={`Section ${g.name || "untitled"}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Collapse section" : "Expand section"} className="rounded p-1 hover:bg-black/5">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <label className="sr-only" htmlFor={`g-${g.id}`}>Section name</label>
        <input
          id={`g-${g.id}`}
          value={g.name}
          onChange={(e) => dispatch({ type: "updateGroup", id: g.id, patch: { name: e.target.value } })}
          className="cell min-w-0 flex-1 font-display text-base font-bold"
          placeholder="Section name"
        />
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-muted sm:inline">Cost <span className="tabular font-semibold text-ink-soft">{formatCurrency(gt.cost)}</span></span>
          <span className="text-muted">Price <span className="tabular font-bold text-ink">{formatCurrency(gt.price)}</span></span>
          <span className={cn("hidden rounded px-1.5 py-0.5 text-xs font-semibold sm:inline", gt.grossProfit.isNegative() ? "bg-danger-tint text-danger" : "bg-ok-tint text-ok")}>
            {gt.grossMargin ? formatPercent(gt.grossMargin) : "—"} GM
          </span>
        </div>
        <GroupMenu {...props} />
      </header>

      {open && (
        <div>
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
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
                <tbody>
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
            <div className="px-3 py-2 sm:px-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Examples (not included in your totals)</p>
              <ul className="divide-y divide-dashed divide-line rounded-lg border border-dashed border-line-strong">
                {examples.map((ex) => (
                  <li key={ex.name} className="flex items-center gap-3 px-3 py-2 text-sm text-muted opacity-70 transition hover:opacity-100">
                    <button
                      className="flex flex-1 items-center gap-3 text-left"
                      onClick={() => props.addItem(g.id, ex, undefined, "cost")}
                      aria-label={`Add example item ${ex.name} to this section`}
                    >
                      <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-bold uppercase">Example</span>
                      <span className="flex-1 italic">{ex.name}</span>
                      <span className="text-xs">{UNIT_ABBR[ex.unit] ?? ex.unit}</span>
                      <span className="text-xs font-semibold text-brand">Click to add</span>
                    </button>
                    <button onClick={() => props.dismissExample(ex.name)} className="rounded p-1 hover:bg-black/5" aria-label={`Dismiss example ${ex.name}`}><X className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
            <Button size="sm" variant="secondary" onClick={() => props.addItem(g.id)}><Plus className="h-4 w-4" /> Add line item</Button>
            <AddFromLibrary group={g} estimate={estimate} suggestions={props.suggestions} lib={props.lib} dispatch={dispatch} />
          </div>
        </div>
      )}
    </section>
  );
}

function GroupMenu({ group: g, index, count, dispatch }: { group: EstimateGroup; index: number; count: number; dispatch: Dispatch<Action> }) {
  const [editPricing, setEditPricing] = useState(false);
  return (
    <>
      <Dropdown.Root>
        <Dropdown.Trigger className="rounded p-1.5 hover:bg-black/5" aria-label="Section actions"><MoreHorizontal className="h-4 w-4" /></Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="end" sideOffset={4} className="z-50 min-w-[200px] rounded-lg border border-line bg-surface p-1 text-sm shadow-lg">
            <MenuItem onSelect={() => dispatch({ type: "moveGroup", id: g.id, dir: -1 })} disabled={index === 0}><ArrowUp className="h-4 w-4" /> Move section up</MenuItem>
            <MenuItem onSelect={() => dispatch({ type: "moveGroup", id: g.id, dir: 1 })} disabled={index === count - 1}><ArrowDown className="h-4 w-4" /> Move section down</MenuItem>
            <MenuItem onSelect={() => setEditPricing(true)}>% Section pricing override</MenuItem>
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
  const groups = sortedGroups(estimate);
  const customUnit = !(UNITS as readonly string[]).includes(it.unit);

  return (
    <>
      <tr className={cn("border-b border-line/70 align-middle", selected && "bg-brand-tint/50")}>
        <td className="px-2 text-center">
          <input type="checkbox" checked={selected} onChange={toggleSelected} aria-label={`Select ${it.name || "item"}`} className="h-4 w-4 accent-[var(--color-brand)]" />
        </td>
        <td className="px-1 py-1">
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(!expanded)} className="rounded p-0.5 text-muted hover:bg-black/5" aria-label={expanded ? "Hide item details" : "Show item details"} aria-expanded={expanded}>
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            <input data-focus={`${it.id}:name`} data-col="name" value={it.name} onChange={(e) => up({ name: e.target.value })} onKeyDown={onKey} className="cell font-medium" placeholder="Item name" aria-label="Item name" />
          </div>
          <div className="flex flex-wrap gap-1 pl-6">
            {it.pricingOverride && <span className="rounded bg-accent-tint px-1 text-[10px] font-semibold text-accent-dark">{it.pricingOverride.percent}% {it.pricingOverride.mode}</span>}
            {it.treatment === "pass_through" && <span className="rounded bg-brand-tint px-1 text-[10px] font-semibold text-brand">at cost</span>}
            {!it.showOnProposal && <span className="rounded bg-black/5 px-1 text-[10px] font-semibold text-muted">hidden from customer</span>}
            {!it.taxable && <span className="rounded bg-black/5 px-1 text-[10px] font-semibold text-muted">non-taxable</span>}
          </div>
        </td>
        <td className="px-1">
          <select value={it.costType} onChange={(e) => up({ costType: e.target.value as LineItem["costType"] })} className="cell" aria-label="Cost type">
            {COST_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </td>
        <td className="px-1">
          <div className="flex items-center gap-0.5">
          <input data-col="qty" value={it.quantity} onChange={(e) => up({ quantity: e.target.value })} onKeyDown={onKey} inputMode="decimal" className="cell tabular text-right" aria-label="Quantity" aria-invalid={invalid("quantity")} />
          <QuantityCalculator item={it} estimate={estimate} dispatch={dispatch} />
          </div>
        </td>
        <td className="px-1">
          {customUnit ? (
            <input value={it.unit} onChange={(e) => up({ unit: e.target.value || "each" })} className="cell" aria-label="Custom unit" onBlur={(e) => !e.target.value && up({ unit: "each" })} />
          ) : (
            <select value={it.unit} onChange={(e) => up({ unit: e.target.value === "__custom" ? "custom" : e.target.value })} className="cell" aria-label="Unit">
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              <option value="__custom">Custom…</option>
            </select>
          )}
        </td>
        <td className="px-1">
          <div className="relative">
            <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted">$</span>
            <input data-focus={`${it.id}:cost`} data-col="cost" value={it.unitCost} onChange={(e) => up({ unitCost: e.target.value })} onKeyDown={onKey} inputMode="decimal" placeholder="0.00" className="cell tabular pl-4 text-right" aria-label="Internal unit cost" aria-invalid={invalid("unitCost")} />
          </div>
        </td>
        <td className="tabular px-1 text-right text-ink-soft">{t ? formatCurrency(t.extendedCost) : "—"}</td>
        <td className="tabular px-1 text-right text-ink-soft">{t ? formatCurrency(t.unitPrice) : "—"}</td>
        <td className="tabular px-1 text-right font-semibold">{t ? formatCurrency(t.extendedPrice) : "—"}</td>
        <td className="px-1">
          <div className="flex justify-end">
            <Dropdown.Root>
              <Dropdown.Trigger className="rounded p-1.5 hover:bg-black/5" aria-label={`Actions for ${it.name || "item"}`}><MoreHorizontal className="h-4 w-4" /></Dropdown.Trigger>
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
                          <MenuItem key={g.id} onSelect={() => dispatch({ type: "moveItemToGroup", id: it.id, groupId: g.id })}>{g.name || "Untitled"}</MenuItem>
                        ))}
                      </Dropdown.SubContent>
                    </Dropdown.Portal>
                  </Dropdown.Sub>
                  <MenuItem onSelect={() => setEditPricing(true)}>% Override pricing</MenuItem>
                  <MenuItem onSelect={() => lib.saveItem(it)}><BookmarkPlus className="h-4 w-4" /> Save to favorites</MenuItem>
                  <Dropdown.Separator className="my-1 h-px bg-line" />
                  <MenuItem onSelect={() => dispatch({ type: "deleteItem", id: it.id })} danger><Trash2 className="h-4 w-4" /> Delete</MenuItem>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-line bg-paper/60">
          <td />
          <td colSpan={9} className="px-2 py-3">
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
        <tr><td colSpan={10}>
          <OverrideEditor title={`Pricing for "${it.name || "item"}"`} rule={it.pricingOverride ?? null} onClose={() => setEditPricing(false)} onSave={(r) => { up({ pricingOverride: r }); setEditPricing(false); }} />
        </td></tr>
      )}
    </>
  );
}

function AddFromLibrary({ group, estimate, suggestions, lib, dispatch }: { group: EstimateGroup; estimate: Estimate; suggestions: TemplateItem[]; lib: Lib; dispatch: Dispatch<Action> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);
  const s = q.trim().toLowerCase();
  const inEstimate = new Set(estimate.items.map((i) => i.name.toLowerCase()));
  const sug = suggestions.filter((x) => (!s || x.name.toLowerCase().includes(s)) && !inEstimate.has(x.name.toLowerCase())).slice(0, 12);
  const favs = lib.items.filter((x) => !s || x.name.toLowerCase().includes(s)).slice(0, 8);
  const asm = lib.assemblies.filter((x) => !s || x.name.toLowerCase().includes(s)).slice(0, 6);
  const custom = s && !sug.length && !favs.length ? parseTemplateItem(q.trim()) : null;

  return (
    <div className="relative" ref={ref}>
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}><Search className="h-4 w-4" /> Suggested & saved items</Button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-[340px] max-w-[90vw] rounded-lg border border-line bg-surface p-2 shadow-xl">
          <input autoFocus className="field field-sm" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search suggested and saved items" />
          <div className="mt-2 max-h-72 overflow-y-auto text-sm">
            {asm.length > 0 && <p className="px-2 pt-1 text-[11px] font-bold uppercase tracking-wider text-muted">Assemblies</p>}
            {asm.map((a) => (
              <button key={a.id} className="flex w-full justify-between rounded px-2 py-1.5 text-left hover:bg-paper" onClick={() => { dispatch({ type: "addItems", groupId: group.id, items: a.items }); setOpen(false); }}>
                <span><Layers className="mr-1 inline h-3.5 w-3.5" />{a.name}</span><span className="text-xs text-muted">{a.items.length} items</span>
              </button>
            ))}
            {favs.length > 0 && <p className="px-2 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted">Favorites</p>}
            {favs.map((f) => (
              <button key={f.id} className="flex w-full justify-between rounded px-2 py-1.5 text-left hover:bg-paper" onClick={() => { dispatch({ type: "addItem", groupId: group.id, from: { ...f, id: undefined } }); setOpen(false); }}>
                <span>{f.name}</span><span className="text-xs text-muted">{f.unitCost ? `${formatCurrency(f.unitCost)}/${UNIT_ABBR[f.unit] ?? f.unit}` : UNIT_ABBR[f.unit] ?? f.unit}</span>
              </button>
            ))}
            {sug.length > 0 && <p className="px-2 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted">Suggested for {estimate.trades.map((t) => getTrade(t)?.name ?? t).join(", ")}</p>}
            {sug.map((x) => (
              <button key={x.name} className="flex w-full justify-between rounded px-2 py-1.5 text-left hover:bg-paper" onClick={() => { dispatch({ type: "addItem", groupId: group.id, from: x }); setOpen(false); }}>
                <span>{x.name}</span><span className="text-xs text-muted">{UNIT_ABBR[x.unit] ?? x.unit} · no price</span>
              </button>
            ))}
            {custom && (
              <button className="w-full rounded px-2 py-1.5 text-left hover:bg-paper" onClick={() => { dispatch({ type: "addItem", groupId: group.id, from: { name: q.trim() } }); setOpen(false); }}>
                Add “{q.trim()}”
              </button>
            )}
            {!asm.length && !favs.length && !sug.length && !custom && <p className="px-2 py-3 text-muted">Nothing found.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
