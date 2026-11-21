/**
 * V9 daily step: feature switch, sandbox books skipped, alerts + snapshot stored for real books, warning emails only when the
 * company turned them on and picked people, each new warning emailed once. Also the digest text and forecast accuracy.
 * Fake database + fake email provider; no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/demo/guard", () => ({ isDemoTenant: async () => false }));
vi.mock("@/lib/comms/send", () => ({
  fromHeader: (n: string, a: string) => `"${n}" <${a}>`, newRfcMessageId: () => "<m@x>",
  sendCommEmail: vi.fn(async (_k: string, m: { to: string }) => { sent.push(m.to); return { ok: true }; }),
}));
vi.mock("@/lib/cash-v9/load", () => ({
  isCashV9Enabled: () => process.env.NEXT_PUBLIC_CASH_V9 === "on",
  loadV9: vi.fn(async () => ({ installed: true, settings: { expenseMode: "known" }, base: {}, data: {} })),
}));
vi.mock("@/lib/cash-v9/engine", () => ({ buildV9: () => ({ forecast: { events: [] } }) }));
vi.mock("@/lib/cash-v9/run", () => ({
  previousSnapshot: async () => ({}),
  alertsFor: () => [{ kind: "low_cash", key: "low_cash", severity: "critical" }],
  persist: vi.fn(async (_a: unknown, bookId: string) => { persisted.push(bookId); return []; }),
}));

const sent: string[] = [];
const persisted: string[] = [];
const notified: string[][] = [];
const settings = [
  { book_id: "real", alert_email: true, alert_recipients: ["u1", "u2"] },
  { book_id: "sandbox", alert_email: true, alert_recipients: ["u1"] },
  { book_id: "quiet", alert_email: false, alert_recipients: ["u1"] },
];
const books: Record<string, Record<string, unknown>> = { real: { company_id: "c1", owner_user_id: null, sandbox_of: null }, sandbox: { sandbox_of: "real" }, quiet: { company_id: "c2", sandbox_of: null } };

function q(table: string) {
  const f: Record<string, unknown> = {};
  const api: Record<string, unknown> = {
    select: () => api, limit: async () => (table === "fin_cash_settings" ? { data: settings, error: null } : { data: [], error: null }),
    eq: (k: string, v: unknown) => { f[k] = v; return api; }, is: () => api, in: () => api, order: () => api,
    maybeSingle: async () => (table === "fin_books" ? { data: books[String(f.id)] ?? null } : { data: { name: "Acme Builders" } }),
  };
  if (table === "fin_cash_alerts") api.limit = async () => ({ data: [{ id: "a1", severity: "critical", title: "Cash drops below your minimum on Dec 3", body: "Lowest $-1,200.", actions: [{ href: "/financials/cash#events" }] }] });
  return api;
}
const admin = {
  from: (t: string) => q(t),
  rpc: async (fn: string, args: { p_ids: string[] }) => { if (fn === "fin_cash_alerts_mark_notified") notified.push(args.p_ids); return { data: null, error: null }; },
  auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@acme.test` } } }) } },
};
const cfg = { mode: "live", enabled: true, apiKey: "k", fromAddress: "noreply@built2bid.org", testRecipients: [] } as never;

import { alertDigest, runCashV9Daily } from "@/lib/cash-v9/daily";
const { accuracy, firstPredictions } = await vi.importActual<typeof import("@/lib/cash-v9/run")>("@/lib/cash-v9/run");

describe("cash-v9 daily", () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_CASH_V9 = "on"; sent.length = 0; persisted.length = 0; notified.length = 0; });
  afterEach(() => { delete process.env.NEXT_PUBLIC_CASH_V9; });

  it("does nothing while the switch is off", async () => {
    delete process.env.NEXT_PUBLIC_CASH_V9;
    expect(await runCashV9Daily(admin as never, "2026-12-01", cfg)).toEqual({ books: 0, alerts: 0, emailed: 0, skipped: 0 });
    expect(persisted).toEqual([]);
  });

  it("stores alerts for real books, skips sandboxes, emails only opted-in companies' chosen people once", async () => {
    const r = await runCashV9Daily(admin as never, "2026-12-01", cfg);
    expect(persisted).toEqual(["real", "quiet"]);
    expect(r).toMatchObject({ books: 2, skipped: 1, emailed: 2 });
    expect(sent).toEqual(["u1@acme.test", "u2@acme.test"]);
    expect(notified).toEqual([["a1"]]);
  });

  it("sends nothing while email is switched off for the site", async () => {
    await runCashV9Daily(admin as never, "2026-12-01", { ...(cfg as object), enabled: false } as never);
    expect(sent).toEqual([]);
    expect(notified).toEqual([]);
  });

  it("writes a plain digest that says these are forecasts", () => {
    const m = alertDigest("Acme", [{ severity: "critical", title: "Low cash Dec 3", body: "Lowest $-1,200.", href: "/financials/cash" }], "https://built2bid.org");
    expect(m.subject).toBe("Action needed: 1 new cash-flow warning for Acme");
    expect(m.text).toContain("https://built2bid.org/financials/cash");
    expect(m.text).toContain("not guarantees");
  });
});

describe("forecast accuracy", () => {
  it("uses each invoice's first prediction and compares to the paid date", () => {
    const pred = firstPredictions([
      { taken_on: "2026-11-10", items: [{ key: "inv:b", date: "2026-11-20" }, { key: "ms:x", date: "2026-11-25" }] },
      { taken_on: "2026-11-01", items: [{ key: "inv:a", date: "2026-11-15" }, { key: "inv:b", date: "2026-11-18" }] },
    ]);
    expect(pred).toEqual({ "inv:a": "2026-11-15", "inv:b": "2026-11-18" });
    const a = accuracy(Object.entries(pred).map(([key, date]) => ({ key, date })), { "inv:a": "2026-11-19", "inv:b": "2026-11-16" });
    expect(a).toEqual({ n: 2, meanAbsDays: 3, late: 1, early: 1 });
  });
});
