/**
 * V4 Phase 10 owner analytics: MRR split by product (core / PM add-on / Enterprise PM editors), no
 * double counting, cancellations at period end, and adoption counts scoped to genuine accounts.
 */
import { describe, expect, it } from "vitest";
import { accountFacts, monthlyCents, mrrParts, revenueModel, scope, type Snapshot, type SubscriptionRow } from "@/lib/admin/model";
import { adoption, EMPTY_PRODUCT, revenueSplit, type ProductData } from "@/lib/admin/product";
import { RANGES } from "@/lib/admin/view";

const NOW = new Date("2026-11-15T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const R30 = { ...RANGES["30d"], key: "30d" as const };
const sub = (user: string, o: Partial<SubscriptionRow> = {}): SubscriptionRow => ({ stripe_subscription_id: `sub_${user}`, user_id: user, stripe_customer_id: `cus_${user}`, status: "active", plan: "monthly", cancel_at_period_end: false, canceled_at: null, ended_at: null, updated_at: ago(3), seat_quantity: null, current_period_end: ago(-27), company_id: null, ...o });
const user = (id: string, email: string) => ({ id, email, created_at: ago(60), email_confirmed_at: ago(60), last_sign_in_at: ago(1) });

function snap(product: ProductData = EMPTY_PRODUCT): Snapshot {
  return {
    users: [user("a", "a@roof.co"), user("b", "b@deck.co"), user("c", "c@paint.co"), user("e", "e@ent.co"), user("x", "gone@roof.co"), user("t", "stripe-test-9@built2bid.test")],
    usersSource: "auth", labels: [], labelsInstalled: true, adminIds: new Set(),
    estimates: [], versions: [], signatures: [], signingRequests: [],
    subscriptions: [
      sub("a", { plan: "monthly", pm_addon: true }),
      sub("b", { plan: "annual", pm_addon: true }),
      sub("c", { plan: "monthly", pm_addon: false, pm_addon_until: ago(-10) }), // removed, still usable until period end
      sub("e", { plan: "enterprise", seat_quantity: 5, pm_extra_editors: 3 }),
      sub("x", { plan: "monthly", status: "canceled", ended_at: ago(5), canceled_at: ago(5), pm_addon: false, pm_addon_until: ago(5) }),
      sub("t", { plan: "monthly", pm_addon: true }),
    ],
    businesses: [], companies: [], members: [], grants: [], consents: [],
    events: ["a", "b", "c", "e", "x", "t"].map((u) => ({ event: "subscribed", user_id: u, created_at: ago(50) })),
    leads: [], leadsInstalled: false, attributionV2: false, costs: [], outbox: [], stripeEvents: [], pdfErrors7d: 0, importFailures7d: 0,
    product, loadedAt: NOW.toISOString(),
  };
}

describe("MRR by product", () => {
  it("splits core, PM add-on and Enterprise editor MRR per subscription", () => {
    expect(mrrParts({ plan: "monthly", seat_quantity: null, pm_addon: true })).toEqual({ core: 1999, pmAddon: 499, pmEditors: 0, total: 2498 });
    expect(mrrParts({ plan: "annual", seat_quantity: null, pm_addon: true })).toEqual({ core: 1658, pmAddon: 417, pmEditors: 0, total: 2075 });
    const ent = mrrParts({ plan: "enterprise", seat_quantity: 5, pm_extra_editors: 3, pm_addon: true });
    expect(ent.pmAddon).toBe(0); // Enterprise includes an editor; no Standard add-on on it
    expect(ent.pmEditors).toBe(597);
    expect(monthlyCents({ plan: "monthly", seat_quantity: null })).toBe(1999); // old rows without PM columns
    expect(mrrParts({ plan: null, seat_quantity: null, pm_addon: true }).total).toBe(0);
  });
  it("totals match the headline MRR, count each subscription once and exclude test accounts", () => {
    const sc = scope(snap(), false);
    const facts = accountFacts(sc, NOW);
    const split = revenueSplit(facts, R30, NOW);
    const rev = revenueModel(facts, R30, NOW);
    expect(split.totalCents).toBe(rev.mrrCents);
    expect(split.totalCents).toBe(split.coreCents + split.pmAddonCents + split.pmEditorCents);
    expect(split.pmAddonSubs).toBe(2); // a + b; c removed it; t is a test account; x ended
    expect(split.pmAddonCents).toBe(499 + 417); // monthly $4.99 + annual $49.99 / 12
    expect(split.pmAddonAnnual).toBe(1);
    expect(split.pmEditorSeats).toBe(3);
    expect(split.pmEditorCents).toBe(597);
    expect(split.pmAddonEnding).toBe(1);
    expect(split.pmAddonEnded).toBe(1);
    // Including test data adds the test account's add-on.
    expect(revenueSplit(accountFacts(scope(snap(), true), NOW), R30, NOW).pmAddonSubs).toBe(3);
  });
});

describe("adoption", () => {
  const product: ProductData = {
    installed: { pipeline: true, schedules: true, publications: true, editors: true, reports: true },
    stages: [{ user_id: "a", pipeline_stage: "won" }, { user_id: "a", pipeline_stage: "draft" }, { user_id: "b", pipeline_stage: "sent" }, { user_id: "c", pipeline_stage: null }, { user_id: "t", pipeline_stage: "won" }],
    stageMoves: [{ changed_by: "a", created_at: ago(3) }, { changed_by: "b", created_at: ago(40) }, { changed_by: "t", created_at: ago(1) }],
    schedules: [{ id: "s1", user_id: "a", company_id: null, status: "active", created_at: ago(4) }, { id: "s2", user_id: "a", company_id: null, status: "archived", created_at: ago(45) }, { id: "s3", user_id: "t", company_id: null, status: "draft", created_at: ago(1) }],
    publications: [{ schedule_id: "s1", published_by: "a", published_at: ago(2) }, { schedule_id: "s3", published_by: "t", published_at: ago(1) }],
    editors: [{ company_id: "co", user_id: "e", assigned_at: ago(9) }],
    reports: [{ user_id: "a", action: "download", created_at: ago(2) }, { user_id: "a", action: "preview", created_at: ago(2) }, { user_id: "b", action: "send", created_at: ago(50) }, { user_id: "t", action: "download", created_at: ago(1) }],
  };
  it("counts usage without amounts and keeps the genuine/test split", () => {
    const sc = scope(snap(product), false);
    const ad = adoption(sc.d.product!, accountFacts(sc, NOW), R30, NOW);
    expect(ad.pipelineAccounts).toBe(2);
    expect(ad.pipelineMovers.current).toBe(1);
    expect(ad.bidsByStage).toEqual([{ stage: "draft", n: 2 }, { stage: "sent", n: 1 }, { stage: "won", n: 1 }]);
    expect(ad.reports.current).toBe(2);
    expect(ad.reportAccounts).toBe(1);
    expect(ad.reportAdoption).toMatchObject({ n: 2, d: 4 });
    expect(ad.schedules).toBe(1);
    expect(ad.schedulesNew.current).toBe(1);
    expect(ad.publications.current).toBe(1);
    expect(ad.editorSeats).toBe(1);
    expect(JSON.stringify(ad)).not.toMatch(/total|price|cost|margin/i);
  });
});
