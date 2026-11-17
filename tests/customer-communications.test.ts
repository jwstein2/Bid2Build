import { describe, expect, it } from "vitest";
import { buildAudience, type EstimateFact } from "@/lib/comms/eligibility";
import { offerText, pickOffer, renderNurture, validateOffer, validateTemplate } from "@/lib/comms/nurture";
import { buildProjectUpdateEmail, milestoneCandidates, sectionLine, staleReason, upcomingWeekly } from "@/lib/comms/project-updates";
import { classifyCommReply } from "@/lib/comms/classify";
import { verifySvix } from "@/lib/comms/svix";
import { checkUnsubSig, tokenFromAddresses, unsubUrls } from "@/lib/comms/tokens";
import { commConfig, replyMonitoring } from "@/lib/comms/config";
import { addMonths, localDate, nextWeeklySlot, zonedInstant } from "@/lib/comms/time";
import type { Offer } from "@/lib/comms/types";
import type { CustomerReport, ReportSection } from "@/lib/schedule/report";
import type { Task } from "@/lib/schedule/types";
import { createHmac } from "node:crypto";

const NOW = new Date("2026-12-10T15:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const est = (o: Partial<EstimateFact>): EstimateFact => ({
  id: crypto.randomUUID(), customerId: null, email: "john@example.com", name: "John Smith", title: "Backyard deck", trades: ["decks"], estimateDate: ago(400).slice(0, 10),
  updatedAt: ago(400), stage: "lost", stageChangedAt: ago(400), scheduleStatus: null, scheduleUpdatedAt: null, ...o,
});
const A = "00000000-0000-4000-8000-0000000000aa";

describe("nurture eligibility", () => {
  it("dedupes one person across several bids and picks the right groups", () => {
    const list = buildAudience({ accountId: A, now: NOW, months: 6, contacts: [], suppressions: [], estimates: [
      est({ stage: "lost" }), est({ stage: "sent", stageChangedAt: ago(200), updatedAt: ago(200) }), est({ stage: "draft", updatedAt: ago(300), email: "JOHN@example.com " }),
    ] });
    expect(list).toHaveLength(1);
    expect(list[0].groups.sort()).toEqual(["lost", "old_draft", "unconverted"]);
    expect(list[0].basis).toBe("inquiry");
    expect(list[0].excluded).toBeNull();
    expect(list[0].estimateCount).toBe(3);
    expect(list[0].due).toBe(true);
  });
  it("excludes active projects, recent proposals, draft-only people, suppressions and replied contacts", () => {
    const list = buildAudience({ accountId: A, now: NOW, months: 6,
      contacts: [{ id: "c1", email: "replied@example.com", status: "replied", basis: "inquiry", lastNurtureAt: null, lastReplyAt: ago(10), enrolledAt: ago(100) }],
      suppressions: [{ accountId: null, email: "bounced@example.com", scope: "all", reason: "bounce" }, { accountId: "other", email: "otherco@example.com", scope: "marketing", reason: "unsubscribe" }],
      estimates: [
        est({ email: "active@example.com", stage: "won" }), est({ email: "active@example.com", stage: "lost" }),
        est({ email: "recent@example.com", stage: "sent", stageChangedAt: ago(5), updatedAt: ago(5) }),
        est({ email: "draft@example.com", stage: "draft", updatedAt: ago(200) }),
        est({ email: "bounced@example.com" }), est({ email: "replied@example.com" }), est({ email: "otherco@example.com" }),
        est({ email: "not-an-email" }),
      ] });
    const by = Object.fromEntries(list.map((e) => [e.email, e.excluded]));
    expect(by["active@example.com"]).toMatch(/in progress/);
    expect(by["recent@example.com"]).toMatch(/30 days/);
    expect(by["draft@example.com"]).toMatch(/Draft only/);
    expect(by["bounced@example.com"]).toMatch(/bounced/);
    expect(by["replied@example.com"]).toMatch(/Replied/);
    expect(by["otherco@example.com"]).toBeNull(); // another company's opt-out doesn't leak across accounts
    expect(by["not-an-email"]).toBeUndefined();
  });
  it("schedules six months after the later of the last interaction and the last follow-up", () => {
    const [e] = buildAudience({ accountId: A, now: NOW, months: 6, suppressions: [],
      contacts: [{ id: "c", email: "john@example.com", status: "eligible", basis: "inquiry", lastNurtureAt: ago(30), lastReplyAt: null, enrolledAt: ago(300) }],
      estimates: [est({ stage: "lost", updatedAt: ago(400), stageChangedAt: ago(400) })] });
    expect(e.due).toBe(false);
    expect(e.nextDueAt.slice(0, 10)).toBe(addMonths(new Date(ago(30)), 6).toISOString().slice(0, 10));
    const [f] = buildAudience({ accountId: A, now: NOW, months: 6, suppressions: [], contacts: [], estimates: [est({ stage: "lost", updatedAt: ago(60), stageChangedAt: ago(60) })] });
    expect(f.due).toBe(false); // a bid lost two months ago waits for the six-month mark
  });
  it("completed customers are customers; old completions are past customers", () => {
    const list = buildAudience({ accountId: A, now: NOW, months: 6, suppressions: [], contacts: [], estimates: [
      est({ email: "a@example.com", stage: "completed", stageChangedAt: ago(200), updatedAt: ago(200) }),
      est({ email: "b@example.com", stage: "won", scheduleStatus: "completed", scheduleUpdatedAt: ago(900), updatedAt: ago(900) }),
    ] });
    expect(list.find((e) => e.email === "a@example.com")!.groups).toEqual(["completed"]);
    expect(list.find((e) => e.email === "b@example.com")!.groups).toEqual(["past_customer"]);
    expect(list.every((e) => e.basis === "customer" && !e.excluded)).toBe(true);
  });
});

const offer = (o: Partial<Offer>): Offer => ({ id: "o1", name: "Fall deck special", offerType: "percent", trades: [], audience: [], startsOn: "2026-12-01", endsOn: "2026-12-31", conditions: "New contracts only", discountValue: 10, message: "", materialCurrent: null, materialAlternative: null, priceBasis: null, estimatedSavings: null, comparisonApprovedAt: null, active: true, ...o });

describe("nurture emails", () => {
  const [entry] = buildAudience({ accountId: A, now: NOW, months: 6, suppressions: [], contacts: [], estimates: [est({ estimateDate: "2026-03-14" })] });
  const ctx = { companyName: "Smith Decks", senderName: "Dana", postalAddress: "PO Box 9, Duluth, MN 55802", unsubscribeUrl: "https://built2bid.org/email/preferences?m=x&s=y", today: "2026-12-10" };
  it("renders from saved facts only, with the legal footer", () => {
    const r = renderNurture(entry, { subject: null, body: null, offers: [], includeOffers: false, ctx });
    expect(r.subject).toBe("Checking in on your deck project");
    expect(r.body).toContain("Hi John,");
    expect(r.body).toContain("the deck project we quoted for you back in March 2026");
    expect(r.body).toContain("PO Box 9, Duluth, MN 55802");
    expect(r.body).toContain("Unsubscribe: https://built2bid.org/email/preferences");
    expect(r.body).not.toMatch(/valid|guarantee|\$/i);
    expect(r.offerId).toBeNull();
  });
  it("offers are optional, dated, trade/audience-scoped, and material swaps need approval", () => {
    expect(renderNurture(entry, { subject: null, body: null, offers: [offer({})], includeOffers: false, ctx }).offerId).toBeNull();
    expect(renderNurture(entry, { subject: null, body: null, offers: [offer({})], includeOffers: true, ctx }).body).toContain("Fall deck special: 10% off");
    expect(pickOffer([offer({ endsOn: "2026-12-01" })], entry, "2026-12-10")).toBeNull(); // expired
    expect(pickOffer([offer({ active: false })], entry, "2026-12-10")).toBeNull();
    expect(pickOffer([offer({ trades: ["roofing"] })], entry, "2026-12-10")).toBeNull();
    expect(pickOffer([offer({ audience: ["completed"] })], entry, "2026-12-10")).toBeNull();
    const mat = offer({ offerType: "material", discountValue: null, materialCurrent: "composite boards", materialAlternative: "pressure-treated pine", priceBasis: "contractor_estimate" });
    expect(pickOffer([mat], entry, "2026-12-10")).toBeNull();
    const txt = offerText({ ...mat, comparisonApprovedAt: "2026-12-01T00:00:00Z" })!;
    expect(txt).toContain("pressure-treated pine instead of composite boards");
    expect(txt).toContain("may lower the cost");
    expect(txt).not.toMatch(/guarantee|will save/i);
  });
  it("refuses templates that promise prices, invent history or use unknown placeholders", () => {
    expect(validateTemplate("Hi", "Your quote is still valid!")).toMatch(/promise/);
    expect(validateTemplate("Hi", "As we discussed last week")).toMatch(/promise|conversations/);
    expect(validateTemplate("Hi {first_name}", "Hello {nickname}")).toMatch(/nickname/);
    expect(validateTemplate("Hi {first_name}", "Checking in about {project_reference}.")).toBeNull();
    expect(validateOffer({ name: "X", offerType: "percent", startsOn: "2026-01-02", endsOn: "2026-01-01" })).toMatch(/end date/);
    expect(validateOffer({ name: "X", offerType: "material", startsOn: "2026-01-01", endsOn: "2026-01-02", message: "We guarantee the same performance" })).toBeTruthy();
  });
});

const section = (o: Partial<ReportSection>): ReportSection => ({ key: "s", name: "Framing", trade: null, plannedStart: "2026-12-07", plannedEnd: "2026-12-14", actualStart: "2026-12-07", actualFinish: null, status: "in_progress", statusLabel: "In progress", state: "current", progress: 80, scope: null, change: null, tasks: null, ...o });
const report = (sections: ReportSection[], date = "2026-12-15"): CustomerReport => ({
  v: 1, company: { name: "Smith Decks", phone: null, email: null, website: null }, brand: { logo: false, color: null }, customerName: "John Smith", projectTitle: "Smith Residence",
  projectAddress: null, reportDate: date, provisional: false, progress: 62, projectStart: "2026-12-01", forecastFinish: "2027-01-08", previousForecast: null, showTimeline: true, sections, notes: null, counts: { completed: 0, current: 1, upcoming: 0 },
});

describe("project update accuracy", () => {
  it("never calls unverified work complete, even past its planned finish", () => {
    const line = sectionLine(section({}), "2026-12-15");
    expect(line).toBe("Framing was scheduled through December 14. Our latest recorded progress is 80%. We'll share an updated completion status when it's confirmed.");
    expect(line).not.toMatch(/has been completed|completed\./);
    expect(sectionLine(section({ status: "complete", state: "completed", actualFinish: "2026-12-13", progress: 100 }), "2026-12-15")).toBe("Framing: completed December 13.");
    expect(sectionLine(section({ state: "upcoming", status: "not_started", plannedStart: "2026-12-20" }), "2026-12-15")).toMatch(/scheduled to start December 20/);
  });
  it("builds the email from the customer report only (no money)", () => {
    const m = buildProjectUpdateEmail(report([section({})]), { link: "https://built2bid.org/updates/abc", contactName: "Dana", unsubscribeUrl: "https://x/u", postalAddress: "PO Box 9" });
    expect(m.subject).toBe("Project update: Smith Residence — Smith Decks");
    expect(m.body).toContain("Overall recorded progress: 62%");
    expect(m.body).toContain("https://built2bid.org/updates/abc");
    expect(m.body).not.toMatch(/\$|cost|margin|price/i);
    const ms = buildProjectUpdateEmail(report([section({ status: "complete", state: "completed", actualFinish: "2026-12-13" })]), { link: null, contactName: null, milestone: { sectionName: "Framing" }, unsubscribeUrl: null, postalAddress: null });
    expect(ms.body).toContain("Framing on Smith Residence has been completed and confirmed by our project manager.");
  });
  it("milestones come only from confirmed-complete sections after updates were turned on", () => {
    const t = (o: Partial<Task>): Task => ({ id: crypto.randomUUID(), parentId: null, kind: "section", sourceGroupId: "g", sourceItemId: null, splitFrom: null, name: "Framing", sortOrder: 0, plannedStart: "2026-12-07", plannedEnd: "2026-12-14", durationDays: 6, actualStart: null, actualFinish: null, percentComplete: 100, status: "in_progress", weight: null, assignee: null, notes: null, ...o });
    const tasks = [t({}), t({ status: "complete", actualFinish: "2026-12-13" }), t({ status: "complete", actualFinish: "2026-11-01" }), t({ kind: "item", status: "complete", actualFinish: "2026-12-13" })];
    expect(milestoneCandidates(tasks, "2026-12-01")).toHaveLength(1);
  });
  it("automatic mode pauses when overdue work hasn't been updated", () => {
    const data = { schedule: { updatedAt: ago(10) } as never, tasks: [{ kind: "section", splitFrom: null, status: "in_progress", plannedEnd: "2026-12-01", name: "Framing" } as Task] };
    expect(staleReason(data, "2026-12-10", NOW)).toMatch(/Framing is past its planned finish/);
    expect(staleReason({ ...data, schedule: { updatedAt: ago(1) } as never }, "2026-12-10", NOW)).toBeNull();
  });
});

describe("time zone scheduling", () => {
  it("weekly slots land on the contractor's local weekday and hour", () => {
    const slot = nextWeeklySlot(new Date("2026-12-09T12:00:00Z"), "America/Chicago", 5, 16); // Wed -> Fri 4 PM CST
    expect(slot.toISOString()).toBe("2026-12-11T22:00:00.000Z");
    expect(localDate(slot, "America/Chicago")).toBe("2026-12-11");
    expect(zonedInstant("2026-07-10", 16, "America/Chicago").toISOString()).toBe("2026-07-10T21:00:00.000Z"); // CDT
    const w = upcomingWeekly(new Date("2026-12-10T22:00:00Z"), "America/Chicago", 5, 16);
    expect(w.reminderAt.toISOString()).toBe("2026-12-10T22:00:00.000Z"); // the day before
  });
});

describe("reply handling and links", () => {
  it("classifies STOP, opt-outs, auto replies and bounces conservatively", () => {
    expect(classifyCommReply({ text: "STOP" })).toBe("opt_out");
    expect(classifyCommReply({ text: "Please remove me from your list" })).toBe("opt_out");
    expect(classifyCommReply({ text: "Not interested anymore, thanks" })).toBe("possible_opt_out");
    expect(classifyCommReply({ subject: "Automatic reply: out of office", text: "I am out of the office until Monday" })).toBe("auto_reply");
    expect(classifyCommReply({ from: "MAILER-DAEMON@x.com", subject: "Undeliverable" })).toBe("bounce");
    expect(classifyCommReply({ text: "Yes! Can you come by next week?\n\nOn Mon, Dana wrote:\n> unsubscribe" })).toBe("human");
  });
  it("verifies Resend (Svix) signatures", () => {
    const secret = `whsec_${Buffer.from("supersecretkey123").toString("base64")}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from("supersecretkey123")).update(`msg_1.${ts}.{"a":1}`).digest("base64");
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, '{"a":1}')).toBe(true);
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, '{"a":2}')).toBe(false);
    expect(verifySvix(secret, { id: "msg_1", timestamp: String(Number(ts) - 900), signature: `v1,${sig}` }, '{"a":1}')).toBe(false);
  });
  it("signs unsubscribe links and finds reply tokens", () => {
    const env = { COMM_UNSUBSCRIBE_SECRET: "x".repeat(40) };
    const id = "11111111-1111-4111-8111-111111111111";
    const u = new URL(unsubUrls("https://built2bid.org", id, env).oneClick);
    expect(checkUnsubSig(u.searchParams.get("m"), u.searchParams.get("s"), env)).toBe(true);
    expect(checkUnsubSig("22222222-2222-4222-8222-222222222222", u.searchParams.get("s"), env)).toBe(false);
    expect(tokenFromAddresses(["Dana <reply+0123456789abcdef01234567@reply.built2bid.org>"], "reply.built2bid.org")).toBe("0123456789abcdef01234567");
    expect(tokenFromAddresses(["reply+0123456789abcdef01234567@evil.com"], "reply.built2bid.org")).toBeNull();
  });
  it("sending is off by default and reply monitoring needs a verified test", () => {
    expect(commConfig({}).enabled).toBe(false);
    expect(commConfig({ COMM_EMAIL_MODE: "live", RESEND_API_KEY: "re_x" }).enabled).toBe(true);
    expect(commConfig({ COMM_EMAIL_MODE: "test", RESEND_API_KEY: "re_x" }).enabled).toBe(false);
    const cfg = commConfig({ COMM_EMAIL_MODE: "live", RESEND_API_KEY: "re_x", COMM_REPLY_DOMAIN: "reply.built2bid.org", RESEND_WEBHOOK_SECRET: "whsec_x" });
    expect(replyMonitoring(cfg, null).active).toBe(false);
    expect(replyMonitoring(cfg, "2026-12-01T00:00:00Z").active).toBe(true);
    expect(replyMonitoring(commConfig({ COMM_EMAIL_MODE: "live", RESEND_API_KEY: "re_x" }), "2026-12-01T00:00:00Z").active).toBe(false);
  });
});
