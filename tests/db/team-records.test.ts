/**
 * Team records (20261210001000), against the real SQL:
 *   - suppliers are per company / solo account; members read, only managers change; imports link by name
 *   - employee profiles: pay rate only for managers; staff clock themselves, managers fix with a reason
 *   - one open punch per person; managers approve (not their own time unless owner); approved entries lock
 *   - location is stored only when sent, and cleared after 90 days
 *   - subcontractor W-9 / documents only for compliance managers; only the last 4 of the TIN is kept
 *   - 1099 totals count non-card payments and apply the year's threshold
 *   - rollback removes everything cleanly
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
type Row = Record<string, unknown>;
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

d("Team records: suppliers, time clock, subcontractor records (database)", () => {
  let solo: string, owner: string, est: string, viewer: string, crew: string, otherOwner: string, company: string, otherCompany: string;
  const as = <T = Row>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows[0] as T);
  const val = <T = unknown>(u: string, sql: string, args: unknown[] = []) => as<{ v: T }>(u, `${sql} as v`, args).then((r) => r.v);
  const saveRes = (u: string, p: object) => as<{ id: string }>(u, "select public.pm_resource_save($1) as id", [p]).then((r) => r.id);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_team_records"));
    solo = await createUser(pool, "solo@test.dev");
    owner = await createUser(pool, "owner@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    crew = await createUser(pool, "crew@acme.dev");
    otherOwner = await createUser(pool, "boss@other.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    otherCompany = (await pool.query("select public.create_company($1, 'Other') as id", [otherOwner])).rows[0].id;
    await pool.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'manager', 'Erin'), ($1, $3, 'viewer', 'Val'), ($1, $4, 'viewer', 'Cris')", [company, est, viewer, crew]);
  });
  afterAll(async () => { await drop?.(); });

  it("suppliers: company members read, managers change, names are unique, other companies can't see them", async () => {
    const id = await val<string>(owner, "select public.pm_supplier_save($1)", [{ name: "ABC Supply", accountNumber: "A-100", trades: ["Roofing", "roofing"] }]);
    expect(await fails(as(owner, "select public.pm_supplier_save($1)", [{ name: " abc supply " }]))).toMatch(/duplicate_name/);
    expect(await fails(as(viewer, "select public.pm_supplier_save($1)", [{ name: "Viewer Lumber" }]))).toMatch(/forbidden/);
    const list = await val<{ suppliers: Row[]; canManage: boolean }>(viewer, "select public.pm_suppliers_list()");
    expect(list.canManage).toBe(false);
    expect(list.suppliers.map((s) => s.name)).toEqual(["ABC Supply"]);
    expect(list.suppliers[0].trades).toEqual(["roofing"]);
    expect((await val<{ suppliers: Row[] }>(otherOwner, "select public.pm_suppliers_list()")).suppliers).toEqual([]);
    expect((await asUser(pool, otherOwner, (q) => q("select * from public.pm_suppliers"))).rows).toHaveLength(0);
    expect(await fails(as(otherOwner, "select public.pm_supplier_set_status($1, 'archived')", [id]))).toMatch(/forbidden/);
    await as(owner, "select public.pm_supplier_set_status($1, 'archived')", [id]);
    await as(owner, "select public.pm_supplier_set_status($1, 'active')", [id]);
  });

  it("price imports link to a supplier (found by name, or added when the importer may manage suppliers)", async () => {
    await pool.query("update public.subscriptions set status = 'active' where user_id = $1", [solo]);
    const imp = (sup: string, u: string) => pool.query("insert into public.price_imports (user_id, supplier_name, rows_total) values ($1, $2, 1) returning id", [u, sup]).then((r) => r.rows[0].id as string);
    const i1 = await imp("abc supply", owner);
    expect(await val(owner, "select public.price_import_link_supplier($1)", [i1])).toBe((await pool.query("select id from public.pm_suppliers where name = 'ABC Supply'")).rows[0].id);
    const i2 = await imp("Brand New Lumber", owner);
    const newId = await val<string>(owner, "select public.price_import_link_supplier($1)", [i2]);
    expect((await pool.query("select name, company_id from public.pm_suppliers where id = $1", [newId])).rows[0]).toMatchObject({ name: "Brand New Lumber", company_id: company });
    // A viewer can link to an existing supplier but never adds one.
    const i3 = await imp("Viewer Only Supply", viewer);
    expect(await val(viewer, "select public.price_import_link_supplier($1)", [i3])).toBeNull();
    // Someone else's import, or another company's supplier, is refused.
    expect(await fails(as(viewer, "select public.price_import_link_supplier($1)", [i1]))).toMatch(/not_found/);
    const otherSup = await val<string>(otherOwner, "select public.pm_supplier_save($1)", [{ name: "Theirs" }]);
    expect(await fails(as(owner, "select public.price_import_link_supplier($1, $2)", [i1, otherSup]))).toMatch(/bad_supplier/);
    // Unlinked old imports still count by name.
    await imp("ABC SUPPLY", owner);
    const abc = (await val<{ suppliers: Row[] }>(owner, "select public.pm_suppliers_list()")).suppliers.find((s) => s.name === "ABC Supply")!;
    expect(abc.imports).toBe(2);
    const detail = await val<{ imports: Row[] }>(owner, "select public.pm_supplier_detail($1)", [abc.id]);
    expect(detail.imports.map((i) => i.linked)).toEqual([false, true]);
  });

  let erinStaff: string, crisStaff: string, noLogin: string, ownerStaff: string;
  it("employee profiles: managers see pay rate, staff see their own details, viewers see names only", async () => {
    erinStaff = await saveRes(owner, { kind: "staff", name: "Erin", linkedUserId: est });
    crisStaff = await saveRes(owner, { kind: "staff", name: "Cris", linkedUserId: crew });
    noLogin = await saveRes(owner, { kind: "staff", name: "Day Laborer" });
    ownerStaff = await saveRes(owner, { kind: "staff", name: "Owner", linkedUserId: owner });
    await as(owner, "select public.pm_employee_profile_save($1, $2)", [crisStaff, { title: "Carpenter", payType: "hourly", hourlyCost: "38.50", emergencyName: "Mom", emergencyPhone: "555" }]);
    expect(await fails(as(crew, "select public.pm_employee_profile_save($1, $2)", [crisStaff, { hourlyCost: "99" }]))).toMatch(/forbidden/);
    const mgr = await val<{ employees: Row[] }>(est, "select public.pm_employees()");
    expect(mgr.employees.find((e) => e.id === crisStaff)).toMatchObject({ title: "Carpenter", hourlyCost: 38.5, emergencyName: "Mom" });
    const me = await val<{ employees: Row[]; canManage: boolean }>(crew, "select public.pm_employees()");
    expect(me.canManage).toBe(false);
    expect(me.employees.find((e) => e.id === crisStaff)).toMatchObject({ hourlyCost: null, emergencyName: "Mom" });
    expect(me.employees.find((e) => e.id === erinStaff)).toMatchObject({ emergencyName: null, hourlyCost: null });
    expect((await asUser(pool, crew, (q) => q("select * from public.pm_employee_profiles"))).rows).toHaveLength(0);
  });

  it("clock in/out: own punch only (or a manager for crew without a login), one open punch, location only when sent", async () => {
    const e = await val<Row>(crew, "select public.pm_clock_in($1)", [{ resourceId: crisStaff, lat: 44.97776, lng: -93.265, accuracyM: 12.4 }]);
    expect(e).toMatchObject({ status: "open", inLocation: { lat: 44.97776, lng: -93.265, accuracyM: 12 } });
    expect(await fails(as(crew, "select public.pm_clock_in($1)", [{ resourceId: crisStaff }]))).toMatch(/already_in|duplicate/);
    expect(await fails(as(crew, "select public.pm_clock_in($1)", [{ resourceId: erinStaff }]))).toMatch(/forbidden/);
    expect(await fails(as(otherOwner, "select public.pm_clock_in($1)", [{ resourceId: noLogin }]))).toMatch(/forbidden/);
    const m = await val<Row>(est, "select public.pm_clock_in($1)", [{ resourceId: noLogin }]);
    expect(m.inLocation).toBeNull();
    // A project from another company is refused.
    const out = await val<Row>(crew, "select public.pm_clock_out($1)", [{ entryId: e.id, breakMinutes: 30, note: "Framing" }]);
    expect(out).toMatchObject({ status: "pending", breakMinutes: 30, note: "Framing", outLocation: null });
    // Viewers can't read other people's time.
    expect((await asUser(pool, viewer, (q) => q("select * from public.pm_time_entries"))).rows).toHaveLength(0);
    expect((await asUser(pool, crew, (q) => q("select * from public.pm_time_entries"))).rows).toHaveLength(1);
    // Archived staff can't clock in.
    await as(owner, "select public.pm_resource_set_status($1, 'archived')", [noLogin]);
    expect(await fails(as(est, "select public.pm_clock_in($1)", [{ resourceId: noLogin }]))).toMatch(/forbidden/);
    await as(owner, "select public.pm_resource_set_status($1, 'active')", [noLogin]);
  });

  it("managers add and fix entries with a reason (logged), no overlaps, approved entries lock; no approving your own time", async () => {
    const add = await val<Row>(est, "select public.pm_time_entry_save($1)", [{ resourceId: crisStaff, clockIn: "2026-11-02T13:00:00Z", clockOut: "2026-11-02T21:00:00Z", breakMinutes: 30 }]);
    expect(add).toMatchObject({ status: "pending", source: "manual" });
    expect(await fails(as(est, "select public.pm_time_entry_save($1)", [{ resourceId: crisStaff, clockIn: "2026-11-02T20:00:00Z", clockOut: "2026-11-02T22:00:00Z" }]))).toMatch(/overlap/);
    expect(await fails(as(est, "select public.pm_time_entry_save($1)", [{ id: add.id, clockIn: "2026-11-02T12:00:00Z", clockOut: "2026-11-02T21:00:00Z" }]))).toMatch(/reason_required/);
    expect(await fails(as(crew, "select public.pm_time_entry_save($1)", [{ id: add.id, clockIn: "2026-11-02T12:00:00Z", clockOut: "2026-11-02T21:00:00Z", reason: "x" }]))).toMatch(/forbidden/);
    await as(est, "select public.pm_time_entry_save($1)", [{ id: add.id, clockIn: "2026-11-02T12:00:00Z", clockOut: "2026-11-02T21:00:00Z", reason: "Started early" }]);
    const hist = await val<Row[]>(crew, "select public.pm_time_entry_history($1)", [add.id]);
    expect(hist.map((h) => h.action)).toEqual(["added", "edited"]);
    expect(hist[1]).toMatchObject({ reason: "Started early", by: "Erin" });

    expect(await fails(as(crew, "select public.pm_time_entries_decide($1, 'approve')", [[add.id]]))).toMatch(/forbidden/);
    expect(await fails(as(est, "select public.pm_time_entries_decide($1, 'reject')", [[add.id]]))).toMatch(/reason_required/);
    expect(await val(est, "select public.pm_time_entries_decide($1, 'approve')", [[add.id]])).toBe(1);
    expect(await fails(as(est, "select public.pm_time_entry_save($1)", [{ id: add.id, clockIn: "2026-11-02T12:00:00Z", clockOut: "2026-11-02T20:00:00Z", reason: "x" }]))).toMatch(/approved_locked/);
    expect(await val(est, "select public.pm_time_entries_decide($1, 'reopen')", [[add.id]])).toBe(1);
    expect(await val(est, "select public.pm_time_entries_decide($1, 'approve')", [[add.id]])).toBe(1);

    // Erin (a manager) can't approve Erin's own time; the owner can approve their own.
    const mine = await val<Row>(est, "select public.pm_time_entry_save($1)", [{ resourceId: erinStaff, clockIn: "2026-11-03T13:00:00Z", clockOut: "2026-11-03T15:00:00Z" }]);
    expect(await fails(as(est, "select public.pm_time_entries_decide($1, 'approve')", [[mine.id]]))).toMatch(/forbidden_own/);
    expect(await val(owner, "select public.pm_time_entries_decide($1, 'approve')", [[mine.id]])).toBe(1);
    const own = await val<Row>(owner, "select public.pm_time_entry_save($1)", [{ resourceId: ownerStaff, clockIn: "2026-11-03T13:00:00Z", clockOut: "2026-11-03T15:00:00Z" }]);
    expect(await val(owner, "select public.pm_time_entries_decide($1, 'approve')", [[own.id]])).toBe(1);
  });

  it("timesheet: managers get everyone plus rates; staff get only their own and no rates", async () => {
    const from = "2026-10-01T00:00:00Z", to = "2027-01-01T00:00:00Z";
    const m = await val<{ entries: Row[]; rates: Record<string, number>; canManage: boolean }>(est, "select public.pm_timesheet($1, $2)", [from, to]);
    expect(m.canManage).toBe(true);
    expect(new Set(m.entries.map((e) => e.resourceId))).toEqual(new Set([crisStaff, noLogin, erinStaff, ownerStaff]));
    expect(m.rates[crisStaff]).toBe(38.5);
    const s = await val<{ entries: Row[]; rates: Record<string, number> }>(crew, "select public.pm_timesheet($1, $2)", [from, to]);
    expect(new Set(s.entries.map((e) => e.resourceId))).toEqual(new Set([crisStaff]));
    expect(s.rates).toEqual({});
  });

  it("location older than 90 days is cleared on the next punch", async () => {
    await pool.query("insert into public.pm_time_entries (company_id, resource_id, clock_in, clock_out, status, in_lat, in_lng, in_accuracy_m) values ($1, $2, now() - interval '100 days', now() - interval '100 days' + interval '1 hour', 'approved', 1, 2, 3)", [company, erinStaff]);
    await as(est, "select public.pm_clock_in($1)", [{ resourceId: erinStaff }]);
    const old = (await pool.query("select in_lat from public.pm_time_entries where resource_id = $1 and clock_in < now() - interval '90 days'", [erinStaff])).rows;
    expect(old).toEqual([{ in_lat: null }]);
  });

  let stone: string;
  it("subcontractor records: only compliance managers see W-9 details and documents; only last 4 digits kept", async () => {
    stone = await saveRes(owner, { kind: "subcontractor", name: "Stone Works" });
    // Erin is a manager role without manage_sub_compliance (unless the role grants it).
    const erinCan = (await pool.query("select $1 = any (public.member_permissions('manager', null, null)) as v", ["manage_sub_compliance"])).rows[0].v as boolean;
    await as(owner, "select public.pm_sub_tax_save($1, $2)", [stone, { legalName: "Stone Works LLC", taxClassification: "llc_p", tinType: "ein", tinLast4: "12-3456789".slice(-4), w9SignedOn: "2026-01-05" }]);
    expect(await fails(as(owner, "select public.pm_sub_tax_save($1, $2)", [stone, { tinLast4: "123456789" }]))).toMatch(/bad_tin/);
    expect(await fails(as(viewer, "select public.pm_sub_record($1)", [stone]))).toMatch(/forbidden/);
    expect((await asUser(pool, viewer, (q) => q("select * from public.pm_sub_tax_profiles"))).rows).toHaveLength(0);
    if (!erinCan) expect(await fails(as(est, "select public.pm_sub_record($1)", [stone]))).toMatch(/forbidden/);
    expect(await fails(as(otherOwner, "select public.pm_sub_record($1)", [stone]))).toMatch(/not_found/);

    const prefix = `${company}/${stone}/`;
    await as(owner, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "coi_general_liability", issuer: "Acme Mutual", expiresOn: "2026-01-01", filePath: prefix + "a.pdf", fileName: "coi.pdf" }]);
    expect(await fails(as(owner, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "w9", filePath: `${otherCompany}/x/evil.pdf` }]))).toMatch(/bad_path/);
    expect(await fails(as(owner, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "verified" }]))).toMatch(/bad_type/);
    const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    await as(owner, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "workers_comp", expiresOn: soon }]);
    await as(owner, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "subcontract_agreement", signedOn: "2026-02-01" }]);

    // Everyone who can see the directory gets the at-a-glance status, without numbers or files.
    const sum = await val<{ subs: Record<string, Row>; canManage: boolean }>(viewer, "select public.pm_sub_compliance_summary()");
    expect(sum.canManage).toBe(false);
    expect(sum.subs[stone]).toMatchObject({ w9OnFile: true, insuranceOnFile: true, agreementOnFile: true, expired: 1, expiringSoon: 1, nextExpiry: soon });
    expect(JSON.stringify(sum)).not.toContain("3456");

    // A new certificate of the same type replaces the old one.
    await as(owner, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "coi_general_liability", expiresOn: "2027-06-01" }]);
    const rec = await val<{ documents: Row[]; tax: Row }>(owner, "select public.pm_sub_record($1)", [stone]);
    expect(rec.tax).toMatchObject({ tinLast4: "6789", tracks1099: true });
    expect(rec.documents.filter((x) => x.docType === "coi_general_liability").map((x) => x.status).sort()).toEqual(["on_file", "replaced"]);
    const file = rec.documents.find((x) => x.hasFile)!;
    expect(await val<Row>(owner, "select public.pm_sub_document_file($1)", [file.id])).toEqual({ path: prefix + "a.pdf", fileName: "coi.pdf" });
    expect(await fails(as(viewer, "select public.pm_sub_document_file($1)", [file.id]))).toMatch(/forbidden/);
    await as(owner, "select public.pm_sub_document_remove($1)", [file.id]);
    expect((await val<{ documents: Row[] }>(owner, "select public.pm_sub_record($1)", [stone])).documents.some((x) => x.id === file.id)).toBe(false);
    // Corporations don't get 1099s by default; an explicit choice wins.
    const corp = await saveRes(owner, { kind: "subcontractor", name: "Big Corp" });
    await as(owner, "select public.pm_sub_tax_save($1, $2)", [corp, { taxClassification: "c_corp" }]);
    expect((await val<{ tax: Row }>(owner, "select public.pm_sub_record($1)", [corp])).tax.tracks1099).toBe(false);
    await as(owner, "select public.pm_sub_tax_save($1, $2)", [corp, { taxClassification: "c_corp", track1099: true }]);
    expect((await val<{ tax: Row }>(owner, "select public.pm_sub_record($1)", [corp])).tax.tracks1099).toBe(true);
  });

  it("1099 totals: non-card payments in the year, the year's threshold, compliance or finance access only", async () => {
    const book = (await pool.query("insert into public.fin_books (company_id, name) values ($1, 'Acme') returning id", [company])).rows[0].id as string;
    const vendor = (await pool.query("insert into public.fin_vendors (book_id, resource_id, name, kind) values ($1, $2, 'Stone Works', 'subcontractor') returning id", [book, stone])).rows[0].id as string;
    const loose = (await pool.query("insert into public.fin_vendors (book_id, name, kind) values ($1, 'Loose Sub', 'subcontractor') returning id", [book])).rows[0].id as string;
    let n = 0;
    const bill = async (v: string, total: number, paid: { on: string; amount: number; method: string }[]) => {
      n++;
      const b = (await pool.query("insert into public.fin_vendor_bills (book_id, vendor_id, vendor_invoice_number, seq, number, bill_date, due_date, total, status, approved_at) values ($1, $2, $3, $4, $5, '2026-01-01', '2026-12-31', $6, 'approved', now()) returning id", [book, v, `INV-${n}`, n, `BILL-${n}`, total])).rows[0].id;
      for (const p of paid) await pool.query("insert into public.fin_bill_payments (book_id, bill_id, paid_on, method, amount) values ($1, $2, $3, $4, $5)", [book, b, p.on, p.method, p.amount]);
    };
    await bill(vendor, 5000, [{ on: "2026-03-01", amount: 1500, method: "check" }, { on: "2026-04-01", amount: 1000, method: "card" }, { on: "2026-05-01", amount: 1000, method: "ach" }]);
    await bill(vendor, 900, [{ on: "2025-12-15", amount: 900, method: "check" }]);
    await bill(loose, 1000, [{ on: "2026-06-01", amount: 1000, method: "check" }]);

    const y26 = await val<{ threshold: number; rows: Row[] }>(owner, "select public.pm_sub_1099_totals(2026)");
    expect(y26.threshold).toBe(2000);
    expect(y26.rows[0]).toMatchObject({ vendorName: "Stone Works", paid: 2500, cardPaid: 1000, needs1099: true, tinLast4: "6789", w9OnFile: true });
    expect(y26.rows[1]).toMatchObject({ vendorName: "Loose Sub", paid: 1000, needs1099: false, tracks1099: true });
    const y25 = await val<{ threshold: number; rows: Row[] }>(owner, "select public.pm_sub_1099_totals(2025)");
    expect(y25.threshold).toBe(600);
    expect(y25.rows[0]).toMatchObject({ paid: 900, needs1099: true });
    expect(await fails(as(viewer, "select public.pm_sub_1099_totals(2026)"))).toMatch(/forbidden/);
    expect((await val<{ rows: Row[] }>(otherOwner, "select public.pm_sub_1099_totals(2026)")).rows).toEqual([]);
  });

  it("solo accounts keep their own suppliers, staff and records", async () => {
    const s = await val<string>(solo, "select public.pm_supplier_save($1)", [{ name: "ABC Supply" }]);
    expect(s).toBeTruthy();
    const me = await saveRes(solo, { kind: "staff", name: "Me", linkedUserId: solo });
    const e = await val<Row>(solo, "select public.pm_clock_in($1)", [{ resourceId: me }]);
    await val(solo, "select public.pm_clock_out($1)", [{ entryId: e.id }]);
    expect(await val(solo, "select public.pm_time_entries_decide($1, 'approve')", [[e.id]])).toBe(1);
    const sub = await saveRes(solo, { kind: "subcontractor", name: "Solo Sub" });
    await as(solo, "select public.pm_sub_tax_save($1, $2)", [sub, { tinType: "ssn", tinLast4: "4321" }]);
    expect((await val<{ tax: Row }>(solo, "select public.pm_sub_record($1)", [sub])).tax.tinLast4).toBe("4321");
    expect(await fails(as(owner, "select public.pm_sub_record($1)", [sub]))).toMatch(/not_found/);
  });

  it("rollback removes everything and leaves Team & Subcontractors intact", async () => {
    await pool.query(readFileSync("docs/team-records/rollback_20270104001000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20270103001000.sql", "utf8"));   // newest first: timesheet labor reads fin_books / pm_time_entries
    await pool.query(readFileSync("docs/supplier-pricing/rollback_20261211001000.sql", "utf8"));
    await pool.query(readFileSync("docs/team-records/rollback_20261210001000.sql", "utf8"));
    const left = (await pool.query("select to_regclass('public.pm_suppliers') a, to_regclass('public.pm_time_entries') b, to_regclass('public.pm_sub_documents') c, to_regprocedure('public.pm_sub_1099_totals(integer)') f")).rows[0];
    expect(left).toEqual({ a: null, b: null, c: null, f: null });
    expect((await pool.query("select count(*)::int n from information_schema.columns where table_name = 'price_imports' and column_name = 'supplier_id'")).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int n from public.pm_resources")).rows[0].n).toBeGreaterThan(0);
  });
});
