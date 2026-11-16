import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { hashSigningToken, newSigningToken } from "@/lib/esign/token";
import { site } from "@/lib/site";
import { opsDbError, UUID } from "@/lib/operations/server";
import { SHAREABLE_FIELDS, shareContent, type ScopeSection, type ShareField } from "@/lib/operations/scope";

export const runtime = "nodejs";
const KEYS = SHAREABLE_FIELDS.map((f) => f.key) as [ShareField, ...ShareField[]];
const schema = z.object({
  shareId: z.string().regex(UUID).optional(), resourceId: z.string().regex(UUID).nullable().optional(),
  fields: z.array(z.enum(KEYS)).min(1).max(KEYS.length), photoIds: z.array(z.string().regex(UUID)).max(30).default([]),
  days: z.number().int().min(1).max(180).default(60), preview: z.boolean().optional(),
});

/**
 * Share a scope section with a subcontractor: only the selected fields (never internal notes or any
 * cost) are frozen into a new share version. "preview" returns exactly what they'll see without
 * sharing. Updating an existing share keeps its link and adds a version.
 */
export async function POST(req: Request, ctx: { params: Promise<{ sectionId: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("scope-share", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { sectionId } = await ctx.params;
  if (!UUID.test(sectionId)) return fail(404, "not_found", "Section not found.");
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Choose at least one field to share.");
  const supabase = await createClient();
  const { data: s } = await supabase.from("project_scope_sections").select("*").eq("id", sectionId).maybeSingle();
  if (!s) return fail(404, "not_found", "Section not found.");
  const sec = s as ScopeSection;
  const [{ data: e }, { data: sched }, res] = await Promise.all([
    supabase.from("estimates").select("title, project_address, user_id").eq("id", sec.estimate_id).maybeSingle(),
    supabase.from("project_schedules").select("id").eq("estimate_id", sec.estimate_id).neq("status", "archived").maybeSingle(),
    p.data.resourceId ? supabase.from("pm_resources").select("name").eq("id", p.data.resourceId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  let dates: { start: string; end: string } | null = null;
  if (sched?.id && p.data.fields.includes("schedule")) {
    const { data: t } = await supabase.from("schedule_tasks").select("planned_start, planned_end").eq("schedule_id", sched.id).eq("source_group_id", sec.source_group_id).eq("kind", "section").is("split_from", null).maybeSingle();
    if (t) dates = { start: t.planned_start as string, end: t.planned_end as string };
  }
  const { data: prof } = await supabase.from("business_profiles").select("company_name").eq("user_id", e?.user_id ?? user.id).maybeSingle();
  const content = shareContent(sec, p.data.fields, { projectTitle: (e?.title as string) || "Project", siteAddress: e?.project_address as string | null, dates, company: (prof?.company_name as string) || "", assignee: (res.data as { name?: string } | null)?.name ?? null });
  if (p.data.preview) return json({ preview: content });

  const token = p.data.shareId ? null : newSigningToken();
  const { data, error } = await supabase.rpc("scope_share_publish", {
    p_section_id: sectionId, p_share_id: p.data.shareId ?? null, p_resource_id: p.data.resourceId ?? null, p_token_hash: token ? hashSigningToken(token) : null,
    p_content: content, p_photo_ids: p.data.photoIds, p_days: p.data.days,
  });
  if (error) {
    const m = opsDbError(error);
    if (m.status === 500) logError("scope.share", error);
    return fail(m.status, m.code, m.code === "forbidden" ? "You need “Share subcontractor scopes” for this project." : error.message.includes("bad_photo") ? "Only photos attached to this section can be shared." : m.message);
  }
  return json({ ...(data as object), url: token ? `${site.url}/scope/${token}` : null }, 201);
}
