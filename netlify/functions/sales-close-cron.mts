/**
 * Netlify Scheduled Function: Sales Portal month-end close, once a day (07:30 UTC, after midnight
 * Central). It only calls the app's protected route; all logic lives in the database
 * (public.sales_close_month), which is idempotent. Without EMAIL_OUTBOX_SECRET it exits immediately.
 * Docs: https://docs.netlify.com/functions/scheduled-functions/
 */
const tick = async () => {
  const secret = process.env.EMAIL_OUTBOX_SECRET;
  const base = process.env.URL; // Netlify sets the site's primary URL in every function
  if (!secret || !base) return new Response("not configured", { status: 200 });
  return runCron("sales_close", "/api/cron/sales-close", secret, base);
};

export default tick;

/** Calls the cron route. A failed run is logged as an error and answers 502; success pings optional CRON_HEARTBEAT_<NAME>. Kept inline (not a shared module) so Netlify's function bundler needs no cross-file import. */
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
  if (!ok) {
    console.error(JSON.stringify({ level: "error", scope: `cron.${name}`, status, detail }));
  } else {
    const hb = process.env[`CRON_HEARTBEAT_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`];
    if (hb && /^https:\/\//.test(hb)) await fetch(hb, { method: "GET", signal: AbortSignal.timeout(5000) }).catch(() => {});
  }
  return new Response(`${name}: ${status || "error"}`, { status: ok ? 200 : 502 });
}

export const config = { schedule: "30 7 * * *" };
