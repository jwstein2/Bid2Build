import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jobStatus, type JobStatus } from "./project-status";
import { missingMigration } from "./server";

export interface QueueItem {
  estimateId: string; status: "needs_review" | "reviewed"; approvalSource: "signature" | "manual"; approvedAt: string;
  reviewedAt: string | null; reviewedBy: string | null; reviewNote: string | null; companyId: string | null; ownerId: string;
  title: string; customerName: string | null; number: string; trades: string[]; stage: string; scheduleId: string | null; scheduleStatus: string | null;
  canReview: boolean; jobStatus: JobStatus | null;
}

/** "Newly Approved — Needs Review" queue (null before the V4.3 SQL runs). Same data on every entry point. */
export async function loadReviewQueue(supabase: SupabaseClient): Promise<QueueItem[] | null> {
  const { data, error } = await supabase.rpc("project_review_queue");
  if (error) { if (!missingMigration(error)) console.error(JSON.stringify({ level: "error", scope: "review.queue", code: error.code })); return null; }
  return ((data ?? []) as Omit<QueueItem, "jobStatus">[]).map((r) => ({ ...r, trades: r.trades ?? [], jobStatus: jobStatus({ stage: r.stage, reviewStatus: r.status, scheduleStatus: r.scheduleStatus }) }));
}
