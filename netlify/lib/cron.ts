/**
 * Shared runner for the Netlify scheduled functions. Each one calls a protected /api/cron/* route.
 * A failed run (non-2xx or network error) is logged as an error and the function answers 502, so it shows up
 * as a failure in the Netlify function logs instead of a silent 200. On success it pings an optional
 * heartbeat URL (e.g. a free Better Stack heartbeat: CRON_HEARTBEAT_COMMS=https://uptime.betterstack.com/api/v1/heartbeat/…),
 * so a job that stops running at all raises an alert.
 */
export async function runCron(name: string, path: string, secret: string, base: string): Promise<Response> {
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
