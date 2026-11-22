/**
 * Netlify Scheduled Function: every 15 minutes, send due Sales Hub follow-up and nurture emails.
 * It only calls the app's protected route; the route does nothing until an administrator turns
 * follow-up emails on (Admin Sales Hub → Follow-up emails). Without EMAIL_OUTBOX_SECRET it exits.
 */
export default async function salesNurtureCron(): Promise<Response> {
  const secret = process.env.EMAIL_OUTBOX_SECRET;
  const base = process.env.URL;
  if (!secret || !base || process.env.SALES_NURTURE_DISABLED === "true") return new Response("off", { status: 200 });
  return runCron("sales_nurture", "/api/cron/sales-nurture", secret, base);
}

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

export const config = { schedule: "*/15 * * * *" };
