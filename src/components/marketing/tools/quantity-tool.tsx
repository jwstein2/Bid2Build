"use client";
import { ArrowRight, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CALCULATORS, SHAPES, abbr, fmt, newInput, newSection, runCalculator, type CalcInput, type CalcSection } from "@/lib/calculators";
import { D } from "@/lib/estimate/money";
import { track } from "@/lib/analytics/track";
import { TOOL_HANDOFF_KEY, type QuantityTool, type ToolHandoff } from "@/lib/marketing/tools";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { FieldInput, ResultBlock, SectionEditor } from "@/components/builder/calculators/calc-fields";

/**
 * Free public quantity calculator. Same engine and the same field components as the builder's
 * calculator. "Send this as a bid" opens a new draft with the result on the matching line item;
 * the measurements go along in sessionStorage only (never in the URL or analytics).
 */
export function QuantityToolForm({ tool, tradeName, from }: { tool: QuantityTool; tradeName: string; from?: string }) {
  const router = useRouter();
  const def = CALCULATORS[tool.calc];
  const shapes = useMemo(() => def.shapes.filter((s) => tool.shapes.includes(s.id)), [def, tool.shapes]);
  const [input, setInput] = useState<CalcInput>(() => newInput({ calc: tool.calc, shape: tool.shapes[0], options: tool.options }));
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [going, setGoing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const result = useMemo(() => runCalculator(tool.calc, input, tool.output), [tool.calc, tool.output, input]);
  const key = (sectionId: string | undefined, field: string | undefined) => `${sectionId ?? "-"}:${field ?? "-"}`;
  const shownErrors = attempted ? result.errors : result.errors.filter((e) => !e.empty && (!e.field || touched.has(key(e.sectionId, e.field))));
  const hidden = result.errors.length - shownErrors.length;
  const touch = (sectionId: string | undefined, field: string) => setTouched((t) => (t.has(key(sectionId, field)) ? t : new Set(t).add(key(sectionId, field))));

  // One "calculator used" signal per page view, the first time a result appears (no values sent).
  const used = useRef(false);
  useEffect(() => {
    if (used.current || !result.ok) return;
    used.current = true;
    track("calculator_used", { tool: tool.slug, trade: tool.trade, from });
  }, [result.ok, tool.slug, tool.trade, from]);

  const patchSection = (id: string, patch: Partial<CalcSection>) => setInput((i) => ({ ...i, sections: i.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const setValue = (id: string, k: string, v: string) => setInput((i) => ({ ...i, sections: i.sections.map((s) => (s.id === id ? { ...s, values: { ...s.values, [k]: v } } : s)) }));
  const setOption = (k: string, v: string) => setInput((i) => ({ ...i, options: { ...i.options, [k]: v } }));
  const changeShape = (s: CalcSection, shape: string) => {
    const fresh = newSection(shape, s.deduct);
    patchSection(s.id, { shape, values: { ...fresh.values, ...Object.fromEntries(Object.entries(s.values).filter(([k]) => SHAPES[shape]?.fields.some((f) => f.key === k))) } });
  };
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const fields = [...(rootRef.current?.querySelectorAll<HTMLInputElement>("input[data-calc-field]") ?? [])];
    const next = fields[fields.indexOf(e.currentTarget) + 1];
    if (next) next.focus(); else e.currentTarget.blur();
  };

  const send = () => {
    if (!result.ok || result.quantity === null) {
      setAttempted(true);
      const first = result.errors.find((e) => e.field);
      const el = first && rootRef.current?.querySelector<HTMLInputElement>(`[data-calc-key="${CSS.escape(`${first.sectionId ?? "-"}:${first.field}`)}"]`);
      (el ?? rootRef.current?.querySelector<HTMLInputElement>("input[data-calc-field]"))?.focus();
      return;
    }
    const handoff: ToolHandoff = { tool: tool.slug, quantity: String(Number(result.quantity)), input };
    try { sessionStorage.setItem(TOOL_HANDOFF_KEY, JSON.stringify(handoff)); } catch { /* the quantity still goes through the URL */ }
    track("calculator_bid_started", { tool: tool.slug, trade: tool.trade, from });
    setGoing(true);
    const qs = new URLSearchParams({ tool: tool.slug, q: handoff.quantity, from: `tool-${tool.slug.replace(/-calculator$/, "")}` });
    router.push(`/start/${tool.trade}?${qs.toString()}`);
  };

  const qty = result.ok && result.quantity !== null ? `${fmt(new D(result.quantity))} ${abbr(result.unit)}` : null;
  const firstShape = input.sections.find((x) => !x.deduct)?.shape ?? shapes[0]?.id;

  return (
    <div ref={rootRef} className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6" data-testid="tool-form">
      <div className="space-y-2">
        {input.sections.map((s, idx) => (
          <SectionEditor
            key={s.id}
            section={s}
            index={idx}
            shapes={shapes.map((x) => ({ id: x.id, label: x.label }))}
            deductions={def.deductions}
            canRemove={input.sections.length > 1}
            errors={shownErrors}
            onShape={(shape) => changeShape(s, shape)}
            onValue={(k, v) => setValue(s.id, k, v)}
            onBlurField={(k) => touch(s.id, k)}
            onFocusField={() => undefined}
            onEnter={onEnter}
            onPatch={(p) => patchSection(s.id, p)}
            namePlaceholder={tool.calc === "roof" ? "Name, e.g. Front plane (optional)" : tool.calc === "boards" ? "Name, e.g. Main deck (optional)" : "Name, e.g. Driveway (optional)"}
            onRemove={() => setInput((i) => ({ ...i, sections: i.sections.filter((x) => x.id !== s.id) }))}
          />
        ))}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => firstShape && setInput((i) => ({ ...i, sections: [...i.sections, newSection(firstShape)] }))} disabled={input.sections.length >= 30}>
            <Plus className="h-4 w-4" aria-hidden /> Add another
          </Button>
          {def.deductions && (
            <Button size="sm" variant="ghost" onClick={() => firstShape && setInput((i) => ({ ...i, sections: [...i.sections, newSection(firstShape, true)] }))} disabled={input.sections.length >= 30}>
              <Minus className="h-4 w-4" aria-hidden /> Subtract an area
            </Button>
          )}
        </div>
      </div>

      {def.options.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-dashed border-line pt-4">
          {def.options.map((f) => (
            <FieldInput key={f.key} id={`tool-opt-${f.key}`} calcKey={`-:${f.key}`} field={f} value={input.options[f.key] ?? ""} onChange={(v) => setOption(f.key, v)} onBlur={() => touch(undefined, f.key)} onEnter={onEnter} invalid={shownErrors.some((e) => !e.sectionId && e.field === f.key)} wide={f.kind === "select"} />
          ))}
        </div>
      )}

      <ResultBlock result={result} errors={shownErrors} pending={hidden > 0} id="tool-result" />

      <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
        <Button loading={going} variant="accent" size="lg" onClick={send} disabled={going} data-cta="tool_bid" data-testid="tool-send" aria-describedby="tool-send-note" className="w-full sm:w-auto">
          {going ? "Opening your bid…" : <>Send this as a bid <ArrowRight className="h-4 w-4" aria-hidden /></>}
        </Button>
        <p id="tool-send-note" className={cn("text-sm text-muted")}>
          {qty ? <>Opens a {tradeName.toLowerCase()} estimate with <span className="font-semibold text-ink">{tool.item.name}</span> set to <span className="font-semibold text-ink tabular">{qty}</span>. No account needed. You add your own prices.</>
            : <>Opens a {tradeName.toLowerCase()} estimate with this quantity filled in. No account needed.</>}
        </p>
      </div>
    </div>
  );
}
