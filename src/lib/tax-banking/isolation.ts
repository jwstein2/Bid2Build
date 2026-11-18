/**
 * Provider modes + fail-closed isolation (V6.2 rules applied to V6.9).
 *
 * Nothing paid is ever switched on by code. A real provider runs only when ALL of these hold:
 *   - the mode env var names it (TAX_PROVIDER=avalara|taxjar|stripe_tax, BANK_PROVIDER=plaid)
 *   - its live switch is set by the owner (TAX_PROVIDER_LIVE=true / BANK_PROVIDER_LIVE=true)
 *   - its credentials are present
 *   - we are not inside a test run
 * Mock providers run only outside production (or inside a Financials practice/sandbox book). Tests call
 * assertTestIsolation(), which throws if any real banking, tax or payment credential is present.
 */
export type TaxProviderName = "none" | "mock" | "avalara" | "taxjar" | "stripe_tax";
export type BankProviderName = "none" | "mock" | "plaid";

type Env = Record<string, string | undefined>;

export const isProductionDeploy = (env: Env = process.env) => env.CONTEXT === "production" || (env.NODE_ENV === "production" && env.NETLIFY === "true" && !env.CONTEXT);
const inTests = (env: Env) => env.VITEST === "true" || env.NODE_ENV === "test";

export function taxProviderMode(env: Env = process.env, opts: { sandbox?: boolean } = {}): TaxProviderName {
  const want = (env.TAX_PROVIDER ?? "none").toLowerCase();
  if (want === "mock") return !isProductionDeploy(env) || opts.sandbox ? "mock" : "none";
  if (want === "avalara" || want === "taxjar" || want === "stripe_tax") {
    if (inTests(env) || env.TAX_PROVIDER_LIVE !== "true") return opts.sandbox && !isProductionDeploy(env) ? "mock" : "none";
    const creds = want === "avalara" ? env.AVALARA_ACCOUNT_ID && env.AVALARA_LICENSE_KEY : want === "taxjar" ? env.TAXJAR_API_KEY : env.STRIPE_TAX_CALC_KEY;
    return creds ? want : "none";
  }
  return opts.sandbox && !isProductionDeploy(env) ? "mock" : "none";
}

export function bankProviderMode(env: Env = process.env, opts: { sandbox?: boolean } = {}): BankProviderName {
  const want = (env.BANK_PROVIDER ?? "none").toLowerCase();
  if (want === "plaid") {
    if (inTests(env) || env.BANK_PROVIDER_LIVE !== "true" || !env.PLAID_CLIENT_ID || !env.PLAID_SECRET || !env.BANK_TOKEN_KEY) return opts.sandbox ? "mock" : "none";
    return "plaid";
  }
  if (want === "mock" || opts.sandbox) return !isProductionDeploy(env) || opts.sandbox ? "mock" : "none";
  return "none";
}

/** Real credentials that must never be present in a test run. */
const LIVE_PATTERNS: [string, RegExp][] = [
  ["STRIPE_SECRET_KEY", /^(sk|rk)_live_/],
  ["PLAID_SECRET", /./],
  ["PLAID_ENV", /^(production|development)$/],
  ["AVALARA_LICENSE_KEY", /./],
  ["TAXJAR_API_KEY", /./],
  ["STRIPE_TAX_CALC_KEY", /^(sk|rk)_live_/],
  ["BANK_PROVIDER_LIVE", /^true$/],
  ["TAX_PROVIDER_LIVE", /^true$/],
];

export function liveCredentialsPresent(env: Env = process.env): string[] {
  return LIVE_PATTERNS.filter(([k, re]) => env[k] && re.test(env[k]!)).map(([k]) => k);
}

/** Fail closed: tests stop immediately if any real banking, tax or payment credential is configured. */
export function assertTestIsolation(env: Env = process.env) {
  const found = liveCredentialsPresent(env);
  if (found.length) throw new Error(`Test isolation: real provider credentials present (${found.join(", ")}). Unset them before running tests.`);
}
