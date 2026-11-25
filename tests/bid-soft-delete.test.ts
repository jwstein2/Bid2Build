import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deleteBlock, deleteWarning, type BoardBid } from "@/lib/pipeline/board";
import { companyRpcError } from "@/lib/enterprise/errors";

const iso = "2026-11-20T12:00:00Z";
function bid(o: Partial<BoardBid> = {}): BoardBid {
  return {
    id: "b1", title: "Bid", customer: "Cust", number: "B-1", trades: ["roofing"], status: "draft", stage: "draft",
    createdAt: iso, updatedAt: iso, stageChangedAt: null, wonAt: null, lostReason: null, latestVersion: null,
    signing: { state: "none", signed: null, latest: null }, ...o,
  };
}
const signed = { state: "signed" as const, signed: { id: "s1", at: iso, versionNumber: 1, total: 100, pdfStatus: "ready" as const }, latest: null };
const awaiting = { state: "awaiting" as const, signed: null, latest: { id: "r", versionId: "v", expiresAt: iso, createdAt: iso } };

describe("deleting a bid", () => {
  it("allows drafts, ready, sent and lost bids", () => {
    for (const stage of ["draft", "ready_for_review", "approved", "sent", "pending", "lost"] as const) expect(deleteBlock(bid({ stage }))).toBeNull();
  });
  it("keeps signed, won, job and project bids on record", () => {
    expect(deleteBlock(bid({ signing: signed }))).toMatch(/e-signed/);
    for (const stage of ["won", "scheduled", "in_progress", "completed"] as const) expect(deleteBlock(bid({ stage }))).toMatch(/Lost \/ Declined/);
    expect(deleteBlock(bid({ scheduleId: "p1" }))).toMatch(/project/);
  });
  it("warns before deleting a bid the customer may have", () => {
    expect(deleteWarning(bid())).toBeNull();
    expect(deleteWarning(bid({ stage: "sent" }))).toMatch(/customer may already have/);
    expect(deleteWarning(bid({ stage: "sent", signing: awaiting }))).toMatch(/signing link/);
  });
  it("maps the database refusals to plain messages", () => {
    expect(companyRpcError({ message: "delete_signed" }).status).toBe(409);
    expect(companyRpcError({ message: "delete_has_invoices" }).message).toMatch(/invoices or payments/);
    expect(companyRpcError({ message: "delete_has_project" }).code).toBe("delete_has_project");
  });
});

describe("soft delete migration", () => {
  const sql = readFileSync("supabase/migrations/20270228001000_bid_soft_delete.sql", "utf8");
  it("hides deleted bids in both estimates policies and blocks plain updates of deleted_at", () => {
    const own = sql.slice(sql.indexOf("create policy estimates_own_all"), sql.indexOf("drop policy if exists estimates_company_select"));
    expect(own.match(/deleted_at is null/g)?.length).toBe(2);   // using + with check
    expect(sql).toMatch(/create policy estimates_company_select[\s\S]*?deleted_at is null/);
  });
  it("writes an audit row for every delete and restore and never erases the bid", () => {
    expect(sql.match(/insert into public\.estimate_deletions/g)?.length).toBe(2);
    expect(sql).not.toMatch(/delete from public\.estimates/);
    expect(sql).toMatch(/'bid\.deleted'/);
    expect(sql).toMatch(/'bid\.restored'/);
  });
  it("refuses bids that must stay on record", () => {
    for (const code of ["delete_signed", "delete_won", "delete_has_project", "delete_has_invoices"]) expect(sql).toContain(`'${code}'`);
  });
});
