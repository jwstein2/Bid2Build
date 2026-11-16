import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const MIGRATION = "20261116008000_facebook_trial_funnel.sql";

const request = async (email: string, source = "messenger", contact: string | null = null, checkins = false): Promise<Row> =>
  (await pool.query("select public.trial_request_invite($1, $2, $3, $4) as r", [email, source, contact, checkins])).rows[0].r;
const activate = async (user: string, invite: string, version = 1): Promise<Row> =>
  (await pool.query("select public.trial_activate($1, $2, $3) as r", [user, invite, version])).rows[0].r;
const unlimited = async (u: string) => (await pool.query("select public.has_unlimited($1) as v", [u])).rows[0].v as boolean;
const invite = async (id: string) => (await pool.query("select * from public.trial_campaign_invites where id = $1", [id])).rows[0];
const grantsFor = async (u: string) => (await pool.query("select * from public.complimentary_grants where user_id = $1 order by created_at", [u])).rows;
const emails = async (inviteId: string) => (await pool.query("select kind, seq, status from public.trial_campaign_emails where invite_id = $1 order by kind, seq", [inviteId])).rows;
const subscribe = (u: string, status = "active", periodEnd = "2099-01-01T00:00:00Z") =>
  pool.query(
    "select public.apply_subscription_update($1::uuid, $4, $5, $2, 'monthly', 'price_m', $3::timestamptz, false, null, null, now())",
    [u, status, periodEnd, `cus_${u}`, `sub_${u}_${status}`],
  );
const credits = (u: string) => asUser(pool, u, (q) => q("select * from public.credit_status()")).then((r) => r.rows[0]);
const sqlError = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

d("Facebook BID trial (database)", () => {
  let admin: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("b2b_test_fb_trial", { stopBefore: MIGRATION }));
    admin = await createUser(pool, "owner@built2bid.test");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
    await applyMigration(pool, MIGRATION);
    await applyMigration(pool, MIGRATION); // safe to re-run
  });
  afterAll(async () => { await drop?.(); });

  it("customers cannot call any campaign function or read campaign tables", async () => {
    const u = await createUser(pool, "nosy@test.dev");
    for (const sql of [
      "select public.trial_request_invite('x@test.dev', 'claim_page')",
      "select public.trial_activate($1, gen_random_uuid(), 1)",
      "select public.trial_campaign_funnel($1)",
      "select * from public.trial_campaign_invites",
      "select * from public.trial_campaign_contacts",
    ]) {
      await expect(asUser(pool, u, (q) => q(sql, sql.includes("$1") ? [u] : []))).rejects.toThrow(/permission denied/);
    }
    // anon can't even see its own trial helper
    expect(await sqlError(pool.query("set role anon; select * from public.my_campaign_trial(); reset role;"))).toMatch(/permission denied/);
    await pool.query("reset role");
  });

  it("an invite request is idempotent: duplicates within 2 minutes queue nothing, resends are capped", async () => {
    const r1 = await request("  Dup@Test.dev ");
    expect(r1.status).toBe("queued");
    expect(r1.email_id).toBeTruthy();
    expect((await invite(r1.invite_id)).email).toBe("dup@test.dev");
    const r2 = await request("dup@test.dev");
    expect(r2).toMatchObject({ status: "duplicate", invite_id: r1.invite_id, email_id: null });
    // Later requests resend the same link (same token version), up to 5 copies.
    for (let i = 2; i <= 5; i++) {
      await pool.query("update public.trial_campaign_invites set last_requested_at = now() - interval '3 minutes' where id = $1", [r1.invite_id]);
      const r = await request("dup@test.dev");
      expect(r.status).toBe("resent");
      expect(r.token_version).toBe(1);
    }
    await pool.query("update public.trial_campaign_invites set last_requested_at = now() - interval '3 minutes' where id = $1", [r1.invite_id]);
    expect((await request("dup@test.dev")).status).toBe("limit");
    expect((await emails(r1.invite_id)).filter((e) => e.kind === "invite")).toHaveLength(5);
    expect(await sqlError(request("not-an-email"))).toBe("invalid_email");
    expect(await sqlError(request("ok@test.dev", "admin"))).toBe("invalid_source");
  });

  it("concurrent requests for one email create exactly one invite and one email", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => request("race@test.dev", "claim_page")));
    expect(results.filter((r) => r.status === "queued")).toHaveLength(1);
    expect(new Set(results.map((r) => r.invite_id)).size).toBe(1);
    expect(await emails(results[0].invite_id)).toHaveLength(1);
  });

  it("an expired invite gets a fresh link (old token version stops working)", async () => {
    const r = await request("stale@test.dev");
    await pool.query("update public.trial_campaign_invites set invite_expires_at = now() - interval '1 minute', last_requested_at = now() - interval '1 hour' where id = $1", [r.invite_id]);
    const u = await createUser(pool, "stale@test.dev");
    expect((await activate(u, r.invite_id, 1)).reason).toBe("invite_expired");
    const again = await request("stale@test.dev");
    expect(again).toMatchObject({ status: "resent", token_version: 2 });
    expect((await activate(u, r.invite_id, 1)).reason).toBe("invalid");
    expect((await activate(u, r.invite_id, 2)).ok).toBe(true);
  });

  it("new user: verified sign-in with the invited email activates exactly 7 days of Unlimited, once", async () => {
    const r = await request("newbie@test.dev", "messenger", null, true);
    // Signing up does NOT activate it (the existing comp auto-claim trigger ignores campaign invites).
    const u = await createUser(pool, "newbie@test.dev");
    expect(await unlimited(u)).toBe(false);
    expect(await grantsFor(u)).toHaveLength(0);

    const a = await activate(u, r.invite_id);
    expect(a.ok).toBe(true);
    const ms = new Date(a.expires_at).getTime() - Date.now();
    expect(ms).toBeGreaterThan(7 * 86_400_000 - 60_000);
    expect(ms).toBeLessThanOrEqual(7 * 86_400_000);
    expect(await unlimited(u)).toBe(true);
    expect((await credits(u)).unlimited).toBe(true);

    const [g] = await grantsFor(u);
    expect(g).toMatchObject({ plan: "unlimited", duration_days: 7, included_seats: 1, extra_seats: 0, status: "active", company_id: null, granted_by: null });
    // Nothing in Stripe tables.
    expect((await pool.query("select count(*)::int n from public.subscriptions where user_id = $1", [u])).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int n from public.billing_customers where user_id = $1", [u])).rows[0].n).toBe(0);

    // Repeat clicks / retries: same expiry, no second grant.
    const again = await activate(u, r.invite_id);
    expect(again).toMatchObject({ ok: true, repeat: true, expires_at: a.expires_at });
    expect(await grantsFor(u)).toHaveLength(1);
    // Check-ins scheduled once.
    expect((await emails(r.invite_id)).map((e) => e.kind)).toEqual(["day2", "day6", "invite"]);
    // Audit trail.
    expect((await pool.query("select count(*)::int n from public.audit_logs where action = 'comp.campaign_activate' and actor_id = $1", [u])).rows[0].n).toBe(1);
    // Dashboard helper.
    const mine = await asUser(pool, u, (q) => q("select * from public.my_campaign_trial()"));
    expect(mine.rows[0]).toMatchObject({ state: "active", has_paid_subscription: false });
    // Requesting again for an activated email sends nothing.
    expect((await request("newbie@test.dev")).status).toBe("already_activated");
  });

  it("concurrent activations of one invite issue one pass", async () => {
    const r = await request("burst@test.dev");
    const u = await createUser(pool, "burst@test.dev");
    const results = await Promise.all(Array.from({ length: 6 }, () => activate(u, r.invite_id)));
    expect(results.every((x) => x.ok)).toBe(true);
    expect(new Set(results.map((x) => x.expires_at)).size).toBe(1);
    expect(await grantsFor(u)).toHaveLength(1);
  });

  it("existing Free user: pass works, then expiry restores Free and keeps bids, credits and other grants", async () => {
    const u = await createUser(pool, "freeuser@test.dev");
    const before = await credits(u);
    expect(before.unlimited).toBe(false);
    await pool.query("insert into public.estimates (user_id, title) values ($1, 'My saved bid')", [u]);
    await pool.query("insert into public.customers (user_id, name) values ($1, 'Pat Customer')", [u]).catch(() => {});
    // An older, ended complimentary grant should survive untouched.
    const old = await pool.query(
      `insert into public.complimentary_grants (email, user_id, plan, duration_days, status, starts_at, expires_at, activated_at, note)
       values ('freeuser@test.dev', $1, 'unlimited', 3, 'active', now() - interval '30 days', now() - interval '27 days', now() - interval '30 days', 'old') returning id`, [u]);

    const r = await request("freeuser@test.dev", "claim_page");
    expect((await activate(u, r.invite_id)).ok).toBe(true);
    expect(await unlimited(u)).toBe(true);

    // Fast-forward past the end of the trial.
    await pool.query("update public.complimentary_grants set starts_at = starts_at - interval '8 days', expires_at = expires_at - interval '8 days' where id = (select grant_id from public.trial_campaign_invites where id = $1)", [r.invite_id]);
    expect(await unlimited(u)).toBe(false);
    const after = await credits(u);
    expect(after.unlimited).toBe(false);
    expect(after.starter_balance).toBe(before.starter_balance);
    expect(after.monthly_balance).toBe(before.monthly_balance);
    expect((await pool.query("select count(*)::int n from public.estimates where user_id = $1", [u])).rows[0].n).toBe(1);
    expect((await pool.query("select id from public.complimentary_grants where id = $1", [old.rows[0].id])).rowCount).toBe(1);
    const mine = await asUser(pool, u, (q) => q("select * from public.my_campaign_trial()"));
    expect(mine.rows[0].state).toBe("expired");
    // The ended trial can't be re-activated.
    expect((await activate(u, r.invite_id)).repeat).toBe(true);
    expect(await unlimited(u)).toBe(false);
  });

  it("paid user keeps their plan: no pass is issued and the invite stays unused", async () => {
    const u = await createUser(pool, "payer@test.dev");
    await subscribe(u);
    const r = await request("payer@test.dev");
    const a = await activate(u, r.invite_id);
    expect(a).toMatchObject({ ok: false, reason: "already_has_access" });
    expect(await grantsFor(u)).toHaveLength(0);
    expect((await invite(r.invite_id)).status).toBe("pending");
    expect((await pool.query("select status from public.subscriptions where user_id = $1", [u])).rows[0].status).toBe("active");
  });

  it("someone with an active complimentary or Enterprise grant keeps it", async () => {
    const u = await createUser(pool, "comped@test.dev");
    await pool.query(
      `insert into public.complimentary_grants (email, user_id, plan, duration_days, included_seats, status, starts_at, expires_at, activated_at)
       values ('comped@test.dev', $1, 'enterprise', 90, 3, 'active', now(), now() + interval '90 days', now())`, [u]);
    const r = await request("comped@test.dev");
    expect((await activate(u, r.invite_id)).reason).toBe("already_has_access");
    expect((await grantsFor(u)).map((g) => g.plan)).toEqual(["enterprise"]);
  });

  it("only the verified owner of the invited email can activate", async () => {
    const r = await request("owner-only@test.dev");
    const other = await createUser(pool, "someone-else@test.dev");
    const a = await activate(other, r.invite_id);
    expect(a).toMatchObject({ ok: false, reason: "email_mismatch", hint: "o***@test.dev" });
    const unverified = await createUser(pool, "owner-only@test.dev", false);
    expect((await activate(unverified, r.invite_id)).reason).toBe("email_unverified");
    expect(await grantsFor(other)).toHaveLength(0);
    expect(await grantsFor(unverified)).toHaveLength(0);
    // Wrong token version / unknown invite.
    const real = await createUser(pool, "owner-only@test.dev");
    expect((await activate(real, r.invite_id, 9)).reason).toBe("invalid");
    expect((await activate(real, "00000000-0000-0000-0000-000000000000")).reason).toBe("invalid");
  });

  it("one pass per account, even if the account changes email", async () => {
    const u = await createUser(pool, "first@test.dev");
    const r1 = await request("first@test.dev");
    expect((await activate(u, r1.invite_id)).ok).toBe(true);
    await pool.query("update public.complimentary_grants set expires_at = now() - interval '1 second', starts_at = now() - interval '7 days' where user_id = $1", [u]);
    await pool.query("update auth.users set email = 'second@test.dev' where id = $1", [u]);
    const r2 = await request("second@test.dev");
    expect((await activate(u, r2.invite_id)).reason).toBe("already_used");
    expect((await invite(r2.invite_id)).status).toBe("already_used");
    expect(await grantsFor(u)).toHaveLength(1);
  });

  it("the pass is fixed: 7-day Unlimited, created active so the comp auto-claim never touches it", async () => {
    const all = (await pool.query("select g.plan, g.duration_days, g.status from public.complimentary_grants g join public.trial_campaign_invites i on i.grant_id = g.id")).rows;
    expect(all.length).toBeGreaterThan(0);
    for (const g of all) expect(g).toMatchObject({ plan: "unlimited", duration_days: 7 });
    // No campaign function accepts a plan, duration, seats or role.
    const args = (await pool.query("select pg_get_function_arguments(p.oid) a from pg_proc p where p.proname in ('trial_request_invite', 'trial_activate', 'trial_set_checkins')")).rows.map((r) => r.a).join(" ");
    expect(args).not.toMatch(/plan|days|seat|role|admin/i);
  });

  it("check-in context honours consent, opt-out, conversion and finished bids", async () => {
    const u = await createUser(pool, "checkins@test.dev");
    const r = await request("checkins@test.dev", "claim_page", null, true);
    await activate(u, r.invite_id);
    const ctx = async () => (await pool.query("select public.trial_checkin_context($1) c", [r.invite_id])).rows[0].c;
    expect(await ctx()).toMatchObject({ opted_in: true, grant_active: true, finished_bid: false, paid: false, suppressed: false });
    await pool.query("select public.trial_set_checkins($1, false)", [r.invite_id]);
    expect((await ctx()).opted_in).toBe(false);
    // Opting out sticks even if they ask for the invite again with check-ins ticked.
    await pool.query("update public.trial_campaign_invites set status = 'pending' where id = $1", [r.invite_id]);
    await pool.query("update public.trial_campaign_invites set last_requested_at = now() - interval '1 hour' where id = $1", [r.invite_id]);
    await request("checkins@test.dev", "claim_page", null, true);
    await pool.query("update public.trial_campaign_invites set status = 'activated' where id = $1", [r.invite_id]);
    expect((await ctx()).opted_in).toBe(false);
    await subscribe(u);
    expect((await ctx()).paid).toBe(true);
  });

  it("Messenger contacts move to invited and stop reminders when an email is submitted", async () => {
    const c = (await pool.query("insert into public.trial_campaign_contacts (channel, page_id, psid, state, reminder_due_at) values ('messenger', '123', 'psid-1', 'awaiting_email', now() + interval '4 hours') returning id")).rows[0].id;
    const r = await request("contact@test.dev", "messenger", c);
    const row = (await pool.query("select state, invite_id, reminder_due_at from public.trial_campaign_contacts where id = $1", [c])).rows[0];
    expect(row).toMatchObject({ state: "invited", invite_id: r.invite_id, reminder_due_at: null });
    // An opted-out contact stays opted out.
    const c2 = (await pool.query("insert into public.trial_campaign_contacts (channel, page_id, psid, state) values ('messenger', '123', 'psid-2', 'opted_out') returning id")).rows[0].id;
    await request("contact2@test.dev", "messenger", c2);
    expect((await pool.query("select state from public.trial_campaign_contacts where id = $1", [c2])).rows[0].state).toBe("opted_out");
  });

  it("funnel counts are admin-only and track each stage", async () => {
    expect(await sqlError(pool.query("select public.trial_campaign_funnel(gen_random_uuid())"))).toBe("forbidden");
    await pool.query("insert into public.trial_campaign_events (dedupe_key, kind, post_id, status) values ('comment:1', 'comment', '123_9', 'replied'), ('comment:2', 'comment', '123_9', 'failed')");
    // A finished bid and a paid upgrade after activation.
    const u = (await pool.query("select user_id from public.trial_campaign_invites where email = 'freeuser@test.dev'")).rows[0].user_id;
    const est = (await pool.query("select id from public.estimates where user_id = $1 limit 1", [u])).rows[0].id;
    await pool.query("select * from public.finalize_bid($1, $2, encode(sha256(random()::text::bytea), 'hex'), '{}'::jsonb, '{}'::jsonb, 100, 125, 0, 125)", [u, est]);
    await subscribe(u);
    const f = (await pool.query("select public.trial_campaign_funnel($1) f", [admin])).rows[0].f;
    expect(f.qualifying_comments).toBe(2);
    expect(f.private_replies_sent).toBe(1);
    expect(f.trials_activated).toBeGreaterThanOrEqual(5);
    expect(f.first_bid_finalized).toBeGreaterThanOrEqual(1);
    expect(f.first_paid_upgrade).toBeGreaterThanOrEqual(2); // freeuser + checkins
    expect(f.by_post[0]).toMatchObject({ post_id: "123_9", comments: 2, replied: 1 });
  });
});
