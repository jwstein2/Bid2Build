import { describe, expect, it } from "vitest";
import { META_DESCRIPTION_MAX, lessonTitle, metaDescription } from "../src/lib/seo/meta";
import { site } from "../src/lib/site";
import { trades } from "../src/lib/trades/catalog";

describe("metaDescription", () => {
  it("leaves short text alone", () => {
    expect(metaDescription("Short and sweet.")).toBe("Short and sweet.");
  });
  it("keeps whole sentences within the limit", () => {
    const out = metaDescription(`${"a".repeat(100)}. ${"b".repeat(50)}. ${"c".repeat(40)}.`);
    expect(out).toBe(`${"a".repeat(100)}. ${"b".repeat(50)}.`);
  });
  it("does not split on decimal points in prices", () => {
    const out = metaDescription(`Individual Unlimited: $19.99/month or $199/year. ${"x ".repeat(80)}`);
    expect(out).toBe("Individual Unlimited: $19.99/month or $199/year.");
  });
  it("cuts a single long sentence at a word with an ellipsis", () => {
    const out = metaDescription("word ".repeat(60));
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(out.endsWith("word…")).toBe(true);
  });
  it("every trade page description fits", () => {
    for (const t of trades) expect(metaDescription(`${t.intro} 3 free bids to start, plus 1 free every month.`).length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
  });
  it("site default description fits", () => {
    expect(site.metaDescription.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
  });
});

describe("lessonTitle", () => {
  it("keeps the course name when it fits", () => {
    expect(lessonTitle("Finding qualified leads", "Contractor Sales Academy")).toBe("Finding qualified leads | Contractor Sales Academy");
  });
  it("drops a long course name", () => {
    expect(lessonTitle("Roofing sales playbook", "Selling Roof Replacements When the Roof Looks Fine")).toBe("Roofing sales playbook");
  });
});
