import type { AccountFact, Segment } from "./model";
import { SEGMENTS } from "./model";
import { ACCOUNT_CLASSES } from "./classify";
import { str } from "./view";

type SP = Record<string, string | string[] | undefined>;
export const PAGE_SIZE = 50;

/**
 * Drilldown cohorts opened from KPI cards. Each matches its card's definition exactly; the windowed ones
 * use the report's date range. Values are validated against this list (unknown values are ignored).
 */
export const COHORTS = {
  signups: "Signed up in this period",
  activated: "First finalized bid in this period",
  first_bid: "Started a first bid in this period",
  new_paid: "Became paying in this period",
  ended: "Paid subscription ended in this period",
  past_due: "Payment failed (past due)",
  canceling: "Scheduled to cancel at period end",
  ever_paid: "Ever paid (all time)",
  unverified: "Never verified their email",
  repeat: "More than one bid (all time)",
} as const;
export type Cohort = keyof typeof COHORTS;
/** Funnel step reached, applied on top of a cohort (Marketing funnel cards). */
export const STEPS = { first_bid: "started a bid", finalized: "finalized a bid", activated7d: "activated within 7 days", paid: "became paying" } as const;
export type Step = keyof typeof STEPS;
export const SUB_PLANS = ["monthly", "annual", "enterprise"] as const;

export interface CustomerFilters { q: string; segment: Segment | ""; plan: "" | "paying" | "complimentary" | "free" | "canceled"; activated: "" | "yes" | "no"; cls: string; sort: "signup" | "activity" | "bids" | "name"; page: number; cohort: Cohort | ""; step: Step | ""; sub: (typeof SUB_PLANS)[number] | "" }

export function parseCustomerFilters(sp: SP): CustomerFilters {
  const seg = str(sp.segment);
  const plan = str(sp.plan);
  const sort = str(sp.sort);
  return {
    q: str(sp.q).trim().slice(0, 100).toLowerCase(),
    segment: SEGMENTS.some((s) => s.key === seg) ? (seg as Segment) : "",
    plan: (["paying", "complimentary", "free", "canceled"] as const).includes(plan as never) ? (plan as CustomerFilters["plan"]) : "",
    activated: str(sp.activated) === "yes" ? "yes" : str(sp.activated) === "no" ? "no" : "",
    cls: (["all", ...ACCOUNT_CLASSES] as string[]).includes(str(sp.cls)) ? str(sp.cls) : "",
    sort: (["signup", "activity", "bids", "name"] as const).includes(sort as never) ? (sort as CustomerFilters["sort"]) : "signup",
    page: Math.max(1, Math.min(10_000, Number.parseInt(str(sp.page), 10) || 1)),
    cohort: Object.hasOwn(COHORTS, str(sp.cohort)) ? (str(sp.cohort) as Cohort) : "",
    step: Object.hasOwn(STEPS, str(sp.step)) ? (str(sp.step) as Step) : "",
    sub: (SUB_PLANS as readonly string[]).includes(str(sp.sub)) ? (str(sp.sub) as CustomerFilters["sub"]) : "",
  };
}

export const planOf = (f: AccountFact): CustomerFilters["plan"] => (f.paying ? "paying" : f.comp ? "complimentary" : f.everPaid ? "canceled" : "free");
export const PLAN_LABEL: Record<Exclude<CustomerFilters["plan"], "">, string> = { paying: "Paying", complimentary: "Complimentary", free: "Free", canceled: "Canceled" };

export function planText(f: AccountFact): string {
  if (f.paying) return `${f.sub?.plan === "annual" ? "Annual" : f.sub?.plan === "enterprise" ? "Team" : "Monthly"}${f.pastDue ? " · past due" : f.sub?.cancel_at_period_end ? " · canceling" : ""}`;
  if (f.comp) return `Comp ${f.comp.plan === "enterprise" ? "Team" : "Unlimited"}`;
  return f.everPaid ? "Canceled" : "Free";
}

const ts = (s: string | null) => (s ? Date.parse(s) : 0);

const within = (iso: string | null, w: { start: number; end: number }) => { if (!iso) return false; const t = Date.parse(iso); return t >= w.start && t <= w.end; };

export function inCohort(x: AccountFact, c: Cohort, w: { start: number; end: number }): boolean {
  switch (c) {
    case "signups": return within(x.createdAt, w);
    case "activated": return within(x.firstFinalizedAt, w);
    case "first_bid": return within(x.firstEstimateAt, w);
    case "new_paid": return x.everPaid && within(x.paidStartedAt, w);
    case "ended": return within(x.paidEndedAt, w);
    case "past_due": return x.paying && x.pastDue;
    case "canceling": return x.paying && Boolean(x.sub?.cancel_at_period_end);
    case "ever_paid": return x.everPaid;
    case "unverified": return !x.confirmed && Date.parse(x.createdAt) < w.end - 86_400_000;
    case "repeat": return x.estimates > 1;
  }
}

export function reachedStep(x: AccountFact, s: Step): boolean {
  return s === "first_bid" ? Boolean(x.firstEstimateAt) : s === "finalized" ? Boolean(x.firstFinalizedAt) : s === "activated7d" ? Boolean(x.activated7dAt) : x.everPaid;
}

/** `w` is the report window ({start, end} in ms); required for the windowed cohorts. */
export function filterCustomers(facts: AccountFact[], f: CustomerFilters, w: { start: number; end: number } = { start: 0, end: Date.now() }): AccountFact[] {
  const out = facts.filter((x) => {
    if (f.cohort && !inCohort(x, f.cohort, w)) return false;
    if (f.step && !reachedStep(x, f.step)) return false;
    if (f.sub && !(x.paying && x.sub?.plan === f.sub)) return false;
    if (f.cls && f.cls !== "all" && x.cls !== f.cls) return false;
    if (f.segment && x.segment !== f.segment) return false;
    if (f.plan && planOf(x) !== f.plan) return false;
    if (f.activated === "yes" && !x.firstFinalizedAt) return false;
    if (f.activated === "no" && x.firstFinalizedAt) return false;
    if (f.q && !(x.email ?? "").toLowerCase().includes(f.q) && !(x.business ?? "").toLowerCase().includes(f.q)) return false;
    return true;
  });
  out.sort((a, b) => f.sort === "activity" ? ts(b.lastActivityAt) - ts(a.lastActivityAt)
    : f.sort === "bids" ? b.estimates - a.estimates || ts(b.lastActivityAt) - ts(a.lastActivityAt)
    : f.sort === "name" ? (a.business ?? a.email ?? "~").localeCompare(b.business ?? b.email ?? "~")
    : ts(b.createdAt) - ts(a.createdAt));
  return out;
}
