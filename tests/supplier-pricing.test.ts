import { describe, expect, it } from "vitest";
import { branchSearchUrl, connectionStatusLabel, crossCheckGroups, mapConnections, mapCrossCheck, PRICING_PROVIDERS, PROVIDER_IDS } from "@/lib/pricing/providers";
import { SUPPLIER_CONNECTORS } from "@/lib/pricing/connectors";

describe("supplier pricing providers", () => {
  it("every provider id is in the catalog once, and the SQL allow-list matches", async () => {
    expect(PRICING_PROVIDERS.map((p) => p.id).sort()).toEqual([...PROVIDER_IDS].sort());
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261211001001_supplier_pricing.sql", "utf8");
    for (const id of PROVIDER_IDS) expect(sql).toContain(`'${id}'`);
  });

  it("no live connector ships: nothing fetches supplier prices yet", () => {
    expect(SUPPLIER_CONNECTORS).toEqual([]);
  });

  it("branch search opens a map query, encoded, with or without a place", () => {
    expect(branchSearchUrl("Lowe's Home Improvement", "55401")).toBe("https://www.google.com/maps/search/?api=1&query=Lowe's%20Home%20Improvement%20near%2055401");
    expect(branchSearchUrl("84 Lumber", "  ")).toBe("https://www.google.com/maps/search/?api=1&query=84%20Lumber");
  });

  it("maps connections, dropping unknown providers", () => {
    const l = mapConnections({ canManage: true, connections: [{ provider: "abc_supply", accountRef: "1", status: "connected" }, { provider: "scraper" }] });
    expect(l.canManage).toBe(true);
    expect(l.connections).toHaveLength(1);
    expect(connectionStatusLabel(l.connections[0])).toBe("Connected");
    expect(connectionStatusLabel(undefined)).toBe("Not connected");
    expect(mapConnections(null)).toEqual({ canManage: false, connections: [] });
  });
});

describe("price cross-check", () => {
  const raw = {
    query: "osb",
    rows: [
      { supplier: "ABC Supply", product: "OSB 7/16", unit: "sheet", unitCost: "15.25", effectiveOn: "2026-11-10" },
      { supplier: "Home Lumber", product: "osb  7/16", unit: "Sheet", unitCost: 13.9 },
      { supplier: "Old Yard", product: "OSB 7/16", unit: "sheet", unitCost: 9, expired: true, expiresOn: "2026-01-01" },
      { supplier: "Solo", product: "Ridge cap", unit: "bundle", unitCost: 52 },
      { supplier: "Broken", product: "Nails", unit: "box", unitCost: null },
    ],
  };

  it("accepts numbers or numeric strings and drops rows without a real price", () => {
    const m = mapCrossCheck(raw);
    expect(m.rows.map((r) => r.unitCost)).toEqual([15.25, 13.9, 9, 52]);
  });

  it("groups the same product across suppliers, ranks current prices only, sorts by spread", () => {
    const groups = crossCheckGroups(mapCrossCheck(raw).rows);
    expect(groups.map((g) => g.product)).toEqual(["OSB 7/16", "Ridge cap"]);
    const osb = groups[0];
    expect(osb.spread).toBe(1.35);
    expect(osb.rows.map((r) => [r.supplier, r.lowest, r.overLowest])).toEqual([["Home Lumber", true, null], ["ABC Supply", false, 1.35], ["Old Yard", false, null]]);
    expect(groups[1].rows[0].lowest).toBe(false); // a single supplier is never "lowest"
    expect(groups[1].spread).toBeNull();
  });
});
