import { describe, expect, it } from "vitest";
import { clampEditors, teamEstimate } from "../src/lib/enterprise/team-estimate";
import { formatCents } from "../src/lib/enterprise/pricing";

describe("Team pricing preview (licensed users + schedule editors)", () => {
  // Totals from the live Stripe prices: base $49.99, seats graduated 2@19.99 / 5@17.99 / inf@15.99, editors $1.99 beyond 1.
  it.each([
    [3, 1, "$49.99", "$49.99"],
    [4, 1, "$69.98", "$69.98"],
    [5, 3, "$93.95", "$89.97"],
    [6, 1, "$107.96", "$107.96"],
    [10, 10, "$197.83", "$179.92"],
    [11, 1, "$195.91", "$195.91"],
  ])("%i users, %i editors -> %s (checkout %s)", (users, editors, total, checkout) => {
    const e = teamEstimate(users, editors);
    expect(formatCents(e.totalCents)).toBe(total);
    expect(formatCents(e.checkoutCents)).toBe(checkout);
    expect(e.totalCents).toBe(e.baseCents + e.extraUsersCents + e.extraEditorsCents);
  });

  it("5 users, 3 editors breaks down like the spec example", () => {
    const e = teamEstimate(5, 3);
    expect([e.baseCents, e.extraUsers, e.extraUsersCents, e.extraEditors, e.extraEditorsCents]).toEqual([4999, 2, 3998, 2, 398]);
  });

  it("editors stay between 1 and the number of licensed users", () => {
    expect(clampEditors(0, 3)).toBe(1);
    expect(clampEditors(7, 5)).toBe(5);
    expect(clampEditors(Number.NaN, 5)).toBe(1);
    expect(teamEstimate(4, 9).editors).toBe(4);
  });

  it("users never go below the 3 included", () => {
    expect(teamEstimate(1, 1).users).toBe(3);
  });

  it("without Project Command Center, editors are ignored", () => {
    expect(teamEstimate(5, 3, { includeEditors: false }).totalCents).toBe(8997);
  });
});
