"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Calculator, Check, Minus, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch } from "react";
import {
  CALCULATORS, SHAPES, abbr, calculatorsFor, fmt, newInput, newSection, recordMatchesItem, runCalculator,
  type CalcId, type CalcInput, type CalcPreset, type CalcRecord, type CalcResult, type CalcSection, type FieldDef,
} from "@/lib/calculators";
import { D } from "@/lib/estimate/money";
import type { Estimate, LineItem } from "@/lib/estimate/types";
import { cn } from "@/lib/cn";
import { Button } from "../../ui/button";
import { useVisualViewport } from "../../ui/use-visual-viewport";
import type { Action } from "../state";

/**
 * Optional quantity calculator for one line item. Collapsed to a small icon beside the quantity
 * field; opens as a popover on desktop and a bottom sheet on phones. It only changes the item's
 * quantity when the contractor presses "Use", and asks first before replacing a different,
 * manually entered quantity. It never adds line items, prices or credits.
 *
 * Phones and tablets (mobile-first; contractors use this on site):
 *  - The sheet sits above the on-screen keyboard (visualViewport), so fields and the Use button stay visible.
 *  - Tapping outside while typing only closes the keyboard; it never throws the calculator away.
 *  - Measurements typed but not applied survive closing and reopening the calculator for that item.
 *  - Blank fields aren't flagged red while the contractor is still filling them in.
 *  - Fields use a 16px font on touch screens so iOS doesn't zoom the page on focus.
 */
export function QuantityCalculator({ item, estimate, dispatch, className }: { item: LineItem; estimate: Estimate; dispatch: Dispatch<Action>; className?: string }) {
  const presets = useMemo(() => calculatorsFor(item, estimate.trades), [item, estimate.trades]);
  const record = estimate.worksheet?.calcs?.[item.id];
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (item.isExample || (!presets.length && !record)) return null;

  const matches = recordMatchesItem(record, item);
  const name = item.name.trim() || "this item";
  const status = record ? (matches ? `Calculated: ${fmt(new D(record.result))} ${abbr(record.unit)}.` : "Quantity was edited after calculating.") : "";

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={cn(
            "relative inline-grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition hover:bg-brand-tint hover:text-brand",
            record && matches && "text-ok",
            open && "bg-brand-tint text-brand",
            className,
          )}
          aria-label={`Calculate quantity for ${name}${status ? `. ${status}` : ""}`}
          title={status || "Quantity calculator"}
        >
          <Calculator className="h-4 w-4" aria-hidden />
          {record && <span className={cn("absolute right-1 top-1 h-1.5 w-1.5 rounded-full", matches ? "bg-teal" : "bg-warn")} aria-hidden />}
        </button>
      </Dialog.Trigger>
      {open && <CalculatorPanel item={item} estimate={estimate} dispatch={dispatch} presets={presets} record={record} anchor={triggerRef} onClose={() => setOpen(false)} />}
    </Dialog.Root>
  );
}

/* ----------------------------------------------------------------------------------------------- */

const PANEL_W = 420;

/** Measurements typed but not yet applied, per line item, for this page session. */
interface PanelDraft { active: CalcId; inputs: Partial<Record<CalcId, CalcInput>>; outputs: Partial<Record<CalcId, string>>; basis?: string }
const unapplied = new Map<string, PanelDraft>();
export function clearUnappliedCalculation(itemId: string) { unapplied.delete(itemId); }

/** Sheet layout on phones and on touch tablets; anchored popover on desktop. */
function useSheetLayout() {
  const query = "(max-width: 639px), (pointer: coarse) and (max-width: 1100px)";
  const [sheet, setSheet] = useState(true);
  useLayoutEffect(() => {
    const mq = window.matchMedia?.(query);
    const update = () => setSheet(mq ? mq.matches : window.innerWidth < 640);
    update();
    mq?.addEventListener?.("change", update);
    return () => mq?.removeEventListener?.("change", update);
  }, []);
  return sheet;
}

function usePanelPosition(anchor: React.RefObject<HTMLElement | null>, sheet: boolean) {
  const [pos, setPos] = useState<{ mobile: boolean; top?: number; left?: number; maxHeight?: number; above?: boolean }>({ mobile: true });
  useLayoutEffect(() => {
    // The sheet never follows the trigger, so keyboard-driven resizes can't move it off screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- layout mode comes from a media query read after mount
    if (sheet) { setPos({ mobile: true }); return; }
    const place = () => {
      const el = anchor.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (!el) { setPos({ mobile: true }); return; }
      const r = el.getBoundingClientRect();
      const left = Math.max(12, Math.min(r.right - PANEL_W, vw - PANEL_W - 12));
      const below = vh - r.bottom - 16;
      const aboveSpace = r.top - 16;
      if (below >= 560 || below >= aboveSpace) setPos({ mobile: false, top: r.bottom + 6, left, maxHeight: Math.max(240, below) });
      else setPos({ mobile: false, top: Math.max(12, r.top - 6 - Math.min(aboveSpace, 640)), left, maxHeight: Math.min(aboveSpace, 640), above: true });
    };
    // Position depends on the trigger's on-screen rect, which is only readable after layout.
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor, sheet]);
  return pos;
}

function CalculatorPanel({ item, estimate, dispatch, presets: basePresets, record, anchor, onClose }: {
  item: LineItem; estimate: Estimate; dispatch: Dispatch<Action>; presets: CalcPreset[]; record?: CalcRecord;
  anchor: React.RefObject<HTMLButtonElement | null>; onClose: () => void;
}) {
  // Keep a saved calculation reachable even if the item's unit changed since.
  const presets = useMemo(() => (record && !basePresets.some((p) => p.calc === record.calc) ? [{ calc: record.calc, output: record.output }, ...basePresets] : basePresets), [basePresets, record]);
  // Reopen with unapplied measurements if the calculator was closed before "Use" (and nothing was applied since).
  const [draft] = useState(() => {
    const d = unapplied.get(item.id);
    return d && d.basis === record?.appliedAt && presets.some((p) => p.calc === d.active) ? d : null;
  });
  const [active, setActive] = useState<CalcId>(draft?.active ?? record?.calc ?? presets[0].calc);
  const [inputs, setInputs] = useState<Partial<Record<CalcId, CalcInput>>>(() => draft?.inputs ?? (record ? { [record.calc]: structuredClone(record.input) } : {}));
  const [outputs, setOutputs] = useState<Partial<Record<CalcId, string>>>(() => draft?.outputs ?? (record ? { [record.calc]: record.output } : {}));
  const [confirming, setConfirming] = useState(false);
  // Validation: blank fields stay quiet until the contractor tries to use the result; a wrong value
  // shows once they leave that field.
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const sheet = useSheetLayout();
  const pos = usePanelPosition(anchor, sheet);
  const vv = useVisualViewport(pos.mobile);
  const contentRef = useRef<HTMLDivElement>(null);
  // Whether a calculator field had focus (keyboard up) when the current outside tap began. Radix
  // reports touch taps outside only on click, after the field has already lost focus.
  const typingAtTap = useRef(false);
  useEffect(() => {
    const onDown = () => {
      const a = document.activeElement as HTMLElement | null;
      typingAtTap.current = Boolean(a && contentRef.current?.contains(a) && a.matches("input, select, textarea"));
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  useEffect(() => {
    if (Object.keys(inputs).length === 0 && !draft) return;
    unapplied.set(item.id, { active, inputs, outputs, basis: record?.appliedAt });
  }, [item.id, active, inputs, outputs, record?.appliedAt, draft]);

  const preset = presets.find((p) => p.calc === active) ?? presets[0];
  const def = CALCULATORS[preset.calc];
  const input = inputs[preset.calc] ?? newInput(preset);
  const output = outputs[preset.calc] ?? preset.output ?? def.outputs[0].id;
  const result = useMemo(() => runCalculator(preset.calc, input, output), [preset.calc, input, output]);
  const fieldKey = (sectionId: string | undefined, field: string | undefined) => `${preset.calc}:${sectionId ?? "-"}:${field ?? "-"}`;
  const shownErrors = attempted ? result.errors : result.errors.filter((e) => !e.empty && (!e.field || touched.has(fieldKey(e.sectionId, e.field))));
  const hiddenErrors = result.errors.length - shownErrors.length;
  const touch = (sectionId: string | undefined, field: string) => setTouched((t) => (t.has(fieldKey(sectionId, field)) ? t : new Set(t).add(fieldKey(sectionId, field))));

  const setInput = (next: CalcInput) => { setInputs((m) => ({ ...m, [preset.calc]: next })); setConfirming(false); };
  const patchSection = (id: string, patch: Partial<CalcSection>) => setInput({ ...input, sections: input.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const setValue = (id: string, key: string, value: string) => setInput({ ...input, sections: input.sections.map((s) => (s.id === id ? { ...s, values: { ...s.values, [key]: value } } : s)) });
  const setOption = (key: string, value: string) => setInput({ ...input, options: { ...input.options, [key]: value } });
  const changeShape = (s: CalcSection, shape: string) => {
    const fresh = newSection(shape, s.deduct);
    patchSection(s.id, { shape, values: { ...fresh.values, ...Object.fromEntries(Object.entries(s.values).filter(([k]) => SHAPES[shape]?.fields.some((f) => f.key === k))) } });
  };

  const current = item.quantity.trim();
  const currentNum = Number(current);
  const resultNum = result.quantity !== null ? Number(result.quantity) : NaN;
  const sameAsCurrent = result.quantity !== null && currentNum === resultNum && item.unit === result.unit;
  // A quantity the contractor typed (or edited after calculating) is never replaced without asking.
  const needsConfirm = !sameAsCurrent && current !== "" && currentNum !== 0 && !(record && recordMatchesItem(record, item) && record.calc === preset.calc);
  const unitChanges = result.quantity !== null && result.unit !== item.unit;
  const canApply = result.ok && result.quantity !== null && resultNum > 0 && !sameAsCurrent;
  // With entries still to fill in, "Use" stays pressable: it points at what's missing instead.
  const canPress = canApply || (result.errors.length > 0 && !sameAsCurrent);

  const apply = () => {
    if (result.errors.length) {
      setAttempted(true);
      const first = result.errors.find((e) => e.field);
      const root = contentRef.current;
      const el = first && root?.querySelector<HTMLInputElement>(`[data-calc-key="${CSS.escape(`${first.sectionId ?? "-"}:${first.field}`)}"]`);
      (el ?? root?.querySelector<HTMLInputElement>("input[data-calc-field]"))?.focus();
      return;
    }
    if (!canApply || result.quantity === null) return;
    if (needsConfirm && !confirming) { setConfirming(true); return; }
    dispatch({ type: "applyCalculation", itemId: item.id, record: { v: 1, calc: preset.calc, output, input, result: result.quantity, unit: result.unit, appliedAt: new Date().toISOString() } });
    unapplied.delete(item.id);
    onClose();
  };
  const forget = (restore?: boolean) => { unapplied.delete(item.id); dispatch({ type: "clearCalculation", itemId: item.id, restore }); onClose(); };

  // Keep the field being typed in visible above the keyboard once it has opened.
  const onFieldFocus = (e: React.FocusEvent<HTMLElement>) => {
    if (!pos.mobile) return;
    const el = e.currentTarget;
    window.setTimeout(() => el.scrollIntoView({ block: "nearest" }), 320);
  };
  // Enter / "Next" on the phone keyboard moves to the next measurement.
  const onFieldEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const fields = [...(contentRef.current?.querySelectorAll<HTMLInputElement>("input[data-calc-field]") ?? [])];
    const next = fields[fields.indexOf(e.currentTarget) + 1];
    if (next) next.focus(); else e.currentTarget.blur();
  };

  const matches = recordMatchesItem(record, item);
  const titleId = `calc-title-${item.id}`;

  return (
    <Dialog.Portal>
      <Dialog.Overlay className={cn("fixed inset-0 z-50", pos.mobile ? "bg-ink/40" : "bg-ink/5")} />
      <Dialog.Content
        ref={contentRef}
        aria-labelledby={titleId}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const root = e.currentTarget as HTMLElement;
          // Desktop: straight into the first measurement. Touch: don't pop the keyboard while the
          // sheet is still opening; the contractor taps the field they want.
          if (pos.mobile || sheet) root.focus({ preventScroll: true });
          else root.querySelector<HTMLInputElement>("input[data-calc-field]")?.focus();
        }}
        onFocusOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          if (!pos.mobile) return;
          // A tap above the sheet while typing just closes the keyboard; the calculator stays open.
          if (typingAtTap.current) {
            e.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur();
          }
        }}
        tabIndex={-1}
        className={cn(
          "calc-panel fixed z-50 flex flex-col overflow-hidden border border-line bg-surface shadow-[var(--shadow-raised)] outline-none",
          pos.mobile ? "inset-x-0 bottom-0 mx-auto max-h-[88dvh] w-full max-w-xl rounded-t-2xl" : "w-[420px] rounded-xl",
        )}
        style={pos.mobile ? (vv ? { bottom: vv.inset, maxHeight: Math.max(220, Math.round(vv.height * 0.94)) } : undefined) : { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-2 border-b border-line px-4 pb-2 pt-3">
          {pos.mobile && <span className="pointer-events-none absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line-strong" aria-hidden />}
          <div className="min-w-0 flex-1">
            <Dialog.Title id={titleId} className="flex items-center gap-1.5 font-display text-[15px] font-bold">
              <Calculator className="h-4 w-4 text-accent-ink" aria-hidden /> {preset.label ?? def.name}
            </Dialog.Title>
            <p className="truncate text-xs text-muted">For <span className="font-semibold text-ink-soft">{item.name || "untitled item"}</span> · now {current || "0"} {abbr(item.unit)}</p>
          </div>
          <Dialog.Close className="rounded p-1.5 text-muted hover:bg-black/5" aria-label="Close calculator"><X className="h-4 w-4" /></Dialog.Close>
        </div>

        {/* Calculator choice */}
        {presets.length > 1 && (
          <div role="tablist" aria-label="Calculator type" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-1.5">
            {presets.map((p) => (
              <button
                key={p.calc}
                role="tab"
                aria-selected={p.calc === preset.calc}
                onClick={() => { setActive(p.calc); setConfirming(false); }}
                className={cn("min-h-8 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold", p.calc === preset.calc ? "bg-navy text-white" : "text-ink-soft hover:bg-black/5")}
              >
                {CALCULATORS[p.calc].name}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <p className="mb-3 text-xs text-muted">{def.summary}</p>

          {/* Sections */}
          {def.shapes.length > 0 && (
            <div className="space-y-2">
              {input.sections.map((s, idx) => (
                <SectionEditor
                  key={s.id}
                  section={s}
                  index={idx}
                  shapes={def.shapes.map((x) => ({ id: x.id, label: x.label }))}
                  deductions={def.deductions}
                  canRemove={input.sections.length > 1}
                  errors={shownErrors}
                  onShape={(shape) => changeShape(s, shape)}
                  onValue={(k, v) => setValue(s.id, k, v)}
                  onBlurField={(k) => touch(s.id, k)}
                  onFocusField={onFieldFocus}
                  onEnter={onFieldEnter}
                  onPatch={(patch) => patchSection(s.id, patch)}
                  onRemove={() => setInput({ ...input, sections: input.sections.filter((x) => x.id !== s.id) })}
                />
              ))}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setInput({ ...input, sections: [...input.sections, newSection(input.sections.find((x) => !x.deduct)?.shape ?? def.shapes[0].id)] })}>
                  <Plus className="h-4 w-4" /> Add section
                </Button>
                {def.deductions && (
                  <Button size="sm" variant="ghost" onClick={() => setInput({ ...input, sections: [...input.sections, newSection(def.shapes.some((x) => x.id === "opening") ? "opening" : def.shapes[0].id, true)] })}>
                    <Minus className="h-4 w-4" /> Subtract an opening
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Options */}
          {def.options.length > 0 && (
            <div className={cn("grid grid-cols-2 gap-x-3 gap-y-2", def.shapes.length > 0 && "mt-3 border-t border-dashed border-line pt-3")}>
              {def.options.map((f) => (
                <FieldInput key={f.key} id={`${item.id}-opt-${f.key}`} calcKey={`-:${f.key}`} field={f} value={input.options[f.key] ?? ""} onChange={(v) => setOption(f.key, v)} onBlur={() => touch(undefined, f.key)} onFocus={onFieldFocus} onEnter={onFieldEnter} invalid={shownErrors.some((e) => !e.sectionId && e.field === f.key)} wide={f.kind === "select"} />
              ))}
            </div>
          )}

          {def.outputs.length > 1 && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <label htmlFor={`${item.id}-out`} className="font-semibold text-ink-soft">Result in</label>
              <select id={`${item.id}-out`} className="field field-sm w-auto" value={output} onChange={(e) => { setOutputs((m) => ({ ...m, [preset.calc]: e.target.value })); setConfirming(false); }}>
                {def.outputs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          )}

          <ResultBlock result={result} errors={shownErrors} pending={hiddenErrors > 0} id={`${item.id}-calc-result`} />

          {record && (
            <div className="mt-3 rounded-lg bg-paper px-3 py-2 text-xs text-ink-soft">
              <p>
                Last applied {new Date(record.appliedAt).toLocaleDateString()}: <span className="font-semibold tabular">{fmt(new D(record.result))} {abbr(record.unit)}</span> ({CALCULATORS[record.calc].name.toLowerCase()}).
                {!matches && <> You changed the quantity to <span className="font-semibold tabular">{current || "0"} {abbr(item.unit)}</span> afterwards; that manual quantity stays unless you apply again.</>}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-3">
                {record.previous && matches && (
                  <button className="font-semibold text-accent-ink underline-offset-2 hover:underline" onClick={() => forget(true)}>
                    <RotateCcw className="mr-1 inline h-3 w-3" />Restore previous quantity ({record.previous.quantity || "0"} {abbr(record.previous.unit)})
                  </button>
                )}
                <button className="font-semibold text-muted underline-offset-2 hover:underline" onClick={() => forget()}>
                  <Trash2 className="mr-1 inline h-3 w-3" />Forget saved measurements
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-line bg-surface px-4 py-3" style={{ paddingBottom: pos.mobile ? "max(0.75rem, env(safe-area-inset-bottom))" : undefined }}>
          {confirming && (
            <div role="alertdialog" aria-label="Replace quantity" className="mb-2 rounded-lg border border-warn/30 bg-warn-tint px-3 py-2 text-sm">
              <p className="font-semibold text-ink">Replace {current} {abbr(item.unit)} with {fmt(new D(result.quantity ?? "0"))} {abbr(result.unit)}?</p>
              <p className="text-xs text-ink-soft">
                {unitChanges ? `The unit will change from ${item.unit} to ${result.unit}. ` : ""}Unit cost and pricing stay as they are{item.unitCost ? "; the line total will change" : ""}.
                {estimate.status === "finalized" ? " This bid was already finalized: the change applies to your working copy, and your last downloaded proposal is unchanged until you download again." : ""}
              </p>
            </div>
          )}
          {!confirming && unitChanges && canApply && <p className="mb-2 text-xs text-warn">This line item is in {item.unit}. Using this result changes its unit to {result.unit}.</p>}
          <div className="flex items-center justify-end gap-2">
            {!confirming && (
              <p className="mr-auto min-w-0 truncate text-xs text-muted" aria-hidden>
                {shownErrors.length ? <span className="text-danger">{shownErrors.length === 1 ? "1 entry to fix" : `${shownErrors.length} entries to fix`}</span>
                  : result.errors.length ? <>Enter the measurements</>
                  : <>Result <span className="font-bold tabular text-navy">{fmt(new D(result.quantity ?? "0"))} {abbr(result.unit)}</span></>}
              </p>
            )}
            {confirming ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>Keep {current} {abbr(item.unit)}</Button>
                <Button size="sm" onClick={apply}><Check className="h-4 w-4" /> Replace quantity</Button>
              </>
            ) : (
              <>
                <Dialog.Close asChild><Button size="sm" variant="ghost" onClick={() => unapplied.delete(item.id)}>Cancel</Button></Dialog.Close>
                <Button size="sm" onClick={apply} disabled={!canPress} aria-describedby={`${item.id}-calc-result`}>
                  {sameAsCurrent ? <><Check className="h-4 w-4" /> Already applied</> : result.quantity !== null && resultNum > 0 ? <>Use {fmt(new D(result.quantity))} {abbr(result.unit)}</> : "Use result"}
                </Button>
              </>
            )}
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

function SectionEditor({ section: s, index, shapes, deductions, canRemove, errors, onShape, onValue, onPatch, onRemove, onBlurField, onFocusField, onEnter }: {
  section: CalcSection; index: number; shapes: { id: string; label: string }[]; deductions: boolean; canRemove: boolean; errors: CalcResult["errors"];
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
        <input id={`${idBase}-label`} className="cell min-w-0 flex-1 py-1 text-xs" placeholder={s.deduct ? "Name, e.g. Windows (optional)" : "Name, e.g. Front wall (optional)"} value={s.label ?? ""} maxLength={80} onChange={(e) => onPatch({ label: e.target.value })} />
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

function FieldInput({ id, calcKey, field: f, value, onChange, onBlur, onFocus, onEnter, invalid, compact, wide }: {
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

function ResultBlock({ result, errors, pending, id }: { result: CalcResult; errors: CalcResult["errors"]; pending: boolean; id: string }) {
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
