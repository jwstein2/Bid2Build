"use client";
import { AlertTriangle, Trash2 } from "lucide-react";
import { SHAPES, abbr, fmt, type CalcResult, type CalcSection, type FieldDef } from "@/lib/calculators";
import { D } from "@/lib/estimate/money";
import { cn } from "@/lib/cn";

/**
 * Field, section and result building blocks shared by the builder's quantity calculator and the
 * free public calculators (/tools). Presentational only: no estimate state.
 */
export function SectionEditor({ section: s, index, shapes, deductions, canRemove, errors, onShape, onValue, onPatch, onRemove, onBlurField, onFocusField, onEnter, namePlaceholder }: {
  namePlaceholder?: string; section: CalcSection; index: number; shapes: { id: string; label: string }[]; deductions: boolean; canRemove: boolean; errors: CalcResult["errors"];
  onShape: (shape: string) => void; onValue: (key: string, value: string) => void; onPatch: (p: Partial<CalcSection>) => void; onRemove: () => void;
  onBlurField: (key: string) => void; onFocusField: (e: React.FocusEvent<HTMLElement>) => void; onEnter: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const shape = SHAPES[s.shape];
  const idBase = `sec-${s.id}`;
  return (
    <fieldset className={cn("rounded-lg border px-3 pb-2.5 pt-2", s.deduct ? "border-dashed border-warn/40 bg-warn-tint/40" : "border-line bg-paper/60")}>
      <legend className="sr-only">{s.label || `${s.deduct ? "Deduction" : "Section"} ${index + 1}`}</legend>
      <div className="mb-1 flex items-center gap-1.5">
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", s.deduct ? "bg-warn/15 text-warn" : "bg-navy/10 text-navy")}>{s.deduct ? "−" : "+"} {index + 1}</span>
        <label className="sr-only" htmlFor={`${idBase}-label`}>Section name</label>
        <input id={`${idBase}-label`} className="cell min-w-0 flex-1 py-1 text-xs" placeholder={s.deduct ? "Name, e.g. Windows (optional)" : namePlaceholder ?? "Name, e.g. Front wall (optional)"} value={s.label ?? ""} maxLength={80} onChange={(e) => onPatch({ label: e.target.value })} />
        {canRemove && <button onClick={onRemove} className="grid h-8 w-8 shrink-0 place-items-center rounded text-muted hover:bg-black/5 hover:text-danger" aria-label={`Remove ${s.label || `section ${index + 1}`}`}><Trash2 className="h-3.5 w-3.5" /></button>}
      </div>
      {(shapes.length > 1 || deductions) && (
        <div className="mb-1.5 flex items-center gap-2">
          {shapes.length > 1 && (
            <>
              <label className="sr-only" htmlFor={`${idBase}-shape`}>Shape</label>
              <select id={`${idBase}-shape`} className="field field-sm min-w-0 flex-1 py-1 text-xs" value={s.shape} onChange={(e) => onShape(e.target.value)}>
                {shapes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </>
          )}
          {deductions && (
            <label className="flex min-h-8 shrink-0 items-center gap-1 text-xs text-ink-soft">
              <input type="checkbox" className="accent-[var(--color-warn)]" checked={Boolean(s.deduct)} onChange={(e) => onPatch({ deduct: e.target.checked || undefined })} /> Subtract
            </label>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 sm:grid-cols-3">
        {shape?.fields.map((f) => (
          <FieldInput key={f.key} id={`${idBase}-${f.key}`} calcKey={`${s.id}:${f.key}`} field={f} value={s.values[f.key] ?? ""} onChange={(v) => onValue(f.key, v)} onBlur={() => onBlurField(f.key)} onFocus={onFocusField} onEnter={onEnter} invalid={errors.some((e) => e.sectionId === s.id && e.field === f.key)} compact />
        ))}
      </div>
    </fieldset>
  );
}

export function FieldInput({ id, calcKey, field: f, value, onChange, onBlur, onFocus, onEnter, invalid, compact, wide }: {
  id: string; calcKey: string; field: FieldDef; value: string; onChange: (v: string) => void; onBlur?: () => void;
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void; onEnter?: (e: React.KeyboardEvent<HTMLInputElement>) => void; invalid?: boolean; compact?: boolean; wide?: boolean;
}) {
  const label = (
    <label htmlFor={id} className={cn("block font-semibold text-ink-soft", compact ? "mb-0.5 text-[11px]" : "mb-0.5 text-xs")}>
      {f.label}{f.optional && f.kind !== "select" ? <span className="font-normal text-muted"> (optional)</span> : null}
    </label>
  );
  if (f.kind === "select") {
    return (
      <div className={cn(wide && "col-span-2")}>
        {label}
        <select id={id} className="field field-sm" value={value || f.initial || ""} onChange={(e) => onChange(e.target.value)}>
          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }
  const helpId = f.help ? `${id}-help` : undefined;
  return (
    <div>
      {label}
      <div className="relative">
        <input
          id={id}
          data-calc-field
          data-calc-key={calcKey}
          className={cn("field field-sm tabular", f.unit && "pr-10")}
          inputMode={f.kind === "feet" ? "text" : "decimal"}
          enterKeyHint="next"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          placeholder={f.placeholder ?? (f.kind === "feet" ? `e.g. 12'6"` : "")}
          aria-invalid={invalid || undefined}
          aria-describedby={helpId}
          onChange={(e) => onChange(e.target.value.slice(0, 20))}
          onBlur={onBlur}
          onFocus={onFocus}
          onKeyDown={(e) => { if (e.key === "Enter") { if (onEnter) onEnter(e); else e.preventDefault(); } }}
        />
        {f.unit && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted">{f.unit}</span>}
      </div>
      {f.help && !compact && <p id={helpId} className="mt-0.5 text-[11px] leading-tight text-muted">{f.help}</p>}
      {f.help && compact && <span id={helpId} className="sr-only">{f.help}</span>}
    </div>
  );
}

export function ResultBlock({ result, errors, pending, id }: { result: CalcResult; errors: CalcResult["errors"]; pending: boolean; id: string }) {
  return (
    <div id={id} className="mt-3" aria-live="polite">
      {errors.length > 0 ? (
        <div className="rounded-lg border border-danger/25 bg-danger-tint px-3 py-2 text-xs text-danger">
          <ul className="list-disc space-y-0.5 pl-4">{errors.slice(0, 4).map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </div>
      ) : pending ? (
        <div className="rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-muted">Enter the measurements above to see the result.</div>
      ) : (
        <div className="rounded-lg border border-line bg-brand-tint/50 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Result</span>
            <span className="font-display text-xl font-extrabold tabular text-navy">{fmt(new D(result.quantity ?? "0"))} <span className="text-sm font-bold">{abbr(result.unit)}</span></span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted">{result.formula}</p>
          <ol className="mt-2 space-y-0.5 border-t border-line pt-1.5 text-xs">
            {result.lines.map((l, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className={cn("shrink-0 font-semibold", l.deduct ? "text-warn" : "text-ink-soft")}>{l.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted" title={l.detail}>{l.detail}</span>
                <span className="shrink-0 tabular font-semibold text-ink">{l.value}</span>
              </li>
            ))}
          </ol>
          {result.exact && result.quantity && result.exact !== result.quantity && (
            <p className="mt-1 text-[11px] text-muted">Exact {fmt(new D(result.exact), 4)}. {result.rounding}</p>
          )}
        </div>
      )}
      {result.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg border border-warn/25 bg-warn-tint px-3 py-2 text-xs text-ink-soft">
          {result.warnings.map((w, i) => <li key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warn" aria-hidden />{w}</li>)}
        </ul>
      )}
    </div>
  );
}
