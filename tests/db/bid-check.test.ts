import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createUser, dbAvailable, freshDb } from "./harness";
import { pgSupabase } from "./pg-supabase";
import { recordSessionEvent, requestPassFromQuestionnaire } from "@/lib/bid-check/server";
import { activateTrial } from "@/lib/trial/service";
import { deliverTrialEmails, trialEmailConfig } from "@/lib/trial/delivery";

/**
 * Bid check -> "Email me my 7-day Unlimited pass" through the real migrations: anonymous session rows,
 * invite delivery (Resend faked at the HTTP boundary), verified activation, duplicate requests, paid
 * plans preserved, expiry, and the admin funnel.
 */
const available = await dbAvailable();
const d = available ? describe : describe.skip;

Object.assign(process.env, { FB_TRIAL_ENABLED: "true", RESEND_API_KEY: "re_test", SUPABASE_SERVICE_ROLE_KEY: "service-key-for-tests" });

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
  if (url.startsWith("https://api.resend.com")) return new Response(JSON.stringify({ id: `re_${calls.length}` }), { status: 200 });
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;
const resend = () => calls.filter((c) => c.url.includes("api.resend.com"));
const tokenFrom = (c: Call) => String((c.body.html as string).match(/#t=([A-Za-z0-9._-]+)/)?.[1]);

const deckAnswers = { goal: "speed", trade: "decks", "decks.job": "new", "decks.pain": "stairs", "follow.speed": "takeoffs", tools: "excel" };

d("bid check: sessions and the 7-day pass", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let db: SupabaseClient;
  const sid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const session = async (id: string) => (await pool.query("select * from public.bid_check_sessions where id = $1", [id])).rows[0];

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("b2b_test_bid_check"));
    db = pgSupabase(pool);
  });
  afterAll(async () => { await drop?.(); });
  beforeEach(() => { calls = []; });

  it("records an anonymous session: answer keys on the path only, first-time timestamps, scrubbed free text", async () => {
    const arrival = { campaign: "bid_check_decks", source: "fb_group", content: "group_v1", tradeHint: "decks" };
    await recordSessionEvent(db, { id: sid(1), type: "start", answers: { goal: "speed" }, arrival, device: "mobile" });
    await recordSessionEvent(db, { id: sid(1), type: "complete", answers: { ...deckAnswers, "painting.pain": "prep" } });
    await recordSessionEvent(db, { id: sid(1), type: "result", answers: deckAnswers });
    const first = await session(sid(1));
    expect(first).toMatchObject({ campaign: "bid_check_decks", source: "fb_group", trade_hint: "decks", device: "mobile", goal: "speed", trade: "decks", pain: "stairs", result_key: "speed:decks:stairs", primary_cta: "pass" });
    expect(first.answers["painting.pain"]).toBeUndefined(); // off-path answer never stored
    expect(first.completed_at).not.toBeNull();
    expect(first.result_shown_at).not.toBeNull();
    await recordSessionEvent(db, { id: sid(1), type: "result", answers: deckAnswers });
    expect(String((await session(sid(1))).result_shown_at)).toBe(String(first.result_shown_at));
    await recordSessionEvent(db, { id: sid(1), type: "deep", answers: { ...deckAnswers, volume: "0-1", who: "solo", "tools.reentry": "notes_sheet", "decks.deep": "pt", feedback: "Email me at bob@example.com or 555-123-4567, see https://x.co" } });
    const s = await session(sid(1));
    expect(s.answers.feedback).toBe("Email me at [removed] or [removed], see [link]");
    expect(s.primary_cta).toBe("free_bid");
    expect(JSON.stringify(s)).not.toMatch(/bob@example\.com/);
    const cols = (await pool.query("select column_name from information_schema.columns where table_name = 'bid_check_sessions'")).rows.map((r) => r.column_name);
    expect(cols.some((c) => /email|name|ip/.test(c))).toBe(false);
  });

  it("emails the pass once, links it to the session, and deduplicates retries", async () => {
    await recordSessionEvent(db, { id: sid(2), type: "result", answers: deckAnswers });
    const r = await requestPassFromQuestionnaire(db, { sessionId: sid(2), email: "Deck.Builder@Example.com", checkins: true });
    expect(r).toMatchObject({ status: "queued", delivered: true });
    expect(resend()).toHaveLength(1);
    expect(resend()[0].body.to).toEqual(["deck.builder@example.com"]);
    expect(resend()[0].body.html).toMatch(/\/trial\/activate#t=/);
    const inv = (await pool.query("select * from public.trial_campaign_invites where id = $1", [r.inviteId])).rows[0];
    expect(inv).toMatchObject({ source: "questionnaire", checkins_opt_in: true, status: "pending" });
    const s = await session(sid(2));
    expect(s.invite_id).toBe(r.inviteId);
    expect(s.invite_requested_at).not.toBeNull();

    // Double tap / retry within 2 minutes: nothing new is sent.
    calls = [];
    expect((await requestPassFromQuestionnaire(db, { sessionId: sid(2), email: "deck.builder@example.com", checkins: false })).status).toBe("duplicate");
    expect(resend()).toHaveLength(0);
    // Later request: the same link again (no second invite, no second pass).
    await pool.query("update public.trial_campaign_invites set last_requested_at = now() - interval '3 minutes' where id = $1", [r.inviteId]);
    const again = await requestPassFromQuestionnaire(db, { sessionId: sid(3), email: "deck.builder@example.com", checkins: false });
    expect(again).toMatchObject({ status: "resent", inviteId: r.inviteId });
    expect(tokenFrom(resend()[0])).toBeTruthy();
    expect((await pool.query("select count(*)::int n from public.trial_campaign_invites where email = 'deck.builder@example.com'")).rows[0].n).toBe(1);
    expect((await pool.query("select checkins_opt_in from public.trial_campaign_invites where id = $1", [r.inviteId])).rows[0].checkins_opt_in).toBe(true); // consent is sticky
  });

  it("activates 7 days for the verified owner only, once, with no card; expiry falls back and keeps saved bids", async () => {
    const r = await requestPassFromQuestionnaire(db, { sessionId: sid(4), email: "painter@example.com", checkins: false });
    const token = tokenFrom(resend()[0]);
    const other = await createUser(pool, "someone@example.com");
    expect(await activateTrial(db, other, token)).toMatchObject({ ok: false, reason: "email_mismatch" });
    const unverified = await createUser(pool, "painter-unverified@example.com", false);
    expect((await activateTrial(db, unverified, token)).ok).toBe(false);
    const u = await createUser(pool, "painter@example.com");
    await pool.query("insert into public.estimates (user_id, title) values ($1, 'Saved bid before the pass')", [u]);
    const a = await activateTrial(db, u, token);
    expect(a.ok).toBe(true);
    const days = (new Date((a as { expiresAt: string }).expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    expect(await activateTrial(db, u, token)).toMatchObject({ ok: true, repeat: true });
    expect((await pool.query("select count(*)::int n from public.complimentary_grants where user_id = $1", [u])).rows[0].n).toBe(1);
    expect((await pool.query("select count(*)::int n from public.subscriptions where user_id = $1", [u])).rows[0].n).toBe(0);
    expect((await pool.query("select public.has_unlimited($1) v", [u])).rows[0].v).toBe(true);
    // No check-ins without consent.
    calls = [];
    await pool.query("update public.trial_campaign_emails set send_after = now() - interval '1 minute' where invite_id = $1 and kind <> 'invite'", [r.inviteId]);
    await deliverTrialEmails(db, { config: trialEmailConfig(), limit: 50 });
    expect(resend()).toHaveLength(0);
    // Expiry: Unlimited ends, bids stay.
    await pool.query("update public.complimentary_grants set starts_at = now() - interval '8 days', expires_at = now() - interval '1 day' where user_id = $1", [u]);
    expect((await pool.query("select public.has_unlimited($1) v", [u])).rows[0].v).toBe(false);
    expect((await pool.query("select count(*)::int n from public.estimates where user_id = $1", [u])).rows[0].n).toBe(1);
    // The same email can't get a second pass.
    calls = [];
    expect((await requestPassFromQuestionnaire(db, { sessionId: sid(5), email: "painter@example.com", checkins: false })).status).toBe("already_activated");
    expect(resend()).toHaveLength(0);
  });

  it("a paid plan is kept: no pass is issued and the invite stays unused", async () => {
    const u = await createUser(pool, "payer@example.com");
    await pool.query("select public.apply_subscription_update($1::uuid, 'cus_p', 'sub_p', 'active', 'monthly', 'price_m', '2099-01-01'::timestamptz, false, null, null, now())", [u]);
    const r = await requestPassFromQuestionnaire(db, { sessionId: null, email: "payer@example.com", checkins: false });
    const res = await activateTrial(db, u, tokenFrom(resend()[0]));
    expect(res).toMatchObject({ ok: false, reason: "already_has_access" });
    expect((await pool.query("select count(*)::int n from public.complimentary_grants where user_id = $1", [u])).rows[0].n).toBe(0);
    expect((await pool.query("select status from public.trial_campaign_invites where id = $1", [r.inviteId])).rows[0].status).toBe("pending");
  });

  it("an expired invite link stops working; asking again sends a fresh link", async () => {
    const r = await requestPassFromQuestionnaire(db, { sessionId: null, email: "late@example.com", checkins: false });
    const oldToken = tokenFrom(resend()[0]);
    await pool.query("update public.trial_campaign_invites set invite_expires_at = now() - interval '1 minute', last_requested_at = now() - interval '15 days' where id = $1", [r.inviteId]);
    const u = await createUser(pool, "late@example.com");
    expect(await activateTrial(db, u, oldToken)).toMatchObject({ ok: false, reason: "invite_expired" });
    calls = [];
    expect((await requestPassFromQuestionnaire(db, { sessionId: null, email: "late@example.com", checkins: false })).status).toBe("resent");
    const fresh = tokenFrom(resend()[0]);
    expect(fresh).not.toBe(oldToken);
    expect(await activateTrial(db, u, oldToken)).toMatchObject({ ok: false, reason: "invalid" });
    expect((await activateTrial(db, u, fresh)).ok).toBe(true);
  });

  it("admin funnel counts the questionnaire steps through to activation and first finalized bid", async () => {
    const admin = await createUser(pool, "owner@example.com");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
    // The painter from the activation test finalizes a bid after activating.
    const painter = (await pool.query("select id from auth.users where email = 'painter@example.com'")).rows[0].id;
    const est = (await pool.query("select id from public.estimates where user_id = $1", [painter])).rows[0].id;
    await pool.query("update public.complimentary_grants set starts_at = now(), expires_at = now() + interval '7 days' where user_id = $1", [painter]);
    await pool.query("select * from public.finalize_bid($1, $2, encode(sha256('b'::bytea), 'hex'), '{}'::jsonb, '{}'::jsonb, 100, 125, 0, 125)", [painter, est]);
    await recordSessionEvent(db, { id: sid(4), type: "result", answers: { goal: "proposals", trade: "painting", "painting.job": "interior", "painting.pain": "materials", "painting.follow.proposals.materials": "coats", tools: "notes" } });
    const f = (await pool.query("select public.bid_check_funnel($1) f", [admin])).rows[0].f;
    expect(f.started).toBeGreaterThanOrEqual(3);
    expect(f.result_shown).toBeGreaterThanOrEqual(3);
    expect(f.invite_requested).toBeGreaterThanOrEqual(3);
    expect(f.pass_activated).toBeGreaterThanOrEqual(1);
    expect(f.first_bid_finalized).toBe(1);
    expect(f.by_goal.speed).toBeGreaterThanOrEqual(1);
    expect(f.recent_feedback[0].text).toMatch(/\[removed\]/);
    await expect(pool.query("select public.bid_check_funnel($1)", [painter])).rejects.toThrow(/forbidden/);
  });
});
