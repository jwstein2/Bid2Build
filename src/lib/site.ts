/**
 * Central brand configuration. Rebranding = change env vars (or these defaults).
 * Nothing else in the codebase hard-codes the product name or domain.
 */
export const site = {
  name: process.env.NEXT_PUBLIC_SITE_NAME ?? "Built2Bid",
  domain: process.env.NEXT_PUBLIC_SITE_DOMAIN ?? "localhost:3000",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  tagline: "Build estimates. Create bids. Win more work.",
  description:
    "Build clear estimates and professional, branded proposals for your trade. Price with markup or margin, choose what your customer sees, and download a PDF. 3 free bids to start, plus 1 free bid every month. No credit card.",
  // Set NEXT_PUBLIC_SUPPORT_EMAIL and NEXT_PUBLIC_SITE_DOMAIN in production (domain not yet registered).
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com",
} as const;

export const plans = {
  /** One-time credits for every verified account. Enforced in Postgres (starter_credit_amount). */
  starterCredits: 3,
  /** Free credits per monthly cycle, starting in the second month. Enforced in Postgres. */
  monthlyCredits: 1,
  monthlyPriceLabel: "$19.99",
  annualPriceLabel: "$149",
  annualMonthlyEquivalent: "$12.42",
} as const;
