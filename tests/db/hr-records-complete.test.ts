/**
 * Complete HR records (20270205001000), against the real SQL:
 *   - employee pay / classification / W-4 / state withholding / direct deposit fields save, keep and clear like the rest
 *   - routing numbers must pass the ABA checksum; bad enums and states are refused
 *   - bank account numbers: HR-only for employees, compliance managers for subs; every access is logged
 *   - subcontractor business profile (partial saves) and COI endorsement fields + new document types
 *   - rollback restores the earlier definitions; re-apply works
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
const ROUTING = "011000015"; // valid ABA checksum (Federal Reserve Bank of Boston)

d("complete HR records (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let cris: string, stone: string;
  const save = (u: string, p: object) => as<{ id: string }>(u, "select public.pm_resource_save($1) as id", [p]).then((r) => r.id);
  const hrGet = (u: string, id = cris) => as<{ r: Row }>(u, "select public.pm_employee_hr_get($1, 2026) as r", [id]).then((x) => x.r);
  const hrSave = (u: string, p: object) => as(u, "select public.pm_employee_hr_save($1, $2)", [cris, p]);
  const subGet = (u: string) => as<{ r: Row }>(u, "select public.pm_sub_record($1) as r", [stone]).then((x) => x.r);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_hr_complete"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    cris = await save(w.owner, { kind: "staff", name: "Cris Lopez" });
    stone = await save(w.owner, { kind: "subcontractor", name: "Stone Works", entity: "company" });
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("pay, classification, W-4, state withholding and direct deposit details save and clear", async () => {
    await hrSave(w.owner, { employeeNumber: "E-104", payRate: 32.5, payRateUnit: "hour", payFrequency: "biweekly", flsaStatus: "non_exempt",
      wcClassCode: "5403", tradeClassification: "Carpenter - Journeyman", unionLocal: "Local 1234", newHireReportedOn: "2026-03-05",
      w4FilingStatus: "married_jointly", w4MultipleJobs: false, w4DependentsAmount: 4000, w4ExtraWithholding: 25, w4SignedOn: "2026-03-01",
      stateWithholdingState: "mn", stateAllowances: 2, ddBankName: "First Bank", ddAccountType: "checking", ddRouting: ROUTING });
    let hr = (await hrGet(w.owner)).hr as Row;
    expect(hr).toMatchObject({ employee_number: "E-104", pay_rate: 32.5, pay_frequency: "biweekly", flsa_status: "non_exempt", wc_class_code: "5403",
      w4_filing_status: "married_jointly", w4_multiple_jobs: false, w4_dependents_amount: 4000, state_withholding_state: "MN", dd_routing: ROUTING });
    await hrSave(w.owner, { w4ExtraWithholding: "", city: "St. Paul" });
    hr = (await hrGet(w.owner)).hr as Row;
    expect(hr).toMatchObject({ w4_extra_withholding: null, city: "St. Paul", pay_rate: 32.5 });
    expect(await fails(hrSave(w.owner, { ddRouting: "123456789" }))).toMatch(/bad_routing/);
    expect(await fails(hrSave(w.owner, { payFrequency: "daily" }))).toMatch(/invalid/);
    expect(await fails(hrSave(w.owner, { stateWithholdingState: "Minnesota" }))).toMatch(/invalid/);
    expect(await fails(hrSave(w.owner, { w4FilingStatus: "married" }))).toMatch(/invalid/);
    expect(await fails(hrSave(w.bk, { payRate: 99 }))).toMatch(/forbidden/);
    const ov = ((await as<{ r: Row }>(w.owner, "select public.pm_hr_overview() as r")).r.people as Row[]).find((p) => p.resourceId === cris)!;
    expect(ov).toMatchObject({ w4OnFile: true, bankOnFile: false });
  });

  it("bank account numbers are HR-only for employees and compliance-only for subs, with every access logged", async () => {
    await pool.query("insert into public.pm_sensitive_ids (resource_id, kind, sealed, last4) values ($1, 'bank', 'v1.aaaa.bbbb.cccc', '4321'), ($2, 'bank', 'v1.dddd.eeee.ffff', '8765')", [cris, stone]);
    expect((await as<{ r: string }>(w.owner, "select public.pm_sensitive_log($1, 'bank', 'revealed') as r", [cris])).r).toBe("4321");
    for (const u of [w.bk, w.pm, w.viewer, w.rival]) expect(await fails(as(u, "select public.pm_sensitive_log($1, 'bank', 'revealed')", [cris]))).toMatch(/forbidden/);
    expect((await as<{ r: string }>(w.owner, "select public.pm_sensitive_log($1, 'bank', 'saved') as r", [stone])).r).toBe("8765");
    expect(await fails(as(w.rival, "select public.pm_sensitive_log($1, 'bank', 'revealed')", [stone]))).toMatch(/forbidden/);
    const f = await hrGet(w.owner);
    expect(f.bank).toMatchObject({ onFile: true, last4: "4321" });
    expect(f.history).toEqual(expect.arrayContaining([expect.objectContaining({ action: "bank.revealed" })]));
    expect(JSON.stringify(f)).not.toContain("v1.aaaa");
    expect(await fails(as(w.owner, "select * from public.pm_sensitive_ids"))).toMatch(/permission denied/);
    const ov = ((await as<{ r: Row }>(w.owner, "select public.pm_hr_overview() as r")).r.people as Row[]).find((p) => p.resourceId === cris)!;
    expect(ov.bankOnFile).toBe(true);
  });

  it("subcontractor profile saves partially; endorsements and new document types are recorded", async () => {
    await as(w.owner, "select public.pm_sub_profile_save($1, $2)", [stone, { paymentTerms: "Net 30", retainagePct: 10, emr: 0.85, yearsInBusiness: 12,
      diversityCerts: ["WBE", "dbe"], achBankName: "First Bank", achAccountType: "checking", achRouting: ROUTING, prequalifiedOn: "2026-02-01" }]);
    await as(w.owner, "select public.pm_sub_profile_save($1, $2)", [stone, { backupWithholding: true, emr: "" }]);
    let r = await subGet(w.owner);
    expect(r.profile).toMatchObject({ paymentTerms: "Net 30", retainagePct: 10, emr: null, backupWithholding: true, diversityCerts: ["dbe", "wbe"], achRouting: ROUTING });
    expect(r.bank).toMatchObject({ onFile: true, last4: "8765" });
    expect(await fails(as(w.owner, "select public.pm_sub_profile_save($1, $2)", [stone, { achRouting: "111111111" }]))).toMatch(/bad_routing/);
    expect(await fails(as(w.owner, "select public.pm_sub_profile_save($1, $2)", [stone, { diversityCerts: ["fancy"] }]))).toMatch(/invalid/);
    expect(await fails(as(w.owner, "select public.pm_sub_profile_save($1, $2)", [stone, { tin: "1" }]))).toMatch(/unknown_field/);
    expect(await fails(as(w.rival, "select public.pm_sub_profile_save($1, $2)", [stone, { emr: 1 }]))).toMatch(/forbidden/);
    expect(await fails(as(w.owner, "select public.pm_sub_profile_save($1, $2)", [cris, { emr: 1 }]))).toMatch(/forbidden/);
    expect(await rows(w.rival, "select 1 from public.pm_sub_profiles")).toHaveLength(0);

    await as(w.owner, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "coi_general_liability", issuer: "Acme Mutual", policyNumber: "GL-1",
      coverageAmount: "1000000", aggregateAmount: "2000000", additionalInsured: true, waiverOfSubrogation: false, primaryNoncontributory: true, expiresOn: "2027-01-31" }]);
    await as(w.owner, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "wc_exemption", expiresOn: "2027-06-30" }]);
    await as(w.owner, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "wc_exemption", expiresOn: "2028-06-30" }]);
    await as(w.owner, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "bond", issuer: "Surety Co", coverageAmount: "50000" }]);
    expect(await fails(as(w.owner, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "coi_general_liability", additionalInsured: "maybe" }]))).toMatch(/invalid/);
    r = await subGet(w.owner);
    const docs = r.documents as Row[];
    expect(docs.find((x) => x.docType === "coi_general_liability")).toMatchObject({ aggregateAmount: 2000000, additionalInsured: true, waiverOfSubrogation: false, primaryNoncontributory: true });
    expect(docs.filter((x) => x.docType === "wc_exemption").map((x) => x.status).sort()).toEqual(["on_file", "replaced"]);
    expect(docs.find((x) => x.docType === "bond")).toMatchObject({ coverageAmount: 50000, status: "on_file" });
  });

  it("rollback restores the earlier definitions and re-apply works", async () => {
    await pool.query(readFileSync("docs/worker-invites/rollback_20270212001000.sql", "utf8"));
    await pool.query(readFileSync("docs/worker-hub/rollback_20270210001000.sql", "utf8"));
    await pool.query(readFileSync("docs/workforce-gps/rollback_20270208001000.sql", "utf8"));
    await pool.query(readFileSync("docs/hr-records/rollback_20270205001000.sql", "utf8"));
    await pool.query(readFileSync("docs/hr-records/rollback_20270205001000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.pm_sub_profiles') as a")).rows[0].a).toBeNull();
    expect((await pool.query("select count(*)::int as n from public.pm_sensitive_ids where kind = 'bank'")).rows[0].n).toBe(0);
    expect(await fails(hrSave(w.owner, { payRate: 10 }))).toMatch(/unknown_field/);
    expect((await hrGet(w.owner)).bank).toBeUndefined();
    expect((await subGet(w.owner)).profile).toBeUndefined();
    expect(await fails(as(w.owner, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "bond" }]))).toMatch(/bad_type/);
    expect(await fails(as(w.owner, "select public.pm_sensitive_log($1, 'bank', 'revealed')", [cris]))).toMatch(/forbidden/);
    await pool.query(readFileSync("supabase/migrations/20270205001000_hr_records_complete.sql", "utf8"));
    await pool.query(readFileSync("supabase/migrations/20270205001000_hr_records_complete.sql", "utf8"));
    expect(((await hrGet(w.owner)).hr as Row).pay_rate).toBeNull();
    await hrSave(w.owner, { payRate: 40 });
    expect(((await hrGet(w.owner)).hr as Row).pay_rate).toBe(40);
  });
});
