import { describe, expect, it } from "vitest";
import { parseAddressComponents } from "@/lib/maps/places";

describe("Google Places address parsing", () => {
  it("pulls city, state code and ZIP from a US address", () => {
    expect(parseAddressComponents([
      { longText: "48", shortText: "48", types: ["street_number"] },
      { longText: "Oak Lane", shortText: "Oak Ln", types: ["route"] },
      { longText: "Springfield", shortText: "Springfield", types: ["locality", "political"] },
      { longText: "Illinois", shortText: "IL", types: ["administrative_area_level_1", "political"] },
      { longText: "62704", shortText: "62704", types: ["postal_code"] },
    ])).toEqual({ city: "Springfield", state: "IL", zip: "62704" });
  });
  it("falls back to sublocality when there is no locality (e.g. Brooklyn)", () => {
    expect(parseAddressComponents([{ longText: "Brooklyn", shortText: "Brooklyn", types: ["sublocality_level_1", "sublocality"] }]).city).toBe("Brooklyn");
  });
  it("handles missing components", () => {
    expect(parseAddressComponents(undefined)).toEqual({ city: undefined, state: undefined, zip: undefined });
    expect(parseAddressComponents([])).toEqual({ city: undefined, state: undefined, zip: undefined });
  });
});
