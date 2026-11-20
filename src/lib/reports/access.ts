import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPremiumAccess } from "@/lib/billing/entitlement";
import { can, loadMyCompany } from "@/lib/enterprise/server";

export type ReportAccess =
  | { ok: true; ownerId: string; companyId: string | null; canDownload: boolean; canSend: boolean }
  | { ok: false; status: 401 | 402 | 403 | 404; code: "not_authenticated" | "upgrade_required" | "forbidden" | "not_found"; message: string };

/**
 * Who may preview, download or email an Internal Estimate Report (cost, markup, margin, profit):
 *   1. signed in, and the estimate is readable under RLS (own bid, or a company bid you may see);
 *   2. a paid entitlement: library_access() (Standard Unlimited, Enterprise, complimentary, admin);
 *   3. company bids also need "View underlying costs", "View gross margin" and "View internal reports";
 *      downloading needs "Download internal reports" and emailing needs "Send internal financial documents"
 *      (V4 Phase 9). Personal bids: the owner may do all three.
 * Enforced on every request in the route; the button state in the builder is only a hint.
 */
export async function internalReportAccess(supabase: SupabaseClient, userId: string | null, estimateId: string): Promise<ReportAccess> {
  if (!userId) return { ok: false, status: 401, code: "not_authenticated", message: "Sign in required." };
  const { data: est } = await supabase.from("estimates").select("id, user_id, company_id").eq("id", estimateId).maybeSingle();
  if (!est) return { ok: false, status: 404, code: "not_found", message: "Estimate not found." };
  if (!(await hasPremiumAccess(supabase)))
    return { ok: false, status: 402, code: "upgrade_required", message: "The Internal Estimate Report is included with Individual Unlimited and Team." };
  if (est.company_id) {
    const company = await loadMyCompany(supabase);
    if (!company || company.id !== est.company_id || !can(company, "view_costs") || !can(company, "view_margin") || !can(company, "view_internal_reports"))
      return { ok: false, status: 403, code: "forbidden", message: "Your company role can't open internal cost reports. Ask your company owner for the View underlying costs, View gross margin and View internal reports permissions." };
    return { ok: true, ownerId: est.user_id as string, companyId: est.company_id as string, canDownload: can(company, "download_internal_reports"), canSend: can(company, "send_internal_reports") };
  } else if (est.user_id !== userId) {
    return { ok: false, status: 404, code: "not_found", message: "Estimate not found." };
  }
  return { ok: true, ownerId: est.user_id as string, companyId: null, canDownload: true, canSend: true };
}
