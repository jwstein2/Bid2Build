/**
 * Central brand configuration. Rebranding = change env vars (or these defaults).
 * Nothing else in the codebase hard-codes the product name or domain.
 */
export const site = {
  name: process.env.NEXT_PUBLIC_SITE_NAME ?? "BuildYourBid",
  domain: process.env.NEXT_PUBLIC_SITE_DOMAIN ?? "buildyourbid.com",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  tagline: "What Are You Bidding Today?",
  description:
    "Build professional estimates, calculate your profit, and create beautiful proposals in minutes. Three free bids every month. No credit card required.",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@buildyourbid.com",
} as const;

export const plans = {
  freeMonthlyExports: 3,
  monthlyPriceLabel: "$19.99",
  annualPriceLabel: "$149",
  annualMonthlyEquivalent: "$12.42",
} as const;
