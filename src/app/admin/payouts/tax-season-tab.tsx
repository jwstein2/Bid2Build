import { Chip, Empty, Mini, Panel, Segmented, Table } from "@/components/admin/cc";
import type { requireStaffCap } from "@/lib/staff/server";
import { money } from "@/lib/payouts/labels";
import {
  BACKUP_REASON, CONTRACTOR_REPORTING, DEPOSIT_SCHEDULE, FILING_METHOD, STATE_1099, depositGaps, federalDeadlines, maskTin, readiness, type TaxSeason,
} from "@/lib/payouts/tax-season";
import { saveThreshold } from "./actions";
import { recordDeposit, recordStateFiling, savePayeeTaxStatus, saveStateRule, saveTaxSettings } from "./tax-actions";

type Db = Awaited<ReturnType<typeof requireStaffCap>>["db"];
const btn = "cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-xs text-white hover:border-[var(--cc-blue)]";
const dl = "cc-mono inline-flex rounded-md border border-[var(--cc-line)] px-2 py-1 text-[11px] text-[var(--cc-blue)] hover:border-[var(--cc-blue)] hover:text-white";
const K = ({ children }: { children: React.ReactNode }) => <span className="cc-kicker mb-1 block">{children}</span>;

/**
 * Year-end tax (V8.4): readiness, downloads (CSV + PDF), payer details and withholding switch, state-by-state rules,
 * payees (W-9 / TIN / IRS notices), contractor reports and withholding deposits. Built2Bid's own payees only.
 */
export async function TaxSeasonTab({ db, caller, year, owner, state }: { db: Db; caller: string; year: number; owner: boolean; state?: string }) {
  const { data, error } = await db.rpc("admin_tax_season", { p_caller: caller, p_year: year });
  if (error || !data) return <Panel title="Not installed"><p className="text-sm text-ink-soft">Run migration 20270304001000_payout_tax_compliance.sql in the Supabase SQL Editor first.</p></Panel>;
  const s = data as TaxSeason;
  const todo = readiness(s);
  const needs = s.payees.filter((p) => p.needs_1099);
  const withheld = s.payees.reduce((n, p) => n + p.federal_withheld_cents + p.state_withheld_cents, 0);
  const gaps = depositGaps(s);
  const usedStates = s.states.filter((r) => r.payees > 0);
  const pick = s.states.find((r) => r.state === (state ?? "").toUpperCase()) ?? usedStates.find((r) => !r.verified) ?? s.states.find((r) => r.state === "MN")!;
  const q = (doc: string, format?: string) => `/api/payouts/tax-season?year=${year}&doc=${doc}${format ? `&format=${format}` : ""}`;
  const ts = s.settings;

  return (
    <div className="space-y-6">
      <Panel title={`Tax season ${year}`} action={<Segmented active={String(year)} options={[year - 1, year, year + 1].map((y) => ({ value: String(y), label: String(y), href: `/admin/payouts?tab=tax&year=${y}` }))} />}>
        <div className="grid gap-2 sm:grid-cols-4">
          <Mini label="1099-NECs needed" value={needs.length} tone={needs.length ? "amber" : undefined} />
          <Mini label="Reportable paid" value={money(s.payees.reduce((n, p) => n + p.gross_cents, 0))} />
          <Mini label="Tax withheld" value={money(withheld)} tone={withheld ? "amber" : undefined} />
          <Mini label="States verified" value={`${usedStates.filter((r) => r.verified).length} / ${usedStates.length}`} tone={usedStates.some((r) => !r.verified) ? "red" : "green"} />
        </div>
        <div className="mt-4">
          <p className="cc-kicker mb-1">Still to do</p>
          {todo.length === 0 ? <p className="text-xs text-[var(--cc-green)]">Nothing outstanding for {year}.</p> : <ul className="list-disc space-y-1 pl-5 text-xs text-white">{todo.map((t) => <li key={t}>{t}</li>)}</ul>}
        </div>
        <div className="mt-4">
          <p className="cc-kicker mb-1">Federal deadlines (standard dates; your CPA confirms)</p>
          <ul className="space-y-0.5 text-xs text-ink-soft">{federalDeadlines(year, s).map((d) => <li key={d.what} className={d.applies ? "text-white" : "opacity-60"}>{d.what}: {d.due}{d.applies ? "" : " (not needed so far)"}</li>)}</ul>
        </div>
      </Panel>

      <Panel title="Downloads for tax season">
        <p className="mb-3 text-xs text-ink-soft">Live payouts settled in {year}. CSV opens in Excel or Google Sheets; PDF is for your records or your accountant. Recipient TINs show only the last 4, except the e-file CSV.</p>
        <Table head={["Document", "What it's for", "Download"]} minWidth={720}>
          {([
            ["Tax season packet", "Everything below in one file for your CPA, plus the to-do list and deadlines", "packet"],
            ["1099-NEC summary", "Who needs a 1099, Box 1 and Box 4 amounts, W-9 status", "summary"],
            ["Payout ledger", "Every live payout: gross, fee, withholding, net, provider reference", "ledger"],
            ["Withholding report", "Backup withholding by month vs deposits (Form 945)", "withholding"],
            ["State-by-state report", "Payees and amounts by state, state filing rules, contractor-report deadlines", "states"],
          ] as const).map(([t, w, d]) => (
            <tr key={d}><td className="text-white">{t}</td><td className="text-xs text-ink-soft">{w}</td><td className="space-x-2"><a className={dl} href={q(d, "pdf")}>PDF</a><a className={dl} href={q(d, "csv")}>CSV</a></td></tr>
          ))}
          <tr><td className="text-white">1099-NEC recipient copies (Copy B)</td><td className="text-xs text-ink-soft">One page per person to mail or hand over (electronic delivery needs the person&apos;s consent)</td><td><a className={dl} href={q("copy-b")}>PDF</a></td></tr>
          {owner && <tr><td className="text-white">1099-NEC e-file file</td><td className="text-xs text-ink-soft">Full taxpayer IDs for your filing service or IRS IRIS. Owner + two-step only; every download is logged.</td><td><a className={dl} href={q("efile")}>CSV</a></td></tr>}
        </Table>
      </Panel>

      <Panel title={`Payees, ${year}`}>
        {s.payees.length === 0 ? <Empty>No contractors or affiliates yet.</Empty> : (
          <Table head={["Payee", "TIN / W-9", "State", "Paid (Box 1)", "Withheld", "1099", "Backup withholding / TIN match"]} minWidth={1100}>
            {s.payees.map((p) => (
              <tr key={p.kind + p.id} className="align-top">
                <td className="text-white">{p.name}{p.business_name ? <div className="text-[11px] text-ink-soft">{p.business_name}</div> : null}<div className="text-[11px] text-ink-soft">{p.kind === "affiliate" ? "Affiliate" : "Staff / sales rep"}</div></td>
                <td className="text-xs">{maskTin(p.tin_type, p.tin_last4) || <span className="text-[var(--cc-red)]">No TIN</span>}<div className="text-ink-soft">W-9: {p.w9_status}</div>{p.missing.length > 0 && <div className="text-[var(--cc-red)]">Missing: {p.missing.join(", ")}</div>}</td>
                <td className="text-xs">{p.tax_state ?? <span className="text-[var(--cc-red)]">Unknown</span>}</td>
                <td className="text-xs text-white">{money(p.gross_cents)}<div className="text-ink-soft">{p.payouts} payout(s)</div></td>
                <td className="text-xs">{money(p.federal_withheld_cents)} fed{p.state_withheld_cents ? <div>{money(p.state_withheld_cents)} state</div> : null}</td>
                <td className="text-xs">{p.needs_1099 ? <Chip tone="amber">1099-NEC</Chip> : p.likely_exempt ? <Chip tone="muted">Corporation: likely exempt</Chip> : <Chip tone="muted">Not yet</Chip>}</td>
                <td className="text-xs">
                  {p.backup_withholding ? <Chip tone="red">Backup withholding: {BACKUP_REASON[p.backup_reason ?? ""] ?? "on"}</Chip> : <span className="text-ink-soft">No IRS notice</span>}
                  <div className="text-ink-soft">TIN match: {p.tin_match.replace("_", " ")}</div>
                  {owner && (
                    <details className="mt-1"><summary className="cursor-pointer text-[var(--cc-blue)]">Update</summary>
                      <form action={savePayeeTaxStatus} className="mt-2 grid gap-1.5">
                        <input type="hidden" name="year" value={year} /><input type="hidden" name="kind" value={p.kind} /><input type="hidden" name="id" value={p.id} />
                        <label><K>IRS backup withholding notice</K><select name="backup_withholding" defaultValue="" className="field field-sm w-full"><option value="">No change</option><option value="on">Yes: start withholding</option><option value="off">No / notice cleared</option></select></label>
                        <label><K>Reason</K><select name="backup_withholding_reason" defaultValue={p.backup_reason ?? ""} className="field field-sm w-full"><option value="">—</option>{Object.entries(BACKUP_REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                        <label><K>Notice date</K><input type="date" name="backup_withholding_since" className="field field-sm w-full" /></label>
                        <label><K>IRS TIN Matching result</K><select name="tin_match_status" defaultValue="" className="field field-sm w-full"><option value="">No change</option><option value="matched">Matched</option><option value="mismatch">Mismatch</option><option value="not_checked">Not checked</option></select></label>
                        <button className={btn}>Save (two-step)</button>
                      </form>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-2 text-[11px] text-ink-soft">Payouts without a W-9 are held, never paid. Backup withholding is only turned on for a person after an IRS notice (B-notice / CP2100). TIN Matching is done in IRS e-Services; record the result here.</p>
      </Panel>

      <Panel title="State-by-state rules" action={<form className="flex items-center gap-1"><input type="hidden" name="tab" value="tax" /><input type="hidden" name="year" value={year} />
        <select name="state" defaultValue={pick.state} className="field field-sm">{s.states.map((r) => <option key={r.state} value={r.state}>{r.state} {r.name}{r.verified ? " ✓" : ""}{r.payees ? ` (${r.payees})` : ""}</option>)}</select><button className={btn}>Open</button></form>}>
        <p className="mb-3 text-xs text-ink-soft">Every state starts <b>unverified</b>. Live payouts to a person are held until their state is verified here with a source (ask your CPA). Pre-filled notes are reminders, not tax advice.</p>
        {usedStates.length > 0 && (
          <Table head={["State", "Verified", "Payees", "State 1099 filing", "Contractor reporting", "State backup rate"]} minWidth={820}>
            {usedStates.map((r) => (
              <tr key={r.state}><td className="text-white">{r.state} {r.name}</td><td>{r.verified ? <Chip tone="green">Verified</Chip> : <Chip tone="red">Not verified</Chip>}</td><td>{r.payees}</td>
                <td className="text-xs">{STATE_1099[r.state_1099_filing]}</td><td className="text-xs">{CONTRACTOR_REPORTING[r.contractor_reporting]}{r.contractor_report_days ? ` (${r.contractor_report_days} days)` : ""}</td>
                <td className="text-xs">{r.state_backup_withholding_bps != null ? `${r.state_backup_withholding_bps / 100}%` : "—"}</td></tr>
            ))}
          </Table>
        )}
        <form action={saveStateRule} className="mt-4 grid gap-3 rounded-lg border border-[var(--cc-line)] p-4 text-xs sm:grid-cols-3">
          <input type="hidden" name="year" value={year} /><input type="hidden" name="state" value={pick.state} />
          <p className="text-sm text-white sm:col-span-3">{pick.state} {pick.name} {pick.verified ? <Chip tone="green">Verified {pick.verified_at?.slice(0, 10)}</Chip> : <Chip tone="red">Not verified</Chip>}</p>
          {pick.notes && <p className="text-ink-soft sm:col-span-3">{pick.notes}</p>}
          <label><K>State income tax</K><select name="has_income_tax" defaultValue={pick.has_income_tax == null ? "" : pick.has_income_tax ? "yes" : "no"} className="field field-sm w-full"><option value="">Not checked</option><option value="yes">Yes</option><option value="no">No</option></select></label>
          <label><K>State 1099-NEC filing</K><select name="state_1099_filing" defaultValue={pick.state_1099_filing} className="field field-sm w-full">{Object.entries(STATE_1099).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><K>State 1099 threshold ($, blank = federal)</K><input name="state_1099_threshold" defaultValue={pick.state_1099_threshold_cents != null ? pick.state_1099_threshold_cents / 100 : ""} className="field field-sm w-full" /></label>
          <label><K>State backup withholding rate (%)</K><input name="state_backup_rate" defaultValue={pick.state_backup_withholding_bps != null ? pick.state_backup_withholding_bps / 100 : ""} className="field field-sm w-full" /></label>
          <label><K>Contractor (new-hire) reporting</K><select name="contractor_reporting" defaultValue={pick.contractor_reporting} className="field field-sm w-full">{Object.entries(CONTRACTOR_REPORTING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2"><label><K>Report at ($)</K><input name="contractor_threshold" defaultValue={pick.contractor_report_threshold_cents != null ? pick.contractor_report_threshold_cents / 100 : ""} className="field field-sm w-full" /></label>
            <label><K>Within (days)</K><input name="contractor_days" defaultValue={pick.contractor_report_days ?? ""} className="field field-sm w-full" /></label></div>
          <label className="sm:col-span-3"><K>Nonresident withholding note</K><input name="nonresident_note" defaultValue={pick.nonresident_withholding_note ?? ""} className="field field-sm w-full" /></label>
          <label><K>Agency website (https://)</K><input name="agency_url" defaultValue={pick.agency_url ?? ""} className="field field-sm w-full" /></label>
          <label className="sm:col-span-2"><K>Notes</K><input name="notes" defaultValue={pick.notes ?? ""} className="field field-sm w-full" /></label>
          <label className="sm:col-span-2"><K>Source (who confirmed it, when, which page)</K><input name="source_note" defaultValue={pick.source_note ?? ""} className="field field-sm w-full" /></label>
          <label className="flex items-center gap-2 text-white"><input type="checkbox" name="verified" defaultChecked={pick.verified} /> My CPA confirmed these rules</label>
          {owner && <div className="sm:col-span-3"><button className={btn}>Save {pick.state} (two-step)</button></div>}
        </form>
      </Panel>

      <Panel title="State contractor reports">
        {s.contractor_reports.length === 0 ? <Empty>No payees in states marked &quot;contractor reporting required&quot;.</Empty> : (
          <Table head={["Payee", "State", "Threshold crossed", "Due", "Filed"]} minWidth={640}>
            {s.contractor_reports.map((c) => {
              const late = !!c.due_on && !c.filed_on && c.due_on < new Date().toISOString().slice(0, 10);
              return <tr key={c.payee_id + c.state}><td className="text-white">{c.name}</td><td>{c.state}{c.rule_verified ? "" : " (unverified)"}</td><td className="text-xs">{c.crossed_on ?? "Not yet"}</td>
                <td className="text-xs">{c.due_on ? (late ? <Chip tone="red">{c.due_on} · late</Chip> : c.due_on) : "—"}</td><td className="text-xs">{c.filed_on ?? (c.agency_url ? <a className="text-[var(--cc-blue)]" href={c.agency_url} target="_blank" rel="noreferrer">File on the state site</a> : "Not recorded")}</td></tr>;
            })}
          </Table>
        )}
        {owner && s.payees.length > 0 && (
          <form action={recordStateFiling} className="mt-4 flex flex-wrap items-end gap-2 text-xs">
            <input type="hidden" name="year" value={year} />
            <label><K>Payee</K><select name="payee" className="field field-sm">{s.payees.map((p) => <option key={p.kind + p.id} value={`${p.kind}:${p.id}`}>{p.name}</option>)}</select></label>
            <label><K>State</K><input name="state" maxLength={2} defaultValue={pick.state} className="field field-sm w-16" /></label>
            <label><K>Filing</K><select name="filing_kind" className="field field-sm"><option value="contractor_report">Contractor report</option><option value="state_1099">State 1099</option><option value="other">Other</option></select></label>
            <label><K>Filed on</K><input type="date" name="filed_on" required className="field field-sm" /></label>
            <label><K>Confirmation #</K><input name="confirmation" className="field field-sm w-36" /></label>
            <button className={btn}>Record filing</button>
          </form>
        )}
      </Panel>

      <Panel title="Withholding deposits (Form 945 / state)">
        {gaps.length === 0 ? <Empty>No tax has been withheld from a live payout in {year}.</Empty> : (
          <Table head={["Month", "Jurisdiction", "Withheld", "Deposited", "Still to deposit"]} minWidth={600}>
            {gaps.map((g) => <tr key={g.month + g.jurisdiction}><td>{g.month}</td><td>{g.jurisdiction === "federal" ? "Federal" : g.jurisdiction}</td><td>{money(g.withheld_cents)}</td><td>{money(g.deposited_cents)}</td>
              <td>{g.gap_cents > 0 ? <Chip tone="red">{money(g.gap_cents)}</Chip> : <Chip tone="green">Done</Chip>}</td></tr>)}
          </Table>
        )}
        <p className="mt-2 text-[11px] text-ink-soft">Withheld money stays in Built2Bid&apos;s account; deposit it with the IRS through EFTPS (and the state, if any) and record it here. Built2Bid can&apos;t make tax deposits for you.</p>
        {owner && (
          <form action={recordDeposit} className="mt-3 flex flex-wrap items-end gap-2 text-xs">
            <input type="hidden" name="year" value={year} />
            <label><K>For month</K><input type="month" name="period_month" required className="field field-sm" /></label>
            <label><K>Jurisdiction</K><input name="jurisdiction" defaultValue="federal" className="field field-sm w-24" /></label>
            <label><K>Amount ($)</K><input name="amount" required className="field field-sm w-28" /></label>
            <label><K>Deposited on</K><input type="date" name="deposited_on" required className="field field-sm" /></label>
            <label><K>EFTPS / confirmation #</K><input name="confirmation" className="field field-sm w-40" /></label>
            <button className={btn}>Record deposit</button>
          </form>
        )}
      </Panel>

      <Panel title="Payer details, filing and withholding">
        <form action={saveTaxSettings} className="grid gap-3 text-xs sm:grid-cols-3">
          <input type="hidden" name="year" value={year} />
          <label><K>Payer legal name</K><input name="payer_legal_name" defaultValue={ts.payer_legal_name} className="field field-sm w-full" /></label>
          <label><K>Payer EIN</K><input name="payer_ein" defaultValue={ts.payer_ein ?? ""} placeholder="12-3456789" className="field field-sm w-full" /></label>
          <label><K>Payer phone</K><input name="payer_phone" defaultValue={ts.payer_phone ?? ""} className="field field-sm w-full" /></label>
          <label className="sm:col-span-3"><K>Payer address (street, city, state ZIP)</K><input name="payer_address" defaultValue={ts.payer_address ?? ""} className="field field-sm w-full" /></label>
          <label className="sm:col-span-3"><K>State payer / withholding IDs (one per line, e.g. MN: 1234567)</K><textarea name="payer_state_ids" rows={2} defaultValue={Object.entries(ts.payer_state_ids ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n")} className="field field-sm w-full" /></label>
          <label><K>How 1099s get filed</K><select name="filing_method" defaultValue={ts.filing_method} className="field field-sm w-full">{Object.entries(FILING_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><K>Form 945 deposit schedule</K><select name="deposit_schedule" defaultValue={ts.deposit_schedule} className="field field-sm w-full">{Object.entries(DEPOSIT_SCHEDULE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><K>CPA / accountant</K><input name="cpa_name" defaultValue={ts.cpa_name ?? ""} className="field field-sm w-full" /></label>
          <div className="rounded-lg border border-[var(--cc-line)] p-3 sm:col-span-3">
            <p className="mb-2 text-white">Backup withholding {ts.backup_withholding_enabled ? <Chip tone="amber">ON</Chip> : <Chip tone="muted">OFF</Chip>}</p>
            <p className="mb-2 text-ink-soft">Applies only to people you mark with an IRS notice above. While it&apos;s off, those people&apos;s payouts wait on hold instead of being paid in full.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label><K>Federal rate (%)</K><input name="backup_rate" defaultValue={ts.backup_withholding_bps / 100} className="field field-sm w-full" /></label>
              <label className="sm:col-span-2"><K>Rate source</K><input name="backup_rate_source" defaultValue={ts.backup_rate_source} className="field field-sm w-full" /></label>
              <label className="flex items-center gap-2 text-white"><input type="checkbox" name="backup_rate_verified" defaultChecked={ts.backup_rate_verified} /> My CPA confirmed the rate</label>
              <label className="flex items-center gap-2 text-white"><input type="checkbox" name="backup_withholding_enabled" defaultChecked={ts.backup_withholding_enabled} /> Withhold for IRS-noticed payees</label>
            </div>
          </div>
          {owner && <div className="sm:col-span-3"><button className={btn}>Save (two-step)</button></div>}
        </form>
      </Panel>

      {owner && (
        <Panel title="1099-NEC threshold for a tax year">
          <form action={saveThreshold} className="flex flex-wrap items-end gap-2 text-xs">
            <label><K>Year</K><input name="year" defaultValue={year} className="field field-sm w-24" /></label>
            <label><K>Threshold ($)</K><input name="threshold" defaultValue={s.threshold ? s.threshold.threshold_cents / 100 : ""} className="field field-sm w-28" /></label>
            <label className="flex-1"><K>Source</K><input name="note" defaultValue={s.threshold?.source_note ?? ""} className="field field-sm w-full" /></label>
            <label className="flex items-center gap-1 text-white"><input type="checkbox" name="verified" defaultChecked={s.threshold?.verified} /> Verified</label>
            <button className={btn}>Save (two-step)</button>
          </form>
        </Panel>
      )}

      <Panel title="W-2 employees">
        <p className="text-xs text-ink-soft">{s.employees_w2.length} employee(s). Wage withholding (federal, state, FICA), W-2s and state new-hire reports for employees need a payroll provider; Built2Bid never pays W-2 wages through contractor payouts. Salsa declined us and Honkamp has no API, so this stays manual until a provider (for example Gusto or Check) is chosen.</p>
      </Panel>
    </div>
  );
}
