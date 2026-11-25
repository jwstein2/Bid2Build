"use client";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { COST_TYPES, UNITS, trades } from "@/lib/trades/catalog";
import { itemPath, pathOptions, savedItemSchema, typeLabel, type SavedItem } from "@/lib/library/saved-items";
import { categoryPath, exactCategory, parseCategoryPath } from "@/lib/library/categories";
import { CategoryCombobox } from "./category-combobox";
import type { LibraryResult } from "../builder/library";
import { Button } from "../ui/button";

export function blankSavedItem(trade?: string | null): SavedItem {
  return { id: crypto.randomUUID(), name: "", trade: trade ?? null, category: "", costType: "labor", treatment: "marked_up", quantity: "", unit: "square foot", unitCost: "", taxable: false };
}

/**
 * Create / edit one Saved Item: every field an estimate row has (name, description, trade, category,
 * type, default quantity, unit, default rate, taxable, billed at cost). Used on the library page and
 * inside the builder's Suggested & Saved Items picker.
 */
export function SavedItemForm({ initial, items, onSave, onCancel, submitLabel = "Save Item" }: {
  initial: SavedItem;
  items: SavedItem[];
  onSave: (s: SavedItem) => Promise<LibraryResult>;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const id = useId();
  const [v, setV] = useState<SavedItem>({ ...initial, treatment: initial.treatment ?? "marked_up", taxable: initial.taxable ?? false, description: initial.description ?? "", category: initial.category ?? "", quantity: initial.quantity ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<SavedItem>) => setV((x) => ({ ...x, ...patch }));
  const customUnit = !(UNITS as readonly string[]).includes(v.unit);
  // Type and Category are one list: "Labor : Contractor" is Type Labor, category Contractor.
  const [path, setPath] = useState(() => itemPath({ costType: initial.costType, category: initial.category ?? "" }));
  const options = pathOptions(v.trade, items);
  const parse = (text: string) => parseCategoryPath(text, COST_TYPES, v.costType);
  const resolvePath = (text: string) => { const p = parse(text); return categoryPath(typeLabel(p.type), p.category); };
  const picked = parse(exactCategory(resolvePath(path), options) ?? path);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = { ...v, costType: picked.type, category: picked.category, unitCost: v.unitCost.replace(/[$,\s]/g, ""), quantity: (v.quantity ?? "").replace(/[,\s]/g, "") };
    const parsed = savedItemSchema.safeParse(clean);
    if (!parsed.success) {
      const errs = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
      setErrors(errs);
      // Fields without their own message (shouldn't happen) still get a visible explanation.
      const shown = ["name", "unitCost", "quantity", "pricingOverride"];
      setErr(Object.keys(errs).some((k) => !shown.includes(k)) ? "Some details are invalid. Check the fields and try again." : null);
      return;
    }
    setErrors({}); setBusy(true); setErr(null);
    const r = await onSave(parsed.data as SavedItem);
    setBusy(false);
    if (!r.ok) setErr(r.message);
  }

  const f = (name: string) => `${id}-${name}`;
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={f("name")}>Item name</label>
        <input id={f("name")} className="field" value={v.name} maxLength={300} onChange={(e) => set({ name: e.target.value })} aria-invalid={Boolean(errors.name)} placeholder="e.g. Complete Framing" autoComplete="off" />
        {errors.name && <p className="mt-1 text-xs text-danger">{errors.name}</p>}
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={f("desc")}>Description <span className="font-normal text-muted">(can appear on proposals)</span></label>
        <textarea id={f("desc")} className="field text-sm" rows={2} maxLength={4000} value={v.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor={f("trade")}>Trade</label>
        <select id={f("trade")} className="field" value={v.trade ?? ""} onChange={(e) => set({ trade: e.target.value || null })}>
          <option value="">General (any trade)</option>
          {trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={f("category")}>Category</label>
        <CategoryCombobox id={f("category")} value={path} options={options} onChange={setPath} resolve={resolvePath} describedBy={f("cathint")} placeholder="e.g. Labor : Contractor" />
        <p id={f("cathint")} className="mt-1 text-xs text-muted" data-testid="category-type">Type: <b className="font-semibold text-ink-soft">{typeLabel(picked.type)}</b>. The first level is the type (Labor, Material, Equipment…). Add levels with a colon.</p>
      </div>
      <div>
        <label className="label" htmlFor={f("qty")}>Quantity <span className="font-normal text-muted">(default, optional)</span></label>
        <input id={f("qty")} className="field tabular" inputMode="decimal" value={v.quantity ?? ""} onChange={(e) => set({ quantity: e.target.value })} aria-invalid={Boolean(errors.quantity)} placeholder="1" />
        {errors.quantity && <p className="mt-1 text-xs text-danger">{errors.quantity}</p>}
      </div>
      <div>
        <label className="label" htmlFor={f("unit")}>Unit</label>
        {customUnit ? (
          <input id={f("unit")} className="field" value={v.unit} maxLength={40} onChange={(e) => set({ unit: e.target.value })} onBlur={(e) => !e.target.value.trim() && set({ unit: "each" })} />
        ) : (
          <select id={f("unit")} className="field" value={v.unit} onChange={(e) => set({ unit: e.target.value === "__custom" ? "custom" : e.target.value })}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            <option value="__custom">Custom…</option>
          </select>
        )}
      </div>
      <div>
        <label className="label" htmlFor={f("rate")}>Unit cost <span className="font-normal text-muted">(your cost per unit)</span></label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
          <input id={f("rate")} className="field tabular pl-7" inputMode="decimal" value={v.unitCost} onChange={(e) => set({ unitCost: e.target.value })} aria-invalid={Boolean(errors.unitCost)} placeholder="0.00" />
        </div>
        {errors.unitCost && <p className="mt-1 text-xs text-danger">{errors.unitCost}</p>}
      </div>
      <div className="text-sm">
        <p className="label">Tax</p>
        <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={v.taxable} onChange={(e) => set({ taxable: e.target.checked })} className="h-4 w-4 accent-[var(--color-brand)]" /> Taxable</label>
      </div>
      <fieldset className="text-sm">
        <legend className="label">Pricing</legend>
        <label className="flex min-h-9 items-center gap-2"><input type="radio" name={f("treat")} checked={v.treatment !== "pass_through" && !v.pricingOverride} onChange={() => set({ treatment: "marked_up", pricingOverride: null })} className="h-4 w-4 accent-[var(--color-brand)]" /> Apply the bid&apos;s markup</label>
        <label className="flex min-h-9 items-center gap-2"><input type="radio" name={f("treat")} checked={v.treatment !== "pass_through" && Boolean(v.pricingOverride)} onChange={() => set({ treatment: "marked_up", pricingOverride: v.pricingOverride ?? { mode: "markup", percent: "0" } })} className="h-4 w-4 accent-[var(--color-brand)]" data-testid="saved-item-own-markup" /> Save its own markup or margin</label>
        {v.treatment !== "pass_through" && v.pricingOverride && (
          <div className="ml-6 flex flex-wrap items-center gap-2 pb-1">
            <label className="sr-only" htmlFor={f("ovpct")}>Percent</label>
            <input id={f("ovpct")} className="field tabular w-20" inputMode="decimal" value={v.pricingOverride.percent} onChange={(e) => set({ pricingOverride: { ...v.pricingOverride!, percent: e.target.value.replace(/[%\s]/g, "") } })} aria-invalid={Boolean(errors.pricingOverride)} data-testid="saved-item-own-markup-pct" />
            <span aria-hidden>%</span>
            <label className="sr-only" htmlFor={f("ovmode")}>Markup or margin</label>
            <select id={f("ovmode")} className="field w-auto" value={v.pricingOverride.mode} onChange={(e) => set({ pricingOverride: { ...v.pricingOverride!, mode: e.target.value as "markup" | "margin" } })}>
              <option value="markup">markup</option>
              <option value="margin">margin</option>
            </select>
            <p className="w-full text-xs text-muted">Used every time you add this item, e.g. 0% markup on a dumpster. You can still change it on the bid.</p>
            {errors.pricingOverride && <p className="w-full text-xs text-danger">Markup 0 to 1000%, margin 0 to 99.99%, up to 4 decimals.</p>}
          </div>
        )}
        <label className="flex min-h-9 items-center gap-2"><input type="radio" name={f("treat")} checked={v.treatment === "pass_through"} onChange={() => set({ treatment: "pass_through", pricingOverride: null })} className="h-4 w-4 accent-[var(--color-brand)]" /> Bill at cost (separate pass-through charge)</label>
      </fieldset>
      <p className="text-xs text-muted sm:col-span-2">Changing a saved rate only affects items you add from now on. Existing estimates and sent proposals keep their prices.</p>
      {err && <p role="alert" className="text-sm text-danger sm:col-span-2">{err}</p>}
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{submitLabel}</Button>
      </div>
    </form>
  );
}
