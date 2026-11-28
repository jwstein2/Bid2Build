import { describe, expect, it } from "vitest";
import { checkConnection, LINKEDIN_VERSION } from "../../../growth-os/connectors/health";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

const tok = { access_token: "AQX", obtained_at: "x" };
const intro = { active: true, status: "active", scope: "r_organization_social,r_organization_admin,r_ads,r_ads_reporting" };
describe("connector: LinkedIn organization page and ads", () => {
  registryChecks("linkedin");
  it("introspects the token for real scopes and confirms admin of org 144185331", async () => {
    const f = fakeFetch([{ match: /introspectToken/, method: "POST", json: intro },
      { match: /organizationAcls/, json: { elements: [{ organization: "urn:li:organization:144185331", role: "ADMINISTRATOR" }] } }]);
    const r = await checkConnection({ provider: "linkedin", accountRef: "144185331", token: tok, clientId: "c", clientSecret: "s", fetch: f.fetch });
    expect(r).toMatchObject({ outcome: "ok", grantedScopes: ["r_organization_social", "r_organization_admin", "r_ads", "r_ads_reporting"] });
    expect(f.calls[1].init?.headers?.["LinkedIn-Version"]).toBe(LINKEDIN_VERSION);
  });
  it("never touches the Bolt Global organization", async () => {
    const f = fakeFetch([]);
    expect((await checkConnection({ provider: "linkedin", accountRef: "107777198", token: tok, fetch: f.fetch })).errorCode).toBe("blocked_org");
    expect(f.calls).toHaveLength(0);
  });
  it("product not approved (403) → awaiting platform approval; revoked token → awaiting authorization; not an admin → limited", async () => {
    let f = fakeFetch([{ match: /introspectToken/, json: intro }, { match: /organizationAcls/, status: 403, json: {} }]);
    expect((await checkConnection({ provider: "linkedin", accountRef: "144185331", token: tok, fetch: f.fetch })).outcome).toBe("platform_pending");
    f = fakeFetch([{ match: /introspectToken/, json: { active: false, status: "revoked" } }]);
    expect((await checkConnection({ provider: "linkedin", accountRef: "144185331", token: tok, fetch: f.fetch })).outcome).toBe("auth_error");
    f = fakeFetch([{ match: /introspectToken/, json: intro }, { match: /organizationAcls/, json: { elements: [] } }]);
    expect((await checkConnection({ provider: "linkedin", accountRef: "144185331", token: tok, fetch: f.fetch })).outcome).toBe("limited");
  });
});
