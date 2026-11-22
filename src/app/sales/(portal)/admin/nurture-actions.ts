"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSalesAdmin } from "@/lib/sales/server";
import { NURTURE_ERRORS } from "@/lib/sales/nurture/templates";

/**
 * Follow-up email settings and campaign controls (Admin Sales Hub → Follow-up emails). Every call is
 * re-checked and audited in the database (admin_sales_nurture_save / admin_sales_campaign_control).
 * Live sending can only be switched on by the platform owner.
 */
const code = (m?: string) => Object.keys(NURTURE_ERRORS).find((k) => (m ?? "").includes(k.replace("nurture_", ""))) ?? "nurture_invalid";
function back(q: Record<string, string>): never {
  revalidatePath("/sales/admin");
  redirect(`/sales/admin?${new URLSearchParams({ tab: "nurture", ...q })}`);
}
const int = (v: FormDataEntryValue | null) => { const n = Number(v); return Number.isInteger(n) ? n : undefined; };

export async function saveNurtureSettings(fd: FormData) {
  const { user, db, has } = await requireSalesAdmin();
  if (!has("manage_reps")) back({ err: "not_authorized" });
  const p: Record<string, unknown> = {
    enabled: fd.get("enabled") === "on", send_mode: String(fd.get("send_mode") ?? "off"), paused: fd.get("paused") === "on",
    test_recipients: String(fd.get("test_recipients") ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean),
    follow_up_1_days: int(fd.get("follow_up_1_days")), follow_up_2_days: int(fd.get("follow_up_2_days")),
    send_start_hour: int(fd.get("send_start_hour")), send_end_hour: int(fd.get("send_end_hour")), weekdays_only: fd.get("weekdays_only") === "on",
    daily_limit: int(fd.get("daily_limit")), rep_daily_limit: int(fd.get("rep_daily_limit")),
    postal_address: String(fd.get("postal_address") ?? "").trim(),
    approve_templates: fd.get("approve_templates") === "on", revoke_templates: fd.get("revoke_templates") === "on", confirm_live: fd.get("confirm_live") === "on",
  };
  const { error } = await db.rpc("admin_sales_nurture_save", { p_caller: user.id, p });
  if (error) back({ err: code(error.message) });
  back({ ok: "Follow-up email settings saved." });
}

/** Emergency pause / resume for all automated sending. */
export async function toggleNurturePause(fd: FormData) {
  const { user, db, has } = await requireSalesAdmin();
  if (!has("manage_reps")) back({ err: "not_authorized" });
  const paused = fd.get("paused") === "1";
  const { data: cur } = await db.rpc("admin_sales_nurture", { p_caller: user.id });
  const mode = (cur as { settings?: { send_mode?: string } } | null)?.settings?.send_mode ?? "off";
  const { error } = await db.rpc("admin_sales_nurture_save", { p_caller: user.id, p: { paused, send_mode: mode } });
  if (error) back({ err: code(error.message) });
  back({ ok: paused ? "All automated follow-up emails are paused." : "Automated follow-up emails resumed." });
}

/** Assign or remove a rep's @built2bid.org sending address (no address = follow-up emails off for that rep). */
export async function setRepSender(fd: FormData) {
  const { user, db, has } = await requireSalesAdmin();
  if (!has("manage_reps")) back({ err: "not_authorized" });
  const rep = String(fd.get("rep") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(rep)) back({ err: "nurture_invalid" });
  const email = fd.get("clear") === "1" ? null : String(fd.get("email") ?? "").trim().toLowerCase() || null;
  if (email && !/^[a-z0-9._+-]+@built2bid\.org$/.test(email)) back({ err: "nurture_not_built2bid_address" });
  const { error } = await db.rpc("admin_sales_rep_sender", { p_caller: user.id, p_rep: rep, p_email: email });
  if (error) back({ err: code(error.message) });
  back({ ok: email ? `Follow-up emails for this rep now come from ${email}.` : "Address removed. Follow-up emails are off for this rep until one is assigned." });
}

export async function adminControlCampaign(fd: FormData) {
  const { user, db, has } = await requireSalesAdmin();
  if (!has("reassign_leads")) back({ err: "not_authorized" });
  const campaign = String(fd.get("campaign") ?? "");
  const action = String(fd.get("action") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(campaign) || !["pause", "resume", "stop"].includes(action)) back({ err: "nurture_invalid" });
  const { error } = await db.rpc("admin_sales_campaign_control", { p_caller: user.id, p_campaign: campaign, p_action: action });
  if (error) back({ err: "nurture_invalid" });
  back({ ok: `Campaign ${action === "stop" ? "stopped" : action === "pause" ? "paused" : "resumed"}.` });
}
