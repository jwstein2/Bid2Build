import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANNUAL, MONTHLY } from "@/lib/billing/plans";
import { classifyChannel } from "@/lib/admin/channels";
import { PRICES, PM_PRODUCT_NAME } from "@/lib/marketing/catalog";
import { FACTS_PATH, productFacts, VERIFIED_ON } from "@/lib/marketing/product-facts";
import { breadcrumbLd, faqLd, ldJson, softwareOffers } from "@/lib/seo/structured-data";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { INDEXNOW_KEY, validUrls } from "../scripts/seo/indexnow.mjs";

const ON = { NEXT_PUBLIC_PROJECT_SCHEDULING: "on", NEXT_PUBLIC_ESIGNATURES: "on", NEXT_PUBLIC_QUICKBOOKS: "on" };
const OFF = { NEXT_PUBLIC_PROJECT_SCHEDULING: "off", NEXT_PUBLIC_ESIGNATURES: "on" };
const PROHIBITED = [/win \d+% more/i, /increase revenue by/i, /reduce estimating time by/i, /save \d+ hours/i, /guaranteed/i, /pays? for itself/i, /trusted by (thousands|\d)/i, /(over|more than|join|trusted by) \d[\d,]*\+? (contractors|users|customers)\b/i, /\d[\d,]{2,}\+ (contractors|users|customers)\b/i, /5[- ]star/i, /award/i, /#1|number one|best[- ]in[- ]class/i, /AI-powered/i, /end-to-end/i];

// Visible text only (tier keys like "enterprise" are internal ids, never shown).
const allText = (f: ReturnType<typeof productFacts>) => JSON.stringify(f, (k, v) => (k === "tier" || k === "slug" ? undefined : v));

describe("product facts (V11.0)", () => {
  it("takes prices from the billing modules", () => {
    const f = productFacts(ON);
    const t = allText(f);
    expect(t).toContain(`${MONTHLY.price}/month or ${ANNUAL.price}/year`);
    expect(t).toContain(`${PRICES.enterpriseBase}/month for ${PRICES.enterpriseIncludedUsers} users`);
    expect(f.addOns[0]?.price).toContain(PRICES.pmMonthly);
    expect(f.plans.map((p) => p.name)).toEqual(["Free", "Individual Unlimited", "Team"]);
  });
  it("never says Enterprise, and makes none of the prohibited claims", () => {
    for (const env of [ON, OFF]) {
      const t = allText(productFacts(env));
      expect(t).not.toMatch(/enterprise/i);
      for (const re of PROHIBITED) expect(t, String(re)).not.toMatch(re);
    }
  });
  it("states the limits plainly: no payroll, no paying subs, no online invoice payments, no iPhone app", () => {
    const l = productFacts(ON).limitations.join(" ");
    expect(l).toMatch(/No built-in payroll/);
    expect(l).toMatch(/Does not pay subcontractors/);
    expect(l).toMatch(/cannot pay invoices online/);
    expect(l).toMatch(/No native iPhone app/);
    // Payroll only ever appears in the negative.
    for (const s of allText(productFacts(ON)).split(/(?<=[.!?])\s/)) if (/payroll/i.test(s)) expect(s).toMatch(/no built-in payroll|payroll runs there|run payroll|where you run payroll|Does .* run payroll/i);
  });
  it("hides the scheduling add-on everywhere when it is switched off", () => {
    const f = productFacts(OFF);
    expect(f.addOns).toEqual([]);
    expect(allText(f)).not.toContain(PM_PRODUCT_NAME);
    expect(softwareOffers(OFF).map((o) => o.name).join()).not.toContain(PM_PRODUCT_NAME);
  });
  it("mentions QuickBooks only when the integration is on", () => {
    expect(productFacts(ON).integrations.some((i) => i.name === "QuickBooks Online")).toBe(true);
    expect(productFacts(OFF).integrations.some((i) => i.name === "QuickBooks Online")).toBe(false);
  });
  it("has a valid verified date and is in the sitemap", () => {
    expect(VERIFIED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sitemap().some((e) => e.url.endsWith(FACTS_PATH))).toBe(true);
  });
  it("keeps Academy Advanced and the desktop app out of public facts until they are live", () => {
    const t = allText(productFacts(ON));
    expect(t).not.toMatch(/academy advanced|desktop app/i);
  });
});

describe("structured data", () => {
  it("offers carry the billing prices and a billing period", () => {
    const o = softwareOffers(ON);
    expect(o.find((x) => x.name === "Individual Unlimited Monthly")?.price).toBe(MONTHLY.price.replace("$", ""));
    expect(o.find((x) => x.name === "Individual Unlimited Annual")?.price).toBe(ANNUAL.price.replace("$", ""));
    expect(JSON.stringify(o)).not.toMatch(/aggregateRating|review/i);
  });
  it("breadcrumbs start at Home and use absolute URLs", () => {
    const b = breadcrumbLd([{ name: "Pricing", path: "/pricing" }]);
    expect(b.itemListElement[0]).toMatchObject({ position: 1, name: "Home" });
    expect(b.itemListElement[1].item).toMatch(/^https?:\/\/.+\/pricing$/);
  });
  it("escapes < so page text can't close the script tag", () => {
    expect(ldJson(faqLd([{ q: "</script><b>", a: "x" }]))).not.toContain("</script>");
  });
});

describe("crawler access", () => {
  it("previews stay blocked; production keeps the private-area rules", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    // Tests run as a non-production deploy, so everything is disallowed.
    expect(rules[0]).toMatchObject({ userAgent: "*", disallow: "/" });
    const src = readFileSync("src/app/robots.ts", "utf8");
    for (const p of ["/api/", "/admin", "/dashboard", "/settings", "/sign/", "/projects"]) expect(src).toContain(`"${p}"`);
  });
});

describe("AI search referrals", () => {
  it("counts ChatGPT, Perplexity, Claude, Gemini and Copilot visits as AI Search", () => {
    expect(classifyChannel({ utm_source: "chatgpt.com" })).toBe("ai_search");
    for (const h of ["chatgpt.com", "perplexity.ai", "claude.ai", "gemini.google.com", "copilot.microsoft.com", "grok.com"]) expect(classifyChannel({ referrer_host: h }), h).toBe("ai_search");
  });
  it("leaves search engines, social and paid tags alone", () => {
    expect(classifyChannel({ referrer_host: "google.com" })).toBe("organic_search");
    expect(classifyChannel({ referrer_host: "bing.com" })).toBe("organic_search");
    expect(classifyChannel({ referrer_host: "facebook.com" })).toBe("social");
    expect(classifyChannel({ utm_source: "google", utm_medium: "cpc" })).toBe("google_ads");
  });
});

describe("IndexNow", () => {
  it("serves the key file at the site root", () => {
    expect(INDEXNOW_KEY).toMatch(/^[a-f0-9]{32}$/);
    expect(existsSync(`public/${INDEXNOW_KEY}.txt`)).toBe(true);
    expect(readFileSync(`public/${INDEXNOW_KEY}.txt`, "utf8").trim()).toBe(INDEXNOW_KEY);
  });
  it("only submits public built2bid.org pages", () => {
    expect(validUrls(["https://built2bid.org/learn/x", "https://built2bid.org/learn/x", "https://built2bid.org/dashboard", "https://built2bid.org/sign/tok", "https://evil.com/a", "http://built2bid.org/", "https://built2bid.org/pricing?utm_source=x", "nope"])).toEqual(["https://built2bid.org/learn/x"]);
  });
});
