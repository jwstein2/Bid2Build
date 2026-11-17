/**
 * Enterprise licensed-user changes: adding is prorated and charged now; removing is never credited
 * (paid periods are non-refundable) and the lower price starts with the next invoice. Fake Stripe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SEAT = "price_ent_seat";
const S = {
  items: [] as unknown[],
  updates: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
  previewLines: [] as unknown[],
};
const fakeStripe = {
  subscriptions: {
    retrieve: async () => ({ id: "sub_1", metadata: {}, items: { data: S.items } }),
    update: async (_id: string, params: Record<string, unknown>) => { S.updates.push(params); return { id: "sub_1", items: { data: S.items } }; },
  },
  invoices: { createPreview: async () => ({ lines: { data: S.previewLines }, amount_due: 0 }) },
};
vi.mock("@/lib/billing/stripe", () => ({ getStripe: () => fakeStripe, assertModeAllowed: () => {} }));
vi.mock("@/lib/billing/apply", () => ({ applySubscription: async () => ({ applied: true }) }));
vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => ({ id: "u1" }),
  createClient: async () => ({}),
  createAdminClient: () => ({ from: () => ({ insert: async (row: Record<string, unknown>) => { S.audit.push(row); return { error: null }; } }) }),
}));
vi.mock("@/lib/enterprise/server", () => ({
  loadMyCompany: async () => ({ id: "c1", permissions: ["manage_billing"], seatsUsed: 4, entitlement: { source: "stripe" } }),
  can: (c: { permissions: string[] }, p: string) => c.permissions.includes(p),
  companySubscription: async () => ({ stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "active", current_period_end: "2026-12-01T00:00:00Z" }),
}));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true, rateLimit: async () => true }));

const post = async (body: unknown) => (await import("@/app/api/company/seats/route")).POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }));
const base = { id: "si_base", price: { id: "price_ent_base" }, quantity: 1 };
const seat = (q: number) => ({ id: "si_seat", price: { id: SEAT }, quantity: q });
const proration = (amount: number) => ({ amount, parent: { subscription_item_details: { proration: true } } });

describe("Enterprise seats route", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x"); vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly"); vi.stubEnv("STRIPE_PRICE_ANNUAL", "price_annual");
    vi.stubEnv("STRIPE_PRICE_ENTERPRISE_BASE", "price_ent_base"); vi.stubEnv("STRIPE_PRICE_ENTERPRISE_SEAT", SEAT);
    Object.assign(S, { items: [base, seat(3)], updates: [], audit: [], previewLines: [proration(-1500)] });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("removing users shows no credit and updates Stripe with no proration", async () => {
    const pv = await (await post({ action: "preview", users: 5, fromUsers: 6 })).json();
    expect(pv).toMatchObject({ creditCents: 0, dueNowCents: 0, currentPeriodEnd: "2026-12-01T00:00:00Z" });
    expect((await post({ action: "confirm", users: 5, fromUsers: 6, attempt: "attempt-rm1" })).status).toBe(200);
    expect(S.updates.at(-1)).toMatchObject({ items: [{ id: "si_seat", quantity: 2 }], proration_behavior: "none" });
    expect(S.updates.at(-1)?.proration_date).toBeUndefined();
    expect(S.audit.at(-1)).toMatchObject({ action: "billing.seats_removed" });
  });

  it("adding users is still prorated and invoiced now", async () => {
    expect((await post({ action: "confirm", users: 8, fromUsers: 6, prorationDate: 1_800_000_000, attempt: "attempt-add1" })).status).toBe(200);
    expect(S.updates.at(-1)).toMatchObject({ items: [{ id: "si_seat", quantity: 5 }], proration_behavior: "always_invoice", proration_date: 1_800_000_000, payment_behavior: "error_if_incomplete" });
  });

  it("can't remove seats that are in use", async () => {
    expect((await (await post({ action: "confirm", users: 3, fromUsers: 6 })).json()).error.code).toBe("below_in_use");
  });
});
