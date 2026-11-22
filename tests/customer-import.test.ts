import { describe, expect, it } from "vitest";
import { classifyRows, cleanPhone, findHeaderRow, parseCustomer, sheetToCustomerRecords, customerTemplateCsv, type CustomerRow } from "@/lib/customers/import";
import { parseCsv } from "@/lib/pricing/import";

const rowsOf = (table: string[][]) => sheetToCustomerRecords(table).records.map((r) => parseCustomer(r.line, r.raw));

describe("customer import: QuickBooks Online Customers → Export to Excel", () => {
  const table = [
    ["Customer", "Company", "Street Address", "City", "State", "Country", "Zip", "Phone", "Email", "Attachments", "Open Balance", "Notes"],
    ["Jane Doe", "", "123 Main St", "St. Paul", "MN", "USA", "55101", "(555) 201-4410", "Jane@Example.com", "", "1,250.00", "Gate code 4410"],
    ["Lee Property Group", "Lee Property Group", "900 Oak Ave", "Minneapolis", "MN", "", "55401", "555.201.5520", "pat@leeproperty.com", "", "0.00", ""],
    ["Lee Property Group:Roof job", "", "", "", "", "", "", "", "", "", "", ""],
  ];
  const p = rowsOf(table);
  it("maps columns, builds the address and keeps the open balance in notes", () => {
    expect(p[0].row).toEqual({ name: "Jane Doe", customerType: "person", email: "jane@example.com", phone: "(555) 201-4410", projectAddress: "123 Main St, St. Paul, MN 55101", notes: "Gate code 4410\nOpen balance in QuickBooks at import: $1250.00" });
    expect(p[1].row).toMatchObject({ name: "Lee Property Group", customerType: "business", companyName: "Lee Property Group" });
    expect(p[1].row?.notes).toBeUndefined();
  });
  it("skips sub-customers / jobs", () => {
    expect(p[2].row).toBeNull();
    expect(p[2].skip).toMatch(/sub-customer/);
  });
});

describe("customer import: Customer Contact List report with title rows and footer", () => {
  const table = [
    ["AOS Home Solutions"], ["Customer Contact List"], ["All Dates"], [],
    ["", "Customer", "Phone Numbers", "Email", "Full Name", "Billing Address", "Shipping Address"],
    ["", "Acme Roofing", "Phone: 555-201-4410 Mobile: 555-201-9999", "ops@acme.com", "Dana Ruiz", "1 Elm St, Duluth, MN 55802", ""],
    ["", "Sam Park", "", "", "Sam Park", "", "7 Pine Rd, Edina, MN 55424"],
    [], ["Accrual basis Sunday, November 22, 2026 07:12 AM GMT-06:00"],
  ];
  it("finds the header below the title", () => expect(findHeaderRow(table)).toBe(4));
  it("treats Customer as the business when Full Name differs", () => {
    const p = rowsOf(table).filter((x) => x.row);
    expect(p[0].row).toMatchObject({ name: "Dana Ruiz", companyName: "Acme Roofing", customerType: "business", phone: "555-201-4410", projectAddress: "1 Elm St, Duluth, MN 55802" });
    expect(p[1].row).toMatchObject({ name: "Sam Park", customerType: "person", projectAddress: "7 Pine Rd, Edina, MN 55424" });
  });
  it("drops the report footer", () => {
    const all = rowsOf(table);
    expect(all.filter((x) => x.row)).toHaveLength(2);
  });
});

describe("customer import: QuickBooks Desktop / generic", () => {
  it("joins first and last name and flags a bad email", () => {
    const [p] = rowsOf([["First Name", "Last Name", "Main Email", "Main Phone"], ["Ana", "Lopez", "not-an-email", "555 201 4412"]]);
    expect(p.row).toMatchObject({ name: "Ana Lopez", phone: "555 201 4412" });
    expect(p.row?.email).toBeUndefined();
    expect(p.warnings[0]).toMatch(/isn't valid/);
  });
  it("template example rows are skipped and the header is recognized", () => {
    const p = rowsOf(parseCsv(customerTemplateCsv()));
    expect(p.every((x) => x.row === null)).toBe(true);
  });
  it("a real customer named Example is imported; only the template row is skipped", () => {
    const p = rowsOf([["Customer"], ["Example Roofing LLC"], ["Example: Jane Doe"]]);
    expect(p.map((x) => x.row?.name ?? null)).toEqual(["Example Roofing LLC", null]);
  });
  it("no name column means no header", () => expect(sheetToCustomerRecords([["Amount", "Date"], ["1", "2"]]).headerFound).toBe(false));
  it("cleanPhone strips labels", () => expect(cleanPhone("Mobile: +1 (555) 201-4410")).toBe("+1 (555) 201-4410"));
});

describe("duplicate detection", () => {
  const r = (line: number, row: Partial<CustomerRow>) => ({ line, row: { customerType: "person" as const, name: "x", ...row } });
  const existing = [{ name: "Jane Doe", email: "JANE@example.com", phone: "555-201-4410" }, { name: "Bob Ray" }];
  it("matches existing customers by email, then phone, then name", () => {
    const s = classifyRows([r(2, { name: "J. Doe", email: "jane@example.com " }), r(3, { name: "Other", phone: "+1 555 201 4410" }), r(4, { name: "bob  ray" }), r(5, { name: "New Person" })], existing);
    expect(s.map((x) => (x.status === "duplicate" ? x.reason : "new"))).toEqual(["email", "phone", "name", "new"]);
  });
  it("catches repeats inside the file", () => {
    const s = classifyRows([r(2, { name: "Kim", email: "k@x.com" }), r(3, { name: "Kim B", email: "K@x.com" })], []);
    expect(s[1]).toMatchObject({ status: "duplicate", inFile: true, match: "row 2" });
  });
  it("allowNameOnly lets same-name rows through but still blocks email matches", () => {
    const s = classifyRows([r(2, { name: "Bob Ray", email: "bob2@x.com" }), r(3, { name: "Jane", email: "jane@example.com" })], existing, true);
    expect(s.map((x) => x.status)).toEqual(["new", "duplicate"]);
  });
});
