/**
 * Netlify Scheduled Function: once a day (13:41 UTC, about 7:41 AM Central), checks that Supabase made a
 * database backup in the last 36 hours (/api/cron/backup-check). A problem opens a Sentry issue. When the
 * check passes, the optional CRON_HEARTBEAT_BACKUP_CHECK URL (Better Stack heartbeat) is pinged, so the
 * heartbeat also alerts if this job stops running. Does nothing unless a cron secret is set.
 */
export default async function backupCheckCron(): Promise<Response> {
  const secret = process.env.MONITOR_CRON_SECRET || process.env.TAX_BANKING_CRON_SECRET;
  const base = process.env.URL;
  if (!secret || !base) return new Response("off", { status: 200 });
  return runCron("backup-check", "/api/cron/backup-check", secret, base);
}

/**
 * Calls the cron route. A failed run is logged as an error and answers 502. The heartbeat is pinged only when the
 * route reports state "ok" (not when the check is skipped for a missing token). Kept inline (not a shared module)
 * so Netlify's function bundler needs no cross-file import.
 */
async function runCron(name: string, path: string, secret: string, base: string): Promise<Response> {
  let status = 0;
  let detail = "";
  try {
    const r = await fetch(new URL(path, base), { method: "POST", headers: { authorization: `Bearer ${secret}` } });
    status = r.status;
    detail = (await r.text().catch(() => "")).slice(0, 300);
  } catch (e) {
    detail = (e as Error)?.message?.slice(0, 300) ?? "fetch failed";
  }
  const ok = status >= 200 && status < 300;
  let state = "";
  try { state = String((JSON.parse(detail) as { state?: unknown }).state ?? ""); } catch { /* not JSON */ }
  if (!ok) {
    console.error(JSON.stringify({ level: "error", scope: `cron.${name}`, status, detail }));
  } else if (state === "ok") {
    const hb = process.env[`CRON_HEARTBEAT_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`];
    if (hb && /^https:\/\//.test(hb)) await fetch(hb, { method: "GET", signal: AbortSignal.timeout(5000) }).catch(() => {});
  }
  return new Response(`${name}: ${state || status || "error"}`, { status: ok ? 200 : 502 });
}

export const config = { schedule: "41 13 * * *" };
