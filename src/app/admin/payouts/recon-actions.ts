"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hasTwoStep, requireStaffCap } from "@/lib/staff/server";
import { getStripe } from "@/lib/billing/stripe";
import { serverEnv } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { runReconciliation } from "@/lib/reconciliation/run";
import { bankAccounts, platformConnection } from "@/lib/quickbooks/platform";

/**
 * Reconciliation controls. "Reconcile now" needs the reconcile capability (owner, finance). Standing authorizations
 * (automatic approval, automatic QuickBooks entries) need the owner with a two-step session; the database re-checks.
 */
const back = (q: Record<string, string>): never => { revalidatePath("/admin/payouts"); redirect(`/admin/payouts?${new URLSearchParams({ tab: "reconciliation", ...q })}`); };

export async function reconcileNow() {
  const { user, db } = await requireStaffCap("reconcile");
  const stripe = serverEnv().stripeSecretKey ? getStripe() : null;
  const r = await runReconciliation(db, { kind: "manual", caller: user.id, stripe }).catch((e) => { logError("recon.manual", e); return null; });
  if (!r) back({ err: "recon_failed" });
  if (r!.skipped) back({ err: r!.skipped === "busy" ? "recon_busy" : "recon_not_installed" });
  back({ ok: "recon_ran", summary: r!.status === "passed" ? "Everything reconciles." : r!.status === "failed" ? "The run stopped; see the last run below." : `${r!.findings ?? 0} item(s) found; see Exceptions below.` });
}

export async function saveReconSettings(fd: FormData) {
  const { user, db } = await requireStaffCap("payouts.activate");
  if (!(await hasTwoStep())) back({ err: "two_step" });
  const dollars = Number(String(fd.get("limit") ?? "").replace(/[$,\s]/g, ""));
  const p: Record<string, unknown> = {
    auto_approve_statements: fd.get("auto_approve") === "on",
    qb_auto_bills: fd.get("qb_auto_bills") === "on",
    qb_record_provider_payouts: fd.get("qb_provider") === "on",
    confirm: fd.get("confirm") === "on",
  };
  if (Number.isFinite(dollars) && dollars >= 1) p.auto_approve_limit_cents = Math.round(dollars * 100);
  const day = Number(fd.get("from_day"));
  if (Number.isInteger(day) && day >= 1 && day <= 28) p.auto_approve_from_day = day;
  const acct = String(fd.get("qb_payment_account") ?? "");
  if (/^\d{1,32}$/.test(acct)) {
    const c = await platformConnection(db);
    const found = c ? (await bankAccounts(db, c).catch(() => [])).find((a) => a.id === acct) : null;
    if (found) { p.qb_payment_account_id = found.id; p.qb_payment_account_name = found.name; }
  }
  const { error } = await db.rpc("admin_recon_settings_save", { p_caller: user.id, p });
  back(error ? { err: /confirm_required/.test(error.message) ? "confirm" : /owner_only/.test(error.message) ? "owner_only" : "invalid" } : { ok: "recon_settings" });
}

export async function acknowledgeException(fd: FormData) {
  const { user, db } = await requireStaffCap("reconcile");
  const id = String(fd.get("id") ?? "");
  const note = String(fd.get("note") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) back({ err: "invalid" });
  if (note.length < 5) back({ err: "note_required" });
  const { error } = await db.rpc("admin_recon_exception_ack", { p_caller: user.id, p_id: id, p_note: note });
  back(error ? { err: "invalid" } : { ok: "recon_ack" });
}
