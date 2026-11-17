import { describe, expect, it, vi } from "vitest";
import { addBusinessDays, centralParts, followUpDue, inBusinessHours, nextBusinessTime, responseDeadline } from "@/lib/creator/outreach/schedule";
import { classifyReply, newText, stageForReply } from "@/lib/creator/outreach/classify";
import { DEFAULT_FOLLOW_UP_BODY, renderFollowUp, sendingBlockers, unresolvedPlaceholders, type OutreachSettings } from "@/lib/creator/outreach/templates";
import { unsubscribeToken, verifyUnsubscribeToken } from "@/lib/creator/outreach/unsubscribe";
import { csvCell, toCsv } from "@/lib/creator/outreach/csv";
import { firstNameOf, parseDrafts, parseSeed } from "@/lib/creator/outreach/import";
import { runCreatorOutreach } from "@/lib/creator/outreach/runner";
import { recordReply } from "@/lib/creator/outreach/replies";
import { MemoryDb } from "./fakes/supabase-memory";

vi.mock("@/lib/http/api", () => ({ logError: () => {} }));

const iso = (s: string) => new Date(s);

describe("outreach schedule (America/Chicago)", () => {
  it("follow-up is due 72 hours after the initial email", () => {
    expect(followUpDue(iso("2026-11-16T15:00:00Z")).toISOString()).toBe("2026-11-19T15:00:00.000Z");
  });
  it("deadline is the first Friday 5 PM CT at least 48h after the follow-up", () => {
    // Follow-up Monday 9am CST -> Friday same week 5pm CST (23:00Z)
    expect(responseDeadline(iso("2026-11-16T15:00:00Z")).toISOString()).toBe("2026-11-20T23:00:00.000Z");
    // Follow-up Thursday -> only ~32h to Friday, so the following Friday
    expect(responseDeadline(iso("2026-11-19T15:00:00Z")).toISOString()).toBe("2026-11-27T23:00:00.000Z");
    // Exactly 48h before Friday 5pm counts
    expect(responseDeadline(iso("2026-11-18T23:00:00Z")).toISOString()).toBe("2026-11-20T23:00:00.000Z");
    // Friday afternoon follow-up -> next Friday
    expect(responseDeadline(iso("2026-11-20T20:00:00Z")).toISOString()).toBe("2026-11-27T23:00:00.000Z");
  });
  it("handles daylight saving time (CDT = UTC-5)", () => {
    expect(responseDeadline(iso("2026-06-01T14:00:00Z")).toISOString()).toBe("2026-06-05T22:00:00.000Z");
    // Across the November DST change (Nov 1 2026)
    expect(responseDeadline(iso("2026-10-28T15:00:00Z")).toISOString()).toBe("2026-10-30T22:00:00.000Z");
    expect(centralParts(iso("2026-11-06T23:00:00Z"))).toMatchObject({ hour: 17, weekday: 5 });
  });
  it("business hours are weekdays 9-5 Central", () => {
    expect(inBusinessHours(iso("2026-11-16T15:00:00Z"))).toBe(true); // Mon 9am CST
    expect(inBusinessHours(iso("2026-11-16T14:59:00Z"))).toBe(false);
    expect(inBusinessHours(iso("2026-11-21T17:00:00Z"))).toBe(false); // Saturday
    expect(nextBusinessTime(iso("2026-11-21T17:00:00Z")).toISOString()).toBe("2026-11-23T15:00:00.000Z");
    expect(addBusinessDays(iso("2026-11-20T18:00:00Z"), 2).toISOString()).toBe("2026-11-24T15:00:00.000Z");
  });
});

describe("reply classification", () => {
  const c = (text: string, subject = "Re: Built2Bid", from = "jason@example.com") => classifyReply({ text, subject, from });
  it("classifies the common cases and never returns accepted", () => {
    expect(c("Yes, I'm interested! Send details.")).toBe("interested");
    expect(c("Sounds interesting. How many seats is it?")).toBe("questions");
    expect(c("Not interested, thanks.")).toBe("not_interested");
    expect(c("No thanks")).toBe("not_interested");
    expect(c("Please remove me from your list")).toBe("unsubscribe");
    expect(c("unsubscribe")).toBe("unsubscribe");
    expect(c("I am out of the office until Monday", "Automatic reply: Built2Bid")).toBe("out_of_office");
    expect(c("Delivery failed", "Undeliverable: Built2Bid", "MAILER-DAEMON@mx.example.com")).toBe("bounce");
    expect(c("ok")).toBe("ambiguous");
    expect(c("👍")).toBe("ambiguous");
  });
  it("ignores quoted history", () => {
    const body = "Not for us right now.\n\nOn Mon, Nov 16, 2026 at 9:00 AM Built2Bid wrote:\n> Would you be interested?";
    expect(newText(body)).toBe("Not for us right now.");
    expect(c(body)).toBe("not_interested");
  });
  it("maps to CRM stages", () => {
    expect(stageForReply("interested")).toBe("interested");
    expect(stageForReply("not_interested")).toBe("declined");
    expect(stageForReply("unsubscribe")).toBe("unsubscribed");
    expect(stageForReply("out_of_office")).toBeNull();
  });
});

describe("templates", () => {
  const ctx = { firstName: "Jason", giftTier: 10, originalSubject: "A free year of Built2Bid?", senderName: "James", deadlineIsReal: false };
  it("drops the deadline sentence unless the cohort deadline is real", () => {
    const off = renderFollowUp("Re: [original subject]", DEFAULT_FOLLOW_UP_BODY, ctx);
    expect(off.body).not.toMatch(/end of the week/);
    expect(off.body).toMatch(/Hi Jason/);
    expect(off.body).toMatch(/10 one-year subscriptions/);
    expect(off.subject).toBe("Re: A free year of Built2Bid?");
    expect(unresolvedPlaceholders(off.subject + off.body)).toEqual([]);
    const on = renderFollowUp("Re: [original subject]", DEFAULT_FOLLOW_UP_BODY, { ...ctx, deadlineIsReal: true });
    expect(on.body).toMatch(/end of the week/);
  });
  it("finds placeholders that must never be sent", () => {
    expect(unresolvedPlaceholders("Hi [First Name], [Built2Bid postal address]")).toEqual(["[First Name]", "[Built2Bid postal address]"]);
  });
  it("lists every sending blocker", () => {
    const s = { sending_enabled: false, approved_at: null, sender_email: null, sender_name: null, postal_address: null } as unknown as OutreachSettings;
    expect(sendingBlockers(s, { enabled: false, hasKey: false, hasUnsubscribeSecret: false })).toHaveLength(6);
  });
});

describe("unsubscribe tokens and CSV", () => {
  it("verifies only untampered tokens", () => {
    const t = unsubscribeToken("Jason@Example.com", "s3cret");
    expect(verifyUnsubscribeToken(t, "s3cret")).toBe("jason@example.com");
    expect(verifyUnsubscribeToken(t, "other")).toBeNull();
    expect(verifyUnsubscribeToken(t.replace(/.$/, "x"), "s3cret")).toBeNull();
    expect(verifyUnsubscribeToken("garbage", "s3cret")).toBeNull();
  });
  it("neutralizes spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(toCsv(["a", "b"], [{ a: "x,y", b: null }])).toBe("a,b\r\n\"x,y\",\r\n");
  });
});

describe("research import", () => {
  const seed = {
    generated: "2026-11-15",
    creators: [
      { rank: 1, score: 87, trade: "Decks", channel: "Example Decks", creator: "Pat Example", channel_url: "https://www.youtube.com/@exampledecks",
        channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa", subscribers: "10K", lifetime_views: 12345, published_business_email: "Hello@Example.test",
        contact_source_url: "https://example.test/contact", recommended_offer: "12 months + 10 one-year gifted", score_pro_audience_30: 27,
        relevant_videos: "Video (https://www.youtube.com/watch?v=abc; 1K views)", verification_date: "2026-11-15", confidence: "High", first_wave: "YES" },
      { rank: 2, trade: "Decks", channel: "Example Decks", channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa" },
      { rank: 3, trade: "Roofing", channel: "No Email Roofing", creator: "(unknown)", published_business_email: "not-an-email", recommended_offer: "5 gifts" },
    ],
    waitlist: [{ channel: "Wait Channel", handle: "@wait", trade: "Painting", reason: "DIY heavy" }],
  };
  it("dedupes, keeps sources, never invents emails", () => {
    const { prospects, skipped } = parseSeed(seed);
    expect(prospects).toHaveLength(3);
    expect(skipped).toEqual([{ channel: "Example Decks", reason: "duplicate" }]);
    const a = prospects[0];
    expect(a).toMatchObject({ contact_email: "hello@example.test", gift_tier: 10, first_name: "Pat", first_wave: true, confidence: "High" });
    expect(a.sources).toContain("https://www.youtube.com/watch?v=abc");
    expect(a.score_breakdown).toEqual({ pro_audience_30: 27 });
    expect(prospects[1]).toMatchObject({ contact_email: null, gift_tier: 5, first_name: null });
    expect(prospects[2]).toMatchObject({ waitlist: true, channel_url: "https://www.youtube.com/@wait" });
    expect(firstNameOf("Jason Russell")).toBe("Jason");
  });
  it("parses the drafts markdown", () => {
    const md = "# Title\n\n---\n\n## 1. Example Decks (Pat) — 10 gifts\n**To:** hello@example.test · **Subject:** A free year?\n\nHi Pat,\n\nThis is the body of the email for testing.\n\n---\n\n## 2. Other — 5 gifts\n**To:** (none) · **Subject:** Another\n\nHi there, a second body long enough.\n";
    expect(parseDrafts(md)).toEqual([
      { rank: 1, subject: "A free year?", body: "Hi Pat,\n\nThis is the body of the email for testing." },
      { rank: 2, subject: "Another", body: "Hi there, a second body long enough." },
    ]);
  });
});

describe("outreach scheduler", () => {
  const settings = {
    id: true, sending_enabled: true, approved_by: "owner", approved_at: "2026-11-15T00:00:00Z", follow_up_subject: "Re: [original subject]",
    follow_up_body: DEFAULT_FOLLOW_UP_BODY, follow_up_approved_at: "2026-11-15T00:00:00Z", follow_up_hours: 72, daily_send_limit: 10,
    business_hour_start: 9, business_hour_end: 17, sender_name: "James", sender_email: "james@built2bid.org", reply_to: null,
    postal_address: "123 Main St, Austin, TX 78701", cohort_label: "First cohort", cohort_deadline_is_real: false,
  };
  const env = { enabled: true, apiKey: "re_test", secret: "s3cret", siteUrl: "https://built2bid.org" };
  function setup() {
    const db = new MemoryDb();
    db.unique.creator_outreach_messages = (a, b) => a.prospect_id === b.prospect_id && a.kind === b.kind && a.status !== "cancelled" && b.status !== "cancelled";
    db.t("creator_outreach_settings").push({ ...settings });
    db.t("creator_prospects").push({ id: "p1", stage: "approved", contact_email: "pat@example.test", first_name: "Pat", gift_tier: 10, replied_at: null });
    db.t("creator_outreach_messages").push({ id: "m1", prospect_id: "p1", kind: "initial", to_email: "pat@example.test", subject: "A free year?", body_text: "Hi Pat, real draft.", status: "approved", attempts: 0, created_at: "2026-11-15" });
    const calls: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => { calls.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: `re_${calls.length}` }), { status: 200 }); }) as typeof fetch;
    db.rpcs.creator_outreach_reallocate = () => null;
    return { db, calls, fetchImpl };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the in-memory fake stands in for SupabaseClient
  const asDb = (db: MemoryDb) => db as any;

  it("does nothing at all while any blocker remains", async () => {
    const { db, calls, fetchImpl } = setup();
    const r = await runCreatorOutreach(asDb(db), { now: iso("2026-11-16T16:00:00Z"), env: { ...env, enabled: false }, fetchImpl });
    expect(r.disabled).toBe(true);
    expect(calls).toHaveLength(0);
    db.t("creator_outreach_settings")[0].sending_enabled = false;
    expect((await runCreatorOutreach(asDb(db), { now: iso("2026-11-16T16:00:00Z"), env, fetchImpl })).disabled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("initial -> one follow-up after 72h in the same thread -> Friday deadline -> no response + reallocation", async () => {
    const { db, calls, fetchImpl } = setup();
    let reallocated = "";
    db.rpcs.creator_outreach_reallocate = (a) => { reallocated = String(a.p_prospect_id); return "p2"; };
    // Outside business hours: nothing sent.
    expect((await runCreatorOutreach(asDb(db), { now: iso("2026-11-16T03:00:00Z"), env, fetchImpl })).outsideHours).toBe(true);
    expect(calls).toHaveLength(0);
    const r1 = await runCreatorOutreach(asDb(db), { now: iso("2026-11-16T16:00:00Z"), env, fetchImpl });
    expect(r1.sent).toBe(1);
    expect(calls[0]).toMatchObject({ to: ["pat@example.test"], subject: "A free year?" });
    expect(String(calls[0].text)).toMatch(/123 Main St/);
    expect(String(calls[0].text)).toMatch(/unsubscribe/);
    const p = db.t("creator_prospects")[0];
    expect(p.stage).toBe("follow_up_scheduled");
    // A second run before 72h does nothing new.
    await runCreatorOutreach(asDb(db), { now: iso("2026-11-17T16:00:00Z"), env, fetchImpl });
    expect(calls).toHaveLength(1);
    // After 72h: exactly one follow-up, threaded.
    const due = new Date(String(p.follow_up_due_at));
    const r2 = await runCreatorOutreach(asDb(db), { now: new Date(due.getTime() + 60_000), env, fetchImpl });
    expect(r2.followUpsQueued, JSON.stringify([r2, db.t("creator_outreach_messages")])).toBe(1);
    expect(r2.sent, JSON.stringify([r2, db.t("creator_outreach_messages")])).toBe(1);
    expect(r2.sent).toBe(1);
    expect(calls[1].subject).toBe("Re: A free year?");
    expect((calls[1].headers as Record<string, string>)["In-Reply-To"]).toBe(db.t("creator_outreach_messages")[0].rfc_message_id);
    expect(String(calls[1].text)).not.toMatch(/end of the week/);
    expect(p.stage).toBe("awaiting_response");
    // Runs again: no second follow-up, ever.
    await runCreatorOutreach(asDb(db), { now: new Date(due.getTime() + 3_600_000), env, fetchImpl });
    expect(calls).toHaveLength(2);
    // Deadline passes with no reply.
    const r3 = await runCreatorOutreach(asDb(db), { now: new Date(new Date(String(p.response_deadline_at)).getTime() + 60_000), env, fetchImpl });
    expect(r3.deadlines).toBe(1);
    expect(r3.reallocated).toBe(1);
    expect(reallocated).toBe("p1");
    expect(p.stage).toBe("no_response_first_cohort");
    expect(calls).toHaveLength(2); // no breakup email
  });

  it("a reply cancels the follow-up; suppression and contact changes stop sends", async () => {
    const { db, calls, fetchImpl } = setup();
    await runCreatorOutreach(asDb(db), { now: iso("2026-11-16T16:00:00Z"), env, fetchImpl });
    await recordReply(asDb(db), { prospectId: "p1", text: "Sounds great, tell me more", now: iso("2026-11-17T16:00:00Z") });
    const p = db.t("creator_prospects")[0];
    expect(p.stage).toBe("interested");
    await runCreatorOutreach(asDb(db), { now: iso("2026-11-20T16:00:00Z"), env, fetchImpl });
    expect(calls).toHaveLength(1);

    const s2 = setup();
    s2.db.t("creator_outreach_suppressions").push({ email: "pat@example.test", reason: "unsubscribe" });
    const r = await runCreatorOutreach(asDb(s2.db), { now: iso("2026-11-16T16:00:00Z"), env, fetchImpl: s2.fetchImpl });
    expect(r.skipped).toBe(1);
    expect(s2.calls).toHaveLength(0);
    expect(s2.db.t("creator_outreach_messages")[0].status).toBe("cancelled");
  });

  it("unsubscribe replies are suppressed permanently; out-of-office postpones", async () => {
    const { db, fetchImpl } = setup();
    await runCreatorOutreach(asDb(db), { now: iso("2026-11-16T16:00:00Z"), env, fetchImpl });
    const ooo = await recordReply(asDb(db), { prospectId: "p1", subject: "Automatic reply", text: "I'm out of the office", now: iso("2026-11-17T16:00:00Z") });
    expect(ooo.stage).toBeNull();
    expect(db.t("creator_prospects")[0].replied_at).toBeNull();
    expect(db.t("creator_prospects")[0].postponed_until).toBeTruthy();
    await recordReply(asDb(db), { prospectId: "p1", text: "Please unsubscribe me", now: iso("2026-11-18T16:00:00Z") });
    expect(db.t("creator_outreach_suppressions")).toEqual([expect.objectContaining({ email: "pat@example.test", reason: "unsubscribe" })]);
    expect(db.t("creator_prospects")[0].stage).toBe("unsubscribed");
  });

  it("respects the daily send limit", async () => {
    const { db, calls, fetchImpl } = setup();
    db.t("creator_outreach_settings")[0].daily_send_limit = 1;
    db.t("creator_prospects").push({ id: "p2", stage: "approved", contact_email: "b@example.test", replied_at: null });
    db.t("creator_outreach_messages").push({ id: "m2", prospect_id: "p2", kind: "initial", to_email: "b@example.test", subject: "Hi", body_text: "Body two", status: "approved", attempts: 0, created_at: "2026-11-15" });
    await runCreatorOutreach(asDb(db), { now: iso("2026-11-16T16:00:00Z"), env, fetchImpl });
    await runCreatorOutreach(asDb(db), { now: iso("2026-11-16T17:00:00Z"), env, fetchImpl });
    expect(calls).toHaveLength(1);
  });
});

import { outreachMetrics } from "@/lib/creator/crm";
describe("CRM metrics", () => {
  it("computes the addendum dashboard numbers", () => {
    const base = { initial_sent_at: null, follow_up_sent_at: null, replied_at: null, replied_after: null, reply_classification: null };
    const m = outreachMetrics([
      { ...base, stage: "interested", initial_sent_at: "x", replied_at: "x", replied_after: "initial", reply_classification: "interested" },
      { ...base, stage: "declined", initial_sent_at: "x", follow_up_sent_at: "x", replied_at: "x", replied_after: "follow_up", reply_classification: "not_interested" },
      { ...base, stage: "opportunity_reallocated", initial_sent_at: "x", follow_up_sent_at: "x" },
      { ...base, stage: "accepted", initial_sent_at: "x", replied_at: "x", replied_after: "initial", reply_classification: "questions" },
      { ...base, stage: "researched" },
    ]);
    expect(m).toEqual({ initialSent: 4, followUpsSent: 2, repliesAfterInitial: 2, repliesAfterFollowUp: 1, positiveRate: 50, accepted: 1, unresponsive: 1, reallocated: 1 });
  });
});
