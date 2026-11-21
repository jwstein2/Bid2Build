/**
 * Netlify Scheduled Function: Contractor Academy weekly drip, every 30 minutes.
 * Publishes courses on their release day (2 every Monday by default, Central time) and writes upcoming courses'
 * lessons with Haiku up to 14 days ahead, one lesson per call, two calls per run. Pause it in Manage Academy
 * (Courses > Weekly releases) or with ACADEMY_RELEASE_ENABLED=false.
 */
export default async function academyCron(): Promise<Response> {
  const secret = process.env.EMAIL_OUTBOX_SECRET;
  const base = process.env.URL;
  if (!secret || !base || process.env.ACADEMY_RELEASE_ENABLED === "false") return new Response("off", { status: 200 });
  // Netlify waits only about 15 seconds for a scheduled function; each call is short (one lesson) and the
  // route keeps running if this function stops waiting.
  const results = await Promise.all([
    runCron("academy_release", "/api/cron/academy?phase=release", secret, base),
    runCron("academy_write", "/api/cron/academy?phase=write&skip=0", secret, base),
    runCron("academy_write_2", "/api/cron/academy?phase=write&skip=1", secret, base),
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

export const config = { schedule: "11,41 * * * *" };
