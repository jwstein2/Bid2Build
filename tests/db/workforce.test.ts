/**
 * V7.3 Contractors & Workforce, against the real SQL:
 *   - subcontracting companies hold workers (same directory only, one level, never an individual's workers)
 *   - pm_assign_resource writes the ONE assignment record (schedule_tasks) that PM Hub reads; section
 *     inheritance matches schedule_assign; duplicate clicks are no-ops; same-project double adds need a yes
 *   - conflicts: a person on two jobs at once, unavailable days, crew capacity, company capacity only when
 *     stated ("unknown" otherwise); times of day that don't overlap aren't a conflict; cancelled doesn't count
 *   - override needs a reason and edit-all rights, and is audited; PM Hub changes are audited too
 *   - pm_workforce: cross-company isolation, RLS on projects, staff contact privacy
 *   - no logins, invitations or seats are created; rollback + re-apply
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);
type Row = Record<string, unknown>;

d("Contractors & Workforce (database)", () => {
  let owner: string, est: string, viewer: string, otherOwner: string, company: string, otherCompany: string;
  const as = <T = Row>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows[0] as T);
  const sub = (u: string, plan: string, companyId: string | null, seats: number | null) =>
    pool.query(
      `select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_' || $1, p_stripe_subscription_id => 'sub_' || $1,
        p_status => 'active', p_plan => $2, p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
        p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => $3::uuid, p_seat_quantity => $4)`,
      [u, plan, companyId, seats],
    );
  const saveRes = (u: string, p: object) => as<{ id: string }>(u, "select public.pm_resource_save($1) as id", [p]).then((r) => r.id);
  const assignR = (u: string, p: object) => as<{ r: Row }>(u, "select public.pm_assign_resource($1) as r", [p]).then((r) => r.r as Row & { conflicts: Row[] });
  const wf = (u: string) => as<{ w: { canManage: boolean; resources: Row[]; assignments: Row[] } }>(u, "select public.pm_workforce() as w").then((r) => r.w);
  const tasks = async (sid: string) => (await pool.query("select * from public.schedule_tasks where schedule_id = $1 order by sort_order, kind desc, name", [sid])).rows as Row[];
  const rev = async (sid: string) => (await pool.query("select revision from public.project_schedules where id = $1", [sid])).rows[0].revision as number;
  const counts = async () => (await pool.query("select (select count(*) from auth.users)::int as users, (select count(*) from public.company_members)::int as members, (select coalesce(sum(seat_quantity), 0) from public.subscriptions)::int as seats")).rows[0];

  async function schedule(u: string, companyId: string | null, start = "2026-11-16", end = "2026-11-19", name = "Job") {
    const id = (await pool.query("insert into public.estimates (user_id, company_id, title, customer_name, trades) values ($1, $2, $3, 'Pat', '{electrical}') returning id", [u, companyId, name])).rows[0].id as string;
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("select set_config('app.stage_change', 'on', true)");
      await c.query("update public.estimates set pipeline_stage = 'won' where id = $1", [id]); await c.query("commit");
    } finally { c.release(); }
    const g = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Electrical', 0) returning id", [id, u])).rows[0].id as string;
    const i1 = (await pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, quantity, unit, unit_cost, sort_order) values ($1, $2, $3, 'Rough-in', 1, 'ea', 1, 0) returning id", [id, g, u])).rows[0].id as string;
    const p = { name, calendar: CAL, startDate: start, deps: [], tasks: [
      { key: "s", kind: "section", sourceGroupId: g, name: "Electrical", plannedStart: start, plannedEnd: end, durationDays: 4, sortOrder: 0 },
      { key: "a", kind: "item", parentKey: "s", sourceGroupId: g, sourceItemId: i1, name: "Rough-in", plannedStart: start, plannedEnd: end, durationDays: 4, sortOrder: 1 },
    ] };
    return as<{ id: string }>(u, "select public.schedule_create($1, false, $2) as id", [id, p]).then((r) => r.id);
  }

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_workforce"));
    owner = await createUser(pool, "owner@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    otherOwner = await createUser(pool, "boss@other.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    otherCompany = (await pool.query("select public.create_company($1, 'Other') as id", [otherOwner])).rows[0].id;
    await pool.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'estimator', 'Erin'), ($1, $3, 'viewer', 'Val')", [company, est, viewer]);
    await sub(owner, "enterprise", company, 5);
    await sub(otherOwner, "enterprise", otherCompany, 3);
    await pool.query("select public.apply_pm_update('sub_' || $1, false, 2, now())", [owner]);
    await as(owner, "select public.company_pm_assign($1, true)", [est]);
    await as(owner, "select public.company_pm_assign($1, true)", [owner]);
    await as(otherOwner, "select public.company_pm_assign($1, true)", [otherOwner]);
  });
  afterAll(async () => { await drop?.(); });

  it("a subcontracting company holds its workers; links stay inside one directory and one level deep", async () => {
    const before = await counts();
    const reds = await saveRes(owner, { kind: "subcontractor", entity: "company", name: "Red's Electric", trades: ["Electrical", "low voltage"], specialties: ["Panel upgrades"] });
    const a = await saveRes(owner, { kind: "subcontractor", parentId: reds, name: "Electrician A", trades: ["electrical"] });
    await saveRes(owner, { kind: "subcontractor", parentId: reds, name: "Electrician B", trades: ["electrical"] });
    const w = (await wf(owner)).resources;
    const ra = w.find((r) => r.id === a)!;
    expect(ra.parentId).toBe(reds);
    expect(ra.entity).toBe("individual");
    const rc = w.find((r) => r.id === reds)!;
    expect(rc.trades).toEqual(["electrical", "low voltage"]); // primary trade stays first
    expect(rc.specialties).toEqual(["Panel upgrades"]);
    expect(rc.capacityDeclared).toBe(false);
    // An individual can't have workers, a worker can't have workers, another company's entry can't be a parent.
    expect(await fails(saveRes(owner, { kind: "subcontractor", parentId: a, name: "Nested" }))).toMatch(/bad_parent/);
    expect(await fails(saveRes(owner, { id: reds, kind: "subcontractor", entity: "individual", name: "Red's Electric" }))).toMatch(/has_workers/);
    const theirs = await saveRes(otherOwner, { kind: "subcontractor", entity: "company", name: "Their Electric" });
    expect(await fails(saveRes(owner, { kind: "subcontractor", parentId: theirs, name: "Sneaky" }))).toMatch(/bad_parent/);
    // Only directory rows: no login, no member, no seat.
    expect(await counts()).toEqual(before);
  });

  it("assigning from the directory writes the PM Hub task assignment, with section inheritance and one revision", async () => {
    const sid = await schedule(est, company);
    const [sec, item] = await tasks(sid);
    const crew = await saveRes(owner, { kind: "crew", name: "Concrete Crew 1", trades: ["concrete"] });
    const r0 = await rev(sid);
    const out = await assignR(est, { taskId: sec.id, resourceId: crew, status: "confirmed", notes: "Bring the mixer", hours: 24, startTime: "07:00", endTime: "15:30", baseRevision: r0 });
    expect(out.ok).toBe(true);
    expect(out.revision).toBe(r0 + 1);
    const t = await tasks(sid);
    expect(t.map((x) => x.resource_id)).toEqual([crew, crew]);
    expect(t[1].assignment_inherited).toBe(true);
    expect(t[0].assignee).toBe("Concrete Crew 1");
    expect(t[0].assignment_notes).toBe("Bring the mixer");
    expect(Number(t[0].assignment_hours)).toBe(24);
    expect(t[0].assignment_confirmed_by).toBe(est);
    // PM Hub's own read sees it (same row).
    const a = await as<{ a: Row[] }>(est, "select public.pm_task_assignments('2026-11-01', '2026-12-31') as a");
    expect(a.a.find((x) => x.id === sec.id)!.resourceId).toBe(crew);
    // The directory shows the section once, not once per inherited task.
    const mine = (await wf(est)).assignments.filter((x) => x.resourceId === crew);
    expect(mine.map((x) => x.taskId)).toEqual([sec.id]);
    expect(mine[0].project).toBe("Job");
    // Same click again: nothing changes.
    const again = await assignR(est, { taskId: sec.id, resourceId: crew, status: "confirmed", notes: "Bring the mixer", hours: 24, startTime: "07:00", endTime: "15:30" });
    expect(again.duplicate).toBe(true);
    expect(await rev(sid)).toBe(r0 + 1);
    // Stale revision and bad input are refused.
    expect(await fails(assignR(est, { taskId: item.id, resourceId: crew, baseRevision: r0 }))).toMatch(/stale_revision/);
    expect(await fails(assignR(est, { taskId: item.id, resourceId: crew, startTime: "15:00", endTime: "09:00" }))).toMatch(/bad_times/);
  });

  it("a person on two jobs at once is a conflict; overriding needs a reason and edit-all rights, and is audited", async () => {
    const jo = await saveRes(owner, { kind: "staff", name: "Jo Electrician", trades: ["electrical"] });
    const s1 = await schedule(est, company, "2026-12-07", "2026-12-10", "Maple St");
    const s2 = await schedule(est, company, "2026-12-09", "2026-12-11", "Oak Ave");
    const s3 = await schedule(est, company, "2026-12-14", "2026-12-15", "Pine Rd");
    const [a1] = await tasks(s1); const [a2] = await tasks(s2); const [a3] = await tasks(s3);
    expect((await assignR(est, { taskId: a1.id, resourceId: jo })).ok).toBe(true);
    // No overlap: fine.
    expect((await assignR(est, { taskId: a3.id, resourceId: jo })).conflicts).toEqual([]);
    // Overlap: preview shows it, the write is refused without a reason, nothing changes.
    const dry = await assignR(est, { taskId: a2.id, resourceId: jo, dryRun: true });
    expect(dry.needsOverride).toBe(true);
    expect(dry.canOverride).toBe(false); // estimator: edit assigned schedules only
    expect(dry.conflicts[0].kind).toBe("double_booked");
    expect((dry.conflicts[0].tasks as Row[])[0].project).toBe("Maple St");
    const refused = await assignR(est, { taskId: a2.id, resourceId: jo });
    expect(refused.ok).toBe(false);
    expect((await tasks(s2))[0].resource_id).toBeNull();
    expect(await fails(assignR(est, { taskId: a2.id, resourceId: jo, overrideReason: "Half day each" }))).toMatch(/override_forbidden/);
    // Owner overrides with a reason: saved, and the audit row keeps the reason and the conflict.
    const ok = await assignR(owner, { taskId: a2.id, resourceId: jo, overrideReason: "Half day at each site" });
    expect(ok.ok).toBe(true);
    expect(ok.overridden).toBe(true);
    const ev = (await pool.query("select * from public.pm_assignment_events where task_id = $1 order by id desc limit 1", [a2.id])).rows[0];
    expect(ev.source).toBe("directory");
    expect(ev.override_reason).toBe("Half day at each site");
    expect(ev.conflicts[0].kind).toBe("double_booked");
    expect(ev.actor_id).toBe(owner);
    // Each overlapping pair is reported once (no duplicate warnings for the section and its task).
    const again = await assignR(owner, { taskId: a2.id, resourceId: jo, status: "requested", dryRun: true });
    expect(again.conflicts.filter((c) => c.kind === "double_booked")).toHaveLength(1);
    expect((again.conflicts[0].tasks as Row[])).toHaveLength(1);
  });

  it("times of day that don't overlap aren't a conflict; cancelled bookings and unavailable days are handled", async () => {
    const kim = await saveRes(owner, { kind: "subcontractor", entity: "individual", name: "Kim Painter", trades: ["painting"], unavailable: ["2027-01-06"] });
    const s1 = await schedule(est, company, "2027-01-04", "2027-01-04", "AM job");
    const s2 = await schedule(est, company, "2027-01-04", "2027-01-04", "PM job");
    const s3 = await schedule(est, company, "2027-01-05", "2027-01-06", "Wed job");
    const [a1] = await tasks(s1); const [a2] = await tasks(s2); const [a3] = await tasks(s3);
    await assignR(est, { taskId: a1.id, resourceId: kim, startTime: "07:00", endTime: "11:00" });
    expect((await assignR(est, { taskId: a2.id, resourceId: kim, startTime: "12:00", endTime: "16:00", dryRun: true })).conflicts).toEqual([]);
    expect((await assignR(est, { taskId: a2.id, resourceId: kim, startTime: "10:00", endTime: "16:00", dryRun: true })).needsOverride).toBe(true);
    // Cancel the morning job: it no longer blocks.
    await assignR(est, { taskId: a1.id, resourceId: kim, status: "cancelled", startTime: "07:00", endTime: "11:00" });
    expect((await assignR(est, { taskId: a2.id, resourceId: kim, startTime: "10:00", endTime: "16:00", dryRun: true })).conflicts).toEqual([]);
    const un = await assignR(est, { taskId: a3.id, resourceId: kim, dryRun: true });
    expect(un.conflicts.map((c) => c.kind)).toEqual(["unavailable"]);
    expect(un.conflicts[0].days).toEqual(["2027-01-06"]);
  });

  it("company capacity: unknown until stated, then concurrent jobs beyond it are flagged; workers count toward it", async () => {
    const co = await saveRes(owner, { kind: "subcontractor", entity: "company", name: "Bright Painting", trades: ["painting"] });
    const worker = await saveRes(owner, { kind: "subcontractor", parentId: co, name: "Painter One" });
    const s1 = await schedule(est, company, "2027-02-01", "2027-02-05", "P1");
    const s2 = await schedule(est, company, "2027-02-02", "2027-02-04", "P2");
    const s3 = await schedule(est, company, "2027-02-03", "2027-02-03", "P3");
    const [a1] = await tasks(s1); const [a2] = await tasks(s2); const [a3] = await tasks(s3);
    await assignR(est, { taskId: a1.id, resourceId: worker });
    // Another job for the company while its worker is busy: information only (capacity unknown).
    const info = await assignR(est, { taskId: a2.id, resourceId: co, dryRun: true });
    expect(info.needsOverride).toBe(false);
    expect(info.conflicts.map((c) => c.kind)).toEqual(["capacity_unknown"]);
    expect(info.conflicts[0].jobs).toBe(1);
    expect((await assignR(est, { taskId: a2.id, resourceId: co })).ok).toBe(true);
    // State capacity 2: a third concurrent job is a possible overbooking.
    // The V4.2 form always sends capacity 1: that alone doesn't make it "stated".
    await saveRes(owner, { id: co, kind: "subcontractor", name: "Bright Painting", trades: ["painting"], capacity: 1 });
    expect((await assignR(est, { taskId: a3.id, resourceId: co, dryRun: true })).needsOverride).toBe(false);
    await saveRes(owner, { id: co, kind: "subcontractor", name: "Bright Painting", trades: ["painting"], capacity: 2, capacityDeclared: true });
    const over = await assignR(est, { taskId: a3.id, resourceId: co, dryRun: true });
    expect(over.conflicts.map((c) => c.kind)).toEqual(["possible_overbooking"]);
    expect(over.needsOverride).toBe(true);
  });

  it("crews: stated capacity and their members' other bookings", async () => {
    const pat = await saveRes(owner, { kind: "staff", name: "Pat Finisher" });
    const crew = await saveRes(owner, { kind: "crew", name: "Flatwork Crew", members: [pat] });
    const s1 = await schedule(est, company, "2027-03-01", "2027-03-03", "Driveway");
    const s2 = await schedule(est, company, "2027-03-02", "2027-03-02", "Patio");
    const [a1] = await tasks(s1); const [a2] = await tasks(s2);
    await assignR(est, { taskId: a1.id, resourceId: pat });
    const c = await assignR(est, { taskId: a2.id, resourceId: crew, dryRun: true });
    expect(c.conflicts.map((x) => x.kind)).toEqual(["double_booked"]);
    expect(c.conflicts[0].resource).toBe("Pat Finisher");
  });

  it("same person twice on one project needs a yes; PM Hub assignment changes are audited too", async () => {
    const lee = await saveRes(owner, { kind: "staff", name: "Lee" });
    const sid = await schedule(est, company, "2027-04-05", "2027-04-08", "Twice");
    const [sec, item] = await tasks(sid);
    await assignR(est, { taskId: item.id, resourceId: lee });
    // Section vs its own task is the same work, not a duplicate.
    const secAssign = await assignR(est, { taskId: sec.id, resourceId: lee, dryRun: true });
    expect(secAssign.alreadyOnProject).toEqual([]);
    // PM Hub (schedule_assign) clears it: logged as a pm_hub event.
    await as(est, "select public.schedule_assign($1, $2, $3)", [sid, await rev(sid), JSON.stringify([{ taskId: item.id, resourceId: null }])]);
    const ev = (await pool.query("select action, source from public.pm_assignment_events where task_id = $1 order by id desc limit 1", [item.id])).rows[0];
    expect(ev).toEqual({ action: "cleared", source: "pm_hub" });
    // History follows project access: readable by the owner, not by another company.
    const h = await as<{ h: Row[] }>(owner, "select public.pm_resource_history($1) as h", [lee]);
    expect(h.h.map((x) => x.action)).toEqual(["cleared", "assigned"]);
    expect((await as<{ h: Row[] }>(otherOwner, "select public.pm_resource_history($1) as h", [lee])).h).toEqual([]);
  });

  it("isolation and privacy: other companies see nothing; staff contacts only for managers or the person", async () => {
    const staff = await saveRes(owner, { kind: "staff", name: "Private Pat", email: "pat@home.test", phone: "555-0199", notes: "Gate code 1234" });
    const subco = await saveRes(owner, { kind: "subcontractor", entity: "company", name: "Public Sub", email: "office@sub.test" });
    const other = await wf(otherOwner);
    expect(other.resources.some((r) => r.id === staff || r.id === subco)).toBe(false);
    expect(other.assignments.some((a) => a.project === "Job")).toBe(false);
    const v = await wf(viewer);
    expect(v.canManage).toBe(false);
    const ps = v.resources.find((r) => r.id === staff)!;
    expect(ps.email).toBeNull();
    expect(ps.phone).toBeNull();
    expect(ps.contactHidden).toBe(true);
    expect(ps.notes).toBeNull();
    expect(v.resources.find((r) => r.id === subco)!.email).toBe("office@sub.test");
    const o = (await wf(owner)).resources.find((r) => r.id === staff)!;
    expect(o.email).toBe("pat@home.test");
    // Viewers can't assign; other companies can't assign onto our projects or use our people.
    const sid = await schedule(est, company, "2027-05-03", "2027-05-04", "Locked");
    const [sec] = await tasks(sid);
    expect(await fails(assignR(viewer, { taskId: sec.id, resourceId: subco }))).toMatch(/forbidden/);
    expect(await fails(assignR(otherOwner, { taskId: sec.id, resourceId: subco }))).toMatch(/forbidden/);
    const theirSid = await schedule(otherOwner, otherCompany, "2027-05-03", "2027-05-04", "Theirs");
    const [theirSec] = await tasks(theirSid);
    expect(await fails(assignR(otherOwner, { taskId: theirSec.id, resourceId: subco }))).toMatch(/bad_resource/);
    // The conflict helper isn't callable directly.
    expect(await fails(as(viewer, "select public.pm_resource_conflicts($1, $2, null, '2027-01-01', '2027-01-02')", [subco, sid]))).toMatch(/permission denied/);
    // Targets: only projects the caller can see.
    const tg = await as<{ t: Row[] }>(otherOwner, "select public.pm_assign_targets() as t");
    expect(tg.t.map((x) => x.name)).toEqual(["Theirs"]);
  });

  it("rollback keeps entries and assignments, and the migration re-applies", async () => {
    const n = (await pool.query("select count(*)::int as n from public.pm_resources")).rows[0].n;
    const assigned = (await pool.query("select count(*)::int as n from public.schedule_tasks where resource_id is not null")).rows[0].n;
    await pool.query(readFileSync("docs/workforce/rollback_20270102005000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.pm_assignment_events') as t")).rows[0].t).toBeNull();
    expect((await pool.query("select count(*)::int as n from public.pm_resources")).rows[0].n).toBe(n);
    expect((await pool.query("select count(*)::int as n from public.schedule_tasks where resource_id is not null")).rows[0].n).toBe(assigned);
    expect((await pool.query("select count(*)::int as n from public.schedule_tasks where assignment_status = 'cancelled'")).rows[0].n).toBe(0);
    // V4.2 save still works after rollback.
    await saveRes(owner, { kind: "staff", name: "After rollback" });
    await applyMigration(pool, "20270102005000_workforce_directory.sql");
    await applyMigration(pool, "20270102005000_workforce_directory.sql");
    expect((await pool.query("select to_regclass('public.pm_assignment_events') as t")).rows[0].t).not.toBeNull();
  });
});
