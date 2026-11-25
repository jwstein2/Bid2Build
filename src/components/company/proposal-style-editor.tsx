"use client";
import { Building2, History, Lock, LockOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buildProposal } from "@/lib/proposal/build";
import { TEMPLATES } from "@/lib/proposal/templates";
import { defaultProposalConfig, type BusinessProfile } from "@/lib/proposal/types";
import { createEstimate, newLineItem } from "@/lib/estimate/factory";
import { resolveProposalStyle, SHOW_KEYS, STYLE_KEY_LABELS, STYLE_KEYS, type CompanyStyle, type StyleKey } from "@/lib/operations/proposal-style";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { ProposalView } from "../proposal/proposal-view";

export interface CompanyStyleData {
  companyId: string; exists: boolean; style: CompanyStyle; locked: string[]; allowCustomization: boolean; revision: number; updatedAt: string | null;
  isOwner: boolean; canManageTemplate: boolean; canChangePolicy: boolean;
  history: { revision: number; actorId: string | null; at: string; allow: boolean; locked: string[] }[];
}

const SHOW_LABEL: Record<(typeof SHOW_KEYS)[number], string> = {
  phone: "Business phone", email: "Business email", address: "Business address", website: "Website", license: "License number",
  itemDescriptions: "Item descriptions", itemPrices: "Line item prices", groupPrices: "Section prices", quantities: "Quantities", notes: "Line notes",
};
const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

function sampleEstimate() {
  const e = createEstimate("other", { blank: true, now: new Date("2026-01-15T12:00:00Z"), number: "EST-SAMPLE" });
  e.title = "Sample project"; e.customer = { name: "Sample Customer", projectAddress: "123 Main St" };
  const [a, b] = e.groups;
  a.name = "Materials"; b.name = "Labor";
  e.items = [
    newLineItem(a.id, 0, { name: "Premium materials", description: "Supplied and delivered", quantity: "10", unit: "ea", unitCost: "40" }),
    newLineItem(b.id, 0, { name: "Installation", description: "Skilled crew", quantity: "16", unit: "hr", unitCost: "55" }),
  ].map((i) => ({ ...i, isExample: false }));
  return e;
}

/**
 * Company Settings → Proposal & Bid Style (V4.4). The style (template, colors, layout, details) needs
 * "Manage company proposal template"; the customization toggle and locks need "Change company-wide
 * proposal policy", which only the owner holds or grants. The server re-checks both on save.
 */
export function ProposalStyleEditor({ initial, ownerBusiness, people }: { initial: CompanyStyleData; ownerBusiness: BusinessProfile | null; people: Record<string, string> }) {
  const router = useRouter();
  const [style, setStyle] = useState<CompanyStyle>({ companyBranding: true, ...initial.style });
  const [locked, setLocked] = useState<string[]>(initial.locked);
  const [allow, setAllow] = useState(initial.allowCustomization);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const canStyle = initial.canManageTemplate, canPolicy = initial.canChangePolicy;
  const estimate = useMemo(() => sampleEstimate(), []);
  const biz = useMemo(() => ownerBusiness ?? ({ companyName: "Your company" } as BusinessProfile), [ownerBusiness]);
  const doc = useMemo(() => {
    const r = resolveProposalStyle({ policy: { managed: true, style, locked, allowCustomization: allow }, estimate, business: biz, config: defaultProposalConfig(), ownerBusiness: biz });
    return buildProposal(r.estimate, r.business, r.config);
  }, [style, locked, allow, estimate, biz]);
  const set = (p: Partial<CompanyStyle>) => setStyle((s) => ({ ...s, ...p }));
  const isLocked = (k: StyleKey) => locked.includes(k);
  const lockBtn = (k: StyleKey) => canPolicy ? (
    <button type="button" onClick={() => setLocked((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]))} aria-pressed={isLocked(k)} aria-label={`${isLocked(k) ? "Unlock" : "Lock"} ${STYLE_KEY_LABELS[k]}`}
      className={cn("rounded p-1", isLocked(k) ? "text-navy" : "text-muted hover:text-ink")}>{isLocked(k) ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}</button>
  ) : isLocked(k) ? <Lock className="h-3.5 w-3.5 text-muted" aria-label="Locked" /> : null;

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/company/proposal-style", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseRevision: initial.revision, style, locked, allowCustomization: allow }) });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setMsg({ tone: "danger", text: d?.error?.message ?? "We couldn't save." }); return; }
    setMsg({ tone: "ok", text: "Saved. Unsent bids use the new style right away; sent and signed proposals never change." });
    router.refresh();
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="space-y-5">
        {!initial.exists && <p className="rounded-lg bg-brand-tint px-3 py-2 text-sm"><Building2 className="mr-1 inline h-4 w-4" aria-hidden />Your company hasn&apos;t set a proposal style yet, so each bid uses its author&apos;s own settings. Saving here makes this the company style.</p>}

        <section className="rounded-xl border border-line bg-surface p-4" data-guide="style.policy">
          <h2 className="font-bold">Team customization</h2>
          <label className="mt-2 flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={allow} disabled={!canPolicy} onChange={(e) => setAllow(e.target.checked)} data-testid="allow-customization" />
            <span><span className="font-semibold">Allow Team Members to Customize Bid Style</span>
              <span className="block text-sm text-ink-soft">Off: every bid uses the company style. On: people with &quot;Customize individual proposal style&quot; can change anything you haven&apos;t locked.</span></span>
          </label>
          {!canPolicy && <p className="mt-2 text-xs text-muted">Only the company owner, or someone they granted &quot;Change company-wide proposal policy&quot;, can change this or the locks.</p>}
          {canPolicy && <p className="mt-2 text-xs text-muted">Use the lock icons to keep an element fixed on every bid, even when customization is on.</p>}
        </section>

        <fieldset disabled={!canStyle} className="space-y-5">
          <section className="rounded-xl border border-line bg-surface p-4" data-guide="style.editor">
            <div className="flex items-center justify-between"><h2 className="font-bold">Template</h2>{lockBtn("template")}</div>
            <div className="mt-2 grid gap-2" role="radiogroup" aria-label="Company template">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={(style.template ?? "classic") === t.id} onClick={() => set({ template: t.id })}
                  className={cn("rounded-lg border px-3 py-2 text-left", (style.template ?? "classic") === t.id ? "border-brand bg-brand-tint" : "border-line")}>
                  <span className="block text-sm font-semibold">{t.name}</span><span className="block text-xs text-muted">{t.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-line bg-surface p-4 space-y-3">
            <h2 className="font-bold">Branding</h2>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={style.companyBranding !== false} onChange={(e) => set({ companyBranding: e.target.checked })} />Use the company profile (name, logo, contact) on every bid{lockBtn("companyBranding")}</label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm"><span className="flex items-center gap-1">Primary color{lockBtn("primaryColor")}</span><input type="color" className="mt-1 h-9 w-full rounded border border-line" value={style.primaryColor ?? biz.primaryColor ?? "#1d4ed8"} onChange={(e) => set({ primaryColor: e.target.value })} /></label>
              <label className="text-sm"><span className="flex items-center gap-1">Accent color{lockBtn("secondaryColor")}</span><input type="color" className="mt-1 h-9 w-full rounded border border-line" value={style.secondaryColor ?? biz.secondaryColor ?? "#0ea5e9"} onChange={(e) => set({ secondaryColor: e.target.value })} /></label>
              <label className="text-sm"><span className="flex items-center gap-1">Logo layout{lockBtn("logoLayout")}</span>
                <select className="field field-sm mt-1" value={style.logoLayout ?? biz.logoLayout ?? "left"} onChange={(e) => set({ logoLayout: e.target.value as CompanyStyle["logoLayout"] })}><option value="left">Left</option><option value="center">Centered</option><option value="stacked">Stacked</option></select></label>
              <label className="text-sm"><span className="flex items-center gap-1">Header style{lockBtn("headerStyle")}</span>
                <select className="field field-sm mt-1" value={style.headerStyle ?? biz.headerStyle ?? "solid"} onChange={(e) => set({ headerStyle: e.target.value as CompanyStyle["headerStyle"] })}><option value="solid">Solid</option><option value="line">Line</option><option value="minimal">Minimal</option></select></label>
            </div>
          </section>

          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="font-bold">Show on proposals</h2>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              {SHOW_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" checked={style.show?.[k] ?? defaultProposalConfig().show[k]} onChange={(e) => set({ show: { ...style.show, [k]: e.target.checked } })} />{SHOW_LABEL[k]}{lockBtn(`show.${k}`)}
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-line bg-surface p-4 space-y-3">
            <h2 className="font-bold">Grouping</h2>
            <label className="block text-sm"><span className="flex items-center gap-1">Price display{lockBtn("displayMode")}</span>
              <select className="field field-sm mt-1" value={style.displayMode ?? ""} onChange={(e) => set({ displayMode: (e.target.value || undefined) as CompanyStyle["displayMode"] })}>
                <option value="">Each bid decides</option><option value="by_group">By section</option><option value="project_total">Project total only</option></select></label>
            <label className="block text-sm"><span className="flex items-center gap-1">Section detail{lockBtn("defaultGroupVisibility")}</span>
              <select className="field field-sm mt-1" value={style.defaultGroupVisibility ?? ""} onChange={(e) => set({ defaultGroupVisibility: (e.target.value || undefined) as CompanyStyle["defaultGroupVisibility"] })}>
                <option value="">Each bid decides</option><option value="itemized">Itemized</option><option value="group_total">Section totals</option><option value="names_only">Names only</option></select></label>
          </section>
        </fieldset>
        {!canStyle && <p className="text-xs text-muted">You can view the company style. Changing it needs &quot;Manage company proposal template&quot;.</p>}

        {msg && <p role={msg.tone === "danger" ? "alert" : "status"} className={cn("text-sm", msg.tone === "danger" ? "text-danger" : "text-ok")}>{msg.text}</p>}
        {(canStyle || canPolicy) && <Button loading={busy} onClick={() => void save()} disabled={busy} data-testid="save-style"> Save company style</Button>}
        <p className="text-xs text-muted">Style never changes prices, and never alters a proposal that was already sent, approved or signed.</p>

        {initial.history.length > 0 && (
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="flex items-center gap-1.5 font-bold"><History className="h-4 w-4" aria-hidden /> Change history</h2>
            <ul className="mt-2 space-y-1 text-xs text-ink-soft">
              {initial.history.map((h) => <li key={h.revision}>Revision {h.revision} · {fmt(h.at)} · {people[h.actorId ?? ""] ?? "A teammate"} · customization {h.allow ? "on" : "off"} · {h.locked.length} locked</li>)}
            </ul>
          </section>
        )}
        <p className="text-xs text-muted">Locked elements: {locked.length ? locked.map((k) => STYLE_KEY_LABELS[k as StyleKey] ?? k).join(", ") : "none"}. ({STYLE_KEYS.length} elements can be locked.)</p>
      </div>
      <div className="min-w-0">
        <div tabIndex={0} role="region" aria-label="Proposal preview (scrollable)" className="sticky top-[7.5rem] max-h-[calc(100vh-9rem)] overflow-y-auto rounded-xl bg-stage p-3 sm:p-6">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-muted">Preview with sample items</p>
          <ProposalView doc={doc} />
        </div>
      </div>
    </div>
  );
}
