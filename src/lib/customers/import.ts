/**
 * Customer list import (Customers → Import). Pure helpers shared by the import page, the import route and tests.
 *
 * Built for the files contractors actually have: a QuickBooks Online customer export (Customers → Export to Excel:
 * Customer, Company, Street Address, City, State, Country, Zip, Phone, Email, Attachments, Open Balance, Notes), the
 * QuickBooks "Customer Contact List" report (Customer, Phone Numbers, Email, Full Name, Billing Address, Shipping
 * Address), a QuickBooks Desktop customer export (Customer, Company, First Name, Last Name, Main Phone, Main Email,
 * Bill to 1-5 …), or any spreadsheet with a name column. Report title rows above the header and the "Accrual basis …"
 * footer are skipped.
 *
 * Duplicates are never imported: a row matching a customer already in Built2Bid (same email, same phone, or the same
 * name) or an earlier row of the same file is skipped. Rows that match only by name can be let through on purpose
 * (two different "John Smith"s). Nothing here talks to the database.
 */

export const MAX_CUSTOMER_ROWS = 5000;
export const CUSTOMER_IMPORT_CHUNK = 100;

export type CustomerField =
  | "displayName" | "contactName" | "companyName" | "firstName" | "lastName" | "email" | "phone" | "mobile"
  | "address" | "shipAddress" | "street" | "street2" | "city" | "state" | "zip" | "country" | "notes" | "openBalance";

/** Header words we accept for each field (lowercased, punctuation folded to spaces before matching). */
const ALIASES: Record<CustomerField, string[]> = {
  displayName: ["customer", "customer name", "name", "display name", "customer display name", "customer full name", "client", "client name"],
  contactName: ["full name", "contact", "contact name", "primary contact", "main contact"],
  companyName: ["company", "company name", "business", "business name", "organization"],
  firstName: ["first name", "given name", "first"],
  lastName: ["last name", "family name", "surname", "last"],
  email: ["email", "email address", "e mail", "main email", "primary email", "billing email"],
  phone: ["phone", "phone number", "phone numbers", "main phone", "work phone", "telephone", "home phone", "primary phone", "business phone"],
  mobile: ["mobile", "mobile phone", "cell", "cell phone", "mobile number"],
  address: ["address", "billing address", "bill to", "full address", "project address", "service address", "job address", "bill address"],
  shipAddress: ["shipping address", "ship to", "ship address", "delivery address"],
  street: ["street", "street address", "billing street", "billing address line 1", "billing address 1", "address line 1", "address 1", "bill to 1", "billing street address"],
  street2: ["address line 2", "address 2", "billing address line 2", "billing address 2", "bill to 2", "apt", "suite", "unit"],
  city: ["city", "billing city", "town", "bill to city"],
  state: ["state", "billing state", "province", "state province", "billing state province", "region", "bill to state"],
  zip: ["zip", "zip code", "zipcode", "postal code", "postcode", "billing zip", "billing zip code", "billing postal code", "bill to zip"],
  country: ["country", "billing country"],
  notes: ["notes", "note", "memo", "comments", "customer notes"],
  openBalance: ["open balance", "balance", "balance total", "customer balance"],
};

/** What the import page shows as "columns we read". */
export const CUSTOMER_FIELD_LABELS: Record<CustomerField, string> = {
  displayName: "Customer / Name", contactName: "Full name / Contact", companyName: "Company", firstName: "First name", lastName: "Last name",
  email: "Email", phone: "Phone", mobile: "Mobile", address: "Billing address", shipAddress: "Shipping address", street: "Street address",
  street2: "Address line 2", city: "City", state: "State", zip: "ZIP", country: "Country", notes: "Notes", openBalance: "Open balance",
};

const NAME_FIELDS: CustomerField[] = ["displayName", "contactName", "companyName", "firstName", "lastName"];
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const LOOKUP = new Map<string, CustomerField>(Object.entries(ALIASES).flatMap(([k, v]) => v.map((a) => [fold(a), k as CustomerField] as const)));

export function matchCustomerHeaders(headers: string[]): { map: (CustomerField | null)[]; ignored: string[] } {
  const used = new Set<CustomerField>();
  const ignored: string[] = [];
  const map = headers.map((h) => {
    const k = LOOKUP.get(fold(String(h ?? "")));
    if (!k || used.has(k)) { if (String(h ?? "").trim()) ignored.push(String(h).trim()); return null; }
    used.add(k);
    return k;
  });
  return { map, ignored };
}

/** The header is the first row (of the first 15) that names a customer column; QuickBooks reports put a title above it. */
export function findHeaderRow(table: string[][]): number {
  for (let i = 0; i < Math.min(table.length, 15); i++) {
    const { map } = matchCustomerHeaders(table[i] ?? []);
    if (map.some((k) => k && NAME_FIELDS.includes(k))) return i;
  }
  return -1;
}

export type RawCustomer = Partial<Record<CustomerField, string>>;

export function sheetToCustomerRecords(table: string[][]): { records: { line: number; raw: RawCustomer }[]; ignored: string[]; headerFound: boolean } {
  const h = findHeaderRow(table);
  if (h < 0) return { records: [], ignored: [], headerFound: false };
  const { map, ignored } = matchCustomerHeaders(table[h]);
  const records: { line: number; raw: RawCustomer }[] = [];
  for (let i = h + 1; i < table.length && records.length < MAX_CUSTOMER_ROWS; i++) {
    const raw: RawCustomer = {};
    map.forEach((k, j) => { const v = String(table[i]?.[j] ?? "").trim(); if (k && v) raw[k] = v; });
    if (Object.keys(raw).length === 0) continue;
    records.push({ line: i + 1, raw });
  }
  return { records, ignored, headerFound: true };
}

/** A clean customer ready to save (same limits as the customers table). */
export interface CustomerRow {
  name: string; companyName?: string; customerType: "person" | "business";
  email?: string; phone?: string; projectAddress?: string; notes?: string;
}
export interface ParsedCustomer { line: number; row: CustomerRow | null; skip?: string; warnings: string[] }

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const cut = (s: string | undefined, n: number) => (s ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");
const US = new Set(["us", "usa", "u s a", "united states", "united states of america"]);

/** "Phone: 555-201-4410 Mobile: 555-…" (Customer Contact List) -> "555-201-4410". */
export function cleanPhone(v: string | undefined): string {
  if (!v) return "";
  const m = v.match(/(\+?\d[\s.\-]?)?\(?\d[\d\s().\-]{5,}\d(\s*(x|ext\.?)\s*\d+)?/i);
  return cut(m ? m[0] : v.replace(/^[a-z ]+:\s*/i, ""), 50);
}

export function parseCustomer(line: number, r: RawCustomer): ParsedCustomer {
  const warnings: string[] = [];
  const display = cut(r.displayName, 200);
  // QuickBooks sub-customers / jobs are "Parent:Job"; the parent is its own row.
  if (display.includes(":")) return { line, row: null, skip: "QuickBooks sub-customer or job (the parent customer is imported instead)", warnings };
  // Only the template's own sample row ("Example: Jane Doe"); a real customer named "Example Roofing" is kept.
  const templateRow = (v: string) => /^\s*example\s*:/i.test(v) || /\(delete this row\)\s*$/i.test(v);
  if (templateRow(display) || templateRow(cut(r.contactName, 50))) return { line, row: null, skip: "Example row from the template", warnings };
  const nameOnly = Object.keys(r).length === 1 && display;
  if (nameOnly && /(accrual|cash) basis|^total\b|^grand total/i.test(display)) return { line, row: null, skip: "Report footer", warnings };
  const first = cut(r.firstName, 100), last = cut(r.lastName, 100);
  const contact = cut(r.contactName, 200) || cut([first, last].filter(Boolean).join(" "), 200);
  let company = cut(r.companyName, 200);
  // Contact List report: "Customer" is the business, "Full Name" the person.
  if (!company && contact && display && customerNorm(contact) !== customerNorm(display)) company = display;
  const name = contact || display || company;
  if (!name) return { line, row: null, skip: "No name", warnings };

  let email = "";
  if (r.email) {
    const all = r.email.split(/[,;\s]+/).filter(Boolean);
    if (all[0] && EMAIL_RE.test(all[0])) { email = cut(all[0], 320).toLowerCase(); if (all.length > 1) warnings.push("Only the first email was kept"); }
    else warnings.push(`Email “${cut(r.email, 60)}” isn't valid and was left off`);
  }
  const phone = cleanPhone(r.phone) || cleanPhone(r.mobile);

  let address = cut(r.address, 500);
  if (!address) {
    const cityLine = [r.city?.trim(), [r.state?.trim(), r.zip?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const country = r.country?.trim() && !US.has(fold(r.country)) ? r.country.trim() : "";
    address = cut([r.street, r.street2, cityLine, country].map((x) => x?.trim()).filter(Boolean).join(", "), 500);
  }
  if (!address && r.shipAddress) address = cut(r.shipAddress, 500);

  const noteParts = [r.notes?.trim() ?? ""];
  const bal = r.openBalance ? Number(r.openBalance.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1")) : 0;
  if (Number.isFinite(bal) && bal !== 0) noteParts.push(`Open balance in QuickBooks at import: $${bal.toFixed(2)}`);
  const notes = noteParts.filter(Boolean).join("\n").slice(0, 4000);

  const row: CustomerRow = { name, customerType: company ? "business" : "person" };
  if (company) row.companyName = company;
  if (email) row.email = email;
  if (phone) row.phone = phone;
  if (address) row.projectAddress = address;
  if (notes) row.notes = notes;
  return { line, row, warnings };
}

// --- Duplicate detection (same rules as public.customer_norm / customer_email_key / customer_phone_key) -----------
export const customerNorm = (p: string | null | undefined) => (p ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const emailKey = (p: string | null | undefined) => { const s = (p ?? "").trim().toLowerCase(); return s.indexOf("@") > 0 ? s : ""; };
export const phoneKey = (p: string | null | undefined) => { const d = (p ?? "").replace(/\D/g, ""); return d.length >= 7 ? d.slice(-10) : ""; };

export type DupReason = "email" | "phone" | "name";
export interface ExistingCustomer { name: string; email?: string | null; phone?: string | null; company_name?: string | null }

export class DuplicateIndex {
  private email = new Map<string, string>(); private phone = new Map<string, string>(); private name = new Map<string, string>();
  add(c: ExistingCustomer, label = c.name) {
    const e = emailKey(c.email), p = phoneKey(c.phone);
    if (e && !this.email.has(e)) this.email.set(e, label);
    if (p && !this.phone.has(p)) this.phone.set(p, label);
    for (const n of [customerNorm(c.name), customerNorm(c.company_name)]) if (n && !this.name.has(n)) this.name.set(n, label);
  }
  find(r: CustomerRow): { reason: DupReason; match: string } | null {
    const e = emailKey(r.email), p = phoneKey(r.phone), n = customerNorm(r.name);
    if (e && this.email.has(e)) return { reason: "email", match: this.email.get(e)! };
    if (p && this.phone.has(p)) return { reason: "phone", match: this.phone.get(p)! };
    if (n && this.name.has(n)) {
      // Same name but a different email or phone on both sides is probably a different person: still flag it as a name match.
      return { reason: "name", match: this.name.get(n)! };
    }
    return null;
  }
}

export type RowStatus =
  | { line: number; status: "new" }
  | { line: number; status: "duplicate"; reason: DupReason; match: string; inFile: boolean };

/**
 * Classify rows against existing customers and earlier rows of the same file. With allowNameOnly, rows matching only
 * by name are treated as new. Rows marked new are added to the index, so a later copy in the file becomes a duplicate.
 */
export function classifyRows(rows: { line: number; row: CustomerRow }[], existing: ExistingCustomer[], allowNameOnly = false): RowStatus[] {
  const db = new DuplicateIndex();
  for (const c of existing) db.add(c);
  const file = new DuplicateIndex();
  return rows.map(({ line, row }) => {
    const hitDb = db.find(row);
    if (hitDb && !(allowNameOnly && hitDb.reason === "name")) return { line, status: "duplicate", reason: hitDb.reason, match: hitDb.match, inFile: false };
    const hitFile = file.find(row);
    if (hitFile && !(allowNameOnly && hitFile.reason === "name")) return { line, status: "duplicate", reason: hitFile.reason, match: hitFile.match, inFile: true };
    file.add({ name: row.name, email: row.email, phone: row.phone, company_name: row.companyName }, `row ${line}`);
    return { line, status: "new" };
  });
}

export function dupWords(s: Extract<RowStatus, { status: "duplicate" }>): string {
  const by = s.reason === "email" ? "same email" : s.reason === "phone" ? "same phone" : "same name";
  return s.inFile ? `Repeats ${s.match} in this file (${by})` : `Already in Built2Bid as ${s.match} (${by})`;
}

export function customerTemplateCsv(): string {
  return [
    "Customer,Company,Email,Phone,Street Address,City,State,Zip,Notes",
    "Example: Jane Doe,,jane@example.com,555-201-4410,123 Main St,St. Paul,MN,55101,Gate code 4410",
    "Example: Pat Lee,Lee Property Group,pat@leeproperty.com,555-201-5520,900 Oak Ave,Minneapolis,MN,55401,",
  ].join("\n") + "\n";
}
