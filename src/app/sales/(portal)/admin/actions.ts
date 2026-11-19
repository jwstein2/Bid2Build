"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesAdmin } from "@/lib/sales/server";
import type { SalesCap } from "@/lib/sales/caps";

/**
 * Admin Sales Hub actions. Each re-authorizes with requireSalesAdmin() (404 for anyone without the admin
 * hub), checks the capability the action needs, and calls an admin_sales_* database function, which
 * checks the caller's capabilities again and writes the audit log in the same transaction. Sales
 * Administrators can run the team; commission policy, adjustments and payouts stay with the platform
 * owner. Nothing here talks to Stripe or moves money: payouts are recorded, not sent.
 */

const PATH = "/sales/admin";
const ERRORS: Record<string, string> = {
  not_authorized: "Your role can't do that. Commission policy, adjustments and payouts are the platform owner's.",
  owner_only: "Only the platform owner can make someone a Sales Administrator or change an administrator.",
  cannot_edit_self: "You can't change your own team record. Ask the platform owner.",
  cannot_approve_own: "You can't approve or cancel your own pay. Another administrator or the owner has to.",
  owner_cannot_be_rep: "That email belongs to an owner account. Sales staff need their own email.",
  reason_required: "Add a short reason; it is kept in the audit log.",
  customer_not_found: "No Built2Bid account uses that email.",
  rep_not_found: "Pick an active sales team member.",
  customer_is_sales_staff: "That account belongs to sales staff, so it can't be a rep's customer.",
  policy_not_confirmed: "Confirm the commission policy (Policy tab) before approving statements.",
  already_approved: "That statement was already approved.",
  already_paid: "A payout was already recorded for that statement.",
  approve_first: "Approve the statement before recording its payout.",
  locked_after_approval: "Approved and paid lines can't be changed. A refund after payout is deducted automatically.",
  invalid: "Check the form and try again.",
  duplicate: "Someone with that email is already on the sales team.",
  invalid_zip: "Enter a 5-digit ZIP code.",
  already_joined: "That person already signed in, so they don't need an invite.",
  not_ready: "That box isn't ready to approve yet (it unlocks after the 30-day refund hold).",
  invalid_goal: "Enter a whole number of accounts.",
  invalid_tiers: "Check the accelerator tiers: sales counts and rates must both go up, rates 50% or less.",
  invalid_milestones: "Check the milestone rules: increasing account numbers, rates 0-20%, flat boxes before the first percentage box.",
  use_offboarding: "Use Offboard on the rep's management page to remove someone, so their records and pay are handled properly.",
};

function back(tab: string, result: { ok?: string; err?: string }): never {
  const q = new URLSearchParams({ tab, ...(result.ok ? { ok: result.ok } : {}), ...(result.err ? { err: ERRORS[result.err] ? result.err : "invalid" } : {}) });
  revalidatePath(PATH);
  redirect(`${PATH}?${q.toString()}`);
}

const code = (e: { message?: string; code?: string } | null) => {
  const m = e?.message ?? "";
  if (e?.code === "23505" || /duplicate key/.test(m)) return "duplicate";
  return Object.keys(ERRORS).find((k) => m.includes(k)) ?? "invalid";
};

async function need(cap: SalesCap, tab: string) {
  const a = await requireSalesAdmin();
  if (!a.has(cap)) back(tab, { err: "not_authorized" });
  return a;
}

const text = (max: number) => z.string().trim().max(max);

export async function saveRep(fd: FormData) {
  const { user, db } = await need("manage_reps", "team");
  const p = z.object({
    id: z.string().uuid().or(z.literal("")), email: z.string().trim().toLowerCase().email().max(320), full_name: text(120).min(1),
    phone: text(40), role: z.enum(["rep", "manager", "admin"]), sells: z.string().optional(), status: z.enum(["invited", "active", "suspended", "removed"]), payout_note: text(300),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("team", { err: "invalid" });
  const v = p.data;
  if (v.status === "removed") {
    // Removing someone goes through offboarding (leads, meetings, final pay). Keeping an already-offboarded record as is is fine.
    const { data: cur } = v.id ? await db.from("sales_reps").select("status").eq("id", v.id).maybeSingle() : { data: null };
    if ((cur as { status?: string } | null)?.status !== "removed") back("team", { err: "use_offboarding" });
  }
  const { error } = await db.rpc("admin_sales_member_save", { p_caller: user.id, p_id: v.id || null, p_email: v.email, p_full_name: v.full_name, p_phone: v.phone, p_role: v.role, p_status: v.status, p_payout_note: v.payout_note, p_sells: v.role !== "admin" || v.sells === "on" });
  if (error) back("team", { err: code(error) });
  back("team", { ok: v.id ? "Saved." : `Added ${v.email}. Send them to built2bid.org/sales to sign in with that email.` });
}

export async function assignCustomer(fd: FormData) {
  const { user, db } = await need("reassign_leads", "customers");
  const p = z.object({ email: z.string().trim().toLowerCase().email(), rep: z.string().uuid(), reason: text(300).min(3) }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("customers", { err: "invalid" });
  const { data, error } = await db.rpc("admin_sales_attribution_set", { p_caller: user.id, p_customer_email: p.data.email, p_rep: p.data.rep, p_reason: p.data.reason });
  if (error) back("customers", { err: code(error) });
  const action = (data as { action?: string })?.action;
  back("customers", { ok: action === "unchanged" ? "That customer is already with this rep." : action === "reassigned" ? "Customer reassigned. Commissions already created stay with the original rep." : "Customer assigned." });
}

export async function endAttribution(fd: FormData) {
  const { user, db } = await need("reassign_leads", "customers");
  const p = z.object({ user_id: z.string().uuid(), reason: text(300).min(3) }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("customers", { err: "reason_required" });
  const { error } = await db.rpc("admin_sales_attribution_end", { p_caller: user.id, p_user: p.data.user_id, p_reason: p.data.reason });
  if (error) back("customers", { err: code(error) });
  back("customers", { ok: "Attribution ended. No further commissions will be created for that customer." });
}

export async function adjustCommission(fd: FormData) {
  const { user, db } = await need("adjust_commissions", "commissions");
  const p = z.object({
    id: z.string().uuid(), status: z.enum(["pending", "earned", "ineligible", "canceled"]),
    amount: z.string().trim().regex(/^\d{0,6}(\.\d{1,2})?$/).or(z.literal("")), reason: text(300).min(3),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("commissions", { err: "invalid" });
  const cents = p.data.amount ? Math.round(Number(p.data.amount) * 100) : null;
  const { error } = await db.rpc("admin_sales_commission_set", { p_caller: user.id, p_id: p.data.id, p_status: p.data.status, p_amount_cents: cents, p_reason: p.data.reason });
  if (error) back("commissions", { err: code(error) });
  back("commissions", { ok: "Commission updated." });
}

export async function approveStatement(fd: FormData) {
  const { user, db } = await need("approve_commissions", "statements");
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) back("statements", { err: "invalid" });
  const { error } = await db.rpc("admin_sales_statement_approve", { p_caller: user.id, p_statement: id.data });
  if (error) back("statements", { err: code(error) });
  back("statements", { ok: "Statement approved. Pay it the usual way, then record the payout here." });
}

export async function recordPayout(fd: FormData) {
  const { user, db } = await need("payout_operations", "statements");
  const p = z.object({
    id: z.string().uuid(), method: z.enum(["ach", "check", "payroll", "paypal", "other"]), reference: text(200),
    paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("statements", { err: "invalid" });
  const { error } = await db.rpc("admin_sales_payout_record", { p_caller: user.id, p_statement: p.data.id, p_method: p.data.method, p_reference: p.data.reference, p_paid_on: p.data.paid_on });
  if (error) back("statements", { err: code(error) });
  back("statements", { ok: "Payout recorded. The rep sees it on their statement." });
}

export async function savePolicy(fd: FormData) {
  const { user, db } = await need("edit_commission_policies", "policy");
  const p = z.object({
    annual_basis: z.enum(["divide_12", "monthly_list", "full_payment"]), refund_policy: z.enum(["month_end_clawback", "hold_30_no_clawback", "never_reverse"]),
    value_scope: z.enum(["plan_seats", "all_items", "base_plan"]), commission_years: z.coerce.number().int().min(1).max(10),
    attribution_window_days: z.coerce.number().int().min(1).max(365), confirm: z.string().optional(),
    first_month_cancel: z.string().optional(), note: z.string().trim().max(500).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("policy", { err: "invalid" });
  const v = p.data;
  const { data, error } = await db.rpc("admin_sales_settings_save", { p_caller: user.id, p_annual_basis: v.annual_basis, p_refund_policy: v.refund_policy, p_value_scope: v.value_scope, p_commission_years: v.commission_years, p_attribution_window_days: v.attribution_window_days, p_confirm: v.confirm === "on",
    p_note: v.note || null, p_first_month_cancel: v.first_month_cancel === "on" });
  if (error) back("policy", { err: code(error) });
  const ver = (data as { version?: number } | null)?.version;
  back("policy", { ok: `${v.confirm === "on" ? "Policy saved and confirmed. Statements can now be approved." : "Policy saved."}${ver ? ` Rules in force: version ${ver}. Lines already recorded keep the version they were created under.` : ""}` });
}

export async function closeMonth() {
  const { user, db } = await need("approve_commissions", "statements");
  const { data, error } = await db.rpc("admin_sales_close_month", { p_caller: user.id });
  if (error) back("statements", { err: code(error) });
  const r = data as { earned?: number; statement_lines?: number; missed_anniversaries?: number };
  back("statements", { ok: `Month-end run: ${r.earned ?? 0} commissions earned, ${r.statement_lines ?? 0} lines added to statements, ${r.missed_anniversaries ?? 0} missed anniversaries marked.` });
}

export async function assignLeads(fd: FormData) {
  const { user, db } = await need("reassign_leads", "leads");
  const ids = fd.getAll("lead").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const rep = String(fd.get("rep") ?? "");
  if (ids.length === 0) back("leads", { err: "invalid" });
  const { data, error } = await db.rpc("admin_sales_crm_assign", { p_caller: user.id, p_leads: ids, p_rep: /^[0-9a-f-]{36}$/i.test(rep) ? rep : null });
  if (error) back("leads", { err: code(error) });
  back("leads", { ok: `${data} lead${data === 1 ? "" : "s"} updated.` });
}

export async function importLeads(fd: FormData) {
  const { user, db } = await need("reassign_leads", "leads");
  const { parseLeadRows } = await import("@/lib/sales/crm");
  const rows = parseLeadRows(String(fd.get("rows") ?? "").slice(0, 200_000));
  const rep = String(fd.get("rep") ?? "");
  if (rows.length === 0) back("leads", { err: "invalid" });
  const { data, error } = await db.rpc("admin_sales_crm_import", { p_caller: user.id, p_rows: rows, p_rep: /^[0-9a-f-]{36}$/i.test(rep) ? rep : null });
  if (error) back("leads", { err: code(error) });
  const r = data as { added: number; skipped: number };
  back("leads", { ok: `Added ${r.added} lead${r.added === 1 ? "" : "s"}${r.skipped ? `, skipped ${r.skipped} already on file` : ""}.` });
}

/** The weekly lead import's target: the agent searches within the radius of this ZIP for this trade. */
export async function saveLeadTarget(fd: FormData) {
  const { user, db } = await need("reassign_leads", "leads");
  const zip = String(fd.get("zip") ?? "").trim();
  if (!/^\d{5}$/.test(zip)) back("leads", { err: "invalid_zip" });
  const { error } = await db.rpc("admin_sales_import_target_save", {
    p_caller: user.id, p_zip: zip, p_trade: String(fd.get("trade") ?? "").slice(0, 40) || null,
    p_radius: Number(fd.get("radius")) || 50, p_count: Number(fd.get("count")) || 50, p_paused: fd.get("paused") === "on",
  });
  if (error) back("leads", { err: code(error) });
  back("leads", { ok: "Saved. The next weekly run will use this target." });
}

/**
 * A fresh invite link for a rep who hasn't signed in yet. The random token is shown to the owner once
 * (to copy or send); only its SHA-256 hash is stored. Opening it still requires signing in with the
 * invited email. Sending invite emails automatically stays off until approved.
 */
export async function createInvite(fd: FormData) {
  const { user, db } = await need("manage_reps", "team");
  const rep = String(fd.get("rep") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(rep)) back("team", { err: "invalid" });
  const { newInviteToken, INVITE_FLASH } = await import("@/lib/sales/invite");
  const t = newInviteToken();
  const { error } = await db.rpc("admin_sales_invite_create", { p_caller: user.id, p_rep: rep, p_token_hash: t.hash, p_days: 14 });
  if (error) back("team", { err: code(error) });
  revalidatePath(PATH);
  // The raw token rides in a short-lived, HTTP-only cookie scoped to this page, never in the address bar,
  // so it stays out of browser history, analytics and server/CDN logs.
  const { cookies } = await import("next/headers");
  (await cookies()).set(INVITE_FLASH, `${rep}.${t.token}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: PATH, maxAge: 120 });
  redirect(`${PATH}?${new URLSearchParams({ tab: "team", invite_rep: rep })}`);
}

export async function saveTeamGoal(fd: FormData) {
  const { user, db } = await need("set_team_goals", "overview");
  const p = z.object({ target: z.string().trim().max(6), floor: z.coerce.number().int().min(0).max(10000), note: text(300).optional(), mode: z.enum(["set", "auto"]) }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("overview", { err: "invalid_goal" });
  const target = p.data.mode === "auto" || p.data.target === "" ? null : Number(p.data.target);
  if (target != null && (!Number.isInteger(target) || target < 0)) back("overview", { err: "invalid_goal" });
  const { error } = await db.rpc("admin_sales_team_goal_set", { p_caller: user.id, p_target: target, p_floor: p.data.floor, p_note: p.data.note || null });
  if (error) back("overview", { err: code(error) });
  back("overview", { ok: target == null ? "Team goal is automatic again." : `This month's team goal is set to ${target}.` });
}

export async function approveMilestone(fd: FormData) {
  const { user, db } = await need("approve_commissions", "commissions");
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) back("commissions", { err: "invalid" });
  const { error } = await db.rpc("admin_sales_milestone_approve", { p_caller: user.id, p_award: id.data });
  if (error) back("commissions", { err: code(error) });
  back("commissions", { ok: "Bonus approved. It goes on the rep's next month-end statement." });
}

export async function voidMilestone(fd: FormData) {
  const { user, db } = await need("approve_commissions", "commissions");
  const p = z.object({ id: z.string().uuid(), reason: text(300).min(1) }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("commissions", { err: "reason_required" });
  const { error } = await db.rpc("admin_sales_milestone_void", { p_caller: user.id, p_award: p.data.id, p_reason: p.data.reason });
  if (error) back("commissions", { err: code(error) });
  back("commissions", { ok: "Box canceled. The reason is in the audit log." });
}

export async function saveMilestoneRules(fd: FormData) {
  const { user, db } = await need("edit_commission_policies", "policy");
  const num = (k: string) => Number(fd.get(k) ?? NaN);
  const every = num("every"), minDollars = num("min_dollars");
  const rates = [0, 1, 2, 3].map((i) => ({ from: num(`rate_from_${i}`), pct: num(`rate_pct_${i}`) })).filter((r) => Number.isFinite(r.from) && r.from > 0 && Number.isFinite(r.pct));
  const flat = [0, 1, 2].map((i) => ({ at: num(`flat_at_${i}`), cents: Math.round(num(`flat_dollars_${i}`) * 100), badge: String(fd.get(`flat_badge_${i}`) ?? "").trim().slice(0, 60) || undefined }))
    .filter((f) => Number.isFinite(f.at) && f.at > 0 && Number.isFinite(f.cents));
  if (!Number.isInteger(every) || !Number.isFinite(minDollars) || rates.length === 0) back("policy", { err: "invalid_milestones" });
  const { data, error } = await db.rpc("admin_sales_milestone_rules_save", { p_caller: user.id, p_every: every, p_rates: rates, p_min_cents: Math.round(minDollars * 100), p_flat: flat, p_note: text(500).parse(fd.get("note") ?? "") || null });
  if (error) back("policy", { err: code(error) });
  back("policy", { ok: `Milestone rules saved (policy version ${(data as { version?: number } | null)?.version ?? "updated"}). Boxes already created keep their rules.` });
}

/** Accelerator tiers and the on/off switch (owner only; each save is a new policy version). */
export async function saveAcceleratorRules(fd: FormData) {
  const { user, db } = await need("edit_commission_policies", "recognition");
  const tiers = [0, 1, 2, 3, 4, 5].map((i) => ({ from: Number(fd.get(`tier_from_${i}`) ?? NaN), pct: Number(fd.get(`tier_pct_${i}`) ?? NaN) }))
    .filter((t) => Number.isInteger(t.from) && t.from > 0 && Number.isFinite(t.pct) && t.pct > 0);
  if (tiers.length === 0) back("recognition", { err: "invalid_tiers" });
  const enabled = fd.get("enabled") === "on";
  const { data, error } = await db.rpc("admin_sales_accelerator_rules_save", { p_caller: user.id, p_enabled: enabled, p_tiers: tiers, p_note: text(500).parse(fd.get("note") ?? "") || null });
  if (error) back("recognition", { err: code(error) });
  back("recognition", { ok: `Accelerator ${enabled ? "on" : "off"} (policy version ${(data as { version?: number } | null)?.version ?? "updated"}). Finalized months keep the rates they were finalized with.` });
}

/** Note that the owner congratulated someone. Sending the message itself comes with the approved email step. */
export async function congratulate(fd: FormData) {
  const { user, db } = await need("view_all_reps", "recognition");
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) back("recognition", { err: "invalid" });
  const { error } = await db.rpc("admin_sales_achievement_congratulate", { p_caller: user.id, p_id: id.data });
  if (error) back("recognition", { err: code(error) });
  back("recognition", { ok: "Marked as congratulated." });
}
