import { describe, expect, it } from "vitest";
import generated from "@/lib/learn/generated-articles.json";
import { articles, articlesForTrade, type Article } from "@/lib/learn/articles";
import { checkArticle, checkFormulaMath, nextTopic, topicPlan } from "@/lib/learn/article-checks";
import { trades } from "@/lib/trades/catalog";

const knownTrades = new Set(trades.map((t) => t.slug));

const good: Article = {
  slug: "how-to-price-decks-jobs",
  trade: "decks",
  title: "How to Price Deck Jobs: A Step-by-Step Method",
  description: "A practical way to price deck work from your own costs: takeoff, materials with waste, labor hours, overhead, and markup or margin.",
  updated: "2026-11-16",
  published: "2026-11-16",
  blocks: [
    { p: ["Pricing a deck starts with your own numbers. Use supplier quotes and your recent invoices, not guesses. ".repeat(6)] },
    ...["Measure the deck", "Take off materials", "Estimate labor hours", "Add equipment and disposal", "Cover overhead", "Set markup or margin"].map((h) => ({ h, p: ["Work from your own costs and local supplier quotes so the number reflects how your crew builds. ".repeat(12)] })),
    { h: "Worked example", p: ["These figures are an example for illustration only."], formula: ["Example: 40 joists × $18 = $720", "Example: $3,000 cost × 1.25 = $3,750 price (25% markup)"] },
  ],
};

describe("article checks", () => {
  it("accepts a clean guide", () => {
    expect(checkArticle(good, { knownTrades }).problems).toEqual([]);
  });

  it("rejects invented market prices, ranges and statistics", () => {
    const bad = structuredClone(good);
    bad.blocks[1].p = ["The average cost of a deck is high, and according to a survey prices run $25 to $40 per square foot. Use local quotes."];
    const { problems } = checkArticle(bad, { knownTrades });
    expect(problems.join(" ")).toMatch(/average cost/);
    expect(problems.join(" ")).toMatch(/survey/);
    expect(problems.join(" ")).toMatch(/price range/);
    expect(problems.join(" ")).toMatch(/only inside worked-example/);
  });

  it("catches arithmetic errors in worked examples", () => {
    expect(checkFormulaMath("Example: 40 joists × $18 = $720")).toBeNull();
    expect(checkFormulaMath("Example: $10,000 cost × 1.25 = $12,500 price (25% markup)")).toBeNull();
    expect(checkFormulaMath("Example: $10,000 ÷ 0.75 = $13,333.33")).toBeNull();
    expect(checkFormulaMath("Example: $10,000 × 25% = $2,500")).toBeNull();
    expect(checkFormulaMath("Price = Cost × (1 + Markup)")).toBeNull();
    expect(checkFormulaMath("Example: 12 squares × $95 = $1,240")).toMatch(/does not add up/);
    expect(checkFormulaMath("Example: $2,000 + $500 = $2,600")).toMatch(/does not add up/);
  });

  it("requires examples to be labelled and a known trade", () => {
    const bad = structuredClone(good);
    bad.trade = "underwater-welding";
    bad.blocks[7] = { h: "The numbers", formula: ["40 joists × $18 = $720", "$720 + $80 = $800"] };
    const text = checkArticle(bad, { knownTrades }).problems.join(" ");
    expect(text).toMatch(/unknown trade/);
    expect(text).toMatch(/labelled as an example/);
  });

  it("core guides keep correct example math", () => {
    for (const a of articles) for (const b of a.blocks) for (const f of b.formula ?? []) expect(checkFormulaMath(f), f).toBeNull();
  });
});

describe("topic plan", () => {
  const plan = topicPlan(trades);
  it("has unique slugs for known trades and enough topics for months of posts", () => {
    expect(new Set(plan.map((t) => t.slug)).size).toBe(plan.length);
    expect(plan.length).toBeGreaterThan(70);
    for (const t of plan) if (t.trade) expect(knownTrades.has(t.trade)).toBe(true);
  });
  it("starts with featured trades and skips published topics", () => {
    const first = nextTopic(trades, new Set());
    expect(trades.find((t) => t.slug === first?.trade)?.featured).toBe(true);
    expect(nextTopic(trades, new Set([first!.slug]))?.slug).not.toBe(first!.slug);
  });
});

describe("published pricing guides", () => {
  const list = generated as Article[];
  it("every generated guide passes the checks", () => {
    const seen = new Set<string>();
    for (const a of list) {
      expect(checkArticle(a, { knownTrades, existingSlugs: seen }).problems, a.slug).toEqual([]);
      seen.add(a.slug);
    }
  });
  it("never collides with a core guide and links back from its trade page", () => {
    expect(new Set(articles.map((a) => a.slug)).size).toBe(articles.length);
    for (const a of list) if (a.trade) expect(articlesForTrade(a.trade).map((x) => x.slug)).toContain(a.slug);
  });
});
