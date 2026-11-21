"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ALERT_LABELS, type AlertKind } from "@/lib/cash-v9/alerts";
import { COLLECTION_PRESETS, EXPENSE_MODES, type CashSettings, type CollectionBasis, type ExpenseMode } from "@/lib/cash-v9/settings";
import { Msg, useV9 } from "./actions";

/** Cost types a company can set a percent-of-contract benchmark for (public.fin_cost_types()). */
const BENCH_TYPES: { key: string; label: string }[] = [
  { key: "material", label: "Materials" }, { key: "labor", label: "Labor" }, { key: "subcontractor", label: "Subcontractors" },
  { key: "equipment", label: "Equipment" }, { key: "permit", label: "Permits" }, { key: "delivery", label: "Delivery" },
  { key: "overhead", label: "Job overhead" }, { key: "other", label: "Other" },
];

const intOr = (v: string, d: number) => (v.trim() === "" || !Number.isFinite(Number(v)) ? d : Math.round(Number(v)));
const numOr = (v: string, d: number) => (v.trim() === "" || !Number.isFinite(Number(v)) ? d : Number(v));
const digits = (v: string) => v.replace(/[^0-9]/g, "");
const decimal = (v: string) => v.replace(/[^0-9.]/g, "");
const signed = (v: string) => v.replace(/[^0-9.-]/g, "");

function Num({ id, label, value, onChange, hint, suffix, disabled, mode = "numeric" }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; suffix?: string; disabled?: boolean; mode?: "numeric" | "decimal" }) {
  return (
    <label className="label" htmlFor={id}>{label}
      <span className="mt-1 flex items-center gap-2"><input id={id} inputMode={mode} className="field" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />{suffix && <span className="text-sm text-muted">{suffix}</span>}</span>
      {hint && <span className="mt-1 block text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

/** Forecast assumptions. Every value is the company's own assumption, saved once for everyone who sees the forecast. */
export function CashSettingsForm({ s, canEdit, people = [] }: { s: CashSettings; canEdit: boolean; people?: { id: string; label: string }[] }) {
  const { busy, msg, run } = useV9();
  const [minCash, setMinCash] = useState(s.minCash === null ? "" : String(s.minCash));
  const [gross, setGross] = useState(s.targetGrossMargin === null ? "" : String(s.targetGrossMargin));
  const [net, setNet] = useState(s.targetNetMargin === null ? "" : String(s.targetNetMargin));
  const [days, setDays] = useState(String(s.collectionDays));
  const [basis, setBasis] = useState<CollectionBasis>(s.collectionBasis);
  const [useHistory, setUseHistory] = useState(s.useHistory);
  const [minSample, setMinSample] = useState(String(s.historyMinSample));
  const [mode, setMode] = useState<ExpenseMode>(s.expenseMode);
  const [bench, setBench] = useState<Record<string, string>>(Object.fromEntries(Object.entries(s.benchmark).map(([k, v]) => [k, String(v)])));
  const [payroll, setPayroll] = useState(s.payrollFromSchedule);
  const [payLag, setPayLag] = useState(String(s.payrollPayLagDays));
  const [burden, setBurden] = useState(String(s.payrollBurdenPct));
  const [subDays, setSubDays] = useState(String(s.subPayDays));
  const [supDays, setSupDays] = useState(String(s.supplierPayDays));
  const [consLate, setConsLate] = useState(String(s.conservativeLateDays));
  const [consCost, setConsCost] = useState(String(s.conservativeCostPct));
  const [grace, setGrace] = useState(String(s.arGraceDays));
  const [concDays, setConcDays] = useState(String(s.concentrationDays));
  const [concPct, setConcPct] = useState(String(s.concentrationPct));
  const [kindsOff, setKindsOff] = useState<string[]>(s.alertKindsOff);
  const [email, setEmail] = useState(s.alertEmail);
  const [recips, setRecips] = useState<string[]>(s.alertRecipients);
  const [err, setErr] = useState<string | null>(null);
  const preset = (COLLECTION_PRESETS as readonly number[]).includes(Number(days));
  const off = !canEdit || busy;

  const save = async () => {
    setErr(null);
    const benchmark: Record<string, number> = {};
    for (const [k, v] of Object.entries(bench)) if (v.trim() !== "") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) { setErr("Benchmarks are percents from 0 to 100."); return; }
      benchmark[k] = n;
    }
    if (minCash.trim() !== "" && !/^\d{1,12}(\.\d{1,2})?$/.test(minCash.trim())) { setErr("Minimum cash must be a dollar amount, like 25000."); return; }
    for (const m of [gross, net]) if (m.trim() !== "" && !/^-?\d{1,3}(\.\d{1,2})?$/.test(m.trim())) { setErr("Margins are percents, like 25."); return; }
    await run({ action: "settings_save", p: {
      minCash: minCash.trim(), targetGrossMargin: gross.trim(), targetNetMargin: net.trim(),
      collectionDays: Math.min(365, intOr(days, 7)), collectionBasis: basis, useHistory, historyMinSample: Math.max(1, Math.min(50, intOr(minSample, 3))),
      expenseMode: mode, benchmark, payrollFromSchedule: payroll, payrollPayLagDays: Math.min(31, intOr(payLag, 5)), payrollBurdenPct: Math.min(100, numOr(burden, 0)),
      subPayDays: Math.min(180, intOr(subDays, 7)), supplierPayDays: Math.min(180, intOr(supDays, 30)), conservativeLateDays: Math.min(180, intOr(consLate, 14)),
      conservativeCostPct: Math.min(100, numOr(consCost, 10)), arGraceDays: Math.min(120, intOr(grace, 7)), concentrationDays: Math.max(1, Math.min(31, intOr(concDays, 7))),
      concentrationPct: Math.max(1, Math.min(1000, numOr(concPct, 50))), alertEmail: email && recips.length > 0, alertRecipients: recips, alertKindsOff: kindsOff,
    } }, "Forecast settings saved. The forecast now uses them.");
  };

  return (
    <form className="space-y-6" data-testid="v9-settings-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <fieldset className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-3" disabled={off}>
        <legend className="px-1 text-lg font-bold">Cash and margin targets</legend>
        <Num id="cs-min" label="Minimum cash to keep" value={minCash} onChange={(v) => setMinCash(decimal(v))} suffix="$" mode="decimal" hint="You get a low-cash warning before the forecast drops below this. Leave blank for none." />
        <Num id="cs-gross" label="Target gross margin" value={gross} onChange={(v) => setGross(decimal(v))} suffix="%" mode="decimal" hint="Jobs forecast below this get a margin warning." />
        <Num id="cs-net" label="Target net margin" value={net} onChange={(v) => setNet(signed(v))} suffix="%" mode="decimal" hint="Optional. Shown next to the profit forecast." />
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2" disabled={off}>
        <legend className="px-1 text-lg font-bold">When customers usually pay</legend>
        <div>
          <span className="label">Usual days to pay</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {COLLECTION_PRESETS.map((d) => <button key={d} type="button" onClick={() => setDays(String(d))} aria-pressed={Number(days) === d}
              className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${Number(days) === d ? "border-brand bg-brand-tint" : "border-line"}`}>{d} days</button>)}
            <input aria-label="Custom days" inputMode="numeric" className={`field w-24 ${preset ? "" : "border-brand"}`} value={days} onChange={(e) => setDays(digits(e.target.value))} />
          </div>
        </div>
        <label className="label" htmlFor="cs-basis">Counted from
          <select id="cs-basis" className="field mt-1" value={basis} onChange={(e) => setBasis(e.target.value as CollectionBasis)}>
            <option value="due">The invoice due date</option><option value="issue">The day the invoice is sent</option>
          </select></label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={useHistory} onChange={(e) => setUseHistory(e.target.checked)} />
          <span>Use each customer&apos;s own payment history once they have paid at least
            <input aria-label="Paid invoices needed" inputMode="numeric" className="field mx-2 inline w-16" value={minSample} onChange={(e) => setMinSample(digits(e.target.value))} />
            invoices. A customer setting below always wins.</span></label>
        <Num id="cs-grace" label="Late payment warning after" value={grace} onChange={(v) => setGrace(digits(v))} suffix="days past their usual" />
        <Num id="cs-cons-late" label="Conservative view: customers pay" value={consLate} onChange={(v) => setConsLate(digits(v))} suffix="days later" />
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-line bg-surface p-4" disabled={off}>
        <legend className="px-1 text-lg font-bold">Job costs not committed yet</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Expense forecast mode">
          {EXPENSE_MODES.map((m) => (
            <label key={m.value} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${mode === m.value ? "border-brand bg-brand-tint" : "border-line"}`}>
              <input type="radio" name="cs-mode" checked={mode === m.value} onChange={() => setMode(m.value)} />
              <span><span className="font-semibold">{m.label}</span><span className="block text-xs text-muted">{m.detail}</span></span>
            </label>))}
        </div>
        {mode === "benchmark" && (
          <div className="grid gap-3 sm:grid-cols-4" data-testid="v9-benchmarks">
            {BENCH_TYPES.map((b) => <Num key={b.key} id={`cs-b-${b.key}`} label={b.label} value={bench[b.key] ?? ""} mode="decimal" suffix="% of contract" onChange={(v) => setBench({ ...bench, [b.key]: decimal(v) })} />)}
            <p className="text-xs text-muted sm:col-span-4">Your own figures, not industry numbers. Actual costs, bills and commitments are always used first.</p>
          </div>)}
        <div className="grid gap-4 sm:grid-cols-3">
          <Num id="cs-sub" label="Subcontractors are paid" value={subDays} onChange={(v) => setSubDays(digits(v))} suffix="days after their phase ends" hint="Used when a subcontract has no payment terms of its own." />
          <Num id="cs-sup" label="Suppliers are paid" value={supDays} onChange={(v) => setSupDays(digits(v))} suffix="days after delivery" />
          <Num id="cs-cons-cost" label="Conservative view: costs run" value={consCost} onChange={(v) => setConsCost(decimal(v))} suffix="% higher" mode="decimal" />
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-line bg-surface p-4" disabled={off}>
        <legend className="px-1 text-lg font-bold">Payroll</legend>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={payroll} onChange={(e) => setPayroll(e.target.checked)} />
          <span>Forecast payroll from crew shifts, assignments and the time clock (including shop and office hours). While on, payroll you entered by hand as a planned payment is left out so it isn&apos;t counted twice. Overtime isn&apos;t estimated.</span></label>
        {payroll && <div className="grid gap-4 sm:grid-cols-3">
          <Num id="cs-lag" label="Paychecks go out" value={payLag} onChange={(v) => setPayLag(digits(v))} suffix="days after the pay period ends" />
          <Num id="cs-burden" label="Payroll taxes and benefits" value={burden} onChange={(v) => setBurden(decimal(v))} suffix="% on top of wages" mode="decimal" hint="Your own estimate. Leave 0 if you aren't sure." />
        </div>}
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-line bg-surface p-4" disabled={off}>
        <legend className="px-1 text-lg font-bold">Early warnings</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Num id="cs-conc-days" label="Warn when payments due within" value={concDays} onChange={(v) => setConcDays(digits(v))} suffix="days of each other" />
          <Num id="cs-conc-pct" label="…add up to more than" value={concPct} onChange={(v) => setConcPct(decimal(v))} suffix="% of today's bank balance" mode="decimal" />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(ALERT_LABELS) as AlertKind[]).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!kindsOff.includes(k)} onChange={(e) => setKindsOff(e.target.checked ? kindsOff.filter((x) => x !== k) : [...kindsOff, k])} />{ALERT_LABELS[k]}</label>))}
        </div>
        <p className="text-xs text-muted">Warnings show on the Cash flow page. They never send an invoice, move money or contact a customer.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={email} onChange={(e) => setEmail(e.target.checked)} data-testid="v9-alert-email" />
          <span>Also email new warnings once a day (off unless you turn it on). Only the people you pick below get them.</span></label>
        {email && (people.length ? (
          <div className="grid gap-2 sm:grid-cols-3" data-testid="v9-alert-recipients">
            {people.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={recips.includes(p.id)}
              onChange={(e) => setRecips(e.target.checked ? [...recips, p.id].slice(0, 20) : recips.filter((x) => x !== p.id))} />{p.label}</label>)}
            {!recips.length && <p className="text-xs text-warn sm:col-span-3">Pick at least one person, or no email is sent.</p>}
          </div>) : <p className="text-xs text-muted">No one with access to company financials was found.</p>)}
      </fieldset>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={busy} data-testid="v9-settings-save">Save forecast settings</Button>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}<Msg msg={msg} /></div>
      ) : <p className="text-sm text-muted">Only someone who can change financial settings can edit these.</p>}
    </form>
  );
}

/** One customer's payment habit. Wins over history and the company default. */
export function CollectionTermRow({ customerId, name, current, history, canEdit }: {
  customerId: string; name: string; current: { days: number; basis: CollectionBasis } | null; history: { n: number; afterDue: number; afterIssue: number } | null; canEdit: boolean;
}) {
  const { busy, msg, run } = useV9();
  const [days, setDays] = useState(current ? String(current.days) : "");
  const [basis, setBasis] = useState<CollectionBasis>(current?.basis ?? "due");
  return (
    <tr className="border-t border-line align-top" data-testid="v9-collection-row">
      <td className="p-2 font-semibold">{name}</td>
      <td className="p-2 text-sm text-muted">{history && history.n > 0 ? `${history.n} paid · about ${Math.round(history.afterDue)} days after due` : "No paid invoices yet"}</td>
      <td className="p-2">{canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label={`Days for ${name}`} inputMode="numeric" className="field w-20" value={days} onChange={(e) => setDays(digits(e.target.value))} placeholder="—" />
          <select aria-label={`Counted from for ${name}`} className="field w-auto" value={basis} onChange={(e) => setBasis(e.target.value as CollectionBasis)}>
            <option value="due">after due date</option><option value="issue">after sending</option></select>
          <Button type="button" size="sm" variant="secondary" disabled={busy || days === ""} onClick={() => run({ action: "collection_terms_save", customerId, p: { days: Math.min(365, Number(days)), basis } }, "Saved.")}>Save</Button>
          {current && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={async () => { if (await run({ action: "collection_terms_save", customerId, p: { remove: true } }, "Back to the default.")) setDays(""); }}>Use default</Button>}
          <Msg msg={msg} />
        </div>
      ) : current ? `${current.days} days ${current.basis === "due" ? "after due date" : "after sending"}` : "Default"}</td>
    </tr>
  );
}
