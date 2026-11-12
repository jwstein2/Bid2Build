/**
 * Regional pricing architecture. No external provider is active until a licensed source with
 * verified credentials is configured; until then every lookup returns "unavailable" and the UI
 * tells the contractor to enter their own cost. We never fabricate reference prices.
 */
export type SourceKind = "supplier_quote" | "licensed_dataset" | "modeled" | "user_history";

export interface PriceQuery {
  itemName: string;
  costType: string;
  unit: string;
  region: { zip?: string; city?: string; state?: string };
}

export interface PriceSuggestion {
  amount: string; // decimal string, USD
  unit: string; // normalized unit
  source: { id: string; name: string; kind: SourceKind };
  region: string; // geographic applicability, e.g. "ZIP 62701" or "Illinois"
  observedAt: string; // ISO timestamp of the underlying data
  isQuote: boolean; // true only for an actual supplier quote
}

export type PriceResult = { available: true; suggestion: PriceSuggestion } | { available: false; message: string; reason: "no_provider" | "no_match" | "rate_limited" | "error" };

export interface PricingProvider {
  id: string;
  name: string;
  kind: SourceKind;
  /** True only when credentials exist AND the integration is enabled by an admin. */
  isConfigured(): boolean;
  lookup(q: NormalizedQuery): Promise<PriceSuggestion | null>;
}

export interface NormalizedQuery extends PriceQuery {
  unit: string;
  itemKey: string;
  regionKey: string;
}

export const UNAVAILABLE_MESSAGE = "Local pricing unavailable. Enter your cost manually.";

const UNIT_ALIASES: Record<string, string> = {
  ea: "each", each: "each", pc: "each", piece: "each", unit: "each",
  lf: "linear foot", "lin ft": "linear foot", "linear foot": "linear foot", "linear feet": "linear foot", ft: "linear foot",
  sf: "square foot", sqft: "square foot", "sq ft": "square foot", "square foot": "square foot", "square feet": "square foot",
  sy: "square yard", "sq yd": "square yard", "square yard": "square yard",
  cy: "cubic yard", "cu yd": "cubic yard", yd3: "cubic yard", "cubic yard": "cubic yard",
  hr: "hour", hrs: "hour", hour: "hour", hours: "hour",
  day: "day", days: "day", ls: "lump sum", "lump sum": "lump sum",
  ton: "ton", tons: "ton", gal: "gallon", gallon: "gallon", gallons: "gallon",
  sht: "sheet", sheet: "sheet", box: "box", bdl: "bundle", bundle: "bundle", sq: "square", square: "square",
};

export function normalizeUnit(u: string): string {
  const k = u.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[k] ?? k;
}

export function normalizeItemKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9×x ]/g, " ").replace(/\s+/g, " ").trim();
}

export function regionKey(r: PriceQuery["region"]): string {
  if (r.zip && /^\d{5}/.test(r.zip)) return `zip3:${r.zip.slice(0, 3)}`;
  if (r.state) return `state:${r.state.trim().toUpperCase().slice(0, 2)}`;
  return "unknown";
}

export interface PricingDeps {
  providers: PricingProvider[];
  cacheGet?: (q: NormalizedQuery) => Promise<PriceSuggestion | null>;
  cachePut?: (q: NormalizedQuery, s: PriceSuggestion, providerId: string) => Promise<void>;
  allowRequest?: (providerId: string) => Promise<boolean>; // rate limit / monthly cost cap
  recordUsage?: (providerId: string) => Promise<void>;
}

export async function suggestPrice(q: PriceQuery, deps: PricingDeps): Promise<PriceResult> {
  const active = deps.providers.filter((p) => p.isConfigured());
  if (!active.length) return { available: false, reason: "no_provider", message: UNAVAILABLE_MESSAGE };
  const nq: NormalizedQuery = { ...q, unit: normalizeUnit(q.unit), itemKey: normalizeItemKey(q.itemName), regionKey: regionKey(q.region) };
  const cached = await deps.cacheGet?.(nq);
  if (cached) return { available: true, suggestion: cached };
  for (const p of active) {
    if (deps.allowRequest && !(await deps.allowRequest(p.id))) continue;
    try {
      const s = await p.lookup(nq);
      await deps.recordUsage?.(p.id);
      if (s && normalizeUnit(s.unit) === nq.unit) {
        await deps.cachePut?.(nq, s, p.id);
        return { available: true, suggestion: s };
      }
    } catch {
      /* try next provider */
    }
  }
  return { available: false, reason: "no_match", message: UNAVAILABLE_MESSAGE };
}

/** Registered integrations. Each is inert until credentials + admin enablement exist. */
export const PROVIDER_CATALOG: { id: string; name: string; kind: SourceKind; envKey: string; notes: string }[] = [
  { id: "user_history", name: "Your past bids", kind: "user_history", envKey: "", notes: "Planned: suggests your own most recent cost for the same item. Uses only your data." },
  { id: "licensed_dataset", name: "Licensed regional cost dataset", kind: "licensed_dataset", envKey: "PRICING_DATASET_API_KEY", notes: "Requires a commercial license (e.g. a construction cost data vendor). Pricing and terms must be approved before enabling." },
  { id: "supplier_api", name: "Authorized supplier pricing", kind: "supplier_quote", envKey: "SUPPLIER_PRICING_API_KEY", notes: "Requires a supplier partnership/API agreement. Shows actual quotes when available." },
];

export function configuredProviders(): PricingProvider[] {
  // No external provider implementations ship enabled. Add implementations here once licensed.
  return [];
}
