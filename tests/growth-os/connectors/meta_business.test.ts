import { describe, expect, it } from "vitest";
import { checkConnection } from "../../../growth-os/connectors/health";
import { OAUTH, longLivedRequest, parseTokenResponse, tokenRequest } from "../../../growth-os/connectors/oauth";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

describe("connector: Meta Business Portfolio", () => {
  registryChecks("meta_business");
  const perms = { data: [{ permission: "business_management", status: "granted" }, { permission: "ads_read", status: "granted" }, { permission: "ads_management", status: "declined" }] };

  it("system-user token (manual secret): /me/permissions lists only granted permissions; token sent as a header, not in the URL", async () => {
    const f = fakeFetch([{ match: /\/me\/permissions$/, json: perms },
      { match: /\/1234567890\?fields=id,name$/, json: { id: "1234567890", name: "Built2Bid" }, headers: { "x-business-use-case-usage": '{"121510736":[{"call_count":1}]}' } }]);
    const r = await checkConnection({ provider: "meta_business", accountRef: "1234567890", secret: "EAAGsystemusertoken", fetch: f.fetch });
    expect(r).toMatchObject({ outcome: "ok", grantedScopes: ["business_management", "ads_read"], accountLabel: "Built2Bid" });
    expect(r.rateLimit?.["x-business-use-case-usage"]).toContain("call_count");
    expect(f.calls[0].url).not.toContain("EAAG");
    expect(f.calls[0].init?.headers?.Authorization).toBe("Bearer EAAGsystemusertoken");
  });
  it("permissions alone are not enough: a token that cannot read the registered portfolio is limited", async () => {
    const f = fakeFetch([{ match: /permissions/, json: perms }, { match: /\/1234567890\?/, status: 400, json: { error: { code: 100, message: "Unsupported get request" } } }]);
    expect((await checkConnection({ provider: "meta_business", accountRef: "1234567890", secret: "EAAGx", fetch: f.fetch })).errorCode).toBe("business_not_accessible");
  });
  it("expired token (code 190) → awaiting authorization; rate limit (17) → transient error; missing permission (200) → limited", async () => {
    for (const [code, outcome] of [[190, "auth_error"], [17, "error"], [200, "limited"]] as const) {
      const f = fakeFetch([{ match: /permissions/, status: 400, json: { error: { code, message: "x" } } }]);
      expect((await checkConnection({ provider: "meta_business", accountRef: "b", secret: "EAAGx", fetch: f.fetch })).outcome).toBe(outcome);
    }
  });
  it("OAuth: code exchange is a server-side GET with the app secret, then a 60-day long-lived exchange", () => {
    const req = tokenRequest(OAUTH.meta_business, { clientId: "app", clientSecret: "shh", code: "c0de", redirectUri: "https://r" });
    expect(new URL(req.url).searchParams.get("code")).toBe("c0de");
    const ll = longLivedRequest(OAUTH.meta_business, { clientId: "app", clientSecret: "shh", accessToken: "short" })!;
    expect(new URL(ll.url).searchParams.get("grant_type")).toBe("fb_exchange_token");
    const t = parseTokenResponse("meta_business", { access_token: "EAAGlong", token_type: "bearer", expires_in: 5183944 }, 0);
    expect(t.grantedScopes).toBeNull();   // Meta does not report scopes here; the health check reads them
    expect(t.expiresAt).toBe(new Date(5183944000).toISOString());
  });
  it("platform error responses become OAuthError, not a stored token", () => {
    expect(() => parseTokenResponse("meta_business", { error: { code: 100, message: "Invalid verification code format." } }, 0)).toThrow(/Invalid verification/);
  });
});
