import { describe, expect, it } from "vitest";
import { applyTradeDetails, worksheetFrom, worksheetToStore, applySectionTrades } from "@/lib/data/mappers";
import { createEstimate } from "@/lib/estimate/factory";
import { estimateSchema } from "@/lib/estimate/schema";
import { primaryProfile, tradeDetail, type ProjectProfile } from "@/lib/market/trade-models";

describe("project details for every trade", () => {
  const legacy: ProjectProfile = { sector: "residential", outcome: "quoted", workType: "replacement", projectType: "replacement", measurements: { squares: 30 } };

  it("shows details saved before per-trade support under the first trade only", () => {
    expect(tradeDetail(legacy, "roofing", true)).toEqual({ workType: "replacement", projectType: "replacement", measurements: { squares: 30 } });
    expect(tradeDetail(legacy, "concrete", false)).toEqual({});
  });

  it("pins legacy details to the first trade on load, so reordering keeps them with that trade", () => {
    const p = applyTradeDetails(legacy, undefined, ["roofing", "concrete"])!;
    expect(p.trades?.roofing?.measurements).toEqual({ squares: 30 });
    // After a reorder, concrete is first but the roof details stay with roofing.
    expect(tradeDetail(p, "concrete", true)).toEqual({});
    expect(primaryProfile(p, ["concrete", "roofing"])?.measurements).toBeUndefined();
    expect(primaryProfile(p, ["concrete", "roofing"])?.sector).toBe("residential");
  });

  it("round-trips every trade through the worksheet and keeps the first trade on the profile row", () => {
    const e = createEstimate("concrete", { blank: true });
    e.trades = ["concrete", "roofing"];
    e.projectProfile = {
      sector: "commercial",
      trades: {
        concrete: { workType: "new_construction", measurements: { area_sqft: "400", junk: "x" } },
        roofing: { workType: "replacement", projectType: "replacement", measurements: { squares: 22 } },
        decks: { workType: "repair" },
      },
    };
    expect(estimateSchema.safeParse(e).success).toBe(true);
    const stored = worksheetToStore(e)!;
    expect(Object.keys(stored.tradeDetails ?? {})).toEqual(["concrete", "roofing"]);
    expect(stored.tradeDetails?.concrete?.measurements).toEqual({ area_sqft: 400 });
    expect(stored.tradeDetails?.roofing).toEqual({ workType: "replacement", projectType: "replacement", measurements: { squares: 22 } });

    const ws = worksheetFrom({ worksheet: stored });
    const loaded = applySectionTrades({ ...e, projectProfile: null, worksheet: null }, ws);
    expect(loaded.worksheet?.tradeDetails).toBeUndefined();
    const row = primaryProfile(e.projectProfile, e.trades)!;
    const p = applyTradeDetails(row, ws?.tradeDetails, e.trades)!;
    expect(p.sector).toBe("commercial");
    expect(tradeDetail(p, "roofing", false).measurements).toEqual({ squares: 22 });
    expect(tradeDetail(p, "concrete", true).workType).toBe("new_construction");
  });

  it("stores nothing extra when there are no details", () => {
    const e = createEstimate("concrete", { blank: true });
    e.trades = ["concrete", "roofing"];
    expect(worksheetToStore(e)?.tradeDetails).toBeUndefined();
  });
});
