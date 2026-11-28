import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isChunkLoadError, isDesktopInstallPromoEnabled, parseVersionInfo, updateStateFor } from "@/lib/pwa/version";
import { describeDevice, safariCanAddToDock } from "@/lib/pwa/install-prompt";
import manifest from "@/app/manifest";

const WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const WIN_EDGE = `${WIN_CHROME} Edg/142.0.0.0`;
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const MAC_SAFARI_18 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15";
const MAC_SAFARI_16 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15";
const WIN_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

describe("desktop app: update detection", () => {
  it("is current when builds match, or when the build is unknown (local dev)", () => {
    expect(updateStateFor("abc", { build: "abc", required: false })).toBe("current");
    expect(updateStateFor("", { build: "abc", required: true })).toBe("current");
    expect(updateStateFor("abc", null)).toBe("current");
  });
  it("offers a refresh when production moved on, and requires it for an urgent release", () => {
    expect(updateStateFor("old", { build: "new", required: false })).toBe("available");
    expect(updateStateFor("old", { build: "new", required: true })).toBe("required");
  });
  it("treats a malformed /api/version answer as no information, never as an update", () => {
    expect(parseVersionInfo(null)).toBeNull();
    expect(parseVersionInfo({ build: "" })).toBeNull();
    expect(parseVersionInfo({ build: 5 })).toBeNull();
    expect(parseVersionInfo("<html>")).toBeNull();
    expect(parseVersionInfo({ build: "x", required: "yes" })).toEqual({ build: "x", required: false });
  });
  it("recognises chunk load failures from an older deploy", () => {
    const e = new Error("Loading chunk 4821 failed.\n(missing: https://built2bid.org/_next/static/chunks/4821.js)");
    e.name = "ChunkLoadError";
    expect(isChunkLoadError(e)).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/a.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Network request failed"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("desktop app: install promotion flag", () => {
  it("is on by default and off only when set to off/false/0", () => {
    expect(isDesktopInstallPromoEnabled(undefined)).toBe(true);
    expect(isDesktopInstallPromoEnabled("")).toBe(true);
    expect(isDesktopInstallPromoEnabled("on")).toBe(true);
    for (const v of ["off", "OFF", "false", "0", " off "]) expect(isDesktopInstallPromoEnabled(v)).toBe(false);
  });
});

describe("desktop app: device detection for install steps", () => {
  it("names platform and browser", () => {
    expect(describeDevice(WIN_CHROME)).toEqual({ platform: "windows", browser: "chrome" });
    expect(describeDevice(WIN_EDGE)).toEqual({ platform: "windows", browser: "edge" });
    expect(describeDevice(MAC_CHROME)).toEqual({ platform: "mac", browser: "chrome" });
    expect(describeDevice(MAC_SAFARI_18)).toEqual({ platform: "mac", browser: "safari" });
    expect(describeDevice(WIN_FIREFOX)).toEqual({ platform: "windows", browser: "firefox" });
    expect(describeDevice(IPHONE).platform).toBe("mobile");
    // iPadOS reports a Mac user agent but has touch.
    expect(describeDevice(MAC_SAFARI_18, 5).platform).toBe("mobile");
  });
  it("knows when Safari can Add to Dock (Safari 17+)", () => {
    expect(safariCanAddToDock(MAC_SAFARI_18)).toBe(true);
    expect(safariCanAddToDock(MAC_SAFARI_16)).toBe(false);
  });
});

describe("desktop app: manifest and service worker", () => {
  const m = manifest();
  it("keeps the installed app's identity and opens into the app", () => {
    expect(m.id).toBe("/");
    expect(m.name).toBe("Built2Bid");
    expect(m.display).toBe("standalone");
    expect(m.scope).toBe("/");
    expect(String(m.start_url)).toMatch(/^\/(home|dashboard)$/);
  });
  it("ships desktop-size official icons, including a maskable one", () => {
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    for (const s of ["192x192", "256x256", "512x512", "1024x1024"]) expect(sizes).toContain(s);
    expect((m.icons ?? []).some((i) => i.purpose === "maskable")).toBe(true);
    for (const i of m.icons ?? []) expect(i.src.startsWith("/brand/")).toBe(true);
  });
  it("service worker caches only the offline page and never touches non-navigation or non-GET requests", () => {
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain('req.mode !== "navigate" || req.method !== "GET"');
    // The only thing ever written to a cache is the offline page.
    expect(sw.match(/cache\.(add|addAll|put)\(/g)).toEqual(["cache.add("]);
    expect(sw).toContain('const OFFLINE_URL = "/offline.html"');
    expect(readFileSync("public/offline.html", "utf8")).toContain("You're offline. Connect to the internet to continue using Built2Bid.");
  });
});
