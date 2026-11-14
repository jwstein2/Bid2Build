"use client";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { COST_TYPES, UNITS, trades } from "@/lib/trades/catalog";
import { categoryOptions, savedItemSchema, type SavedItem } from "@/lib/library/saved-items";
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
  const cats = categoryOptions(v.trade, items);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = { ...v, unitCost: v.unitCost.replace(/[$,\s]/g, ""), quantity: (v.quantity ?? "").replace(/[,\s]/g, "") };
    const parsed = savedItemSchema.safeParse(clean);
    if (!parsed.success) {
      const errs = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
      setErrors(errs);
      // Fields without their own message (shouldn't happen) still get a visible explanation.
      const shown = ["name", "unitCost", "quantity"];
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
      <div>
        <label className="label" htmlFor={f("trade")}>Trade</label>
        <select id={f("trade")} className="field" value={v.trade ?? ""} onChange={(e) => set({ trade: e.target.value || null })}>
          <option value="">General (any trade)</option>
          {trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={f("category")}>Category</label>
        <input id={f("category")} className="field" list={f("cats")} value={v.category ?? ""} maxLength={120} onChange={(e) => set({ category: e.target.value })} placeholder={cats[0] ? `e.g. ${cats[0]}` : "e.g. Labor"} autoComplete="off" />
        <datalist id={f("cats")}>{cats.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div>
        <label className="label" htmlFor={f("type")}>Type</label>
        <select id={f("type")} className="field" value={v.costType} onChange={(e) => set({ costType: e.target.value as SavedItem["costType"] })}>
          {COST_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
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
        <label className="label" htmlFor={f("rate")}>Default rate <span className="font-normal text-muted">(your cost per unit)</span></label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
          <input id={f("rate")} className="field tabular pl-7" inputMode="decimal" value={v.unitCost} onChange={(e) => set({ unitCost: e.target.value })} aria-invalid={Boolean(errors.unitCost)} placeholder="0.00" />
        </div>
        {errors.unitCost && <p className="mt-1 text-xs text-danger">{errors.unitCost}</p>}
      </div>
      <div>
        <label className="label" htmlFor={f("qty")}>Default quantity <span className="font-normal text-muted">(optional)</span></label>
        <input id={f("qty")} className="field tabular" inputMode="decimal" value={v.quantity ?? ""} onChange={(e) => set({ quantity: e.target.value })} aria-invalid={Boolean(errors.quantity)} placeholder="1" />
        {errors.quantity && <p className="mt-1 text-xs text-danger">{errors.quantity}</p>}
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={f("desc")}>Description <span className="font-normal text-muted">(can appear on proposals)</span></label>
        <textarea id={f("desc")} className="field text-sm" rows={2} maxLength={4000} value={v.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm sm:col-span-2">
        <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={v.taxable} onChange={(e) => set({ taxable: e.target.checked })} className="h-4 w-4 accent-[var(--color-brand)]" /> Taxable</label>
        <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={v.treatment === "pass_through"} onChange={(e) => set({ treatment: e.target.checked ? "pass_through" : "marked_up" })} className="h-4 w-4 accent-[var(--color-brand)]" /> Bill at cost (no markup)</label>
      </div>
      <p className="text-xs text-muted sm:col-span-2">Changing a saved rate only affects items you add from now on. Existing estimates and sent proposals keep their prices.</p>
      {err && <p role="alert" className="text-sm text-danger sm:col-span-2">{err}</p>}
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{submitLabel}</Button>
      </div>
    </form>
  );
}
