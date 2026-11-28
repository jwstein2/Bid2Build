import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRICES } from "@/lib/marketing/catalog";
import { COMPARISONS, getComparison } from "@/lib/marketing/comparisons";
import sitemap from "@/app/sitemap";

const PROHIBITED = [/guaranteed/i, /trusted by/i, /5[- ]star/i, /award/i, /#1|number one|best[- ]in[- ]class|\bthe best\b/i, /AI-powered/i, /end-to-end/i, /(runs?|handles?|includes?|built-in) payroll(?!\.)/i, /coming soon/i, /rated|rating/i];

describe("comparison pages (V11.0)", () => {
  it("has one page per competitor with sources, a verified date and both 'choose' lists", () => {
    expect(COMPARISONS.map((c) => c.slug)).toEqual(["joist", "jobber", "contractor-foreman"]);
    for (const c of COMPARISONS) {
      expect(c.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.sources.length).toBeGreaterThan(0);
      for (const s of c.sources) expect(s.url).toMatch(/^https:\/\//);
      expect(c.chooseThem.length).toBeGreaterThan(0);
      expect(c.chooseUs.length).toBeGreaterThan(0);
      expect(getComparison(c.slug)).toBe(c);
    }
  });
  it("takes Built2Bid prices from billing and never says Enterprise", () => {
    for (const c of COMPARISONS) {
      const price = c.rows[0].built2bid;
      expect(price).toContain(PRICES.unlimitedMonthly);
      expect(price).toContain(PRICES.unlimitedAnnual);
      expect(price).toContain(PRICES.enterpriseBase);
      expect(JSON.stringify(c)).not.toMatch(/enterprise/i);
    }
  });
  it("makes no prohibited claims and admits what Built2Bid can't do (invoice emails)", () => {
    for (const c of COMPARISONS) {
      const ours = [c.summary, ...c.rows.map((r) => r.built2bid), ...c.chooseUs].join(" ");
      for (const re of PROHIBITED) expect(ours, `${c.slug} ${re}`).not.toMatch(re);
      expect(c.rows.some((r) => /aren't emailed from Built2Bid/.test(r.built2bid))).toBe(true);
    }
  });
  it("lists /compare and every comparison in the sitemap and footer", () => {
    const urls = sitemap().map((u) => u.url);
    expect(urls.some((u) => u.endsWith("/compare"))).toBe(true);
    for (const c of COMPARISONS) expect(urls.some((u) => u.endsWith(`/compare/${c.slug}`))).toBe(true);
    expect(readFileSync("src/components/layout/footer.tsx", "utf8")).toContain("/compare");
  });
  it("links competitor sources nofollow and carries a no-affiliation note", () => {
    const page = readFileSync("src/app/(marketing)/compare/[slug]/page.tsx", "utf8");
    expect(page).toMatch(/nofollow/);
    expect(page).toMatch(/not affiliated/i);
  });
});
