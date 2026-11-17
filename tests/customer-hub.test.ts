import { describe, expect, it } from "vitest";
import { hubMetrics, matchesFocus, matchesSearch, possibleDuplicates, sortSummaries, summarize, type HubBid, type HubCustomerRow, type HubProject } from "../src/lib/customers/hub";
import { takeNewBidCustomer, rememberNewBidCustomer } from "../src/lib/customers/new-bid";

const cust = (o: Partial<HubCustomerRow> = {}): HubCustomerRow => ({
  id: "c1", userId: "u1", companyId: null, name: "Pat Johnson", email: "pat@x.dev", phone: "(555) 333-4444", address: "48 Oak Lane", notes: null,
  customerType: "person", companyName: null, source: "backfill", createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z", ...o,
});
const bid = (o: Partial<HubBid> = {}): HubBid => ({
  id: "b1", customerId: "c1", own: true, href: "/estimates/b1", title: "Deck", customer: "", number: "B-1", trades: [], status: "draft", stage: "draft",
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", stageChangedAt: null, wonAt: null, lostReason: null, latestVersion: null, signing: null, ...o,
});
const opts = { esign: false, scheduling: true };

describe("Customer Hub summaries", () => {
  it("relationship comes from recorded stages and projects, in priority order", () => {
    expect(summarize(cust(), [], [], null, opts).relationship).toBe("no_bids");
    expect(summarize(cust(), [bid()], [], null, opts).relationship).toBe("drafting");
    expect(summarize(cust(), [bid({ stage: "sent" })], [], null, opts).relationship).toBe("awaiting");
    expect(summarize(cust(), [bid({ stage: "lost" })], [], null, opts).relationship).toBe("lost");
    expect(summarize(cust(), [bid({ stage: "completed" }), bid({ id: "b2", stage: "lost" })], [], null, opts).relationship).toBe("past");
    const project: HubProject = { id: "p1", estimateId: "b1", name: "Deck job", status: "active", startDate: "2026-11-20", updatedAt: "2026-11-16T00:00:00Z" };
    const s = summarize(cust(), [bid({ stage: "won" }), bid({ id: "b2", stage: "sent" })], [project], null, opts);
    expect(s.relationship).toBe("active_project");
    expect(s.activeProjects).toBe(1);
    expect(s.openBids).toBe(1);
    expect(s.latest?.kind).toBe("project");
  });

  it("needs attention only for real signals; never for an ordinary sent bid", () => {
    expect(summarize(cust(), [bid({ stage: "sent" })], [], null, opts).attention).toHaveLength(0);
    const won = summarize(cust(), [bid({ stage: "won" })], [], null, opts);
    expect(won.attention[0].label).toMatch(/Approved, not scheduled/);
    expect(won.next?.href).toBe("/projects/new?estimate=b1");
    expect(summarize(cust(), [bid({ status: "finalized" })], [], null, opts).attention[0].label).toMatch(/ready to send/);
    expect(summarize(cust(), [], [], { status: "replied", lastReplyAt: "2026-11-10", lastSentAt: "2026-11-01", awaitingReview: 0 }, opts).attention[0].label).toMatch(/replied/);
    // A teammate's bid is visible but its action belongs to the teammate.
    expect(summarize(cust(), [bid({ stage: "won", own: false })], [], null, opts).attention).toHaveLength(0);
  });

  it("last activity of an automatic record is its bids' activity, not the day it was created", () => {
    expect(summarize(cust(), [bid()], [], null, opts).lastActivity).toBe("2026-10-02T00:00:00Z");
    expect(summarize(cust({ source: "manual" }), [bid()], [], null, opts).lastActivity).toBe("2026-11-17T00:00:00Z");
  });

  it("metrics, filters, search and sorting agree", () => {
    const a = summarize(cust(), [bid({ stage: "sent", number: "B-1004" })], [], null, opts);
    const b = summarize(cust({ id: "c2", name: "Chris Rivera", email: null, phone: "555-010-7788", createdAt: "2026-11-18T00:00:00Z" }), [bid({ id: "b9", customerId: "c2", status: "finalized" })], [], null, opts);
    const c = summarize(cust({ id: "c3", name: "Ann Lee", email: null, phone: null }), [], [], null, opts);
    const list = [a, b, c];
    expect(hubMetrics(list)).toEqual({ total: 3, open: 2, projects: 0, attention: 1 });
    expect(list.filter((s) => matchesFocus(s, "attention")).map((s) => s.customer.id)).toEqual(["c2"]);
    expect(list.filter((s) => matchesFocus(s, "none")).map((s) => s.customer.id)).toEqual(["c3"]);
    expect(list.filter((s) => matchesSearch(s, "b-1004")).map((s) => s.customer.id)).toEqual(["c1"]);
    expect(list.filter((s) => matchesSearch(s, "7788")).map((s) => s.customer.id)).toEqual(["c2"]);
    expect(sortSummaries(list, "name").map((s) => s.customer.name)).toEqual(["Ann Lee", "Chris Rivera", "Pat Johnson"]);
    expect(sortSummaries(list, "created")[0].customer.id).toBe("c2");
  });

  it("flags possible duplicates within one account only", () => {
    const d = possibleDuplicates([
      cust({ id: "a", name: "John Smith", email: null, phone: null }),
      cust({ id: "b", name: "john  smith.", email: null, phone: null }),
      cust({ id: "c", name: "John Smith", email: null, phone: null, userId: "other" }),
      cust({ id: "d", name: "Jane", email: "pat@x.dev", phone: null }),
      cust({ id: "e", name: "Pat", email: "PAT@x.dev ", phone: null }),
    ]);
    expect(d.get("a")).toEqual(["b"]);
    expect(d.has("c")).toBe(false);
    expect(d.get("d")).toEqual(["e"]);
  });
});

describe("New bid for this customer", () => {
  it("remembers the customer once, and forgets it after 30 minutes", () => {
    const store = new Map<string, string>();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    rememberNewBidCustomer({ id: "c1", name: "Taylor", email: null, phone: null, address: null });
    expect(takeNewBidCustomer()?.name).toBe("Taylor");
    expect(takeNewBidCustomer()).toBeNull();
    rememberNewBidCustomer({ id: "c1", name: "Taylor", email: null, phone: null, address: null });
    expect(takeNewBidCustomer(Date.now() + 31 * 60_000)).toBeNull();
  });
});
