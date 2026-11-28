import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkConnection } from "../../../growth-os/connectors/health";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const sa = JSON.stringify({ client_email: "growth-os-reader@b2b.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
describe("connector: GA4, Search Console and Tag Manager", () => {
  const c = registryChecks("ga4_gtm");
  it("Tag Manager is unsupported (no container: the site loads gtag.js directly)", () => {
    expect(c.operations.find((o) => o.key === "gtm.read")?.baseline).toBe("unsupported");
  });
  it("signs a JWT with the service account and proves GA4 + Search Console access with read-only calls", async () => {
    const f = fakeFetch([{ match: /oauth2\.googleapis\.com\/token/, json: { access_token: "ya29.sa" } },
      { match: /properties\/123456789:runReport/, json: { rows: [] } }, { match: /webmasters\/v3\/sites/, json: { siteEntry: [{ siteUrl: "sc-domain:built2bid.org" }] } }]);
    const r = await checkConnection({ provider: "ga4_gtm", accountRef: "123456789", secret: sa, fetch: f.fetch });
    expect(r).toMatchObject({ outcome: "ok", grantedScopes: ["https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/webmasters.readonly"] });
    const assertion = new URLSearchParams(f.calls[0].init!.body!).get("assertion")!;
    const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString());
    expect(claims.scope).toBe("https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly");
  });
  it("service account not added as Viewer → message names the email to add; partial access → limited", async () => {
    const f = fakeFetch([{ match: /token/, json: { access_token: "ya29.sa" } }, { match: /runReport/, status: 403, json: {} }, { match: /sites/, json: { siteEntry: [{}] } }]);
    const r = await checkConnection({ provider: "ga4_gtm", accountRef: "123456789", secret: sa, fetch: f.fetch });
    expect(r.outcome).toBe("limited");
    expect(r.message).toContain("growth-os-reader@b2b.iam.gserviceaccount.com as Viewer");
  });
  it("rejects a secret that is not a service account key, and a non-numeric property id", async () => {
    expect((await checkConnection({ provider: "ga4_gtm", accountRef: "1", secret: "{}", fetch: fakeFetch([]).fetch })).errorCode).toBe("bad_service_account");
    const f = fakeFetch([{ match: /token/, json: { access_token: "t" } }]);
    expect((await checkConnection({ provider: "ga4_gtm", accountRef: "G-2KJ9K3FX07", secret: sa, fetch: f.fetch })).errorCode).toBe("bad_property_id");
  });
});
