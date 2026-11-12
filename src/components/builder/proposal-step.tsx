"use client";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { buildProposal } from "@/lib/proposal/build";
import { TEMPLATES } from "@/lib/proposal/templates";
import type { BusinessProfile, ProposalConfig } from "@/lib/proposal/types";
import type { Estimate } from "@/lib/estimate/types";
import { toDec } from "@/lib/estimate/money";
import { cn } from "@/lib/cn";
import { ProposalView } from "../proposal/proposal-view";
import { Button } from "../ui/button";

const SHOW_LABELS: [keyof ProposalConfig["show"], string][] = [
  ["phone", "Business phone"], ["email", "Business email"], ["address", "Business address"], ["website", "Website"], ["license", "License number"],
  ["itemDescriptions", "Item descriptions"], ["itemPrices", "Individual item prices"], ["groupPrices", "Section prices"], ["quantities", "Quantities"], ["notes", "Item notes"],
];

const TEXT_SECTIONS: [keyof ProposalConfig, string, string][] = [
  ["introduction", "Introduction", "A short thank-you and summary."],
  ["allowances", "Allowances", "e.g. Tile allowance of $5/sq ft; selections above allowance billed separately."],
  ["customerResponsibilities", "Customer responsibilities", "e.g. Clear the work area; provide water and power."],
  ["schedule", "Estimated schedule", "e.g. Start within 3 weeks of signing; about 5 working days."],
  ["terms", "Terms and conditions", "Have your terms reviewed by an attorney."],
];

export function ProposalStep({ estimate, business, config, onConfig, textExtra }: { estimate: Estimate; business: BusinessProfile; config: ProposalConfig; onConfig: (c: ProposalConfig) => void; textExtra?: ReactNode }) {
  const doc = useMemo(() => buildProposal(estimate, business, config), [estimate, business, config]);
  const set = (patch: Partial<ProposalConfig>) => onConfig({ ...config, ...patch });
  const pctSum = config.paymentSchedule.reduce((s, p) => s.plus(toDec(p.percent).value), toDec("0").value);

  return (
    <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-5">
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="font-bold">Proposal style</h2>
          <div className="mt-3 grid grid-cols-1 gap-2" role="radiogroup" aria-label="Proposal template">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                role="radio"
                aria-checked={config.template === t.id}
                onClick={() => set({ template: t.id })}
                className={cn("rounded-lg border px-3 py-2 text-left", config.template === t.id ? "border-brand bg-brand-tint" : "border-line hover:border-line-strong")}
              >
                <span className="block text-sm font-semibold">{t.name}</span>
                <span className="block text-xs text-muted">{t.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="font-bold">Show on proposal</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {SHOW_LABELS.map(([k, l]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={config.show[k]} onChange={(ev) => set({ show: { ...config.show, [k]: ev.target.checked } })} className="accent-[var(--color-brand)]" />{l}
              </label>
            ))}
            <label className="col-span-2 flex items-center gap-2">
              <input type="checkbox" checked={config.showSignature} onChange={(ev) => set({ showSignature: ev.target.checked })} className="accent-[var(--color-brand)]" />Acceptance / signature area
            </label>
          </div>
          <p className="mt-2 text-xs text-muted">Section display (totals, names, itemized) is set per section in the estimate.</p>
        </section>

        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="font-bold">Proposal text</h2>
          <p className="mt-1 text-xs text-muted">{textExtra ? "Defaults for new bids." : "Scope of Work and Exclusions & Clarifications are on the Scope & exclusions step."}</p>
          <div className="mt-3 space-y-3">
            {TEXT_SECTIONS.map(([k, l, hint]) => (
              <div key={k}>
                <label htmlFor={`pt-${k}`} className="label">{l} <span className="font-normal text-muted">(optional)</span></label>
                <textarea id={`pt-${k}`} rows={k === "terms" ? 4 : 2} className="field text-sm" placeholder={hint} value={config[k] as string} onChange={(ev) => set({ [k]: ev.target.value } as Partial<ProposalConfig>)} />
              </div>
            ))}
          </div>
        </section>

        {textExtra}

        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="font-bold">Payment schedule</h2>
          <div className="mt-3 space-y-2">
            {config.paymentSchedule.map((m, i) => (
              <div key={i} className="flex gap-2">
                <input aria-label={`Milestone ${i + 1} label`} className="field field-sm" value={m.label} onChange={(ev) => set({ paymentSchedule: config.paymentSchedule.map((x, k) => (k === i ? { ...x, label: ev.target.value } : x)) })} />
                <div className="relative w-24 shrink-0">
                  <input aria-label={`Milestone ${i + 1} percent`} inputMode="decimal" className="field field-sm tabular pr-6" value={m.percent} onChange={(ev) => set({ paymentSchedule: config.paymentSchedule.map((x, k) => (k === i ? { ...x, percent: ev.target.value } : x)) })} />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
                </div>
                <button aria-label={`Remove milestone ${i + 1}`} onClick={() => set({ paymentSchedule: config.paymentSchedule.filter((_, k) => k !== i) })} className="rounded p-1.5 text-muted hover:bg-black/5"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button size="sm" variant="ghost" onClick={() => set({ paymentSchedule: [...config.paymentSchedule, { label: "", percent: "" }] })}><Plus className="h-4 w-4" /> Add milestone</Button>
              <span className={cn("text-xs", pctSum.eq(100) || config.paymentSchedule.length === 0 ? "text-muted" : "text-warn")}>Total {pctSum.toString()}%{!pctSum.eq(100) && config.paymentSchedule.length > 0 ? " (usually 100%)" : ""}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="min-w-0">
        <div className="sticky top-[7.5rem] max-h-[calc(100vh-9rem)] overflow-y-auto rounded-xl bg-[#e4eaf1] p-3 sm:p-6">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-muted">Live preview: exactly what your customer will see</p>
          <ProposalView doc={doc} />
        </div>
      </div>
    </div>
  );
}
