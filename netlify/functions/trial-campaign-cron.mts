/**
 * Netlify Scheduled Function: every 15 minutes, ask the site to run the Facebook trial jobs
 * (private-reply retries, the 4-hour Messenger reminder, invite and check-in emails).
 * Runs only on the published production deploy. Needs EMAIL_OUTBOX_SECRET (already used by the
 * founder email retries). Does nothing while FB_TRIAL_ENABLED is not "true".
 */
import { runCron } from "../lib/cron";
export default async function trialCampaignCron(): Promise<Response> {
  const secret = process.env.EMAIL_OUTBOX_SECRET;
  const base = process.env.URL;
  if (!secret || !base) return new Response("not configured", { status: 200 });
  return runCron("trial_campaign", "/api/cron/trial-campaign", secret, base);
}

export const config = { schedule: "*/15 * * * *" };
