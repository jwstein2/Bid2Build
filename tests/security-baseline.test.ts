import { describe, expect, it } from "vitest";
import { baselineCsp } from "@/lib/config/csp";

describe("baseline CSP", () => {
  it("blocks framing, plugins and <base> hijacking everywhere", () => {
    for (const ctx of ["local", "production", "deploy-preview"]) {
      const csp = baselineCsp(ctx);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      // Must never restrict scripts until a nonce-based policy has run in report-only mode.
      expect(csp).not.toMatch(/script-src|default-src|connect-src/);
    }
  });
  it("upgrades insecure requests only on deployed copies", () => {
    expect(baselineCsp("local")).not.toContain("upgrade-insecure-requests");
    expect(baselineCsp("production")).toContain("upgrade-insecure-requests");
  });
});
