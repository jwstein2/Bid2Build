import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/pricing/import";
import { EMPLOYEE_COLUMNS, headerRowIndex, isTemplateExampleRow, matchHeaders, parseCell, parseDate, parseRecord, sheetToRecords, SUB_COLUMNS, templateCsv } from "@/lib/team/import";
import { HR_FIELDS, normalizeAccountNumber, routingOk } from "@/lib/team/hr";

describe("team import: templates and headers", () => {
  it("every employee HR column maps to a real HR field (or a directory/job/sensitive field)", () => {
    const other = new Set(["name", "email", "phone", "trades", "title", "payType", "hourlyCost", "hireDate", "ssn", "bankAccount"]);
    for (const c of EMPLOYEE_COLUMNS) expect(other.has(c.key) || c.key in HR_FIELDS, c.key).toBe(true);
    expect(new Set(EMPLOYEE_COLUMNS.map((c) => c.key)).size).toBe(EMPLOYEE_COLUMNS.length);
    expect(new Set(SUB_COLUMNS.map((c) => c.key)).size).toBe(SUB_COLUMNS.length);
  });

  it("the template round-trips: headers match, and the example row is skipped", () => {
    for (const kind of ["employees", "subs"] as const) {
      const table = parseCsv(templateCsv(kind));
      const { map, ignored, missingRequired } = matchHeaders(kind, table[0]);
      expect(ignored).toEqual([]);
      expect(missingRequired).toEqual([]);
      expect(map.every(Boolean)).toBe(true);
      expect(sheetToRecords(kind, table).records).toEqual([]);
      // The example values themselves are all valid.
      const raw = Object.fromEntries((map as string[]).map((k, i) => [k, table[1][i]]));
      raw.name = "Real Person";
      expect(parseRecord(kind, 2, raw).errors).toEqual([]);
    }
  });

  it("matches common payroll-export headers and builds a name from first + last", () => {
    const table = [["First Name", "Last Name", "Email Address", "Birthday", "Filing Status", "Routing #", "Department", "Shoe size"],
      ["Cristina", "Lopez", "Cris@Example.com", "4/2/1990", "Married", "011000015", "Framing", "10"]];
    const { records, ignored, missingRequired } = sheetToRecords("employees", table);
    expect(missingRequired).toEqual([]);
    expect(ignored).toEqual(["Shoe size"]);
    const row = parseRecord("employees", records[0].line, records[0].raw);
    expect(row).toMatchObject({ name: "Cristina Lopez", errors: [] });
    expect(row.values).toMatchObject({ email: "cris@example.com", dateOfBirth: "1990-04-02", w4FilingStatus: "married_jointly", ddRouting: "011000015", department: "Framing" });
  });

  it("requires a name column for subs", () => {
    expect(matchHeaders("subs", ["Email", "Phone"]).missingRequired).toEqual(["Company or person name"]);
    expect(matchHeaders("subs", ["Vendor Name", "EIN"]).missingRequired).toEqual([]);
  });
});

describe("team import: cell validation", () => {
  const col = (key: string) => [...EMPLOYEE_COLUMNS, ...SUB_COLUMNS].find((c) => c.key === key)!;

  it("dates, money, booleans and enums", () => {
    expect(parseDate("2026-03-02")).toBe("2026-03-02");
    expect(parseDate("3/2/26")).toBe("2026-03-02");
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseCell(col("payRate"), "$1,250.50").value).toBe(1250.5);
    expect(parseCell(col("payRate"), "abc").error).toMatch(/isn't a number/);
    expect(parseCell(col("w4Exempt"), "Y").value).toBe(true);
    expect(parseCell(col("w4Exempt"), "maybe").error).toMatch(/yes \/ no/);
    expect(parseCell(col("employmentType"), "FT").value).toBe("full_time");
    expect(parseCell(col("flsaStatus"), "Non-exempt").value).toBe("non_exempt");
    expect(parseCell(col("payFrequency"), "bi-weekly").value).toBe("biweekly");
    expect(parseCell(col("taxClassification"), "S corp").value).toBe("s_corp");
    expect(parseCell(col("stateWithholdingState"), "mn").value).toBe("MN");
    expect(parseCell(col("stateWithholdingState"), "Minnesota").error).toBeTruthy();
    expect(parseCell(col("diversityCerts"), "WBE; 8(a)").value).toEqual(["wbe", "8a"]);
  });

  it("sensitive numbers: SSN, TIN (9 digits or last 4), routing checksum, account number", () => {
    expect(parseCell(col("ssn"), "123-45-6789").value).toBe("123456789");
    expect(parseCell(col("ssn"), "6789").error).toBeTruthy();
    expect(parseCell(col("tin"), "12-3456789").value).toBe("123456789");
    expect(parseCell(col("tin"), "6789").value).toBe("6789");
    expect(parseCell(col("ddRouting"), "123456789").error).toMatch(/routing/);
    expect(routingOk("011000015")).toBe(true);
    expect(routingOk("021000021")).toBe(true);
    expect(normalizeAccountNumber("0012 3456 789")).toBe("00123456789");
    expect(normalizeAccountNumber("12")).toBeNull();
  });

  it("refuses spreadsheet formulas instead of reading them", () => {
    expect(parseCell(col("name"), "=HYPERLINK(\"x\")").error).toMatch(/formula/);
    const row = parseRecord("subs", 3, { name: "+cmd|calc" });
    expect(row.errors.length).toBeGreaterThan(0);
  });

  it("a 9-digit TIN without a type guesses EIN for companies and SSN for individuals", () => {
    expect(parseRecord("subs", 2, { name: "Stone Works", tin: "123456789" }).values.tinType).toBe("ein");
    expect(parseRecord("subs", 2, { name: "Joe Tile", entity: "individual", tin: "123456789" }).values.tinType).toBe("ssn");
  });
});

describe("team import: real exports", () => {
  it("skips the report title rows a QuickBooks vendor list starts with", () => {
    const table = [["Practice Builders"], ["Vendor Contact List"], ["All Dates"], [], ["Vendor", "Phone Numbers", "Email", "Full Name", "Address", "Account #"],
      ["Sample Lumber Supply", "(651) 555-0301", "orders@lumber.example", "Pat Sample", "100 Example Ave", ""]];
    expect(headerRowIndex("subs", table)).toBe(4);
    const { records, missingRequired } = sheetToRecords("subs", table);
    expect(missingRequired).toEqual([]);
    expect(records).toEqual([{ line: 6, raw: { name: "Sample Lumber Supply", email: "orders@lumber.example", w9Address: "100 Example Ave" } }]);
  });
  it("a header in the first row still starts at row 1", () => expect(headerRowIndex("employees", [["Name", "Work email"], ["Cris", ""]])).toBe(0));
  it("only the template's own example row is skipped; a real company named Example is imported", () => {
    expect(isTemplateExampleRow("EXAMPLE Cris Lopez (delete this row)")).toBe(true);
    expect(isTemplateExampleRow("Example Roofing LLC")).toBe(false);
    const { records } = sheetToRecords("subs", [["Company or person name"], ["Example Roofing LLC"], ["EXAMPLE Stone Works LLC (delete this row)"]]);
    expect(records.map((r) => r.raw.name)).toEqual(["Example Roofing LLC"]);
  });
});
