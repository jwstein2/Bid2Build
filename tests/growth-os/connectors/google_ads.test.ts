import { describe, expect, it } from "vitest";
import { checkConnection, GOOGLE_ADS_API_VERSION } from "../../../growth-os/connectors/health";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

const ADS = "https://www.googleapis.com/auth/adwords";
const tok = { access_token: "ya29.a", obtained_at: "x" };
describe("connector: Google Ads", () => {
  const c = registryChecks("google_ads");
  it("starts as awaiting platform approval; ad changes are privileged, phase 9", () => {
    expect(c.baseline).toBe("awaiting_platform_approval");
    expect(c.operations.find((o) => o.key === "campaigns.manage")).toMatchObject({ privileged: true, phase: 9 });
  });
  it("lists accessible customers (read-only) and checks the Built2Bid account is among them", async () => {
    const f = fakeFetch([{ match: /tokeninfo/, json: { scope: ADS } }, { match: /listAccessibleCustomers/, json: { resourceNames: ["customers/1234567890"] } }]);
    expect((await checkConnection({ provider: "google_ads", accountRef: "123-456-7890", token: tok, developerToken: "dt", fetch: f.fetch })).outcome).toBe("ok");
    expect(f.calls[1].url).toContain(`/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`);
    expect(f.calls[1].init?.method).toBe("GET");
    expect(f.calls[1].init?.headers?.["developer-token"]).toBe("dt");
  });
  it("Test-level access → limited; no access level → awaiting platform approval; login without account access → limited", async () => {
    const cases: [unknown, string][] = [
      [{ error: { details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" } }] }] } }, "limited"],
      [{ error: { message: "The developer token is not allowed with this access level" } }, "platform_pending"],
      [{ error: { details: [{ errors: [{ errorCode: { authenticationError: "NOT_ADS_USER" } }] }] } }, "limited"],
    ];
    for (const [json, outcome] of cases) {
      const f = fakeFetch([{ match: /tokeninfo/, json: { scope: ADS } }, { match: /listAccessibleCustomers/, status: 403, json }]);
      expect((await checkConnection({ provider: "google_ads", accountRef: "1234567890", token: tok, fetch: f.fetch })).outcome).toBe(outcome);
    }
  });
});
