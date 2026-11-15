/**
 * Weekly pricing-guide writer. Run twice a week by .github/workflows/pricing-articles.yml.
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/content/write-article.ts [--dry-run] [--topic <slug>]
 *
 * 1. Picks the next unpublished topic from the plan in src/lib/learn/article-checks.ts.
 * 2. Asks Claude Haiku 5.5 to draft it from Built2Bid's own trade data (sections, items, units,
 *    tips), under strict rules: no market prices, statistics or dated claims; dollar figures only
 *    in labelled worked examples.
 * 3. Runs the automated checks (banned claims, length, example math) and a second Haiku pass
 *    acting as an estimating editor. Problems go back for up to two rewrites; if it still fails, nothing
 *    is published and the job exits non-zero (GitHub emails the repo owner).
 * 4. Appends the guide to src/lib/learn/generated-articles.json. The workflow commits it to main
 *    and Netlify deploys it like any other change.
 *
 * Cost: a few cents a month at most (Haiku 5.5 list price $0.10 / $0.50 per million tokens).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tradeSeeds } from "../../src/lib/trades/data";
import type { Article } from "../../src/lib/learn/articles";
import { checkArticle, nextTopic, topicPlan, type Topic } from "../../src/lib/learn/article-checks";

const MODEL = process.env.ARTICLE_MODEL?.trim() || "claude-haiku-5-5";
/** Rewrites allowed after the first draft before the run gives up without publishing. */
const MAX_REWRITES = 2;
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
- For codes, permits, licensing, tax and contract terms, say requirements vary and point to the local building department, state licensing board, a tax professional or an attorney. Do not state specific code requirements.
- Plain text only. No markdown, no emojis, no exclamation marks, no hype, no superlatives. Short paragraphs. American English.
- Mention Built2Bid at most twice, factually, using only these features: ${FEATURES.join(" ")}
- Structure: an opening block with no heading (1-2 short paragraphs), then 6-10 headed sections, ending with a short "Putting it together" or similar section. 800-1300 words total.`;

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

function toArticle(topic: Topic, draft: z.infer<typeof DraftSchema>, today: string): Article {
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
  };
}

async function review(a: Article): Promise<string[]> {
  const r = await ask(
    `You are a senior construction estimator and editor reviewing a guide before it is published on a contractor software website. Approve only if a careful estimator would sign off on it. Reject for: wrong or misleading estimating advice; arithmetic errors; any price, cost range or statistic presented as fact rather than a labelled example; specific building code, legal or tax requirements stated as universal; claims about Built2Bid beyond this list: ${FEATURES.join(" ")}; filler, repetition or generic text that does not help a contractor price this work; safety advice that is wrong. The worked example is intentionally a simplified illustration of the arithmetic: do not reject it for leaving out line items, as long as it says which lines it covers and does not claim to be a complete bid. Ignore style preferences. List concrete problems only.`,
    `Review this guide:\n\n${JSON.stringify(a, null, 2)}`,
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

  const brief = `Write the guide "${topic.title}".
Angle: ${topic.angle}

${tradeContext(topic.trade)}

Return the title (you may refine it, keep it under 70 characters), a meta description, and the content blocks.`;

  let article = toArticle(topic, await ask(SYSTEM, brief, DraftSchema, "medium"), today);
  let problems = checkArticle(article, { knownTrades, existingSlugs: published }).problems;
  if (!problems.length) problems = await review(article);
  for (let attempt = 1; attempt <= MAX_REWRITES && problems.length; attempt++) {
    console.log(`Draft ${attempt} needs fixes:\n- ${problems.join("\n- ")}`);
    const fix = `${brief}\n\nYour previous draft is below. Rewrite it to fix every problem listed, keeping what was good.\n\nProblems:\n- ${problems.join("\n- ")}\n\nPrevious draft:\n${JSON.stringify({ title: article.title, description: article.description, blocks: article.blocks })}`;
    article = toArticle(topic, await ask(SYSTEM, fix, DraftSchema, "medium"), today);
    problems = checkArticle(article, { knownTrades, existingSlugs: published }).problems;
    if (!problems.length) problems = await review(article);
  }
  const cost = (spend.input * 0.1 + spend.output * 0.5) / 1_000_000;
  if (problems.length) {
    summary([`### Not published: ${topic.title}`, "", "The draft failed quality checks after every rewrite, so nothing went live. The next run tries again.", "", ...problems.map((p) => `- ${p}`), "", `API cost: $${cost.toFixed(4)}`]);
    process.exit(1);
  }
  if (dryRun) {
    console.log(JSON.stringify(article, null, 2));
  } else {
    writeFileSync(STORE, JSON.stringify([...store, article], null, 2) + "\n");
  }
  summary([`### ${dryRun ? "Drafted (dry run)" : "Published"}: ${article.title}`, "", `https://built2bid.org/learn/${article.slug}`, "", `Model: ${MODEL}. Tokens: ${spend.input} in / ${spend.output} out. API cost: $${cost.toFixed(4)}.`]);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `slug=${article.slug}\ntitle=${article.title.replace(/\n/g, " ")}\n`);
}

main().catch((e) => {
  console.error(e instanceof Anthropic.APIError ? `Anthropic API error ${e.status ?? "network"}: ${e.message}` : e instanceof Error ? e.message : e);
  process.exit(1);
});
