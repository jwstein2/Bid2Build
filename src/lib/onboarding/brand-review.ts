/**
 * Branding review helpers for gifted-member onboarding (pure, shared by server and browser).
 *  - Contrast: proposal headings use the primary color on white, and the "band" header puts white text
 *    on it, so a primary color needs 4.5:1 against white (WCAG AA) to be readable.
 *  - Brand match: flags when what we found doesn't obviously belong to the website the user typed
 *    (e.g. the page redirected to another company, or the email is on another business's domain).
 *  - Merge: never overwrites existing branding unless the user explicitly chose to replace that field.
 */
export const BRAND_FIELDS = ["companyName", "logo", "primaryColor", "secondaryColor", "tagline", "trade", "email", "phone", "address", "website", "services", "licenseNumber"] as const;
export type BrandField = (typeof BRAND_FIELDS)[number];

export const FIELD_LABELS: Record<BrandField, string> = {
  companyName: "Company name", logo: "Logo", primaryColor: "Primary brand color", secondaryColor: "Accent color", tagline: "Tagline",
  trade: "Primary trade", email: "Business email", phone: "Business phone", address: "Business location", website: "Website",
  services: "Services", licenseNumber: "License number",
};

const HEX = /^#[0-9a-f]{6}$/i;

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number {
  if (!HEX.test(a) || !HEX.test(b)) return 0;
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

/** Darken a color step by step until it reaches `target` contrast against white. */
export function accessibleOnWhite(hex: string, target = 4.5): string {
  if (!HEX.test(hex)) return "#0B2A4A";
  let n = parseInt(hex.slice(1), 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  for (let i = 0; i < 40; i++) {
    const h = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    if (contrastRatio(h, "#ffffff") >= target) return h;
    [r, g, b] = [r, g, b].map((v) => Math.max(0, Math.floor(v * 0.92)));
    n = (r << 16) | (g << 8) | b;
  }
  return "#0B2A4A";
}

export function colorCheck(hex: string | null | undefined): { ok: boolean; ratio: number; suggestion: string | null } {
  if (!hex || !HEX.test(hex)) return { ok: false, ratio: 0, suggestion: null };
  const ratio = contrastRatio(hex.toLowerCase(), "#ffffff");
  return ratio >= 4.5 ? { ok: true, ratio, suggestion: null } : { ok: false, ratio, suggestion: accessibleOnWhite(hex.toLowerCase()) };
}

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com", "me.com", "live.com", "msn.com", "comcast.net", "att.net", "verizon.net", "protonmail.com", "proton.me", "ymail.com", "sbcglobal.net", "bellsouth.net", "cox.net", "charter.net"]);
const TWO_LEVEL = /\.(co|com|org|net|gov|ac)\.[a-z]{2}$/;

/** "www.shop.smithroofing.com" -> "smithroofing.com" (good enough for matching; not a PSL). */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const parts = h.split(".");
  return parts.slice(TWO_LEVEL.test(h) ? -3 : -2).join(".");
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const STOP = new Set(["llc", "inc", "co", "corp", "company", "the", "and", "services", "service", "construction", "contracting", "contractors", "contractor", "group", "home", "homes", "pro", "pros", "ltd"]);

/** Warnings shown next to the suggestions. Empty = looks consistent. */
export function brandWarnings(input: { requestedUrl: string; finalUrl: string; companyName?: string | null; email?: string | null }): string[] {
  const out: string[] = [];
  let req = "", fin = "";
  try { req = registrableDomain(new URL(input.requestedUrl.includes("://") ? input.requestedUrl : `https://${input.requestedUrl}`).hostname); } catch { /* ignore */ }
  try { fin = registrableDomain(new URL(input.finalUrl).hostname); } catch { /* ignore */ }
  if (req && fin && req !== fin) out.push(`Your website sent us to ${fin}, which is a different address from ${req}. Check that these details belong to your business.`);
  const domainCore = norm((fin || req).split(".")[0] ?? "");
  if (input.companyName && domainCore) {
    const tokens = input.companyName.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t));
    const nameCore = norm(input.companyName);
    const matches = nameCore.includes(domainCore) || domainCore.includes(nameCore) || tokens.some((t) => domainCore.includes(t));
    if (tokens.length && !matches) out.push(`The company name we found ("${input.companyName}") doesn't match the website address. It may be a different business or a website builder's name.`);
  }
  if (input.email) {
    const ed = registrableDomain(input.email.split("@")[1] ?? "");
    if (ed && fin && ed !== fin && !FREE_MAIL.has(ed)) out.push(`The email we found is on ${ed}, not your website's domain. Make sure it's yours before using it.`);
  }
  return out;
}

export type Decision = "accept" | "edit" | "remove";

/**
 * Which fields to write to the company profile. Existing non-empty values are kept unless the user
 * picked "replace" for that field (shown when both an existing and a found value exist).
 */
export function mergeBranding<T extends Record<string, unknown>>(existing: Partial<T>, approved: Partial<T>, replace: ReadonlySet<string>): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(approved) as [keyof T & string, T[keyof T & string]][]) {
    if (v === undefined || v === null || v === "") continue;
    const cur = existing[k];
    const hasCurrent = cur !== undefined && cur !== null && cur !== "" && !(k.endsWith("Color") && isDefaultColor(String(cur)));
    if (hasCurrent && !replace.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/** business_profiles defaults: treated as "not set" so imported colors can fill them. */
export const isDefaultColor = (hex: string) => ["#1f3a5f", "#c8702a"].includes(hex.toLowerCase());

/** Very small keyword map from public site text to a Built2Bid trade name (suggestion only). */
const TRADE_WORDS: [RegExp, string][] = [
  [/\broof(ing|er|s)?\b/, "Roofing"], [/\bsiding\b/, "Siding"], [/\bdeck(s|ing)?\b|\bpergola|\bporch/, "Decks & Porches"], [/\bconcrete\b|\bflatwork\b/, "Concrete"],
  [/\bkitchen/, "Kitchens"], [/\bbath(room)?s?\b/, "Bathrooms"], [/\bpaint(ing|er|ers)?\b/, "Painting"], [/\belectric(al|ian)\b/, "Electrical"],
  [/\bfloor(ing)?\b/, "Flooring"], [/\bplumb(ing|er)\b/, "Plumbing"], [/\bhvac\b|\bheating\b|\bair conditioning\b/, "HVAC"], [/\bfenc(e|ing)\b/, "Fencing"],
  [/\bremodel(ing)?\b|\brenovation/, "Remodeling"], [/\bdrywall\b/, "Drywall"], [/\btile\b/, "Tile"], [/\blandscap/, "Landscaping"], [/\bhandyman\b/, "Handyman"],
];

export function guessTrade(text: string | null | undefined): string | null {
  const t = (text ?? "").toLowerCase();
  let best: [string, number] | null = null;
  for (const [re, name] of TRADE_WORDS) {
    const n = (t.match(new RegExp(re.source, "g")) ?? []).length;
    if (n && (!best || n > best[1])) best = [name, n];
  }
  return best?.[0] ?? null;
}

/** "License #ABC-12345" style text, only when the page literally says it. */
export function findLicense(text: string | null | undefined): string | null {
  const m = (text ?? "").match(/\b(?:contractor'?s?\s+)?lic(?:ense|\.)?\s*(?:#|no\.?|number)\s*:?\s*([A-Z0-9][A-Z0-9-]{3,19})\b/i);
  return m ? m[1].toUpperCase() : null;
}

export const TRADE_OPTIONS = [...new Set(TRADE_WORDS.map(([, n]) => n))].concat(["General contracting", "Other"]);
