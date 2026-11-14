import { describe, expect, it, vi } from "vitest";
import { GrantInput, SeatsInput, claimMessage, compErrorMessage, daysLeft, INCLUDED_SEATS } from "@/lib/comp/grants";

vi.mock("@/lib/site", () => ({ site: { url: "https://built2bid.org" } }));
const { hashInviteToken, inviteUrl, newInviteToken, sendCompInvitation } = await import("@/lib/comp/server");

describe("complimentary access input rules", () => {
  const base = { email: "  Pat@Example.COM ", plan: "unlimited", days: 30 };
  it("normalizes email and accepts presets or custom days", () => {
    const v = GrantInput.parse(base);
    expect(v).toMatchObject({ email: "pat@example.com", plan: "unlimited", days: 30, extraSeats: 0, sendInvite: true });
    expect(GrantInput.safeParse({ ...base, days: 45 }).success).toBe(true);
    expect(GrantInput.safeParse({ ...base, days: 0 }).success).toBe(false);
    expect(GrantInput.safeParse({ ...base, days: 366 }).success).toBe(false);
    expect(GrantInput.safeParse({ ...base, days: 2.5 }).success).toBe(false);
    expect(GrantInput.safeParse({ ...base, email: "nope" }).success).toBe(false);
  });
  it("extra seats: Enterprise only, and only with explicit owner authorization", () => {
    expect(GrantInput.safeParse({ ...base, extraSeats: 2, approveExtraSeats: true }).success).toBe(false);
    expect(GrantInput.safeParse({ ...base, plan: "enterprise", extraSeats: 2 }).success).toBe(false);
    expect(GrantInput.safeParse({ ...base, plan: "enterprise", extraSeats: 2, approveExtraSeats: true }).success).toBe(true);
    expect(GrantInput.safeParse({ ...base, plan: "enterprise", extraSeats: 51, approveExtraSeats: true }).success).toBe(false);
    expect(SeatsInput.safeParse({ id: "00000000-0000-4000-8000-000000000001", extraSeats: 3 }).success).toBe(false);
    expect(INCLUDED_SEATS.enterprise).toBe(3);
  });
  it("maps database errors and claim failures to plain messages", () => {
    expect(compErrorMessage("grant_exists")).toMatch(/Extend that one/);
    expect(compErrorMessage("forbidden")).toMatch(/platform admins/);
    expect(compErrorMessage("something internal")).toBe("Something went wrong. Nothing was changed.");
    expect(claimMessage("email_mismatch", "p***@example.com")).toContain("p***@example.com");
    expect(claimMessage("invite_expired")).toMatch(/expired/);
    expect(claimMessage(undefined)).toMatch(/isn't valid/);
  });
  it("days left rounds up and never goes negative", () => {
    const now = Date.parse("2026-11-14T00:00:00Z");
    expect(daysLeft("2026-11-15T12:00:00Z", now)).toBe(2);
    expect(daysLeft("2026-11-01T00:00:00Z", now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
  });
});

describe("invitation tokens", () => {
  it("are random, URL-safe, and only the SHA-256 hash is meant for storage", () => {
    const a = newInviteToken(), b = newInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(a.token)).toBe(a.hash);
    expect(inviteUrl(a.token)).toBe(`https://built2bid.org/complimentary?token=${a.token}`);
  });
  it("sends through Supabase's invite email with a same-site return link", async () => {
    const inviteUserByEmail = vi.fn(async () => ({ error: null }));
    const db = { auth: { admin: { inviteUserByEmail } } } as never;
    expect(await sendCompInvitation(db, "pat@example.com", "tok123")).toEqual({ sent: true });
    const [email, opts] = inviteUserByEmail.mock.calls[0] as unknown as [string, { redirectTo: string }];
    expect(email).toBe("pat@example.com");
    const u = new URL(opts.redirectTo);
    expect(u.origin + u.pathname).toBe("https://built2bid.org/auth/callback");
    expect(u.searchParams.get("next")).toBe("/complimentary?token=tok123");
  });
  it("reports why an invitation was not sent", async () => {
    const mk = (message: string) => ({ auth: { admin: { inviteUserByEmail: async () => ({ error: { message } }) } } }) as never;
    expect(await sendCompInvitation(mk("A user with this email address has already been registered"), "a@b.co", "t")).toEqual({ sent: false, reason: "account_exists" });
    expect(await sendCompInvitation(mk("Email rate limit exceeded"), "a@b.co", "t")).toEqual({ sent: false, reason: "email_rate_limited" });
    expect(await sendCompInvitation(mk("boom"), "a@b.co", "t")).toEqual({ sent: false, reason: "send_failed" });
  });
});
