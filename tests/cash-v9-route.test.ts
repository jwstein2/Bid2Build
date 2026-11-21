/**
 * V9 cash-forecast API: feature flag, input validation, and milestone confirmation using the server's own reading of
 * schedule progress (never a percent sent by the browser). Fake guard + fake database; no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const MS = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const calls: { fn: string; args: Record<string, unknown> }[] = [];
const progress = { value: 42 as number | null, threshold: 30 as number | null };

const db = {
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: "trig-1", error: null }; }),
  from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { job_id: JOB } }) }) }) })),
};
vi.mock("@/lib/financials/api", () => ({
  finGuard: vi.fn(async () => ({ db, bookId: "book-1", user: { id: "u1" } })),
  finFail: (e: { code?: string }) => Response.json({ error: { code: e.code ?? "server_error" } }, { status: 409 }),
}));
vi.mock("@/lib/cash-v9/load", () => ({
  isCashV9Enabled: () => process.env.NEXT_PUBLIC_CASH_V9 === "on",
  loadJobCostTiming: vi.fn(async () => ({ commitments: [], costCodes: [] })),
  loadJobProgress: vi.fn(async () => ({ hasSchedule: true, scheduleDraft: false, sections: [], milestones: [
    { id: MS, seq: 2, description: "Rough-in", triggerKind: "phase_complete", amount: 5000, state: "not_triggered",
      rule: progress.threshold === null ? null : { threshold: progress.threshold, method: "weight", sectionKey: null }, progress: progress.value, eligible: true, projectedOn: null, slipDays: 0 }] })),
}));

import { GET, POST } from "@/app/api/financials/cash-v9/route";

const post = async (body: unknown) => (await POST(new Request("http://x/api/financials/cash-v9", { method: "POST", body: JSON.stringify(body) })))!;
const get = async (url: string) => (await GET(new Request(url)))!;

describe("cash-v9 route", () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_CASH_V9 = "on"; calls.length = 0; progress.value = 42; progress.threshold = 30; });
  afterEach(() => { delete process.env.NEXT_PUBLIC_CASH_V9; });

  it("is hidden while the feature switch is off", async () => {
    delete process.env.NEXT_PUBLIC_CASH_V9;
    expect((await post({ action: "alert_set", alertId: MS, p: { status: "resolved" } })).status).toBe(404);
    expect((await get(`http://x/api/financials/cash-v9?jobId=${JOB}`)).status).toBe(404);
  });

  it("rejects bad input before touching the database", async () => {
    expect((await post({ action: "settings_save", p: { collectionDays: 999 } })).status).toBe(400);
    expect((await get("http://x/api/financials/cash-v9?jobId=nope")).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("confirms with the server's progress, ignoring any percent from the browser", async () => {
    const r = await post({ action: "progress_confirm", milestoneId: MS, p: { note: "Walked it", percent: 100 } });
    expect(r.status).toBe(200);
    expect(calls).toEqual([{ fn: "fin_milestone_progress_confirm", args: { p_milestone_id: MS, p: { percent: 42, method: "weight", note: "Walked it" } } }]);
  });

  it("refuses to confirm below the threshold or without a rule", async () => {
    progress.value = 20;
    expect((await post({ action: "progress_confirm", milestoneId: MS, p: {} })).status).toBe(409);
    progress.value = 50; progress.threshold = null;
    expect((await post({ action: "progress_confirm", milestoneId: MS, p: {} })).status).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it("passes settings through to the permission-checked database function", async () => {
    const p = { minCash: "25000", collectionDays: 14, collectionBasis: "due", useHistory: true, historyMinSample: 3, expenseMode: "benchmark", benchmark: { material: 35 },
      payrollFromSchedule: false, payrollPayLagDays: 5, payrollBurdenPct: 0, subPayDays: 7, supplierPayDays: 30, conservativeLateDays: 14, conservativeCostPct: 10,
      arGraceDays: 7, concentrationDays: 7, concentrationPct: 50, alertEmail: false, alertRecipients: [], alertKindsOff: ["forecast_confidence"] };
    expect((await post({ action: "settings_save", p })).status).toBe(200);
    expect(calls[0]).toEqual({ fn: "fin_cash_settings_save", args: { p_book_id: "book-1", p } });
  });

  it("returns a job's progress and cost timing", async () => {
    const a = await (await get(`http://x/api/financials/cash-v9?jobId=${JOB}`)).json();
    expect(a.milestones[0].progress).toBe(42);
    const b = await (await get(`http://x/api/financials/cash-v9?jobId=${JOB}&view=costs`)).json();
    expect(b).toEqual({ commitments: [], costCodes: [] });
  });
});
