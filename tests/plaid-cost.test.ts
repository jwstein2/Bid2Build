import { describe, expect, it } from "vitest";
import { parsePrice, plaidUsage } from "@/lib/admin/plaid-cost";

const now = new Date("2026-12-11T00:00:00Z"); // 10 days into a 31-day month
const c = (status: string, disc: string | null = null) => ({ id: `${status}-${disc}`, status, created_at: "2026-11-01T00:00:00Z", disconnected_at: disc });

describe("plaid cost estimate", () => {
  it("parses prices and keeps blanks unknown", () => {
    expect(parsePrice("0.30")).toBeCloseTo(30);
    expect(parsePrice("$0.10")).toBeCloseTo(10);
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
  });
  it("counts connections live this month and projects balance calls", () => {
    const conns = [c("active"), c("needs_reauth"), c("disconnected", "2026-12-05T00:00:00Z"), c("disconnected", "2026-11-20T00:00:00Z")];
    const u = plaidUsage(conns, 20, { transactionsCents: 30, balanceCents: 10 }, now);
    expect(u.billableItems).toBe(3);
    expect(u.activeItems).toBe(2);
    expect(u.needsAttention).toBe(1);
    expect(u.projectedBalanceCalls).toBe(62);
    expect(u.mtdCents).toBe(3 * 30 + 20 * 10);
    expect(u.projectedCents).toBe(3 * 30 + 62 * 10);
  });
  it("never counts a missing price as zero", () => {
    expect(plaidUsage([c("active")], 5, { transactionsCents: null, balanceCents: 10 }, now).mtdCents).toBeNull();
  });
});
