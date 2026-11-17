"use client";
import { Building2, Lock, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { buildProposal } from "@/lib/proposal/build";
import { TEMPLATES } from "@/lib/proposal/templates";
import type { BusinessProfile, ProposalConfig } from "@/lib/proposal/types";
import type { Estimate } from "@/lib/estimate/types";
import { toDec } from "@/lib/estimate/money";
import { cn } from "@/lib/cn";
import { ProposalView } from "../proposal/proposal-view";
import { Button } from "../ui/button";
import { canEditStyleKey, resolveProposalStyle, type StylePolicy } from "@/lib/operations/proposal-style";

export const MANAGED_STYLE_NOTICE = "Your company manages proposal formatting. Contact your company administrator to request changes.";

const SHOW_LABELS: [keyof ProposalConfig["show"], string][] = [
  ["phone", "Business phone"], ["email", "Business email"], ["address", "Business address"], ["website", "Website"], ["license", "License number"],
  ["itemDescriptions", "Item descriptions"], ["itemPrices", "Individual item prices"], ["groupPrices", "Section prices"], ["quantities", "Quantities"], ["notes", "Item notes"],
];

const TEXT_SECTIONS: [keyof ProposalConfig, string, string][] = [
  ["introduction", "Introduction", "A short thank-you and summary."],
  ["allowances", "Allowances", "e.g. Tile allowance of $5/sq ft; selections above allowance billed separately."],
  ["customerResponsibilities", "Customer responsibilities", "e.g. Clear the work area; provide water and power."],
  ["schedule", "Estimated schedule", "e.g. Start within 3 weeks of signing; about 5 working days."],
  ["terms", "Terms and conditions", "Your payment, warranty and change-order terms. Leave blank to omit this section."],
];

export function ProposalStep({ estimate, business, config, onConfig, textExtra, stylePolicy, ownerBusiness, onResetStyle, resetting }: {
  estimate: Estimate; business: BusinessProfile; config: ProposalConfig; onConfig: (c: ProposalConfig) => void; textExtra?: ReactNode;
  /** V4.4: the company style policy for this bid (null = not managed). */
  stylePolicy?: StylePolicy | null; ownerBusiness?: BusinessProfile | null; onResetStyle?: () => void; resetting?: boolean;
}) {
  const styled = useMemo(() => resolveProposalStyle({ policy: stylePolicy, estimate, business, config, ownerBusiness }), [stylePolicy, estimate, business, config, ownerBusiness]);
  const doc = useMemo(() => buildProposal(styled.estimate, styled.business, styled.config), [styled]);
  const set = (patch: Partial<ProposalConfig>) => onConfig({ ...config, ...patch });
  const managed = Boolean(stylePolicy?.managed);
  const canTemplate = canEditStyleKey(stylePolicy, "template");
  const shown = styled.config;
  const withOverride = (key: string) => (managed ? [...new Set([...(config.styleOverrides ?? []), key])] : config.styleOverrides);
  const pctSum = config.paymentSchedule.reduce((s, p) => s.plus(toDec(p.percent).value), toDec("0").value);

  return (
    <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-5">
        <section className="rounded-xl border border-line bg-surface p-4" data-testid="proposal-style-panel">
          <h2 className="font-bold">Proposal style</h2>
          {managed && (
            <div className="mt-2 rounded-lg bg-brand-tint px-3 py-2 text-xs text-ink-soft" role="note">
              <p className="flex items-start gap-1.5"><Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {styled.bidChoicesApply ? "Your company sets the default proposal style. Locked elements can't be changed on this bid." : MANAGED_STYLE_NOTICE}</p>
              {onResetStyle && <Button size="sm" variant="secondary" className="mt-2" onClick={onResetStyle} disabled={resetting}><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset to Company Default</Button>}
            </div>
          )}
          <div className="mt-3 grid grid-cols-1 gap-2" role="radiogroup" aria-label="Proposal template">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                role="radio"
                aria-checked={shown.template === t.id}
                aria-disabled={!canTemplate || undefined}
                disabled={!canTemplate}
                onClick={() => set({ template: t.id, styleOverrides: withOverride("template") })}
                className={cn("rounded-lg border px-3 py-2 text-left disabled:cursor-not-allowed", shown.template === t.id ? "border-brand bg-brand-tint" : "border-line hover:border-line-strong", !canTemplate && shown.template !== t.id && "opacity-60")}
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
            {SHOW_LABELS.map(([k, l]) => {
              const can = canEditStyleKey(stylePolicy, `show.${k}`);
              return (
                <label key={k} className={cn("flex items-center gap-2", !can && "text-muted")}>
                  <input type="checkbox" checked={shown.show[k]} disabled={!can} onChange={(ev) => set({ show: { ...shown.show, ...config.show, [k]: ev.target.checked }, styleOverrides: withOverride(`show.${k}`) })} className="accent-[var(--color-brand)]" />{l}
                  {!can && <Lock className="h-3 w-3" aria-label="Set by your company" />}
                </label>
              );
            })}
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
                {k === "terms" && <p id="pt-terms-guidance" className="mb-1 text-xs text-muted">Only you see this note: contract rules vary by state, so have an attorney review your standard terms. Built2Bid doesn&apos;t write terms for you, and bracketed notes like [placeholder] never print on the proposal.</p>}
                <textarea id={`pt-${k}`} aria-describedby={k === "terms" ? "pt-terms-guidance" : undefined} rows={k === "terms" ? 4 : 2} className="field text-sm" placeholder={hint} value={config[k] as string} onChange={(ev) => set({ [k]: ev.target.value } as Partial<ProposalConfig>)} />
              </div>
            ))}
          </div>
        </section>

        {textExtra}

        <section className="rounded-xl border border-line bg-surface p-4" data-guide="builder.payment-schedule">
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
        <div tabIndex={0} role="region" aria-label="Proposal preview (scrollable)" className="sticky top-[7.5rem] max-h-[calc(100vh-9rem)] overflow-y-auto rounded-xl bg-stage p-3 sm:p-6">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-muted">Live preview: exactly what your customer will see</p>
          <ProposalView doc={doc} />
        </div>
      </div>
    </div>
  );
}
