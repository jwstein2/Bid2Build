"use client";
import { ArrowLeft, Loader2, Sparkles, Store } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import type { Estimate, LineItem } from "@/lib/estimate/types";
import { getTrade, tradeName, UNIT_ABBR } from "@/lib/trades/catalog";
import { formatCurrency } from "@/lib/estimate/money";
import { sectionTrade } from "@/lib/estimate/trades";
import { DEFAULT_LABOR_BURDEN, MAX_LABOR_BURDEN, MIN_LABOR_BURDEN, clampBurden } from "@/lib/ai-draft/labor-rates";
import { resolveDraft, sourceCounts, type DraftResponse, type PricedLine, type PriceSourceKind } from "@/lib/ai-draft/resolve";
import { loadStoredDraft, saveStoredDraft } from "@/lib/ai-draft/store";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { Badge, Notice } from "../ui/misc";
import { Modal } from "./dialogs";
import type { Action } from "./state";
import type { Library } from "./library";

const SOURCE_TONE: Record<PriceSourceKind, "ok" | "brand" | "warn" | "neutral"> = { saved: "ok", labor_rate: "brand", ai_guess: "warn", none: "neutral" };
const MAX_DESCRIPTION = 2000;

/** Pure: turns the reviewed lines into the applyDraft action payload (ids pre-made so Undo can remove them). */
export function draftSections(lines: PricedLine[], picked: Set<number>, makeId: () => string = () => crypto.randomUUID()) {
  const bySection = new Map<string, (Partial<LineItem> & { id: string })[]>();
  lines.forEach((l, i) => {
    if (!picked.has(i)) return;
    const row: Partial<LineItem> & { id: string } = {
      id: makeId(),
      name: l.name,
      description: l.description,
      costType: l.costType,
      treatment: l.costType === "permit" ? "pass_through" : "marked_up",
      quantity: String(l.quantity),
      unit: l.unit,
      unitCost: l.unitCost,
      taxable: l.costType === "material",
    };
    const list = bySection.get(l.section) ?? [];
    list.push(row);
    bySection.set(l.section, list);
  });
  return [...bySection.entries()].map(([name, items]) => ({ name, items }));
}

export function AiDraftButton({ estimate, dispatch, lib, onApplied }: { estimate: Estimate; dispatch: Dispatch<Action>; lib: Library; onApplied: (msg: string, undoIds: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/25 bg-brand-tint px-4 py-3" data-guide="builder.ai-draft">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold text-ink"><Sparkles className="h-4 w-4 text-brand" aria-hidden /> Draft with AI</p>
          <p className="text-sm text-ink-soft">Describe the job and get a starting list of items, quantities and prices to review.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} disabled={!lib.signedIn} title={lib.signedIn ? undefined : "Sign in to draft with AI"}>
          <Sparkles className="h-4 w-4" aria-hidden /> {lib.signedIn ? "Draft with AI" : "Sign in to use"}
        </Button>
      </div>
      {open && <AiDraftDialog estimate={estimate} lib={lib} onClose={() => setOpen(false)} onApply={(trade, sections) => {
        const ids = sections.flatMap((s) => s.items.map((i) => i.id));
        dispatch({ type: "applyDraft", trade, sections });
        // Keep the draft for later (Will meeting 2026-11-21); just note that its lines are now in the bid.
        const stored = loadStoredDraft(estimate.id);
        if (stored) saveStoredDraft(estimate.id, { ...stored, appliedAt: new Date().toISOString(), appliedCount: ids.length });
        setOpen(false);
        onApplied(`Added ${ids.length} drafted ${ids.length === 1 ? "item" : "items"} to ${tradeName(trade)}. Review every price before you send.`, ids);
      }} />}
    </>
  );
}

function AiDraftDialog({ estimate, lib, onClose, onApply }: {
  estimate: Estimate; lib: Library; onClose: () => void;
  onApply: (trade: string, sections: ReturnType<typeof draftSections>) => void;
}) {
  // Restores the last draft for this bid (Will meeting 2026-11-21): closing the dialog never loses it.
  const [stored] = useState(() => loadStoredDraft(estimate.id));
  const [trade, setTrade] = useState(stored?.trade && estimate.trades.includes(stored.trade) ? stored.trade : estimate.trades[0] ?? "other");
  const [description, setDescription] = useState(stored?.description ?? "");
  const [draftedFrom, setDraftedFrom] = useState(stored?.draftedFrom ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(stored?.appliedAt ? `You added ${stored.appliedCount ?? "some"} lines from this draft on ${new Date(stored.appliedAt).toLocaleString()}. Adding again adds them a second time.` : null);
  const [draft, setDraft] = useState<DraftResponse | null>(stored?.draft ?? null);
  const [editing, setEditing] = useState(false);
  const [burden, setBurden] = useState(stored?.burden ?? String(DEFAULT_LABOR_BURDEN));
  const [useBallpark, setUseBallpark] = useState(stored?.useBallpark ?? true);
  const [picked, setPicked] = useState<Set<number>>(new Set(stored?.picked ?? []));
  const appliedRef = useRef({ appliedAt: stored?.appliedAt ?? null, appliedCount: stored?.appliedCount });

  // No copy in this browser: ask the server for this bid's last saved draft (own rows only).
  useEffect(() => {
    if (stored?.draft || !lib.signedIn) return;
    let live = true;
    fetch(`/api/ai/bid-draft?estimateId=${encodeURIComponent(estimate.id)}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!live || !d?.lines?.length) return;
      setDraft((cur) => cur ?? (d as DraftResponse));
      setPicked((cur) => (cur.size ? cur : new Set((d as DraftResponse).lines.map((_, i) => i))));
      if (typeof d.description === "string") { setDescription((cur) => cur || d.description); setDraftedFrom(d.description); }
      if (typeof d.trade === "string" && estimate.trades.includes(d.trade)) setTrade(d.trade);
      setNotice(`Restored your last draft${d.savedAt ? ` from ${new Date(d.savedAt).toLocaleString()}` : ""}. Nothing was charged.`);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [stored, lib.signedIn, estimate.id, estimate.trades]);

  useEffect(() => {
    saveStoredDraft(estimate.id, { trade, description, draftedFrom, draft, picked: [...picked], burden, useBallpark, ...appliedRef.current });
  }, [estimate.id, trade, description, draftedFrom, draft, picked, burden, useBallpark]);

  const priced = useMemo(
    () => (draft ? resolveDraft(draft.lines, { savedItems: lib.items, wages: draft.labor.wages, laborBurden: clampBurden(Number(burden)), useBallpark, trade: draft.trade }) : []),
    [draft, lib.items, burden, useBallpark],
  );
  const counts = sourceCounts(priced);
  const total = priced.reduce((s, l, i) => (picked.has(i) && l.unitCost ? s + Number(l.unitCost) * l.quantity : s), 0);
  const where = estimate.location.zip || estimate.location.state ? [estimate.location.city, estimate.location.state, estimate.location.zip].filter(Boolean).join(", ") : null;

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const existingSections = estimate.groups.filter((g) => estimate.trades.length < 2 || sectionTrade(estimate, g) === trade).map((g) => g.name.trim()).filter(Boolean).slice(0, 30);
      const r = await fetch("/api/ai/bid-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Same description as the draft on screen = "draft again": a fresh draft on paid plans, the saved one otherwise.
        body: JSON.stringify({ estimateId: estimate.id, trade, description: description.trim(), location: { zip: estimate.location.zip || undefined, state: estimate.location.state || undefined }, existingSections, ...(draft && draftedFrom === description.trim() ? { fresh: true } : {}) }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data) { setError(data?.error?.message ?? "The draft didn't come through. Please try again."); return; }
      const d = data as DraftResponse & { cached?: boolean };
      appliedRef.current = { appliedAt: null, appliedCount: undefined };
      setDraft(d);
      setDraftedFrom(description.trim());
      setEditing(false);
      setNotice(d.notice ?? (d.cached ? "This is your saved draft for this description. Nothing was charged." : null));
      setPicked(new Set(d.lines.map((_, i) => i)));
    } catch {
      setError("You're offline or the server didn't answer. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (i: number) => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const sections = [...new Set(priced.map((l) => l.section))];

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Draft with AI" description={draft && !editing ? "Untick anything you don't want, then add the rest. Prices show where they came from." : "A starting point for this bid. Nothing is added until you review it."} wide>
      {!draft || editing ? (
        <div className="space-y-4">
          {estimate.trades.length > 1 && (
            <div>
              <label htmlFor="ai-draft-trade" className="label">Trade</label>
              <select id="ai-draft-trade" className="input" value={trade} onChange={(e) => setTrade(e.target.value)}>
                {estimate.trades.map((t) => <option key={t} value={t}>{getTrade(t)?.name ?? t}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="ai-draft-desc" className="label">Describe the job</label>
            <textarea
              id="ai-draft-desc"
              className="input min-h-32"
              maxLength={MAX_DESCRIPTION}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`For example: 5x8 ft bathroom, full gut. New tile floor and shower walls, double vanity with quartz top, new toilet and fan, mid-range finishes.`}
            />
            <p className="mt-1 text-xs text-muted">Include sizes and finish level for better quantities. Don&apos;t include customer names or addresses. {description.length}/{MAX_DESCRIPTION}</p>
          </div>
          <p className="text-sm text-ink-soft">{where ? <>Labor rates use the project location (<span className="font-semibold">{where}</span>).</> : "Add the project ZIP on the Project step for local labor rates. Without it, national rates are used."}</p>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex justify-end gap-2">
            {draft ? <Button variant="ghost" onClick={() => setEditing(false)}><ArrowLeft className="h-4 w-4" aria-hidden /> Back to your draft</Button> : <Button variant="ghost" onClick={onClose}>Cancel</Button>}
            <Button onClick={run} disabled={busy || description.trim().length < 10}>
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Drafting…</> : <><Sparkles className="h-4 w-4" aria-hidden /> Draft items</>}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {notice && <Notice tone="neutral">{notice}</Notice>}
          <div className="flex flex-wrap gap-1.5 text-xs" aria-label="Where prices came from">
            <Badge tone="ok">{counts.saved} your prices</Badge>
            <Badge tone="brand">{counts.labor_rate} local labor</Badge>
            <Badge tone="warn">{counts.ai_guess} AI guesses</Badge>
            {counts.none > 0 && <Badge>{counts.none} need a price</Badge>}
          </div>

          <div className="grid gap-3 rounded-lg border border-line p-3 text-sm sm:grid-cols-2">
            <label className="flex items-center gap-2">
              <span className="shrink-0">Labor burden ×</span>
              <input type="number" inputMode="decimal" className="input max-w-24" step="0.05" min={MIN_LABOR_BURDEN} max={MAX_LABOR_BURDEN} value={burden} onChange={(e) => setBurden(e.target.value)} aria-describedby="ai-draft-burden-help" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useBallpark} onChange={(e) => setUseBallpark(e.target.checked)} />
              <span>Fill gaps with AI ballpark prices</span>
            </label>
            <p id="ai-draft-burden-help" className="text-xs text-muted sm:col-span-2">
              Labor = {draft.labor.source} {draft.labor.period} median wage{draft.labor.state ? ` for ${draft.labor.state}` : " (US)"} × burden for payroll taxes, workers&apos; comp and insurance. Your markup is added on top, as usual.
            </p>
          </div>

          <div className="max-h-[45dvh] space-y-3 overflow-y-auto pr-1">
            {sections.map((sec) => (
              <div key={sec}>
                <p className="text-xs font-bold uppercase tracking-wider text-muted">{sec}</p>
                <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
                  {priced.map((l, i) => l.section !== sec ? null : (
                    <li key={i} className={cn("flex items-start gap-3 px-3 py-2 text-sm", !picked.has(i) && "opacity-50")}>
                      <input type="checkbox" className="mt-1" checked={picked.has(i)} onChange={() => toggle(i)} aria-label={`Include ${l.name}`} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink">{l.name}</p>
                        {(l.description || l.basis) && <p className="text-xs text-muted">{[l.description, l.basis].filter(Boolean).join(" · ")}</p>}
                        <p className="mt-0.5"><Badge tone={SOURCE_TONE[l.source.kind]}>{l.source.label}</Badge> <span className="text-xs text-muted">{l.source.detail}</span></p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tabular-nums">{l.quantity} {UNIT_ABBR[l.unit] ?? l.unit}</p>
                        <p className="tabular-nums text-xs text-muted">{l.unitCost ? `${formatCurrency(l.unitCost)}/${UNIT_ABBR[l.unit] ?? l.unit}` : "—"}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {(draft.assumptions.length > 0 || draft.questions.length > 0) && (
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              {draft.assumptions.length > 0 && <div><p className="font-semibold">AI assumed</p><ul className="mt-1 list-disc pl-5 text-ink-soft">{draft.assumptions.map((a, k) => <li key={k}>{a}</li>)}</ul></div>}
              {draft.questions.length > 0 && <div><p className="font-semibold">Confirm with the customer</p><ul className="mt-1 list-disc pl-5 text-ink-soft">{draft.questions.map((a, k) => <li key={k}>{a}</li>)}</ul></div>}
            </div>
          )}

          <p className="flex items-center gap-1.5 text-xs text-muted"><Store className="h-3.5 w-3.5" aria-hidden /> Home Depot and Lowe&apos;s online prices: coming soon.</p>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <Button variant="ghost" onClick={() => { setEditing(true); setError(null); }}><ArrowLeft className="h-4 w-4" aria-hidden /> Edit description</Button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink-soft">Cost before markup: <span className="font-semibold tabular-nums text-ink">{formatCurrency(total)}</span></span>
              <Button onClick={() => onApply(draft.trade, draftSections(priced, picked))} disabled={picked.size === 0}>Add {picked.size} {picked.size === 1 ? "item" : "items"}</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
