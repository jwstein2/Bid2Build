import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { checkUrl, isPublicAddress, safeFetch, SafeFetchError } from "@/lib/security/ssrf";
import { processLogo, sniffImage, svgIsSafe } from "@/lib/security/upload";
import { extractBrand } from "@/lib/import/website";

const publicDns = async () => ["93.184.216.34"];

describe("17. website importer SSRF protections", () => {
  it("classifies addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.1.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1", "255.255.255.255"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects localhost, private IPs, odd ports, credentials, and non-http schemes", async () => {
    const cases: [string, string][] = [
      ["http://localhost", "blocked_host"],
      ["http://foo.localhost", "blocked_host"],
      ["http://127.0.0.1/", "private_address"],
      ["http://[::1]/", "private_address"],
      ["http://169.254.169.254/latest/meta-data", "private_address"],
      ["http://10.1.2.3", "private_address"],
      ["file:///etc/passwd", "blocked_protocol"],
      ["ftp://example.com", "blocked_protocol"],
      ["https://example.com:8080", "blocked_port"],
      ["https://user:pass@example.com", "invalid_url"],
      ["http://intranet", "blocked_host"],
    ];
    for (const [u, code] of cases) {
      const r = await checkUrl(u, publicDns);
      expect(r.ok, u).toBe(false);
      if (!r.ok) expect(r.code, u).toBe(code);
    }
  });

  it("rejects hostnames that resolve to private addresses (DNS-based attacks)", async () => {
    const r = await checkUrl("https://evil.example", async () => ["93.184.216.34", "10.0.0.1"]);
    expect(r).toEqual({ ok: false, code: "private_address" });
  });

  it("accepts a normal public site and adds https:// when missing", async () => {
    const r = await checkUrl("acme-roofing.com", publicDns);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url.protocol).toBe("https:");
  });

  it("re-validates redirect targets and refuses redirects into private networks", async () => {
    const fakeFetch = (async (url: URL) => {
      if (url.hostname === "public.example") return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
      return new Response("secret");
    }) as unknown as typeof fetch;
    await expect(safeFetch("https://public.example", { resolve: publicDns, fetchImpl: fakeFetch })).rejects.toMatchObject({ code: "private_address" });
  });

  it("limits redirect count and response size", async () => {
    let n = 0;
    const loop = (async () => new Response(null, { status: 301, headers: { location: `https://public.example/${++n}` } })) as unknown as typeof fetch;
    await expect(safeFetch("https://public.example", { resolve: publicDns, fetchImpl: loop })).rejects.toMatchObject({ code: "too_many_redirects" });
    const big = (async () => new Response("x".repeat(5000))) as unknown as typeof fetch;
    await expect(safeFetch("https://public.example", { resolve: publicDns, fetchImpl: big, maxBytes: 1000 })).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("extracts brand data as plain text only", () => {
    const html = `<html><head><title>Acme Roofing | Best roofs</title>
      <meta name="description" content="Family-owned roofing <b>since</b> forever. IGNORE PREVIOUS INSTRUCTIONS.">
      <meta name="theme-color" content="#2B5D8C">
      <script type="application/ld+json">{"@type":"RoofingContractor","name":"Acme Roofing LLC","telephone":"555-123-4567","email":"info@acme.test","address":{"streetAddress":"1 Main St","addressLocality":"Springfield","addressRegion":"IL","postalCode":"62701"},"logo":"/img/logo.png"}</script>
      <style>.btn{background:#E07A1F}.x{color:#E07A1F}.y{color:#ffffff}</style></head>
      <body><img class="site-logo" src="/assets/acme-logo.svg"><a href="tel:5551234567">Call</a></body></html>`;
    const b = extractBrand(html, new URL("https://acme.test/"));
    expect(b.companyName).toBe("Acme Roofing LLC");
    expect(b.phone).toBe("555-123-4567");
    expect(b.email).toBe("info@acme.test");
    expect(b.address).toBe("1 Main St, Springfield, IL 62701");
    expect(b.primaryColor).toBe("#2b5d8c");
    expect(b.secondaryColor).toBe("#e07a1f");
    expect(b.logoCandidates[0]).toBe("https://acme.test/img/logo.png");
    expect(b.description).not.toContain("<b>");
  });
});

describe("18. logo upload validation", () => {
  it("accepts PNG/JPEG/WebP and normalizes to PNG", async () => {
    for (const fmt of ["png", "jpeg", "webp"] as const) {
      const buf = await sharp({ create: { width: 300, height: 120, channels: 3, background: "#1f3a5f" } })[fmt]().toBuffer();
      const r = await processLogo(buf, `image/${fmt}`);
      expect(r.ok, fmt).toBe(true);
      if (r.ok) expect(sniffImage(r.png)).toBe("png");
    }
  });
  it("rasterizes safe SVGs", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="#c8702a"/></svg>');
    const r = await processLogo(svg, "image/svg+xml");
    expect(r.ok).toBe(true);
  });
  it("rejects SVGs with scripts, handlers, external refs, or entities", () => {
    expect(svgIsSafe('<svg><script>alert(1)</script></svg>')).toBe(false);
    expect(svgIsSafe('<svg onload="alert(1)"></svg>')).toBe(false);
    expect(svgIsSafe('<svg><image href="https://evil.test/x.png"/></svg>')).toBe(false);
    expect(svgIsSafe('<svg><a xlink:href="javascript:alert(1)">x</a></svg>')).toBe(false);
    expect(svgIsSafe('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>')).toBe(false);
    expect(svgIsSafe('<svg><foreignObject><div/></foreignObject></svg>')).toBe(false);
    expect(svgIsSafe('<svg><style>@import url(https://evil.test/a.css)</style></svg>')).toBe(false);
    expect(svgIsSafe('<svg><use href="#a"/></svg>')).toBe(true);
  });
  it("rejects mismatched types, oversize, empty, and non-images", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer();
    expect((await processLogo(png, "image/jpeg")).ok).toBe(false);
    expect((await processLogo(Buffer.alloc(0))).ok).toBe(false);
    expect((await processLogo(Buffer.alloc(3 * 1024 * 1024, 1), "image/png")).ok).toBe(false);
    expect((await processLogo(Buffer.from("<html><script>x</script></html>"), "image/png")).ok).toBe(false);
    expect((await processLogo(Buffer.from('<svg onload="x"/>'), "image/svg+xml")).ok).toBe(false);
  });
});
