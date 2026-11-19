import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
// Monday 2026-11-23, 08:00 Chicago = 14:00Z. Slots from 9:00 CT (15:00Z).
const NOW = "2026-11-23T14:00:00Z";
const slots = async (slug: string, extra = "[]", now = NOW) =>
  (await pool.query("select starts_at from public.sales_booking_slots($1, $2, $3::jsonb)", [slug, now, extra])).rows.map((r) => (r.starts_at as Date).toISOString());
const book = (slug: string, start: string, email = "pat@roof.test", token = `t-${Math.random()}`, extra = "[]") =>
  pool.query("select public.sales_booking_create($1, 'win', $2, 'Pat Roofer', $3, 'Pat Roofing', 'Wants estimates help', $4, $5::jsonb, $6) b", [slug, start, email, token, extra, NOW]);

d("sales hub V8.4 P2 calendar, time off and client scheduling (database)", () => {
  let owner: string, ritaU: string, samU: string, rita: string, sam: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_v84_cal"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    const member = async (email: string, name: string) =>
      (await q1("select public.admin_sales_member_save($1, null, $2, $3, null, 'rep', 'active', null, true) r", [owner, email, name])).r.id as string;
    rita = await member("rita@sales.com", "Rita Rep");
    sam = await member("sam@sales.com", "Sam Seller");
    ritaU = await createUser(pool, "rita@sales.com");
    samU = await createUser(pool, "sam@sales.com");
    for (const u of [ritaU, samU]) await asUser(pool, u, (q) => q("select public.sales_me()"));
    const save = (u: string, slug: string) => asUser(pool, u, (q) => q("select public.sales_my_calendar_settings_save('America/Chicago', $1, true, 30, 0, 0, 14, '[{\"d\":1,\"s\":\"09:00\",\"e\":\"11:00\"}]', 'https://meet.example.test/rita')", [slug]));
    await save(ritaU, "rita");
    await save(samU, "sam");
  });
  afterAll(async () => { await drop?.(); });

  it("validates settings and keeps booking slugs unique", async () => {
    await expect(asUser(pool, samU, (q) => q("select public.sales_my_calendar_settings_save('Mars/Base', 'x1', false, 30, 0, 0, 14, '[]', null)"))).rejects.toThrow(/invalid_time_zone/);
    await expect(asUser(pool, samU, (q) => q("select public.sales_my_calendar_settings_save('America/Chicago', 'x1', false, 30, 0, 0, 14, '[{\"d\":8,\"s\":\"09:00\",\"e\":\"10:00\"}]', null)"))).rejects.toThrow(/invalid_hours/);
    await expect(asUser(pool, samU, (q) => q("select public.sales_my_calendar_settings_save('America/Chicago', 'rita', true, 30, 0, 0, 14, '[]', null)"))).rejects.toThrow(/slug_taken/);
    await expect(asUser(pool, samU, (q) => q("select public.sales_my_calendar_settings_save('America/Chicago', 'Bad Slug!', true, 30, 0, 0, 14, '[]', null)"))).rejects.toThrow(/check constraint/);
  });

  it("builds slots from weekly hours in the rep's zone", async () => {
    const s = await slots("rita");
    // Monday 9-11 CT = 15:00-17:00Z, 30-minute slots; next Monday too (14 days ahead).
    expect(s.slice(0, 4)).toEqual(["2026-11-23T15:00:00.000Z", "2026-11-23T15:30:00.000Z", "2026-11-23T16:00:00.000Z", "2026-11-23T16:30:00.000Z"]);
    expect(s).toHaveLength(12); // 3 Mondays (23rd, 30th, Dec 7th) x 4
    expect(await val("select public.sales_booking_page('RITA')")).toMatchObject({ first_name: "Rita", session_minutes: 30, enabled: true });
  });

  it("blocks slots with events, Google busy times and the notice window", async () => {
    await asUser(pool, ritaU, (q) => q("select public.sales_my_event_save(null, 'personal', 'Dentist', 'private', '2026-11-23T15:00:00Z', '2026-11-23T15:30:00Z', false, null)"));
    const s = await slots("rita", JSON.stringify([{ start: "2026-11-23T16:00:00Z", end: "2026-11-23T16:30:00Z" }]));
    expect(s.slice(0, 2)).toEqual(["2026-11-23T15:30:00.000Z", "2026-11-23T16:30:00.000Z"]);
  });

  it("books a slot once and never double-books", async () => {
    const b = (await book("rita", "2026-11-23T15:30:00Z", "pat@roof.test", "tok-1")).rows[0].b;
    expect(b).toMatchObject({ session: "win", rep_name: "Rita Rep", meeting_link: "https://meet.example.test/rita" });
    await expect(book("rita", "2026-11-23T15:30:00Z", "other@roof.test")).rejects.toThrow(/slot_taken/);
    await expect(book("rita", "2026-11-23T15:45:00Z")).rejects.toThrow(/slot_taken/); // not a slot boundary
    await expect(book("rita", "2026-11-23T16:00:00Z", "x@roof.test", "t2", JSON.stringify([{ start: "2026-11-23T16:00:00Z", end: "2026-11-23T16:30:00Z" }]))).rejects.toThrow(/slot_taken/);
    await expect(pool.query("select public.sales_booking_create('rita', 'win', '2026-11-30T15:00:00Z', 'X', 'not-an-email', null, null, 'tx', '[]', $1)", [NOW])).rejects.toThrow(/invalid_contact/);
    // Two at once: only one wins.
    const both = await Promise.allSettled([book("rita", "2026-11-23T16:30:00Z", "a@x.test"), book("rita", "2026-11-23T16:30:00Z", "b@x.test")]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("lets the customer reschedule and cancel with their private link", async () => {
    expect(await val("select public.sales_booking_by_token('tok-1')")).toMatchObject({ status: "booked", rep_first_name: "Rita", customer_name: "Pat Roofer" });
    await expect(pool.query("select public.sales_booking_reschedule('tok-1', '2026-11-23T16:30:00Z', '[]', $1)", [NOW])).rejects.toThrow(/slot_taken/);
    expect(await val("select public.sales_booking_by_token('tok-1')")).toMatchObject({ starts_at: "2026-11-23T15:30:00+00:00" }); // unchanged
    await pool.query("select public.sales_booking_reschedule('tok-1', '2026-11-30T15:00:00Z', '[]', $1)", [NOW]);
    expect(await val("select count(*)::int from public.sales_bookings where status = 'canceled' and cancel_reason = 'rescheduled'")).toBe(1);
    expect((await slots("rita")).includes("2026-11-23T15:30:00.000Z")).toBe(true); // old slot is open again
    await pool.query("select public.sales_booking_cancel('tok-1', 'Got busy')");
    await expect(pool.query("select public.sales_booking_cancel('tok-1', null)")).rejects.toThrow(/not_cancelable/);
  });

  it("time off blocks new slots, keeps existing meetings and lists what needs attention", async () => {
    const before = await val("select count(*)::int from public.sales_bookings where status = 'booked' and rep_id = $1", [rita]);
    const lead = (await val("insert into public.sales_leads (company_name, assigned_rep) values ('Lead Co', $1) returning id", [rita])) as string;
    await pool.query("insert into public.sales_tasks (lead_id, rep_id, title, due_at) values ($1, $2, 'Call back', '2026-11-23T18:00:00Z')", [lead, rita]);
    const t = (await asUser(pool, ritaU, (q) => q("select public.sales_my_time_off_save(null, '2026-11-23T06:00:00Z', '2026-11-24T06:00:00Z', true, 'family', 'I''m out until Tuesday.', null) t"))).rows[0].t;
    expect(t.bookings).toHaveLength(1);
    expect(t.tasks).toHaveLength(1);
    expect(await val("select count(*)::int from public.sales_bookings where status = 'booked' and rep_id = $1", [rita])).toBe(before);
    expect((await slots("rita")).some((s) => s.startsWith("2026-11-23"))).toBe(false);
    expect(await val("select backup_contact from public.sales_time_off where id = $1", [t.id])).toBe("support@built2bid.org");
    // The end of the absence opens slots again without any job running; canceling reopens them too.
    expect((await slots("rita", "[]", "2026-11-24T14:00:00Z")).some((s) => s.startsWith("2026-11-30"))).toBe(true);
    await asUser(pool, ritaU, (q) => q("select public.sales_my_time_off_cancel($1)", [t.id]));
    expect((await slots("rita")).some((s) => s.startsWith("2026-11-23"))).toBe(true);
  });

  it("keeps each rep's calendar private and the public functions off the browser", async () => {
    const mine = (await asUser(pool, samU, (q) => q("select public.sales_my_calendar('2026-11-20', '2026-12-10') c"))).rows[0].c;
    expect(mine.events).toEqual([]);
    expect(mine.bookings).toEqual([]);
    const ritas = (await asUser(pool, ritaU, (q) => q("select public.sales_my_calendar('2026-11-20', '2026-12-10') c"))).rows[0].c;
    expect(ritas.events[0]).toMatchObject({ title: "Dentist", description: "private" });
    const ev = ritas.events[0].id as string;
    await asUser(pool, samU, (q) => q("select public.sales_my_event_delete($1)", [ev]));
    expect(await val("select count(*)::int from public.sales_calendar_events where id = $1", [ev])).toBe(1);
    await expect(asUser(pool, samU, (q) => q("select public.sales_booking_slots('rita', now(), '[]')"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, samU, (q) => q("select * from public.sales_bookings"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, samU, (q) => q("select public.sales_my_calendar('2026-01-01', '2026-06-01')"))).rejects.toThrow(/invalid_range/);
  });

  it("reassigns a booking to a free rep with approval, keeping the original attribution", async () => {
    const b = (await book("rita", "2026-11-30T16:00:00Z", "q@roof.test", "tok-r")).rows[0].b;
    await expect(pool.query("select public.admin_sales_booking_reassign($1, $2, $3)", [ritaU, b.id, sam])).rejects.toThrow(/not_authorized/);
    // Sam is busy then: blocked.
    await asUser(pool, samU, (q) => q("select public.sales_my_event_save(null, 'meeting', 'Demo', null, '2026-11-30T16:00:00Z', '2026-11-30T17:00:00Z', false, null)"));
    await expect(pool.query("select public.admin_sales_booking_reassign($1, $2, $3)", [owner, b.id, sam])).rejects.toThrow(/rep_busy/);
    await pool.query("delete from public.sales_calendar_events where rep_id = $1", [sam]);
    await pool.query("select public.admin_sales_booking_reassign($1, $2, $3)", [owner, b.id, sam]);
    expect(await q1("select rep_id, original_rep_id from public.sales_bookings where id = $1", [b.id])).toMatchObject({ rep_id: sam, original_rep_id: rita });
    expect(await val("select count(*)::int from public.audit_logs where action = 'sales.booking_reassigned'")).toBe(1);
    const list = (await val("select public.admin_sales_bookings($1)", [owner])) as { id: string; original_rep: string }[];
    expect(list.find((x) => x.id === b.id)?.original_rep).toBe("Rita Rep");
    expect(JSON.stringify(list)).not.toContain("Dentist");
  });
});
