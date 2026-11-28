import { describe, expect, it } from "vitest";
import { CONNECTORS, privilegedScopes, readScopes } from "../../../growth-os/connectors/registry";
import { OAUTH } from "../../../growth-os/connectors/oauth";
import { redact } from "../../../growth-os/connectors/health";
import { readdirSync } from "node:fs";
import path from "node:path";

describe("connector registry", () => {
  it("covers all 11 integrations from the Phase 5 prompt (plus Buffer and TikTok content)", () => {
    const p = CONNECTORS.map((c) => c.provider);
    for (const need of ["meta_business", "facebook_pages", "instagram", "tiktok_business", "youtube", "google_ads", "linkedin", "google_workspace", "supabase", "ga4_gtm", "stripe", "video_tools"]) expect(p).toContain(need);
    expect(new Set(p).size).toBe(p.length);
  });
  it("every connector has its own test suite file", () => {
    const files = readdirSync(path.resolve(import.meta.dirname));
    for (const c of CONNECTORS) expect(files).toContain(`${c.provider}.test.ts`);
  });
  it("every OAuth connector has an OAuth config, and only OAuth connectors do", () => {
    for (const c of CONNECTORS) expect(Boolean(OAUTH[c.provider])).toBe(c.authKinds.includes("oauth2"));
  });
  it("read and privileged scope sets never overlap for a scope that only privileged operations need", () => {
    for (const c of CONNECTORS) for (const s of privilegedScopes(c)) expect(readScopes(c)).not.toContain(s);
  });
  it("redact removes secrets from messages", () => {
    expect(redact("token EAAGabcdefgh failed", ["EAAGabcdefgh"])).toBe("token [redacted] failed");
  });
});
