"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesAdmin } from "@/lib/sales/server";
import type { SalesCap } from "@/lib/sales/caps";
import { COMP_ERRORS } from "@/lib/sales/compensation";

/**
 * Compensation V3 admin actions (Compensation & payroll tab). Each re-authorizes, checks the capability,
 * and calls an admin_sales_* database function that checks again and writes the audit trail. None of them
 * can change an award that was already earned, and none moves money.
 */
const TAB = "compensation";

function back(result: { ok?: string; err?: string }): never {
  const q = new URLSearchParams({ tab: TAB, ...(result.ok ? { ok: result.ok } : {}), ...(result.err ? { err: `comp_${COMP_ERRORS[result.err] ? result.err : "invalid"}` } : {}) });
  revalidatePath("/sales/admin");
  redirect(`/sales/admin?${q.toString()}`);
}
const code = (e: { message?: string } | null) => Object.keys(COMP_ERRORS).find((k) => (e?.message ?? "").includes(k)) ?? "invalid";
async function need(cap: SalesCap) {
  const a = await requireSalesAdmin();
  if (!a.has(cap)) back({ err: "not_authorized" });
  return a;
}
const note = z.string().trim().min(3).max(500);

export async function saveMilestoneModel(fd: FormData) {
  const { user, db } = await need("edit_commission_policies");
  const p = z.object({ model: z.enum(["v2_window", "v3_active_mrr"]), qualification: z.enum(["first_payment", "second_cycle"]), note }).safeParse(Object.fromEntries(fd));
  if (!p.success) back({ err: "reason_required" });
  const { error } = await db.rpc("admin_sales_milestone_model_save", { p_caller: user.id, p_model: p.data.model, p_qualification: p.data.qualification, p_note: p.data.note });
  if (error) back({ err: code(error) });
  back({ ok: "Milestone rules saved as a new policy version. They apply to milestones reached from now on." });
}

export async function setProgram(fd: FormData) {
  const { user, db } = await need("edit_commission_policies");
  const p = z.object({ key: z.enum(["milestone_bonus", "randomized_activity_bonus"]), enabled: z.enum(["on", "off"]), note }).safeParse(Object.fromEntries(fd));
  if (!p.success) back({ err: "reason_required" });
  const { error } = await db.rpc("admin_sales_program_set", { p_caller: user.id, p_key: p.data.key, p_enabled: p.data.enabled === "on", p_note: p.data.note });
  if (error) back({ err: code(error) });
  back({ ok: p.data.enabled === "on" ? "Program turned on." : "Program turned off for the future. Anything already earned stands." });
}

export async function emergencyProgram(fd: FormData) {
  const p = z.object({ key: z.enum(["milestone_bonus", "randomized_activity_bonus"]), stop: z.enum(["on", "off"]), reason: note }).safeParse(Object.fromEntries(fd));
  if (!p.success) back({ err: "reason_required" });
  const { user, db } = await need(p.data.stop === "on" ? "approve_commissions" : "edit_commission_policies");
  const { error } = await db.rpc("admin_sales_program_emergency", { p_caller: user.id, p_key: p.data.key, p_stop: p.data.stop === "on", p_reason: p.data.reason });
  if (error) back({ err: code(error) });
  back({ ok: p.data.stop === "on" ? "Emergency stop recorded. The program is off until the owner clears it." : "Emergency stop cleared." });
}

export async function saveJurisdiction(fd: FormData) {
  const { user, db } = await need("edit_commission_policies");
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const p = z.object({
    key: z.enum(["milestone_bonus", "randomized_activity_bonus"]), state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/), locality: z.string().trim().max(120),
    status: z.enum(["approved", "not_approved", "prohibited"]), legal_reference: z.string().trim().max(300), reviewed_by: z.string().trim().max(120),
    effective_from: date, expires_on: date.or(z.literal("")), notes: z.string().trim().max(600),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) back({ err: "invalid" });
  const v = p.data;
  const { error } = await db.rpc("admin_sales_jurisdiction_save", {
    p_caller: user.id, p_key: v.key, p_state: v.state, p_locality: v.locality || null, p_status: v.status, p_legal_reference: v.legal_reference || null,
    p_reviewed_by: v.reviewed_by || null, p_effective_from: v.effective_from, p_expires_on: v.expires_on || null, p_notes: v.notes || null,
  });
  if (error) back({ err: code(error) });
  back({ ok: "Jurisdiction decision recorded." });
}

export async function revokeJurisdiction(fd: FormData) {
  const { user, db } = await need("edit_commission_policies");
  const p = z.object({ id: z.string().uuid(), reason: note }).safeParse(Object.fromEntries(fd));
  if (!p.success) back({ err: "reason_required" });
  const { error } = await db.rpc("admin_sales_jurisdiction_revoke", { p_caller: user.id, p_id: p.data.id, p_reason: p.data.reason });
  if (error) back({ err: code(error) });
  back({ ok: "Jurisdiction decision revoked." });
}

export async function saveWorkLocation(fd: FormData) {
  const { user, db } = await need("manage_reps");
  const p = z.object({ rep: z.string().uuid(), state: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/), locality: z.string().trim().max(120) }).safeParse(Object.fromEntries(fd));
  if (!p.success) back({ err: "invalid" });
  const { error } = await db.rpc("admin_sales_rep_work_location", { p_caller: user.id, p_rep: p.data.rep, p_state: p.data.state || null, p_locality: p.data.locality || null });
  if (error) back({ err: code(error) });
  back({ ok: "Work location saved." });
}

export async function resolveDispute(fd: FormData) {
  const { user, db } = await need("adjust_commissions");
  const p = z.object({
    id: z.string().uuid(), outcome: z.enum(["upheld", "denied"]), resolution: z.string().trim().min(3).max(1000),
    adjustment: z.string().trim().regex(/^\d{0,6}(\.\d{1,2})?$/).or(z.literal("")),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) back({ err: "reason_required" });
  const cents = p.data.adjustment ? Math.round(Number(p.data.adjustment) * 100) : null;
  const { error } = await db.rpc("admin_sales_milestone_dispute_resolve", { p_caller: user.id, p_dispute: p.data.id, p_outcome: p.data.outcome, p_resolution: p.data.resolution, p_adjustment_cents: cents || null });
  if (error) back({ err: code(error) });
  back({ ok: cents ? "Dispute upheld. The adjustment is a separate bonus line on the next statement." : "Dispute resolved." });
}
