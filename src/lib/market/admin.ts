import "server-only";
import { requireAdmin } from "../admin/server";
import type { Filters } from "./filters";

export type Summary =
  | { n: number; contributors: number; suppressed: true; reason: "no_data" | "min_contributors" }
  | { n: number; contributors: number; suppressed: false; p25: number; median: number; p75: number; mean: number; mad: number; iqr: number };

export interface ReportMeta {
  coverage?: never; view: string; filters: Filters; dataset: "real" | "synthetic"; min_contributors: number; precise_confidence: number; generated_at: string }
export type TrendPoint = { month: string; stats: Summary };

/** Run an admin report: authorizes, records the view in the audit log, and returns the JSON. */
export async function loadReport<T>(view: string, filters: Filters): Promise<{ data: (T & { meta: ReportMeta; coverage: Coverage }) | null; error: string | null; userId: string }> {
  const { user, db } = await requireAdmin();
  const p = { ...filters };
  await db.rpc("market_log_view", { p_caller: user.id, p_view: view, p_filters: p });
  const { data, error } = await db.rpc("market_report", { p_caller: user.id, p_view: view, p_filters: p });
  if (error) return { data: null, error: /does not exist|schema cache/.test(error.message) ? "not_migrated" : "failed", userId: user.id };
  return { data: data as T & { meta: ReportMeta; coverage: Coverage }, error: null, userId: user.id };
}

export interface Coverage { bids: number; contributors: number; date_from: string | null; date_to: string | null; freshest: string | null }
