/**
 * Network helpers for the Intuit calls, kept free of server-only imports so they can be unit tested:
 * discovery-document parsing, retry of temporary failures, and the intuit_tid support reference.
 */

export interface QbEndpoints { authorize: string; token: string; revoke: string }

/** Only https URLs on an intuit.com host are accepted from the discovery document. */
function intuitUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return null;
    return u.hostname === "intuit.com" || u.hostname.endsWith(".intuit.com") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Reads authorization, token and revocation endpoints from Intuit's discovery document, or null if any is missing or odd. */
export function parseDiscovery(j: unknown): QbEndpoints | null {
  if (!j || typeof j !== "object") return null;
  const d = j as Record<string, unknown>;
  const authorize = intuitUrl(d.authorization_endpoint), token = intuitUrl(d.token_endpoint), revoke = intuitUrl(d.revocation_endpoint);
  return authorize && token && revoke ? { authorize, token, revoke } : null;
}

/** Temporary failures worth another try: rate limiting and Intuit-side errors. Client errors (4xx) are never retried. */
export const retryableStatus = (status: number) => status === 429 || status >= 500;

/** Wait before retry number `attempt` (1, 2, ...): honours Retry-After up to 5 s, else 0.5 s, 1 s, 2 s... */
export function retryDelay(attempt: number, retryAfter: string | null): number {
  const s = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, 5000);
  return Math.min(500 * 2 ** (attempt - 1), 5000);
}

type Fetcher = () => Promise<Response>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs a request, retrying up to `retries` more times when the network fails or Intuit answers 429/5xx.
 * Only use it for requests that are safe to repeat (token refresh, reads, and writes carrying a requestid).
 * Returns the last response; a network error on the final try is rethrown.
 */
export async function withRetry(run: Fetcher, retries = 2, wait: (ms: number) => Promise<unknown> = sleep): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await run();
      if (!retryableStatus(res.status) || attempt >= retries) return res;
      await wait(retryDelay(attempt + 1, res.headers.get("retry-after")));
    } catch (e) {
      if (attempt >= retries) throw e;
      await wait(retryDelay(attempt + 1, null));
    }
  }
}

/** Intuit's per-request id (response header intuit_tid). Support asks for it when troubleshooting. */
export function intuitTid(res: Response): string | null {
  const v = res.headers.get("intuit_tid");
  return v && /^[A-Za-z0-9-]{1,100}$/.test(v) ? v : null;
}

/** Adds the support reference to a message shown to the contractor. */
export const withRef = (message: string, tid: string | null) => (tid ? `${message} (QuickBooks reference ${tid})` : message);
