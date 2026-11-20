import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const hash = (n: number | string) => createHash("sha256").update(`v89-token-${n}`).digest("hex");
const save = async (caller: string, email: string, name: string, role = "rep", sells = true) =>
  (await q1("select public.admin_sales_member_save($1, null, $2, $3, null, $4, 'invited', null, $5) r", [caller, email, name, role, sells])).r.id as string;
const invite = (caller: string, rep: string, h: string) => pool.query("select public.admin_sales_invite_create($1, $2, $3, 14)", [caller, rep, h]);
const accept = (user: string, h: string) => asUser(pool, user, async (q) => (await q("select public.sales_invite_accept($1) r", [h])).rows[0].r as Record<string, unknown>);
const me = (user: string) => asUser(pool, user, async (q) => (await q("select public.sales_me() r")).rows[0].r as Record<string, unknown> | null);
const ws = (user: string) => asUser(pool, user, async (q) => (await q("select public.my_workspaces() r")).rows[0].r as Record<string, unknown>);

d("sales V8.9 invite acceptance + V8.10 workspaces (database)", () => {
  let owner: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_v89_invite"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
  });
  afterAll(async () => { await drop?.(); });

  it("1. a brand-new rep accepts with the invited email and becomes an active rep", async () => {
    const rep = await save(owner, "newrep@sales.com", "New Rep");
    await invite(owner, rep, hash("new"));
    const u = await createUser(pool, "newrep@sales.com");
    expect(await accept(u, hash("new"))).toMatchObject({ status: "joined", rep_id: rep, sells: true, email_matched: true });
    expect(await val("select status from public.sales_reps where id = $1", [rep])).toBe("active");
    expect(await val("select accepted_by = $2 from public.sales_rep_invites where rep_id = $1", [rep, u])).toBe(true);
    expect(await val("select public.sales_capabilities($1)", [u])).toContain("view_own_leads");
    // 5. Clicking the original invite again is harmless and says they're already a member.
    expect(await accept(u, hash("new"))).toMatchObject({ status: "already_member", rep_id: rep });
    // 4. Signing back in later: sales_me finds the record by account.
    expect(await me(u)).toMatchObject({ id: rep, status: "active" });
    expect(await val("select count(*)::int from public.audit_logs where action = 'sales.invite_accepted' and target_id = $1", [rep])).toBe(1);
  });

  it("2. an existing customer account with a different email accepts by token", async () => {
    const rep = await save(owner, "work@sales.com", "Work Email");
    await invite(owner, rep, hash("existing"));
    const customer = await createUser(pool, "personal@gmail.com");
    await pool.query("insert into public.estimates (user_id, title) values ($1, 'Deck bid')", [customer]);
    // Before: the email path can't link this account (different email).
    expect(await me(customer)).toBeNull();
    expect(await accept(customer, hash("existing"))).toMatchObject({ status: "joined", email_matched: false });
    expect(await me(customer)).toMatchObject({ id: rep });
    expect(await val("select accepted_email from public.sales_rep_invites where rep_id = $1", [rep])).toBe("personal@gmail.com");
    // 10-ish: this person has both workspaces now.
    expect(await ws(customer)).toMatchObject({ sales_my: true, sales_admin: false, contractor: true, landing: "auto" });
  });

  it("refuses unverified accounts and signed-out callers", async () => {
    const rep = await save(owner, "slow@sales.com", "Slow Verify");
    await invite(owner, rep, hash("unverified"));
    const u = await createUser(pool, "slow@sales.com", false);
    expect(await accept(u, hash("unverified"))).toMatchObject({ status: "unverified" });
    expect(await val("select user_id from public.sales_reps where id = $1", [rep])).toBeNull();
    // 3. Verified later (another tab or device): the same token still works.
    await pool.query("update auth.users set email_confirmed_at = now() where id = $1", [u]);
    expect(await accept(u, hash("unverified"))).toMatchObject({ status: "joined" });
    expect(await val("select (public.sales_invite_accept($1)) ->> 'status'", [hash("unverified")])).toBe("signed_out");
  });

  it("6, 7, 8. expired, revoked and resent invites", async () => {
    const rep = await save(owner, "states@sales.com", "States Rep");
    await invite(owner, rep, hash("s1"));
    await invite(owner, rep, hash("s2")); // resend: s1 is revoked
    const other = await createUser(pool, "someone@else.com");
    expect(await accept(other, hash("s1"))).toMatchObject({ status: "revoked" });
    await pool.query("update public.sales_rep_invites set expires_at = now() - interval '1 minute' where token_hash = $1", [hash("s2")]);
    expect(await accept(other, hash("s2"))).toMatchObject({ status: "expired" });
    expect(await accept(other, hash("nope"))).toMatchObject({ status: "not_found" });
    expect(await accept(other, "not-a-hash")).toMatchObject({ status: "not_found" });
    // Email auto-link no longer bypasses an expired or revoked invite.
    const u = await createUser(pool, "states@sales.com");
    expect(await me(u)).toBeNull();
    // A fresh (resent) link works.
    await invite(owner, rep, hash("s3"));
    expect(await accept(u, hash("s3"))).toMatchObject({ status: "joined" });
    // Revoked (suspended) after joining: the hub closes.
    await pool.query("update public.sales_reps set status = 'suspended' where id = $1", [rep]);
    expect(await accept(u, hash("s3"))).toMatchObject({ status: "suspended" });
    expect(await val("select public.sales_capabilities($1)", [u])).toEqual([]);
    expect(await ws(u)).toMatchObject({ sales_my: false, sales_admin: false });
  });

  it("9. duplicate invites never create a second team record", async () => {
    const a = await save(owner, "dup-a@sales.com", "Dup A");
    const b = await save(owner, "dup-b@sales.com", "Dup B");
    await invite(owner, a, hash("dupA"));
    await invite(owner, b, hash("dupB"));
    const u = await createUser(pool, "dup-a@sales.com");
    expect(await accept(u, hash("dupA"))).toMatchObject({ status: "joined" });
    expect(await accept(u, hash("dupB"))).toMatchObject({ status: "other_record" });
    // Someone else can't take an invite that was already used.
    const thief = await createUser(pool, "thief@x.com");
    expect(await accept(thief, hash("dupA"))).toMatchObject({ status: "accepted" });
    expect(await val("select count(*)::int from public.sales_reps where user_id = $1", [u])).toBe(1);
    await expect(pool.query("select public.admin_sales_member_save($1, null, 'dup-a@sales.com', 'Again', null, 'rep', 'invited', null, true)", [owner])).rejects.toThrow(/duplicate|unique/);
  });

  it("a Sales Administrator invite only opens for the exact invited email", async () => {
    const adm = await save(owner, "admin@sales.com", "Sales Admin", "admin", false);
    await invite(owner, adm, hash("adm"));
    const wrong = await createUser(pool, "admin-personal@gmail.com");
    expect(await accept(wrong, hash("adm"))).toMatchObject({ status: "email_mismatch" });
    expect(await val("select public.sales_capabilities($1)", [wrong])).toEqual([]);
    const right = await createUser(pool, "admin@sales.com");
    expect(await accept(right, hash("adm"))).toMatchObject({ status: "joined", role: "admin", sells: false });
    expect(await ws(right)).toMatchObject({ sales_my: false, sales_admin: true, contractor: false });
  });

  it("10, 11, 14. workspaces per role, and nobody grants themselves anything", async () => {
    const plain = await createUser(pool, "customer@co.com");
    expect(await ws(plain)).toMatchObject({ sales_my: false, sales_admin: false, contractor: false });
    // The platform owner (also selling = dual role) has everything.
    const ownerRep = await save(owner, "owner@built2bid.org", "Owner Sells");
    await me(owner);
    expect(await val("select user_id = $2 from public.sales_reps where id = $1", [ownerRep, owner])).toBe(true);
    expect(await ws(owner)).toMatchObject({ sales_my: true, sales_admin: true, contractor: true });
    // Preferences only remember; they never add a capability.
    const after = await asUser(pool, plain, async (q) => (await q("select public.set_my_workspace('sales', 'admin', 'sales') r")).rows[0].r);
    expect(after).toMatchObject({ sales_my: false, sales_admin: false, landing: "sales", last_workspace: "sales", sales_view: "admin" });
    expect(await val("select public.sales_capabilities($1)", [plain])).toEqual([]);
    await expect(asUser(pool, plain, (q) => q("select public.set_my_workspace('admin_hub')"))).rejects.toThrow(/invalid/);
    // Nobody reads or writes the preferences table directly.
    await expect(asUser(pool, plain, (q) => q("select * from public.account_preferences"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, plain, (q) => q("update public.sales_reps set status = 'active', user_id = auth.uid()"))).rejects.toThrow(/permission denied/);
  });
});
