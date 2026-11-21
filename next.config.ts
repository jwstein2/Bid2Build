import type { NextConfig } from "next";
import { baselineCsp } from "./src/lib/config/csp";
import { resolveAllowIndexing, resolveDeployContext, resolveSiteUrl } from "./src/lib/config/deploy";

// Resolve per-deploy values once at build time and inline them for server and browser code.
const deployContext = resolveDeployContext(process.env);
const siteUrl = resolveSiteUrl(process.env);
const allowIndexing = resolveAllowIndexing(process.env);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // geolocation=(self): the time clock asks for location at a punch when the person ticks the box, and (V8.2) the
  // Time clock screen watches it while open when the employee accepted automatic GPS clock-in. Own origin only.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  // HTTPS-only on real deploys. No includeSubDomains/preload until the production domain is settled.
  ...(deployContext === "local" ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
  // Baseline Content Security Policy (enforced). Only directives that cannot break third-party scripts (Stripe,
  // Plaid, Sentry, Google Maps) or Next.js inline scripts: see src/lib/config/csp.ts.
  { key: "Content-Security-Policy", value: baselineCsp(deployContext) },
  // Keep every non-production deploy (previews, branch deploys) out of search results.
  ...(allowIndexing ? [] : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]),
];

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SITE_URL: siteUrl,
    NEXT_PUBLIC_DEPLOY_CONTEXT: deployContext,
    // Netlify commit SHA, used as the Sentry release.
    NEXT_PUBLIC_COMMIT_REF: process.env.COMMIT_REF ?? "",
  },
  serverExternalPackages: ["@react-pdf/renderer"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // V7.3: the retired "Pricing data" page. Old bookmarks go to Saved Items & Pricing before anything renders.
  async redirects() {
    return [{ source: "/settings/pricing", destination: "/dashboard/items", permanent: true }];
  },
  async headers() {
    // Signing links carry a secret token in the path: never send it as a referrer, never cache or index.
    const signingHeaders = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
    ];
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/sign/:path*", headers: signingHeaders },
      { source: "/api/sign/:path*", headers: signingHeaders },
    ];
  },
};

export default nextConfig;
