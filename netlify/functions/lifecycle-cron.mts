/**
 * Netlify Scheduled Function: once a day (15:00 UTC, 9-10 AM Central), run the lifecycle email job.
 * Runs only on the published production deploy. Does nothing while LIFECYCLE_EMAIL_MODE is off.
 */
export default async function lifecycleCron(): Promise<Response> {
  const secret = process.env.EMAIL_OUTBOX_SECRET;
  const base = process.env.URL;
  const mode = process.env.LIFECYCLE_EMAIL_MODE;
  if (!secret || !base || (mode !== "test" && mode !== "live")) return new Response("off", { status: 200 });
  const r = await fetch(new URL("/api/cron/lifecycle", base), { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  return new Response(`lifecycle: ${r.status}`, { status: 200 });
}

export const config = { schedule: "0 15 * * *" };
