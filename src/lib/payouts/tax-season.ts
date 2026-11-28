/**
 * Tax season (V8.4): the shape of public.admin_tax_season() plus the CSV and PDF table builders every download
 * uses. Pure functions (no server imports) so they're unit-tested. Full TINs never pass through here except the
 * e-file builder, which receives them from the server route after the owner's two-step check.
 */
import { csv } from "@/lib/admin/csv";

export interface TaxPayee {
  kind: "staff" | "affiliate"; id: string; name: string; business_name: string | null; email: string; label: string;
  tin_type: "ssn" | "ein" | "itin" | null; tin_last4: string | null; w9_status: string; tax_class: string | null; exempt_code: string | null;
  backup_withholding: boolean; backup_reason: string | null; tin_match: string;
  address: string | null; address_line1: string | null; address_line2: string | null; city: string | null; addr_state: string | null; postal_code: string | null;
  tax_state: string | null; gross_cents: number; federal_withheld_cents: number; state_withheld_cents: number; net_cents: number; recipient_fees_cents: number; payouts: number;
  likely_exempt: boolean; needs_1099: boolean; missing: string[];
}
export interface TaxStateRow {
  state: string; name: string; verified: boolean; verified_at: string | null; source_note: string | null; has_income_tax: boolean | null;
  state_1099_filing: "unknown" | "cfsf" | "direct" | "direct_if_withholding" | "none_expected"; state_1099_threshold_cents: number | null;
  state_backup_withholding_bps: number | null; nonresident_withholding_note: string | null;
  contractor_reporting: "unknown" | "required" | "not_required"; contractor_report_threshold_cents: number | null; contractor_report_days: number | null;
  agency_url: string | null; notes: string | null; payees: number; needs_1099: number; gross_cents: number; state_withheld_cents: number; payer_state_id: string | null; filings: number;
}
export interface ContractorReport { payee_kind: string; payee_id: string; name: string; state: string; rule_verified: boolean; threshold_cents: number | null; crossed_on: string | null; due_on: string | null; filed_on: string | null; agency_url: string | null }
export interface TaxSettings {
  payer_legal_name: string; payer_ein: string | null; payer_address: string | null; payer_phone: string | null; payer_state_ids: Record<string, string>;
  backup_withholding_enabled: boolean; backup_withholding_bps: number; backup_rate_verified: boolean; backup_rate_source: string;
  filing_method: "not_chosen" | "accountant" | "filing_service" | "irs_iris"; deposit_schedule: "not_set" | "monthly" | "semiweekly"; cpa_name: string | null;
}
export interface TaxSeason {
  year: number; generated_at: string;
  threshold: { threshold_cents: number; verified: boolean; source_note: string } | null;
  settings: TaxSettings; payees: TaxPayee[]; states: TaxStateRow[]; contractor_reports: ContractorReport[];
  withholding_by_month: { month: string; federal_cents: number; state: Record<string, number> }[];
  withholding_payouts: { ref: string; settled_at: string; payee: string; tax_state: string | null; gross_cents: number; federal_cents: number; state_cents: number; net_cents: number }[];
  deposits: { id: string; jurisdiction: string; period_month: string; amount_cents: number; deposited_on: string; confirmation: string | null; note: string | null }[];
  ledger: { ref: string; payee: string; payee_kind: string; status: string; settled_at: string | null; tax_state: string | null; gross_cents: number; adjustments_cents: number; fee_cents: number;
    fee_bearer: string; federal_cents: number; state_cents: number; net_cents: number; provider: string; provider_ref: string | null; items: number }[];
  employees_w2: { id: string; name: string; status: string; work_state: string | null }[];
  filings: { id: string; payee_kind: string; payee_id: string; state: string; kind: string; filed_on: string; confirmation: string | null; note: string | null }[];
}

export const usd = (c: number | null | undefined) => ((c ?? 0) / 100).toFixed(2);
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
export const maskTin = (t: string | null, last4: string | null) => (last4 ? (t === "ein" ? `**-***${last4}` : `***-**-${last4}`) : "");

export const STATE_1099: Record<TaxStateRow["state_1099_filing"], string> = {
  unknown: "Not checked yet", cfsf: "IRS forwards it (Combined Federal/State program)", direct: "File directly with the state",
  direct_if_withholding: "File with the state only if state tax was withheld", none_expected: "No state filing expected",
};
export const CONTRACTOR_REPORTING: Record<TaxStateRow["contractor_reporting"], string> = { unknown: "Not checked yet", required: "Required", not_required: "Not required" };
export const FILING_METHOD: Record<TaxSettings["filing_method"], string> = { not_chosen: "Not chosen yet", accountant: "My accountant files", filing_service: "A filing service (e.g. Track1099, Tax1099)", irs_iris: "I file on IRS IRIS myself" };
export const DEPOSIT_SCHEDULE: Record<TaxSettings["deposit_schedule"], string> = { not_set: "Not set (ask your CPA)", monthly: "Monthly depositor", semiweekly: "Semiweekly depositor" };
export const BACKUP_REASON: Record<string, string> = { irs_b_notice: "IRS B-notice (CP2100/972CG TIN mismatch)", irs_cp2100: "IRS CP2100 list", irs_notified: "IRS notified underreporting", other: "Other (see note)" };

/** Standard federal deadlines for the year's forms. Shown as reminders; the CPA confirms. */
export function federalDeadlines(year: number, s: TaxSeason): { what: string; due: string; applies: boolean }[] {
  const next = year + 1;
  const withheld = s.payees.some((p) => p.federal_withheld_cents > 0);
  const needs = s.payees.filter((p) => p.needs_1099).length;
  return [
    { what: `Form 1099-NEC to each recipient (${needs} ${needs === 1 ? "person" : "people"})`, due: `${next}-01-31`, applies: needs > 0 },
    { what: "Form 1099-NEC to the IRS (Copy A, e-file)", due: `${next}-01-31`, applies: needs > 0 },
    { what: "Form 945 (annual return of withheld federal income tax)", due: `${next}-01-31`, applies: withheld },
    { what: "Backup withholding deposits (monthly depositors: by the 15th of the next month)", due: "monthly", applies: withheld },
  ];
}

/** Monthly federal + state withheld vs deposited (for the withholding report). */
export function depositGaps(s: TaxSeason): { month: string; jurisdiction: string; withheld_cents: number; deposited_cents: number; gap_cents: number }[] {
  const out: { month: string; jurisdiction: string; withheld_cents: number; deposited_cents: number; gap_cents: number }[] = [];
  const dep = (m: string, j: string) => s.deposits.filter((x) => x.period_month.slice(0, 7) === m.slice(0, 7) && x.jurisdiction === j).reduce((n, x) => n + x.amount_cents, 0);
  for (const w of s.withholding_by_month) {
    const rows: [string, number][] = [["federal", w.federal_cents], ...Object.entries(w.state)];
    for (const [j, c] of rows) if (c > 0) { const d = dep(w.month, j); out.push({ month: w.month.slice(0, 7), jurisdiction: j, withheld_cents: c, deposited_cents: d, gap_cents: c - d }); }
  }
  return out;
}

export interface Sheet { title: string; head: string[]; rows: string[][]; note?: string }

export function summarySheet(s: TaxSeason): Sheet {
  return {
    title: `1099-NEC summary, ${s.year}`,
    head: ["Payee", "Type", "TIN", "Tax state", "Box 1 nonemployee comp", "Box 4 federal withheld", "State withheld", "Payouts", "W-9", "1099 needed", "Missing"],
    rows: s.payees.map((p) => [p.name + (p.business_name ? ` (${p.business_name})` : ""), p.kind === "affiliate" ? "Affiliate" : "Staff/rep", maskTin(p.tin_type, p.tin_last4) || "Not on file",
      p.tax_state ?? "", usd(p.gross_cents), usd(p.federal_withheld_cents), usd(p.state_withheld_cents), String(p.payouts), p.w9_status,
      p.needs_1099 ? "Yes" : p.likely_exempt ? "Likely exempt (corporation)" : "No", p.missing.join(", ")]),
    note: `Threshold ${s.threshold ? `$${usd(s.threshold.threshold_cents)}${s.threshold.verified ? "" : " (NOT verified)"}` : "not set"}. Gross = what was earned before any fee or withholding, live payouts settled in ${s.year}. Anyone with tax withheld needs a 1099 regardless of the threshold.`,
  };
}

export function ledgerSheet(s: TaxSeason): Sheet {
  return {
    title: `Payout ledger, ${s.year}`,
    head: ["Reference", "Payee", "Type", "Status", "Settled", "Tax state", "Gross", "Adjustments", "Fee", "Fee paid by", "Federal withheld", "State withheld", "Net deposit", "Provider ref", "Items"],
    rows: s.ledger.map((l) => [l.ref, l.payee, l.payee_kind, l.status, day(l.settled_at), l.tax_state ?? "", usd(l.gross_cents), usd(l.adjustments_cents), usd(l.fee_cents), l.fee_bearer,
      usd(l.federal_cents), usd(l.state_cents), usd(l.net_cents), l.provider_ref ?? "", String(l.items)]),
    note: "Live payouts only. Returned payouts are listed but don't count toward 1099 totals.",
  };
}

export function withholdingSheets(s: TaxSeason): Sheet[] {
  return [
    { title: `Withholding by month, ${s.year}`, head: ["Month", "Jurisdiction", "Withheld", "Deposited", "Still to deposit"],
      rows: depositGaps(s).map((g) => [g.month, g.jurisdiction === "federal" ? "Federal (Form 945)" : g.jurisdiction, usd(g.withheld_cents), usd(g.deposited_cents), usd(g.gap_cents)]),
      note: "Federal backup withholding is reported on Form 945 and deposited through EFTPS. Confirm your deposit schedule with your CPA." },
    { title: `Payouts with withholding, ${s.year}`, head: ["Reference", "Settled", "Payee", "State", "Gross", "Federal", "State", "Net"],
      rows: s.withholding_payouts.map((w) => [w.ref, day(w.settled_at), w.payee, w.tax_state ?? "", usd(w.gross_cents), usd(w.federal_cents), usd(w.state_cents), usd(w.net_cents)]) },
    { title: `Deposits recorded, ${s.year}`, head: ["Period", "Jurisdiction", "Amount", "Deposited on", "Confirmation", "Note"],
      rows: s.deposits.map((d) => [d.period_month.slice(0, 7), d.jurisdiction, usd(d.amount_cents), d.deposited_on, d.confirmation ?? "", d.note ?? ""]) },
  ];
}

export function stateSheets(s: TaxSeason): Sheet[] {
  const used = s.states.filter((r) => r.payees > 0 || r.verified);
  return [
    { title: `States with payees, ${s.year}`, head: ["State", "Rules verified", "Payees", "1099s", "Gross", "State withheld", "State 1099 filing", "Contractor reporting", "Payer state ID", "Filings recorded"],
      rows: used.map((r) => [`${r.state} ${r.name}`, r.verified ? `Yes (${day(r.verified_at)})` : "NO", String(r.payees), String(r.needs_1099), usd(r.gross_cents), usd(r.state_withheld_cents),
        STATE_1099[r.state_1099_filing], CONTRACTOR_REPORTING[r.contractor_reporting], r.payer_state_id ?? "", String(r.filings)]),
      note: "Unverified state rules are reminders, not tax advice. Verify each state your payees work in with your CPA before paying them live." },
    { title: `Contractor reporting deadlines, ${s.year}`, head: ["Payee", "State", "Rule verified", "Threshold crossed", "Due", "Filed"],
      rows: s.contractor_reports.map((c) => [c.name, c.state, c.rule_verified ? "Yes" : "NO", c.crossed_on ?? "Not yet", c.due_on ?? "", c.filed_on ?? "Not recorded"]) },
  ];
}

export const sheetCsv = (sheets: Sheet[]) => sheets.map((sh, i) => (i ? "\r\n" : "") + csv([sh.title], []) + csv(sh.head, sh.rows) + (sh.note ? csv([sh.note], []) : "")).join("");

/** IRS-style e-file columns (one row per 1099 needed). `tins` maps payee id -> formatted full TIN. */
export const EFILE_HEAD = ["Tax Year", "Form", "Payer Name", "Payer TIN", "Payer Address", "Payer Phone", "Recipient TIN Type", "Recipient TIN", "Recipient Name", "Recipient Second Name",
  "Recipient Address 1", "Recipient Address 2", "Recipient City", "Recipient State", "Recipient ZIP", "Account Number", "Box 1 Nonemployee Compensation", "Box 4 Federal Income Tax Withheld",
  "Box 5 State Tax Withheld", "Box 6 State", "Box 6 Payer State Number", "Box 7 State Income", "Recipient Email"] as const;

export function efileCsv(s: TaxSeason, tins: Map<string, string | null>): string {
  const rows = s.payees.filter((p) => p.needs_1099).map((p) => [String(s.year), "1099-NEC", s.settings.payer_legal_name, s.settings.payer_ein ?? "", s.settings.payer_address ?? "", s.settings.payer_phone ?? "",
    p.tin_type === "ein" ? "EIN" : p.tin_type ? "SSN" : "", tins.get(p.id) ?? "", p.name, p.business_name ?? "", p.address_line1 ?? "", p.address_line2 ?? "", p.city ?? "",
    p.addr_state ?? p.tax_state ?? "", p.postal_code ?? "", p.id.slice(0, 8).toUpperCase(), usd(p.gross_cents), usd(p.federal_withheld_cents),
    p.state_withheld_cents > 0 ? usd(p.state_withheld_cents) : "", p.tax_state ?? "", (p.tax_state && s.settings.payer_state_ids[p.tax_state]) || "",
    p.tax_state ? usd(p.gross_cents) : "", p.email]);
  return csv([...EFILE_HEAD], rows);
}

/** What still stands between this year and an easy filing (shown at the top of the Tax season tab and the packet). */
export function readiness(s: TaxSeason): string[] {
  const out: string[] = [];
  if (!s.settings.payer_ein) out.push("Add Built2Bid's EIN (payer details) so 1099s can be made.");
  if (!s.settings.payer_address) out.push("Add Built2Bid's business address (payer details).");
  if (s.settings.filing_method === "not_chosen") out.push("Choose how 1099s will be filed (accountant, filing service or IRS IRIS).");
  if (!s.threshold) out.push(`Enter the ${s.year} 1099-NEC threshold.`); else if (!s.threshold.verified) out.push(`Verify the ${s.year} 1099-NEC threshold with your CPA.`);
  const missing = s.payees.filter((p) => p.missing.length > 0);
  if (missing.length) out.push(`${missing.length} ${missing.length === 1 ? "payee is" : "payees are"} missing a W-9, TIN, address or state.`);
  const unverified = [...new Set(s.payees.map((p) => p.tax_state).filter((x): x is string => !!x))].filter((st) => !s.states.find((r) => r.state === st)?.verified);
  if (unverified.length) out.push(`Verify the tax rules for: ${unverified.join(", ")}.`);
  const overdue = s.contractor_reports.filter((c) => c.due_on && !c.filed_on && c.due_on < new Date().toISOString().slice(0, 10));
  if (overdue.length) out.push(`${overdue.length} state contractor ${overdue.length === 1 ? "report is" : "reports are"} past due.`);
  const gaps = depositGaps(s).filter((g) => g.gap_cents > 0);
  if (gaps.length) out.push(`Withholding not yet deposited for ${gaps.length} month/jurisdiction ${gaps.length === 1 ? "line" : "lines"}.`);
  if (s.payees.some((p) => p.backup_withholding) && !s.settings.backup_withholding_enabled) out.push("A payee has an IRS backup withholding notice but withholding is off: their payouts are on hold.");
  if (s.employees_w2.length) out.push(`${s.employees_w2.length} W-2 ${s.employees_w2.length === 1 ? "employee needs" : "employees need"} a payroll provider for wage withholding and W-2s (not handled here).`);
  return out;
}
