/**
 * The approved-job flow (V4.3): Approved/Signed → Needs PM Review → Ready to Schedule → Scheduled →
 * In Progress → Completed. Derived from the pipeline stage, the review row and the schedule status, so
 * every entry point (Bids, Projects, the PM dashboard) shows the same thing.
 */
export type JobStatus = "needs_review" | "ready_to_schedule" | "draft_schedule" | "scheduled" | "in_progress" | "completed";

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  needs_review: "Newly approved — needs review", ready_to_schedule: "Ready to schedule", draft_schedule: "Draft schedule",
  scheduled: "Scheduled", in_progress: "In progress", completed: "Completed",
};

export function jobStatus(input: { stage: string | null; reviewStatus?: "needs_review" | "reviewed" | null; scheduleStatus?: string | null }): JobStatus | null {
  const { stage, reviewStatus, scheduleStatus } = input;
  if (stage === "completed" || scheduleStatus === "completed") return "completed";
  // Owner rule (2026-11-17): a job is In Progress as soon as scheduling is complete (the schedule is
  // published) and it has a start date (every schedule has one). Publishing also moves the stage.
  if (scheduleStatus === "active") return "in_progress";
  // A job moved to In Progress by hand while its schedule is still a draft hasn't finished scheduling.
  if (scheduleStatus === "draft") return reviewStatus === "needs_review" ? "needs_review" : "draft_schedule";
  if (stage === "in_progress") return "in_progress";
  // When the caller knows the schedule (null = none, as in the review queue), a pipeline stage set to
  // Scheduled by hand doesn't count: the job still needs a schedule. Only fall back to the stage when
  // the schedule is unknown (undefined).
  if (stage === "scheduled" && scheduleStatus === undefined) return "scheduled";
  if (reviewStatus === "needs_review") return "needs_review";
  if (scheduleStatus === "draft") return "draft_schedule";
  if (stage === "won" || stage === "scheduled" || reviewStatus === "reviewed") return "ready_to_schedule";
  return null;
}
