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
