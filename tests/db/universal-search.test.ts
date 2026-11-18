/**
 * Universal search (20261220001000), against the real SQL and the shared demo world
 * (scripts/universal-search/seed.mjs: 38 trades, a Johnson kitchen project with tasks / scope / change orders /
 * signed proposal / photo / message, Financials with a sandbox book, people, suppliers, saved items, a rival
 * company and a solo contractor with the same names).
 *
 * Covers the V6.4 test list: exact / partial / misspelled customer, project number, estimate number, invoice number,
 * vendor, subcontractor, supplier SKU, all 38 trades, scope text, schedule tasks, signed proposal version,
 * change order, related-record grouping, category / date / status filters, project context vs company-wide,
 * restricted financial records, payroll never exposed, cross-company isolation, sandbox / live separation,
 * empty results, pagination, recent history (revoked records drop off), and query time under seeded load.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, dbAvailable, freshDb, type Row } from "./harness";
import { seedSearchWorld, seedBulk, IDS, TRADES } from "../../scripts/universal-search/seed.mjs";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ids from the JS seed
let w: any;
const { ME, PAM, RAE, CRIS, RIVAL, SOLO } = IDS as Record<string, string>;

type Opts = { types?: string[] | null; boost?: string[]; filters?: object; context?: object; perType?: number; limit?: number; offset?: number; sort?: string };
const search = (u: string, q: string, o: Opts = {}) => asUser(pool, u, (x) => x(
  "select * from public.search_universal($1, $2, $3, $4, $5, $6, $7, $8, $9)",
  [q, o.types ?? null, o.boost ?? [], o.filters ?? {}, o.context ?? {}, o.perType ?? 6, o.limit ?? 50, o.offset ?? 0, o.sort ?? "relevance"])).then((r) => r.rows);
const top = (rows: Row[], kind?: string) => rows.filter((r) => !kind || r.kind === kind).sort((a, b) => Number(b.score) - Number(a.score))[0] as Row;
const ids = (rows: Row[], kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.id);
const as = (u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (x) => x(sql, args)).then((r) => r.rows);

d("Universal search (database)", () => {
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_universal_search"));
    w = await seedSearchWorld(pool);
  }, 180_000);
  afterAll(async () => { await drop?.(); });

  it("1-3. customers: exact, partial and misspelled names", async () => {
    const exact = await search(ME, "michael johnson");
    expect(top(exact, "customer")).toMatchObject({ id: w.johnson, reason: "Exact name" });
    const partial = await search(ME, "johns");
    expect(ids(partial, "customer")).toEqual(expect.arrayContaining([w.johnson, w.johnston]));
    expect(top(partial, "customer").reason).toMatch(/Name/);
    const typo = await search(ME, "jhonson");
    expect(ids(typo, "customer")).toContain(w.johnson);
    expect(typo.find((r) => r.id === w.johnson)!.reason).toBe('Similar spelling to "jhonson"');
    // Fuzzy matching stays responsible: an unrelated name doesn't come back.
    expect((await search(ME, "zebrowski")).length).toBe(0);
    // Customer email / phone match without showing them in the reason.
    const phone = await search(ME, "6125550142");
    expect(top(phone, "customer")).toMatchObject({ id: w.johnson, reason: "Phone match" });
  });

  it("4-6. project number, estimate number and invoice number are exact identifier matches", async () => {
    const r = await search(ME, "1042");
    expect(top(r)).toMatchObject({ reason: expect.stringMatching(/^Exact (estimate|project|proposal) number/) });
    expect(r.find((x) => x.kind === "project")).toMatchObject({ id: w.schedule, reason: "Exact project number" });
    expect(r.find((x) => x.kind === "estimate")).toMatchObject({ id: w.kitchen, reason: "Exact estimate number" });
    const k = await search(ME, "kitchen 1042", { boost: ["estimate"] });   // "Kitchen estimate 1042"
    expect(top(k)).toMatchObject({ kind: "estimate", id: w.kitchen });
    const inv = await search(ME, w.overdue.number.toLowerCase());
    expect(top(inv)).toMatchObject({ kind: "invoice", id: w.overdue.id, reason: "Exact invoice number", status: "overdue" });
    // Digits alone ("0001") still find the invoice number when the query hints at invoices.
    expect(top(await search(ME, "1", { boost: ["invoice"], types: ["invoice"] }))).toMatchObject({ id: w.overdue.id });
  });

  it("7-9. vendor, subcontractor and supplier SKU", async () => {
    const v = await search(ME, "bright electric");
    expect(ids(v, "resource")).toContain(w.bright);
    expect(ids(v, "vendor")).toContain(w.vendor);
    expect(ids(v, "bill")).toContain(w.bill.billId);
    expect(v.find((x) => x.id === w.bright)!.status).toBe("subcontractor");
    const sku = await search(ME, "shg-30-blk");
    expect(top(sku)).toMatchObject({ kind: "saved_item", id: w.shingle, reason: "Exact SKU" });
    expect(top(await search(ME, "abc supply"))).toMatchObject({ kind: "supplier", id: w.supplier });
  });

  it("10. every one of the 38 trades finds its bid", async () => {
    expect(TRADES).toHaveLength(38);
    for (const [slug, label] of TRADES as [string, string][]) {
      const r = await search(ME, label.replace("&", "").toLowerCase(), { types: ["estimate"] });
      expect(ids(r, "estimate"), `${slug}`).toContain(w.tradeBids[slug]);
      const f = await search(ME, "", { types: ["estimate"], filters: { trade: slug }, perType: 0 });
      expect(f.map((x) => x.id), `trade filter ${slug}`).toContain(w.tradeBids[slug]);
    }
  });

  it("11-12. scope text and schedule tasks", async () => {
    const scope = await search(ME, "recessed lights");
    expect(top(scope)).toMatchObject({ kind: "scope", id: w.scope });
    expect(top(scope).reason).toMatch(/^Approved scope: Install 200A panel/);
    // Bid line items count as scope too.
    const panel = await search(ME, "200a panel");
    expect(panel.find((x) => x.kind === "estimate" && x.id === w.kitchen)?.reason).toMatch(/Scope contains/);
    const t = await search(ME, "rough-in wiring");
    expect(top(t)).toMatchObject({ kind: "task", id: w.roughIn, schedule_id: w.schedule });
    // A task is found by who it's assigned to.
    const byPerson = await search(ME, "jose martinez");
    expect(ids(byPerson, "task")).toContain(w.demo);
    expect(ids(byPerson, "resource")).toContain(w.jose);
  });

  it("13-14. signed proposal version and change orders (internal notes never searched)", async () => {
    const v = await search(ME, "johnson v2");
    expect(v.find((x) => x.kind === "signature")).toMatchObject({ id: w.signature, status: "signed" });
    const co = await search(ME, "2", { boost: ["change_order"] });
    expect(top(co)).toMatchObject({ kind: "change_order", id: w.co2, reason: "Exact change order number", status: "approved" });
    expect(top(await search(ME, "pantry outlets"))).toMatchObject({ kind: "change_order", id: w.co2 });
    expect(await search(ME, "secret-internal-note")).toHaveLength(0);
    expect(await search(ME, "margin is thin")).toHaveLength(0);
  });

  it("15. related records: one customer name finds their projects, bids, invoices, tasks and change orders as separate results", async () => {
    const r = await search(ME, "johnson", { perType: 25 });
    const kinds = new Set(r.map((x) => x.kind));
    for (const k of ["customer", "project", "estimate", "invoice", "payment", "change_order", "signature", "task", "message"]) expect(kinds, k).toContain(k);
    // Each record appears once.
    expect(new Set(r.map((x) => `${x.kind}:${x.id}`)).size).toBe(r.length);
    // The trade sections of the customer's project come back as related tasks, explained.
    expect(r.find((x) => x.id === w.secElec)?.reason).toBe("Related project: Johnson Kitchen Remodel");
    // Exact matches rank above related ones.
    expect(Number(top(r).score)).toBeGreaterThan(Number(r.find((x) => x.id === w.secElec)!.score));
  });

  it("16-17. category, status and date filters (overdue Johnson = overdue invoices from balances, not text)", async () => {
    const od = await search(ME, "johnson", { types: ["invoice"], filters: { status: "overdue" } });
    expect(od.map((x) => x.id)).toEqual([w.overdue.id]);
    const unpaid = await search(ME, "johnson", { types: ["invoice"], filters: { status: "open,overdue" } });
    expect(unpaid.map((x) => x.id).sort()).toEqual([w.overdue.id, w.current.id].sort());
    const cat = await search(ME, "johnson", { types: ["customer"] });
    expect(new Set(cat.map((x) => x.kind))).toEqual(new Set(["customer"]));
    const dated = await search(ME, "johnson", { types: ["invoice"], filters: { from: "2026-09-01", to: "2026-09-30" } });
    expect(dated.map((x) => x.id)).toEqual([w.overdue.id]);
    // Person filter: projects this PM manages.
    const pm = await search(ME, "", { types: ["project"], filters: { person: PAM } });
    expect(pm.map((x) => x.id)).toEqual([w.schedule]);
  });

  it("18-19. inside a project its records rank first and are flagged; the whole company is still searched", async () => {
    const all = await search(ME, "electrical", { perType: 20 });
    const inProject = await search(ME, "electrical", { context: { schedule_id: w.schedule }, perType: 20 });
    expect(inProject.find((x) => x.id === w.secElec)!.in_context).toBe(true);
    expect(Number(inProject.find((x) => x.id === w.scope)!.score)).toBeGreaterThan(Number(all.find((x) => x.id === w.scope)!.score));
    // Company-wide results are still there (another bid with Electrical in its name).
    expect(inProject.some((x) => x.kind === "estimate" && !x.in_context)).toBe(true);
    // "This project" scope narrows to the project.
    const only = await search(ME, "electrical", { context: { schedule_id: w.schedule }, filters: { scope: "project" }, perType: 20 });
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((x) => x.estimate_id === w.kitchen)).toBe(true);
  });

  it("21. financial records need a Financials seat: the crew member and the estimator see none, counts included", async () => {
    for (const u of [CRIS, RAE]) {
      const r = await search(u, "johnson", { perType: 50 });
      expect(r.some((x) => ["invoice", "payment", "bill", "expense", "vendor"].includes(x.kind)), u).toBe(false);
      const listed = await search(u, "", { types: ["invoice", "payment", "bill", "expense", "vendor"], perType: 0 });
      expect(listed).toHaveLength(0);
    }
    // The owner sees them.
    expect((await search(ME, "", { types: ["invoice"], perType: 0 })).length).toBe(2);
  });

  it("22. payroll, tax ids, account numbers, message bodies and costs never appear anywhere in search output", async () => {
    const blob = JSON.stringify([
      ...(await search(ME, "jose", { perType: 25 })), ...(await search(ME, "abc supply", { perType: 25 })), ...(await search(ME, "johnson", { perType: 25 })),
      ...(await search(ME, "shingles", { perType: 25 })), ...(await search(CRIS, "jose", { perType: 25 })),
    ]);
    for (const secret of ["38.5", "ACCT-SECRET", "PRIVATE-BODY-TEXT", "41.75", "secret-internal-note", "Margin is thin"]) expect(blob).not.toContain(secret);
    expect(await search(ME, "acct-secret-991")).toHaveLength(0);
    expect(await search(ME, "private-body-text")).toHaveLength(0);
  });

  it("23. companies never see each other's records (or counts), even with identical names and numbers", async () => {
    const mine = await search(ME, "johnson kitchen remodel", { perType: 25 });
    expect(mine.map((x) => x.id)).not.toContain(w.rivalKitchen);
    expect(mine.map((x) => x.id)).not.toContain(w.rivalJohnson);
    const theirs = await search(RIVAL, "johnson", { perType: 25 });
    expect(theirs.map((x) => x.id)).toEqual(expect.arrayContaining([w.rivalJohnson, w.rivalKitchen, w.rivalInvoice.id]));
    for (const x of theirs) expect([w.johnson, w.kitchen, w.schedule, w.overdue.id, w.bright, w.signature]).not.toContain(x.id);
    expect(Math.max(...theirs.map((x) => x.total_all))).toBeLessThan(10);
    expect((await search(RIVAL, "1042")).map((x) => x.id)).toEqual([w.rivalKitchen]);
    expect(await search(RIVAL, "bright electric", { types: ["resource"] })).toEqual([expect.objectContaining({ id: w.rivalSub })]);
    const solo = await search(SOLO, "johnson", { perType: 25 });
    expect(solo.map((x) => x.id).sort()).toEqual(expect.arrayContaining([w.soloDeck]));
    expect(solo.every((x) => ![w.johnson, w.kitchen, w.rivalKitchen].includes(x.id))).toBe(true);
  });

  it("24. sandbox and live never mix: practice mode returns only SBX- records, live only real ones, labelled", async () => {
    const live = await search(ME, "", { types: ["invoice"], perType: 0 });
    expect(live.every((x) => x.workspace === "live" && !x.title.startsWith("SBX-"))).toBe(true);
    expect(live.map((x) => x.id)).not.toContain(w.sbInvoice.id);
    await as(ME, "select public.fin_sandbox_enter($1)", [w.book]);
    try {
      const sb = await search(ME, "", { types: ["invoice"], perType: 0 });
      expect(sb.map((x) => x.id)).toEqual([w.sbInvoice.id]);
      expect(sb[0]).toMatchObject({ workspace: "sandbox", title: expect.stringMatching(/^SBX-INV-/) });
      // The live invoice number only reaches the practice copy (SBX-INV-…), never the real invoice.
      const real = await search(ME, w.overdue.number.toLowerCase(), { types: ["invoice"] });
      expect(real.map((x) => x.id)).not.toContain(w.overdue.id);
      expect(real.every((x) => x.workspace === "sandbox")).toBe(true);
      // Recents can't reach the real book from practice mode either.
      expect((await as(ME, "select * from public.search_resolve('invoice', $1)", [w.overdue.id]))).toHaveLength(0);
      // Non-financial records are the same company records (labelled live).
      expect(top(await search(ME, "michael johnson"))).toMatchObject({ id: w.johnson, workspace: "live" });
    } finally {
      await as(ME, "select public.fin_sandbox_leave()");
    }
    const back = await search(ME, w.sbInvoice.number.toLowerCase(), { types: ["invoice"] });
    expect(back.map((x) => x.id)).not.toContain(w.sbInvoice.id);
    expect(back.every((x) => x.workspace === "live")).toBe(true);
  });

  it("28-29. empty results and pagination", async () => {
    expect(await search(ME, "qqqzzzxxx")).toHaveLength(0);
    expect(await search(ME, "")).toHaveLength(0);      // an empty box lists nothing (the app shows recents)
    const p1 = await search(ME, "project", { types: ["estimate"], perType: 0, limit: 10, offset: 0 });
    const p2 = await search(ME, "project", { types: ["estimate"], perType: 0, limit: 10, offset: 10 });
    expect(p1).toHaveLength(10);
    expect(p2.length).toBeGreaterThan(0);
    expect(p1[0].total_all).toBeGreaterThanOrEqual(38);
    expect(p1.map((x) => x.id).filter((i) => p2.some((y) => y.id === i))).toEqual([]);
    const byName = await search(ME, "project", { types: ["estimate"], perType: 0, limit: 5, sort: "name" });
    expect(byName.map((x) => x.title)).toEqual([...byName.map((x) => x.title)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  });

  it("recent searches and opened records are per user, honour 'history off', and drop records the user lost access to", async () => {
    // Cris is a viewer; give Cris company-wide bid visibility so there's something to open and then lose.
    await pool.query("update public.company_members set permissions_granted = array['view_company_bids'] where user_id = $1", [CRIS]);
    expect(top(await search(CRIS, "johnson kitchen"))).toMatchObject({ id: w.kitchen });
    await as(CRIS, "select public.search_remember('query', 'johnson')");
    await as(CRIS, "select public.search_remember('record', null, 'project', $1)", [w.schedule]);
    await as(CRIS, "select public.search_remember('record', null, 'customer', $1)", [w.johnson]);
    let rec = (await as(CRIS, "select public.search_recent() as r"))[0].r;
    expect(rec.queries).toEqual(["johnson"]);
    expect(rec.records.map((x: Row) => x.id).sort()).toEqual([w.schedule, w.johnson].sort());
    // Someone else never sees them.
    expect((await as(ME, "select public.search_recent() as r"))[0].r.queries).toEqual([]);
    expect(await as(ME, "select * from public.search_history where user_id = $1", [CRIS])).toHaveLength(0);
    // Remembering a record you can't open stores nothing visible: it's removed on the next read.
    await as(CRIS, "select public.search_remember('record', null, 'invoice', $1)", [w.overdue.id]);
    rec = (await as(CRIS, "select public.search_recent() as r"))[0].r;
    expect(rec.records.map((x: Row) => x.id)).not.toContain(w.overdue.id);
    expect((await as(CRIS, "select count(*)::int n from public.search_history where record_id = $1", [w.overdue.id]))[0].n).toBe(0);
    // Access revoked: Cris leaves the company, the company records drop off recents.
    await pool.query("update public.company_members set status = 'deactivated', deactivated_at = now() where user_id = $1", [CRIS]);
    rec = (await as(CRIS, "select public.search_recent() as r"))[0].r;
    expect(rec.records).toEqual([]);
    expect(await search(CRIS, "johnson")).toHaveLength(0);
    await pool.query("update public.company_members set status = 'active', deactivated_at = null where user_id = $1", [CRIS]);
    // History off: nothing saved, and what was saved is cleared.
    await as(CRIS, "select public.search_save_preferences($1)", [{ history_enabled: false }]);
    await as(CRIS, "select public.search_remember('query', 'roof')");
    rec = (await as(CRIS, "select public.search_recent() as r"))[0].r;
    expect(rec).toMatchObject({ history_enabled: false, queries: [], records: [] });
    // Direct writes are refused; only the functions write.
    await expect(as(CRIS, "insert into public.search_history (kind, query) values ('query', 'x')")).rejects.toThrow(/permission denied/);
    await pool.query("update public.company_members set permissions_granted = '{}' where user_id = $1", [CRIS]);
  });

  it("command capabilities reflect the real permissions; owner admin lookup is admin-only", async () => {
    const own = (await as(ME, "select public.search_capabilities() as c"))[0].c;
    expect(own).toMatchObject({ company: { role: "owner" }, fin: { sandbox: false } });
    expect(own.fin.perms).toEqual(expect.arrayContaining(["create_invoices", "record_payments", "view_company_financials"]));
    const cr = (await as(CRIS, "select public.search_capabilities() as c"))[0].c;
    expect(cr.fin).toBeNull();
    expect(cr.company.perms).not.toContain("create_estimates");
    await expect(as(ME, "select * from public.search_admin_accounts('summit')")).rejects.toThrow(/forbidden/);
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin') on conflict do nothing", [PAM]);
    const acc = await as(PAM, "select * from public.search_admin_accounts('rival')");
    expect(acc.map((a) => a.email)).toContain("boss@rival.test");
  });

  it("30. stays fast under seeded load (5,000 extra customers and bids, 2,500 tasks)", async () => {
    await seedBulk(pool, { company: w.company, owner: ME, count: 5000 });
    const time = async (u: string, q: string, o: Opts = {}) => { const t = performance.now(); const r = await search(u, q, o); return { ms: performance.now() - t, n: r.length }; };
    await time(ME, "warm up");
    const runs: Record<string, number> = {};
    for (const q of ["johnson", "jhonson", "1042", "bulk customer 4321", "electrical", "smith deck", "b104321", "shg-30-blk"]) {
      const samples = [];
      for (let i = 0; i < 3; i++) samples.push((await time(ME, q)).ms);
      runs[q] = Math.min(...samples);
    }
    const rival = (await time(RIVAL, "bulk customer")).ms;
    console.log("search timings (ms, best of 3):", JSON.stringify(runs), "rival:", Math.round(rival));
    for (const [q, ms] of Object.entries(runs)) expect(ms, q).toBeLessThan(500);
    expect((await search(ME, "bulk customer 4321")).some((x) => x.kind === "customer" && x.title.startsWith("Bulk Customer 4321"))).toBe(true);
    expect(await search(RIVAL, "bulk customer")).toHaveLength(0);
  }, 180_000);
});
