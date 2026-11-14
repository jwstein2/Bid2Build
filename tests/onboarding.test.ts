import { describe, expect, it } from "vitest";
import { decide, hasSessionCookie, isBusySearch, isEligiblePath, looksReturning, needsServer, parseLocal } from "@/lib/onboarding/state";
import { TOUR_STEPS } from "@/components/onboarding/steps";

const now = "2026-11-14T00:00:00.000Z";

describe("onboarding eligibility", () => {
  it("opens only on landing pages and the dashboard", () => {
    for (const p of ["/", "/dashboard", "/bids", "/bids/roofing", "/learn", "/learn/x", "/pricing", "/dashboard/"]) expect(isEligiblePath(p)).toBe(true);
    for (const p of ["/builder", "/start/roofing", "/login", "/auth/finish", "/settings/billing", "/admin", "/estimates/1", "/dashboard/items"]) expect(isEligiblePath(p)).toBe(false);
  });
  it("stays out of sign-in and checkout returns", () => {
    expect(isBusySearch("?resume=monthly")).toBe(true);
    expect(isBusySearch("?checkout=success")).toBe(true);
    expect(isBusySearch("?code=abc")).toBe(true);
    expect(isBusySearch("?utm_source=x")).toBe(false);
    expect(isBusySearch("")).toBe(false);
  });
  it("detects a Supabase session cookie, chunked or not", () => {
    expect(hasSessionCookie("a=1; sb-asiiq-auth-token=base64")).toBe(true);
    expect(hasSessionCookie("sb-asiiq-auth-token.0=x")).toBe(true);
    expect(hasSessionCookie("b2b_attr=1; sb-asiiq-auth-token-code-verifier=x")).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
  });
  it("treats a browser that already used the app as returning", () => {
    expect(looksReturning(["byb:drafts"])).toBe(true);
    expect(looksReturning(["b2b:step:abc"])).toBe(true);
    expect(looksReturning(["b2b.checkoutIntent"])).toBe(true);
    expect(looksReturning(["b2b.smsCooldown", "other"])).toBe(false);
  });
  it("parses only valid local state", () => {
    expect(parseLocal(null)).toBeNull();
    expect(parseLocal("{bad")).toBeNull();
    expect(parseLocal(JSON.stringify({ status: "nope" }))).toBeNull();
    expect(parseLocal(JSON.stringify({ status: "dismissed", at: now }))).toEqual({ status: "dismissed", at: now, synced: false });
  });
});

describe("decide", () => {
  const anon = { signedIn: false } as const;
  it("shows to a brand-new anonymous visitor", () => {
    expect(decide({ local: null, returning: false, server: null, now }).show).toBe(true);
    expect(decide({ local: null, returning: false, server: anon, now }).show).toBe(true);
  });
  it("never shows again after dismiss or complete in this browser", () => {
    for (const status of ["dismissed", "completed", "existing"] as const) expect(decide({ local: { status, at: now }, returning: false, server: null, now }).show).toBe(false);
  });
  it("marks a returning browser as existing instead of showing", () => {
    const d = decide({ local: null, returning: true, server: null, now });
    expect(d).toMatchObject({ show: false, writeLocal: { status: "existing" } });
  });
  it("never shows to existing accounts (grandfathered by the migration)", () => {
    const d = decide({ local: null, returning: false, server: { signedIn: true, status: "existing", known: true }, now });
    expect(d).toMatchObject({ show: false, writeLocal: { status: "existing", synced: true } });
  });
  it("never shows when the account status can't be read (migration not applied)", () => {
    expect(decide({ local: null, returning: false, server: { signedIn: true, status: null, known: false }, now }).show).toBe(false);
  });
  it("shows to a new account with no choice made yet", () => {
    expect(decide({ local: null, returning: true, server: { signedIn: true, status: null, known: true }, now }).show).toBe(true);
    expect(decide({ local: { status: "existing", at: now }, returning: true, server: { signedIn: true, status: null, known: true }, now }).show).toBe(true);
  });
  it("copies a choice made before sign-up to the new account", () => {
    const d = decide({ local: { status: "dismissed", at: now }, returning: false, server: { signedIn: true, status: null, known: true }, now });
    expect(d).toMatchObject({ show: false, pushToServer: "dismissed", writeLocal: { status: "dismissed", synced: true } });
  });
  it("account choice wins over this browser", () => {
    const d = decide({ local: null, returning: false, server: { signedIn: true, status: "completed", known: true }, now });
    expect(d).toMatchObject({ show: false, writeLocal: { status: "completed" } });
  });
  it("asks the server only with a session and unsynced local state", () => {
    expect(needsServer(null, false)).toBe(false);
    expect(needsServer(null, true)).toBe(true);
    expect(needsServer({ status: "dismissed", at: now, synced: false }, true)).toBe(true);
    expect(needsServer({ status: "dismissed", at: now, synced: true }, true)).toBe(false);
  });
});

describe("tour steps", () => {
  it("has the seven steps in the approved order", () => {
    expect(TOUR_STEPS.map((s) => s.title)).toEqual([
      "Welcome to Built2Bid!", "What Are You Bidding Today?", "Your Company, Your Brand", "Who Are You Bidding For?",
      "Build Your Estimate in Minutes", "Make Every Bid Professional", "You're Ready to Bid!",
    ]);
    expect(TOUR_STEPS[0].media.kind).toBe("video");
    expect(TOUR_STEPS[6].note).toBe("You're ready to create your first professional estimate with Built2Bid. Let's get bidding!");
  });
});
