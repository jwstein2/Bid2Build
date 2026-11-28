import { describe, expect, it } from "vitest";
import { checkConnection } from "../../../growth-os/connectors/health";
import { OAUTH, buildAuthorizeUrl, parseTokenResponse, refreshRequest } from "../../../growth-os/connectors/oauth";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

describe("connector: TikTok account content (Login Kit)", () => {
  registryChecks("tiktok_content");
  it("uses client_key, comma-separated scopes and PKCE", () => {
    const u = new URL(buildAuthorizeUrl(OAUTH.tiktok_content, { clientId: "ck", redirectUri: "https://r", state: "s", scopes: ["user.info.basic", "video.list"], codeChallenge: "c" }));
    expect(u.searchParams.get("client_key")).toBe("ck");
    expect(u.searchParams.get("scope")).toBe("user.info.basic,video.list");
  });
  it("2 h access token, rotating 180-day refresh token: the new refresh token replaces the old one", () => {
    const first = parseTokenResponse("tiktok_content", { access_token: "act.1", expires_in: 7200, refresh_token: "rft.1", refresh_expires_in: 15552000, open_id: "o1", scope: "user.info.basic,video.list" }, 0);
    expect(first.grantedScopes).toEqual(["user.info.basic", "video.list"]);
    expect(first.token.refresh_expires_at).toBe(new Date(15552000000).toISOString());
    const req = refreshRequest(OAUTH.tiktok_content, { clientId: "ck", clientSecret: "cs", token: first.token })!;
    expect(req.init.body).toContain("refresh_token=rft.1");
    const second = parseTokenResponse("tiktok_content", { access_token: "act.2", expires_in: 7200, refresh_token: "rft.2" }, 1000, first.token);
    expect(second.token).toMatchObject({ refresh_token: "rft.2", extra: { open_id: "o1" } });
  });
  it("health: user info ok → ok; invalid token → awaiting authorization", async () => {
    let f = fakeFetch([{ match: /user\/info/, json: { data: { user: { display_name: "built2bid" } }, error: { code: "ok" } } }]);
    expect((await checkConnection({ provider: "tiktok_content", accountRef: "o1", token: { access_token: "a", obtained_at: "x" }, grantedScopes: ["user.info.basic"], fetch: f.fetch })).outcome).toBe("ok");
    f = fakeFetch([{ match: /user\/info/, status: 401, json: { error: { code: "access_token_invalid" } } }]);
    expect((await checkConnection({ provider: "tiktok_content", accountRef: "o1", token: { access_token: "a", obtained_at: "x" }, fetch: f.fetch })).outcome).toBe("auth_error");
  });
});
