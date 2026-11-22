import { describe, expect, it } from "vitest";
import { biggestDrop, setupFunnel } from "../src/lib/admin/setup-funnel";
import type { AccountFact } from "../src/lib/admin/model";

const base = { confirmed: true, business: null, estimates: 0, finalized: 0, signed: 0, signingRequests: 0, firstMeaningfulAt: null, everPaid: false } as const;
const acct = (createdAt: string, o: Partial<AccountFact> = {}) => ({ ...base, id: createdAt, createdAt, ...o }) as unknown as AccountFact;

describe("setup funnel", () => {
  const now = Date.parse("2026-11-22T00:00:00Z");
  const since = now - 30 * 864e5;
  const facts = [
    acct("2026-11-20T00:00:00Z", { business: "A", estimates: 2, finalized: 1, signed: 1, everPaid: true }),
    acct("2026-11-19T00:00:00Z", { business: "B", estimates: 1 }),
    acct("2026-11-18T00:00:00Z", { confirmed: false }),
    acct("2026-11-17T00:00:00Z"),
    acct("2026-09-01T00:00:00Z", { business: "old", estimates: 9 }), // outside the window
  ];
  it("counts each step for accounts that signed up in the window", () => {
    const s = setupFunnel(facts, since, now);
    expect(s.map((x) => x.count)).toEqual([4, 3, 2, 2, 1, 1, 1, 1]);
    expect(s[1].fromPrev).toBeCloseTo(0.75);
    expect(s[7].fromStart).toBeCloseTo(0.25);
  });
  it("finds the biggest drop", () => {
    expect(biggestDrop(setupFunnel(facts, since, now))?.key).toBe("priced");
  });
  it("empty window has no shares", () => {
    const s = setupFunnel([], since, now);
    expect(s.every((x) => x.count === 0 && (x.fromStart === null))).toBe(true);
  });
});
