import { describe, expect, it } from "vitest";
import { ADMIN_TWO_STEP_SETUP, adminLoginRedirect, adminStepUpTarget, adminTwoStepRequired, safeAdminNext } from "@/lib/auth/admin-gate";
import { stepUpExempt } from "@/lib/auth/mfa";

describe("admin sign-in", () => {
  it("sends signed-out visits to any admin page to the admin sign-in and back", () => {
    expect(adminLoginRedirect("/admin", "")).toBe("/admin-login");
    expect(adminLoginRedirect("/admin/customers", "?q=1")).toBe(`/admin-login?next=${encodeURIComponent("/admin/customers?q=1")}`);
    for (const p of ["/administrator", "/admin-login", "/dashboard", "/sales/admin", "/"]) expect(adminLoginRedirect(p, "")).toBeNull();
  });
  it("only returns to admin pages after signing in", () => {
    for (const bad of [null, "", "https://evil.example/admin", "//evil.example/admin", "/dashboard", "/admin\\x", "/admin\nx", "/administrator"]) expect(safeAdminNext(bad)).toBe("/admin");
    expect(safeAdminNext("/admin/costs?x=1")).toBe("/admin/costs?x=1");
  });
  it("requires two-step sign-in unless the owner switches it off", () => {
    expect(adminTwoStepRequired({})).toBe(true);
    expect(adminTwoStepRequired({ ADMIN_REQUIRE_TWO_STEP: "true" })).toBe(true);
    expect(adminTwoStepRequired({ ADMIN_REQUIRE_TWO_STEP: "" })).toBe(true);
    expect(adminTwoStepRequired({ ADMIN_REQUIRE_TWO_STEP: " FALSE " })).toBe(false);
  });
  it("asks for the authenticator code, or to set one up, before the admin area opens", () => {
    expect(adminStepUpTarget({ currentLevel: "aal2", nextLevel: "aal2" })).toBeNull();
    expect(adminStepUpTarget({ currentLevel: "aal1", nextLevel: "aal2" }, "/admin/costs")).toBe(`/auth/mfa?next=${encodeURIComponent("/admin/costs")}`);
    expect(adminStepUpTarget({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(ADMIN_TWO_STEP_SETUP);
    expect(adminStepUpTarget(null)).toBe(ADMIN_TWO_STEP_SETUP);
  });
  it("keeps the admin sign-in page open to a half-signed-in session", () => {
    expect(stepUpExempt("/admin-login")).toBe(true);
    expect(stepUpExempt("/admin")).toBe(false);
  });
});
