/**
 * Netlify Scheduled Function: ticks the creator outreach scheduler every 15 minutes.
 * It only calls the app's protected route; all logic and every safety check live there. While the owner
 * hasn't approved sending (or CREATOR_OUTREACH_SEND_ENABLED isn't "true") the route does nothing.
 * Without CREATOR_OUTREACH_SECRET this function exits immediately.
 * Docs: https://docs.netlify.com/functions/scheduled-functions/
 */
import { runCron } from "../lib/cron";
const tick = async () => {
  const secret = process.env.CREATOR_OUTREACH_SECRET;
  const base = process.env.URL; // Netlify sets the site's primary URL in every function
  if (!secret || !base) return new Response("not configured", { status: 200 });
  return runCron("creator_outreach", "/api/cron/creator-outreach", secret, base);
};

export default tick;

export const config = { schedule: "*/15 * * * *" };
