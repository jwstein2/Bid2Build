import { describe, expect, it } from "vitest";
import { countyId, idFromCensus, labelFromId, parseShard, placeId, shardUrl, slug, townId } from "@/lib/academy/kb/geo";
import shard559 from "../public/academy-geo/559.json";

describe("Academy project location: ids match the generator", () => {
  it("slugs names the same way as gen_geo.py", () => {
    expect(slug("St. Paul")).toBe("saint-paul");
    expect(slug("Ste. Genevieve")).toBe("sainte-genevieve");
    expect(slug("Rock Dell")).toBe("rock-dell");
  });
  it("builds city, township and county ids", () => {
    expect(placeId("MN", "Byron city", "Olmsted County")).toBe("MN:byron");
    expect(placeId("MN", "St. Anthony city", "Stearns County")).toBe("MN:saint-anthony-stearns");
    expect(townId("MN", "Cascade township", "Olmsted County")).toBe("MN:olmsted:cascade-twp");
    expect(countyId("MN", "Olmsted County")).toBe("MN:olmsted-county");
    expect(countyId("DC", "District of Columbia")).toBe("DC:district-of-columbia");
  });
  it("maps a Census address match to the same id a ZIP pick gives", () => {
    expect(idFromCensus({ state: "27", place: { NAME: "Byron city" }, county: { NAME: "Olmsted County" } }).id).toBe("MN:byron");
    expect(idFromCensus({ state: "27", cousub: { NAME: "Cascade township", FUNCSTAT: "A" }, county: { NAME: "Olmsted County" } })).toMatchObject({ id: "MN:olmsted:cascade-twp", kind: "township" });
    expect(idFromCensus({ state: "27", cousub: { NAME: "Unorganized Territory of X", FUNCSTAT: "F" }, county: { NAME: "Lake County" } })).toMatchObject({ id: "MN:lake-county", kind: "county" });
    expect(idFromCensus({ state: "11", county: { NAME: "District of Columbia" } }).id).toBe("DC:district-of-columbia");
  });
  it("reads readable names back out of ids", () => {
    expect(labelFromId("MN:olmsted:cascade-twp")).toBe("Cascade Township, Olmsted County");
    expect(labelFromId("MN:olmsted-county")).toBe("Unincorporated Olmsted County");
    expect(labelFromId("MN:saint-paul")).toBe("Saint Paul");
  });
});

describe("Academy project location: ZIP choices", () => {
  it("only fetches for a real 5-digit ZIP", () => {
    expect(shardUrl("55920")).toBe("/academy-geo/559.json");
    expect(shardUrl("5592")).toBeNull();
    expect(shardUrl("../x")).toBeNull();
  });
  it("lists every area a ZIP touches, cities first", () => {
    const opts = parseShard(shard559, "55920");
    expect(opts[0]).toMatchObject({ id: "MN:byron", kind: "city" });
    expect(opts.map((o) => o.id)).toContain("MN:olmsted:salem-twp");
    expect(parseShard(shard559, "00000")).toEqual([]);
  });
  it("drops malformed rows from a shard", () => {
    expect(parseShard({ "11111": [["<script>", "x", "city", 1], ["MN:ok", "Ok", "weird", 0.5]] }, "11111")).toEqual([{ id: "MN:ok", label: "Ok", kind: "county", share: 0.5 }]);
    expect(parseShard(null, "11111")).toEqual([]);
  });
});
