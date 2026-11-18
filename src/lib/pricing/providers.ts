/**
 * Supplier pricing sources a contractor can opt into, and the price cross-check helpers.
 *
 * Every source here is opt-in per company. None is live yet: each one needs a partner agreement (or an
 * affiliate approval) with the supplier before any price flows, and we never scrape supplier websites.
 * Until a source is live its card says so and only records the contractor's interest and account number.
 * Research notes and links: docs/supplier-pricing/README.md.
 */

export const PROVIDER_IDS = ["qxo", "abc_supply", "srs", "ferguson", "onebuild", "rsmeans", "home_depot_pro", "lowes_pro", "lumber_84"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderKind = "supplier" | "market_data" | "retail";
export type Offer = "contract_pricing" | "branch_pricing" | "availability" | "branches" | "ordering" | "market_prices" | "retail_prices";

export interface PricingProvider {
  id: ProviderId;
  name: string;
  kind: ProviderKind;
  trades: string[];
  /** What a live connection would give the contractor. */
  offers: Offer[];
  /** How access works today, in one plain sentence. */
  access: string;
  /** What the contractor would enter to connect (never a password). */
  accountLabel: string | null;
  branchLabel: string | null;
  /** Name used to search for nearby branches on a map; null for data-only providers. */
  branchSearch: string | null;
  website: string;
}

export const OFFER_LABELS: Record<Offer, string> = {
  contract_pricing: "Your contract pricing",
  branch_pricing: "Branch pricing",
  availability: "Stock at your branch",
  branches: "Branch locations",
  ordering: "Ordering",
  market_prices: "Local market prices",
  retail_prices: "Online retail prices",
};

export const PRICING_PROVIDERS: PricingProvider[] = [
  { id: "abc_supply", name: "ABC Supply", kind: "supplier", trades: ["roofing", "siding", "windows", "gutters"],
    offers: ["contract_pricing", "branch_pricing", "branches", "ordering"],
    access: "Public developer program. Built2Bid needs to be approved as a software partner first.",
    accountLabel: "Ship-to account number", branchLabel: "Branch number", branchSearch: "ABC Supply", website: "https://www.abcsupply.com" },
  { id: "qxo", name: "QXO (formerly Beacon)", kind: "supplier", trades: ["roofing", "siding", "waterproofing"],
    offers: ["contract_pricing", "branch_pricing", "ordering"],
    access: "Partner integrations only. Needs a partner agreement between Built2Bid and QXO.",
    accountLabel: "QXO account number", branchLabel: "Home branch", branchSearch: "QXO Beacon building products", website: "https://www.qxo.com" },
  { id: "srs", name: "SRS Distribution (Roof Hub)", kind: "supplier", trades: ["roofing", "pool", "landscape"],
    offers: ["branch_pricing", "availability", "ordering"],
    access: "Partner integrations only. When live, you'll paste the integration key from Roof Hub.",
    accountLabel: "Roof Hub account number", branchLabel: "Home branch", branchSearch: "SRS Distribution", website: "https://www.srsdistribution.com" },
  { id: "ferguson", name: "Ferguson", kind: "supplier", trades: ["plumbing", "hvac", "waterworks"],
    offers: ["contract_pricing", "availability", "ordering"],
    access: "Partner API and PunchOut catalogs. Needs a partner agreement with Ferguson.",
    accountLabel: "Ferguson account number", branchLabel: "Home branch", branchSearch: "Ferguson plumbing supply", website: "https://www.ferguson.com" },
  { id: "onebuild", name: "1build", kind: "market_data", trades: ["all trades"],
    offers: ["market_prices"],
    access: "Paid data API (quote from 1build). County-level material, labor and equipment prices.",
    accountLabel: null, branchLabel: null, branchSearch: null, website: "https://www.1build.com" },
  { id: "rsmeans", name: "RSMeans (Gordian)", kind: "market_data", trades: ["all trades"],
    offers: ["market_prices"],
    access: "Paid subscription with an API option (quote from Gordian).",
    accountLabel: null, branchLabel: null, branchSearch: null, website: "https://www.rsmeans.com" },
  { id: "home_depot_pro", name: "The Home Depot", kind: "retail", trades: ["all trades"],
    offers: ["retail_prices", "branches"],
    access: "No public API. Online retail prices may come through Home Depot's affiliate product feed once approved.",
    accountLabel: null, branchLabel: "Home store", branchSearch: "The Home Depot", website: "https://www.homedepot.com" },
  { id: "lowes_pro", name: "Lowe's", kind: "retail", trades: ["all trades"],
    offers: ["retail_prices", "branches"],
    access: "No public API. Online retail prices may come through Lowe's affiliate product feed once approved.",
    accountLabel: null, branchLabel: "Home store", branchSearch: "Lowe's Home Improvement", website: "https://www.lowes.com" },
  { id: "lumber_84", name: "84 Lumber", kind: "supplier", trades: ["framing", "lumber", "trusses"],
    offers: ["branches"],
    access: "No API. Ask your store for a price list and import it.",
    accountLabel: "84 Lumber account number", branchLabel: "Home store", branchSearch: "84 Lumber", website: "https://www.84lumber.com" },
];

export function providerById(id: string): PricingProvider | undefined {
  return PRICING_PROVIDERS.find((p) => p.id === id);
}

/**
 * Map link that finds a supplier's branches near a ZIP code or town. Uses the Google Maps search URL
 * (no API key, opens in a new tab); nothing is fetched from the supplier's site.
 */
export function branchSearchUrl(name: string, near?: string | null): string {
  const q = [name.trim(), near?.trim() ? `near ${near.trim()}` : ""].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// --- Connections ----------------------------------------------------------------------------------

export type ConnectionStatus = "requested" | "connected" | "paused";
export interface SupplierConnection {
  provider: ProviderId;
  supplierId: string | null;
  supplierName: string | null;
  accountRef: string | null;
  branchRef: string | null;
  useForCrossCheck: boolean;
  status: ConnectionStatus;
  consentAt: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
}
export interface ConnectionList { canManage: boolean; connections: SupplierConnection[] }

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function mapConnections(raw: unknown): ConnectionList {
  const o = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(o.connections) ? (o.connections as Record<string, unknown>[]) : [];
  return {
    canManage: o.canManage === true,
    connections: rows
      .filter((r) => (PROVIDER_IDS as readonly string[]).includes(String(r.provider)))
      .map((r) => ({
        provider: r.provider as ProviderId,
        supplierId: str(r.supplierId),
        supplierName: str(r.supplierName),
        accountRef: str(r.accountRef),
        branchRef: str(r.branchRef),
        useForCrossCheck: r.useForCrossCheck !== false,
        status: r.status === "connected" || r.status === "paused" ? r.status : "requested",
        consentAt: str(r.consentAt),
        connectedAt: str(r.connectedAt),
        lastSyncAt: str(r.lastSyncAt),
      })),
  };
}

export function connectionStatusLabel(c: SupplierConnection | undefined): string {
  if (!c) return "Not connected";
  if (c.status === "connected") return "Connected";
  if (c.status === "paused") return "Paused";
  return "Requested: waiting on supplier access";
}

// --- Cross-check ----------------------------------------------------------------------------------

export interface CrossCheckRow {
  supplier: string;
  supplierId: string | null;
  product: string;
  sku: string | null;
  unit: string;
  packSize: number | null;
  unitCost: number;
  effectiveOn: string | null;
  expiresOn: string | null;
  expired: boolean;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Accepts PostgREST numbers or numeric strings (both happen). Drops rows without a real price. */
export function mapCrossCheck(raw: unknown): { query: string | null; rows: CrossCheckRow[] } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(o.rows) ? (o.rows as Record<string, unknown>[]) : [];
  return {
    query: str(o.query),
    rows: rows.flatMap((r) => {
      const cost = num(r.unitCost);
      if (cost === null || !str(r.supplier) || !str(r.product)) return [];
      return [{
        supplier: String(r.supplier), supplierId: str(r.supplierId), product: String(r.product), sku: str(r.sku),
        unit: str(r.unit) ?? "each", packSize: num(r.packSize), unitCost: cost,
        effectiveOn: str(r.effectiveOn), expiresOn: str(r.expiresOn), expired: r.expired === true,
      }];
    }),
  };
}

export interface CrossCheckGroup {
  key: string;
  product: string;
  unit: string;
  packSize: number | null;
  rows: (CrossCheckRow & { lowest: boolean; overLowest: number | null })[];
  /** Highest minus lowest current (not expired) price, when 2+ suppliers have one. */
  spread: number | null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Groups prices for the same product (same name, unit and pack size, ignoring case and spacing) and marks
 * the lowest current price. Expired prices are listed but never ranked.
 */
export function crossCheckGroups(rows: CrossCheckRow[]): CrossCheckGroup[] {
  const map = new Map<string, CrossCheckRow[]>();
  for (const r of rows) {
    const key = `${norm(r.product)}|${norm(r.unit)}|${r.packSize ?? 1}`;
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  return [...map.entries()].map(([key, list]) => {
    const current = list.filter((r) => !r.expired);
    const low = current.length ? Math.min(...current.map((r) => r.unitCost)) : null;
    const high = current.length ? Math.max(...current.map((r) => r.unitCost)) : null;
    const sorted = [...list].sort((a, b) => Number(a.expired) - Number(b.expired) || a.unitCost - b.unitCost || a.supplier.localeCompare(b.supplier));
    return {
      key, product: list[0].product, unit: list[0].unit, packSize: list[0].packSize,
      rows: sorted.map((r) => ({
        ...r,
        lowest: !r.expired && low !== null && current.length > 1 && r.unitCost === low,
        overLowest: !r.expired && low !== null && current.length > 1 && r.unitCost > low ? Math.round((r.unitCost - low) * 10000) / 10000 : null,
      })),
      spread: current.length > 1 && low !== null && high !== null ? Math.round((high - low) * 10000) / 10000 : null,
    };
  }).sort((a, b) => (b.spread ?? -1) - (a.spread ?? -1) || a.product.localeCompare(b.product));
}
