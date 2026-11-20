import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createUser, dbAvailable, freshDb } from "./harness";
import { pgSupabase } from "./pg-supabase";
import { trialConfig, PAYLOAD_CHECKINS_YES, PAYLOAD_SEND_INVITE } from "@/lib/trial/config";
import { processMetaPayload, type MetaPayload } from "@/lib/trial/flow";
import { activateTrial, metaFlowDeps, requestTrialInvite, runTrialJobs } from "@/lib/trial/service";
import { deliverTrialEmails, trialEmailConfig } from "@/lib/trial/delivery";

/**
 * End to end through the real migration: Meta webhook payloads -> private reply -> Messenger
 * conversation -> invite email (Resend) -> verified activation -> reminders and check-ins.
 * Meta and Resend are faked at the HTTP boundary; everything else is the production code.
 */
const available = await dbAvailable();
const d = available ? describe : describe.skip;

const ENV = {
  FB_TRIAL_ENABLED: "true", RESEND_API_KEY: "re_test", SUPABASE_SERVICE_ROLE_KEY: "service-key-for-tests",
  META_APP_ID: "111", META_APP_SECRET: "app-secret", META_PAGE_ID: "999", META_PAGE_ACCESS_TOKEN: "page-token",
  META_VERIFY_TOKEN: "verify", META_TEST_POST_IDS: "999_1", META_AD_POST_IDS: "999_2",
};
Object.assign(process.env, ENV);

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
let calls: Call[] = [];
let resendStatus: number[] = []; // queued statuses for the next Resend calls (default 200)
let graphFail: { status: number; code: number }[] = [];
const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? "{}"));
  calls.push({ url, body, headers: init?.headers as Record<string, string> });
  if (url.startsWith("https://api.resend.com")) {
    const s = resendStatus.shift() ?? 200;
    return new Response(JSON.stringify(s === 200 ? { id: `re_${calls.length}` } : { name: "error" }), { status: s });
  }
  if (url.startsWith("https://graph.facebook.com")) {
    const f = graphFail.shift();
    if (f) return new Response(JSON.stringify({ error: { code: f.code, message: "fail" } }), { status: f.status });
    return new Response(JSON.stringify({ recipient_id: "x", message_id: `m_${calls.length}` }), { status: 200 });
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;
globalThis.fetch = fakeFetch; // delivery called through requestTrialInvite uses the global

const graphCalls = () => calls.filter((c) => c.url.includes("graph.facebook.com"));
const resendCalls = () => calls.filter((c) => c.url.includes("api.resend.com"));

const comment = (id: string, o: Partial<{ post: string; text: string; verb: string; from: string }> = {}): MetaPayload => ({
  object: "page",
  entry: [{ id: "999", changes: [{ field: "feed", value: { item: "comment", verb: o.verb ?? "add", post_id: o.post ?? "999_1", comment_id: id, message: o.text ?? "BID", from: { id: o.from ?? "555" }, created_time: Math.floor(Date.now() / 1000) } }] }],
});
const msg = (psid: string, mid: string, m: { text?: string; payload?: string }): MetaPayload => ({
  object: "page",
  entry: [{ id: "999", messaging: [{ sender: { id: psid }, recipient: { id: "999" }, timestamp: Date.now(), message: { mid, text: m.text, ...(m.payload ? { quick_reply: { payload: m.payload } } : {}) } }] }],
});
const tokenFrom = (call: Call) => String((call.body.html as string).match(/#t=([A-Za-z0-9._-]+)/)?.[1]);

d("Facebook BID trial end to end", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let db: SupabaseClient;
  const deps = () => metaFlowDeps(db, trialConfig(), fakeFetch);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("b2b_test_fb_trial_flow"));
    db = pgSupabase(pool);
  });
  afterAll(async () => { await drop?.(); });
  beforeEach(() => { calls = []; resendStatus = []; graphFail = []; });

  it("comment -> private reply -> tap -> email -> invite -> new user activates 7 days once", async () => {
    // 1. Qualifying comment: one private reply with the quick reply.
    const s1 = await processMetaPayload(comment("c1", { text: "bid!" }), deps());
    expect(s1).toMatchObject({ comments: 1, replied: 1 });
    const [pr] = graphCalls();
    expect(pr.url).toContain("/v26.0/999/messages");
    expect(pr.url).toContain("appsecret_proof=");
    expect(pr.url).not.toContain("page-token");
    expect(pr.headers.authorization).toBe("Bearer page-token");
    expect(pr.body).toMatchObject({ recipient: { comment_id: "c1" }, message: { quick_replies: [{ title: "Send my invite", payload: PAYLOAD_SEND_INVITE }] } });

    // Webhook retry / duplicate delivery of the same comment: no second reply.
    expect(await processMetaPayload(comment("c1"), deps())).toMatchObject({ duplicates: 1, replied: 0 });
    // Edits, other posts, other words and the Page's own comments are ignored.
    const ign = await processMetaPayload({ object: "page", entry: [
      ...comment("c2", { verb: "edited" }).entry!, ...comment("c3", { post: "999_7" }).entry!,
      ...comment("c4", { text: "bid please send pricing" }).entry!, ...comment("c5", { from: "999" }).entry!,
      { id: "888", changes: comment("c6").entry![0].changes },
    ] }, deps());
    expect(ign).toMatchObject({ comments: 0, replied: 0 });
    expect(graphCalls()).toHaveLength(1);

    // 2. They tap "Send my invite": we ask for the email, with Messenger's email quick reply.
    calls = [];
    await processMetaPayload(msg("psid-new", "mid-1", { text: "Send my invite", payload: PAYLOAD_SEND_INVITE }), deps());
    expect(graphCalls()[0].body).toMatchObject({ recipient: { id: "psid-new" }, messaging_type: "RESPONSE", message: { quick_replies: [{ content_type: "user_email" }] } });
    const contact = (await pool.query("select * from public.trial_campaign_contacts where psid = 'psid-new'")).rows[0];
    expect(contact.state).toBe("awaiting_email");
    const due = new Date(contact.reminder_due_at).getTime() - Date.now();
    expect(due).toBeGreaterThan(3.9 * 3_600_000);
    expect(due).toBeLessThanOrEqual(4 * 3_600_000);
    // Same message delivered twice: handled once.
    expect(await processMetaPayload(msg("psid-new", "mid-1", { text: "Send my invite", payload: PAYLOAD_SEND_INVITE }), deps())).toMatchObject({ duplicates: 1 });

    // 3. They send their email: invite emailed, link token only in the fragment.
    calls = [];
    await processMetaPayload(msg("psid-new", "mid-2", { text: "it's NewPerson@Example.com thanks" }), deps());
    const [mail] = resendCalls();
    expect(mail.body.to).toEqual(["newperson@example.com"]);
    expect(mail.body.subject).toBe("Your 7 free days of Built2Bid Individual Unlimited");
    expect(mail.headers["idempotency-key"]).toMatch(/^trial-email\//);
    expect(String(mail.body.html)).toMatch(/\/trial\/activate#t=/);
    expect(String(mail.body.html)).not.toMatch(/\?t=|token=/);
    const done = graphCalls().find((c) => (c.body.message as { text: string }).text.startsWith("Done!"))!;
    expect((done.body.message as { text: string }).text).toContain("n***@example.com");
    expect((done.body.message as { text: string }).text).not.toContain("newperson@example.com");
    expect((await pool.query("select state from public.trial_campaign_contacts where psid = 'psid-new'")).rows[0].state).toBe("invited");

    // Same email again right away: no second email.
    calls = [];
    await processMetaPayload(msg("psid-new", "mid-3", { text: "newperson@example.com" }), deps());
    expect(resendCalls()).toHaveLength(0);
    expect((graphCalls()[0].body.message as { text: string }).text).toMatch(/^I just sent it/);

    // 4. Check-ins consent.
    await processMetaPayload(msg("psid-new", "mid-4", { text: "Yes, send tips", payload: PAYLOAD_CHECKINS_YES }), deps());
    expect((await pool.query("select checkins_opt_in from public.trial_campaign_invites where email = 'newperson@example.com'")).rows[0].checkins_opt_in).toBe(true);

    // 5. Activation needs the right token AND the verified owner of the address.
    const token = tokenFrom(mail);
    const stranger = await createUser(pool, "stranger@example.com");
    expect(await activateTrial(db, stranger, token)).toMatchObject({ ok: false, reason: "email_mismatch" });
    const user = await createUser(pool, "newperson@example.com"); // new account, verified by the 6-digit code
    expect(await activateTrial(db, user, token.slice(0, -2) + "xx")).toMatchObject({ ok: false, reason: "invalid" });
    const a = await activateTrial(db, user, token);
    expect(a.ok).toBe(true);
    const b = await activateTrial(db, user, token);
    expect(b).toMatchObject({ ok: true, repeat: true });
    expect((await pool.query("select count(*)::int n from public.complimentary_grants where user_id = $1", [user])).rows[0].n).toBe(1);
    expect((await pool.query("select public.has_unlimited($1) v", [user])).rows[0].v).toBe(true);

    // 6. Reminder never goes to someone who already gave their email.
    calls = [];
    await runTrialJobs(db, { fetchImpl: fakeFetch, now: new Date(Date.now() + 5 * 3_600_000) });
    expect(graphCalls()).toHaveLength(0);
  });

  it("one reminder ~4h after tapping, only inside the 24h window, never after STOP", async () => {
    await processMetaPayload(msg("psid-r", "r-1", { text: "invite" }), deps());
    await processMetaPayload(msg("psid-late", "l-1", { text: "invite" }), deps());
    await processMetaPayload(msg("psid-stop", "s-1", { text: "invite" }), deps());
    calls = [];
    await processMetaPayload(msg("psid-stop", "s-2", { text: "STOP" }), deps());
    expect((graphCalls()[0].body.message as { text: string }).text).toMatch(/unsubscribed/);
    // psid-late's window closes before the reminder is due.
    await pool.query("update public.trial_campaign_contacts set last_inbound_at = now() - interval '25 hours', reminder_due_at = now() - interval '1 minute' where psid = 'psid-late'");

    calls = [];
    await runTrialJobs(db, { fetchImpl: fakeFetch, now: new Date(Date.now() + 3 * 3_600_000) });
    expect(graphCalls()).toHaveLength(0); // not due yet (and psid-late expired)
    await runTrialJobs(db, { fetchImpl: fakeFetch, now: new Date(Date.now() + 4 * 3_600_000 + 60_000) });
    expect(graphCalls().map((c) => (c.body.recipient as { id: string }).id)).toEqual(["psid-r"]);
    await runTrialJobs(db, { fetchImpl: fakeFetch, now: new Date(Date.now() + 6 * 3_600_000) });
    expect(graphCalls()).toHaveLength(1); // only one reminder ever

    // A stranger messaging the Page about something else gets no automated reply and no contact row.
    calls = [];
    await processMetaPayload(msg("psid-random", "x-1", { text: "Do you do roofing in Austin?" }), deps());
    expect(graphCalls()).toHaveLength(0);
    expect((await pool.query("select count(*)::int n from public.trial_campaign_contacts where psid = 'psid-random'")).rows[0].n).toBe(0);
  });

  it("private reply: falls back to text-only on a quick-reply rejection, retries transient failures once per job", async () => {
    graphFail = [{ status: 400, code: 100 }];
    await processMetaPayload(comment("c-fallback"), deps());
    expect(graphCalls()).toHaveLength(2);
    expect(graphCalls()[1].body.message).toEqual({ text: expect.stringContaining('Reply "INVITE"') });
    expect((await pool.query("select status, reply_format from public.trial_campaign_events where dedupe_key = 'comment:c-fallback'")).rows[0]).toEqual({ status: "replied", reply_format: "text_only" });

    calls = [];
    graphFail = [{ status: 500, code: 2 }];
    await processMetaPayload(comment("c-retry"), deps());
    expect((await pool.query("select status from public.trial_campaign_events where dedupe_key = 'comment:c-retry'")).rows[0].status).toBe("failed");
    await runTrialJobs(db, { fetchImpl: fakeFetch });
    expect((await pool.query("select status, attempts from public.trial_campaign_events where dedupe_key = 'comment:c-retry'")).rows[0]).toEqual({ status: "replied", attempts: 2 });
    calls = [];
    await runTrialJobs(db, { fetchImpl: fakeFetch });
    expect(graphCalls().filter((c) => (c.body.recipient as { comment_id?: string }).comment_id)).toHaveLength(0);
  });

  it("an email failure is retried safely with the same idempotency key; a hard rejection stops", async () => {
    resendStatus = [500];
    const r = await requestTrialInvite(db, { email: "flaky@example.com", source: "claim_page", fetchImpl: fakeFetch });
    expect(r).toMatchObject({ status: "queued", delivered: false });
    const row = (await pool.query("select id, status, attempts from public.trial_campaign_emails where invite_id = $1", [r.inviteId])).rows[0];
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    // Two workers at once: one send.
    await Promise.all([runTrialJobs(db, { fetchImpl: fakeFetch }), runTrialJobs(db, { fetchImpl: fakeFetch })]);
    const sends = resendCalls();
    expect(sends).toHaveLength(2);
    expect(sends[0].headers["idempotency-key"]).toBe(sends[1].headers["idempotency-key"]);
    expect((await pool.query("select status from public.trial_campaign_emails where id = $1", [row.id])).rows[0].status).toBe("sent");

    calls = [];
    resendStatus = [422];
    const bad = await requestTrialInvite(db, { email: "rejected@example.com", source: "claim_page", fetchImpl: fakeFetch });
    expect((await pool.query("select status from public.trial_campaign_emails where invite_id = $1", [bad.inviteId])).rows[0].status).toBe("skipped");
    // The person can simply ask again later: a fresh copy is queued and sent.
    await pool.query("update public.trial_campaign_invites set last_requested_at = now() - interval '5 minutes' where id = $1", [bad.inviteId]);
    expect((await requestTrialInvite(db, { email: "rejected@example.com", source: "claim_page" })).delivered).toBe(true);
  });

  it("existing Free user via the claim page; a paid user keeps their plan", async () => {
    const free = await createUser(pool, "free@example.com");
    const before = (await pool.query("select count(*)::int n from public.credit_ledger where user_id = $1", [free])).rows[0].n;
    calls = [];
    await requestTrialInvite(db, { email: "free@example.com", source: "claim_page" });
    expect((await activateTrial(db, free, tokenFrom(resendCalls()[0]))).ok).toBe(true);
    expect((await pool.query("select count(*)::int n from public.credit_ledger where user_id = $1", [free])).rows[0].n).toBe(before);

    const payer = await createUser(pool, "payer@example.com");
    await pool.query("select public.apply_subscription_update($1::uuid, 'cus_p', 'sub_p', 'active', 'monthly', 'price_m', '2099-01-01'::timestamptz, false, null, null, now())", [payer]);
    calls = [];
    await requestTrialInvite(db, { email: "payer@example.com", source: "messenger" });
    expect(await activateTrial(db, payer, tokenFrom(resendCalls()[0]))).toMatchObject({ ok: false, reason: "already_has_access" });
    expect((await pool.query("select count(*)::int n from public.complimentary_grants where user_id = $1", [payer])).rows[0].n).toBe(0);
  });

  it("check-ins: day 2 only if no finished bid, day 6 with the expiry date, both suppressed after an upgrade or opt-out", async () => {
    const mk = async (email: string, checkins: boolean) => {
      calls = [];
      const u = await createUser(pool, email);
      const r = await requestTrialInvite(db, { email, source: "claim_page", checkins });
      await activateTrial(db, u, tokenFrom(resendCalls()[0]));
      await pool.query("update public.trial_campaign_emails set send_after = now() - interval '1 minute' where invite_id = $1 and kind <> 'invite'", [r.inviteId]);
      return { u, invite: r.inviteId };
    };
    const yes = await mk("tips@example.com", true);
    const no = await mk("notips@example.com", false);
    const builder = await mk("builder@example.com", true);
    const est = (await pool.query("insert into public.estimates (user_id, title) values ($1, 'x') returning id", [builder.u])).rows[0].id;
    await pool.query("select * from public.finalize_bid($1, $2, encode(sha256('b'::bytea), 'hex'), '{}'::jsonb, '{}'::jsonb, 100, 125, 0, 125)", [builder.u, est]);
    const converted = await mk("converted@example.com", true);
    await pool.query("select public.apply_subscription_update($1::uuid, 'cus_c', 'sub_c', 'active', 'annual', 'price_a', '2099-01-01'::timestamptz, false, null, null, now())", [converted.u]);

    calls = [];
    await deliverTrialEmails(db, { config: trialEmailConfig(), fetchImpl: fakeFetch, limit: 100 });
    const sent = resendCalls().map((c) => `${(c.body.to as string[])[0]}:${c.body.subject}`);
    expect(sent.sort()).toEqual([
      "builder@example.com:Your free Built2Bid week ends soon",
      "tips@example.com:Your first Built2Bid bid in 5 minutes",
      "tips@example.com:Your free Built2Bid week ends soon",
    ]);
    const day6 = resendCalls().find((c) => c.body.subject === "Your free Built2Bid week ends soon" && (c.body.to as string[])[0] === "tips@example.com")!;
    expect(String(day6.body.text)).toMatch(/ends (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), /);
    expect((day6.body.headers as Record<string, string>)["List-Unsubscribe"]).toMatch(/\/trial\/unsubscribe\?i=/);
    const skipped = (await pool.query("select i.email, e.kind, e.last_error from public.trial_campaign_emails e join public.trial_campaign_invites i on i.id = e.invite_id where e.status = 'skipped' and e.kind <> 'invite' order by 1, 2")).rows;
    expect(skipped).toEqual([
      { email: "builder@example.com", kind: "day2", last_error: "already finished a bid" },
      { email: "converted@example.com", kind: "day2", last_error: "converted" },
      { email: "converted@example.com", kind: "day6", last_error: "converted" },
      { email: "notips@example.com", kind: "day2", last_error: "no check-in consent" },
      { email: "notips@example.com", kind: "day6", last_error: "no check-in consent" },
    ]);
    void no; void yes;
  });

  it("everything stays quiet while the campaign switch is off", async () => {
    process.env.FB_TRIAL_ENABLED = "false";
    try {
      calls = [];
      const out = await runTrialJobs(db, { fetchImpl: fakeFetch });
      expect(out.emails.disabled).toBe(true);
      expect(calls).toHaveLength(0);
    } finally {
      process.env.FB_TRIAL_ENABLED = "true";
    }
  });
});
