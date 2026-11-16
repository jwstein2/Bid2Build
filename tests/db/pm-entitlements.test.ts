import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const sub = (u: string, plan: string, company: string | null = null, seats: number | null = null, at = "now()", status = "active", end = "2099-01-01") =>
  pool.query(
    `select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_' || $1, p_stripe_subscription_id => 'sub_' || $1,
      p_status => $2, p_plan => $3, p_price_id => 'price_x', p_current_period_end => $6::timestamptz, p_cancel_at_period_end => false,
      p_canceled_at => null, p_ended_at => null, p_event_created => ${at}, p_company_id => $4::uuid, p_seat_quantity => $5)`,
    [u, status, plan, company, seats, end],
  );
const pm = (u: string, addon: boolean, extra: number, at = "now()") =>
  pool.query(`select public.apply_pm_update('sub_' || $1, $2, $3, ${at}) as applied`, [u, addon, extra]);
const ent = async (u: string) => (await pool.query("select * from public.pm_entitlement($1)", [u])).rows[0];
const access = (u: string) => asUser(pool, u, (q) => q("select public.my_pm_access() as a")).then((r) => r.rows[0].a);
const assign = (actor: string, u: string, on = true) => asUser(pool, actor, (q) => q("select public.company_pm_assign($1, $2) as r", [u, on]));
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

d("PM entitlements (database)", () => {
  let solo: string, freeUser: string, owner: string, est: string, viewer: string, outsider: string, company: string, compUser: string, compOwner: string, compCompany: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_pm"));
    solo = await createUser(pool, "solo@test.dev");
    freeUser = await createUser(pool, "free@test.dev");
    owner = await createUser(pool, "owner@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    outsider = await createUser(pool, "out@test.dev");
    compUser = await createUser(pool, "comp@test.dev");
    compOwner = await createUser(pool, "compowner@test.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    for (const [u, role] of [[est, "estimator"], [viewer, "viewer"]]) await pool.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, $3)", [company, u, role]);
    compCompany = (await pool.query("select public.create_company($1, 'Comp Co') as id", [compOwner])).rows[0].id;
  });
  afterAll(async () => { await drop?.(); });

  it("free accounts have no PM access", async () => {
    expect(await ent(freeUser)).toMatchObject({ scope: "none", can_edit: false, editor_limit: 0 });
    expect(await asUser(pool, freeUser, (q) => q("select public.can_edit_schedules() as c")).then((r) => r.rows[0].c)).toBe(false);
  });

  it("Unlimited alone doesn't include PM; the add-on gives one editor", async () => {
    await sub(solo, "monthly", null, null, "now() - interval '1 minute'");
    expect((await ent(solo)).can_edit).toBe(false);
    expect((await pm(solo, true, 0)).rows[0].applied).toBe(true);
    expect(await ent(solo)).toMatchObject({ scope: "individual", can_edit: true, editor_limit: 1, source: "subscription" });
    expect(await access(solo)).toMatchObject({ canEdit: true, addon: true });
  });

  it("older Stripe events never change the add-on", async () => {
    expect((await pm(solo, false, 0, "now() - interval '1 hour'")).rows[0].applied).toBe(false);
    expect((await ent(solo)).can_edit).toBe(true);
  });

  it("removing the add-on keeps editing until the paid period ends, then read-only (data untouched)", async () => {
    await pool.query("update public.subscriptions set current_period_end = now() + interval '10 days' where user_id = $1", [solo]);
    await pm(solo, false, 0);
    const e = await ent(solo);
    expect(e.can_edit).toBe(true);
    expect(new Date(e.edit_until).getTime()).toBeGreaterThan(Date.now() + 9 * 864e5);
    await pool.query("update public.subscriptions set pm_addon_until = now() - interval '1 minute' where user_id = $1", [solo]);
    expect((await ent(solo)).can_edit).toBe(false);
    await pm(solo, true, 0);
    expect((await ent(solo)).can_edit).toBe(true);
    expect((await pool.query("select pm_addon_until from public.subscriptions where user_id = $1", [solo])).rows[0].pm_addon_until).toBeNull();
  });

  it("Enterprise includes one editor; only assigned active members can edit", async () => {
    await sub(owner, "enterprise", company, 5, "now() - interval '1 minute'");
    expect(await ent(owner)).toMatchObject({ scope: "company", editor_limit: 1, editors_assigned: 0, can_edit: false });
    await assign(owner, est);
    expect((await ent(est)).can_edit).toBe(true);
    expect((await ent(viewer)).can_edit).toBe(false);
    expect(await fails(assign(owner, viewer))).toMatch(/editor_limit/);
  });

  it("extra paid editors raise the limit; dropping the limit keeps the earliest editors", async () => {
    await pm(owner, false, 1);
    expect((await ent(owner)).editor_limit).toBe(2);
    await assign(owner, viewer);
    expect((await ent(viewer)).can_edit).toBe(true);
    await pm(owner, false, 0);
    expect((await ent(est)).can_edit).toBe(true);
    expect((await ent(viewer)).can_edit).toBe(false);
    await assign(owner, viewer, false);
    expect((await ent(owner)).editors_assigned).toBe(1);
  });

  it("PM editors don't change licensed users", async () => {
    await pm(owner, false, 3);
    expect((await pool.query("select seat_limit from public.company_entitlement($1)", [company])).rows[0].seat_limit).toBe(5);
    await pm(owner, false, 0);
  });

  it("only admins of the company can assign, and only active members", async () => {
    expect(await fails(assign(est, viewer))).toMatch(/forbidden/);
    expect(await fails(assign(outsider, est))).toMatch(/forbidden/);
    expect(await fails(assign(owner, outsider))).toMatch(/not_member/);
    expect(await fails(asUser(pool, est, (q) => q("insert into public.pm_editors (company_id, user_id) values ($1, $2)", [company, est])))).toMatch(/row-level security|permission denied/);
    const log = await pool.query("select action from public.company_audit_log where company_id = $1 and action like 'pm.%'", [company]);
    expect(log.rows.length).toBeGreaterThan(0);
  });

  it("deactivated members lose editing", async () => {
    await pool.query("update public.company_members set status = 'deactivated', deactivated_at = now() where user_id = $1", [est]);
    expect((await ent(est)).scope).toBe("none");
    await pool.query("update public.company_members set status = 'active', deactivated_at = null where user_id = $1", [est]);
  });

  it("complimentary: Unlimited grants don't include PM unless the owner sets it; Enterprise grants include 1", async () => {
    await pool.query("insert into public.complimentary_grants (email, duration_days, included_seats, user_id, plan, status, starts_at, expires_at) values ('comp@test.dev', 30, 1, $1, 'unlimited', 'active', now() - interval '1 day', now() + interval '29 days')", [compUser]);
    expect((await ent(compUser)).can_edit).toBe(false);
    await pool.query("update public.complimentary_grants set pm_editors = 1 where user_id = $1", [compUser]);
    expect(await ent(compUser)).toMatchObject({ scope: "individual", can_edit: true, source: "complimentary" });

    await pool.query("insert into public.complimentary_grants (email, duration_days, included_seats, company_id, user_id, plan, status, starts_at, expires_at) values ('compowner@test.dev', 30, 3, $1, $2, 'enterprise', 'active', now() - interval '1 day', now() + interval '29 days')", [compCompany, compOwner]);
    expect(await ent(compOwner)).toMatchObject({ scope: "company", editor_limit: 1 });
    await pool.query("update public.complimentary_grants set pm_editors = 0 where company_id = $1", [compCompany]);
    expect((await ent(compOwner)).editor_limit).toBe(0);
    await pool.query("update public.complimentary_grants set pm_editors = 4 where company_id = $1", [compCompany]);
    expect((await ent(compOwner)).editor_limit).toBe(4);
  });

  it("only service role can write billing state; admin override needs an admin", async () => {
    expect(await fails(asUser(pool, solo, (q) => q("select public.apply_pm_update('sub_x', true, 0, now())")))).toMatch(/permission denied/);
    expect(await fails(pool.query("select public.admin_comp_set_pm_editors($1, (select id from public.complimentary_grants limit 1), 2)", [solo]))).toMatch(/not_admin|forbidden|admin/);
  });
});
