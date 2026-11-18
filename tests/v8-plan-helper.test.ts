import { describe, expect, it } from "vitest";
import { recommendPlan } from "@/lib/marketing/plan-helper";
import { ANNUAL, MONTHLY, formatUsd } from "@/lib/billing/plans";

describe("pricing plan helper", () => {
  it("suggests Free for about one bid a month, solo, no scheduling", () => {
    expect(recommendPlan({ bids: "one", people: "solo", schedule: false }, true)).toMatchObject({ plan: "free", addPcc: false, anchor: "#plans" });
  });
  it("suggests Unlimited for regular bidders", () => {
    expect(recommendPlan({ bids: "few", people: "solo", schedule: false }, true)).toMatchObject({ plan: "unlimited", addPcc: false });
    expect(recommendPlan({ bids: "many", people: "solo", schedule: false }, true).plan).toBe("unlimited");
  });
  it("adds Project Command Center only when it is live", () => {
    expect(recommendPlan({ bids: "one", people: "solo", schedule: true }, true)).toMatchObject({ plan: "unlimited", addPcc: true });
    expect(recommendPlan({ bids: "one", people: "solo", schedule: true }, false)).toMatchObject({ plan: "free", addPcc: false });
  });
  it("suggests Enterprise for two or more people", () => {
    const r = recommendPlan({ bids: "one", people: "team", schedule: true }, true);
    expect(r).toMatchObject({ plan: "enterprise", anchor: "#enterprise" });
    expect(r.why).toMatch(/schedule editor is included/);
    expect(recommendPlan({ bids: "many", people: "team", schedule: true }, false).why).not.toMatch(/schedule/);
  });
  it("annual savings in dollars come from the approved prices", () => {
    expect(formatUsd(MONTHLY.amountCents * 12 - ANNUAL.amountCents)).toBe("$90.88");
  });
});
