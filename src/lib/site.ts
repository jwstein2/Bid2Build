/**
 * Central brand configuration. Rebranding = change env vars (or these defaults).
 * Nothing else in the codebase hard-codes the product name or domain.
 */
export const site = {
  name: process.env.NEXT_PUBLIC_SITE_NAME ?? "Bid2Build",
  domain: process.env.NEXT_PUBLIC_SITE_DOMAIN ?? "localhost:3000",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  tagline: "What Are You Bidding Today?",
  description:
    "Build professional estimates, calculate your profit, and create beautiful proposals in minutes. Three free bids every month. No credit card required.",
  // Set NEXT_PUBLIC_SUPPORT_EMAIL and NEXT_PUBLIC_SITE_DOMAIN in production (bid2build.com is registered to someone else).
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com",
} as const;

export const plans = {
  freeMonthlyExports: 3,
  monthlyPriceLabel: "$19.99",
  annualPriceLabel: "$149",
  annualMonthlyEquivalent: "$12.42",
} as const;
