import { describe, expect, it } from "vitest";
import { creditStatusFrom, creditsAvailable, exportMessage, monthlyHint, type CreditStatus } from "@/lib/credits/status";

const base: CreditStatus = { starter: 2, starterTotal: 3, monthly: 0, monthlyEligible: true, nextCycleAt: "2027-03-31T10:00:00.000Z", unlimited: false, emailVerified: true, starterGranted: true };
const fmt = () => "Mar 31";

describe("credit status helpers", () => {
  it("maps the database row and keeps the balances separate", () => {
    const s = creditStatusFrom([{ starter_balance: 3, starter_total: 3, monthly_balance: 1, monthly_eligible: true, next_cycle_at: "2027-03-31 10:00:00+00", unlimited: false, email_verified: true, starter_granted: true }]);
    expect(s).toMatchObject({ starter: 3, monthly: 1, nextCycleAt: "2027-03-31T10:00:00.000Z" });
    expect(creditsAvailable(s!)).toBe(4);
    expect(creditStatusFrom(null)).toBeNull();
    expect(creditsAvailable({ ...base, unlimited: true })).toBe(Infinity);
  });

  it("explains when the monthly credit expires or arrives", () => {
    expect(monthlyHint({ ...base, monthly: 1 }, fmt)).toBe("Ready now. Use it by Mar 31; it doesn't roll over.");
    expect(monthlyHint(base, fmt)).toBe("Used this cycle. Your next one arrives Mar 31.");
    expect(monthlyHint({ ...base, monthlyEligible: false }, fmt)).toBe("Your first free monthly bid arrives Mar 31.");
  });

  it("describes which credit an export used", () => {
    expect(exportMessage("monthly", 1, { starter: 3, monthly: 0, unlimited: false })).toMatch(/free monthly bid\. 3 starter credits left/);
    expect(exportMessage("starter", 1, { starter: 1, monthly: 0, unlimited: false })).toBe("Bid finalized with 1 starter credit. 1 starter credit left.");
    expect(exportMessage("already_counted", 3, { starter: 0, monthly: 0, unlimited: false })).toMatch(/always free/);
    expect(exportMessage("existing_version", 2, { starter: 0, monthly: 0, unlimited: false })).toMatch(/No credit used/);
    expect(exportMessage("unlimited", 4, { starter: 3, monthly: 0, unlimited: true })).toBe("Proposal version 4 exported.");
  });
});
