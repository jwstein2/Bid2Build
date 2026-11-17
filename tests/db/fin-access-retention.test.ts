/**
 * Financials owner decisions (20261125001000):
 *   - a Financials seat alone opens a job's header (no bid permission needed); outsiders get nothing
 *   - account deletion: an empty solo book is purged so the login can be deleted; a book with records
 *     gets a 7-year retention hold and the login cannot be hard-deleted
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createUser, dbAvailable, freshDb, type Row } from "./harness";
import { asFn, fails, finAddon, sub, setupWorld, wonBid, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("Financials: seat-only job access and record retention (database)", () => {
  let as: ReturnType<typeof asFn>;
  let est: { id: string; v1: string };

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_access_retention"));
    w = await setupWorld(pool);
    as = asFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.viewer]);
    est = await wonBid(pool, w.owner, w.company, { title: "Smith deck" });
    await as(w.owner, "select public.fin_job_open($1, $2) as r", [est.id, est.v1]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("a bookkeeper seat opens the job header without bid access; outsiders get null", async () => {
    const hdr = (await as<{ h: Row | null }>(w.viewer, "select public.fin_job_header($1) as h", [est.id])).h;
    expect(hdr).toMatchObject({ id: est.id, title: "Smith deck" });
    expect(Object.keys(hdr ?? {})).not.toContain("total");
    expect((await as<{ h: Row | null }>(w.rival, "select public.fin_job_header($1) as h", [est.id])).h).toBeNull();
    // The rep has no Financials seat: no header either.
    expect((await as<{ h: Row | null }>(w.rep, "select public.fin_job_header($1) as h", [est.id])).h).toBeNull();
  });

  it("deleting an account with an empty solo book purges the book, then the login deletes", async () => {
    const u = await createUser(pool, "empty-solo@test.test");
    await sub(pool, u, "monthly", null, null);
    await finAddon(pool, u, true, 0);
    const book = (await as<{ b: string }>(u, "select public.fin_my_book() as b")).b;
    expect(book).toBeTruthy();
    const plan = (await pool.query("select public.fin_prepare_account_deletion($1) as p", [u])).rows[0].p;
    expect(plan).toEqual({ action: "delete" });
    expect((await pool.query("select count(*)::int c from public.fin_books where id = $1", [book])).rows[0].c).toBe(0);
    await pool.query("delete from public.subscriptions where user_id = $1", [u]);
    await pool.query("delete from auth.users where id = $1", [u]);
  });

  it("a solo book with records gets a 7-year hold and the login cannot be hard-deleted", async () => {
    const b = await wonBid(pool, w.solo, null, { title: "Solo job" });
    await as(w.solo, "select public.fin_job_open($1, $2) as r", [b.id, b.v1]);
    const plan = (await pool.query("select public.fin_prepare_account_deletion($1) as p", [w.solo])).rows[0].p;
    expect(plan.action).toBe("retain");
    const years = new Date(plan.retainUntil).getUTCFullYear() - new Date().getUTCFullYear();
    expect(years).toBe(7);
    const holds = (await pool.query("select * from public.fin_retention_holds where book_id = $1 and released_at is null", [w.soloBook])).rows;
    expect(holds).toHaveLength(1);
    // Calling again keeps one open hold.
    await pool.query("select public.fin_prepare_account_deletion($1)", [w.solo]);
    expect((await pool.query("select count(*)::int c from public.fin_retention_holds where book_id = $1", [w.soloBook])).rows[0].c).toBe(1);
    expect(await fails(pool.query("delete from auth.users where id = $1", [w.solo]))).not.toBe("ok");
    // The purge refuses a book with records.
    expect(await fails(pool.query("select public.fin_purge_empty_book($1)", [w.soloBook]))).toContain("book_has_records");
  });

  it("the audit log stays append-only outside a purge, and users cannot call the service functions", async () => {
    expect(await fails(pool.query("delete from public.fin_audit_log where book_id = $1", [w.book]))).toContain("record_immutable");
    expect(await fails(as(w.owner, "select public.fin_prepare_account_deletion($1)", [w.owner]))).toMatch(/permission denied/);
    expect(await fails(as(w.owner, "select public.fin_purge_empty_book($1)", [w.book]))).toMatch(/permission denied/);
  });
});
