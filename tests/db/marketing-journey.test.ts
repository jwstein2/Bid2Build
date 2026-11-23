/**
 * Growth OS Phase 3 acceptance test (real Postgres, synthetic people, no network).
 *
 * A test visitor is followed through tagged visits (the real proxy), a simulated signup (the real signed-in
 * sync), a first bid and a proposal (real event recorder), a paid subscription, a renewal, a partial refund, a
 * scheduled cancellation and a cancellation (the real Stripe webhook route with a fake Stripe client), with
 * duplicate and replayed webhook deliveries. Then the journey report is read back from the database through
 * the real loader. A second visitor saw a Google ad but signed up through a sales rep's link: the rep owns that
 * revenue and it is not also counted as Google Ads.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { NextRequest } from "next/server";
import { createUser, dbAvailable, freshDb } from "./harness";
import { pgSupabase } from "./pg-supabase";

vi.mock("@/lib/demo/guard", () => ({ inDemoSession: async () => false, demoSessionClaim: async () => null, isDemoTenant: async () => false }));
vi.mock("@/lib/growth/instantly", () => ({ blockEmail: async () => ({ ok: false }) }));
vi.mock("@/lib/email/outbox", () => ({ enqueueFounderWelcome: async () => "skipped", deliverFounderEmails: async () => ({ sent: 0 }) }));

const db: { client: ReturnType<typeof pgSupabase> | null } = { client: null };
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => db.client }));
vi.mock("@/lib/env", () => ({
  serverEnv: () => new Proxy({ stripeWebhookSecret: "whsec_test", stripeSecretKey: "sk_live_synthetic", stripePriceMonthly: "price_monthly", stripePriceAnnual: "price_annual" } as Record<string, string>, { get: (t, k: string) => t[k] ?? "" }),
}));

// Fake Stripe: the route verifies the signature with constructEvent (returns the queued event) and re-reads the
// subscription, which we serve from `subs`.
let nextEvent: Record<string, unknown> = {};
const subs = new Map<string, Record<string, unknown>>();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => nextEvent },
    subscriptions: { retrieve: async (id: string) => subs.get(id) },
    charges: { retrieve: async (id: string) => ({ id, invoice: null }) },
    invoices: { retrieve: async (id: string) => ({ id }) },
    invoicePayments: { list: async () => ({ data: [] }) },
  }),
}));

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const DAY = 86_400_000;
const T0 = Date.now() - 100 * DAY;
const at = (days: number) => new Date(T0 + days * DAY);
const sec = (days: number) => Math.floor(at(days).getTime() / 1000);

/** One request through the real proxy at a given time, carrying the browser's cookies; returns the new cookie jar. */
async function visit(jar: Map<string, string>, url: string, days: number, referer?: string): Promise<Map<string, string>> {
  vi.setSystemTime(at(days));
  const { proxy } = await import("@/proxy");
  const headers: Record<string, string> = { host: "localhost:3000", "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile" };
  if (referer) headers.referer = referer;
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await proxy(new NextRequest(url, { headers }));
  const out = new Map(jar);
  for (const c of res.cookies.getAll()) out.set(c.name, c.value);
  return out;
}

async function send(ev: Record<string, unknown>) {
  const { POST } = await import("@/app/api/stripe/webhook/route");
  nextEvent = ev;
  const r = await POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
  return r.text();
}

const sub = (id: string, customer: string, user: string, o: Partial<{ status: string; cancel_at_period_end: boolean; canceled_at: number | null; ended_at: number | null; cancel_at: number | null; periodEnd: number }> = {}) => ({
  id, customer, status: o.status ?? "active", cancel_at_period_end: o.cancel_at_period_end ?? false, canceled_at: o.canceled_at ?? null, ended_at: o.ended_at ?? null, cancel_at: o.cancel_at ?? null,
  metadata: { user_id: user }, items: { data: [{ current_period_end: o.periodEnd ?? sec(36), quantity: 1, price: { id: "price_monthly", unit_amount: 1999, recurring: { interval: "month" } } }] },
});
const invoicePaid = (evt: string, inv: string, subId: string, customer: string, days: number, reason: string, cents = 1999) => ({
  id: evt, type: "invoice.paid", created: sec(days), livemode: true,
  data: { object: { id: inv, livemode: true, status: "paid", customer, billing_reason: reason, currency: "usd", amount_due: cents, amount_paid: cents, total: cents, total_excluding_tax: cents, created: sec(days), status_transitions: { paid_at: sec(days) }, period_start: sec(days), period_end: sec(days + 30), parent: { subscription_details: { subscription: subId } } } },
});

d("Phase 3 acceptance: visitor → signup → bid → subscription → cancellation", () => {
  let user: string, repUser: string;
  const events: Record<string, unknown>[] = [];

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_marketing_journey"));
    db.client = pgSupabase(pool);
    process.env.MARKETING_TOUCHES = "on";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterAll(async () => { vi.useRealTimers(); delete process.env.MARKETING_TOUCHES; await drop?.(); });

  it("records the visitor's touches in first-party cookies (anonymous id, no personal data)", async () => {
    let jar = new Map<string, string>();
    jar = await visit(jar, "http://localhost:3000/bids/roofing?utm_source=google&utm_medium=cpc&utm_campaign=b2b-google-signup-202611&utm_content=rsa-roofing-1&gclid=SECRETCLICKVALUE", 0);
    jar = await visit(jar, "http://localhost:3000/bids/roofing?utm_source=google&utm_medium=cpc&utm_campaign=b2b-google-signup-202611&utm_content=rsa-roofing-1&gclid=SECRETCLICKVALUE", 0.005); // refresh: same visit
    jar = await visit(jar, "http://localhost:3000/pricing", 3, "https://www.facebook.com/groups/roofers");
    jar = await visit(jar, "http://localhost:3000/dashboard", 3.1, "http://localhost:3000/pricing"); // internal: not a touch
    const { decodeTouches } = await import("@/lib/growth/touches");
    const touches = decodeTouches(jar.get("b2b_touch"));
    expect(touches.map((t) => t.s ?? t.rh)).toEqual(["google", "facebook.com"]);
    expect(jar.get("b2b_touch")).not.toMatch(/SECRETCLICKVALUE/);
    expect(touches[0].ck).toBe("gclid");
    expect(jar.get("b2b_vid")).toMatch(/^[0-9a-f-]{36}$/);
    expect(jar.get("b2b_attr")).toContain("google");

    // Simulated signup at day 4: account created, first signed-in page load syncs lead + touches.
    vi.setSystemTime(at(4));
    user = await createUser(pool, "syn-visitor-1@test.dev");
    await pool.query("update auth.users set created_at = $2 where id = $1", [user, at(4)]);
    const { syncSignedInUser } = await import("@/lib/growth/leads");
    const { decodeAttribution } = await import("@/lib/growth/attribution");
    const { syncTouches } = await import("@/lib/growth/touches-server");
    await syncSignedInUser(db.client!, { id: user, email: "syn-visitor-1@test.dev" }, decodeAttribution(decodeURIComponent(jar.get("b2b_attr")!)));
    expect(await syncTouches(db.client!, user, jar.get("b2b_vid"), touches)).toBe(2);
    expect(await syncTouches(db.client!, user, jar.get("b2b_vid"), touches)).toBe(0); // next page load: nothing new

    // After signup they click an outreach email: the last touch before payment.
    jar = await visit(jar, "http://localhost:3000/pricing?utm_source=instantly&utm_medium=email&utm_campaign=cold_outreach", 5);
    vi.setSystemTime(at(5.01));
    await syncTouches(db.client!, user, jar.get("b2b_vid"), decodeTouches(jar.get("b2b_touch")));
    const { rows } = await pool.query("select channel, user_id from public.marketing_touches where visitor_id = $1 order by touch_at", [jar.get("b2b_vid")]);
    expect(rows.map((r) => r.channel)).toEqual(["google_ads", "social", "email_outreach"]);
    expect(rows.every((r) => r.user_id === user)).toBe(true);
    const cols = await pool.query("select column_name from information_schema.columns where table_name = 'marketing_touches'");
    expect(cols.rows.map((r) => r.column_name)).not.toEqual(expect.arrayContaining(["email", "ip", "gclid"]));
  });

  it("records the first bid, proposal and activation once each", async () => {
    const { recordEvent, eventIds } = await import("@/lib/growth/events");
    for (let i = 0; i < 2; i++) {
      await recordEvent(db.client!, { userId: user, event: "first_bid_started", eventId: eventIds.firstBidStarted(user) });
      await recordEvent(db.client!, { userId: user, event: "proposal_sent", eventId: eventIds.proposalSent("syn-sign-1") });
      await recordEvent(db.client!, { userId: user, event: "bid_activated", eventId: eventIds.bidActivated(user) });
    }
    const { rows } = await pool.query("select event, count(*)::int n from public.analytics_events where user_id = $1 group by event order by event", [user]);
    expect(rows).toEqual([
      { event: "account_created", n: 1 }, { event: "bid_activated", n: 1 }, { event: "first_bid_started", n: 1 }, { event: "proposal_sent", n: 1 },
    ]);
  });

  it("processes subscription, renewal, refund, scheduled cancellation and cancellation through the real webhook", async () => {
    const S = "sub_syn_1", C = "cus_syn_1";
    subs.set(S, sub(S, C, user));
    events.push(
      { id: "evt_syn_checkout", type: "checkout.session.completed", created: sec(6), livemode: true, data: { object: { mode: "subscription", subscription: S, customer: C, client_reference_id: user, customer_details: { email: "syn-visitor-1@test.dev" } } } },
      invoicePaid("evt_syn_in1", "in_syn_1", S, C, 6, "subscription_create"),
      invoicePaid("evt_syn_in1_again", "in_syn_1", S, C, 6.01, "subscription_create"), // same invoice, different event id
      invoicePaid("evt_syn_in2", "in_syn_2", S, C, 36, "subscription_cycle"),
      { id: "evt_syn_refund", type: "charge.refunded", created: sec(40), livemode: true, data: { object: { id: "ch_syn_2", invoice: "in_syn_2", amount_refunded: 500, amount: 1999 } } },
    );
    for (const e of events) expect(await send(e)).toBe("ok");
    expect(await send(events[1])).toBe("duplicate"); // Stripe redelivery of the same event

    subs.set(S, sub(S, C, user, { cancel_at_period_end: true, cancel_at: sec(66), canceled_at: sec(50), periodEnd: sec(66) }));
    const sched = { id: "evt_syn_sched", type: "customer.subscription.updated", created: sec(50), livemode: true, data: { object: { id: S } } };
    expect(await send(sched)).toBe("ok");
    subs.set(S, sub(S, C, user, { status: "canceled", cancel_at_period_end: true, cancel_at: sec(66), canceled_at: sec(50), ended_at: sec(66), periodEnd: sec(66) }));
    const del = { id: "evt_syn_deleted", type: "customer.subscription.deleted", created: sec(66), livemode: true, data: { object: { id: S } } };
    expect(await send(del)).toBe("ok");
    events.push(sched, del);

    const ev = await pool.query("select event, count(*)::int n from public.analytics_events where user_id = $1 and event like 'subscri%' group by event order by event", [user]);
    expect(ev.rows).toEqual([
      { event: "subscribed", n: 1 }, { event: "subscription_cancel_scheduled", n: 1 }, { event: "subscription_canceled", n: 1 }, { event: "subscription_renewed", n: 1 },
    ]);
    const rev = await pool.query("select invoice_id, net_cents, refund_cents from public.mkt_revenue_facts where user_id = $1 order by invoice_id", [user]);
    expect(rev.rows).toEqual([{ invoice_id: "in_syn_1", net_cents: 1999, refund_cents: 0 }, { invoice_id: "in_syn_2", net_cents: 1499, refund_cents: 500 }]);
  });

  it("a second visitor saw a Google ad but signed up through a sales rep: the rep owns the revenue", async () => {
    let jar = new Map<string, string>();
    jar = await visit(jar, "http://localhost:3000/bids/painting?utm_source=google&utm_medium=cpc&utm_campaign=b2b-google-signup-202611&gclid=x", 10);
    jar = await visit(jar, "http://localhost:3000/?utm_source=sales_rep&utm_medium=referral&utm_campaign=sales_team&utm_content=SYNREPAA", 12);
    vi.setSystemTime(at(12.1));
    repUser = await createUser(pool, "syn-visitor-2@test.dev");
    await pool.query("update auth.users set created_at = $2 where id = $1", [repUser, at(12.1)]);
    const { decodeTouches } = await import("@/lib/growth/touches");
    const { syncTouches } = await import("@/lib/growth/touches-server");
    await syncTouches(db.client!, repUser, jar.get("b2b_vid"), decodeTouches(jar.get("b2b_touch")));
    const rep = await pool.query("insert into public.sales_reps (email, full_name, code, status) values ('syn-rep@test.dev', 'Synthetic Rep', 'SYNREPAA', 'active') returning id");
    await pool.query("insert into public.sales_attributions (user_id, rep_id, source, code, attributed_at) values ($1, $2, 'link', 'SYNREPAA', $3)", [repUser, rep.rows[0].id, at(12.1)]);
    const S = "sub_syn_2", C = "cus_syn_2";
    subs.set(S, sub(S, C, repUser, { periodEnd: sec(45) }));
    expect(await send({ id: "evt_syn2_checkout", type: "checkout.session.completed", created: sec(14), livemode: true, data: { object: { mode: "subscription", subscription: S, customer: C, client_reference_id: repUser, customer_details: {} } } })).toBe("ok");
    expect(await send(invoicePaid("evt_syn2_in1", "in_syn2_1", S, C, 14, "subscription_create"))).toBe("ok");
  });

  it("the journey report follows both visitors with correct attribution and no duplicate revenue", async () => {
    vi.setSystemTime(at(100));
    const { loadJourneyInput } = await import("@/lib/growth/journey-server");
    const { buildJourneys, revenueByOwner, breakdown, dataQuality } = await import("@/lib/growth/journey");
    const accounts = [{ id: user, createdAt: at(4).toISOString(), trade: "roofing" }, { id: repUser, createdAt: at(12.1).toISOString(), trade: "painting" }];
    const read = async () => {
      const { input, installed } = await loadJourneyInput(db.client!, accounts);
      expect(installed).toEqual({ touches: true, revenue: true, owners: true });
      return { input, js: buildJourneys(input, at(100)) };
    };
    const { input, js } = await read();
    const j1 = js.find((j) => j.id === user)!;
    expect(j1.firstTouch).toMatchObject({ channel: "google_ads", campaign: "b2b-google-signup-202611", content: "rsa-roofing-1", landing: "/bids/roofing", from: "touch" });
    expect(j1.lastTouchSignup.channel).toBe("social");
    expect(j1.lastTouchPaid?.channel).toBe("email_outreach");
    expect(j1.owner).toEqual({ kind: "marketing", key: "email_outreach", partnerId: null });
    expect([j1.firstBidAt, j1.proposalSentAt, j1.activatedAt, j1.paidAt, j1.cancelScheduledAt, j1.canceledAt].every(Boolean)).toBe(true);
    expect(j1).toMatchObject({ renewals: 1, paying: false, invoices: 2, grossCents: 3998, refundCents: 500, netCents: 3498 });

    const j2 = js.find((j) => j.id === repUser)!;
    expect(j2.firstTouch.channel).toBe("google_ads");
    expect(j2.owner.kind).toBe("sales_rep");

    const r = revenueByOwner(input, js, 0, at(100).getTime());
    expect(r.totalCents).toBe(3498 + 1999);
    expect(r.invoiceIds).toBe(3);
    expect(Object.fromEntries(r.rows.map((x) => [x.key, x.netCents]))).toEqual({ email_outreach: 3498, sales_rep: 1999 });
    // First-touch view credits Google with both signups (influence) but carries no revenue column to add up.
    const first = breakdown(js, "channel", "first", 0, at(100).getTime());
    expect(first).toEqual([expect.objectContaining({ key: "google_ads", netCents: 0, counts: expect.objectContaining({ signup: 2, paid: 2, canceled: 1, retained: 1 }) })]);
    expect(dataQuality(input, js, at(100), { touchesOn: true }).filter((c) => c.severity !== "ok")).toEqual([]);

    // Replay every webhook event: nothing changes.
    for (const e of events) expect(await send(e)).toBe("duplicate");
    const again = await read();
    expect(revenueByOwner(again.input, again.js, 0, at(100).getTime())).toEqual(r);
  });

  it("migration is re-runnable and the rollback script removes it cleanly", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(import.meta.dirname, "../..");
    const mig = fs.readFileSync(path.join(root, "supabase/migrations/20270228001000_marketing_measurement.sql"), "utf8");
    await pool.query(mig); // second run: no error, no duplicate backfill
    const ev = await pool.query("select count(*)::int n from public.analytics_events where event = 'subscription_canceled'");
    expect(ev.rows[0].n).toBe(1);
    await pool.query(fs.readFileSync(path.join(root, "docs/growth-os/phase3/rollback_20270228001000.sql"), "utf8"));
    const t = await pool.query("select to_regclass('public.marketing_touches') t, to_regclass('public.mkt_revenue_facts') v");
    expect(t.rows[0]).toEqual({ t: null, v: null });
    await pool.query(mig); // and back again
  });
});
