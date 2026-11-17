/** Solo Financials add-on: items recognised by lookup key, never mistaken for the plan; price created once. */
import { describe, expect, it, vi } from "vitest";
import { ensureFinSoloPrice, finFromItems, FIN_SOLO_CENTS, FIN_SOLO_LOOKUP, isFinItem } from "@/lib/financials/billing";
import { planInterval } from "@/lib/pm/billing";
import { subscriptionToUpdate, type SubscriptionLike } from "@/lib/billing/sync";

const prices = { monthly: "price_month", annual: "price_year" };
const finItem = { id: "si_fin", current_period_end: 1, price: { id: "price_fin", lookup_key: FIN_SOLO_LOOKUP, recurring: { interval: "month" } } };
const planItem = { id: "si_plan", current_period_end: 1, price: { id: "price_month", lookup_key: null, recurring: { interval: "month" } } };

describe("solo Financials add-on", () => {
  it("recognises the add-on item by lookup key", () => {
    expect(isFinItem(finItem)).toBe(true);
    expect(isFinItem(planItem)).toBe(false);
    expect(finFromItems([planItem, finItem]).addon).toBe(true);
    expect(finFromItems([planItem]).addon).toBe(false);
  });

  it("never treats the add-on as the plan item, whatever the order", () => {
    expect(planInterval([finItem, { ...planItem, price: { ...planItem.price, id: "price_year", recurring: { interval: "year" } } }], {})).toBe("year");
    const sub = {
      id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false, metadata: {},
      items: { data: [{ ...finItem, current_period_end: 2_000_000_000 }, { ...planItem, current_period_end: 2_000_000_000 }] },
    } as unknown as SubscriptionLike;
    expect(subscriptionToUpdate(sub, "u1", 1, prices).p_plan).toBe("monthly");
  });

  it("reuses the existing price and creates it only when missing", async () => {
    const good = { id: "price_ok", unit_amount: FIN_SOLO_CENTS, currency: "usd", recurring: { interval: "month" } };
    const existing = { prices: { list: vi.fn().mockResolvedValue({ data: [good] }), create: vi.fn() } };
    expect(await ensureFinSoloPrice(existing as never)).toBe("price_ok");
    expect(existing.prices.create).not.toHaveBeenCalled();

    const missing = { prices: { list: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn().mockResolvedValue(good) } };
    expect(await ensureFinSoloPrice(missing as never)).toBe("price_ok");
    expect(missing.prices.create).toHaveBeenCalledWith(expect.objectContaining({ unit_amount: 2199, lookup_key: FIN_SOLO_LOOKUP, recurring: { interval: "month" } }), expect.anything());
  });

  it("refuses a price with the wrong amount", async () => {
    const wrong = { prices: { list: vi.fn().mockResolvedValue({ data: [{ id: "p", unit_amount: 999, currency: "usd", recurring: { interval: "month" } }] }), create: vi.fn() } };
    await expect(ensureFinSoloPrice(wrong as never)).rejects.toThrow("fin_price_mismatch");
  });
});
