import { describe, expect, it } from "vitest";
import {
  FOCUS, analytics, bidEvents, boardSummary, checkMove, columnOf, columnTotals, filterBoard, isFocus, nextAction, resolveRange, stageForColumn, valueOf,
  type BoardBid, type FocusKey, type HistoryRow,
} from "@/lib/pipeline/board";
import { salesPay, sanitizePay } from "@/lib/pipeline/sales-pay";
import { STAGES as ENT_STAGES } from "@/lib/enterprise/pipeline";
import { STAGES } from "@/lib/pipeline/board";

const NOW = new Date("2026-11-15T12:00:00Z");
const d = (days: number) => new Date(NOW.getTime() - days * 864e5).toISOString();
let n = 0;
function bid(o: Partial<BoardBid> = {}): BoardBid {
  n++;
  return {
    id: `b${n}`, title: `Bid ${n}`, customer: "Cust", number: `B-${n}`, trades: ["siding"], status: "finalized", stage: "draft",
    createdAt: d(20), updatedAt: d(1), stageChangedAt: null, wonAt: null, lostReason: null,
    latestVersion: { id: `v${n}`, number: 1, total: 1000, subtotal: 1000, cost: 700 }, signing: { state: "none", signed: null, latest: null }, ...o,
  };
}
const signed = (at = d(3), total = 1200, versionNumber = 1) => ({ state: "signed" as const, signed: { id: "s1", at, versionNumber, total, pdfStatus: "ready" as const }, latest: { id: "r1", versionId: "v", expiresAt: d(-20), createdAt: d(5) } });
const awaiting = () => ({ state: "awaiting" as const, signed: null, latest: { id: "r2", versionId: "v", expiresAt: d(-20), createdAt: d(2) } });

describe("board columns", () => {
  it("keeps existing bids accessible: every stage maps to exactly one column", () => {
    for (const s of STAGES) expect(columnOf(bid({ stage: s }))).toBeTruthy();
    expect(columnOf(bid({ stage: "draft", status: "draft", latestVersion: null }))).toBe("draft");
    expect(columnOf(bid({ stage: "draft", status: "finalized" }))).toBe("ready");
    expect(columnOf(bid({ stage: "approved" }))).toBe("ready");
    expect(columnOf(bid({ stage: "pending" }))).toBe("awaiting");
  });
  it("a real signature places the bid at Won or later; a manual stage never implies a signature", () => {
    expect(columnOf(bid({ stage: "sent", signing: signed() }))).toBe("won");
    expect(columnOf(bid({ stage: "in_progress", signing: signed() }))).toBe("in_progress");
    const manual = bid({ stage: "won", wonAt: d(2) });
    expect(columnOf(manual)).toBe("won");
    expect(manual.signing?.signed).toBeNull();
  });
  it("an active signing link shows the bid as Awaiting Signature", () => {
    expect(columnOf(bid({ stage: "draft", status: "draft", signing: awaiting() }))).toBe("awaiting");
    expect(columnOf(bid({ stage: "won", signing: awaiting() }))).toBe("won");
  });
  it("lost wins over a signature (cancelled job) and is a separate outcome", () => {
    expect(columnOf(bid({ stage: "lost", signing: signed() }))).toBe("lost");
  });
  it("Ready keeps an Enterprise approved stage", () => {
    expect(stageForColumn("ready", { stage: "approved" })).toBe("approved");
    expect(stageForColumn("ready", { stage: "sent" })).toBe("ready_for_review");
    expect(stageForColumn("awaiting", { stage: "sent" })).toBe("pending");
  });
  it("Enterprise and contractor pipelines share one stage list", () => {
    expect([...ENT_STAGES].sort()).toEqual([...STAGES].sort());
  });
});

describe("moves", () => {
  it("prevents fabricating or undoing a signature", () => {
    const s = bid({ stage: "sent", signing: signed() });
    expect(checkMove(s, "sent")).toMatchObject({ ok: false });
    expect(checkMove(s, "draft")).toMatchObject({ ok: false });
    expect(checkMove(s, "lost")).toMatchObject({ ok: true, confirm: "lost" });
    expect(checkMove(s, "scheduled")).toMatchObject({ ok: true });
  });
  it("blocks moving back while a signing link is out", () => {
    expect(checkMove(bid({ stage: "pending", signing: awaiting() }), "ready")).toMatchObject({ ok: false });
  });
  it("job stages need a won bid", () => {
    expect(checkMove(bid({ stage: "sent" }), "scheduled")).toMatchObject({ ok: false });
    expect(checkMove(bid({ stage: "won" }), "scheduled")).toEqual({ ok: true, confirm: null });
  });
  it("asks for confirmation on won, lost and reopening", () => {
    expect(checkMove(bid({ stage: "sent" }), "won")).toEqual({ ok: true, confirm: "won" });
    expect(checkMove(bid({ stage: "won" }), "sent")).toEqual({ ok: true, confirm: "reopen" });
    expect(checkMove(bid({ stage: "lost" }), "won")).toEqual({ ok: true, confirm: "won" });
    expect(checkMove(bid({ stage: "draft", status: "draft" }), "ready")).toEqual({ ok: true, confirm: null });
  });
  it("archived bids are not moved from the board", () => {
    expect(checkMove(bid({ status: "archived" }), "sent")).toMatchObject({ ok: false });
  });
});

describe("next action", () => {
  it("one context-aware action per stage", () => {
    expect(nextAction(bid({ status: "draft", latestVersion: null }), true)?.label).toBe("Continue estimate");
    expect(nextAction(bid({ stage: "ready_for_review" }), true)?.label).toBe("Send proposal");
    expect(nextAction(bid({ stage: "sent" }), true)?.label).toBe("Request signature");
    expect(nextAction(bid({ stage: "sent" }), false)?.label).toBe("Review proposal");
    expect(nextAction(bid({ stage: "pending", signing: awaiting() }), true)?.label).toBe("Review customer response");
    expect(nextAction(bid({ stage: "won" }), true)).toMatchObject({ label: "Schedule Now", move: "scheduled" });
    expect(nextAction(bid({ stage: "in_progress" }), true)?.label).toBe("Mark completed");
  });
});

describe("totals", () => {
  it("counts each bid once and never counts drafts as revenue", () => {
    const bids = [
      bid({ stage: "draft", status: "draft", latestVersion: null }),
      bid({ stage: "ready_for_review" }), bid({ stage: "sent" }), bid({ stage: "pending", signing: awaiting() }),
      bid({ stage: "sent", signing: signed(d(3), 1200) }), // signed: Won, valued at the signed total
      bid({ stage: "completed", wonAt: d(30) }), bid({ stage: "lost" }),
    ];
    const t = columnTotals(bids);
    const totalCount = Object.values(t).reduce((s, c) => s + c.count, 0);
    expect(totalCount).toBe(bids.length);
    expect(t.draft).toEqual({ count: 1, value: 0, unpriced: 1 });
    expect(t.won.value).toBe(1200);
    const s = boardSummary(bids);
    expect(s.activeValue).toBe(3000);
    expect(s.openCount).toBe(4);
    expect(s.wonValue).toBe(2200);
    expect(s.awaitingCount).toBe(1);
    expect(s.winRate).toBeNull(); // only 3 decided
    expect(s.decided).toBe(3);
  });
  it("shows a win rate once enough bids are decided", () => {
    const bids = [...Array(4)].map(() => bid({ stage: "won", wonAt: d(1) })).concat([bid({ stage: "lost" })]);
    expect(boardSummary(bids).winRate).toBe(80);
  });
  it("uses the signed total over the latest version", () => {
    expect(valueOf(bid({ signing: signed(d(1), 999) }))).toBe(999);
    expect(valueOf(bid({ latestVersion: null }))).toBeNull();
  });
});

describe("date filters and historical analytics", () => {
  it("resolves ranges", () => {
    expect(resolveRange("all", NOW)).toEqual({ from: null, to: null });
    expect(resolveRange("30d", NOW).from?.toISOString()).toBe(d(30));
    const m = resolveRange("month", NOW).from!;
    expect([m.getDate(), m.getMonth()]).toEqual([1, NOW.getMonth()]);
    const c = resolveRange("custom", NOW, { from: "2026-11-01", to: "2026-11-10" });
    expect(c.to!.getTime() - c.from!.getTime()).toBe(10 * 864e5);
  });
  it("board filter applies to the labeled date only", () => {
    const old = bid({ createdAt: d(200), updatedAt: d(1) });
    const r = resolveRange("30d", NOW);
    expect(filterBoard([old], r, "activity")).toHaveLength(1);
    expect(filterBoard([old], r, "created")).toHaveLength(0);
  });
  it("counts events in the period, not the current stage", () => {
    const h: HistoryRow[] = [];
    const wonOld = bid({ stage: "completed", createdAt: d(120), wonAt: d(100) });
    h.push({ estimate_id: wonOld.id, from_stage: "sent", to_stage: "won", created_at: d(100), effective_at: d(100) },
      { estimate_id: wonOld.id, from_stage: "won", to_stage: "scheduled", created_at: d(5) },
      { estimate_id: wonOld.id, from_stage: "in_progress", to_stage: "completed", created_at: d(2) });
    const wonNew = bid({ stage: "won", createdAt: d(25), wonAt: d(10) });
    h.push({ estimate_id: wonNew.id, from_stage: "sent", to_stage: "won", created_at: d(10), effective_at: d(10) });
    const lost = bid({ stage: "lost", createdAt: d(40) });
    h.push({ estimate_id: lost.id, from_stage: "sent", to_stage: "lost", created_at: d(3) });
    const a = analytics([wonOld, wonNew, lost], h, resolveRange("30d", NOW));
    expect(a.won).toBe(1); // completing an old job is not a new win
    expect(a.lost).toBe(1);
    expect(a.created).toBe(1);
    expect(a.avgDaysToWin).toBe(15);
    expect(a.winRate).toBeNull();
  });
  it("won then lost counts only the latest outcome; signature after manual win is one win", () => {
    const b1 = bid({ stage: "lost" });
    const h: HistoryRow[] = [
      { estimate_id: b1.id, from_stage: "sent", to_stage: "won", created_at: d(10) },
      { estimate_id: b1.id, from_stage: "won", to_stage: "lost", created_at: d(4) },
    ];
    expect(bidEvents(b1, h).outcome).toMatchObject({ kind: "lost" });
    const b2 = bid({ stage: "won", signing: signed(d(2)) });
    const h2: HistoryRow[] = [{ estimate_id: b2.id, from_stage: "sent", to_stage: "won", created_at: d(6) }];
    expect(bidEvents(b2, h2).outcome).toEqual({ kind: "won", at: d(6), via: "esign" });
    const a = analytics([b1, b2], [...h, ...h2], resolveRange("all", NOW));
    expect(a.won + a.lost).toBe(2);
  });
  it("legacy won bids without history use the backfilled won date", () => {
    const b = bid({ stage: "won", wonAt: d(8) });
    expect(bidEvents(b, []).outcome).toEqual({ kind: "won", at: d(8), via: "manual" });
  });
  it("sent = first move to Sent or the first signing link", () => {
    const b = bid({ stage: "pending", signing: awaiting() });
    expect(bidEvents(b, []).sentAt).toBe(d(2));
    expect(bidEvents(b, [{ estimate_id: b.id, from_stage: "ready_for_review", to_stage: "sent", created_at: d(9) }]).sentAt).toBe(d(9));
  });
});

describe("sales pay calculator", () => {
  const bids = [{ id: "a", value: 10800, subtotal: 10000, cost: 7000 }, { id: "b", value: 5000, subtotal: 5000, cost: 5600 }, { id: "c", value: null, subtotal: null, cost: null }];
  it("percent of sale uses the pre-tax price", () => {
    const r = salesPay(sanitizePay({ method: "percent_sale", rate: 10 }), bids);
    expect(r.lines.map((l) => l.earnings)).toEqual([1000, 500, null]);
    expect(r.skipped).toBe(1);
  });
  it("percent of gross profit never goes negative", () => {
    const r = salesPay(sanitizePay({ method: "percent_profit", rate: 20 }), bids);
    expect(r.lines.map((l) => l.earnings)).toEqual([600, 0, null]);
  });
  it("commissionable base, flat fee and base pay", () => {
    expect(salesPay(sanitizePay({ method: "percent_base", rate: 10, baseExclusions: 20 }), [bids[0]]).total).toBe(800);
    expect(salesPay(sanitizePay({ method: "flat", flatFee: 250, baseSalary: 1000 }), bids).total).toBe(1750);
  });
  it("does not change the bids it reads", () => {
    const copy = JSON.parse(JSON.stringify(bids));
    salesPay(sanitizePay({ method: "percent_sale", rate: 50 }), bids);
    expect(bids).toEqual(copy);
  });
  it("sanitizes bad input", () => {
    expect(sanitizePay({ method: "x" as never, rate: 500, flatFee: -3 })).toMatchObject({ method: "percent_sale", rate: 100, flatFee: 0 });
  });
});

describe("bids dashboard KPI drilldowns", () => {
  const bids = [
    bid({ stage: "draft", status: "draft", latestVersion: null }), bid({ stage: "draft" }), bid({ stage: "sent" }), bid({ signing: awaiting() }),
    bid({ stage: "won", wonAt: d(2) }), bid({ stage: "scheduled", wonAt: d(9) }), bid({ stage: "lost" }), bid({ signing: signed() }),
  ];
  const inFocus = (k: FocusKey) => bids.filter((b) => (FOCUS[k].columns as readonly string[]).includes(columnOf(b))).length;
  it("each card's filter shows exactly the bids it counts", () => {
    const s = boardSummary(bids);
    const t = columnTotals(bids);
    expect(inFocus("open")).toBe(s.openCount);
    expect(inFocus("awaiting")).toBe(s.awaitingCount);
    expect(inFocus("won")).toBe(s.wonCount);
    expect(inFocus("decided")).toBe(s.decided);
    expect(inFocus("draft")).toBe(t.draft.count);
    expect(inFocus("sent")).toBe(t.sent.count);
    const active = bids.filter((b) => (FOCUS.active.columns as readonly string[]).includes(columnOf(b))).reduce((n, b) => n + (valueOf(b) ?? 0), 0);
    expect(active).toBe(s.activeValue);
  });
  it("validates ?focus= and exposes the bids behind each analytics tile", () => {
    expect(isFocus("awaiting")).toBe(true);
    expect(isFocus("hasOwnProperty")).toBe(false);
    const a = analytics(bids, [], resolveRange("all", NOW));
    expect(a.ids.created).toHaveLength(a.created);
    expect(a.ids.won).toHaveLength(a.won);
    expect(a.ids.lost).toHaveLength(a.lost);
    expect(a.ids.awaiting).toHaveLength(a.awaitingNow);
  });
});
