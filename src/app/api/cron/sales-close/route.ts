import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { fillBriefs } from "@/lib/sales/brief";

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
  // Milestone gift boxes: create reached boxes and fix amounts whose 30-day hold has passed.
  await createAdminClient().rpc("sales_milestones_evaluate", {}).then(() => null, () => null);
  // V8.4: monthly accelerators (finalize months whose sales cleared the hold) and achievements.
  // Both are idempotent and do nothing before migration 20270114001000 is applied.
  const accel = await createAdminClient().rpc("sales_accelerators_evaluate", {}).then((r) => r.data ?? null, () => null);
  await createAdminClient().rpc("sales_achievements_evaluate", {}).then(() => null, () => null);
  // Imported leads whose sales brief didn't finish during the import.
  const briefs = await fillBriefs(createAdminClient(), { limit: 50, budgetMs: 8000 }).catch(() => 0);
  return json({ ...(data as object), accelerators: accel, briefs_written: briefs });
}
