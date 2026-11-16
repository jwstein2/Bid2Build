import { z } from "zod";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";
import { reportOptionsSchema } from "@/lib/schedule/report";
import { previewReport } from "@/lib/schedule/publications";
import { loadSchedule } from "@/lib/schedule/server";

export const runtime = "nodejs";
const UUID = /^[0-9a-f-]{36}$/i;
const body = z.object({ options: reportOptionsSchema }).strict();

/**
 * Preview Customer Update: exactly what the customer would see, built on the server from the saved
 * schedule. Nothing is stored or sent. The revision is returned so publishing can refuse a schedule
 * that changed after this preview.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("schedule-update-preview", 300, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Schedule not found.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Those options aren't valid.");
  const supabase = await createClient();
  const data = await loadSchedule(supabase, id);
  if (!data) return fail(404, "not_found", "Schedule not found.");
  if (!data.permissions.publish) return fail(403, "forbidden", "Your company role can't publish customer updates for this schedule.");
  const { report, last } = await previewReport(supabase, createAdminClient(), data, p.data.options);
  return json({ report, revision: data.schedule.revision, lastVersion: last?.version ?? null });
}
