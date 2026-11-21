import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { fillBriefs } from "@/lib/sales/brief";
import { sendDayBeforeReminders } from "@/lib/sales/booking-email";
import { sendWeeklyDigest } from "@/lib/sales/digest";
import { recheckLeadEmails } from "@/lib/sales/email-check";

export const runtime = "nodejs";

/**
 * Sales Portal month-end close (netlify/functions/sales-close-cron.mts, daily). Authorization:
 * Bearer $EMAIL_OUTBOX_SECRET (the existing scheduled-job secret). Idempotent: on the first run of a new
 * month it earns last month's pending commissions and puts them on each rep's statement; other days it
 * only catches late changes. Also writes any missing lead sales briefs. Never pays anyone: payouts are approved and recorded by the owner.
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  const { data, error } = await createAdminClient().rpc("sales_close_month", {});
  if (error) {
    // Migration not applied yet: nothing to close.
    if (/sales_close_month/.test(error.message ?? "")) return json({ skipped: "not_installed" });
    logError("sales.close_month", error);
    return fail(500, "close_failed", "Month-end close failed.");
  }
  // Compensation V3: log incentive-program approvals that expired (they stop applying on their own).
  await createAdminClient().rpc("sales_programs_sweep", {}).then(() => null, () => null);
  // Randomized activity bonus: last month's drawing (once per month; records "no drawing" with the reason
  // when the program is off or paying accounts are below the first prize tier). Missing until 20270216003000.
  const drawing = await createAdminClient().rpc("sales_activity_drawing_run", {}).then((r) => r.data ?? null, () => null);
  // Milestone awards: create every milestone reached (V3 snapshots the amount now; V2 boxes wait out the hold).
  await createAdminClient().rpc("sales_milestones_evaluate", {}).then(() => null, () => null);
  // V8.4: monthly accelerators (finalize months whose sales cleared the hold) and achievements.
  // Both are idempotent and do nothing before migration 20270116001000 is applied.
  const accel = await createAdminClient().rpc("sales_accelerators_evaluate", {}).then((r) => r.data ?? null, () => null);
  await createAdminClient().rpc("sales_achievements_evaluate", {}).then(() => null, () => null);
  // V8.4 P1: customer success celebrations (and owner congratulation drafts, when the owner has them on).
  const successes = await createAdminClient().rpc("sales_customer_successes_evaluate", {}).then((r) => r.data ?? null, () => null);
  // V8.4 P2: day-before reminders for client sessions (only when SALES_BOOKING_EMAILS=on).
  const reminders = await sendDayBeforeReminders(createAdminClient()).catch(() => 0);
  // V8.4 P3: the owner's weekly recognition digest (Monday or later, once a week, only when turned on).
  const digest = await sendWeeklyDigest(createAdminClient()).catch(() => false);
  // V8.6: leads waiting only because nobody was eligible get shared out once someone is (missing until 20270121001000).
  const { data: queue } = await createAdminClient().rpc("sales_allocate_queue", { p_actor: null });
  // V8.7: daily lead recycling review (warnings first, then neglected leads move). Missing until 20270122001000.
  const { data: recycle } = await createAdminClient().rpc("sales_recycle_run", { p_actor: null });
  // Imported leads whose sales brief didn't finish during the import.
  const briefs = await fillBriefs(createAdminClient(), { limit: 50, budgetMs: 8000 }).catch(() => 0);
  // Lead emails not checked yet (manual adds, CSV imports): can the domain receive mail? DNS only.
  const emails = await recheckLeadEmails(createAdminClient(), { limit: 200 }).catch(() => null);
  return json({ ...(data as object), drawing, email_checks: emails, accelerators: accel, customer_successes: successes, reminders, digest, queue: queue ?? null, recycle: recycle ?? null, briefs_written: briefs });
}
