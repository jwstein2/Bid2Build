/**
 * Legal Documentation Status V1 against the real SQL: only platform admins can record a status, customers
 * (including Team/Enterprise admins) can't read notes or write anything, the public read exposes no notes,
 * history is append-only, and the migration is safe to run twice.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

d("Legal document status (database)", () => {
  let owner: string;
  let customer: string;
  const set = (caller: string, key: string, status: string, completed: string | null = null, notes: string | null = null) =>
    pool.query("select public.admin_legal_set_status($1, $2, $3, $4::date, $5) as r", [caller, key, status, completed, notes]).then((x) => x.rows[0].r as { ok: boolean; error?: string });

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_legal_status"));
    owner = await createUser(pool, "owner@test.dev");
    customer = await createUser(pool, "teamadmin@test.dev");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
  });
  afterAll(async () => { await drop?.(); });

  it("starts empty: every document falls back to its default", async () => {
    expect((await pool.query("select * from public.legal_public_statuses()")).rows).toEqual([]);
  });

  it("refuses non-admins and bad input", async () => {
    expect(await set(customer, "terms", "reviewed", "2026-11-20")).toEqual({ ok: false, error: "forbidden" });
    expect(await set(owner, "Terms!", "in_review")).toEqual({ ok: false, error: "bad_doc" });
    expect(await set(owner, "terms", "approved")).toEqual({ ok: false, error: "bad_status" });
    expect(await set(owner, "terms", "reviewed")).toEqual({ ok: false, error: "completion_date_required" });
    expect(await set(owner, "terms", "in_review", "2026-11-20")).toEqual({ ok: false, error: "completion_date_only_when_reviewed" });
    expect(await set(owner, "terms", "reviewed", "2999-01-01")).toEqual({ ok: false, error: "completion_date_future" });
    expect((await pool.query("select count(*)::int as n from public.legal_document_reviews")).rows[0].n).toBe(0);
  });

  it("records an admin's status with history, and the public read hides notes", async () => {
    expect(await set(owner, "terms", "in_review", null, "Sent to counsel, ref 123")).toEqual({ ok: true });
    expect(await set(owner, "terms", "revision_required", null, "Counsel asked for a liability edit")).toEqual({ ok: true });
    const pub = (await pool.query("select * from public.legal_public_statuses()")).rows;
    expect(pub).toEqual([{ doc_key: "terms", status: "revision_required", review_completed_on: null }]);
    const ev = (await pool.query("select old_status, new_status from public.legal_document_review_events where doc_key = 'terms' order by id")).rows;
    expect(ev).toEqual([{ old_status: "published_pending", new_status: "in_review" }, { old_status: "in_review", new_status: "revision_required" }]);
  });

  it("keeps history append-only", async () => {
    await expect(pool.query("delete from public.legal_document_review_events")).rejects.toThrow(/append-only/);
    await expect(pool.query("update public.legal_document_review_events set new_status = 'reviewed'")).rejects.toThrow(/append-only/);
  });

  it("gives signed-in customers no table access and no write function", async () => {
    await expect(asUser(pool, customer, (q) => q("select * from public.legal_document_reviews"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, customer, (q) => q("insert into public.legal_document_reviews (doc_key, status) values ('privacy', 'reviewed')"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, customer, (q) => q("select public.admin_legal_set_status($1, 'privacy', 'reviewed', current_date, null)", [owner]))).rejects.toThrow(/permission denied/);
    const rows = await asUser(pool, customer, (q) => q("select * from public.legal_public_statuses()"));
    expect(rows.rows.map((r) => Object.keys(r).sort())).toEqual([["doc_key", "review_completed_on", "status"]]);
  });

  it("is safe to run twice and keeps recorded statuses", async () => {
    await applyMigration(pool, "20270206001000_legal_document_status.sql");
    expect((await pool.query("select status from public.legal_document_reviews where doc_key = 'terms'")).rows[0].status).toBe("revision_required");
  });
});
