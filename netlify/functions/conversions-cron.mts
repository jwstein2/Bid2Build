/**
 * Netlify Scheduled Function: every 10 minutes, send queued ad-platform conversions (Meta CAPI).
 * Runs only on the published production deploy. Does nothing while META_CAPI_ENABLED is not "true".
 */
import { runCron } from "../lib/cron";
export default async function conversionsCron(): Promise<Response> {
  const secret = process.env.EMAIL_OUTBOX_SECRET;
  const base = process.env.URL;
  if (!secret || !base || process.env.META_CAPI_ENABLED !== "true") return new Response("off", { status: 200 });
  return runCron("conversions", "/api/cron/conversions", secret, base);
}

export const config = { schedule: "*/10 * * * *" };
