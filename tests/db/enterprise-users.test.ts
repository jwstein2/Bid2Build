import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

async function asAnon<T>(fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role anon");
    return await fn((sql, p) => c.query(sql, p));
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
}

d("Enterprise users & permissions (database)", () => {
  let owner: string, est: string, invitee: string, unverified: string, outsider: string, company: string, token: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_ent_users"));
    owner = await createUser(pool, "owner@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    invitee = await createUser(pool, "new@acme.dev");
    unverified = await createUser(pool, "lazy@acme.dev", false);
    outsider = await createUser(pool, "out@else.dev");
    company = (await pool.query("select public.create_company($1, 'Acme Roofing') as id", [owner])).rows[0].id;
    await pool.query("select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_o', p_stripe_subscription_id => 'sub_o', p_status => 'active', p_plan => 'enterprise', p_price_id => 'p', p_current_period_end => '2099-01-01', p_cancel_at_period_end => false, p_canceled_at => null, p_ended_at => null, p_event_created => now(), p_company_id => $2::uuid, p_seat_quantity => 5)", [owner, company]);
    const t1 = (await asUser(pool, owner, (q) => q("select token from public.create_company_invitation('est@acme.dev', 'estimator')"))).rows[0].token;
    await asUser(pool, est, (q) => q("select public.accept_company_invitation($1)", [t1]));
    token = (await asUser(pool, owner, (q) => q("select token from public.create_company_invitation('new@acme.dev', 'manager')"))).rows[0].token;
  });
  afterAll(async () => { await drop?.(); });

  it("peek shows company, role and a masked email to anyone holding the link", async () => {
    const r = (await asAnon((q) => q("select * from public.peek_company_invitation($1)", [token]))).rows[0];
    expect(r).toMatchObject({ company_name: "Acme Roofing", role: "manager", email_hint: "n•••@acme.dev", email_matches: false });
  });

  it("peek reports whether the signed-in account's verified email matches", async () => {
    const yes = (await asUser(pool, invitee, (q) => q("select email_matches from public.peek_company_invitation($1)", [token])));
    expect(yes.rows[0].email_matches).toBe(true);
    const no = (await asUser(pool, outsider, (q) => q("select email_matches from public.peek_company_invitation($1)", [token])));
    expect(no.rows[0].email_matches).toBe(false);
  });

  it("peek returns nothing for bad, revoked or used tokens", async () => {
    expect((await asAnon((q) => q("select * from public.peek_company_invitation('nope')"))).rows).toHaveLength(0);
    expect((await asAnon((q) => q("select * from public.peek_company_invitation(null)"))).rows).toHaveLength(0);
    const { token: t2, invitation_id } = (await asUser(pool, owner, (q) => q("select * from public.create_company_invitation('lazy@acme.dev', 'viewer')"))).rows[0];
    await asUser(pool, owner, (q) => q("select public.revoke_company_invitation($1)", [invitation_id]));
    expect((await asAnon((q) => q("select * from public.peek_company_invitation($1)", [t2]))).rows).toHaveLength(0);
  });

  it("teams overview counts members and managers, for company members only", async () => {
    const team = (await asUser(pool, owner, (q) => q("select public.create_company_team('Crew A', 'roofing') as id"))).rows[0].id;
    await asUser(pool, owner, (q) => q("select public.set_company_team_member($1, $2, true, false)", [team, est]));
    const rows = (await asUser(pool, est, (q) => q("select * from public.company_teams_overview()"))).rows;
    expect(rows).toEqual([{ id: team, name: "Crew A", trade: "roofing", member_count: 1, manager_count: 1 }]);
    await expect(asUser(pool, outsider, (q) => q("select * from public.company_teams_overview()"))).rejects.toThrow(/not_a_member/);
  });

  it("recovery email requires manage_users, an active member and a verified address, and is audited", async () => {
    const e = (await asUser(pool, owner, (q) => q("select public.company_member_recovery_email($1) as e", [est]))).rows[0].e;
    expect(e).toBe("est@acme.dev");
    await expect(asUser(pool, est, (q) => q("select public.company_member_recovery_email($1)", [owner]))).rejects.toThrow(/forbidden/);
    await expect(asUser(pool, owner, (q) => q("select public.company_member_recovery_email($1)", [outsider]))).rejects.toThrow(/no_verified_email/);
    const audit = await pool.query("select count(*)::int as n from public.company_audit_log where company_id = $1 and action = 'member.recovery_sent'", [company]);
    expect(audit.rows[0].n).toBe(1);
  });

  it("member access shows custom grants to user admins only", async () => {
    await asUser(pool, owner, (q) => q("select public.update_company_member($1, 'estimator', array['view_analytics'], array['view_costs'])", [est]));
    const rows = (await asUser(pool, owner, (q) => q("select * from public.company_member_access() where user_id = $1", [est]))).rows;
    expect(rows[0]).toMatchObject({ permissions_granted: ["view_analytics"], permissions_revoked: ["view_costs"] });
    await expect(asUser(pool, est, (q) => q("select * from public.company_member_access()"))).rejects.toThrow(/forbidden/);
  });

  it("anon cannot call member-only functions", async () => {
    await expect(asAnon((q) => q("select * from public.company_teams_overview()"))).rejects.toThrow(/permission denied/);
    await expect(asAnon((q) => q("select public.company_member_recovery_email($1)", [est]))).rejects.toThrow(/permission denied/);
  });

  it("an unverified account cannot accept even with the right link", async () => {
    const t3 = (await asUser(pool, owner, (q) => q("select token from public.create_company_invitation('lazy@acme.dev', 'viewer')"))).rows[0].token;
    expect((await asUser(pool, unverified, (q) => q("select email_matches from public.peek_company_invitation($1)", [t3]))).rows[0].email_matches).toBe(false);
    await expect(asUser(pool, unverified, (q) => q("select public.accept_company_invitation($1)", [t3]))).rejects.toThrow(/invitation_email_mismatch|no_verified/);
  });
});
