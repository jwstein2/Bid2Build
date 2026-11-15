"use client";
import { useMemo, useState } from "react";
import { SCENARIOS, defaultAssumptions, forecast, type Assumptions, type Observed } from "@/lib/admin/forecast";

const FIELDS: { key: keyof Assumptions; label: string; step: number; kind: "observed" | "assumption"; hint?: string }[] = [
  { key: "freePerPaying", label: "Free accounts per paying business", step: 0.5, kind: "assumption" },
  { key: "estimatesPerBusinessMonth", label: "Estimates per business per month", step: 1, kind: "assumption" },
  { key: "pdfsPerEstimate", label: "PDF exports per estimate", step: 0.1, kind: "assumption" },
  { key: "avgPdfKb", label: "Average PDF size (KB)", step: 10, kind: "assumption" },
  { key: "signedPerBusinessMonth", label: "Signed proposals per business per month", step: 0.5, kind: "assumption" },
  { key: "dbKbPerEstimate", label: "Database KB per estimate", step: 5, kind: "observed", hint: "Derived from today's database when there are enough estimates" },
  { key: "aiGenerationsPerBusinessMonth", label: "AI text requests per business per month", step: 1, kind: "assumption" },
  { key: "aiCostPerGenerationUsd", label: "AI cost per request (USD)", step: 0.001, kind: "observed", hint: "Average from the app's AI usage log" },
  { key: "emailsPerBusinessMonth", label: "Emails per business per month", step: 1, kind: "assumption" },
  { key: "requestsPerBusinessMonth", label: "Server requests per business per month", step: 100, kind: "assumption" },
  { key: "retentionMonths", label: "Months of files and data kept", step: 1, kind: "assumption" },
  { key: "arpaUsd", label: "Revenue per paying business (USD/month)", step: 1, kind: "observed", hint: "Current list-price MRR ÷ paying customers, or $19.99" },
  { key: "hostingBaseUsd", label: "Hosting plan (USD/month)", step: 1, kind: "observed", hint: "From Tech Stack & Costs when entered" },
  { key: "hostingPerMillionRequestsUsd", label: "Hosting cost per 1M extra requests (USD)", step: 0.5, kind: "assumption", hint: "Hypothetical: depends on the Netlify plan" },
];

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 });

export function ForecastTool({ observed }: { observed: Observed }) {
  const [a, setA] = useState<Assumptions>(() => defaultAssumptions(observed));
  const [custom, setCustom] = useState(5_000);
  const counts = useMemo(() => [...SCENARIOS, custom], [custom]);
  const results = useMemo(() => counts.map((n) => forecast(n, a, observed)), [counts, a, observed]);
  const set = (k: keyof Assumptions, v: string) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) setA((p) => ({ ...p, [k]: n })); };

  return (
    <div className="space-y-6">
      <section className="cc-panel min-w-0 p-5">
        <h2 className="text-base font-bold text-white">Scenarios</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 760 }}>
            <thead className="cc-kicker text-left">
              <tr><th className="pb-2 pr-3 font-normal">Paying businesses</th>{results.map((r, i) => <th key={i} className="pb-2 pr-3 text-right font-normal">{i === results.length - 1 ? <label className="inline-flex items-center gap-1">Custom <input aria-label="Custom paying businesses" type="number" min={1} max={1_000_000} value={custom} onChange={(e) => setCustom(Math.max(1, Math.min(1_000_000, Number(e.target.value) || 1)))} className="field field-sm w-24 text-right" /></label> : r.paying.toLocaleString("en-US")}</th>)}</tr>
            </thead>
            <tbody className="cc-mono [&_td]:border-t [&_td]:border-[var(--cc-line)] [&_td]:py-2 [&_td]:pr-3">
              {results[0].lines.map((l, li) => (
                <tr key={l.key}><td className="font-sans text-ink-soft">{l.label}</td>{results.map((r, i) => <td key={i} className="text-right" title={r.lines[li].note}>{usd(r.lines[li].usd)}</td>)}</tr>
              ))}
              <tr><td className="font-sans font-semibold text-white">Estimated platform cost / month</td>{results.map((r, i) => <td key={i} className="text-right font-semibold text-white">{usd(r.totalUsd)}</td>)}</tr>
              <tr><td className="font-sans text-ink-soft">Cost per paying business</td>{results.map((r, i) => <td key={i} className="text-right">{usd(r.perCustomerUsd)}</td>)}</tr>
              <tr><td className="font-sans text-ink-soft">Subscription revenue / month</td>{results.map((r, i) => <td key={i} className="text-right">{usd(r.revenueUsd)}</td>)}</tr>
              <tr><td className="font-sans text-ink-soft">Gross contribution margin</td>{results.map((r, i) => <td key={i} className="text-right text-[var(--cc-green)]">{r.marginPct == null ? "–" : `${r.marginPct}%`}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {results.map((r, i) => r.limits.length > 0 && (
            <div key={i} className="rounded-lg border border-[var(--cc-amber)]/40 px-3 py-2">
              <p className="cc-kicker !text-[10px] text-[var(--cc-amber)]">At {r.paying.toLocaleString("en-US")} paying · plan limits</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-ink-soft">{r.limits.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Hover a cost for its volume. Costs follow each provider&apos;s tiers rather than a straight line. Excludes advertising, salaries, taxes and fixed tools that do not grow with customers (see Tech Stack &amp; Costs). This is a planning estimate, not a quote, and it never changes pricing.</p>
      </section>

      <section className="cc-panel min-w-0 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-white">Inputs</h2>
          <button type="button" onClick={() => setA(defaultAssumptions(observed))} className="cc-mono rounded-md border border-[var(--cc-line)] px-2.5 py-1 text-xs text-ink-soft hover:text-white">Reset to defaults</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="text-xs">
              <span className="mb-1 flex items-center gap-2"><span className="cc-kicker">{f.label}</span><span className={`cc-mono rounded px-1 text-[9px] ${f.kind === "observed" ? "bg-[rgb(56_182_255/0.12)] text-[var(--cc-blue)]" : "bg-[rgb(255_181_71/0.1)] text-[var(--cc-amber)]"}`}>{f.kind === "observed" ? "OBSERVED" : "ASSUMPTION"}</span></span>
              <input type="number" min={0} step={f.step} value={a[f.key]} onChange={(e) => set(f.key, e.target.value)} className="field field-sm" />
              {f.hint && <span className="mt-0.5 block text-[11px] text-muted">{f.hint}</span>}
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
