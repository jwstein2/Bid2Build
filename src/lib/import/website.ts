import "server-only";
import { parse, type HTMLElement } from "node-html-parser";

/**
 * Extract public branding facts from a company website's HTML.
 * Output is plain data shown to the user for review; it is never treated as instructions and
 * never auto-accepted. Text is length-limited and stripped of markup.
 */
export interface ImportedBrand {
  companyName?: string;
  description?: string;
  phone?: string;
  email?: string;
  address?: string;
  services?: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoCandidates: string[];
}

const clip = (s: string | undefined | null, n: number) => {
  if (!s) return undefined;
  const t = s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, n) : undefined;
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const normHex = (h: string) => {
  const x = h.toLowerCase();
  return x.length === 4 ? `#${x[1]}${x[1]}${x[2]}${x[2]}${x[3]}${x[3]}` : x;
};
const isNeutral = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max - min < 24 || max < 30 || min > 235;
};

function jsonLdBlocks(root: HTMLElement): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.text);
      const items = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const it of items) if (it && typeof it === "object") out.push(it as Record<string, unknown>);
    } catch { /* ignore malformed */ }
  }
  return out;
}

function formatAddress(a: unknown): string | undefined {
  if (!a) return undefined;
  if (typeof a === "string") return clip(a, 300);
  if (typeof a === "object") {
    const o = a as Record<string, string>;
    return clip([o.streetAddress, o.addressLocality, [o.addressRegion, o.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "), 300);
  }
  return undefined;
}

export function extractBrand(html: string, baseUrl: URL): ImportedBrand {
  const root = parse(html, { blockTextElements: { script: true, style: true, noscript: false, pre: false } });
  const meta = (sel: string) => root.querySelector(sel)?.getAttribute("content") ?? undefined;
  const abs = (u?: string | null) => {
    if (!u) return undefined;
    try {
      const x = new URL(u, baseUrl);
      return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : undefined;
    } catch { return undefined; }
  };

  const ld = jsonLdBlocks(root);
  const org = ld.find((x) => {
    const t = ([] as unknown[]).concat(x["@type"] ?? []).map(String);
    return t.some((y) => /Organization|LocalBusiness|Contractor|HomeAndConstructionBusiness|Roofing|Plumber|Electrician|HVAC|GeneralContractor/i.test(y));
  });

  const title = clip(root.querySelector("title")?.text, 200);
  const companyName = clip((org?.name as string) ?? meta('meta[property="og:site_name"]') ?? meta('meta[name="application-name"]') ?? title?.split(/[|\-–—]/)[0], 120);
  const description = clip((org?.description as string) ?? meta('meta[name="description"]') ?? meta('meta[property="og:description"]'), 600);

  const tel = root.querySelector('a[href^="tel:"]')?.getAttribute("href")?.slice(4);
  const phoneRegex = html.replace(/<[^>]+>/g, " ").match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
  const phone = clip((org?.telephone as string) ?? (tel ? decodeURIComponent(tel) : undefined) ?? phoneRegex?.[0], 40);

  const mailto = root.querySelector('a[href^="mailto:"]')?.getAttribute("href")?.slice(7).split("?")[0];
  const emailRaw = (org?.email as string) ?? (mailto ? decodeURIComponent(mailto) : undefined);
  const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw.replace(/^mailto:/, "")) ? emailRaw.replace(/^mailto:/, "").slice(0, 200) : undefined;

  const address = formatAddress(org?.address) ?? clip(root.querySelector("address")?.text, 300);

  const services = clip(
    ((org?.makesOffer as { itemOffered?: { name?: string } }[] | undefined)?.map((o) => o.itemOffered?.name).filter(Boolean).join(", ")) ||
      ((org?.knowsAbout as string[] | undefined)?.join?.(", ")),
    400,
  );

  // Colors: theme-color first, then frequent non-neutral hex values in inline CSS.
  const colors: string[] = [];
  const theme = meta('meta[name="theme-color"]');
  if (theme && HEX.test(theme.trim())) colors.push(normHex(theme.trim()));
  const css = root.querySelectorAll("style").map((s) => s.text).join("\n") + " " + root.querySelectorAll("[style]").map((e) => e.getAttribute("style")).join(" ");
  const freq = new Map<string, number>();
  for (const m of css.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = normHex(m[0]);
    if (!isNeutral(h)) freq.set(h, (freq.get(h) ?? 0) + 1);
  }
  for (const [h] of [...freq.entries()].sort((a, b) => b[1] - a[1])) if (!colors.includes(h)) colors.push(h);

  // Logo candidates, most specific first.
  const logos: string[] = [];
  const push = (u?: string) => { if (u && !logos.includes(u) && logos.length < 6) push2(u); };
  const push2 = (u: string) => logos.push(u);
  const orgLogo = org?.logo as string | { url?: string } | undefined;
  push(abs(typeof orgLogo === "string" ? orgLogo : orgLogo?.url));
  for (const img of root.querySelectorAll("img")) {
    const hay = `${img.getAttribute("class") ?? ""} ${img.getAttribute("id") ?? ""} ${img.getAttribute("alt") ?? ""} ${img.getAttribute("src") ?? ""}`.toLowerCase();
    if (hay.includes("logo")) push(abs(img.getAttribute("src")));
  }
  push(abs(root.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href")));
  push(abs(meta('meta[property="og:image"]')));
  push(abs(root.querySelector('link[rel~="icon"]')?.getAttribute("href")));

  return {
    companyName, description, phone, email, address, services,
    primaryColor: colors[0], secondaryColor: colors[1],
    logoCandidates: logos,
  };
}
