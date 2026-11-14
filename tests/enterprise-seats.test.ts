import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSeatTarget, licensedUsers, monthlyChange, seatItemUpdates } from "@/lib/enterprise/seats";

const SEAT = "price_seat";
const base = { id: "si_base", price: { id: "price_base" }, quantity: 1 };
const seat = (q: number) => ({ id: "si_seat", price: { id: SEAT }, quantity: q });

describe("Enterprise seat changes", () => {
  it("counts licensed users as 3 + seat quantity", () => {
    expect(licensedUsers([base], SEAT)).toBe(3);
    expect(licensedUsers([base, seat(7)], SEAT)).toBe(10);
  });

  it("adds the seat item when buying the 4th user, updates it after, deletes it back at 3", () => {
    expect(seatItemUpdates([base], SEAT, 4)).toEqual([{ price: SEAT, quantity: 1 }]);
    expect(seatItemUpdates([base, seat(1)], SEAT, 25)).toEqual([{ id: "si_seat", quantity: 22 }]);
    expect(seatItemUpdates([base, seat(2)], SEAT, 3)).toEqual([{ id: "si_seat", deleted: true }]);
    expect(seatItemUpdates([base], SEAT, 3)).toEqual([]);
  });

  it("never goes below seats in use (active users + pending invitations) or the 3 included", () => {
    expect(checkSeatTarget(5, 8, 6)).toMatchObject({ ok: false, code: "below_in_use" });
    expect(checkSeatTarget(6, 8, 6)).toEqual({ ok: true });
    expect(checkSeatTarget(2, 5, 1)).toMatchObject({ ok: false, code: "invalid" });
    expect(checkSeatTarget(5, 5, 1)).toMatchObject({ ok: false, code: "unchanged" });
    expect(checkSeatTarget(4.5, 5, 1)).toMatchObject({ ok: false, code: "invalid" });
  });

  it("shows the monthly difference from the central price table", () => {
    expect(monthlyChange(3, 4)).toEqual({ beforeCents: 4999, afterCents: 6998, deltaCents: 1999 });
    expect(monthlyChange(10, 11)).toMatchObject({ deltaCents: 1599 });
    expect(monthlyChange(6, 5)).toMatchObject({ deltaCents: -1799 });
  });
});

describe("Enterprise live-checkout switch", () => {
  afterEach(() => vi.unstubAllEnvs());
  const setPrices = (key: string) => {
    vi.stubEnv("STRIPE_SECRET_KEY", key);
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "p1");
    vi.stubEnv("STRIPE_PRICE_ANNUAL", "p2");
    vi.stubEnv("STRIPE_PRICE_ENTERPRISE_BASE", "p3");
    vi.stubEnv("STRIPE_PRICE_ENTERPRISE_SEAT", "p4");
  };
  it("is on in test mode once both prices exist", async () => {
    const { isEnterpriseConfigured } = await import("@/lib/env");
    setPrices("sk_test_x");
    expect(isEnterpriseConfigured()).toBe(true);
    vi.stubEnv("STRIPE_PRICE_ENTERPRISE_SEAT", "");
    expect(isEnterpriseConfigured()).toBe(false);
  });
  it("stays off with live keys until ENTERPRISE_CHECKOUT_LIVE=true", async () => {
    const { isEnterpriseConfigured } = await import("@/lib/env");
    setPrices("sk_live_x");
    vi.stubEnv("STRIPE_ALLOW_LIVE", "true");
    expect(isEnterpriseConfigured()).toBe(false);
    vi.stubEnv("ENTERPRISE_CHECKOUT_LIVE", "true");
    expect(isEnterpriseConfigured()).toBe(true);
    setPrices("rk_live_x");
    vi.stubEnv("ENTERPRISE_CHECKOUT_LIVE", "");
    expect(isEnterpriseConfigured()).toBe(false);
  });
});
