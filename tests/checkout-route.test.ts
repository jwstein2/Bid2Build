/**
 * The checkout endpoint against a fake Stripe + fake database (no network, no real charges).
 * Covers: plan-id → configured price mapping, price verification, existing subscribers,
 * one open session per customer, and idempotency keys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Sess = { id: string; created: number; url: string | null; expires_at: number; status: string; metadata: Record<string, string> };
const state = {
  user: { id: "00000000-0000-4000-8000-0000000000aa", email: "pro@example.test", emailVerified: true } as { id: string; email: string; emailVerified: boolean } | null,
  hasUnlimited: false,
  subs: [] as { id: string; status: string; metadata: Record<string, string>; customer: string }[],
  sessions: [] as Sess[],
  prices: {
    price_month: { unit_amount: 1999, currency: "usd", recurring: { interval: "month", interval_count: 1 }, active: true },
    price_year: { unit_amount: 14900, currency: "usd", recurring: { interval: "year", interval_count: 1 }, active: true },
  } as Record<string, unknown>,
  created: [] as { params: Record<string, unknown>; key?: string }[],
  expired: [] as string[],
  applied: 0,
  clock: 1_800_000_000,
};

const fakeStripe = {
  prices: { retrieve: vi.fn(async (id: string) => state.prices[id]) },
  customers: { create: vi.fn(async () => ({ id: "cus_1" })) },
  subscriptions: { list: vi.fn(async () => ({ data: state.subs })) },
  checkout: {
    sessions: {
      list: vi.fn(async () => ({ data: state.sessions.filter((s) => s.status === "open") })),
      expire: vi.fn(async (id: string) => { state.expired.push(id); const s = state.sessions.find((x) => x.id === id); if (s) s.status = "expired"; return s; }),
      create: vi.fn(async (params: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
        state.created.push({ params, key: opts?.idempotencyKey });
        const s: Sess = { id: `cs_${state.sessions.length + 1}`, created: ++state.clock, url: `https://checkout.stripe.com/c/pay/cs_${state.sessions.length + 1}`, expires_at: state.clock + 3600, status: "open", metadata: params.metadata as Record<string, string> };
        state.sessions.push(s);
        return s;
      }),
    },
  },
};

const admin = {
  rpc: vi.fn(async () => ({ data: state.hasUnlimited })),
  from: vi.fn(() => {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: { stripe_customer_id: "cus_1" } }),
      insert: async () => ({ error: null }),
    };
    return q;
  }),
};

vi.mock("@/lib/supabase/server", () => ({ getUser: async () => state.user, createAdminClient: () => admin }));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: () => fakeStripe, assertModeAllowed: () => {} }));
vi.mock("@/lib/billing/apply", () => ({ applySubscription: async () => { state.applied++; return { applied: true, userId: "u" }; } }));
vi.mock("@/lib/env", () => ({
  isStripeConfigured: () => true,
  serverEnv: () => ({ stripeSecretKey: "sk_test_x", stripePriceMonthly: "price_month", stripePriceAnnual: "price_year", stripeWebhookSecret: "" }),
}));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true, rateLimit: async () => true }));

const { POST } = await import("@/app/api/stripe/checkout/route");
const call = async (body: unknown) => {
  const r = await POST(new Request("http://localhost/api/stripe/checkout", { method: "POST", body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};

beforeEach(() => {
  state.user = { id: "00000000-0000-4000-8000-0000000000aa", email: "pro@example.test", emailVerified: true };
  state.hasUnlimited = false; state.subs = []; state.sessions = []; state.created = []; state.expired = []; state.applied = 0;
  state.prices.price_month = { unit_amount: 1999, currency: "usd", recurring: { interval: "month", interval_count: 1 }, active: true };
  vi.spyOn(Date, "now").mockReturnValue(state.clock * 1000);
});

describe("POST /api/stripe/checkout", () => {
  it("maps the plan id to the configured price (monthly and annual)", async () => {
    const m = await call({ plan: "monthly", attempt: "attempt-0001" });
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ plan: "monthly" });
    expect(state.created[0].params.line_items).toEqual([{ price: "price_month", quantity: 1 }]);
    expect(state.created[0].params.cancel_url).toMatch(/\/pricing\?checkout=cancelled&plan=monthly$/);
    expect(state.created[0].params.success_url).toMatch(/\/settings\/billing\?checkout=success&plan=monthly$/);
    expect(state.created[0].key).toBe(`checkout-${state.user!.id}-monthly-attempt-0001`);

    state.sessions = [];
    const a = await call({ plan: "annual", attempt: "attempt-0002" });
    expect(a.status).toBe(200);
    expect(state.created[1].params.line_items).toEqual([{ price: "price_year", quantity: 1 }]);
  });

  it("ignores client-supplied prices", async () => {
    expect((await call({ plan: "price_live_cheap" })).status).toBe(400);
    const r = await call({ plan: "monthly", price: "price_cheap", amount: 1 });
    expect(r.status).toBe(200);
    expect(state.created[0].params.line_items).toEqual([{ price: "price_month", quantity: 1 }]);
  });

  it("requires a signed-in, verified account", async () => {
    state.user = null;
    expect((await call({ plan: "monthly" })).body.error.code).toBe("not_authenticated");
    state.user = { id: "u", email: "x@y.z", emailVerified: false };
    expect((await call({ plan: "monthly" })).body.error.code).toBe("email_not_verified");
  });

  it("sends existing subscribers to manage their plan instead of selling another", async () => {
    state.hasUnlimited = true;
    expect((await call({ plan: "annual" }))).toMatchObject({ status: 409, body: { error: { code: "already_subscribed" } } });
    state.hasUnlimited = false;
    // Paid in Stripe but the webhook hasn't landed yet: still blocked, and the subscription is recorded.
    state.subs = [{ id: "sub_1", status: "active", metadata: {}, customer: "cus_1" }];
    expect((await call({ plan: "annual" })).body.error.code).toBe("already_subscribed");
    expect(state.applied).toBe(1);
    expect(state.created).toHaveLength(0);
  });

  it("allows a new subscription after a cancelled one", async () => {
    state.subs = [{ id: "sub_old", status: "canceled", metadata: {}, customer: "cus_1" }];
    expect((await call({ plan: "monthly" })).status).toBe(200);
  });

  it("reuses an open session for the same plan (cancelled checkout, second tab, repeated callback)", async () => {
    const first = await call({ plan: "monthly", attempt: "attempt-0001" });
    const again = await call({ plan: "monthly", attempt: "attempt-0002" });
    expect(again.body).toMatchObject({ url: first.body.url, reused: true });
    expect(state.created).toHaveLength(1);
  });

  it("switching plans expires the other open session so only one can be paid", async () => {
    const m = await call({ plan: "monthly", attempt: "attempt-0001" });
    const a = await call({ plan: "annual", attempt: "attempt-0002" });
    expect(a.body.url).not.toBe(m.body.url);
    expect(state.expired).toEqual(["cs_1"]);
    expect(state.sessions.filter((s) => s.status === "open").map((s) => s.metadata.plan)).toEqual(["annual"]);
  });

  it("refuses to open checkout if the Stripe price doesn't match the advertised price", async () => {
    state.prices.price_month = { unit_amount: 2999, currency: "usd", recurring: { interval: "month", interval_count: 1 }, active: true };
    // The verification cache is per price id; use a fresh id so the earlier success isn't reused.
    const env = await import("@/lib/env");
    vi.spyOn(env, "serverEnv").mockReturnValue({ stripeSecretKey: "sk_test_x", stripePriceMonthly: "price_month_v2", stripePriceAnnual: "price_year", stripeWebhookSecret: "" } as never);
    state.prices.price_month_v2 = state.prices.price_month;
    const r = await call({ plan: "monthly" });
    expect(r).toMatchObject({ status: 500, body: { error: { code: "pricing_mismatch" } } });
    expect(state.created).toHaveLength(0);
  });
});
