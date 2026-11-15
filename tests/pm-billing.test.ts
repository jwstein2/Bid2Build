/**
 * PM add-on and Enterprise editor billing rules, the webhook mapping, and the purchase routes
 * (Stripe mocked; test mode only).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addonItemUpdates, checkEditorTarget, editorItemUpdates, editorMonthlyCents, planInterval, pmFromItems, pmPriceMismatch,
  PM_ADDON_CENTS, PM_EDITOR_CENTS,
} from "@/lib/pm/billing";
import { subscriptionToUpdate } from "@/lib/billing/sync";

const P = { addonMonthly: "price_pm_m", addonAnnual: undefined as string | undefined, editor: "price_pm_ed" };
const monthly = { id: "si_plan", price: { id: "price_monthly", recurring: { interval: "month" } }, quantity: 1 };
const annual = { id: "si_plan", price: { id: "price_annual", recurring: { interval: "year" } }, quantity: 1 };
const addon = { id: "si_pm", price: { id: "price_pm_m", recurring: { interval: "month" } }, quantity: 1 };
const entBase = { id: "si_base", price: { id: "price_ent_base", recurring: { interval: "month" } }, quantity: 1 };
const editors = (q: number) => ({ id: "si_ed", price: { id: "price_pm_ed", recurring: { interval: "month" } }, quantity: q });

describe("PM billing rules", () => {
  it("prices match the brief: $4.99 add-on, $1.99 per extra editor", () => {
    expect(PM_ADDON_CENTS).toBe(499);
    expect(PM_EDITOR_CENTS).toBe(199);
    expect(editorMonthlyCents(3)).toBe(597);
  });
  it("reads the add-on and extra editors from subscription items", () => {
    expect(pmFromItems([monthly], P)).toEqual({ addon: false, extraEditors: 0 });
    expect(pmFromItems([monthly, addon], P)).toEqual({ addon: true, extraEditors: 0 });
    expect(pmFromItems([entBase, editors(2)], P)).toEqual({ addon: false, extraEditors: 2 });
  });
  it("adds the add-on only on a matching interval; annual waits for a yearly price", () => {
    expect(addonItemUpdates([monthly], P, true)).toEqual([{ price: "price_pm_m", quantity: 1 }]);
    expect(addonItemUpdates([monthly, addon], P, true)).toEqual([]);
    expect(addonItemUpdates([annual], P, true)).toEqual({ error: "annual_unavailable" });
    expect(addonItemUpdates([annual], { ...P, addonAnnual: "price_pm_y" }, true)).toEqual([{ price: "price_pm_y", quantity: 1 }]);
    expect(addonItemUpdates([monthly, addon], P, false)).toEqual([{ id: "si_pm", deleted: true }]);
    expect(planInterval([addon, annual], P)).toBe("year"); // the plan item, not the add-on
  });
  it("sets, adds or deletes the editor item", () => {
    expect(editorItemUpdates([entBase], P, 2)).toEqual([{ price: "price_pm_ed", quantity: 2 }]);
    expect(editorItemUpdates([entBase, editors(2)], P, 5)).toEqual([{ id: "si_ed", quantity: 5 }]);
    expect(editorItemUpdates([entBase, editors(2)], P, 0)).toEqual([{ id: "si_ed", deleted: true }]);
    expect(editorItemUpdates([entBase], P, 0)).toEqual([]);
  });
  it("never drops editor seats below the people assigned", () => {
    expect(checkEditorTarget(0, 2, 2)).toMatchObject({ ok: false, code: "below_assigned" });
    expect(checkEditorTarget(1, 2, 2)).toEqual({ ok: true });
    expect(checkEditorTarget(2, 2, 1)).toMatchObject({ code: "unchanged" });
    expect(checkEditorTarget(-1, 0, 0)).toMatchObject({ code: "invalid" });
  });
  it("checks configured Stripe prices", () => {
    const ok = { currency: "usd", unit_amount: 499, recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } };
    expect(pmPriceMismatch(ok, 499)).toBeNull();
    expect(pmPriceMismatch({ ...ok, unit_amount: 500 }, 499)).toMatch(/amount/);
    expect(pmPriceMismatch({ ...ok, recurring: { ...ok.recurring, interval: "year" } }, 499)).toMatch(/every month/);
  });
  it("the webhook mapping keeps the plan item (not the add-on) as the subscription's plan and price", () => {
    const sub = { id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false, canceled_at: null, ended_at: null,
      items: { data: [{ ...addon, current_period_end: 2_000_000_000 }, { ...monthly, current_period_end: 2_000_000_000 }] } };
    const u = subscriptionToUpdate(sub, "u1", 1, { monthly: "price_monthly", annual: "price_annual", pmAddonMonthly: "price_pm_m", pmEditor: "price_pm_ed" });
    expect(u.p_plan).toBe("monthly");
    expect(u.p_price_id).toBe("price_monthly");
  });
});

// ---------------------------------------------------------------- routes
const S = {
  user: { id: "u1" } as { id: string } | null,
  company: null as null | Record<string, unknown>,
  subRow: null as null | Record<string, unknown>,
  items: [] as unknown[],
  previewLines: [] as { amount: number; parent?: unknown }[],
  updates: [] as Record<string, unknown>[],
  pm: { editorsAssigned: 1 } as Record<string, unknown>,
  audit: [] as unknown[],
};
const fakeStripe = {
  prices: { retrieve: async (id: string) => ({ id, currency: "usd", unit_amount: id === "price_pm_ed" ? 199 : 499, recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } }) },
  subscriptions: {
    retrieve: async () => ({ id: "sub_1", items: { data: S.items } }),
    update: async (_id: string, params: Record<string, unknown>) => { S.updates.push(params); return { id: "sub_1", items: { data: S.items } }; },
  },
  invoices: { createPreview: async (params: Record<string, unknown>) => { S.updates.push({ preview: params }); return { lines: { data: S.previewLines }, amount_due: 0 }; } },
};
const chain = (result: () => unknown) => {
  const c: Record<string, unknown> = {};
  for (const k of ["select", "eq", "neq", "in", "order", "limit"]) c[k] = () => c;
  c.maybeSingle = async () => ({ data: result(), error: null });
  c.insert = async (row: unknown) => { S.audit.push(row); return { error: null }; };
  return c;
};
vi.mock("@/lib/billing/stripe", () => ({ getStripe: () => fakeStripe, assertModeAllowed: () => {} }));
vi.mock("@/lib/billing/apply", () => ({ applySubscription: async () => ({ applied: true, userId: "u1" }) }));
vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => S.user,
  createClient: async () => ({ rpc: async (n: string) => ({ data: n === "my_pm_access" ? S.pm : null, error: null }) }),
  createAdminClient: () => ({ from: () => chain(() => S.subRow) }),
}));
vi.mock("@/lib/enterprise/server", () => ({
  loadMyCompany: async () => S.company,
  can: (c: { permissions: string[] }, p: string) => c.permissions.includes(p),
  companySubscription: async () => S.subRow,
}));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true, rateLimit: async () => true }));

const post = async (path: "addon" | "editors", body: unknown) => {
  const mod = path === "addon" ? await import("@/app/api/billing/pm-addon/route") : await import("@/app/api/company/pm-editors/route");
  return mod.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }));
};
const proration = (amount: number) => ({ amount, parent: { subscription_item_details: { proration: true } } });

describe("PM add-on route (Standard Unlimited)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_PROJECT_SCHEDULING", "on");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x"); vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly"); vi.stubEnv("STRIPE_PRICE_ANNUAL", "price_annual");
    vi.stubEnv("STRIPE_PRICE_PM_ADDON", "price_pm_m"); vi.stubEnv("STRIPE_PRICE_PM_EDITOR", "price_pm_ed");
    Object.assign(S, { user: { id: "u1" }, company: null, items: [monthly], previewLines: [proration(312)], updates: [], audit: [],
      subRow: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "active", plan: "monthly", current_period_end: "2026-12-01T00:00:00Z", cancel_at_period_end: false } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is off until project scheduling is switched on", async () => {
    vi.stubEnv("NEXT_PUBLIC_PROJECT_SCHEDULING", "");
    expect((await post("addon", { action: "preview" })).status).toBe(503);
  });
  it("is off with a live key until PM_BILLING_LIVE=true", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_x");
    expect((await post("addon", { action: "preview" })).status).toBe(503);
  });
  it("preview shows the new charge, interval, effective date and prorated amount without changing anything", async () => {
    const r = await post("addon", { action: "preview" });
    const j = await r.json();
    expect(j).toMatchObject({ monthlyCents: 499, interval: "month", dueNowCents: 312, nextInvoiceAt: "2026-12-01T00:00:00Z" });
    expect(S.updates).toHaveLength(1);
    expect(S.updates[0]).toHaveProperty("preview");
  });
  it("add charges the prorated amount now; remove has no proration (editing stays on until period end)", async () => {
    expect((await post("addon", { action: "add", prorationDate: 1_800_000_000, attempt: "attempt-123" })).status).toBe(200);
    expect(S.updates.at(-1)).toMatchObject({ items: [{ price: "price_pm_m", quantity: 1 }], proration_behavior: "always_invoice", payment_behavior: "error_if_incomplete" });
    S.items = [monthly, addon];
    const r = await post("addon", { action: "remove" });
    expect(await r.json()).toMatchObject({ ok: true, addon: false, editUntil: "2026-12-01T00:00:00Z" });
    expect(S.updates.at(-1)).toMatchObject({ items: [{ id: "si_pm", deleted: true }], proration_behavior: "none" });
  });
  it("refuses: complimentary-only accounts, Enterprise members, annual plans without a yearly price, duplicates", async () => {
    S.subRow = null;
    expect((await (await post("addon", { action: "preview" })).json()).error.code).toBe("no_subscription");
    S.subRow = { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "active", current_period_end: null, cancel_at_period_end: false };
    S.items = [annual];
    expect((await (await post("addon", { action: "preview" })).json()).error.code).toBe("annual_unavailable");
    S.items = [monthly, addon];
    expect((await (await post("addon", { action: "add" })).json()).error.code).toBe("already_active");
    S.company = { id: "c1", permissions: [] };
    expect((await (await post("addon", { action: "preview" })).json()).error.code).toBe("enterprise_member");
    expect(S.updates.filter((u) => !("preview" in u))).toHaveLength(0); // nothing billed
  });
});

describe("Enterprise PM editors route", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_PROJECT_SCHEDULING", "on");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x"); vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly"); vi.stubEnv("STRIPE_PRICE_ANNUAL", "price_annual");
    vi.stubEnv("STRIPE_PRICE_PM_ADDON", "price_pm_m"); vi.stubEnv("STRIPE_PRICE_PM_EDITOR", "price_pm_ed");
    Object.assign(S, { user: { id: "u1" }, items: [entBase], previewLines: [proration(140)], updates: [], audit: [], pm: { editorsAssigned: 1 },
      company: { id: "c1", permissions: ["manage_billing", "manage_pm_addons"], entitlement: { source: "stripe" } },
      subRow: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "active", current_period_end: "2026-12-01T00:00:00Z" } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("only billing admins", async () => {
    S.company = { id: "c1", permissions: ["manage_users"], entitlement: { source: "stripe" } };
    expect((await post("editors", { action: "preview", extra: 1, fromExtra: 0 })).status).toBe(403);
    // Phase 9: billing alone isn't enough; buying seats is "Manage paid scheduling add-ons".
    S.company = { id: "c1", permissions: ["manage_billing", "manage_pm_seats"], entitlement: { source: "stripe" } };
    expect((await post("editors", { action: "preview", extra: 1, fromExtra: 0 })).status).toBe(403);
  });
  it("previews and buys extra editors, with an audit entry", async () => {
    const pv = await (await post("editors", { action: "preview", extra: 2, fromExtra: 0 })).json();
    expect(pv).toMatchObject({ beforeCents: 0, afterCents: 398, deltaCents: 398, dueNowCents: 140, interval: "month" });
    expect((await post("editors", { action: "confirm", extra: 2, fromExtra: 0, attempt: "attempt-abc" })).status).toBe(200);
    expect(S.updates.at(-1)).toMatchObject({ items: [{ price: "price_pm_ed", quantity: 2 }], proration_behavior: "always_invoice" });
    expect(S.audit.at(-1)).toMatchObject({ action: "billing.pm_editors_added", details: { from: 0, to: 2 } });
  });
  it("removal credits the next invoice and can't drop below assigned editors", async () => {
    S.items = [entBase, editors(2)];
    S.pm = { editorsAssigned: 3 };
    expect((await (await post("editors", { action: "preview", extra: 1, fromExtra: 2 })).json()).error.code).toBe("below_assigned");
    S.pm = { editorsAssigned: 1 };
    await post("editors", { action: "confirm", extra: 0, fromExtra: 2 });
    expect(S.updates.at(-1)).toMatchObject({ items: [{ id: "si_ed", deleted: true }], proration_behavior: "create_prorations" });
  });
  it("complimentary companies arrange editors with Built2Bid; stale previews are refused", async () => {
    S.items = [entBase, editors(1)];
    expect((await (await post("editors", { action: "preview", extra: 2, fromExtra: 0 })).json()).error.code).toBe("editors_changed");
    S.subRow = null; S.company = { id: "c1", permissions: ["manage_billing", "manage_pm_addons"], entitlement: { source: "complimentary" } };
    const j = await (await post("editors", { action: "preview", extra: 1, fromExtra: 0 })).json();
    expect(j.error.message).toMatch(/complimentary/);
  });
});
