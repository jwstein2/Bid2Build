/**
 * V6.7 Enterprise Workspace & Granular Feature Access, against the real SQL (20261222001000_workspace_access.sql).
 *   - the access editor's save writes the existing granted/revoked arrays (+ profile) and is audited with a reason
 *   - delegated administrators: can't add what they don't hold, can't touch owner-only or owner-locked permissions
 *   - company-wide restrictions apply to every write path (access editor, older editor, new members) and lift cleanly
 *   - turning a workspace off revokes through existing permissions, so RLS hides the records (schedules, financials)
 *   - my_workspace_access / overview / history: right person, right company, nothing about other tenants
 *   - nothing touches seats or subscriptions
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";
import { sub } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const MIGRATION = "20261222001000_workspace_access.sql";

const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

d("Workspace access (database)", () => {
  let owner: string, admin: string, rep: string, pm: string, newbie: string, rival: string, rivalRep: string;
  let company: string, rivalCompany: string;
  const as = <T = Row>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows[0] as T);
  const rows = (u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows);
  const perms = async (u: string) => (await as<{ p: string[] }>(u, "select public.member_permissions(m.role, m.permissions_granted, m.permissions_revoked) as p from public.company_members m where m.user_id = $1", [u])).p;
  const save = (actor: string, u: string, role: string, granted: string[], revoked: string[], profile: object | null = { v: 1 }, reason: string | null = null) =>
    as(actor, "select public.company_member_access_save($1, $2, $3, $4, $5, $6) as r", [u, role, granted, revoked, profile, reason]);
  const policy = (actor: string, denied: string[], locked: string[] = []) => as(actor, "select public.company_access_policy_save($1, $2, 'test') as r", [denied, locked]);
  async function join(by: string, u: string, email: string, role: string) {
    const { token } = await as<{ token: string }>(by, "select * from public.create_company_invitation($1, $2, null)", [email, role]);
    await asUser(pool, u, (q) => q("select public.accept_company_invitation($1)", [token]));
  }

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_workspace_access"));
    await applyMigration(pool, MIGRATION); // idempotent on top of the full chain
    owner = await createUser(pool, "owner@acme.dev");
    admin = await createUser(pool, "admin@acme.dev");
    rep = await createUser(pool, "rep@acme.dev");
    pm = await createUser(pool, "pm@acme.dev");
    newbie = await createUser(pool, "new@acme.dev");
    rival = await createUser(pool, "boss@rival.dev");
    rivalRep = await createUser(pool, "rep@rival.dev");
    company = (await pool.query("select public.create_company($1, 'Acme Builders') as id", [owner])).rows[0].id;
    rivalCompany = (await pool.query("select public.create_company($1, 'Rival') as id", [rival])).rows[0].id;
    await sub(pool, owner, "enterprise", company, 8);
    await sub(pool, rival, "enterprise", rivalCompany, 4);
    await join(owner, admin, "admin@acme.dev", "manager");
    await join(owner, rep, "rep@acme.dev", "estimator");
    await join(owner, pm, "pm@acme.dev", "manager");
    await join(rival, rivalRep, "rep@rival.dev", "estimator");
    // The owner delegates user administration to the admin (owner-only grant).
    await as(owner, "select public.update_company_member($1, 'manager', '{manage_users}', '{}')", [admin]);
  });
  afterAll(async () => { await drop?.(); });

  it("saves access as existing permissions plus the profile, audited with the reason", async () => {
    const before = (await pool.query("select seat_quantity from public.subscriptions where company_id = $1", [company])).rows[0];
    const r = await save(owner, rep, "estimator", [], ["view_schedules", "download_schedule_pdf"], { v: 1, template: "sales_rep", workspaces: { run: false } }, "Sales only");
    expect((r.r as { permissions: string[] }).permissions).not.toContain("view_schedules");
    expect(await perms(rep)).not.toContain("view_schedules");
    expect(await perms(rep)).toContain("create_estimates");
    const m = (await pool.query("select access_profile, permissions_revoked from public.company_members where user_id = $1", [rep])).rows[0];
    expect(m.access_profile).toEqual({ v: 1, template: "sales_rep", workspaces: { run: false } });
    const log = (await pool.query("select actor_id, details from public.company_audit_log where action = 'member.access_updated' and target_id = $1", [rep])).rows;
    expect(log).toHaveLength(1);
    expect(log[0].actor_id).toBe(owner);
    expect(log[0].details.reason).toBe("Sales only");
    expect(log[0].details.from.revoked).toEqual([]);
    expect(log[0].details.to.revoked).toEqual(["download_schedule_pdf", "view_schedules"]);
    // Seats and billing untouched.
    expect((await pool.query("select seat_quantity from public.subscriptions where company_id = $1", [company])).rows[0]).toEqual(before);
  });

  it("refuses self, the owner, non-admins, bad keys and oversized profiles", async () => {
    expect(await fails(save(admin, admin, "manager", [], []))).toMatch(/cannot_change_self/);
    expect(await fails(save(admin, owner, "manager", [], []))).toMatch(/cannot_change_owner/);
    expect(await fails(save(rep, pm, "manager", [], []))).toMatch(/forbidden/);
    expect(await fails(save(owner, rep, "estimator", ["not_a_key"], []))).toMatch(/invalid_permission/);
    expect(await fails(save(owner, rep, "owner", [], []))).toMatch(/invalid_role/);
    expect(await fails(save(owner, rep, "estimator", [], [], { v: 1, junk: "x".repeat(5000) }))).toMatch(/invalid_profile|access_profile_shape/);
  });

  it("is tenant-isolated: another company's owner can't touch our members or read our overview", async () => {
    expect(await fails(save(rival, rep, "estimator", [], []))).toMatch(/member_not_found/);
    const ov = await as<{ o: { members: { userId: string }[] } }>(rival, "select public.company_access_overview() as o");
    expect(ov.o.members.map((x) => x.userId).sort()).toEqual([rival, rivalRep].sort());
    expect(await rows(rival, "select * from public.company_access_history()")).toEqual([]);
  });

  it("delegated admin: may keep what the member had, may only add what they hold, never owner-only", async () => {
    // The PM (manager) holds approve_bids; the admin also does (manager role). The admin lacks view_company_bids.
    await save(owner, pm, "manager", ["view_company_bids"], [], { v: 1 });
    // Keeping view_company_bids (already held) while changing something else is fine for the admin.
    await save(admin, pm, "manager", ["view_company_bids"], ["view_margin"], { v: 1 });
    expect(await perms(pm)).toContain("view_company_bids");
    // Adding a permission the admin doesn't hold is refused.
    expect(await fails(save(admin, rep, "estimator", ["view_company_bids"], []))).toMatch(/forbidden_permission/);
    // Owner-only permissions stay with the owner.
    expect(await fails(save(admin, rep, "estimator", ["manage_billing"], []))).toMatch(/forbidden_permission/);
  });

  it("owner locks: a delegated admin can't change locked permissions (either editor)", async () => {
    await policy(owner, [], ["view_costs"]);
    expect(await fails(save(admin, rep, "estimator", [], ["view_costs", "view_schedules", "download_schedule_pdf"]))).toMatch(/locked_by_owner/);
    expect(await fails(as(admin, "select public.update_company_member($1, 'estimator', '{}', '{view_costs}')", [rep]))).toMatch(/locked_by_owner/);
    // Unlocked changes still go through; the owner can change locked ones.
    await save(admin, rep, "estimator", [], ["view_schedules", "download_schedule_pdf", "upload_photos"]);
    await save(owner, rep, "estimator", [], ["view_schedules", "download_schedule_pdf", "view_costs"]);
    expect(await perms(rep)).not.toContain("view_costs");
    await save(owner, rep, "estimator", [], ["view_schedules", "download_schedule_pdf"]);
    expect(await fails(policy(admin, [], []))).toMatch(/owner_only/);
    await policy(owner, [], []);
  });

  it("company-wide restriction: applies to every member and write path, and lifting it restores only what it added", async () => {
    // rep explicitly revoked view_schedules earlier; policy denies view_schedules + view_margin.
    await policy(owner, ["view_schedules", "view_margin"]);
    expect(await perms(pm)).not.toContain("view_margin");
    expect(await perms(pm)).not.toContain("view_schedules");
    expect(await perms(owner)).toContain("view_margin");   // the primary account holder is never restricted
    // A grant can't bypass it, through either editor.
    await as(owner, "select public.update_company_member($1, 'manager', '{view_company_bids}', '{}')", [pm]);
    expect(await perms(pm)).not.toContain("view_schedules");
    await save(owner, pm, "manager", ["view_company_bids", "view_margin"], [], { v: 1 });
    expect(await perms(pm)).not.toContain("view_margin");
    // New members get it too.
    await join(owner, newbie, "new@acme.dev", "viewer");
    expect(await perms(newbie)).not.toContain("view_schedules");
    // Lift: pm gets both back; rep keeps their own explicit revoke of view_schedules.
    await policy(owner, []);
    expect(await perms(pm)).toEqual(expect.arrayContaining(["view_margin", "view_schedules"]));
    expect(await perms(newbie)).toContain("view_schedules");
    expect(await perms(rep)).not.toContain("view_schedules");
  });

  it("a revoked workspace hides records through RLS (company schedules)", async () => {
    const est = (await pool.query("insert into public.estimates (user_id, company_id, title, customer_name, trades) values ($1, $2, 'Johnson Kitchen', 'Johnson', '{framing}') returning id", [owner, company])).rows[0].id as string;
    await pool.query(`insert into public.project_schedules (estimate_id, user_id, company_id, name, source_snapshot, calendar, start_date)
      values ($1, $2, $3, 'Johnson Kitchen', '{}', '{"workdays":[1,2,3,4,5],"holidays":[],"timezone":"America/Chicago"}', '2026-12-01')`, [est, owner, company]);
    await save(owner, pm, "manager", ["view_company_bids"], [], { v: 1 });
    expect(await rows(pm, "select id from public.project_schedules where estimate_id = $1", [est])).toHaveLength(1);
    await save(owner, pm, "manager", ["view_company_bids"], ["view_schedules", "download_schedule_pdf"], { v: 1, workspaces: { run: false } });
    expect(await rows(pm, "select id from public.project_schedules where estimate_id = $1", [est])).toEqual([]);
    // Turning it back on restores it: nothing was deleted.
    await save(owner, pm, "manager", ["view_company_bids"], [], { v: 1, workspaces: { run: true } });
    expect(await rows(pm, "select id from public.project_schedules where estimate_id = $1", [est])).toHaveLength(1);
  });

  it("my_workspace_access returns the caller's own profile and policy only", async () => {
    await policy(owner, [], ["view_costs"]);
    const r = await as<{ a: Row }>(rep, "select public.my_workspace_access() as a");
    expect(r.a.member.companyId).toBe(company);
    expect(r.a.member.isOwner).toBe(false);
    expect(r.a.member.profile).toBeTruthy();
    expect(r.a.member.policy.locked).toEqual(["view_costs"]);
    expect(r.a.company.perms).not.toContain("view_schedules");
    const solo = await createUser(pool, "solo@x.dev");
    const s = await as<{ a: Row }>(solo, "select public.my_workspace_access() as a");
    expect(s.a.member).toBeNull();
    await policy(owner, [], []);
  });

  it("overview and history are admin-only and carry no emails", async () => {
    expect(await fails(as(rep, "select public.company_access_overview()"))).toMatch(/forbidden/);
    expect(await fails(rows(rep, "select * from public.company_access_history()"))).toMatch(/forbidden/);
    const ov = await as<{ o: { members: Row[]; licenses: Row; policy: Row } }>(admin, "select public.company_access_overview() as o");
    expect(ov.o.members.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(ov.o)).not.toMatch(/@acme\.dev/);
    const hist = await rows(admin, "select * from public.company_access_history($1)", [rep]);
    expect(hist.length).toBeGreaterThan(0);
    expect(hist.every((x) => x.target_id === rep)).toBe(true);
    const all = await rows(owner, "select action from public.company_access_history()");
    expect(all.map((x) => x.action)).toContain("access.policy_updated");
  });

  it("direct table writes are refused", async () => {
    expect(await fails(asUser(pool, admin, (q) => q("insert into public.company_access_policies (company_id, denied) values ($1, '{view_costs}')", [company])))).not.toBe("ok");
    const upd = await asUser(pool, admin, (q) => q("update public.company_members set access_profile = '{}'::jsonb where user_id = $1", [rep])).then((r) => r.rowCount, (e: Error) => e.message);
    expect(upd === 0 || typeof upd === "string").toBe(true);
  });
});
