import { describe, expect, it } from "vitest";
import { normalizeUnit, regionKey, suggestPrice, UNAVAILABLE_MESSAGE, type PricingProvider } from "@/lib/pricing/provider";

const q = { itemName: "Pressure-treated 2×10", costType: "material", unit: "EA", region: { zip: "62701" } };

describe("regional pricing architecture", () => {
  it("falls back to manual entry when no licensed provider is configured", async () => {
    const r = await suggestPrice(q, { providers: [] });
    expect(r).toEqual({ available: false, reason: "no_provider", message: UNAVAILABLE_MESSAGE });
  });
  it("ignores unconfigured providers", async () => {
    const p: PricingProvider = { id: "x", name: "X", kind: "licensed_dataset", isConfigured: () => false, lookup: async () => { throw new Error("should not be called"); } };
    expect((await suggestPrice(q, { providers: [p] })).available).toBe(false);
  });
  it("returns sourced suggestions with unit normalization, caching, and usage caps", async () => {
    let calls = 0;
    const p: PricingProvider = {
      id: "test", name: "Test Data", kind: "licensed_dataset", isConfigured: () => true,
      lookup: async (nq) => { calls++; expect(nq.unit).toBe("each"); expect(nq.regionKey).toBe("zip3:627"); return { amount: "27.00", unit: "ea", source: { id: "test", name: "Test Data", kind: "licensed_dataset" }, region: "ZIP 627xx", observedAt: "2026-11-01T00:00:00Z", isQuote: false }; },
    };
    const cache = new Map<string, unknown>();
    const deps = {
      providers: [p],
      cacheGet: async (nq: { itemKey: string; regionKey: string }) => (cache.get(nq.itemKey + nq.regionKey) as never) ?? null,
      cachePut: async (nq: { itemKey: string; regionKey: string }, s: unknown) => { cache.set(nq.itemKey + nq.regionKey, s); },
    };
    const r1 = await suggestPrice(q, deps);
    expect(r1.available && r1.suggestion.source.name).toBe("Test Data");
    await suggestPrice(q, deps);
    expect(calls).toBe(1);
    const capped = await suggestPrice({ ...q, itemName: "other" }, { providers: [p], allowRequest: async () => false });
    expect(capped.available).toBe(false);
  });
  it("normalizes units and regions", () => {
    expect(normalizeUnit("SF")).toBe("square foot");
    expect(normalizeUnit("cu yd")).toBe("cubic yard");
    expect(regionKey({ state: "il" })).toBe("state:IL");
    expect(regionKey({})).toBe("unknown");
  });
});
