/**
 * Safety net for failed sign-up texts: "I'm new here" creates the account before texting, so a
 * failed text used to leave a phone-only account behind. The cleanup must remove exactly that
 * leftover and never a real account.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ABANDONED_SIGNUP_WINDOW_MS, isAbandonedPhoneSignup, isSendFailure } from "@/lib/auth/phone";

process.env.NEXT_PUBLIC_SMS_SIGNIN = "on";
const NOW = Date.parse("2026-11-15T03:30:00Z");
const fresh = { id: "orphan", phone: "12187900140", email: "", phone_confirmed_at: null, last_sign_in_at: null, created_at: "2026-11-15T03:26:53Z", identities: [{ provider: "phone" }] };

describe("isAbandonedPhoneSignup", () => {
  it("matches a minutes-old, unconfirmed, phone-only account for the same number", () => {
    expect(isAbandonedPhoneSignup(fresh, "+1 (218) 790-0140", NOW)).toBe(true);
    expect(isAbandonedPhoneSignup({ ...fresh, identities: [] }, "+12187900140", NOW)).toBe(true);
  });
  it("never matches a real or used account", () => {
    for (const patch of [
      { email: "jwstein2@gmail.com" }, { phone_confirmed_at: "2026-11-15T03:27:00Z" }, { email_confirmed_at: "2026-11-15T03:27:00Z" },
      { confirmed_at: "2026-11-15T03:27:00Z" }, { last_sign_in_at: "2026-11-15T03:27:00Z" }, { identities: [{ provider: "phone" }, { provider: "email" }] },
      { phone: "15550001111" }, { created_at: "2026-11-12T04:27:08Z" }, { created_at: null }, { created_at: "garbage" },
    ]) expect(isAbandonedPhoneSignup({ ...fresh, ...patch }, "+12187900140", NOW)).toBe(false);
    expect(isAbandonedPhoneSignup(fresh, "", NOW)).toBe(false);
    expect(isAbandonedPhoneSignup(null, "+12187900140", NOW)).toBe(false);
    expect(isAbandonedPhoneSignup(fresh, "+12187900140", Date.parse(fresh.created_at) + ABANDONED_SIGNUP_WINDOW_MS + 1)).toBe(false);
  });
});

describe("isSendFailure", () => {
  it("is true for the Twilio/provider failure Supabase returns", () => {
    expect(isSendFailure({ code: "sms_send_failed", status: 422, message: "Error sending confirmation OTP to provider: Primary compliance profile is not approved." })).toBe(true);
    expect(isSendFailure({ code: "phone_provider_disabled" })).toBe(true);
  });
  it("is false for rate limits, captcha, network trouble and the no-account answer", () => {
    expect(isSendFailure({ status: 429, code: "over_sms_send_rate_limit", message: "sms rate limit" })).toBe(false);
    expect(isSendFailure({ code: "captcha_failed" })).toBe(false);
    expect(isSendFailure({ message: "Failed to fetch" })).toBe(false);
    expect(isSendFailure({ code: "otp_disabled", message: "Signups not allowed for otp" })).toBe(false);
    expect(isSendFailure(null)).toBe(false);
  });
});

// ---- The cleanup route, against a fake admin client ------------------------------------------
const state = { users: [] as Record<string, unknown>[], deleted: [] as string[], audits: 0, pages: 0 };
const admin = {
  auth: { admin: {
    listUsers: vi.fn(async ({ page, perPage }: { page: number; perPage: number }) => { state.pages++; return { data: { users: state.users.slice((page - 1) * perPage, page * perPage) }, error: null }; }),
    deleteUser: vi.fn(async (id: string) => { state.deleted.push(id); return { error: null }; }),
  } },
  from: () => ({ insert: async () => { state.audits++; return { error: null }; } }),
};
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true, rateLimit: async () => true }));

const { POST } = await import("@/app/api/auth/phone-abandon/route");
const call = async (body: unknown) => { const r = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })); return { status: r.status, body: await r.json() }; };

describe("POST /api/auth/phone-abandon", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
    state.users = [{ id: "real", email: "jwstein2@gmail.com", phone: "", created_at: "2026-11-12T04:27:08Z", last_sign_in_at: "2026-11-15T03:26:34Z" }];
    state.deleted = []; state.audits = 0; state.pages = 0;
  });
  it("removes the leftover account and records it", async () => {
    state.users.push(fresh);
    expect(await call({ phone: "+12187900140" })).toEqual({ status: 200, body: { ok: true } });
    expect(state.deleted).toEqual(["orphan"]);
    expect(state.audits).toBe(1);
  });
  it("leaves a confirmed or older account alone and answers the same way", async () => {
    state.users.push({ ...fresh, phone_confirmed_at: "2026-11-15T03:27:00Z" });
    expect(await call({ phone: "+12187900140" })).toEqual({ status: 200, body: { ok: true } });
    state.users[1] = { ...fresh, created_at: "2026-11-14T00:00:00Z" };
    expect((await call({ phone: "+12187900140" })).status).toBe(200);
    expect(state.deleted).toEqual([]);
  });
  it("answers the same when there is no account for the number", async () => {
    expect(await call({ phone: "+15550001111" })).toEqual({ status: 200, body: { ok: true } });
    expect(state.deleted).toEqual([]);
  });
  it("refuses bad input and is off when SMS sign-in is off", async () => {
    expect((await call({ phone: "12" })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    process.env.NEXT_PUBLIC_SMS_SIGNIN = "off";
    try { expect((await call({ phone: "+12187900140" })).status).toBe(404); } finally { process.env.NEXT_PUBLIC_SMS_SIGNIN = "on"; }
    expect(state.deleted).toEqual([]);
  });
});
