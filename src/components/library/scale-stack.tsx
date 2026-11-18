"use client";
import { Calculator, Ruler } from "lucide-react";
import { useMemo, useState } from "react";
import type { Estimate } from "@/lib/estimate/types";
import { UNIT_ABBR } from "@/lib/trades/catalog";
import { calculatorMeasures, perLabel, scaleStack } from "@/lib/library/assemblies";
import { SCALE_UNITS, type SavedStack, type ScaleUnit, type StackScale, type StackItem } from "@/lib/library/saved-items";
import { Button } from "../ui/button";

const abbr = (u: string) => UNIT_ABBR[u] ?? u;
const valid = (v: string) => /^\d+(\.\d+)?$/.test(v.trim()) && Number(v) > 0;

/**
 * Adds a scaling assembly: the contractor enters the measure (or picks one a quantity calculator already
 * worked out in this estimate), sees every row's quantity, then adds the rows. Fixed rows stay as saved.
 */
export function ScaleStackForm({ stack, estimate, starter, onAdd, onCancel }: {
  stack: SavedStack; estimate: Pick<Estimate, "items" | "worksheet">; starter?: boolean;
  onAdd: (items: (StackItem & { quantity: string })[]) => void; onCancel: () => void;
}) {
  const scale = stack.scale!;
  const measures = useMemo(() => calculatorMeasures(estimate, scale.unit), [estimate, scale.unit]);
  const [m, setM] = useState(measures[0]?.converted ?? "");
  const ok = valid(m);
  const rows = ok ? scaleStack(stack, m) : stack.items.map((i) => ({ ...i, quantity: i.per ? "–" : i.quantity }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ok) onAdd(scaleStack(stack, m)); }} data-testid="scale-stack-form">
      <label className="label" htmlFor="scale-measure">{scale.label} ({abbr(scale.unit)})</label>
      <div className="relative w-44">
        <input id="scale-measure" inputMode="decimal" className="field tabular pr-12" value={m} onChange={(e) => setM(e.target.value)} placeholder="0" autoFocus autoComplete="off" aria-invalid={m !== "" && !ok} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">{abbr(scale.unit)}</span>
      </div>
      {measures.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Measurements from your calculators">
          {measures.map((x) => (
            <button key={x.label + x.converted} type="button" onClick={() => setM(x.converted)} data-testid="scale-measure-chip"
              className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-2.5 text-xs ${m === x.converted ? "border-brand bg-brand-tint text-brand" : "border-line hover:border-brand/50"}`}>
              <Calculator className="h-3.5 w-3.5" aria-hidden /> {Number(x.converted)} {abbr(scale.unit)} · {x.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">Tip: measure a row with its calculator first (for example the {scale.calc === "roof" ? "roof planes" : "area"} calculator). Its result then shows here.</p>
      )}
      <div className="mt-4 overflow-hidden rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-paper text-left text-xs text-muted"><tr><th className="px-3 py-1.5 font-semibold">Row</th><th className="px-3 py-1.5 text-right font-semibold">Quantity</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id} data-testid="scale-row">
                <td className="px-3 py-1.5"><span className="block">{r.name}</span><span className="block text-xs text-muted">{perLabel(r, scale)}</span></td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular font-semibold">{r.quantity} {abbr(r.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {starter && <p className="mt-2 text-xs text-muted">Starter ratios with no prices. Check the quantities and add your rates. Save it to your stacks from Saved Items &amp; Pricing to keep your own ratios and rates.</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!ok} data-testid="scale-stack-add">Add {rows.length} rows</Button>
      </div>
    </form>
  );
}

/** Fields for "scale with a measurement" when saving or editing a stack. */
export function ScaleFields({ value, onChange, measureLabel, measure, onMeasure }: {
  value: StackScale | null; onChange: (s: StackScale | null) => void;
  /** When saving from an estimate: what the current quantities were for. */
  measureLabel?: string; measure?: string; onMeasure?: (v: string) => void;
}) {
  return (
    <fieldset className="mt-3 rounded-lg border border-line p-3">
      <label className="flex min-h-9 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked ? { unit: "square foot", label: "Area" } : null)} data-testid="scale-toggle" />
        <Ruler className="h-4 w-4 text-brand" aria-hidden /> Scale quantities with a measurement
      </label>
      {value && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="scale-unit">Measured in</label>
            <select id="scale-unit" className="field" value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as ScaleUnit })}>
              {SCALE_UNITS.map((u) => <option key={u} value={u}>{u === "each" ? "each (count)" : `${u} (${abbr(u)})`}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="scale-label">Measure name</label>
            <input id="scale-label" className="field" maxLength={120} value={value.label} onChange={(e) => onChange({ ...value, label: e.target.value })} placeholder="e.g. Roof area" />
          </div>
          {onMeasure && (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="scale-for">{measureLabel ?? "These quantities are for"}</label>
              <div className="relative w-44">
                <input id="scale-for" inputMode="decimal" className="field tabular pr-12" value={measure ?? ""} onChange={(e) => onMeasure(e.target.value)} placeholder="e.g. 24" data-testid="scale-for" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">{abbr(value.unit)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">Each row&apos;s amount per {abbr(value.unit)} is its quantity divided by this. You can fine-tune them in Saved Items &amp; Pricing.</p>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

export const isValidMeasure = valid;
