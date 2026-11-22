import { describe, expect, it } from "vitest";
import { ecfrDiscover, parseCfrCitation, toSegments, wantsFederal } from "@/lib/academy/kb/ecfr";
import { CODEBOOK, codebookDrift, federalHeading, findPart, sectionsOf } from "@/lib/academy/kb/codebook";
import { suggest } from "@/lib/academy/kb/autocomplete";
import { highlightTerms } from "@/lib/academy/kb/answer";
import { TOPIC_SHORTCUTS } from "@/lib/academy/kb/examples";
import index from "../public/academy-codes/federal-sections.json";

const sections = index.sections as [string, string][];
const api = (results: unknown[], status = 200) => (async () => new Response(JSON.stringify({ results }), { status })) as unknown as typeof fetch;
const row = (title: string, section: string | null, extra: Record<string, unknown> = {}) => ({ score: 10,
  type: "Section", starts_on: "2016-09-01", ends_on: null, hierarchy: { title, part: section?.split(".")[0] ?? null, subpart: "M", section },
  headings: { section: "Duty to have <strong>fall</strong> protection.", subpart: "Fall Protection" },
  full_text_excerpt: 'employers <strong>fall</strong> <script>alert(1)</script><span class="elipsis">…</span>&amp; more', ...extra,
});

describe("eCFR citations and intent", () => {
  it("parses federal citations in common forms", () => {
    expect(parseCfrCitation("40 CFR 745.85")).toEqual({ title: 40, part: "745", section: "745.85" });
    expect(parseCfrCitation("29 C.F.R. § 1926.501(b)(13)")).toEqual({ title: 29, part: "1926", section: "1926.501" });
    expect(parseCfrCitation("29 CFR part 1926")).toEqual({ title: 29, part: "1926", section: null });
    expect(parseCfrCitation("deck railing height")).toBeNull();
  });
  it("only asks eCFR about federal topics, never for building-code questions", () => {
    expect(wantsFederal("deck railing height", "building")).toBe(false);
    expect(wantsFederal("deck stair riser requirements", null)).toBe(false);
    expect(wantsFederal("lead paint renovation pre-1978", null)).toBe(true);
    expect(wantsFederal("OSHA fall protection residential roofing", "safety")).toBe(true);
    expect(wantsFederal("40 CFR 745.85", "environment")).toBe(true);
    expect(wantsFederal("guard height osha", "building")).toBe(true);
  });
  it("sanitizes excerpts to plain text with hit markers only", () => {
    const s = toSegments('a <strong>fall</strong> <script>x</script><span class="elipsis">…</span>&amp;b');
    expect(s.map((x) => x.text).join("")).toBe("a fall x … &b");
    expect(s.filter((x) => x.hit).map((x) => x.text)).toEqual(["fall"]);
    expect(JSON.stringify(s)).not.toMatch(/<|>/);
    // Nested or broken tags inside a hit can't survive, and entities decode once.
    const t = toSegments("<strong><<script>script>x</strong> &amp;lt;");
    expect(t.map((x) => x.text).join("")).toBe("scriptscriptx &lt;");
  });
});

describe("eCFR discovery layer", () => {
  it("returns current sections, skips historical/removed/non-section rows and ones already shown", async () => {
    const f = api([row("29", "1926.501"), row("29", "1926.502", { ends_on: "2020-01-01" }), row("29", null, { type: "Subpart" }), row("29", "1926.503", { removed: true }), row("29", "1926.1053")]);
    const hits = await ecfrDiscover("fall protection", { fetcher: f, exclude: ["29 CFR 1926.1053(a)"] });
    expect(hits?.map((h) => h.citation)).toEqual(["29 CFR 1926.501"]);
    expect(hits?.[0].url).toBe("https://www.ecfr.gov/current/title-29/section-1926.501");
  });
  it("drops weak matches relative to the best one", async () => {
    const hits = await ecfrDiscover("scaffold guardrail", { fetcher: api([row("29", "1926.451", { score: 20 }), row("29", "1926.15", { score: 4 })]) });
    expect(hits?.map((h) => h.citation)).toEqual(["29 CFR 1926.451"]);
  });
  it("falls back (null) when eCFR is down or rate limited, and never throws", async () => {
    expect(await ecfrDiscover("fall protection", { fetcher: api([], 429) })).toBeNull();
    expect(await ecfrDiscover("fall protection", { fetcher: (async () => { throw new Error("timeout"); }) as unknown as typeof fetch })).toBeNull();
    expect(await ecfrDiscover("ab", { fetcher: api([row("29", "1926.501")]) })).toEqual([]);
  });
  it("does not full-text search an exact citation (the codebook card handles it)", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ results: [] })); }) as unknown as typeof fetch;
    expect(await ecfrDiscover("40 CFR 745.85", { fetcher: f })).toEqual([]);
    expect(urls.length).toBe(0);
    await ecfrDiscover("40 CFR part 745 renovation", { fetcher: f });
    expect(urls.length).toBe(1);
    expect(decodeURIComponent(urls[0])).toContain("hierarchy[title]=40");
    expect(urls[0]).toContain("date=current");
    expect(decodeURIComponent(urls[0])).not.toMatch(/query=[^&]*cfr/i);
  });
});

describe("Codebook snapshot", () => {
  it("covers OSHA construction, recordkeeping, EPA RRP and FMCSA parts with real headings", () => {
    expect(CODEBOOK.parts.map((p) => `${p.title}-${p.part}`)).toEqual(expect.arrayContaining(["29-1926", "29-1904", "40-745", "49-391", "49-395", "49-396"]));
    expect(federalHeading(29, "1926.501")?.heading).toBe("Duty to have fall protection");
    expect(federalHeading(40, "745.85")?.heading).toBe("Work practice standards");
    expect(sectionsOf(findPart("29-1926")!).length).toBeGreaterThan(200);
    expect(findPart("29-9999")).toBeNull();
  });
  it("flags a part amended after the snapshot", () => {
    const p = findPart("40-745")!;
    expect(codebookDrift({ "40-745": p.last_amended })).toEqual([]);
    expect(codebookDrift({ "40-745": "2099-01-01" }).map((d) => d.key)).toEqual(["40-745"]);
  });
});

describe("Autocomplete and highlighting", () => {
  it("is citation-aware", () => {
    const s = suggest("1926.50", TOPIC_SHORTCUTS, sections);
    expect(s[0].value).toMatch(/^29 CFR 1926\.50/);
    expect(s.every((x) => x.kind === "section")).toBe(true);
    expect(suggest("40 cfr 745.8", TOPIC_SHORTCUTS, sections).map((x) => x.value)).toContain("40 CFR 745.85");
  });
  it("suggests topics first, then section headings", () => {
    const s = suggest("lead", TOPIC_SHORTCUTS, sections);
    expect(s[0]).toMatchObject({ kind: "topic" });
    expect(suggest("deck rail", TOPIC_SHORTCUTS, sections).map((x) => x.value)).toContain("deck railing height");
    expect(suggest("x", TOPIC_SHORTCUTS, sections)).toEqual([]);
  });
  it("marks searched words without stop words", () => {
    const parts = highlightTerms("Guards on decks; guard height", "deck guard height requirements");
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["Guard", "deck", "guard", "height"]);
    expect(highlightTerms("anything", "the and")).toEqual([{ text: "anything", hit: false }]);
  });
});
