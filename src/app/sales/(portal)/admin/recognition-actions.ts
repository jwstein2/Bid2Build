"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesAdmin } from "@/lib/sales/server";
import type { SalesCap } from "@/lib/sales/caps";
import { founderEmailConfig } from "@/lib/email/outbox";
import { sendCongrats } from "@/lib/sales/congrats-email";
import { RECOGNITION_ERRORS, REWARD_CATEGORIES, TAX_LABELS } from "@/lib/sales/preferences";

/**
 * V8.4 P1 recognition actions: owner congratulations, customer success notes, the reward catalog and
 * award records. Each re-checks the caller here and again in the database. Nothing here buys a reward
 * or moves money; an authorized cash reward becomes an earned ledger line for the normal statement.
 */

const ERRORS = RECOGNITION_ERRORS;

function back(result: { ok?: string; err?: string }, tab = "recognition"): never {
  const q = new URLSearchParams({ tab, ...(result.ok ? { ok: result.ok } : {}), ...(result.err ? { err: ERRORS[result.err] ? result.err : "invalid" } : {}) });
  revalidatePath("/sales/admin");
  redirect(`/sales/admin?${q.toString()}`);
}

const code = (e: { message?: string } | null) => Object.keys(ERRORS).find((k) => (e?.message ?? "").includes(k)) ?? "invalid";

async function need(cap: SalesCap) {
  const a = await requireSalesAdmin();
  if (!a.has(cap)) back({ err: "not_authorized" });
  return a;
}

const uuid = z.string().uuid();
const str = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max);
const cents = (fd: FormData, k: string) => { const n = Number(fd.get(k)); return Number.isFinite(n) && n >= 0 && n <= 10000 ? Math.round(n * 100) : NaN; };

export async function saveCongratsSettings(fd: FormData) {
  const { user, db } = await need("edit_commission_policies");
  const enabled = fd.get("enabled") === "on";
  const { error } = await db.rpc("admin_sales_congrats_settings_save", { p_caller: user.id, p_enabled: enabled, p_subject: str(fd, "subject", 200), p_body: str(fd, "body", 5000) });
  if (error) back({ err: code(error) });
  back({ ok: enabled ? "Congratulation emails are on. Each one still waits for your approval." : "Congratulation emails are off. No drafts are created." });
}

/** Approve (with edits) and send one congratulations email from the verified founder address. */
export async function sendCongratsEmail(fd: FormData) {
  const { user, db } = await need("edit_commission_policies");
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) back({ err: "invalid" });
  const cfg = founderEmailConfig();
  if (!cfg.enabled) back({ err: "send_failed" });
  const { data, error } = await db.rpc("admin_sales_congrats_claim", { p_caller: user.id, p_id: id.data, p_subject: str(fd, "subject", 200), p_body: str(fd, "body", 5000) });
  if (error) back({ err: code(error) });
  const m = data as { id: string; to?: string; subject?: string; body?: string; skipped?: boolean };
  if (m.skipped || !m.to) back({ ok: "Skipped: that rep turned off congratulation emails." });
  const res = await sendCongrats(cfg, { id: m.id, to: m.to, subject: m.subject!, body: m.body! });
  await db.rpc("admin_sales_congrats_result", { p_caller: user.id, p_id: m.id, p_ok: res.ok, p_message_id: res.ok ? res.id : null, p_error: res.ok ? null : res.error });
  if (!res.ok) back({ err: "send_failed" });
  back({ ok: "Congratulations sent." });
}

export async function skipCongratsEmail(fd: FormData) {
  const { user, db } = await need("edit_commission_policies");
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) back({ err: "invalid" });
  const { error } = await db.rpc("admin_sales_congrats_skip", { p_caller: user.id, p_id: id.data });
  if (error) back({ err: code(error) });
  back({ ok: "Skipped. Nothing was sent." });
}

export async function markSuccessCongratulated(fd: FormData) {
  const { user, db } = await need("view_all_reps");
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) back({ err: "invalid" });
  const { error } = await db.rpc("admin_sales_success_congratulate", { p_caller: user.id, p_id: id.data });
  if (error) back({ err: code(error) });
  back({ ok: "Marked as congratulated." });
}

export async function saveRecognitionNote(fd: FormData) {
  const { user, db } = await need("view_all_reps");
  const id = uuid.safeParse(fd.get("id"));
  const kind = fd.get("kind") === "achievement" ? "achievement" : "success";
  if (!id.success) back({ err: "invalid" });
  const { error } = await db.rpc("admin_sales_recognition_note", { p_caller: user.id, p_kind: kind, p_id: id.data, p_note: str(fd, "note", 1000) });
  if (error) back({ err: code(error) });
  back({ ok: "Private note saved." });
}

export async function saveReward(fd: FormData) {
  const { user, db } = await need("edit_commission_policies");
  const id = fd.get("id") ? uuid.safeParse(fd.get("id")) : { success: true as const, data: null };
  const category = str(fd, "category", 40), tax = category === "cash" ? "taxable_cash" : category === "gift_card" ? "taxable_cash_equivalent" : str(fd, "tax", 40);
  const value = cents(fd, "value"), cost = fd.get("cost") ? cents(fd, "cost") : value;
  if (!id.success || !str(fd, "name", 120) || !(category in REWARD_CATEGORIES) || !(tax in TAX_LABELS) || !Number.isFinite(value) || !Number.isFinite(cost)) back({ err: "invalid" });
  const status = ["draft", "active", "paused", "retired"].includes(String(fd.get("status"))) ? String(fd.get("status")) : "draft";
  const { error } = await db.rpc("admin_sales_reward_save", {
    p_caller: user.id, p_id: id.data, p_name: str(fd, "name", 120), p_description: str(fd, "description", 1000), p_category: category,
    p_eligibility: str(fd, "eligibility", 500), p_value_cents: value, p_cost_cents: cost, p_redemption: str(fd, "redemption", 200),
    p_tax: tax, p_requires_approval: true, p_status: status,
  });
  if (error) back({ err: code(error) });
  back({ ok: status === "active" ? "Reward saved and visible to reps." : "Reward saved." });
}

export async function proposeAward(fd: FormData) {
  const { user, db } = await need("approve_commissions");
  const rep = uuid.safeParse(fd.get("rep_id")), reward = uuid.safeParse(fd.get("reward_id"));
  const success = fd.get("success_id") ? uuid.safeParse(fd.get("success_id")) : null;
  if (!rep.success || !reward.success || (success && !success.success)) back({ err: "invalid" });
  const { error } = await db.rpc("admin_sales_award_propose", {
    p_caller: user.id, p_rep: rep.data, p_reward: reward.data, p_reason: str(fd, "reason", 300), p_achievement: null,
    p_success: success?.data ?? null, p_value_cents: null,
  });
  if (error) back({ err: code(error) });
  back({ ok: "Reward proposed. The owner authorizes it before anything is bought or paid." });
}

export async function setAward(fd: FormData) {
  const { user, db } = await need("edit_commission_policies");
  const id = uuid.safeParse(fd.get("id"));
  const status = String(fd.get("status"));
  if (!id.success || !["authorized", "ordered", "delivered", "canceled"].includes(status)) back({ err: "invalid" });
  const { data, error } = await db.rpc("admin_sales_award_set", { p_caller: user.id, p_id: id.data, p_status: status, p_note: str(fd, "note", 1000) });
  if (error) back({ err: code(error) });
  const line = (data as { commission_id?: string | null } | null)?.commission_id;
  back({ ok: line ? "Authorized. The cash reward is an earned line on the next statement." : `Award ${status}.` });
}

/** Approved reassignment of a client session to another free rep. Attribution and commissions stay with the original rep. */
export async function reassignBooking(fd: FormData) {
  const { user, db } = await need("reassign_leads");
  const id = uuid.safeParse(fd.get("id")), rep = uuid.safeParse(fd.get("rep_id"));
  if (!id.success || !rep.success) back({ err: "invalid" }, "overview");
  const { data, error } = await db.rpc("admin_sales_booking_reassign", { p_caller: user.id, p_booking: id.data, p_rep: rep.data });
  if (error) back({ err: /rep_busy/.test(error.message) ? "rep_busy" : code(error) }, "overview");
  const r = data as { from_rep: string; to_rep: string; google_event_id: string | null };
  const { deleteEvent } = await import("@/lib/sales/google");
  await deleteEvent(db, r.from_rep, r.google_event_id);
  back({ ok: "Session reassigned. The new rep sees it on their calendar; the original rep keeps the attribution." }, "overview");
}
