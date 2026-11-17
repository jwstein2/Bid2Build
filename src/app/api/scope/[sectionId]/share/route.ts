import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { hashSigningToken, newSigningToken } from "@/lib/esign/token";
import { site } from "@/lib/site";
import { opsDbError, UUID } from "@/lib/operations/server";
import { SHARE_PRICING, SHAREABLE_FIELDS, shareContent, type ScopeSection, type ShareField, type SharedPricing, type SharePricing } from "@/lib/operations/scope";
import { loadEstimate } from "@/lib/data/server";
import { computeEstimate } from "@/lib/estimate/engine";
import { approvedSubAmount, type SubQuoteBundle } from "@/lib/operations/sub-quotes";

export const runtime = "nodejs";
const KEYS = SHAREABLE_FIELDS.map((f) => f.key) as [ShareField, ...ShareField[]];
const PRICING = SHARE_PRICING.map((x) => x.key) as [SharePricing, ...SharePricing[]];
const schema = z.object({
  shareId: z.string().regex(UUID).optional(), resourceId: z.string().regex(UUID).nullable().optional(),
  fields: z.array(z.enum(KEYS)).min(1).max(KEYS.length), photoIds: z.array(z.string().regex(UUID)).max(30).default([]),
  days: z.number().int().min(1).max(180).default(60), preview: z.boolean().optional(), pricing: z.enum(PRICING).default("none"), includePhotos: z.boolean().default(false),
});

/**
 * Share a scope section with a subcontractor: only the selected fields (never internal notes or any
 * cost unless the contractor explicitly picks a pricing option they're allowed to see) are frozen into
 * a new share version. Margin, markup, the customer price and other sections are never shared. "preview" returns exactly what they'll see without
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
    supabase.from("estimates").select("title, project_address, user_id, customer_name, customer_phone, customer_email").eq("id", sec.estimate_id).maybeSingle(),
    supabase.from("project_schedules").select("id").eq("estimate_id", sec.estimate_id).neq("status", "archived").maybeSingle(),
    p.data.resourceId ? supabase.from("pm_resources").select("name").eq("id", p.data.resourceId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  let dates: { start: string; end: string } | null = null;
  if (sched?.id && p.data.fields.includes("schedule")) {
    const { data: t } = await supabase.from("schedule_tasks").select("planned_start, planned_end").eq("schedule_id", sched.id).eq("source_group_id", sec.source_group_id).eq("kind", "section").is("split_from", null).maybeSingle();
    if (t) dates = { start: t.planned_start as string, end: t.planned_end as string };
  }
  let pricing: SharedPricing | null = null;
  if (p.data.pricing !== "none") {
    const { data: b } = await supabase.rpc("sub_quotes_for_estimate", { p_estimate_id: sec.estimate_id });
    const bundle = b as SubQuoteBundle | null;
    if (!bundle?.canView) return fail(403, "forbidden", "You need permission to see subcontractor costs to share pricing.");
    if (p.data.pricing === "approved") {
      const amount = approvedSubAmount(bundle.quotes, sec.source_group_id, p.data.resourceId ?? null);
      if (!amount) return fail(400, "no_approved_amount", "There's no accepted subcontractor quote for this section yet. Accept one in Internal costs, or share a proposed budget.");
      pricing = { kind: "approved", amount };
    } else {
      const est = await loadEstimate(supabase, sec.estimate_id);
      const g = est ? computeEstimate(est.estimate).groups[sec.source_group_id] : undefined;
      if (!g || g.cost.lte(0)) return fail(400, "no_budget", "This section has no estimated cost to share as a budget.");
      pricing = { kind: "budget", amount: g.cost.toFixed(2) };
    }
  }
  const { data: prof } = await supabase.from("business_profiles").select("company_name").eq("user_id", e?.user_id ?? user.id).maybeSingle();
  const content = shareContent(sec, p.data.fields, { projectTitle: (e?.title as string) || "Project", siteAddress: e?.project_address as string | null, dates, company: (prof?.company_name as string) || "", assignee: (res.data as { name?: string } | null)?.name ?? null,
    customer: { name: e?.customer_name as string | null, phone: e?.customer_phone as string | null, email: e?.customer_email as string | null }, pricing });
  let photoIds = p.data.photoIds;
  if (p.data.includePhotos && !photoIds.length) {
    const { data: ph } = await supabase.from("project_photos").select("id").eq("scope_section_id", sectionId).is("archived_at", null).limit(30);
    photoIds = ((ph ?? []) as { id: string }[]).map((x) => x.id);
  }
  if (p.data.preview) return json({ preview: content, photoCount: photoIds.length });

  const token = p.data.shareId ? null : newSigningToken();
  const { data, error } = await supabase.rpc("scope_share_publish", {
    p_section_id: sectionId, p_share_id: p.data.shareId ?? null, p_resource_id: p.data.resourceId ?? null, p_token_hash: token ? hashSigningToken(token) : null,
    p_content: content, p_photo_ids: photoIds, p_days: p.data.days,
  });
  if (error) {
    const m = opsDbError(error);
    if (m.status === 500) logError("scope.share", error);
    return fail(m.status, m.code, m.code === "forbidden" ? "You need “Share subcontractor scopes” for this project." : error.message.includes("bad_photo") ? "Only photos attached to this section can be shared." : m.message);
  }
  return json({ ...(data as object), url: token ? `${site.url}/scope/${token}` : null }, 201);
}
