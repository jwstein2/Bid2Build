import "server-only";
/**
 * Intuit OAuth 2.0 and the few QuickBooks Online Accounting API calls the hours sync needs.
 * Tokens are passed in and returned; storage and encryption live in server.ts.
 */
import { QB_AUTHORIZE_URL, QB_MINOR_VERSION, QB_REVOKE_URL, QB_SCOPE, QB_TOKEN_URL, qbApiBase, type QbEnvironment } from "./config";
import { faultMessage, type TimeActivityPayload } from "./mapping";

export interface QbTokens { accessToken: string; refreshToken: string; accessExpiresAt: Date; refreshExpiresAt: Date | null }
export interface QbEntity { id: string; name: string; type: "Employee" | "Vendor" | "Customer" }

export class QbError extends Error {
  constructor(message: string, readonly status: number, readonly reauth = false) { super(message); }
}

const basic = () => `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`;

export function authorizeUrl(redirectUri: string, state: string): string {
  const u = new URL(QB_AUTHORIZE_URL);
  u.searchParams.set("client_id", process.env.QBO_CLIENT_ID ?? "");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", QB_SCOPE);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

function toTokens(j: Record<string, unknown>, now = Date.now()): QbTokens {
  const access = String(j.access_token ?? ""), refresh = String(j.refresh_token ?? "");
  if (!access || !refresh) throw new QbError("QuickBooks returned no tokens.", 502);
  const exp = Number(j.expires_in) || 3600, rexp = Number(j.x_refresh_token_expires_in);
  return { accessToken: access, refreshToken: refresh, accessExpiresAt: new Date(now + exp * 1000), refreshExpiresAt: Number.isFinite(rexp) && rexp > 0 ? new Date(now + rexp * 1000) : null };
}

async function tokenCall(body: Record<string, string>): Promise<QbTokens> {
  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: { authorization: basic(), "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new QbError(`QuickBooks sign-in failed (${String(j.error ?? res.status)}).`, res.status, j.error === "invalid_grant");
  return toTokens(j);
}

export const exchangeCode = (code: string, redirectUri: string) => tokenCall({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
export const refreshTokens = (refreshToken: string) => tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken });

/** Best effort: tells Intuit to forget the tokens when a contractor disconnects. */
export async function revokeToken(token: string): Promise<void> {
  await fetch(QB_REVOKE_URL, {
    method: "POST",
    headers: { authorization: basic(), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

async function api(env: QbEnvironment, realm: string, token: string, path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<Record<string, unknown>> {
  const u = new URL(`${qbApiBase(env)}/v3/company/${encodeURIComponent(realm)}/${path}`);
  u.searchParams.set("minorversion", QB_MINOR_VERSION);
  for (const [k, v] of Object.entries(init.query ?? {})) u.searchParams.set(k, v);
  const res = await fetch(u, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new QbError(faultMessage(j), res.status, res.status === 401);
  return j;
}

export async function companyName(env: QbEnvironment, realm: string, token: string): Promise<string | null> {
  const j = await api(env, realm, token, `companyinfo/${encodeURIComponent(realm)}`);
  const n = (j.CompanyInfo as { CompanyName?: string } | undefined)?.CompanyName;
  return n ? n.slice(0, 200) : null;
}

/** Active employees, vendors and customers (jobs are customers too), up to 1,000 of each. */
export async function listEntities(env: QbEnvironment, realm: string, token: string): Promise<QbEntity[]> {
  const q = async (type: QbEntity["type"]) => {
    const j = await api(env, realm, token, "query", { query: { query: `select Id, DisplayName from ${type} where Active = true maxresults 1000` } });
    const rows = ((j.QueryResponse as Record<string, unknown> | undefined)?.[type] ?? []) as { Id?: string; DisplayName?: string }[];
    return rows.filter((r) => r.Id && /^\d{1,32}$/.test(r.Id)).map((r) => ({ id: String(r.Id), name: String(r.DisplayName ?? `#${r.Id}`).slice(0, 200), type }));
  };
  const [e, v, c] = await Promise.all([q("Employee"), q("Vendor"), q("Customer")]);
  return [...e, ...v, ...c];
}

/** Creates one time activity. requestid makes QuickBooks ignore a retry of the same entry. */
export async function createTimeActivity(env: QbEnvironment, realm: string, token: string, payload: TimeActivityPayload, requestId: string): Promise<string> {
  const j = await api(env, realm, token, "timeactivity", { method: "POST", body: payload, query: { requestid: requestId } });
  const id = (j.TimeActivity as { Id?: string } | undefined)?.Id;
  if (!id || !/^\d{1,32}$/.test(id)) throw new QbError("QuickBooks didn't return the new time entry.", 502);
  return id;
}
