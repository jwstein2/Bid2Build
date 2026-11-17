"use client";
import { useMemo, useState } from "react";
import { Calculator, ChevronDown, Lock } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { PAY_METHODS, salesPay, sanitizePay, type PayMethod, type PaySettings } from "@/lib/pipeline/sales-pay";
import type { Analytics } from "@/lib/pipeline/board";
import { money } from "./format";

const LS = "b2b-sales-pay";

/** Personal planning calculator. Changes nothing on any bid; settings are private to the signed-in user. */
export function SalesPayCalculator({ wonBids, initial, saved }: { wonBids: Analytics["wonBids"]; initial: PaySettings; saved: boolean }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<PaySettings>(() => {
    if (saved) return initial;
    try { const raw = localStorage.getItem(LS); if (raw) return sanitizePay(JSON.parse(raw)); } catch { /* ignore */ }
    return initial;
  });
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = all won bids in the period
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = wonBids.filter((b) => !picked || picked.has(b.id));
  const result = useMemo(() => salesPay(s, selected), [s, selected]);
  const set = (patch: Partial<PaySettings>) => { setS((x) => sanitizePay({ ...x, ...patch })); setMsg(null); };
  const percent = s.method !== "flat";

  async function save() {
    setBusy(true);
    try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* ignore */ }
    const r = await fetch("/api/pipeline/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(false);
    setMsg(r?.ok ? { ok: true, text: "Saved to your account. Only you can see these settings." } : { ok: false, text: d?.error?.message ?? "Couldn't save to your account. Saved on this device." });
  }

  return (
    <Card data-testid="sales-pay" data-feature="sales_pay" data-guide="bids.sales-pay">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <span>
          <span className="flex items-center gap-2 font-bold text-navy"><Calculator className="h-4 w-4" aria-hidden />Sales pay calculator <span className="text-xs font-semibold text-muted">(optional)</span></span>
          <span className="block text-sm text-muted">Estimate your own commission on won bids. Doesn&apos;t change any bid or customer price.</span>
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="space-y-4 border-t border-line p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="sp-method" className="label">How you&apos;re paid</label>
              <select id="sp-method" className="field" value={s.method} onChange={(e) => set({ method: e.target.value as PayMethod })}>
                {Object.entries(PAY_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            {percent ? (
              <div>
                <label htmlFor="sp-rate" className="label">Rate (%)</label>
                <input id="sp-rate" type="number" inputMode="decimal" min={0} max={100} step="0.1" className="field" value={s.rate} onChange={(e) => set({ rate: Number(e.target.value) })} />
              </div>
            ) : (
              <div>
                <label htmlFor="sp-flat" className="label">Fee per project ($)</label>
                <input id="sp-flat" type="number" inputMode="decimal" min={0} step="1" className="field" value={s.flatFee} onChange={(e) => set({ flatFee: Number(e.target.value) })} />
              </div>
            )}
            <div>
              <label htmlFor="sp-base" className="label">Base pay for period ($) <span className="font-normal text-muted">(optional)</span></label>
              <input id="sp-base" type="number" inputMode="decimal" min={0} step="1" className="field" value={s.baseSalary} onChange={(e) => set({ baseSalary: Number(e.target.value) })} />
            </div>
            {s.method === "percent_base" && (
              <div className="sm:col-span-2">
                <label htmlFor="sp-excl" className="label">Excluded from base (% of sale)</label>
                <input id="sp-excl" type="number" inputMode="decimal" min={0} max={100} step="0.5" className="field" value={s.baseExclusions} onChange={(e) => set({ baseExclusions: Number(e.target.value) })} />
                <p className="mt-1 text-xs text-muted">For example permits or pass-through materials your plan doesn&apos;t pay on.</p>
              </div>
            )}
          </div>
          <p className="text-xs text-muted">Sale = proposal price before sales tax. Gross profit = sale − estimated direct cost from the bid version. A loss earns $0.</p>

          {wonBids.length === 0 ? (
            <p className="rounded-lg bg-paper p-3 text-sm text-muted">No won bids in this period yet. Pick a longer date range to include more.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-2"><input type="checkbox" aria-label="Include all won bids" checked={!picked || picked.size === wonBids.length} onChange={(e) => setPicked(e.target.checked ? null : new Set())} /></th>
                  <th className="py-2 pr-2 font-semibold">Won bid</th><th className="py-2 pr-2 text-right font-semibold">Basis</th><th className="py-2 text-right font-semibold">Est. earnings</th>
                </tr></thead>
                <tbody>
                  {wonBids.map((b) => {
                    const line = salesPay(s, [b]).lines[0];
                    const on = !picked || picked.has(b.id);
                    return (
                      <tr key={b.id} className="border-b border-line/60">
                        <td className="py-2 pr-2"><input type="checkbox" aria-label={`Include ${b.title}`} checked={on} onChange={() => setPicked((p) => { const n = new Set(p ?? wonBids.map((x) => x.id)); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })} /></td>
                        <td className="py-2 pr-2"><span className="font-semibold">{b.title}</span><span className="block text-xs text-muted">{b.customer} · won {new Date(b.wonAt).toLocaleDateString()}</span></td>
                        <td className="tabular py-2 pr-2 text-right">{line.basis === null ? (line.note ? <span className="text-xs text-muted">{line.note}</span> : "—") : money(line.basis, true)}</td>
                        <td className="tabular py-2 text-right font-semibold">{line.earnings === null ? "—" : money(line.earnings, true)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-brand-tint p-3">
            <div>
              <p className="text-xs font-semibold text-muted">Estimated earnings ({selected.length} bid{selected.length === 1 ? "" : "s"}{s.baseSalary ? " + base pay" : ""})</p>
              <p className="tabular text-2xl font-extrabold text-navy" data-testid="sales-pay-total">{money(result.total, true)}</p>
              {result.skipped > 0 && <p className="text-xs text-warn">{result.skipped} bid{result.skipped === 1 ? "" : "s"} left out: no price or cost available.</p>}
            </div>
            <Button size="sm" variant="secondary" onClick={save} disabled={busy}><Lock className="h-3.5 w-3.5" aria-hidden />Save my settings</Button>
          </div>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ok" : "text-warn"}`}>{msg.text}</p>}
          <p className="text-xs text-muted">A planning estimate only. It isn&apos;t payroll or a guarantee of pay; your employer&apos;s plan decides actual earnings.</p>
        </div>
      )}
    </Card>
  );
}
