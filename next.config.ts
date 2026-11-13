import type { NextConfig } from "next";
import { resolveAllowIndexing, resolveDeployContext, resolveSiteUrl } from "./src/lib/config/deploy";

// Resolve per-deploy values once at build time and inline them for server and browser code.
const deployContext = resolveDeployContext(process.env);
const siteUrl = resolveSiteUrl(process.env);
const allowIndexing = resolveAllowIndexing(process.env);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HTTPS-only on real deploys. No includeSubDomains/preload until the production domain is settled.
  ...(deployContext === "local" ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
