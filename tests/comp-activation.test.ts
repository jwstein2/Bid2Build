import { describe, expect, it } from "vitest";
import { activationFor, followUpMailto } from "@/lib/comp/activation";
import type { CompRow } from "@/lib/comp/grants";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const row = (over: Partial<CompRow> = {}): CompRow => ({
  id: "g1", email: "pro@example.com", user_id: "u1", plan: "unlimited", state: "active", status: "active", duration_days: 30, included_seats: 1, extra_seats: 0,
  company_id: null, starts_at: day(10), expires_at: new Date(NOW + 20 * 86_400_000).toISOString(), paused_at: null, activated_at: day(10), invite_expires_at: null,
  invite_sent_at: day(11), invite_send_count: 1, note: null, created_at: day(11), revoked_at: null, revoke_reason: null, granted_by_email: null, account_name: "Pro Co",
  last_activity_at: day(1), paid_now: false, converted: false, ...over,
});

describe("complimentary activation", () => {
  it("flags invitations nobody accepted", () => {
    const a = activationFor(row({ state: "pending", user_id: null, invite_sent_at: day(4), last_activity_at: null }), null, NOW);
    expect(a.activation).toBe("invite_pending");
    expect(a.followUp).toBe(true);
    expect(activationFor(row({ state: "pending", user_id: null, invite_sent_at: day(1) }), null, NOW).followUp).toBe(false);
  });
  it("flags accepted accounts that never started a bid", () => {
    const a = activationFor(row(), null, NOW);
    expect(a.activation).toBe("not_started");
    expect(a.reason).toMatch(/no bid started/);
  });
  it("active users with a bid need nothing; inactive ones do", () => {
    expect(activationFor(row(), { at: day(9), count: 3 }, NOW)).toMatchObject({ activation: "active", followUp: false, daysLeft: 20 });
    expect(activationFor(row({ last_activity_at: day(20) }), { at: day(9), count: 1 }, NOW)).toMatchObject({ activation: "inactive", followUp: true });
  });
  it("flags access ending soon unless they already pay", () => {
    const soon = row({ expires_at: new Date(NOW + 3 * 86_400_000).toISOString() });
    expect(activationFor(soon, { at: day(9), count: 2 }, NOW).reason).toMatch(/ends in 3 days/);
    expect(activationFor({ ...soon, paid_now: true }, { at: day(9), count: 2 }, NOW).followUp).toBe(false);
  });
  it("ended grants are never flagged", () => {
    expect(activationFor(row({ state: "expired" }), null, NOW)).toMatchObject({ activation: "ended", followUp: false });
  });
  it("builds a mailto for the owner's own email app", () => {
    const r = row();
    const m = followUpMailto(r, activationFor(r, null, NOW), "https://built2bid.org");
    expect(m.startsWith("mailto:pro%40example.com?subject=")).toBe(true);
    expect(decodeURIComponent(m)).toContain("https://built2bid.org/bids");
  });
});
