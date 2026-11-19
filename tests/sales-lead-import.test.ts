import { describe, expect, it } from "vitest";
import { cleanRows, ImportBody, importAuthCheck, importSecretMatches } from "@/lib/sales/import";
import { verificationSources } from "@/lib/sales/crm";

const good = {
  company_name: "  Summit Roofing ", contact_name: "Dana Lee", email: "Office@SummitRoof.com", phone: "(612) 555-0100", zip: "55401",
  trades: ["roofing"], business_started: "2014-03-02",
  verification: { owner_name: ["https://mn.gov/license/123"], email: ["https://summitroof.com/contact"], phone: ["https://summitroof.com/contact"] },
};

describe("sales lead import payload", () => {
  it("keeps only verified rows and says which facts were missing", () => {
    const { valid, unverified, reasons } = cleanRows([
      good,
      { ...good, contact_name: undefined },
      { ...good, verification: { owner_name: ["https://x.org"], email: [], phone: ["https://x.org"] } },
      { ...good, business_started: "around 2010" },
      { ...good, phone: "555-0100" },
      "not an object",
    ]);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ company_name: "Summit Roofing", email: "office@summitroof.com" });
    expect(unverified).toBe(5);
    expect(reasons).toEqual(expect.arrayContaining(["contact_name", "verification.email", "business_started", "phone"]));
  });

  it("requires a batch id and caps a request at 1,000 leads", () => {
    expect(ImportBody.safeParse({ leads: [] }).success).toBe(false);
    expect(ImportBody.safeParse({ batch_id: "2026-W47", leads: [] }).success).toBe(true);
    expect(ImportBody.safeParse({ batch_id: "2026-W47", leads: Array(1001).fill({}) }).success).toBe(false);
  });

  it("lists verification sources by field, ignoring anything that isn't a web link", () => {
    expect(verificationSources({ owner_name: ["https://mn.gov/x", "javascript:alert(1)"], phone: "nope", email_domain_mx: true }))
      .toEqual([{ field: "Owner", urls: ["https://mn.gov/x"] }]);
  });

  it("matches the import secret despite common paste slips, and stays closed without one", () => {
    const secret = "a".repeat(32);
    for (const h of [`Bearer ${secret}`, `bearer ${secret}`, `Bearer  ${secret} `, secret, ` Bearer ${secret}\n`]) expect(importSecretMatches(h, `${secret}\n`)).toBe(true);
    expect(importSecretMatches(`Bearer ${secret}x`, secret)).toBe(false);
    expect(importSecretMatches(null, secret)).toBe(false);
    expect(importSecretMatches("Bearer short", "short")).toBe(false);
    expect(importSecretMatches("Bearer ", undefined)).toBe(false);
    expect(importAuthCheck(`Bearer ${secret}`, "short")).toBe("not_configured");
    expect(importAuthCheck(null, secret)).toBe("no_credentials");
    expect(importAuthCheck("Bearer nope", secret)).toBe("mismatch");
  });
});
