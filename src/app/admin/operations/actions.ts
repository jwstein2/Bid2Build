"use server";
import { redirect } from "next/navigation";
import { audit, requireAdmin } from "@/lib/admin/server";
import { runLifecycle, sendLifecycleSamples } from "@/lib/email/lifecycle-run";

/**
 * Owner tools for the lifecycle emails. Owner-only (requireAdmin) and audited.
 *  - Preview: counts how many of each email would go out right now. Sends and records nothing.
 *  - Samples: sends one example of each email (example data) to LIFECYCLE_TEST_RECIPIENTS only,
 *    and only when LIFECYCLE_EMAIL_MODE is test or live.
 */
export async function previewLifecycle() {
  const { user, db } = await requireAdmin();
  const r = await runLifecycle(db, { dryRun: true });
  await audit(db, user.id, "lifecycle.preview", "email", "lifecycle", { due: r.due });
  const due = r.unavailable ? `unavailable: ${r.unavailable}` : Object.entries(r.due).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(" · ");
  redirect(`/admin/operations?lifecycle=${encodeURIComponent(`Would send now: ${due}. Sending is ${r.enabled ? r.mode : `off (${r.reason})`}.`)}`);
}

export async function sendLifecycleSamplesAction() {
  const { user, db } = await requireAdmin();
  const r = await sendLifecycleSamples();
  await audit(db, user.id, "lifecycle.samples", "email", "lifecycle", { sent: r.sent, failed: r.failed });
  const msg = r.reason ? `Samples not sent: ${r.reason}.` : `Sent ${r.sent} sample emails to the test addresses${r.failed ? ` (${r.failed} failed)` : ""}.`;
  redirect(`/admin/operations?lifecycle=${encodeURIComponent(msg)}`);
}

/**
 * Customer communications (V4.6) owner controls: emergency stop for every automated contractor email,
 * and the inbound reply test that proves reply monitoring really works before anything can claim it's on.
 */
export async function setCommsPaused(formData: FormData) {
  const { user, db } = await requireAdmin();
  const paused = formData.get("paused") === "1";
  await db.from("comm_global").update({ paused, paused_at: paused ? new Date().toISOString() : null, paused_by: paused ? user.id : null, pause_reason: paused ? "Owner emergency stop" : null, updated_at: new Date().toISOString() }).eq("id", 1);
  await audit(db, user.id, paused ? "comms.emergency_stop" : "comms.resume", "email", "customer_communications");
  redirect(`/admin/operations?comms=${encodeURIComponent(paused ? "All automated customer emails are stopped." : "Automated customer emails may run again (still subject to COMM_EMAIL_MODE and each contractor's settings).")}#comms`);
}

export async function sendCommsInboundTest() {
  const { user, db } = await requireAdmin();
  const { commConfig } = await import("@/lib/comms/config");
  const { newReplyToken, replyAddress } = await import("@/lib/comms/tokens");
  const { sendCommEmail, newRfcMessageId, fromHeader } = await import("@/lib/comms/send");
  const cfg = commConfig();
  if (!cfg.replyDomain || !cfg.apiKey) redirect(`/admin/operations?comms=${encodeURIComponent("Set COMM_REPLY_DOMAIN and a Resend key first.")}#comms`);
  const token = newReplyToken();
  await db.from("comm_global").update({ inbound_test_token: token, updated_at: new Date().toISOString() }).eq("id", 1);
  const r = await sendCommEmail(cfg.apiKey, { idempotencyKey: `comm-inbound-test/${token}`, from: fromHeader("Built2Bid reply test", cfg.fromAddress), to: replyAddress(token, cfg.replyDomain!), replyTo: null, subject: "Built2Bid reply monitoring test", text: "This message checks that replies reach Built2Bid. No action needed.", messageId: newRfcMessageId() });
  await audit(db, user.id, "comms.inbound_test", "email", "customer_communications", { ok: r.ok });
  redirect(`/admin/operations?comms=${encodeURIComponent(r.ok ? "Test sent. Refresh in a minute: reply monitoring turns on only when it arrives." : `Test not sent: ${r.error}`)}#comms`);
}
