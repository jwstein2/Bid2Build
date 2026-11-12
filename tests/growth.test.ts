import { describe, expect, it } from "vitest";
import { decodeAttribution, encodeAttribution, normalizeEmail, parseAttribution } from "@/lib/growth/attribution";
import { effectOf } from "@/lib/growth/instantly-events";
import { nextStage } from "@/lib/growth/leads";
import { resolveAllowIndexing, resolveDeployContext, resolveSiteUrl } from "@/lib/config/deploy";

describe("deploy config", () => {
  it("production uses the canonical domain, then Netlify URL", () => {
    expect(resolveSiteUrl({ CONTEXT: "production", NEXT_PUBLIC_SITE_URL: "https://built2bid.org/", URL: "https://built2bid.netlify.app" })).toBe("https://built2bid.org");
    expect(resolveSiteUrl({ CONTEXT: "production", URL: "https://built2bid.netlify.app" })).toBe("https://built2bid.netlify.app");
  });
  it("previews always use their own URL even if the production URL is set for all contexts", () => {
    expect(resolveSiteUrl({ CONTEXT: "deploy-preview", NEXT_PUBLIC_SITE_URL: "https://built2bid.org", DEPLOY_PRIME_URL: "https://deploy-preview-4--built2bid.netlify.app" })).toBe("https://deploy-preview-4--built2bid.netlify.app");
    expect(resolveSiteUrl({ CONTEXT: "branch-deploy", DEPLOY_PRIME_URL: "https://staging--built2bid.netlify.app/" })).toBe("https://staging--built2bid.netlify.app");
  });
  it("local falls back to localhost", () => {
    expect(resolveSiteUrl({})).toBe("http://localhost:3000");
    expect(resolveDeployContext({})).toBe("local");
  });
  it("indexing is only possible on production with the flag", () => {
    expect(resolveAllowIndexing({ CONTEXT: "production", NEXT_PUBLIC_ALLOW_INDEXING: "true" })).toBe(true);
    expect(resolveAllowIndexing({ CONTEXT: "production" })).toBe(false);
    expect(resolveAllowIndexing({ CONTEXT: "deploy-preview", NEXT_PUBLIC_ALLOW_INDEXING: "true" })).toBe(false);
    expect(resolveAllowIndexing({ NEXT_PUBLIC_ALLOW_INDEXING: "true" })).toBe(false);
  });
});

describe("attribution", () => {
  it("captures UTM and Instantly campaign ids, nothing without params", () => {
    const a = parseAttribution(new URL("https://built2bid.org/bids/roofing?utm_source=instantly&utm_medium=email&utm_campaign=Roofers%20Q1&ic=abc-123"), new Date("2026-11-12T00:00:00Z"));
    expect(a).toMatchObject({ source: "instantly", medium: "email", campaign: "Roofers Q1", campaignId: "abc-123", path: "/bids/roofing", at: "2026-11-12T00:00:00.000Z" });
    expect(parseAttribution(new URL("https://built2bid.org/pricing"))).toBeNull();
  });
  it("drops values with unexpected characters", () => {
    expect(parseAttribution(new URL("https://x.org/?utm_source=%3Cscript%3E"))).toBeNull();
  });
  it("round-trips through the cookie and rejects garbage", () => {
    const a = parseAttribution(new URL("https://x.org/?ref=friend"))!;
    expect(decodeAttribution(encodeAttribution(a))).toEqual(a);
    expect(decodeAttribution("%7Bnot json")).toBeNull();
    expect(decodeAttribution("x".repeat(3000))).toBeNull();
  });
  it("normalizes emails", () => {
    expect(normalizeEmail("  Pat@Example.COM ")).toBe("pat@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});

describe("lifecycle", () => {
  it("stages only move forward, except paid <-> churned", () => {
    expect(nextStage("prospect", "replied")).toBe("replied");
    expect(nextStage("signed_up", "replied")).toBe("signed_up");
    expect(nextStage("paid", "churned")).toBe("churned");
    expect(nextStage("churned", "paid")).toBe("paid");
    expect(nextStage("paid", "signed_up")).toBe("paid");
  });
  it("maps Instantly events; opt-outs suppress and block", () => {
    expect(effectOf("lead_unsubscribed")).toEqual({ suppress: "unsubscribed", block: true });
    expect(effectOf("email_bounced")).toEqual({ suppress: "bounced" });
    expect(effectOf("reply_received")).toEqual({ stage: "replied" });
    expect(effectOf("campaign_completed")).toEqual({});
  });
});
