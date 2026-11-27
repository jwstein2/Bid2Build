import { FACTS_PATH, productFacts } from "@/lib/marketing/product-facts";
import { site } from "@/lib/site";

/**
 * /llms.txt: a short plain-text summary for AI tools, built from the same product facts as
 * /what-is-built2bid (no separate copy to drift). It is a convenience, not a ranking signal:
 * search engines and AI search crawlers read the normal HTML pages too.
 */
export const dynamic = "force-static";

export function GET() {
  const f = productFacts();
  const u = (p: string) => `${site.url}${p}`;
  const lines = [
    `# ${site.name}`,
    "",
    `> ${f.summary}`,
    "",
    `Facts last checked: ${f.verifiedOn}. Company: ${f.company.legalName} (${f.company.state}). Support: ${f.company.support}.`,
    "",
    "## Who it's for",
    ...f.audience.map((a) => `- ${a}`),
    "",
    "## Plans and prices (USD)",
    ...f.plans.map((p) => `- ${p.name}: ${p.price}. ${p.summary}`),
    ...f.addOns.map((a) => `- ${a.name} add-on: ${a.price}. ${a.summary}`),
    "",
    "## What it doesn't do",
    ...f.limitations.map((l) => `- ${l}`),
    "",
    "## Key pages",
    `- [Product facts](${u(FACTS_PATH)}): what ${site.name} is, features, prices and limits`,
    `- [Pricing](${u("/pricing")}): plans and every feature by plan`,
    `- [Trades](${u("/bids")}): estimate builders by trade`,
    `- [Free calculators](${u("/tools")})`,
    `- [Contractor guides](${u("/learn")})`,
    `- [Contractor Academy](${u("/academy/classroom")})`,
    `- [About](${u("/about")})`,
    `- [Security](${u("/security")})`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
