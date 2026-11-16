import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { contractSummary, type ChangeOrderLike } from "@/lib/operations/contract";
import { missingMigration, UUID } from "@/lib/operations/server";
import { loadOwnerBusiness, loadStylePolicy } from "@/lib/operations/style-server";
import type { SubQuoteBundle } from "@/lib/operations/sub-quotes";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/**
 * Everything the bid builder needs for project operations, in one call: line-item subcontractor
 * quotes (only for people allowed to see sub costs), the Team directory, the company style policy and
 * the approved contract value. Before the V4.3/V4.4 SQL runs this returns { available: false }.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Bid not found.");
  const supabase = await createClient();
  const { data: est } = await supabase.from("estimates").select("id, company_id, pipeline_stage").eq("id", id).maybeSingle();
  if (!est) return fail(404, "not_found", "Bid not found.");

  const [quotes, history, policy, resources] = await Promise.all([
    supabase.rpc("sub_quotes_for_estimate", { p_estimate_id: id }),
    supabase.rpc("project_proposal_history", { p_estimate_id: id }),
    loadStylePolicy(supabase, id),
    supabase.from("pm_resources").select("id, name, kind, trades").eq("status", "active").order("name").limit(500),
  ]);
  if (missingMigration(quotes.error)) return json({ available: false });
  if (quotes.error) logError("ops.quotes", quotes.error);

  const bundle = (quotes.data ?? null) as SubQuoteBundle | null;
  const h = history.data as null | { approval: { versionId: string; source: string; total: number } | null; changeOrders: (ChangeOrderLike & { id: string })[];
    permissions: { create: boolean; send: boolean; accepted: boolean }; versions: { id: string; number: number }[] };

  let ownerBrand: { companyName: string; logoUrl: string | null; primaryColor: string; secondaryColor: string; logoLayout: string; headerStyle: string;
    phone?: string; email?: string; address?: string; website?: string; licenseNumber?: string; tagline?: string } | null = null;
  if (policy?.managed && policy.style && (policy.style as { companyBranding?: boolean }).companyBranding && policy.companyOwnerId) {
    try {
      const b = await loadOwnerBusiness(createAdminClient(), policy.companyOwnerId, { signedLogo: true });
      if (b) ownerBrand = { companyName: b.companyName, logoUrl: b.logoUrl ?? null, primaryColor: b.primaryColor, secondaryColor: b.secondaryColor, logoLayout: b.logoLayout,
        headerStyle: b.headerStyle, phone: b.phone, email: b.email, address: b.address, website: b.website, licenseNumber: b.licenseNumber, tagline: b.tagline };
    } catch (e) { logError("ops.brand", e); }
  }

  return json({
    available: true,
    stage: est.pipeline_stage,
    subQuotes: bundle?.canView ? bundle : bundle ? { canView: false, canRecord: false, canApply: false, quotes: [], adjustments: [] } : null,
    resources: bundle?.canView ? (resources.data ?? []) : [],
    stylePolicy: policy,
    ownerBrand,
    contract: h ? {
      accepted: h.permissions.accepted, canCreate: h.permissions.create, canSend: h.permissions.send,
      approval: h.approval ? { ...h.approval, versionNumber: h.versions.find((v) => v.id === h.approval!.versionId)?.number ?? null } : null,
      summary: h.approval ? contractSummary(h.approval.total, h.changeOrders) : null,
      changeOrderCount: h.changeOrders.length,
    } : null,
  });
}
