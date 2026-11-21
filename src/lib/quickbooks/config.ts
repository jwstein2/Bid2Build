/**
 * QuickBooks Online hours sync (V8.4). Shown only with NEXT_PUBLIC_QUICKBOOKS=on; connecting also needs the
 * Intuit app keys (QBO_CLIENT_ID, QBO_CLIENT_SECRET) and BANK_TOKEN_KEY, which encrypts the OAuth tokens.
 * QBO_ENVIRONMENT is "sandbox" (default) or "production". Owner setup: docs/quickbooks/README.md.
 */
export type QbEnvironment = "sandbox" | "production";

export const isQuickBooksEnabled = () => process.env.NEXT_PUBLIC_QUICKBOOKS === "on";

export function qbEnvironment(raw = process.env.QBO_ENVIRONMENT): QbEnvironment {
  return raw === "production" ? "production" : "sandbox";
}

/** True when the Intuit app keys and the token encryption key are all set. */
export function qbConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const key = env.BANK_TOKEN_KEY ? Buffer.from(env.BANK_TOKEN_KEY, "base64") : null;
  return Boolean(env.QBO_CLIENT_ID && env.QBO_CLIENT_SECRET && key && key.length === 32);
}

export const QB_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QB_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
export const QB_SCOPE = "com.intuit.quickbooks.accounting";
export const QB_MINOR_VERSION = "75";

export function qbApiBase(env: QbEnvironment): string {
  return env === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
}

export const QB_CALLBACK_PATH = "/api/integrations/quickbooks/callback";
export const QB_PAGE_PATH = "/projects/workforce/quickbooks";
