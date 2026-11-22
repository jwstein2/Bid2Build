/**
 * Netlify Scheduled Function: Academy code-library source monitoring, daily at 09:23 UTC.
 * Each run fingerprints up to 8 official sources that were not checked in the last 28 days (so every source is checked
 * about monthly), and on Jan 2 and Jul 2 queues the six-month review. Changes go to Manage Academy → Codes for an
 * admin to classify; nothing is edited automatically and no AI is used. Turn off with ACADEMY_KB_MONITOR=false.
 */
export default async function academyKbCron(): Promise<Response> {
  const secret = process.env.EMAIL_OUTBOX_SECRET;
  const base = process.env.URL;
  if (!secret || !base || process.env.ACADEMY_KB_MONITOR === "false") return new Response("off", { status: 200 });
  const now = new Date();
  const semiannual = now.getUTCDate() === 2 && (now.getUTCMonth() === 0 || now.getUTCMonth() === 6);
  const results = await Promise.all([
    runCron("academy_kb_check", "/api/cron/academy-kb?phase=check", secret, base),
    ...(semiannual ? [runCron("academy_kb_semiannual", "/api/cron/academy-kb?phase=semiannual", secret, base)] : []),
  ]);
  const failed = results.some((r) => !r.ok);
  return new Response(results.map((r) => r.status).join(" "), { status: failed ? 502 : 200 });
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

export const config = { schedule: "23 9 * * *" };
