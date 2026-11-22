import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn(), createClient: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: vi.fn(), assertModeAllowed: vi.fn() }));

import { challengeError, challengePercent, daysLeftInMonth, monthLabel, rewardHeadline, rewardPhase, type ChallengeReward } from "@/lib/academy/rewards";
import { deliverReward, stripeCreditsEnabled } from "@/lib/academy/rewards-server";

const reward = (over: Partial<ChallengeReward> = {}): ChallengeReward => ({
  id: "r1", status: "applied", action: "comp_days", month: "2026-11-01", qualified_at: "2026-11-20T00:00:00Z",
  activates_at: "2026-11-20T00:00:00Z", expires_at: "2026-12-20T00:00:00Z", applied_at: "2026-11-20T00:00:00Z", credit_cents: null, ...over,
});

describe("challenge display helpers", () => {
  it("never shows the reward as available once earned", () => {
    const now = new Date("2026-11-25T00:00:00Z");
    expect(rewardPhase({ reward: null, excluded: null, email_used: false }, now)).toBe("available");
    expect(rewardPhase({ reward: null, excluded: "excluded_test", email_used: false }, now)).toBe("unavailable");
    expect(rewardPhase({ reward: null, excluded: null, email_used: true }, now)).toBe("unavailable");
    expect(rewardPhase({ reward: reward(), excluded: null, email_used: false }, now)).toBe("earned_active");
    expect(rewardPhase({ reward: reward({ activates_at: "2026-12-05T00:00:00Z", expires_at: "2027-01-04T00:00:00Z" }), excluded: null, email_used: false }, now)).toBe("earned_scheduled");
    expect(rewardPhase({ reward: reward(), excluded: null, email_used: false }, new Date("2027-02-01T00:00:00Z"))).toBe("claimed");
    expect(rewardPhase({ reward: reward({ status: "review", action: null }), excluded: null, email_used: false }, now)).toBe("earned_review");
    expect(rewardPhase({ reward: reward({ status: "pending" }), excluded: null, email_used: false }, now)).toBe("earned_processing");
    expect(rewardHeadline("claimed")).toBe("Earned: Lifetime Reward Claimed");
    for (const p of ["earned_active", "earned_review", "claimed"] as const) expect(rewardHeadline(p)).not.toMatch(/^Reward: 1 Free Month/);
  });

  it("computes progress, month labels and days left in UTC", () => {
    expect(challengePercent({ trainings_done: 0, quiz_status: "not_started" })).toBe(0);
    expect(challengePercent({ trainings_done: 2, quiz_status: "failed" })).toBe(40);
    expect(challengePercent({ trainings_done: 6, quiz_status: "passed" })).toBe(100);
    expect(monthLabel("2026-11-01")).toBe("November 2026");
    expect(daysLeftInMonth(new Date("2026-11-30T23:00:00Z"))).toBe(1);
    expect(daysLeftInMonth(new Date("2026-11-01T00:00:00Z"))).toBe(30);
    expect(challengeError("rate_limited")).toMatch(/5 challenge quizzes/);
    expect(challengeError("weird")).toMatch(/try again/);
  });
});

type Call = { name: string; args: Record<string, unknown> };
function mockDb(begin: unknown, extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const db = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "academy_reward_begin") return { data: begin, error: null };
      if (name in extra) return { data: extra[name], error: null };
      return { data: null, error: null };
    }),
  };
  return { db: db as never, calls };
}

function mockStripe(opts: { existing?: { id: string; amount: number; metadata: Record<string, string> }[]; unitAmount?: number; interval?: string } = {}) {
  const create = vi.fn(async () => ({ id: "cbtxn_new" }));
  const stripe = {
    customers: { listBalanceTransactions: vi.fn(async () => ({ data: opts.existing ?? [] })), createBalanceTransaction: create },
    subscriptions: { retrieve: vi.fn(async () => ({ items: { data: [
      { quantity: 1, price: { unit_amount: opts.unitAmount ?? 1999, currency: "usd", recurring: { interval: opts.interval ?? "month", interval_count: 1 } } },
      { quantity: 1, price: { unit_amount: 499, currency: "usd", recurring: { interval: "month", interval_count: 1 } } },
    ] } })) },
  };
  return { stripe: () => stripe as never, create };
}

describe("deliverReward", () => {
  const on = { ACADEMY_REWARD_STRIPE_CREDITS: "on" };

  it("reads the owner's switch strictly", () => {
    expect(stripeCreditsEnabled({})).toBe(false);
    expect(stripeCreditsEnabled({ ACADEMY_REWARD_STRIPE_CREDITS: "true" })).toBe(false);
    expect(stripeCreditsEnabled(on)).toBe(true);
  });

  it("grants 30 days for comp_days without touching Stripe", async () => {
    const { db, calls } = mockDb({ action: "comp_days", id: "r1", starts_at: "2026-11-22T00:00:00Z" }, { academy_reward_grant_comp: { ok: true } });
    const s = mockStripe();
    expect(await deliverReward(db, "r1", { stripe: s.stripe, env: on })).toBe("comp_days");
    expect(calls.map((c) => c.name)).toEqual(["academy_reward_begin", "academy_reward_grant_comp"]);
    expect(s.create).not.toHaveBeenCalled();
  });

  it("parks monthly subscribers for review while the Stripe switch is off", async () => {
    const { db, calls } = mockDb({ action: "stripe_credit", id: "r1", customer: "cus_1", subscription: "sub_1" });
    const s = mockStripe();
    expect(await deliverReward(db, "r1", { stripe: s.stripe, env: {} })).toBe("review");
    expect(calls.at(-1)).toMatchObject({ name: "academy_reward_set_review", args: { p_reason: "monthly_credit_needs_approval" } });
    expect(s.create).not.toHaveBeenCalled();
  });

  it("credits one month of the plan item (not add-ons), capped at $19.99, with an idempotency key", async () => {
    const { db, calls } = mockDb({ action: "stripe_credit", id: "r1", customer: "cus_1", subscription: "sub_1" });
    const s = mockStripe();
    expect(await deliverReward(db, "r1", { stripe: s.stripe, env: on })).toBe("stripe_credit");
    expect(s.create).toHaveBeenCalledWith("cus_1", expect.objectContaining({ amount: -1999, currency: "usd", metadata: { academy_reward_id: "r1" } }), { idempotencyKey: "academy-reward-r1" });
    expect(calls.at(-1)).toMatchObject({ name: "academy_reward_finish", args: { p_ok: true, p_ref: "cbtxn_new", p_cents: 1999 } });
  });

  it("reuses a credit an earlier try already made instead of crediting twice", async () => {
    const { db, calls } = mockDb({ action: "stripe_credit", id: "r1", customer: "cus_1", subscription: "sub_1" });
    const s = mockStripe({ existing: [{ id: "cbtxn_old", amount: -1999, metadata: { academy_reward_id: "r1" } }] });
    expect(await deliverReward(db, "r1", { stripe: s.stripe, env: on })).toBe("stripe_credit");
    expect(s.create).not.toHaveBeenCalled();
    expect(calls.at(-1)).toMatchObject({ name: "academy_reward_finish", args: { p_ok: true, p_ref: "cbtxn_old", p_cents: 1999 } });
  });

  it("does nothing when the database says the reward is already applied, under review or in progress", async () => {
    for (const begin of [{ action: "none", reason: "applied" }, { action: "none", reason: "in_progress" }]) {
      const { db, calls } = mockDb(begin);
      expect(await deliverReward(db, "r1", { stripe: mockStripe().stripe, env: on })).toBe("none");
      expect(calls).toHaveLength(1);
    }
    const { db } = mockDb({ action: "review", reason: "annual_subscriber" });
    expect(await deliverReward(db, "r1", { env: on })).toBe("review");
  });

  it("records a Stripe failure on the reward instead of throwing", async () => {
    const { db, calls } = mockDb({ action: "stripe_credit", id: "r1", customer: "cus_1", subscription: "sub_1" });
    const s = mockStripe();
    s.create.mockRejectedValueOnce(new Error("card_declined"));
    expect(await deliverReward(db, "r1", { stripe: s.stripe, env: on })).toBe("failed");
    expect(calls.at(-1)).toMatchObject({ name: "academy_reward_finish", args: { p_ok: false } });
  });

  it("refuses an admin-forced Stripe credit while the switch is off", async () => {
    const { db, calls } = mockDb({ action: "stripe_credit", id: "r1", customer: "cus_1", subscription: "sub_1" });
    expect(await deliverReward(db, "r1", { force: "stripe_credit", actor: "admin", stripe: mockStripe().stripe, env: {} })).toBe("none");
    expect(calls).toHaveLength(0);
  });
});
