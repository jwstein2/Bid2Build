import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstimateTotals } from "../estimate/engine";
import type { Estimate } from "../estimate/types";
import { logError } from "../http/api";
import { buildObservation } from "./capture";
import { sanitizeMeasurements } from "./trade-models";

export const CONSENT_POLICY_VERSION = "2026-11-draft";

/** Persist the benchmarking profile next to the estimate (RLS client: the user can only write their own). */
export async function saveProjectProfile(supabase: SupabaseClient, userId: string, estimate: Estimate) {
  const p = estimate.projectProfile;
  if (!p) return;
  const { error } = await supabase.from("estimate_project_profiles").upsert({
    estimate_id: estimate.id,
    user_id: userId,
    sector: p.sector ?? null,
    work_type: p.workType ?? null,
    project_type: p.projectType ?? null,
    measurements: sanitizeMeasurements(estimate.trades[0], p.measurements),
    outcome: p.outcome ?? null,
  }, { onConflict: "estimate_id" });
  // Never fail the user's save over benchmarking metadata (e.g. before the migration is applied).
  if (error) logError("market.profile", error, { user: userId });
}

/**
 * Record a de-identified pricing observation for a finalized version. Best effort: an analytics
 * failure must never break the export. The database decides consent and de-duplicates by version.
 */
export async function captureObservation(admin: SupabaseClient, userId: string, versionId: string, estimate: Estimate, totals: EstimateTotals): Promise<string> {
  try {
    const { data: consent } = await admin.from("market_consent").select("share_prices, share_costs").eq("user_id", userId).maybeSingle();
    if (!consent?.share_prices) return "no_consent";
    const payload = buildObservation(estimate, totals, estimate.projectProfile, { sharePrices: true, shareCosts: Boolean(consent.share_costs) });
    const { data, error } = await admin.rpc("market_capture", { p_user_id: userId, p_version_id: versionId, p_payload: payload });
    if (error) throw error;
    return String(data);
  } catch (e) {
    logError("market.capture", e, { user: userId });
    return "error";
  }
}
