import { describe, expect, it } from "vitest";
import { checkConnection } from "../../../growth-os/connectors/health";
import { OAUTH, buildAuthorizeUrl, parseTokenResponse, tokenRequest } from "../../../growth-os/connectors/oauth";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

describe("connector: TikTok ads (API for Business)", () => {
  const c = registryChecks("tiktok_business");
  it("starts as awaiting platform approval (developer app not yet approved)", () => expect(c.baseline).toBe("awaiting_platform_approval"));
  it("authorize link uses app_id; permissions are chosen on the app, not in the URL", () => {
    const u = new URL(buildAuthorizeUrl(OAUTH.tiktok_business, { clientId: "7123", redirectUri: "https://r", state: "s", scopes: ["x"] }));
    expect(u.searchParams.get("app_id")).toBe("7123");
    expect(u.searchParams.get("scope")).toBeNull();
  });
  it("token exchange posts JSON with auth_code; long-term token has no expiry", () => {
    const req = tokenRequest(OAUTH.tiktok_business, { clientId: "7123", clientSecret: "s", code: "ac", redirectUri: "https://r" });
    expect(JSON.parse(req.init.body!)).toEqual({ app_id: "7123", secret: "s", auth_code: "ac" });
    const t = parseTokenResponse("tiktok_business", { code: 0, data: { access_token: "act", advertiser_ids: ["7001"], scope: [4, 5] } }, 0);
    expect(t).toMatchObject({ expiresAt: null, grantedScopes: null, token: { extra: { advertiser_ids: ["7001"] } } });
    expect(() => parseTokenResponse("tiktok_business", { code: 40002, message: "auth_code expired" }, 0)).toThrow(/expired/);
  });
  it("health: advertiser visible + report probe ok → advertiser.read and reporting.read", async () => {
    const f = fakeFetch([{ match: /advertiser\/get/, json: { code: 0, data: { list: [{ advertiser_id: "7001", advertiser_name: "Built2Bid" }] } } },
      { match: /report\/integrated\/get/, json: { code: 0, data: { list: [] } } }]);
    expect(await checkConnection({ provider: "tiktok_business", accountRef: "7001", token: { access_token: "act", obtained_at: "x" }, clientId: "7123", clientSecret: "s", fetch: f.fetch }))
      .toMatchObject({ outcome: "ok", grantedScopes: ["advertiser.read", "reporting.read"] });
    expect(f.calls[0].init?.headers?.["Access-Token"]).toBe("act");
  });
  it("revoked authorization (40105) → awaiting authorization", async () => {
    const f = fakeFetch([{ match: /advertiser\/get/, json: { code: 40105, message: "access token invalid" } }]);
    expect((await checkConnection({ provider: "tiktok_business", accountRef: "7001", token: { access_token: "a", obtained_at: "x" }, fetch: f.fetch })).outcome).toBe("auth_error");
  });
});
