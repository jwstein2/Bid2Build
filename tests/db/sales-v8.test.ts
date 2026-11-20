import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const HASH = (c: string) => c.repeat(64);

d("sales hub V8 foundation (database)", () => {
  let owner: string, repId: string, repCode: string;
  const attribute = async (email: string) => {
    const u = await createUser(pool, email);
    expect(await val("select public.sales_record_attribution($1, $2, now())", [u, repCode])).toBe("recorded");
    return u;
  };
  const pay = (u: string, inv: string, paidAt: string) =>
    val("select public.sales_sync_billing($1, $2, 'active', 'monthly', null, 1999, '{}'::jsonb, $3, 1999, $4::timestamptz)", [u, `sub_${u}`, inv, paidAt]);
  const line = (u: string) => q1("select status, reason, policy_version, statement_id from public.sales_commissions where user_id = $1 and year_no = 1", [u]);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_v8"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    await applyMigration(pool, "20270110001000_sales_v8_foundation.sql"); // safe to re-run
    const r = await q1("select public.admin_sales_rep_save($1, null, 'rita@sales.com', 'Rita Rep', null, 'rep', 'active', null) as r", [owner]);
    repId = r.r.id;
    const ritaU = await createUser(pool, "rita@sales.com");
    await asUser(pool, ritaU, (q) => q("select public.sales_me()"));
    repCode = await val("select code from public.sales_reps where id = $1", [repId]) as string;
  });
  afterAll(async () => { await drop?.(); });

  it("applies James's V8 rules as policy version 2 and keeps version 1 as the earlier rules", async () => {
    expect(await q1("select refund_policy, attribution_window_days, first_month_cancel_voids from public.sales_settings where id"))
      .toEqual({ refund_policy: "hold_30_no_clawback", attribution_window_days: 90, first_month_cancel_voids: true });
    const versions = await val("select public.admin_sales_policy_versions($1)", [owner]) as { version: number; policy: Record<string, unknown>; note: string }[];
    // Version 3 is Compensation Model V3 (20270202001000), which changes only the milestone rules; version 4 is the
    // ten-year term (20270209001000), which changes only commission_years.
    expect(versions.map((v) => v.version)).toEqual([4, 3, 2, 1]);
    expect(versions[0].note).toMatch(/Ten-year recurring term/);
    expect(versions[0].policy).toMatchObject({ refund_policy: "hold_30_no_clawback", commission_years: 10, attribution_window_days: 90 });
    versions.shift();
    expect(versions[2].policy).toMatchObject({ refund_policy: "month_end_clawback", attribution_window_days: 30, first_month_cancel_voids: false });
    expect(versions[1].note).toMatch(/V8 rules/);
    expect(versions[0].note).toMatch(/Compensation Model V3/);
    expect(versions[0].policy).toMatchObject({ refund_policy: "hold_30_no_clawback", commission_years: 3, attribution_window_days: 90 });
  });

  it("writes a new version only when a rule changes, and stamps each new commission with the version in force", async () => {
    await val("select public.admin_sales_settings_save($1, 'monthly_list', 'hold_30_no_clawback', 'all_items', 10, 90, true, 'just confirming', true)", [owner]);
    expect(await val("select public.sales_policy_current_version()")).toBe(4);
    const u = await attribute("summit@roof.com");
    await pay(u, "in_1", new Date().toISOString());
    expect(await line(u)).toMatchObject({ status: "pending", policy_version: 4 });
    await val("select public.admin_sales_settings_save($1, 'monthly_list', 'hold_30_no_clawback', 'all_items', 10, 60, false, 'shorter window', true)", [owner]);
    expect(await val("select public.sales_policy_current_version()")).toBe(5);
    expect(await line(u)).toMatchObject({ policy_version: 4 }); // earlier line keeps its version
    await val("select public.admin_sales_settings_save($1, 'monthly_list', 'hold_30_no_clawback', 'all_items', 10, 90, false, null, true)", [owner]);
  });

  it("holds commissions 30 days before month-end close earns them", async () => {
    const u = await attribute("deck@pros.com");
    await pay(u, "in_2", "2026-03-10T15:00:00Z");
    await pool.query("update public.sales_commissions set created_at = '2026-03-10T15:00:00Z' where user_id = $1", [u]);
    await val("select public.sales_close_month('2026-04-01T12:00:00Z')"); // 22 days: still held
    expect((await line(u)).status).toBe("pending");
    await val("select public.sales_close_month('2026-04-10T12:00:00Z')"); // 31 days: earned onto the March statement
    expect((await line(u)).status).toBe("earned");
  });

  it("cancels the sale-month commission when the customer cancels within the first month, even with no refund", async () => {
    const u = await attribute("quick@quit.com");
    const paidAt = new Date(Date.now() - 10 * 86400_000).toISOString();
    await pay(u, "in_3", paidAt);
    expect(await val("select public.sales_customer_canceled($1, now())", [u])).toEqual({ action: "canceled" });
    expect(await line(u)).toMatchObject({ status: "canceled", reason: "customer_canceled_first_month" });

    const late = await attribute("late@quit.com");
    await pay(late, "in_4", new Date(Date.now() - 45 * 86400_000).toISOString());
    expect(await val("select public.sales_customer_canceled($1, now())", [late])).toMatchObject({ action: "none", reason: "after_first_month" });
    expect((await line(late)).status).toBe("pending");

    // The stored status turning canceled does the same (backup for missed webhook data).
    const viaStatus = await attribute("status@quit.com");
    await pay(viaStatus, "in_5", new Date(Date.now() - 5 * 86400_000).toISOString());
    await pool.query("update public.sales_attributions set sub_status = 'canceled' where user_id = $1", [viaStatus]);
    expect((await line(viaStatus)).status).toBe("canceled");

    // Approved or paid lines are never taken back; they are flagged for review.
    const paidLine = await attribute("paid@quit.com");
    await pay(paidLine, "in_6", new Date(Date.now() - 3 * 86400_000).toISOString());
    await pool.query("update public.sales_commissions set status = 'approved' where user_id = $1", [paidLine]);
    expect(await val("select public.sales_customer_canceled($1, now())", [paidLine])).toEqual({ action: "flagged" });
    expect((await line(paidLine)).status).toBe("approved");
  });

  it("creates single-use, expiring rep invites that only the owner can make and that close on first sign-in", async () => {
    const neo = await q1("select public.admin_sales_rep_save($1, null, 'neo@sales.com', 'Neo Rep', null, 'rep', 'active', null) as r", [owner]);
    const id = neo.r.id;
    await val("select public.admin_sales_invite_create($1, $2, $3, 14)", [owner, id, HASH("a")]);
    expect(await val("select public.sales_invite_lookup($1)", [HASH("a")])).toMatchObject({ status: "valid", full_name: "Neo Rep", email_hint: "n•••@sales.com" });
    // A fresh link replaces the old one.
    await val("select public.admin_sales_invite_create($1, $2, $3, 14)", [owner, id, HASH("b")]);
    expect(await val("select public.sales_invite_lookup($1)", [HASH("a")])).toMatchObject({ status: "revoked" });
    await pool.query("update public.sales_rep_invites set expires_at = now() - interval '1 minute' where token_hash = $1", [HASH("b")]);
    expect(await val("select public.sales_invite_lookup($1)", [HASH("b")])).toMatchObject({ status: "expired" });
    await val("select public.admin_sales_invite_create($1, $2, $3, 14)", [owner, id, HASH("c")]);
    const u = await createUser(pool, "neo@sales.com");
    await asUser(pool, u, (q) => q("select public.sales_me()"));
    expect(await val("select public.sales_invite_lookup($1)", [HASH("c")])).toMatchObject({ status: "accepted" });
    await expect(val("select public.admin_sales_invite_create($1, $2, $3, 14)", [owner, id, HASH("d")])).rejects.toThrow(/already_joined/);
    expect(Object.keys(await val("select public.admin_sales_invites($1)", [owner]) as object)).toContain(id);
    expect(await val("select count(*)::int from public.audit_logs where action = 'sales.invite_created'")).toBe(3);

    const stranger = await createUser(pool, "x@y.com");
    await expect(val("select public.admin_sales_invite_create($1, $2, $3, 14)", [stranger, repId, HASH("e")])).rejects.toThrow();
    await expect(asUser(pool, stranger, (q) => q("select public.sales_invite_lookup($1)", [HASH("c")]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, stranger, (q) => q("select * from public.sales_policy_versions"))).rejects.toThrow(/permission denied/);
  });
});
