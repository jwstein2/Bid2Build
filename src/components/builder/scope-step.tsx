"use client";
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, ChevronDown, Heading, History, List, ListOrdered, Loader2, Maximize2, Minimize2, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, Undo2, X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { Estimate } from "@/lib/estimate/types";
import type { ProposalConfig } from "@/lib/proposal/types";
import {
  approvedExclusions, bidFingerprint, buildGenerationInput, exclusionLine, hasBidContent, newId, pushExclusionHistory, pushScopeHistory, WRITING_STYLES,
  type ExclusionItem, type ExclusionSettings, type ScopeSettings, type TextSource, type WritingStyle,
} from "@/lib/proposal/text-sections";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { Modal } from "./dialogs";
import { GenerationError, requestGeneration } from "./proposal-text-client";

interface Props {
  estimate: Estimate;
  config: ProposalConfig;
  onConfig: (c: ProposalConfig) => void;
  signedIn: boolean;
  estimateId?: string | null;
}

const now = () => new Date().toISOString();

/** Scope of Work + Exclusions & Clarifications, shared by every trade's estimate. */
export function ScopeStep(props: Props) {
  const { estimate, config, onConfig } = props;
  const fingerprint = useMemo(() => bidFingerprint(estimate), [estimate]);
  const canGenerate = useMemo(() => hasBidContent(buildGenerationInput(estimate, { kind: "scope", style: "simple" })), [estimate]);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-navy">Scope &amp; exclusions</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Say clearly what&apos;s included and what isn&apos;t. Write it yourself or draft it from your bid, then edit anything. Prices, costs, and your markup are never sent for drafting.
        </p>
      </div>
      <ScopeEditor {...props} fingerprint={fingerprint} canGenerate={canGenerate} scope={config.scope} text={config.scopeOfWork}
        onChange={(scopeOfWork, scope) => onConfig({ ...config, scopeOfWork, scope })} />
      <ExclusionsEditor {...props} fingerprint={fingerprint} canGenerate={canGenerate} value={config.exclusionList}
        onChange={(exclusionList) => onConfig({ ...config, exclusionList })} />
    </div>
  );
}

/* ------------------------------------------------ shared bits ------------------------------------ */

function VisibilityToggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink-soft">
      <span className="relative inline-flex">
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-10 rounded-full bg-line-strong transition-colors peer-checked:bg-ok peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-focus" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
      Show on Customer Proposal
    </label>
  );
}

function StylePicker({ value, onChange, label }: { value: WritingStyle; onChange: (s: WritingStyle) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-paper p-0.5">
      {WRITING_STYLES.map((s) => (
        <button key={s.id} type="button" role="radio" aria-checked={value === s.id} title={s.hint} onClick={() => onChange(s.id)}
          className={cn("rounded-md px-2.5 py-1 text-xs font-semibold", value === s.id ? "bg-surface text-navy shadow-sm" : "text-muted hover:text-ink")}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

function StaleNotice({ children, action }: { children: React.ReactNode; action: React.ReactNode }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/25 bg-warn-tint px-3 py-2 text-sm text-ink-soft">
      <span className="flex items-center gap-2"><RefreshCw className="h-4 w-4 text-warn" aria-hidden />{children}</span>
      <span className="flex gap-2">{action}</span>
    </div>
  );
}

const SOURCE_LABEL: Record<TextSource, string> = { manual: "Written by you", generated: "Draft, not yet edited", edited: "Draft, edited by you" };

function when(iso: string) {
  try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; }
}

/* ------------------------------------------------ Scope of Work ---------------------------------- */

function ScopeEditor({ estimate, signedIn, estimateId, fingerprint, canGenerate, scope, text, onChange }: Props & {
  fingerprint: string; canGenerate: boolean; scope: ScopeSettings; text: string; onChange: (text: string, s: ScopeSettings) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState<{ scope: string; generator: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const stale = Boolean(scope.basedOn && scope.basedOn !== fingerprint && text.trim());
  const hasText = Boolean(text.trim());
  const set = (patch: Partial<ScopeSettings>, nextText = text) => onChange(nextText, { ...scope, ...patch, updatedAt: now() });

  const apply = (generated: string, generator: string, mode: "replace" | "append") => {
    const history = pushScopeHistory(scope, text);
    const next = mode === "append" && hasText ? `${text.trimEnd()}\n\n${generated}` : generated;
    onChange(next, {
      ...scope, history, generator, generatedAt: now(), basedOn: fingerprint, updatedAt: now(),
      source: mode === "append" && hasText ? "edited" : "generated",
    });
    setPending(null);
  };

  const generate = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const input = buildGenerationInput(estimate, { kind: "scope", style: scope.style, includeNotes });
      const r = await requestGeneration(input, { signedIn, estimateId });
      if (!r.scope?.trim()) { setNotice({ tone: "danger", text: "There wasn't enough in the bid to describe. Add line items and try again." }); return; }
      if (r.notice) setNotice({ tone: "info", text: r.notice });
      // Ask before touching anything the contractor wrote or edited.
      if (hasText && scope.source !== "generated") setPending({ scope: r.scope, generator: r.generator });
      else apply(r.scope, r.generator, "replace");
    } catch (e) {
      setNotice({ tone: "danger", text: e instanceof GenerationError ? e.message : "Couldn't generate right now. You can keep writing your own scope." });
    } finally {
      setBusy(false);
    }
  };

  const restore = (content: string) => {
    const history = pushScopeHistory(scope, text);
    onChange(content, { ...scope, history, source: "edited", updatedAt: now() });
    setHistoryOpen(false);
  };

  /** Toolbar: prefix (or un-prefix) the selected lines. */
  const formatLines = (kind: "bullet" | "number" | "heading") => {
    const el = ref.current;
    if (!el) return;
    const start = text.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const endIdx = text.indexOf("\n", el.selectionEnd);
    const end = endIdx === -1 ? text.length : endIdx;
    const lines = text.slice(start, end).split("\n");
    const stripped = lines.map((l) => l.replace(/^\s*(?:•|-|\*|\d+[.)])\s+/, ""));
    let out: string[];
    if (kind === "bullet") out = lines.every((l) => /^\s*•\s/.test(l)) ? stripped : stripped.map((l) => (l.trim() ? `• ${l}` : l));
    else if (kind === "number") out = lines.every((l) => /^\s*\d+[.)]\s/.test(l)) ? stripped : stripped.map((l, i) => (l.trim() ? `${i + 1}. ${l}` : l));
    else out = lines.map((l) => (l === l.toUpperCase() ? l.charAt(0) + l.slice(1).toLowerCase() : l.toUpperCase()));
    const next = text.slice(0, start) + out.join("\n") + text.slice(end);
    set({ source: scope.source === "generated" ? "edited" : scope.source }, next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start, start + out.join("\n").length); });
  };

  const lastRevision = scope.history[scope.history.length - 1];
  const rows = expanded ? 24 : Math.min(18, Math.max(8, text.split("\n").length + 2));

  return (
    <section aria-labelledby="sow-h" className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sow-h" className="font-display text-lg font-bold">Scope of Work</h2>
          <p className="text-sm text-muted">What you&apos;ll provide and perform. Appears before pricing on the proposal.</p>
        </div>
        <VisibilityToggle id="sow-visible" checked={scope.visible} onChange={(visible) => set({ visible })} />
      </div>

      {stale && (
        <div className="mt-3">
          <StaleNotice action={<Button size="sm" variant="secondary" onClick={generate} disabled={busy || !canGenerate}>Update Scope</Button>}>
            Your bid has changed since this scope was generated.
          </StaleNotice>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-t-lg border border-b-0 border-line bg-paper px-2 py-1.5">
        <div className="flex items-center gap-0.5" role="toolbar" aria-label="Formatting">
          <ToolBtn label="Bulleted list" onClick={() => formatLines("bullet")}><List className="h-4 w-4" /></ToolBtn>
          <ToolBtn label="Numbered list" onClick={() => formatLines("number")}><ListOrdered className="h-4 w-4" /></ToolBtn>
          <ToolBtn label="Heading (uppercase line)" onClick={() => formatLines("heading")}><Heading className="h-4 w-4" /></ToolBtn>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <ToolBtn label={expanded ? "Shrink editor" : "Expand editor"} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</ToolBtn>
        </div>
        <StylePicker label="Scope writing style" value={scope.style} onChange={(style) => set({ style })} />
      </div>
      <label htmlFor="sow-text" className="sr-only">Scope of Work</label>
      <textarea
        id="sow-text" ref={ref} rows={rows} value={text} maxLength={20000}
        onChange={(e) => set({ source: scope.source === "generated" ? "edited" : scope.source === "edited" ? "edited" : "manual" }, e.target.value)}
        placeholder={"Describe the work you'll do, for example:\nBuild a new composite deck with pressure-treated framing, concrete footings, aluminum railing, and stairs."}
        className="field rounded-t-none font-[inherit] text-sm leading-relaxed"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={hasText ? "secondary" : "accent"} onClick={generate} disabled={busy || !canGenerate} title={canGenerate ? undefined : "Add line items to your estimate first"}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : hasText ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          {hasText ? "Regenerate" : "Generate Scope from Bid"}
        </Button>
        {lastRevision && (
          <Button size="sm" variant="ghost" onClick={() => restore(lastRevision.content)}><Undo2 className="h-4 w-4" /> Undo</Button>
        )}
        {scope.history.length > 0 && (
          <div className="relative">
            <Button size="sm" variant="ghost" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><History className="h-4 w-4" /> Restore a version <ChevronDown className="h-3 w-3" /></Button>
            {historyOpen && (
              <ul className="absolute left-0 z-20 mt-1 max-h-72 w-80 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
                {[...scope.history].reverse().map((h, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => restore(h.content)} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-paper">
                      <span className="block text-xs font-semibold text-ink-soft">{when(h.at)} · {SOURCE_LABEL[h.source]}</span>
                      <span className="line-clamp-2 text-xs text-muted">{h.content}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} className="accent-[var(--color-brand)]" />
          Use my private project notes when drafting
        </label>
      </div>

      <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
        {hasText && <span>{SOURCE_LABEL[scope.source]}</span>}
        {!scope.visible && <span className="font-semibold text-warn">Hidden from the customer. Saved for your records.</span>}
        {scope.visible && !hasText && <span>Empty sections are left off the proposal.</span>}
        {!canGenerate && <span className="font-semibold text-ink-soft">Add line items on the Estimate step to draft from your bid.</span>}
        {canGenerate && !signedIn && <span>AI writing needs a free account. Without it, drafts are built from your line items.</span>}
      </p>
      {notice && <p role="status" className={cn("mt-2 rounded-md px-3 py-2 text-sm", notice.tone === "danger" ? "bg-danger-tint text-danger" : "bg-accent-tint text-ink-soft")}>{notice.text}</p>}

      <Modal open={Boolean(pending)} onOpenChange={(o) => !o && setPending(null)} title="Replace your scope?" description="Your scope has text you wrote or edited. Choose what to do with the new draft. Your current text is saved in version history either way." wide>
        {pending && (
          <>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-paper p-3 font-sans text-sm text-ink-soft">{pending.scope}</pre>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setPending(null)}>Keep mine</Button>
              <Button variant="secondary" onClick={() => apply(pending.scope, pending.generator, "append")}><Plus className="h-4 w-4" /> Add below mine</Button>
              <Button onClick={() => apply(pending.scope, pending.generator, "replace")}>Replace</Button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}

function ToolBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-md text-ink-soft hover:bg-black/5">{children}</button>;
}

/* ------------------------------------------ Exclusions & Clarifications -------------------------- */

export function ExclusionsEditor({ estimate, signedIn, estimateId, fingerprint, canGenerate, value, onChange, config, manualOnly }: Props & {
  fingerprint: string; canGenerate: boolean; value: ExclusionSettings; onChange: (v: ExclusionSettings) => void; manualOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  const approved = value.items.filter((i) => i.status === "approved");
  const suggested = value.items.filter((i) => i.status === "suggested");
  const rejected = value.items.filter((i) => i.status === "rejected");
  const visibleCount = approvedExclusions(value).length;
  const stale = !manualOnly && Boolean(value.basedOn && value.basedOn !== fingerprint && approved.length);

  const set = (patch: Partial<ExclusionSettings>) => onChange({ ...value, ...patch, updatedAt: now() });
  const setItems = (items: ExclusionItem[], extra: Partial<ExclusionSettings> = {}) => set({ items, ...extra });
  const update = (id: string, patch: Partial<ExclusionItem>) =>
    setItems(value.items.map((i) => (i.id === id ? { ...i, ...patch, source: ("text" in patch || "title" in patch) && i.source === "generated" ? "edited" : i.source } : i)));
  const setStatus = (id: string, status: ExclusionItem["status"]) => setItems(value.items.map((i) => (i.id === id ? { ...i, status, review: status === "approved" ? null : i.review } : i)));
  const remove = (id: string) => setItems(value.items.filter((i) => i.id !== id), { history: pushExclusionHistory(value) });
  const move = (id: string, dir: -1 | 1) => {
    const list = [...approved];
    const idx = list.findIndex((i) => i.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= list.length) return;
    [list[idx], list[to]] = [list[to], list[idx]];
    setItems([...list, ...suggested, ...rejected]);
  };
  const add = () => {
    const id = newId();
    setItems([...value.items, { id, category: "custom", title: "", text: "", status: "approved", source: "manual", review: null }]);
    setFocusId(id);
  };

  const generate = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const input = buildGenerationInput(estimate, { kind: "exclusions", style: value.style, scope: config.scopeOfWork, existing: [...approved, ...rejected] });
      const r = await requestGeneration(input, { signedIn, estimateId });
      const fresh = (r.items ?? []).map((i) => ({ ...i, status: "suggested" as const }));
      // Replace earlier unreviewed suggestions; never touch approved or rejected ones.
      setItems([...approved, ...fresh, ...rejected], { history: pushExclusionHistory(value), generatedAt: now(), generator: r.generator, basedOn: fingerprint });
      const parts = [r.notice, fresh.length ? null : "No new suggestions. Your exclusions already cover the usual items for this job."].filter(Boolean);
      if (parts.length) setNotice({ tone: "info", text: parts.join(" ") });
    } catch (e) {
      setNotice({ tone: "danger", text: e instanceof GenerationError ? e.message : "Couldn't generate right now. You can add your own exclusions." });
    } finally {
      setBusy(false);
    }
  };

  const restore = (items: ExclusionItem[]) => {
    setItems(items, { history: pushExclusionHistory(value) });
    setHistoryOpen(false);
  };

  return (
    <section aria-labelledby="exc-h" className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="exc-h" className="font-display text-lg font-bold">Exclusions &amp; Clarifications</h2>
          <p className="text-sm text-muted">What isn&apos;t included, plus assumptions. Only items you approve appear on the proposal.</p>
        </div>
        <VisibilityToggle id="exc-visible" checked={value.visible} onChange={(visible) => set({ visible })} />
      </div>

      {stale && (
        <div className="mt-3">
          <StaleNotice action={<>
            <Button size="sm" variant="ghost" onClick={() => set({ basedOn: fingerprint })}>They still apply</Button>
            <Button size="sm" variant="secondary" onClick={generate} disabled={busy || !canGenerate}>Review suggestions</Button>
          </>}>
            Your estimate has changed. Review your exclusions to ensure they still apply.
          </StaleNotice>
        </div>
      )}

      {/* Approved list */}
      <ol className="mt-4 space-y-2" aria-label="Approved exclusions">
        {approved.map((i, n) => (
          <li key={i.id} className="flex gap-2 rounded-lg border border-line p-2">
            <span className="mt-2 w-5 shrink-0 text-right text-sm font-semibold text-muted">{n + 1}.</span>
            <div className="min-w-0 flex-1 space-y-1">
              <input aria-label={`Exclusion ${n + 1} heading`} className="cell w-full text-sm font-semibold" placeholder="Heading (optional), e.g. Permits & Inspections" value={i.title} maxLength={120}
                onChange={(e) => update(i.id, { title: e.target.value })} autoFocus={focusId === i.id} onFocus={() => focusId === i.id && setFocusId(null)} />
              <textarea aria-label={`Exclusion ${n + 1} text`} rows={2} className="field text-sm" placeholder="What is excluded or clarified" value={i.text} maxLength={1000}
                onChange={(e) => update(i.id, { text: e.target.value })} />
            </div>
            <div className="flex shrink-0 flex-col gap-0.5">
              <IconBtn label={`Move exclusion ${n + 1} up`} onClick={() => move(i.id, -1)} disabled={n === 0}><ArrowUp className="h-4 w-4" /></IconBtn>
              <IconBtn label={`Move exclusion ${n + 1} down`} onClick={() => move(i.id, 1)} disabled={n === approved.length - 1}><ArrowDown className="h-4 w-4" /></IconBtn>
              <IconBtn label={`Delete exclusion ${n + 1}`} onClick={() => remove(i.id)}><Trash2 className="h-4 w-4" /></IconBtn>
            </div>
          </li>
        ))}
      </ol>
      {approved.length === 0 && suggested.length === 0 && (
        <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
          No exclusions yet. {manualOnly ? "Add the ones you use on most bids." : "Add your own or generate suggestions from your bid."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={add}><Plus className="h-4 w-4" /> Add exclusion</Button>
        {!manualOnly && (
          <Button size="sm" variant={approved.length || suggested.length ? "secondary" : "accent"} onClick={generate} disabled={busy || !canGenerate} title={canGenerate ? undefined : "Add line items to your estimate first"}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : value.generatedAt ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {value.generatedAt ? "Regenerate suggestions" : "Generate Exclusions from Bid"}
          </Button>
        )}
        {value.history.length > 0 && (
          <div className="relative">
            <Button size="sm" variant="ghost" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><History className="h-4 w-4" /> Restore a version <ChevronDown className="h-3 w-3" /></Button>
            {historyOpen && (
              <ul className="absolute left-0 z-20 mt-1 max-h-72 w-80 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
                {[...value.history].reverse().map((h, k) => (
                  <li key={k}>
                    <button type="button" onClick={() => restore(h.items)} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-paper">
                      <span className="block text-xs font-semibold text-ink-soft">{when(h.at)} · {h.items.filter((x) => x.status === "approved").length} approved</span>
                      <span className="line-clamp-2 text-xs text-muted">{h.items.filter((x) => x.status === "approved").map(exclusionLine).join(" · ") || "Suggestions only"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!manualOnly && <span className="ml-auto"><StylePicker label="Exclusions writing style" value={value.style} onChange={(style) => set({ style })} /></span>}
      </div>
      {notice && <p role="status" className={cn("mt-2 rounded-md px-3 py-2 text-sm", notice.tone === "danger" ? "bg-danger-tint text-danger" : "bg-accent-tint text-ink-soft")}>{notice.text}</p>}

      {/* Suggestions awaiting review */}
      {suggested.length > 0 && (
        <div className="mt-5 rounded-lg border border-accent/40 bg-accent-tint/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-navy">Suggestions to review ({suggested.length})</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setItems(value.items.map((i) => (i.status === "suggested" ? { ...i, status: "rejected" } : i)))}>Reject all</Button>
              <Button size="sm" variant="secondary" onClick={() => setItems(value.items.map((i) => (i.status === "suggested" && !i.review ? { ...i, status: "approved" } : i)))} title="Approves every suggestion that isn't flagged for review">
                <Check className="h-4 w-4" /> Approve unflagged
              </Button>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted">Suggestions are not on the proposal until you approve them. Edit any wording first if you like.</p>
          <ul className="mt-3 space-y-2">
            {suggested.map((i) => (
              <li key={i.id} className="rounded-lg border border-line bg-surface p-2">
                {i.review && (
                  <p className="mb-1.5 flex items-start gap-1.5 rounded bg-warn-tint px-2 py-1 text-xs text-ink-soft"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden /><span><b>Check this one:</b> {i.review}</span></p>
                )}
                <input aria-label="Suggested exclusion heading" className="cell w-full text-sm font-semibold" value={i.title} maxLength={120} onChange={(e) => update(i.id, { title: e.target.value })} />
                <textarea aria-label="Suggested exclusion text" rows={2} className="field mt-1 text-sm" value={i.text} maxLength={1000} onChange={(e) => update(i.id, { text: e.target.value })} />
                <div className="mt-1.5 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setStatus(i.id, "rejected")}><X className="h-4 w-4" /> Reject</Button>
                  <Button size="sm" onClick={() => setStatus(i.id, "approved")}><Check className="h-4 w-4" /> Approve</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="mt-3">
          <button type="button" className="text-xs font-semibold text-muted underline" aria-expanded={showRejected} onClick={() => setShowRejected(!showRejected)}>
            {showRejected ? "Hide" : "Show"} rejected suggestions ({rejected.length})
          </button>
          {showRejected && (
            <ul className="mt-2 space-y-1">
              {rejected.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 rounded-md bg-paper px-2 py-1.5 text-sm text-muted">
                  <span className="min-w-0 truncate line-through">{exclusionLine(i)}</span>
                  <span className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setStatus(i.id, "suggested")}><RotateCcw className="h-4 w-4" /> Restore</Button>
                    <IconBtn label="Delete permanently" onClick={() => remove(i.id)}><Trash2 className="h-4 w-4" /></IconBtn>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-3 flex flex-wrap gap-x-3 text-xs text-muted">
        {!value.visible && <span className="font-semibold text-warn">Hidden from the customer. Saved for your records.</span>}
        {value.visible && visibleCount === 0 && <span>Nothing approved yet, so this section is left off the proposal.</span>}
        {value.visible && visibleCount > 0 && <span>{visibleCount} approved item{visibleCount === 1 ? "" : "s"} will appear on the proposal.</span>}
      </p>
    </section>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-black/5 hover:text-ink disabled:opacity-30">{children}</button>;
}
