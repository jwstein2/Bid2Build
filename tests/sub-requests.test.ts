import { describe, expect, it } from "vitest";
import { complianceDigest, csvCell, daysUntil, necCsv, subRequestEmail } from "@/lib/team/sub-requests";
import { formatTaxId, normalizeTaxId, openPii, piiReady, sealPii } from "@/lib/security/pii";

const KEY = Buffer.alloc(32, 3).toString("base64");

describe("PII encryption", () => {
  it("seals and opens with the key, never the plain value in the output", () => {
    const s = sealPii("123456789", KEY);
    expect(s).toMatch(/^v1\./);
    expect(s).not.toContain("123456789");
    expect(openPii(s, KEY)).toBe("123456789");
    expect(sealPii("123456789", KEY)).not.toBe(s); // random IV
    expect(() => openPii(s.replace(/.$/, (c) => (c === "A" ? "B" : "A")), KEY)).toThrow();
  });
  it("needs a 32-byte key", () => {
    expect(piiReady("")).toBe(false);
    expect(piiReady(Buffer.alloc(16).toString("base64"))).toBe(false);
    expect(piiReady(KEY)).toBe(true);
  });
  it("normalizes and formats tax ids", () => {
    expect(normalizeTaxId("12-3456789")).toBe("123456789");
    expect(normalizeTaxId("123-45-678")).toBeNull();
    expect(formatTaxId("123456789", "ssn")).toBe("123-45-6789");
    expect(formatTaxId("123456789", "ein")).toBe("12-3456789");
  });
});

describe("sub requests and 1099 files", () => {
  it("request email lists what's asked and the link", () => {
    const m = subRequestEmail({ companyName: "Acme", subName: "Sam Stone", kinds: ["w9", "workers_comp"], note: null, link: "https://x/sub-docs/t" });
    expect(m.subject).toBe("Acme: please send your W-9 paperwork");
    expect(m.text).toMatch(/Hi Sam,/);
    expect(m.text).toMatch(/Workers' comp certificate/);
    expect(m.text).toMatch(/https:\/\/x\/sub-docs\/t/);
  });
  it("expiry digest wording", () => {
    expect(daysUntil("2026-12-01", "2026-11-30")).toBe(1);
    const m = complianceDigest({ companyName: "Acme", today: "2026-11-20", link: "L", items: [
      { subName: "A", docType: "workers_comp", expiresOn: "2026-11-19", stage: "expired" },
      { subName: "B", docType: "license", expiresOn: "2026-12-10", stage: "30_days" }] });
    expect(m.subject).toBe("1 subcontractor certificate has expired");
    expect(m.text).toMatch(/A: Workers' comp certificate expired 1 day ago/);
    expect(m.text).toMatch(/B: Contractor license expires in 20 days/);
  });
  it("CSV cells can't run formulas; e-file rows carry the full TIN", () => {
    expect(csvCell("=HYPERLINK()")).toBe("'=HYPERLINK()");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    const csv = necCsv(2026, { legalName: "Acme", ein: "12-3456789", address: null, phone: null }, [{ recipientName: "Stone", businessName: null, tinType: "ein", tin: "98-7654321", address: "9 Rock Rd", amount: "2500" }]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("2026,1099-NEC,Acme,12-3456789,,,EIN,98-7654321,Stone,,9 Rock Rd,2500.00,0.00");
  });
});
