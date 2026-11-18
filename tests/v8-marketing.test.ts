import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { showHeaderUpgrade, type CreditStatus } from "@/lib/credits/status";
import { COMPANY, FOUNDER, PROMISES } from "@/lib/marketing/about";
import { site } from "@/lib/site";
import { OG_IMAGE } from "@/lib/seo/open-graph";

const base: CreditStatus = { starter: 3, starterTotal: 3, monthly: 0, monthlyEligible: false, nextCycleAt: "2027-03-31T10:00:00.000Z", unlimited: false, emailVerified: true, starterGranted: true };

describe("V8 header upgrade gate", () => {
  it("stays hidden while a verified Free account has 2 or more bids left", () => {
    expect(showHeaderUpgrade(base)).toBe(false);
    expect(showHeaderUpgrade({ ...base, starter: 1, monthly: 1 })).toBe(false);
  });
  it("shows at the last free bid and at zero", () => {
    expect(showHeaderUpgrade({ ...base, starter: 1 })).toBe(true);
    expect(showHeaderUpgrade({ ...base, starter: 0, monthly: 1 })).toBe(true);
    expect(showHeaderUpgrade({ ...base, starter: 0 })).toBe(true);
  });
  it("never shows for Unlimited, unverified or unknown accounts", () => {
    expect(showHeaderUpgrade({ ...base, starter: 0, unlimited: true })).toBe(false);
    expect(showHeaderUpgrade({ ...base, starter: 0, emailVerified: false })).toBe(false);
    expect(showHeaderUpgrade(null)).toBe(false);
  });
});

describe("V8 one positioning line", () => {
  it("uses the same tagline in site config, share-image alt text and the static alt files", () => {
    expect(site.tagline).toBe("Professional estimates for your trade, ready to send.");
    expect(OG_IMAGE.alt).toContain(site.tagline);
    for (const f of ["src/app/opengraph-image.alt.txt", "src/app/twitter-image.alt.txt"]) expect(readFileSync(f, "utf8")).toContain(site.tagline);
  });
});

// V8 addendum: claims that need Built2Bid-specific evidence before they can appear anywhere public.
const PROHIBITED = [/win \d+% more/i, /increase revenue by/i, /reduce estimating time by/i, /save \d+ hours/i, /guaranteed/i, /pay for itself/i, /trusted by (thousands|\d)/i, /\d[\d,]*\+? (contractors|users|customers)/i, /5[- ]star/i, /award/i];

describe("V8 trust content makes no unsupported claims", () => {
  const text = [COMPANY.legalName, COMPANY.state, ...PROMISES.flatMap((p) => [p.title, p.body]), readFileSync("src/app/(marketing)/about/page.tsx", "utf8"), readFileSync("src/app/(marketing)/page.tsx", "utf8")].join("\n");
  it("contains none of the prohibited claim patterns", () => {
    for (const re of PROHIBITED) expect(text, String(re)).not.toMatch(re);
  });
  it("does not render a founder story until the owner supplies one", () => {
    expect(FOUNDER).toBeNull();
  });
});

import { pageType } from "@/lib/analytics/track";
describe("V8 funnel page types", () => {
  it("maps paths to coarse families without ids", () => {
    expect(pageType("/")).toBe("home");
    expect(pageType("/pricing/")).toBe("pricing");
    expect(pageType("/bids/roofing")).toBe("trade");
    expect(pageType("/learn/markup-vs-margin")).toBe("learn");
    expect(pageType("/builder/abc")).toBe("builder");
    expect(pageType("/sign/tok_123")).toBe("other");
  });
});
