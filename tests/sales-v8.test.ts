import { describe, expect, it } from "vitest";
import { cancellationTime } from "@/lib/sales/billing-server";
import { hashInviteToken, isInviteToken, newInviteToken } from "@/lib/sales/invite";
import { safeSalesNext, salesLoginRedirect } from "@/lib/sales/next";
import { DEFAULT_POLICY } from "@/lib/sales/basis";

describe("V8 commission defaults", () => {
  it("uses the owner's rules: 30-day hold without clawback, 90-day link window", () => {
    expect(DEFAULT_POLICY.refund_policy).toBe("hold_30_no_clawback");
    expect(DEFAULT_POLICY.attribution_window_days).toBe(90);
    expect(DEFAULT_POLICY.annual_basis).toBe("monthly_list");
    expect(DEFAULT_POLICY.commission_years).toBe(3);
  });
});

describe("cancellationTime", () => {
  const base = { status: "active", cancel_at_period_end: false, cancel_at: null, canceled_at: null } as const;
  it("is null for an active subscription", () => expect(cancellationTime(base)).toBeNull());
  it("uses Stripe's canceled_at when present", () => {
    expect(cancellationTime({ ...base, canceled_at: 1767225600 })).toBe("2026-01-01T00:00:00.000Z");
  });
  it("counts a scheduled cancel as a cancel request now", () => {
    const t = cancellationTime({ ...base, cancel_at_period_end: true });
    expect(t).not.toBeNull();
    expect(Math.abs(Date.parse(t!) - Date.now())).toBeLessThan(5000);
  });
  it("counts a canceled status", () => expect(cancellationTime({ ...base, status: "canceled" })).not.toBeNull());
});

describe("invite tokens", () => {
  it("are 43 URL-safe characters stored only as a sha256 hash", () => {
    const { token, hash } = newInviteToken();
    expect(isInviteToken(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(hash);
    expect(newInviteToken().token).not.toBe(token);
  });
  it("reject malformed tokens", () => {
    expect(isInviteToken("short")).toBe(false);
    expect(isInviteToken("a".repeat(42) + "/")).toBe(false);
  });
});

describe("sales sign-in return path", () => {
  it("keeps destinations inside the portal", () => {
    expect(safeSalesNext("/sales/leads?q=1")).toBe("/sales/leads?q=1");
    expect(safeSalesNext("/sales")).toBe("/sales");
  });
  it("refuses anything else", () => {
    for (const bad of [null, "", "https://evil.example", "//evil.example", "/salesforce", "/admin", "/sales/login", "/sales/invite/x", "/sales\\..\\x"]) {
      expect(safeSalesNext(bad)).toBe("/sales");
    }
  });
  it("sends signed-out visitors of private pages to login with next", () => {
    expect(salesLoginRedirect("/sales/leads", "?stage=new")).toBe("/sales/login?next=%2Fsales%2Fleads%3Fstage%3Dnew");
    expect(salesLoginRedirect("/sales", "")).toBe("/sales/login");
    expect(salesLoginRedirect("/sales/login", "")).toBeNull();
    expect(salesLoginRedirect("/sales/invite/abc", "")).toBeNull();
    expect(salesLoginRedirect("/pricing", "")).toBeNull();
    expect(salesLoginRedirect("/salesforce", "")).toBeNull();
  });
});
