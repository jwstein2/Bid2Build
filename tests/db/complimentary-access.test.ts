import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const MIGRATION = "20261114004000_complimentary_access.sql";
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const token = () => randomBytes(32).toString("base64url");

const subscribe = (u: string, status = "active", periodEnd = "2099-01-01T00:00:00Z") =>
  pool.query(
    "select public.apply_subscription_update($1::uuid, $4, $5, $2, 'monthly', 'price_m', $3::timestamptz, false, null, null, now())",
    [u, status, periodEnd, `cus_${u}`, `sub_${u}`],
  );

async function create(caller: string, email: string, plan = "unlimited", days = 30, extra = 0, tokenHash: string | null = hash(token())): Promise<Row> {
  const r = await pool.query("select public.admin_comp_create($1, $2, $3, $4, $5, 'test', $6) as g", [caller, email, plan, days, extra, tokenHash]);
  return r.rows[0].g;
}
const unlimited = async (u: string) => (await pool.query("select public.has_unlimited($1) as v", [u])).rows[0].v as boolean;
const row = async (id: string) => (await pool.query("select g.*, public.comp_grant_state(g) as state from public.complimentary_grants g where id = $1", [id])).rows[0];
const sqlError = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

d("complimentary access (database)", () => {
  let admin: string, existing: string, payer: string, stranger: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_comp", { stopBefore: MIGRATION }));
    admin = await createUser(pool, "owner@built2bid.test");
    existing = await createUser(pool, "existing@test.dev");
    payer = await createUser(pool, "payer@test.dev");
    stranger = await createUser(pool, "stranger@test.dev");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
    await subscribe(payer);
    await applyMigration(pool, MIGRATION);
    await applyMigration(pool, MIGRATION); // idempotent
  });
  afterAll(async () => { await drop?.(); });

  it("only platform admins can grant; customers cannot call any admin function", async () => {
    expect(await sqlError(create(stranger, "x@test.dev"))).toBe("forbidden");
    await expect(asUser(pool, stranger, (q) => q("select public.admin_comp_create($1, 'x@test.dev', 'unlimited', 7)", [stranger]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, stranger, (q) => q("select * from public.complimentary_grants"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, stranger, (q) => q("select public.claim_comp_grants_for($1)", [stranger]))).rejects.toThrow(/permission denied/);
  });

  it("existing verified account: Unlimited starts now, expires after the duration, never touches Stripe tables", async () => {
    const before = (await pool.query("select (select count(*) from public.subscriptions) s, (select count(*) from public.billing_customers) b")).rows[0];
    expect(await unlimited(existing)).toBe(false);
    const g = await create(admin, "  Existing@Test.dev ", "unlimited", 14);
    expect(g.existing_account).toBe(true);
    expect(g.state).toBe("active");
    expect(g.email).toBe("existing@test.dev");
    const r = await row(g.id);
    expect(r.invite_token_hash).toBeNull();
    expect(Math.round((r.expires_at - r.starts_at) / 86_400_000)).toBe(14);
    expect(await unlimited(existing)).toBe(true);
    // feeds credit_status + library_access for the user themselves
    const cs = await asUser(pool, existing, (q) => q("select unlimited from public.credit_status()"));
    expect(cs.rows[0].unlimited).toBe(true);
    const lib = await asUser(pool, existing, (q) => q("select public.library_access() as v"));
    expect(lib.rows[0].v).toBe(true);
    const mine = await asUser(pool, existing, (q) => q("select * from public.my_comp_access()"));
    expect(mine.rows[0]).toMatchObject({ plan: "unlimited", state: "active", has_paid_subscription: false });
    const after = (await pool.query("select (select count(*) from public.subscriptions) s, (select count(*) from public.billing_customers) b")).rows[0];
    expect(after).toEqual(before);
  });

  it("one open grant per email; extend instead of stacking", async () => {
    expect(await sqlError(create(admin, "existing@test.dev"))).toBe("grant_exists");
  });

  it("expiry is enforced by the database clock, and work is preserved", async () => {
    const g = (await pool.query("select id from public.complimentary_grants where email = 'existing@test.dev'")).rows[0];
    await pool.query("insert into public.estimates (user_id, title) values ($1, 'Kept bid')", [existing]).catch(async () => {
      await pool.query("insert into public.estimates (user_id) values ($1)", [existing]);
    });
    await pool.query("update public.complimentary_grants set starts_at = now() - interval '20 days', expires_at = now() - interval '1 second' where id = $1", [g.id]);
    expect(await unlimited(existing)).toBe(false);
    expect((await row(g.id)).state).toBe("expired");
    const cs = await asUser(pool, existing, (q) => q("select unlimited from public.credit_status()"));
    expect(cs.rows[0].unlimited).toBe(false);
    expect((await pool.query("select count(*)::int n from public.estimates where user_id = $1", [existing])).rows[0].n).toBe(1);
    const mine = await asUser(pool, existing, (q) => q("select state from public.my_comp_access()"));
    expect(mine.rows[0].state).toBe("expired");
    // A new grant is allowed once the old one ended.
    const again = await create(admin, "existing@test.dev", "unlimited", 7);
    expect(again.state).toBe("active");
    await pool.query("select public.admin_comp_revoke($1, $2, 'cleanup')", [admin, again.id]);
  });

  it("extend pushes out the end date; an ended grant restarts from now", async () => {
    const g = await create(admin, "ext@test.dev", "unlimited", 10, 0, hash(token()));
    const u = await createUser(pool, "ext@test.dev"); // verified sign-up activates it
    expect(await unlimited(u)).toBe(true);
    const r1 = await row(g.id);
    const e = (await pool.query("select public.admin_comp_extend($1, $2, 5) as g", [admin, g.id])).rows[0].g;
    expect(new Date(e.expires_at).getTime() - r1.expires_at.getTime()).toBe(5 * 86_400_000);
    await pool.query("update public.complimentary_grants set expires_at = now() - interval '1 day', starts_at = now() - interval '30 days' where id = $1", [g.id]);
    expect(await unlimited(u)).toBe(false);
    const e2 = (await pool.query("select public.admin_comp_extend($1, $2, 3) as g", [admin, g.id])).rows[0].g;
    expect(e2.state).toBe("active");
    expect(Math.round((new Date(e2.expires_at).getTime() - Date.now()) / 86_400_000)).toBe(3);
    expect(await sqlError(pool.query("select public.admin_comp_extend($1, $2, 900)", [admin, g.id]))).toBe("invalid_duration");
  });

  it("pause stops access now and resume gives the paused time back", async () => {
    const g = (await pool.query("select id, expires_at from public.complimentary_grants where email = 'ext@test.dev'")).rows[0];
    const u = (await pool.query("select id from auth.users where email = 'ext@test.dev'")).rows[0].id;
    await pool.query("select public.admin_comp_pause($1, $2)", [admin, g.id]);
    expect(await unlimited(u)).toBe(false);
    await pool.query("update public.complimentary_grants set paused_at = now() - interval '2 days' where id = $1", [g.id]);
    const r = (await pool.query("select public.admin_comp_resume($1, $2) as g", [admin, g.id])).rows[0].g;
    expect(await unlimited(u)).toBe(true);
    expect(Math.round((new Date(r.expires_at).getTime() - g.expires_at.getTime()) / 86_400_000)).toBe(2);
  });

  it("revoke ends access immediately and is idempotent", async () => {
    const g = (await pool.query("select id from public.complimentary_grants where email = 'ext@test.dev'")).rows[0];
    const u = (await pool.query("select id from auth.users where email = 'ext@test.dev'")).rows[0].id;
    await pool.query("select public.admin_comp_revoke($1, $2, 'test')", [admin, g.id]);
    await pool.query("select public.admin_comp_revoke($1, $2, 'again')", [admin, g.id]);
    expect(await unlimited(u)).toBe(false);
    expect(await sqlError(pool.query("select public.admin_comp_extend($1, $2, 5)", [admin, g.id]))).toBe("revoked");
  });

  it("new recipient: pending until activation; the clock starts at activation", async () => {
    const t = token();
    const g = await create(admin, "newbie@test.dev", "unlimited", 30, 0, hash(t));
    expect(g.existing_account).toBe(false);
    expect(g.state).toBe("pending");
    expect(g.starts_at).toBeNull();
    // Unverified sign-up does not activate it.
    const u = await createUser(pool, "newbie@test.dev", false);
    expect((await row(g.id)).state).toBe("pending");
    expect(await unlimited(u)).toBe(false);
    // Someone else holding the link can't claim it.
    const wrong = (await pool.query("select public.claim_comp_grant_by_token($1, $2) as r", [stranger, hash(t)])).rows[0].r;
    expect(wrong).toMatchObject({ ok: false, reason: "email_mismatch" });
    expect(wrong.hint).toBe("n***@test.dev");
    // Verifying the email activates it (trigger), and the token becomes useless.
    await pool.query("update auth.users set email_confirmed_at = now() where id = $1", [u]);
    const r = await row(g.id);
    expect(r.state).toBe("active");
    expect(r.user_id).toBe(u);
    expect(r.invite_token_hash).toBeNull();
    expect(Math.abs(r.starts_at.getTime() - Date.now())).toBeLessThan(60_000);
    expect(await unlimited(u)).toBe(true);
    const reuse = (await pool.query("select public.claim_comp_grant_by_token($1, $2) as r", [stranger, hash(t)])).rows[0].r;
    expect(reuse).toEqual({ ok: false, reason: "invalid" });
    const own = (await pool.query("select public.claim_comp_grant_by_token($1, $2) as r", [u, hash(t)])).rows[0].r;
    expect(own.ok).toBe(true);
  });

  it("token claim works for the invited verified user; expired and rotated invitations don't", async () => {
    const t1 = token();
    const g = await create(admin, "linky@test.dev", "unlimited", 7, 0, hash(t1));
    // Rotate (resend): old token dies.
    const t2 = token();
    await pool.query("select public.admin_comp_rotate_invite($1, $2, $3)", [admin, g.id, hash(t2)]);
    expect(await sqlError(pool.query("select public.admin_comp_rotate_invite($1, $2, $3)", [admin, g.id, "nothex"]))).toBe("invalid_token");
    // Create the account WITHOUT firing the trigger path (verified later via token flow): insert unverified, then claim by token after verifying with trigger disabled.
    const u = await createUser(pool, "linky@test.dev", false);
    await pool.query("alter table auth.users disable trigger on_auth_user_email_verified_comp");
    await pool.query("update auth.users set email_confirmed_at = now() where id = $1", [u]);
    await pool.query("alter table auth.users enable trigger on_auth_user_email_verified_comp");
    expect((await pool.query("select public.claim_comp_grant_by_token($1, $2) as r", [u, hash(t1)])).rows[0].r.ok).toBe(false);
    // Expired invitation can't be used.
    await pool.query("update public.complimentary_grants set invite_expires_at = now() - interval '1 minute' where id = $1", [g.id]);
    expect((await row(g.id)).state).toBe("invite_expired");
    expect((await pool.query("select public.claim_comp_grant_by_token($1, $2) as r", [u, hash(t2)])).rows[0].r).toEqual({ ok: false, reason: "invite_expired" });
    expect(await pool.query("select public.claim_comp_grants_for($1) n", [u]).then((r) => r.rows[0].n)).toBe(0);
    // Admin resends (new window), then the token works.
    await pool.query("update public.complimentary_grants set invite_sent_at = null where id = $1", [g.id]);
    const t3 = token();
    await pool.query("select public.admin_comp_rotate_invite($1, $2, $3)", [admin, g.id, hash(t3)]);
    const ok = (await pool.query("select public.claim_comp_grant_by_token($1, $2) as r", [u, hash(t3)])).rows[0].r;
    expect(ok).toMatchObject({ ok: true, state: "active", plan: "unlimited" });
  });

  it("resend is throttled", async () => {
    const g = await create(admin, "throttle@test.dev");
    await pool.query("select public.admin_comp_record_invite($1, $2, true)", [admin, g.id]);
    expect(await sqlError(pool.query("select public.admin_comp_rotate_invite($1, $2, $3)", [admin, g.id, hash(token())]))).toBe("too_soon");
    await pool.query("update public.complimentary_grants set invite_sent_at = now() - interval '2 minutes', invite_send_count = 10 where id = $1", [g.id]);
    expect(await sqlError(pool.query("select public.admin_comp_rotate_invite($1, $2, $3)", [admin, g.id, hash(token())]))).toBe("too_many_invites");
  });

  it("existing paid subscriber: comp is layered on top; Stripe rows untouched; expiry falls back to paid", async () => {
    const sub = (await pool.query("select * from public.subscriptions where user_id = $1", [payer])).rows[0];
    const g = await create(admin, "payer@test.dev", "unlimited", 30);
    expect((await row(g.id)).had_paid_subscription).toBe(true);
    await pool.query("update public.complimentary_grants set expires_at = now() - interval '1 second', starts_at = now() - interval '31 days' where id = $1", [g.id]);
    expect(await unlimited(payer)).toBe(true); // still paying
    expect((await pool.query("select * from public.subscriptions where user_id = $1", [payer])).rows[0]).toEqual(sub);
    const list = (await pool.query("select public.admin_comp_list($1, '{\"q\":\"payer\"}') as r", [admin])).rows[0].r;
    expect(list.rows[0]).toMatchObject({ paid_now: true, converted: false });
  });

  it("Enterprise grant: 3 included seats, extra seats only via admin, owner gets Unlimited", async () => {
    const owner = await createUser(pool, "boss@test.dev");
    expect(await sqlError(create(admin, "solo@test.dev", "unlimited", 30, 2))).toBe("invalid_seats");
    const g = await create(admin, "boss@test.dev", "enterprise", 60, 0);
    expect(g).toMatchObject({ plan: "enterprise", included_seats: 3, extra_seats: 0, state: "active" });
    expect(await unlimited(owner)).toBe(true);
    const s = (await pool.query("select public.admin_comp_set_extra_seats($1, $2, 2) as g", [admin, g.id])).rows[0].g;
    expect(s.extra_seats).toBe(2);
    expect(await sqlError(pool.query("select public.admin_comp_set_extra_seats($1, $2, 99)", [owner, g.id]))).toBe("forbidden");
    expect(await sqlError(pool.query("select public.admin_comp_set_extra_seats($1, $2, 51)", [admin, g.id]))).toBe("invalid_seats");
  });

  it("conversion to paid is tracked separately from existing customers", async () => {
    const u = (await pool.query("select id from auth.users where email = 'newbie@test.dev'")).rows[0].id;
    await subscribe(u);
    const list = (await pool.query("select public.admin_comp_list($1, '{}') as r", [admin])).rows[0].r;
    const newbie = list.rows.find((r: Row) => r.email === "newbie@test.dev");
    expect(newbie).toMatchObject({ converted: true, paid_now: true });
    expect(list.metrics.converted).toBe(1);
  });

  it("list filters and metrics", async () => {
    const all = (await pool.query("select public.admin_comp_list($1, '{}') as r", [admin])).rows[0].r;
    expect(all.metrics.total).toBe(all.rows.length);
    expect(all.metrics.enterprise).toBe(1);
    const ent = (await pool.query("select public.admin_comp_list($1, '{\"plan\":\"enterprise\"}') as r", [admin])).rows[0].r;
    expect(ent.rows.map((r: Row) => r.email)).toEqual(["boss@test.dev"]);
    const pend = (await pool.query("select public.admin_comp_list($1, '{\"state\":\"pending\"}') as r", [admin])).rows[0].r;
    expect(pend.rows.every((r: Row) => r.state === "pending")).toBe(true);
    const future = (await pool.query("select public.admin_comp_list($1, '{\"from\":\"2099-01-01\"}') as r", [admin])).rows[0].r;
    expect(future.rows).toEqual([]);
    expect(all.rows[0]).not.toHaveProperty("invite_token_hash");
    expect(all.rows.find((r: Row) => r.email === "boss@test.dev").granted_by_email).toBe("owner@built2bid.test");
    expect(await sqlError(pool.query("select public.admin_comp_list($1, '{}')", [stranger]))).toBe("forbidden");
  });

  it("every admin action is in the audit log with its grant id", async () => {
    const g = (await pool.query("select id from public.complimentary_grants where email = 'ext@test.dev'")).rows[0];
    const det = (await pool.query("select public.admin_comp_detail($1, $2) as r", [admin, g.id])).rows[0].r;
    const actions = det.history.map((h: Row) => h.action).sort();
    expect(actions).toEqual(["comp.activate", "comp.extend", "comp.extend", "comp.grant", "comp.pause", "comp.resume", "comp.revoke"].sort());
  });

  it("an auth trigger failure never blocks sign-up", async () => {
    await pool.query("insert into public.complimentary_grants (email, plan, duration_days, status, invite_expires_at) values ('weird@test.dev', 'unlimited', 5, 'pending', now() + interval '1 day')");
    // Simulate a broken claim: make the activation fail by violating a check via a bogus duration.
    await pool.query("alter table public.complimentary_grants drop constraint if exists complimentary_grants_duration_days_check");
    await pool.query("update public.complimentary_grants set duration_days = -5 where email = 'weird@test.dev'");
    const u = await createUser(pool, "weird@test.dev");
    expect(u).toBeTruthy();
    expect((await pool.query("select status from public.complimentary_grants where email = 'weird@test.dev'")).rows[0].status).toBe("pending");
  });
});

d("complimentary access works alongside the Enterprise entitlement owner", () => {
  it("does not overwrite has_unlimited when user_entitlement() already exists", async () => {
    const { pool: p, drop: dr } = await freshDb("byb_test_comp_order", { stopBefore: MIGRATION });
    try {
      await p.query("create function public.user_entitlement(p uuid) returns text language sql as $$ select 'free' $$");
      await p.query("create or replace function public.has_unlimited(p_user_id uuid) returns boolean language sql stable security definer set search_path = public as $$ select public.user_entitlement(p_user_id) <> 'free' $$");
      await p.query((await import("node:fs")).readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), "utf8"));
      const def = (await p.query("select pg_get_functiondef('public.has_unlimited(uuid)'::regprocedure) d")).rows[0].d as string;
      expect(def).toContain("user_entitlement");
    } finally { await dr(); }
  });
});
