"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/misc";
import { useDismiss } from "@/components/ui/use-dismiss";
import { TradeIcon, familyTint } from "@/components/trade-icon";
import type { PickerTrade } from "@/components/marketing/trade-picker";
import { CARDS } from "@/lib/financials/profiles/catalog";
import { resolveProfile, type BusinessConfig } from "@/lib/financials/profiles/engine";
import { PRESETS, PRESET_KEYS, presetForTrade, type PresetKey } from "@/lib/financials/profiles/presets";
import { QUICK_ACTION_LABELS, REPORT_LABELS } from "@/lib/financials/ui-labels";
import { finAction } from "./fin-client";

/** Searchable trade picker over the existing trade catalog. Closes on select, outside click or Escape. */
function TradeCombobox({ id, trades, value, onPick, exclude = [], placeholder }: { id: string; trades: PickerTrade[]; value: string | null; onPick: (slug: string) => void; exclude?: string[]; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), { inside: [btn, panel], returnFocus: btn });
  const current = trades.find((t) => t.slug === value);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return trades.filter((t) => !exclude.includes(t.slug) && (!s || t.name.toLowerCase().includes(s) || t.family.toLowerCase().includes(s)));
  }, [q, trades, exclude]);
  return (
    <div className="relative">
      <button ref={btn} id={id} type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}
        className="field flex min-h-11 items-center gap-2 text-left">
        {current ? <><span className={`grid h-7 w-7 place-items-center rounded-md ${familyTint[current.family] ?? ""}`}><TradeIcon name={current.icon} className="h-4 w-4" /></span><span className="flex-1 truncate">{current.name}</span></>
          : <span className="flex-1 text-muted">{placeholder}</span>}
        <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
      </button>
      {open && (
        <div ref={panel} className="absolute z-30 mt-1 w-full rounded-lg border border-line bg-surface p-2 shadow-xl">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input autoFocus className="field pl-8" placeholder="Search trades" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search trades" />
          </div>
          <ul role="listbox" aria-label="Trades" className="mt-1 max-h-64 overflow-y-auto">
            {list.map((t) => (
              <li key={t.slug} role="option" aria-selected={t.slug === value}>
                <button type="button" onClick={() => { onPick(t.slug); setOpen(false); setQ(""); }} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-black/5">
                  <span className={`grid h-7 w-7 place-items-center rounded-md ${familyTint[t.family] ?? ""}`}><TradeIcon name={t.icon} className="h-4 w-4" /></span>
                  <span className="flex-1">{t.name}</span>{t.slug === value && <Check className="h-4 w-4 text-brand" aria-hidden />}
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-2 py-3 text-sm text-muted">No trade matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

const MARKETS = [["residential", "Residential"], ["commercial", "Commercial"], ["mixed", "Both"]] as const;
const MODELS = [["fixed_price", "Fixed price"], ["time_materials", "Time & materials"], ["cost_plus", "Cost plus"], ["service_call", "Service calls"], ["mixed", "A mix"]] as const;
const PAYMENTS = [["deposit_progress_final", "Deposit, progress, final"], ["milestones", "Milestones"], ["progress_sov", "Progress billing (schedule of values)"], ["on_completion", "Paid on completion"], ["time_materials", "Time & materials"], ["cost_plus", "Cost plus"], ["mixed", "A mix"]] as const;
const LABOR = [["employees", "My own crew"], ["subcontractors", "Subcontractors"], ["both", "Both"]] as const;

function Choice<T extends string>({ legend, name, options, value, onChange }: { legend: string; name: string; options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <label key={v} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${value === v ? "border-brand bg-brand-tint font-semibold" : "border-line"}`}>
            <input type="radio" name={name} className="sr-only" checked={value === v} onChange={() => onChange(v)} />{l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Company → Business & Trade Configuration. Presentation only: it chooses what Financials shows first
 * (cards, quick actions, reports, starter cost codes). It never changes recorded numbers or what anyone
 * is allowed to do. The preview updates as you choose.
 */
export function BusinessConfigForm({ trades, initial, canEdit }: { trades: PickerTrade[]; initial: BusinessConfig; canEdit: boolean }) {
  const router = useRouter();
  const [primary, setPrimary] = useState<string | null>(initial.primaryTradeSlug);
  const [extra, setExtra] = useState<string[]>([...(initial.additionalTradeSlugs ?? [])]);
  const [preset, setPreset] = useState<PresetKey | "">(initial.presetKey ?? "");
  const [market, setMarket] = useState(initial.market ?? "residential");
  const [model, setModel] = useState(initial.projectModel ?? PRESETS[presetForTrade(initial.primaryTradeSlug)].defaultProjectModel);
  const [payment, setPayment] = useState(initial.paymentStructure ?? PRESETS[presetForTrade(initial.primaryTradeSlug)].defaultPaymentStructure);
  const [labor, setLabor] = useState(initial.laborModel ?? "both");
  const [inventory, setInventory] = useState(Boolean(initial.usesInventory));
  const [equipment, setEquipment] = useState(Boolean(initial.usesEquipment));
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const name = (slug: string) => trades.find((t) => t.slug === slug)?.name ?? slug;

  const config: BusinessConfig = { primaryTradeSlug: primary, additionalTradeSlugs: extra, presetKey: preset || null, market, projectModel: model, paymentStructure: payment, laborModel: labor, usesInventory: inventory, usesEquipment: equipment };
  const profile = resolveProfile(config);

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await finAction({ action: "save_business_config", p: { ...config, presetKey: preset || null } });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "danger", text: r.message });
    setMsg({ tone: "ok", text: "Saved. Your Financials home now follows this setup." });
    router.refresh();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <form className="space-y-5 rounded-xl border border-line bg-surface p-4 sm:p-5" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="fin-config-form">
        <fieldset disabled={!canEdit} className="space-y-5">
          <Field label="Main type of work" htmlFor="cfg-primary">
            <TradeCombobox id="cfg-primary" trades={trades} value={primary} onPick={(slug) => { setPrimary(slug); setExtra(extra.filter((x) => x !== slug)); const p = PRESETS[presetForTrade(slug)]; setModel(p.defaultProjectModel); setPayment(p.defaultPaymentStructure); }} placeholder="Choose your main trade" />
          </Field>
          <div>
            <p className="label">Other trades you do</p>
            <div className="flex flex-wrap gap-2">
              {extra.map((slug) => (
                <span key={slug} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line bg-paper pl-3 pr-1 text-sm">
                  {name(slug)}
                  <button type="button" className="grid h-8 w-8 place-items-center rounded-full hover:bg-black/5" aria-label={`Remove ${name(slug)}`} onClick={() => setExtra(extra.filter((x) => x !== slug))}><X className="h-3.5 w-3.5" aria-hidden /></button>
                </span>
              ))}
            </div>
            {extra.length < 30 && <div className="mt-2"><TradeCombobox id="cfg-extra" trades={trades} value={null} exclude={[...(primary ? [primary] : []), ...extra]} onPick={(slug) => setExtra([...extra, slug])} placeholder="+ Add a trade" /></div>}
          </div>
          <Choice legend="Who you work for" name="cfg-market" options={MARKETS} value={market} onChange={setMarket} />
          <Choice legend="How you price jobs" name="cfg-model" options={MODELS} value={model} onChange={setModel} />
          <Choice legend="How customers pay you" name="cfg-pay" options={PAYMENTS} value={payment} onChange={setPayment} />
          <Choice legend="Who does the work" name="cfg-labor" options={LABOR} value={labor} onChange={setLabor} />
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={inventory} onChange={(e) => setInventory(e.target.checked)} /> I keep materials in stock</label>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={equipment} onChange={(e) => setEquipment(e.target.checked)} /> I track equipment costs</label>
          </div>
          <Field label="Layout preset" optional htmlFor="cfg-preset" hint="Leave on Automatic to follow your main trade.">
            <select id="cfg-preset" className="field" value={preset} onChange={(e) => setPreset(e.target.value as PresetKey | "")}>
              <option value="">Automatic ({PRESETS[presetForTrade(primary)].label})</option>
              {PRESET_KEYS.map((k) => <option key={k} value={k}>{PRESETS[k].label}</option>)}
            </select>
          </Field>
        </fieldset>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {canEdit ? <Button type="submit" disabled={busy} data-testid="fin-config-save">{busy ? "Saving…" : "Save configuration"}</Button>
          : <p className="text-sm text-muted">Only people who can manage financial settings can change this.</p>}
        <p className="text-xs text-muted">This only changes what Financials shows first. It never changes recorded amounts, history or anyone&apos;s access. Each project can override it.</p>
      </form>
      <aside className="space-y-3 rounded-xl border border-line bg-paper p-4" aria-label="Preview" data-testid="fin-config-preview">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Preview</p>
        <p className="font-display text-lg font-extrabold">{PRESETS[profile.presetKey].label}</p>
        <div><p className="label">Home cards</p><ul className="flex flex-wrap gap-1">{profile.cards.map((c) => <li key={c} className="rounded-full bg-surface px-2 py-1 text-xs">{CARDS[c].title}</li>)}</ul></div>
        <div><p className="label">Quick actions</p><ul className="flex flex-wrap gap-1">{profile.quickActions.map((q) => <li key={q} className="rounded-full bg-surface px-2 py-1 text-xs">{QUICK_ACTION_LABELS[q]}</li>)}</ul></div>
        <div><p className="label">Reports</p><ul className="flex flex-wrap gap-1">{profile.reports.map((r) => <li key={r} className="rounded-full bg-surface px-2 py-1 text-xs">{REPORT_LABELS[r]}</li>)}</ul></div>
        <div><p className="label">Starter cost codes</p><p className="text-xs text-ink-soft">{profile.costCodeSuggestions.length} suggested ({profile.trades.length || 1} trade{profile.trades.length === 1 ? "" : "s"} × the cost types you use)</p></div>
      </aside>
    </div>
  );
}
