import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { computeEstimate } from "@/lib/estimate/engine";
import type { Estimate } from "@/lib/estimate/types";
import { customerExclusions, customerScope, normalizeExclusions, normalizeScope } from "@/lib/proposal/text-sections";
import { tradeName } from "@/lib/trades/catalog";
import { UUID } from "@/lib/operations/server";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ estimateId: string }> };

/**
 * The review screen for one newly approved job: approved proposal (version, total, signer), scope,
 * sections, notes, customer, trades and attachments. Cost and margin are included ONLY for people
 * allowed to see costs on this bid.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { estimateId: id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Project not found.");
  const supabase = await createClient();
  const { data: e } = await supabase.from("estimates").select("id, title, estimate_number, customer_name, customer_email, customer_phone, project_address, customer_notes, trades, pipeline_stage, company_id, user_id").eq("id", id).maybeSingle();
  if (!e) return fail(404, "not_found", "Project not found.");
  const [hist, costs, photos, quotes, review] = await Promise.all([
    supabase.rpc("project_proposal_history", { p_estimate_id: id }),
    supabase.rpc("estimate_permission", { p_estimate_id: id, p_permission: "view_costs" }),
    supabase.from("project_photos").select("id", { count: "exact", head: true }).eq("estimate_id", id).is("archived_at", null),
    supabase.from("subcontractor_quotes").select("id", { count: "exact", head: true }).eq("estimate_id", id),
    supabase.from("project_reviews").select("status, approval_source, approved_at, reviewed_at, reviewed_by, review_note").eq("estimate_id", id).maybeSingle(),
  ]);
  const h = hist.data as null | { approval: { versionId: string; source: string; total: number } | null; versions: { id: string; number: number; signatures: { signerName: string; signedAt: string }[] }[] };
  const approved = h?.approval ? h.versions.find((v) => v.id === h.approval!.versionId) : null;
  let scope: string | null = null, exclusions: string | null = null, sections: { name: string; trade: string | null; price: string; cost?: string }[] = [], financials: null | { cost: string; price: string; profit: string; margin: string | null } = null;
  if (h?.approval) {
    const { data: v } = await supabase.from("estimate_versions").select("snapshot").eq("id", h.approval.versionId).maybeSingle();
    const snap = v?.snapshot as { estimate?: Estimate; proposalConfig?: { scopeOfWork?: string; scope?: unknown; exclusionList?: unknown } } | undefined;
    if (snap?.estimate) {
      const cfg = snap.proposalConfig ?? {};
      scope = customerScope(cfg.scopeOfWork ?? "", normalizeScope(cfg.scope)) ?? null;
      exclusions = customerExclusions(normalizeExclusions(cfg.exclusionList, "")) ?? null;
      const t = computeEstimate(snap.estimate);
      const canCost = costs.data === true;
      sections = snap.estimate.groups.filter((g) => t.groups[g.id]?.itemCount).sort((a, b) => a.sortOrder - b.sortOrder)
        .map((g) => ({ name: g.name || "Section", trade: g.trade ? tradeName(g.trade) : null, price: t.groups[g.id].price.toFixed(2), ...(canCost ? { cost: t.groups[g.id].cost.toFixed(2) } : {}) }));
      if (canCost) financials = { cost: t.totalCost.toFixed(2), price: t.subtotal.toFixed(2), profit: t.grossProfit.toFixed(2), margin: t.grossMargin ? t.grossMargin.toDecimalPlaces(1).toFixed(1) : null };
    }
  }
  return json({
    estimate: { id: e.id, title: e.title, number: e.estimate_number, stage: e.pipeline_stage, trades: ((e.trades as string[]) ?? []).map(tradeName), notes: (e.customer_notes as string | null) ?? null },
    customer: { name: e.customer_name, email: e.customer_email, phone: e.customer_phone, projectAddress: e.project_address },
    approval: h?.approval ? { ...h.approval, versionNumber: approved?.number ?? null, signedBy: approved?.signatures[0]?.signerName ?? null, signedAt: approved?.signatures[0]?.signedAt ?? null } : null,
    review: review.data ?? null, scope, exclusions, sections, financials,
    attachments: { photos: photos.count ?? 0, subQuotes: quotes.count ?? 0 },
  });
}
