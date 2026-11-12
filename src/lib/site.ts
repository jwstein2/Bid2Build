import { hostOf, resolveAllowIndexing, resolveDeployContext, resolveSiteUrl } from "./config/deploy";

/**
 * Central brand and URL configuration. Rebranding or moving domains = change env vars, not code.
 * Nothing else in the codebase hard-codes the product name or domain.
 *
 * NEXT_PUBLIC_* values are inlined at build time; next.config.ts resolves the site URL and deploy
 * context per Netlify context (see src/lib/config/deploy.ts) so previews never point at production.
 */
const env = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_DEPLOY_CONTEXT: process.env.NEXT_PUBLIC_DEPLOY_CONTEXT,
  NEXT_PUBLIC_ALLOW_INDEXING: process.env.NEXT_PUBLIC_ALLOW_INDEXING,
};
const url = resolveSiteUrl(env);

export const deploy = {
  context: resolveDeployContext(env),
  /** True only on a production deploy with NEXT_PUBLIC_ALLOW_INDEXING=true. */
  allowIndexing: resolveAllowIndexing(env),
} as const;

export const site = {
  name: process.env.NEXT_PUBLIC_SITE_NAME ?? "Built2Bid",
  domain: process.env.NEXT_PUBLIC_SITE_DOMAIN || hostOf(url),
  /** Canonical public URL of this deploy (app and marketing share one origin). */
  url,
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
