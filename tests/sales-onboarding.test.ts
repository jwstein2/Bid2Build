import { describe, expect, it } from "vitest";
import { onboardingComplete, onboardingSteps } from "@/lib/sales/onboarding";

const base = { visits: 0, certified: false, prefsStatus: "not_started", touches: 0, paidAccounts: 0 };

describe("sales rep onboarding checklist", () => {
  it("starts with only the join step done and every step linked", () => {
    const s = onboardingSteps(base);
    expect(s.map((x) => x.id)).toEqual(["joined", "pay", "academy", "prefs", "share", "lead"]);
    expect(s.filter((x) => x.done).map((x) => x.id)).toEqual(["joined"]);
    expect(s.every((x) => x.href.startsWith("/sales") || x.href === "#referral-link")).toBe(true);
    expect(onboardingComplete(s)).toBe(false);
  });
  it("derives each step from real activity", () => {
    const s = onboardingSteps({ visits: 2, certified: true, prefsStatus: "done", touches: 4, paidAccounts: 0 });
    expect(onboardingComplete(s)).toBe(true);
  });
  it("hides steps for features that aren't on", () => {
    const s = onboardingSteps({ ...base, certified: null, prefsStatus: null });
    expect(s.map((x) => x.id)).toEqual(["joined", "pay", "share", "lead"]);
  });
});
