import { describe, expect, it, vi } from "vitest";
import { buildMetaPayload, deliverMetaConversions, META_EVENT_FOR, metaConfig, queueMetaConversion, sha256 } from "@/lib/growth/conversions";
import { parseAdConsent, pixelId, readConsentCookie } from "@/lib/growth/consent";

const ON = { META_CAPI_ENABLED: "true", META_PIXEL_ID: "1234567890", META_CAPI_TOKEN: "x".repeat(40) };

describe("Meta config", () => {
  it("is off unless enabled with a pixel id and token", () => {
    expect(metaConfig({}).enabled).toBe(false);
    expect(metaConfig({ ...ON, META_CAPI_ENABLED: "false" }).enabled).toBe(false);
    expect(metaConfig({ ...ON, META_PIXEL_ID: "abc" }).enabled).toBe(false);
    expect(metaConfig(ON)).toMatchObject({ enabled: true, version: "v25.0", testCode: null });
  });
  it("only maps real milestones", () => {
    expect(Object.keys(META_EVENT_FOR).sort()).toEqual(["account_created", "bid_activated", "subscribed"]);
  });
});

describe("Meta payload", () => {
  const base = { eventId: "account_created:u1", at: new Date("2026-11-16T00:00:00Z"), userId: "u1", url: "https://built2bid.org/dashboard" };
  it("hashes the normalized email and account id and sends nothing else personal", () => {
    const p = buildMetaPayload({ ...base, event: "CompleteRegistration", email: "  Pat@Example.COM " });
    expect(p.user_data.em).toEqual([sha256("pat@example.com")]);
    expect(p.user_data.external_id).toEqual([sha256("u1")]);
    expect(JSON.stringify(p)).not.toMatch(/pat@example|Pat/i);
    expect(p).toMatchObject({ event_name: "CompleteRegistration", event_id: "account_created:u1", action_source: "website", event_time: 1794787200 });
    expect(p.custom_data).toBeUndefined();
  });
  it("adds plan value only to Subscribe, and drops malformed browser ids", () => {
    const p = buildMetaPayload({ ...base, event: "Subscribe", email: null, value: 19.99, fbp: "fb.1.1700000000000.123", fbc: "<script>" });
    expect(p.custom_data).toEqual({ currency: "USD", value: 19.99 });
    expect(p.user_data.fbp).toBe("fb.1.1700000000000.123");
    expect(p.user_data.fbc).toBeUndefined();
    expect(p.user_data.em).toBeUndefined();
  });
});

describe("consent helpers", () => {
  it("parses stored consent and cookies strictly", () => {
    expect(parseAdConsent({ granted: true, at: "2026-11-16" })).toMatchObject({ granted: true });
    expect(parseAdConsent({ granted: "yes", at: "x" })).toBeNull();
    expect(readConsentCookie("a=1; b2b_ad_consent=denied")).toBe("denied");
    expect(readConsentCookie("a=1")).toBeNull();
    expect(pixelId("12345678")).toBe("12345678");
    expect(pixelId("<x>")).toBeNull();
  });
});

function fakeAdmin(opts: { consent?: unknown; rows?: unknown[] } = {}) {
  const upserts: unknown[] = []; const updates: unknown[] = [];
  const chain = { select: () => chain, eq: () => chain, in: () => chain, lt: () => chain, order: () => chain, limit: async () => ({ data: opts.rows ?? [] }) };
  return {
    upserts, updates,
    auth: { admin: { getUserById: async () => ({ data: { user: { id: "u1", email: "a@b.co", user_metadata: { b2b_ad_consent: opts.consent } } } }) } },
    from: () => ({ upsert: async (r: unknown) => { upserts.push(r); return { error: null }; }, update: (r: unknown) => ({ eq: async () => { updates.push(r); return {}; } }), ...chain }),
  } as never as Parameters<typeof queueMetaConversion>[0] & { upserts: unknown[]; updates: unknown[] };
}

describe("queue and delivery", () => {
  it("queues nothing while Meta is off or without consent", async () => {
    const a = fakeAdmin({ consent: { granted: true, at: "x" } });
    expect(await queueMetaConversion(a, { userId: "u1", event: "account_created", eventId: "e1" }, metaConfig({}))).toBe("skipped");
    const b = fakeAdmin({ consent: { granted: false, at: "x" } });
    expect(await queueMetaConversion(b, { userId: "u1", event: "account_created", eventId: "e1" }, metaConfig(ON))).toBe("skipped");
    const c = fakeAdmin({});
    expect(await queueMetaConversion(c, { userId: "u1", event: "account_created", eventId: "e1" }, metaConfig(ON))).toBe("skipped");
    expect(await queueMetaConversion(fakeAdmin({ consent: { granted: true, at: "x" } }), { userId: "u1", event: "export_succeeded", eventId: "e1" }, metaConfig(ON))).toBe("skipped");
    expect(a.upserts.length + b.upserts.length + c.upserts.length).toBe(0);
  });
  it("queues once-keyed rows with consent", async () => {
    const a = fakeAdmin({ consent: { granted: true, at: "x", fbp: "fb.1.1.2" } });
    expect(await queueMetaConversion(a, { userId: "u1", event: "subscribed", eventId: "subscribed:sub_1", value: 149 }, metaConfig(ON))).toBe("queued");
    expect(a.upserts[0]).toMatchObject({ platform: "meta", event_id: "subscribed:sub_1", event_name: "Subscribe" });
  });
  it("delivers with the token server-side, records failures without leaking the token", async () => {
    const payload = buildMetaPayload({ event: "CompleteRegistration", eventId: "e1", at: new Date(), userId: "u1", email: null, url: "https://x" });
    const a = fakeAdmin({ rows: [{ id: 1, event_id: "e1", payload, attempts: 0 }] });
    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await deliverMetaConversions(a, { fetchImpl: ok as never, cfg: metaConfig(ON) })).toEqual({ sent: 1, failed: 0 });
    expect(String((ok.mock.calls[0] as unknown[])[0])).toContain("graph.facebook.com/v25.0/1234567890/events");
    const b = fakeAdmin({ rows: [{ id: 1, event_id: "e1", payload, attempts: 0 }] });
    const bad = vi.fn(async () => new Response(`bad token ${"x".repeat(40)}`, { status: 400 }));
    expect(await deliverMetaConversions(b, { fetchImpl: bad as never, cfg: metaConfig(ON) })).toEqual({ sent: 0, failed: 1 });
    expect(JSON.stringify(b.updates)).not.toContain("x".repeat(40));
    expect(await deliverMetaConversions(b, { cfg: metaConfig({}) })).toMatchObject({ disabled: true });
  });
});
