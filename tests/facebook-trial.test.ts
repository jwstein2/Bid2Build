import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { isBidComment, extractEmail, isOptOut, isSendIntent, maskEmail, formatExpiry } from "@/lib/trial/text";
import { makeInviteToken, readInviteToken, unsubscribeSig, checkUnsubscribeSig } from "@/lib/trial/token";
import { verifyMetaSignature } from "@/lib/trial/meta";
import { trialConfig, metaReady } from "@/lib/trial/config";
import { inviteEmail, day6Email } from "@/lib/trial/emails";
import { reminderAllowed } from "@/lib/trial/flow";
import { analyticsAllowedOn } from "@/lib/seo/analytics";

const ENV = { SUPABASE_SERVICE_ROLE_KEY: "svc" };
const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("comment matching and Messenger text", () => {
  it("matches only the word BID", () => {
    for (const t of ["BID", "bid", " Bid! ", "BID 👍", "bid.", "#BID"]) expect(isBidComment(t)).toBe(true);
    for (const t of ["", null, "bidding", "bid please", "I want to bid on this", "B I D", "rebid"]) expect(isBidComment(t)).toBe(false);
  });
  it("pulls a clean email out of a message", () => {
    expect(extractEmail("sure it's Jane.Doe+b2b@Example.co.uk.")).toBe("jane.doe+b2b@example.co.uk");
    expect(extractEmail("no email here")).toBeNull();
    expect(extractEmail("a".repeat(2001) + " x@y.com")).toBeNull();
  });
  it("knows STOP and send intents", () => {
    expect(isOptOut("STOP")).toBe(true);
    expect(isOptOut("please stop the madness")).toBe(false);
    expect(isSendIntent("Send my invite")).toBe(true);
    expect(isSendIntent("INVITE")).toBe(true);
    expect(isSendIntent("how much is it?")).toBe(false);
  });
  it("masks emails and formats an exact expiry with time zone", () => {
    expect(maskEmail("jane@example.com")).toBe("j***@example.com");
    expect(formatExpiry("2026-11-23T18:30:00Z")).toBe("Monday, November 23, 2026 at 12:30 PM CST");
  });
});

describe("invite tokens", () => {
  it("round-trips and rejects tampering, other versions and other secrets", () => {
    const t = makeInviteToken(ID, 3, ENV);
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}\.3\.[A-Za-z0-9_-]{43}$/);
    expect(t).not.toContain(ID);
    expect(readInviteToken(t, ENV)).toEqual({ id: ID, version: 3 });
    expect(readInviteToken(t.replace(".3.", ".4."), ENV)).toBeNull();
    expect(readInviteToken(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"), ENV)).toBeNull();
    expect(readInviteToken(t, { SUPABASE_SERVICE_ROLE_KEY: "other" })).toBeNull();
    expect(readInviteToken(t, { TRIAL_INVITE_SECRET: "x".repeat(40) })).toBeNull();
    for (const bad of [null, 42, "", "a.b.c", "x".repeat(500)]) expect(readInviteToken(bad, ENV)).toBeNull();
  });
  it("signs unsubscribe links", () => {
    const s = unsubscribeSig(ID, ENV);
    expect(checkUnsubscribeSig(ID, s, ENV)).toBe(true);
    expect(checkUnsubscribeSig(ID, s.slice(1), ENV)).toBe(false);
    expect(checkUnsubscribeSig("not-a-uuid", s, ENV)).toBe(false);
  });
});

describe("Meta webhook signature", () => {
  const body = '{"object":"page","entry":[]}';
  const sig = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
  it("accepts the exact raw body only", () => {
    expect(verifyMetaSignature(body, sig, "app-secret")).toBe(true);
    expect(verifyMetaSignature(body + " ", sig, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, sig, "other")).toBe(false);
    expect(verifyMetaSignature(body, null, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, sig, "")).toBe(false);
  });
});

describe("webhook route", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it("answers Meta's subscription check only with the right verify token", async () => {
    process.env.META_VERIFY_TOKEN = "verify-me";
    const { GET } = await import("@/app/api/webhooks/meta/route");
    const ok = await GET(new Request("https://built2bid.org/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    expect((await GET(new Request("https://built2bid.org/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"))).status).toBe(403);
  });
  it("refuses unsigned or badly signed deliveries before parsing", async () => {
    Object.assign(process.env, { META_APP_SECRET: "app-secret", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk", NEXT_PUBLIC_SUPABASE_ANON_KEY: "pk" });
    const { POST } = await import("@/app/api/webhooks/meta/route");
    const r = await POST(new Request("https://built2bid.org/api/webhooks/meta", { method: "POST", body: "{}", headers: { "x-hub-signature-256": "sha256=" + "0".repeat(64) } }));
    expect([401, 503]).toContain(r.status);
  });
});

describe("settings", () => {
  it("is off and not ready by default; post ids are validated", () => {
    expect(trialConfig({}).enabled).toBe(false);
    expect(metaReady(trialConfig({}))).toBe(false);
    const c = trialConfig({ META_TEST_POST_IDS: "1_2, bad, 3_4", META_GRAPH_VERSION: "latest" });
    expect(c.testPostIds).toEqual(["1_2", "3_4"]);
    expect(c.graphVersion).toBe("v26.0");
  });
  it("keeps invite and unsubscribe pages out of analytics", () => {
    expect(analyticsAllowedOn("/trial/activate")).toBe(false);
    expect(analyticsAllowedOn("/trial/unsubscribe")).toBe(false);
    expect(analyticsAllowedOn("/trial")).toBe(true);
  });
});

describe("emails and reminders", () => {
  it("invite email: fragment link, no card, no charge, no tracking", () => {
    const m = inviteEmail({ activateUrl: "https://built2bid.org/trial/activate#t=abc", inviteExpiresAt: "2026-11-30T12:00:00Z" });
    expect(m.html).toContain('href="https://built2bid.org/trial/activate#t=abc"');
    expect(m.text).toMatch(/No card is needed and nothing is charged automatically/);
    expect(m.html).not.toMatch(/<img|<script|utm_/i);
  });
  it("day-6 email names the exact expiry and keeps the upgrade optional", () => {
    const m = day6Email({ expiresAt: "2026-11-23T18:30:00Z", billingUrl: "https://built2bid.org/pricing", unsubscribeUrl: "https://built2bid.org/trial/unsubscribe?i=1&s=2" });
    expect(m.text).toContain("Monday, November 23, 2026 at 12:30 PM CST");
    expect(m.text).toMatch(/completely optional/);
    expect(m.text).toContain("Stop check-ins:");
  });
  it("reminder only once, after 4h, while the 24h window is open", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    const base = { state: "awaiting_email" as const, reminder_sent_at: null, reminder_due_at: "2026-11-16T11:00:00Z", last_inbound_at: "2026-11-16T07:00:00Z" };
    expect(reminderAllowed(base, now)).toBe("send");
    expect(reminderAllowed({ ...base, reminder_due_at: "2026-11-16T13:00:00Z" }, now)).toBe("wait");
    expect(reminderAllowed({ ...base, last_inbound_at: "2026-11-15T11:00:00Z" }, now)).toBe("expired");
    expect(reminderAllowed({ ...base, reminder_sent_at: "2026-11-16T11:30:00Z" }, now)).toBe("no");
    expect(reminderAllowed({ ...base, state: "invited" }, now)).toBe("no");
  });
});
