/**
 * Pricing page plan helper (MKT-4): three questions that only recommend a plan. It never starts
 * checkout or stores answers; the result links to the matching card on the same page.
 */
export type BidsPerMonth = "one" | "few" | "many";
export type People = "solo" | "team";
export interface HelperAnswers { bids: BidsPerMonth; people: People; schedule: boolean }
export interface HelperResult { plan: "free" | "unlimited" | "enterprise"; addPcc: boolean; anchor: "#plans" | "#enterprise"; why: string }

export function recommendPlan(a: HelperAnswers, pccLive: boolean): HelperResult {
  const pcc = a.schedule && pccLive;
  if (a.people === "team") {
    return { plan: "enterprise", addPcc: false, anchor: "#enterprise", why: pcc
      ? "Each person gets their own login with unlimited bidding, and one schedule editor is included."
      : "Each person gets their own login with unlimited bidding, managed from one company account." };
  }
  if (a.bids === "one" && !pcc) {
    return { plan: "free", addPcc: false, anchor: "#plans", why: "Your starter bids plus one free bid every month should cover you. Drafts are always free." };
  }
  return { plan: "unlimited", addPcc: pcc, anchor: "#plans", why: pcc
    ? "Unlimited bids, plus the Project Command Center add-on to schedule crews and subcontractors."
    : "You'd run out of free bids quickly. Unlimited lets you finalize as many as you need." };
}
