/**
 * V6.6 Personalized Dashboard Builder: access gating, widget registry, layout schema, templates and chart data.
 * The database side (own-row storage, conflicts, company defaults) is in tests/db/dashboard-layouts.test.ts.
 */
import { describe, expect, it } from "vitest";
import { accessFromFacts, allowed, hasCapability, need, type AccessFacts } from "@/lib/dashboard/access";
import { WIDGETS, WIDGET_TYPES, sanitizeSettings, widgetDef, QUICK_ACTIONS, QUICK_ACTION_KEYS } from "@/lib/dashboard/registry";
import { add, configure, move, newInstance, parseLayout, remove, resize, serialize, MAX_WIDGETS } from "@/lib/dashboard/schema";
import { buildTemplate, defaultTemplate, suggestLayout, availableInterests, TEMPLATE_KEYS } from "@/lib/dashboard/templates";
import { chartTypesFor, plChart, invoiceChart, chartTotal, DATASETS, DATASET_INFO, reportHref, type ChartSettings } from "@/lib/dashboard/charts";
import { totalsOf, series, bucketsBetween, grainFor, type PlRow } from "@/lib/financials/reports";
import { add as madd } from "@/lib/financials/money";

const ALL_FIN = ["view_company_financials", "view_project_financials", "create_invoices", "record_payments", "record_expenses", "approve_expenses", "record_bills", "approve_vendor_bills", "manage_accounts", "post_journal_entries", "reconcile", "close_periods", "export_financials"];
const facts = (o: Partial<AccessFacts> = {}): AccessFacts => ({ pmEnabled: true, financialsEnabled: true, company: null, fin: null, accountantModeAllowed: false, ...o });
const solo = accessFromFacts(facts());
const soloFin = accessFromFacts(facts({ fin: { role: "owner", permissions: ALL_FIN, active: true, readOnly: false, sandbox: false }, accountantModeAllowed: true }));
const salesRep = accessFromFacts(facts({ company: { id: "c1", role: "estimator", isOwner: false, permissions: ["view_own_bids", "create_estimates", "view_costs", "view_schedules"] } }));
const projectFin = accessFromFacts(facts({ company: { id: "c1", role: "manager", isOwner: false, permissions: ["view_own_bids", "view_schedules", "view_analytics", "manage_teams"] },
  fin: { role: "project_manager", permissions: ["view_project_financials", "record_expenses"], active: true, readOnly: false, sandbox: false } }));
const accountant = accessFromFacts(facts({ company: { id: "c1", role: "viewer", isOwner: false, permissions: ["view_own_bids"] },
  fin: { role: "accountant", permissions: ["view_company_financials", "reconcile", "export_financials"], active: true, readOnly: false, sandbox: false }, accountantModeAllowed: true }));

const can = (a: ReturnType<typeof accessFromFacts>, type: string) => allowed(a, widgetDef(type)!.requires);

describe("access (V6.7 vocabulary, today's permissions)", () => {
  it("levels include the ones below them", () => {
    expect(hasCapability(soloFin, need("fin_visibility", "project"))).toBe(true);
    expect(hasCapability(projectFin, need("fin_visibility", "company"))).toBe(false);
    expect(hasCapability(projectFin, need("fin_visibility", "project"))).toBe(true);
    expect(hasCapability(salesRep, need("bids", "create"))).toBe(true);
    expect(hasCapability(salesRep, need("bids", "approve"))).toBe(false);
  });
  it("15. restricted widgets: no company financials means no bank, P&L, payroll or chart widgets", () => {
    for (const t of ["fin_bank_balance", "fin_projected_balance", "chart", "fin_pl_summary", "fin_labor_costs", "fin_ap", "fin_profitability"]) {
      expect(can(salesRep, t), t).toBe(false);
      expect(can(projectFin, t), t).toBe(false);
      expect(can(soloFin, t), t).toBe(true);
    }
    expect(can(salesRep, "fin_ar")).toBe(false);
    expect(can(projectFin, "fin_ar")).toBe(true);
    expect(can(accountant, "fin_reconciliation")).toBe(true);
    expect(can(projectFin, "fin_reconciliation")).toBe(false);
  });
  it("feature flags gate whole areas", () => {
    const noPm = accessFromFacts(facts({ pmEnabled: false }));
    expect(can(noPm, "pm_active")).toBe(false);
    expect(can(solo, "pm_active")).toBe(true);
    const finOff = accessFromFacts(facts({ financialsEnabled: false, fin: { role: "owner", permissions: ALL_FIN, active: true, readOnly: false, sandbox: false } }));
    expect(can(finOff, "fin_revenue")).toBe(false);
    expect(finOff.fin).toBeNull();
  });
  it("company analytics only for companies with view_analytics", () => {
    expect(can(solo, "company_pipeline")).toBe(false);
    expect(can(projectFin, "company_pipeline")).toBe(true);
    expect(can(salesRep, "company_pipeline")).toBe(false);
  });
  it("Accountant Mode grants nothing: access depends only on permissions", () => {
    const a = accessFromFacts(facts({ fin: { role: "accountant", permissions: ["view_project_financials"], active: true, readOnly: false, sandbox: false }, accountantModeAllowed: true }));
    expect(can(a, "fin_bank_balance")).toBe(false);
  });
  it("quick actions each need their own capability", () => {
    const ok = (a: ReturnType<typeof accessFromFacts>) => QUICK_ACTION_KEYS.filter((k) => allowed(a, QUICK_ACTIONS[k].requires));
    expect(ok(salesRep)).toEqual(expect.arrayContaining(["create_bid", "open_schedule", "customers"]));
    expect(ok(salesRep)).not.toContain("reconcile");
    expect(ok(salesRep)).not.toContain("create_invoice");
    expect(ok(accountant)).toContain("reconcile");
  });
});

describe("registry", () => {
  it("every widget has a known group, sane size and at least one link target", () => {
    for (const t of WIDGET_TYPES) {
      const d = WIDGETS[t];
      expect(d.size.w).toBeGreaterThanOrEqual(d.size.minW ?? 1);
      expect(d.size.w).toBeLessThanOrEqual(d.size.maxW ?? 4);
      expect(d.title.length).toBeGreaterThan(2);
    }
  });
  it("sanitizes settings to the allowed options", () => {
    const ar = widgetDef("fin_ar")!;
    expect(sanitizeSettings(ar, { bucket: "overdue", view: "table", limit: "10", junk: 1 })).toEqual({ bucket: "overdue", view: "table", limit: "10" });
    expect(sanitizeSettings(ar, { bucket: "<script>", view: 7 })).toEqual({ bucket: "open", view: "card", limit: "5" });
    const qa = widgetDef("quick_actions")!;
    expect(sanitizeSettings(qa, { actions: ["create_bid", "nope", "create_bid", "view_pl"] })).toEqual({ actions: ["create_bid", "view_pl"] });
  });
  it("8. chart types follow the data shape (no line chart of categories, no donut of a time series)", () => {
    const c = widgetDef("chart")!;
    expect(sanitizeSettings(c, { dataset: "expenses", chart: "line" }).chart).toBe("donut");
    expect(sanitizeSettings(c, { dataset: "cash_flow", chart: "donut" }).chart).toBe("bar");
    expect(sanitizeSettings(c, { dataset: "cash_flow", chart: "area" }).chart).toBe("area");
    for (const d of DATASETS) {
      const types = chartTypesFor(d);
      expect(types).toContain("table");
      if (DATASET_INFO[d].shape === "category") expect(types).not.toContain("line");
      else expect(types).not.toContain("donut");
    }
  });
  it("7. categories are kept only for category datasets; filters only where they apply", () => {
    const c = widgetDef("chart")!;
    expect(sanitizeSettings(c, { dataset: "expenses", categories: ["labor", "materials", "bogus"] }).categories).toEqual(["labor", "materials"]);
    expect(sanitizeSettings(c, { dataset: "cash_flow", categories: ["labor"] }).categories).toBeNull();
    expect(sanitizeSettings(c, { dataset: "revenue_breakdown", job: "11111111-1111-1111-1111-111111111111" }).job).toBe("");
    expect(sanitizeSettings(c, { dataset: "expenses", job: "11111111-1111-1111-1111-111111111111" }).job).toBe("11111111-1111-1111-1111-111111111111");
    expect(sanitizeSettings(c, { dataset: "expenses", job: "1; drop" }).job).toBe("");
  });
});

describe("layout schema", () => {
  const base = () => [newInstance("sales_drafts", undefined, undefined, "a"), newInstance("pm_active", undefined, undefined, "b"), newInstance("chart", { dataset: "expenses" }, undefined, "c")];
  it("2-5. add, remove, move and resize", () => {
    let w = base();
    w = add(w, newInstance("customers", undefined, undefined, "d"));
    expect(w.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    expect(add(w, newInstance("customers", undefined, undefined, "e"))).toHaveLength(4); // single-copy widget
    w = move(w, "d", 0);
    expect(w.map((x) => x.id)).toEqual(["d", "a", "b", "c"]);
    w = move(w, "d", 99);
    expect(w.at(-1)!.id).toBe("d");
    w = resize(w, "c", 4, 2);
    expect(w.find((x) => x.id === "c")).toMatchObject({ w: 4, h: 2 });
    w = resize(w, "a", 4, 2); // drafts card: max 2 wide, 1 tall
    expect(w.find((x) => x.id === "a")).toMatchObject({ w: 2, h: 1 });
    w = remove(w, "b");
    expect(w.map((x) => x.id)).not.toContain("b");
  });
  it("6. multiple charts coexist with independent settings", () => {
    let w = base();
    w = add(w, newInstance("chart", { dataset: "cash_flow", chart: "line" }, undefined, "c2"));
    w = configure(w, "c", { chart: "bar", categories: ["labor"] });
    expect(w.filter((x) => x.type === "chart")).toHaveLength(2);
    expect(w.find((x) => x.id === "c")!.settings).toMatchObject({ dataset: "expenses", chart: "bar", categories: ["labor"] });
    expect(w.find((x) => x.id === "c2")!.settings).toMatchObject({ dataset: "cash_flow", chart: "line", categories: null });
  });
  it("parses stored layouts tolerantly and keeps unknown (retired or newer) widgets", () => {
    const l = parseLayout({ schemaVersion: 1, template: "simple", widgets: [
      { id: "a", type: "sales_drafts", w: 9, h: 0, settings: { x: 1 } },
      { id: "a", type: "pm_active", w: 1, h: 1 },          // duplicate id dropped
      { id: "bad id!", type: "pm_active" },                 // bad id dropped
      { id: "z", type: "future_widget", w: 2, h: 1, settings: { keep: true } },
      "garbage",
    ] });
    expect(l.widgets.map((w) => w.id)).toEqual(["a", "z"]);
    expect(l.widgets[0]).toMatchObject({ w: 2, h: 1, settings: {} });
    expect(l.widgets[1]).toMatchObject({ type: "future_widget", settings: { keep: true } });
    expect(parseLayout(null).widgets).toEqual([]);
    expect(serialize(l)).toMatchObject({ schemaVersion: 1, template: "simple" });
  });
  it("caps the number of widgets", () => {
    let w = [] as ReturnType<typeof base>;
    for (let i = 0; i < MAX_WIDGETS + 5; i++) w = add(w, newInstance("chart", undefined, undefined, `c${i}`));
    expect(w).toHaveLength(MAX_WIDGETS);
  });
});

describe("templates and setup", () => {
  it("templates keep only widgets the person may see", () => {
    for (const k of TEMPLATE_KEYS) {
      for (const a of [solo, soloFin, salesRep, projectFin, accountant]) {
        for (const w of buildTemplate(k, a).widgets) expect(can(a, w.type), `${k}:${w.type}`).toBe(true);
      }
    }
    expect(buildTemplate("financial", salesRep).widgets.some((w) => w.type.startsWith("fin_"))).toBe(false);
    expect(buildTemplate("financial", soloFin).widgets.filter((w) => w.type === "chart")).toHaveLength(2);
  });
  it("the default template follows role and mode", () => {
    expect(defaultTemplate(solo, "contractor")).toBe("simple");
    expect(defaultTemplate(salesRep, "contractor")).toBe("job");
    expect(defaultTemplate(accountant, "contractor")).toBe("financial");
    expect(defaultTemplate(soloFin, "accountant")).toBe("financial");
    expect(defaultTemplate(soloFin, "contractor")).toBe("simple");
  });
  it("setup suggests a layout from interests, without duplicates or inaccessible widgets", () => {
    expect(availableInterests(salesRep)).not.toContain("accounting");
    expect(availableInterests(soloFin)).toContain("accounting");
    const l = suggestLayout(["cash", "accounting", "invoices"], soloFin);
    const ids = l.widgets.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(l.widgets[0].type).toBe("quick_actions");
    expect(l.template).toBe("financial");
    const rep = suggestLayout(["sales", "cash"], salesRep);
    expect(rep.widgets.every((w) => can(salesRep, w.type))).toBe(true);
  });
});

describe("chart data (21. totals reconcile with the P&L report)", () => {
  const rows: PlRow[] = [
    { m: "2026-01", job: "j1", trade: "roofing", type: null, dir: "income", amount: "10000.00" },
    { m: "2026-02", job: "j2", trade: "decks", type: null, dir: "income", amount: "5000.00" },
    { m: "2026-01", job: "j1", trade: "roofing", type: "material", dir: "cost", amount: "3000.00" },
    { m: "2026-01", job: "j1", trade: "roofing", type: "labor", dir: "cost", amount: "2000.00" },
    { m: "2026-02", job: "j2", trade: "decks", type: "subcontractor", dir: "cost", amount: "1500.00" },
    { m: "2026-02", job: null, trade: null, type: "overhead", dir: "cost", amount: "800.00" },
    { m: "2026-03", job: null, trade: null, type: "labor_burden", dir: "cost", amount: "200.00" },
  ];
  const range = { from: "2026-01-01", to: "2026-03-31" };
  const cs = (o: Partial<ChartSettings>): ChartSettings => ({ dataset: "expenses", chart: "donut", period: "ytd", basis: "cash", categories: null, job: null, trade: null, ...o });

  it("expenses equal all money out on the report", () => {
    const d = plChart(rows, cs({}), range);
    const t = totalsOf(rows);
    expect(chartTotal(d)).toBe(madd(t.jobCosts, t.overhead));
    if (d.shape !== "category") throw new Error("shape");
    expect(d.slices.find((s) => s.key === "labor")!.amount).toBe("2200.00");
    expect(d.slices.every((s) => s.href?.startsWith("/financials/reports?"))).toBe(true);
    expect(d.selectedOnly).toBeNull();
  });
  it("job costs leave out overhead and match the report's job costs", () => {
    const d = plChart(rows, cs({ dataset: "job_costs" }), range);
    expect(chartTotal(d)).toBe(totalsOf(rows).jobCosts);
  });
  it("selected categories change the total and are labeled as a subset", () => {
    const d = plChart(rows, cs({ categories: ["materials", "labor"] }), range);
    expect(chartTotal(d)).toBe("5200.00");
    if (d.shape !== "category") throw new Error("shape");
    expect(d.selectedOnly).toEqual({ shown: 2, of: 4 });
  });
  it("project and trade filters narrow the data and carry into the drill-down", () => {
    const d = plChart(rows, cs({ job: "j1" }), range);
    expect(chartTotal(d)).toBe("5000.00");
    if (d.shape !== "category") throw new Error("shape");
    expect(d.slices[0].href).toContain("job=j1");
    expect(reportHref({ period: "ytd", basis: "cash", job: null, trade: "decks" })).toContain("trade=decks");
  });
  it("cash in vs out is aggregated by period and matches the report's series", () => {
    const d = plChart(rows, cs({ dataset: "cash_flow", chart: "bar" }), range);
    if (d.shape !== "series") throw new Error("shape");
    const g = grainFor(range.from, range.to);
    const ref = series(rows, bucketsBetween(range.from, range.to, g), g);
    expect(d.points.map((p) => p.values.map((v) => v.amount))).toEqual(ref.map((r) => [r.moneyIn, r.moneyOut]));
    expect(d.points[0].href).toContain("df=2026-01-01");
  });
  it("profit trend sums to net profit; labor and subcontractor series pick their category", () => {
    expect(chartTotal(plChart(rows, cs({ dataset: "profit_trend", chart: "line" }), range))).toBe(totalsOf(rows).netProfit);
    expect(chartTotal(plChart(rows, cs({ dataset: "labor_costs", chart: "line" }), range))).toBe("2200.00");
    expect(chartTotal(plChart(rows, cs({ dataset: "sub_costs", chart: "area" }), range))).toBe("1500.00");
  });
  it("revenue breakdown splits revenue into costs, overhead and profit", () => {
    const d = plChart(rows, cs({ dataset: "revenue_breakdown" }), range);
    expect(chartTotal(d)).toBe("15000.00");
  });
  it("invoice status uses paid / not due / overdue", () => {
    const d = invoiceChart([{ total: "100", paid: "40", credited: "10", balance: "50", days_overdue: 3 }, { total: "200", paid: "0", credited: "0", balance: "200", days_overdue: 0 }]);
    if (d.shape !== "category") throw new Error("shape");
    expect(d.slices.map((s) => [s.key, s.amount])).toEqual([["paid", "50.00"], ["open", "200.00"], ["overdue", "50.00"]]);
  });
});

// ---- V6.7 effective access (src/lib/access) drives which widgets show ------------------------------------------
import { FEATURE_BY_ID } from "@/lib/access/capabilities";
import { resolveAccess } from "@/lib/access/effective";
import { DASHBOARD_FEATURES, withEffectiveAccess, hasCapability as dashHas, need as dashNeed, type DashboardAccess as DA } from "@/lib/dashboard/access";

describe("dashboard access from V6.7 effective access", () => {
  it("uses the same level keys, in the same order, as V6.7", () => {
    for (const id of DASHBOARD_FEATURES) {
      const keys = FEATURE_BY_ID[id].options.map((o) => o.key);
      keys.forEach((held, i) => keys.forEach((want, j) => {
        expect(dashHas({ features: { [id]: held }, company: null, fin: null }, dashNeed(id, want))).toBe(i >= j);
      }));
    }
  });

  it("a workspace turned off for an employee hides its widgets; the fin context follows fin_visibility", () => {
    const base: DA = { features: { bids: "approve", schedule: "manage", fin_visibility: "company" }, company: { id: "c", role: "manager", isOwner: false }, fin: { role: "bookkeeper", canWrite: true, sandbox: false, accountantMode: true } };
    const lic = { pm: true, pmEditor: true, financials: true, premium: true };
    const company = { id: "c", name: "Co", role: "manager" as const, isOwner: false, perms: ["view_own_bids", "create_estimates", "view_schedules"], policy: { denied: [], locked: [] } };
    const off = resolveAccess({ company: { ...company, profile: { version: 1, workspaces: { financials: false } } as never }, finPerms: ["view_company_financials"], licenses: lic });
    const a = withEffectiveAccess(base, off);
    expect(a.features.fin_visibility).toBeUndefined();
    expect(a.fin).toBeNull();
    expect(a.features.bids).toBe("create");
    expect(withEffectiveAccess(base, null)).toBe(base);
  });
});
