// Health checks and permission diagnostics: one cheap, read-only API call (or a few) per connection.
// The result goes to growth_api.record_check, which alone decides whether a connection is verified_operational.
// Every request is a GET or a read-only POST (token introspection, GA4 runReport, GraphQL query). Nothing here writes.
import { META_GRAPH } from "./constants.ts";
import type { StoredToken } from "./oauth.ts";

export type Outcome = "ok" | "limited" | "auth_error" | "platform_pending" | "error";
export interface HealthResult {
  outcome: Outcome;
  httpStatus?: number;
  grantedScopes?: string[];        // what the platform says is granted (or what the probes proved)
  errorCode?: string;
  message?: string;                // plain language, shown to the admin
  rateLimit?: Record<string, string>;
  accountLabel?: string;
}
export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number; headers: { get(name: string): string | null }; text(): Promise<string>;
}>;

export interface HealthInput {
  provider: string;
  accountRef: string;
  token?: StoredToken;     // OAuth connections
  secret?: string;         // manual-secret connections (value read from Vault by the worker, never logged)
  grantedScopes?: string[]; // last known grants (used where the platform cannot list them)
  clientId?: string;
  clientSecret?: string;
  developerToken?: string; // Google Ads, when the Cloud project still uses one
  fetch: Fetch;
  now?: () => number;
}

export const GOOGLE_ADS_API_VERSION = "v22";   // [platform-doc] confirm the current version at go-live
export const LINKEDIN_VERSION = "202510";      // [platform-doc] LinkedIn-Version header (YYYYMM)

const RATE_HEADERS = ["x-app-usage", "x-business-use-case-usage", "x-ad-account-usage", "x-ratelimit-remaining", "x-ratelimit-limit", "retry-after"];

async function call(f: Fetch, url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const r = await f(url, { method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
  const text = await r.text();
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- platform JSON
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  const rate: Record<string, string> = {};
  for (const h of RATE_HEADERS) { const v = r.headers.get(h); if (v) rate[h] = v.slice(0, 300); }
  return { status: r.status, json, rate };
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}`, Accept: "application/json" });

/** Generic HTTP → outcome mapping, used when a platform-specific rule does not apply. */
export function classifyHttp(status: number): Outcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "auth_error";
  if (status === 403) return "limited";
  if (status === 429 || status >= 500) return "error";
  return "error";
}

// ---------------------------------------------------------------------------------------------
// Meta (Business portfolio, Pages) and Instagram
// ---------------------------------------------------------------------------------------------
function metaError(e: { code?: number; error_subcode?: number; message?: string } | undefined, status: number): HealthResult {
  const code = Number(e?.code);
  if (code === 190 || code === 102) return { outcome: "auth_error", httpStatus: status, errorCode: `meta_${code}`, message: "Meta says the token expired or was revoked. Reconnect on the Connections page." };
  if ([4, 17, 32, 613, 80000, 80001, 80004].includes(code)) return { outcome: "error", httpStatus: status, errorCode: `meta_${code}`, message: "Meta rate limit reached. The next check retries automatically." };
  if (code === 10 || (code >= 200 && code < 300)) return { outcome: "limited", httpStatus: status, errorCode: `meta_${code}`, message: "Meta refused a permission. The app may need App Review (Advanced Access) or the permission was unticked." };
  return { outcome: "error", httpStatus: status, errorCode: `meta_${code || status}`, message: e?.message?.slice(0, 300) ?? `Meta returned HTTP ${status}.` };
}

async function checkMeta(i: HealthInput, token: string): Promise<HealthResult> {
  const base = `https://graph.facebook.com/${META_GRAPH}`;
  const p = await call(i.fetch, `${base}/me/permissions`, { headers: bearer(token) });
  if (p.status !== 200) return { ...metaError(p.json?.error, p.status), rateLimit: p.rate };
  const granted = (p.json?.data ?? []).filter((x: { status: string }) => x.status === "granted").map((x: { permission: string }) => x.permission);
  if (i.provider === "facebook_pages") {
    const a = await call(i.fetch, `${base}/me/accounts?fields=id,name&limit=100`, { headers: bearer(token) });
    if (a.status !== 200) return { ...metaError(a.json?.error, a.status), grantedScopes: granted, rateLimit: a.rate };
    const page = (a.json?.data ?? []).find((x: { id: string }) => x.id === i.accountRef);
    if (!page) return { outcome: "limited", httpStatus: 200, grantedScopes: granted, rateLimit: a.rate, errorCode: "page_not_granted",
      message: `The token cannot see Page ${i.accountRef}. Reconnect and tick that Page on Facebook's screen.` };
    return { outcome: "ok", httpStatus: 200, grantedScopes: granted, rateLimit: a.rate, accountLabel: page.name };
  }
  // meta_business: the token must reach the registered Business portfolio, not just hold the permissions.
  const b = await call(i.fetch, `${base}/${encodeURIComponent(i.accountRef)}?fields=id,name`, { headers: bearer(token) });
  if (b.status !== 200 || String(b.json?.id ?? "") !== i.accountRef) {
    const e = b.json?.error;
    if (e && Number(e.code) === 190) return { ...metaError(e, b.status), grantedScopes: granted };
    return { outcome: "limited", httpStatus: b.status, grantedScopes: granted, rateLimit: b.rate, errorCode: "business_not_accessible",
      message: `The token cannot read Business portfolio ${i.accountRef}. Give the system user (or your login) access to that portfolio.` };
  }
  return { outcome: "ok", httpStatus: 200, grantedScopes: granted, rateLimit: b.rate, accountLabel: b.json?.name };
}

async function checkInstagram(i: HealthInput, token: string): Promise<HealthResult> {
  const r = await call(i.fetch, `https://graph.instagram.com/${META_GRAPH}/me?fields=user_id,username,account_type`, { headers: bearer(token) });
  if (r.status !== 200) return { ...metaError(r.json?.error, r.status), rateLimit: r.rate };
  if (r.json?.account_type && !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(String(r.json.account_type).toUpperCase())) {
    return { outcome: "limited", httpStatus: 200, errorCode: "not_professional", message: "This Instagram account is not a Business or Creator account." };
  }
  const ids = [r.json?.user_id, r.json?.id, r.json?.username].filter(Boolean).map((x: unknown) => String(x).toLowerCase());
  if (!ids.includes(i.accountRef.toLowerCase())) return { outcome: "limited", httpStatus: 200, errorCode: "account_mismatch",
    message: `The connected Instagram account (${r.json?.username ?? "unknown"}) is not the registered account ${i.accountRef}.` };
  const perms = (i.token?.extra?.permissions as string[] | undefined) ?? i.grantedScopes;
  return { outcome: "ok", httpStatus: 200, grantedScopes: perms, rateLimit: r.rate, accountLabel: r.json?.username };
}

// ---------------------------------------------------------------------------------------------
// Google (YouTube, Google Ads, Workspace) — tokeninfo gives the real granted scopes
// ---------------------------------------------------------------------------------------------
async function googleScopes(i: HealthInput, token: string): Promise<{ scopes?: string[]; fail?: HealthResult }> {
  const r = await call(i.fetch, `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (r.status === 400 || r.status === 401) return { fail: { outcome: "auth_error", httpStatus: r.status, errorCode: "google_invalid_token", message: "Google says the token is invalid or expired. Reconnect, or wait for the next automatic refresh." } };
  if (r.status !== 200) return { fail: { outcome: "error", httpStatus: r.status, errorCode: `google_${r.status}`, message: `Google tokeninfo returned HTTP ${r.status}.` } };
  return { scopes: String(r.json?.scope ?? "").split(" ").filter(Boolean) };
}

function googleApiError(r: { status: number; json: any }, product: string): HealthResult { // eslint-disable-line @typescript-eslint/no-explicit-any
  const e = r.json?.error ?? r.json?.[0]?.error;
  const raw = JSON.stringify(e ?? {}).slice(0, 2000);
  if (r.status === 401) return { outcome: "auth_error", httpStatus: 401, errorCode: "google_401", message: `${product}: Google says the token is not valid. Reconnect.` };
  if (/DEVELOPER_TOKEN_NOT_APPROVED|only approved for use with test accounts/i.test(raw)) return { outcome: "limited", httpStatus: r.status, errorCode: "ads_test_access_only", message: "Google Ads API access is Test level: only test accounts work. Apply for Explorer access in Google Cloud." };
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(raw)) return { outcome: "platform_pending", httpStatus: r.status, errorCode: "api_disabled", message: `${product} API is not enabled in the Google Cloud project yet.` };
  if (/DEVELOPER_TOKEN_(INVALID|PROHIBITED)|ACCESS_LEVEL|access level/i.test(raw)) return { outcome: "platform_pending", httpStatus: r.status, errorCode: "ads_access_pending", message: "The Google Cloud project has no usable Google Ads API access level yet." };
  if (/NOT_ADS_USER|USER_PERMISSION_DENIED/i.test(raw)) return { outcome: "limited", httpStatus: r.status, errorCode: "ads_no_account_access", message: "The connected Google login has no access to the Google Ads account. Add it with Read-only access." };
  if (/quota|rateLimitExceeded|RESOURCE_EXHAUSTED/i.test(raw)) return { outcome: "error", httpStatus: r.status, errorCode: "google_quota", message: `${product}: quota reached. The next check retries.` };
  if (r.status === 403) return { outcome: "limited", httpStatus: 403, errorCode: "google_403", message: `${product}: Google refused the request (permission).` };
  return { outcome: classifyHttp(r.status), httpStatus: r.status, errorCode: `google_${r.status}`, message: `${product}: Google returned HTTP ${r.status}.` };
}

async function checkGoogle(i: HealthInput, token: string): Promise<HealthResult> {
  const g = await googleScopes(i, token);
  if (g.fail) return g.fail;
  const scopes = g.scopes!;
  if (i.provider === "youtube") {
    const r = await call(i.fetch, "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true", { headers: bearer(token) });
    if (r.status !== 200) return { ...googleApiError(r, "YouTube"), grantedScopes: scopes };
    const ch = (r.json?.items ?? []).find((x: { id: string }) => x.id === i.accountRef) ?? null;
    if (!ch) return { outcome: "limited", httpStatus: 200, grantedScopes: scopes, errorCode: "channel_not_granted",
      message: `The Google login can't manage channel ${i.accountRef}. Reconnect and pick the Built2Bid channel.` };
    return { outcome: "ok", httpStatus: 200, grantedScopes: scopes, accountLabel: ch.snippet?.title };
  }
  if (i.provider === "google_ads") {
    const headers: Record<string, string> = { ...bearer(token) };
    if (i.developerToken) headers["developer-token"] = i.developerToken;
    const r = await call(i.fetch, `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`, { headers });
    if (r.status !== 200) return { ...googleApiError(r, "Google Ads"), grantedScopes: scopes };
    const ids = (r.json?.resourceNames ?? []).map((n: string) => n.replace("customers/", ""));
    if (!ids.includes(i.accountRef.replace(/-/g, ""))) return { outcome: "limited", httpStatus: 200, grantedScopes: scopes, errorCode: "ads_account_not_accessible",
      message: `Google Ads account ${i.accountRef} is not accessible to this login.` };
    return { outcome: "ok", httpStatus: 200, grantedScopes: scopes };
  }
  const r = await call(i.fetch, "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)", { headers: bearer(token) });
  if (r.status !== 200) return { ...googleApiError(r, "Google Drive"), grantedScopes: scopes };
  return { outcome: "ok", httpStatus: 200, grantedScopes: scopes, accountLabel: r.json?.user?.displayName };
}

// GA4 + Search Console through a service account (JWT bearer grant, RS256 via WebCrypto).
const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ""; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export async function serviceAccountJwt(sa: { client_email: string; private_key: string }, scopes: string[], nowSec: number): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: scopes.join(" "), aud: "https://oauth2.googleapis.com/token", iat: nowSec, exp: nowSec + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
async function checkGa4(i: HealthInput): Promise<HealthResult> {
  let sa: { client_email: string; private_key: string };
  try { sa = JSON.parse(i.secret ?? ""); if (!sa.client_email || !sa.private_key) throw new Error(); } catch {
    return { outcome: "auth_error", errorCode: "bad_service_account", message: "The Vault secret is not a Google service account JSON key." };
  }
  const now = Math.floor((i.now ?? Date.now)() / 1000);
  let assertion: string;
  try { assertion = await serviceAccountJwt(sa, [GA_SCOPE, GSC_SCOPE], now); } catch {
    return { outcome: "auth_error", errorCode: "bad_private_key", message: "The service account private key could not be read." };
  }
  const t = await call(i.fetch, "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString() });
  if (t.status !== 200 || !t.json?.access_token) return { outcome: "auth_error", httpStatus: t.status, errorCode: "sa_token_refused", message: "Google refused the service account key (deleted or disabled?)." };
  const token = t.json.access_token as string;
  const granted: string[] = [];
  const msgs: string[] = [];
  if (!/^\d{6,12}$/.test(i.accountRef)) return { outcome: "limited", errorCode: "bad_property_id", message: "Account must be the numeric GA4 property id (Admin → Property details)." };
  const ga = await call(i.fetch, `https://analyticsdata.googleapis.com/v1beta/properties/${i.accountRef}:runReport`, { method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify({ dateRanges: [{ startDate: "yesterday", endDate: "yesterday" }], metrics: [{ name: "sessions" }], limit: 1 }) });
  if (ga.status === 200) granted.push(GA_SCOPE); else msgs.push(ga.status === 403 ? `GA4: add ${sa.client_email} as Viewer on property ${i.accountRef}.` : `GA4 returned HTTP ${ga.status}.`);
  const gsc = await call(i.fetch, "https://www.googleapis.com/webmasters/v3/sites", { headers: bearer(token) });
  if (gsc.status === 200 && (gsc.json?.siteEntry ?? []).length > 0) granted.push(GSC_SCOPE);
  else msgs.push(`Search Console: add ${sa.client_email} as a Restricted user on the built2bid.org property.`);
  if (!granted.length) return { outcome: ga.status === 403 ? "auth_error" : classifyHttp(ga.status), httpStatus: ga.status, grantedScopes: granted, errorCode: "ga4_no_access", message: msgs.join(" ") };
  return { outcome: granted.length === 2 ? "ok" : "limited", httpStatus: 200, grantedScopes: granted, errorCode: granted.length === 2 ? undefined : "partial_access", message: msgs.join(" ") || undefined };
}

// ---------------------------------------------------------------------------------------------
// LinkedIn, TikTok, Stripe, Buffer
// ---------------------------------------------------------------------------------------------
async function checkLinkedIn(i: HealthInput, token: string): Promise<HealthResult> {
  if (i.accountRef === "107777198") return { outcome: "auth_error", errorCode: "blocked_org", message: "Organization 107777198 (Bolt Global) must never be used by Growth OS." };
  const intro = await call(i.fetch, "https://www.linkedin.com/oauth/v2/introspectToken", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: i.clientId ?? "", client_secret: i.clientSecret ?? "", token }).toString() });
  if (intro.status !== 200 || intro.json?.active === false || intro.json?.status === "revoked" || intro.json?.status === "expired") {
    return { outcome: "auth_error", httpStatus: intro.status, errorCode: "linkedin_token_inactive", message: "LinkedIn says the token is expired or revoked. Reconnect." };
  }
  const scopes = String(intro.json?.scope ?? "").split(/[ ,]+/).filter(Boolean);
  const acl = await call(i.fetch, "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED",
    { headers: { ...bearer(token), "LinkedIn-Version": LINKEDIN_VERSION, "X-Restli-Protocol-Version": "2.0.0" } });
  if (acl.status === 403) return { outcome: "platform_pending", httpStatus: 403, grantedScopes: scopes, errorCode: "linkedin_product_not_approved", message: "LinkedIn refused the organization call: the Community Management API is probably not approved for the app yet." };
  if (acl.status !== 200) return { outcome: classifyHttp(acl.status), httpStatus: acl.status, grantedScopes: scopes, errorCode: `linkedin_${acl.status}`, message: `LinkedIn returned HTTP ${acl.status}.` };
  const orgs = (acl.json?.elements ?? []).map((e: { organization?: string; organizationTarget?: string }) => String(e.organization ?? e.organizationTarget ?? ""));
  if (!orgs.includes(`urn:li:organization:${i.accountRef}`)) return { outcome: "limited", httpStatus: 200, grantedScopes: scopes, errorCode: "org_not_admin",
    message: `The connected LinkedIn member is not an approved admin of organization ${i.accountRef}.` };
  return { outcome: "ok", httpStatus: 200, grantedScopes: scopes, rateLimit: acl.rate };
}

const TIKTOK_AUTH_CODES = new Set([40001, 40100, 40101, 40102, 40104, 40105]);
async function checkTikTokBusiness(i: HealthInput, token: string): Promise<HealthResult> {
  const base = "https://business-api.tiktok.com/open_api/v1.3";
  const a = await call(i.fetch, `${base}/oauth2/advertiser/get/?app_id=${encodeURIComponent(i.clientId ?? "")}&secret=${encodeURIComponent(i.clientSecret ?? "")}`, { headers: { "Access-Token": token } });
  if (a.status !== 200 || a.json?.code !== 0) {
    const code = Number(a.json?.code);
    if (TIKTOK_AUTH_CODES.has(code)) return { outcome: "auth_error", httpStatus: a.status, errorCode: `tiktok_${code}`, message: "TikTok says the advertiser authorization is no longer valid. Reconnect." };
    return { outcome: classifyHttp(a.status === 200 ? 500 : a.status), httpStatus: a.status, errorCode: `tiktok_${code || a.status}`, message: String(a.json?.message ?? `TikTok returned HTTP ${a.status}.`).slice(0, 300) };
  }
  const list = (a.json?.data?.list ?? []) as { advertiser_id: string; advertiser_name?: string }[];
  const adv = list.find((x) => String(x.advertiser_id) === i.accountRef);
  if (!adv) return { outcome: "limited", httpStatus: 200, grantedScopes: [], errorCode: "advertiser_not_authorized", message: `Advertiser ${i.accountRef} is not in this authorization.` };
  const granted = ["advertiser.read"];
  const day = new Date((i.now ?? Date.now)() - 86_400_000).toISOString().slice(0, 10);
  const q = new URLSearchParams({ advertiser_id: i.accountRef, report_type: "BASIC", data_level: "AUCTION_ADVERTISER", dimensions: '["advertiser_id"]', metrics: '["spend"]', start_date: day, end_date: day });
  const rep = await call(i.fetch, `${base}/report/integrated/get/?${q}`, { headers: { "Access-Token": token } });
  if (rep.status === 200 && rep.json?.code === 0) granted.push("reporting.read");
  return { outcome: "ok", httpStatus: 200, grantedScopes: granted, accountLabel: adv.advertiser_name };
}

async function checkTikTokContent(i: HealthInput, token: string): Promise<HealthResult> {
  const r = await call(i.fetch, "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", { headers: bearer(token) });
  const err = r.json?.error;
  if (r.status === 401 || err?.code === "access_token_invalid") return { outcome: "auth_error", httpStatus: r.status, errorCode: "tiktok_token_invalid", message: "TikTok says the token is invalid. It refreshes automatically; reconnect if this repeats." };
  if (err?.code === "scope_not_authorized") return { outcome: "limited", httpStatus: r.status, errorCode: "tiktok_scope", message: "TikTok: a scope was not authorized for this app." };
  if (r.status !== 200 || (err?.code && err.code !== "ok")) return { outcome: classifyHttp(r.status === 200 ? 500 : r.status), httpStatus: r.status, errorCode: `tiktok_${err?.code ?? r.status}`, message: String(err?.message ?? `TikTok returned HTTP ${r.status}.`).slice(0, 300) };
  const u = r.json?.data?.user ?? {};
  const ids = [u.open_id, i.token?.extra?.open_id, u.display_name].filter(Boolean).map((x: unknown) => String(x).toLowerCase());
  if (!ids.includes(i.accountRef.toLowerCase())) return { outcome: "limited", httpStatus: 200, errorCode: "account_mismatch",
    message: `The connected TikTok account (${u.display_name ?? "unknown"}) is not the registered account ${i.accountRef}.` };
  return { outcome: "ok", httpStatus: 200, grantedScopes: i.grantedScopes, accountLabel: u.display_name };
}

const STRIPE_PROBES: [string, string][] = [
  ["read:customers", "/v1/customers?limit=1"], ["read:subscriptions", "/v1/subscriptions?limit=1"], ["read:invoices", "/v1/invoices?limit=1"],
  ["read:charges", "/v1/charges?limit=1"], ["read:balance_transactions", "/v1/balance_transactions?limit=1"],
];
async function checkStripe(i: HealthInput): Promise<HealthResult> {
  const key = (i.secret ?? "").trim();
  if (/^sk_(live|test)_/.test(key)) return { outcome: "limited", errorCode: "not_restricted_key", message: "This is a full secret key. Growth OS only uses a restricted read-only key (rk_…); replace it. No call was made with it." };
  if (!/^rk_(live|test)_/.test(key)) return { outcome: "auth_error", errorCode: "not_a_stripe_key", message: "The Vault secret does not look like a Stripe restricted key (rk_live_… or rk_test_…)." };
  const granted: string[] = []; const missing: string[] = []; let rate: Record<string, string> = {};
  for (const [scope, path] of STRIPE_PROBES) {
    const r = await call(i.fetch, `https://api.stripe.com${path}`, { headers: bearer(key) });
    rate = { ...rate, ...r.rate };
    if (r.status === 401) return { outcome: "auth_error", httpStatus: 401, errorCode: "stripe_401", message: "Stripe says the restricted key is invalid or was rolled." };
    if (r.status === 200) granted.push(scope); else if (r.status === 403) missing.push(scope);
    else return { outcome: "error", httpStatus: r.status, grantedScopes: granted, errorCode: `stripe_${r.status}`, message: `Stripe returned HTTP ${r.status}.` };
  }
  const mode = key.startsWith("rk_live_") ? "live" : "test";
  return { outcome: missing.length ? "limited" : "ok", httpStatus: 200, grantedScopes: granted, rateLimit: rate, accountLabel: `${mode} mode`,
    errorCode: missing.length ? "stripe_missing_read" : undefined, message: missing.length ? `Give the restricted key Read on: ${missing.map((m) => m.slice(5)).join(", ")}.` : undefined };
}

// Buffer public API (GraphQL). [platform-doc] endpoint per developers.buffer.com; confirm at go-live.
export const BUFFER_API = "https://api.buffer.com";
async function checkBuffer(i: HealthInput): Promise<HealthResult> {
  const r = await call(i.fetch, BUFFER_API, { method: "POST", headers: { ...bearer(i.secret ?? ""), "Content-Type": "application/json" },
    body: JSON.stringify({ query: "query { account { id organizations { id name } } }" }) });
  if (r.status === 401 || r.status === 403) return { outcome: "auth_error", httpStatus: r.status, errorCode: "buffer_auth", message: "Buffer refused the API key. Create a new key and replace the Vault secret." };
  if (r.status !== 200 || r.json?.errors?.length) return { outcome: "error", httpStatus: r.status, errorCode: `buffer_${r.status}`, message: String(r.json?.errors?.[0]?.message ?? `Buffer returned HTTP ${r.status}.`).slice(0, 300) };
  if (!r.json?.data?.account?.id) return { outcome: "error", httpStatus: 200, errorCode: "buffer_unexpected", message: "Buffer answered without an account; the API may have changed." };
  return { outcome: "ok", httpStatus: 200, grantedScopes: ["buffer:read"], rateLimit: r.rate };
}

// ---------------------------------------------------------------------------------------------
export async function checkConnection(i: HealthInput): Promise<HealthResult> {
  const token = i.token?.access_token;
  const needToken = (fn: (t: string) => Promise<HealthResult>) =>
    token ? fn(token) : Promise.resolve<HealthResult>({ outcome: "auth_error", errorCode: "no_token", message: "No token stored. Connect it on the Connections page." });
  try {
    switch (i.provider) {
      case "meta_business":
        // System user token (manual secret) or OAuth token: same check.
        if (!token && i.secret) return await checkMeta(i, i.secret);
        return await needToken((t) => checkMeta(i, t));
      case "facebook_pages": return await needToken((t) => checkMeta(i, t));
      case "instagram": return await needToken((t) => checkInstagram(i, t));
      case "youtube": case "google_ads": case "google_workspace": return await needToken((t) => checkGoogle(i, t));
      case "linkedin": return await needToken((t) => checkLinkedIn(i, t));
      case "tiktok_business": return await needToken((t) => checkTikTokBusiness(i, t));
      case "tiktok_content": return await needToken((t) => checkTikTokContent(i, t));
      case "ga4_gtm": return await checkGa4(i);
      case "stripe": return await checkStripe(i);
      case "buffer": return await checkBuffer(i);
      default: return { outcome: "error", errorCode: "no_adapter", message: `No health check for ${i.provider}.` };
    }
  } catch (e) {
    return { outcome: "error", errorCode: "network", message: `Could not reach the platform: ${String((e as Error).message ?? e).slice(0, 200)}` };
  }
}

/** Never let a token or key reach a log, audit row or message. */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("[redacted]");
  return out;
}
