import { describe, expect, it } from "vitest";
import { checklistSteps, nextStep, type ChecklistFacts } from "../src/lib/onboarding/checklist";

const empty: ChecklistFacts = { companyName: false, logo: false, tourDone: false, bids: 0, sentBids: 0, wonBids: 0, savedItems: 0 };

describe("getting started checklist", () => {
  it("a brand-new account starts at company setup, through the website wizard", () => {
    const s = checklistSteps(empty);
    expect(s.map((x) => x.id)).toEqual(["company", "tour", "first-bid", "saved-items", "send", "win"]);
    expect(s.every((x) => !x.done)).toBe(true);
    expect(nextStep(s)?.id).toBe("company");
    expect(s[0].href).toBe("/welcome");
  });

  it("company needs both a name and a logo, and says which is missing", () => {
    const s = checklistSteps({ ...empty, companyName: true });
    expect(s[0].done).toBe(false);
    expect(s[0].action).toBe("Add your logo");
    expect(checklistSteps({ ...empty, companyName: true, logo: true })[0].done).toBe(true);
  });

  it("Send a proposal continues the latest bid when there is one", () => {
    expect(checklistSteps({ ...empty, bids: 1, latestBidId: "abc" }).find((x) => x.id === "send")?.href).toBe("/estimates/abc?step=proposal");
    expect(checklistSteps(empty).find((x) => x.id === "send")?.href).toBe("/bids");
  });

  it("the tour step opens the tour instead of navigating", () => {
    expect(checklistSteps(empty).find((x) => x.id === "tour")?.opensTour).toBe(true);
  });

  it("a signed bid counts as sent and won even when its pipeline stage is still draft", () => {
    const s = checklistSteps({ ...empty, bids: 1, signingLinks: 1, signedBids: 1 });
    expect(s.find((x) => x.id === "send")?.done).toBe(true);
    expect(s.find((x) => x.id === "win")?.done).toBe(true);
  });

  it("a signing link alone finishes Send but not Win", () => {
    const s = checklistSteps({ ...empty, bids: 1, signingLinks: 1 });
    expect(s.find((x) => x.id === "send")?.done).toBe(true);
    expect(s.find((x) => x.id === "win")?.done).toBe(false);
  });

  it("everything done leaves no next step", () => {
    const s = checklistSteps({ companyName: true, logo: true, tourDone: true, bids: 2, sentBids: 1, wonBids: 1, savedItems: 5 });
    expect(nextStep(s)).toBeNull();
  });
});
