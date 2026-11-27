"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hasTwoStep, requireStaffCap } from "@/lib/staff/server";

/**
 * Year-end tax controls (V8.4). Owner only: every RPC re-checks the owner in the database and writes the audit log.
 * Anything that changes what is withheld from a payout, or marks a state's rules as verified, also needs two-step.
 */
const back = (q: Record<string, string>): never => { revalidatePath("/admin/payouts"); redirect(`/admin/payouts?${new URLSearchParams({ tab: "tax", ...q })}`); };
const errOf = (m?: string) => (m ?? "invalid").replace(/^[\s\S]*?(rate_not_verified|reason_required|state_rule_verified|owner_only|unknown_state|payer_ein|forbidden)[\s\S]*$/, "$1").slice(0, 60);
const str = (fd: FormData, k: string, max = 300) => String(fd.get(k) ?? "").trim().slice(0, max);
const dollars = (v: string) => { const n = Number(v.replace(/[$,\s]/g, "")); return v === "" ? null : Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN; };
const pct = (v: string) => { const n = Number(v.replace(/[%\s]/g, "")); return v === "" ? null : Number.isFinite(n) && n >= 0 && n <= 50 ? Math.round(n * 100) : NaN; };

async function owner2fa(q: Record<string, string> = {}) {
  const a = await requireStaffCap("payouts.activate");
  if (!(await hasTwoStep())) back({ ...q, err: "two_step" });
  return a;
}

export async function saveTaxSettings(fd: FormData) {
  const year = str(fd, "year", 4);
  const { user, db } = await owner2fa({ year });
  const ein = str(fd, "payer_ein", 20).replace(/[^0-9]/g, "");
  if (ein && ein.length !== 9) back({ year, err: "payer_ein" });
  const bps = pct(str(fd, "backup_rate", 6));
  if (Number.isNaN(bps)) back({ year, err: "invalid" });
  const stateIds: Record<string, string> = {};
  for (const line of str(fd, "payer_state_ids", 2000).split(/[\n,;]+/)) {
    const m = line.trim().match(/^([A-Za-z]{2})\s*[:=]\s*(\S{1,40})$/);
    if (m) stateIds[m[1].toUpperCase()] = m[2];
  }
  const p = {
    payer_legal_name: str(fd, "payer_legal_name", 200), payer_ein: ein ? `${ein.slice(0, 2)}-${ein.slice(2)}` : "", payer_address: str(fd, "payer_address"), payer_phone: str(fd, "payer_phone", 40),
    payer_state_ids: stateIds, backup_withholding_bps: bps, backup_rate_verified: fd.get("backup_rate_verified") === "on", backup_rate_source: str(fd, "backup_rate_source", 500),
    backup_withholding_enabled: fd.get("backup_withholding_enabled") === "on", filing_method: str(fd, "filing_method", 20), deposit_schedule: str(fd, "deposit_schedule", 20), cpa_name: str(fd, "cpa_name", 200),
  };
  const { error } = await db.rpc("admin_payout_tax_settings_save", { p_caller: user.id, p });
  back(error ? { year, err: errOf(error.message) } : { year, ok: "tax_settings" });
}

export async function saveStateRule(fd: FormData) {
  const year = str(fd, "year", 4);
  const state = str(fd, "state", 2).toUpperCase();
  const { user, db } = await owner2fa({ year, state });
  const threshold = dollars(str(fd, "state_1099_threshold", 12));
  const ct = dollars(str(fd, "contractor_threshold", 12));
  const bw = pct(str(fd, "state_backup_rate", 6));
  const days = str(fd, "contractor_days", 3);
  if ([threshold, ct, bw].some((x) => Number.isNaN(x)) || (days && !/^\d{1,3}$/.test(days))) back({ year, state, err: "invalid" });
  const income = str(fd, "has_income_tax", 5);
  const p = {
    has_income_tax: income === "yes" ? true : income === "no" ? false : null,
    state_1099_filing: str(fd, "state_1099_filing", 30), state_1099_threshold_cents: threshold, state_backup_withholding_bps: bw,
    nonresident_withholding_note: str(fd, "nonresident_note", 500), contractor_reporting: str(fd, "contractor_reporting", 20),
    contractor_report_threshold_cents: ct, contractor_report_days: days ? Number(days) : null, agency_url: /^https:\/\//.test(str(fd, "agency_url")) ? str(fd, "agency_url") : "",
    notes: str(fd, "notes", 1000), source_note: str(fd, "source_note", 500), verified: fd.get("verified") === "on",
  };
  const { error } = await db.rpc("admin_state_tax_rule_save", { p_caller: user.id, p_state: state, p });
  back(error ? { year, state, err: errOf(error.message) } : { year, state, ok: "state_saved" });
}

export async function savePayeeTaxStatus(fd: FormData) {
  const year = str(fd, "year", 4);
  const { user, db } = await owner2fa({ year });
  const kind = str(fd, "kind", 10);
  const flag = str(fd, "backup_withholding", 5);
  const p: Record<string, unknown> = { tin_match_status: str(fd, "tin_match_status", 20) || null, tin_matched_on: str(fd, "tin_matched_on", 10) || null };
  if (flag === "on" || flag === "off") {
    p.backup_withholding = flag === "on";
    p.backup_withholding_reason = str(fd, "backup_withholding_reason", 20) || null;
    p.backup_withholding_since = str(fd, "backup_withholding_since", 10) || null;
  }
  const { error } = await db.rpc("admin_payee_tax_status_save", { p_caller: user.id, p_kind: kind, p_id: str(fd, "id", 40), p });
  back(error ? { year, err: errOf(error.message) } : { year, ok: "payee_saved" });
}

export async function recordStateFiling(fd: FormData) {
  const year = str(fd, "year", 4);
  const { user, db } = await requireStaffCap("payouts.activate");
  const [kind, id] = str(fd, "payee", 60).split(":");
  const p = { payee_kind: kind, payee_id: id, state: str(fd, "state", 2), kind: str(fd, "filing_kind", 20), tax_year: Number(year), filed_on: str(fd, "filed_on", 10),
    confirmation: str(fd, "confirmation", 200), note: str(fd, "note", 500) };
  const { error } = await db.rpc("admin_state_filing_record", { p_caller: user.id, p });
  back(error ? { year, err: errOf(error.message) } : { year, ok: "filing" });
}

export async function recordDeposit(fd: FormData) {
  const year = str(fd, "year", 4);
  const { user, db } = await requireStaffCap("payouts.activate");
  const amount = dollars(str(fd, "amount", 14));
  if (!amount || Number.isNaN(amount)) back({ year, err: "invalid" });
  const p = { jurisdiction: str(fd, "jurisdiction", 10), period_month: `${str(fd, "period_month", 7)}-01`, amount_cents: amount, deposited_on: str(fd, "deposited_on", 10),
    confirmation: str(fd, "confirmation", 200), note: str(fd, "note", 500) };
  const { error } = await db.rpc("admin_withholding_deposit_record", { p_caller: user.id, p });
  back(error ? { year, err: errOf(error.message) } : { year, ok: "deposit" });
}
