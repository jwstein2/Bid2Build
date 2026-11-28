// Shared checks every per-integration suite runs against the registry entry.
import { expect, it } from "vitest";
import { connectorByProvider, readScopes, STATUSES } from "../../../growth-os/connectors/registry";
import { OAUTH, buildAuthorizeUrl } from "../../../growth-os/connectors/oauth";

const ASKS_FOR_SECRET_CODES = /(enter|type|paste|give|share|send|tell)[^.]{0,60}(password|recovery code|backup code|mfa code|2fa code|one-time code|verification code)/i;

export function registryChecks(provider: string) {
  const c = connectorByProvider.get(provider)!;
  it("is in the registry with a valid baseline, docs/limits/cost/review facts and operations", () => {
    expect(c).toBeDefined();
    expect(["awaiting_authorization", "awaiting_platform_approval", "unsupported"]).toContain(c.baseline);
    expect(STATUSES).toContain(c.baseline);
    for (const f of [c.existing, c.review, c.limits, c.cost, c.baselineReason]) expect(f.length).toBeGreaterThan(3);
    expect(c.operations.length).toBeGreaterThan(0);
    for (const o of c.operations) {
      expect(o.key).toMatch(/^[a-z0-9_.]{2,60}$/);
      if (o.baseline !== "unsupported" && c.baseline !== "unsupported") expect(o.scopes.length).toBeGreaterThan(0);
      if (o.privileged) expect(o.phase).toBeGreaterThanOrEqual(6);
    }
  });
  it("gives manual authorization steps that never ask for a password, recovery or MFA code", () => {
    expect(c.manualSteps.length).toBeGreaterThan(0);
    for (const s of c.manualSteps) expect(s).not.toMatch(ASKS_FOR_SECRET_CODES);
    for (const m of c.manualSecrets ?? []) expect(m.name.startsWith(`growth_${provider}_`)).toBe(true);
  });
  if (OAUTH[provider]) {
    it("authorize URL requests only the phase-5 read scopes, with state (and PKCE where supported)", () => {
      const cfg = OAUTH[provider];
      const u = new URL(buildAuthorizeUrl(cfg, { clientId: "cid", redirectUri: "https://x.supabase.co/functions/v1/growth-oauth/callback", state: "s".repeat(64), scopes: readScopes(c), codeChallenge: "ch" }));
      expect(u.searchParams.get("state")).toBe("s".repeat(64));
      expect(u.searchParams.get("redirect_uri")).toBe("https://x.supabase.co/functions/v1/growth-oauth/callback");
      if (cfg.sendScopes) {
        const asked = (u.searchParams.get("scope") ?? "").split(cfg.scopeSeparator);
        expect(asked.sort()).toEqual(readScopes(c).sort());
        const privileged = c.operations.filter((o) => o.privileged).flatMap((o) => o.scopes).filter((s) => !readScopes(c).includes(s));
        for (const p of privileged) expect(asked).not.toContain(p);
      }
      if (cfg.pkce) expect(u.searchParams.get("code_challenge_method")).toBe("S256");
      else expect(u.searchParams.get("code_challenge")).toBeNull();
      expect(u.protocol).toBe("https:");
    });
  }
  return c;
}

export const res = (status: number, json: unknown) => ({ status, json });
