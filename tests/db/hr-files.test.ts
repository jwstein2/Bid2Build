/**
 * Employee HR files (20270105001000), against the real SQL:
 *   - only the owner and named HR managers open HR files; managers, viewers and other companies can't
 *   - SSNs are HR-only (pm_sensitive_can 'ssn'); TIN rules are unchanged
 *   - saving keeps unsent fields, clears "" fields, audits field names only (never values)
 *   - documents, certifications and time off, with the year's balance
 *   - rollback removes everything; re-apply works
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";
import { asFn, fails, rowsFn, setupWorld, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("employee HR files (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let cris: string, boss: string;
  const save = (u: string, p: object) => as<{ id: string }>(u, "select public.pm_resource_save($1) as id", [p]).then((r) => r.id);
  const get = (u: string, id = cris) => as<{ r: Row }>(u, "select public.pm_employee_hr_get($1, 2026) as r", [id]).then((x) => x.r);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_hr_files"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    cris = await save(w.owner, { kind: "staff", name: "Cris Lopez" });
    boss = await save(w.owner, { kind: "staff", name: "Bo Foreman" });
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("only the owner and named HR managers can open HR files", async () => {
    expect((await get(w.owner)).name).toBe("Cris Lopez");
    for (const u of [w.bk, w.pm, w.viewer]) expect(await fails(get(u))).toMatch(/forbidden/);
    expect(await fails(get(w.rival))).toMatch(/forbidden/);
    expect(await fails(as(w.pm, "select public.pm_hr_manager_set($1, true)", [w.pm]))).toMatch(/forbidden/);
    expect(await fails(as(w.owner, "select public.pm_hr_manager_set($1, true)", [w.acct]))).toMatch(/not_member/);
    await as(w.owner, "select public.pm_hr_manager_set($1, true)", [w.pm]);
    expect((await get(w.pm)).name).toBe("Cris Lopez");
    const ov = (await as<{ r: Row }>(w.pm, "select public.pm_hr_overview() as r")).r;
    expect(ov).toMatchObject({ canManage: true, isOwner: false });
    expect((ov.people as Row[]).map((p) => p.name)).toEqual(["Bo Foreman", "Cris Lopez"]);
    expect((await as<{ r: Row }>(w.viewer, "select public.pm_hr_overview() as r")).r).toMatchObject({ canManage: false, people: [] });
    // A subcontractor isn't an employee.
    const sub = await save(w.owner, { kind: "subcontractor", name: "Stone Works" });
    expect(await fails(get(w.owner, sub))).toMatch(/not_found/);
  });

  it("SSNs are HR-only and every access is logged", async () => {
    await pool.query("insert into public.pm_sensitive_ids (resource_id, kind, sealed, last4) values ($1, 'ssn', 'v1.aaaa.bbbb.cccc', '6789')", [cris]);
    expect((await as<{ r: string }>(w.pm, "select public.pm_sensitive_log($1, 'ssn', 'revealed') as r", [cris])).r).toBe("6789");
    expect(await fails(as(w.bk, "select public.pm_sensitive_log($1, 'ssn', 'revealed')", [cris]))).toMatch(/forbidden/);
    expect(await fails(as(w.owner, "select public.pm_sensitive_log($1, 'tin', 'revealed')", [cris]))).toMatch(/forbidden/); // not a sub
    expect((await get(w.owner)).ssn).toMatchObject({ onFile: true, last4: "6789" });
    expect(JSON.stringify(await get(w.owner))).not.toContain("v1.aaaa");
    expect(await rows(w.bk, "select 1 from public.pm_sensitive_access_log where kind = 'ssn'")).toHaveLength(0);
    expect((await get(w.owner)).history).toEqual(expect.arrayContaining([expect.objectContaining({ action: "ssn.revealed", by: "Pam" })]));
  });

  it("saving keeps unsent fields, clears blanks, and audits field names only", async () => {
    await as(w.pm, "select public.pm_employee_hr_save($1, $2)", [cris, { legalFirstName: "Cristina", legalLastName: "Lopez", dateOfBirth: "1990-04-02", personalPhone: "555-0100",
      emergency1Name: "Ana Lopez", emergency1Relation: "Sister", emergency1Phone: "555-0101", employmentType: "full_time", supervisorId: boss, ptoHoursPerYear: 80, sickHoursPerYear: 40 }]);
    await as(w.owner, "select public.pm_employee_hr_save($1, $2)", [cris, { personalPhone: "", city: "Austin" }]);
    const hr = (await get(w.owner)).hr as Row;
    expect(hr).toMatchObject({ legal_first_name: "Cristina", date_of_birth: "1990-04-02", personal_phone: null, city: "Austin", emergency1_phone: "555-0101",
      employment_status: "active", supervisor_id: boss, pto_hours_per_year: 80 });
    expect(await fails(as(w.owner, "select public.pm_employee_hr_save($1, $2)", [cris, { ssn: "123456789" }]))).toMatch(/unknown_field/);
    expect(await fails(as(w.owner, "select public.pm_employee_hr_save($1, $2)", [cris, { supervisorId: cris }]))).toMatch(/bad_supervisor/);
    expect(await fails(as(w.owner, "select public.pm_employee_hr_save($1, $2)", [cris, { dateOfBirth: "2999-01-01" }]))).toMatch(/invalid/);
    expect(await fails(as(w.owner, "select public.pm_employee_hr_save($1, $2)", [cris, { employmentType: "gig" }]))).toMatch(/invalid/);
    expect(await fails(as(w.bk, "select public.pm_employee_hr_save($1, $2)", [cris, { city: "Nope" }]))).toMatch(/forbidden/);
    const audit = (await pool.query("select action, fields from public.pm_hr_audit where resource_id = $1 and action = 'hr_file.updated' order by at", [cris])).rows;
    expect(audit[1].fields).toEqual(["city", "personal_phone"]);
    expect(JSON.stringify(audit)).not.toMatch(/555-0100|Austin|1990/);
    expect(await rows(w.bk, "select 1 from public.pm_employee_hr")).toHaveLength(0);
  });

  it("documents, certifications and time off with the year's balance", async () => {
    const folder = `${w.company}/${cris}/`;
    const doc = (await as<{ id: string }>(w.owner, "select public.pm_employee_document_add($1, $2) as id", [cris, { docType: "application", filePath: folder + "app.pdf", fileName: "application.pdf" }])).id;
    expect(await fails(as(w.owner, "select public.pm_employee_document_add($1, $2)", [cris, { docType: "i9", filePath: `${w.rivalCompany}/x/a.pdf` }]))).toMatch(/bad_path/);
    expect(await fails(as(w.owner, "select public.pm_employee_document_add($1, $2)", [cris, { docType: "selfie" }]))).toMatch(/bad_type/);
    expect((await as<{ r: Row }>(w.pm, "select public.pm_employee_document_file($1) as r", [doc])).r).toEqual({ path: folder + "app.pdf", fileName: "application.pdf" });
    expect(await fails(as(w.bk, "select public.pm_employee_document_file($1)", [doc]))).toMatch(/forbidden/);
    expect(await fails(as(w.owner, "select file_path from public.pm_employee_documents"))).toMatch(/permission denied/);
    const cert = (await as<{ id: string }>(w.owner, "select public.pm_employee_cert_save($1, $2) as id", [cris, { name: "OSHA 30", expiresOn: "2026-12-01", documentId: doc }])).id;
    await as(w.owner, "select public.pm_employee_cert_save($1, $2)", [cris, { id: cert, name: "OSHA 30 Construction", expiresOn: "2027-12-01" }]);
    await as(w.owner, "select public.pm_pto_save($1, $2)", [cris, { kind: "pto", startDate: "2026-07-01", endDate: "2026-07-03", hours: 24 }]);
    await as(w.owner, "select public.pm_pto_save($1, $2)", [cris, { kind: "sick", startDate: "2026-03-10", hours: 8 }]);
    const req = (await as<{ id: string }>(w.owner, "select public.pm_pto_save($1, $2) as id", [cris, { kind: "pto", startDate: "2026-12-24", hours: 8, status: "requested" }])).id;
    expect(await fails(as(w.owner, "select public.pm_pto_save($1, $2)", [cris, { kind: "pto", startDate: "2026-12-24", endDate: "2026-12-20", hours: 8 }]))).toMatch(/invalid/);
    let f = await get(w.owner);
    expect(f.balances).toMatchObject({ ptoAllowance: 80, ptoUsed: 24, sickAllowance: 40, sickUsed: 8 });
    await as(w.owner, "select public.pm_pto_set_status($1, 'approved')", [req]);
    f = await get(w.owner);
    expect((f.balances as Row).ptoUsed).toBe(32);
    expect((f.certifications as Row[])[0]).toMatchObject({ name: "OSHA 30 Construction", expiresOn: "2027-12-01" });
    expect((f.documents as Row[])[0]).toMatchObject({ docType: "application", hasFile: true });
    await as(w.owner, "select public.pm_employee_document_remove($1)", [doc]);
    expect((await get(w.owner)).documents).toEqual([]);
    const person = ((await as<{ r: Row }>(w.owner, "select public.pm_hr_overview() as r")).r.people as Row[]).find((p) => p.resourceId === cris)!;
    expect(person).toMatchObject({ hrStarted: true, ssnOnFile: true, emergencyOnFile: true, i9OnFile: false, nextExpiry: "2027-12-01" });
    await as(w.owner, "select public.pm_hr_manager_set($1, false)", [w.pm]);
    expect(await fails(get(w.pm))).toMatch(/forbidden/);
  });

  it("rollback removes everything and re-apply works", async () => {
    await pool.query(readFileSync("docs/worker-invites/rollback_20270212001000.sql", "utf8"));
    await pool.query(readFileSync("docs/worker-hub/rollback_20270210001000.sql", "utf8"));
    await pool.query(readFileSync("docs/workforce-gps/rollback_20270208001000.sql", "utf8"));
    await pool.query(readFileSync("docs/hr-records/rollback_20270205001000.sql", "utf8"));
    await pool.query(readFileSync("docs/team-records/rollback_20270105001000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.pm_employee_hr') as a, to_regclass('public.pm_hr_audit') as b")).rows[0]).toEqual({ a: null, b: null });
    expect((await pool.query("select count(*)::int as n from public.pm_sensitive_ids where kind = 'ssn'")).rows[0].n).toBe(0);
    expect(await fails(as(w.owner, "select public.pm_sensitive_log($1, 'ssn', 'revealed')", [cris]))).toMatch(/forbidden/);
    await pool.query(readFileSync("supabase/migrations/20270105001000_hr_files.sql", "utf8"));
    await pool.query(readFileSync("supabase/migrations/20270105001000_hr_files.sql", "utf8"));
    expect((await get(w.owner)).hr).toBeNull();
  });
});
