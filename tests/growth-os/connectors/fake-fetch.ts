// Recorded-fixture fetch for connector tests. No network: an unmatched URL fails the test loudly.
import type { Fetch } from "../../../growth-os/connectors/health";

export interface Route { match: RegExp; status?: number; json?: unknown; text?: string; headers?: Record<string, string>; method?: string }
export interface Call { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }

export function fakeFetch(routes: Route[]): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    const r = routes.find((x) => x.match.test(url) && (!x.method || x.method === (init?.method ?? "GET")));
    if (!r) throw new Error(`unexpected request in test: ${init?.method ?? "GET"} ${url}`);
    const headers = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { status: r.status ?? 200, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, text: async () => r.text ?? JSON.stringify(r.json ?? {}) };
  };
  return { fetch, calls };
}
