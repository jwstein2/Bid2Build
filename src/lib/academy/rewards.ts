/**
 * Academy monthly challenge: "Learn More. Build Better. Earn a Free Month." Pure types and display helpers shared by the
 * Academy pages, the profile card, the admin view and tests. Every rule is enforced in Postgres
 * (supabase/migrations/20270223001000_academy_rewards.sql); nothing here decides eligibility.
 */

export const CHALLENGE_TRAININGS = 4;
export const CHALLENGE_QUESTIONS = 20;
export const CHALLENGE_PASS = 16;
export const CHALLENGE_MIN_POOL = 25;
export const CHALLENGE_REWARD_VALUE = "$19.99";

export type QuizStatus = "not_started" | "in_progress" | "passed" | "failed";
export type RewardStatus = "pending" | "applying" | "applied" | "review" | "failed" | "declined";

export interface ChallengeTraining { course_id: string; title: string; slug: string; completed_at: string; fast: boolean }
export interface ChallengeMonth {
  month: string;
  trainings: ChallengeTraining[];
  trainings_done: number;
  quiz_status: QuizStatus;
  quiz_pass: { attempt_id: string; correct: number; finished_at: string; topic: string } | null;
  quiz_latest: { correct: number; finished_at: string; passed: boolean } | null;
  open_attempt: string | null;
  qualified: boolean;
}
export interface ChallengeReward {
  id: string; status: RewardStatus; action: "comp_days" | "stripe_credit" | null; month: string; qualified_at: string;
  activates_at: string | null; expires_at: string | null; applied_at: string | null; credit_cents: number | null;
}
export interface ChallengeStatus {
  month: ChallengeMonth;
  total_trainings: number;
  available_trainings: number;
  quizzes_passed: number;
  excluded: string | null;
  reward: ChallengeReward | null;
  email_used: boolean;
  milestones: { badge: string; label: string; awarded_at: string }[];
  history: { month: string; trainings: number }[];
  topics: { slug: string; title: string; pool: number }[];
}

export interface ChallengeQuestion { id: string; prompt: string; options: string[] }
export interface ChallengeAttempt { attempt_id: string; topic: string; started_at: string; expires_at: string; questions: ChallengeQuestion[]; resumed: boolean }
export interface ChallengeResult {
  correct: number; total: number; passed: boolean; expired: boolean; pass_correct: number;
  review: { id: string; picked: number | null; correct: number; explanation: string | null; citation: string | null }[];
  claim: { state: string; status?: RewardStatus; action?: string | null; reason?: string } | null;
}

/** The one-line state of the lifetime reward, phrased from the learner's actual records. */
export type RewardPhase = "available" | "unavailable" | "earned_processing" | "earned_review" | "earned_active" | "earned_scheduled" | "claimed";

export function rewardPhase(s: Pick<ChallengeStatus, "reward" | "excluded" | "email_used">, now = new Date()): RewardPhase {
  const r = s.reward;
  if (!r) return s.excluded || s.email_used ? "unavailable" : "available";
  if (r.status === "review" || r.status === "failed") return "earned_review";
  if (r.status === "pending" || r.status === "applying") return "earned_processing";
  if (r.status === "declined") return "claimed";
  if (r.action === "comp_days" && r.activates_at && r.expires_at) {
    if (new Date(r.activates_at) > now) return "earned_scheduled";
    if (new Date(r.expires_at) > now) return "earned_active";
  }
  return "claimed";
}

export function rewardHeadline(phase: RewardPhase): string {
  switch (phase) {
    case "available": return "Reward: 1 Free Month of Individual Unlimited";
    case "unavailable": return "Reward not available on this account";
    case "earned_processing": return "Earned! Your free month is being added";
    case "earned_review": return "Earned! Our team is applying your free month";
    case "earned_active": return "Earned: your free month is active";
    case "earned_scheduled": return "Earned: your free month is scheduled";
    case "claimed": return "Earned: Lifetime Reward Claimed";
  }
}

export const quizLabel: Record<QuizStatus, string> = { not_started: "Not started", in_progress: "In progress", passed: "Passed", failed: "Not passed yet" };

/** Overall challenge progress, 0-100: each training is one fifth, the passed quiz the last fifth. */
export function challengePercent(m: Pick<ChallengeMonth, "trainings_done" | "quiz_status">): number {
  const steps = Math.min(m.trainings_done, CHALLENGE_TRAININGS) + (m.quiz_status === "passed" ? 1 : 0);
  return Math.round((steps / (CHALLENGE_TRAININGS + 1)) * 100);
}

export function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function shortDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

/** Days left in the current UTC month, counting today. */
export function daysLeftInMonth(now = new Date()): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((end - now.getTime()) / 86_400_000));
}

const ERRORS: Record<string, string> = {
  rate_limited: "You've started 5 challenge quizzes in the last 24 hours. Please try again tomorrow.",
  topic_too_small: "That topic doesn't have enough questions yet. Please pick another topic.",
  bad_topic: "Please pick a quiz topic.",
  already_submitted: "That quiz was already submitted.",
  not_found: "That quiz could not be found. Please start a new one.",
  not_authenticated: "Please sign in to take the challenge quiz.",
};
export function challengeError(message: string | undefined | null): string {
  const key = Object.keys(ERRORS).find((k) => (message ?? "").includes(k));
  return key ? ERRORS[key] : "Something went wrong. Please try again.";
}

export const REVIEW_REASONS: Record<string, string> = {
  suspicious_activity: "Very fast course or quiz: check before applying",
  enterprise_member: "Enterprise account: no Enterprise discount or seats",
  billing_issue: "Past-due or unpaid subscription",
  annual_subscriber: "Annual plan: no automatic annual extension",
  monthly_credit_needs_approval: "Monthly subscriber: Stripe credit switch is off",
  unknown_plan: "Unrecognized plan",
  no_subscription: "No subscription found for a credit",
};
