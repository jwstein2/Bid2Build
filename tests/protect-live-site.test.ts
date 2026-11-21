/** Stripe test-mode guard for deployed copies, and the Supabase backup summary. */
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isLiveKey, isTestAccount, isTestKey, testCheckoutBlocked } from "@/lib/billing/test-mode";
import { summarizeBackups } from "@/lib/monitoring/backups";

describe("Stripe test-mode checkout guard", () => {
  const preview = { NEXT_PUBLIC_DEPLOY_CONTEXT: "deploy-preview" };
  it("recognizes key modes", () => {
    expect(isTestKey("sk_test_abc")).toBe(true);
    expect(isTestKey("rk_test_abc")).toBe(true);
    expect(isTestKey("sk_live_abc")).toBe(false);
    expect(isLiveKey("rk_live_abc")).toBe(true);
    expect(isLiveKey("")).toBe(false);
  });
  it("blocks real accounts on a deployed copy with a test key", () => {
    expect(testCheckoutBlocked("sk_test_x", "customer@gmail.com", preview)).toBe(true);
    expect(testCheckoutBlocked("sk_test_x", null, preview)).toBe(true);
    expect(testCheckoutBlocked("sk_test_x", "customer@gmail.com", { CONTEXT: "branch-deploy" })).toBe(true);
    expect(testCheckoutBlocked("sk_test_x", "customer@gmail.com", { CONTEXT: "production" })).toBe(true);
  });
  it("allows test accounts", () => {
    expect(testCheckoutBlocked("sk_test_x", "stripe-test-1@built2bid.test", preview)).toBe(false);
    const env = { ...preview, STRIPE_TEST_CHECKOUT_EMAILS: " Owner+Test@Example.com , qa@example.com" };
    expect(isTestAccount("owner+test@example.com", env)).toBe(true);
    expect(testCheckoutBlocked("sk_test_x", "QA@example.com", env)).toBe(false);
    expect(testCheckoutBlocked("sk_test_x", "owner@example.com", env)).toBe(true);
  });
  it("never applies to live keys or local development", () => {
    expect(testCheckoutBlocked("sk_live_x", "customer@gmail.com", preview)).toBe(false);
    expect(testCheckoutBlocked("sk_test_x", "customer@gmail.com", {})).toBe(false);
  });
});

describe("summarizeBackups", () => {
  const now = Date.parse("2026-11-20T23:00:00Z");
  it("reads the newest completed backup", () => {
    const s = summarizeBackups({ pitr_enabled: false, backups: [
      { status: "COMPLETED", inserted_at: "2026-11-19T03:10:00.000Z" },
      { status: "COMPLETED", inserted_at: "2026-11-20T03:10:00" },
      { status: "FAILED", inserted_at: "2026-11-18T03:10:00Z" },
      { status: "FAILED", inserted_at: "2026-11-01T03:10:00Z" },
    ] }, now);
    expect(s).toMatchObject({ latestAt: "2026-11-20T03:10:00.000Z", ageHours: 19.8, completed: 2, failedLast7Days: 1, pitr: false, stale: false });
  });
  it("uses physical backup data when present", () => {
    const s = summarizeBackups({ backups: [], physical_backup_data: { latest_physical_backup_date_unix: Date.parse("2026-11-20T12:00:00Z") / 1000 } }, now);
    expect(s.latestAt).toBe("2026-11-20T12:00:00.000Z");
    expect(s.stale).toBe(false);
  });
  it("flags missing or old backups", () => {
    expect(summarizeBackups({}, now)).toMatchObject({ latestAt: null, stale: true });
    expect(summarizeBackups({ backups: [{ status: "COMPLETED", inserted_at: "2026-11-18T03:00:00Z" }] }, now).stale).toBe(true);
    expect(summarizeBackups(null, now).stale).toBe(true);
  });
});
