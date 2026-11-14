import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";
import { PERMISSION_KEYS, ROLE_PERMISSIONS } from "../../src/lib/enterprise/permissions";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const MIGRATION = "20261114005000_enterprise_workspace.sql";

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
const one = async (u: string, sql: string, params: unknown[] = []) => (await asUser(pool, u, (q) => q(sql, params))).rows[0];
const fails = async (u: string, sql: string, params: unknown[] = []) => {
  try { await asUser(pool, u, (q) => q(sql, params)); return null; } catch (e) { return (e as Error).message; }
};
const tier = async (u: string) => (await pool.query("select tier, source from public.user_entitlement($1)", [u])).rows[0];
const subscribeEnterprise = (owner: string, company: string, seats: number, status = "active") =>
  pool.query(
    `insert into public.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan, price_id, current_period_end, source_event_created, company_id, seat_quantity)
     values ($1, $2, $3, $4, 'enterprise', 'price_ent', '2099-01-01', now(), $5, $6)
     on conflict (stripe_subscription_id) do update set status = excluded.status, seat_quantity = excluded.seat_quantity`,
    [`sub_ent_${company}`, owner, `cus_${owner}`, status, company, seats],
  );
const newEstimate = (q: Q, u: string, title: string) =>
  q("insert into public.estimates (user_id, title) values ($1, $2) returning id, company_id, created_by", [u, title]);

/** Invite + accept, returning nothing; throws on failure. */
async function join(admin: string, user: string, email: string, role: string, team: string | null = null) {
  const { token } = await one(admin, "select * from public.create_company_invitation($1, $2, $3)", [email, role, team]) as { token: string };
  await asUser(pool, user, (q) => q("select public.accept_company_invitation($1)", [token]));
}

d("Enterprise workspace, roles and entitlement (database)", () => {
  let owner: string, mgr: string, est1: string, est2: string, viewer: string, outsider: string, otherOwner: string, solo: string;
  let company: string, otherCompany: string, roofing: string, decking: string;
  let personalEstimate: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_enterprise", { stopBefore: MIGRATION }));
    owner = await createUser(pool, "owner@acme.dev");
    mgr = await createUser(pool, "mgr@acme.dev");
    est1 = await createUser(pool, "est1@acme.dev");
    est2 = await createUser(pool, "est2@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    outsider = await createUser(pool, "outsider@else.dev");
    otherOwner = await createUser(pool, "boss@rival.dev");
    solo = await createUser(pool, "solo@test.dev");
    // A bid that exists before Enterprise ships stays personal.
    personalEstimate = (await asUser(pool, owner, (q) => q("insert into public.estimates (user_id, title) values ($1, 'Old personal bid') returning id", [owner]))).rows[0].id as string;
    await applyMigration(pool, MIGRATION);
    await applyMigration(pool, MIGRATION); // idempotent
    company = (await pool.query("select public.create_company($1, 'Acme Roofing') as id", [owner])).rows[0].id;
    otherCompany = (await pool.query("select public.create_company($1, 'Rival Decks') as id", [otherOwner])).rows[0].id;
  });
  afterAll(async () => { await drop?.(); });

  it("role defaults in SQL match the TypeScript mirror", async () => {
    const keys = (await pool.query("select public.company_permission_keys() as k")).rows[0].k;
    expect(keys).toEqual([...PERMISSION_KEYS]);
    for (const role of Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]) {
      const r = (await pool.query("select public.company_role_permissions($1) as p", [role])).rows[0].p;
      expect(r, role).toEqual([...ROLE_PERMISSIONS[role]]);
    }
  });

  it("create_company is idempotent and makes the caller the owner", async () => {
    const again = (await pool.query("select public.create_company($1, 'Other name') as id", [owner])).rows[0].id;
    expect(again).toBe(company);
    const m = await one(owner, "select public.my_company() as c");
    expect(m.c).toMatchObject({ id: company, name: "Acme Roofing", role: "owner", isOwner: true, seatsUsed: 1 });
    expect(await fails(owner, "select public.create_company($1, 'x')", [owner])).toMatch(/permission denied/);
  });

  it("no Enterprise access until the company is paid for (or comped)", async () => {
    expect(await tier(owner)).toEqual({ tier: "free", source: null });
    const e = (await pool.query("select * from public.company_entitlement($1)", [company])).rows[0];
    expect(e).toMatchObject({ active: false, seat_limit: 0 });
    expect(await fails(owner, "select * from public.create_company_invitation('mgr@acme.dev', 'manager')")).toMatch(/no_seats_available/);
  });

  it("a paid Enterprise subscription gives 3 seats and Unlimited-level access to the owner", async () => {
    await subscribeEnterprise(owner, company, 3);
    expect(await tier(owner)).toEqual({ tier: "enterprise", source: "company_seat" });
    expect((await pool.query("select public.has_unlimited($1) as v", [owner])).rows[0].v).toBe(true);
    const e = (await pool.query("select * from public.company_entitlement($1)", [company])).rows[0];
    expect(e).toMatchObject({ active: true, source: "stripe", seat_limit: 3 });
  });

  it("invitations reserve seats and stop at the licensed seat count", async () => {
    roofing = (await one(owner, "select public.create_company_team('Roofing', 'roofing') as id")).id as string;
    decking = (await one(owner, "select public.create_company_team('Decking', 'decking') as id")).id as string;
    await join(owner, mgr, "MGR@acme.dev", "manager", roofing);
    // owner + manager + one pending invite = 3
    await one(owner, "select * from public.create_company_invitation('est1@acme.dev', 'estimator', $1)", [roofing]);
    expect(await fails(owner, "select * from public.create_company_invitation('est2@acme.dev', 'estimator')")).toMatch(/no_seats_available/);
    // buying more seats (Stripe webhook raises seat_quantity) opens room
    await subscribeEnterprise(owner, company, 6);
    const pending = (await one(owner, "select count(*)::int as n from public.list_company_invitations()")).n;
    expect(pending).toBe(1);
  });

  it("an invitation only works for the verified account it was sent to, once", async () => {
    const { token } = await one(owner, "select * from public.create_company_invitation('est2@acme.dev', 'estimator', $1)", [decking]) as { token: string };
    expect(await fails(outsider, "select public.accept_company_invitation($1)", [token])).toMatch(/invitation_email_mismatch/);
    expect(await fails(est2, "select public.accept_company_invitation('not-a-token')")).toMatch(/invitation_invalid/);
    await asUser(pool, est2, (q) => q("select public.accept_company_invitation($1)", [token]));
    expect(await fails(est2, "select public.accept_company_invitation($1)", [token])).toMatch(/invitation_invalid/);
    // the raw token is never stored
    const stored = (await pool.query("select count(*)::int as n from public.company_invitations where token_hash = $1", [token])).rows[0].n;
    expect(stored).toBe(0);
  });

  it("re-inviting revokes the old link", async () => {
    const first = await one(owner, "select * from public.create_company_invitation('est1@acme.dev', 'estimator', $1)", [roofing]) as { token: string };
    const second = await one(owner, "select * from public.create_company_invitation('est1@acme.dev', 'estimator', $1)", [roofing]) as { token: string };
    expect(await fails(est1, "select public.accept_company_invitation($1)", [first.token])).toMatch(/invitation_invalid/);
    await asUser(pool, est1, (q) => q("select public.accept_company_invitation($1)", [second.token]));
    expect((await tier(est1)).tier).toBe("enterprise");
  });

  it("a person cannot sit in two companies", async () => {
    await subscribeEnterprise(otherOwner, otherCompany, 3);
    const { token } = await one(otherOwner, "select * from public.create_company_invitation('est1@acme.dev', 'estimator')") as { token: string };
    expect(await fails(est1, "select public.accept_company_invitation($1)", [token])).toMatch(/already_in_company/);
    await join(owner, viewer, "viewer@acme.dev", "viewer", roofing);
    expect((await tier(viewer)).tier).toBe("enterprise");
  });

  it("new bids by members are company-owned; old personal bids are untouched", async () => {
    const r = (await asUser(pool, est1, (q) => newEstimate(q, est1, "Roof A"))).rows[0];
    expect(r).toMatchObject({ company_id: company, created_by: est1 });
    await asUser(pool, est2, (q) => newEstimate(q, est2, "Deck B"));
    await asUser(pool, mgr, (q) => newEstimate(q, mgr, "Roof C"));
    await asUser(pool, otherOwner, (q) => newEstimate(q, otherOwner, "Rival bid"));
    const p = (await pool.query("select company_id from public.estimates where id = $1", [personalEstimate])).rows[0];
    expect(p.company_id).toBeNull();
  });

  const titles = async (u: string) =>
    (await asUser(pool, u, (q) => q("select title from public.estimates order by title"))).rows.map((r) => r.title);

  it("owner sees the whole company; manager and reviewer see their team; estimators see their own", async () => {
    expect(await titles(owner)).toEqual(["Deck B", "Old personal bid", "Roof A", "Roof C"]);
    expect(await titles(mgr)).toEqual(["Roof A", "Roof C"]); // Roofing team only, not Decking
    expect(await titles(viewer)).toEqual(["Roof A", "Roof C"]);
    expect(await titles(est1)).toEqual(["Roof A"]);
    expect(await titles(est2)).toEqual(["Deck B"]);
  });

  it("no company data crosses tenants, even by id", async () => {
    expect(await titles(otherOwner)).toEqual(["Rival bid"]);
    const roofA = (await pool.query("select id from public.estimates where title = 'Roof A'")).rows[0].id;
    const r = await asUser(pool, otherOwner, (q) => q("select id from public.estimates where id = $1", [roofA]));
    expect(r.rowCount).toBe(0);
    expect(await titles(outsider)).toEqual([]);
    expect(await titles(solo)).toEqual([]);
    const roster = await fails(otherOwner, "select public.update_company_member($1, 'viewer')", [est1]);
    expect(roster).toMatch(/member_not_found/);
  });

  it("viewers and managers cannot edit other people's bids", async () => {
    const r = await asUser(pool, mgr, (q) => q("update public.estimates set title = 'hacked' where title = 'Roof A'"));
    expect(r.rowCount).toBe(0);
    const v = await asUser(pool, viewer, (q) => q("delete from public.estimates where title = 'Roof A'"));
    expect(v.rowCount).toBe(0);
  });

  it("nobody can raise their own access or hand out access they lack", async () => {
    expect(await fails(mgr, "select public.update_company_member($1, 'manager', '{manage_users}')", [est1])).toMatch(/forbidden/);
    expect(await fails(owner, "select public.update_company_member($1, 'manager')", [owner])).toMatch(/cannot_change_self/);
    expect(await fails(est1, "insert into public.company_members (company_id, user_id, role) values ($1, $2, 'owner')", [company, est1])).toMatch(/permission denied/);
    expect(await fails(est1, "update public.company_members set role = 'owner' where user_id = $1", [est1])).toMatch(/permission denied/);
    // the owner delegates user management to the manager...
    await asUser(pool, owner, (q) => q("select public.update_company_member($1, 'manager', '{manage_users}')", [mgr]));
    // ...who still cannot grant billing, give out permissions they lack, or touch the owner
    expect(await fails(mgr, "select public.update_company_member($1, 'estimator', '{manage_billing}')", [est1])).toMatch(/forbidden_permission/);
    expect(await fails(mgr, "select public.update_company_member($1, 'estimator', '{view_company_bids}')", [est1])).toMatch(/forbidden_permission/);
    expect(await fails(mgr, "select public.update_company_member($1, 'viewer')", [owner])).toMatch(/cannot_change_owner/);
    expect(await fails(mgr, "select public.update_company_member($1, 'estimator', '{manage_teams}')", [est1])).toMatch(/forbidden_permission/);
    await asUser(pool, mgr, (q) => q("select public.update_company_member($1, 'estimator', '{view_margin}')", [est1]));
    const perms = (await one(est1, "select public.my_company() as c")).c as { permissions: string[] };
    expect(perms.permissions).toContain("view_margin");
    expect(perms.permissions).not.toContain("manage_billing");
  });

  it("granting view_company_bids widens visibility; revoking narrows it", async () => {
    await asUser(pool, owner, (q) => q("select public.update_company_member($1, 'viewer', '{view_company_bids}')", [viewer]));
    expect(await titles(viewer)).toEqual(["Deck B", "Roof A", "Roof C"]);
    await asUser(pool, owner, (q) => q("select public.update_company_member($1, 'viewer', '{}', '{view_team_bids}')", [viewer]));
    expect(await titles(viewer)).toEqual([]);
  });

  it("line items follow the estimate's visibility", async () => {
    const id = (await pool.query("select id from public.estimates where title = 'Roof A'")).rows[0].id;
    await pool.query("insert into public.estimate_groups (id, estimate_id, user_id, name) values (gen_random_uuid(), $1, $2, 'Main')", [id, est1]);
    const count = async (u: string) => (await asUser(pool, u, (q) => q("select count(*)::int as n from public.estimate_groups where estimate_id = $1", [id]))).rows[0].n;
    expect(await count(est1)).toBe(1);
    expect(await count(mgr)).toBe(1);
    expect(await count(est2)).toBe(0);
    expect(await count(otherOwner)).toBe(0);
  });

  it("deactivating a member ends their access, keeps their bids, and frees the seat", async () => {
    const before = ((await one(owner, "select public.my_company() as c")).c as { seatsUsed: number }).seatsUsed;
    await asUser(pool, owner, (q) => q("select public.set_company_member_status($1, 'deactivated')", [est2]));
    expect(await titles(est2)).toEqual([]);
    expect((await tier(est2)).tier).toBe("free");
    expect(await titles(owner)).toContain("Deck B");
    const after = ((await one(owner, "select public.my_company() as c")).c as { seatsUsed: number }).seatsUsed;
    expect(after).toBe(before - 1);
    // reactivation needs a free seat and is audited
    await asUser(pool, owner, (q) => q("select public.set_company_member_status($1, 'active')", [est2]));
    expect(await titles(est2)).toEqual(["Deck B"]);
    const log = (await one(owner, "select array_agg(action order by id) as a from public.company_audit_log")).a as string[];
    expect(log).toEqual(expect.arrayContaining(["company.created", "invitation.accepted", "member.updated", "member.deactivated", "member.reactivated"]));
  });

  it("audit log and invitations are private to user admins", async () => {
    expect((await asUser(pool, est1, (q) => q("select count(*)::int as n from public.company_audit_log"))).rows[0].n).toBe(0);
    expect(await fails(est1, "select * from public.list_company_invitations()")).toMatch(/forbidden/);
    expect(await fails(est1, "select * from public.company_invitations")).toMatch(/permission denied/);
    const emails = (await asUser(pool, est1, (q) => q("select email from public.company_roster() where user_id <> $1", [est1]))).rows;
    expect(emails.every((r) => r.email === null)).toBe(true);
  });

  it("deleting an employee's login hands their company bids to the owner instead of deleting them", async () => {
    await pool.query("delete from auth.users where id = $1", [est2]);
    const r = (await pool.query("select user_id, created_by from public.estimates where title = 'Deck B'")).rows[0];
    expect(r).toEqual({ user_id: owner, created_by: null });
    await expect(pool.query("delete from auth.users where id = $1", [owner])).rejects.toThrow(/violates foreign key/);
  });

  it("a lapsed Enterprise subscription removes seat access but keeps all company data", async () => {
    await subscribeEnterprise(owner, company, 6, "canceled");
    expect(await tier(mgr)).toEqual({ tier: "free", source: null });
    expect(await titles(owner)).toContain("Roof A");
    expect(await fails(owner, "select * from public.create_company_invitation('new@acme.dev', 'viewer')")).toMatch(/no_seats_available/);
    await subscribeEnterprise(owner, company, 6, "active");
  });

  it("an individual Unlimited subscriber stays Unlimited (no regression)", async () => {
    await pool.query("select public.apply_subscription_update($1::uuid, 'cus_solo', 'sub_solo', 'active', 'monthly', 'price_m', '2099-01-01', false, null, null, now())", [solo]);
    expect(await tier(solo)).toEqual({ tier: "unlimited", source: "subscription" });
    expect((await one(solo, "select unlimited from public.credit_status()")).unlimited).toBe(true);
  });

  describe("complimentary grants (table owned by the platform-owner thread)", () => {
    let compOwner: string, compUser: string, compCompany: string;
    beforeAll(async () => {
      await pool.query(`create table if not exists public.complimentary_grants (
        id uuid primary key default gen_random_uuid(), email text, user_id uuid, plan text, status text,
        starts_at timestamptz, expires_at timestamptz, extra_seats int default 0, company_id uuid)`);
      compOwner = await createUser(pool, "comp-owner@test.dev");
      compUser = await createUser(pool, "comp-user@test.dev");
      compCompany = (await pool.query("select public.create_company($1, 'Comp Co') as id", [compOwner])).rows[0].id;
    });

    it("an Unlimited grant gives Unlimited and expires by time alone", async () => {
      await pool.query("insert into public.complimentary_grants (user_id, plan, status, starts_at, expires_at) values ($1, 'unlimited', 'active', now() - interval '1 day', now() + interval '1 day')", [compUser]);
      expect(await tier(compUser)).toEqual({ tier: "unlimited", source: "complimentary" });
      await pool.query("update public.complimentary_grants set expires_at = now() - interval '1 second' where user_id = $1", [compUser]);
      expect(await tier(compUser)).toEqual({ tier: "free", source: null });
    });

    it("an Enterprise grant gives 3 + authorized extra seats, and lapses cleanly", async () => {
      await pool.query("insert into public.complimentary_grants (user_id, company_id, plan, status, starts_at, expires_at, extra_seats) values ($1, $2, 'enterprise', 'active', now(), now() + interval '30 days', 2)", [compOwner, compCompany]);
      expect(await tier(compOwner)).toEqual({ tier: "enterprise", source: "company_seat" });
      const e = (await pool.query("select * from public.company_entitlement($1)", [compCompany])).rows[0];
      expect(e).toMatchObject({ active: true, source: "complimentary", seat_limit: 5 });
      await pool.query("update public.complimentary_grants set status = 'revoked' where company_id = $1", [compCompany]);
      expect(await tier(compOwner)).toEqual({ tier: "free", source: null });
    });
  });
});
