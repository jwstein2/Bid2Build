import { describe, expect, it } from "vitest";
import { intuitTid, parseDiscovery, retryDelay, retryableStatus, withRef, withRetry } from "@/lib/quickbooks/net";
import { qbDiscoveryUrl } from "@/lib/quickbooks/config";

const doc = {
  authorization_endpoint: "https://appcenter.intuit.com/connect/oauth2",
  token_endpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revocation_endpoint: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
};
const res = (status: number, headers: Record<string, string> = {}) => new Response("{}", { status, headers });
const noWait = async () => undefined;

describe("Intuit discovery document", () => {
  it("uses the sandbox and production documents", () => {
    expect(qbDiscoveryUrl("sandbox")).toBe("https://developer.api.intuit.com/.well-known/openid_sandbox_configuration");
    expect(qbDiscoveryUrl("production")).toBe("https://developer.api.intuit.com/.well-known/openid_configuration");
  });
  it("reads the three OAuth endpoints", () => {
    expect(parseDiscovery(doc)).toEqual({ authorize: doc.authorization_endpoint, token: doc.token_endpoint, revoke: doc.revocation_endpoint });
  });
  it("rejects missing, non-https or non-Intuit endpoints", () => {
    expect(parseDiscovery(null)).toBeNull();
    expect(parseDiscovery({ ...doc, revocation_endpoint: undefined })).toBeNull();
    expect(parseDiscovery({ ...doc, token_endpoint: "http://oauth.platform.intuit.com/t" })).toBeNull();
    expect(parseDiscovery({ ...doc, token_endpoint: "https://intuit.com.evil.example/t" })).toBeNull();
    expect(parseDiscovery({ ...doc, authorization_endpoint: "not a url" })).toBeNull();
  });
});

describe("retrying temporary failures", () => {
  it("retries only 429 and 5xx", () => {
    expect([429, 500, 503].every(retryableStatus)).toBe(true);
    expect([200, 400, 401, 403, 404].some(retryableStatus)).toBe(false);
  });
  it("backs off and honours Retry-After up to 5 s", () => {
    expect([1, 2, 3].map((a) => retryDelay(a, null))).toEqual([500, 1000, 2000]);
    expect(retryDelay(1, "2")).toBe(2000);
    expect(retryDelay(1, "60")).toBe(5000);
  });
  it("retries a 503 then returns the success", async () => {
    const seq = [res(503), res(200)];
    let calls = 0;
    const r = await withRetry(async () => seq[calls++], 2, noWait);
    expect(r.status).toBe(200);
    expect(calls).toBe(2);
  });
  it("does not retry a 400", async () => {
    let calls = 0;
    const r = await withRetry(async () => { calls++; return res(400); }, 2, noWait);
    expect(r.status).toBe(400);
    expect(calls).toBe(1);
  });
  it("gives up after the retries and returns the last answer", async () => {
    let calls = 0;
    const r = await withRetry(async () => { calls++; return res(500); }, 2, noWait);
    expect(r.status).toBe(500);
    expect(calls).toBe(3);
  });
  it("retries network errors and rethrows the last one", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new TypeError("fetch failed"); }, 1, noWait)).rejects.toThrow("fetch failed");
    expect(calls).toBe(2);
  });
});

describe("intuit_tid support reference", () => {
  it("captures a well-formed intuit_tid header", () => {
    expect(intuitTid(res(400, { intuit_tid: "1-6560c3f1-2b7a" }))).toBe("1-6560c3f1-2b7a");
    expect(intuitTid(res(400))).toBeNull();
    expect(intuitTid(res(400, { intuit_tid: "<script>" }))).toBeNull();
  });
  it("adds the reference to the message", () => {
    expect(withRef("Bad date.", "abc-1")).toBe("Bad date. (QuickBooks reference abc-1)");
    expect(withRef("Bad date.", null)).toBe("Bad date.");
  });
});
