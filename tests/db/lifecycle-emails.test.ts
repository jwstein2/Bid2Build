import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";
import { pgSupabase } from "./pg-supabase";
import { lifecycleConfig, runLifecycle } from "@/lib/email/lifecycle-run";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const env = { LIFECYCLE_EMAIL_MODE: "live", RESEND_API_KEY: "re_test", LIFECYCLE_POSTAL_ADDRESS: "PO Box 1, Minneapolis, MN 55401", SUPABASE_SERVICE_ROLE_KEY: "test-service-key" };

function fakeResend() {
  const sent: { to: string; subject: string; key: string; unsub: string }[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    sent.push({ to: b.to[0], subject: b.subject, key: (init.headers as Record<string, string>)["idempotency-key"], unsub: b.headers["List-Unsubscribe"] });
    return new Response(JSON.stringify({ id: `msg_${sent.length}` }), { status: 200 });
  }) as unknown as typeof fetch;
  return { sent, impl };
}

d("lifecycle emails (migration 20261117003000)", () => {
  const ids: Record<string, string> = {};
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_lifecycle"));
    const make = async (key: string, email: string, createdDaysAgo: number) => {
      ids[key] = await createUser(pool, email);
      await pool.query("update auth.users set created_at = $2 where id = $1", [ids[key], ago(createdDaysAgo)]);
    };
    await make("nobid", "nobid@contractor.dev", 2);        // A
    await make("draft", "draft@contractor.dev", 5);        // B
    await make("payer", "payer@contractor.dev", 40);       // E (paying 10 days)
    await make("tester", "qa@example.com", 2);             // test account: never in live mode
    await make("unsub", "unsub@contractor.dev", 2);        // unsubscribed
    await make("fresh", "fresh@contractor.dev", 0.2);      // too new for A
    await make("bounced", "bounced@contractor.dev", 2);    // suppressed address
    await pool.query("update public.profiles set lifecycle_unsubscribed_at = now() where id = $1", [ids.unsub]);
    await pool.query("insert into public.leads (email_norm, user_id, suppressed_at, suppression_reason) values ('bounced@contractor.dev', $1, now(), 'bounced')", [ids.bounced]);
    const est = (await pool.query("insert into public.estimates (user_id, title, template_trade, updated_at) values ($1, 'Deck', 'decks', $2) returning id", [ids.draft, ago(3)])).rows[0].id;
    ids.draftEstimate = est;
    await pool.query("insert into public.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan, source_event_created) values ('sub_1', $1, 'cus_1', 'active', 'monthly', now())", [ids.payer]);
    await pool.query("insert into public.analytics_events (user_id, event, created_at) values ($1, 'subscribed', $2)", [ids.payer, ago(10)]);
  });
  afterAll(async () => { await drop?.(); });

  it("accepts lifecycle kinds once per account and rejects unknown kinds", async () => {
    const u = await createUser(pool, "kinds@contractor.dev");
    await pool.query("insert into public.email_outbox (kind, user_id, status, meta) values ('lifecycle_a', $1, 'skipped', '{\"trade\":\"decks\"}')", [u]);
    await expect(pool.query("insert into public.email_outbox (kind, user_id) values ('lifecycle_a', $1)", [u])).rejects.toThrow(/duplicate key/);
    await expect(pool.query("insert into public.email_outbox (kind, user_id) values ('lifecycle_z', $1)", [u])).rejects.toThrow(/check constraint/);
    await pool.query("insert into public.email_outbox (kind, user_id) values ('founder_welcome', $1)", [u]);
    await pool.query("delete from auth.users where id = $1", [u]);
  });

  it("keeps the outbox private and lets users read their own unsubscribe flag", async () => {
    await expect(asUser(pool, ids.nobid, (q) => q("select * from public.email_outbox"))).rejects.toThrow(/permission denied/);
    const r = await asUser(pool, ids.unsub, (q) => q("select lifecycle_unsubscribed_at from public.profiles"));
    expect(r.rows[0].lifecycle_unsubscribed_at).toBeTruthy();
  });

  it("dry run reports what would go out and records nothing", async () => {
    const db = pgSupabase(pool);
    const res = await runLifecycle(db, { dryRun: true, config: lifecycleConfig(env) });
    expect(res.due).toEqual({ a: 1, b: 1, c: 0, d: 0, e: 1 });
    expect(res.sent).toBe(0);
    expect((await pool.query("select count(*)::int n from public.email_outbox where kind like 'lifecycle_%'")).rows[0].n).toBe(0);
  });

  it("off mode never sends", async () => {
    const { sent, impl } = fakeResend();
    const res = await runLifecycle(pgSupabase(pool), { config: lifecycleConfig({ ...env, LIFECYCLE_EMAIL_MODE: "off" }), fetchImpl: impl });
    expect(res.dryRun).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("test mode only reaches the listed test addresses", async () => {
    const { sent, impl } = fakeResend();
    const res = await runLifecycle(pgSupabase(pool), { config: lifecycleConfig({ ...env, LIFECYCLE_EMAIL_MODE: "test", LIFECYCLE_TEST_RECIPIENTS: "qa@example.com" }), fetchImpl: impl });
    expect(res.sent).toBe(1);
    expect(sent.map((s) => s.to)).toEqual(["qa@example.com"]);
  });

  it("live mode sends each due step once, respects the cap, and never repeats", async () => {
    const { sent, impl } = fakeResend();
    const capped = await runLifecycle(pgSupabase(pool), { config: lifecycleConfig({ ...env, LIFECYCLE_DAILY_CAP: "3" }), fetchImpl: impl });
    // The test-mode email above already used 1 of today's 3.
    expect(capped.sent).toBe(2);
    expect(capped.capped).toBe(1);
    const rest = await runLifecycle(pgSupabase(pool), { config: lifecycleConfig(env), fetchImpl: impl });
    expect(rest.sent).toBe(1);
    expect(sent.map((s) => s.to).sort()).toEqual(["draft@contractor.dev", "nobid@contractor.dev", "payer@contractor.dev"]);
    expect(sent.every((s) => /\/api\/email\/unsubscribe\?u=[0-9a-f-]{36}&s=/.test(s.unsub))).toBe(true);
    expect(sent.find((s) => s.to === "draft@contractor.dev")!.subject).toBe("Your Decks & Porches estimate is ready when you are");

    const again = await runLifecycle(pgSupabase(pool), { config: lifecycleConfig(env), fetchImpl: impl });
    expect(again.sent).toBe(0);
    const rows = (await pool.query("select kind, status, to_email, meta from public.email_outbox where kind like 'lifecycle_%' order by kind")).rows;
    expect(rows.map((r) => `${r.kind}:${r.status}`)).toEqual(["lifecycle_a", "lifecycle_a", "lifecycle_b", "lifecycle_e"].map((k) => `${k}:sent`));
    expect(rows.every((r) => r.to_email === null)).toBe(true);
    expect(rows.find((r) => r.kind === "lifecycle_b").meta).toEqual({ trade: "decks", estimate_id: ids.draftEstimate });
  });
});
