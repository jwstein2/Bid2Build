import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTrade } from "@/lib/trades/catalog";
import { LANDING_TRADES, landingFor } from "@/lib/trades/landing";
import { accountCtas } from "@/lib/account/status";

describe("trade landing copy", () => {
  it("covers the priority trades with real catalog slugs and a sample proposal image", () => {
    for (const slug of LANDING_TRADES) {
      expect(getTrade(slug), slug).toBeTruthy();
      expect(fs.existsSync(path.resolve(`public/media/proposals/${slug}-v1.webp`)), `${slug} image`).toBe(true);
    }
  });
  it("uses the owner's example copy for decks and painting", () => {
    expect(landingFor("decks")).toMatchObject({ headline: "Stop Spending Your Nights Writing Deck Estimates.", cta: "Create Your First Free Deck Bid" });
    expect(landingFor("painting")).toMatchObject({ headline: "More Professional Painting Estimates. Less Paperwork.", cta: "Create a Free Painting Estimate" });
  });
  it("makes no speed, profit, conversion or testimonial claims", () => {
    const banned = /\b(\d+\s?%|\d+x|faster|in minutes|seconds|guarantee|win more|more profit|increase|boost|double|best|#1|testimonial|customers say|trusted by)\b/i;
    for (const slug of LANDING_TRADES) {
      const l = landingFor(slug)!;
      for (const text of [l.headline, l.sub, l.cta, ...l.pains, l.calculator, ...l.calculatorBullets]) expect(text, `${slug}: ${text}`).not.toMatch(banned);
    }
  });
  it("trades without landing copy keep the original page", () => {
    expect(landingFor("plumbing")).toBeNull();
  });
  it("the trade CTA label only changes for signed-out visitors", () => {
    const opts = { createHref: "/start/decks", createFreeLabel: "Create Your First Free Deck Bid" };
    expect(accountCtas({ kind: "signed_out" } as never, opts).primary).toMatchObject({ label: "Create Your First Free Deck Bid", href: "/start/decks" });
  });
});
