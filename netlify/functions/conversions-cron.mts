/**
 * Netlify Scheduled Function: every 10 minutes, send queued ad-platform conversions (Meta CAPI).
 * Runs only on the published production deploy. Does nothing while META_CAPI_ENABLED is not "true".
 */
export default async function conversionsCron(): Promise<Response> {
  const secret = process.env.EMAIL_OUTBOX_SECRET;
  const base = process.env.URL;
  if (!secret || !base || process.env.META_CAPI_ENABLED !== "true") return new Response("off", { status: 200 });
  const r = await fetch(new URL("/api/cron/conversions", base), { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  return new Response(`conversions: ${r.status}`, { status: 200 });
}

export const config = { schedule: "*/10 * * * *" };
