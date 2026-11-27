import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { FREE_RESOURCES, marginFromMarkup, overheadPerHour, priceForMargin, resourceBySlug, roundUpTo } from "@/lib/marketing/free-resources";

describe("free resources", () => {
  it("has one resource per episode 1-10 with unique, URL-safe slugs", () => {
    expect(FREE_RESOURCES.map((r) => r.episode).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const slugs = FREE_RESOURCES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
    for (const r of FREE_RESOURCES) {
      if (r.kind === "calculator") expect(r.calculator).toBeTruthy();
      if (r.kind === "checklist" || r.kind === "template") expect(r.items?.length).toBeGreaterThan(2);
      expect(r.title.length).toBeLessThanOrEqual(80);
    }
    expect(resourceBySlug("nope")).toBeUndefined();
  });

  it("never makes income, profit or win promises", () => {
    const text = JSON.stringify(FREE_RESOURCES).toLowerCase();
    for (const banned of ["make more money", "guarantee", "win every", "win more", "enterprise", "$149"]) expect(text).not.toContain(banned);
  });

  it("matches the episode math", () => {
    expect(marginFromMarkup(30)).toBeCloseTo(23.08, 2);
    expect(marginFromMarkup(25)).toBeCloseTo(20, 6);
    expect(priceForMargin(8520, 15)).toBeCloseTo(10023.53, 2);
    expect(roundUpTo(priceForMargin(8520, 15), 25)).toBe(10025);
    expect(overheadPerHour(35400, 50, 30)).toBeCloseTo(23.6, 6);
    expect(priceForMargin(23.6 + 38, 15)).toBeCloseTo(72.47, 2);
    expect(priceForMargin(24000 / 1200 + 50000 / 1200, 15)).toBeCloseTo(72.55, 2);
  });

  it("rejects bad inputs instead of returning a wrong price", () => {
    expect(priceForMargin(100, 100)).toBeNaN();
    expect(priceForMargin(-1, 10)).toBeNaN();
    expect(overheadPerHour(1000, 0, 30)).toBeNaN();
    expect(marginFromMarkup(-5)).toBeNaN();
  });

  it("lists /free and every resource page in the sitemap", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/free"))).toBe(true);
    for (const r of FREE_RESOURCES) expect(urls.some((u) => u.endsWith(`/free/${r.slug}`))).toBe(true);
  });
});
