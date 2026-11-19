import { describe, expect, it } from "vitest";
import { cleanRows, ImportBody } from "@/lib/sales/import";

describe("sales lead import payload", () => {
  it("keeps valid rows and counts bad ones without failing the run", () => {
    const { valid, invalid } = cleanRows([
      { company_name: "  Summit Roofing ", phone: "612-555-0100", trades: ["roofing"] },
      { company_name: "" },
      "not an object",
      { company_name: "X".repeat(201) },
      { company_name: "Bright Deck", website: "brightdeck.com", notes: null },
    ]);
    expect(valid.map((v) => v.company_name)).toEqual(["Summit Roofing", "Bright Deck"]);
    expect(invalid).toBe(3);
  });

  it("requires a batch id and caps a request at 1,000 leads", () => {
    expect(ImportBody.safeParse({ leads: [] }).success).toBe(false);
    expect(ImportBody.safeParse({ batch_id: "2026-W47", leads: [] }).success).toBe(true);
    expect(ImportBody.safeParse({ batch_id: "2026-W47", leads: Array(1001).fill({}) }).success).toBe(false);
  });
});
