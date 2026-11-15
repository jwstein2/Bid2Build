import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const h = (x: string) => createHash("sha256").update(x).digest("hex");
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

d("Customer schedule updates (database)", () => {
  let solo: string, owner: string, est: string, viewer: string, outsider: string, company: string;

  const sub = (u: string, plan = "monthly", companyId: string | null = null, seats: number | null = null) =>
    pool.query(
      `select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_' || $1, p_stripe_subscription_id => 'sub_' || $1,
        p_status => 'active', p_plan => $2, p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
        p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => $3::uuid, p_seat_quantity => $4)`,
      [u, plan, companyId, seats],
    );
  async function schedule(u: string, companyId: string | null = null) {
    const id = (await pool.query("insert into public.estimates (user_id, company_id, title, customer_name, trades) values ($1, $2, 'Kitchen', 'Pat', '{framing}') returning id", [u, companyId])).rows[0].id as string;
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("select set_config('app.stage_change', 'on', true)");
      await c.query("update public.estimates set pipeline_stage = 'won' where id = $1", [id]); await c.query("commit");
    } finally { c.release(); }
    const g = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Framing', 0) returning id", [id, u])).rows[0].id as string;
    const p = { name: "Kitchen", calendar: CAL, startDate: "2026-11-16", tasks: [{ key: "a", kind: "section", sourceGroupId: g, name: "Framing", plannedStart: "2026-11-16", plannedEnd: "2026-11-19", durationDays: 4, sortOrder: 0 }], deps: [] };
    return asUser(pool, u, (q) => q("select public.schedule_create($1, false, $2) as id", [id, p])).then((r) => r.rows[0].id as string);
  }
  const content = (n: number) => ({ v: 1, projectTitle: "Kitchen", progress: n, sections: [] });
  const publish = (u: string, sid: string, rev: number, n = 10) =>
    asUser(pool, u, (q) => q("select public.schedule_publish($1, $2, $3) as r", [sid, rev, { options: { showProgress: true }, content: content(n), contentHash: h(String(n)), publisherName: "Sam" }])).then((r) => r.rows[0].r);
  const list = (u: string, sid: string) => asUser(pool, u, (q) => q("select id, version, content, token_hash, delivery from public.schedule_publications where schedule_id = $1 order by version", [sid])).then((r) => r.rows);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sched_pubs"));
    solo = await createUser(pool, "solo@test.dev");
    owner = await createUser(pool, "owner@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    outsider = await createUser(pool, "out@test.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    for (const [u, role] of [[est, "estimator"], [viewer, "viewer"]]) await pool.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, $3)", [company, u, role]);
    await pool.query("update public.company_members set permissions_granted = '{view_company_bids}' where user_id = $1", [viewer]);
    await sub(solo);
    await pool.query("select public.apply_pm_update('sub_' || $1, true, 0, now())", [solo]);
    await sub(owner, "enterprise", company, 5);
  });
  afterAll(async () => { await drop?.(); });

  it("publishes numbered, frozen versions; a stale preview is refused", async () => {
    const sid = await schedule(solo);
    const a = await publish(solo, sid, 1, 10);
    expect(a.version).toBe(1);
    expect(await fails(publish(solo, sid, 7))).toMatch(/stale_revision/);
    const b = await publish(solo, sid, 1, 40);
    expect(b.version).toBe(2);
    const rows = await list(solo, sid);
    expect(rows.map((r) => [r.version, r.content.progress])).toEqual([[1, 10], [2, 40]]);
    // Write-once: even the service role can't rewrite a published update.
    expect(await fails(pool.query("update public.schedule_publications set content = '{\"progress\": 99}' where id = $1", [a.id]))).toMatch(/publication_frozen/);
    // Later schedule edits don't touch earlier publications.
    await asUser(pool, solo, (q) => q("select public.schedule_save($1, 1, $2)", [sid, { summary: "edit", schedule: { name: "Kitchen 2" } }]));
    expect((await list(solo, sid))[0].content.progress).toBe(10);
  });

  it("no direct writes; other accounts can't read or publish", async () => {
    const sid = await schedule(solo);
    await publish(solo, sid, 1);
    expect(await fails(asUser(pool, solo, (q) => q("insert into public.schedule_publications (schedule_id, estimate_id, version, schedule_revision, options, content, content_hash) select id, estimate_id, 9, 1, '{}', '{}', $2 from public.project_schedules where id = $1", [sid, h("x")])))).toMatch(/permission denied/);
    expect(await fails(asUser(pool, solo, (q) => q("update public.schedule_publications set delivery = '[]' where schedule_id = $1", [sid])))).toMatch(/permission denied/);
    expect(await list(outsider, sid)).toHaveLength(0);
    expect(await fails(publish(outsider, sid, 1))).toMatch(/forbidden/);
  });

  it("share link: only the hash is stored, a new link replaces the old, revoke turns it off; delivery is recorded honestly", async () => {
    const sid = await schedule(solo);
    const { id } = await publish(solo, sid, 1);
    const exp = await asUser(pool, solo, (q) => q("select public.schedule_publication_link($1, $2, 30) as e", [id, h("tok1")])).then((r) => r.rows[0].e as Date);
    expect(new Date(exp).getTime()).toBeGreaterThan(Date.now() + 29 * 864e5);
    await asUser(pool, solo, (q) => q("select public.schedule_publication_link($1, $2, 30)", [id, h("tok2")]));
    const row = (await pool.query("select token_hash, link_revoked_at, delivery from public.schedule_publications where id = $1", [id])).rows[0];
    expect(row.token_hash).toBe(h("tok2"));
    expect(row.delivery.map((x: { method: string }) => x.method)).toEqual(["link_created", "link_created"]);
    await asUser(pool, solo, (q) => q("select public.schedule_publication_delivery($1, 'email_draft')", [id]));
    expect(await fails(asUser(pool, solo, (q) => q("select public.schedule_publication_delivery($1, 'delivered')", [id])))).toMatch(/invalid/);
    await asUser(pool, solo, (q) => q("select public.schedule_publication_revoke_link($1)", [id]));
    const after = (await pool.query("select link_revoked_at, delivery from public.schedule_publications where id = $1", [id])).rows[0];
    expect(after.link_revoked_at).not.toBeNull();
    expect(after.delivery.at(-1).method).toBe("email_draft");
    expect(await fails(asUser(pool, outsider, (q) => q("select public.schedule_publication_link($1, $2, 30)", [id, h("x")])))).toMatch(/forbidden/);
    expect(await fails(asUser(pool, solo, (q) => q("select public.schedule_publication_link($1, 'not-a-hash', 30)", [id])))).toMatch(/invalid/);
  });

  it("Enterprise: the PM editor publishes; view-only members see the history but can't publish or share", async () => {
    await asUser(pool, owner, (q) => q("select public.company_pm_assign($1, true)", [est]));
    const sid = await schedule(est, company);
    const { id } = await publish(est, sid, 1);
    const audit = await pool.query("select action from public.company_audit_log where company_id = $1 and action = 'schedule.update_published'", [company]);
    expect(audit.rows).toHaveLength(1);
    expect(await list(viewer, sid)).toHaveLength(1);
    expect(await fails(publish(viewer, sid, 1))).toMatch(/forbidden/);
    expect(await fails(asUser(pool, viewer, (q) => q("select public.schedule_publication_link($1, $2, 30)", [id, h("v")])))).toMatch(/forbidden/);
    expect(await fails(asUser(pool, viewer, (q) => q("select public.schedule_publication_delivery($1, 'pdf_download')", [id])))).toMatch(/forbidden/);
    expect(await list(outsider, sid)).toHaveLength(0);
  });
});
