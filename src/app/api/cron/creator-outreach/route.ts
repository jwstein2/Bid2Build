import { runCreatorOutreach } from "@/lib/creator/outreach/runner";
import { outreachEnv } from "@/lib/creator/outreach/send";
import { secretMatches } from "@/lib/creator/outreach/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { site } from "@/lib/site";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Creator outreach scheduler tick. Called every 15 minutes by netlify/functions/creator-outreach-cron.mts
 * with `Authorization: Bearer $CREATOR_OUTREACH_SECRET`. A no-op (returns the blockers) until the owner
 * approves sending in Admin → Creator Partnerships → Settings AND CREATOR_OUTREACH_SEND_ENABLED=true.
 * Returns counts only.
 */
export async function POST(req: Request) {
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secretMatches(got, process.env.CREATOR_OUTREACH_SECRET)) return fail(401, "unauthorized", "Not allowed.");
  const res = await runCreatorOutreach(createAdminClient(), { env: outreachEnv(process.env, site.url) });
  return json(res);
}
