import { describe, expect, it } from "vitest";
import { enterpriseSeats, subscriptionToUpdate, type SubscriptionLike } from "@/lib/billing/sync";

const prices = { monthly: "price_month", annual: "price_year", enterpriseBase: "price_ent_base", enterpriseSeat: "price_ent_seat" };
const end = Math.floor(Date.now() / 1000) + 86400 * 30;
const ent = (seatQty: number | null, over: Partial<SubscriptionLike> = {}): SubscriptionLike => ({
  id: "sub_ent", customer: "cus_1", status: "active", cancel_at_period_end: false, canceled_at: null, ended_at: null,
  metadata: { user_id: "11111111-1111-1111-1111-111111111111", company_name: "Acme" },
  items: {
    data: [
      { current_period_end: end, quantity: 1, price: { id: "price_ent_base", recurring: { interval: "month" } } },
      ...(seatQty === null ? [] : [{ current_period_end: end, quantity: seatQty, price: { id: "price_ent_seat", recurring: { interval: "month" } } }]),
    ],
  },
  ...over,
});

describe("Enterprise Stripe subscription mapping", () => {
  it("base only = 3 licensed users", () => {
    expect(enterpriseSeats(ent(null), prices)).toBe(3);
  });
  it("seat item quantity is added to the 3 included users", () => {
    expect(enterpriseSeats(ent(197), prices)).toBe(200);
    expect(enterpriseSeats(ent(0), prices)).toBe(3);
  });
  it("maps to an enterprise update tied to the company", () => {
    const u = subscriptionToUpdate(ent(7), "u1", 1700000000, prices, "c1");
    expect(u).toMatchObject({ p_plan: "enterprise", p_price_id: "price_ent_base", p_seat_quantity: 10, p_company_id: "c1", p_status: "active" });
  });
  it("individual plans are untouched and never carry a company", () => {
    const s: SubscriptionLike = { ...ent(null), items: { data: [{ current_period_end: end, price: { id: "price_month", recurring: { interval: "month" } } }] } };
    const u = subscriptionToUpdate(s, "u1", 1, prices, "c1");
    expect(u).toMatchObject({ p_plan: "monthly", p_company_id: null, p_seat_quantity: null });
  });
  it("without Enterprise prices configured nothing is treated as Enterprise", () => {
    expect(enterpriseSeats(ent(5), { monthly: "price_month", annual: "price_year" })).toBeNull();
  });
});
