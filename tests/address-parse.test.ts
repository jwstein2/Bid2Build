import { describe, expect, it } from "vitest";
import { bidState, fillLocationFromAddress, parseUsAddress } from "@/lib/geo/address";

describe("parseUsAddress", () => {
  it.each([
    ["123 Main St, Austin, TX 78701", { zip: "78701", state: "TX", city: "Austin" }],
    ["123 Main St, Austin, TX 78701-1234, USA", { zip: "78701", state: "TX", city: "Austin" }],
    ["123 Main St\nAustin, TX 78701", { zip: "78701", state: "TX", city: null }],
    ["45 Oak Ave, Portland, Oregon", { zip: null, state: "OR", city: "Portland" }],
    ["45 Oak Ave, Portland, OR", { zip: null, state: "OR", city: "Portland" }],
    ["9 Elm Rd Springfield IL 62701", { zip: "62701", state: "IL", city: null }],
    ["1 Lake Dr, Madison WI", { zip: null, state: "WI", city: "Madison" }],
    ["500 Pine St, Chicago, IL, United States", { zip: null, state: "IL", city: "Chicago" }],
    ["12 River Rd, Columbus, New York 10001", { zip: "10001", state: "NY", city: "Columbus" }],
  ])("%s", (addr, want) => expect(parseUsAddress(addr)).toEqual(want));

  it("returns nothing for addresses without a state or ZIP", () => {
    for (const a of ["", null, undefined, "123 Main St", "Behind the barn", "12 Court Ct", "Unit 4, Building in", "Shed out back, in", "Barn, or"]) expect(parseUsAddress(a)).toEqual({ zip: null, state: null, city: null });
  });
  it("drops a state that contradicts the ZIP", () => {
    expect(parseUsAddress("1 Main St, Austin, CA 78701")).toEqual({ zip: "78701", state: null, city: "Austin" });
  });
  it("does not read lower-case two-letter words as states", () => {
    expect(parseUsAddress("1 Main St in").state).toBeNull();
  });
});

describe("fillLocationFromAddress", () => {
  it("fills only empty fields", () => {
    expect(fillLocationFromAddress({}, "123 Main St, Austin, TX 78701")).toEqual({ zip: "78701", state: "TX", city: "Austin" });
    expect(fillLocationFromAddress({ city: "Round Rock" }, "123 Main St, Austin, TX 78701")).toEqual({ city: "Round Rock", zip: "78701", state: "TX" });
  });
  it("never overwrites typed values and returns the same object when complete", () => {
    const loc = { zip: "10001", state: "NY" };
    expect(fillLocationFromAddress(loc, "123 Main St, Austin, TX 78701")).toBe(loc);
  });
  it("won't add a state that contradicts an entered ZIP", () => {
    expect(fillLocationFromAddress({ zip: "10001" }, "1 Main St, Austin, TX")).toEqual({ zip: "10001" });
  });
  it("leaves unparseable addresses alone", () => {
    const loc = {};
    expect(fillLocationFromAddress(loc, "Behind the barn")).toBe(loc);
  });
});

describe("bidState", () => {
  it("prefers the ZIP, then the state field, then the typed address", () => {
    expect(bidState({ location_zip: "78701", location_state: "CA" })).toEqual({ state: "TX", zip: "78701", source: "zip" });
    expect(bidState({ location_state: "texas" })).toEqual({ state: "TX", zip: null, source: "state_field" });
    expect(bidState({ project_address: "1 Main St, Denver, CO 80202" })).toEqual({ state: "CO", zip: "80202", source: "address" });
    expect(bidState({ project_address: "" })).toEqual({ state: null, zip: null, source: null });
  });
});
