"use client";
/**
 * V6.9 "View Tax Details" for a saved bid. Asks the server for a calculation (licensed tax service when one is
 * approved, otherwise the rate you typed, clearly labeled). It never changes the bid by itself: "Use this rate"
 * fills the field only when you press it, and signed proposals keep their own snapshot.
 */
import { useState } from "react";
import { Receipt } from "lucide-react";
import { formatCurrency } from "@/lib/estimate/money";
import { Button } from "../ui/button";

type Res = {
  result: { status: string; source: string; provider: string | null; taxAmount: string; taxableAmount: string; nontaxableAmount: string; combinedRate: string | null; transactionDate: string;
    jurisdictions: { name: string; level: string; rate: string; tax: string }[]; reviewReasons: string[]; dataAsOf: string | null; address: { city?: string | null; state?: string | null; zip?: string | null };
    exemptions: { state: string; reason: string; applied: boolean }[] };
  providerConfigured: boolean; bidRate: string; bidTax: string; difference: { difference: string; message: string } | null; latestVersion: { number: number; tax: string } | null;
  reasonText: Record<string, string>; savedId: string | null;
};
const SOURCE: Record<string, string> = { provider: "Licensed tax service", mock: "Practice tax data", company_rate: "The rate you entered (not verified)", contract: "Contract rate" };

export function TaxDetails({ estimateId, onUseRate }: { estimateId: string | null; onUseRate: (rate: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [r, setR] = useState<Res | null>(null);
  const load = async (save = false) => {
    if (!estimateId) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/tax/calculate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ estimateId, save }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) setErr(b?.error?.message ?? "Tax details aren't available right now. Your bid is unchanged.");
      else setR(b as Res);
    } catch { setErr("You're offline. Your bid is unchanged."); }
    setBusy(false);
  };
  if (!estimateId) return <p className="mt-1 text-xs text-muted">Save the bid to see tax details for its address.</p>;
  return (
    <div className="mt-2">
      <Button type="button" size="sm" variant="link" onClick={() => { setOpen(!open); if (!open && !r) void load(); }} aria-expanded={open} data-testid="tax-details-open">
        <Receipt className="h-3.5 w-3.5" aria-hidden /> View tax details
      </Button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl border border-line bg-surface p-3 text-sm" role="region" aria-label="Tax details" data-testid="tax-details">
          {busy && <p className="text-muted" role="status">Calculating…</p>}
          {err && <p className="text-danger" role="alert">{err}</p>}
          {r && !busy && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">{r.result.combinedRate ? `${r.result.combinedRate}%` : "No rate"} · {formatCurrency(r.result.taxAmount)}</p>
                <span className="text-xs text-muted">{SOURCE[r.result.source] ?? r.result.source}{r.result.dataAsOf ? ` · data as of ${r.result.dataAsOf}` : ""}</span>
              </div>
              <p className="text-xs text-muted">{[r.result.address.city, r.result.address.state, r.result.address.zip].filter(Boolean).join(", ") || "No project address"} · for {r.result.transactionDate}</p>
              {r.result.jurisdictions.length > 0 && (
                <table className="w-full text-xs"><thead><tr className="text-left text-muted"><th className="py-0.5">Jurisdiction</th><th className="text-right">Rate</th><th className="text-right">Tax</th></tr></thead>
                  <tbody>{r.result.jurisdictions.map((j, i) => <tr key={i} className="border-t border-line"><td className="py-1">{j.name} <span className="text-muted">({j.level})</span></td><td className="text-right tabular-nums">{j.rate}%</td><td className="text-right tabular-nums">{formatCurrency(j.tax)}</td></tr>)}</tbody></table>
              )}
              <p className="text-xs text-ink-soft">Taxable {formatCurrency(r.result.taxableAmount)} · Not taxed {formatCurrency(r.result.nontaxableAmount)}</p>
              {r.result.exemptions.map((x, i) => <p key={i} className="text-xs">{x.applied ? "Exemption applied" : "Exemption not applied"} ({x.state}, {x.reason})</p>)}
              {r.result.reviewReasons.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-warn-tint p-2 text-xs">{r.result.reviewReasons.map((k) => <li key={k}>• {r.reasonText[k] ?? k}</li>)}</ul>
              )}
              {r.difference && <p className="text-xs">Your bid uses {r.bidRate}% ({formatCurrency(r.bidTax)}). Difference: {formatCurrency(r.difference.difference)}.</p>}
              {r.latestVersion && <p className="text-xs text-muted">Sent proposal v{r.latestVersion.number} keeps its own tax ({formatCurrency(r.latestVersion.tax)}); nothing here changes it.</p>}
              {!r.providerConfigured && <p className="text-xs text-muted">Live tax rates are coming soon. Until then this uses the rate you entered.</p>}
              <div className="flex flex-wrap gap-2">
                {r.result.combinedRate && r.result.source !== "company_rate" && r.result.combinedRate !== r.bidRate && <Button type="button" size="sm" variant="secondary" onClick={() => onUseRate(r.result.combinedRate!)}>Use {r.result.combinedRate}%</Button>}
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void load(true)}>{r.savedId ? "Saved" : "Save this calculation"}</Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>Recalculate</Button>
              </div>
              <p className="text-[11px] text-muted">An estimate to help you price. Not tax advice and not a guarantee of compliance.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
