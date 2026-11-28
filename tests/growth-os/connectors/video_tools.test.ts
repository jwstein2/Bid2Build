import { describe, expect, it } from "vitest";
import { checkConnection } from "../../../growth-os/connectors/health";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

describe("connector: Authorized video creation tools", () => {
  const c = registryChecks("video_tools");
  it("is unsupported for the worker: OpusClip and Streamlabs are used by Claude sessions and James, not through an API", () => {
    expect(c.baseline).toBe("unsupported");
    expect(c.operations.every((o) => o.baseline === "unsupported")).toBe(true);
    expect(c.authKinds).toEqual(["none"]);
  });
  it("has no health adapter, so it can never be reported as connected", async () => {
    expect((await checkConnection({ provider: "video_tools", accountRef: "opusclip", fetch: fakeFetch([]).fetch })).outcome).toBe("error");
  });
});
