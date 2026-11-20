"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasTwoStep, requireStaffCap } from "@/lib/staff/server";
import { runPayouts, afterPayoutEvent } from "@/lib/payouts/run";

/**
 * Owner payout controls. Each RPC re-checks the owner in the database and is audited there. Money-sensitive
 * changes (limits, fee schedule, funding account, live activation, approving an exceptional payout) also need a
 * two-step (aal2) session. Pausing never does: an emergency stop must always work.
 */
const back = (tab: string, q: Record<string, string>): never => { revalidatePath("/admin/payouts"); redirect(`/admin/payouts?${new URLSearchParams({ tab, ...q })}`); };
const errOf = (m?: string) => (m ?? "invalid").replace(/^[\s\S]*?(checklist_incomplete:\w+|provider_is_mock|funding_not_approved|fee_policy_not_approved|use_activation|owner_only|not_awaiting_approval|not_cancelable|test_mock_only|not_submitted|label_required|forbidden)[\s\S]*$/, "$1").slice(0, 60);
const cents = (v: FormDataEntryValue | null) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) && n >= 1 ? Math.round(n * 100) : null; };

async function owner2fa(tab: string) {
  const a = await requireStaffCap("payouts.manage");
  if (!(await hasTwoStep())) back(tab, { err: "two_step" });
  return a;
}

export async function saveMode(fd: FormData) {
  const { user, db } = await requireStaffCap("payouts.manage");
  const mode = String(fd.get("mode"));
  const provider = String(fd.get("provider"));
  if (!["off", "test"].includes(mode) || !["mock", "stripe_global_payouts"].includes(provider)) back("settings", { err: "invalid" });
  const { error } = await db.rpc("admin_payout_settings_save", { p_caller: user.id, p: { mode, provider } });
  back("settings", error ? { err: errOf(error.message) } : { ok: "mode" });
}

export async function saveLimits(fd: FormData) {
  const { user, db } = await owner2fa("settings");
  const p = {
    per_payout_limit_cents: cents(fd.get("per_payout")), daily_limit_cents: cents(fd.get("daily")), review_above_cents: cents(fd.get("review_above")),
    bank_change_hold_hours: z.coerce.number().int().min(0).max(720).safeParse(fd.get("hold_hours")).data ?? null,
    pay_delay_days: z.coerce.number().int().min(0).max(31).safeParse(fd.get("delay_days")).data ?? null,
    min_payout_cents: Math.round((Number(fd.get("min_payout") ?? 0) || 0) * 100),
    fee_recovery_blocked_states: String(fd.get("blocked_states") ?? "").toUpperCase().split(/[\s,]+/).filter((x) => /^[A-Z]{2}$/.test(x)),
  };
  const { error } = await db.rpc("admin_payout_settings_save", { p_caller: user.id, p });
  back("settings", error ? { err: errOf(error.message) } : { ok: "limits" });
}

export async function pause(fd: FormData) {
  const { user, db } = await requireStaffCap("payouts.manage");
  const on = fd.get("paused") === "1";
  if (!on && !(await hasTwoStep())) back("overview", { err: "two_step" });
  const { error } = await db.rpc("admin_payout_pause", { p_caller: user.id, p_paused: on, p_reason: String(fd.get("reason") ?? "").slice(0, 500) });
  back("overview", error ? { err: errOf(error.message) } : { ok: on ? "paused" : "resumed" });
}

export async function approveFeePolicy(fd: FormData) {
  const { user, db } = await owner2fa("settings");
  const v = z.coerce.number().int().positive().safeParse(fd.get("version"));
  if (!v.success || fd.get("confirm") !== "on") back("settings", { err: "confirm" });
  const { error } = await db.rpc("admin_fee_policy_approve", { p_caller: user.id, p_version: v.data });
  back("settings", error ? { err: errOf(error.message) } : { ok: "fees" });
}

export async function approveFunding(fd: FormData) {
  const { user, db } = await owner2fa("settings");
  const { error } = await db.rpc("admin_funding_approve", { p_caller: user.id, p_label: String(fd.get("label") ?? "").slice(0, 200) });
  back("settings", error ? { err: errOf(error.message) } : { ok: "funding" });
}

export async function activateLive(fd: FormData) {
  const { user, db } = await owner2fa("settings");
  if (process.env.PAYOUTS_ALLOW_LIVE !== "true") back("settings", { err: "env_live" });
  const keys = ["provider_approved", "provider_live_keys", "funding_confirmed", "fee_policy_reviewed", "agreements_reviewed_by_counsel", "tax_reporting_plan", "classification_reviewed", "limits_reviewed", "test_run_passed"];
  const checklist = Object.fromEntries(keys.map((k) => [k, fd.get(k) === "on"]));
  const { error } = await db.rpc("admin_payout_activate_live", { p_caller: user.id, p_checklist: { ...checklist, typed_name: String(fd.get("typed_name") ?? "").slice(0, 120), at: new Date().toISOString() } });
  back("settings", error ? { err: errOf(error.message) } : { ok: "live" });
}

export async function approvePayout(fd: FormData) {
  const { user, db } = await owner2fa("ledger");
  const { error } = await db.rpc("admin_payout_approve", { p_caller: user.id, p_id: String(fd.get("id")) });
  back("ledger", error ? { err: errOf(error.message) } : { ok: "approved" });
}

export async function cancelPayout(fd: FormData) {
  const { user, db } = await requireStaffCap("payouts.manage");
  const { error } = await db.rpc("admin_payout_cancel", { p_caller: user.id, p_id: String(fd.get("id")), p_reason: String(fd.get("reason") ?? "Canceled by owner").slice(0, 300) });
  back("ledger", error ? { err: errOf(error.message) } : { ok: "canceled" });
}

export async function simulate(fd: FormData) {
  const { user, db } = await requireStaffCap("payouts.manage");
  const kind = String(fd.get("kind"));
  if (!["posted", "failed", "returned"].includes(kind)) back("ledger", { err: "invalid" });
  const { data, error } = await db.rpc("admin_payout_simulate", { p_caller: user.id, p_id: String(fd.get("id")), p_kind: kind });
  if (!error) await afterPayoutEvent(db, data as { status: string }).catch(() => null);
  back("ledger", error ? { err: errOf(error.message) } : { ok: `sim_${kind}` });
}

export async function runNow() {
  const { db } = await requireStaffCap("payouts.manage");
  const r = await runPayouts(db);
  back("overview", r.error ? { err: errOf(r.error) } : { ok: "ran", summary: `${r.claimed} claimed · ${r.submitted} sent · ${r.retry} retrying · ${r.failed} failed${r.skipped ? ` · ${r.skipped}` : ""}` });
}

export async function reconcile(fd: FormData) {
  const { user, db } = await requireStaffCap("reconcile");
  const { error } = await db.rpc("admin_payout_reconcile", { p_caller: user.id, p_id: String(fd.get("id")), p_state: String(fd.get("state")), p_note: String(fd.get("note") ?? "") });
  back("ledger", error ? { err: errOf(error.message) } : { ok: "reconciled" });
}

export async function saveThreshold(fd: FormData) {
  const { user, db } = await owner2fa("tax");
  const year = z.coerce.number().int().min(2020).max(2100).safeParse(fd.get("year"));
  const c = cents(fd.get("threshold"));
  if (!year.success || c == null) back("tax", { err: "invalid" });
  const { error } = await db.rpc("admin_tax_threshold_save", { p_caller: user.id, p_year: year.data, p_cents: c, p_verified: fd.get("verified") === "on", p_note: String(fd.get("note") ?? "").slice(0, 500) || "Owner-entered" });
  back("tax", error ? { err: errOf(error.message) } : { ok: "threshold", year: String(year.data) });
}
