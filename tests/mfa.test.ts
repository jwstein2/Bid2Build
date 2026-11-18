import { describe, expect, it } from "vitest";
import { needsStepUp, stepUpExempt } from "@/lib/auth/mfa";

describe("two-step sign-in", () => {
  it("asks for the authenticator only when the account has one and the session passed just the email code", () => {
    expect(needsStepUp({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
    expect(needsStepUp({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
    expect(needsStepUp({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
    expect(needsStepUp(null)).toBe(false);
  });
  it("keeps sign-in, customer signing links and legal pages open", () => {
    for (const p of ["/auth/mfa", "/auth/signout", "/login", "/sign/abc", "/exempt/xyz", "/privacy", "/security", "/api/health"]) expect(stepUpExempt(p)).toBe(true);
    for (const p of ["/dashboard", "/financials/banks", "/api/financials/tax-banking", "/settings/account", "/signed/1"]) expect(stepUpExempt(p)).toBe(false);
  });
});
