/**
 * Netlify Scheduled Function: every 15 minutes, ask the site to run the Facebook trial jobs
 * (private-reply retries, the 4-hour Messenger reminder, invite and check-in emails).
 * Runs only on the published production deploy. Needs EMAIL_OUTBOX_SECRET (already used by the
 * founder email retries). Does nothing while FB_TRIAL_ENABLED is not "true".
 */
export default async function trialCampaignCron(): Promise<Response> {
  const secret = process.env.EMAIL_OUTBOX_SECRET;
  const base = process.env.URL;
  if (!secret || !base) return new Response("not configured", { status: 200 });
  const r = await fetch(new URL("/api/cron/trial-campaign", base), { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  return new Response(`trial jobs: ${r.status}`, { status: 200 });
}

export const config = { schedule: "*/15 * * * *" };
