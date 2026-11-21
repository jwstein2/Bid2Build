/**
 * V8.3.1 worker app invites (20270212001000), against the real SQL with synthetic companies:
 *   - an owner invites an unlinked staff record by email; accepting the company invitation links the login to that
 *     record (no duplicate identity) and the person lands in My work
 *   - an email that already belongs to an active member is linked right away (no seat used)
 *   - seats, permissions, staff-only, already-linked and other companies are refused
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

d("Worker app invites (database)", () => {
  let owner: string, viewer: string, otherOwner: string, company: string;
  let jose: string, cris: string, sub: string, otherStaff: string;
  const val = <T = unknown>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(`${sql} as v`, args)).then((r) => r.rows[0].v as T);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_worker_invites"));
    owner = await createUser(pool, "owner@acme.dev");
    viewer = await createUser(pool, "cris@acme.dev");
    otherOwner = await createUser(pool, "boss@other.dev");
    company = (await pool.query("select public.create_company($1, 'Acme Roofing') as id", [owner])).rows[0].id;
    const other = (await pool.query("select public.create_company($1, 'Other') as id", [otherOwner])).rows[0].id;
    await pool.query(`select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'c1', p_stripe_subscription_id => 's1', p_status => 'active', p_plan => 'enterprise',
      p_price_id => 'p', p_current_period_end => '2099-01-01', p_cancel_at_period_end => false, p_canceled_at => null, p_ended_at => null, p_event_created => now(), p_company_id => $2::uuid, p_seat_quantity => 3)`, [owner, company]);
    await pool.query("insert into public.company_members (company_id, user_id, role, display_name, email) values ($1, $2, 'viewer', 'Cris', 'cris@acme.dev')", [company, viewer]);
    const res = (c: string, kind: string, name: string) => pool.query("insert into public.pm_resources (company_id, kind, name) values ($1, $2, $3) returning id", [c, kind, name]).then((r) => r.rows[0].id as string);
    jose = await res(company, "staff", "Jose");
    cris = await res(company, "staff", "Cris");
    sub = await res(company, "subcontractor", "Sparky LLC");
    otherStaff = await res(other, "staff", "Oz");
  });
  afterAll(async () => { if (drop) await drop(); });

  it("refuses people who can't invite, other companies, subs and bad emails", async () => {
    expect(await fails(val(viewer, "select public.pm_worker_invite_create($1, 'jose@acme.dev')", [jose]))).toMatch(/forbidden/);
    expect(await fails(val(owner, "select public.pm_worker_invite_create($1, 'oz@other.dev')", [otherStaff]))).toMatch(/forbidden/);
    expect(await fails(val(owner, "select public.pm_worker_invite_create($1, 'sub@acme.dev')", [sub]))).toMatch(/staff_only/);
    expect(await fails(val(owner, "select public.pm_worker_invite_create($1, 'nope')", [jose]))).toMatch(/invalid_email/);
    const st = await val<Record<string, unknown>>(viewer, "select public.pm_worker_invite_status($1)", [jose]);
    expect(st).toMatchObject({ linked: false, canInvite: false, pending: null });
  });

  it("an existing member's email links right away without a seat", async () => {
    const r = await val<Record<string, unknown>>(owner, "select public.pm_worker_invite_create($1, 'Cris@Acme.dev')", [cris]);
    expect(r).toEqual({ status: "linked" });
    expect((await pool.query("select linked_user_id from public.pm_resources where id = $1", [cris])).rows[0].linked_user_id).toBe(viewer);
    expect(await fails(val(owner, "select public.pm_worker_invite_create($1, 'cris@acme.dev')", [cris]))).toMatch(/already_linked/);
  });

  it("a new worker gets a one-time link; accepting it joins the company and links the staff record", async () => {
    const first = await val<Record<string, string>>(owner, "select public.pm_worker_invite_create($1, 'jose@acme.dev')", [jose]);
    expect(first.status).toBe("invited");
    const again = await val<Record<string, string>>(owner, "select public.pm_worker_invite_create($1, 'jose@acme.dev')", [jose]);
    // Re-inviting replaces the old link.
    expect((await pool.query("select count(*)::int as n from public.company_invitations where resource_id = $1 and revoked_at is null", [jose])).rows[0].n).toBe(1);
    const st = await val<Record<string, Record<string, unknown>>>(owner, "select public.pm_worker_invite_status($1)", [jose]);
    expect(st.pending).toMatchObject({ email: "jose@acme.dev" });
    expect(JSON.stringify(st)).not.toContain(again.token);
    const joseUser = await createUser(pool, "jose@acme.dev");
    expect(await fails(val(joseUser, "select public.accept_company_invitation($1)", [first.token]))).toMatch(/invitation_invalid/);
    expect(await val(joseUser, "select public.accept_company_invitation($1)", [again.token])).toBe(company);
    const row = (await pool.query("select linked_user_id, email from public.pm_resources where id = $1", [jose])).rows[0];
    expect(row).toEqual({ linked_user_id: joseUser, email: "jose@acme.dev" });
    expect((await pool.query("select role from public.company_members where user_id = $1", [joseUser])).rows[0].role).toBe("viewer");
  });

  it("seats are respected", async () => {
    const extra = (await pool.query("insert into public.pm_resources (company_id, kind, name) values ($1, 'staff', 'Lee') returning id", [company])).rows[0].id;
    // owner + cris + jose = 3 seats of 3
    expect(await fails(val(owner, "select public.pm_worker_invite_create($1, 'lee@acme.dev')", [extra]))).toMatch(/no_seats_available/);
  });

  it("rollback removes it cleanly and the migration re-applies", async () => {
    await pool.query(readFileSync("docs/worker-invites/rollback_20270212001000.sql", "utf8"));
    expect((await pool.query("select count(*)::int as n from information_schema.columns where table_name = 'company_invitations' and column_name = 'resource_id'")).rows[0].n).toBe(0);
    await pool.query(readFileSync("supabase/migrations/20270212001000_worker_invites.sql", "utf8"));
  });
});
