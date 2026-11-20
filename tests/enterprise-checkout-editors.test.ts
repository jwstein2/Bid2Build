/**
 * Team checkout carries the pricing calculator's licensed users AND schedule editors into Stripe
 * Checkout, against a fake Stripe + fake database (no network, no real charges).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  pmEditorBilling: true,
  created: [] as { params: Record<string, unknown>; key?: string }[],
};
const prices: Record<string, unknown> = {
  price_base: { active: true, currency: "usd", unit_amount: 4999, recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } },
  price_seat: { active: true, currency: "usd", unit_amount: null, billing_scheme: "tiered", tiers_mode: "graduated", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    tiers: [{ up_to: 2, unit_amount: 1999, flat_amount: null }, { up_to: 7, unit_amount: 1799, flat_amount: null }, { up_to: null, unit_amount: 1599, flat_amount: null }] },
  price_editor: { active: true, currency: "usd", unit_amount: 199, recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } },
};
const fakeStripe = {
  prices: { retrieve: vi.fn(async (id: string) => prices[id]) },
  customers: { create: vi.fn(async () => ({ id: "cus_1" })) },
  subscriptions: { list: vi.fn(async () => ({ data: [] })) },
  checkout: { sessions: {
    list: vi.fn(async () => ({ data: [] })), expire: vi.fn(),
    create: vi.fn(async (params: Record<string, unknown>, opts?: { idempotencyKey?: string }) => { state.created.push({ params, key: opts?.idempotencyKey }); return { id: "cs_1", status: "open", url: "https://checkout.stripe.com/c/pay/cs_1" }; }),
  } },
};
const admin = {
  from: vi.fn(() => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null }), insert: async () => ({ error: null }) };
    return q;
  }),
};
vi.mock("@/lib/supabase/server", () => ({ getUser: async () => ({ id: "00000000-0000-4000-8000-0000000000aa", email: "o@example.test", verified: true }), createAdminClient: () => admin }));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: () => fakeStripe, assertModeAllowed: () => {} }));
vi.mock("@/lib/billing/apply", () => ({ applySubscription: async () => ({}) }));
vi.mock("@/lib/billing/tax", () => ({ checkoutTaxParams: () => ({}) }));
vi.mock("@/lib/env", () => ({
  isEnterpriseConfigured: () => true,
  isPmBillingConfigured: () => state.pmEditorBilling,
  serverEnv: () => ({ stripePriceEnterpriseBase: "price_base", stripePriceEnterpriseSeat: "price_seat", stripePricePmEditor: "price_editor", stripePricePmAddon: "", stripePricePmAddonAnnual: "" }),
}));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true, rateLimit: async () => true }));

const { POST } = await import("@/app/api/stripe/enterprise-checkout/route");
const call = async (body: unknown) => {
  const r = await POST(new Request("http://localhost/api/stripe/enterprise-checkout", { method: "POST", body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const lineItems = () => state.created.at(-1)!.params.line_items;

beforeEach(() => { state.pmEditorBilling = true; state.created = []; });

describe("Team checkout with schedule editors", () => {
  it("5 users, 3 editors -> base + 2 seats + 2 editor items", async () => {
    const r = await call({ companyName: "Acme", users: 5, editors: 3 });
    expect(r.status).toBe(200);
    expect(lineItems()).toEqual([{ price: "price_base", quantity: 1 }, { price: "price_seat", quantity: 2 }, { price: "price_editor", quantity: 2 }]);
    expect((state.created.at(-1)!.params.metadata as Record<string, string>).schedule_editors).toBe("3");
  });

  it("1 editor (the included one) adds no editor item", async () => {
    await call({ companyName: "Acme", users: 4, editors: 1 });
    expect(lineItems()).toEqual([{ price: "price_base", quantity: 1 }, { price: "price_seat", quantity: 1 }]);
  });

  it("no editors field behaves exactly like before", async () => {
    await call({ companyName: "Acme", users: 3 });
    expect(lineItems()).toEqual([{ price: "price_base", quantity: 1 }]);
  });

  it("refuses more editors than licensed users", async () => {
    const r = await call({ companyName: "Acme", users: 3, editors: 4 });
    expect(r.status).toBe(400);
    expect(state.created).toHaveLength(0);
  });

  it("refuses extra editors when editor billing is off, instead of dropping them silently", async () => {
    state.pmEditorBilling = false;
    const r = await call({ companyName: "Acme", users: 5, editors: 2 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("editors_unavailable");
  });

  it("refuses when the Stripe editor price drifts from $1.99", async () => {
    prices.price_editor = { ...(prices.price_editor as object), unit_amount: 299 };
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000); // past the 10-minute price cache
    const r = await call({ companyName: "Acme", users: 5, editors: 2, attempt: "attempt-drift-1" });
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe("pricing_mismatch");
    prices.price_editor = { ...(prices.price_editor as object), unit_amount: 199 };
    vi.restoreAllMocks();
  });
});
