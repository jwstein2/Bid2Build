import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applySectionTrades, proposalConfigFrom, roundTotalFrom, rowToBusiness, rowToProjectProfile, rowsToEstimate, worksheetFrom } from "./mappers";

export async function loadEstimate(supabase: SupabaseClient, id: string) {
  const [{ data: e, error }, { data: groups }, { data: items }, { data: profile }] = await Promise.all([
    supabase.from("estimates").select("*").eq("id", id).maybeSingle(),
    supabase.from("estimate_groups").select("*").eq("estimate_id", id).order("sort_order"),
    supabase.from("estimate_items").select("*").eq("estimate_id", id).order("sort_order"),
    // Tolerates the table not existing yet (migration not applied): profile is just empty.
    supabase.from("estimate_project_profiles").select("sector, work_type, project_type, measurements, outcome").eq("estimate_id", id).maybeSingle(),
  ]);
  if (error || !e) return null;
  // Section trades are stored in proposal_config.worksheet (no schema change) and restored onto the sections.
  const estimate = applySectionTrades(rowsToEstimate(e, groups ?? [], items ?? []), worksheetFrom(e.proposal_config));
  estimate.projectProfile = rowToProjectProfile(profile);
  if (roundTotalFrom(e.proposal_config)) estimate.roundTotal = true;
  return { estimate, proposalConfig: proposalConfigFrom(e.proposal_config), customerId: e.customer_id as string | null };
}

export async function loadBusiness(supabase: SupabaseClient, userId: string, opts: { signedLogo?: boolean } = {}) {
  const { data } = await supabase.from("business_profiles").select("*").eq("user_id", userId).maybeSingle();
  const b = rowToBusiness(data);
  if (opts.signedLogo !== false && b.logoPath) {
    const { data: signed } = await supabase.storage.from("logos").createSignedUrl(b.logoPath, 3600);
    b.logoUrl = signed?.signedUrl ?? null;
  }
  return { business: b, exists: Boolean(data) };
}
