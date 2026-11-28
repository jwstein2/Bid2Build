import { describe, expect, it } from "vitest";
import { BUFFER_API, checkConnection } from "../../../growth-os/connectors/health";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

describe("connector: Buffer (social scheduler)", () => {
  registryChecks("buffer");
  it("read-only GraphQL query → ok; refused key → awaiting authorization; unexpected shape → error (never green)", async () => {
    let f = fakeFetch([{ match: new RegExp(BUFFER_API.replace(/\./g, "\\.")), method: "POST", json: { data: { account: { id: "a1", organizations: [] } } } }]);
    expect((await checkConnection({ provider: "buffer", accountRef: "org", secret: "bufkey", fetch: f.fetch })).outcome).toBe("ok");
    expect(JSON.parse(f.calls[0].init!.body!).query).toMatch(/^query /);
    f = fakeFetch([{ match: /buffer/, status: 401, json: {} }]);
    expect((await checkConnection({ provider: "buffer", accountRef: "org", secret: "bufkey", fetch: f.fetch })).outcome).toBe("auth_error");
    f = fakeFetch([{ match: /buffer/, json: { data: {} } }]);
    expect((await checkConnection({ provider: "buffer", accountRef: "org", secret: "bufkey", fetch: f.fetch })).outcome).toBe("error");
  });
});
