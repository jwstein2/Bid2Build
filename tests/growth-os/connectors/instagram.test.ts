import { describe, expect, it } from "vitest";
import { checkConnection } from "../../../growth-os/connectors/health";
import { OAUTH, longLivedRequest, parseTokenResponse, refreshRequest, tokenRequest } from "../../../growth-os/connectors/oauth";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

describe("connector: Instagram professional account (Instagram Login)", () => {
  registryChecks("instagram");

  it("short-lived token response (data[] shape) carries the granted permissions; long-lived exchange and refresh use graph.instagram.com", () => {
    const t = parseTokenResponse("instagram", { data: [{ access_token: "IGQshort", user_id: "1789", permissions: "instagram_business_basic,instagram_business_manage_insights" }] }, 0);
    expect(t.grantedScopes).toEqual(["instagram_business_basic", "instagram_business_manage_insights"]);
    expect(t.token.extra?.user_id).toBe("1789");
    expect(tokenRequest(OAUTH.instagram, { clientId: "a", clientSecret: "b", code: "c", redirectUri: "https://r" }).init.method).toBe("POST");
    expect(longLivedRequest(OAUTH.instagram, { clientId: "a", clientSecret: "b", accessToken: "IGQshort" })!.url).toContain("ig_exchange_token");
    expect(refreshRequest(OAUTH.instagram, { clientId: "a", clientSecret: "b", token: t.token })!.url).toContain("ig_refresh_token");
  });
  it("Business account → ok with stored permissions; personal account → limited", async () => {
    const token = { access_token: "IGQlong", obtained_at: "x", extra: { permissions: ["instagram_business_basic"] } };
    let f = fakeFetch([{ match: /graph\.instagram\.com\/.*\/me/, json: { user_id: "1789", username: "built2bid", account_type: "BUSINESS" } }]);
    expect(await checkConnection({ provider: "instagram", accountRef: "1789", token, fetch: f.fetch })).toMatchObject({ outcome: "ok", grantedScopes: ["instagram_business_basic"], accountLabel: "built2bid" });
    f = fakeFetch([{ match: /me/, json: { account_type: "PERSONAL" } }]);
    expect((await checkConnection({ provider: "instagram", accountRef: "1789", token, fetch: f.fetch })).outcome).toBe("limited");
  });
  it("a different Instagram account than the registered one → limited", async () => {
    const f = fakeFetch([{ match: /me/, json: { user_id: "555", username: "someoneelse", account_type: "BUSINESS" } }]);
    expect((await checkConnection({ provider: "instagram", accountRef: "built2bid", token: { access_token: "x", obtained_at: "x" }, fetch: f.fetch })).errorCode).toBe("account_mismatch");
  });
  it("expired token → awaiting authorization", async () => {
    const f = fakeFetch([{ match: /me/, status: 400, json: { error: { code: 190, message: "expired" } } }]);
    expect((await checkConnection({ provider: "instagram", accountRef: "1", token: { access_token: "x", obtained_at: "x" }, fetch: f.fetch })).outcome).toBe("auth_error");
  });
});
