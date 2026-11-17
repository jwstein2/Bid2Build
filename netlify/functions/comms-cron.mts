/**
 * Netlify Scheduled Function: every 15 minutes, plan and send customer communications (V4.6).
 * Does nothing unless COMM_EMAIL_MODE is test or live. The owner emergency stop is checked inside.
 */
export default async function commsCron(): Promise<Response> {
  const secret = process.env.EMAIL_OUTBOX_SECRET;
  const base = process.env.URL;
  const mode = process.env.COMM_EMAIL_MODE;
  if (!secret || !base || (mode !== "test" && mode !== "live")) return new Response("off", { status: 200 });
  const r = await fetch(new URL("/api/cron/comms", base), { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  return new Response(`comms: ${r.status}`, { status: 200 });
}

export const config = { schedule: "*/15 * * * *" };
