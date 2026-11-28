// OAuth 2.0 configuration and pure request/response helpers for every OAuth connector.
// Runtime-agnostic (Deno Edge Functions and Node tests). No network here: callers pass the result to fetch.
// Client ids and secrets are read from Vault by the caller (growth_api.secret); this file never sees a password,
// recovery code or MFA code — people sign in only on the platform's own consent screen.
import { META_GRAPH } from "./registry.ts";

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  obtained_at: string;            // ISO
  refresh_expires_at?: string;    // ISO, when the platform says
  extra?: Record<string, unknown>; // platform ids (open_id, advertiser_ids, user_id, permissions)
}

export interface OAuthConfig {
  provider: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopeSeparator: " " | ",";
  pkce: boolean;
  clientIdParam: "client_id" | "app_id" | "client_key";
  clientIdSecret: string;          // Vault name of the client id
  clientSecretSecret: string;      // Vault name of the client secret
  extraAuthParams?: Record<string, string>;
  tokenStyle: "form" | "json_tiktok_business" | "get_meta";
  longLived?: "meta" | "instagram";
  refreshStyle?: "form_refresh_token" | "meta_exchange" | "instagram_refresh";
  sendScopes: boolean;             // TikTok Business picks permissions on the app, not in the URL
}

const GOOGLE = {
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopeSeparator: " " as const, pkce: true, clientIdParam: "client_id" as const,
  clientIdSecret: "growth_google_client_id", clientSecretSecret: "growth_google_client_secret",
  extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "false" },
  tokenStyle: "form" as const, refreshStyle: "form_refresh_token" as const, sendScopes: true,
};
const META = {
  authorizeUrl: `https://www.facebook.com/${META_GRAPH}/dialog/oauth`,
  tokenUrl: `https://graph.facebook.com/${META_GRAPH}/oauth/access_token`,
  scopeSeparator: "," as const, pkce: false, clientIdParam: "client_id" as const,
  clientIdSecret: "growth_meta_client_id", clientSecretSecret: "growth_meta_client_secret",
  tokenStyle: "get_meta" as const, longLived: "meta" as const, refreshStyle: "meta_exchange" as const, sendScopes: true,
};

export const OAUTH: Record<string, OAuthConfig> = {
  meta_business: { provider: "meta_business", ...META },
  facebook_pages: { provider: "facebook_pages", ...META },
  instagram: {
    provider: "instagram",
    authorizeUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    scopeSeparator: ",", pkce: false, clientIdParam: "client_id",
    clientIdSecret: "growth_instagram_client_id", clientSecretSecret: "growth_instagram_client_secret",
    extraAuthParams: { enable_fb_login: "0", force_authentication: "1" },
    tokenStyle: "form", longLived: "instagram", refreshStyle: "instagram_refresh", sendScopes: true,
  },
  tiktok_business: {
    provider: "tiktok_business",
    authorizeUrl: "https://business-api.tiktok.com/portal/auth",
    tokenUrl: "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
    scopeSeparator: ",", pkce: false, clientIdParam: "app_id",
    clientIdSecret: "growth_tiktok_business_client_id", clientSecretSecret: "growth_tiktok_business_client_secret",
    tokenStyle: "json_tiktok_business", sendScopes: false,
  },
  tiktok_content: {
    provider: "tiktok_content",
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopeSeparator: ",", pkce: true, clientIdParam: "client_key",
    clientIdSecret: "growth_tiktok_content_client_id", clientSecretSecret: "growth_tiktok_content_client_secret",
    tokenStyle: "form", refreshStyle: "form_refresh_token", sendScopes: true,
  },
  youtube: { provider: "youtube", ...GOOGLE },
  google_ads: { provider: "google_ads", ...GOOGLE },
  google_workspace: { provider: "google_workspace", ...GOOGLE },
  linkedin: {
    provider: "linkedin",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopeSeparator: " ", pkce: false, clientIdParam: "client_id",
    clientIdSecret: "growth_linkedin_client_id", clientSecretSecret: "growth_linkedin_client_secret",
    tokenStyle: "form", refreshStyle: "form_refresh_token", sendScopes: true,
  },
};

export interface HttpRequest { url: string; init: { method: string; headers: Record<string, string>; body?: string } }

export function buildAuthorizeUrl(cfg: OAuthConfig, p: { clientId: string; redirectUri: string; state: string; scopes: string[]; codeChallenge?: string }): string {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set(cfg.clientIdParam, p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("state", p.state);
  if (cfg.provider !== "tiktok_business") u.searchParams.set("response_type", "code");
  if (cfg.sendScopes) u.searchParams.set("scope", p.scopes.join(cfg.scopeSeparator));
  if (cfg.pkce && p.codeChallenge) { u.searchParams.set("code_challenge", p.codeChallenge); u.searchParams.set("code_challenge_method", "S256"); }
  for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

const form = (o: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined) as [string, string][]).toString();
const FORM = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };

export function tokenRequest(cfg: OAuthConfig, p: { clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier?: string }): HttpRequest {
  if (cfg.tokenStyle === "get_meta") {
    const u = new URL(cfg.tokenUrl);
    for (const [k, v] of Object.entries({ client_id: p.clientId, client_secret: p.clientSecret, redirect_uri: p.redirectUri, code: p.code })) u.searchParams.set(k, v);
    return { url: u.toString(), init: { method: "GET", headers: { Accept: "application/json" } } };
  }
  if (cfg.tokenStyle === "json_tiktok_business") {
    return { url: cfg.tokenUrl, init: { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: p.clientId, secret: p.clientSecret, auth_code: p.code }) } };
  }
  return { url: cfg.tokenUrl, init: { method: "POST", headers: FORM, body: form({
    [cfg.clientIdParam]: p.clientId, client_secret: p.clientSecret, code: p.code, grant_type: "authorization_code",
    redirect_uri: p.redirectUri, code_verifier: cfg.pkce ? p.codeVerifier : undefined,
  }) } };
}

/** Second step for Meta/Instagram: swap the short-lived user token for a 60-day one. */
export function longLivedRequest(cfg: OAuthConfig, p: { clientId: string; clientSecret: string; accessToken: string }): HttpRequest | null {
  if (cfg.longLived === "meta") {
    const u = new URL(cfg.tokenUrl);
    for (const [k, v] of Object.entries({ grant_type: "fb_exchange_token", client_id: p.clientId, client_secret: p.clientSecret, fb_exchange_token: p.accessToken })) u.searchParams.set(k, v);
    return { url: u.toString(), init: { method: "GET", headers: { Accept: "application/json" } } };
  }
  if (cfg.longLived === "instagram") {
    const u = new URL("https://graph.instagram.com/access_token");
    u.searchParams.set("grant_type", "ig_exchange_token");
    u.searchParams.set("client_secret", p.clientSecret);
    u.searchParams.set("access_token", p.accessToken);
    return { url: u.toString(), init: { method: "GET", headers: { Accept: "application/json" } } };
  }
  return null;
}

export function refreshRequest(cfg: OAuthConfig, p: { clientId: string; clientSecret: string; token: StoredToken }): HttpRequest | null {
  switch (cfg.refreshStyle) {
    case "form_refresh_token":
      if (!p.token.refresh_token) return null;
      return { url: cfg.tokenUrl, init: { method: "POST", headers: FORM, body: form({
        [cfg.clientIdParam]: p.clientId, client_secret: p.clientSecret, grant_type: "refresh_token", refresh_token: p.token.refresh_token }) } };
    case "meta_exchange":
      return longLivedRequest(cfg, { clientId: p.clientId, clientSecret: p.clientSecret, accessToken: p.token.access_token });
    case "instagram_refresh": {
      const u = new URL("https://graph.instagram.com/refresh_access_token");
      u.searchParams.set("grant_type", "ig_refresh_token");
      u.searchParams.set("access_token", p.token.access_token);
      return { url: u.toString(), init: { method: "GET", headers: { Accept: "application/json" } } };
    }
    default:
      return null;
  }
}

export interface ParsedToken { token: StoredToken; grantedScopes: string[] | null; expiresAt: string | null; accountLabel?: string }
export class OAuthError extends Error { constructor(public code: string, message: string) { super(message); } }

const iso = (ms: number) => new Date(ms).toISOString();
const splitScopes = (s: unknown): string[] | null =>
  Array.isArray(s) ? s.map(String) : typeof s === "string" && s.trim() ? s.split(/[ ,]+/).filter(Boolean) : null;

/**
 * Normalizes a token endpoint response. `previous` keeps a refresh token the platform did not resend (Google).
 * grantedScopes is null when the platform does not report scopes in the token response (Meta, TikTok Business):
 * the health check then reads the real grants from the platform.
 */
export function parseTokenResponse(provider: string, body: unknown, now: number, previous?: StoredToken): ParsedToken {
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- platform JSON shapes differ
  let b = body as any;
  if (!b || typeof b !== "object") throw new OAuthError("bad_response", "The platform returned an unreadable token response.");
  if (provider === "tiktok_business") {
    if (b.code !== 0) throw new OAuthError(`tiktok_${b.code}`, String(b.message ?? "TikTok refused the authorization code."));
    b = b.data ?? {};
    if (!b.access_token) throw new OAuthError("no_token", "TikTok returned no access token.");
    return { token: { access_token: b.access_token, obtained_at: iso(now), extra: { advertiser_ids: b.advertiser_ids ?? [], scope_ids: b.scope ?? [] } },
             grantedScopes: null, expiresAt: null };
  }
  if (provider === "instagram" && Array.isArray(b.data)) b = b.data[0] ?? {};
  if (b.error || b.error_description) {
    const e = typeof b.error === "object" ? b.error : { code: b.error, message: b.error_description };
    throw new OAuthError(String(e.code ?? e.type ?? "oauth_error"), String(e.message ?? e.error_message ?? b.error_description ?? "The platform refused the request."));
  }
  if (!b.access_token) throw new OAuthError("no_token", "The platform returned no access token.");
  const extra: Record<string, unknown> = { ...(previous?.extra ?? {}) };
  for (const k of ["open_id", "user_id", "id_token_present"]) if (b[k] !== undefined) extra[k] = b[k];
  if (b.permissions !== undefined) extra.permissions = splitScopes(b.permissions);
  const token: StoredToken = {
    access_token: String(b.access_token),
    refresh_token: b.refresh_token ? String(b.refresh_token) : previous?.refresh_token,
    token_type: b.token_type ? String(b.token_type) : previous?.token_type,
    obtained_at: iso(now),
    refresh_expires_at: b.refresh_expires_in ? iso(now + Number(b.refresh_expires_in) * 1000)
      : b.refresh_token_expires_in ? iso(now + Number(b.refresh_token_expires_in) * 1000) : previous?.refresh_expires_at,
    extra,
  };
  if (!token.refresh_token) delete token.refresh_token;
  if (!token.refresh_expires_at) delete token.refresh_expires_at;
  if (!token.token_type) delete token.token_type;
  const granted = splitScopes(b.scope) ?? splitScopes(b.permissions);
  return { token, grantedScopes: granted, expiresAt: b.expires_in ? iso(now + Number(b.expires_in) * 1000) : null };
}

export function redirectUri(functionsBase: string): string {
  return functionsBase.replace(/\/+$/, "") + "/growth-oauth/callback";
}
