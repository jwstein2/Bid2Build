import { describe, expect, it } from "vitest";
import { checkConnection } from "../../../growth-os/connectors/health";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

describe("connector: Facebook Page and ads", () => {
  registryChecks("facebook_pages");
  const token = { access_token: "EAAGpage", obtained_at: "2026-11-28T00:00:00Z" };
  const perms = { data: ["pages_show_list", "pages_read_engagement", "read_insights", "ads_read"].map((p) => ({ permission: p, status: "granted" })) };

  it("verifies the token can see the Built2Bid Page", async () => {
    const f = fakeFetch([{ match: /permissions/, json: perms }, { match: /me\/accounts/, json: { data: [{ id: "61596515102500", name: "Built2Bid" }] } }]);
    expect(await checkConnection({ provider: "facebook_pages", accountRef: "61596515102500", token, fetch: f.fetch }))
      .toMatchObject({ outcome: "ok", accountLabel: "Built2Bid" });
  });
  it("Page not ticked on Facebook's screen → limited with the fix", async () => {
    const f = fakeFetch([{ match: /permissions/, json: perms }, { match: /me\/accounts/, json: { data: [{ id: "999", name: "Other" }] } }]);
    const r = await checkConnection({ provider: "facebook_pages", accountRef: "61596515102500", token, fetch: f.fetch });
    expect(r).toMatchObject({ outcome: "limited", errorCode: "page_not_granted" });
    expect(r.message).toMatch(/Reconnect and tick that Page/);
  });
  it("no token stored → awaiting authorization without any call", async () => {
    const f = fakeFetch([]);
    expect((await checkConnection({ provider: "facebook_pages", accountRef: "1", fetch: f.fetch })).outcome).toBe("auth_error");
    expect(f.calls).toHaveLength(0);
  });
});
