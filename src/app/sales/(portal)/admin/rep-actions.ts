"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesAdmin } from "@/lib/sales/server";
import type { SalesCap } from "@/lib/sales/caps";
import { site } from "@/lib/site";
import { ADMIN_LEAD_ERRORS, LEAD_PLANS, listField, REASON_CATEGORIES } from "@/lib/sales/leads-admin";

/**
 * V8.6 rep management: invitations, lead allocation, access, offboarding and reactivation. Every call is
 * re-checked in the database (sales_manage_guard: administrators are the owner's to change, nobody but
 * the owner changes their own record) and audited there. Nothing here sends anything unless invitation
 * emails are switched on (SALES_INVITE_EMAILS=on), and nothing changes earned commission.
 */

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const code = (e: { message?: string } | null) => Object.keys(ADMIN_LEAD_ERRORS).find((k) => (e?.message ?? "").includes(k)) ?? "invalid";

function back(rep: string, result: { ok?: string; err?: string }, extra: Record<string, string> = {}, to: "manage" | "team" = "manage"): never {
  const q = new URLSearchParams({ ...(to === "team" ? { tab: "team" } : {}), ...(result.ok ? { ok: result.ok } : {}), ...(result.err ? { err: ADMIN_LEAD_ERRORS[result.err] ? result.err : "invalid" } : {}), ...extra });
  revalidatePath("/sales/admin");
  revalidatePath(`/sales/admin/reps/${rep}/manage`);
  redirect(to === "team" ? `/sales/admin?${q}` : `/sales/admin/reps/${rep}/manage?${q}`);
}

async function need(cap: SalesCap, fd: FormData) {
  const rep = String(fd.get("rep") ?? "");
  if (!uuidRe.test(rep)) redirect("/sales/admin?tab=team");
  const a = await requireSalesAdmin();
  if (!a.has(cap)) back(rep, { err: "not_authorized" });
  return { ...a, rep };
}

/** New invite link; emailed only when invitation emails are on. The link is shown once either way. */
export async function sendInvite(fd: FormData) {
  const { user, db, rep } = await need("manage_reps", fd);
  const to = fd.get("to") === "team" ? "team" : "manage";
  const { newInviteToken } = await import("@/lib/sales/invite");
  const t = newInviteToken();
  const { data, error } = await db.rpc("admin_sales_invite_resend", { p_caller: user.id, p_rep: rep, p_token_hash: t.hash });
  if (error) back(rep, { err: code(error) }, {}, to);
  const inv = data as { id: string; expires_at: string; email: string; full_name: string };
  const link = new URL(`/sales/invite/${t.token}`, site.url).toString();
  const { inviteEmailsOn, inviteText, sendInviteEmail } = await import("@/lib/sales/invite-email");
  if (!inviteEmailsOn()) back(rep, { ok: "New invite link made. Copy it and send it yourself (invitation emails are off)." }, { invite: t.token, invite_rep: rep }, to);
  const expires = new Date(inv.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Chicago" });
  const msg = inviteText(inv.full_name.split(" ")[0] || "there", link, expires);
  const res = await sendInviteEmail({ inviteId: inv.id, to: inv.email, ...msg });
  await db.rpc("admin_sales_invite_sent", { p_caller: user.id, p_invite: inv.id, p_ok: res.ok, p_message_id: res.ok ? res.id : null, p_error: res.ok ? null : res.error });
  if (!res.ok) back(rep, { err: "send_failed" }, { invite: t.token, invite_rep: rep }, to);
  back(rep, { ok: `Invitation emailed to ${inv.email}. The email provider accepted it; delivery shows here once it's confirmed.` }, {}, to);
}

export async function revokeInvite(fd: FormData) {
  const { user, db, rep } = await need("manage_reps", fd);
  const { error } = await db.rpc("admin_sales_invite_revoke", { p_caller: user.id, p_rep: rep });
  if (error) back(rep, { err: code(error) });
  back(rep, { ok: "Outstanding invitation turned off. The link no longer works." });
}

export async function saveAllocation(fd: FormData) {
  const { user, db, rep } = await need("manage_reps", fd);
  const auto = ["default", "on", "off"].includes(String(fd.get("auto"))) ? String(fd.get("auto")) : "default";
  const paused = fd.get("paused") === "on";
  const { error } = await db.rpc("admin_sales_rep_allocation_save", {
    p_caller: user.id, p_rep: rep, p_paused: paused, p_note: String(fd.get("note") ?? "").slice(0, 300) || null, p_auto: auto,
    p_states: listField(fd.get("states"), "state"), p_trades: listField(fd.get("trades"), "trade"),
  });
  if (error) back(rep, { err: code(error) });
  back(rep, { ok: paused ? "Lead allocation paused. Their current leads stay with them." : "Lead allocation saved." });
}

export async function setAccess(fd: FormData) {
  const { user, db, rep } = await need("manage_reps", fd);
  const action = fd.get("action") === "restore" ? "restore" : "suspend";
  const { data, error } = await db.rpc("admin_sales_rep_access", { p_caller: user.id, p_rep: rep, p_action: action, p_reason: String(fd.get("reason") ?? "").slice(0, 300), p_sign_out: fd.get("sign_out") === "on" });
  if (error) back(rep, { err: code(error) });
  const n = (data as { signed_out_sessions?: number } | null)?.signed_out_sessions ?? 0;
  back(rep, { ok: action === "suspend" ? `Access suspended. They can't open the Sales Hub and get no new leads.${n ? ` Signed out of ${n} session${n === 1 ? "" : "s"}.` : ""}` : "Access restored." });
}

const OffboardStart = z.object({
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason_category: z.enum(Object.keys(REASON_CATEGORIES) as [string, ...string[]]),
  admin_notes: z.string().trim().max(4000).optional(), access_end: z.enum(["now", "on_completion"]), lead_plan: z.enum(Object.keys(LEAD_PLANS) as [string, ...string[]]),
});

export async function startOffboarding(fd: FormData) {
  const { user, db, rep } = await need("manage_reps", fd);
  const p = OffboardStart.safeParse(Object.fromEntries(fd));
  if (!p.success) back(rep, { err: "invalid" });
  if (fd.get("confirm") !== "on") back(rep, { err: "invalid" });
  const { error } = await db.rpc("admin_sales_offboarding_start", { p_caller: user.id, p_rep: rep, p: { ...p.data, sign_out: fd.get("sign_out") === "on" } });
  if (error) back(rep, { err: code(error) });
  back(rep, { ok: "Offboarding started. They get no new leads. Work through the checklist below, then finish." });
}

export async function updateOffboarding(fd: FormData) {
  const { user, db, rep } = await need("manage_reps", fd);
  const id = z.string().regex(uuidRe).safeParse(fd.get("id"));
  if (!id.success) back(rep, { err: "invalid" });
  const pick = (k: string, allowed: string[]) => (allowed.includes(String(fd.get(k))) ? String(fd.get(k)) : undefined);
  const p = {
    effective_date: /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("effective_date"))) ? String(fd.get("effective_date")) : undefined,
    reason_category: pick("reason_category", Object.keys(REASON_CATEGORIES)), lead_plan: pick("lead_plan", Object.keys(LEAD_PLANS)),
    admin_notes: String(fd.get("admin_notes") ?? "").slice(0, 4000), meetings_note: String(fd.get("meetings_note") ?? "").slice(0, 1000),
    commission_review: pick("commission_review", ["pending", "reviewed"]), reward_review: pick("reward_review", ["pending", "reviewed"]),
    agreement_status: pick("agreement_status", ["unknown", "on_file", "not_applicable", "missing"]),
    final_payout_review: pick("final_payout_review", ["pending", "scheduled", "not_needed"]), tax_retention: pick("tax_retention", ["pending", "retained", "not_applicable"]),
  };
  const { error } = await db.rpc("admin_sales_offboarding_update", { p_caller: user.id, p_id: id.data, p });
  if (error) back(rep, { err: code(error) });
  back(rep, { ok: "Offboarding checklist saved." });
}

export async function reassignRepLeads(fd: FormData) {
  const { user, db, rep } = await need("reassign_leads", fd);
  const method = ["equal", "trade", "territory", "rep", "unassign"].includes(String(fd.get("method"))) ? String(fd.get("method")) : "equal";
  const cats = fd.getAll("cat").map(String).filter((c) => ["new", "contacted", "active", "trial"].includes(c));
  const target = String(fd.get("target") ?? "");
  if (cats.length === 0 || (method === "rep" && !uuidRe.test(target))) back(rep, { err: "invalid" });
  const { data, error } = await db.rpc("admin_sales_rep_leads_reassign", { p_caller: user.id, p_rep: rep, p_categories: cats, p_method: method, p_target: method === "rep" ? target : null });
  if (error) back(rep, { err: code(error) });
  const r = data as { moved: number; unassigned: number };
  back(rep, { ok: `${r.moved} lead${r.moved === 1 ? "" : "s"} moved${r.unassigned ? `, ${r.unassigned} waiting in the queue` : ""}. Customers and commissions didn't move.` });
}

export async function completeOffboarding(fd: FormData) {
  const { user, db, rep } = await need("manage_reps", fd);
  const id = z.string().regex(uuidRe).safeParse(fd.get("id"));
  if (!id.success || fd.get("confirm") !== "on") back(rep, { err: "invalid" });
  const { error } = await db.rpc("admin_sales_offboarding_complete", { p_caller: user.id, p_id: id.data, p_sign_out: fd.get("sign_out") === "on" });
  if (error) back(rep, { err: code(error) });
  back(rep, { ok: "Offboarding finished. Access ended; earned pay, history and records are kept. Remaining open leads were shared out." });
}

export async function cancelOffboarding(fd: FormData) {
  const { user, db, rep } = await need("manage_reps", fd);
  const id = z.string().regex(uuidRe).safeParse(fd.get("id"));
  if (!id.success) back(rep, { err: "invalid" });
  const { error } = await db.rpc("admin_sales_offboarding_cancel", { p_caller: user.id, p_id: id.data, p_reason: String(fd.get("reason") ?? "").slice(0, 300) });
  if (error) back(rep, { err: code(error) });
  back(rep, { ok: "Offboarding canceled. If access was suspended, restore it below." });
}

export async function reactivateRep(fd: FormData) {
  const { user, db, rep } = await need("manage_reps", fd);
  const { error } = await db.rpc("admin_sales_rep_reactivate", { p_caller: user.id, p_rep: rep, p_note: String(fd.get("note") ?? "").slice(0, 500) || null, p_agreement_confirmed: fd.get("agreement") === "on" });
  if (error) back(rep, { err: code(error) });
  back(rep, { ok: "Reactivated with their history intact. Lead allocation is paused until you turn it on; leads they had before stay with their new owners." });
}
