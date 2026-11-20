/**
 * V8.2 customer workforce GPS timekeeping (20270208001000), against the real SQL, with synthetic companies:
 *   - off by default; can't switch on without a confirmed location and the disclosure acknowledgment
 *   - only Staff the admin confirmed as W-2 can be enrolled (subcontractors / crews never), and nothing is stored
 *     until the employee accepts the disclosure
 *   - spec scenarios: HQ clock-in, jobsite clock-in, drive-by, inaccurate GPS, leaving (ask / auto), travel between
 *     two jobsites, permission denied, correction + approval, labor cost, tenant isolation, nothing deleted
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

d("GPS timekeeping for contractor crews (database)", () => {
  let owner: string, mgr: string, crewUser: string, crew2User: string, viewer: string, otherOwner: string, otherCrewUser: string;
  let company: string, otherCompany: string;
  let crew: string, crew2: string, sub: string, otherCrew: string;
  let hq: string, siteA: string, siteB: string, siteUnassigned: string, schedA: string, schedB: string, estA: string;
  const as = <T = Row>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows[0] as T);
  const val = <T = unknown>(u: string, sql: string, args: unknown[] = []) => as<{ v: T }>(u, `${sql} as v`, args).then((r) => r.v);
  const rows = (u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows);
  const ev = (u: string, resourceId: string, locationId: string, kind: string, minAgo: number, o: { acc?: number; dist?: number; confirmed?: boolean; src?: string; id?: string } = {}) =>
    val<Row>(u, "select public.pm_gps_event($1)", [{ resourceId, locationId, kind, occurredAt: ago(minAgo), accuracyM: o.acc ?? 12,
      distanceM: o.dist ?? (kind.startsWith("exit") ? 600 : 40), source: o.src ?? "browser", confirmed: o.confirmed ?? false, clientEventId: o.id }]);
  const openOf = (r: string) => pool.query("select * from public.pm_time_entries where resource_id = $1 and status = 'open'", [r]).then((x) => x.rows[0] as Row | undefined);
  const entriesOf = (r: string) => pool.query("select * from public.pm_time_entries where resource_id = $1 order by clock_in", [r]).then((x) => x.rows as Row[]);
  const resetTime = async (r: string) => {
    await pool.query("delete from public.pm_geofence_events where resource_id = $1", [r]);
    await pool.query("delete from public.pm_time_corrections where resource_id = $1", [r]);
    await pool.query("delete from public.pm_time_entries where resource_id = $1", [r]);
  };
  const saveSettings = (p: object) => val<Row>(owner, "select public.pm_gps_settings_save($1)", [p]);

  async function schedule(name: string, address: string) {
    const est = (await pool.query("insert into public.estimates (user_id, company_id, title, customer_name, project_address) values ($1, $2, $3, 'Pat', $4) returning id", [owner, company, name, address])).rows[0].id as string;
    const s = (await pool.query(`insert into public.project_schedules (estimate_id, user_id, company_id, name, status, source_snapshot, calendar, start_date)
      values ($1, $2, $3, $4, 'active', '{}'::jsonb, '{"workdays":[1,2,3,4,5],"holidays":[],"timezone":"America/Chicago"}'::jsonb, current_date) returning id`, [est, owner, company, name])).rows[0].id as string;
    return { est, s };
  }

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_gps_timekeeping"));
    owner = await createUser(pool, "owner@acme.dev");
    mgr = await createUser(pool, "mgr@acme.dev");
    crewUser = await createUser(pool, "crew@acme.dev");
    crew2User = await createUser(pool, "crew2@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    otherOwner = await createUser(pool, "boss@other.dev");
    otherCrewUser = await createUser(pool, "crew@other.dev");
    company = (await pool.query("select public.create_company($1, 'Acme Roofing') as id", [owner])).rows[0].id;
    otherCompany = (await pool.query("select public.create_company($1, 'Other Builders') as id", [otherOwner])).rows[0].id;
    await pool.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'manager', 'Mia'), ($1, $3, 'viewer', 'Cris'), ($1, $4, 'viewer', 'Dee'), ($1, $5, 'viewer', 'Val')",
      [company, mgr, crewUser, crew2User, viewer]);
    await pool.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'viewer', 'Oz')", [otherCompany, otherCrewUser]);
    await pool.query("insert into public.business_profiles (user_id, company_name, address) values ($1, 'Acme Roofing', '100 Main St, Minneapolis, MN 55401') on conflict (user_id) do update set address = excluded.address", [owner]);
    const res = (c: string, kind: string, name: string, link: string | null) => pool.query("insert into public.pm_resources (company_id, kind, name, linked_user_id) values ($1, $2, $3, $4) returning id", [c, kind, name, link]).then((r) => r.rows[0].id as string);
    crew = await res(company, "staff", "Cris", crewUser);
    crew2 = await res(company, "staff", "Dee", crew2User);
    sub = await res(company, "subcontractor", "Sparky Electric LLC", null);
    otherCrew = await res(otherCompany, "staff", "Oz", otherCrewUser);
    await pool.query("insert into public.pm_employee_profiles (resource_id, hourly_cost) values ($1, 30), ($2, 25)", [crew, crew2]);
    ({ est: estA, s: schedA } = await schedule("Smith roof", "12 Oak Ave, St Paul, MN"));
    ({ s: schedB } = await schedule("Jones siding", "88 Elm St, Edina, MN"));
  });
  afterAll(async () => { await drop?.(); });

  it("is off by default and can't be switched on until a location is confirmed and employees were told", async () => {
    const o = await val<Row>(owner, "select public.pm_gps_admin_overview()");
    expect(o.settings.enabled).toBe(false);
    expect(o.candidates.business).toBe("100 Main St, Minneapolis, MN 55401");
    expect(o.candidates.projects.map((p: Row) => p.name).sort()).toEqual(["Jones siding", "Smith roof"]);
    expect(o.employees.find((e: Row) => e.id === sub).kind).toBe("subcontractor");
    expect(await fails(saveSettings({ enabled: true, disclosureAck: true }))).toMatch(/location_required/);
    expect(await fails(saveSettings({ enabled: true }))).toMatch(/disclosure_required/);
    // A crew member, a viewer and another company can't change anything.
    expect(await fails(val(crewUser, "select public.pm_gps_settings_save($1)", [{ startRule: "any_time" }]))).toMatch(/forbidden/);
    expect(await fails(val(viewer, "select public.pm_gps_admin_overview()"))).toMatch(/forbidden/);
    expect(await fails(val(otherOwner, "select public.pm_work_location_save($1)", [{ kind: "project", name: "x", scheduleId: schedA }]))).toMatch(/bad_project/);
  });

  it("locations: business, project and other; radius capped at 0.2 mi; a moved pin needs confirming again", async () => {
    expect(await fails(val(owner, "select public.pm_work_location_save($1)", [{ kind: "business", name: "HQ", lat: 44.98, lng: -93.27, radiusM: 400 }]))).toMatch(/bad_radius|check/);
    hq = await val<string>(owner, "select public.pm_work_location_save($1)", [{ kind: "business", name: "Acme HQ", address: "100 Main St", lat: 44.98, lng: -93.27, pinSource: "census", confirm: true, everyone: true }]);
    expect(await fails(val(owner, "select public.pm_work_location_save($1)", [{ kind: "business", name: "Second HQ", lat: 44.9, lng: -93.2 }]))).toMatch(/duplicate|unique/);
    siteA = await val<string>(owner, "select public.pm_work_location_save($1)", [{ kind: "project", name: "Smith roof", scheduleId: schedA, lat: 44.95, lng: -93.1, radiusM: 161, confirm: true }]);
    siteB = await val<string>(owner, "select public.pm_work_location_save($1)", [{ kind: "project", name: "Jones siding", scheduleId: schedB, lat: 44.9, lng: -93.35, radiusM: 80, confirm: true }]);
    siteUnassigned = await val<string>(owner, "select public.pm_work_location_save($1)", [{ kind: "other", name: "Supplier yard", lat: 44.99, lng: -93.2, radiusM: 100, confirm: true }]);
    // Moving the pin clears the confirmation until the admin confirms again.
    await val(owner, "select public.pm_work_location_save($1)", [{ id: siteUnassigned, name: "Supplier yard", lat: 44.991, lng: -93.2, radiusM: 100 }]);
    expect((await pool.query("select confirmed_at from public.pm_work_locations where id = $1", [siteUnassigned])).rows[0].confirmed_at).toBeNull();
    await val(owner, "select public.pm_work_location_save($1)", [{ id: siteUnassigned, name: "Supplier yard", lat: 44.991, lng: -93.2, radiusM: 100, confirm: true }]);
    // Assignments: only staff in the same company.
    expect(await fails(val(owner, "select public.pm_work_location_assign($1, $2)", [siteA, [sub]]))).toMatch(/staff_only/);
    expect(await fails(val(owner, "select public.pm_work_location_assign($1, $2)", [siteA, [otherCrew]]))).toMatch(/staff_only/);
    expect(await val(owner, "select public.pm_work_location_assign($1, $2)", [siteA, [crew, crew2]])).toBe(2);
    expect(await val(owner, "select public.pm_work_location_assign($1, $2)", [siteB, [crew]])).toBe(1);
    // Other company sees nothing.
    expect(await rows(otherOwner, "select * from public.pm_work_locations")).toHaveLength(0);
    expect((await val<Row>(otherOwner, "select public.pm_gps_admin_overview()")).locations).toEqual([]);
    await saveSettings({ enabled: true, disclosureAck: true, startRule: "any_time" });
  });

  it("only staff confirmed as W-2 can be enrolled; subcontractors are excluded", async () => {
    expect(await fails(val(owner, "select public.pm_gps_enrollment_save($1, $2)", [sub, { enrolled: true, w2Confirmed: true }]))).toMatch(/staff_only/);
    expect(await fails(val(owner, "select public.pm_gps_enrollment_save($1, $2)", [crew, { enrolled: true }]))).toMatch(/w2_required/);
    expect(await fails(val(otherOwner, "select public.pm_gps_enrollment_save($1, $2)", [crew, { enrolled: true, w2Confirmed: true }]))).toMatch(/forbidden/);
    expect(await fails(val(crewUser, "select public.pm_gps_enrollment_save($1, $2)", [crew, { enrolled: true, w2Confirmed: true }]))).toMatch(/forbidden/);
    expect((await val<Row>(owner, "select public.pm_gps_enrollment_save($1, $2)", [crew, { enrolled: true, w2Confirmed: true }])).active).toBe(false);
    await val(owner, "select public.pm_gps_enrollment_save($1, $2)", [crew2, { enrolled: true, w2Confirmed: true }]);
  });

  it("nothing is recorded until the employee accepts the disclosure; withdrawing stops it", async () => {
    expect((await ev(crewUser, crew, hq, "enter", 5)).outcome).toBe("disabled");
    expect((await pool.query("select count(*)::int as n from public.pm_geofence_events")).rows[0].n).toBe(0);
    const st = await val<Row>(crewUser, "select public.pm_gps_my_status()");
    expect(st.me[0].locations).toEqual([]);
    expect(await fails(val(crewUser, "select public.pm_gps_consent($1, true, 99)", [crew]))).toMatch(/stale_disclosure/);
    expect(await fails(val(crew2User, "select public.pm_gps_consent($1, true, 1)", [crew]))).toMatch(/forbidden/);
    expect((await val<Row>(crewUser, "select public.pm_gps_consent($1, true, 1)", [crew])).active).toBe(true);
    await val(crew2User, "select public.pm_gps_consent($1, true, 1)", [crew2]);
    const st2 = await val<Row>(crewUser, "select public.pm_gps_my_status()");
    expect(st2.me[0].locations.map((l: Row) => l.name).sort()).toEqual(["Acme HQ", "Jones siding", "Smith roof"]);
    // Can't report an event for someone else.
    expect(await fails(ev(crewUser, crew2, hq, "enter", 1))).toMatch(/forbidden/);
    expect(await fails(ev(otherCrewUser, crew, hq, "enter", 1))).toMatch(/forbidden/);
  });

  it("1. clocks in at headquarters after the dwell time, from arrival, once", async () => {
    await ev(crewUser, crew, hq, "enter", 5);
    const r = await ev(crewUser, crew, hq, "dwell", 1);
    expect(r).toMatchObject({ outcome: "clocked_in", message: "Clocked in — Acme HQ" });
    const o = await openOf(crew);
    expect(o).toMatchObject({ source: "gps", location_id: hq, schedule_id: null });
    expect(Math.abs(new Date(o!.clock_in).getTime() - Date.parse(ago(5)))).toBeLessThan(5000);
    expect((await ev(crewUser, crew, hq, "dwell", 0)).outcome).toBe("ignored_duplicate");
    expect((await pool.query("select count(*)::int as n from public.pm_time_entries where resource_id = $1", [crew])).rows[0].n).toBe(1);
    // Events never hold coordinates.
    const cols = (await pool.query("select column_name from information_schema.columns where table_name = 'pm_geofence_events'")).rows.map((x) => x.column_name);
    expect(cols).not.toContain("lat");
    expect(cols).toContain("distance_m");
    await resetTime(crew);
  });

  it("2 + 5. clocks in at a jobsite, then moving to a second jobsite keeps travel time and one shift", async () => {
    await ev(crewUser, crew, siteA, "enter", 120);
    expect((await ev(crewUser, crew, siteA, "dwell", 116)).outcome).toBe("clocked_in");
    expect((await openOf(crew))!.schedule_id).toBe(schedA);
    await ev(crewUser, crew, siteA, "exit", 60);
    await ev(crewUser, crew, siteB, "enter", 35);
    const r = await ev(crewUser, crew, siteB, "dwell", 30);
    expect(r).toMatchObject({ outcome: "transferred", message: "Clocked in — Jones siding" });
    const list = await entriesOf(crew);
    expect(list.map((e) => [e.work_type, e.status, e.source])).toEqual([["regular", "pending", "gps"], ["travel", "pending", "travel"], ["regular", "open", "gps"]]);
    const [a, t, b] = list;
    expect(new Date(a.clock_out).getTime()).toBe(new Date(t.clock_in).getTime());
    expect(new Date(t.clock_out).getTime()).toBe(new Date(b.clock_in).getTime());
    expect(new Set(list.map((e) => e.shift_id)).size).toBe(1);
    expect(t.review_flag).toBe("travel");
    expect(b.schedule_id).toBe(schedB);
    // No overlapping shifts and only one open entry.
    expect((await pool.query("select count(*)::int as n from public.pm_time_entries where resource_id = $1 and status = 'open'", [crew])).rows[0].n).toBe(1);
    await resetTime(crew);
  });

  it("4. driving past a jobsite doesn't clock anyone in; an unassigned site is ignored", async () => {
    await ev(crewUser, crew, siteA, "enter", 3);
    await ev(crewUser, crew, siteA, "exit", 2.5);
    expect((await ev(crewUser, crew, siteA, "dwell", 0)).outcome).toBe("ignored_no_arrival");
    await ev(crewUser, crew, siteB, "enter", 1);
    expect((await ev(crewUser, crew, siteB, "dwell", 0)).outcome).toBe("ignored_no_arrival");
    expect((await ev(crewUser, crew, siteUnassigned, "enter", 10)).outcome).toBe("ignored_not_assigned");
    expect((await ev(crewUser, crew, siteUnassigned, "dwell", 0)).outcome).toBe("ignored_not_assigned");
    expect(await openOf(crew)).toBeUndefined();
    await resetTime(crew);
  });

  it("6. inaccurate GPS never clocks in or out", async () => {
    expect((await ev(crewUser, crew, hq, "enter", 10, { acc: 400 })).outcome).toBe("ignored_low_accuracy");
    expect((await ev(crewUser, crew, hq, "dwell", 0, { acc: 400 })).outcome).toBe("ignored_low_accuracy");
    await ev(crewUser, crew, hq, "enter", 10);
    await ev(crewUser, crew, hq, "dwell", 6);
    // Reported "outside" but the accuracy circle still overlaps the site: not a departure.
    expect((await ev(crewUser, crew, hq, "exit", 5, { dist: 350, acc: 80 })).outcome).toBe("ignored_low_accuracy");
    expect((await ev(crewUser, crew, hq, "exit_confirmed", 0, { dist: 350, acc: 80 })).outcome).toBe("ignored_low_accuracy");
    expect((await openOf(crew))?.away_since).toBeNull();
    await resetTime(crew);
  });

  it("3. leaving: ask mode keeps the shift open until the employee answers; auto mode clocks out and flags it", async () => {
    await ev(crewUser, crew, hq, "enter", 60);
    await ev(crewUser, crew, hq, "dwell", 55);
    await ev(crewUser, crew, hq, "exit", 30);
    expect((await ev(crewUser, crew, hq, "exit_confirmed", 25)).outcome).toBe("ignored_no_arrival"); // grace not over
    const asked = await ev(crewUser, crew, hq, "exit_confirmed", 15);
    expect(asked).toMatchObject({ outcome: "asked", prompt: "left_site" });
    const o = (await openOf(crew))!;
    expect(o.away_since).not.toBeNull();
    // Paid offsite work: still working.
    await val(crewUser, "select public.pm_gps_away_resolve($1, 'working', 'Picked up shingles')", [o.id]);
    expect((await openOf(crew))!.away_since).toBeNull();
    expect((await openOf(crew))!.note).toMatch(/Worked offsite.*shingles/);
    // Leaves again and says they're done: clocked out at the time they left.
    await ev(crewUser, crew, hq, "exit", 12);
    await ev(crewUser, crew, hq, "exit_confirmed", 1);
    expect(await fails(val(crew2User, "select public.pm_gps_away_resolve($1, 'clock_out')", [o.id]))).toMatch(/forbidden/);
    const done = await val<Row>(crewUser, "select public.pm_gps_away_resolve($1, 'clock_out')", [o.id]);
    expect(done.status).toBe("pending");
    expect(Math.abs(Date.parse(done.clockOut) - Date.parse(ago(12)))).toBeLessThan(5000);
    await resetTime(crew);

    // Auto clock-out, then arriving at another assigned site inside the travel window keeps the drive.
    await saveSettings({ exitAction: "auto" });
    await ev(crewUser, crew, siteA, "enter", 100);
    await ev(crewUser, crew, siteA, "dwell", 96);
    await ev(crewUser, crew, siteA, "exit", 50);
    const out = await ev(crewUser, crew, siteA, "exit_confirmed", 39);
    expect(out).toMatchObject({ outcome: "clocked_out", message: "Clocked out — Smith roof" });
    expect((await entriesOf(crew))[0].review_flag).toBe("auto_clock_out");
    await ev(crewUser, crew, siteB, "enter", 20);
    expect((await ev(crewUser, crew, siteB, "dwell", 16)).outcome).toBe("clocked_in");
    expect((await entriesOf(crew)).map((e) => e.work_type)).toEqual(["regular", "travel", "regular"]);
    await saveSettings({ exitAction: "ask" });
    await resetTime(crew);
  });

  it("outside work hours it asks first, and the employee can still start the shift", async () => {
    const isodow = Number((await pool.query("select extract(isodow from now() at time zone 'America/Chicago')::int as d")).rows[0].d);
    await saveSettings({ startRule: "schedule", workDays: [1, 2, 3, 4, 5, 6, 7].filter((x) => x !== isodow) });
    await ev(crewUser, crew, hq, "enter", 6);
    expect(await ev(crewUser, crew, hq, "dwell", 2)).toMatchObject({ outcome: "asked", prompt: "start_shift" });
    expect(await openOf(crew)).toBeUndefined();
    expect((await ev(crewUser, crew, hq, "dwell", 0, { confirmed: true })).outcome).toBe("confirmed");
    expect((await openOf(crew))!.source).toBe("gps_confirmed");
    await saveSettings({ startRule: "any_time", workDays: [1, 2, 3, 4, 5] });
    await resetTime(crew);
  });

  it("client event ids make retries safe (queued native events)", async () => {
    await ev(crewUser, crew, hq, "enter", 8, { id: "dev-1", src: "native_android" });
    const a = await ev(crewUser, crew, hq, "dwell", 4, { id: "dev-2", src: "native_android" });
    const b = await ev(crewUser, crew, hq, "dwell", 4, { id: "dev-2", src: "native_android" });
    expect(a.outcome).toBe("clocked_in");
    expect(b).toMatchObject({ outcome: "clocked_in", duplicate: true });
    expect((await pool.query("select count(*)::int as n from public.pm_time_entries where resource_id = $1", [crew])).rows[0].n).toBe(1);
    expect(await fails(ev(crewUser, crew, hq, "enter", 60 * 25))).toMatch(/bad_time/);
    await resetTime(crew);
  });

  it("7. denied location permission shows up as an exception, and manual clock-in still works", async () => {
    await val(crew2User, "select public.pm_gps_device_status($1, $2)", [crew2, { permission: "denied", appMode: "browser" }]);
    const x = await val<Row>(owner, "select public.pm_gps_exceptions()");
    expect(x.people.find((p: Row) => p.resourceId === crew2).permission).toBe("denied");
    expect(await fails(val(crewUser, "select public.pm_gps_exceptions()"))).toMatch(/forbidden/);
    const e = await val<Row>(crew2User, "select public.pm_clock_in($1)", [{ resourceId: crew2, locationId: siteA }]);
    expect(e).toMatchObject({ source: "clock", locationId: siteA, scheduleId: schedA });
    await val(crew2User, "select public.pm_clock_out($1)", [{ entryId: e.id, paidBreakMinutes: 15, breakMinutes: 30 }]);
    const audit = await rows(owner, "select action from public.pm_gps_audit where action = 'permission.change'");
    expect(audit.length).toBeGreaterThan(0);
    expect(await rows(crewUser, "select * from public.pm_gps_audit")).toHaveLength(0);
  });

  it("8 + 9. the employee asks for a correction; a manager approves it; the original punch is kept", async () => {
    const e = await val<Row>(crewUser, "select public.pm_clock_in($1)", [{ resourceId: crew }]);
    await val(crewUser, "select public.pm_clock_out($1)", [{ entryId: e.id }]);
    const start = ago(240), end = ago(10);
    expect(await fails(val(crewUser, "select public.pm_time_correction_request($1)", [{ resourceId: crew, entryId: e.id, clockIn: start, clockOut: end }]))).toMatch(/reason_required/);
    const k = await val<Row>(crewUser, "select public.pm_time_correction_request($1)", [{ resourceId: crew, entryId: e.id, clockIn: start, clockOut: end, reason: "Forgot to clock in when I got to the shop" }]);
    expect(k.status).toBe("pending");
    expect(await fails(val(crewUser, "select public.pm_time_correction_request($1)", [{ resourceId: crew, entryId: e.id, clockIn: start, clockOut: end, reason: "again" }]))).toMatch(/already_requested/);
    // Missing time for a day with no entry.
    const miss = await val<Row>(crewUser, "select public.pm_time_correction_request($1)", [{ resourceId: crew, clockIn: ago(60 * 22), clockOut: ago(60 * 20), reason: "Phone died", workType: "offsite" }]);
    expect(miss.kind).toBe("missing");
    expect(await fails(val(crewUser, "select public.pm_time_correction_decide($1, true)", [k.id]))).toMatch(/forbidden/);
    expect(await fails(val(otherOwner, "select public.pm_time_correction_decide($1, true)", [k.id]))).toMatch(/forbidden/);
    expect((await val<Row[]>(mgr, "select public.pm_time_corrections_list('pending')")).length).toBe(2);
    expect((await val<Row[]>(crew2User, "select public.pm_time_corrections_list('pending')")).length).toBe(0);
    const ok = await val<Row>(mgr, "select public.pm_time_correction_decide($1, true, 'Thanks')", [k.id]);
    expect(ok.status).toBe("approved");
    const fixed = (await pool.query("select * from public.pm_time_entries where id = $1", [e.id])).rows[0];
    expect(fixed.status).toBe("approved");
    expect(Math.abs(new Date(fixed.clock_in).getTime() - Date.parse(start))).toBeLessThan(1000);
    expect(new Date(fixed.original_clock_in).getTime()).toBe(new Date(e.clockIn).getTime());
    const hist = (await pool.query("select action, reason from public.pm_time_entry_changes where entry_id = $1 order by changed_at", [e.id])).rows;
    expect(hist.at(-1)).toMatchObject({ action: "correction", reason: "Employee correction: Forgot to clock in when I got to the shop" });
    expect(await fails(val(mgr, "select public.pm_time_correction_decide($1, false)", [miss.id]))).toMatch(/reason_required/);
    const added = await val<Row>(owner, "select public.pm_time_correction_decide($1, true)", [miss.id]);
    expect((await pool.query("select work_type, source, status from public.pm_time_entries where id = $1", [added.entryId])).rows[0]).toEqual({ work_type: "offsite", source: "correction", status: "approved" });
  });

  it("15. GPS never removes recorded time; retention removes only old geofence events", async () => {
    const before = (await pool.query("select count(*)::int as n from public.pm_time_entries")).rows[0].n;
    await pool.query("update public.pm_geofence_events set recorded_at = now() - interval '200 days'");
    await ev(crewUser, crew, hq, "enter", 1);
    expect((await pool.query("select count(*)::int as n from public.pm_geofence_events where recorded_at < now() - interval '100 days'")).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int as n from public.pm_time_entries")).rows[0].n).toBe(before);
  });

  it("11. Company B can't read Company A's employees, time, events, corrections or locations", async () => {
    for (const t of ["pm_work_locations", "pm_work_location_assignments", "pm_gps_enrollments", "pm_geofence_events", "pm_time_corrections", "pm_time_entries", "pm_gps_audit", "pm_gps_settings"]) {
      expect(await rows(otherOwner, `select * from public.${t}`), t).toHaveLength(0);
      expect(await rows(otherCrewUser, `select * from public.${t}`), t).toHaveLength(0);
    }
    expect(await val(otherOwner, "select public.pm_gps_events_list($1)", [crew])).toEqual([]);
    expect((await val<Row>(otherOwner, "select public.pm_timesheet(now() - interval '30 days', now() + interval '1 day')")).entries).toEqual([]);
    // A coworker sees only their own events.
    expect((await val<Row[]>(crew2User, "select public.pm_gps_events_list($1)", [crew]))).toEqual([]);
    expect((await val<Row[]>(crewUser, "select public.pm_gps_events_list($1)", [crew])).length).toBeGreaterThan(0);
    // Location events: owner and named supervisors only (a manager without the supervisor role doesn't see them).
    expect(await rows(mgr, "select * from public.pm_geofence_events")).toHaveLength(0);
    await val(owner, "select public.pm_time_supervisor_set($1, 'supervisor')", [mgr]);
    expect((await rows(mgr, "select * from public.pm_geofence_events")).length).toBeGreaterThan(0);
    expect(await fails(val(mgr, "select public.pm_gps_settings_save($1)", [{ startRule: "schedule" }]))).toMatch(/forbidden/);
    expect(await fails(val(mgr, "select public.pm_time_supervisor_set($1, 'admin')", [mgr]))).toMatch(/forbidden/);
  });

  it("12. project labor: estimated vs actual hours and cost; wages hidden from people who can't see pay", async () => {
    const g = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name) values ($1, $2, 'Roof') returning id", [estA, owner])).rows[0].id;
    await pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, cost_type, quantity, unit, unit_cost) values ($1, $2, $3, 'Tear-off labor', 'labor', 16, 'hours', 30), ($1, $2, $3, 'Shingles', 'material', 30, 'sq', 120), ($1, $2, $3, 'Cleanup', 'labor', 1, 'lump sum', 200)", [estA, g, owner]);
    await resetTime(crew);
    const add = (resource: string, h0: number, h1: number) => pool.query("insert into public.pm_time_entries (company_id, resource_id, schedule_id, clock_in, clock_out, status, source) values ($1, $2, $3, now() - make_interval(hours => $4), now() - make_interval(hours => $5), 'approved', 'gps')", [company, resource, schedA, h0, h1]);
    await add(crew, 30, 20); // 10 h x $30
    await add(crew2, 30, 22); // 8 h x $25
    const l = await val<Row>(owner, "select public.pm_project_labor($1)", [schedA]);
    expect(Number(l.estimatedHours)).toBe(16);
    expect(Number(l.estimatedCost)).toBe(680);
    expect(Number(l.approvedHours)).toBeCloseTo(18 + 0, 0);
    expect(Number(l.actualCost)).toBeCloseTo(300 + 200, 0);
    const v = await val<Row>(viewer, "select public.pm_project_labor($1)", [schedA]);
    expect(v.canSeeCost).toBe(false);
    expect(v.actualCost).toBeNull();
    expect(v.estimatedCost).toBeNull();
    expect(await fails(val(otherOwner, "select public.pm_project_labor($1)", [schedA]))).toMatch(/forbidden/);
  });

  it("10. subcontractors stay out of GPS time tracking and the old time clock", async () => {
    expect(await fails(val(owner, "select public.pm_clock_in($1)", [{ resourceId: sub }]))).toMatch(/forbidden/);
    expect((await pool.query("select count(*)::int as n from public.pm_gps_enrollments where resource_id = $1", [sub])).rows[0].n).toBe(0);
  });

  it("rollback removes everything and restores the original time clock", async () => {
    await pool.query(readFileSync("docs/worker-hub/rollback_20270210001000.sql", "utf8"));
    await pool.query(readFileSync("docs/workforce-gps/rollback_20270208001000.sql", "utf8"));
    const left = (await pool.query("select table_name from information_schema.tables where table_name in ('pm_work_locations','pm_geofence_events','pm_gps_settings','pm_time_corrections','pm_gps_enrollments','pm_time_supervisors','pm_gps_audit','pm_timesheet_signoffs','pm_work_location_assignments')")).rows;
    expect(left).toEqual([]);
    const cols = (await pool.query("select column_name from information_schema.columns where table_name = 'pm_time_entries' and column_name in ('location_id','work_type','away_since')")).rows;
    expect(cols).toEqual([]);
    const e = await val<Row>(crewUser, "select public.pm_clock_in($1)", [{ resourceId: crew }]);
    expect(e.source).toBe("clock");
    await val(crewUser, "select public.pm_clock_out($1)", [{ entryId: e.id }]);
    const ts = await val<Row>(owner, "select public.pm_timesheet(now() - interval '30 days', now() + interval '1 day')");
    expect(ts.entries.length).toBeGreaterThan(0);
    await pool.query(readFileSync("supabase/migrations/20270208001000_gps_timekeeping.sql", "utf8"));
  });
});
