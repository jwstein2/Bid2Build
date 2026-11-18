import type { NewsArticle } from "./types";

/**
 * Sandbox / demo fixtures (V6.8 §16). Clearly fictional: every headline starts with "Sample", the
 * publisher is "Built2Bid sample", `sample: true` makes every card show a SAMPLE badge, and links go
 * to the Sources page that explains samples instead of pretending to be a real article. Never mixed
 * into a live feed; shown only in Sandbox/preview mode or in tests.
 */

const SAMPLE_URL = "/industry/sources#samples";
const PUBLISHER = "Built2Bid sample (not real news)";

const base = (i: number, over: Partial<NewsArticle>): NewsArticle => ({
  id: `00000000-0000-4000-a000-${String(i).padStart(12, "0")}`, sourceKey: "sample", headline: "", publisher: PUBLISHER, url: SAMPLE_URL,
  publishedAt: new Date(Date.now() - i * 86400_000).toISOString(), datePrecision: "day", lastVerifiedAt: new Date().toISOString(),
  categories: [], trades: [], geoLevel: "national", states: [], counties: [], regions: [], articleType: "news", authority: "industry",
  snippet: null, summary: null, summaryStatus: "none", effectiveOn: null, jurisdiction: null, imageUrl: null, verified: false, sample: true, ...over,
});

export function sampleArticles(state: string | null): (NewsArticle & { tradeTerms: Record<string, string[]>; places: string[] })[] {
  const st = state ?? "MN";
  return [
    { ...base(1, { headline: "Sample: State agency proposes changes to roofing permit inspections", authority: "official", articleType: "proposed_rule", geoLevel: "state", states: [st], trades: ["roofing", "gutters"], categories: ["building_codes", "licensing_regulations"], jurisdiction: "Sample jurisdiction", summary: "Sample summary. A state agency has proposed changes to how roofing permits are inspected. The proposal is open for comment and nothing has changed yet. This text is a fictional example of how official items appear." }), tradeTerms: { roofing: ["roofing"] }, places: [] },
    { ...base(2, { headline: "Sample: Lumber and sheathing prices in a regional supplier survey", articleType: "analysis", trades: ["framing", "decks", "general-contracting"], categories: ["material_prices"], snippet: "Fictional example of a trade-press item: a publisher's short description appears here, with a link to the original article." }), tradeTerms: { framing: ["lumber"], decks: ["lumber"] }, places: [] },
    { ...base(3, { headline: "Sample: Heat-illness guidance for outdoor crews", authority: "official", articleType: "notice", trades: ["landscaping", "roofing", "concrete", "asphalt-paving"], categories: ["safety", "labor_workforce"], summary: "Sample summary. A federal safety agency published a notice about protecting outdoor workers from heat. This text is a fictional example." }), tradeTerms: { landscaping: ["heat illness"], roofing: ["roofing"] }, places: [] },
    { ...base(4, { headline: "Sample: Severe storm disaster declaration", authority: "official", articleType: "disaster_declaration", geoLevel: "local", states: [st], trades: ["roofing", "siding", "gutters", "windows-doors", "fencing"], categories: ["disaster_recovery", "local_construction"], summary: "Sample summary. A disaster declaration was issued for several counties after severe storms. This text is a fictional example of a local item." }), tradeTerms: {}, places: [] },
    { ...base(5, { headline: "Sample: Electrical code update training sessions announced", articleType: "news", trades: ["electrical"], categories: ["building_codes", "trade_association"], snippet: "Fictional example: an association announces training on code changes." }), tradeTerms: { electrical: ["electrical"] }, places: [] },
    { ...base(6, { headline: "Sample: Heat pump efficiency standard takes effect", authority: "official", articleType: "final_rule", trades: ["hvac", "plumbing"], categories: ["building_codes"], effectiveOn: null, summary: "Sample summary. A federal efficiency standard for heat pumps is described here as a fictional example of a final rule." }), tradeTerms: { hvac: ["heat pump"] }, places: [] },
    { ...base(7, { headline: "Sample: Remodeling market index for the quarter", articleType: "analysis", trades: ["kitchens", "bathrooms", "interior-remodeling", "general-contracting"], categories: ["housing_market", "residential_construction"], snippet: "Fictional example of housing-market research from an association." }), tradeTerms: { kitchens: ["remodeling"] }, places: [] },
  ];
}
