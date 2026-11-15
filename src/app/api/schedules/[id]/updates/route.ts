import { z } from "zod";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { reportOptionsSchema } from "@/lib/schedule/report";
import { contentHash, getPublication, listPublications, previewReport, publicationDbError } from "@/lib/schedule/publications";
import { loadSchedule } from "@/lib/schedule/server";

export const runtime = "nodejs";
const UUID = /^[0-9a-f-]{36}$/i;
type Ctx = { params: Promise<{ id: string }> };

/** Published customer updates (history), for anyone who can view the schedule. */
export async function GET(_req: Request, ctx: Ctx) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Schedule not found.");
  const supabase = await createClient();
  const data = await loadSchedule(supabase, id);
  if (!data) return fail(404, "not_found", "Schedule not found.");
  return json({ publications: await listPublications(supabase, id) });
}

const body = z.object({ options: reportOptionsSchema, baseRevision: z.number().int().min(1), confirm: z.literal(true) }).strict();

/**
 * Publish: the contractor approved the preview. The report is rebuilt on the server from the same
 * saved revision (never taken from the browser) and stored as a frozen copy. Publishing sends nothing:
 * the contractor then downloads the PDF, opens an email draft or creates a secure link.
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("schedule-update-publish", 30, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Schedule not found.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Review the preview and confirm before publishing.");
  const supabase = await createClient();
  const data = await loadSchedule(supabase, id);
  if (!data) return fail(404, "not_found", "Schedule not found.");
  if (!data.permissions.publish) return fail(403, "forbidden", "Your company role can't publish customer updates for this schedule.");
  if (data.schedule.revision !== p.data.baseRevision) return fail(409, "stale_revision", "The schedule changed after this preview. Review the preview again before publishing.");

  const admin = createAdminClient();
  const { report, brand } = await previewReport(supabase, admin, data, p.data.options);
  const { data: prof } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const publisherName = (prof as { display_name?: string | null } | null)?.display_name?.trim() || brand.contactName || null;
  const { data: out, error } = await supabase.rpc("schedule_publish", {
    p_schedule_id: id, p_base_revision: p.data.baseRevision,
    p: { options: p.data.options, content: report, contentHash: contentHash(report), logoPath: report.brand.logo ? brand.logoPath : null, publisherName },
  });
  if (error) {
    const e = publicationDbError(error);
    if (e.status >= 500) logError("schedule.publish", error, { schedule: id });
    return fail(e.status, e.code, e.message);
  }
  const pub = await getPublication(supabase, id, String((out as { id: string }).id));
  return json({ publication: pub }, 201);
}
