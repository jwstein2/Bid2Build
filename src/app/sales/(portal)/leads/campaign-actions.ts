"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesRep } from "@/lib/sales/server";
import { activityErrorMessage } from "@/lib/sales/calling";
import { createAdminClient } from "@/lib/supabase/server";
import { CALL_OUTCOMES, START_BLOCK_LABEL, type CallOutcome } from "@/lib/sales/nurture/templates";
import { sendFirstEmail } from "@/lib/sales/nurture/runner";

/**
 * Call outcomes and follow-up campaigns on a lead. Every database call runs with the rep's own session
 * (sales_crm_* and sales_campaign_* functions only touch leads the rep may see). The first email is
 * sent with the service role only after the rep's own sales_campaign_start succeeded.
 */
function back(id: string, q: Record<string, string>, path = `/sales/leads/${id}`): never {
  revalidatePath(`/sales/leads/${id}`);
  redirect(`${path}?${new URLSearchParams(q)}`);
}
const errKey = (m?: string | null) => Object.keys(START_BLOCK_LABEL).find((k) => (m ?? "").includes(k));

export async function recordCallOutcome(fd: FormData) {
  const { db } = await requireSalesRep();
  const id = z.string().uuid().parse(fd.get("id"));
  const outcome = CALL_OUTCOMES.find((o) => o.v === fd.get("outcome"));
  if (!outcome) back(id, { err: "Pick what happened on the call." });
  const note = String(fd.get("note") ?? "").trim().slice(0, 3000);
  const v = outcome!.v as CallOutcome;
  const body = { answered: "Talked to them.", no_answer: "No answer.", not_interested: "Not interested. No follow-up.", callback: "Asked for a callback.", wrong_number: "Wrong number / invalid contact." }[v] + (note ? ` ${note}` : "");
  // Reuses the existing call log (Do Not Call and calling-hours rules are enforced there).
  const { error } = await db.rpc("sales_crm_activity_log", { p_lead: id, p_kind: "call", p_body: body, p_disposition: outcome!.disposition });
  if (error) back(id, { err: activityErrorMessage(error.message) });
  const { data: state } = await db.rpc("sales_campaign_lead", { p_lead: id });
  const s = state as { enabled: boolean; live: { id: string; kind: string } | null; can_start: Record<string, string> } | null;
  // They talked to the rep: a running no-answer nurture stops now (the follow-up can start next).
  if (s?.live?.kind === "no_answer" && (v === "answered" || v === "callback")) await db.rpc("sales_campaign_control", { p_campaign: s.live.id, p_action: "stop" });

  if (v === "not_interested") {
    const { error: e2 } = await db.rpc("sales_crm_lead_update", { p_id: id, p: { stage: "lost", lost_reason: "Not interested" } });
    back(id, e2 ? { err: "The call was logged, but the lead couldn't be marked not interested." } : { ok: "Logged. Marked not interested, and any follow-up emails stopped." });
  }
  if (v === "callback") {
    const when = String(fd.get("callback_at") ?? "");
    const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when) ? zonedToUtc(when, String(fd.get("tz") ?? "America/Chicago")) : null;
    if (!at) back(id, { err: "The call was logged. Pick a date and time for the callback." });
    await db.rpc("sales_crm_task_save", { p_lead: id, p_task: null, p_title: "Callback requested", p_due_at: at!.toISOString(), p_done: false });
    await db.rpc("sales_my_event_save", { p_id: null, p_kind: "call", p_title: "Callback", p_description: note || null, p_starts_at: at!.toISOString(), p_ends_at: new Date(at!.getTime() + 15 * 60_000).toISOString(), p_all_day: false, p_lead_id: id });
    back(id, { ok: "Logged. The callback is on your calendar and task list." });
  }
  if (v === "wrong_number") back(id, { ok: "Logged as wrong number. Update the phone number in Details if you find the right one." });
  // Answered / no answer: open the email for review when a campaign can start.
  const kind = v === "answered" ? "answered" : "no_answer";
  if (s?.enabled && s.can_start?.[kind] === "ok") redirect(`/sales/leads/${id}/email?kind=${kind}`);
  back(id, { ok: s?.enabled && s.can_start?.[kind] ? `Logged. ${START_BLOCK_LABEL[s.can_start[kind]] ?? ""}` : "Logged." });
}

/** "2026-11-24T10:30" in a time zone -> UTC Date. */
function zonedToUtc(local: string, tz: string): Date | null {
  try {
    const guess = new Date(`${local}:00Z`);
    const shown = new Date(guess.toLocaleString("en-US", { timeZone: tz }));
    const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
    const d = new Date(guess.getTime() + (utc.getTime() - shown.getTime()));
    return Number.isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

/** The rep reviewed the first email and clicked Send: start the campaign, then send it right away. */
export async function startCampaign(fd: FormData) {
  const { db } = await requireSalesRep();
  const id = z.string().uuid().parse(fd.get("id"));
  const kind = z.enum(["answered", "no_answer"]).parse(fd.get("kind"));
  const subject = String(fd.get("subject") ?? "").trim().slice(0, 200);
  const body = String(fd.get("body") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 6000);
  const compose = `/sales/leads/${id}/email`;
  if (fd.get("confirm") !== "on") back(id, { kind, err: "Tick the box to confirm you reviewed the email." }, compose);
  const { data, error } = await db.rpc("sales_campaign_start", { p_lead: id, p_kind: kind, p_subject: subject, p_body: body });
  if (error) back(id, { kind, err: START_BLOCK_LABEL[errKey(error.message) ?? ""] ?? "That couldn't be sent. Try again." }, compose);
  const r = data as { campaign_id: string; message_id: string };
  const res = await sendFirstEmail(createAdminClient(), r.message_id);
  const label = kind === "answered" ? "follow-up" : "nurture";
  if (res === "sent") back(id, { ok: `Sent. The ${label} campaign is running: up to two automatic follow-ups, and it stops as soon as they reply, book a time, opt out or sign up for a paid plan.` });
  if (res === "retry" || res === "not_claimed") back(id, { ok: `The ${label} campaign started. The email provider didn't take the first email yet, so it will retry automatically in a few minutes.` });
  back(id, { err: "The campaign started, but the first email couldn't be sent, so it was stopped. Check the campaign panel for the reason." });
}

export async function controlCampaign(fd: FormData) {
  const { db } = await requireSalesRep();
  const id = z.string().uuid().parse(fd.get("id"));
  const campaign = z.string().uuid().parse(fd.get("campaign"));
  const action = z.enum(["pause", "resume", "stop"]).parse(fd.get("action"));
  if (action === "stop" && fd.get("confirm") !== "on") back(id, { err: "Tick the box to confirm stopping the campaign." });
  const { error } = await db.rpc("sales_campaign_control", { p_campaign: campaign, p_action: action });
  if (error) back(id, { err: "That didn't work. The campaign may have already ended." });
  back(id, { ok: { pause: "Campaign paused. Nothing more sends until you resume it.", resume: "Campaign resumed.", stop: "Campaign stopped. No more automatic emails will go to this lead." }[action] });
}

/** Put a call with this lead on the rep's calendar and task list. */
export async function scheduleCall(fd: FormData) {
  const { db } = await requireSalesRep();
  const id = z.string().uuid().parse(fd.get("id"));
  const when = String(fd.get("at") ?? "");
  const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when) ? zonedToUtc(when, String(fd.get("tz") ?? "America/Chicago")) : null;
  if (!at) back(id, { err: "Pick a date and time for the call." });
  const { error } = await db.rpc("sales_my_event_save", { p_id: null, p_kind: "call", p_title: "Call", p_description: null, p_starts_at: at!.toISOString(), p_ends_at: new Date(at!.getTime() + 15 * 60_000).toISOString(), p_all_day: false, p_lead_id: id });
  if (error) back(id, { err: "That call couldn't be scheduled." });
  await db.rpc("sales_crm_task_save", { p_lead: id, p_task: null, p_title: "Scheduled call", p_due_at: at!.toISOString(), p_done: false });
  back(id, { ok: "Call added to your calendar and task list." });
}
