/**
 * Netlify Scheduled Function: daily Industry Intelligence ingestion (V6.8), 10:20 UTC (about 4–5 AM Central).
 * Off unless NEWS_INGEST_ENABLED=true. Each source has its own cadence inside the job (daily, several
 * times a week), so most runs fetch only what's due. Free feeds only; no email.
 */
export default async function newsCron(): Promise<Response> {
  const secret = process.env.EMAIL_OUTBOX_SECRET;
  const base = process.env.URL;
  if (!secret || !base || process.env.NEWS_INGEST_ENABLED !== "true") return new Response("off", { status: 200 });
  const results: Response[] = [];
  for (const phase of ["fetch", "summarize", "purge"]) results.push(await runCron(`news_${phase}`, `/api/cron/news?phase=${phase}`, secret, base));
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

export const config = { schedule: "20 10 * * *" };
