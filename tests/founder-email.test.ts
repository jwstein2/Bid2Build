import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FOUNDER_SUBJECT, founderWelcomeHtml, founderWelcomeText, isFirstPaidSubscriptionInvoice } from "@/lib/email/founder-welcome";
import { deliverFounderEmails, enqueueFounderWelcome, founderEmailConfig, MAX_ATTEMPTS } from "@/lib/email/outbox";

/** Tiny in-memory stand-in for the email_outbox table (only the query shapes outbox.ts uses). */
function fakeAdmin() {
  type Row = Record<string, unknown>;
  const rows: Row[] = [];
  let seq = 0;
  const auth = { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@example.test` } } }) } };
  function from(table: string) {
    if (table !== "email_outbox") throw new Error(table);
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "update" | "upsert" = "select";
    let patch: Row = {};
    let upsertRow: Row | null = null;
    let limit = Infinity;
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
      lt: (k: string, v: number | string) => { filters.push((r) => r[k] != null && (r[k] as number | string) < v); return q; },
      gte: (k: string, v: string) => { filters.push((r) => (r[k] as string) >= v); return q; },
      order: () => q,
      limit: (n: number) => { limit = n; return q; },
      update: (p: Row) => { op = "update"; patch = p; return q; },
      upsert: (r: Row) => { op = "upsert"; upsertRow = r; return q; },
      then: (resolve: (v: unknown) => void) => {
        if (op === "upsert") {
          const exists = rows.some((r) => r.kind === upsertRow!.kind && r.user_id === upsertRow!.user_id);
          if (exists) return resolve({ data: [], error: null });
          const row = { id: `job${++seq}`, attempts: 0, created_at: new Date().toISOString(), locked_until: null, ...upsertRow };
          rows.push(row);
          return resolve({ data: [{ id: row.id }], error: null });
        }
        const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, limit);
        if (op === "update") hit.forEach((r) => Object.assign(r, patch));
        return resolve({ data: hit.map((r) => ({ ...r })), error: null });
      },
    };
    return q;
  }
  return { admin: { from, auth } as unknown as SupabaseClient, rows };
}

const enabled = founderEmailConfig({ FOUNDER_EMAIL_ENABLED: "true", RESEND_API_KEY: "re_test" });
const okFetch = () => vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));

describe("founder welcome email: copy", () => {
  it("matches the approved subject, sender and body", () => {
    expect(FOUNDER_SUBJECT).toBe("A personal thank you from the founder of Built2Bid");
    expect(enabled.from).toBe('"James Stein — Founder, Built2Bid" <james@built2bid.org>');
    expect(enabled.replyTo).toBe("james@built2bid.org");
    const t = founderWelcomeText();
    expect(t.startsWith("Hey there!\n\nI'm James Stein, owner and founder of Built2Bid")).toBe(true);
    expect(t).toContain("around $2 million in annual sales scaling the company 4x");
    expect(t).toContain("Thanks again, and happy bidding!\n\nJames Stein\nOwner & Founder | Built2Bid\njames@built2bid.org\nhttps://built2bid.org");
    expect(founderWelcomeHtml()).toContain("Owner &amp; Founder | Built2Bid");
    expect(founderWelcomeHtml()).not.toMatch(/<script|unsubscribe|track/i);
  });
});

describe("founder welcome email: trigger", () => {
  it("only the first paid subscription invoice qualifies", () => {
    expect(isFirstPaidSubscriptionInvoice({ billing_reason: "subscription_create", amount_paid: 1999, status: "paid" })).toBe(true);
    expect(isFirstPaidSubscriptionInvoice({ billing_reason: "subscription_cycle", amount_paid: 1999, status: "paid" })).toBe(false); // renewal
    expect(isFirstPaidSubscriptionInvoice({ billing_reason: "subscription_update", amount_paid: 500, status: "paid" })).toBe(false); // upgrade / seats
    expect(isFirstPaidSubscriptionInvoice({ billing_reason: "subscription_create", amount_paid: 0, status: "paid" })).toBe(false); // 100% coupon
    expect(isFirstPaidSubscriptionInvoice({ billing_reason: "subscription_create", amount_paid: 1999, status: "open" })).toBe(false);
    expect(isFirstPaidSubscriptionInvoice({ billing_reason: "manual", amount_paid: 1999 })).toBe(false);
  });
  it("creates at most one job per user, whatever Stripe redelivers", async () => {
    const { admin, rows } = fakeAdmin();
    expect(await enqueueFounderWelcome(admin, { userId: "u1", email: "a@x.test", sourceRef: "in_1" })).toBe("queued");
    expect(await enqueueFounderWelcome(admin, { userId: "u1", email: "a@x.test", sourceRef: "in_1" })).toBe("exists"); // duplicate event
    expect(await enqueueFounderWelcome(admin, { userId: "u1", email: "a@x.test", sourceRef: "in_2" })).toBe("exists"); // later subscription
    expect(rows).toHaveLength(1);
  });
  it("never throws into the webhook when the table is missing", async () => {
    const admin = { from: () => ({ upsert: () => ({ select: async () => ({ data: null, error: { code: "42P01", message: "relation email_outbox does not exist" } }) }) }) } as unknown as SupabaseClient;
    expect(await enqueueFounderWelcome(admin, { userId: "u1", email: null, sourceRef: "in_1" })).toBe("unavailable");
  });
});

describe("founder welcome email: delivery", () => {
  it("is disabled by default and sends nothing", async () => {
    expect(founderEmailConfig({}).enabled).toBe(false);
    expect(founderEmailConfig({ FOUNDER_EMAIL_ENABLED: "true" }).enabled).toBe(false); // no provider key
    expect(founderEmailConfig({ RESEND_API_KEY: "re_x" }).enabled).toBe(false); // not switched on
    const { admin, rows } = fakeAdmin();
    await enqueueFounderWelcome(admin, { userId: "u1", email: "a@x.test", sourceRef: "in_1" });
    const f = okFetch();
    const res = await deliverFounderEmails(admin, { config: founderEmailConfig({}), fetchImpl: f });
    expect(res.disabled).toBe(true);
    expect(f).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("pending");
  });
  it("sends once with an idempotency key, then clears the address", async () => {
    const { admin, rows } = fakeAdmin();
    await enqueueFounderWelcome(admin, { userId: "u1", email: "a@x.test", sourceRef: "in_1" });
    const f = okFetch();
    expect((await deliverFounderEmails(admin, { config: enabled, fetchImpl: f })).sent).toBe(1);
    expect((await deliverFounderEmails(admin, { config: enabled, fetchImpl: f })).sent).toBe(0); // second run: nothing to send
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("founder-welcome/job1");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ to: ["a@x.test"], reply_to: "james@built2bid.org", subject: FOUNDER_SUBJECT });
    expect(rows[0]).toMatchObject({ status: "sent", to_email: null, provider_message_id: "msg_1" });
  });
  it("a failed send is kept for a safe retry, and gives up after the attempt limit", async () => {
    const { admin, rows } = fakeAdmin();
    await enqueueFounderWelcome(admin, { userId: "u1", email: "a@x.test", sourceRef: "in_1" });
    const down = vi.fn(async () => new Response("{}", { status: 503 }));
    await deliverFounderEmails(admin, { config: enabled, fetchImpl: down });
    expect(rows[0]).toMatchObject({ status: "failed", attempts: 1 });
    for (let i = 1; i < MAX_ATTEMPTS + 2; i++) await deliverFounderEmails(admin, { config: enabled, fetchImpl: down });
    expect(down).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(rows[0].status).toBe("skipped");
  });
  it("a rejected address (4xx) is not retried", async () => {
    const { admin, rows } = fakeAdmin();
    await enqueueFounderWelcome(admin, { userId: "u1", email: "bad@x.test", sourceRef: "in_1" });
    const reject = vi.fn(async () => new Response(JSON.stringify({ name: "validation_error", message: "Invalid to" }), { status: 422 }));
    await deliverFounderEmails(admin, { config: enabled, fetchImpl: reject });
    await deliverFounderEmails(admin, { config: enabled, fetchImpl: reject });
    expect(reject).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe("skipped");
  });
  it("jobs older than the age limit are skipped, not sent late", async () => {
    const { admin, rows } = fakeAdmin();
    await enqueueFounderWelcome(admin, { userId: "u1", email: "a@x.test", sourceRef: "in_1" });
    rows[0].created_at = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const f = okFetch();
    await deliverFounderEmails(admin, { config: enabled, fetchImpl: f });
    expect(f).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("skipped");
  });
  it("falls back to the account email when Stripe gave none", async () => {
    const { admin } = fakeAdmin();
    await enqueueFounderWelcome(admin, { userId: "u9", email: null, sourceRef: "in_1" });
    const f = okFetch();
    await deliverFounderEmails(admin, { config: enabled, fetchImpl: f });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).to).toEqual(["u9@example.test"]);
  });
});
