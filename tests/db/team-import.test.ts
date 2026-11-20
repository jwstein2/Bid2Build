/**
 * Spreadsheet import of employees and subcontractors (runImport), end to end against the real SQL:
 *   - creates people, then a second import updates them (matched by email / name) without erasing blank cells
 *   - HR columns are saved for the owner; a manager without HR access gets the directory entry and a warning
 *   - SSN / TIN / bank numbers are stored encrypted (never in plain text), W-9 fields merge, certificates don't duplicate
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { asUser, dbAvailable, freshDb, type Row } from "./harness";
import { setupWorld, type World } from "./fin-fixtures";

let pool: Pool;
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      upsert: async (o: Row) => {
        if (table !== "pm_sensitive_ids") throw new Error("unexpected table");
        await pool.query(`insert into public.pm_sensitive_ids (resource_id, kind, sealed, last4, updated_by) values ($1, $2, $3, $4, $5)
          on conflict (resource_id, kind) do update set sealed = excluded.sealed, last4 = excluded.last4`, [o.resource_id, o.kind, o.sealed, o.last4, o.updated_by]);
        return { error: null };
      },
    }),
  }),
}));
process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const { runImport } = await import("@/lib/team/import-server");
const { openPii } = await import("@/lib/security/pii");

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let drop: () => Promise<void>;
let w: World;

/** A Supabase-like client whose rpc() runs as the given user. */
const dbAs = (u: string) => ({
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    const keys = Object.keys(args);
    try {
      const r = await asUser(pool, u, (q) => q(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k])));
      return { data: r.rows[0].r, error: null };
    } catch (e) { return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } }; }
  },
}) as never;

d("team import (database)", () => {
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_team_import"));
    w = await setupWorld(pool);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("imports employees with HR details and encrypted numbers, then updates them on a second import", async () => {
    const first = await runImport(dbAs(w.owner), w.owner, "employees", [
      { line: 2, raw: { name: "Cris Lopez", email: "cris@example.com", title: "Lead carpenter", payType: "Hourly", hireDate: "3/2/2026", legalFirstName: "Cristina",
        legalLastName: "Lopez", emergency1Name: "Ana Lopez", emergency1Phone: "555-0101", payRate: "32.50", payFrequency: "Every 2 weeks", w4FilingStatus: "Married",
        ddRouting: "011000015", ssn: "123-45-6789", bankAccount: "000123456789" } },
      { line: 3, raw: { name: "Bo Foreman", trades: "framing; roofing" } },
      { line: 4, raw: { name: "Bad Row", dateOfBirth: "someday" } },
    ], false);
    expect(first.map((r) => r.action)).toEqual(["created", "created", "failed"]);
    expect(first[0].warnings).toEqual([]);
    expect(first[2].message).toMatch(/Date of birth/);
    const cris = (await pool.query("select id from public.pm_resources where name = 'Cris Lopez'")).rows[0].id;
    const hr = (await pool.query("select * from public.pm_employee_hr where resource_id = $1", [cris])).rows[0];
    expect(hr).toMatchObject({ legal_first_name: "Cristina", emergency1_phone: "555-0101", pay_frequency: "biweekly", w4_filing_status: "married_jointly", dd_routing: "011000015" });
    expect(Number(hr.pay_rate)).toBe(32.5);
    const sens = (await pool.query("select kind, sealed, last4 from public.pm_sensitive_ids where resource_id = $1 order by kind", [cris])).rows;
    expect(sens.map((s) => [s.kind, s.last4])).toEqual([["bank", "6789"], ["ssn", "6789"]]);
    expect(openPii(sens[1].sealed)).toBe("123456789");
    expect(JSON.stringify(sens)).not.toContain("123456789");
    expect((await pool.query("select count(*)::int as n from public.pm_sensitive_access_log where resource_id = $1 and action = 'saved'", [cris])).rows[0].n).toBe(2);
    expect((await pool.query("select title, pay_type, hire_date::text from public.pm_employee_profiles where resource_id = $1", [cris])).rows[0]).toEqual({ title: "Lead carpenter", pay_type: "hourly", hire_date: "2026-03-02" });

    // Dry run tells which rows already exist; the second import updates by email without erasing anything left blank.
    const plan = await runImport(dbAs(w.owner), w.owner, "employees", [{ line: 2, raw: { name: "Cristina Lopez", email: "CRIS@example.com" } }, { line: 3, raw: { name: "New Person" } }], true);
    expect(plan.map((r) => r.action)).toEqual(["match", "new"]);
    const second = await runImport(dbAs(w.owner), w.owner, "employees", [{ line: 2, raw: { name: "Cristina Lopez", email: "cris@example.com", city: "St. Paul" } }], false);
    expect(second[0].action).toBe("updated");
    const after = (await pool.query("select r.name, h.city, h.legal_first_name, p.title from public.pm_resources r join public.pm_employee_hr h on h.resource_id = r.id join public.pm_employee_profiles p on p.resource_id = r.id where r.id = $1", [cris])).rows[0];
    expect(after).toEqual({ name: "Cristina Lopez", city: "St. Paul", legal_first_name: "Cristina", title: "Lead carpenter" });
    expect((await pool.query("select count(*)::int as n from public.pm_resources where kind = 'staff'")).rows[0].n).toBe(2);
  });

  it("a team manager without HR access adds people but HR columns are skipped with a warning", async () => {
    const r = await runImport(dbAs(w.pm), w.pm, "employees", [{ line: 2, raw: { name: "Pat Helper", personalPhone: "555-0199", ssn: "987654321" } }], false);
    expect(r[0].action).toBe("created");
    expect(r[0].warnings.join(" ")).toMatch(/only the owner and HR managers/);
    const id = (await pool.query("select id from public.pm_resources where name = 'Pat Helper'")).rows[0].id;
    expect((await pool.query("select count(*)::int as n from public.pm_employee_hr where resource_id = $1", [id])).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int as n from public.pm_sensitive_ids where resource_id = $1", [id])).rows[0].n).toBe(0);
  });

  it("imports subcontractors with W-9, business profile, ACH and certificates; re-importing doesn't duplicate", async () => {
    const row = { name: "Stone Works LLC", entity: "Company", email: "office@stone.example", trades: "masonry", legalName: "Stone Works LLC", taxClassification: "LLC taxed as a partnership",
      tin: "12-3456789", w9SignedOn: "2026-01-15", paymentTerms: "Net 30", retainagePct: "10%", emr: "0.85", diversityCerts: "WBE", achRouting: "011000015", achAccount: "55554444",
      glInsurer: "Acme Mutual", glPolicy: "GL-1", glEachOccurrence: "1,000,000", glAggregate: "2000000", glExpires: "2027-01-31", glAdditionalInsured: "yes", glWaiver: "no",
      wcPolicy: "WC-9", wcExpires: "2027-01-31", licenseNumber: "BC123", licenseIssuer: "Minnesota DLI", licenseExpires: "2028-03-31" };
    const r = await runImport(dbAs(w.owner), w.owner, "subs", [{ line: 2, raw: row }], false);
    expect(r[0]).toMatchObject({ action: "created", warnings: [] });
    const id = (await pool.query("select id from public.pm_resources where name = 'Stone Works LLC'")).rows[0].id;
    expect((await pool.query("select legal_name, tax_classification, tin_type, tin_last4 from public.pm_sub_tax_profiles where resource_id = $1", [id])).rows[0])
      .toEqual({ legal_name: "Stone Works LLC", tax_classification: "llc_p", tin_type: "ein", tin_last4: "6789" });
    const prof = (await pool.query("select payment_terms, retainage_pct::float, emr::float, diversity_certs, ach_routing from public.pm_sub_profiles where resource_id = $1", [id])).rows[0];
    expect(prof).toEqual({ payment_terms: "Net 30", retainage_pct: 10, emr: 0.85, diversity_certs: ["wbe"], ach_routing: "011000015" });
    expect((await pool.query("select kind, last4 from public.pm_sensitive_ids where resource_id = $1 order by kind", [id])).rows).toEqual([{ kind: "bank", last4: "4444" }, { kind: "tin", last4: "6789" }]);
    const docs = (await pool.query("select doc_type, policy_number, coverage_amount::float, aggregate_amount::float, additional_insured, waiver_of_subrogation from public.pm_sub_documents where resource_id = $1 and status = 'on_file' order by doc_type", [id])).rows;
    expect(docs).toEqual([
      { doc_type: "coi_general_liability", policy_number: "GL-1", coverage_amount: 1000000, aggregate_amount: 2000000, additional_insured: true, waiver_of_subrogation: false },
      { doc_type: "license", policy_number: "BC123", coverage_amount: null, aggregate_amount: null, additional_insured: null, waiver_of_subrogation: null },
      { doc_type: "workers_comp", policy_number: "WC-9", coverage_amount: null, aggregate_amount: null, additional_insured: null, waiver_of_subrogation: null },
    ]);
    // Same file again: matched, nothing duplicated. Then a W-9 change keeps the other W-9 fields.
    expect((await runImport(dbAs(w.owner), w.owner, "subs", [{ line: 2, raw: row }], false))[0].action).toBe("updated");
    await runImport(dbAs(w.owner), w.owner, "subs", [{ line: 2, raw: { name: "Stone Works LLC", w9Address: "40 Quarry Rd" } }], false);
    expect((await pool.query("select count(*)::int as n from public.pm_sub_documents where resource_id = $1", [id])).rows[0].n).toBe(3);
    expect((await pool.query("select legal_name, address, tin_last4 from public.pm_sub_tax_profiles where resource_id = $1", [id])).rows[0]).toEqual({ legal_name: "Stone Works LLC", address: "40 Quarry Rd", tin_last4: "6789" });
    // Two subs with the same name and no email can't be told apart.
    await pool.query("insert into public.pm_resources (company_id, kind, name) values ($1, 'subcontractor', 'Twin Co'), ($1, 'subcontractor', 'Twin Co')", [w.company]);
    expect((await runImport(dbAs(w.owner), w.owner, "subs", [{ line: 2, raw: { name: "Twin Co" } }], false))[0].message).toMatch(/More than one/);
  });
});
