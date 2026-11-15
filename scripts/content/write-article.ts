/**
 * Weekly pricing-guide writer. Run twice a week by .github/workflows/pricing-articles.yml.
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/content/write-article.ts [--dry-run] [--topic <slug>]
 *
 * 1. Picks the next unpublished topic from the plan in src/lib/learn/article-checks.ts.
 * 2. Research: Haiku 5.5 with web search looks up what is changing for that trade (materials,
 *    lead times, energy code adoption, insurance, demand) and the phrases people search for. Only
 *    pages the search actually returned may be cited, as "Further reading". If search fails the
 *    guide is written without a trends section.
 * 3. Asks Claude Haiku 5.5 to draft it from Built2Bid's own trade data (sections, items, units,
 *    tips), the research notes, and the vetted building code sections for the trade
 *    (src/lib/learn/code-references.ts, International Residential Code), under strict rules: no
 *    market prices, statistics or dated claims; dollar figures only in labelled worked examples;
 *    code sections named and described, never paraphrased into measurements.
 * 4. Runs the automated checks (banned claims, length, example math) and a second Haiku pass
 *    acting as an estimating editor. Problems go back for up to three rewrites; if it still fails, nothing
 *    is published and the job exits non-zero (GitHub emails the repo owner).
 * 5. Appends the guide to src/lib/learn/generated-articles.json. The workflow commits it to main
 *    and Netlify deploys it like any other change.
 *
 * Cost: about 3-5 cents per guide (Haiku 5.5 at $0.10 / $0.50 per million tokens, plus web
 * search at $10 per 1,000 searches, capped at 4 searches per guide).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tradeSeeds } from "../../src/lib/trades/data";
import type { Article } from "../../src/lib/learn/articles";
import { checkArticle, nextTopic, topicPlan, type Topic } from "../../src/lib/learn/article-checks";
import { codeRefsFor } from "../../src/lib/learn/code-references";

const MODEL = process.env.ARTICLE_MODEL?.trim() || "claude-haiku-5-5";
/** Rewrites allowed after the first draft before the run gives up without publishing. */
const MAX_REWRITES = 3;
/** Web searches allowed in the research step ($0.01 each). */
const MAX_SEARCHES = 4;
const root = join(import.meta.dirname, "../..");
const STORE = join(root, "src/lib/learn/generated-articles.json");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const forced = args.includes("--topic") ? args[args.indexOf("--topic") + 1] : undefined;

const BlockSchema = z.object({
  h: z.string().describe("Section heading. Omit only for the opening paragraph block.").optional(),
  p: z.array(z.string()).describe("Paragraphs, plain text, no markdown.").optional(),
  list: z.array(z.string()).describe("Bullet points, plain text.").optional(),
  formula: z.array(z.string()).describe("Formula or worked-example lines, one calculation per line, e.g. 'Example: 12 squares × $95 = $1,140'.").optional(),
});
const DraftSchema = z.object({
  title: z.string(),
  description: z.string().describe("Meta description, 120-160 characters, plain and specific."),
  blocks: z.array(BlockSchema),
  sources: z.array(z.object({ title: z.string(), url: z.string() })).describe("Up to 4 pages from the ALLOWED SOURCES list that support the trends section, copied exactly. Empty if there is no trends section.").optional(),
});
const ReviewSchema = z.object({
  approved: z.boolean(),
  problems: z.array(z.string()).describe("Each concrete problem that must be fixed before publishing. Empty when approved."),
});

const FEATURES = [
  "Estimates are organised in sections with line items (quantity, unit, unit cost, cost type: material, labor, equipment, subcontractor, other).",
  "Price each estimate with either markup on cost or target gross margin; the other number is shown for reference.",
  "Suggested items per trade are a checklist with no prices; the contractor enters their own costs.",
  "Per-section control of what the customer sees on the proposal (item names, prices, or totals only).",
  "Sales tax applies only to lines marked taxable; adjustments/discounts apply before tax.",
  "Quantity calculators for areas, volumes, perimeters, roof planes, stairs and labor hours.",
  "Branded PDF proposals with scope, exclusions, terms and e-signature.",
];

const SYSTEM = `You write practical pricing guides for Built2Bid, a free estimate and proposal builder for small contractors and tradespeople in the United States. Readers are owner-operators who know their trade and want to price jobs profitably.

Hard rules (an automated checker rejects drafts that break them):
- Never state what work, materials or labor cost or typically cost, in any region. No price ranges, no "average cost", no market or national claims, no statistics, studies, surveys or "according to". No years or "current prices".
- Dollar figures may appear ONLY inside formula blocks as a clearly labelled worked example. Start such lines with "Example:" or put "Example" in the section heading, and say the numbers are for illustration only. Use simple round numbers.
- The worked example is a deliberately simplified illustration of the math, not a complete bid. Head it "Simplified example" and open it with one sentence naming exactly which lines it covers and saying a real estimate includes every section above. Describe the example scope only as those lines (do not call it a full job). Keep it consistent with the method you describe (same units and the same way of pricing labor).
- Every calculation must be arithmetically correct. Write one calculation per formula line in the form "Example: 12 squares × $95 = $1,140". Use × for multiply and ÷ for divide. Keep percentages as markup/margin math consistent with: Price = Cost × (1 + Markup); Price = Cost ÷ (1 − Margin).
- Tell the reader to use their own costs: supplier quotes, recent invoices, their labor rate, local permit fees.
- For permits, licensing, tax and contract terms, say requirements vary and point to the local building department, state licensing board, a tax professional or an attorney.
- Building code: you may cite ONLY the International Residential Code (IRC) sections given in the brief, by number and title, exactly as listed. Say what topic the section covers and that it is something an inspector may look at, and tell readers to ask the building department which inspections apply. Do not claim when or how inspections happen, and do not attribute topics to a section beyond its listed title. Never state a dimension, spacing, load, rating or other value from any code, never name a code edition or year, and never cite a section that is not listed. Say that local editions and amendments vary and to confirm with the local building department. Also tell readers to follow manufacturer installation instructions.
- Market trends: use only what the research notes support, phrased qualitatively with no numbers, percentages, prices or dates, and tied to what the contractor should do when pricing (confirm lead times, check supplier quotes, set a price validity date, ask the building department). Do not write "according to". Do not present a trend as certain everywhere; say to check how it applies locally.
- Use the search phrases from the research notes only where they read naturally, for example in a heading. Never stuff keywords.
- Plain text only. No markdown, no emojis, no exclamation marks, no hype, no superlatives. Short paragraphs. American English.
- Mention Built2Bid at most twice, factually, using only these features: ${FEATURES.join(" ")}
- Structure: an opening block with no heading (1-2 short paragraphs), then 7-11 headed sections, ending with a short "Putting it together" or similar section. 900-1400 words total.`;

function tradeContext(slug: string | undefined): string {
  const t = tradeSeeds.find((x) => x.slug === slug);
  if (!t) return "This is a general topic for contractors in any trade. Use examples from common residential trades.";
  const groups = t.groups.map((g) => `- ${g.name}: ${g.items.map((i) => { const [n, u] = i.split("|"); return `${n} (${u ?? "each"})`; }).join("; ")}`).join("\n");
  return `Trade: ${t.name}
How Built2Bid describes it: ${t.intro}
Typical projects: ${t.projects.join("; ")}
Built2Bid's estimate sections and suggested items for this trade (name and purchase/installation unit):
${groups}
Contractor tips already on our ${t.name} page: ${t.tips.join(" ")}
Use these sections, items and units in the guide so it matches the estimate a contractor builds in Built2Bid.`;
}

function codeContext(trade: string | undefined, required: boolean): string {
  const refs = codeRefsFor(trade);
  if (!refs.length) return `Building code: the International Residential Code does not cover this work directly. Include a headed "Quality tips" section with 4-6 practical, trade-specific quality tips (doing the work right the first time, protecting the property, call-backs to avoid, following product labels and manufacturer instructions, local rules to check). Do not cite any code section.`;
  return `Building code sections you may cite (International Residential Code, ICC). Cite only these, by number and title:
${refs.map((r) => `- ${r.code}: ${r.title}`).join("\n")}
${required ? `Include a headed section such as "Quality tips and code items inspectors check" with 4-6 bullet tips specific to this trade. Where a tip relates to one of the sections above, name it (for example "${refs[0].code} (${refs[0].title.replace(/ \(.*$/, "")})") and say what it covers in the words of its title, without any measurements or values. Explain how each tip affects the estimate: the labor, materials or inspection time to include so the job is priced to be done right.` : "Mention a listed section only where it genuinely helps."}`;
}

const client = new Anthropic({ timeout: 120_000, maxRetries: 2 });
const spend = { input: 0, output: 0 };

async function ask<S extends z.ZodType>(system: string, user: string, schema: S, effort: "low" | "medium"): Promise<z.infer<S>> {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort, format: zodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: user }],
  });
  spend.input += res.usage.input_tokens;
  spend.output += res.usage.output_tokens;
  if (res.stop_reason === "refusal") throw new Error("The model declined this topic.");
  if (res.stop_reason === "max_tokens") throw new Error("The draft was cut off (max_tokens).");
  if (!res.parsed_output) throw new Error("The model returned output that did not match the schema.");
  return res.parsed_output;
}

interface Research { notes: string; sources: { title: string; url: string }[]; searches: number }

/** Web research on what is changing for the trade and how people search for it. Never throws. */
async function research(topic: Topic): Promise<Research | null> {
  const t = tradeSeeds.find((x) => x.slug === topic.trade);
  const subject = t ? `${t.name.toLowerCase()} work (${t.projects.slice(0, 3).join("; ")})` : `the topic "${topic.title}" for small construction contractors`;
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 6000,
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES, user_location: { type: "approximate", country: "US" } }],
      system: "You research background notes for a practical pricing guide for small US contractors. Rely only on what your searches return. Prefer trade associations, manufacturers, government agencies, the International Code Council and established trade publications over blogs and lead-generation sites.",
      messages: [{ role: "user", content: `Research ${subject}. Find:
1. Recent changes that affect how US contractors in this trade plan and price jobs: material availability and lead times, product or installation method shifts, energy or building code adoption, insurance, permitting, labor availability, customer demand. Include worldwide supply or market changes only if they affect US jobs.
2. The questions and phrases homeowners and contractors search for about pricing or estimating this work.

Then reply in plain text with exactly two parts:
TRENDS: 2-4 bullets. Each is one qualitative sentence with no numbers, prices, percentages or dates, followed by the URL of the search result that supports it.
SEARCH PHRASES: 5-8 short phrases people search for.
Leave out anything your search results do not support.` }],
    });
    spend.input += res.usage.input_tokens;
    spend.output += res.usage.output_tokens;
    const searches = res.usage.server_tool_use?.web_search_requests ?? 0;
    const found = new Map<string, string>();
    for (const b of res.content) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r.url.startsWith("https://")) found.set(r.url, r.title.trim() || new URL(r.url).hostname);
      }
    }
    const notes = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    if (!found.size || !/TRENDS:/i.test(notes)) {
      console.log("Research returned no usable results; writing without a trends section.");
      return { notes: "", sources: [], searches };
    }
    return { notes, sources: [...found].map(([url, title]) => ({ url, title })), searches };
  } catch (e) {
    console.log(`Research step skipped (${e instanceof Error ? e.message : e}); writing without a trends section.`);
    return null;
  }
}

function toArticle(topic: Topic, draft: z.infer<typeof DraftSchema>, today: string, allowed: Map<string, string>): Article {
  const clean = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
  return {
    slug: topic.slug,
    title: clean(draft.title),
    description: clean(draft.description),
    updated: today,
    published: today,
    ...(topic.trade ? { trade: topic.trade } : {}),
    blocks: draft.blocks.map((b) => ({
      ...(b.h ? { h: clean(b.h) } : {}),
      ...(b.p?.length ? { p: b.p.map(clean) } : {}),
      ...(b.list?.length ? { list: b.list.map(clean) } : {}),
      ...(b.formula?.length ? { formula: b.formula.map(clean) } : {}),
    })).filter((b) => b.h || b.p || b.list || b.formula),
    ...(() => {
      // Keep only pages the search really returned, with the search result's own title.
      const seen = new Set<string>();
      const sources = (draft.sources ?? []).map((x) => x.url.trim()).filter((u) => allowed.has(u) && !seen.has(u) && seen.add(u)).slice(0, 4).map((url) => ({ title: clean(allowed.get(url)!), url }));
      return sources.length ? { sources } : {};
    })(),
  };
}

async function review(a: Article, researchNotes: string): Promise<string[]> {
  const refs = codeRefsFor(a.trade).map((r) => `${r.code}: ${r.title}`).join("; ") || "none";
  const r = await ask(
    `You are a senior construction estimator and editor reviewing a guide before it is published on a contractor software website. Approve only if a careful estimator would sign off on it. Reject for: wrong or misleading estimating advice; arithmetic errors; any price, cost range or statistic presented as fact rather than a labelled example; building code, legal or tax requirements stated as specific universal values; a building code section described as covering something outside its title (the vetted IRC sections and titles for this guide are: ${refs}); saying an inspector "may" look at a listed topic is acceptable when the guide also says to confirm inspections with the local building department; quality tips that are wrong, unsafe or generic rather than specific to this trade; market trend statements not supported by the research notes provided, or stated as certain everywhere; claims about Built2Bid beyond this list: ${FEATURES.join(" ")}; filler, repetition or generic text that does not help a contractor price this work; safety advice that is wrong. The worked example is intentionally a simplified illustration of the arithmetic: do not reject it for leaving out line items, as long as it says which lines it covers and does not claim to be a complete bid. Ignore style preferences. List concrete problems only.`,
    `Research notes the writer was given (trend statements must be supported by these):\n${researchNotes || "(none: the guide should have no market trends section)"}\n\nReview this guide:\n\n${JSON.stringify(a, null, 2)}`,
    ReviewSchema,
    "medium",
  );
  return r.approved ? [] : r.problems.length ? r.problems : ["Reviewer rejected the draft without details."];
}

function summary(lines: string[]) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  for (const l of lines) console.log(l);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set. Add it as a GitHub Actions secret (see docs/seo/PRICING_ARTICLES.md).");
  const store = JSON.parse(readFileSync(STORE, "utf8")) as Article[];
  const published = new Set(store.map((a) => a.slug));
  const trades = tradeSeeds.map((t) => ({ slug: t.slug, name: t.name, featured: t.featured }));
  const topic = forced ? topicPlan(trades).find((t) => t.slug === forced) : nextTopic(trades, published);
  if (!topic) { summary(["All planned topics are published. Add new ones to topicPlan() in src/lib/learn/article-checks.ts."]); return; }
  if (published.has(topic.slug)) throw new Error(`${topic.slug} is already published.`);
  const today = new Date().toISOString().slice(0, 10);
  const knownTrades = new Set(trades.map((t) => t.slug));

  const found = await research(topic);
  const allowed = new Map((found?.sources ?? []).map((x) => [x.url, x.title]));
  const requireCodeSection = Boolean(topic.trade && codeRefsFor(topic.trade).length);
  const researchBrief = found?.notes
    ? `Research notes from a web search (use only what these support):
${found.notes}

ALLOWED SOURCES (the only URLs you may list in sources, copied exactly):
${found.sources.map((x) => `- ${x.title}: ${x.url}`).join("\n")}

Include a headed section on what is changing for ${topic.trade ? `${tradeSeeds.find((x) => x.slug === topic.trade)?.name.toLowerCase()} contractors` : "contractors"} and how to reflect it in a bid, and list the supporting pages in sources.`
    : "No research notes are available. Do not include a market trends section and leave sources empty.";

  const brief = `Write the guide "${topic.title}".
Angle: ${topic.angle}

${tradeContext(topic.trade)}

${codeContext(topic.trade, requireCodeSection)}

${researchBrief}

Return the title (you may refine it, keep it under 70 characters), a meta description, and the content blocks.`;

  let article = toArticle(topic, await ask(SYSTEM, brief, DraftSchema, "medium"), today, allowed);
  let problems = checkArticle(article, { knownTrades, existingSlugs: published, allowedSources: new Set(allowed.keys()), requireCodeSection }).problems;
  if (!problems.length) problems = await review(article, found?.notes ?? "");
  for (let attempt = 1; attempt <= MAX_REWRITES && problems.length; attempt++) {
    console.log(`Draft ${attempt} needs fixes:\n- ${problems.join("\n- ")}`);
    const fix = `${brief}\n\nYour previous draft is below. Rewrite it to fix every problem listed, keeping what was good.\n\nProblems:\n- ${problems.join("\n- ")}\n\nPrevious draft:\n${JSON.stringify({ title: article.title, description: article.description, blocks: article.blocks, sources: article.sources ?? [] })}`;
    article = toArticle(topic, await ask(SYSTEM, fix, DraftSchema, "medium"), today, allowed);
    problems = checkArticle(article, { knownTrades, existingSlugs: published, allowedSources: new Set(allowed.keys()), requireCodeSection }).problems;
    if (!problems.length) problems = await review(article, found?.notes ?? "");
  }
  const searches = found?.searches ?? 0;
  const cost = (spend.input * 0.1 + spend.output * 0.5) / 1_000_000 + searches * 0.01;
  if (problems.length) {
    summary([`### Not published: ${topic.title}`, "", "The draft failed quality checks after every rewrite, so nothing went live. The next run tries again.", "", ...problems.map((p) => `- ${p}`), "", `API cost: $${cost.toFixed(4)}`]);
    process.exit(1);
  }
  if (dryRun) {
    console.log(JSON.stringify(article, null, 2));
  } else {
    writeFileSync(STORE, JSON.stringify([...store, article], null, 2) + "\n");
  }
  summary([`### ${dryRun ? "Drafted (dry run)" : "Published"}: ${article.title}`, "", `https://built2bid.org/learn/${article.slug}`, "", `Model: ${MODEL}. Tokens: ${spend.input} in / ${spend.output} out. Web searches: ${searches}. API cost: $${cost.toFixed(4)}.`, ...(article.sources?.length ? ["", "Further reading:", ...article.sources.map((x) => `- ${x.title}: ${x.url}`)] : [])]);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `slug=${article.slug}\ntitle=${article.title.replace(/\n/g, " ")}\n`);
}

main().catch((e) => {
  console.error(e instanceof Anthropic.APIError ? `Anthropic API error ${e.status ?? "network"}: ${e.message}` : e instanceof Error ? e.message : e);
  process.exit(1);
});
