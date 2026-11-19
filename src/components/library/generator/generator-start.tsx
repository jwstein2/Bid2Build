"use client";
import { Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trades, featuredTrades, tradeName } from "@/lib/trades/catalog";
import { DRAFT_STATUS_LABEL, GENERATE_LIMITS, type DraftSummaryRow } from "@/lib/library-generator/model";
import { Button } from "../../ui/button";
import { Badge, Card, Notice } from "../../ui/misc";
import { generate, listDrafts, patchDraft } from "./api";
import { StepBar } from "./step-bar";

const EXAMPLES = [
  "Concrete", "Residential concrete work", "4-inch concrete driveways", "Residential roofing and tear-offs",
  "Painting residential interiors", "Kitchen remodeling", "General contractor doing kitchens, baths, decks, and additions",
];
const PROGRESS = ["Reading your description", "Choosing categories for your trade", "Listing materials, labor and equipment", "Checking against your Saved Items", "Saving your draft"];

type Bid = { id: string; label: string };

/** Step 1: describe your trade or scope. Step 2 runs here (progress, cancel, retry), then opens the review. */
export function GeneratorStart({ bids = [], defaultTrades = [] }: { bids?: Bid[]; defaultTrades?: string[] }) {
  const [prompt, setPrompt] = useState("");
  const [picked, setPicked] = useState<string[]>(defaultTrades.slice(0, GENERATE_LIMITS.trades));
  const [bid, setBid] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<{ message: string; draftId?: string } | null>(null);
  const [drafts, setDrafts] = useState<DraftSummaryRow[] | null>(null);
  const [state, setState] = useState<{ ready: boolean; aiReady: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [showAll, setShowAll] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    listDrafts().then((r) => { if (!cancelled && r.ok) { setDrafts(r.data.drafts); setState({ ready: r.data.ready, aiReady: r.data.aiReady }); } });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, PROGRESS.length - 1)), 5000);
    return () => window.clearInterval(t);
  }, [busy]);

  const toggle = (slug: string) => setPicked((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : p.length >= GENERATE_LIMITS.trades ? p : [...p, slug]));
  const canGo = Boolean(prompt.trim() || picked.length || bid) && !busy;

  async function run(force = false) {
    setError(null); setBusy(true); setStep(0);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const r = await generate({ prompt: prompt.trim(), trades: picked, estimateId: bid || undefined, focus: "catalog", force }, ctrl.signal);
    abort.current = null;
    if (r.ok) { router.push(`/dashboard/items/generate/${r.data.draft.id}${r.data.reused ? "?reused=1" : ""}`); return; }
    setBusy(false);
    if (r.code !== "canceled") setError({ message: r.message, draftId: r.draftId });
  }
  async function cancel() {
    abort.current?.abort();
    setBusy(false);
    setError({ message: "Canceled. Nothing was added to your Saved Items." });
  }

  if (state && !state.ready) return <Card className="p-6 text-center text-muted">Price library generation is coming soon.</Card>;

  const tradeList = showAll ? trades : [...featuredTrades, ...trades.filter((t) => picked.includes(t.slug) && !t.featured)];
  return (
    <div className="space-y-6">
      <StepBar current={1} />
      <Card className="space-y-5 p-4 sm:p-6" data-guide="generate.describe">
        <div>
          <label htmlFor="gen-prompt" className="font-display text-lg font-bold text-navy">Describe your trade or scope</label>
          <p className="text-sm text-ink-soft">A word or two builds a reusable catalog for your trade. A detailed scope builds the items that job needs.</p>
          <textarea id="gen-prompt" className="field mt-2 min-h-28" maxLength={GENERATE_LIMITS.prompt} value={prompt} disabled={busy}
            placeholder="Concrete" onChange={(e) => setPrompt(e.target.value)} data-testid="gen-prompt" />
          <div className="mt-2 flex flex-wrap gap-2" aria-label="Examples">
            {EXAMPLES.map((x) => (
              <button key={x} type="button" disabled={busy} onClick={() => setPrompt(x)} className="min-h-9 rounded-full border border-line px-3 py-1 text-left text-xs text-ink-soft hover:border-brand/50 hover:text-ink">{x}</button>
            ))}
          </div>
        </div>
        <fieldset>
          <legend className="font-semibold">Trades <span className="font-normal text-muted">(optional, up to {GENERATE_LIMITS.trades})</span></legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {tradeList.map((t) => {
              const on = picked.includes(t.slug);
              return (
                <button key={t.slug} type="button" aria-pressed={on} disabled={busy} onClick={() => toggle(t.slug)} data-testid="gen-trade"
                  className={`min-h-9 rounded-full border px-3 py-1 text-sm ${on ? "border-brand bg-brand text-white" : "border-line hover:border-brand/50"}`}>
                  {t.name}
                </button>
              );
            })}
            <button type="button" className="min-h-9 px-2 text-sm font-semibold text-brand underline" onClick={() => setShowAll((s) => !s)}>{showAll ? "Fewer trades" : "All trades"}</button>
          </div>
        </fieldset>
        {bids.length > 0 && (
          <div>
            <label htmlFor="gen-bid" className="font-semibold">Start from one of your bids <span className="font-normal text-muted">(optional)</span></label>
            <p className="text-xs text-muted">Uses its sections, scope and item names. Never its prices or customer details.</p>
            <select id="gen-bid" className="field mt-1" value={bid} disabled={busy} onChange={(e) => setBid(e.target.value)}>
              <option value="">Don&apos;t use a bid</option>
              {bids.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
        )}
        <Notice tone="neutral" title="Your prices stay yours">
          The AI suggests item names, units and categories only. It never sets a price. Costs come from your Saved Items, your supplier price lists, or what you type, and anything without a cost shows “Cost not set”.
        </Notice>
        {error && (
          <Notice tone="warn">
            {error.message}{" "}
            {error.draftId && <a className="font-semibold underline" href={`/dashboard/items/generate/${error.draftId}`}>Open the draft</a>}
          </Notice>
        )}
        {busy ? (
          <div className="rounded-lg border border-line p-4" role="status" aria-live="polite" data-testid="gen-progress">
            <p className="flex items-center gap-2 font-semibold"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {PROGRESS[step]}…</p>
            <p className="mt-1 text-sm text-muted">This usually takes 15 to 40 seconds. You can leave this page; your draft is saved and waits for you here.</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full bg-brand transition-[width] duration-1000" style={{ width: `${((step + 1) / PROGRESS.length) * 100}%` }} /></div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={cancel}><X className="h-4 w-4" aria-hidden /> Cancel</Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="lg" disabled={!canGo || state?.aiReady === false} onClick={() => run()} data-testid="gen-submit"><Sparkles className="h-4 w-4" aria-hidden /> Generate draft catalog</Button>
            {error && canGo && <Button variant="secondary" size="lg" onClick={() => run(true)}>Try again</Button>}
            {state?.aiReady === false && <span className="self-center text-sm text-muted">Generating is coming soon.</span>}
          </div>
        )}
      </Card>

      {drafts && drafts.length > 0 && (
        <section aria-labelledby="drafts-h">
          <h2 id="drafts-h" className="mb-2 font-display text-xl font-bold text-navy">Your drafts</h2>
          <Card>
            <ul className="divide-y divide-line">
              {drafts.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <a href={`/dashboard/items/generate/${d.id}`} className="min-w-0 flex-1 font-semibold text-navy hover:underline">{d.title}</a>
                  <span className="text-xs text-muted">{d.trades.map(tradeName).join(", ")}</span>
                  <Badge tone={d.status === "approved" ? "ok" : d.status === "failed" ? "warn" : "neutral"}>{DRAFT_STATUS_LABEL[d.status]}</Badge>
                  <span className="text-xs text-muted">{d.candidateCount} to review · {d.approvedItems} approved</span>
                  <Button size="sm" variant="ghost" onClick={async () => { const r = await patchDraft(d.id, { status: "archived" }); if (r.ok) setDrafts((x) => x?.filter((y) => y.id !== d.id) ?? null); }}>Archive</Button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
