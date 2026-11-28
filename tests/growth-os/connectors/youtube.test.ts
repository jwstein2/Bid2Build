import { describe, expect, it } from "vitest";
import { checkConnection } from "../../../growth-os/connectors/health";
import { OAUTH, buildAuthorizeUrl, parseTokenResponse, refreshRequest } from "../../../growth-os/connectors/oauth";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

const RO = "https://www.googleapis.com/auth/youtube.readonly", AN = "https://www.googleapis.com/auth/yt-analytics.readonly";
describe("connector: YouTube channel", () => {
  registryChecks("youtube");
  it("asks Google for offline access (refresh token) with forced consent", () => {
    const u = new URL(buildAuthorizeUrl(OAUTH.youtube, { clientId: "c", redirectUri: "https://r", state: "s", scopes: [RO, AN], codeChallenge: "x" }));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
  });
  it("refresh keeps the refresh token Google does not resend", () => {
    const t = parseTokenResponse("youtube", { access_token: "ya29.a", expires_in: 3599, refresh_token: "1//r", scope: `${RO} ${AN}` }, 0);
    expect(refreshRequest(OAUTH.youtube, { clientId: "c", clientSecret: "s", token: t.token })!.init.body).toContain("grant_type=refresh_token");
    expect(parseTokenResponse("youtube", { access_token: "ya29.b", expires_in: 3599 }, 1, t.token).token.refresh_token).toBe("1//r");
  });
  it("health: real granted scopes from tokeninfo; wrong channel → limited; invalid token → awaiting authorization", async () => {
    const tok = { access_token: "ya29.a", obtained_at: "x" };
    let f = fakeFetch([{ match: /tokeninfo/, json: { scope: `${RO} ${AN}` } }, { match: /channels/, json: { items: [{ id: "UCyg", snippet: { title: "Built2Bid" } }] } }]);
    expect(await checkConnection({ provider: "youtube", accountRef: "UCyg", token: tok, fetch: f.fetch })).toMatchObject({ outcome: "ok", grantedScopes: [RO, AN] });
    f = fakeFetch([{ match: /tokeninfo/, json: { scope: RO } }, { match: /channels/, json: { items: [{ id: "UCother" }] } }]);
    expect((await checkConnection({ provider: "youtube", accountRef: "UCyg", token: tok, fetch: f.fetch })).errorCode).toBe("channel_not_granted");
    f = fakeFetch([{ match: /tokeninfo/, status: 400, json: { error: "invalid_token" } }]);
    expect((await checkConnection({ provider: "youtube", accountRef: "UCyg", token: tok, fetch: f.fetch })).outcome).toBe("auth_error");
  });
  it("API not enabled in the Cloud project → awaiting platform approval; quota → transient", async () => {
    const tok = { access_token: "ya29.a", obtained_at: "x" };
    let f = fakeFetch([{ match: /tokeninfo/, json: { scope: RO } }, { match: /channels/, status: 403, json: { error: { status: "PERMISSION_DENIED", message: "YouTube Data API v3 has not been used in project 1 before or it is disabled." } } }]);
    expect((await checkConnection({ provider: "youtube", accountRef: "UCyg", token: tok, fetch: f.fetch })).outcome).toBe("platform_pending");
    f = fakeFetch([{ match: /tokeninfo/, json: { scope: RO } }, { match: /channels/, status: 403, json: { error: { errors: [{ reason: "quotaExceeded" }], message: "quota" } } }]);
    expect((await checkConnection({ provider: "youtube", accountRef: "UCyg", token: tok, fetch: f.fetch })).outcome).toBe("error");
  });
});
