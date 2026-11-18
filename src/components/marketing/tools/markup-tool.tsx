"use client";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics/track";
import { cleanPercent, priceFrom, type MarkupTool } from "@/lib/marketing/tools";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const pct = (n: number) => `${Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "∞"}%`;

/**
 * Markup ↔ margin calculator. The cost never leaves the page: only the chosen mode and percentage
 * go to the new bid (in the URL), and analytics get the tool name only.
 */
export function MarkupToolForm({ tool, trades, from }: { tool: MarkupTool; trades: { slug: string; name: string }[]; from?: string }) {
  const router = useRouter();
  const [cost, setCost] = useState("10000");
  const [mode, setMode] = useState<"markup" | "margin">("markup");
  const [percent, setPercent] = useState("25");
  const [trade, setTrade] = useState("general-contracting");
  const [going, setGoing] = useState(false);
  const costNum = Number(cost.replace(/[$,\s]/g, ""));
  const pctClean = cleanPercent(percent.trim(), mode);
  const costOk = cost.trim() !== "" && Number.isFinite(costNum) && costNum >= 0 && costNum <= 1e9;
  const r = costOk && pctClean !== null ? priceFrom(costNum, mode, Number(pctClean)) : null;
  const pctError = percent.trim() === "" ? "Enter a percentage." : pctClean === null ? (mode === "margin" ? "Margin must be from 0 to 95%." : "Markup must be from 0 to 1,000%.") : null;

  const used = useRef(false);
  const edited = useRef(false);
  useEffect(() => {
    if (used.current || !edited.current || !r) return;
    used.current = true;
    track("calculator_used", { tool: tool.slug, from });
  }, [r, tool.slug, from]);
  const edit = <T,>(set: (v: T) => void) => (v: T) => { edited.current = true; set(v); };

  const start = () => {
    if (!pctClean) return;
    track("calculator_bid_started", { tool: tool.slug, trade, from });
    setGoing(true);
    const qs = new URLSearchParams({ tool: tool.slug, pricing: mode, pct: pctClean, from: "tool-markup-margin" });
    router.push(`/start/${trade}?${qs.toString()}`);
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6" data-testid="tool-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="mm-cost" className="mb-1 block text-sm font-semibold text-ink-soft">Job cost</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
            <input id="mm-cost" className="field tabular pl-7" inputMode="decimal" autoComplete="off" value={cost} aria-invalid={!costOk || undefined} onChange={(e) => edit(setCost)(e.target.value.slice(0, 16))} />
          </div>
          {!costOk && <p className="mt-1 text-xs text-danger">Enter the job cost as a number.</p>}
        </div>
        <fieldset>
          <legend className="mb-1 block text-sm font-semibold text-ink-soft">I price with</legend>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-line-strong p-1">
            {(["markup", "margin"] as const).map((m) => (
              <label key={m} className={cn("flex min-h-10 cursor-pointer items-center justify-center rounded-md text-sm font-semibold", mode === m ? "bg-navy text-white" : "text-ink-soft hover:bg-black/5")}>
                <input type="radio" name="mm-mode" value={m} checked={mode === m} onChange={() => edit(setMode)(m)} className="sr-only" />
                {m === "markup" ? "Markup" : "Target margin"}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="mm-pct" className="mb-1 block text-sm font-semibold text-ink-soft">{mode === "markup" ? "Markup" : "Target margin"}</label>
          <div className="relative">
            <input id="mm-pct" className="field tabular pr-8" inputMode="decimal" autoComplete="off" value={percent} aria-invalid={Boolean(pctError) || undefined} aria-describedby={pctError ? "mm-pct-err" : undefined} onChange={(e) => edit(setPercent)(e.target.value.slice(0, 7))} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>
          </div>
          {pctError && <p id="mm-pct-err" className="mt-1 text-xs text-danger">{pctError}</p>}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4" aria-live="polite" data-testid="markup-result">
        {[
          ["Price", r ? money(r.price) : "—"],
          ["Profit", r ? money(r.profit) : "—"],
          ["Markup", r ? pct(r.markup) : "—"],
          ["Margin", r ? pct(r.margin) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-brand-tint/50 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
            <p className="font-display text-xl font-extrabold tabular text-navy">{value}</p>
          </div>
        ))}
      </div>
      {r && <p className="mt-2 text-sm text-ink-soft">{mode === "markup" ? `${pct(r.markup)} markup is a ${pct(r.margin)} margin.` : `A ${pct(r.margin)} margin needs ${pct(r.markup)} markup.`}</p>}

      <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end">
        <div className="sm:w-56">
          <label htmlFor="mm-trade" className="mb-1 block text-sm font-semibold text-ink-soft">Trade</label>
          <select id="mm-trade" className="field" value={trade} onChange={(e) => setTrade(e.target.value)}>
            {trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </div>
        <Button variant="accent" size="lg" onClick={start} disabled={!pctClean || going} data-cta="tool_bid" data-testid="tool-send" className="w-full sm:w-auto">
          {going ? "Opening your bid…" : <>Start a bid with this pricing <ArrowRight className="h-4 w-4" aria-hidden /></>}
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted">The new estimate uses {mode === "markup" ? "this markup" : "this target margin"}. Your cost stays on this page. No account needed.</p>
    </div>
  );
}
