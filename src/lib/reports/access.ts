import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPremiumAccess } from "@/lib/billing/entitlement";
import { can, loadMyCompany } from "@/lib/enterprise/server";

export type ReportAccess =
  | { ok: true; ownerId: string }
  | { ok: false; status: 401 | 402 | 403 | 404; code: "not_authenticated" | "upgrade_required" | "forbidden" | "not_found"; message: string };

/**
 * Who may preview, download or email an Internal Estimate Report (cost, markup, margin, profit):
 *   1. signed in, and the estimate is readable under RLS (own bid, or a company bid you may see);
 *   2. a paid entitlement: library_access() (Standard Unlimited, Enterprise, complimentary, admin);
 *   3. company bids also need BOTH "View underlying costs" and "View gross margin" company permissions.
 * Enforced on every request in the route; the button state in the builder is only a hint.
 */
export async function internalReportAccess(supabase: SupabaseClient, userId: string | null, estimateId: string): Promise<ReportAccess> {
  if (!userId) return { ok: false, status: 401, code: "not_authenticated", message: "Sign in required." };
  const { data: est } = await supabase.from("estimates").select("id, user_id, company_id").eq("id", estimateId).maybeSingle();
  if (!est) return { ok: false, status: 404, code: "not_found", message: "Estimate not found." };
  if (!(await hasPremiumAccess(supabase)))
    return { ok: false, status: 402, code: "upgrade_required", message: "The Internal Estimate Report is included with Unlimited and Enterprise." };
  if (est.company_id) {
    const company = await loadMyCompany(supabase);
    if (!company || company.id !== est.company_id || !can(company, "view_costs") || !can(company, "view_margin"))
      return { ok: false, status: 403, code: "forbidden", message: "Your company role can't open internal cost reports. Ask your company owner for the View underlying costs and View gross margin permissions." };
  } else if (est.user_id !== userId) {
    return { ok: false, status: 404, code: "not_found", message: "Estimate not found." };
  }
  return { ok: true, ownerId: est.user_id as string };
}
