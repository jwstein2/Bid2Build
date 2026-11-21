import { timingSafeEqual } from "node:crypto";
import { fail, json, logError } from "@/lib/http/api";
import { checkBackups } from "@/lib/monitoring/backups";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Daily database backup check (netlify/functions/backup-check-cron.mts).
 * Authorization: Bearer $MONITOR_CRON_SECRET (falls back to TAX_BANKING_CRON_SECRET so no new secret is needed).
 *
 * - ok: newest completed backup is under 36 hours old. Answers 200 {state:"ok"}; the scheduled function then
 *   pings the optional CRON_HEARTBEAT_BACKUP_CHECK URL (a Better Stack heartbeat), so a missed day alerts.
 * - stale / error: logged with logError, which also opens a Sentry issue (email alert). Answers 503.
 * - not_connected (no SUPABASE_MANAGEMENT_TOKEN): 200 {state:"not_connected"}, no heartbeat ping.
 * Returns timestamps and counts only, never the token.
 */
export async function POST(req: Request) {
  const secret = process.env.MONITOR_CRON_SECRET || process.env.TAX_BANKING_CRON_SECRET || "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");

  const r = await checkBackups();
  if (r.state === "not_connected") return json({ state: r.state });
  if (r.state === "error") {
    // The code is in the Sentry issue title, so the alert says why (e.g. "monitor.backups: token_forbidden").
    logError("monitor.backups", Object.assign(new Error(`Backup check failed: ${r.message}`), { code: r.code }));
    return json({ state: r.state, message: r.message }, 503);
  }
  if (r.state === "stale" || r.data.failedLast7Days > 0) {
    const why = r.data.latestAt ? `newest completed backup is ${r.data.ageHours}h old (${r.data.latestAt})` : "no completed backup found";
    logError("monitor.backups", Object.assign(new Error(`Database backups need attention: ${why}; ${r.data.failedLast7Days} failed in 7 days`), { code: r.state === "stale" ? "backups_stale" : "backups_failed" }), { failed: r.data.failedLast7Days });
    return json({ state: "stale", ...r.data }, 503);
  }
  return json({ state: "ok", ...r.data });
}
