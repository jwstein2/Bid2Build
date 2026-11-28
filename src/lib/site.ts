import { hostOf, resolveAllowIndexing, resolveDeployContext, resolveSiteUrl } from "./config/deploy";
import { ANNUAL, ANNUAL_MONTHLY_EQUIVALENT, ANNUAL_SAVINGS_PERCENT, MONTHLY } from "./billing/plans";

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
  tagline: "Professional estimates for your trade, ready to send.",
  // Mentions scheduling only on deploys where Project Command Center is switched on (inlined at build).
  description:
    process.env.NEXT_PUBLIC_PROJECT_SCHEDULING === "on"
      ? "Contractor estimating, proposal and project scheduling software. Build branded bids for your trade, get them signed online, track your pipeline and schedule won jobs. 3 free bids to start, plus 1 free bid every month. No credit card."
      : "Contractor estimating and proposal software for every trade. Build branded bids with markup or margin, get them signed online and track your pipeline. 3 free bids to start, plus 1 free bid every month. No credit card.",
  // Search snippet version of `description` (160 characters or fewer; see src/lib/seo/meta.ts).
  metaDescription:
    process.env.NEXT_PUBLIC_PROJECT_SCHEDULING === "on"
      ? "Contractor estimating, proposal and scheduling software. Build branded bids, get them signed online and schedule won jobs. Start free, no credit card."
      : "Contractor estimating and proposal software for every trade. Build branded bids, get them signed online and track your pipeline. Start free, no credit card.",
  // Set NEXT_PUBLIC_SUPPORT_EMAIL and NEXT_PUBLIC_SITE_DOMAIN in production (domain not yet registered).
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com",
} as const;

export const plans = {
  /** One-time credits for every verified account. Enforced in Postgres (starter_credit_amount). */
  starterCredits: 3,
  /** Free credits per monthly cycle, starting in the second month. Enforced in Postgres. */
  monthlyCredits: 1,
  /** Derived from src/lib/billing/plans.ts (the single source of truth for paid plan prices). */
  monthlyPriceLabel: MONTHLY.price,
  annualPriceLabel: ANNUAL.price,
  annualMonthlyEquivalent: ANNUAL_MONTHLY_EQUIVALENT,
  annualSavingsPercent: ANNUAL_SAVINGS_PERCENT,
} as const;
