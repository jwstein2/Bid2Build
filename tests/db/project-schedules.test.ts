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
const sub = (u: string, plan = "monthly", company: string | null = null, seats: number | null = null) =>
  pool.query(
    `select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_' || $1, p_stripe_subscription_id => 'sub_' || $1,
      p_status => 'active', p_plan => $2, p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
      p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => $3::uuid, p_seat_quantity => $4)`,
    [u, plan, company, seats],
  );
const addon = (u: string, on: boolean) => pool.query("select public.apply_pm_update('sub_' || $1, $2, 0, now())", [u, on]);

d("Project schedules (database)", () => {
  let solo: string, freeUser: string, owner: string, est: string, viewer: string, outsider: string, company: string;

  async function bid(u: string, stage = "won", companyId: string | null = null) {
    const id = (await pool.query("insert into public.estimates (user_id, company_id, title, customer_name, trades) values ($1, $2, 'Kitchen', 'Pat', '{framing}') returning id", [u, companyId])).rows[0].id as string;
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.stage_change', 'on', true)");
      await c.query("update public.estimates set pipeline_stage = $2 where id = $1", [id, stage]);
      await c.query("commit");
    } finally { c.release(); }
    const g1 = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Framing', 0) returning id", [id, u])).rows[0].id as string;
    const g2 = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Flooring', 1) returning id", [id, u])).rows[0].id as string;
    const i1 = (await pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, quantity, unit, unit_cost, sort_order) values ($1, $2, $3, 'Wall framing', 400, 'sq ft', 12.5, 0) returning id", [id, g1, u])).rows[0].id as string;
    return { id, g1, g2, i1 };
  }
  const payload = (b: { g1: string; g2: string }) => ({
    name: "Kitchen", calendar: CAL, startDate: "2026-11-16", targetEndDate: null,
    tasks: [
      { key: "a", kind: "section", sourceGroupId: b.g1, name: "Framing", plannedStart: "2026-11-16", plannedEnd: "2026-11-19", durationDays: 4, sortOrder: 0 },
      { key: "b", kind: "section", sourceGroupId: b.g2, name: "Flooring", plannedStart: "2026-11-18", plannedEnd: "2026-11-20", durationDays: 3, sortOrder: 1 },
    ],
    deps: [{ from: "a", to: "b", lagDays: -2, maxOverlap: 2 }],
  });
  const create = (u: string, b: { id: string; g1: string; g2: string }, provisional = false, p: object = payload(b)) =>
    asUser(pool, u, (q) => q("select public.schedule_create($1, $2, $3) as id", [b.id, provisional, p])).then((r) => r.rows[0].id as string);
  const get = (u: string, id: string) => asUser(pool, u, (q) => q("select public.schedule_get($1) as s", [id])).then((r) => r.rows[0].s);
  const save = (u: string, id: string, rev: number, p: object) => asUser(pool, u, (q) => q("select public.schedule_save($1, $2, $3) as r", [id, rev, p])).then((r) => r.rows[0].r as number);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_schedules"));
    solo = await createUser(pool, "solo@test.dev");
    freeUser = await createUser(pool, "free@test.dev");
    owner = await createUser(pool, "owner@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    outsider = await createUser(pool, "out@test.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    for (const [u, role] of [[est, "estimator"], [viewer, "viewer"]]) await pool.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, $3)", [company, u, role]);
    await sub(solo);
    await sub(owner, "enterprise", company, 5);
  });
  afterAll(async () => { await drop?.(); });

  it("free accounts and Unlimited without the add-on can't create schedules", async () => {
    const b = await bid(freeUser);
    expect(await fails(create(freeUser, b))).toMatch(/forbidden/);
    const s = await bid(solo);
    expect(await fails(create(solo, s))).toMatch(/forbidden/);
  });

  it("with the add-on: an accepted bid becomes a draft schedule; unaccepted needs provisional", async () => {
    await addon(solo, true);
    const draft = await bid(solo, "sent");
    expect(await fails(create(solo, draft))).toMatch(/not_accepted/);
    const provId = await create(solo, draft, true);
    expect((await get(solo, provId)).schedule).toMatchObject({ provisional: true, status: "draft" });

    const b = await bid(solo);
    const id = await create(solo, b);
    const s = await get(solo, id);
    expect(s.schedule).toMatchObject({ provisional: false, status: "draft", revision: 1 });
    expect(s.tasks).toHaveLength(2);
    expect(s.deps[0]).toMatchObject({ lag_days: -2, max_overlap: 2 });
    expect(s.revisions[0].summary).toMatch(/draft/i);
    expect(s.canEdit).toBe(true);
  });

  it("a customer signature counts as accepted, even before the bid is moved to Won", async () => {
    const b = await bid(solo, "pending");
    const v = (await pool.query(
      `insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total)
       values ($1, $2, 1, $3, '{}', $4, 700, 1000, 0, 1000) returning id`,
      [b.id, solo, h(b.id), { meta: { title: "Kitchen", number: "1" }, customer: { name: "Pat" }, pricing: { total: "$1" } }])).rows[0].id as string;
    expect(await fails(create(solo, b))).toMatch(/not_accepted/);
    const tok = `tok-${b.id}`;
    await pool.query("select * from public.create_signing_request($1, $2, $3, $4, $5, now() + interval '7 days')", [solo, b.id, v, h(tok), h("d")]);
    await pool.query(`select * from public.accept_signing_request($1, 'Pat Smith', 'p@x.dev', 'typed', 'Pat Smith', null, 'v1', 'I consent', 'I accept', now(), '203.0.113.9', 'agent')`, [h(tok)]);
    const id = await create(solo, b);
    expect((await get(solo, id)).schedule.provisional).toBe(false);
  });

  it("one schedule per bid (no duplicate projects)", async () => {
    const b = await bid(solo);
    const id = await create(solo, b);
    const err = await asUser(pool, solo, (q) => q("select public.schedule_create($1, false, $2)", [b.id, payload(b)])).then(() => null, (e) => e);
    expect(err.message).toMatch(/schedule_exists/);
    expect(err.detail).toBe(id);
  });

  it("snapshot: sections and items from the estimate, never costs; later edits don't change it", async () => {
    const b = await bid(solo);
    const id = await create(solo, b);
    const snap = (await pool.query("select source_snapshot from public.project_schedules where id = $1", [id])).rows[0].source_snapshot;
    expect(snap.sections.map((s: { name: string }) => s.name)).toEqual(["Framing", "Flooring"]);
    expect(snap.sections[0].items[0]).toMatchObject({ name: "Wall framing", unit: "sq ft" });
    expect(JSON.stringify(snap)).not.toMatch(/unit_cost|12\.5|pricing|total/);
    await pool.query("update public.estimate_items set name = 'Changed' where id = $1", [b.i1]);
    expect((await get(solo, id)).snapshot.sections[0].items[0].name).toBe("Wall framing");
  });

  it("refuses sections that aren't in the estimate", async () => {
    const b = await bid(solo);
    const p = payload(b);
    p.tasks[1].sourceGroupId = "00000000-0000-4000-8000-000000000999";
    expect(await fails(create(solo, b, false, p))).toMatch(/unknown_source/);
  });

  it("saves edits with a revision check and history; line items once; complete needs a finish", async () => {
    const b = await bid(solo);
    const id = await create(solo, b);
    const s = await get(solo, id);
    const frame = s.tasks.find((t: { name: string }) => t.name === "Framing");
    const r2 = await save(solo, id, 1, {
      summary: "Scheduled 1 line item in Framing",
      tasks: [{ key: "new-1", kind: "item", parentId: frame.id, sourceGroupId: b.g1, sourceItemId: b.i1, name: "Wall framing", plannedStart: "2026-11-16", plannedEnd: "2026-11-17", durationDays: 2, percentComplete: 0, status: "not_started" }],
      changes: [{ id: "new-1", name: "Wall framing", from: null, to: { start: "2026-11-16", end: "2026-11-17" } }],
    });
    expect(r2).toBe(2);
    expect(await fails(save(solo, id, 1, { summary: "x" }))).toMatch(/stale_revision/);
    expect(await fails(save(solo, id, 2, { summary: "dup", tasks: [{ kind: "item", parentId: frame.id, sourceGroupId: b.g1, sourceItemId: b.i1, name: "Again", plannedStart: "2026-11-16", plannedEnd: "2026-11-16", durationDays: 1 }] }))).toMatch(/duplicate|unique/);
    const item = (await get(solo, id)).tasks.find((t: { kind: string }) => t.kind === "item");
    expect(await fails(save(solo, id, 2, { summary: "done", tasks: [{ ...camel(item), status: "complete", percentComplete: 100 }] }))).toMatch(/schedule_tasks_complete/);
    await save(solo, id, 2, { summary: "done", tasks: [{ ...camel(item), status: "complete", percentComplete: 100, actualStart: "2026-11-16", actualFinish: "2026-11-18" }] });
    const after = await get(solo, id);
    expect(after.tasks.find((t: { id: string }) => t.id === item.id)).toMatchObject({ status: "complete", planned_end: "2026-11-17", actual_finish: "2026-11-18" });
    expect(after.revisions.map((r: { revision: number }) => r.revision)).toEqual([3, 2, 1]);
    expect(await fails(save(solo, id, 3, { summary: "x", delete: [frame.id] }))).toMatch(/cannot_delete_section/);
  });

  it("no direct writes, other accounts can't see it, and losing the add-on leaves it read-only with data intact", async () => {
    const b = await bid(solo);
    const id = await create(solo, b);
    expect(await fails(asUser(pool, solo, (q) => q("update public.schedule_tasks set name = 'x' where schedule_id = $1", [id])))).toMatch(/permission denied/);
    expect(await fails(asUser(pool, solo, (q) => q("insert into public.project_schedules (estimate_id, user_id, name, source_snapshot, calendar, start_date) values ($1, $2, 'x', '{}', $3, now())", [b.id, solo, CAL])))).toMatch(/permission denied/);
    expect(await get(outsider, id)).toBeNull();
    expect(await fails(save(outsider, id, 1, { summary: "x" }))).toMatch(/forbidden/);

    await pool.query("update public.subscriptions set pm_addon = false, pm_addon_until = now() - interval '1 minute' where user_id = $1", [solo]);
    const ro = await get(solo, id);
    expect(ro.canEdit).toBe(false);
    expect(ro.tasks).toHaveLength(2);
    expect(await fails(save(solo, id, 1, { summary: "x" }))).toMatch(/forbidden/);
    await addon(solo, true);
  });

  it("Enterprise: the assigned editor edits company bids; view-only members can see but not edit", async () => {
    const b = await bid(est, "won", company);
    expect(await fails(create(est, b))).toMatch(/forbidden/);
    await asUser(pool, owner, (q) => q("select public.company_pm_assign($1, true)", [est]));
    const id = await create(est, b);
    expect((await get(est, id)).canEdit).toBe(true);
    const audit = await pool.query("select action from public.company_audit_log where company_id = $1 and action = 'schedule.created'", [company]);
    expect(audit.rows).toHaveLength(1);
    // A member who can't see the bid can't see its schedule; once allowed to see company bids, it's read-only.
    expect(await get(viewer, id)).toBeNull();
    await pool.query("update public.company_members set permissions_granted = '{view_company_bids}' where user_id = $1", [viewer]);
    const v = await get(viewer, id);
    expect(v.tasks).toHaveLength(2);
    expect(v.canEdit).toBe(false);
    expect(await fails(save(viewer, id, 1, { summary: "x" }))).toMatch(/forbidden/);
    expect(await fails(asUser(pool, viewer, (q) => q("select public.schedule_create($1, true, '{}')", [b.id])))).toMatch(/forbidden/);
    expect(await get(outsider, id)).toBeNull();
  });

  it("projects list reports duration-weighted progress", async () => {
    const b = await bid(solo);
    const id = await create(solo, b);
    const s = await get(solo, id);
    const [a, c] = s.tasks;
    await save(solo, id, 1, { summary: "progress", tasks: [{ ...camel(a), percentComplete: 50 }, { ...camel(c), percentComplete: 0 }] });
    const list = await asUser(pool, solo, (q) => q("select public.schedule_list() as l")).then((r) => r.rows[0].l);
    // Framing 4 days at 50%, flooring 3 days at 0% -> 2/7 = 29%
    expect(list.find((x: { id: string }) => x.id === id).progress).toBe(29);
  });
});

function camel(t: Record<string, unknown>) {
  return {
    id: t.id, kind: t.kind, sourceGroupId: t.source_group_id, sourceItemId: t.source_item_id, parentId: t.parent_id, name: t.name, sortOrder: t.sort_order,
    plannedStart: t.planned_start, plannedEnd: t.planned_end, durationDays: t.duration_days, actualStart: t.actual_start, actualFinish: t.actual_finish,
    percentComplete: t.percent_complete, status: t.status, weight: t.weight, assignee: t.assignee, notes: t.notes,
  };
}
