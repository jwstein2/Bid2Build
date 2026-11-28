import { describe, expect, it } from "vitest";
import { checkConnection } from "../../../growth-os/connectors/health";
import { fakeFetch } from "./fake-fetch";
import { registryChecks } from "./common";

describe("connector: Stripe revenue data", () => {
  const c = registryChecks("stripe");
  it("writes are unsupported by design", () => expect(c.operations.find((o) => o.key === "billing.write")?.baseline).toBe("unsupported"));
  it("probes five read endpoints with GET only; all allowed → ok", async () => {
    const f = fakeFetch([{ match: /api\.stripe\.com/, json: { data: [] } }]);
    const r = await checkConnection({ provider: "stripe", accountRef: "b2b", secret: "rk_live_abc123456789", fetch: f.fetch });
    expect(r).toMatchObject({ outcome: "ok", accountLabel: "live mode" });
    expect(f.calls).toHaveLength(5);
    expect(f.calls.every((x) => x.init?.method === "GET" && !x.url.includes("rk_live"))).toBe(true);
  });
  it("missing read permission → limited with the exact fix; invalid key → awaiting authorization; full secret key → refused, no call", async () => {
    let f = fakeFetch([{ match: /invoices/, status: 403, json: {} }, { match: /stripe/, json: {} }]);
    const r = await checkConnection({ provider: "stripe", accountRef: "b2b", secret: "rk_test_x123456789", fetch: f.fetch });
    expect(r.outcome).toBe("limited");
    expect(r.message).toBe("Give the restricted key Read on: invoices.");
    f = fakeFetch([{ match: /stripe/, status: 401, json: {} }]);
    expect((await checkConnection({ provider: "stripe", accountRef: "b2b", secret: "rk_test_x123456789", fetch: f.fetch })).outcome).toBe("auth_error");
    f = fakeFetch([]);
    expect((await checkConnection({ provider: "stripe", accountRef: "b2b", secret: "sk_live_full", fetch: f.fetch })).errorCode).toBe("not_restricted_key");
    expect(f.calls).toHaveLength(0);
  });
});
