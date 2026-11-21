/** V8.3.1 worker app invites: copy, errors, Practice Mode block, sign-in return to My work (pure). */
import { describe, expect, it } from "vitest";
import { inviteError, mapInviteStatus, workerInviteEmail, workerInviteText } from "@/lib/workforce/hub/invite";
import { isDemoBlocked } from "@/lib/demo/session";
import { appLoginRedirect } from "@/lib/auth/app-next";

describe("worker app invites", () => {
  it("email and text carry the link and say there's nothing to pay", () => {
    const m = workerInviteEmail({ companyName: "Summit Exteriors", workerName: "Jose Martinez", link: "https://built2bid.org/company/join?token=abc", expiresAt: "2026-11-27T12:00:00Z" });
    expect(m.subject).toBe("Summit Exteriors invited you to the Built2Bid worker app");
    expect(m.text).toMatch(/^Hi Jose,/);
    expect(m.text).toContain("https://built2bid.org/company/join?token=abc");
    expect(m.text).toMatch(/My work/);
    expect(m.text).toMatch(/nothing to pay/);
    expect(workerInviteText("Summit", "https://x.test/j")).toContain("https://x.test/j");
  });
  it("maps database errors to plain messages", () => {
    expect(inviteError("no_seats_available")).toMatchObject({ status: 409, code: "no_seats_available" });
    expect(inviteError("already_linked")!.message).toMatch(/already has a login/);
    expect(inviteError("something else")).toBeNull();
  });
  it("status never exposes a token", () => {
    expect(mapInviteStatus({ resourceId: "r", linked: false, company: true, canInvite: true, pending: { id: "i", email: "a@b.c", expiresAt: "2026-11-27", token: "secret" } }).pending).toEqual({ id: "i", email: "a@b.c", expiresAt: "2026-11-27" });
  });
  it("Practice / Demo Mode can't send invites", () => {
    expect(isDemoBlocked("/api/workforce/hub/invite", "POST")).toBe(true);
    expect(isDemoBlocked("/api/workforce/hub/invite", "GET")).toBe(false);
  });
  it("a signed-out visit to My work comes back there after sign-in", () => {
    expect(appLoginRedirect("/clock", "")).toBe("/login?next=%2Fclock");
  });
});
