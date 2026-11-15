import type { AccountFact, Segment } from "./model";
import { SEGMENTS } from "./model";
import { ACCOUNT_CLASSES } from "./classify";
import { str } from "./view";

type SP = Record<string, string | string[] | undefined>;
export const PAGE_SIZE = 50;

export interface CustomerFilters { q: string; segment: Segment | ""; plan: "" | "paying" | "complimentary" | "free" | "canceled"; activated: "" | "yes" | "no"; cls: string; sort: "signup" | "activity" | "bids" | "name"; page: number }

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
  };
}

export const planOf = (f: AccountFact): CustomerFilters["plan"] => (f.paying ? "paying" : f.comp ? "complimentary" : f.everPaid ? "canceled" : "free");
export const PLAN_LABEL: Record<Exclude<CustomerFilters["plan"], "">, string> = { paying: "Paying", complimentary: "Complimentary", free: "Free", canceled: "Canceled" };

export function planText(f: AccountFact): string {
  if (f.paying) return `${f.sub?.plan === "annual" ? "Annual" : f.sub?.plan === "enterprise" ? "Enterprise" : "Monthly"}${f.pastDue ? " · past due" : f.sub?.cancel_at_period_end ? " · canceling" : ""}`;
  if (f.comp) return `Comp ${f.comp.plan === "enterprise" ? "Enterprise" : "Unlimited"}`;
  return f.everPaid ? "Canceled" : "Free";
}

const ts = (s: string | null) => (s ? Date.parse(s) : 0);

export function filterCustomers(facts: AccountFact[], f: CustomerFilters): AccountFact[] {
  const out = facts.filter((x) => {
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
