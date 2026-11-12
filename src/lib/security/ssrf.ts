import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

/** Only public unicast addresses are allowed as fetch targets. */
export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address();
  const range = addr.range();
  if (range !== "unicast") return false;
  if (addr.kind() === "ipv4") {
    const s = addr.toString();
    // Block shared address space, benchmarking, and cloud metadata explicitly (defense in depth).
    if (addr.match(ipaddr.parseCIDR("100.64.0.0/10"))) return false;
    if (addr.match(ipaddr.parseCIDR("198.18.0.0/15"))) return false;
    if (s === "169.254.169.254") return false;
  }
  return true;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; code: "invalid_url" | "blocked_protocol" | "blocked_port" | "blocked_host" | "dns_failed" | "private_address" };

export function normalizeUserUrl(input: string): URL | null {
  let s = input.trim();
  if (!s || s.length > 2048) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

/** Validate a URL and every address its hostname resolves to. */
export async function checkUrl(input: string | URL, resolve: Resolver = defaultResolver): Promise<UrlCheck> {
  const url = typeof input === "string" ? normalizeUserUrl(input) : input;
  if (!url) return { ok: false, code: "invalid_url" };
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, code: "blocked_protocol" };
  if (url.username || url.password) return { ok: false, code: "invalid_url" };
  if (url.port && !["80", "443"].includes(url.port)) return { ok: false, code: "blocked_port" };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || !host.includes(".") && !isIP(host)) {
    return { ok: false, code: "blocked_host" };
  }
  let addrs: string[];
  if (isIP(host)) addrs = [host];
  else {
    try { addrs = await resolve(host); } catch { return { ok: false, code: "dns_failed" }; }
  }
  if (!addrs.length) return { ok: false, code: "dns_failed" };
  if (!addrs.every(isPublicAddress)) return { ok: false, code: "private_address" };
  return { ok: true, url };
}

export interface SafeFetchOptions {
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  accept?: string;
  resolve?: Resolver;
  fetchImpl?: typeof fetch;
}

export class SafeFetchError extends Error {
  constructor(public code: string, message?: string) { super(message ?? code); }
}

/**
 * Fetch a user-supplied URL safely: validates each hop (redirects are followed manually and
 * re-validated), caps response size and time, and never sends cookies or credentials.
 * Residual risk (DNS rebinding between check and connect) is mitigated by re-checking per hop and
 * short timeouts; for stricter isolation run imports from an egress-restricted network.
 */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<{ url: URL; status: number; contentType: string; body: Buffer }> {
  const { maxBytes = 1_500_000, maxRedirects = 3, timeoutMs = 8000, accept = "text/html,application/xhtml+xml", resolve, fetchImpl = fetch } = opts;
  let current: string | URL = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await checkUrl(current, resolve);
    if (!check.ok) throw new SafeFetchError(check.code);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(check.url, {
        redirect: "manual",
        signal: ctrl.signal,
        credentials: "omit",
        headers: { accept, "user-agent": "Mozilla/5.0 (compatible; BrandImporter/1.0)" },
      });
    } catch (e) {
      clearTimeout(timer);
      throw new SafeFetchError((e as Error).name === "AbortError" ? "timeout" : "fetch_failed");
    }
    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get("location");
      if (!loc) throw new SafeFetchError("bad_redirect");
      current = new URL(loc, check.url);
      continue;
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) { clearTimeout(timer); throw new SafeFetchError("too_large"); }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel(); throw new SafeFetchError("too_large"); }
        chunks.push(value);
      }
    } finally {
      clearTimeout(timer);
    }
    return { url: check.url, status: res.status, contentType: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks) };
  }
  throw new SafeFetchError("too_many_redirects");
}
