import "server-only";
/**
 * Intuit OAuth 2.0 and the few QuickBooks Online Accounting API calls the hours sync needs.
 * Tokens are passed in and returned; storage and encryption live in server.ts.
 */
import { QB_AUTHORIZE_URL, QB_MINOR_VERSION, QB_REVOKE_URL, QB_SCOPE, QB_TOKEN_URL, qbApiBase, qbDiscoveryUrl, qbEnvironment, type QbEnvironment } from "./config";
import { faultMessage, type TimeActivityPayload } from "./mapping";
import { intuitTid, parseDiscovery, withRef, withRetry, type QbEndpoints } from "./net";

export interface QbTokens { accessToken: string; refreshToken: string; accessExpiresAt: Date; refreshExpiresAt: Date | null }
export interface QbEntity { id: string; name: string; type: "Employee" | "Vendor" | "Customer" }

/** A QuickBooks failure. `tid` is Intuit's request id (intuit_tid) for support, when Intuit sent one. */
export class QbError extends Error {
  constructor(message: string, readonly status: number, readonly reauth = false, readonly tid: string | null = null) { super(message); }
}

const FALLBACK: QbEndpoints = { authorize: QB_AUTHORIZE_URL, token: QB_TOKEN_URL, revoke: QB_REVOKE_URL };
const DISCOVERY_TTL = 24 * 60 * 60_000;
const discovered = new Map<QbEnvironment, { at: number; ep: QbEndpoints }>();

/**
 * OAuth endpoints from Intuit's discovery document, cached for a day per environment (Intuit's recommendation).
 * Falls back to the documented endpoints when the document can't be read, so connecting never breaks on it.
 */
export async function endpoints(env: QbEnvironment = qbEnvironment()): Promise<QbEndpoints> {
  const hit = discovered.get(env);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL) return hit.ep;
  try {
    const res = await withRetry(() => fetch(qbDiscoveryUrl(env), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) }), 1);
    const ep = res.ok ? parseDiscovery(await res.json().catch(() => null)) : null;
    if (ep) { discovered.set(env, { at: Date.now(), ep }); return ep; }
  } catch { /* fall through */ }
  return hit?.ep ?? FALLBACK;
}

const basic = () => `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`;

export async function authorizeUrl(redirectUri: string, state: string, env: QbEnvironment = qbEnvironment()): Promise<string> {
  const u = new URL((await endpoints(env)).authorize);
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

/** Token requests retry network failures and Intuit 429/5xx; an invalid_grant (expired or revoked) asks the contractor to reconnect. */
async function tokenCall(env: QbEnvironment, body: Record<string, string>): Promise<QbTokens> {
  const url = (await endpoints(env)).token;
  const res = await withRetry(() => fetch(url, {
    method: "POST",
    headers: { authorization: basic(), "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000),
  }));
  const tid = intuitTid(res);
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new QbError(withRef(`QuickBooks sign-in failed (${String(j.error ?? res.status)}).`, tid), res.status, j.error === "invalid_grant", tid);
  return toTokens(j);
}

export const exchangeCode = (code: string, redirectUri: string, env: QbEnvironment = qbEnvironment()) =>
  tokenCall(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
export const refreshTokens = (refreshToken: string, env: QbEnvironment = qbEnvironment()) =>
  tokenCall(env, { grant_type: "refresh_token", refresh_token: refreshToken });

/** Best effort: tells Intuit to forget the tokens when a contractor disconnects. */
export async function revokeToken(token: string, env: QbEnvironment = qbEnvironment()): Promise<void> {
  const url = (await endpoints(env)).revoke;
  await fetch(url, {
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
  // Reads are safe to repeat, and every write carries a requestid, so QuickBooks ignores a repeated create.
  const res = await withRetry(() => fetch(u, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  }));
  const tid = intuitTid(res);
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new QbError(withRef(faultMessage(j), tid), res.status, res.status === 401, tid);
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

// --- Admin payouts: vendors, bills and expense accounts in Built2Bid's own QuickBooks company --------------------

/** Active expense accounts (where commissions are booked), up to 1,000. */
export async function listExpenseAccounts(env: QbEnvironment, realm: string, token: string): Promise<{ id: string; name: string }[]> {
  const j = await api(env, realm, token, "query", { query: { query: "select Id, FullyQualifiedName from Account where AccountType = 'Expense' and Active = true maxresults 1000" } });
  const rows = ((j.QueryResponse as Record<string, unknown> | undefined)?.Account ?? []) as { Id?: string; FullyQualifiedName?: string }[];
  return rows.filter((r) => r.Id && /^\d{1,32}$/.test(r.Id)).map((r) => ({ id: String(r.Id), name: String(r.FullyQualifiedName ?? `#${r.Id}`).slice(0, 200) }));
}

/** A vendor with exactly this display name, if there is one (active or not). */
export async function findVendorByName(env: QbEnvironment, realm: string, token: string, quotedName: string): Promise<{ id: string; active: boolean } | null> {
  const j = await api(env, realm, token, "query", { query: { query: `select Id, Active from Vendor where DisplayName = ${quotedName}` } });
  const v = (((j.QueryResponse as Record<string, unknown> | undefined)?.Vendor ?? []) as { Id?: string; Active?: boolean }[])[0];
  return v?.Id && /^\d{1,32}$/.test(v.Id) ? { id: v.Id, active: v.Active !== false } : null;
}

export async function createVendor(env: QbEnvironment, realm: string, token: string, payload: Record<string, unknown>, requestId: string): Promise<string> {
  const j = await api(env, realm, token, "vendor", { method: "POST", body: payload, query: { requestid: requestId } });
  const id = (j.Vendor as { Id?: string } | undefined)?.Id;
  if (!id || !/^\d{1,32}$/.test(id)) throw new QbError("QuickBooks didn't return the new vendor.", 502);
  return id;
}

/** Creates one bill. requestid (the Built2Bid bill id) makes QuickBooks ignore a retry of the same bill. */
export async function createBill(env: QbEnvironment, realm: string, token: string, payload: Record<string, unknown>, requestId: string): Promise<string> {
  const j = await api(env, realm, token, "bill", { method: "POST", body: payload, query: { requestid: requestId } });
  const id = (j.Bill as { Id?: string } | undefined)?.Id;
  if (!id || !/^\d{1,32}$/.test(id)) throw new QbError("QuickBooks didn't return the new bill.", 502);
  return id;
}

/** Reads a bill (Balance 0 = paid). Null when QuickBooks no longer has it (deleted). */
export async function getBill(env: QbEnvironment, realm: string, token: string, id: string): Promise<{ Balance?: unknown; TotalAmt?: unknown } | null> {
  if (!/^\d{1,32}$/.test(id)) return null;
  const j = await api(env, realm, token, "query", { query: { query: `select Id, Balance, TotalAmt from Bill where Id = '${id}'` } });
  const b = (((j.QueryResponse as Record<string, unknown> | undefined)?.Bill ?? []) as { Balance?: unknown; TotalAmt?: unknown }[])[0];
  return b ?? null;
}

/** Active bank accounts (where payouts are booked as paid from, e.g. the Stripe payout balance). */
export async function listBankAccounts(env: QbEnvironment, realm: string, token: string): Promise<{ id: string; name: string }[]> {
  const j = await api(env, realm, token, "query", { query: { query: "select Id, FullyQualifiedName from Account where AccountType = 'Bank' and Active = true maxresults 1000" } });
  const rows = ((j.QueryResponse as Record<string, unknown> | undefined)?.Account ?? []) as { Id?: string; FullyQualifiedName?: string }[];
  return rows.filter((r) => r.Id && /^\d{1,32}$/.test(r.Id)).map((r) => ({ id: String(r.Id), name: String(r.FullyQualifiedName ?? `#${r.Id}`).slice(0, 200) }));
}

/** Records a bill as paid from a bank account (bookkeeping entry only: QuickBooks moves no money for a "Check" bill payment). */
export async function createBillPayment(env: QbEnvironment, realm: string, token: string, payload: Record<string, unknown>, requestId: string): Promise<string> {
  const j = await api(env, realm, token, "billpayment", { method: "POST", body: payload, query: { requestid: requestId } });
  const id = (j.BillPayment as { Id?: string } | undefined)?.Id;
  if (!id || !/^\d{1,32}$/.test(id)) throw new QbError("QuickBooks didn't return the bill payment.", 502);
  return id;
}
