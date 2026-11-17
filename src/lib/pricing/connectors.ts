/**
 * Provider-neutral supplier connector (V5 Pricing Intelligence). A connector turns a supplier's
 * authorized feed (partner API, EDI price file, emailed price list) into the same rows the CSV
 * importer produces, so every source goes through the same preview → review → apply → undo path.
 *
 * No live connector ships. Each real one needs the supplier's written authorization and credentials
 * held server-side; we never scrape supplier websites. Only the mock below exists, for tests and demos.
 */
export interface SupplierPriceRow {
  sku: string;
  name: string;
  unit: string;
  price: string; // decimal string, USD, per unit or per pack
  packSize?: string;
  category?: string;
  effectiveOn?: string; // ISO date
  expiresOn?: string;
}

export interface SupplierConnector {
  id: string;
  name: string;
  /** True only when the supplier authorized access, credentials exist, and an admin enabled it. */
  isConfigured(): boolean;
  /** Current account pricing for the contractor's branch/account. */
  fetchPrices(opts: { accountRef: string; skus?: string[] }): Promise<SupplierPriceRow[]>;
}

/** Converts connector rows to the header-first string rows buildPreview() reads. */
export function connectorRowsToTable(rows: SupplierPriceRow[]): string[][] {
  return [
    ["SKU", "Description", "Unit", "Price", "Pack size", "Category"],
    ...rows.map((r) => [r.sku, r.name, r.unit, r.price, r.packSize ?? "", r.category ?? ""]),
  ];
}

/** Test/demo connector with fixed data. Never registered in production. */
export function mockSupplierConnector(rows: SupplierPriceRow[], configured = true): SupplierConnector {
  return {
    id: "mock-supplier",
    name: "Mock Supplier (test data)",
    isConfigured: () => configured,
    async fetchPrices({ skus }) {
      if (!configured) throw new Error("not_configured");
      return skus?.length ? rows.filter((r) => skus.includes(r.sku)) : rows;
    },
  };
}

/** Registry of live connectors. Empty until a supplier partnership is approved by the owner. */
export const SUPPLIER_CONNECTORS: SupplierConnector[] = [];
