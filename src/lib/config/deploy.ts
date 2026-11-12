/**
 * Deployment-environment resolution. Pure functions with no imports so next.config.ts, server code
 * and tests can all use them.
 *
 * Netlify sets these at build time (and in functions):
 *   CONTEXT          "production" | "deploy-preview" | "branch-deploy" | "dev"
 *   URL              the site's primary URL (the custom domain once one is set as primary)
 *   DEPLOY_PRIME_URL the URL of this deploy's context (e.g. https://deploy-preview-4--built2bid.netlify.app)
 *
 * Rules:
 *  - Production uses NEXT_PUBLIC_SITE_URL when set (the canonical domain), else Netlify's URL.
 *  - Previews and branch deploys ALWAYS use their own DEPLOY_PRIME_URL, even if NEXT_PUBLIC_SITE_URL is
 *    set for every context, so a preview can never send sign-in links, checkout returns or canonical
 *    tags to production.
 *  - Local development falls back to http://localhost:3000.
 *  - Search indexing is only ever allowed on a production deploy, and only when
 *    NEXT_PUBLIC_ALLOW_INDEXING is "true".
 */
export type DeployContext = "production" | "deploy-preview" | "branch-deploy" | "dev" | "local";

type Env = Record<string, string | undefined>;

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export function resolveDeployContext(env: Env): DeployContext {
  const c = env.NEXT_PUBLIC_DEPLOY_CONTEXT ?? env.CONTEXT;
  if (c === "production" || c === "deploy-preview" || c === "branch-deploy" || c === "dev") return c;
  return "local";
}

export function resolveSiteUrl(env: Env): string {
  const ctx = resolveDeployContext(env);
  if ((ctx === "deploy-preview" || ctx === "branch-deploy") && env.DEPLOY_PRIME_URL) return trimSlash(env.DEPLOY_PRIME_URL);
  const explicit = env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return trimSlash(explicit);
  if (ctx === "production" && env.URL) return trimSlash(env.URL);
  return "http://localhost:3000";
}

export function resolveAllowIndexing(env: Env): boolean {
  return resolveDeployContext(env) === "production" && env.NEXT_PUBLIC_ALLOW_INDEXING === "true";
}

/** Host part of a URL ("built2bid.org"), used where only a display domain is needed. */
export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}
