/**
 * Academy Advanced: the three learning packages and the founding-member price ladder (pure, client-safe).
 *
 * The database (academy_adv_price_stages, academy_adv_prices) is authoritative for what anyone is charged. This
 * module only describes the packages, formats prices and holds the pure rules shared by the server and the tests.
 */
export const ADV_PLANS = ["one_subject", "two_subjects", "all_access"] as const;
export type AdvPlan = (typeof ADV_PLANS)[number];
export const isAdvPlan = (v: unknown): v is AdvPlan => typeof v === "string" && (ADV_PLANS as readonly string[]).includes(v);

export type Stage = {
  stage: number;
  min_members: number;
  max_members: number | null;
  one_subject_cents: number;
  two_subjects_cents: number;
  all_access_cents: number;
  min_published_lessons: number;
  approved_at?: string | null;
};

/** The owner-approved ladder (V10.0). Mirrors the seed in 20270303001000; the database copy wins. */
export const DEFAULT_STAGES: Stage[] = [
  { stage: 1, min_members: 1, max_members: 10, one_subject_cents: 999, two_subjects_cents: 1499, all_access_cents: 2999, min_published_lessons: 12 },
  { stage: 2, min_members: 11, max_members: 25, one_subject_cents: 1299, two_subjects_cents: 1799, all_access_cents: 3499, min_published_lessons: 24 },
  { stage: 3, min_members: 26, max_members: 50, one_subject_cents: 1499, two_subjects_cents: 2099, all_access_cents: 3999, min_published_lessons: 36 },
  { stage: 4, min_members: 51, max_members: 100, one_subject_cents: 1799, two_subjects_cents: 2499, all_access_cents: 4499, min_published_lessons: 48 },
  { stage: 5, min_members: 101, max_members: null, one_subject_cents: 1999, two_subjects_cents: 2999, all_access_cents: 4999, min_published_lessons: 60 },
];

export const PLAN_META: Record<AdvPlan, { name: string; short: string; tagline: string; subjects: number | "all"; software: boolean; includes: string[] }> = {
  one_subject: {
    name: "Learn one subject", short: "One subject", tagline: "Just this subject.", subjects: 1, software: false,
    includes: ["Every published lesson in this subject", "New lessons in this subject while you're a member", "Exercises, quizzes and progress tracking", "Course badges"],
  },
  two_subjects: {
    name: "Learn + expand", short: "Two subjects", tagline: "This subject plus the best next one.", subjects: 2, software: false,
    includes: ["Everything in both subjects", "New lessons in both while you're a member", "Exercises, quizzes and progress tracking", "Course badges"],
  },
  all_access: {
    name: "Academy All Access + Estimator", short: "All Access + Estimator", tagline: "Every advanced course plus one Individual Unlimited seat.", subjects: "all", software: true,
    includes: ["Every advanced course, now and as new ones publish", "One Built2Bid Individual Unlimited seat for you", "Practice lessons inside the real estimator", "One account, one monthly payment"],
  },
};

/** What All Access does NOT include (shown wherever the package is sold). Written to read mid-sentence: never lowercase it (proper nouns). */
export const ALL_ACCESS_EXCLUDES = [
  "Team or Enterprise plans, extra staff seats or Enterprise reporting",
  "separately billed add-ons (for example Project Command Center or Financials add-ons)",
  "payment processing, banking or other third-party fees",
  "AI use beyond the limits that come with Individual Unlimited",
];

/** "$9.99" */
export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function stagePrice(stage: Pick<Stage, "one_subject_cents" | "two_subjects_cents" | "all_access_cents">, plan: AdvPlan): number {
  return plan === "one_subject" ? stage.one_subject_cents : plan === "two_subjects" ? stage.two_subjects_cents : stage.all_access_cents;
}

/**
 * Subjects a package covers. New members: the selected subject (+ its recommended partner). Upgraders from One
 * subject: the subject they own + the one they opened.
 */
export function subjectsFor(plan: AdvPlan, selected: string, partner: string | null, owned: string[] = []): string[] | null {
  if (plan === "all_access") return [];
  if (plan === "one_subject") return [selected];
  const second = owned.find((s) => s !== selected) ?? partner;
  if (!second || second === selected) return null;
  return [selected, second];
}

export type Access = { all_access: boolean; subjects: string[]; software: boolean; plan: AdvPlan | null; sources: string[]; staff: boolean };
export const NO_ACCESS: Access = { all_access: false, subjects: [], software: false, plan: null, sources: [], staff: false };

export const hasSubject = (a: Access, subject: string) => a.all_access || a.subjects.includes(subject);

/**
 * Which of the three options to show someone who opened `subject`:
 * - already has it (or All Access) -> none, go straight in;
 * - otherwise the three options, minus "Learn + expand" when there's no purchasable partner, and with
 *   upgrade flags for people who already pay for a smaller Academy package.
 */
export function pickerOptions(a: Access, subject: string, partner: string | null): { enter: boolean; plans: AdvPlan[]; upgrade: boolean } {
  if (hasSubject(a, subject)) return { enter: true, plans: [], upgrade: false };
  const plans: AdvPlan[] = [];
  const paying = a.plan !== null;
  if (!paying) {
    plans.push("one_subject");
    if (partner && partner !== subject) plans.push("two_subjects");
  } else if (a.plan === "one_subject") {
    // Upgrade: their current subject plus this one. (Two subjects -> the honest next step is All Access.)
    plans.push("two_subjects");
  }
  plans.push("all_access");
  return { enter: false, plans, upgrade: paying };
}

/** Recommended package: Learn + expand when a partner exists (V10.0 default), else All Access for upgraders. */
export function recommendedPlan(plans: AdvPlan[]): AdvPlan | null {
  if (plans.includes("two_subjects")) return "two_subjects";
  return plans[0] ?? null;
}

/**
 * Admin recommendation for the next pricing stage. Both readiness criteria must hold: the qualifying-member
 * threshold of the current stage is reached, and the published library meets the next stage's lesson minimum.
 */
export function stageRecommendation(stages: Stage[], current: number, qualifying: number, publishedLessons: number) {
  const cur = stages.find((s) => s.stage === current) ?? stages[0];
  const next = stages.find((s) => s.stage === current + 1) ?? null;
  const membersNeeded = cur.max_members === null ? null : Math.max(0, cur.max_members - qualifying);
  const membersReady = cur.max_members !== null && qualifying >= cur.max_members;
  const libraryReady = Boolean(next && publishedLessons >= next.min_published_lessons);
  return {
    current: cur, next, membersNeeded, membersReady, libraryReady,
    lessonsNeeded: next ? Math.max(0, next.min_published_lessons - publishedLessons) : null,
    recommend: Boolean(next && membersReady && libraryReady),
  };
}

/** Monthly revenue change for new members if the next stage were approved (per new member, per package). */
export function stageDelta(cur: Stage, next: Stage) {
  return ADV_PLANS.map((p) => ({ plan: p, from: stagePrice(cur, p), to: stagePrice(next, p), pct: Math.round(((stagePrice(next, p) - stagePrice(cur, p)) / stagePrice(cur, p)) * 100) }));
}

/** Stripe metadata marker on every Academy Checkout session and subscription. */
export const ACADEMY_PRODUCT_LINE = "academy_advanced";

/** True for subscription/session metadata written by Academy checkout. */
export function isAcademyMeta(meta: Record<string, string> | null | undefined): boolean {
  return meta?.product_line === ACADEMY_PRODUCT_LINE;
}

/** Stripe lookup key for a price (used by the idempotent provisioning). */
export function priceLookupKey(plan: AdvPlan, stage: number, interval: "month" | "year" = "month") {
  return `b2b_academy_${plan}_s${stage}_${interval}`;
}

/** Fixed Stripe product ids (custom ids make provisioning idempotent: retrieve, else create). */
export const PRODUCT_IDS: Record<AdvPlan, string> = {
  one_subject: "prod_b2bAcademyOneSubject",
  two_subjects: "prod_b2bAcademyTwoSubjects",
  all_access: "prod_b2bAcademyAllAccess",
};
export const PRODUCT_NAMES: Record<AdvPlan, string> = {
  one_subject: "Built2Bid Academy — One Subject",
  two_subjects: "Built2Bid Academy — Two Subjects",
  all_access: "Built2Bid Academy — All Access + Estimator",
};
