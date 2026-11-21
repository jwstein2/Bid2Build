"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { tbAction } from "@/components/tax-banking/client";

type Terms = { payBasis: string; payDays: number; payDate: string | null; sectionKey: string | null; retainagePct: number; depositAmount: number | null; depositOn: string | null };
type Payload = {
  commitments: { id: string; number: string; title: string; vendorName: string | null; open: number; terms: Terms | null }[];
  costCodes: { id: string; code: string | null; name: string; estimated: number; committed: number; actual: number; override: { amount: number | null; reason: string; at: string } | null }[];
};
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

function useSave(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const post = async (payload: Record<string, unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    const r = await tbAction(payload, "/api/financials/cash-v9");
    setBusy(false);
    if (!r.ok) { setMsg({ tone: "danger", text: r.message }); return false; }
    setMsg({ tone: "ok", text: ok }); onDone(); return true;
  };
  const note = msg ? <p role="status" className={`text-sm ${msg.tone === "ok" ? "text-ok" : "text-danger"}`}>{msg.text}</p> : null;
  return { busy, post, note, setMsg };
}

/**
 * V9 cash timing for one job: when each subcontract / purchase order gets paid (for the forecast only) and, for people who
 * manage financial settings, a forecast-at-completion override per cost code with a reason. Nothing here pays anyone.
 */
export function CostTimingCard({ jobId, canTerms, canOverride }: { jobId: string; canTerms: boolean; canOverride: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/financials/cash-v9?jobId=${jobId}&view=costs`, { cache: "no-store" }).catch(() => null);
    setData(res?.ok ? await res.json().catch(() => null) : null);
  }, [jobId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- load once on mount
  useEffect(() => { void load(); }, [load]);
  if (!data || (!data.commitments.length && !data.costCodes.length)) return null;
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4" aria-labelledby="v9-ct-h" data-testid="v9-cost-timing">
      <h2 id="v9-ct-h" className="font-display text-lg font-extrabold">Cash forecast timing</h2>
      <p className="text-xs text-muted">Used only by the cash forecast. Changing these never pays, approves or changes a bill.</p>
      {data.commitments.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">When subcontracts and purchase orders get paid</h3>
          <ul className="space-y-2">{data.commitments.map((c) => <CommitmentRow key={c.id} c={c} canEdit={canTerms} onDone={load} />)}</ul>
        </div>)}
      {canOverride && data.costCodes.length > 0 && (
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer font-semibold">Override a cost code&apos;s forecast at completion</summary>
          <p className="mt-1 text-xs text-muted">Use when you know a cost will end up different from the estimate. A reason is required and every change is kept in the history.</p>
          <ul className="mt-2 space-y-2">{data.costCodes.map((cc) => <OverrideRow key={cc.id} jobId={jobId} cc={cc} onDone={load} />)}</ul>
        </details>)}
    </section>
  );
}

function CommitmentRow({ c, canEdit, onDone }: { c: Payload["commitments"][number]; canEdit: boolean; onDone: () => void }) {
  const t = c.terms;
  const [editing, setEditing] = useState(false);
  const [basis, setBasis] = useState(t?.payBasis ?? "completion");
  const [days, setDays] = useState(String(t?.payDays ?? 7));
  const [date, setDate] = useState(t?.payDate ?? "");
  const [ret, setRet] = useState(t?.retainagePct ? String(t.retainagePct) : "");
  const [dep, setDep] = useState(t?.depositAmount !== null && t?.depositAmount !== undefined ? String(t.depositAmount) : "");
  const [depOn, setDepOn] = useState(t?.depositOn ?? "");
  const { busy, post, note, setMsg } = useSave(onDone);
  const summary = t ? `${t.payBasis === "date" && t.payDate ? `Paid on ${t.payDate}` : `Paid ${t.payDays} days after the work ${t.payBasis === "start" ? "starts" : "is done"}`}${t.retainagePct ? `, ${t.retainagePct}% held back until the job finishes` : ""}${t.depositAmount ? `, ${usd(t.depositAmount)} deposit${t.depositOn ? ` on ${t.depositOn}` : ""}` : ""}.`
    : "Using your default payment days (Forecast settings).";
  const save = async () => {
    if (dep && !MONEY.test(dep)) { setMsg({ tone: "danger", text: "Check the deposit amount." }); return; }
    if (basis === "date" && !date) { setMsg({ tone: "danger", text: "Pick the payment date." }); return; }
    const ok = await post({ action: "commitment_terms_save", commitmentId: c.id, p: { payBasis: basis, payDays: Math.min(180, Number(days) || 0), payDate: basis === "date" ? date : undefined,
      retainagePct: ret ? Math.min(50, Number(ret)) : 0, depositAmount: dep || undefined, depositOn: dep && depOn ? depOn : undefined } }, "Saved. The forecast uses these terms now.");
    if (ok) setEditing(false);
  };
  return (
    <li className="rounded-lg border border-line p-3 text-sm" data-testid="v9-ct-commitment">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1"><span className="font-semibold">{c.number} · {c.title}</span>{c.vendorName && <span className="text-muted"> · {c.vendorName}</span>}
          <span className="block text-xs text-muted">{summary}</span></span>
        <span className="tabular-nums">{usd(c.open)} open</span>
        {canEdit && <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(!editing)}>Payment terms</Button>}
      </div>
      {editing && (
        <form className="mt-2 grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="label" htmlFor={`ct-b-${c.id}`}>Paid<select id={`ct-b-${c.id}`} className="field mt-1" value={basis} onChange={(e) => setBasis(e.target.value)}>
            <option value="completion">After their work is done</option><option value="start">After their work starts</option><option value="date">On a set date</option></select></label>
          {basis === "date"
            ? <label className="label" htmlFor={`ct-d-${c.id}`}>Date<input id={`ct-d-${c.id}`} type="date" className="field mt-1" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            : <label className="label" htmlFor={`ct-n-${c.id}`}>Days later<input id={`ct-n-${c.id}`} inputMode="numeric" className="field mt-1" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))} /></label>}
          <label className="label" htmlFor={`ct-r-${c.id}`}>Retainage held (%)<input id={`ct-r-${c.id}`} inputMode="decimal" className="field mt-1" value={ret} placeholder="0" onChange={(e) => setRet(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
          <label className="label" htmlFor={`ct-p-${c.id}`}>Deposit ($)<input id={`ct-p-${c.id}`} inputMode="decimal" className="field mt-1" value={dep} placeholder="None" onChange={(e) => setDep(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
          {dep && <label className="label" htmlFor={`ct-po-${c.id}`}>Deposit paid on<input id={`ct-po-${c.id}`} type="date" className="field mt-1" value={depOn} onChange={(e) => setDepOn(e.target.value)} /></label>}
          <div className="flex items-end"><Button type="submit" size="sm" disabled={busy}>Save terms</Button></div>
        </form>)}
      {note}
    </li>
  );
}

function OverrideRow({ jobId, cc, onDone }: { jobId: string; cc: Payload["costCodes"][number]; onDone: () => void }) {
  const [amount, setAmount] = useState(cc.override?.amount !== null && cc.override?.amount !== undefined ? String(cc.override.amount) : "");
  const [reason, setReason] = useState("");
  const { busy, post, note, setMsg } = useSave(onDone);
  const save = async (clear: boolean) => {
    if (!clear && !MONEY.test(amount)) { setMsg({ tone: "danger", text: "Check the amount." }); return; }
    if (reason.trim().length < 3) { setMsg({ tone: "danger", text: "Add a short reason." }); return; }
    if (await post({ action: "override_save", jobId, p: { costCodeId: cc.id, amount: clear ? null : amount, reason: reason.trim() } }, clear ? "Override removed." : "Saved.")) { setReason(""); if (clear) setAmount(""); }
  };
  return (
    <li className="grid gap-2 border-t border-line pt-2 text-sm sm:grid-cols-[1fr_auto_auto_auto] sm:items-end" data-testid="v9-ct-override">
      <span><span className="font-semibold">{cc.code ? `${cc.code} ` : ""}{cc.name}</span>
        <span className="block text-xs text-muted">Estimate {usd(cc.estimated)} · committed {usd(cc.committed)} · actual {usd(cc.actual)}{cc.override ? ` · override ${cc.override.amount === null ? "cleared" : usd(cc.override.amount)} (${cc.override.reason})` : ""}</span></span>
      <label className="label" htmlFor={`ov-a-${cc.id}`}>Forecast at completion ($)<input id={`ov-a-${cc.id}`} inputMode="decimal" className="field mt-1 w-36" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
      <label className="label" htmlFor={`ov-r-${cc.id}`}>Reason<input id={`ov-r-${cc.id}`} className="field mt-1" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <div className="flex gap-2"><Button type="button" size="sm" disabled={busy} onClick={() => void save(false)}>Save</Button>
        {cc.override && cc.override.amount !== null && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void save(true)}>Clear</Button>}</div>
      <div className="sm:col-span-4">{note}</div>
    </li>
  );
}
