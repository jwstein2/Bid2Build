/**
 * Stripe webhook → founder welcome email. The job is queued only for the first paid subscription
 * invoice; duplicates, renewals and checkout events never queue another; a failed email never fails
 * the webhook (so it can't block or revoke paid access). Fake Stripe and database, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { events: new Map<string, { processed_at: string | null }>(), applied: 0, enqueued: [] as Record<string, unknown>[], deliver: 0, deliverThrows: false, enqueueResult: "queued" as string };

const admin = {
  from: (table: string) => {
    const ctx: { id?: string; op?: string; row?: Record<string, unknown> } = {};
    const q = {
      select: () => q,
      eq: (_k: string, v: string) => { ctx.id = v; return ctx.op === "update" ? Promise.resolve({ error: null }).then(() => { const e = state.events.get(v); if (e && ctx.row?.processed_at) e.processed_at = String(ctx.row.processed_at); return { error: null }; }) : q; },
      maybeSingle: async () => ({ data: table === "stripe_events" ? state.events.get(ctx.id!) ?? null : null }),
      insert: async (row: { id: string }) => { if (table === "stripe_events") state.events.set(row.id, { processed_at: null }); return { error: null }; },
      update: (row: Record<string, unknown>) => { ctx.op = "update"; ctx.row = row; return q; },
      upsert: async () => ({ error: null }),
    };
    return q;
  },
};

let nextEvent: Record<string, unknown> = {};
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ webhooks: { constructEvent: () => nextEvent }, subscriptions: { retrieve: async (id: string) => ({ id }) } }),
}));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ stripeWebhookSecret: "whsec_test" }) }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/billing/apply", () => ({ applySubscription: async () => { state.applied++; return { applied: true, userId: "u1" }; } }));
vi.mock("@/lib/growth/leads", () => ({ markCustomer: async () => {}, markChurned: async () => {} }));
vi.mock("@/lib/email/outbox", () => ({
  enqueueFounderWelcome: async (_a: unknown, job: Record<string, unknown>) => { state.enqueued.push(job); return state.enqueueResult; },
  deliverFounderEmails: async () => { state.deliver++; if (state.deliverThrows) throw new Error("provider down"); return { sent: 1 }; },
}));

const { POST } = await import("@/app/api/stripe/webhook/route");
const send = async (ev: Record<string, unknown>) => {
  nextEvent = ev;
  const r = await POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
  return { status: r.status, text: await r.text() };
};
const invoice = (id: string, reason: string, amount = 1999) => ({
  id: `evt_${id}`, type: "invoice.paid", created: 1_800_000_000,
  data: { object: { id: `in_${id}`, billing_reason: reason, amount_paid: amount, status: "paid", customer_email: "buyer@example.test", parent: { subscription_details: { subscription: "sub_1" } } } },
});

beforeEach(() => { state.events.clear(); state.applied = 0; state.enqueued = []; state.deliver = 0; state.deliverThrows = false; state.enqueueResult = "queued"; });

describe("Stripe webhook: founder welcome email", () => {
  it("queues one job for the first paid invoice and tries delivery after entitlements are saved", async () => {
    const r = await send(invoice("1", "subscription_create"));
    expect(r).toEqual({ status: 200, text: "ok" });
    expect(state.applied).toBe(1);
    expect(state.enqueued).toEqual([{ userId: "u1", email: "buyer@example.test", sourceRef: "in_1" }]);
    expect(state.deliver).toBe(1);
  });
  it("a duplicate delivery of the same event is ignored", async () => {
    await send(invoice("1", "subscription_create"));
    const r = await send(invoice("1", "subscription_create"));
    expect(r.text).toBe("duplicate");
    expect(state.enqueued).toHaveLength(1);
  });
  it("renewals, upgrades, seat changes and $0 invoices never queue the email", async () => {
    await send(invoice("2", "subscription_cycle"));
    await send(invoice("3", "subscription_update"));
    await send(invoice("4", "subscription_create", 0));
    expect(state.enqueued).toHaveLength(0);
    expect(state.deliver).toBe(0);
    expect(state.applied).toBe(3); // entitlements still updated as before
  });
  it("checkout.session.completed alone doesn't queue it (no email from a success page or unpaid checkout)", async () => {
    await send({ id: "evt_c", type: "checkout.session.completed", created: 1_800_000_000, data: { object: { mode: "subscription", subscription: "sub_1", customer: "cus_1", client_reference_id: "u1", customer_details: { email: "b@x.test" } } } });
    expect(state.enqueued).toHaveLength(0);
  });
  it("an email failure never fails the webhook or the subscription update", async () => {
    state.deliverThrows = true;
    const r = await send(invoice("5", "subscription_create"));
    expect(r.status).toBe(200);
    expect(state.applied).toBe(1);
  });
  it("doesn't try delivery when the user already had a welcome job", async () => {
    state.enqueueResult = "exists";
    await send(invoice("6", "subscription_create"));
    expect(state.deliver).toBe(0);
  });
});
