import { describe, expect, it } from "vitest";
import { analyticsAllowedOn, gaMeasurementId } from "@/lib/seo/analytics";
import { OG_IMAGE, openGraphFor } from "@/lib/seo/open-graph";

describe("gaMeasurementId", () => {
  it("accepts a GA4 id, trimming and upper-casing it", () => {
    expect(gaMeasurementId(" g-abc123xyz9 ")).toBe("G-ABC123XYZ9");
  });
  it("rejects empty, Universal Analytics and junk values", () => {
    for (const v of [undefined, null, "", "UA-12345-1", "G-", "G-<script>", "GTM-ABCD12"]) expect(gaMeasurementId(v)).toBeNull();
  });
});

describe("analyticsAllowedOn", () => {
  it("allows marketing and app pages", () => {
    for (const p of ["/", "/pricing", "/bids/decks", "/learn/markup-vs-margin", "/dashboard", "/builder/abc", "/signed"]) expect(analyticsAllowedOn(p)).toBe(true);
  });
  it("never loads on pages whose URL carries a token or code", () => {
    for (const p of ["/sign/tok_123", "/auth/callback", "/auth/confirm", "/complimentary", "/api/health", "/admin", "/admin/sales", null, ""]) expect(analyticsAllowedOn(p)).toBe(false);
  });
});

describe("openGraphFor", () => {
  it("always carries the share image, URL and site name", () => {
    const og = openGraphFor({ title: "Deck Estimate | Built2Bid", description: "d", path: "/bids/decks" }) as Record<string, unknown>;
    expect(og.images).toEqual([OG_IMAGE]);
    expect(og.url).toBe("/bids/decks");
    expect(og.siteName).toBeTruthy();
    expect(og.type).toBe("website");
  });
  it("marks guides as articles", () => {
    expect((openGraphFor({ title: "t", description: "d", path: "/learn/x", type: "article" }) as Record<string, unknown>).type).toBe("article");
    // Trade pages and guides have their own generated card, so the generic image must not override it.
    expect((openGraphFor({ title: "t", description: "d", path: "/bids/decks", ownImage: true }) as Record<string, unknown>).images).toBeUndefined();
  });
});
