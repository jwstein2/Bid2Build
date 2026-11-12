"use client";
import { ArrowLeft, Check, CloudOff, Download, Eye, EyeOff, Loader2, RotateCcw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { computeEstimate } from "@/lib/estimate/engine";
import { formatCurrency } from "@/lib/estimate/money";
import type { Estimate } from "@/lib/estimate/types";
import { buildProposal } from "@/lib/proposal/build";
import { defaultBusinessProfile, type BusinessProfile, type ProposalConfig } from "@/lib/proposal/types";
import { deleteLocalDraft, loadLocalBusiness, saveLocalBusiness, saveLocalDraft, clearLocalBusiness } from "@/lib/drafts/local";
import { tradeName } from "@/lib/trades/catalog";
import { cn } from "@/lib/cn";
import { Logo } from "../layout/logo";
import { ProposalView } from "../proposal/proposal-view";
import { Button } from "../ui/button";
import { Notice } from "../ui/misc";
import { CompanyStep } from "./company-step";
import { AuthDialog, Modal, UpgradeDialog } from "./dialogs";
import { useLibrary } from "./library";
import { ProjectStep } from "./project-step";
import { ProposalStep } from "./proposal-step";
import { reducer } from "./state";
import { Workspace } from "./workspace";

type Biz = BusinessProfile & { logoPath?: string | null };
type Step = "company" | "project" | "estimate" | "proposal";
type SaveState = "idle" | "saving" | "saved" | "local" | "error";
interface Quota { used: number; limit: number; unlimited: boolean; resetsAt: string; emailVerified: boolean }

export interface BuilderProps {
  initialEstimate: Estimate;
  initialConfig: ProposalConfig;
  initialBusiness: Biz | null;
  mode: "local" | "cloud";
  user: { id: string; email: string | null; emailVerified: boolean } | null;
  initialStep?: Step;
  autoExport?: boolean;
}

const STEPS: { id: Step; label: string }[] = [
  { id: "company", label: "Company" },
  { id: "project", label: "Customer & project" },
  { id: "estimate", label: "Estimate" },
  { id: "proposal", label: "Proposal" },
];

function downloadBase64(b64: string, filename: string) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Builder({ initialEstimate, initialConfig, initialBusiness, mode, user, initialStep, autoExport }: BuilderProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, { estimate: initialEstimate, trash: [], dirty: 0 });
  const [config, setConfig] = useState<ProposalConfig>(initialConfig);
  const [configDirty, setConfigDirty] = useState(0);
  const [business, setBusinessState] = useState<Biz>(() => initialBusiness ?? defaultBusinessProfile());
  const [bizDirty, setBizDirty] = useState(0);
  const [step, setStep] = useState<Step>(initialStep ?? "estimate");
  const [customerView, setCustomerView] = useState(false);
  const [save, setSave] = useState<SaveState>(mode === "cloud" ? "saved" : "local");
  const [quota, setQuota] = useState<Quota | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ tone: "ok" | "danger" | "warn"; text: string } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cloudMode, setCloudMode] = useState(mode === "cloud");
  const lib = useLibrary(Boolean(user));
  const estimate = state.estimate;
  const totals = useMemo(() => computeEstimate(estimate), [estimate]);
  const doc = useMemo(() => buildProposal(estimate, business, config), [estimate, business, config]);

  // Load business for anonymous visitors from the browser.
  useEffect(() => {
    if (!user && !initialBusiness) {
      const b = loadLocalBusiness();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after hydration
      if (b) setBusinessState(b);
      else if (!initialStep) setStep("company");
    }
  }, [user, initialBusiness, initialStep]);

  const setBusiness = (b: Biz) => { setBusinessState(b); setBizDirty((n) => n + 1); };
  const onConfig = (c: ProposalConfig) => { setConfig(c); setConfigDirty((n) => n + 1); };

  // Always keep a local copy (safety net against refreshes, expired sessions, and network loss).
  useEffect(() => {
    saveLocalDraft({ estimate, proposalConfig: config });
  }, [estimate, config]);
  useEffect(() => {
    if (!user) saveLocalBusiness(business);
  }, [business, user]);

  const saveCloud = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    setSave("saving");
    try {
      const r = await fetch("/api/estimates/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ estimate: { ...estimate, isExample: undefined }, proposalConfig: config }) });
      if (r.status === 401) { setSave("error"); setExportMsg({ tone: "warn", text: "Your session expired. Sign in again; your work is saved on this device." }); return false; }
      if (!r.ok) { setSave("error"); return false; }
      setSave("saved");
      return true;
    } catch {
      setSave("error");
      return false;
    }
  }, [user, estimate, config]);

  // Debounced cloud autosave.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- status mirrors the autosave target
    if (!user || !cloudMode) { setSave("local"); return; }
    setSave("saving");
    const t = setTimeout(() => { void saveCloud(); }, 1200);
    return () => clearTimeout(t);
  }, [state.dirty, configDirty, user, cloudMode, saveCloud]);

  const saveBusiness = useCallback(async (b: Biz) => {
    if (!user) return;
    const { logoUrl: _l, ...rest } = b;
    void _l;
    await fetch("/api/business", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ business: { ...rest, logoUrl: null, logoPath: b.logoPath ?? null } }) }).catch(() => {});
  }, [user]);
  useEffect(() => {
    if (!bizDirty || !user) return;
    const t = setTimeout(() => void saveBusiness(business), 1000);
    return () => clearTimeout(t);
  }, [bizDirty, business, user, saveBusiness]);

  // Transfer a local draft (and local branding) into the account right after sign-in.
  useEffect(() => {
    if (!user || mode !== "local") return;
    (async () => {
      const local = loadLocalBusiness();
      if (local && (!initialBusiness || !initialBusiness.companyName)) {
        let next: Biz = { ...local };
        if (local.logoUrl?.startsWith("data:")) {
          try {
            const blob = await (await fetch(local.logoUrl)).blob();
            const fd = new FormData();
            fd.append("file", new File([blob], "logo.png", { type: "image/png" }));
            const r = await fetch("/api/logo", { method: "POST", body: fd });
            if (r.ok) { const d = await r.json(); next = { ...next, logoUrl: d.url, logoPath: d.path }; }
          } catch { /* keep going */ }
        }
        setBusinessState(next);
        await saveBusiness(next);
        clearLocalBusiness();
      }
      const ok = await saveCloud();
      if (ok) {
        deleteLocalDraft(estimate.id);
        setCloudMode(true);
        router.replace(`/estimates/${estimate.id}${autoExport ? "?export=1" : ""}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, mode]);

  const refreshQuota = useCallback(async () => {
    if (!user) return;
    const r = await fetch("/api/quota", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setQuota(await r.json());
  }, [user]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches server quota on mount
  useEffect(() => { void refreshQuota(); }, [refreshQuota]);

  const doExport = useCallback(async () => {
    setExportMsg(null);
    if (!user) { setAuthOpen(true); return; }
    if (!user.emailVerified) { setExportMsg({ tone: "warn", text: "Please verify your email address before exporting." }); return; }
    if (totals.issues.length) { setStep("estimate"); setExportMsg({ tone: "danger", text: "Fix the highlighted entries before exporting." }); return; }
    if (!estimate.items.length) { setStep("estimate"); setExportMsg({ tone: "warn", text: "Add at least one line item before exporting." }); return; }
    setExporting(true);
    try {
      if (!(await saveCloud())) { setExportMsg({ tone: "danger", text: "We couldn't save your latest changes, so we didn't export. Check your connection and try again." }); return; }
      const r = await fetch(`/api/estimates/${estimate.id}/export`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (r.status === 402) { await refreshQuota(); setUpgradeOpen(true); return; }
      if (r.status === 401) { setAuthOpen(true); return; }
      if (!r.ok) { setExportMsg({ tone: "danger", text: data?.error?.message ?? "Export failed. Please try again." }); return; }
      if (data.url) window.location.assign(data.url);
      else if (data.pdfBase64) downloadBase64(data.pdfBase64, data.filename);
      setExportMsg({ tone: "ok", text: data.charged ? `Proposal version ${data.versionNumber} exported.${data.quota.unlimited ? "" : ` ${Math.max(0, data.quota.limit - data.quota.used)} free export(s) left this month.`}` : `Re-downloaded version ${data.versionNumber}. No bid credit used.` });
      await refreshQuota();
    } finally {
      setExporting(false);
    }
  }, [user, totals.issues.length, estimate.items.length, estimate.id, saveCloud, refreshQuota]);

  // Resume an export that was interrupted by sign-in.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoExport && user && cloudMode && !autoRan.current) {
      autoRan.current = true;
      void doExport();
    }
  }, [autoExport, user, cloudMode, doExport]);

  const remaining = quota && !quota.unlimited ? Math.max(0, quota.limit - quota.used) : null;
  const lastTrash = state.trash[state.trash.length - 1];

  return (
    <div className="flex min-h-screen flex-col">
      {/* Project header */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur no-print">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-5">
          <div className="flex items-center gap-2">
            <Link href={user ? "/dashboard" : "/"} className="rounded p-1.5 text-muted hover:bg-black/5" aria-label={user ? "Back to dashboard" : "Back to home"}><ArrowLeft className="h-4 w-4" /></Link>
            <span className="hidden sm:block"><Logo className="text-base" /></span>
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="est-title" className="sr-only">Project title</label>
            <input id="est-title" value={estimate.title} onChange={(e) => dispatch({ type: "patch", patch: { title: e.target.value } })} className="cell w-full max-w-md truncate font-display text-lg font-bold" placeholder="Project title" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1.5 text-xs text-muted">
              <span>{estimate.customer.name || <button className="underline" onClick={() => setStep("project")}>Add customer</button>}</span>
              <span>{estimate.trades.map(tradeName).join(" + ")}</span>
              {(estimate.location.city || estimate.location.zip) && <span>{[estimate.location.city, estimate.location.state, estimate.location.zip].filter(Boolean).join(", ")}</span>}
              <span>#{estimate.estimateNumber}</span>
              <span>{estimate.estimateDate}{estimate.expirationDate ? ` → ${estimate.expirationDate}` : ""}</span>
              <span className={cn("rounded px-1.5 py-0.5 font-semibold", estimate.status === "finalized" ? "bg-ok-tint text-ok" : "bg-black/5 text-ink-soft")}>{estimate.status === "finalized" ? "Finalized" : "Draft"}</span>
              <SaveBadge state={save} signedIn={Boolean(user)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step === "estimate" && (
              <Button size="sm" variant="ghost" onClick={() => setCustomerView(!customerView)} aria-pressed={customerView} className="hidden md:inline-flex">
                {customerView ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} Customer view
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4" /> <span className="hidden sm:inline">Preview My Bid</span><span className="sm:hidden">Preview</span></Button>
            <div className="flex flex-col items-end">
              <Button size="sm" variant="accent" onClick={doExport} disabled={exporting}>
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
              </Button>
              {remaining !== null && <span className="mt-0.5 text-[11px] text-muted">{remaining} of {quota!.limit} free left this month</span>}
              {quota?.unlimited && <span className="mt-0.5 text-[11px] text-ok">Unlimited plan</span>}
            </div>
          </div>
        </div>
        <nav aria-label="Builder steps" className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-3 sm:px-5">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => { setStep(s.id); setCustomerView(false); }}
              aria-current={step === s.id ? "step" : undefined}
              className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", step === s.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}
            >
              <span className="mr-1.5 text-xs text-muted">{i + 1}</span>{s.label}
            </button>
          ))}
        </nav>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-5 pb-28 sm:px-5 lg:pb-8">
        {exportMsg && (
          <Notice tone={exportMsg.tone === "ok" ? "ok" : exportMsg.tone} className="mb-4">
            <span className="flex items-center justify-between gap-3">{exportMsg.text}<button onClick={() => setExportMsg(null)} className="text-xs underline">Dismiss</button></span>
          </Notice>
        )}
        {user && !user.emailVerified && <Notice tone="warn" className="mb-4" title="Verify your email">Check your inbox for the verification link to unlock PDF downloads.</Notice>}
        {lastTrash && (
          <div className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg lg:bottom-6" role="status">
            Deleted {lastTrash.label}
            <button onClick={() => dispatch({ type: "undo" })} className="inline-flex items-center gap-1 font-semibold text-accent-tint underline"><Undo2 className="h-4 w-4" /> Undo</button>
          </div>
        )}

        {step === "company" && <CompanyStep business={business} onChange={setBusiness} signedIn={Boolean(user)} onDone={() => setStep(estimate.customer.name ? "estimate" : "project")} />}
        {step === "project" && <ProjectStep estimate={estimate} dispatch={dispatch} signedIn={Boolean(user)} onDone={() => setStep("estimate")} />}
        {step === "estimate" && (customerView ? (
          <div className="rounded-xl bg-[#e9e6df] p-3 sm:p-6">
            <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-muted">Customer view: this is all your customer sees</p>
            <ProposalView doc={doc} />
          </div>
        ) : (
          <Workspace estimate={estimate} dispatch={dispatch} lib={lib} />
        ))}
        {step === "proposal" && <ProposalStep estimate={estimate} business={business} config={config} onConfig={onConfig} />}
      </main>

      {/* Mobile persistent total */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 shadow-[0_-4px_12px_rgb(0_0_0/0.06)] lg:hidden no-print">
        <div>
          <p className="text-xs text-muted">Proposal total</p>
          <p className="tabular text-lg font-extrabold">{formatCurrency(totals.total)}</p>
        </div>
        <div className="text-right text-xs text-muted">
          <p>Profit <span className="tabular font-semibold text-ink">{formatCurrency(totals.grossProfit)}</span></p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4" /> Preview</Button>
      </div>

      <Modal open={previewOpen} onOpenChange={setPreviewOpen} title="Preview your proposal" description="This is exactly what your customer will see. Previews are always free." wide>
        <div className="-mx-6 bg-[#e9e6df] p-3 sm:p-5"><ProposalView doc={doc} /></div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => { setPreviewOpen(false); setStep("proposal"); }}>Customize proposal</Button>
          <Button variant="accent" onClick={() => { setPreviewOpen(false); void doExport(); }}><Download className="h-4 w-4" /> Download PDF</Button>
        </div>
      </Modal>
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} next={`/builder?draft=${estimate.id}&export=1`} onVerified={() => { window.location.assign(`/builder?draft=${estimate.id}&export=1`); }} />
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} resetsAt={quota?.resetsAt} />
    </div>
  );
}

function SaveBadge({ state, signedIn }: { state: SaveState; signedIn: boolean }) {
  if (state === "saving") return <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>;
  if (state === "saved") return <span className="inline-flex items-center gap-1 text-ok"><Check className="h-3 w-3" /> Saved</span>;
  if (state === "error") return <span className="inline-flex items-center gap-1 text-warn"><CloudOff className="h-3 w-3" /> Not synced, saved on this device</span>;
  return <span className="inline-flex items-center gap-1"><RotateCcw className="h-3 w-3" /> {signedIn ? "Saved on this device" : "Draft saved on this device"}</span>;
}
