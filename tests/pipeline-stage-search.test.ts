import { describe, expect, it } from "vitest";
import { columnTotals, nextAction, type BoardBid } from "@/lib/pipeline/board";
import { matchBid, normaliseQuery, searchStages, sortStage } from "@/lib/pipeline/stage-search";

const NOW = new Date("2026-11-20T12:00:00Z");
const d = (days: number) => new Date(NOW.getTime() - days * 864e5).toISOString();
let n = 0;
function bid(o: Partial<BoardBid> = {}): BoardBid {
  n++;
  return {
    id: `b${n}`, title: `Bid ${n}`, customer: "Cust", number: `B-${1000 + n}`, trades: ["decks"], status: "finalized", stage: "draft",
    createdAt: d(20), updatedAt: d(n), stageChangedAt: null, wonAt: null, lostReason: null,
    latestVersion: { id: `v${n}`, number: 1, total: 1000 * n, subtotal: null, cost: null }, signing: { state: "none", signed: null, latest: null }, ...o,
  };
}
const draft = (o: Partial<BoardBid> = {}) => bid({ status: "draft", latestVersion: null, ...o });

describe("stage search", () => {
  const johnDraft = draft({ customer: "John Anderson", title: "Basement finish" });
  const johnAwaiting = bid({ customer: "John Anderson", title: "Deck Replacement", stage: "pending" });
  const johnsonSent = bid({ customer: "Pat Johnson", title: "Siding", stage: "sent", customerEmail: "pat@example.test", address: "48 Oak Lane" });
  const other = bid({ customer: "Riley Wright", title: "Composite deck", stage: "won" });
  const all = [johnDraft, johnAwaiting, johnsonSent, other, ...Array.from({ length: 20 }, () => draft({ customer: "Filler Co" }))];

  it("finds the bid in another stage when the searched stage has none", () => {
    const r = searchStages(all, "deck replacement", "draft");
    expect(r.local).toHaveLength(0);
    expect(r.other.map((m) => [m.bid.id, m.column])).toEqual([[johnAwaiting.id, "awaiting"]]);
  });

  it("lists local matches first and still shows the customer's bids in other stages, each separately", () => {
    const r = searchStages(all, "john", "draft");
    expect(r.local.map((m) => m.bid.id)).toEqual([johnDraft.id]);
    expect(r.other.map((m) => m.bid.id)).toEqual(expect.arrayContaining([johnAwaiting.id, johnsonSent.id]));
    expect(r.other.find((m) => m.bid.id === johnAwaiting.id)?.column).toBe("awaiting");
  });

  it("is case-insensitive, partial, and ranks exact and word-start matches above contains", () => {
    const r = searchStages(all, "  JOHN  ", null);
    // "John Anderson" (word start) outranks "Pat Johnson" only by score ties broken by activity; both match.
    expect(r.other.length).toBe(3);
    expect(searchStages(all, "ohn", null).other.length).toBe(3);
    const exact = bid({ customer: "Deck", title: "x" });
    const contains = bid({ customer: "Redeck Inc", title: "y" });
    const ranked = searchStages([contains, exact], "deck", null).other.map((m) => m.bid.id);
    expect(ranked[0]).toBe(exact.id);
  });

  it("searches bid number, email and address; letters alone never match bid numbers", () => {
    expect(matchBid(johnsonSent, normaliseQuery(johnsonSent.number))?.field).toBe("number");
    expect(matchBid(johnsonSent, johnsonSent.number.replace(/\D/g, ""))?.field).toBe("number");
    expect(matchBid(johnsonSent, "pat@example")?.field).toBe("email");
    expect(matchBid(johnsonSent, "example.test")?.field).toBe("email");
    expect(matchBid(johnsonSent, "oak lane")?.field).toBe("address");
    expect(matchBid(bid({ customer: "Zed", title: "Zed" }), "b")).toBeNull();
  });

  it("covers every loaded bid, not just the first four in a stage", () => {
    const deep = draft({ customer: "Needle Haystack", updatedAt: d(400) });
    const r = searchStages([...all, deep], "needle", "draft");
    expect(r.local.map((m) => m.bid.id)).toEqual([deep.id]);
  });

  it("reports the bid's current stage after a move", () => {
    const moved = { ...johnDraft, stage: "sent" as const, status: "finalized" as const, latestVersion: { id: "v", number: 1, total: 5, subtotal: null, cost: null } };
    expect(searchStages([moved], "basement", "draft").other[0].column).toBe("sent");
  });

  it("never changes counts, totals or the bids themselves", () => {
    const before = JSON.stringify(all);
    const totals = columnTotals(all);
    searchStages(all, "john", "draft");
    expect(JSON.stringify(all)).toBe(before);
    expect(columnTotals(all)).toEqual(totals);
  });

  it("empty query returns nothing", () => {
    expect(searchStages(all, "   ", "draft")).toEqual({ local: [], other: [] });
  });
});

describe("stage sort", () => {
  const a = bid({ updatedAt: d(1), latestVersion: { id: "a", number: 1, total: 500, subtotal: null, cost: null } });
  const b = bid({ updatedAt: d(9), latestVersion: { id: "b", number: 1, total: 9000, subtotal: null, cost: null } });
  const c = draft({ updatedAt: d(5) });
  it("recent, oldest, highest and lowest value (unpriced last)", () => {
    expect(sortStage([b, c, a], "recent").map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    expect(sortStage([a, c, b], "oldest").map((x) => x.id)).toEqual([b.id, c.id, a.id]);
    expect(sortStage([a, c, b], "value_desc").map((x) => x.id)).toEqual([b.id, a.id, c.id]);
    expect(sortStage([c, b, a], "value_asc").map((x) => x.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe("job card actions with a project schedule", () => {
  it("Scheduled opens the company calendar; In Progress and Completed open the project", () => {
    const s = (stage: BoardBid["stage"]) => nextAction(bid({ stage, wonAt: d(3), scheduleId: "sched-1" }), true, true);
    expect(s("scheduled")).toEqual({ label: "View schedule", href: "/projects?view=calendar&project=sched-1" });
    expect(s("in_progress")).toEqual({ label: "View project", href: "/projects/sched-1" });
    expect(s("completed")).toEqual({ label: "View completed project", href: "/projects/sched-1" });
  });
  it("without scheduling or a schedule, the existing moves stay", () => {
    expect(nextAction(bid({ stage: "scheduled", scheduleId: "x" }), true, false)).toEqual({ label: "Start job", move: "in_progress" });
    expect(nextAction(bid({ stage: "in_progress" }), true, true)).toEqual({ label: "Mark completed", move: "completed" });
  });
});
