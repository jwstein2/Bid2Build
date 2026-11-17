import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { commConfig, replyMonitoring } from "./config";
import { deliverDue, renderUpdate } from "./runner";
import { loadSettings, logEvent } from "./server";
import type { CommAccess } from "./types";

type Row = Record<string, unknown>;
export type MessageAction = "approve" | "send_now" | "skip" | "refresh" | "cancel";

/**
 * Contractor actions on a queued message. Approval records who approved which schedule revision, so a
 * later schedule edit sends it back for review instead of sending something nobody saw.
 */
export async function messageAction(admin: SupabaseClient, access: CommAccess & { accountId: string }, userId: string, id: string, action: MessageAction): Promise<{ ok: true; status: string; message?: string } | { ok: false; status: number; code: string; message: string }> {
  const { data } = await admin.from("comm_messages").select("*").eq("id", id).eq("account_id", access.accountId).maybeSingle();
  const m = data as Row | null;
  if (!m) return { ok: false, status: 404, code: "not_found", message: "That message wasn't found." };
  const perm = m.kind === "nurture" ? "approve_marketing_outreach" : "approve_customer_updates";
  if (!access.perms.includes(perm)) return { ok: false, status: 403, code: "forbidden", message: "You don't have permission to approve these emails." };
  const open = ["awaiting_review", "scheduled", "approved", "failed", "paused", "draft"].includes(String(m.status));
  if (!open) return { ok: false, status: 409, code: "closed", message: `This email is already ${String(m.status).replace("_", " ")}.` };
  const now = new Date();
  if (action === "skip" || action === "cancel") {
    await admin.from("comm_messages").update({ status: action === "skip" ? "skipped" : "canceled", status_reason: action === "skip" ? "Skipped by your team" : "Canceled by your team", locked_until: null }).eq("id", id);
    await logEvent(admin, { accountId: access.accountId, kind: action === "skip" ? "skipped" : "canceled", messageId: id, actorId: userId });
    await admin.from("user_notifications").update({ status: "resolved", resolution: "skipped", resolved_at: now.toISOString(), resolved_by: userId }).eq("dedupe_key", `customer_update:${id}`).in("status", ["open", "snoozed"]);
    return { ok: true, status: action === "skip" ? "skipped" : "canceled" };
  }
  let revision: number | null = null;
  if (m.kind === "project_update" && m.schedule_id) {
    const settings = await loadSettings(admin, access.accountId);
    const r = await renderUpdate(admin, String(m.schedule_id), { milestoneTaskId: (m.task_id as string) ?? null, postalAddress: settings.postalAddress, now });
    if (!r) return { ok: false, status: 409, code: "no_schedule", message: "The project schedule isn't available." };
    revision = r.revision;
    // What the reviewer sees is rebuilt from the latest schedule (the secure link is added when it sends).
    await admin.from("comm_messages").update({ subject: r.subject, body_text: r.body, content: { report: r.report, options: r.options, revision: r.revision } }).eq("id", id);
  }
  if (action === "refresh") return { ok: true, status: String(m.status) };
  const scheduledFor = action === "send_now" || Date.parse(String(m.scheduled_for ?? 0)) < now.getTime() ? now.toISOString() : String(m.scheduled_for);
  await admin.from("comm_messages").update({ status: "approved", approved_by: userId, approved_at: now.toISOString(), approved_revision: revision, scheduled_for: scheduledFor, status_reason: null, attempts: 0, locked_until: null }).eq("id", id);
  await logEvent(admin, { accountId: access.accountId, kind: "approved", messageId: id, actorId: userId, details: { revision, sendNow: action === "send_now" } });
  await admin.from("user_notifications").update({ status: "resolved", resolution: "handled", resolved_at: now.toISOString(), resolved_by: userId }).eq("dedupe_key", `customer_update:${id}`).in("status", ["open", "snoozed"]);
  if (action === "send_now") {
    const cfg = commConfig();
    if (!cfg.enabled) return { ok: true, status: "approved", message: `Approved. It will send once customer email is switched on for Built2Bid (${cfg.reason})` };
    const { data: g } = await admin.from("comm_global").select("paused, inbound_verified_at").eq("id", 1).maybeSingle();
    if ((g as Row | null)?.paused) return { ok: true, status: "approved", message: "Approved. Built2Bid has paused automated email, so it will send when that's lifted." };
    const out: Record<string, number> = {};
    await deliverDue(admin, now, cfg, replyMonitoring(cfg, ((g as Row | null)?.inbound_verified_at as string) ?? null).active, out, [id]);
    const { data: after } = await admin.from("comm_messages").select("status, status_reason").eq("id", id).maybeSingle();
    return { ok: true, status: String((after as Row | null)?.status ?? "approved"), message: ((after as Row | null)?.status_reason as string) ?? undefined };
  }
  return { ok: true, status: "approved" };
}
