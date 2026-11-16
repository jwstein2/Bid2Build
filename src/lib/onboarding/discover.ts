import "server-only";
import { parse } from "node-html-parser";
import { extractBrand } from "../import/website";
import { normalizeUserUrl, safeFetch, SafeFetchError, type SafeFetchOptions } from "../security/ssrf";
import { processLogo } from "../security/upload";
import { brandWarnings, colorCheck, findLicense, guessTrade } from "./brand-review";

/**
 * Website branding discovery for onboarding. Server-side only, built on the existing hardened pieces:
 * safeFetch (URL validation, private/internal address blocking on every DNS answer and redirect hop,
 * size + time limits, no cookies), extractBrand (metadata / Open Graph / JSON-LD; text is clipped and
 * stripped), and processLogo (sniffed, SVG-sanitized, re-encoded PNG). Scripts are never executed;
 * nothing on the page is treated as an instruction. Nothing is saved here: the user reviews every field.
 */
export interface Suggestion<T = string> { value: T; source: string }
export interface Discovery {
  website: string;
  finalUrl: string;
  fields: Partial<Record<"companyName" | "tagline" | "primaryColor" | "secondaryColor" | "trade" | "email" | "phone" | "address" | "services" | "licenseNumber", Suggestion>>;
  logo: Suggestion<string> | null; // PNG data URL, for preview only until approved
  colorChecks: { primary: ReturnType<typeof colorCheck> | null; secondary: ReturnType<typeof colorCheck> | null };
  warnings: string[];
}

export const DISCOVER_ERRORS: Record<string, string> = {
  invalid_url: "That doesn't look like a website address.",
  blocked_protocol: "Only http and https websites can be used.",
  blocked_port: "That address uses a port we can't read from.",
  blocked_host: "That address can't be used. Enter your public website address.",
  private_address: "That address points to a private network, so we can't read it.",
  dns_failed: "We couldn't find that website. Check the spelling.",
  timeout: "Your website took too long to respond.",
  too_large: "Your homepage was too large to read.",
  too_many_redirects: "Your website redirected too many times.",
  fetch_failed: "We couldn't reach that website.",
  bad_redirect: "Your website returned an invalid redirect.",
  robots: "Your website asks automated tools not to read it, so we skipped it.",
  http_error: "Your website returned an error.",
  not_html: "That address isn't a web page.",
};

/** Respect robots.txt for our importer (User-agent: * or BrandImporter, Disallow: /). Fails open on errors. */
export function robotsDisallowsAll(txt: string): boolean {
  let applies = false;
  let blocked = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k)) applies = v === "*" || /brandimporter/i.test(v);
    else if (applies && /^disallow$/i.test(k) && v === "/") blocked = true;
    else if (applies && /^allow$/i.test(k) && v === "/") return false;
  }
  return blocked;
}

const visibleText = (html: string) => parse(html, { blockTextElements: { script: false, style: false, noscript: false } }).text.replace(/\s+/g, " ").slice(0, 200_000);

export async function discoverBranding(input: string, opts: { fetch?: SafeFetchOptions } = {}): Promise<{ ok: true; data: Discovery } | { ok: false; code: string }> {
  const start = normalizeUserUrl(input);
  if (!start) return { ok: false, code: "invalid_url" };
  let page;
  try {
    try {
      const robots = await safeFetch(`${start.origin}/robots.txt`, { ...opts.fetch, accept: "text/plain", maxBytes: 100_000, timeoutMs: 4000 });
      if (robots.status === 200 && robotsDisallowsAll(robots.body.toString("utf8"))) return { ok: false, code: "robots" };
    } catch (e) {
      // Blocked targets fail here first; anything else (no robots.txt, timeouts) is fine.
      if (e instanceof SafeFetchError && ["invalid_url", "blocked_protocol", "blocked_port", "blocked_host", "private_address", "dns_failed"].includes(e.code)) throw e;
    }
    page = await safeFetch(start.toString(), opts.fetch);
  } catch (e) {
    return { ok: false, code: e instanceof SafeFetchError ? e.code : "fetch_failed" };
  }
  if (page.status >= 400) return { ok: false, code: "http_error" };
  if (!/text\/html|application\/xhtml/i.test(page.contentType)) return { ok: false, code: "not_html" };
  const html = page.body.toString("utf8");
  const brand = extractBrand(html, page.url);
  const text = visibleText(html);
  const src = (s: string) => `${s} on ${page.url.hostname}`;

  const fields: Discovery["fields"] = {};
  if (brand.companyName) fields.companyName = { value: brand.companyName, source: src("Business name in page metadata") };
  if (brand.description) fields.tagline = { value: brand.description.split(/(?<=[.!?])\s/)[0].slice(0, 200), source: src("Page description") };
  if (brand.primaryColor) fields.primaryColor = { value: brand.primaryColor, source: src("Site colors") };
  if (brand.secondaryColor) fields.secondaryColor = { value: brand.secondaryColor, source: src("Site colors") };
  if (brand.email) fields.email = { value: brand.email.toLowerCase(), source: src("Public email link") };
  if (brand.phone) fields.phone = { value: brand.phone, source: src("Public phone number") };
  if (brand.address) fields.address = { value: brand.address, source: src("Public address") };
  if (brand.services) fields.services = { value: brand.services, source: src("Listed services") };
  const trade = guessTrade(`${brand.services ?? ""} ${brand.description ?? ""} ${brand.companyName ?? ""} ${text.slice(0, 20_000)}`);
  if (trade) fields.trade = { value: trade, source: src("Words used on your homepage") };
  const license = findLicense(text);
  if (license) fields.licenseNumber = { value: license, source: src("License number shown on the page") };

  let logo: Discovery["logo"] = null;
  for (const candidate of brand.logoCandidates.slice(0, 3)) {
    try {
      const img = await safeFetch(candidate, { ...opts.fetch, accept: "image/png,image/jpeg,image/webp,image/svg+xml", maxBytes: 2_000_000, timeoutMs: 6000 });
      const processed = await processLogo(img.body);
      if (processed.ok && processed.width >= 32 && processed.height >= 16) {
        logo = { value: `data:image/png;base64,${processed.png.toString("base64")}`, source: src("Logo image") };
        break;
      }
    } catch { /* try the next candidate */ }
  }

  return {
    ok: true,
    data: {
      website: page.url.origin, finalUrl: page.url.toString(), fields, logo,
      colorChecks: { primary: brand.primaryColor ? colorCheck(brand.primaryColor) : null, secondary: brand.secondaryColor ? colorCheck(brand.secondaryColor) : null },
      warnings: brandWarnings({ requestedUrl: input, finalUrl: page.url.toString(), companyName: brand.companyName, email: brand.email }),
    },
  };
}
