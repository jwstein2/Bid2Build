/**
 * Shared Sentry settings. Error reporting is OFF until NEXT_PUBLIC_SENTRY_DSN is set in Netlify,
 * so local dev and forks send nothing. A DSN only allows sending events, so it is safe in the browser.
 */
const rawDsn = (process.env.NEXT_PUBLIC_SENTRY_DSN ?? "").trim();
// Ignore anything that isn't a DSN URL (e.g. a setup command pasted by mistake) so Sentry stays off.
export const sentryDsn = /^https:\/\/[^\s@]+@[^\s/]+\/\d+$/.test(rawDsn) ? rawDsn : "";

export const sentryOptions = {
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  // Netlify deploy context (production, deploy-preview, branch-deploy, local) from next.config.ts.
  environment: process.env.NEXT_PUBLIC_DEPLOY_CONTEXT || "local",
  release: process.env.NEXT_PUBLIC_COMMIT_REF || undefined,
  // Errors only: no performance tracing or session replay, which keeps us inside the free plan.
  tracesSampleRate: 0,
  // Never attach IP addresses, cookies or request bodies (contractor and customer data).
  sendDefaultPii: false,
} as const;
