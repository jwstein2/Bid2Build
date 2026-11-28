// growth-oauth Supabase Edge Function (Deno). Deploy with verify_jwt = false (browsers arrive here from consent screens).
//
//   GET /growth-oauth/start?s=<state>     one-time link minted by an operator with growth_api.oauth_begin; redirects to the
//                                         platform's own consent screen (the person signs in there, never here or in Claude)
//   GET /growth-oauth/callback?code&state the platform redirects back; the code is exchanged server-side, the token goes
//                                         straight into Vault through growth_api.oauth_complete, then one health check runs
//
// Security: the state is single use, expires in 10 minutes, and only its SHA-256 is stored; PKCE where the platform
// supports it; client secrets come from Vault per request; no token is ever returned to the browser or logged.
// Environment (Edge Function secrets): GROWTH_DB_PASSWORD (growth_worker), GROWTH_ENV, optional GROWTH_ADMIN_RETURN_URL
// (where to send the admin afterwards, e.g. the app's /admin/growth/connections page). SUPABASE_URL is platform-provided.
import postgres from "npm:postgres@3.4.5";
import { workerDbUrl } from "../worker/db.ts";
import { buildAuthorizeUrl, longLivedRequest, OAUTH, OAuthError, parseTokenResponse, redirectUri, tokenRequest } from "../connectors/oauth.ts";
import { checkConnection, redact } from "../connectors/health.ts";

const sql = postgres(workerDbUrl((k) => Deno.env.get(k)), { prepare: false, max: 2, idle_timeout: 20 });
const FUNCTIONS_BASE = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "") + "/functions/v1";
const RETURN_URL = Deno.env.get("GROWTH_ADMIN_RETURN_URL") ?? "";
const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

async function secret(name: string): Promise<string | null> {
  const [{ v }] = await sql`select growth_api.secret(${name}) as v`;
  return v ?? null;
}

function finish(provider: string, result: "connected" | "error", code?: string) {
  if (RETURN_URL) {
    const u = new URL(RETURN_URL);
    u.searchParams.set("provider", provider);
    u.searchParams.set("result", result);
    if (code) u.searchParams.set("code", code.slice(0, 60));
    return new Response(null, { status: 303, headers: { Location: u.toString(), ...NO_STORE } });
  }
  return Response.json({ provider, result, code: code ?? null, next: "Open the Connections page to see the health check result." }, { headers: NO_STORE });
}

async function start(url: URL) {
  const state = url.searchParams.get("s") ?? "";
  let s: { provider: string; scopes: string[]; code_challenge: string };
  try { [{ s }] = await sql`select growth_api.oauth_start(${state}) as s`; } catch {
    return new Response("This connection link is unknown or expired. Start again from the Connections page.", { status: 400, headers: NO_STORE });
  }
  const cfg = OAUTH[s.provider];
  const clientId = cfg ? await secret(cfg.clientIdSecret) : null;
  if (!cfg || !clientId) return new Response(`The ${s.provider} OAuth app is not set up yet (missing ${cfg?.clientIdSecret ?? "config"} in Vault).`, { status: 409, headers: NO_STORE });
  const location = buildAuthorizeUrl(cfg, { clientId, redirectUri: redirectUri(FUNCTIONS_BASE), state, scopes: s.scopes, codeChallenge: s.code_challenge });
  return new Response(null, { status: 302, headers: { Location: location, ...NO_STORE } });
}

async function callback(url: URL) {
  const state = url.searchParams.get("state") ?? "";
  let c: { state_sha256: string; provider: string; account_ref: string; scopes: string[]; code_verifier: string };
  try { [{ c }] = await sql`select growth_api.oauth_consume(${state}) as c`; } catch {
    return new Response("This connection link is unknown, already used or expired. Start again from the Connections page.", { status: 400, headers: NO_STORE });
  }
  const fail = async (code: string, message: string) => {
    await sql`select growth_api.oauth_fail(${c.state_sha256}, ${code}, ${message})`;
    return finish(c.provider, "error", code);
  };
  const platformError = url.searchParams.get("error");
  if (platformError) return fail(platformError, url.searchParams.get("error_description") ?? "The platform did not grant access.");
  const code = url.searchParams.get("code") ?? url.searchParams.get("auth_code");
  if (!code) return fail("no_code", "The platform returned no authorization code.");
  const cfg = OAUTH[c.provider];
  const [clientId, clientSecret] = cfg ? [await secret(cfg.clientIdSecret), await secret(cfg.clientSecretSecret)] : [null, null];
  if (!cfg || !clientId || !clientSecret) return fail("no_client", "OAuth client id/secret missing in Vault.");
  try {
    const req = tokenRequest(cfg, { clientId, clientSecret, code, redirectUri: redirectUri(FUNCTIONS_BASE), codeVerifier: c.code_verifier });
    let parsed = parseTokenResponse(c.provider, await (await fetch(req.url, req.init)).json(), Date.now());
    const ll = longLivedRequest(cfg, { clientId, clientSecret, accessToken: parsed.token.access_token });
    if (ll) {
      const long = parseTokenResponse(c.provider, await (await fetch(ll.url, ll.init)).json(), Date.now(), parsed.token);
      parsed = { ...long, grantedScopes: long.grantedScopes ?? parsed.grantedScopes };
    }
    await sql`select growth_api.oauth_complete(${c.state_sha256}, ${JSON.stringify(parsed.token)}::jsonb, ${parsed.grantedScopes}::text[],
      ${parsed.expiresAt}::timestamptz, ${parsed.accountLabel ?? null})`;

    // First health check right away, unless Growth OS (or this connector) is stopped.
    const [{ stopped }] = await sql`select growth_api.is_stopped(null, ${c.provider}) as stopped`;
    if (!stopped) {
      const needsClient = ["linkedin", "tiktok_business"].includes(c.provider);
      const t0 = Date.now();
      const res = await checkConnection({ provider: c.provider, accountRef: c.account_ref, token: parsed.token, grantedScopes: parsed.grantedScopes ?? undefined,
        clientId: needsClient ? clientId : undefined, clientSecret: needsClient ? clientSecret : undefined,
        developerToken: c.provider === "google_ads" ? (await secret("growth_google_ads_developer_token")) ?? undefined : undefined, fetch });
      const msg = res.message ? redact(res.message, [parsed.token.access_token, parsed.token.refresh_token, clientSecret]) : null;
      await sql`select growth_api.record_check(${c.provider}, ${c.account_ref}, ${res.outcome}, ${res.httpStatus ?? null}, ${Date.now() - t0},
        ${res.grantedScopes ?? null}::text[], ${res.errorCode ?? null}, ${msg}, ${res.rateLimit ? JSON.stringify(res.rateLimit) : null}::jsonb, 'growth-oauth')`;
    }
    return finish(c.provider, "connected");
  } catch (e) {
    const codeStr = e instanceof OAuthError ? e.code : "exchange_failed";
    return fail(codeStr, redact(String((e as Error).message ?? e), [code, clientSecret]).slice(0, 400));
  }
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  const url = new URL(req.url);
  const route = url.pathname.split("/").filter(Boolean).pop();
  try {
    if (route === "start") return await start(url);
    if (route === "callback") return await callback(url);
    return new Response("not found", { status: 404 });
  } catch (e) {
    console.error("growth-oauth failed", (e as Error).name);   // never log the message: it could echo a code
    return new Response("Something went wrong. Nothing was stored. Try again from the Connections page.", { status: 500, headers: NO_STORE });
  }
});
