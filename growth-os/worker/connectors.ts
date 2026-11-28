// Worker handlers for the Connections Center: connector.health and connector.refresh (risk tier 0, read-only).
// Tokens are read from Vault through growth_api.secret only for the duration of one call and never logged.
import { type Ctx, type Handler, type HandlerResult, PermanentError, type Sql, StopError } from "./core.ts";
import { checkConnection, type Fetch, type HealthResult, redact } from "../connectors/health.ts";
import { OAUTH, OAuthError, parseTokenResponse, refreshRequest, type StoredToken } from "../connectors/oauth.ts";

interface DueRow { provider: string; account_ref: string; auth_kind: string; secret_name: string | null; expires_at: string | Date | null; granted_scopes: string[]; refresh: string }

async function secret(sql: Sql, name: string | null | undefined): Promise<string | undefined> {
  if (!name) return undefined;
  const [{ v }] = await sql`select growth_api.secret(${name}) as v`;
  return v ?? undefined;
}
const parseToken = (raw: string | undefined): StoredToken | undefined => {
  if (!raw) return undefined;
  try { const t = JSON.parse(raw); return typeof t?.access_token === "string" ? t : undefined; } catch { return undefined; }
};
const expMs = (v: DueRow["expires_at"]) => (v == null ? null : new Date(v).getTime());

/** Refresh one OAuth token and record the outcome (success stores the new token in Vault via SQL). */
export async function refreshOne(ctx: Ctx, fetchImpl: Fetch, row: DueRow, token: StoredToken | undefined, now: () => number): Promise<{ status: string; token?: StoredToken }> {
  const { sql, worker } = ctx.deps;
  const cfg = OAUTH[row.provider];
  const fail = async (code: string, message: string) => {
    const [{ s }] = await sql`select growth_api.record_refresh(${row.provider}, ${row.account_ref}, false, null::jsonb, null::timestamptz, ${code}, ${message}, ${worker}) as s`;
    return { status: String(s) };
  };
  if (!cfg || !token) return fail("no_token", "No stored token to refresh. Reconnect on the Connections page.");
  const [clientId, clientSecret] = [await secret(sql, cfg.clientIdSecret), await secret(sql, cfg.clientSecretSecret)];
  if (!clientId || !clientSecret) return fail("no_client", `OAuth client is missing in Vault (${cfg.clientIdSecret} / ${cfg.clientSecretSecret}).`);
  const req = refreshRequest(cfg, { clientId, clientSecret, token });
  if (!req) return fail("no_refresh_token", "The platform gave no refresh token. Reconnect before the token expires.");
  try {
    const body = await ctx.step(row.provider, "token.refresh", async () => {
      const r = await fetchImpl(req.url, req.init);
      const text = await r.text();
      try { return JSON.parse(text); } catch { throw new OAuthError(`http_${r.status}`, `Token endpoint returned HTTP ${r.status}.`); }
    });
    const parsed = parseTokenResponse(row.provider, body, now(), token);
    const [{ s }] = await sql`select growth_api.record_refresh(${row.provider}, ${row.account_ref}, true, ${JSON.stringify(parsed.token)}::jsonb,
      ${parsed.expiresAt}::timestamptz, null, null, ${worker}) as s`;
    return { status: String(s), token: parsed.token };
  } catch (e) {
    if (e instanceof StopError || e instanceof PermanentError) throw e;   // a stop or pause is not a failed refresh
    const code = e instanceof OAuthError ? e.code : "refresh_error";
    return fail(code, redact(String((e as Error).message ?? e), [token.access_token, token.refresh_token, clientSecret]).slice(0, 400));
  }
}

async function isPaused(sql: Sql, task: string, connector: string) {
  const [{ s }] = await sql`select growth_api.is_stopped(${task}, ${connector}) as s`;
  return Boolean(s);
}

export function connectorHandlers(fetchImpl: Fetch, opts: { now?: () => number } = {}): Record<string, Handler> {
  const now = opts.now ?? Date.now;

  const health: Handler = async (ctx): Promise<HandlerResult> => {
    const { sql, worker } = ctx.deps;
    await ctx.checkStop();
    const only = (ctx.job.payload as { provider?: string | null }).provider ?? null;
    const rows = (await sql`select * from growth_api.connections_due('health', ${only})`) as DueRow[];
    const results: Record<string, string> = {};
    for (const row of rows) {
      const key = `${row.provider}/${row.account_ref}`;
      if (await isPaused(sql, ctx.job.task_key, row.provider)) { results[key] = "skipped: paused"; continue; }
      let res: HealthResult;
      const t0 = now();
      if (row.auth_kind === "internal") {
        res = await ctx.step(row.provider, "health", async () => {
          await sql`select count(*) from growth_read.funnel_leads`;
          await sql`select count(*) from growth_read.acquisition_events`;
          return { outcome: "ok" as const, grantedScopes: ["growth_read"], message: "growth_worker can read the growth_read views." };
        }).catch((e) => ({ outcome: "error" as const, errorCode: "db_read_failed", message: String((e as Error).message).slice(0, 300) }));
      } else {
        const raw = await secret(sql, row.secret_name);
        let token = row.secret_name?.startsWith("growth_conn_") ? parseToken(raw) : undefined;
        const manual = row.secret_name?.startsWith("growth_conn_") ? undefined : raw;
        const cfg = OAUTH[row.provider];
        // An expired (or nearly expired) OAuth token is refreshed first, so the check tests the real path.
        const exp = expMs(row.expires_at);
        if (token && cfg?.refreshStyle && exp !== null && exp < now() + 120_000) {
          const r = await refreshOne(ctx, fetchImpl, row, token, now);
          if (r.token) token = r.token;
        }
        const needsClient = ["linkedin", "tiktok_business"].includes(row.provider);
        const clientId = needsClient && cfg ? await secret(sql, cfg.clientIdSecret) : undefined;
        const clientSecret = needsClient && cfg ? await secret(sql, cfg.clientSecretSecret) : undefined;
        const developerToken = row.provider === "google_ads" ? await secret(sql, "growth_google_ads_developer_token") : undefined;
        res = await ctx.step(row.provider, "health", () => checkConnection({
          provider: row.provider, accountRef: row.account_ref, token, secret: manual, grantedScopes: row.granted_scopes,
          clientId, clientSecret, developerToken, fetch: fetchImpl, now,
        }));
        res.message = res.message ? redact(res.message, [token?.access_token, token?.refresh_token, manual, clientSecret, developerToken]) : res.message;
      }
      const [{ s }] = await sql`select growth_api.record_check(${row.provider}, ${row.account_ref}, ${res.outcome}, ${res.httpStatus ?? null},
        ${now() - t0}, ${res.grantedScopes ?? null}::text[], ${res.errorCode ?? null}, ${res.message ?? null},
        ${res.rateLimit ? JSON.stringify(res.rateLimit) : null}::jsonb, ${worker}) as s`;
      results[key] = String(s);
    }
    return { output: { checked: rows.length, results } };
  };

  const refresh: Handler = async (ctx): Promise<HandlerResult> => {
    const { sql } = ctx.deps;
    await ctx.checkStop();
    const only = (ctx.job.payload as { provider?: string | null }).provider ?? null;
    const rows = (await sql`select * from growth_api.connections_due('refresh', ${only})`) as DueRow[];
    const results: Record<string, string> = {};
    for (const row of rows) {
      const key = `${row.provider}/${row.account_ref}`;
      if (await isPaused(sql, ctx.job.task_key, row.provider)) { results[key] = "skipped: paused"; continue; }
      const token = parseToken(await secret(sql, row.secret_name));
      results[key] = (await refreshOne(ctx, fetchImpl, row, token, now)).status;
    }
    return { output: { refreshed: rows.length, results } };
  };

  return { "connector.health": health, "connector.refresh": refresh };
}
