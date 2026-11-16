"use client";
import { AlertCircle, ArrowLeft, ArrowRight, Home, Check, CloudOff, Download, Eye, EyeOff, Loader2, Link2, Mail, RotateCcw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { computeEstimate } from "@/lib/estimate/engine";
import { formatCurrency } from "@/lib/estimate/money";
import type { Estimate } from "@/lib/estimate/types";
import { buildProposal } from "@/lib/proposal/build";
import { defaultBusinessProfile, type BusinessProfile, type ProposalConfig } from "@/lib/proposal/types";
import { deleteLocalDraft, loadLocalBusiness, saveLocalBusiness, saveLocalDraft, clearLocalBusiness, loadLocalStep, saveLocalStep } from "@/lib/drafts/local";
import { isBuilderStep, isCompanyComplete, resolveStartStep, type BuilderStep } from "@/lib/estimate/workflow";
import { tradeName } from "@/lib/trades/catalog";
import { isDefaultTitle } from "@/lib/estimate/factory";
import { cn } from "@/lib/cn";
import { exportMessage, type CreditSource, type CreditStatus } from "@/lib/credits/status";
import { CreditSummary, UpgradeLink } from "../billing/credits";
import { Logo } from "../layout/logo";
import { ProposalView } from "../proposal/proposal-view";
import { Button } from "../ui/button";
import { Notice } from "../ui/misc";
import { CompanyStep } from "./company-step";
import { Modal, UpgradeDialog } from "./dialogs";
import { AuthDialog } from "../auth/auth-dialog";
import { useLibrary } from "./library";
import { ProjectStep } from "./project-step";
import { ProposalStep } from "./proposal-step";
import { BuilderOpsProvider, useOpsLoader, type OwnerBrand } from "./ops-context";
import { ContractPanel } from "./contract-panel";
import { resolveProposalStyle } from "@/lib/operations/proposal-style";
import { ScopeStep } from "./scope-step";
import { reducer } from "./state";
import { Workspace } from "./workspace";
import { WashingJobPanel, isWashingEstimate } from "./calculators/washing-job-panel";
import { InternalReportButton } from "./internal-report";
import { ScheduleNowButton } from "@/components/schedule/schedule-now-button";
import { SendEmailDialog, type SendMode, type SendPhase } from "./send-email";
import { SigningPanel, type CreatedLink } from "../esign/signing-panel";
import { isEsignEnabled } from "@/lib/esign/config";
import { exportReadiness, type ReadinessIssue } from "@/lib/estimate/readiness";
import { stepStatuses } from "@/lib/estimate/step-status";
import type { ShareEmailInput } from "@/lib/proposal/share-email";
import { displayPhone } from "@/lib/proposal/customer-text";
import { ThemeToggle } from "../theme/theme-toggle";
import type { ThemePref } from "@/lib/theme";
import { track } from "@/lib/analytics/track";

type Biz = BusinessProfile & { logoPath?: string | null };
type Step = BuilderStep;
type SaveState = "idle" | "saving" | "saved" | "local" | "error";

export interface BuilderProps {
  initialEstimate: Estimate;
  initialConfig: ProposalConfig;
  initialBusiness: Biz | null;
  mode: "local" | "cloud";
  user: { id: string; email: string | null; emailVerified: boolean; verified?: boolean; theme?: ThemePref } | null;
  /** A step the URL asks for (e.g. ?step=proposal). Otherwise the workflow decides; see resolveStartStep. */
  initialStep?: Step;
  autoExport?: boolean;
  /** Credit balances loaded with the page, so the header (Upgrade, credit line) is right on first paint. */
  initialCredits?: CreditStatus | null;
}

const STEPS: { id: Step; label: string; next: string }[] = [
  { id: "company", label: "Company", next: "Next: customer & project" },
  { id: "project", label: "Customer & project", next: "Next: build the estimate" },
  { id: "estimate", label: "Estimate", next: "Next: scope & exclusions" },
  { id: "scope", label: "Scope & exclusions", next: "Next: proposal & terms" },
  { id: "proposal", label: "Proposal", next: "Preview & download" },
];

function base64File(b64: string, filename: string): File {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new File([bytes], filename, { type: "application/pdf" });
}

function downloadBase64(b64: string, filename: string) {
  const url = URL.createObjectURL(base64File(b64, filename));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Builder({ initialEstimate, initialConfig, initialBusiness, mode, user, initialStep, autoExport, initialCredits = null }: BuilderProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, { estimate: initialEstimate, trash: [], dirty: 0 });
  const [config, setConfig] = useState<ProposalConfig>(initialConfig);
  const [configDirty, setConfigDirty] = useState(0);
  // Local drafts render only in the browser (BuilderLoader waits for storage), so browser storage is
  // readable here; cloud bids are server-rendered and read it after hydration (effect below).
  const [business, setBusinessState] = useState<Biz>(() => initialBusiness ?? (mode === "local" && !user ? loadLocalBusiness() : null) ?? defaultBusinessProfile());
  const [bizDirty, setBizDirty] = useState(0);
  const [step, setStep] = useState<Step>(() => {
    const saved = mode === "local" ? loadLocalStep(initialEstimate.id) : null;
    const biz = initialBusiness ?? (mode === "local" && !user ? loadLocalBusiness() : null);
    return resolveStartStep({ companyComplete: isCompanyComplete(biz), estimate: initialEstimate, saved: isBuilderStep(saved) ? saved : null, requested: initialStep });
  });
  const [customerView, setCustomerView] = useState(false);
  // Steps opened in this session: an opened step is "visited", never "complete" on its own.
  const [visited, setVisited] = useState<ReadonlySet<Step>>(() => new Set<Step>());
  // eslint-disable-next-line react-hooks/set-state-in-effect -- records the step being shown
  useEffect(() => { setVisited((v) => (v.has(step) ? v : new Set([...v, step]))); }, [step]);
  const [save, setSave] = useState<SaveState>(mode === "cloud" ? "saved" : "local");
  const [credits, setCredits] = useState<CreditStatus | null>(initialCredits);
  const [finalizedHere, setFinalizedHere] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ tone: "ok" | "danger" | "warn"; text: string } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [missing, setMissing] = useState<ReadinessIssue[]>([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendPhase, setSendPhase] = useState<SendPhase>({ k: "preparing" });
  const [sendMode, setSendMode] = useState<SendMode>("pdf");
  const [creatingLink, setCreatingLink] = useState(false);
  const [sendKey, setSendKey] = useState(0);
  // The signing link made in this session, with the edit counters it was made at. It is reused while
  // the bid is unchanged (no new request, no extra credit), and dropped after an edit, a revoke or expiry.
  const [signingLinkState, setSigningLinkState] = useState<{ link: CreatedLink; stamp: string } | null>(null);
  const [signingRefresh, setSigningRefresh] = useState(0);
  const esign = isEsignEnabled() && Boolean(user);
  // One export at a time, across Download PDF and Send via My Email (double taps included).
  const exportLock = useRef(false);
  const [cloudMode, setCloudMode] = useState(mode === "cloud");
  const lib = useLibrary(Boolean(user));
  const estimate = state.estimate;
  const primaryTrade = estimate.trades[0];
  const editStamp = `${state.dirty}|${configDirty}|${bizDirty}`;
  const signingLink = signingLinkState && signingLinkState.stamp === editStamp ? signingLinkState.link : null;
  const totals = useMemo(() => computeEstimate(estimate), [estimate]);
  // V4.3/V4.4 project operations for saved bids: sub quotes, contract value, company proposal style.
  const { ops, refresh: refreshOps } = useOpsLoader(cloudMode && user ? estimate.id : null);
  const ownerBusiness = useMemo(() => brandToBusiness(ops?.ownerBrand ?? null), [ops?.ownerBrand]);
  const styled = useMemo(() => resolveProposalStyle({ policy: ops?.stylePolicy, estimate, business, config, ownerBusiness }), [ops?.stylePolicy, estimate, business, config, ownerBusiness]);
  const doc = useMemo(() => buildProposal(styled.estimate, styled.business, styled.config), [styled]);
  const [resettingStyle, setResettingStyle] = useState(false);
  const resetStyle = useCallback(async () => {
    setResettingStyle(true);
    try {
      const r = await fetch(`/api/estimates/${estimate.id}/proposal-style/reset`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setExportMsg({ tone: "danger", text: d?.error?.message ?? "We couldn't reset the style. Please try again." }); return; }
      onConfig({ ...config, styleOverrides: [] });
      setExportMsg({ tone: "ok", text: "This bid now follows your company's proposal style." });
    } finally { setResettingStyle(false); }
  }, [estimate.id, config]); // eslint-disable-line react-hooks/exhaustive-deps

  // Server-rendered (cloud) bids: reopen the step this device last showed for this bid.
  useEffect(() => {
    if (mode !== "cloud" || initialStep) return;
    const saved = loadLocalStep(initialEstimate.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after hydration
    if (isBuilderStep(saved)) setStep(resolveStartStep({ companyComplete: isCompanyComplete(initialBusiness), estimate: initialEstimate, saved }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per bid, on mount
  }, [initialEstimate.id]);
  useEffect(() => { saveLocalStep(estimate.id, step); }, [estimate.id, step]);

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

  // Activation analytics: the customer-facing preview was opened for a saved bid (once per bid per
  // browser session; the server also stores it at most once per bid per day). Fire-and-forget.
  const previewSent = useRef<string | null>(null);
  useEffect(() => {
    if (!previewOpen || !user || !cloudMode || previewSent.current === estimate.id) return;
    previewSent.current = estimate.id;
    track("proposal_previewed", { trade: primaryTrade });
    void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "preview_opened", estimateId: estimate.id }), keepalive: true }).catch(() => {});
  }, [previewOpen, user, cloudMode, estimate.id, primaryTrade]);

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

  const refreshCredits = useCallback(async () => {
    if (!user) return;
    const r = await fetch("/api/credits", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setCredits(await r.json());
  }, [user]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches server credit balances on mount
  useEffect(() => { void refreshCredits(); }, [refreshCredits]);

  const readiness = useMemo(() => exportReadiness(estimate, business, totals), [estimate, business, totals]);

  /** Jump to the step (and field) that holds a missing detail. */
  const fixIssue = useCallback((i: ReadinessIssue) => {
    setStep(i.step); setCustomerView(false);
    if (i.fieldId) {
      const id = i.fieldId;
      // Wait for the step to render, then bring the field into view and focus it.
      setTimeout(() => { const el = document.getElementById(id); el?.scrollIntoView({ block: "center", behavior: "smooth" }); el?.focus({ preventScroll: true }); }, 60);
    } else window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /**
   * The one finalize + export path behind Download PDF and Send via My Email. The export API applies
   * the bid-credit rules (an unchanged, already-finalized proposal is never charged again), so
   * switching between the two actions never uses an extra credit. Returns null when it stopped.
   */
  const runExport = useCallback(async (deliver: "download" | "bytes" | "signing"): Promise<{ file?: File; message: string; link?: CreatedLink } | { error: string } | null> => {
    setExportMsg(null);
    // Missing details first, so nobody signs up only to be told the proposal isn't ready yet.
    if (readiness.length) { setMissing(readiness); fixIssue(readiness[0]); return null; }
    setMissing([]);
    if (!user) { setAuthOpen(true); return null; }
    if (!(user.verified ?? user.emailVerified)) { setExportMsg({ tone: "warn", text: "Please verify your email address before exporting." }); return null; }
    if (exportLock.current) return null;
    exportLock.current = true;
    setExporting(true);
    try {
      if (!(await saveCloud())) return { error: "We couldn't save your latest changes, so we didn't export. Check your connection and try again." };
      // Create Signing Link finalizes through the same server path (same credit rules), then freezes the version.
      const target = deliver === "signing" ? `/api/estimates/${estimate.id}/signing` : `/api/estimates/${estimate.id}/export`;
      const r = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deliver }) }).catch(() => null);
      if (!r) return { error: "We couldn't reach Built2Bid. Check your connection and try again. No bid credit was used." };
      const data = await r.json().catch(() => ({}));
      if (r.status === 402) { await refreshCredits(); setUpgradeOpen(true); return null; }
      if (r.status === 401) { setAuthOpen(true); return null; }
      if (r.status === 422 && Array.isArray(data?.error?.missing) && data.error.missing.length) {
        setMissing(data.error.missing as ReadinessIssue[]); fixIssue(data.error.missing[0] as ReadinessIssue); return null;
      }
      if (!r.ok) return { error: data?.error?.message ?? "Export failed. Please try again." };
      const message = exportMessage(data.creditSource as CreditSource, data.versionNumber, data.credits);
      setFinalizedHere(true);
      // A PDF was actually generated on the server (response ok): mirror it for GA4 / the Pixel.
      track("pdf_exported", { trade: primaryTrade });
      await refreshCredits();
      if (deliver === "signing") {
        const file = data.pdfBase64 ? base64File(data.pdfBase64, data.filename) : undefined;
        const linkMsg = data.charged ? message : "This version was already finalized, so creating the link used no credit.";
        return { message: linkMsg, link: { url: data.url, requestId: data.requestId, expiresAt: data.expiresAt, versionNumber: data.versionNumber, total: data.total, file, message: linkMsg } };
      }
      if (deliver === "bytes") {
        if (!data.pdfBase64) return { error: "We couldn't prepare the PDF for sharing. Please try again." };
        return { file: base64File(data.pdfBase64, data.filename), message };
      }
      if (data.url) window.location.assign(data.url);
      else if (data.pdfBase64) downloadBase64(data.pdfBase64, data.filename);
      return { message };
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  }, [user, readiness, fixIssue, estimate.id, saveCloud, refreshCredits, primaryTrade]);

  const doExport = useCallback(async () => {
    const res = await runExport("download");
    if (!res) return;
    if ("error" in res) setExportMsg({ tone: "danger", text: res.error });
    else setExportMsg({ tone: "ok", text: res.message });
  }, [runExport]);

  const prepareSend = useCallback(async () => {
    setSendPhase({ k: "preparing" });
    const res = await runExport("bytes");
    if (!res) { setSendOpen(false); return; }
    if ("error" in res) { setSendPhase({ k: "error", message: res.error }); return; }
    setSendPhase({ k: "ready", file: res.file!, note: res.message });
  }, [runExport]);

  /**
   * Create Signing Link, from the Proposal step or from the Email Proposal dialog. Either way the new
   * link lands in the Email Proposal dialog, in "Signing link" mode, ready to send.
   */
  const createSigning = useCallback(async (fromDialog = false) => {
    const stamp = editStamp;
    // The bid hasn't changed since this session's link was made: show that link, no new request.
    if (!fromDialog && signingLink && Date.parse(signingLink.expiresAt) > Date.now()) {
      setSendKey((k) => k + 1); setSendPhase({ k: "idle" }); setSendMode("link"); setSendOpen(true);
      return;
    }
    if (fromDialog) setCreatingLink(true);
    const res = await runExport("signing").finally(() => setCreatingLink(false));
    if (!res) { if (fromDialog) setSendOpen(false); return; }
    if ("error" in res) {
      if (fromDialog) setSendOpen(false);
      setExportMsg({ tone: "danger", text: res.error }); return;
    }
    setSigningLinkState(res.link ? { link: res.link, stamp } : null);
    setSigningRefresh((n) => n + 1);
    setStep("proposal");
    if (!fromDialog) {
      setSendKey((k) => k + 1);
      setSendPhase({ k: "idle" });
      setSendMode("link");
      setSendOpen(true);
    }
  }, [runExport, editStamp, signingLink]);

  const changeSendMode = useCallback((m: SendMode) => {
    setSendMode(m);
    if (m === "pdf" && sendPhase.k === "idle") void prepareSend();
  }, [sendPhase.k, prepareSend]);

  const startSend = useCallback(() => {
    // Checks that need another screen (sign-in, missing details) run before the dialog opens.
    if (!user || !(user.verified ?? user.emailVerified) || readiness.length) { void runExport("bytes"); return; }
    if (exportLock.current) return;
    setSendKey((k) => k + 1);
    setSendMode("pdf");
    setSendOpen(true);
    void prepareSend();
  }, [user, readiness.length, runExport, prepareSend]);

  const shareEmail = useMemo<ShareEmailInput>(() => ({
    customerName: estimate.customer.name, customerEmail: estimate.customer.email, projectTitle: estimate.title,
    companyName: business.companyName, contactName: business.contactName, phone: displayPhone(business.phone),
  }), [estimate.customer.name, estimate.customer.email, estimate.title, business.companyName, business.contactName, business.phone]);

  // Resume an export that was interrupted by sign-in.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoExport && user && cloudMode && !autoRan.current) {
      autoRan.current = true;
      void doExport();
    }
  }, [autoExport, user, cloudMode, doExport]);

  const alreadyFinalized = finalizedHere || estimate.status === "finalized";
  // Issues drop off the notice as soon as they are fixed.
  const missingNow = missing.filter((m) => readiness.some((r) => r.code === m.code));
  const missingCodes = new Set<string>(missingNow.map((m) => m.code));
  const status = stepStatuses({ estimate, business, config, totals, visited, finalized: alreadyFinalized });
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  // On narrow screens the step strip scrolls sideways: keep the current step in view.
  const stepsRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    stepsRef.current?.querySelector<HTMLElement>('[aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [step]);
  // Publish the sticky header's height so sticky content below it (the selected-items toolbar)
  // sits under it at every screen width instead of behind it.
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current, root = rootRef.current;
    if (!header || !root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => root.style.setProperty("--builder-header-h", `${Math.ceil(header.getBoundingClientRect().height)}px`));
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  const goTo = (s: Step) => { setStep(s); setCustomerView(false); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const lastTrash = state.trash[state.trash.length - 1];

  return (
    <BuilderOpsProvider estimateId={cloudMode && user ? estimate.id : null} saved={save === "saved"} ops={ops} refresh={refreshOps}>
    <div ref={rootRef} className="app-theme flex min-h-screen flex-col">
      {/* Project header */}
      <header ref={headerRef} className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur no-print">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-5">
          <div className="flex shrink-0 items-center gap-2">
            <Link href={user ? "/dashboard" : "/"} className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-accent-ink hover:bg-black/5" aria-label={user ? "Dashboard" : "Home"} data-testid="builder-home"><Home className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">{user ? "Dashboard" : "Home"}</span></Link>
            <span className="hidden lg:block"><Logo className="text-base" /></span>
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="est-title" className="sr-only">Project title</label>
            <input id="est-title" value={estimate.title} onChange={(e) => dispatch({ type: "patch", patch: { title: e.target.value } })}
              // Starter title ("Decks & Porches Project"): select it on focus so typing replaces it.
              onFocus={(ev) => { if (isDefaultTitle(estimate)) { const el = ev.currentTarget; requestAnimationFrame(() => el.select()); } }} className="cell w-full max-w-md truncate font-display text-lg font-bold" placeholder="Project title" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1.5 text-xs text-muted [&>*]:whitespace-nowrap">
              <span>{estimate.customer.name || <button className="underline" onClick={() => setStep("project")}>Add customer</button>}</span>
              <span className="hidden max-w-[16rem] truncate sm:inline">{estimate.trades.map(tradeName).join(" + ")}</span>
              {(estimate.location.city || estimate.location.zip) && <span className="hidden md:inline">{[estimate.location.city, estimate.location.state, estimate.location.zip].filter(Boolean).join(", ")}</span>}
              <span className="hidden md:inline">#{estimate.estimateNumber}</span>
              <span className="hidden lg:inline">{estimate.estimateDate}{estimate.expirationDate ? ` → ${estimate.expirationDate}` : ""}</span>
              <span className={cn("rounded px-1.5 py-0.5 font-semibold", estimate.status === "finalized" ? "bg-ok-tint text-ok" : "bg-black/5 text-ink-soft")}>{estimate.status === "finalized" ? "Finalized" : "Draft"}</span>
              <SaveBadge state={save} signedIn={Boolean(user)} />
            </div>
          </div>
          <div className="flex w-full flex-wrap items-start justify-end gap-2 lg:w-auto lg:flex-nowrap">
            {credits && !credits.unlimited && <UpgradeLink compact className="border-transparent text-xs sm:text-sm" />}
            {step === "estimate" && (
              <Button size="sm" variant="ghost" onClick={() => setCustomerView(!customerView)} aria-pressed={customerView} className="hidden md:inline-flex">
                {customerView ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} Customer view
              </Button>
            )}
            {cloudMode && user && save === "saved" && <ScheduleNowButton estimateId={estimate.id} />}
            {cloudMode && user && <InternalReportButton estimateId={estimate.id} locked={credits ? !credits.unlimited : false} saved={save === "saved"} signedIn={Boolean(user)} businessEmail={business.email} title={estimate.title} />}
            <Button size="sm" variant="secondary" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4" /> <span className="hidden sm:inline">Preview My Bid</span><span className="sm:hidden">Preview</span></Button>
            <Button size="sm" variant="secondary" onClick={startSend} disabled={exporting} aria-label="Send via My Email" data-testid="send-email-header">
              <Mail className="h-4 w-4" aria-hidden /> <span className="max-[419px]:hidden"><span className="sm:hidden">Email</span><span className="hidden sm:inline xl:hidden">Send by email</span><span className="hidden xl:inline">Send via My Email</span></span>
            </Button>
            <div className="flex flex-col items-end">
              <Button size="sm" variant="accent" onClick={doExport} disabled={exporting} aria-label="Download PDF">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} <span><span className="max-[360px]:hidden">Download </span>PDF</span>
              </Button>
              {credits && <span className="mt-0.5"><CreditSummary credits={credits} /></span>}
              {/* Holds the credit line's space while balances load, so the header doesn't grow and push
                  the steps and estimate down a moment after the page appears (layout shift). */}
              {user && !credits && <span className="invisible mt-0.5 text-[11px] tabular" aria-hidden>Monthly 0 · Starter 0</span>}
              {credits && !credits.unlimited && <span className="text-[11px] text-muted">{alreadyFinalized ? "Updates are free" : "Uses 1 credit"}</span>}
            </div>
            <ThemeToggle signedIn={Boolean(user)} account={user?.theme ?? null} className="min-h-9 min-w-9 md:min-h-9 md:min-w-9" />
          </div>
        </div>
        <nav aria-label="Builder steps" className="mx-auto max-w-[1400px] px-3 sm:px-5">
          <p className="sr-only" aria-live="polite">Step {stepIndex + 1} of {STEPS.length}: {STEPS[stepIndex]?.label}</p>
          <ol ref={stepsRef} className="relative flex gap-1 overflow-x-auto">
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button
                  onClick={() => goTo(s.id)}
                  aria-current={step === s.id ? "step" : undefined}
                  className={cn("flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold", step === s.id ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink")}
                >
                  <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold",
                    status[s.id] === "complete" ? "bg-teal text-navy"
                      : status[s.id] === "needs_attention" && step !== s.id ? "bg-warn-tint text-warn ring-1 ring-warn/40"
                        : step === s.id ? "bg-navy text-white" : "bg-black/5 text-ink-soft")} aria-hidden>
                    {status[s.id] === "complete" ? <Check className="h-3 w-3" strokeWidth={3} /> : status[s.id] === "needs_attention" && step !== s.id ? <AlertCircle className="h-3 w-3" strokeWidth={3} /> : i + 1}
                  </span>
                  {s.label}
                  {status[s.id] === "complete" && <span className="sr-only">(done)</span>}
                  {status[s.id] === "needs_attention" && <span className="sr-only">(needs details)</span>}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-5 pb-28 sm:px-5 lg:pb-8">
        {exportMsg && (
          <Notice tone={exportMsg.tone === "ok" ? "ok" : exportMsg.tone} className="mb-4">
            <span className="flex items-center justify-between gap-3">{exportMsg.text}<button onClick={() => setExportMsg(null)} className="text-xs underline">Dismiss</button></span>
          </Notice>
        )}
        {missingNow.length > 0 && (
          <Notice tone="warn" className="mb-4" title="A few details are needed before you download">
            <ul className="mt-1 space-y-1" data-testid="export-missing">
              {missingNow.map((m) => (
                <li key={m.code} className="flex flex-wrap items-center justify-between gap-x-3">
                  <span>{m.message}</span>
                  <button type="button" className="min-h-9 text-sm font-semibold text-brand underline" onClick={() => fixIssue(m)}>{m.step === "company" ? "Go to company" : m.step === "project" ? "Go to customer & project" : "Go to estimate"}</button>
                </li>
              ))}
            </ul>
            <button type="button" className="mt-1 text-xs underline" onClick={() => setMissing([])}>Dismiss</button>
          </Notice>
        )}
        {user && !(user.verified ?? user.emailVerified) && <Notice tone="warn" className="mb-4" title="Verify your email">Check your inbox for the verification link to unlock PDF downloads.</Notice>}
        {lastTrash && (
          <div className="on-dark fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg lg:bottom-6" role="status">
            {lastTrash.kind === "trade" ? `Removed ${lastTrash.label} and its sections` : `Deleted ${lastTrash.label}`}
            <button onClick={() => dispatch({ type: "undo" })} className="inline-flex items-center gap-1 font-semibold text-accent underline"><Undo2 className="h-4 w-4" /> Undo</button>
          </div>
        )}

        {step === "company" && <CompanyStep business={business} onChange={setBusiness} signedIn={Boolean(user)} missing={missingCodes} />}
        {step === "project" && <ProjectStep estimate={estimate} dispatch={dispatch} signedIn={Boolean(user)} missing={missingCodes} />}
        {step === "estimate" && (customerView ? (
          <div className="rounded-xl bg-stage p-3 sm:p-6">
            <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-muted">Customer view: this is all your customer sees</p>
            <ProposalView doc={doc} />
          </div>
        ) : (
          <>{isWashingEstimate(estimate) && <WashingJobPanel estimate={estimate} dispatch={dispatch} />}<Workspace estimate={estimate} dispatch={dispatch} lib={lib} /></>
        ))}
        {step === "scope" && <ScopeStep estimate={estimate} config={config} onConfig={onConfig} signedIn={Boolean(user)} estimateId={cloudMode ? estimate.id : null} />}
        {step === "proposal" && esign && cloudMode && <SigningPanel estimateId={estimate.id} onCreate={() => void createSigning()} creating={exporting} refreshKey={signingRefresh}
          onRevoked={(id) => setSigningLinkState((s) => (s?.link.requestId === id ? null : s))} />}
        {step === "proposal" && cloudMode && user && <ContractPanel estimateId={estimate.id} />}
        {step === "proposal" && <ProposalStep estimate={estimate} business={business} config={config} onConfig={onConfig}
          stylePolicy={ops?.stylePolicy ?? null} ownerBusiness={ownerBusiness} resetting={resettingStyle}
          onResetStyle={ops?.stylePolicy?.managed && (config.styleOverrides?.length || ops.stylePolicy.canOverride) ? () => void resetStyle() : undefined} />}

        {/* Step footer: Back / Next on every step */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 no-print">
          {stepIndex > 0 ? (
            <Button variant="secondary" onClick={() => goTo(STEPS[stepIndex - 1].id)}><ArrowLeft className="h-4 w-4" /><span>Back<span className="hidden sm:inline">: {STEPS[stepIndex - 1].label.toLowerCase()}</span></span></Button>
          ) : <span />}
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">Step {stepIndex + 1} of {STEPS.length}</span>
            {stepIndex < STEPS.length - 1 ? (
              <Button size="lg" onClick={() => goTo(STEPS[stepIndex + 1].id)}>{STEPS[stepIndex].next} <ArrowRight className="h-4 w-4" /></Button>
            ) : (
              <span className="flex flex-wrap justify-end gap-2">
                {esign && cloudMode && <Button size="lg" variant="secondary" onClick={() => void createSigning()} disabled={exporting}><Link2 className="h-4 w-4" aria-hidden /> Create Signing Link</Button>}
                <Button size="lg" variant="secondary" onClick={startSend} disabled={exporting}><Mail className="h-4 w-4" aria-hidden /> Send via My Email</Button>
                <Button size="lg" variant="accent" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4" /> Preview &amp; download</Button>
              </span>
            )}
          </div>
        </div>
      </main>

      {/* Mobile persistent total */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 shadow-[0_-4px_12px_rgb(0_0_0/0.06)] lg:hidden no-print">
        <div>
          <p className="text-xs text-muted">Proposal total</p>
          <p className="tabular font-display text-lg font-extrabold text-navy">{formatCurrency(totals.total)}</p>
        </div>
        <div className="text-right text-xs text-muted">
          <p>Profit <span className="tabular font-semibold text-ink">{formatCurrency(totals.grossProfit)}</span></p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4" /> Preview</Button>
      </div>

      <Modal open={previewOpen} onOpenChange={setPreviewOpen} title="Preview your proposal" description="This is exactly what your customer will see. Previews are always free." wide>
        <div className="-mx-6 bg-stage p-3 sm:p-5"><ProposalView doc={doc} /></div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => { setPreviewOpen(false); setStep("proposal"); }}>Customize proposal</Button>
          {esign && cloudMode && <Button variant="secondary" onClick={() => { setPreviewOpen(false); void createSigning(); }}><Link2 className="h-4 w-4" aria-hidden /> Create Signing Link</Button>}
          <Button variant="secondary" onClick={() => { setPreviewOpen(false); startSend(); }}><Mail className="h-4 w-4" aria-hidden /> Send via My Email</Button>
          <Button variant="accent" onClick={() => { setPreviewOpen(false); void doExport(); }}><Download className="h-4 w-4" /> Download PDF</Button>
        </div>
      </Modal>
      <SendEmailDialog key={sendKey} open={sendOpen} onOpenChange={(o) => { if (!o && (sendPhase.k === "preparing" || creatingLink)) return; setSendOpen(o); }}
        phase={sendPhase} emailInput={shareEmail} onRetry={() => void prepareSend()}
        mode={sendMode} onModeChange={changeSendMode} allowLink={esign && cloudMode}
        link={signingLink} onCreateLink={() => void createSigning(true)} creatingLink={creatingLink} />
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} next={`/builder?draft=${estimate.id}&export=1`} onVerified={() => { window.location.assign(`/builder?draft=${estimate.id}&export=1`); }} />
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} nextCycleAt={credits?.nextCycleAt} />
    </div>
    </BuilderOpsProvider>
  );
}

function brandToBusiness(b: OwnerBrand | null): BusinessProfile | null {
  if (!b) return null;
  return {
    companyName: b.companyName, logoUrl: b.logoUrl, primaryColor: b.primaryColor, secondaryColor: b.secondaryColor,
    logoLayout: (["left", "center", "stacked"].includes(b.logoLayout) ? b.logoLayout : "left") as BusinessProfile["logoLayout"],
    headerStyle: (["solid", "line", "minimal"].includes(b.headerStyle) ? b.headerStyle : "solid") as BusinessProfile["headerStyle"],
    phone: b.phone, email: b.email, address: b.address, website: b.website, licenseNumber: b.licenseNumber, tagline: b.tagline,
  };
}

function SaveBadge({ state, signedIn }: { state: SaveState; signedIn: boolean }) {
  const label =
    state === "saving" ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving…</span>
    : state === "saved" ? <span className="inline-flex items-center gap-1 text-ok"><Check className="h-3 w-3" aria-hidden /> Saved</span>
    : state === "error" ? <span className="inline-flex items-center gap-1 text-warn"><CloudOff className="h-3 w-3" aria-hidden /> Not synced, saved on this device</span>
    : <span className="inline-flex items-center gap-1"><RotateCcw className="h-3 w-3" aria-hidden /> {signedIn ? "Saved on this device" : "Draft saved on this device"}</span>;
  return (
    <>
      {/* Remounts on each state change, so the new status fades in (motion-fade) and is noticed. */}
      <span key={state} className="inline-flex motion-fade" data-testid="save-badge" data-state={state}>{label}</span>
      {/* Screen readers hear only a failed sync, not every autosave. */}
      <span className="sr-only" role="status">{state === "error" ? "Changes not synced to your account. Your work is saved on this device." : ""}</span>
    </>
  );
}
