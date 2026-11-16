import { describe, expect, it } from "vitest";
import { previewTaxParams } from "@/lib/billing/tax";

describe("previewTaxParams", () => {
  it("mirrors the subscription's automatic tax setting", () => {
    expect(previewTaxParams({ automatic_tax: { enabled: true } })).toEqual({ automatic_tax: { enabled: true } });
    expect(previewTaxParams({ automatic_tax: { enabled: false } })).toEqual({});
    expect(previewTaxParams({})).toEqual({});
  });
});
