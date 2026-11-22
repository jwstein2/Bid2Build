import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/demo/guard", () => ({ inDemoSession: async () => false }));
process.env.SALES_NURTURE_SECRET = "x".repeat(40);

const { answeredInitial, buildCtx, firstNameOf, FOLLOW_UP_KEYS, footer, noAnswerInitial, planFollowUp, renderKey, unresolved } = await import("@/lib/sales/nurture/templates");
const { decide, deliver } = await import("@/lib/sales/nurture/runner");
const { bookingRef, unsubscribeToken, verifyBookingRef, verifyUnsubscribeToken } = await import("@/lib/sales/nurture/tokens");
type Ctx = import("@/lib/sales/nurture/runner").SendContext;

const rep = { full_name: "Rita Rep", email: "rita@sales.test", phone: "507-555-0100", code: "ABCD2345", booking_slug: "rita" };
const ctxT = buildCtx({ contactName: "dana smith", companyName: "ABC Construction", trades: ["roofing"], rep, origin: "https://built2bid.org", scheduleRef: "ref1" });

function sendCtx(over: Partial<Ctx> & { step?: 0 | 1 | 2; top?: string; paid?: boolean } = {}): Ctx {
  const { step = 1, top = "none", paid = false, ...rest } = over;
  return {
    message: { id: "11111111-1111-1111-1111-111111111111", step, status: "sending", attempts: 1, subject: step === 0 ? "Hello" : null, body: step === 0 ? "Hi Dana, thanks for taking my call today." : null },
    campaign: { id: "22222222-2222-2222-2222-222222222222", kind: "answered", status: "active", to_email: "dana@abc.test", first_subject: "Hello", first_rfc_message_id: "<sales-1@built2bid.org>", sent_templates: ["answered_initial"] },
    lead: { id: "l1", company_name: "ABC Construction", contact_name: "Dana Smith", email: "dana@abc.test", state: "MN", trades: ["roofing"], stage: "contacted", do_not_contact: false, email_status: "ok", email_opt_out_at: null, assigned_rep: "r1" },
    rep: { id: "r1", full_name: "Rita Rep", email: "rita@sales.test", phone: null, code: "ABCD2345", status: "active", booking_slug: "rita", from_email: "rita@built2bid.org" },
    milestones: { match: "linked", top: top as Ctx["milestones"]["top"], paid },
    suppressed: null,
    settings: { send_mode: "live", test_recipients: [], postal_address: "123 Main St, Rochester, MN 55901", paused: false, blockers: [] },
    ...rest,
  };
}

describe("sales nurture templates", () => {
  it("fills the first emails from CRM and rep details, with the rep's own tracked link", () => {
    const a = answeredInitial(ctxT);
    expect(a.subject).toBe("Great speaking with you today — Built2Bid");
    expect(a.body).toMatch(/^Hi Dana,/);
    expect(a.body).toContain("valuable resource for ABC Construction, particularly when it comes to creating roofing estimates");
    expect(a.body).toContain("https://built2bid.org/s/ABCD2345?to=/login");
    expect(a.body).toContain("Rita Rep\nBuilt2Bid\nrita@sales.test · 507-555-0100");
    // Already has an account: sign-in link, never sign-up again.
    const acct = answeredInitial(ctxT, { hasAccount: true });
    expect(acct.body).not.toContain("/s/ABCD2345");
    expect(acct.body).toContain("https://built2bid.org/login");
    const n = noAnswerInitial(ctxT);
    expect(n.subject).toBe("Quick question about ABC Construction");
    expect(n.body).toContain("I'm Rita Rep with Built2Bid");
  });

  it("never guesses a first name", () => {
    expect(firstNameOf("dana smith")).toBe("Dana");
    expect(firstNameOf("Owner")).toBeNull();
    expect(firstNameOf("J.")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(answeredInitial({ ...ctxT, firstName: null }).body).toMatch(/^Hi there,/);
  });

  it("has no unfilled placeholders, and every template works without a booking page", () => {
    const keys = ["answered_initial", "no_answer_initial", ...FOLLOW_UP_KEYS];
    for (const k of keys) {
      for (const c of [ctxT, { ...ctxT, scheduleLink: null }]) {
        const r = renderKey(k, c);
        expect(unresolved(`${r.subject}\n${r.body}`), k).toEqual([]);
        expect(r.body, k).not.toMatch(/null|undefined/);
      }
    }
    expect(renderKey("no_answer_d7", ctxT).body).toContain("https://built2bid.org/meet/rita?session=intro&ref=ref1");
    expect(renderKey("no_answer_d7", { ...ctxT, scheduleLink: null }).body).toContain("just reply with a day and time");
  });

  it("picks the follow-up from the most advanced verified milestone", () => {
    expect(planFollowUp("answered", 1, { top: "none", paid: false })).toEqual({ action: "send", key: "answered_d3_none" });
    expect(planFollowUp("answered", 1, { top: "account_created", paid: false })).toEqual({ action: "send", key: "answered_d3_account_created" });
    expect(planFollowUp("answered", 1, { top: "estimate_started", paid: false })).toEqual({ action: "send", key: "answered_d3_estimate_started" });
    expect(planFollowUp("answered", 1, { top: "estimate_completed", paid: false })).toEqual({ action: "send", key: "answered_d3_estimate_completed" });
    expect(planFollowUp("answered", 1, { top: "proposal_approved", paid: false })).toEqual({ action: "send", key: "answered_d3_proposal_approved" });
    expect(planFollowUp("answered", 1, { top: "account_exists", paid: false })).toEqual({ action: "send", key: "answered_d3_account_exists" });
    expect(planFollowUp("answered", 2, { top: "proposal_sent", paid: false })).toEqual({ action: "send", key: "answered_d7_progress" });
    expect(planFollowUp("answered", 2, { top: "none", paid: false })).toEqual({ action: "send", key: "answered_d7_none" });
    expect(planFollowUp("no_answer", 1, { top: "none", paid: false })).toEqual({ action: "send", key: "no_answer_d3" });
    expect(planFollowUp("no_answer", 1, { top: "estimate_started", paid: false })).toEqual({ action: "send", key: "answered_d3_estimate_started" });
    expect(planFollowUp("no_answer", 2, { top: "account_created", paid: false })).toEqual({ action: "send", key: "no_answer_d7" });
    expect(planFollowUp("answered", 2, { top: "paid", paid: true })).toMatchObject({ action: "stop", status: "converted" });
    for (const k of FOLLOW_UP_KEYS.filter((k) => k.startsWith("answered_d3"))) expect(renderKey(k, ctxT).subject).not.toBe("");
  });

  it("uses neutral wording when activity isn't verified (no false claims)", () => {
    const none = renderKey("answered_d3_none", ctxT).body;
    expect(none).toContain("If you haven't had a chance to try Built2Bid yet");
    expect(none).not.toMatch(/I noticed/);
    const exists = renderKey("answered_d3_account_exists", ctxT).body;
    expect(exists).not.toMatch(/I noticed|created an account|haven't started/);
    expect(exists).not.toContain("/s/ABCD2345");
    expect(renderKey("no_answer_d3_account_exists", ctxT).body).not.toContain("create an account");
  });

  it("adds the compliance footer", () => {
    const f = footer({ companyName: "ABC Construction", postalAddress: "123 Main St, Rochester, MN 55901", unsubscribeUrl: "https://built2bid.org/unsubscribe/sales?t=x", repFirstName: "Rita" });
    expect(f).toContain("Built2Bid L.L.C. · 123 Main St, Rochester, MN 55901");
    expect(f).toContain("unsubscribe here: https://built2bid.org/unsubscribe/sales?t=x");
  });
});

describe("sales nurture send decisions", () => {
  it("renders the follow-up only at send time from current milestones", () => {
    const d = decide(sendCtx({ top: "estimate_started" }), "https://built2bid.org");
    expect(d).toMatchObject({ action: "send", key: "answered_d3_estimate_started", milestone: "estimate_started" });
    expect(d.action === "send" && d.body).toContain("https://built2bid.org/meet/rita?session=intro&ref=");
  });

  it("stops instead of sending on every stop condition", () => {
    expect(decide(sendCtx({ paid: true, top: "paid" }))).toMatchObject({ action: "skip", endStatus: "converted" });
    expect(decide(sendCtx({ suppressed: "opted_out" }))).toMatchObject({ action: "skip", endStatus: "unsubscribed" });
    expect(decide(sendCtx({ suppressed: "bounced" }))).toMatchObject({ action: "skip", endStatus: "failed_delivery" });
    const base = sendCtx();
    expect(decide({ ...base, lead: { ...base.lead, do_not_contact: true } })).toMatchObject({ endStatus: "unsubscribed" });
    expect(decide({ ...base, lead: { ...base.lead, email: "new@abc.test" } })).toMatchObject({ endStatus: "stopped" });
    expect(decide({ ...base, lead: { ...base.lead, assigned_rep: "r2" } })).toMatchObject({ endStatus: "stopped" });
    expect(decide({ ...base, lead: { ...base.lead, stage: "lost" } })).toMatchObject({ endStatus: "not_interested" });
    expect(decide({ ...base, rep: { ...base.rep, status: "suspended" } })).toMatchObject({ endStatus: "stopped" });
    expect(decide({ ...base, settings: { ...base.settings, send_mode: "test", test_recipients: ["other@x.test"] } })).toMatchObject({ action: "skip" });
    expect(decide({ ...base, settings: { ...base.settings, paused: true } })).toMatchObject({ action: "wait" });
    // Only from the rep's own @built2bid.org mailbox: without one, hold (don't end the campaign).
    expect(decide({ ...base, rep: { ...base.rep, from_email: null } })).toMatchObject({ action: "wait" });
    expect(decide({ ...base, rep: { ...base.rep, from_email: "rita@gmail.com" } })).toMatchObject({ action: "wait" });
    expect(decide({ ...base, campaign: { ...base.campaign, sent_templates: ["answered_initial", "answered_d3_none"] } })).toMatchObject({ action: "skip" });
  });

  it("sends the rep's own first email unchanged", () => {
    expect(decide(sendCtx({ step: 0 }))).toMatchObject({ action: "send", key: "answered_initial", subject: "Hello" });
  });
});

describe("sales nurture delivery", () => {
  it("sends through Resend with sender identity, reply-to, unsubscribe headers, threading and an idempotency key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); }) as unknown as typeof fetch;
    const marks: unknown[] = [];
    const db = { rpc: async (fn: string, args: unknown) => { marks.push({ fn, args }); return { data: { ok: true }, error: null }; } } as never;
    expect(await deliver(db, sendCtx({ top: "account_created" }), { fetchImpl, apiKey: "re_test", origin: "https://built2bid.org", replyDomain: null })).toBe("sent");
    const body = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>)["idempotency-key"]).toBe("sales-nurture/11111111-1111-1111-1111-111111111111");
    expect(body).toMatchObject({ from: '"Rita Rep at Built2Bid" <rita@built2bid.org>', to: ["dana@abc.test"], reply_to: "rita@built2bid.org", subject: "Ready to try your first estimate?" });
    expect(body.headers["In-Reply-To"]).toBe("<sales-1@built2bid.org>");
    expect(body.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/built2bid\.org\/api\/sales\/unsubscribe\?t=/);
    expect(body.text).toContain("Built2Bid L.L.C. · 123 Main St");
    expect(marks[0]).toMatchObject({ fn: "sales_campaign_mark", args: { p_outcome: "sent", p: { template_key: "answered_d3_account_created", milestone: "account_created", provider_id: "re_1" } } });
  });

  it("retries temporary provider errors and fails permanent ones", async () => {
    const mk = (status: number) => (async () => new Response(JSON.stringify({ message: "x" }), { status })) as unknown as typeof fetch;
    const outcomes: string[] = [];
    const db = { rpc: async (_fn: string, args: { p_outcome: string }) => { outcomes.push(args.p_outcome); return { data: null, error: null }; } } as never;
    expect(await deliver(db, sendCtx(), { fetchImpl: mk(503), apiKey: "k", replyDomain: null })).toBe("retry");
    expect(await deliver(db, sendCtx(), { fetchImpl: mk(422), apiKey: "k", replyDomain: null })).toBe("failed");
    expect(await deliver(db, sendCtx({ paid: true, top: "paid" }), { fetchImpl: mk(200), apiKey: "k", replyDomain: null })).toBe("skipped");
    expect(outcomes).toEqual(["retry", "failed", "skipped"]);
  });
});

describe("sales nurture tokens", () => {
  it("signs unsubscribe links and booking refs", () => {
    const t = unsubscribeToken("Dana@ABC.test");
    expect(verifyUnsubscribeToken(t)).toBe("dana@abc.test");
    expect(verifyUnsubscribeToken(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
    const r = bookingRef("22222222-2222-2222-2222-222222222222");
    expect(verifyBookingRef(r)).toBe("22222222-2222-2222-2222-222222222222");
    expect(verifyBookingRef("22222222-2222-2222-2222-222222222222.bad")).toBeNull();
  });
});
