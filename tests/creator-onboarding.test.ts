import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { brandWarnings, colorCheck, contrastRatio, findLicense, guessTrade, mergeBranding, registrableDomain } from "@/lib/onboarding/brand-review";
import { discoverBranding, robotsDisallowsAll } from "@/lib/onboarding/discover";

const PUBLIC = async () => ["93.184.216.34"];
type Routes = Record<string, { status?: number; type?: string; body: string | Buffer; location?: string }>;
const fakeFetch = (routes: Routes, seen: string[] = []) => (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  seen.push(url);
  const r = routes[url];
  if (!r) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  const headers: Record<string, string> = { "content-type": r.type ?? "text/html" };
  if (r.location) headers.location = r.location;
  return new Response(r.body as BodyInit, { status: r.status ?? 200, headers });
}) as typeof fetch;

const HOME = `<!doctype html><html><head><title>Smith Roofing LLC</title>
<meta property="og:site_name" content="Smith Roofing LLC"><meta name="description" content="Quality roof replacement in Austin. Free estimates!">
<meta name="theme-color" content="#1d4ed8"><link rel="icon" href="/logo.png"></head>
<body><header><img src="/logo.png" alt="Smith Roofing logo" class="logo"></header>
<p>Roofing, roof repair and new roofs. Contractor License #RC-55821.</p>
<a href="mailto:office@smithroofing.com">Email</a> <a href="tel:+15125550100">(512) 555-0100</a></body></html>`;

describe("brand review helpers", () => {
  it("computes WCAG contrast and suggests a darker accessible color", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(colorCheck("#0b2d4d").ok).toBe(true);
    const yellow = colorCheck("#ffd400");
    expect(yellow.ok).toBe(false);
    expect(contrastRatio(yellow.suggestion!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(colorCheck("not-a-color").ok).toBe(false);
  });

  it("flags a redirect to another domain, a mismatched name and an off-domain email", () => {
    expect(registrableDomain("www.shop.smithroofing.co.uk")).toBe("smithroofing.co.uk");
    expect(brandWarnings({ requestedUrl: "smithroofing.com", finalUrl: "https://smithroofing.com/", companyName: "Smith Roofing LLC", email: "office@smithroofing.com" })).toEqual([]);
    const w = brandWarnings({ requestedUrl: "smithroofing.com", finalUrl: "https://bigbuilder.com/", companyName: "Acme Decks", email: "x@otherco.com" });
    expect(w.length).toBe(3);
    // Free email providers are normal for small contractors and aren't flagged.
    expect(brandWarnings({ requestedUrl: "smithroofing.com", finalUrl: "https://smithroofing.com/", email: "smithroof@gmail.com" })).toEqual([]);
  });

  it("never overwrites existing branding unless the field was chosen for replacement", () => {
    const existing = { companyName: "My Co", primaryColor: "#1f3a5f", phone: "" };
    const approved = { companyName: "Found Co", primaryColor: "#123456", phone: "555", tagline: "" };
    // Existing name kept; default color counts as unset; empty existing phone gets filled; empty found values skipped.
    expect(mergeBranding(existing, approved, new Set())).toEqual({ primaryColor: "#123456", phone: "555" });
    expect(mergeBranding(existing, approved, new Set(["companyName"]))).toEqual({ companyName: "Found Co", primaryColor: "#123456", phone: "555" });
  });

  it("guesses a trade and finds a license only when the page states it", () => {
    expect(guessTrade("We do roofing, roof repair and siding")).toBe("Roofing");
    expect(guessTrade("Welcome to our site")).toBeNull();
    expect(findLicense("Contractor License #RC-55821 insured")).toBe("RC-55821");
    expect(findLicense("Licensed and insured")).toBeNull();
  });

  it("reads robots.txt blocks for all agents", () => {
    expect(robotsDisallowsAll("User-agent: *\nDisallow: /")).toBe(true);
    expect(robotsDisallowsAll("User-agent: *\nDisallow: /admin")).toBe(false);
    expect(robotsDisallowsAll("User-agent: Googlebot\nDisallow: /")).toBe(false);
  });
});

describe("discoverBranding (server-side, SSRF-safe)", () => {
  it("refuses localhost and private addresses before fetching anything", async () => {
    const seen: string[] = [];
    const f = fakeFetch({}, seen);
    expect(await discoverBranding("http://localhost:3000", { fetch: { fetchImpl: f } })).toMatchObject({ ok: false });
    expect(await discoverBranding("http://127.0.0.1/", { fetch: { fetchImpl: f } })).toMatchObject({ ok: false });
    expect(await discoverBranding("https://intranet.example", { fetch: { fetchImpl: f, resolve: async () => ["10.0.0.5"] } })).toEqual({ ok: false, code: "private_address" });
    expect(await discoverBranding("http://169.254.169.254/latest/meta-data", { fetch: { fetchImpl: f } })).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
  });

  it("refuses a redirect to an internal address", async () => {
    const resolve = async (h: string) => (h === "evil.example" ? ["93.184.216.34"] : ["192.168.1.1"]);
    const f = fakeFetch({ "https://evil.example/": { status: 302, body: "", location: "http://cdn.example.net/" } });
    expect(await discoverBranding("evil.example", { fetch: { fetchImpl: f, resolve } })).toEqual({ ok: false, code: "private_address" });
  });

  it("skips sites whose robots.txt disallows everything", async () => {
    const f = fakeFetch({ "https://smithroofing.com/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /" }, "https://smithroofing.com/": { body: HOME } });
    expect(await discoverBranding("smithroofing.com", { fetch: { fetchImpl: f, resolve: PUBLIC } })).toEqual({ ok: false, code: "robots" });
  });

  it("finds name, colors, contact, trade, license and a valid logo, each with its source", async () => {
    const png = await sharp({ create: { width: 120, height: 48, channels: 4, background: "#1d4ed8" } }).png().toBuffer();
    const f = fakeFetch({ "https://smithroofing.com/": { body: HOME }, "https://smithroofing.com/logo.png": { type: "image/png", body: png } });
    const r = await discoverBranding("smithroofing.com", { fetch: { fetchImpl: f, resolve: PUBLIC } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.fields.companyName?.value).toBe("Smith Roofing LLC");
    expect(r.data.fields.companyName?.source).toContain("smithroofing.com");
    expect(r.data.fields.email?.value).toBe("office@smithroofing.com");
    expect(r.data.fields.trade?.value).toBe("Roofing");
    expect(r.data.fields.licenseNumber?.value).toBe("RC-55821");
    expect(r.data.logo?.value.startsWith("data:image/png;base64,")).toBe(true);
    expect(r.data.warnings).toEqual([]);
  });

  it("works without a logo, and ignores an invalid logo file", async () => {
    const f = fakeFetch({ "https://smithroofing.com/": { body: HOME }, "https://smithroofing.com/logo.png": { type: "image/png", body: "<script>not an image</script>" } });
    const r = await discoverBranding("smithroofing.com", { fetch: { fetchImpl: f, resolve: PUBLIC } });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.data.logo).toBeNull(); expect(r.data.fields.companyName?.value).toBe("Smith Roofing LLC"); }
  });

  it("rejects non-HTML responses and HTTP errors", async () => {
    expect(await discoverBranding("a.example", { fetch: { fetchImpl: fakeFetch({ "https://a.example/": { type: "application/pdf", body: "%PDF" } }), resolve: PUBLIC } })).toEqual({ ok: false, code: "not_html" });
    expect(await discoverBranding("b.example", { fetch: { fetchImpl: fakeFetch({ "https://b.example/": { status: 500, body: "x" } }), resolve: PUBLIC } })).toEqual({ ok: false, code: "http_error" });
  });
});
