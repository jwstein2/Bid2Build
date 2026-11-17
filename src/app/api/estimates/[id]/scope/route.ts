import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import type { Estimate } from "@/lib/estimate/types";
import { tradeName } from "@/lib/trades/catalog";
import { missingMigration, opsDbError, UUID } from "@/lib/operations/server";
import type { SubQuoteBundle } from "@/lib/operations/sub-quotes";
import { latestRevision } from "@/lib/operations/sub-quotes";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/**
 * Trade scope workspace for one project: sections built from the approved scope, assignees from the
 * Team directory, shares, and (for people who may see sub costs) the line-item subcontractor quotes
 * that carry forward into each section.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Project not found.");
  const supabase = await createClient();
  const [sections, canManage, canShare, shares, resources, quotes, photos] = await Promise.all([
    supabase.from("project_scope_sections").select("*").eq("estimate_id", id).order("sort_order"),
    supabase.rpc("can_manage_project_scope", { p_estimate_id: id }),
    supabase.rpc("can_share_project_scope", { p_estimate_id: id }),
    supabase.rpc("project_scope_shares", { p_estimate_id: id }),
    supabase.from("pm_resources").select("id, name, kind, email, phone, trades, company_id, owner_id").eq("status", "active").order("name").limit(500),
    supabase.rpc("sub_quotes_for_estimate", { p_estimate_id: id }),
    supabase.from("project_photos").select("id, scope_section_id").eq("estimate_id", id).is("archived_at", null).not("scope_section_id", "is", null),
  ]);
  if (missingMigration(sections.error)) return json({ available: false });
  if (sections.error) { logError("scope.list", sections.error); return fail(500, "server_error", "We couldn't load the scope."); }
  const b = quotes.data as SubQuoteBundle | null;
  const byGroup: Record<string, { itemName: string; vendorName: string; resourceId: string | null; latest: string | null; status: string }[]> = {};
  if (b?.canView) for (const q of b.quotes) {
    if (!q.groupId || q.status === "rejected") continue;
    const last = latestRevision(q);
    (byGroup[q.groupId] ??= []).push({ itemName: q.itemName, vendorName: q.vendorName, resourceId: q.resourceId, latest: last ? Number(last.amount).toFixed(2) : null, status: q.status });
  }
  const photoCount: Record<string, number> = {};
  for (const p of (photos.data ?? []) as { scope_section_id: string }[]) photoCount[p.scope_section_id] = (photoCount[p.scope_section_id] ?? 0) + 1;
  // Offer only directory entries the save will accept: the project's company directory, or the solo
  // owner's own directory. (RLS can return both to a company member; picking the wrong one used to fail
  // silently and snap back to "Unassigned".)
  const first = (sections.data ?? [])[0] as { company_id: string | null; user_id: string } | undefined;
  type Res = { id: string; name: string; kind: string; email: string | null; phone: string | null; trades: string[] | null; company_id: string | null; owner_id: string | null };
  const assignable = ((resources.data ?? []) as Res[])
    .filter((r) => !first || (first.company_id ? r.company_id === first.company_id : !r.company_id && r.owner_id === first.user_id))
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, email: r.email, phone: r.phone, trades: r.trades ?? [] }));
  return json({
    available: true, sections: sections.data ?? [], canManage: canManage.data === true, canShare: canShare.data === true,
    shares: shares.data ?? [], resources: assignable, quotesByGroup: byGroup, showCosts: Boolean(b?.canView), photoCount,
  });
}

const initSchema = z.object({ action: z.literal("init") });

/** Build (or top up) the workspace from the APPROVED version's sections. Existing sections are kept. */
export async function POST(req: Request, ctx: Ctx) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("scope-init", 30, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id) || !initSchema.safeParse(await req.json().catch(() => null)).success) return fail(400, "invalid", "Invalid request.");
  const supabase = await createClient();
  const { data: h, error: he } = await supabase.rpc("project_proposal_history", { p_estimate_id: id });
  if (he || !h) return fail(404, "not_found", "Project not found.");
  const approval = (h as { approval: { versionId: string } | null }).approval;
  if (!approval) return fail(409, "not_accepted", "Build the scope workspace after the proposal is approved or signed.");
  const { data: v } = await supabase.from("estimate_versions").select("snapshot").eq("id", approval.versionId).maybeSingle();
  const est = (v?.snapshot as { estimate?: Estimate } | undefined)?.estimate;
  if (!est) return fail(409, "no_snapshot", "The approved version couldn't be read.");
  const sections = [...est.groups].sort((a, b) => a.sortOrder - b.sortOrder).map((g, i) => {
    const items = est.items.filter((it) => it.groupId === g.id && !it.isExample);
    const lines = [g.description?.trim(), ...items.map((it) => `• ${it.name}${it.description ? ` — ${it.description}` : ""}`)].filter(Boolean).join("\n");
    return { sourceGroupId: g.id, trade: g.trade ?? est.trades[0] ?? null, title: `${g.trade ? `${tradeName(g.trade)}: ` : ""}${g.name || "Section"}`.slice(0, 200), sortOrder: i, approvedScope: lines.slice(0, 8000) };
  }).filter((s) => s.approvedScope);
  const { data, error } = await supabase.rpc("project_scope_init", { p_estimate_id: id, p_version_id: approval.versionId, p_sections: sections });
  if (error) {
    const m = opsDbError(error);
    if (m.status === 500) logError("scope.init", error);
    return fail(m.status, m.code, m.code === "forbidden" ? "You need schedule edit access on this project to build its scope." : m.message);
  }
  return json({ created: data as number });
}
