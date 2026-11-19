"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/server";

/**
 * Sales Hub owner actions. Each re-authorizes with requireAdmin() (404 for anyone else) and calls an
 * admin_sales_* database function, which checks is_admin(caller) again and writes the audit log in the
 * same transaction. Nothing here talks to Stripe or moves money: payouts are recorded, not sent.
 */

const PATH = "/admin/sales-hub";
const ERRORS: Record<string, string> = {
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
  invalid_milestones: "Check the milestone rules: increasing account numbers, rates 0-20%, flat boxes before the first percentage box.",
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

const text = (max: number) => z.string().trim().max(max);

export async function saveRep(fd: FormData) {
  const { user, db } = await requireAdmin();
  const p = z.object({
    id: z.string().uuid().or(z.literal("")), email: z.string().trim().toLowerCase().email().max(320), full_name: text(120).min(1),
    phone: text(40), role: z.enum(["rep", "manager"]), status: z.enum(["invited", "active", "suspended", "removed"]), payout_note: text(300),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("team", { err: "invalid" });
  const v = p.data;
  const { error } = await db.rpc("admin_sales_rep_save", { p_caller: user.id, p_id: v.id || null, p_email: v.email, p_full_name: v.full_name, p_phone: v.phone, p_role: v.role, p_status: v.status, p_payout_note: v.payout_note });
  if (error) back("team", { err: code(error) });
  back("team", { ok: v.id ? "Saved." : `Added ${v.email}. Send them to built2bid.org/sales to sign in with that email.` });
}

export async function assignCustomer(fd: FormData) {
  const { user, db } = await requireAdmin();
  const p = z.object({ email: z.string().trim().toLowerCase().email(), rep: z.string().uuid(), reason: text(300).min(3) }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("customers", { err: "invalid" });
  const { data, error } = await db.rpc("admin_sales_attribution_set", { p_caller: user.id, p_customer_email: p.data.email, p_rep: p.data.rep, p_reason: p.data.reason });
  if (error) back("customers", { err: code(error) });
  const action = (data as { action?: string })?.action;
  back("customers", { ok: action === "unchanged" ? "That customer is already with this rep." : action === "reassigned" ? "Customer reassigned. Commissions already created stay with the original rep." : "Customer assigned." });
}

export async function endAttribution(fd: FormData) {
  const { user, db } = await requireAdmin();
  const p = z.object({ user_id: z.string().uuid(), reason: text(300).min(3) }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("customers", { err: "reason_required" });
  const { error } = await db.rpc("admin_sales_attribution_end", { p_caller: user.id, p_user: p.data.user_id, p_reason: p.data.reason });
  if (error) back("customers", { err: code(error) });
  back("customers", { ok: "Attribution ended. No further commissions will be created for that customer." });
}

export async function adjustCommission(fd: FormData) {
  const { user, db } = await requireAdmin();
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
  const { user, db } = await requireAdmin();
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) back("statements", { err: "invalid" });
  const { error } = await db.rpc("admin_sales_statement_approve", { p_caller: user.id, p_statement: id.data });
  if (error) back("statements", { err: code(error) });
  back("statements", { ok: "Statement approved. Pay it the usual way, then record the payout here." });
}

export async function recordPayout(fd: FormData) {
  const { user, db } = await requireAdmin();
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
  const { user, db } = await requireAdmin();
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
  const { user, db } = await requireAdmin();
  const { data, error } = await db.rpc("admin_sales_close_month", { p_caller: user.id });
  if (error) back("statements", { err: code(error) });
  const r = data as { earned?: number; statement_lines?: number; missed_anniversaries?: number };
  back("statements", { ok: `Month-end run: ${r.earned ?? 0} commissions earned, ${r.statement_lines ?? 0} lines added to statements, ${r.missed_anniversaries ?? 0} missed anniversaries marked.` });
}

export async function assignLeads(fd: FormData) {
  const { user, db } = await requireAdmin();
  const ids = fd.getAll("lead").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const rep = String(fd.get("rep") ?? "");
  if (ids.length === 0) back("leads", { err: "invalid" });
  const { data, error } = await db.rpc("admin_sales_crm_assign", { p_caller: user.id, p_leads: ids, p_rep: /^[0-9a-f-]{36}$/i.test(rep) ? rep : null });
  if (error) back("leads", { err: code(error) });
  back("leads", { ok: `${data} lead${data === 1 ? "" : "s"} updated.` });
}

export async function importLeads(fd: FormData) {
  const { user, db } = await requireAdmin();
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
  const { user, db } = await requireAdmin();
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
  const { user, db } = await requireAdmin();
  const rep = String(fd.get("rep") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(rep)) back("team", { err: "invalid" });
  const { newInviteToken } = await import("@/lib/sales/invite");
  const t = newInviteToken();
  const { error } = await db.rpc("admin_sales_invite_create", { p_caller: user.id, p_rep: rep, p_token_hash: t.hash, p_days: 14 });
  if (error) back("team", { err: code(error) });
  revalidatePath(PATH);
  redirect(`${PATH}?${new URLSearchParams({ tab: "team", invite: t.token, invite_rep: rep })}`);
}

export async function saveTeamGoal(fd: FormData) {
  const { user, db } = await requireAdmin();
  const p = z.object({ target: z.string().trim().max(6), floor: z.coerce.number().int().min(0).max(10000), note: text(300).optional(), mode: z.enum(["set", "auto"]) }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("overview", { err: "invalid_goal" });
  const target = p.data.mode === "auto" || p.data.target === "" ? null : Number(p.data.target);
  if (target != null && (!Number.isInteger(target) || target < 0)) back("overview", { err: "invalid_goal" });
  const { error } = await db.rpc("admin_sales_team_goal_set", { p_caller: user.id, p_target: target, p_floor: p.data.floor, p_note: p.data.note || null });
  if (error) back("overview", { err: code(error) });
  back("overview", { ok: target == null ? "Team goal is automatic again." : `This month's team goal is set to ${target}.` });
}

export async function approveMilestone(fd: FormData) {
  const { user, db } = await requireAdmin();
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) back("commissions", { err: "invalid" });
  const { error } = await db.rpc("admin_sales_milestone_approve", { p_caller: user.id, p_award: id.data });
  if (error) back("commissions", { err: code(error) });
  back("commissions", { ok: "Bonus approved. It goes on the rep's next month-end statement." });
}

export async function voidMilestone(fd: FormData) {
  const { user, db } = await requireAdmin();
  const p = z.object({ id: z.string().uuid(), reason: text(300).min(1) }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("commissions", { err: "reason_required" });
  const { error } = await db.rpc("admin_sales_milestone_void", { p_caller: user.id, p_award: p.data.id, p_reason: p.data.reason });
  if (error) back("commissions", { err: code(error) });
  back("commissions", { ok: "Box canceled. The reason is in the audit log." });
}

export async function saveMilestoneRules(fd: FormData) {
  const { user, db } = await requireAdmin();
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
