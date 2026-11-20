"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/server";
import { inviteTokenHash, newInviteToken } from "@/lib/affiliates/server";
import { sendAffiliateEmail, type AffiliateTemplate } from "@/lib/affiliates/emails";
import { site } from "@/lib/site";

/**
 * Owner Affiliate CRM actions. Each admin_affiliate_* function re-checks is_admin(p_caller) in the database and writes
 * an audit log entry. Emails go out only when their switch is on (see lib/affiliates/emails.ts); otherwise they're
 * logged as not sent, and invitation links are shown here to copy.
 */
const s = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const go = (tab: string, q: Record<string, string> = {}): never => { revalidatePath("/admin/affiliates"); redirect(`/admin/affiliates?${new URLSearchParams({ tab, ...q })}`); };
const fail = (tab: string, e: { message: string }) => go(tab, { err: e.message.replace(/^.*?: /, "").slice(0, 200) });

async function notify(db: Awaited<ReturnType<typeof requireAdmin>>["db"], affiliateId: string, t: AffiliateTemplate, extra: { reason?: string | null; key?: string } = {}) {
  const { data: a } = await db.from("affiliates").select("email, display_name, legal_name").eq("id", affiliateId).maybeSingle();
  if (a) await sendAffiliateEmail(db, extra.key ?? `${t}/${affiliateId}`, t, a.email, { name: a.display_name ?? a.legal_name, email: a.email, reason: extra.reason ?? null }, { affiliateId });
}

export async function decide(fd: FormData) {
  const { user, db } = await requireAdmin();
  const id = s(fd, "id", 40), decision = s(fd, "decision", 10), reason = s(fd, "reason", 1000);
  const { data, error } = await db.rpc("admin_affiliate_decide", { p_caller: user.id, p_id: id, p_decision: decision, p_reason: reason });
  if (error) fail("affiliates", error);
  const st = (data as { status: string }).status;
  await notify(db, id, decision === "reject" ? "rejected" : st === "active" ? "activated" : "approved", { reason, key: `${decision}-${st}/${id}` });
  go("affiliates", { msg: decision === "reject" ? "Application rejected." : st === "active" ? "Affiliate activated: their link is live." : "Approved to start onboarding." });
}

export async function setStatus(fd: FormData) {
  const { user, db } = await requireAdmin();
  const id = s(fd, "id", 40), status = s(fd, "status", 20), reason = s(fd, "reason", 1000);
  const { error } = await db.rpc("admin_affiliate_set_status", { p_caller: user.id, p_id: id, p_status: status, p_kind: s(fd, "kind", 30) || null, p_reason: reason });
  if (error) fail("affiliates", error);
  if (status !== "active") await notify(db, id, status === "suspended" ? "suspended" : "terminated", { reason, key: `${status}/${id}/${Date.now()}` });
  go("affiliates", { msg: `Affiliate ${status}.` });
}

export async function invite(fd: FormData) {
  const { user, db } = await requireAdmin();
  const token = newInviteToken();
  const prospect = s(fd, "prospect", 40) || null;
  const { data, error } = await db.rpc("admin_affiliate_invite_create", { p_caller: user.id, p_email: s(fd, "email", 320), p_name: s(fd, "name"), p_prospect: prospect, p_token_hash: inviteTokenHash(token), p_note: s(fd, "note", 1000), p_days: 14 });
  if (error) fail(prospect ? "prospects" : "affiliates", error);
  const r = data as { affiliate_id: string; invite_id: string; email: string; name: string | null };
  const link = `${site.url.replace(/\/$/, "")}/affiliate-hub/invite/${token}`;
  const sent = fd.get("send") === "on" ? await sendAffiliateEmail(db, `invite/${r.invite_id}`, "invite", r.email, { name: r.name, email: r.email, link, note: s(fd, "note", 1000) || null }, { affiliateId: r.affiliate_id, prospectId: prospect }) : "skipped";
  go(prospect ? "prospects" : "affiliates", { msg: `Invitation link for ${r.email} (expires in 14 days; shown once): ${link}${sent === "sent" ? " · Email sent." : " · Not emailed (copy the link, or turn on recruitment emails in Settings)."}` });
}

export async function prospectSave(fd: FormData) {
  const { user, db } = await requireAdmin();
  const p = Object.fromEntries(["channel_name", "channel_url", "channel_id", "platform", "subscriber_count", "primary_audience", "contact_name", "email", "email_source", "status", "relevance_score", "next_action", "next_action_at", "notes"].map((k) => [k, s(fd, k, k === "notes" ? 5000 : 500)]));
  const { error } = await db.rpc("admin_affiliate_prospect_save", { p_caller: user.id, p_id: s(fd, "id", 40) || null, p: { ...p, categories: s(fd, "categories", 400).split(",").map((c) => c.trim()).filter(Boolean) } });
  if (error) fail("prospects", error);
  go("prospects", { msg: "Prospect saved." });
}

export async function prospectEvent(fd: FormData) {
  const { user, db } = await requireAdmin();
  const { error } = await db.rpc("admin_affiliate_prospect_event", { p_caller: user.id, p_prospect: s(fd, "id", 40), p_kind: s(fd, "kind", 20), p_body: s(fd, "body", 4000) });
  if (error) fail("prospects", error);
  go("prospects", { msg: "Activity logged." });
}

export async function correctionReview(fd: FormData) {
  const { user, db } = await requireAdmin();
  const { error } = await db.rpc("admin_affiliate_correction_review", { p_caller: user.id, p_id: s(fd, "id", 40), p_approve: s(fd, "approve", 5) === "yes", p_note: s(fd, "note", 1000) });
  if (error) fail("corrections", error);
  go("corrections", { msg: "Correction reviewed." });
}

export async function channelVerify(fd: FormData) {
  const { user, db } = await requireAdmin();
  const { error } = await db.rpc("admin_affiliate_channel_verify", { p_caller: user.id, p_affiliate: s(fd, "id", 40) });
  if (error) fail("affiliates", error);
  go("affiliates", { msg: "Channel marked verified." });
}

export async function commissionSet(fd: FormData) {
  const { user, db } = await requireAdmin();
  const { error } = await db.rpc("admin_affiliate_commission_set", { p_caller: user.id, p_id: s(fd, "id", 40), p_status: s(fd, "status", 20), p_reason: s(fd, "reason", 300) });
  if (error) fail("commissions", error);
  go("commissions", { msg: "Commission updated." });
}

export async function disputeOpen(fd: FormData) {
  const { user, db } = await requireAdmin();
  const email = s(fd, "email", 320).toLowerCase();
  const { data: u } = await db.rpc("admin_affiliate_user_by_email", { p_caller: user.id, p_email: email });
  const userId = (u as string | null) ?? null;
  if (!userId) go("disputes", { err: "No account with that email." });
  const { error } = await db.rpc("admin_affiliate_dispute_open", { p_caller: user.id, p_user: userId, p_kind: s(fd, "kind", 20), p_description: s(fd, "description", 2000), p_raised_by: s(fd, "raised_by", 10) });
  if (error) fail("disputes", error);
  go("disputes", { msg: "Review opened." });
}

export async function disputeResolve(fd: FormData) {
  const { user, db } = await requireAdmin();
  const { error } = await db.rpc("admin_affiliate_dispute_resolve", { p_caller: user.id, p_id: s(fd, "id", 40), p_outcome: s(fd, "outcome", 30), p_resolution: s(fd, "resolution", 2000),
    p_target_affiliate: s(fd, "target_affiliate", 40) || null, p_target_rep: s(fd, "target_rep", 40) || null });
  if (error) fail("disputes", error);
  go("disputes", { msg: "Decision recorded." });
}

export async function complianceSave(fd: FormData) {
  const { user, db } = await requireAdmin();
  const id = s(fd, "id", 40) || null;
  const { error } = await db.rpc("admin_affiliate_compliance_save", { p_caller: user.id, p_id: id, p: { affiliate_id: s(fd, "affiliate_id", 40) || undefined, kind: s(fd, "kind", 40), evidence_url: s(fd, "evidence_url", 500), description: s(fd, "description", 4000), reported_by: s(fd, "reported_by"), status: s(fd, "status", 20) || undefined, action_taken: s(fd, "action_taken", 2000) } });
  if (error) fail("compliance", error);
  go("compliance", { msg: id ? "Case updated." : "Case opened." });
}

export async function settingsSave(fd: FormData) {
  const { user, db } = await requireAdmin();
  const num = (k: string) => (s(fd, k, 12) === "" ? undefined : Number(s(fd, k, 12)));
  const p = {
    applications_open: fd.get("applications_open") === "on", annual_basis: s(fd, "annual_basis", 20), approve_annual_basis: fd.get("approve_annual_basis") === "on",
    hold_days: num("hold_days"), grace_days: num("grace_days"), attribution_window_days: num("attribution_window_days"), min_payout_cents: num("min_payout_dollars") != null ? Math.round(num("min_payout_dollars")! * 100) : undefined,
    max_signups_per_ip_day: num("max_signups_per_ip_day"), forecast_monthly_churn_bps: num("churn_pct") != null ? Math.round(num("churn_pct")! * 100) : undefined,
    forecast_annual_upgrade_bps: num("upgrade_pct") != null ? Math.round(num("upgrade_pct")! * 100) : undefined,
    recruitment_emails: fd.get("recruitment_emails") === "on", payouts_enabled: fd.get("payouts_enabled") === "on", confirm: fd.get("confirm") === "on",
  };
  const { error } = await db.rpc("admin_affiliate_settings_save", { p_caller: user.id, p, p_note: s(fd, "note", 500) || "Settings updated" });
  if (error) fail("settings", error);
  go("settings", { msg: "Settings saved (new policy version recorded if terms changed)." });
}

export async function agreementLegal(fd: FormData) {
  const { user, db } = await requireAdmin();
  const { error } = await db.rpc("admin_affiliate_agreement_legal", { p_caller: user.id, p_id: s(fd, "id", 40), p_status: s(fd, "status", 30) });
  if (error) fail("settings", error);
  go("settings", { msg: "Agreement legal status updated." });
}

export async function runDaily() {
  const { db } = await requireAdmin();
  const { data, error } = await db.rpc("affiliate_daily");
  if (error) fail("commissions", error);
  go("commissions", { msg: `Daily run: ${JSON.stringify(data)}` });
}
