/**
 * V6.6 dashboard layouts (20261221001000) against the real SQL: own-row storage, layouts that survive sign-out
 * and other devices (they live in the database, keyed by user + mode), separate Contractor / Accountant layouts,
 * revision conflicts, restore defaults, company defaults that apply only until a person saves their own, and
 * owner-only company defaults. Preferences never touch business tables.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let owner: string, mgr: string, est: string, outsider: string, company: string;

const as = (u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows as Row[]);
const fails = (u: string, sql: string, args: unknown[] = []) => as(u, sql, args).then(() => "ok", (e: Error) => e.message);
const W = (ids: string[]) => JSON.stringify(ids.map((id) => ({ id, type: "sales_drafts", w: 1, h: 1, settings: {} })));
const save = (u: string, mode: string, ids: string[], rev: number | null) => as(u, "select public.dashboard_layout_save($1, 'simple', $2::jsonb, 1, $3, 'user') as r", [mode, W(ids), rev]).then((r) => r[0].r as number);
const get = (u: string, mode = "contractor") => as(u, "select public.dashboard_layout_get($1) as g", [mode]).then((r) => r[0].g as Row);

d("Dashboard layouts (database)", () => {
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_dashboard_layouts"));
    owner = await createUser(pool, "owner@dash.dev");
    mgr = await createUser(pool, "mgr@dash.dev");
    est = await createUser(pool, "est@dash.dev");
    outsider = await createUser(pool, "out@else.dev");
    company = (await pool.query("select public.create_company($1, 'Dash Co') as id", [owner])).rows[0].id;
    await pool.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, 'manager'), ($1, $3, 'estimator')", [company, mgr, est]);
  }, 180_000);
  afterAll(async () => { await drop?.(); });

  it("10-11. a saved layout is stored per user and read back from any session", async () => {
    expect(await get(est)).toMatchObject({ mine: null });
    expect(await save(est, "contractor", ["a", "b"], null)).toBe(1);
    const g = await get(est);
    expect(g.mine).toMatchObject({ revision: 1, template: "simple", source: "user" });
    expect((g.mine.widgets as Row[]).map((w) => w.id)).toEqual(["a", "b"]);
    // Another person never sees it, and can't read the table row either.
    expect((await get(mgr)).mine).toBeNull();
    expect(await as(mgr, "select * from public.dashboard_layouts")).toEqual([]);
  });

  it("12. Contractor and Accountant layouts are separate", async () => {
    await save(est, "accountant", ["x"], null);
    expect(((await get(est, "contractor")).mine.widgets as Row[]).map((w) => w.id)).toEqual(["a", "b"]);
    expect(((await get(est, "accountant")).mine.widgets as Row[]).map((w) => w.id)).toEqual(["x"]);
  });

  it("22. a save from an older copy is refused instead of overwriting the newer layout", async () => {
    expect(await save(est, "contractor", ["b", "a"], 1)).toBe(2);
    expect(await fails(est, "select public.dashboard_layout_save('contractor', null, $1::jsonb, 1, 1, 'user')", [W(["stale"])])).toMatch(/layout_conflict/);
    expect(await fails(est, "select public.dashboard_layout_save('contractor', null, $1::jsonb, 1, null, 'user')", [W(["stale"])])).toMatch(/layout_conflict/);
    expect(((await get(est)).mine.widgets as Row[]).map((w) => w.id)).toEqual(["b", "a"]);
  });

  it("rejects malformed layouts and direct writes", async () => {
    expect(await fails(est, "select public.dashboard_layout_save('contractor', null, '[{\"id\":\"bad id\",\"type\":\"x\"}]'::jsonb, 1, 2, 'user')")).toMatch(/bad_layout/);
    expect(await fails(est, "select public.dashboard_layout_save('contractor', null, '{}'::jsonb, 1, 2, 'user')")).toMatch(/bad_layout/);
    expect(await fails(est, "select public.dashboard_layout_save('boss', null, '[]'::jsonb, 1, 2, 'user')")).toMatch(/bad_mode/);
    expect(await fails(est, "insert into public.dashboard_layouts (user_id, mode) values ($1, 'contractor')", [mgr])).toMatch(/permission denied/);
    expect(await fails(est, "update public.dashboard_layouts set widgets = '[]'")).toMatch(/permission denied/);
    const many = JSON.stringify(Array.from({ length: 41 }, (_, i) => ({ id: `w${i}`, type: "chart", settings: {} })));
    expect(await fails(est, "select public.dashboard_layout_save('contractor', null, $1::jsonb, 1, 2, 'user')", [many])).toMatch(/bad_layout/);
  });

  it("13-14. company defaults apply to people without their own layout, and never overwrite personal ones", async () => {
    // Only the primary account holder may set them.
    expect(await fails(mgr, "select public.company_dashboard_default_save(null, 'contractor', 'job', $1::jsonb, 1)", [W(["co"])])).toMatch(/forbidden/);
    expect(await fails(outsider, "select public.company_dashboard_default_save(null, 'contractor', 'job', $1::jsonb, 1)", [W(["co"])])).toMatch(/forbidden/);
    await as(owner, "select public.company_dashboard_default_save(null, 'contractor', 'job', $1::jsonb, 1)", [W(["co"])]);
    await as(owner, "select public.company_dashboard_default_save('manager', 'contractor', 'job', $1::jsonb, 1)", [W(["mgr1", "mgr2"])]);
    const m = await get(mgr);
    expect(m.mine).toBeNull();
    expect(m.companyDefault).toMatchObject({ role: "manager", template: "job" });   // role default wins over everyone
    // The estimator already has a personal layout: it stays theirs.
    const e = await get(est);
    expect((e.mine.widgets as Row[]).map((w) => w.id)).toEqual(["b", "a"]);
    expect(e.companyDefault).toMatchObject({ role: null });
    expect((await get(outsider)).companyDefault).toBeNull();
    expect((await get(owner)).isCompanyOwner).toBe(true);
    expect((await get(mgr)).isCompanyOwner).toBe(false);
    const list = (await as(owner, "select public.company_dashboard_defaults_list() as l"))[0].l as Row[];
    expect(list).toHaveLength(2);
    expect((await as(mgr, "select public.company_dashboard_defaults_list() as l"))[0].l).toEqual([]);
    // Audited in the company log.
    const log = await pool.query("select action from public.company_audit_log where company_id = $1 and action like 'dashboard_default.%'", [company]);
    expect(log.rowCount).toBe(2);
    // Removing a default.
    await as(owner, "select public.company_dashboard_default_save('manager', 'contractor', null, null, 1)");
    expect((await get(mgr)).companyDefault).toMatchObject({ role: null });
  });

  it("19. restore defaults removes only the caller's own layout for that mode", async () => {
    await as(est, "select public.dashboard_layout_reset('contractor')");
    const e = await get(est);
    expect(e.mine).toBeNull();
    expect(e.companyDefault).toMatchObject({ role: null });
    expect((await get(est, "accountant")).mine).not.toBeNull();
    // Next save starts again from "no layout".
    expect(await save(est, "contractor", ["n"], null)).toBe(1);
  });

  it("Financials page layouts are separate from Home, per mode, and calls without a page stay on Home", async () => {
    const fsave = (u: string, mode: string, ids: string[], rev: number | null) =>
      as(u, "select public.dashboard_layout_save($1, null, $2::jsonb, 1, $3, 'user', 'financials') as r", [mode, W(ids), rev]).then((r) => r[0].r as number);
    const fget = (u: string, mode = "contractor") => as(u, "select public.dashboard_layout_get($1, 'financials') as g", [mode]).then((r) => r[0].g as Row);
    const homeBefore = ((await get(est)).mine.widgets as Row[]).map((w) => w.id);
    expect((await fget(est)).mine).toBeNull();
    expect(await fsave(est, "contractor", ["fc1", "fc2"], null)).toBe(1);
    expect(await fsave(est, "accountant", ["fa1"], null)).toBe(1);
    expect(((await fget(est)).mine.widgets as Row[]).map((w) => w.id)).toEqual(["fc1", "fc2"]);
    expect(((await fget(est, "accountant")).mine.widgets as Row[]).map((w) => w.id)).toEqual(["fa1"]);
    // Home is untouched, and a page-less call still means Home.
    expect(((await get(est)).mine.widgets as Row[]).map((w) => w.id)).toEqual(homeBefore);
    // Each page/mode keeps its own revision.
    expect(await fsave(est, "contractor", ["fc2", "fc1"], 1)).toBe(2);
    expect(await fails(est, "select public.dashboard_layout_save('contractor', null, $1::jsonb, 1, 1, 'user', 'financials')", [W(["stale"])])).toMatch(/layout_conflict/);
    expect(await fails(est, "select public.dashboard_layout_get('contractor', 'nowhere')")).toMatch(/bad_page/);
    // Restoring the Financials Contractor layout leaves Home and Accountant alone.
    await as(est, "select public.dashboard_layout_reset('contractor', 'financials')");
    expect((await fget(est)).mine).toBeNull();
    expect((await fget(est, "accountant")).mine).not.toBeNull();
    expect((await get(est)).mine).not.toBeNull();
    // Company defaults are per page too.
    await as(owner, "select public.company_dashboard_default_save(null, 'contractor', null, $1::jsonb, 1, 'financials')", [W(["fco"])]);
    expect(((await fget(mgr)).companyDefault.widgets as Row[]).map((w) => w.id)).toEqual(["fco"]);
    expect((await get(mgr)).companyDefault).toMatchObject({ role: null, template: "job" });
    const list = (await as(owner, "select public.company_dashboard_defaults_list() as l"))[0].l as Row[];
    expect(list.some((r) => r.page === "financials")).toBe(true);
  });

  it("deleting a user removes their layouts; layouts reference no business data", async () => {
    const cols = await pool.query("select column_name from information_schema.columns where table_name = 'dashboard_layouts'");
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(["created_at", "mode", "page", "revision", "schema_version", "source", "template", "updated_at", "user_id", "widgets"]);
    const tmp = await createUser(pool, "tmp@dash.dev");
    await save(tmp, "contractor", ["t"], null);
    await pool.query("delete from auth.users where id = $1", [tmp]);
    expect((await pool.query("select count(*)::int as n from public.dashboard_layouts where user_id = $1", [tmp])).rows[0].n).toBe(0);
  });
});
