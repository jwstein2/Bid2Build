import { describe, expect, it } from "vitest";
import { D } from "@/lib/estimate/money";
import { applyRows, autoMap, buildPreview, parseCsv, parsePrice, sheetToRows } from "@/lib/pricing/import";
import { belowTargetMargin, canRefresh, refreshPreview } from "@/lib/pricing/refresh";
import { connectorRowsToTable, mockSupplierConnector, SUPPLIER_CONNECTORS } from "@/lib/pricing/connectors";
import type { LineItem } from "@/lib/estimate/types";

const CSV = `﻿Item #,Description,UOM,Net Price,Pack Qty
GAF-TL-01,Architectural shingles,BDL,"$41.25",
UDL-10,"Synthetic underlayment, 10 sq",RL,89.00,
NAIL-1,"Coil nails 1-1/4""",BX,"$120.00",4
DRIP-8,Drip edge 8ft,EA,abc,
X-1,,EA,3,
GAF-TL-01,Architectural shingles dup,BDL,41.25,
RIDGE,Ridge cap,BDL,90.00,
`;

const library = [
  { id: "a", name: "Architectural Shingles", unit: "bundle", unitCost: "38.50", supplierSku: null },
  { id: "b", name: "Ridge cap", unit: "bundle", unitCost: "60" },
  { id: "c", name: "Coil nails 1-1/4\"", unit: "each", unitCost: "30", supplierSku: "NAIL-1" },
];

describe("supplier CSV parsing + mapping", () => {
  it("parses quotes, escaped quotes, commas in fields and a BOM", () => {
    const rows = parseCsv(CSV);
    expect(rows[0]).toEqual(["Item #", "Description", "UOM", "Net Price", "Pack Qty"]);
    expect(rows[2][1]).toBe("Synthetic underlayment, 10 sq");
    expect(rows[3][1]).toBe('Coil nails 1-1/4"');
    expect(rows).toHaveLength(8);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\r\n1\t2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("guesses columns from common supplier headers", () => {
    expect(autoMap(["Item #", "Description", "UOM", "Net Price", "Pack Qty"])).toEqual({ sku: 0, name: 1, unit: 2, unitCost: 3, packSize: 4, category: null });
    expect(autoMap(["SKU", "Product Name", "Unit", "Your Cost", "Category"])).toMatchObject({ sku: 0, name: 1, unit: 2, unitCost: 3, category: 4 });
  });

  it("reads prices safely", () => {
    expect(parsePrice("$1,234.50")).toBe("1234.5");
    expect(parsePrice("-3")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("")).toBeNull();
  });

  it("turns spreadsheet cells into rows", () => {
    expect(sheetToRows([["SKU", "Price"], ["A", 12.5], [null, null], ["B", new Date("2026-11-01T00:00:00Z")]])).toEqual([["SKU", "Price"], ["A", "12.5"], ["B", "2026-11-01"]]);
  });
});

describe("import preview", () => {
  const rows = parseCsv(CSV);
  const p = buildPreview({ rows, mapping: autoMap(rows[0]), items: library });
  const at = (line: number) => p.rows.find((r) => r.line === line)!;

  it("classifies every row before anything is written", () => {
    expect(p.counts).toEqual({ new: 1, changed: 3, unchanged: 0, invalid: 2, duplicate: 1 });
    expect(at(2)).toMatchObject({ status: "changed", unit: "bundle", unitCost: "41.25", match: { id: "a", by: "name" }, changePct: "7.1", include: true });
    expect(at(3)).toMatchObject({ status: "new", unit: "roll", include: true });
    expect(at(5)).toMatchObject({ status: "invalid", error: "Price isn't a number" });
    expect(at(6)).toMatchObject({ status: "invalid", error: "No product name" });
    expect(at(7)).toMatchObject({ status: "duplicate", include: false });
  });

  it("flags big changes and unit mismatches and leaves them unticked", () => {
    expect(at(8)).toMatchObject({ status: "changed", changePct: "50", bigChange: true, include: false });
    // Nails match by SKU but the file sells a box while the library prices each: review first.
    expect(at(4)).toMatchObject({ status: "changed", unit: "box", unitMismatch: true, include: false, match: { by: "sku" } });
    expect(p.flagged).toBe(2);
  });

  it("can convert pack prices to unit prices", () => {
    const per = buildPreview({ rows, mapping: autoMap(rows[0]), items: library, perUnit: true });
    expect(per.rows.find((r) => r.line === 4)).toMatchObject({ filePrice: "120", packSize: "4", unitCost: "30" });
  });

  it("refuses formula-looking cells instead of evaluating them", () => {
    const f = buildPreview({ rows: [["Name", "Price"], ["=HYPERLINK(\"http://x\")", "1"], ["@SUM(A1)", "2"], ["-cmd", "3"], ["2x4 stud", "4"]], mapping: autoMap(["Name", "Price"]), items: [] });
    expect(f.rows.map((r) => r.status)).toEqual(["invalid", "invalid", "invalid", "new"]);
    expect(f.rows[0].error).toBe("Looks like a spreadsheet formula");
  });

  it("an unchanged price is not re-imported", () => {
    const same = buildPreview({ rows: [["Name", "Price", "Unit"], ["Ridge cap", "60.00", "bdl"]], mapping: autoMap(["Name", "Price", "Unit"]), items: library });
    expect(same.rows[0]).toMatchObject({ status: "unchanged", include: false });
  });

  it("sends only ticked new/changed rows to the database", () => {
    const out = applyRows(p.rows, { trade: "roofing" });
    expect(out.map((r) => [r.name, r.savedItemId ?? null, r.unitCost])).toEqual([
      ["Architectural shingles", "a", "41.25"],
      ["Synthetic underlayment, 10 sq", null, "89"],
    ]);
    expect(out[1].trade).toBe("roofing");
  });
});

describe("refresh material costs", () => {
  const item = (o: Partial<LineItem>): LineItem => ({ id: "i", groupId: "g", name: "Architectural shingles", costType: "material", treatment: "marked_up", quantity: "30", unit: "bdl", unitCost: "38.50", taxable: true, showOnProposal: true, sortOrder: 0, ...o });
  const prices = [{ id: "a", name: "Architectural Shingles", unit: "bundle", unitCost: "41.25", supplierName: "ABC Supply", priceSource: "supplier_import", priceEffectiveOn: "2026-11-15" }];

  it("lists material rows whose saved price changed, with the cost impact and source", () => {
    const e = { status: "draft" as const, items: [item({}), item({ id: "l", costType: "labor", unitCost: "1" }), item({ id: "x", unitCost: "41.25" })] };
    expect(refreshPreview(e, prices)).toEqual([{
      itemId: "i", name: "Architectural shingles", unit: "bdl", quantity: "30", from: "38.50", to: "41.25", costDelta: "82.50", changePct: "7.1",
      source: { savedItemId: "a", supplierName: "ABC Supply", kind: "supplier_import", effectiveOn: "2026-11-15" },
    }]);
  });

  it("never offers a refresh on a finalized (sent / approved / signed) estimate", () => {
    expect(canRefresh({ status: "finalized" })).toBe(false);
    expect(refreshPreview({ status: "finalized", items: [item({})] }, prices)).toEqual([]);
    expect(refreshPreview({ status: "archived", items: [item({})] }, prices)).toEqual([]);
  });

  it("doesn't match a different unit", () => {
    expect(refreshPreview({ status: "draft", items: [item({ unit: "square" })] }, prices)).toEqual([]);
  });
});

describe("target margin warning (margin, not markup)", () => {
  it("warns below the target gross margin only", () => {
    // 25% markup = 20% margin: below a 22% target even though "25" looks higher.
    expect(belowTargetMargin(new D(125), new D(100), "22")).toBe(true);
    expect(belowTargetMargin(new D(130), new D(100), "22")).toBe(false);
    expect(belowTargetMargin(new D(125), new D(100), null)).toBe(false);
    expect(belowTargetMargin(new D(0), new D(0), "22")).toBe(false);
  });
});

describe("supplier connectors", () => {
  it("ships no live connector; the mock feeds the same preview path", async () => {
    expect(SUPPLIER_CONNECTORS).toHaveLength(0);
    const c = mockSupplierConnector([{ sku: "RIDGE", name: "Ridge cap", unit: "BDL", price: "62.00" }]);
    const table = connectorRowsToTable(await c.fetchPrices({ accountRef: "test" }));
    const p = buildPreview({ rows: table, mapping: autoMap(table[0]), items: library });
    expect(p.rows[0]).toMatchObject({ status: "changed", unitCost: "62", match: { id: "b" } });
    await expect(mockSupplierConnector([], false).fetchPrices({ accountRef: "x" })).rejects.toThrow("not_configured");
  });
});
