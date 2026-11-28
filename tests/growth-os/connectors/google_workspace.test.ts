import { describe, expect, it } from "vitest";
import { checkConnection } from "../../../growth-os/connectors/health";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

describe("connector: Google Workspace (Drive and Sheets)", () => {
  const c = registryChecks("google_workspace");
  it("offers drive.file only for phase 5 and never offers Gmail", () => {
    expect(c.operations.find((o) => o.key === "drive.export")?.scopes).toEqual(["https://www.googleapis.com/auth/drive.file"]);
    expect(c.operations.find((o) => o.key === "gmail")?.baseline).toBe("unsupported");
  });
  it("health: Drive about → ok; 401 → awaiting authorization", async () => {
    const tok = { access_token: "ya29", obtained_at: "x" };
    let f = fakeFetch([{ match: /tokeninfo/, json: { scope: "https://www.googleapis.com/auth/drive.file" } }, { match: /drive\/v3\/about/, json: { user: { displayName: "Built2Bid" } } }]);
    expect(await checkConnection({ provider: "google_workspace", accountRef: "built2bid", token: tok, fetch: f.fetch })).toMatchObject({ outcome: "ok", accountLabel: "Built2Bid" });
    f = fakeFetch([{ match: /tokeninfo/, json: { scope: "x" } }, { match: /drive/, status: 401, json: {} }]);
    expect((await checkConnection({ provider: "google_workspace", accountRef: "b", token: tok, fetch: f.fetch })).outcome).toBe("auth_error");
  });
});
