import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ADV_PLANS, DEFAULT_STAGES, NO_ACCESS, PLAN_META, PRODUCT_IDS, isAcademyMeta, pickerOptions, priceLookupKey, recommendedPlan,
  stageDelta, stagePrice, stageRecommendation, subjectsFor, usd, type Access,
} from "@/lib/academy/advanced/plans";
import { isAdvancedBillingEnabled, isAdvancedFlagOn, isAutoAdvanceAllowed, stripeMode } from "@/lib/academy/advanced/flags";
import { academySubscriptionPayload, advancedErrorMessage, isAcademySubscriptionWith } from "@/lib/academy/advanced/billing";
import { provisionAcademyPrices } from "@/lib/academy/advanced/provision";
import { ADV_SUBJECTS, loadAdvCourses } from "@/lib/academy/advanced/content";

// Paid lesson text isn't in the public repo; these checks run wherever private/academy-advanced/lessons/ exists.
const ADV_COURSES = await loadAdvCourses();

/** Does an in-app href resolve to a static page under src/app (ignoring route groups)? */
function pageExists(href: string): boolean {
  const parts = href.split(/[?#]/)[0].split("/").filter(Boolean);
  const walk = (dir: string, i: number): boolean => {
    if (i === parts.length) return existsSync(path.join(dir, "page.tsx"));
    if (existsSync(path.join(dir, parts[i])) && walk(path.join(dir, parts[i]), i + 1)) return true;
    return readdirSync(dir, { withFileTypes: true }).some((d) => d.isDirectory() && /^\(.+\)$/.test(d.name) && walk(path.join(dir, d.name), i));
  };
  return walk(path.resolve(import.meta.dirname, "../src/app"), 0);
}

const access = (a: Partial<Access>): Access => ({ ...NO_ACCESS, ...a });

describe("founding-member price ladder", () => {
  it("matches the approved stage table exactly", () => {
    const table = DEFAULT_STAGES.map((s) => [s.stage, s.min_members, s.max_members, s.one_subject_cents, s.two_subjects_cents, s.all_access_cents]);
    expect(table).toEqual([
      [1, 1, 10, 999, 1499, 2999], [2, 11, 25, 1299, 1799, 3499], [3, 26, 50, 1499, 2099, 3999], [4, 51, 100, 1799, 2499, 4499], [5, 101, null, 1999, 2999, 4999],
    ]);
  });
  it("stages are contiguous with no gaps or overlaps", () => {
    for (let i = 1; i < DEFAULT_STAGES.length; i++) expect(DEFAULT_STAGES[i].min_members).toBe((DEFAULT_STAGES[i - 1].max_members ?? 0) + 1);
  });
  it("formats prices", () => {
    expect(usd(999)).toBe("$9.99");
    expect(stagePrice(DEFAULT_STAGES[0], "two_subjects")).toBe(1499);
  });
  it("recommends the next stage only when members AND library are ready", () => {
    expect(stageRecommendation(DEFAULT_STAGES, 1, 9, 100).recommend).toBe(false);
    expect(stageRecommendation(DEFAULT_STAGES, 1, 10, 23).recommend).toBe(false);
    const r = stageRecommendation(DEFAULT_STAGES, 1, 10, 24);
    expect(r).toMatchObject({ recommend: true, membersReady: true, libraryReady: true, membersNeeded: 0, lessonsNeeded: 0 });
    expect(stageRecommendation(DEFAULT_STAGES, 5, 500, 500)).toMatchObject({ next: null, recommend: false, membersNeeded: null });
  });
  it("shows the price change for new members", () => {
    expect(stageDelta(DEFAULT_STAGES[0], DEFAULT_STAGES[1]).map((d) => [d.plan, d.from, d.to])).toEqual([["one_subject", 999, 1299], ["two_subjects", 1499, 1799], ["all_access", 2999, 3499]]);
  });
});

describe("picker options", () => {
  it("non-members see all three with Learn + expand recommended", () => {
    const o = pickerOptions(NO_ACCESS, "ai-for-contractors", "business-management");
    expect(o).toEqual({ enter: false, plans: ["one_subject", "two_subjects", "all_access"], upgrade: false });
    expect(recommendedPlan(o.plans)).toBe("two_subjects");
  });
  it("hides Learn + expand without a purchasable partner", () => {
    expect(pickerOptions(NO_ACCESS, "ai-for-contractors", null).plans).toEqual(["one_subject", "all_access"]);
    expect(pickerOptions(NO_ACCESS, "x-subject", "x-subject").plans).toEqual(["one_subject", "all_access"]);
  });
  it("one-subject members get upgrades, two-subject members get All Access only", () => {
    expect(pickerOptions(access({ plan: "one_subject", subjects: ["business-management"] }), "ai-for-contractors", "business-management")).toEqual({ enter: false, plans: ["two_subjects", "all_access"], upgrade: true });
    expect(pickerOptions(access({ plan: "two_subjects", subjects: ["a-subject", "b-subject"] }), "c-subject", "a-subject")).toEqual({ enter: false, plans: ["all_access"], upgrade: true });
  });
  it("owners and All Access go straight in", () => {
    expect(pickerOptions(access({ subjects: ["ai-for-contractors"] }), "ai-for-contractors", null).enter).toBe(true);
    expect(pickerOptions(access({ all_access: true, plan: "all_access" }), "anything", null).enter).toBe(true);
  });
  it("covers the right subjects", () => {
    expect(subjectsFor("one_subject", "a-subject", "b-subject")).toEqual(["a-subject"]);
    expect(subjectsFor("two_subjects", "a-subject", "b-subject")).toEqual(["a-subject", "b-subject"]);
    expect(subjectsFor("two_subjects", "a-subject", "b-subject", ["c-subject"])).toEqual(["a-subject", "c-subject"]);
    expect(subjectsFor("two_subjects", "a-subject", null)).toBeNull();
    expect(subjectsFor("all_access", "a-subject", null)).toEqual([]);
  });
  it("All Access names what it excludes and includes software; the others don't", () => {
    expect(PLAN_META.all_access.software).toBe(true);
    expect(PLAN_META.one_subject.software || PLAN_META.two_subjects.software).toBe(false);
  });
});

describe("release switches", () => {
  it("everything is off by default", () => {
    expect(isAdvancedFlagOn({})).toBe(false);
    expect(isAdvancedBillingEnabled({ STRIPE_SECRET_KEY: "sk_test_x" })).toBe(false);
    expect(isAutoAdvanceAllowed({})).toBe(false);
  });
  it("test billing needs the flag and a key", () => {
    expect(isAdvancedBillingEnabled({ ACADEMY_ADVANCED_BILLING_ENABLED: "on" })).toBe(false);
    expect(isAdvancedBillingEnabled({ ACADEMY_ADVANCED_BILLING_ENABLED: "on", STRIPE_SECRET_KEY: "sk_test_x" })).toBe(true);
  });
  it("live billing needs two extra owner switches", () => {
    const base = { ACADEMY_ADVANCED_BILLING_ENABLED: "on", STRIPE_SECRET_KEY: "sk_live_x" };
    expect(isAdvancedBillingEnabled(base)).toBe(false);
    expect(isAdvancedBillingEnabled({ ...base, STRIPE_ALLOW_LIVE: "true" })).toBe(false);
    expect(isAdvancedBillingEnabled({ ...base, STRIPE_ALLOW_LIVE: "true", ACADEMY_ADVANCED_BILLING_LIVE: "true" })).toBe(true);
  });
  it("maps keys to modes", () => {
    expect(stripeMode({ STRIPE_SECRET_KEY: "sk_live_1" })).toBe("live");
    expect(stripeMode({ STRIPE_SECRET_KEY: "rk_test_1" })).toBe("test");
    expect(stripeMode({})).toBeNull();
  });
});

describe("telling Academy subscriptions apart from Individual Unlimited", () => {
  const sub = (meta: Record<string, string> | null, price = "price_iu") => ({
    id: "sub_1", customer: "cus_1", status: "active", livemode: false, cancel_at_period_end: false, canceled_at: null, ended_at: null, metadata: meta,
    items: { data: [{ current_period_end: 1_900_000_000, price: { id: price, unit_amount: 1499 } }] },
  });
  it("uses the metadata marker or a mapped price", () => {
    expect(isAcademyMeta({ product_line: "academy_advanced" })).toBe(true);
    expect(isAcademySubscriptionWith(sub({ product_line: "academy_advanced" }), new Set())).toBe(true);
    expect(isAcademySubscriptionWith(sub(null, "price_academy"), new Set(["price_academy"]))).toBe(true);
    expect(isAcademySubscriptionWith(sub({ plan: "monthly" }), new Set(["price_academy"]))).toBe(false);
  });
  it("builds the apply payload", () => {
    const p = academySubscriptionPayload(sub({ product_line: "academy_advanced", plan: "two_subjects", subjects: "a-subject, b-subject", stage: "1", quote_id: "not-a-uuid" }), "u1", 1_800_000_000);
    expect(p).toMatchObject({ user_id: "u1", mode: "test", customer_id: "cus_1", price_id: "price_iu", amount_cents: 1499, plan: "two_subjects", subjects: ["a-subject", "b-subject"], quote_id: null, cancel_at_period_end: false });
    expect(p.current_period_end).toBe(new Date(1_900_000_000_000).toISOString());
  });
  it("turns database errors into customer-friendly messages", () => {
    const m = advancedErrorMessage("quote_expired");
    expect(m.code).toBe("quote_expired");
    expect(m.message).not.toMatch(/quote_expired/);
  });
});

describe("Stripe provisioning", () => {
  function fakeStripe(existing: Record<string, { id: string; unit_amount: number }> = {}, products = new Set<string>()) {
    const created: { products: string[]; prices: { lookup_key: string; unit_amount: number }[] } = { products: [], prices: [] };
    const stripe = {
      products: {
        retrieve: vi.fn(async (id: string) => { if (!products.has(id)) throw Object.assign(new Error("No such product"), { statusCode: 404, code: "resource_missing" }); return { id }; }),
        create: vi.fn(async (p: { id: string }) => { products.add(p.id); created.products.push(p.id); return p; }),
      },
      prices: {
        list: vi.fn(async ({ lookup_keys }: { lookup_keys: string[] }) => {
          const e = existing[lookup_keys[0]];
          return { data: e ? [{ id: e.id, unit_amount: e.unit_amount, currency: "usd", recurring: { interval: "month", interval_count: 1 } }] : [] };
        }),
        create: vi.fn(async (p: { lookup_key: string; unit_amount: number }) => {
          const id = `price_${p.lookup_key.replace(/[^a-z0-9]/gi, "")}`;
          existing[p.lookup_key] = { id, unit_amount: p.unit_amount }; created.prices.push(p); return { id };
        }),
      },
    };
    return { stripe: stripe as never, created };
  }
  it("refuses live keys without explicit approval", async () => {
    await expect(provisionAcademyPrices({ stripe: fakeStripe().stripe, db: null, secretKey: "sk_live_x" })).rejects.toThrow("live_provision_refused");
  });
  it("dry run creates nothing", async () => {
    const f = fakeStripe();
    const r = await provisionAcademyPrices({ stripe: f.stripe, db: null, secretKey: "sk_test_x", dryRun: true });
    expect(f.created.products).toEqual([]);
    expect(r.prices).toHaveLength(15);
    expect(r.prices.every((p) => p.status === "planned")).toBe(true);
  });
  it("creates 3 products and 15 prices once, then is idempotent", async () => {
    const f = fakeStripe();
    const r1 = await provisionAcademyPrices({ stripe: f.stripe, db: null, secretKey: "sk_test_x" });
    expect(f.created.products).toEqual(Object.values(PRODUCT_IDS));
    expect(f.created.prices).toHaveLength(15);
    expect(f.created.prices.find((p) => p.lookup_key === priceLookupKey("all_access", 3))?.unit_amount).toBe(3999);
    expect(r1.prices.every((p) => p.status === "created")).toBe(true);
    const r2 = await provisionAcademyPrices({ stripe: f.stripe, db: null, secretKey: "sk_test_x" });
    expect(f.created.prices).toHaveLength(15);
    expect(r2.prices.every((p) => p.status === "existing")).toBe(true);
  });
  it("reports a Stripe price whose amount doesn't match instead of mapping it", async () => {
    const f = fakeStripe({ [priceLookupKey("one_subject", 1)]: { id: "price_wrong", unit_amount: 500 } }, new Set(Object.values(PRODUCT_IDS)));
    const inserted: unknown[] = [];
    const db = { from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [] }) }) }), insert: async (row: unknown) => { inserted.push(row); return { error: null }; } }) };
    const r = await provisionAcademyPrices({ stripe: f.stripe, db, secretKey: "sk_test_x" });
    expect(r.prices.find((p) => p.price_id === "price_wrong")?.status).toBe("mismatch");
    expect(r.problems.join(" ")).toMatch(/price_wrong/);
    expect(inserted).toHaveLength(14);
    expect(r.mapped).toBe(14);
  });
});

describe("advanced lesson content", () => {
  it("has two published subjects paired with each other and the rest upcoming", () => {
    const pub = ADV_SUBJECTS.filter((s) => s.status === "published");
    expect(pub.map((s) => s.slug)).toEqual(["ai-for-contractors", "business-management"]);
    expect(pub[0].next).toBe(pub[1].slug);
    expect(pub[1].next).toBe(pub[0].slug);
    expect(ADV_SUBJECTS.filter((s) => s.status === "upcoming").length).toBeGreaterThanOrEqual(8);
    for (const s of ADV_SUBJECTS) { expect(s.summary.length).toBeLessThanOrEqual(240); expect(s.slug).toMatch(/^[a-z0-9-]{3,60}$/); }
  });
  it.skipIf(ADV_COURSES.length === 0)("finds both paid courses when the lesson files are present", () => expect(ADV_COURSES.map((c) => c.subject)).toEqual(["ai-for-contractors", "business-management"]));
  for (const { subject, course } of ADV_COURSES) {
    describe(subject, () => {
      const lessons = course.lessons ?? [];
      it("is seeded for human review, never as published", () => expect(course.status).toBe("in_review"));
      it("has six lessons plus a capstone with a final assessment", () => {
        expect(lessons).toHaveLength(7);
        const cap = lessons[6];
        expect(cap.slug).toBe("capstone-and-final-assessment");
        expect((cap.quiz ?? []).length).toBeGreaterThanOrEqual(10);
      });
      it("lesson 1 is the free preview and the rest are advanced", () => {
        expect(lessons[0].access).toBe("public");
        expect(lessons.slice(1).every((l) => l.access === "advanced")).toBe(true);
      });
      it("every lesson is complete: body, takeaways, exercise checklist and a valid quiz", () => {
        for (const l of lessons) {
          expect(l.body.length, l.slug).toBeGreaterThan(2500);
          expect((l.takeaways ?? []).length, l.slug).toBeGreaterThanOrEqual(3);
          expect((l.checklist ?? []).length, l.slug).toBeGreaterThanOrEqual(3);
          expect((l.quiz ?? []).length, l.slug).toBeGreaterThanOrEqual(3);
          for (const q of l.quiz ?? []) expect(q.answer, `${l.slug}: ${q.q}`).toBeLessThan(q.options.length);
        }
        expect(new Set(lessons.map((l) => l.slug)).size).toBe(lessons.length);
      });
      it("only points at real in-app pages", () => {
        for (const l of lessons) if (l.action) expect(pageExists(l.action.href), `${l.slug}: ${l.action.href}`).toBe(true);
      });
      it("never claims payroll or end-to-end", () => {
        const text = JSON.stringify(course).toLowerCase();
        expect(text).not.toMatch(/end-to-end/);
        expect(text).not.toMatch(/built2bid (runs|handles|does) payroll/);
      });
    });
  }
  it("every plan has a fixed product id", () => expect(ADV_PLANS.map((p) => PRODUCT_IDS[p]).every((id) => /^prod_[A-Za-z0-9]+$/.test(id))).toBe(true));
});
